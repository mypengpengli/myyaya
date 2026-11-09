package com.myyaya.navigationprobe

import com.google.ar.core.Frame
import org.opencv.android.OpenCVLoader
import org.opencv.core.*
import org.opencv.imgproc.Imgproc
import org.opencv.video.Video
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.*

/** Read-only sparse flow worker. Manual lower-image floor ROI is an assumption, not segmentation/free space. */
internal class FloorFlowDiagnostic {
  private data class Input(val gray: ByteArray,val width: Int,val height: Int,val time: Long,val q: FloatArray,
    val fx: Float,val fy: Float,val cx: Float,val cy: Float,val measuredHeight: Float,val region: FloorFlowRegion)
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
  private var initialized=false
  @Volatile private var latestFrameNs=0L
  @Volatile var region=FloorFlowRegion();private set
  @Synchronized fun selectRegion(value: FloorFlowRegion) { region=value;reset() }
  fun reset() { epoch.incrementAndGet();sampleAt=0;state=mapOf("status" to "RESET","region" to region.report(),"autonomousMotionAuthorized" to false) }
  fun close() { if(closed) return;closed=true;reset();worker.execute { clear() };worker.shutdown() }
  fun report(): Map<String,Any?> {
    val snapshot=state;val sampled=(snapshot["sampleTimestampNs"] as? Number)?.toLong()
    return if(sampled!=null && latestFrameNs-sampled>500_000_000L) snapshot+mapOf("status" to "FLOW_STALE") else snapshot
  }
  fun offer(frame: Frame,height: Float?) {
    latestFrameNs=frame.timestamp
    if(closed || height==null || frame.timestamp-sampleAt<100_000_000L || !busy.compareAndSet(false,true)) return
    sampleAt=frame.timestamp;val (generation,selectedRegion)=synchronized(this) { epoch.get() to region }
    val input=try {
      frame.acquireCameraImage().use { image ->
        require(abs(frame.timestamp-image.timestamp)<=100_000_000L)
        require(image.width*image.height<=1280*960)
        val plane=image.planes[0];val buffer=plane.buffer;val bytes=ByteArray(image.width*image.height)
        val base=buffer.position()
        for(y in 0 until image.height) for(x in 0 until image.width) bytes[y*image.width+x]=buffer.get(base+y*plane.rowStride+x*plane.pixelStride)
        val k=frame.camera.imageIntrinsics;val f=k.focalLength;val c=k.principalPoint
        check(k.imageDimensions.contentEquals(intArrayOf(image.width,image.height)))
        Input(bytes,image.width,image.height,image.timestamp,frame.camera.pose.rotationQuaternion,f[0],f[1],c[0],c[1],height,selectedRegion)
      }
    } catch(_: Exception) { busy.set(false);return }
    runCatching { worker.execute {
      try {
        if(workerEpoch!=generation) { clear();workerEpoch=generation }
        if(!initialized) { check(OpenCVLoader.initLocal()) { "OpenCV load failed" };initialized=true }
        val result=process(input)
        if(!closed && epoch.get()==generation) state=result+mapOf("sampleTimestampNs" to input.time,"referenceTimestampNs" to referenceTime,
          "measuredHeightMeters" to height,"region" to input.region.report(),"source" to "manual-floor-roi-fixed-height","autonomousMotionAuthorized" to false)
      } catch(error: Throwable) {
        clear()
        if(!closed && epoch.get()==generation) state=mapOf("status" to "FLOW_UNAVAILABLE","error" to error.javaClass.simpleName,"autonomousMotionAuthorized" to false)
      } finally { busy.set(false) }
    } }.onFailure { busy.set(false) }
  }
  private fun clear() { previous?.release();previous=null;points=emptyArray();reference=emptyList();previousTime=0;referenceTime=0 }
  private fun project(p: Point,i: Input)=FloorFlowGeometry.project(p.x,p.y,i.fx.toDouble(),i.fy.toDouble(),i.cx.toDouble(),i.cy.toDouble(),i.q,i.measuredHeight)
  private fun seed(gray: Mat,i: Input): Map<String,Any?> {
    clear()
    val mask=Mat.zeros(i.height,i.width,CvType.CV_8UC1);val corners=MatOfPoint()
    try {
      Imgproc.rectangle(mask,Point(i.region.left*i.width.toDouble(),i.region.top*i.height.toDouble()),
        Point(i.region.right*i.width.toDouble(),i.region.bottom*i.height.toDouble()),Scalar(255.0),-1)
      Imgproc.goodFeaturesToTrack(gray,corners,600,.004,5.0,mask)
      val pairs=corners.toArray().mapNotNull { p->project(p,i)?.let { p to it } }
      points=pairs.map { it.first }.toTypedArray();reference=pairs.map { it.second }
      previous=gray;previousTime=i.time;referenceTime=i.time
      return mapOf("status" to if(points.size>=12) "REFERENCE_READY" else "FLOOR_FEATURES_INSUFFICIENT","tracks" to points.size)
    } finally { corners.release();mask.release() }
  }
  private fun process(i: Input): Map<String,Any?> {
    val gray=Mat(i.height,i.width,CvType.CV_8UC1);gray.put(0,0,i.gray)
    val prev=previous
    if(prev==null || points.size<12 || i.time-previousTime !in 1..400_000_000L || prev.cols()!=i.width || prev.rows()!=i.height) return seed(gray,i)
    val from=MatOfPoint2f(*points);val to=MatOfPoint2f();val back=MatOfPoint2f()
    val ok=MatOfByte();val err=MatOfFloat();val backOk=MatOfByte();val backErr=MatOfFloat()
    try {
      Video.calcOpticalFlowPyrLK(prev,gray,from,to,ok,err,Size(21.0,21.0),3,TermCriteria(TermCriteria.COUNT+TermCriteria.EPS,40,.01))
      Video.calcOpticalFlowPyrLK(gray,prev,to,back,backOk,backErr,Size(21.0,21.0),3)
      val next=to.toArray();val reverse=back.toArray();val accepted=ok.toArray();val reverseOk=backOk.toArray()
      val keep=points.indices.filter { accepted[it].toInt()==1 && reverseOk[it].toInt()==1 && hypot(reverse[it].x-points[it].x,reverse[it].y-points[it].y)<.6 }
      val oldReference=reference;points=keep.map { next[it] }.toTypedArray();reference=keep.map { oldReference[it] }
      val projected=points.indices.mapNotNull { n->project(points[n],i)?.let { reference[n] to it } }
      prev.release();previous=gray;previousTime=i.time
      val assessment=FloorFlowGeometry.assess(projected.map { it.first },projected.map { it.second });val estimate=assessment.estimate
      return if(estimate==null) assessment.report()+mapOf("status" to "FLOOR_FLOW_REJECTED","tracks" to points.size)
      else mapOf("status" to "FLOOR_FLOW_ESTIMATE","cameraDxMeters" to estimate.dx,"cameraDzMeters" to estimate.dz,
        "fitReason" to "ACCEPTED","correspondences" to projected.size,"scale" to estimate.scale,"orientationCorrectionRadians" to estimate.angle,"inliers" to estimate.inliers,
        "inlierRatio" to estimate.ratio,"medianResidualMeters" to estimate.residual,"tracks" to points.size)
    } catch(error: Throwable) { gray.release();throw error }
    finally { from.release();to.release();back.release();ok.release();err.release();backOk.release();backErr.release() }
  }
}
