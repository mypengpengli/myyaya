package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class NavigationPoseLockTest {
  private val p=RoutePose(0f,0f,0f)
  private fun locked()=NavigationPoseLock().apply {
    begin(1000);assertFalse(observe(p,.1f,1800));assertTrue(observe(p,.1f,2400))
  }
  @Test fun waitsForSettlingAndStablePose() {
    val lock=NavigationPoseLock();lock.begin(1000)
    assertFalse(lock.observe(p,.1f,1500))
    assertFalse(lock.observe(p,.1f,1800))
    assertFalse(lock.observe(p.copy(pitch=.05f),.1f,2200))
    assertFalse(lock.observe(p.copy(pitch=.05f),.1f,2600))
    assertTrue(lock.observe(p.copy(pitch=.05f),.1f,2800))
  }
  @Test fun flatFloorTranslationAndTurnsKeepMountLocked() {
    assertTrue(locked().observe(p.copy(x=1f,z=-1f,yaw=2f),.11f,3000))
  }
  @Test fun neckHeightChangeInvalidatesUntilExplicitConfirmation() {
    val lock=locked();assertFalse(lock.observe(p,.14f,3000));assertFalse(lock.isLocked)
    assertFalse(lock.observe(p,.1f,4000))
    lock.begin(4000);assertFalse(lock.observe(p,.1f,4800));assertTrue(lock.observe(p,.1f,5400))
  }
  @Test fun pitchRollAndTrackingDoNotPretendFixed() {
    assertFalse(locked().observe(p.copy(pitch=.2f),.1f,3000))
    assertFalse(locked().observe(p.copy(roll=.2f),.1f,3000))
    assertFalse(locked().observe(null,null,3000))
  }
  @Test fun neckChangeStopsFollowerBeforeAnotherPulse() {
    val lock=locked()
    val r=TaughtRoute(name="short",mapId="map",sessionId="session",referenceKey="",mount=RouteMount(),
      points=listOf(p,p.copy(z=-.1f),p.copy(z=-.2f)),pitch=0f)
    val f=RouteFollower(r)
    f.start(RouteObservation(p,2500,true,true,RouteClearance.CLEAR,true,true))
    val d=f.step(RouteObservation(p,3000,true,true,RouteClearance.CLEAR,true,lock.observe(p,.14f,3000)),3000)
    assertTrue(d.stop);assertNull(d.pulse);assertEquals("PAUSED",f.phase)
  }
  @Test fun heightFailureReportsTheMapDeltaWithoutClaimingMechanicalCause() {
    val lock=locked();assertFalse(lock.observe(p,.154f,3000))
    assertEquals("MAP_HEIGHT_CHANGED",lock.report()["state"])
    assertEquals(.054f,lock.report()["heightDeltaMeters"] as Float,.00001f)
    assertFalse(lock.isLocked)
    assertEquals("MAP_HEIGHT_CHANGED",lock.failureReason())
    assertTrue(lock.reason.contains("不能判断脖子"))
  }
  @Test fun recordedFieldHeightDriftIsDistinctFromTiltAndDisconnect() {
    val lock=NavigationPoseLock();val pose=p.copy(pitch=.014391891f,roll=-.0063089826f)
    lock.begin(1000);assertFalse(lock.observe(pose,-.20585288f,1800));assertTrue(lock.observe(pose,-.20585288f,2400))
    assertFalse(lock.observe(pose.copy(pitch=pose.pitch-.01612986f,roll=pose.roll-.0013214356f),-.23280925f,3000))
    assertEquals("MAP_HEIGHT_CHANGED",lock.failureReason())
    val tilted=locked();assertFalse(tilted.observe(p.copy(pitch=.2f),.1f,3000))
    assertEquals("MOUNT_TILT_CHANGED",tilted.failureReason())
    val disconnected=locked();assertFalse(disconnected.observe(p,.1f,3000,false,1))
    assertEquals("CONNECTION_CHANGED",disconnected.failureReason())
  }
  @Test fun disconnectionInvalidatesTheMinimumEvenWithoutVisiblePoseChange() {
    val lock=locked()
    assertFalse(lock.observe(p,.1f,3000,false,1))
    assertEquals("CONNECTION_CHANGED",lock.report()["state"])
    assertFalse(lock.observe(p,.1f,5000,true,2))
    lock.begin(6000,2);assertFalse(lock.observe(p,.1f,6800,true,2));assertTrue(lock.observe(p,.1f,7400,true,2))
  }
  @Test fun reconnectBetweenCameraFramesStillRequiresManualPoseConfirmation() {
    val lock=locked()
    // The camera sees connected=true both times; the transport revision exposes the intervening drop.
    assertFalse(lock.observe(p,.1f,3000,true,2))
    assertFalse(lock.isLocked);assertFalse(lock.observe(p,.1f,4000,true,2))
  }
}
