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
  var enabledOverlay=true
  private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
  override fun onDraw(canvas: Canvas) {
    if (!enabledOverlay || SystemClock.elapsedRealtime()-updatedAt>1000) return
    for (p in dots) {
      if (p.u !in 0f..1f || p.v !in 0f..1f) continue
      paint.color=p.color;paint.style=if (p.filled) Paint.Style.STROKE else Paint.Style.FILL;paint.strokeWidth=2f
      canvas.drawCircle(p.u*width,p.v*height,if (p.filled) 4f else 3f,paint)
    }
    paint.style=Paint.Style.FILL;paint.color=0xbb000000.toInt()
    canvas.drawRect(0f,height-40f,width.toFloat(),height.toFloat(),paint)
    paint.color=Color.WHITE;paint.textSize=23f
    canvas.drawText("深度叠加：青平面 / 红高处 / 橙低处 · 空心为融合点",10f,height-12f,paint)
  }
}
