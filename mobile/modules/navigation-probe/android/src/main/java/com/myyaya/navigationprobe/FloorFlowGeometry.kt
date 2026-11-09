package com.myyaya.navigationprobe

import kotlin.math.*
import kotlin.random.Random

/** Metric floor-feature check using an operator-measured fixed height. Does not authorize movement. */
internal object FloorFlowGeometry {
  data class Point(val x: Double,val z: Double)
  data class Estimate(val dx: Double,val dz: Double,val scale: Double,val angle: Double,val inliers: Int,val ratio: Double,val residual: Double)
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
  fun estimate(a: List<Point>,b: List<Point>): Estimate? {
    if(a.size!=b.size || a.size<12 || (a+b).any { !it.x.isFinite() || !it.z.isFinite() }) return null
    val random=Random(71);var best: List<Int> = emptyList()
    repeat(240) {
      val i=random.nextInt(a.size);val j=random.nextInt(a.size)
      val ax=a[j].x-a[i].x;val az=a[j].z-a[i].z;val bx=b[j].x-b[i].x;val bz=b[j].z-b[i].z
      val d=ax*ax+az*az
      if(d<.0004) return@repeat
      val ca=(ax*bx+az*bz)/d;val cb=(ax*bz-az*bx)/d
      val fit=Fit(ca,cb,b[i].x-ca*a[i].x+cb*a[i].z,b[i].z-cb*a[i].x-ca*a[i].z)
      if(!fit.admissible()) return@repeat
      val inliers=a.indices.filter { fit.error(a[it],b[it])<=.004 }
      if(inliers.size>best.size) best=inliers
    }
    if(best.size<12 || best.size.toDouble()/a.size<.65) return null
    val mx=best.map { a[it].x }.average();val mz=best.map { a[it].z }.average()
    val nx=best.map { b[it].x }.average();val nz=best.map { b[it].z }.average()
    val den=best.sumOf { (a[it].x-mx).pow(2)+(a[it].z-mz).pow(2) };if(den<.0001) return null
    val ca=best.sumOf { (a[it].x-mx)*(b[it].x-nx)+(a[it].z-mz)*(b[it].z-nz) }/den
    val cb=best.sumOf { (a[it].x-mx)*(b[it].z-nz)-(a[it].z-mz)*(b[it].x-nx) }/den
    val fit=Fit(ca,cb,nx-ca*mx+cb*mz,nz-cb*mx-ca*mz)
    if(!fit.admissible()) return null
    val scale=hypot(ca,cb);val d=ca*ca+cb*cb
    val errors=best.map { fit.error(a[it],b[it]) }.sorted()
    return Estimate(-(ca*fit.tx+cb*fit.tz)/d,-(-cb*fit.tx+ca*fit.tz)/d,scale,atan2(cb,ca),best.size,best.size.toDouble()/a.size,errors[errors.size/2])
  }
}
