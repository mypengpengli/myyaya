package com.myyaya.navigationprobe

import android.content.Context
import android.graphics.*
import android.view.View
import kotlin.math.*

/** Live camera-relative evidence only; a candidate cell is not a drivable route. */
internal class TerrainView(context: Context): View(context) {
  var snapshot=TerrainSnapshot(false,"SELECT_GROUND")
  private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
  override fun onDraw(canvas: Canvas) {
    canvas.drawColor(Color.rgb(16,24,34))
    val camera=snapshot.camera
    if (camera==null) {
      paint.color=Color.LTGRAY; paint.textSize=22f
      canvas.drawText("等待本次会话的地面与原始深度",12f,height/2f,paint)
      return
    }
    val ahead=camera.point(floatArrayOf(0f,0f,-1f))
    val dx=ahead[0]-camera.t[0]; val dz=ahead[2]-camera.t[2]; val norm=hypot(dx,dz)
    if (norm<.2f) return
    val fx=dx/norm; val fz=dz/norm
    val scale=min((width-30f)/3f,(height-35f)/2.8f)
    val centerX=width/2f; val centerY=height-25f-.3f*scale
    fun view(x: Float,z: Float): Pair<Float,Float> {
      val a=x-camera.t[0]; val b=z-camera.t[2]
      return (centerX+(-fz*a+fx*b)*scale) to (centerY-(fx*a+fz*b)*scale)
    }
    paint.color=Color.rgb(45,57,70); paint.strokeWidth=1f
    for (i in -3..3) canvas.drawLine(centerX+i*.5f*scale,12f,centerX+i*.5f*scale,height-25f,paint)
    for (i in 0..5) canvas.drawLine(5f,centerY-i*.5f*scale,width-5f,centerY-i*.5f*scale,paint)
    canvas.save(); canvas.clipRect(0f,0f,width.toFloat(),height-25f)
    for (cell in snapshot.cells) {
      val x=cell.x*TerrainAnalysis.CELL; val z=cell.z*TerrainAnalysis.CELL
      val corners=listOf(view(x,z),view(x+TerrainAnalysis.CELL,z),view(x+TerrainAnalysis.CELL,z+TerrainAnalysis.CELL),view(x,z+TerrainAnalysis.CELL))
      val path=Path().apply { moveTo(corners[0].first,corners[0].second); for (p in corners.drop(1)) lineTo(p.first,p.second); close() }
      paint.color=when {
        cell.candidate -> Color.rgb(57,203,103)
        cell.kind==TerrainKind.GROUND -> Color.rgb(30,125,139)
        cell.kind==TerrainKind.OBSTACLE -> Color.rgb(243,81,81)
        cell.kind==TerrainKind.DROP -> Color.rgb(236,147,49)
        else -> Color.rgb(66,75,87)
      }
      paint.style=Paint.Style.FILL; canvas.drawPath(path,paint)
    }
    snapshot.envelope?.let {
      paint.color=Color.WHITE; paint.style=Paint.Style.STROKE; paint.strokeWidth=2f
      canvas.drawCircle(centerX,centerY,it.radius*scale,paint); paint.style=Paint.Style.FILL
    }
    paint.color=Color.WHITE; paint.strokeWidth=4f
    canvas.drawCircle(centerX,centerY,5f,paint)
    canvas.drawLine(centerX,centerY,centerX,centerY-.2f*scale,paint)
    canvas.restore()
    paint.color=Color.LTGRAY; paint.textSize=17f
    canvas.drawText("网格0.5m · 上方为后摄方向 · 白圈为占地+余量",8f,height-5f,paint)
  }
}
