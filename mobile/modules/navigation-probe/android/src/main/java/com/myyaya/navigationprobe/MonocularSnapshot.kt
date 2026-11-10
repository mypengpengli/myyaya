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
  @Synchronized fun cancel() {
    val old=pending;pending=null;copying=false;lastId=null
    old?.promise?.reject("ERR_MONOCULAR_CLOSED","相机界面已暂停",null)
  }
  fun close() { closed=true;cancel();handler.removeCallbacksAndMessages(null);dialog?.dismiss();io.shutdown() }
}
