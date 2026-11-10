package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class FloorFlowTrackChainTest {
  private fun step(x: Double=0.0,z: Double=-.03)=FloorFlowGeometry.Estimate(x,z,1.0,0.0,30,1.0,.001)
  @Test fun validRollingLinksPreserveOneOriginAndAccumulateInCommonWorldBasis() {
    val chain=FloorFlowTrackChain();chain.seed(100)
    assertTrue(chain.accept(100,200,step()))
    assertTrue(chain.accept(200,300,step(.01,-.02)))
    assertEquals(100L,chain.originNs);assertEquals(300L,chain.keyframeNs)
    assertEquals(.01,chain.dx,1e-9);assertEquals(-.05,chain.dz,1e-9)
    assertEquals(true,chain.report(true)["cumulativePoseAvailable"])
  }
  @Test fun unlinkedReseedDoesNotMakeOldOriginAvailableOrPublishZero() {
    val chain=FloorFlowTrackChain();chain.seed(100);chain.accept(100,200,step());chain.seed(500)
    assertTrue(chain.accept(500,600,step(0.0,-.02)))
    val report=chain.report(true)
    assertFalse(chain.continuous);assertEquals(100L,chain.originNs);assertEquals(2,chain.segments)
    assertNull(report["cumulativeCameraDxMeters"]);assertNull(report["cumulativeCameraDzMeters"])
    assertEquals(false,report["cumulativePoseAvailable"]);assertEquals(-.02,report["segmentDzMeters"] as Double,1e-9)
  }
  @Test fun rejectedSampleKeepsCheckpointForALaterDirectLink() {
    val chain=FloorFlowTrackChain();chain.seed(100)
    assertEquals(false,chain.report(false)["cumulativePoseAvailable"])
    assertEquals(100L,chain.keyframeNs)
    assertTrue(chain.accept(100,400,step(0.0,-.05)))
    assertEquals(-.05,chain.dz,1e-9);assertEquals(1,chain.links)
  }
  @Test fun duplicateWrongReferenceAndInvalidDeltaNeverAccumulate() {
    val chain=FloorFlowTrackChain();chain.seed(100)
    assertFalse(chain.accept(99,200,step()));assertFalse(chain.accept(100,100,step()))
    assertFalse(chain.accept(100,200,step(Double.NaN)))
    assertTrue(chain.accept(100,200,step()));assertFalse(chain.accept(100,200,step()))
    assertEquals(-.03,chain.dz,1e-9);assertEquals(1,chain.links)
  }
  @Test fun onlyExplicitResetCanCreateANewIndependentOriginAfterLoss() {
    val chain=FloorFlowTrackChain();chain.seed(100);chain.seed(200);assertFalse(chain.continuous)
    chain.reset();chain.seed(500);assertTrue(chain.accept(500,600,step()))
    assertTrue(chain.continuous);assertEquals(500L,chain.originNs);assertEquals(-.03,chain.dz,1e-9)
  }
}
