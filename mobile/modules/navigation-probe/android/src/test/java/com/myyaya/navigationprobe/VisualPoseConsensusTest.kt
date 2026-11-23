package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class VisualPoseConsensusTest {
  @Test fun acceptsObservedPointCloudPipelineOffsetWithoutAcceptingUnboundedSkew() {
    val frame=10_000_000_000L
    assertTrue(VisualPoseConsensus.acceptsPointCloud(frame,frame+32_000_000L))
    assertTrue(VisualPoseConsensus.acceptsPointCloud(frame,frame-1_500_000_000L))
    assertFalse(VisualPoseConsensus.acceptsPointCloud(frame,frame+101_000_000L))
    assertFalse(VisualPoseConsensus.acceptsPointCloud(frame,frame-2_001_000_000L))
    assertFalse(VisualPoseConsensus.acceptsPointCloud(frame,0))
  }
  private fun p(x: Float)=RigidPose(floatArrayOf(x,0f,0f),floatArrayOf(0f,0f,0f,1f))
  @Test fun needsThreeConsistentFreshObservationsOfSameMap() {
    val c=VisualPoseConsensus()
    assertFalse(c.offer("old",p(0f),1_000_000_000))
    assertFalse(c.offer("new",p(0f),2_000_000_000))
    assertFalse(c.offer("new",p(.01f),3_000_000_000))
    assertFalse(c.offer("new",p(.01f),3_000_000_000))
    assertTrue(c.offer("new",p(.02f),4_000_000_000))
    assertFalse(c.offer("new",p(.5f),5_000_000_000))
    assertFalse(c.offer("new",p(.5f),9_000_000_000))
    c.reset();assertFalse(c.offer("new",p(.5f),10_000_000_000))
  }
  @Test fun pnpConventionConvertsForwardDownToBackwardUp() {
    val pose=VisualPoseConsensus.fromPnP(doubleArrayOf(1.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,-1.0),doubleArrayOf(-1.0,2.0,3.0))
    assertArrayEquals(floatArrayOf(1f,2f,3f),pose.t,.00001f)
    assertArrayEquals(floatArrayOf(1f,3f,2f),pose.point(floatArrayOf(0f,1f,-1f)),.00001f)
  }
  @Test fun visualAlignmentCanRestoreOldMapInNewArSession() {
    val m=RoomMapper(RoomMapData(name="old home",sessionId="old"))
    m.bindSession("new")
    assertFalse(m.observePose("new",p(1f),true))
    assertFalse(m.alignVisual("old",p(1f)))
    assertTrue(m.alignVisual("new",p(1f)))
    assertTrue(m.observePose("new",p(1.2f),true))
    assertEquals(.2f,m.livePosition!![0],.00001f)
    m.bindSession("another")
    assertFalse(m.observePose("another",p(1.2f),true))
  }
}
