package com.myyaya.navigationprobe

import android.app.Activity
import android.app.AlertDialog
import android.graphics.*
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.widget.ImageView
import android.widget.LinearLayout
import com.google.ar.core.Frame
import com.google.ar.core.exceptions.NotYetAvailableException
import expo.modules.kotlin.Promise
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import org.json.JSONObject

/** One explicit camera sample, not a live feed or a motor/perception authority. */
internal class MonocularSnapshot(private val host: Activity,private val active: ()->Boolean) {
  private data class Request(val id: String,val promise: Promise)
  private val io=Executors.newSingleThreadExecutor()
  private val handler=Handler(Looper.getMainLooper())
  @Volatile private var pending: Request?=null
  @Volatile private var copying=false
  @Volatile private var lastId: String?=null
  @Volatile private var closed=false
  private var dialog: AlertDialog?=null
  private val cache=File(host.cacheDir,"monocular-benchmark")
  @Synchronized fun request(promise: Promise) {
    if(closed || !active()) { promise.reject("ERR_MONOCULAR_CAMERA","请先开始相机扫描",null);return }
    if(pending!=null) { promise.reject("ERR_MONOCULAR_BUSY","上一帧仍在取样",null);return }
    val request=Request(UUID.randomUUID().toString(),promise);pending=request;lastId=null
    handler.postDelayed({ synchronized(this) {
      if(pending===request) { pending=null;copying=false;request.promise.reject("ERR_MONOCULAR_TIMEOUT","相机取样超时",null) }
    } },5000)
  }
  /** GL thread. Close Image before JPEG conversion and neural inference. */
  fun offer(frame: Frame) {
    val request=synchronized(this) { val r=pending;if(r==null || copying || closed) return;copying=true;r }
    try {
      frame.acquireCameraImage().use { image ->
        require(image.format==ImageFormat.YUV_420_888 && image.planes.size==3)
        require(image.cropRect.left==0 && image.cropRect.top==0 && image.cropRect.width()==image.width && image.cropRect.height()==image.height)
        val lag=(frame.timestamp-image.timestamp)/1_000_000.0;require(kotlin.math.abs(lag)<=100)
        val planes=image.planes.map { plane ->
          val buffer=plane.buffer.duplicate();val bytes=ByteArray(buffer.remaining());buffer.get(bytes)
          Yuv420Pack.Plane(bytes,plane.rowStride,plane.pixelStride)
        }
        val width=image.width;val height=image.height;val k=frame.camera.imageIntrinsics
        val metadata=mapOf<String,Any>("requestId" to request.id,"frameTimestampNs" to frame.timestamp,
          "imageTimestampNs" to image.timestamp,"imageLagMs" to lag,"imageDimensions" to listOf(width,height),
          "imageFocalLength" to k.focalLength.toList(),"imagePrincipalPoint" to k.principalPoint.toList(),
          "cameraQuaternion" to frame.camera.pose.rotationQuaternion.toList(),"trackingState" to frame.camera.trackingState.name)
        io.execute {
          try {
            val nv21=Yuv420Pack.nv21(width,height,planes[0],planes[1],planes[2])
            val stream=ByteArrayOutputStream()
            check(YuvImage(nv21,ImageFormat.NV21,width,height,null).compressToJpeg(Rect(0,0,width,height),94,stream))
            val jpeg=stream.toByteArray();val bitmap=requireNotNull(BitmapFactory.decodeByteArray(jpeg,0,jpeg.size))
            val scaled=Bitmap.createScaledBitmap(bitmap,256,256,true)
            val pixels=IntArray(256*256);scaled.getPixels(pixels,0,256,0,0,256,256)
            val rgb=ByteArray(pixels.size*3)
            pixels.forEachIndexed { i,p -> rgb[i*3]=(p shr 16).toByte();rgb[i*3+1]=(p shr 8).toByte();rgb[i*3+2]=p.toByte() }
            scaled.recycle();bitmap.recycle()
            cache.mkdirs();File(cache,"live.jpg").writeBytes(jpeg);File(cache,"live.rgb").writeBytes(rgb)
            File(cache,"live.json").writeText(JSONObject(metadata).toString())
            host.runOnUiThread { synchronized(this) {
              if(pending!==request) return@synchronized
              pending=null;copying=false
              if(closed || !active()) request.promise.reject("ERR_MONOCULAR_CLOSED","相机界面已暂停",null)
              else { lastId=request.id;request.promise.resolve(metadata+mapOf("inputUri" to "file://${File(cache,"live.rgb").absolutePath}")) }
            } }
          } catch(e: Exception) { fail(request,e) }
        }
      }
    } catch(_: NotYetAvailableException) { synchronized(this) { if(pending===request) copying=false } }
      catch(e: Exception) { fail(request,e) }
  }
  private fun fail(request: Request,error: Exception) { host.runOnUiThread { synchronized(this) {
    if(pending===request) { pending=null;copying=false;request.promise.reject("ERR_MONOCULAR_CAPTURE",error.message,error) }
  } } }
  fun show(id: String,encoded: String,inferenceMs: Double) {
    check(!closed && active() && lastId==id) { "拍摄已被新取样或暂停替换" }
    require(encoded.length<=85_000 && inferenceMs.isFinite() && inferenceMs>=0)
    val bytes=Base64.decode(encoded,Base64.NO_WRAP);require(bytes.size==252*252)
    val original=requireNotNull(BitmapFactory.decodeFile(File(cache,"live.jpg").path))
    val colors=IntArray(bytes.size) { val v=bytes[it].toInt() and 255;Color.rgb(v,v,v) }
    val small=Bitmap.createBitmap(colors,252,252,Bitmap.Config.ARGB_8888)
    val depth=Bitmap.createScaledBitmap(small,original.width,original.height,true);small.recycle()
    val row=LinearLayout(host)
    for(bitmap in listOf(original,depth)) row.addView(ImageView(host).apply {
      setImageBitmap(bitmap);scaleType=ImageView.ScaleType.FIT_CENTER
    },LinearLayout.LayoutParams(0,(host.resources.displayMetrics.heightPixels*.5).toInt(),1f))
    dialog?.dismiss()
    dialog=AlertDialog.Builder(host).setTitle("单目视觉对照 · 本次拍摄")
      .setMessage("左：拍摄画面；右：本机计算的相对深度。亮处较近，暗处较远；不是米数。\n推理与传输约${inferenceMs.toInt()}毫秒，本页不驱动底座。")
      .setView(row).setPositiveButton("关闭对照",null).create()
    dialog?.show()
  }
  fun reference(id: String,height: Double,width: Double,promise: Promise) {
    try {
      check(!closed && active() && lastId==id) { "拍摄已被替换或暂停，请重新取样" }
      val metadata=JSONObject(File(cache,"live.json").readText())
      check(metadata.getString("requestId")==id && metadata.getString("trackingState")=="TRACKING") { "需要本次有效定位帧" }
      val jpeg=File(cache,"live.jpg").readBytes()
      io.execute {
        var bitmap: Bitmap?=null
        try {
          bitmap=requireNotNull(BitmapFactory.decodeByteArray(jpeg,0,jpeg.size))
          val detection=RedReferenceDetector.detect(bitmap)
          val sorted=detection.corners.sortedBy { it.y }
          fun center(points: List<UprightReferenceGeometry.Pixel>)=UprightReferenceGeometry.Pixel(points.map { it.x }.average(),points.map { it.y }.average())
          val top=center(sorted.take(2));val bottom=center(sorted.takeLast(2))
          val horizontal=detection.corners.sortedBy { it.x };val left=center(horizontal.take(2));val right=center(horizontal.takeLast(2))
          val focal=metadata.getJSONArray("imageFocalLength");val principal=metadata.getJSONArray("imagePrincipalPoint")
          val q=metadata.getJSONArray("cameraQuaternion")
          val camera=UprightReferenceGeometry.Camera(focal.getDouble(0),focal.getDouble(1),principal.getDouble(0),principal.getDouble(1),FloatArray(4) { q.getDouble(it).toFloat() })
          val candidate=requireNotNull(UprightReferenceGeometry.estimate(camera,top,bottom,left,right,height,width)) { "参照物几何条件不满足，未产生标定值" }
          val result=mapOf<String,Any>("requestId" to id,"candidateCameraHeightMeters" to candidate.height,
            "knownObjectHeightMeters" to height,"heldoutMeasuredWidthMeters" to width,"estimatedWidthMeters" to candidate.width,
            "widthErrorMeters" to candidate.widthError,"independentWidthCheckPassed" to candidate.independentWidthCheck,
            "objectRangeMeters" to candidate.range,"horizontalResidualMeters" to candidate.horizontalResidual,
            "foregroundPixels" to detection.area,"corners" to detection.corners.map { listOf(it.x,it.y) },
            "assumption" to "upright object on level floor; approximate planar silhouette; one red reference only",
            "settingsChanged" to false,"autonomousMotionAuthorized" to false)
          val overlay=bitmap.copy(Bitmap.Config.ARGB_8888,true)
          val canvas=Canvas(overlay);val paint=Paint().apply { color=Color.GREEN;strokeWidth=3f;style=Paint.Style.STROKE }
          val path=Path();detection.corners.forEachIndexed { i,p -> if(i==0) path.moveTo(p.x.toFloat(),p.y.toFloat()) else path.lineTo(p.x.toFloat(),p.y.toFloat()) };path.close();canvas.drawPath(path,paint)
          bitmap.recycle();bitmap=null
          host.runOnUiThread {
            if(closed || !active() || lastId!=id) { overlay.recycle();promise.reject("ERR_REFERENCE_STALE","标定期间相机已暂停或取样已更新",null);return@runOnUiThread }
            try {
              val destination=File(host.getExternalFilesDir("navigation-probe") ?: File(host.filesDir,"navigation-probe"),"upright-reference").apply { mkdirs() }
              File(destination,"latest.json").writeText(JSONObject(result).put("frame",metadata).toString())
              File(destination,"latest.jpg").writeBytes(jpeg)
              File(destination,"overlay.jpg").outputStream().use { overlay.compress(Bitmap.CompressFormat.JPEG,94,it) }
              dialog?.dismiss()
              val picture=ImageView(host).apply { setImageBitmap(overlay);adjustViewBounds=true;maxHeight=(host.resources.displayMetrics.heightPixels*.45).toInt() }
              val checked=if(candidate.independentWidthCheck) "直径核对在20%容差内" else "直径核对未通过，不采用此候选"
              dialog=AlertDialog.Builder(host).setTitle("已知物体标定 · 候选")
                .setMessage(String.format(java.util.Locale.ROOT,"镜头高度候选 %.1f 厘米\n直径估计 %.1f / 实测 %.1f 厘米\n%s\n未修改原标定；本项不驱动底座。",candidate.height*100,candidate.width*100,width*100,checked))
                .setView(picture).setPositiveButton("关闭对照",null).create();dialog?.show()
              promise.resolve(result+mapOf("exportDirectory" to destination.absolutePath))
            } catch(e: Exception) { promise.reject("ERR_REFERENCE_RESULT",e.message,e) }
          }
        } catch(e: Exception) { bitmap?.recycle();promise.reject("ERR_REFERENCE_GEOMETRY",e.message,e) }
      }
    } catch(e: Exception) { promise.reject("ERR_REFERENCE_CAPTURE",e.message,e) }
  }
  fun showFloor(id: String,encoded: String,summary: String) {
    check(!closed && active() && lastId==id) { "拍摄已暂停或被替换" }
    require(encoded.length<=85_000 && summary.length<=8000)
    val labels=Base64.decode(encoded,Base64.NO_WRAP);require(labels.size==252*252 && labels.all { it.toInt() in 0..3 })
    val report=JSONObject(summary)
    check(report.optBoolean("manualFloorAssumption") && !report.optBoolean("autonomousMotionAuthorized",true))
    val original=requireNotNull(BitmapFactory.decodeFile(File(cache,"live.jpg").path))
    val colors=IntArray(labels.size) { when(labels[it].toInt()) { 1->Color.argb(90,0,240,100);2->Color.argb(150,255,40,40);3->Color.argb(150,255,160,0);else->Color.TRANSPARENT } }
    val tiny=Bitmap.createBitmap(colors,252,252,Bitmap.Config.ARGB_8888)
    val colored=Bitmap.createScaledBitmap(tiny,original.width,original.height,false);tiny.recycle()
    val overlay=original.copy(Bitmap.Config.ARGB_8888,true);Canvas(overlay).drawBitmap(colored,0f,0f,null);colored.recycle()
    File(cache,"live.labels").writeBytes(labels);File(cache,"live.floor.json").writeText(summary)
    val row=LinearLayout(host)
    for(bitmap in listOf(original,overlay)) row.addView(ImageView(host).apply { setImageBitmap(bitmap);scaleType=ImageView.ScaleType.FIT_CENTER },
      LinearLayout.LayoutParams(0,(host.resources.displayMetrics.heightPixels*.5).toInt(),1f))
    dialog?.dismiss()
    dialog=AlertDialog.Builder(host).setTitle("地面与障碍观察 · 实验")
      .setMessage("左：本次原图；右：绿为地板假设、红为高出平面的物体、橙为疑似低处。\n${report.getString("reason")}\n比例来自实测镜头高度和人工地板区域；不是通行许可。")
      .setView(row).setPositiveButton("关闭对照",null).create();dialog?.show()
  }
  @Synchronized fun cancel() {
    val old=pending;pending=null;copying=false;lastId=null
    old?.promise?.reject("ERR_MONOCULAR_CLOSED","相机界面已暂停",null)
  }
  fun dismissComparison() { dialog?.dismiss();dialog=null }
  fun close() { closed=true;cancel();handler.removeCallbacksAndMessages(null);dialog?.dismiss();io.shutdown() }
}
