package com.myyaya.navigationprobe

import kotlin.math.*
import kotlin.random.Random

/** Metric floor-feature check using an operator-measured fixed height. Does not authorize movement. */
internal object FloorFlowGeometry {
  data class Point(val x: Double,val z: Double)
  data class Estimate(val dx: Double,val dz: Double,val scale: Double,val angle: Double,val inliers: Int,val ratio: Double,val residual: Double)
  fun isInlier(a: Point,b: Point,e: Estimate): Boolean {
    val x=a.x-e.dx;val z=a.z-e.dz;val c=cos(e.angle)*e.scale;val s=sin(e.angle)*e.scale
    return hypot(c*x-s*z-b.x,s*x+c*z-b.z)<=.004
  }
  data class Assessment(val reason: String,val estimate: Estimate?=null,val inliers: Int=0,val correspondences: Int=0,
    val scale: Double?=null,val angle: Double?=null,val residual: Double?=null) {
    fun report(): Map<String,Any?> = mapOf("fitReason" to reason,"inliers" to inliers,"correspondences" to correspondences,
      "inlierRatio" to if(correspondences>0) inliers.toDouble()/correspondences else 0.0,"scale" to scale,
      "orientationCorrectionRadians" to angle,"medianResidualMeters" to residual)
  }
  fun project(u: Double,v: Double,fx: Double,fy: Double,cx: Double,cy: Double,q: FloatArray,height: Float): Point? {
    if(q.size!=4 || !q.all { it.isFinite() } || !height.isFinite() || height !in .03f.. .5f || fx<=0 || fy<=0) return null
    val n=sqrt(q.sumOf { it.toDouble()*it });if(n<.9 || n>1.1) return null
    val x=q[0]/n;val y=q[1]/n;val z=q[2]/n;val w=q[3]/n
    val a=(u-cx)/fx;val b=-(v-cy)/fy;val c=-1.0
    val rx=(1-2*(y*y+z*z))*a+2*(x*y-z*w)*b+2*(x*z+y*w)*c
    val ry=2*(x*y+z*w)*a+(1-2*(x*x+z*z))*b+2*(y*z-x*w)*c
    val rz=2*(x*z-y*w)*a+2*(y*z+x*w)*b+(1-2*(x*x+y*y))*c
    if(ry>=-.08) return null
    val t=-height/ry;val p=Point(rx*t,rz*t)
    return p.takeIf { it.x.isFinite() && it.z.isFinite() && hypot(it.x,it.z) in .10.. .85 }
  }
  private data class Fit(val a: Double,val b: Double,val tx: Double,val tz: Double) {
    fun error(p: Point,q: Point)=hypot(a*p.x-b*p.z+tx-q.x,b*p.x+a*p.z+tz-q.z)
    fun admissible()=hypot(a,b) in .94..1.06 && abs(atan2(b,a))<=Math.toRadians(3.0)
  }
  fun estimate(a: List<Point>,b: List<Point>): Estimate? = assess(a,b).estimate
  fun assess(a: List<Point>,b: List<Point>): Assessment {
    if(a.size!=b.size || (a+b).any { !it.x.isFinite() || !it.z.isFinite() }) return Assessment("INVALID_CORRESPONDENCES")
    if(a.size<12) return Assessment("INSUFFICIENT_CORRESPONDENCES",correspondences=a.size)
    val random=Random(71);var best: List<Int> = emptyList();var unconstrained: List<Int> = emptyList();var diagnosticFit: Fit?=null
    repeat(240) {
      val i=random.nextInt(a.size);val j=random.nextInt(a.size)
      val ax=a[j].x-a[i].x;val az=a[j].z-a[i].z;val bx=b[j].x-b[i].x;val bz=b[j].z-b[i].z
      val d=ax*ax+az*az
      if(d<.0004) return@repeat
      val ca=(ax*bx+az*bz)/d;val cb=(ax*bz-az*bx)/d
      val fit=Fit(ca,cb,b[i].x-ca*a[i].x+cb*a[i].z,b[i].z-cb*a[i].x-ca*a[i].z)
      val inliers=a.indices.filter { fit.error(a[it],b[it])<=.004 }
      if(inliers.size>unconstrained.size) { unconstrained=inliers;diagnosticFit=fit }
      if(fit.admissible() && inliers.size>best.size) best=inliers
    }
    if(best.size<12 || best.size.toDouble()/a.size<.65) {
      val fit=diagnosticFit
      val reason=when {
        unconstrained.size<12->"NO_CONSENSUS"
        unconstrained.size.toDouble()/a.size<.65->"LOW_INLIER_RATIO"
        fit!=null && hypot(fit.a,fit.b) !in .94..1.06->"SCALE_OUT_OF_RANGE"
        fit!=null && abs(atan2(fit.b,fit.a))>Math.toRadians(3.0)->"ROTATION_OUT_OF_RANGE"
        else->"LOW_INLIER_RATIO"
      }
      return Assessment(reason,inliers=unconstrained.size,correspondences=a.size,
        scale=fit?.let { hypot(it.a,it.b) },angle=fit?.let { atan2(it.b,it.a) })
    }
    val mx=best.map { a[it].x }.average();val mz=best.map { a[it].z }.average()
    val nx=best.map { b[it].x }.average();val nz=best.map { b[it].z }.average()
    val den=best.sumOf { (a[it].x-mx).pow(2)+(a[it].z-mz).pow(2) };if(den<.0001) return Assessment("DEGENERATE_GEOMETRY",correspondences=a.size)
    val ca=best.sumOf { (a[it].x-mx)*(b[it].x-nx)+(a[it].z-mz)*(b[it].z-nz) }/den
    val cb=best.sumOf { (a[it].x-mx)*(b[it].z-nz)-(a[it].z-mz)*(b[it].x-nx) }/den
    val fit=Fit(ca,cb,nx-ca*mx+cb*mz,nz-cb*mx-ca*mz)
    val scale=hypot(ca,cb);val d=ca*ca+cb*cb
    val refined=a.indices.filter { fit.error(a[it],b[it])<=.004 }
    val errors=refined.map { fit.error(a[it],b[it]) }.sorted()
    val reason=when {
      scale !in .94..1.06->"SCALE_OUT_OF_RANGE"
      abs(atan2(cb,ca))>Math.toRadians(3.0)->"ROTATION_OUT_OF_RANGE"
      refined.size<12->"NO_CONSENSUS"
      refined.size.toDouble()/a.size<.65->"LOW_INLIER_RATIO"
      else->"ACCEPTED"
    }
    val residual=errors.takeIf { it.isNotEmpty() }?.let { it[it.size/2] }
    val estimate=if(reason=="ACCEPTED") Estimate(-(ca*fit.tx+cb*fit.tz)/d,-(-cb*fit.tx+ca*fit.tz)/d,
      scale,atan2(cb,ca),refined.size,refined.size.toDouble()/a.size,residual!!) else null
    return Assessment(reason,estimate,refined.size,a.size,scale,atan2(cb,ca),residual)
  }
}
