package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class Yuv420PackTest {
  @Test fun respectsRowPaddingAndChromaPixelStride() {
    val y=Yuv420Pack.Plane(byteArrayOf(1,2,3,4,99,99,5,6,7,8),6,1)
    val u=Yuv420Pack.Plane(byteArrayOf(40,99,50),4,2)
    val v=Yuv420Pack.Plane(byteArrayOf(60,99,70),4,2)
    assertArrayEquals(byteArrayOf(1,2,3,4,5,6,7,8,60,40,70,50),Yuv420Pack.nv21(4,2,y,u,v))
  }
  @Test fun truncationDoesNotSilentlyGenerateAnImage() {
    val p=Yuv420Pack.Plane(byteArrayOf(1),2,1)
    try { Yuv420Pack.nv21(2,2,p,p,p);fail("truncated YUV") } catch(_:IllegalArgumentException) {}
  }
}
