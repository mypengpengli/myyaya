package com.myyaya.navigationprobe

import kotlin.math.*

/** A user-confirmed flat taught corridor is the prior; raw depth checks new obstructions. */
internal object RoutePerception {
  fun evaluate(points: List<FloatArray>,plane: GroundPlane?,pose: RoutePose?,fresh: Boolean,width: Float,
    length: Float,height: Float,margin: Float,turning: Boolean=false): RouteClearance {
    if (!fresh || points.size<32 || plane==null || pose==null) return RouteClearance.DEPTH_UNKNOWN
    val dx=sin(pose.yaw);val dz=-cos(pose.yaw)
    val half=width/2+margin;val radius=hypot(width,length)/2+margin
    var hazards=0
    for (p in points) {
      val x=p[0]-pose.x;val z=p[2]-pose.z
      val along=x*dx+z*dz;val across=abs(x*dz-z*dx)
      val inSweep=(turning && hypot(x,z)<=radius+.12f) || (along in 0f..(.45f+length/2) && across<=half)
      if (!inSweep) continue
      val h=plane.distance(p)
      if (h< -.04f || h>.03f && h<height+.08f) hazards++
      if (hazards>=3) return RouteClearance.OBSTACLE
    }
    return RouteClearance.CLEAR
  }
}
