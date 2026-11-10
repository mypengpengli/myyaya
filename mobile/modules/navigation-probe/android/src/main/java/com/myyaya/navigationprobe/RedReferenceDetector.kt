package com.myyaya.navigationprobe

import android.graphics.Bitmap
import org.opencv.android.OpenCVLoader
import org.opencv.android.Utils
import org.opencv.core.*
import org.opencv.imgproc.Imgproc

/** Explicit red-can experiment. Color segmentation is not a general obstacle detector. */
internal object RedReferenceDetector {
  data class Detection(val corners: List<UprightReferenceGeometry.Pixel>,val area: Int)
  fun detect(bitmap: Bitmap): Detection {
    check(OpenCVLoader.initLocal()) { "OpenCV unavailable" }
    val owned=ArrayList<Mat>()
    fun mat()=Mat().also { owned.add(it) }
    try {
      val rgba=mat();Utils.bitmapToMat(bitmap,rgba)
      val bgr=mat();Imgproc.cvtColor(rgba,bgr,Imgproc.COLOR_RGBA2BGR)
      val hsv=mat();Imgproc.cvtColor(bgr,hsv,Imgproc.COLOR_BGR2HSV)
      val low=mat();val high=mat();val red=mat()
      Core.inRange(hsv,Scalar(0.0,110.0,80.0),Scalar(12.0,255.0,255.0),low)
      Core.inRange(hsv,Scalar(170.0,110.0,80.0),Scalar(180.0,255.0,255.0),high);Core.bitwise_or(low,high,red)
      // A white logo splits red into islands; group nearby islands before selecting.
      val kernel=Imgproc.getStructuringElement(Imgproc.MORPH_RECT,Size(7.0,21.0)).also { owned.add(it) }
      val grouped=mat();Imgproc.morphologyEx(red,grouped,Imgproc.MORPH_CLOSE,kernel)
      val labels=mat();val stats=mat();val centers=mat()
      val count=Imgproc.connectedComponentsWithStats(grouped,labels,stats,centers)
      val candidates=(1 until count).filter { i ->
        val x=stats.get(i,Imgproc.CC_STAT_LEFT)[0];val y=stats.get(i,Imgproc.CC_STAT_TOP)[0]
        val w=stats.get(i,Imgproc.CC_STAT_WIDTH)[0];val h=stats.get(i,Imgproc.CC_STAT_HEIGHT)[0]
        val area=stats.get(i,Imgproc.CC_STAT_AREA)[0]
        x>12 && x+w<bitmap.width-12 && y>12 && y+h<bitmap.height-12 && h>30 && w>15 && h/w in 1.1..3.0 && area>250
      }.sortedByDescending { stats.get(it,Imgproc.CC_STAT_AREA)[0] }
      check(candidates.isNotEmpty()) { "未找到完整红色竖直罐子" }
      val best=candidates.first();val bestArea=stats.get(best,Imgproc.CC_STAT_AREA)[0]
      check(candidates.drop(1).none { stats.get(it,Imgproc.CC_STAT_AREA)[0]>bestArea*.5 }) { "存在多个红色候选，请只保留一个参照物" }
      val component=mat();Core.compare(labels,Scalar(best.toDouble()),component,Core.CMP_EQ)
      val seed=mat();Core.bitwise_and(component,red,seed)
      val points=mat();Core.findNonZero(seed,points)
      val raw=MatOfPoint(points).also { owned.add(it) };val hullIndices=MatOfInt().also { owned.add(it) }
      Imgproc.convexHull(raw,hullIndices)
      val all=raw.toArray();val hull=MatOfPoint(*hullIndices.toArray().map { all[it] }.toTypedArray()).also { owned.add(it) }
      val x=stats.get(best,Imgproc.CC_STAT_LEFT)[0].toInt();val y=stats.get(best,Imgproc.CC_STAT_TOP)[0].toInt()
      val w=stats.get(best,Imgproc.CC_STAT_WIDTH)[0].toInt();val h=stats.get(best,Imgproc.CC_STAT_HEIGHT)[0].toInt()
      val mask=Mat.zeros(bitmap.height,bitmap.width,CvType.CV_8UC1).also { owned.add(it) }
      Imgproc.rectangle(mask,Point((x-10).toDouble(),(y-9).toDouble()),Point((x+w+9).toDouble(),(y+h+6).toDouble()),Scalar(Imgproc.GC_PR_BGD.toDouble()),-1)
      Imgproc.fillConvexPoly(mask,hull,Scalar(Imgproc.GC_PR_FGD.toDouble()));mask.setTo(Scalar(Imgproc.GC_FGD.toDouble()),seed)
      val bg=mat();val fg=mat();Imgproc.grabCut(bgr,mask,Rect(),bg,fg,5,Imgproc.GC_INIT_WITH_MASK)
      val definite=mat();val probable=mat();val foreground=mat()
      Core.compare(mask,Scalar(Imgproc.GC_FGD.toDouble()),definite,Core.CMP_EQ)
      Core.compare(mask,Scalar(Imgproc.GC_PR_FGD.toDouble()),probable,Core.CMP_EQ);Core.bitwise_or(definite,probable,foreground)
      val fgLabels=mat();val fgStats=mat();val fgCenters=mat()
      val n=Imgproc.connectedComponentsWithStats(foreground,fgLabels,fgStats,fgCenters)
      val overlap=mat();val componentMask=mat()
      val chosen=(1 until n).maxByOrNull { i ->
        Core.compare(fgLabels,Scalar(i.toDouble()),componentMask,Core.CMP_EQ);Core.bitwise_and(componentMask,seed,overlap);Core.countNonZero(overlap)
      } ?: error("参照物轮廓为空")
      Core.compare(fgLabels,Scalar(chosen.toDouble()),componentMask,Core.CMP_EQ)
      val area=Core.countNonZero(componentMask);Core.findNonZero(componentMask,points)
      val floatPoints=mat();points.convertTo(floatPoints,CvType.CV_32F)
      val pts=MatOfPoint2f(floatPoints).also { owned.add(it) }
      // Java's points API needs a non-null array.
      val corners=Array(4) { Point() };Imgproc.minAreaRect(pts).points(corners)
      check(area>300) { "参照物轮廓太小" }
      return Detection(corners.map { UprightReferenceGeometry.Pixel(it.x,it.y) },area)
    } finally { owned.asReversed().forEach { it.release() } }
  }
}
