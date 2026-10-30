package com.myyaya.navigationprobe

import kotlin.math.*

/** Normalized clockwise TL/TR/BR/BL corners, with explicit physical dimensions. */
internal object ReferenceGeometry {
  fun validate(corners: FloatArray, widthMeters: Float, heightMeters: Float): Pair<Int,Int> {
    require(corners.size == 8 && corners.all { it.isFinite() && it in 0f..1f }) { "四角必须位于照片内" }
    require(widthMeters.isFinite() && heightMeters.isFinite() && widthMeters in .05f..3f && heightMeters in .05f..3f) { "宽高需为 5～300 厘米" }
    val ratio=widthMeters/heightMeters
    require(ratio in .2f..5f) { "图像宽高比需在 1:5～5:1 之间" }
    var area=0f
    for (i in 0..3) {
      val a=i*2; val b=((i+1)%4)*2; val c=((i+2)%4)*2
      val dx=corners[b]-corners[a]; val dy=corners[b+1]-corners[a+1]
      val ex=corners[c]-corners[b]; val ey=corners[c+1]-corners[b+1]
      require(dx*ey-dy*ex > .001f) { "四角不能交叉或重叠，请按左上、右上、右下、左下排列" }
      require(hypot(dx,dy) >= .05f) { "选区过窄，请重新拍摄更清晰的照片" }
      area += corners[a]*corners[b+1]-corners[b]*corners[a+1]
    }
    require(area/2 >= .04f) { "选区过小，请靠近实物重新拍照" }
    return if (ratio>=1) 1600 to (1600/ratio).roundToInt() else (1600*ratio).roundToInt() to 1600
  }
}
