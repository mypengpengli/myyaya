package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class FloorFlowRegionTest {
  @Test fun selectedCpuCornersPreserveOrderForDisplayTransform() {
    val r=FloorFlowRegion(.3f,.8f,.88f,.95f)
    assertArrayEquals(floatArrayOf(192f,384f,563.2f,384f,563.2f,456f,192f,456f),r.corners(640,480),.001f)
    assertEquals(false,r.report()["floorVerified"])
  }
  @Test fun invalidOrTooSmallRegionsAreRejected() {
    for(v in listOf(floatArrayOf(-.1f,.7f,.8f,.95f),floatArrayOf(.8f,.7f,.3f,.95f),
      floatArrayOf(.3f,.9f,.8f,.85f),floatArrayOf(.3f,.8f,.35f,.95f),floatArrayOf(.3f,.8f,.8f,Float.NaN))) {
      assertTrue(runCatching { FloorFlowRegion(v[0],v[1],v[2],v[3]) }.isFailure)
    }
  }
}
