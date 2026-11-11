package com.myyaya.navigationprobe

import kotlin.math.hypot

/** A short supervised pulse also watches image-floor displacement; ARCore translation is not used. */
internal class VisualPulseGuard(private val start: Sample,private val boundMeters: Double) {
  data class Sample(val originNs: Long,val sampledNs: Long,val x: Double,val z: Double)
  init { require(boundMeters in .02.. .1 && start.x.isFinite() && start.z.isFinite() && start.originNs>0) }
  fun check(sample: Sample?,cameraNs: Long): String? {
    if(sample==null || !sample.x.isFinite() || !sample.z.isFinite() || sample.originNs!=start.originNs) return "VISUAL_MOTION_UNAVAILABLE"
    if(cameraNs-sample.sampledNs !in -100_000_000L..400_000_000L) return "VISUAL_MOTION_STALE"
    if(hypot(sample.x-start.x,sample.z-start.z)>=boundMeters-.005) return "VISUAL_STEP_DISTANCE_LIMIT"
    return null
  }
}
