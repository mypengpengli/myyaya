package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.roundToInt

class HybridDepthTest {
  private val camera=RigidPose(floatArrayOf(0f,.3f,0f),floatArrayOf(0f,0f,0f,1f))
  private val plane=GroundPlane(floatArrayOf(0f,0f,0f),floatArrayOf(0f,1f,0f))
  private fun sample(sparse: Boolean): DepthSamples.Result {
    val values=IntArray(40*30) { i ->
      val x=i%40;val y=i/40
      if (y<14 || sparse && (x%3!=0 || y%3!=0)) 0 else (6000f/(y-10)).roundToInt()
    }
    return DepthSamples.Result(40,30,values,0.0,null,null)
  }
  private fun fuse(raw: DepthSamples.Result=sample(true),dense: DepthSamples.Result?=sample(false),
    rawNs: Long=1_000_000_000L,denseNs: Long=1_000_000_000L,now: Long=1_000_000_000L)=
    HybridDepth.fuse(raw,dense,camera,plane,20f,20f,20f,10f,40,30,rawNs,denseNs,now)
  @Test fun matchingFullDepthAddsSpatialEvidenceAroundMeasuredPlaneAnchors() {
    val raw=sample(true);val r=fuse(raw)
    assertEquals("RAW_AND_VALIDATED_SMOOTH",r.status);assertTrue(r.added>100)
    assertTrue(r.anchors>=8);assertEquals(0f,r.medianError!!,.0001f)
    raw.millimeters.forEachIndexed { i,mm -> if (mm>0) { assertEquals(mm,r.sample.millimeters[i]);assertFalse(r.filled[i]) } }
  }
  @Test fun denseOnlyPlaneWithoutRawAnchorsCannotFillUnknownSpace() {
    val r=fuse(sample(true).copy(millimeters=IntArray(1200)))
    assertEquals(0,r.added);assertTrue(r.sample.millimeters.all { it==0 })
  }
  @Test fun disagreeingDepthSourcesAreExplicitlyRejected() {
    val dense=sample(false).let { it.copy(millimeters=it.millimeters.map { mm -> if (mm>0) mm+400 else 0 }.toIntArray()) }
    val r=fuse(dense=dense);assertEquals("RAW_ONLY_PAIR_DISAGREES",r.status);assertEquals(0,r.added)
  }
  @Test fun grossOutOfRangeSmoothValuesCannotMasqueradeAsFloor() {
    val r=fuse(dense=sample(false).copy(millimeters=IntArray(1200) { 16000 }))
    assertEquals("RAW_ONLY_INSUFFICIENT_OVERLAP",r.status);assertEquals(0,r.added)
  }
  @Test fun smoothDepthNeverOverwritesRawObstacle() {
    val raw=sample(true);val i=26*40+20;raw.millimeters[i]=sample(false).millimeters[i]/2
    val r=fuse(raw)
    assertEquals(raw.millimeters[i],r.sample.millimeters[i]);assertFalse(r.filled[i])
    assertTrue(r.added>0)
  }
  @Test fun unsupportedAndMismatchedPairsUseRawWithoutFilling() {
    assertEquals("RAW_ONLY_UNAVAILABLE",fuse(dense=null).status)
    assertEquals("RAW_ONLY_SIZE_MISMATCH",fuse(dense=sample(false).copy(sourceWidth=80)).status)
    assertEquals("RAW_ONLY_STALE_PAIR",fuse(denseNs=1L).status)
    assertEquals("RAW_ONLY_STALE_PAIR",fuse(rawNs=1_000_000_001L).status)
  }
  @Test fun agreeingHighSurfacesDoNotProvideGroundAnchors() {
    val raised=sample(false).let { it.copy(millimeters=it.millimeters.map { mm -> mm/3 }.toIntArray()) }
    val r=fuse(raised,raised);assertEquals("RAW_ONLY_INSUFFICIENT_PLANE_ANCHORS",r.status)
    assertEquals(0,r.added)
  }
}
