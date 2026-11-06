package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class RoutePerceptionTest {
  private val ground=GroundPlane(floatArrayOf(0f,0f,0f),floatArrayOf(0f,1f,0f))
  private val pose=RoutePose(0f,0f,0f)
  private fun patch()=listOf(-.15f,-.11f,-.07f,-.03f,.01f,.05f,.09f,.13f,.17f).flatMap { x->
    listOf(.18f,.22f,.26f,.34f,.38f,.42f,.46f).map { d->floatArrayOf(x,0f,-d) } }
  private fun assess(p: List<FloatArray>,fresh: Boolean=true)=RoutePerception.assess(p,ground,pose,fresh,.15f,.10f,.11f,.10f,true)
  @Test fun outsideOrHighPointsCannotProveLocalSpaceClear() {
    assertEquals(RouteClearance.DEPTH_UNKNOWN,assess(List(80) { floatArrayOf(.5f,0f,-1f) }).clearance)
    val high=assess(patch().map { floatArrayOf(it[0],.5f,it[2]) })
    assertEquals(0,high.lowBandPoints);assertEquals(RouteClearance.DEPTH_UNKNOWN,high.clearance)
  }
  @Test fun localGroundSamplingCanPassWithoutWholeDiscCandidate() {
    val r=assess(patch());assertEquals(RouteClearance.CLEAR,r.clearance)
    assertTrue(r.sectorSamples.all { it>=2 });assertEquals(false,r.report()["motionAuthorized"])
  }
  @Test fun missingSideIsExplainedRatherThanSilentlyCleared() {
    val r=assess(patch().filter { it[0]<.05f })
    assertEquals(RouteClearance.DEPTH_UNKNOWN,r.clearance)
    assertTrue((r.report()["missingSectors"] as List<*>).contains("近右"))
  }
  @Test fun duplicatedSamplesCannotInventAreaCoverage() {
    val r=assess(List(100) { floatArrayOf(0f,0f,-.2f) })
    assertEquals(RouteClearance.DEPTH_UNKNOWN,r.clearance);assertEquals(1,r.sectorSamples.sum())
  }
  @Test fun localObstacleWinsEvenWithIncompleteFloorCoverage() {
    val r=assess(List(40) { floatArrayOf(.5f,0f,-1f) }+List(3) { floatArrayOf(0f,.08f,-.25f) })
    assertEquals(RouteClearance.OBSTACLE,r.clearance);assertEquals("LOCAL_HAZARD",r.reason)
  }
  @Test fun oldDepthAndAbsentGroundAreExplicitUnknowns() {
    assertEquals("FRESH_RAW_REQUIRED",assess(patch(),false).reason)
    assertEquals(RouteClearance.DEPTH_UNKNOWN,RoutePerception.assess(patch(),null,pose,true,.15f,.1f,.11f,.1f).clearance)
  }
}
