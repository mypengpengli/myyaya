package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class VisualPulseGuardTest {
  private val a=VisualPulseGuard.Sample(1_000_000_000,1_500_000_000,0.0,0.0)
  @Test fun stopsBeforeMeasuredImageDisplacementReachesTheBound() {
    val g=VisualPulseGuard(a,.05)
    assertNull(g.check(a.copy(z=-.03),1_600_000_000))
    assertEquals("VISUAL_STEP_DISTANCE_LIMIT",g.check(a.copy(z=-.046),1_600_000_000))
  }
  @Test fun staleOrDisconnectedVisualOriginCannotKeepDriving() {
    val g=VisualPulseGuard(a,.03)
    assertEquals("VISUAL_MOTION_STALE",g.check(a,2_000_000_000))
    assertEquals("VISUAL_MOTION_UNAVAILABLE",g.check(a.copy(originNs=2),1_600_000_000))
    assertEquals("VISUAL_MOTION_UNAVAILABLE",g.check(null,1_600_000_000))
  }
  @Test fun rejectsNonFiniteMotionAndFutureSamplesOutsideCameraTolerance() {
    val g=VisualPulseGuard(a,.05)
    assertEquals("VISUAL_MOTION_UNAVAILABLE",g.check(a.copy(x=Double.NaN),1_600_000_000))
    assertEquals("VISUAL_MOTION_STALE",g.check(a.copy(sampledNs=2_000_000_000),1_600_000_000))
  }
}
