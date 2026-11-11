package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class OperatorExplorationTest {
  private fun sample(at: Long=1000,y: Float=0f)=OperatorExploration.Sample(at,RoutePose(0f,0f,0f),y,"session",true,1,true,false,false)
  @Test fun mapHeightDriftIsRecordedWithoutPretendingItIsPhysicalTilt() {
    val f=OperatorExploration(sample());f.issue(1000);f.acknowledge(true,1450)
    for(t in 1500L..3000L step 100) f.observe(sample(t,-.04f),t)
    assertEquals("READY",f.phase);assertEquals(-.04f,f.result!!["rawCameraYDeltaMeters"])
    assertEquals(false,f.result!!["metricNavigationValidated"]);assertEquals(false,f.result!!["depthClearanceClaimed"])
  }
  @Test fun eachSegmentRequiresExplicitIssueAndBudgetEndsAtThree() {
    val f=OperatorExploration(sample())
    repeat(3) { i ->
      val t=1000L+i*2000;f.observe(sample(t),t);f.issue(t);f.acknowledge(true,t+450)
      for(j in 500L..2000L step 100) f.observe(sample(t+j),t+j)
      assertEquals(i+1,f.segments)
    }
    assertEquals("COMPLETE",f.phase)
    try { f.issue(8000);fail() } catch(_:IllegalStateException) {}
  }
  @Test fun tiltDisconnectHazardTrackingAndRecordingStillStop() {
    val bad=listOf(sample(1100).copy(pose=RoutePose(0f,0f,0f,.2f)),sample(1100).copy(connected=false),
      sample(1100).copy(revision=2),sample(1100).copy(hazard=true),sample(1100).copy(pose=null),
      sample(1100).copy(recording=false),sample(1100).copy(playback=true),sample(1100).copy(session="new"))
    for(s in bad) { val f=OperatorExploration(sample());f.issue(1000);f.observe(s,1100);assertEquals("STOPPED",f.phase) }
  }
  @Test fun staleSampleCannotStartAndNoNextSegmentWhileMoving() {
    val f=OperatorExploration(sample());try { f.issue(1600);fail() } catch(_:IllegalStateException) {}
    assertEquals("STOPPED",f.phase)
    val g=OperatorExploration(sample());g.issue(1000)
    try { g.issue(1001);fail() } catch(_:IllegalStateException) {}
    assertEquals(1,g.segments)
  }
  @Test fun failedAcknowledgementDoesNotReportMovementSuccess() {
    val f=OperatorExploration(sample());f.issue(1000);f.acknowledge(false,1200)
    assertEquals("STOPPED",f.phase);assertEquals(false,f.result!!["completed"])
    assertEquals(false,f.result!!["motorStopAcknowledged"])
  }
  @Test fun insufficientRecordingTimeNeverIssuesNextPulse() {
    val f=OperatorExploration(sample().copy(recordingRemainingMs=2000))
    try { f.issue(1000);fail() } catch(_:IllegalStateException) {}
    assertEquals(0,f.segments);assertFalse(f.moving)
  }
  @Test fun recordingExpiryAfterAcknowledgementRetainsPartialCurrentSegment() {
    val f=OperatorExploration(sample());f.issue(1000);f.acknowledge(true,1450)
    f.observe(sample(2000).copy(pose=RoutePose(0f,-.065f,0f)),2000)
    f.observe(sample(2100).copy(recording=false),2100)
    assertEquals("STOPPED",f.phase);assertEquals(1,f.result!!["segment"])
    assertEquals(false,f.result!!["completed"]);assertEquals(true,f.result!!["motorStopAcknowledged"])
    assertEquals(.065f,f.result!!["rawPoseDisplacementMeters"])
    assertEquals("RECORDING_STOPPED",f.result!!["completionReason"])
  }
  @Test fun turnCaptureUsesBoundedTurnDurationAndRetainsDirection() {
    for(direction in listOf("left","right")) {
      val f=OperatorExploration(sample());f.issue(1000,direction);f.acknowledge(true,1350)
      for(t in 1400L..3000L step 100) f.observe(sample(t),t)
      assertEquals(direction,f.result!!["direction"]);assertEquals(350,f.result!!["durationMs"])
    }
  }
  @Test fun unsupportedDirectionNeverConsumesBudget() {
    val f=OperatorExploration(sample());try { f.issue(1000,"forward");fail() } catch(_:IllegalArgumentException) {}
    assertEquals(0,f.segments);assertFalse(f.moving)
  }
  @Test fun nearObservationStepUsesShortBoundedPulse() {
    val f=OperatorExploration(sample());f.issue(1000,"back_step");f.acknowledge(true,1150)
    for(t in 1200L..2800L step 100) f.observe(sample(t),t)
    assertEquals(150,f.result!!["durationMs"]);assertEquals("back_step",f.result!!["direction"])
  }
}
