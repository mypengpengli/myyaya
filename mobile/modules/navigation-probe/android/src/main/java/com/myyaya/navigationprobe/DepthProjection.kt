package com.myyaya.navigationprobe

/** Raw depth is camera-Z distance, in unrotated texture coordinates. */
internal object DepthProjection {
  fun points(sample: DepthSamples.Result, cameraToMap: RigidPose,
    fx: Float, fy: Float, cx: Float, cy: Float, textureWidth: Int, textureHeight: Int,
    visit: (FloatArray) -> Unit) {
    require(fx.isFinite() && fy.isFinite() && fx > 0 && fy > 0 && cx.isFinite() && cy.isFinite())
    require(textureWidth > 0 && textureHeight > 0 && sample.sourceWidth > 0 && sample.sourceHeight > 0)
    require(sample.width > 0 && sample.height > 0 && sample.step > 0 && sample.millimeters.size == sample.width*sample.height)
    val dx=sample.sourceWidth.toFloat()/textureWidth; val dy=sample.sourceHeight.toFloat()/textureHeight
    for (y in 0 until sample.height) for (x in 0 until sample.width) {
      val mm=sample.millimeters[y*sample.width+x]
      if (mm !in 200..4000) continue
      val d=mm/1000f
      val p=cameraToMap.point(floatArrayOf(d*(x*sample.step-cx*dx)/(fx*dx),d*(cy*dy-y*sample.step)/(fy*dy),-d))
      if (p.all { it.isFinite() && kotlin.math.abs(it)<=25f }) visit(p)
    }
  }
}
