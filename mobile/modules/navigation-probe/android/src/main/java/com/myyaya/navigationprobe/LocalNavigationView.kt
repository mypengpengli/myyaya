package com.myyaya.navigationprobe

import android.content.Context
import android.graphics.*
import android.view.MotionEvent
import android.view.View
import kotlin.math.*

/** Taps select diagnostic map goals; this view has no motor gateway. */
internal class LocalNavigationView(context: Context,val goalSelected: (LocalGoal)->Unit): View(context) {
  var snapshot=LocalMapSnapshot()
  var pose: RoutePose?=null
  var goal: LocalGoal?=null
  var plan=LocalPlan("WAITING")
  var robot: RobotEnvelope?=null
  private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
  private fun scale()=min((width-20f)/1.4f,(height-30f)/1.3f).coerceAtLeast(1f)
  private fun view(x: Float,z: Float): Pair<Float,Float> {
    val p=pose ?: return 0f to 0f;val dx=x-p.x;val dz=z-p.z
    return width/2f+(dx*cos(p.yaw)+dz*sin(p.yaw))*scale() to
      height*.78f-(dx*sin(p.yaw)-dz*cos(p.yaw))*scale()
  }
  override fun onTouchEvent(event: MotionEvent): Boolean {
    if(event.action==MotionEvent.ACTION_UP) {
      val p=pose ?: return true
      val right=(event.x-width/2f)/scale();val ahead=(height*.78f-event.y)/scale()
      goalSelected(LocalGoal(p.x+cos(p.yaw)*right+sin(p.yaw)*ahead,
        p.z+sin(p.yaw)*right-cos(p.yaw)*ahead));performClick()
    }
    return true
  }
  override fun performClick(): Boolean { super.performClick();return true }
  override fun onDraw(canvas: Canvas) {
    canvas.drawColor(Color.rgb(12,20,29))
    val p=pose ?: return
    for((t,s) in snapshot.tiles) {
      val x=t.x*LocalNavigationMap.TILE;val z=t.z*LocalNavigationMap.TILE
      val corners=listOf(view(x,z),view(x+.025f,z),view(x+.025f,z+.025f),view(x,z+.025f))
      val path=Path().apply { moveTo(corners[0].first,corners[0].second)
        corners.drop(1).forEach { lineTo(it.first,it.second) };close() }
      paint.style=Paint.Style.FILL
      paint.color=when(s.space) {
        LocalSpace.FREE->Color.rgb(27,157,150);LocalSpace.SUPPORT_ONLY->Color.rgb(50,70,100)
        LocalSpace.OBSTACLE->Color.rgb(240,68,68);LocalSpace.WEAK_OBSTACLE->Color.rgb(223,122,123)
        LocalSpace.DROP->Color.rgb(244,155,35);LocalSpace.UNKNOWN->Color.rgb(50,52,57)
      }
      canvas.drawPath(path,paint)
    }
    robot?.let { r->
      val tiles=LocalTrajectory.footprint(p.x,p.z,p.yaw,r.width/2+r.margin+.01f,r.length/2+r.margin+.01f)
      paint.color=Color.argb(65,255,255,255)
      for(t in tiles) { val v=view((t.x+.5f)*.025f,(t.z+.5f)*.025f);canvas.drawCircle(v.first,v.second,.0125f*scale(),paint) }
    }
    paint.color=Color.YELLOW;paint.strokeWidth=3f
    plan.path.zipWithNext().forEach { (a,b)->val v=view(a.x,a.z);val w=view(b.x,b.z)
      canvas.drawLine(v.first,v.second,w.first,w.second,paint) }
    goal?.let { g->val v=view(g.x,g.z);paint.color=Color.MAGENTA;paint.style=Paint.Style.STROKE
      canvas.drawCircle(v.first,v.second,7f,paint);paint.style=Paint.Style.FILL }
    val v=view(p.x,p.z);paint.color=Color.WHITE;canvas.drawCircle(v.first,v.second,4f,paint)
    canvas.drawLine(v.first,v.second,v.first,v.second-.08f*scale(),paint)
    paint.color=Color.LTGRAY;paint.textSize=17f
    canvas.drawText("点图选目标，仅预览 · 青近期空地 / 蓝旧地面 / 红障碍",8f,height-5f,paint)
  }
}
