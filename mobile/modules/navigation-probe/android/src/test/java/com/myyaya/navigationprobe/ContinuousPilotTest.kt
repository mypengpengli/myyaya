package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class ContinuousPilotTest {
  private fun pilot()=ContinuousPilot(0.0,.4,.15,.10,.02,.07,.05,.08f,1000)
  private fun frame(p: ContinuousPilot,t: Long,y: Double=0.0,origin: Long=1_000_000_000L,yaw: Double=0.0) {
    p.sensors(t,true,true,true)
    p.frame(t,t*1_000_000,yaw,mapOf("sampleTimestampNs" to t*1_000_000,"originTimestampNs" to origin,
      "cumulativePoseAvailable" to true,"originContinuity" to true,"cumulativeCameraDxMeters" to 0.0,"cumulativeCameraDzMeters" to -y,"sampleYawRadians" to yaw))
  }
  private fun observe(p: ContinuousPilot,t:Long,obstacle:Boolean=false) {
    val points=(-3..3).flatMap { x-> (1..8).map { y->ContinuousPilot.Point(.07+x*.03,.05+y*.04,1) } }.toMutableList()
    if(obstacle)points.add(ContinuousPilot.Point(.07,.15,2))
    p.observation(t,t*1_000_000,p.pose,points,listOf(ContinuousPilot.Pose(0.0,.4,0.0)))
  }
  @Test fun waitsForLinkAndPose() { val p=pilot();assertEquals(0 to 0,p.tick(1010,true));assertEquals("WAITING_LINK",p.phase) }
  @Test fun movesBetweenPerceptionUpdates() {
    val p=pilot();frame(p,1000);observe(p,1000)
    frame(p,1050);val a=p.tick(1050,true);frame(p,1100);val b=p.tick(1100,false)
    assertTrue(a.first<0 && b.first<a.first);assertEquals(1,p.perceptionCount)
  }
  @Test fun staleCameraBrakesWithoutJavascript() {
    val p=pilot();frame(p,1000);observe(p,1000);p.tick(1050,true)
    p.sensors(1400,true,true,true);assertEquals(0 to 0,p.tick(1400,false));assertEquals("WAITING_POSE",p.phase)
  }
  @Test fun perceptionExpiryBrakesWithLivePose() {
    val p=pilot();frame(p,1000);observe(p,1000)
    frame(p,2200);assertEquals(0 to 0,p.tick(2200,false));assertEquals("WAITING_PERCEPTION",p.phase)
  }
  @Test fun heartbeatExpiryBrakes() {
    val p=pilot();frame(p,1000);observe(p,1000);assertEquals(0 to 0,p.tick(1950,false));assertEquals("WAITING_LINK",p.phase)
  }
  @Test fun stopNeverRearmsOnNewFrames() {
    val p=pilot();frame(p,1000);observe(p,1000);p.cancel("USER_STOP");frame(p,1100);observe(p,1100)
    assertEquals(0 to 0,p.tick(1100,true));assertEquals("CANCELLED",p.phase);assertFalse(p.active)
  }
  @Test fun nearObstacleStopsSweptFootprint() {
    val p=pilot();frame(p,1000);observe(p,1000,true);assertEquals(0 to 0,p.tick(1050,true));assertEquals("WAITING_CLEARANCE",p.phase)
  }
  @Test fun unknownGroundIsNotClear() {
    val p=pilot();frame(p,1000);p.observation(1000,1_000_000_000,p.pose,emptyList(),listOf(ContinuousPilot.Pose(0.0,.4,0.0)))
    assertEquals(0,p.tick(1050,true).first)
  }
  @Test fun arrivalUsesMeasuredOdometry() {
    val p=pilot();frame(p,1000);observe(p,1000)
    frame(p,1100,.1);frame(p,1200,.2);frame(p,1300,.3);frame(p,1400,.35)
    assertEquals(0 to 0,p.tick(1400,false));assertEquals("AT_GOAL",p.phase)
  }
  @Test fun poseJumpCancelsPermanently() {val p=pilot();frame(p,1000);frame(p,1100,.3);assertEquals("CANCELLED",p.phase)}
  @Test fun changedFlowOriginCannotTeleportPose() {
    val p=pilot();frame(p,1000);frame(p,1100,.05);frame(p,1200,4.0,1_200_000_000)
    assertEquals(.05,p.pose.y,.00001);p.frame(1600,1_600_000_000,0.0,emptyMap());p.sensors(1600,true,true,true);p.tick(1600,true);p.sensors(2300,true,true,true)
    p.frame(2300,2_300_000_000,0.0,emptyMap());p.tick(2300,true);assertTrue(p.needReseed)
    p.reseeded();frame(p,2400,4.1,2_400_000_000);assertEquals(.05,p.pose.y,.00001)
    assertEquals(.02,p.uncertainty,.00001)
  }
  @Test fun blockedSensorStops() {
    val p=pilot();frame(p,1000);observe(p,1000);p.sensors(1050,true,false,false)
    assertEquals(0 to 0,p.tick(1050,true));assertEquals("WAITING_INTERLOCK",p.phase)
  }
  @Test fun noPathDoesNotDriveDirectlyIntoBlockedGoal() {
    val p=pilot();frame(p,1000);p.observation(1000,1_000_000_000,p.pose,emptyList(),emptyList())
    assertEquals(0 to 0,p.tick(1050,true));assertEquals("WAITING_PATH",p.phase)
  }
  @Test fun retainedObstacleIsNotForgottenOutsideCurrentImage() {
    val p=pilot();frame(p,1000)
    p.observation(1000,1_000_000_000,p.pose,emptyList(),listOf(ContinuousPilot.Pose(0.0,.4,0.0)),listOf(ContinuousPilot.Point(0.0,.08,2)))
    assertEquals(0 to 0,p.tick(1050,true));assertEquals("WAITING_CLEARANCE",p.phase)
  }
}
