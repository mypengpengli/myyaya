package com.myyaya.navigationprobe

import android.content.Context
import android.graphics.*
import android.os.SystemClock
import android.view.View

/** Normalized Android view coordinates supplied by ARCore, including display crop/rotation. */
internal class DepthOverlayView(context: Context): View(context) {
  data class Dot(val u: Float,val v: Float,val color: Int,val filled: Boolean)
  var dots: List<Dot> = emptyList()
  var updatedAt=0L
  var outlines: List<FloatArray> = emptyList()
  var outlinesUpdatedAt=0L
  var enabledOverlay=true
  var floorRegion: FloatArray?=null
  var floorRegionUpdatedAt=0L
  private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
  override fun onDraw(canvas: Canvas) {
    if (!enabledOverlay) return
    val now=SystemClock.elapsedRealtime()
    floorRegion?.takeIf { it.size==8 && it.all { coordinate->coordinate.isFinite() } && now-floorRegionUpdatedAt<=1000 }?.let { uv->
      val path=Path().apply { moveTo(uv[0]*width,uv[1]*height)
        for(i in 2 until 8 step 2) lineTo(uv[i]*width,uv[i+1]*height);close() }
      paint.color=Color.YELLOW;paint.style=Paint.Style.STROKE;paint.strokeWidth=4f;canvas.drawPath(path,paint)
    }
    if (now-outlinesUpdatedAt<=1000) for (uv in outlines) {
      if (uv.size<6) continue
      val path=Path().apply { moveTo(uv[0]*width,uv[1]*height)
        for (i in 2 until uv.size step 2) lineTo(uv[i]*width,uv[i+1]*height);close() }
      paint.color=Color.CYAN;paint.style=Paint.Style.STROKE;paint.strokeWidth=3f;canvas.drawPath(path,paint)
    }
    if (now-updatedAt<=1000) for (p in dots) {
      if (p.u !in 0f..1f || p.v !in 0f..1f) continue
      paint.color=p.color;paint.style=if (p.filled) Paint.Style.STROKE else Paint.Style.FILL;paint.strokeWidth=2f
      canvas.drawCircle(p.u*width,p.v*height,if (p.filled) 4f else 3f,paint)
    }
    paint.style=Paint.Style.FILL;paint.color=0xbb000000.toInt()
    canvas.drawRect(0f,height-40f,width.toFloat(),height.toFloat(),paint)
    paint.color=Color.WHITE;paint.textSize=23f
    canvas.drawText("黄框：地板取样假设 · 青线：水平面 · 红高处 / 橙低处",10f,height-12f,paint)
  }
}
