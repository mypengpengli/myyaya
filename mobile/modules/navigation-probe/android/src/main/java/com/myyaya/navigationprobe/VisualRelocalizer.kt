package com.myyaya.navigationprobe

import com.google.ar.core.Frame
import com.google.ar.core.TrackingState
import org.opencv.android.OpenCVLoader
import org.opencv.core.*
import org.opencv.features2d.SIFT
import org.opencv.features2d.DescriptorMatcher
import org.opencv.calib3d.Calib3d
import java.io.File
import java.security.MessageDigest
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.io.ByteArrayOutputStream
import android.graphics.Bitmap
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.*

/** Sparse RGB/3D landmarks. ARCore supplies metric points; PnP recovers a new session's map alignment. */
internal class VisualRelocalizer(private val mapDirectory: File,evidenceDirectory: File?=null) {
  data class Match(val mapId: String,val session: String,val timestamp: Long,val worldFromMap: RigidPose,val inliers: Int)
  private data class Input(val gray: ByteArray,val width: Int,val height: Int,val k: FloatArray,
    val raw: RigidPose,val mapped: RigidPose?,val cloud: List<FloatArray>,val map: RoomMapData,val session: String,val ns: Long,
    val cloudStats: Map<String,Any?>,val localizationTrusted: Boolean)
  private data class Estimate(val keyframe: VisualKeyframe,val camera: RigidPose,val inliers: Int)
  private data class Observation(val mapId: String,val ns: Long,val pose: RigidPose,val k: FloatArray,
    val pixels: Array<Point>,val descriptors: ByteArray)
  private val observations=ArrayList<Observation>()
  private val worker=Executors.newSingleThreadExecutor()
  private val busy=AtomicBoolean(false)
  private val store=VisualLandmarkStore(File(mapDirectory,"visual-landmarks"))
  private val evidence=evidenceDirectory?.apply {mkdirs()}?.let {File(it,"visual-live.ndjson")}
  private val library=LinkedHashMap<String,List<VisualKeyframe>>()
  private val consensus=VisualPoseConsensus()
  private var workerSession=""
  private var firstView: RigidPose?=null
  private var candidateMap=""
  private var learningStats: Map<String,Any?> = emptyMap()
  private var matchStats: Map<String,Any?> = emptyMap()
  private fun rejected(stage: String,pairs: Int,inliers: Int=0): Estimate? {
    if(pairs>=(matchStats["descriptorMatches"] as? Int ?: 0))
      matchStats=mapOf("rejectedStage" to stage,"descriptorMatches" to pairs,"pnpInliers" to inliers)
    return null
  }
  private var lastOffer=0L
  private var lastCatalog=0L
  @Volatile private var closed=false
  @Volatile private var match: Match?=null
  @Volatile private var state: Map<String,Any?> = mapOf("status" to "WAITING_FOR_CAMERA")
  fun report()=state
  fun candidate(session: String,ns: Long)=match?.takeIf {it.session==session && ns-it.timestamp in 0..1_500_000_000L}
  fun close() {closed=true;match=null;worker.shutdown()}
  private fun key(m: RoomMapData)=MessageDigest.getInstance("SHA-256").digest(m.referenceJpeg+m.referenceWidth.toString().toByteArray())
    .joinToString("") {"%02x".format(it)}
  fun offer(frame: Frame,map: RoomMapData,mapped: RigidPose?,session: String,localizationTrusted: Boolean=mapped!=null) {
    if(closed || frame.camera.trackingState!=TrackingState.TRACKING || frame.timestamp-lastOffer<400_000_000L || !busy.compareAndSet(false,true))return
    lastOffer=frame.timestamp
    val input=try {
      frame.acquireCameraImage().use {image->
        require(abs(image.timestamp-frame.timestamp)<100_000_000L && image.width*image.height<=1280*960)
        val plane=image.planes[0];val b=plane.buffer;val base=b.position();val gray=ByteArray(image.width*image.height)
        if(plane.pixelStride==1) {
          val row=b.duplicate()
          for(y in 0 until image.height){row.position(base+y*plane.rowStride);row.get(gray,y*image.width,image.width)}
        } else for(y in 0 until image.height)for(x in 0 until image.width)gray[y*image.width+x]=b.get(base+y*plane.rowStride+x*plane.pixelStride)
        val intr=frame.camera.imageIntrinsics;require(intr.imageDimensions.contentEquals(intArrayOf(image.width,image.height)))
        val f=intr.focalLength;val c=intr.principalPoint
        val cloud=ArrayList<FloatArray>()
        var cloudStats: Map<String,Any?> = emptyMap()
        if(mapped!=null)frame.acquirePointCloud().use {pc->
          cloudStats=mapOf("rawTrackedPoints" to pc.points.remaining()/4,"pointCloudAgeMs" to (frame.timestamp-pc.timestamp)/1_000_000L)
          if(VisualPoseConsensus.acceptsPointCloud(frame.timestamp,pc.timestamp)) {
            val points=pc.points
            while(points.remaining()>=4 && cloud.size<2500) {
              val p=floatArrayOf(points.get(),points.get(),points.get());val confidence=points.get()
              if(confidence>=.5f)cloud.add(p)
            }
          }
        }
        Input(gray,image.width,image.height,floatArrayOf(f[0],f[1],c[0],c[1]),
          RigidPose(frame.camera.pose.translation,frame.camera.pose.rotationQuaternion),mapped,cloud,map,session,frame.timestamp,cloudStats,localizationTrusted)
      }
    }catch(_: Exception){busy.set(false);return}
    try {worker.execute {
      try {if(!closed)process(input)}catch(e: Exception){match=null;consensus.reset();state=mapOf("status" to "VISION_ERROR","reason" to (e.message ?: e.javaClass.simpleName))}
      finally {runCatching {record(input)};busy.set(false)}
    }}catch(_: java.util.concurrent.RejectedExecutionException){busy.set(false)}
  }
  private fun record(i: Input) {
    val file=evidence ?: return
    if(file.length()>2_000_000) {
      val previous=File(file.parentFile,"visual-previous.ndjson")
      if(previous.exists())check(previous.delete())
      check(file.renameTo(previous))
    }
    file.appendText(JSONObject(state+mapOf("frameNs" to i.ns,"epochMs" to System.currentTimeMillis(),
      "session" to i.session,"mapId" to i.map.id,"cameraTranslation" to i.raw.t.toList(),
      "cameraQuaternion" to i.raw.q.toList(),"mapCameraTranslation" to i.mapped?.t?.toList(),
      "imageWidth" to i.width,"imageHeight" to i.height,"detector" to "SIFT")).toString()+"\n")
  }
  private fun process(i: Input) {
    check(OpenCVLoader.initLocal()) {"OpenCV 初始化失败"}
    if(workerSession!=i.session){consensus.reset();match=null;firstView=null;candidateMap="";observations.clear();workerSession=i.session}
    if(lastCatalog==0L || i.ns-lastCatalog>10_000_000_000L) {
      val ids=mapDirectory.listFiles()?.filter {it.extension=="yayamap"}?.sortedByDescending {it.lastModified()}
        ?.take(8)?.map {it.nameWithoutExtension}.orEmpty()+i.map.id
      library.keys.retainAll(ids.toSet())
      ids.distinct().forEach {id->if(!library.containsKey(id))library[id]=runCatching {store.load(id)}.getOrElse {emptyList()}}
      lastCatalog=i.ns
    }
    val fingerprint=key(i.map)
    library[i.map.id]=library[i.map.id].orEmpty().filter {it.referenceKey==fingerprint}
    val gray=Mat(i.height,i.width,CvType.CV_8UC1);val descriptors=Mat();val features=MatOfKeyPoint();val mask=Mat()
    val detector=SIFT.create(900)
    try {
      gray.put(0,0,i.gray);detector.detectAndCompute(gray,mask,features,descriptors)
      if(descriptors.rows()<2){match=null;consensus.reset();state=mapOf("status" to "NEED_TEXTURE");return}
      val kp=features.toArray()
      if(i.mapped!=null) {
        learn(i,kp,descriptors,fingerprint)
        if(i.localizationTrusted) {
          match=null;consensus.reset();firstView=null;state=mapOf("status" to "LEARNING","keyframes" to library[i.map.id].orEmpty().size,"mapId" to i.map.id)+learningStats
          return
        }
      }
      if(i.mapped==null)observations.clear()
      matchStats=emptyMap()
      val all=library.values.flatMap {frames->frames.mapNotNull {estimate(it,kp,descriptors,i)}}
      val estimates=all.groupBy {it.keyframe.mapId}.values.mapNotNull {it.maxByOrNull {e->e.inliers}}
        .sortedByDescending {it.inliers}
      val best=estimates.firstOrNull()
      if(best==null || estimates.getOrNull(1)?.let {best.inliers<it.inliers*1.35}==true) {
        match=null;consensus.reset();firstView=null
        state=if(best==null && i.mapped!=null)mapOf("status" to "LEARNING","keyframes" to library[i.map.id].orEmpty().size,"bootstrap" to true)+learningStats+matchStats
          else mapOf("status" to if(best==null) "UNKNOWN_LOCATION" else "AMBIGUOUS_LOCATION")+matchStats
        return
      }
      val transform=i.raw.compose(best.camera.inverse())
      // Both map and ARCore session use gravity. Reject upside-down/tilted PnP solutions.
      val up=transform.point(floatArrayOf(0f,1f,0f));val gravity=up[1]-transform.t[1]
      if(gravity<cos(Math.toRadians(8.0))){match=null;consensus.reset();state=mapOf("status" to "GRAVITY_MISMATCH");return}
      if(candidateMap!=best.keyframe.mapId || firstView==null) {candidateMap=best.keyframe.mapId;firstView=i.raw}
      val first=requireNotNull(firstView)
      val multiView=all.count {it.keyframe.mapId==best.keyframe.mapId && VisualPoseConsensus.distance(it.camera,best.camera)<.10 && VisualPoseConsensus.angle(it.camera,best.camera)<.12}>=2 ||
        VisualPoseConsensus.distance(first,i.raw)>.06 || VisualPoseConsensus.angle(first,i.raw)>.12
      val confirmed=consensus.offer(best.keyframe.mapId,transform,i.ns) && multiView
      match=if(confirmed)Match(best.keyframe.mapId,i.session,i.ns,transform,best.inliers) else null
      state=mapOf("status" to if(confirmed) "MATCH_CONFIRMED" else "VERIFYING","candidateMapId" to best.keyframe.mapId,"inliers" to best.inliers)
    } finally {gray.release();descriptors.release();features.release();mask.release();detector.clear()}
  }
  private fun learn(i: Input,kp: Array<KeyPoint>,descriptors: Mat,fingerprint: String) {
    learningStats=i.cloudStats+mapOf("trackedPoints" to i.cloud.size,"imageFeatures" to kp.size)
    val pose=requireNotNull(i.mapped);val old=library[i.map.id].orEmpty()
    if(old.any {VisualPoseConsensus.distance(it.pose,pose)<.06 && VisualPoseConsensus.angle(it.pose,pose)<.12})return
    val inv=i.raw.inverse();val toMap=pose.compose(inv)
    val projected=i.cloud.mapNotNull {p->
      val c=inv.point(p);val z=-c[2]
      if(z !in .15f..6f)null else Triple(Point((i.k[0]*c[0]/z+i.k[2]).toDouble(),(i.k[3]-i.k[1]*c[1]/z).toDouble()),toMap.point(p),z)
    }
    val xyz=ArrayList<FloatArray>();val bytes=ArrayList<Byte>();val used=HashSet<Int>()
    learningStats=learningStats+mapOf("projectedPoints" to projected.size)
    kp.forEachIndexed {index,k->
      if(xyz.size>=400)return@forEachIndexed
      var nearest=-1;var distance=9.0
      for(n in projected.indices) {
        if(n in used)continue
        val p=projected[n].first;val d=(p.x-k.pt.x).pow(2)+(p.y-k.pt.y).pow(2)
        if(d<=distance){distance=d;nearest=n}
      }
      if(nearest<0)return@forEachIndexed
      used.add(nearest);xyz.add(projected[nearest].second)
      bytes.addAll(descriptorBytes(descriptors,index,1).toList())
    }
    learningStats=learningStats+mapOf("associatedPoints" to xyz.size)
    if(xyz.size<24) {
      val generated=observations.filter {it.mapId==i.map.id && i.ns-it.ns in 1..15_000_000_000L &&
        VisualPoseConsensus.distance(it.pose,pose) in .05..1.0 && VisualPoseConsensus.angle(it.pose,pose)<1.0}
        .take(3).mapNotNull {triangulate(it,i,kp,descriptors)}.maxByOrNull {it.first.size}
      learningStats=learningStats+mapOf("triangulationCandidates" to (generated?.first?.size ?: 0))
      if(generated!=null && generated.first.size>=24) {
        xyz.clear();xyz.addAll(generated.first);bytes.clear();bytes.addAll(generated.second.toList())
        learningStats=learningStats+mapOf("triangulatedPoints" to xyz.size)
      }
    }
    val last=observations.lastOrNull()
    if(last==null || last.mapId!=i.map.id || VisualPoseConsensus.distance(last.pose,pose)>.04 || VisualPoseConsensus.angle(last.pose,pose)>.08) {
      val data=descriptorBytes(descriptors,0,descriptors.rows())
      observations.add(Observation(i.map.id,i.ns,pose,i.k.clone(),kp.map {Point(it.pt.x,it.pt.y)}.toTypedArray(),data))
      while(observations.size>8)observations.removeAt(0)
    }
    if(xyz.size<24)return
    val bitmap=Bitmap.createBitmap(i.width,i.height,Bitmap.Config.ARGB_8888)
    val photo=try {
      val pixels=IntArray(i.gray.size) {n->val v=i.gray[n].toInt() and 255;0xff000000.toInt() or (v shl 16) or (v shl 8) or v}
      bitmap.setPixels(pixels,0,i.width,0,0,i.width,i.height)
      ByteArrayOutputStream().use {out->check(bitmap.compress(Bitmap.CompressFormat.JPEG,92,out));out.toByteArray()}
    }finally {bitmap.recycle()}
    val next=(old+VisualKeyframe(i.map.id,fingerprint,pose,xyz,bytes.toByteArray(),photo,i.k.clone(),i.width,i.height)).takeLast(12)
    store.save(i.map.id,next);library[i.map.id]=next
    evidence?.parentFile?.let {folder->
      runCatching {VisualLandmarkStore(folder).save(i.map.id,next)}
        .onFailure {learningStats=learningStats+mapOf("evidenceError" to it.message)}
    }
  }
  private fun descriptorBytes(matrix: Mat,row: Int,rows: Int): ByteArray {
    val values=FloatArray(rows*128);matrix.get(row,0,values)
    return ByteBuffer.allocate(values.size*4).order(ByteOrder.LITTLE_ENDIAN).apply {asFloatBuffer().put(values)}.array()
  }
  private fun loadDescriptors(matrix: Mat,bytes: ByteArray) {
    val values=FloatArray(bytes.size/4)
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(values)
    matrix.put(0,0,values)
  }
  /** Known metric camera poses supply scale when ARCore exposes too few sparse points. */
  private fun triangulate(previous: Observation,i: Input,kp: Array<KeyPoint>,descriptors: Mat): Pair<List<FloatArray>,ByteArray>? {
    val pose=requireNotNull(i.mapped)
    fun projection(pose: RigidPose,k: FloatArray): Mat {
      val inverse=pose.inverse();val out=Mat(3,4,CvType.CV_64F)
      for(c in 0..3) {
        val v=if(c==3)inverse.t else inverse.point(FloatArray(3) {if(it==c)1f else 0f}).let {p->FloatArray(3) {p[it]-inverse.t[it]}}
        out.put(0,c,(k[0]*v[0]-k[2]*v[2]).toDouble())
        out.put(1,c,(-k[1]*v[1]-k[3]*v[2]).toDouble());out.put(2,c,-v[2].toDouble())
      }
      return out
    }
    val reference=Mat(previous.pixels.size,128,CvType.CV_32F);val matches=ArrayList<MatOfDMatch>()
    val matcher=DescriptorMatcher.create(DescriptorMatcher.FLANNBASED)
    val a=projection(previous.pose,previous.k);val b=projection(pose,i.k)
    val pa=MatOfPoint2f();val pb=MatOfPoint2f();val homogeneous=Mat()
    try {
      loadDescriptors(reference,previous.descriptors);matcher.knnMatch(reference,descriptors,matches,2)
      val pairs=matches.mapNotNull {row->val m=row.toArray();m.firstOrNull()?.takeIf {m.size==2 && it.distance<300 && it.distance<m[1].distance*.72}}
        .sortedBy {it.distance}.distinctBy {it.trainIdx}.take(400)
      if(pairs.size<24)return null
      pa.fromList(pairs.map {previous.pixels[it.queryIdx]});pb.fromList(pairs.map {kp[it.trainIdx].pt})
      Calib3d.triangulatePoints(a,b,pa,pb,homogeneous)
      val oldInverse=previous.pose.inverse();val inverse=pose.inverse()
      val xyz=ArrayList<FloatArray>();val bytes=ArrayList<Byte>()
      for(n in pairs.indices) {
        val w=homogeneous.get(3,n)[0];if(!w.isFinite() || abs(w)<1e-8)continue
        val p=FloatArray(3) {(homogeneous.get(it,n)[0]/w).toFloat()}
        if(p.any {!it.isFinite() || abs(it)>25})continue
        val old=oldInverse.point(p);val current=inverse.point(p)
        if(-old[2] !in .15f..6f || -current[2] !in .15f..6f)continue
        fun error(c: FloatArray,k: FloatArray,pixel: Point)=hypot(k[0]*c[0]/-c[2]+k[2]-pixel.x,k[3]-k[1]*c[1]/-c[2]-pixel.y)
        if(error(old,previous.k,previous.pixels[pairs[n].queryIdx])>1.5 || error(current,i.k,kp[pairs[n].trainIdx].pt)>1.5)continue
        val v=FloatArray(3) {p[it]-previous.pose.t[it]};val u=FloatArray(3) {p[it]-pose.t[it]}
        val dot=(0..2).sumOf {(v[it]*u[it]).toDouble()};val norm=sqrt(v.sumOf {(it*it).toDouble()}*u.sumOf {(it*it).toDouble()})
        if(norm<1e-6 || dot/norm>cos(Math.toRadians(1.5)))continue
        xyz.add(p);bytes.addAll(descriptorBytes(descriptors,pairs[n].trainIdx,1).toList())
      }
      return xyz to bytes.toByteArray()
    } finally {
      listOf(reference,a,b,pa,pb,homogeneous).forEach {it.release()};matches.forEach {it.release()};matcher.clear()
    }
  }
  private fun estimate(key: VisualKeyframe,kp: Array<KeyPoint>,descriptors: Mat,i: Input): Estimate? {
    val reference=Mat(key.points.size,128,CvType.CV_32F);val matches=ArrayList<MatOfDMatch>()
    val matcher=DescriptorMatcher.create(DescriptorMatcher.FLANNBASED)
    val xyz=MatOfPoint3f();val uv=MatOfPoint2f();val camera=Mat.eye(3,3,CvType.CV_64F)
    val distortion=MatOfDouble();val rv=Mat();val tv=Mat();val inliers=Mat();val rotation=Mat();val reprojection=MatOfPoint2f()
    try {
      loadDescriptors(reference,key.descriptors);matcher.knnMatch(reference,descriptors,matches,2)
      val pairs=matches.mapNotNull {row->val a=row.toArray();a.firstOrNull()?.takeIf {a.size==2 && it.distance<300 && it.distance<a[1].distance*.75}}
        .sortedBy {it.distance}.distinctBy {it.trainIdx}
      if(pairs.size<16)return rejected("DESCRIPTORS",pairs.size)
      xyz.fromList(pairs.map {val p=key.points[it.queryIdx];Point3(p[0].toDouble(),p[1].toDouble(),p[2].toDouble())})
      uv.fromList(pairs.map {kp[it.trainIdx].pt})
      camera.put(0,0,i.k[0].toDouble());camera.put(1,1,i.k[1].toDouble());camera.put(0,2,i.k[2].toDouble());camera.put(1,2,i.k[3].toDouble())
      if(!Calib3d.solvePnPRansac(xyz,uv,camera,distortion,rv,tv,false,150,3f,.995,inliers,Calib3d.SOLVEPNP_EPNP))return rejected("PNP",pairs.size)
      if(inliers.rows()<12 || inliers.rows()<pairs.size*.55)return rejected("INLIERS",pairs.size,inliers.rows())
      val ids=(0 until inliers.rows()).map {inliers.get(it,0)[0].toInt()}
      val bins=ids.map {val p=kp[pairs[it].trainIdx].pt;(p.x/i.width*3).toInt() to (p.y/i.height*3).toInt()}.toSet()
      if(bins.size<4)return rejected("IMAGE_COVERAGE",pairs.size,inliers.rows())
      Calib3d.Rodrigues(rv,rotation);val r=DoubleArray(9);val t=DoubleArray(3);rotation.get(0,0,r);tv.get(0,0,t)
      val pose=VisualPoseConsensus.fromPnP(r,t)
      // Every accepted correspondence must lie in front of the estimated camera.
      val inverse=pose.inverse()
      if(ids.count {inverse.point(key.points[pairs[it].queryIdx])[2]<-.10f}<ids.size*.95)return rejected("CHEIRALITY",pairs.size,ids.size)
      Calib3d.projectPoints(xyz,rv,tv,camera,distortion,reprojection)
      val projected=reprojection.toArray();val actual=uv.toArray()
      val error=ids.sumOf {n->hypot(projected[n].x-actual[n].x,projected[n].y-actual[n].y)}/ids.size
      if(error>2.0 || pose.t.any {abs(it)>25})return rejected("REPROJECTION",pairs.size,ids.size)
      return Estimate(key,pose,ids.size)
    } finally {
      listOf(reference,xyz,uv,camera,distortion,rv,tv,inliers,rotation,reprojection).forEach {it.release()}
      matches.forEach {it.release()};matcher.clear()
    }
  }
}
