package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class ReferenceGeometryTest {
  private val valid=floatArrayOf(.1f,.1f,.9f,.06f,.85f,.95f,.16f,.9f)
  @Test fun physicalWidthAndHeightDetermineRectifiedAspect() {
    val size=ReferenceGeometry.validate(valid,.15f,.27f)
    assertEquals(889,size.first); assertEquals(1600,size.second)
  }
  @Test fun landscapeReferenceKeepsShortestSideAbove300Pixels() {
    assertEquals(1600 to 320,ReferenceGeometry.validate(valid,1f,.2f))
  }
  @Test fun crossingReversedAndOverlappingCornersAreRejected() {
    val crossed=floatArrayOf(.1f,.1f,.9f,.9f,.9f,.1f,.1f,.9f)
    val reversed=floatArrayOf(.1f,.1f,.1f,.9f,.9f,.9f,.9f,.1f)
    val overlapped=valid.clone().apply { this[2]=this[0]; this[3]=this[1] }
    for (corners in listOf(crossed,reversed,overlapped)) assertThrows(IllegalArgumentException::class.java) { ReferenceGeometry.validate(corners,.15f,.27f) }
  }
  @Test fun nonFiniteAndOutsideImageCornersAreRejected() {
    for (value in listOf(Float.NaN,Float.POSITIVE_INFINITY,-.01f,1.01f)) {
      val corners=valid.clone().apply { this[0]=value }
      assertThrows(IllegalArgumentException::class.java) { ReferenceGeometry.validate(corners,.15f,.27f) }
    }
  }
  @Test fun wrongDimensionsAndTinySelectionAreRejected() {
    for (w in listOf(0f,Float.NaN,4f)) assertThrows(IllegalArgumentException::class.java) { ReferenceGeometry.validate(valid,w,.27f) }
    val tiny=floatArrayOf(.1f,.1f,.2f,.1f,.2f,.2f,.1f,.2f)
    assertThrows(IllegalArgumentException::class.java) { ReferenceGeometry.validate(tiny,.15f,.27f) }
  }
}
