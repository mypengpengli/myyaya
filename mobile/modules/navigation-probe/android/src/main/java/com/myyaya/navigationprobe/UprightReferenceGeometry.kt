package com.myyaya.navigationprobe

import kotlin.math.*

/** Known upright reference on a flat floor. Diagnostic candidates, never motor clearance. */
internal object UprightReferenceGeometry {
  data class Pixel(val x: Double,val y: Double)
  data class Camera(val fx: Double,val fy: Double,val cx: Double,val cy: Double,val q: FloatArray)
  data class Candidate(val height: Double,val range: Double,val width: Double,val widthError: Double,
    val horizontalResidual: Double,val independentWidthCheck: Boolean)
  private fun ray(p: Pixel,k: Camera): DoubleArray? {
    if(!listOf(p.x,p.y,k.fx,k.fy,k.cx,k.cy).all { it.isFinite() } || k.fx<=0 || k.fy<=0) return null
    if(k.q.size!=4 || !k.q.all { it.isFinite() }) return null
    val norm=sqrt(k.q.sumOf { it.toDouble()*it });if(norm !in .99..1.01) return null
    val rotation=RigidPose(FloatArray(3),FloatArray(4) { (k.q[it]/norm).toFloat() })
    return rotation.point(floatArrayOf(((p.x-k.cx)/k.fx).toFloat(),((k.cy-p.y)/k.fy).toFloat(),-1f)).map { it.toDouble() }.toDoubleArray()
  }
  fun estimate(k: Camera,top: Pixel,bottom: Pixel,left: Pixel,right: Pixel,knownHeight: Double,heldoutWidth: Double): Candidate? {
    if(!knownHeight.isFinite() || knownHeight !in .03.. .5 || !heldoutWidth.isFinite() || heldoutWidth !in .02.. .3) return null
    if(bottom.y-top.y<20 || right.x-left.x<10) return null
    val a=ray(top,k) ?: return null;val b=ray(bottom,k) ?: return null
    val l=ray(left,k) ?: return null;val r=ray(right,k) ?: return null
    val denominator=b[0]*b[0]+b[2]*b[2];if(denominator<.1) return null
    // Upright endpoints share horizontal coordinates, including when camera pitches.
    val ratio=(a[0]*b[0]+a[2]*b[2])/denominator
    val vertical=a[1]-ratio*b[1];if(ratio<=0 || vertical<.025) return null
    val ta=knownHeight/vertical;val tb=ratio*ta;val height=-tb*b[1]
    val range=hypot(tb*b[0],tb*b[2]);val residual=hypot(ta*a[0]-tb*b[0],ta*a[2]-tb*b[2])
    if(height !in .03.. .5 || range !in .15..2.0 || residual>.015) return null
    val norm=sqrt(k.q.sumOf { it.toDouble()*it })
    val rotation=RigidPose(FloatArray(3),FloatArray(4) { (k.q[it]/norm).toFloat() })
    val axis=rotation.point(floatArrayOf(1f,0f,0f));val length=hypot(axis[0].toDouble(),axis[2].toDouble())
    if(length<.5) return null
    val width=abs((r[0]-l[0])*axis[0]/length+(r[2]-l[2])*axis[2]/length)*(ta+tb)/2
    val error=width-heldoutWidth
    return Candidate(height,range,width,error,residual,abs(error)<=heldoutWidth*.2)
  }
}
