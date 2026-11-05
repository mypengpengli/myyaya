package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.roundToInt

class SurfaceReferenceTest {
  private val camera=RigidPose(floatArrayOf(0f,.3f,0f),floatArrayOf(0f,0f,0f,1f))
  private fun sample()=DepthSamples.Result(40,30,IntArray(1200) { i ->
    val y=i/40;if (y<14) 0 else (6000f/(y-10)).roundToInt()
  },0.0,null,null)
  private fun fit(s: DepthSamples.Result=sample(),hit: FloatArray?=null)=SurfaceReference.fitPatch(s,camera,.5f,.75f,20f,20f,20f,10f,40,30,hit)
  @Test fun planarRawNeighborhoodCanEstablishHorizontalReferenceWithoutAnArPolygon() {
    val r=fit();assertEquals("RAW_HORIZONTAL_PATCH",r.status);assertTrue(r.samples>=16)
    assertEquals(0f,r.plane!!.origin[1],.001f);assertArrayEquals(floatArrayOf(0f,1f,0f),r.plane.normal,.00001f)
  }
  @Test fun sparseUnknownNeighborhoodCannotBecomeAPlane() {
    assertNull(fit(sample().copy(millimeters=IntArray(1200))).plane)
    val s=sample();s.millimeters.indices.filter { it%40!=20 }.forEach { s.millimeters[it]=0 }
    assertNull(fit(s).plane)
  }
  @Test fun verticalWallAndConflictingDepthHitAreRejected() {
    assertNull(fit(sample().copy(millimeters=IntArray(1200) { 1000 })).plane)
    assertEquals("DEPTH_HIT_DISAGREES",fit(hit=floatArrayOf(0f,.2f,-.5f)).status)
  }
  @Test fun measuredHeightUsesGravityAndMountHeightRatherThanBodyHeight() {
    val c=RigidPose(floatArrayOf(1f,2f,3f),camera.q)
    val p=SurfaceReference.measuredHeight(c,.065f)
    assertEquals(1.935f,p.origin[1],.00001f);assertEquals(.065f,p.distance(c.t),.00001f)
    assertEquals(1f,p.origin[0],.00001f);assertEquals(3f,p.origin[2],.00001f)
  }
  @Test fun invalidHeightCannotSilentlyCreateAReference() {
    for (h in listOf(0f,-1f,Float.NaN,3f)) assertThrows(IllegalArgumentException::class.java) { SurfaceReference.measuredHeight(camera,h) }
  }
}
