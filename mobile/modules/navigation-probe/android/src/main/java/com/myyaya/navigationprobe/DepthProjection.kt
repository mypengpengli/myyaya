package com.myyaya.navigationprobe

/** Raw depth is camera-Z distance, in unrotated texture coordinates. */
internal object DepthProjection {
  /** Clip a camera-space polygon at the near plane, then project to GPU texture UV. */
  fun polygonUv(vertices: List<FloatArray>,fx: Float,fy: Float,cx: Float,cy: Float,tw: Int,th: Int): FloatArray {
    require(fx>0 && fy>0 && tw>0 && th>0)
    if (vertices.size<3 || vertices.any { it.size!=3 || it.any { v -> !v.isFinite() } }) return floatArrayOf()
    val clipped=ArrayList<FloatArray>();var previous=vertices.last()
    for (p in vertices) {
      val inside=p[2]<= -.05f;val before=previous[2]<= -.05f
      if (inside!=before) {
        val t=(-.05f-previous[2])/(p[2]-previous[2])
        clipped.add(FloatArray(3) { previous[it]+t*(p[it]-previous[it]) })
      }
      if (inside) clipped.add(p)
      previous=p
    }
    if (clipped.size<3) return floatArrayOf()
    return clipped.flatMap { p -> listOf((fx*p[0]/-p[2]+cx)/tw,(cy-fy*p[1]/-p[2])/th) }.toFloatArray()
  }
  fun points(sample: DepthSamples.Result, cameraToMap: RigidPose,
    fx: Float, fy: Float, cx: Float, cy: Float, textureWidth: Int, textureHeight: Int,
    visit: (FloatArray) -> Unit) {
    indexedPoints(sample,cameraToMap,fx,fy,cx,cy,textureWidth,textureHeight) { _,point -> visit(point) }
  }
  fun indexedPoints(sample: DepthSamples.Result, cameraToMap: RigidPose,
    fx: Float, fy: Float, cx: Float, cy: Float, textureWidth: Int, textureHeight: Int,
    visit: (Int,FloatArray) -> Unit) {
    require(fx.isFinite() && fy.isFinite() && fx > 0 && fy > 0 && cx.isFinite() && cy.isFinite())
    require(textureWidth > 0 && textureHeight > 0 && sample.sourceWidth > 0 && sample.sourceHeight > 0)
    require(sample.width > 0 && sample.height > 0 && sample.step > 0 && sample.millimeters.size == sample.width*sample.height)
    val dx=sample.sourceWidth.toFloat()/textureWidth; val dy=sample.sourceHeight.toFloat()/textureHeight
    for (y in 0 until sample.height) for (x in 0 until sample.width) {
      val mm=sample.millimeters[y*sample.width+x]
      if (mm !in 200..4000) continue
      val d=mm/1000f
      val p=cameraToMap.point(floatArrayOf(d*(x*sample.step-cx*dx)/(fx*dx),d*(cy*dy-y*sample.step)/(fy*dy),-d))
      if (p.all { it.isFinite() && kotlin.math.abs(it)<=25f }) visit(y*sample.width+x,p)
    }
  }
}
