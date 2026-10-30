package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.sqrt

class TerrainAnalysisTest {
  private val plane=GroundPlane(floatArrayOf(0f,0f,0f),floatArrayOf(0f,1f,0f))
  private val camera=RigidPose(floatArrayOf(0f,.3f,0f),floatArrayOf(0f,0f,0f,1f))
  private val robot=RobotEnvelope(.15f,.10f,.11f,.05f)
  private fun analyzer(dimensions: Boolean=true)=TerrainAnalysis().apply { if (dimensions) setEnvelope(robot); selectGround(plane) }
  private fun patch(xr: IntRange=-5..5,zr: IntRange=-10..0,y: Float=0f)=xr.flatMap { x -> zr.flatMap { z ->
    listOf(.025f to .025f,.075f to .025f,.075f to .075f,.025f to .075f).map { (a,b) -> floatArrayOf(x*.1f+a,y,z*.1f+b) }
  } }
  private fun observe(a: TerrainAnalysis,points: List<FloatArray>,start: Long=1_000_000_000L): TerrainSnapshot {
    var result=TerrainSnapshot(false,"test")
    repeat(3) { val t=start+it*500_000_000L; result=a.update(camera,plane,t,t,points) }
    return result
  }
  @Test fun unknownSpaceAndPlanePolygonAloneNeverBecomeGround() {
    val r=observe(analyzer(),emptyList()); assertTrue(r.cells.isEmpty()); assertEquals(0,r.report()["candidateCenterCells"])
  }
  @Test fun needsThreeIndependentDepthFramesAndSpatialCoverage() {
    val a=analyzer(); val points=patch(0..0,-3..-3)
    assertEquals(TerrainKind.UNCERTAIN,a.update(camera,plane,1_000_000_000L,1_000_000_000L,points).cells.single().kind)
    repeat(4) { assertFalse(a.update(camera,plane,1_100_000_000L+it,1_000_000_000L,points).cells.single().kind==TerrainKind.GROUND) }
    assertEquals(TerrainKind.GROUND,observe(a,points,1_500_000_000L).cells.single().kind)
  }
  @Test fun sparsePointCannotFillAnEntireFloorCell() {
    val r=observe(analyzer(),listOf(floatArrayOf(.025f,0f,-.275f)))
    assertEquals(TerrainKind.UNCERTAIN,r.cells.single().kind); assertFalse(r.cells.single().candidate)
  }
  @Test fun completeWidePatchHasCandidateCentersButUnknownEdgesDoNot() {
    val r=observe(analyzer(),patch())
    assertTrue(r.cells.any { it.candidate }); assertTrue(r.cells.filter { it.x== -5 || it.x==5 }.none { it.candidate })
    assertEquals(false,r.report()["motionAuthorized"])
  }
  @Test fun wholeDiagonalEnvelopeIncludesLengthAndTurningMargin() {
    assertEquals(sqrt(.15f*.15f+.1f*.1f)/2+.05f,robot.radius,.00001f)
    val a=analyzer(); a.setEnvelope(RobotEnvelope(.15f,.8f,.11f,.05f))
    assertFalse(observe(a,patch(-2..2)).cells.any { it.candidate })
  }
  @Test fun unknownGapAndNarrowFloorCannotBeDeclaredTraversable() {
    assertFalse(observe(analyzer(),patch(-1..0)).cells.any { it.candidate })
    val r=observe(analyzer(),patch().filterNot { it[0] in 0f..0.1f })
    assertTrue(r.cells.filter { it.x in -1..1 }.none { it.candidate })
  }
  @Test fun obstacleOverridesGroundAndExcludesNearbyCenters() {
    val a=analyzer(); observe(a,patch())
    val r=a.update(camera,plane,2_500_000_000L,2_500_000_000L,patch()+listOf(floatArrayOf(.025f,.08f,-.475f)))
    assertEquals(TerrainKind.OBSTACLE,r.cells.single { it.x==0 && it.z== -5 }.kind)
    assertTrue(r.cells.filter { it.x in -1..1 && it.z in -6..-4 }.none { it.candidate })
  }
  @Test fun detectedDropOverridesGroundAndExcludesCandidates() {
    val a=analyzer(); observe(a,patch())
    val r=a.update(camera,plane,2_500_000_000L,2_500_000_000L,listOf(floatArrayOf(.025f,-.1f,-.475f)))
    assertEquals(TerrainKind.DROP,r.cells.single { it.x==0 && it.z== -5 }.kind)
  }
  @Test fun highSurfaceDoesNotProveGroundUnderneathIsClear() {
    val r=observe(analyzer(),patch(0..0,-4..-4,.5f))
    assertEquals(TerrainKind.UNCERTAIN,r.cells.single().kind); assertFalse(r.cells.single().candidate)
  }
  @Test fun roughOrBorderlineHeightsStayUnknown() {
    val points=patch(0..0,-4..-4).mapIndexed { i,p -> p.clone().also { it[1]=if (i%2==0) -.024f else .024f } }
    assertEquals(TerrainKind.UNCERTAIN,observe(analyzer(),points).cells.single().kind)
    assertEquals(TerrainKind.UNCERTAIN,observe(analyzer(),patch(0..0,-4..-4,.028f)).cells.single().kind)
  }
  @Test fun missingDimensionsStillClassifyButNeverOfferCandidateCenters() {
    val r=observe(analyzer(false),patch()); assertTrue(r.cells.any { it.kind==TerrainKind.GROUND })
    assertFalse(r.cells.any { it.candidate }); assertEquals("DIMENSIONS_REQUIRED",r.status)
  }
  @Test fun expiredAndReprojectedDepthCannotKeepOldEvidenceAlive() {
    val a=analyzer(); observe(a,patch())
    assertTrue(a.update(camera,plane,5_000_000_001L,2_000_000_000L,patch()).cells.isEmpty())
  }
  @Test fun oldQuadrantsCannotBeKeptAliveByOneRepeatedSpatialPoint() {
    val a=analyzer(); observe(a,patch(0..0,-4..-4))
    var r=TerrainSnapshot(false,"")
    for (i in 1..8) { val t=2_000_000_000L+i*500_000_000L; r=a.update(camera,plane,t,t,listOf(floatArrayOf(.025f,0f,-.375f))) }
    assertEquals(TerrainKind.UNCERTAIN,r.cells.single().kind)
  }
  @Test fun staleFutureAndDuplicateDepthCannotCreateEvidence() {
    for ((now,depth) in listOf(1_300_000_001L to 1_000_000_000L,1_000_000_000L to 1_000_000_001L)) {
      assertTrue(analyzer().update(camera,plane,now,depth,patch()).cells.isEmpty())
    }
  }
  @Test fun trackingResetAndNewPlaneCannotReuseOldFloorCells() {
    val a=analyzer(); observe(a,patch()); a.reset(); assertFalse(a.hasGround())
    assertFalse(a.update(camera,plane,3_000_000_000L,3_000_000_000L,patch()).groundSelected)
    a.selectGround(plane); assertEquals(TerrainKind.UNCERTAIN,a.update(camera,plane,4_000_000_000L,4_000_000_000L,patch(0..0,-4..-4)).cells.single().kind)
  }
  @Test fun planeHeightJumpClearsOldClassification() {
    val a=analyzer(); observe(a,patch())
    val raised=GroundPlane(floatArrayOf(0f,.1f,0f),plane.normal)
    assertTrue(a.update(camera,raised,3_000_000_000L,3_000_000_000L,emptyList()).cells.isEmpty())
  }
  @Test fun invalidCameraHeightAndClockRollbackClearEvidence() {
    val a=analyzer(); observe(a,patch())
    val low=RigidPose(floatArrayOf(0f,.01f,0f),camera.q)
    assertEquals("CAMERA_HEIGHT_INVALID",a.update(low,plane,3_000_000_000L,3_000_000_000L,patch()).status)
    assertEquals("CLOCK_RESET",a.update(camera,plane,2_000_000_000L,2_000_000_000L,patch()).status)
  }
  @Test fun rejectInvalidDimensionsAndNonGroundNormals() {
    assertThrows(IllegalArgumentException::class.java) { RobotEnvelope(.15f,.1f,Float.NaN,.05f) }
    assertThrows(IllegalArgumentException::class.java) { RobotEnvelope(.15f,.1f,.11f,0f) }
    assertThrows(IllegalArgumentException::class.java) { GroundPlane(floatArrayOf(0f,0f,0f),floatArrayOf(0f,-1f,0f)) }
    assertThrows(IllegalArgumentException::class.java) { GroundPlane(floatArrayOf(0f,0f,0f),floatArrayOf(1f,0f,0f)) }
  }
  @Test fun tabletopExperimentIsNeverReportedAsConfirmedFloorOrFloorCandidates() {
    val a=analyzer(); a.selectGround(plane,false)
    val r=observe(a,patch()); val report=r.report()
    assertEquals(false,report["groundSelected"]); assertEquals(true,report["referenceSurfaceSelected"])
    assertEquals("bench-test",report["surfaceRole"]); assertEquals(0,report["candidateCenterCells"])
    assertTrue((report["benchCandidateCenterCells"] as Int)>0); assertEquals(false,report["motionAuthorized"])
    a.reset(); a.selectGround(plane,true)
    val floor=observe(a,patch(),4_000_000_000L).report()
    assertEquals("floor-confirmed",floor["surfaceRole"]); assertEquals(true,floor["groundSelected"])
    assertEquals(0,floor["benchCandidateCenterCells"])
  }
  @Test fun lowMountedCameraCanObserveAPlaneWithoutPretendingItIsFloor() {
    val a=analyzer(); a.selectGround(plane,false)
    val low=RigidPose(floatArrayOf(0f,.05f,0f),camera.q)
    val r=a.update(low,plane,1_000_000_000L,1_000_000_000L,patch())
    assertEquals("OBSERVING",r.status); assertEquals(.05f,r.cameraHeight!!,.00001f)
    assertEquals(false,r.report()["groundSelected"])
  }
}
