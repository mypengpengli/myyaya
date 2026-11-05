package com.myyaya.navigationprobe

import kotlin.math.*

/** Gravity-aligned alternatives when ARCore has not formed a textured Plane polygon. */
internal object SurfaceReference {
  data class Fit(val plane: GroundPlane?,val status: String,val samples: Int)
  fun measuredHeight(camera: RigidPose,heightMeters: Float): GroundPlane {
    require(heightMeters.isFinite() && heightMeters in .03f..2.5f)
    return GroundPlane(floatArrayOf(camera.t[0],camera.t[1]-heightMeters,camera.t[2]),floatArrayOf(0f,1f,0f))
  }
  fun fitPatch(sample: DepthSamples.Result,camera: RigidPose,u: Float,v: Float,
    fx: Float,fy: Float,cx: Float,cy: Float,tw: Int,th: Int,depthHit: FloatArray?=null): Fit {
    if (u !in 0f..1f || v !in 0f..1f) return Fit(null,"OUTSIDE_IMAGE",0)
    val points=ArrayList<FloatArray>()
    val px=u*sample.sourceWidth;val py=v*sample.sourceHeight
    DepthProjection.indexedPoints(sample,camera,fx,fy,cx,cy,tw,th) { i,p ->
      if (abs((i%sample.width)*sample.step-px)<=8*sample.step && abs((i/sample.width)*sample.step-py)<=8*sample.step) points.add(p)
    }
    if (points.size<16) return Fit(null,"INSUFFICIENT_RAW_NEIGHBORS",points.size)
    val ys=points.map { it[1] }.sorted()
    var lo=0;var bestLo=0;var bestHi=0
    for (hi in ys.indices) {
      while (ys[hi]-ys[lo]>.04f) lo++
      if (hi-lo>bestHi-bestLo) { bestLo=lo;bestHi=hi }
    }
    if (bestHi-bestLo+1<16 || (bestHi-bestLo+1)<points.size*.7f) return Fit(null,"NOT_HORIZONTAL",points.size)
    val height=ys[(bestLo+bestHi)/2]
    val inliers=points.filter { abs(it[1]-height)<=.025f }
    fun percentile(values: List<Float>,p: Float)=values.sorted()[((values.size-1)*p).toInt()]
    val mad=percentile(inliers.map { abs(it[1]-height) },.5f)
    val spanX=percentile(inliers.map { it[0] },.9f)-percentile(inliers.map { it[0] },.1f)
    val spanZ=percentile(inliers.map { it[2] },.9f)-percentile(inliers.map { it[2] },.1f)
    if (mad>.012f || spanX<.025f || spanZ<.025f) return Fit(null,"INSUFFICIENT_PLANAR_EXTENT",points.size)
    if (depthHit!=null && (depthHit.size!=3 || abs(depthHit[1]-height)>.04f)) return Fit(null,"DEPTH_HIT_DISAGREES",points.size)
    if (camera.t[1]-height !in .03f..2.5f) return Fit(null,"HEIGHT_INVALID",points.size)
    val origin=floatArrayOf(percentile(inliers.map { it[0] },.5f),height,percentile(inliers.map { it[2] },.5f))
    return Fit(GroundPlane(origin,floatArrayOf(0f,1f,0f)),"RAW_HORIZONTAL_PATCH",points.size)
  }
}
