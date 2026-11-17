package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.PI

class HomePoseTrackerTest {
  private fun flow(t:Long,dx:Double=0.0,dz:Double=0.0,origin:Long=1L)=mapOf<String,Any?>("sampleTimestampNs" to t,"originTimestampNs" to origin,
    "cumulativePoseAvailable" to true,"originContinuity" to true,"cumulativeCameraDxMeters" to dx,"cumulativeCameraDzMeters" to dz)
  private fun frame(p:HomePoseTracker,t:Long,dx:Double=0.0,dz:Double=0.0,origin:Long=1L,mapped:HomePose?=null,session:String="s") =
    p.frame("map",session,t,0.0,mapped,flow(t,dx,dz,origin),.07,.05)
  @Test fun savedNumericPoseAloneCannotRelocalize() {val p=HomePoseTracker();frame(p,1_000_000_000);assertFalse(p.ready(1_000_000_000));assertNull(p.pose)}
  @Test fun liveMapSeedThenFloorTranslationIgnoresDriftingArTranslation() {
    val p=HomePoseTracker();frame(p,1_000_000_000,mapped=HomePose(5.0,4.0))
    frame(p,1_100_000_000,dz=-.1,mapped=HomePose(20.0,20.0));assertEquals(4.1,p.pose!!.y,.0001)
  }
  @Test fun rotatedMapUsesGravityAlignedFloorFlow() {
    val p=HomePoseTracker();frame(p,1_000_000_000,mapped=HomePose(5.0,4.0,PI/2))
    frame(p,1_100_000_000,dz=-.1);assertEquals(5.1,p.pose!!.x,.0001);assertEquals(4.0,p.pose!!.y,.0001)
  }
  @Test fun expectedStartResetPreservesHomePosition() {
    val p=HomePoseTracker();frame(p,1_000_000_000,mapped=HomePose(5.0,4.0));val revision=p.revision
    p.expectFlowReset();frame(p,1_100_000_000,dx=2.0,origin=2)
    assertEquals(5.0,p.pose!!.x,.0001);assertEquals(revision,p.revision)
  }
  @Test fun unexpectedResetCannotBridgeUnlocatedCoordinates() {
    val p=HomePoseTracker();frame(p,1_000_000_000,mapped=HomePose(0.0,0.0));frame(p,1_100_000_000,origin=2)
    assertFalse(p.ready(1_100_000_000))
  }
  @Test fun restartAndStaleFramesRequireFreshAlignment() {
    val p=HomePoseTracker();frame(p,1_000_000_000,mapped=HomePose(0.0,0.0));assertFalse(p.ready(2_000_000_000))
    frame(p,2_100_000_000,session="new");assertNull(p.pose);assertFalse(p.ready(2_100_000_000))
  }
}
