package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class PulseMeasurementTest {
  private val start=RoutePose(0f,0f,0f)
  @Test fun explicit450msBackTrialDoesNotAllowLongTurnOrArbitraryDuration() {
    PulseMeasurementTrial("back",450,start,1000)
    for((direction,ms) in listOf("left" to 450,"right" to 450,"back" to 451)) {
      try { PulseMeasurementTrial(direction,ms,start,1000);fail("invalid calibration duration") } catch(_:IllegalArgumentException) {}
    }
  }
  @Test fun largerTurnIsAnExactOperatorDurationAndStillNeedsSettling() {
    for(direction in listOf("left","right")) {
      val trial=PulseMeasurementTrial(direction,350,start,1000)
      trial.observe(start,1000);trial.observe(start.copy(yaw=.2f),1300);trial.acknowledge(true,1400)
      for(ms in 1500L..2100L step 100) trial.observe(start.copy(yaw=.2f),ms)
      assertTrue(trial.result!!.valid)
    }
    for((direction,ms) in listOf("back" to 350,"left" to 351,"right" to 600)) {
      try { PulseMeasurementTrial(direction,ms,start,1000);fail("arbitrary larger pulse") } catch(_:IllegalArgumentException) {}
    }
  }
  @Test fun measuredSevenRightFiveForwardUsesRearCameraAxes() {
    val camera=RigidPose(floatArrayOf(0f,.1f,0f),floatArrayOf(0f,0f,0f,1f))
    val base=RoutePose.fromCamera(camera,.07f,.05f)
    assertEquals(.07f,base.x,1e-6f);assertEquals(-.05f,base.z,1e-6f)
  }
  @Test fun cameraOrbitIsNotMistakenForTrackCenterTranslation() {
    for(yaw in listOf(0f,.5f,PI.toFloat()/2,2f)) {
      val camera=RigidPose(floatArrayOf(-cos(yaw)*.07f-sin(yaw)*.05f,.1f,-sin(yaw)*.07f+cos(yaw)*.05f),
        floatArrayOf(0f,-sin(yaw/2),0f,cos(yaw/2)))
      val base=RoutePose.fromCamera(camera,.07f,.05f)
      assertEquals(0f,base.x,1e-6f);assertEquals(0f,base.z,1e-6f)
      assertEquals(yaw,base.yaw,1e-6f)
    }
  }
  @Test fun backTrialWaitsForAckAndSettledFreshPose() {
    val t=PulseMeasurementTrial("back",200,start,1000)
    t.observe(start,1000);t.observe(start.copy(z=-.02f),1200);t.acknowledge(true,1250)
    for(ms in 1300L..1900L step 100) t.observe(start.copy(z=-.024f),ms)
    assertNull(t.result)
    t.observe(start.copy(z=-.024f),2000)
    val r=t.result!!;assertTrue(r.valid);assertEquals(.024f,r.displacementMeters,.0001f)
    assertEquals(.004f,r.postAckResidualMeters,.0001f)
    assertEquals(false,r.report()["stoppingDistanceValidated"])
  }
  @Test fun wrongDirectionAndNoMovementCannotPass() {
    for(z in listOf(.03f,0f)) {
      val t=PulseMeasurementTrial("back",200,start,1000)
      t.observe(start,1000);t.acknowledge(true,1100)
      for(ms in 1200L..1900L step 100) t.observe(start.copy(z=z),ms)
      assertFalse(t.result!!.valid)
    }
  }
  @Test fun discontinuousTrackingAndChangedMountAreRejected() {
    val lost=PulseMeasurementTrial("left",120,start,1000)
    lost.observe(start,1000);lost.observe(start,1500)
    assertEquals("POSE_GAP",lost.result!!.reason)
    val tilt=PulseMeasurementTrial("left",120,start,1000)
    tilt.observe(start.copy(pitch=.2f),1100)
    assertEquals("MOUNT_MOVED",tilt.result!!.reason)
  }
  @Test fun rotationRequiresCorrectedCenterToStayNearPivot() {
    for(x in listOf(0f,.06f)) {
      val t=PulseMeasurementTrial("right",120,start,1000)
      t.observe(start,1000);t.acknowledge(true,1100)
      for(ms in 1200L..1900L step 100) t.observe(start.copy(x=x,yaw=.12f),ms)
      assertEquals(x==0f,t.result!!.valid)
    }
  }
  @Test fun failedMeasurementKeepsObservedMotionAndTraceForDiagnosis() {
    val t=PulseMeasurementTrial("back",200,start,1000)
    t.observe(start,1000);t.observe(start.copy(z=-.02f),1100);t.acknowledge(true,1150)
    t.observe(start.copy(z=-.03f),1200);t.fail("MOUNT_CHECK_INVALID")
    val r=t.result!!;assertFalse(r.valid)
    assertEquals(.03f,r.displacementMeters,.00001f)
    assertEquals(.03f,r.peakDisplacementMeters,.00001f)
    assertEquals(1150L,r.ackAtMs)
    assertTrue(r.trace.size>=3);assertEquals(false,r.report()["stoppingDistanceValidated"])
  }
}
