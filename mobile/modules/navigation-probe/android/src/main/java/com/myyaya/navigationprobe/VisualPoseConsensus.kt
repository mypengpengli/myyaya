package com.myyaya.navigationprobe

import kotlin.math.*

/** Compare map-to-session transforms, so camera movement does not look like disagreement. */
internal class VisualPoseConsensus {
  private var mapId=""
  private var previous: RigidPose?=null
  private var count=0
  private var lastNs=0L
  fun reset() {mapId="";previous=null;count=0;lastNs=0}
  fun offer(id: String,transform: RigidPose,ns: Long): Boolean {
    if(ns<=lastNs) return false
    val old=previous
    val agrees=id==mapId && old!=null && ns-lastNs<=2_500_000_000L &&
      distance(old,transform)<.08 && angle(old,transform)<Math.toRadians(6.0)
    count=if(agrees) count+1 else 1
    mapId=id;previous=transform;lastNs=ns
    return count>=3
  }
  companion object {
    fun acceptsPointCloud(frameNs: Long,cloudNs: Long)=frameNs>0 && cloudNs>0 &&
      frameNs-cloudNs in -100_000_000L..2_000_000_000L
    fun distance(a: RigidPose,b: RigidPose)=sqrt((0..2).sumOf {(a.t[it]-b.t[it]).toDouble().pow(2)})
    fun angle(a: RigidPose,b: RigidPose)=2*acos(abs((0..3).sumOf {(a.q[it]*b.q[it]).toDouble()}).coerceIn(0.0,1.0))
    /** OpenCV world-to-camera R,t to ARCore map-from-camera (+Y up, -Z forward). */
    fun fromPnP(r: DoubleArray,t: DoubleArray): RigidPose {
      require(r.size==9 && t.size==3)
      val m=DoubleArray(9) {i->r[(i%3)*3+i/3]*if(i%3==0) 1 else -1}
      val p=FloatArray(3) {i->-(0..2).sumOf {j->r[j*3+i]*t[j]}.toFloat()}
      val q=DoubleArray(4)
      val trace=m[0]+m[4]+m[8]
      if(trace>0) {
        val s=sqrt(trace+1)*2;q[3]=s/4;q[0]=(m[7]-m[5])/s;q[1]=(m[2]-m[6])/s;q[2]=(m[3]-m[1])/s
      } else {
        val i=(0..2).maxByOrNull {m[it*3+it]}!!;val j=(i+1)%3;val k=(i+2)%3
        val s=sqrt(1+m[i*3+i]-m[j*3+j]-m[k*3+k])*2
        q[i]=s/4;q[j]=(m[j*3+i]+m[i*3+j])/s;q[k]=(m[k*3+i]+m[i*3+k])/s;q[3]=(m[k*3+j]-m[j*3+k])/s
      }
      val norm=sqrt(q.sumOf {it*it});return RigidPose(p,FloatArray(4) {(q[it]/norm).toFloat()})
    }
  }
}
