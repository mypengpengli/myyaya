package com.myyaya.navigationprobe

import com.google.ar.core.Frame
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import org.opencv.android.OpenCVLoader
import org.opencv.core.*
import org.opencv.imgproc.Imgproc
import org.opencv.video.Video
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.io.File
import java.util.UUID
import org.json.JSONObject
import kotlin.math.*

/** Read-only sparse flow worker. Manual lower-image floor ROI is an assumption, not segmentation/free space. */
internal class FloorFlowDiagnostic(private val evidenceDirectory: File?=null) {
  private data class Input(val gray: ByteArray,val width: Int,val height: Int,val time: Long,val q: FloatArray,
    val fx: Float,val fy: Float,val cx: Float,val cy: Float,val measuredHeight: Float,val region: FloorFlowRegion,val capturedAtMs: Long,val frameTime: Long,val gapLimitNs: Long)
  private val worker=Executors.newSingleThreadExecutor()
  private val busy=AtomicBoolean(false)
  private val epoch=AtomicInteger(0)
  @Volatile private var closed=false
  @Volatile private var state: Map<String,Any?> = mapOf("status" to "MEASURED_FLOOR_REQUIRED","autonomousMotionAuthorized" to false)
  @Volatile private var sampleAt=0L
  private var workerEpoch=-1
  private var previous: Mat?=null
  private var points: Array<Point> = emptyArray()
  private var reference: List<FloorFlowGeometry.Point> = emptyList()
  private var referenceTime=0L
  private var previousTime=0L
  private val chain=FloorFlowTrackChain()
  private var featuresAdded=0
  private var replenishments=0
  private val evidenceArmed=AtomicBoolean(false)
  private var evidenceReference: Input?=null
  @Volatile private var evidenceFile: String?=null
  fun armEvidence(): Boolean { if(evidenceDirectory==null) return false;evidenceFile=null;evidenceArmed.set(true);return true }
  private var initialized=false
  @Volatile private var latestFrameNs=0L
  @Volatile private var preview: Bitmap?=null
  private var previewAt=0L
  fun previewSnapshot(): Bitmap?=preview
  @Volatile var region=FloorFlowRegion.TRAVEL_CENTER;private set
  @Synchronized fun selectRegion(value: FloorFlowRegion) { region=value;reset() }
  fun reset() { epoch.incrementAndGet();sampleAt=0;preview=null;state=mapOf("status" to "RESET","region" to region.report(),"autonomousMotionAuthorized" to false) }
  fun close() { if(closed) return;closed=true;reset();worker.execute { clear() };worker.shutdown() }
  fun report(): Map<String,Any?> {
    val snapshot=state;val sampled=(snapshot["sampleTimestampNs"] as? Number)?.toLong()
    return if(sampled!=null && latestFrameNs-sampled>500_000_000L)
      (snapshot-setOf("cameraDxMeters","cameraDzMeters"))+mapOf("status" to "FLOW_STALE","cumulativePoseAvailable" to false,
        "cumulativeCameraDxMeters" to null,"cumulativeCameraDzMeters" to null) else snapshot
  }
  fun offer(frame: Frame,height: Float?,boundedMotion: Boolean=false) {
    latestFrameNs=frame.timestamp
    if(closed || height==null || frame.timestamp-sampleAt<66_000_000L || !busy.compareAndSet(false,true)) return
    sampleAt=frame.timestamp;val (generation,selectedRegion)=synchronized(this) { epoch.get() to region }
    val input=try {
      frame.acquireCameraImage().use { image ->
        require(abs(frame.timestamp-image.timestamp)<=100_000_000L)
        require(image.width*image.height<=1280*960)
        val plane=image.planes[0];val buffer=plane.buffer;val bytes=ByteArray(image.width*image.height)
        val base=buffer.position()
        if(plane.pixelStride==1) {
          val row=buffer.duplicate()
          for(y in 0 until image.height) {row.position(base+y*plane.rowStride);row.get(bytes,y*image.width,image.width)}
        } else for(y in 0 until image.height) for(x in 0 until image.width) bytes[y*image.width+x]=buffer.get(base+y*plane.rowStride+x*plane.pixelStride)
        val k=frame.camera.imageIntrinsics;val f=k.focalLength;val c=k.principalPoint
        check(k.imageDimensions.contentEquals(intArrayOf(image.width,image.height)))
        Input(bytes,image.width,image.height,image.timestamp,frame.camera.pose.rotationQuaternion,f[0],f[1],c[0],c[1],height,selectedRegion,android.os.SystemClock.elapsedRealtime(),frame.timestamp,if(boundedMotion) 2_000_000_000L else 400_000_000L)
      }
    } catch(_: Exception) { busy.set(false);return }
    runCatching { worker.execute {
      val workStarted=android.os.SystemClock.elapsedRealtime()
      try {
        if(workerEpoch!=generation) { clear();workerEpoch=generation }
        if(!initialized) { check(OpenCVLoader.initLocal()) { "OpenCV load failed" };initialized=true }
        val result=if(android.os.SystemClock.elapsedRealtime()-input.capturedAtMs>250) {
          // Library warm-up or a delayed worker must not establish an already stale origin.
          chain.report(false)+mapOf("status" to "WORKER_DELAY","referenceTimestampNs" to referenceTime)
        } else {
          if(input.time-previewAt>=1_000_000_000L) {
            val snapshot=createPreview(input)
            if(!closed && epoch.get()==generation) preview=snapshot
            previewAt=input.time
          }
          process(input)
        }
        if(!closed && epoch.get()==generation) state=result+mapOf("sampleTimestampNs" to input.time,
          "evidenceFile" to evidenceFile,"cameraImageLagMs" to (input.frameTime-input.time)/1_000_000.0,
          "workerDurationMs" to android.os.SystemClock.elapsedRealtime()-workStarted,
          "measuredHeightMeters" to height,"region" to input.region.report(),"source" to "rolling-floor-flow-fixed-height","autonomousMotionAuthorized" to false)
      } catch(error: Throwable) {
        releaseTracking()
        if(!closed && epoch.get()==generation) state=chain.report(false)+mapOf("status" to "FLOW_UNAVAILABLE","error" to error.javaClass.simpleName,"autonomousMotionAuthorized" to false)
      } finally { busy.set(false) }
    } }.onFailure { busy.set(false) }
  }
  private fun releaseTracking() { previous?.release();previous=null;points=emptyArray();reference=emptyList();previousTime=0;referenceTime=0;evidenceReference=null }
  private fun clear() { releaseTracking();chain.reset();featuresAdded=0;replenishments=0;previewAt=0 }
  private fun createPreview(i: Input): Bitmap {
    val width=320;val height=(width*i.height/i.width).coerceAtLeast(1)
    val pixels=IntArray(width*height) { n ->
      val x=(n%width)*i.width/width;val y=(n/width)*i.height/height
      val gray=i.gray[y*i.width+x].toInt() and 255;Color.rgb(gray,gray,gray)
    }
    return Bitmap.createBitmap(pixels,width,height,Bitmap.Config.ARGB_8888).copy(Bitmap.Config.ARGB_8888,true).also { bitmap ->
      val paint=Paint().apply { color=Color.YELLOW;style=Paint.Style.STROKE;strokeWidth=2f }
      Canvas(bitmap).drawRect(i.region.left*width,i.region.top*height,i.region.right*width,i.region.bottom*height,paint)
    }
  }
  private fun project(p: Point,i: Input)=FloorFlowGeometry.project(p.x,p.y,i.fx.toDouble(),i.fy.toDouble(),i.cx.toDouble(),i.cy.toDouble(),i.q,i.measuredHeight)
  private fun detectFresh(gray: Mat,i: Input,existing: Array<Point>): List<Pair<Point,FloorFlowGeometry.Point>> {
    val mask=Mat.zeros(i.height,i.width,CvType.CV_8UC1)
    val found=ArrayList<Pair<Point,FloorFlowGeometry.Point>>()
    try {
      Imgproc.rectangle(mask,Point(i.region.left*i.width.toDouble(),i.region.top*i.height.toDouble()),
        Point(i.region.right*i.width.toDouble(),i.region.bottom*i.height.toDouble()),Scalar(255.0),-1)
      for(p in existing) Imgproc.circle(mask,p,5,Scalar(0.0),-1)
      for(row in 0..2) for(col in 0..3) {
        if(existing.size+found.size>=600) continue
        val x0=((i.region.left+(i.region.right-i.region.left)*col/4)*i.width).toInt().coerceIn(0,i.width-1)
        val x1=((i.region.left+(i.region.right-i.region.left)*(col+1)/4)*i.width).toInt().coerceIn(x0+1,i.width)
        val y0=((i.region.top+(i.region.bottom-i.region.top)*row/3)*i.height).toInt().coerceIn(0,i.height-1)
        val y1=((i.region.top+(i.region.bottom-i.region.top)*(row+1)/3)*i.height).toInt().coerceIn(y0+1,i.height)
        val occupied=existing.count { it.x>=x0 && it.x<x1 && it.y>=y0 && it.y<y1 }
        val limit=minOf(50-occupied,600-existing.size-found.size)
        if(limit<=0) continue
        val imageCell=gray.submat(y0,y1,x0,x1);val maskCell=mask.submat(y0,y1,x0,x1);val corners=MatOfPoint()
        try {
          Imgproc.goodFeaturesToTrack(imageCell,corners,limit,.004,5.0,maskCell)
          for(p in corners.toArray()) {
            val pixel=Point(p.x+x0,p.y+y0)
            if(pixel.x<8 || pixel.y<8 || pixel.x>=i.width-8 || pixel.y>=i.height-8) continue
            val ground=project(pixel,i) ?: continue
            found.add(pixel to ground);Imgproc.circle(mask,pixel,5,Scalar(0.0),-1)
          }
        } finally { corners.release();imageCell.release();maskCell.release() }
      }
      return found
    } finally { mask.release() }
  }
  private fun seed(gray: Mat,i: Input,reason: String): Map<String,Any?> {
    releaseTracking();chain.seed(i.time)
    val pairs=detectFresh(gray,i,emptyArray())
    points=pairs.map { it.first }.toTypedArray();reference=pairs.map { it.second }
    previous=gray;previousTime=i.time;referenceTime=i.time
    if(evidenceArmed.get()) evidenceReference=i
    return chain.report(false)+mapOf("status" to if(points.size>=12) "REFERENCE_READY" else "FLOOR_FEATURES_INSUFFICIENT",
      "tracks" to points.size,"referenceTimestampNs" to referenceTime,"seedReason" to reason)
  }
  private fun process(i: Input): Map<String,Any?> {
    val gray=Mat(i.height,i.width,CvType.CV_8UC1);gray.put(0,0,i.gray)
    val prev=previous
    if(prev==null || points.size<12 || i.time-previousTime !in 1..i.gapLimitNs || prev.cols()!=i.width || prev.rows()!=i.height)
      return seed(gray,i,when { prev==null->"NO_PREVIOUS_IMAGE";points.size<12->"TRACKS_DEPLETED";prev.cols()!=i.width || prev.rows()!=i.height->"IMAGE_SIZE_CHANGED";else->"FRAME_GAP" })
    val from=MatOfPoint2f(*points);val to=MatOfPoint2f();val back=MatOfPoint2f()
    val ok=MatOfByte();val err=MatOfFloat();val backOk=MatOfByte();val backErr=MatOfFloat()
    try {
      Video.calcOpticalFlowPyrLK(prev,gray,from,to,ok,err,Size(31.0,31.0),4,TermCriteria(TermCriteria.COUNT+TermCriteria.EPS,40,.01))
      Video.calcOpticalFlowPyrLK(gray,prev,to,back,backOk,backErr,Size(31.0,31.0),4)
      val next=to.toArray();val reverse=back.toArray();val accepted=ok.toArray();val reverseOk=backOk.toArray()
      val keep=points.indices.filter { accepted[it].toInt()==1 && reverseOk[it].toInt()==1 &&
        next[it].x>=8 && next[it].x<i.width-8 && next[it].y>=8 && next[it].y<i.height-8 &&
        hypot(reverse[it].x-points[it].x,reverse[it].y-points[it].y)<.6 }
      val pairGapMs=(i.time-previousTime)/1_000_000.0
      val oldReference=reference;points=keep.map { next[it] }.toTypedArray();reference=keep.map { oldReference[it] }
      val projected=points.indices.mapNotNull { n->project(points[n],i)?.let { Triple(n,reference[n],it) } }
      prev.release();previous=gray;previousTime=i.time
      val assessment=FloorFlowGeometry.assess(projected.map { it.second },projected.map { it.third });val estimate=assessment.estimate
      val linkFrom=referenceTime
      if(estimate==null) {
        if(!closed && evidenceArmed.compareAndSet(true,false)) runCatching { saveEvidence(i,projected,assessment) }
        return chain.report(false)+assessment.report()+mapOf("status" to "FLOOR_FLOW_REJECTED","tracks" to points.size,"referenceTimestampNs" to linkFrom)
      }
      check(chain.accept(linkFrom,i.time,estimate)) { "Invalid floor-flow reference link" }
      val inliers=projected.filter { FloorFlowGeometry.isInlier(it.second,it.third,estimate) }
      points=inliers.map { points[it.first] }.toTypedArray();reference=inliers.map { it.third };referenceTime=i.time
      if(evidenceArmed.get()) evidenceReference=i else evidenceReference=null
      var added=0
      if(points.size<480) {
        val fresh=detectFresh(gray,i,points);added=fresh.size
        points+=fresh.map { it.first };reference+=fresh.map { it.second }
        if(added>0) { replenishments++;featuresAdded+=added }
      }
      val origin=if(chain.continuous) mapOf("cameraDxMeters" to chain.dx,"cameraDzMeters" to chain.dz) else emptyMap()
      return chain.report(true)+assessment.report()+origin+mapOf("status" to if(chain.continuous) "FLOOR_FLOW_ESTIMATE" else "FLOOR_FLOW_SEGMENT_ESTIMATE","pairGapMs" to pairGapMs,"boundedGapRecovered" to (pairGapMs>400),
        "localDxMeters" to estimate.dx,"localDzMeters" to estimate.dz,"referenceTimestampNs" to linkFrom,
        "tracks" to points.size,"addedFeatures" to added,"featuresAddedTotal" to featuresAdded,"replenishments" to replenishments)
    } catch(error: Throwable) { gray.release();throw error }
    finally { from.release();to.release();back.release();ok.release();err.release();backOk.release();backErr.release() }
  }
  private fun saveEvidence(current: Input,pairs: List<Triple<Int,FloorFlowGeometry.Point,FloorFlowGeometry.Point>>,assessment: FloorFlowGeometry.Assessment) {
    val source=evidenceReference ?: return
    val folder=evidenceDirectory ?: return;folder.mkdirs()
    val id="floor-flow-"+UUID.randomUUID().toString()
    fun image(input: Input,name: String) {
      File(folder,name).outputStream().use { out->out.write("P5\n${input.width} ${input.height}\n255\n".toByteArray(Charsets.US_ASCII));out.write(input.gray) }
    }
    fun metadata(input: Input)=mapOf("imageTimestampNs" to input.time,"frameTimestampNs" to input.frameTime,
      "quaternion" to input.q.toList(),"dimensions" to listOf(input.width,input.height),
      "focalLength" to listOf(input.fx,input.fy),"principalPoint" to listOf(input.cx,input.cy),"heightMeters" to input.measuredHeight)
    image(source,"$id-reference.pgm");image(current,"$id-current.pgm")
    val report=mapOf("reference" to metadata(source),"current" to metadata(current),"region" to current.region.report(),
      "fit" to assessment.report(),"pairs" to pairs.map { listOf(it.second.x,it.second.z,it.third.x,it.third.z,points[it.first].x,points[it.first].y) },
      "referenceImage" to "$id-reference.pgm","currentImage" to "$id-current.pgm","localOnly" to true,"autonomousMotionAuthorized" to false)
    File(folder,"$id.json").writeText(JSONObject(report).toString())
    evidenceFile="floor-flow-evidence/$id.json"
  }
}
