package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class LocalNavigationTest {
  private val ground=GroundPlane(floatArrayOf(0f,0f,0f),floatArrayOf(0f,1f,0f))
  private val camera=RigidPose(floatArrayOf(0f,.1f,0f),floatArrayOf(0f,0f,0f,1f))
  private val robot=RobotEnvelope(.15f,.10f,.11f,.05f)
  private val start=RoutePose(.0125f,.0125f,0f)
  private fun points(xs: IntRange= -20..20,zs: IntRange= -30..20)=xs.flatMap { x->zs.map { z->
    floatArrayOf((x+.5f)*.025f,0f,(z+.5f)*.025f) } }
  private fun map(p: List<FloatArray> = points()): LocalMapSnapshot {
    val m=LocalNavigationMap();m.update(camera,ground,1_000_000_000,1_000_000_000,p,.11f)
    return m.update(camera,ground,1_100_000_000,1_100_000_000,p,.11f)
  }
  @Test fun floorSupportSurvivesButOldClearanceDoesNot() {
    val m=LocalNavigationMap();val p=points()
    m.update(camera,ground,1_000_000_000,1_000_000_000,p,.11f)
    val s=m.update(camera,ground,1_100_000_000,1_100_000_000,p,.11f)
    val old=m.update(camera,ground,5_000_000_000,0,emptyList(),.11f)
    assertEquals(s.tiles.values.count { it.floorFrames>=2 },old.tiles.values.count { it.floorFrames>=2 })
    assertTrue(old.tiles.values.none { it.space==LocalSpace.FREE })
    assertEquals("FRESH_RAW_REQUIRED",LocalTrajectory.check(old,start,start.copy(z=-.02f),robot).state)
  }
  @Test fun repeatedRawCannotCreateSupportOrClearHazard() {
    val m=LocalNavigationMap();val p=points()
    repeat(5) { m.update(camera,ground,1_000_000_000L+it*10_000_000,1_000_000_000,p,.11f) }
    val s=m.update(camera,ground,1_100_000_000,1_000_000_000,p,.11f)
    assertTrue(s.tiles.values.none { it.space==LocalSpace.FREE })
  }
  @Test fun sparsePointsNeverFillTheirConvexHullOrOccludedHole() {
    val s=map(points().filterNot { it[0] in -.02f.. .02f && it[2] in -.15f.. -.05f })
    assertEquals(LocalSpace.UNKNOWN,s.space(LocalNavigationMap.tile(0f,-.1f)))
    assertFalse(LocalTrajectory.check(s,start,start.copy(z=-.05f),robot).clear)
  }
  @Test fun oneHazardBlocksAndCannotDisappearOnTimeoutOrFloorInSameCell() {
    val m=LocalNavigationMap();val hazard=floatArrayOf(.0125f,.08f,-.1125f);val p=points()
    m.update(camera,ground,1_000_000_000,1_000_000_000,p+listOf(hazard),.11f)
    var s=m.update(camera,ground,1_100_000_000,1_100_000_000,p,.11f)
    assertEquals(LocalSpace.WEAK_OBSTACLE,s.space(LocalNavigationMap.tile(hazard[0],hazard[2])))
    s=m.update(camera,ground,9_000_000_000,0,emptyList(),.11f)
    assertEquals(LocalSpace.WEAK_OBSTACLE,s.space(LocalNavigationMap.tile(hazard[0],hazard[2])))
  }
  @Test fun stableObstacleAndDropRemainDistinct() {
    val obstacle=floatArrayOf(.0125f,.08f,-.1125f);val drop=floatArrayOf(.0875f,-.08f,-.1125f)
    val s=map(points()+listOf(obstacle,drop))
    assertEquals(LocalSpace.OBSTACLE,s.space(LocalNavigationMap.tile(obstacle[0],obstacle[2])))
    assertEquals(LocalSpace.DROP,s.space(LocalNavigationMap.tile(drop[0],drop[2])))
    assertEquals("DROP_IN_SWEEP",LocalTrajectory.check(s,start,start.copy(z=-.05f),robot).state)
  }
  @Test fun clearingNeedsThreeLaterRaysThroughOccupiedHeight() {
    val m=LocalNavigationMap();val hazard=floatArrayOf(0f,.05f,-.2f)
    m.update(camera,ground,1_000_000_000,1_000_000_000,listOf(hazard),.11f)
    var s=LocalMapSnapshot()
    for(i in 1..3) {
      val ns=1_000_000_000L+i*100_000_000L
      s=m.update(camera,ground,ns,ns,listOf(floatArrayOf(0f,0f,-.4f)),.11f)
      if(i<3) assertEquals(LocalSpace.WEAK_OBSTACLE,s.space(LocalNavigationMap.tile(0f,-.2f)))
    }
    assertEquals(LocalSpace.UNKNOWN,s.space(LocalNavigationMap.tile(0f,-.2f)))
  }
  @Test fun highRaysDoNotClearLowObstacles() {
    val m=LocalNavigationMap();val p=floatArrayOf(0f,.04f,-.2f)
    m.update(camera,ground,1_000_000_000,1_000_000_000,listOf(p),.11f)
    for(i in 1..4) {
      val ns=1_000_000_000L+i*100_000_000L
      val s=m.update(camera,ground,ns,ns,listOf(floatArrayOf(0f,.4f,-.4f)),.11f)
      assertEquals(LocalSpace.WEAK_OBSTACLE,s.space(LocalNavigationMap.tile(0f,-.2f)))
    }
  }
  @Test fun datumChangeAndLocalizationResetInvalidateOldEvidence() {
    val m=LocalNavigationMap();val p=points()
    m.update(camera,ground,1_000_000_000,1_000_000_000,p,.11f)
    val s=m.update(camera,GroundPlane(floatArrayOf(0f,.03f,0f),ground.normal),1_100_000_000,0,emptyList(),.11f)
    assertTrue(s.tiles.isEmpty());m.reset()
    val after=m.update(camera,ground,1_200_000_000,1_200_000_000,p,.11f)
    assertTrue(after.tiles.values.none { it.space==LocalSpace.FREE })
  }
  @Test fun shortRectangleCanFitWithoutAnyFullTurnDiscFitting() {
    // 30cm observed corridor: the legacy 10cm grid cannot establish three
    // fully supported columns, but an oriented short rectangle can fit.
    val p=points(-6..5,-20..20);val s=map(p)
    val legacy=TerrainAnalysis();legacy.setEnvelope(robot);legacy.selectGround(ground)
    var diagnostic=TerrainSnapshot(true,"OBSERVING")
    repeat(3) { i->val ns=1_000_000_000L+i*100_000_000L;diagnostic=legacy.update(camera,ground,ns,ns,p) }
    assertEquals(0,diagnostic.cells.count { it.candidate })
    val centered=start.copy(x=0f)
    val step=LocalTrajectory.check(s,centered,centered.copy(z=-.0375f),robot)
    assertEquals("GEOMETRY_CLEAR",step.state)
    assertFalse(LocalTrajectory.check(s,centered,centered.copy(yaw=PI.toFloat()/2),robot,0f).clear)
    assertEquals(false,step.report()["motionAuthorized"])
  }
  @Test fun sweptMiddleAndStoppingDistanceAreChecked() {
    val obstacle=floatArrayOf(.0125f,.08f,-.1375f)
    val s=map(points()+listOf(obstacle))
    assertEquals("OBSTACLE_IN_SWEEP",LocalTrajectory.check(s,start,start.copy(z=-.1f),robot).state)
    val edge=map(points(-20..20,-6..20))
    assertTrue(LocalTrajectory.check(edge,start,start.copy(z=-.0125f),robot,0f,0f,0f).clear)
    assertFalse(LocalTrajectory.check(edge,start,start.copy(z=-.0125f),robot,.06f).clear)
  }
  @Test fun unknownRearCornerBlocksTurnEvenWithClearFront() {
    val s=map(points().filterNot { it[0]>.1f && it[2]>.06f })
    assertFalse(LocalTrajectory.check(s,start,start.copy(yaw=.4f),robot,0f).clear)
  }
  @Test fun plannerRoutesAroundKnownObstacleAndChecksEveryEdge() {
    val can=points(-2..2,-14.. -10).map { floatArrayOf(it[0],.08f,it[2]) }
    val s=map(points()+can);val goal=LocalGoal(.0125f,-.55f)
    val p=LocalPlanner.plan(s,start,goal,robot,2000)
    assertEquals("PATH_TO_GOAL",p.state)
    assertTrue(p.path.any { abs(it.x-start.x)>.2f })
    p.path.zipWithNext().forEach { (a,b)->assertTrue(LocalTrajectory.check(s,a,b,robot,
      if(a.distance(b)>.001f) .01f else 0f,
      if(a.distance(b)<=.001f) sign(wrapYaw(b.yaw-a.yaw))*.05f else 0f).clear) }
  }
  @Test fun unknownGoalReturnsReachableFreeBoundaryAndStopsBeforeUnknown() {
    val s=map(points(-15..15,-14..10))
    val p=LocalPlanner.plan(s,start,LocalGoal(.0125f,-.8f),robot,1000)
    assertEquals("PATH_TO_FRONTIER",p.state)
    assertTrue(p.path.last().z> -.35f)
    assertTrue(p.firstStep!!.clear)
  }
  @Test fun fullyUnknownStartCannotProduceExplorationMotion() {
    val s=LocalMapSnapshot(atNs=1_000_000_000,lastDepthNs=1_000_000_000)
    val p=LocalPlanner.plan(s,start,LocalGoal(0f,-.5f),robot)
    assertEquals("WAITING",p.state);assertEquals("UNOBSERVED_SWEEP",p.reason)
    assertTrue(p.firstStep!!.initialUnknown>0)
  }
  @Test fun incrementalRevealCanExtendAFrontierPathToGoal() {
    val goal=LocalGoal(.0125f,-.7f)
    val partial=map(points(-20..20,-14..20))
    val frontier=LocalPlanner.plan(partial,start,goal,robot,1000)
    assertEquals("PATH_TO_FRONTIER",frontier.state)
    val revealed=map(points(-20..20,-36..20))
    val next=LocalPlanner.plan(revealed,frontier.path.last(),goal,robot,1000)
    assertEquals("PATH_TO_GOAL",next.state)
  }
}
