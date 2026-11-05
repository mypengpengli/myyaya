package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class LocalDepthReadinessTest {
  private val good=DepthSamples.Result(8,8,IntArray(64) { 700 },1.0,700,700)
  private val base=1_000_000_000L
  private fun warm(g: LocalDepthReadiness): LocalDepthReadiness.State {
    g.update(base,base,good,true);g.update(base+200_000_000L,base+200_000_000L,good,true)
    return g.update(base+400_000_000L,base+400_000_000L,good,true)
  }
  @Test fun stationaryFullDepthCannotInitializeWithoutRawEvidence() {
    val g=LocalDepthReadiness()
    repeat(20) { assertFalse(g.update(base+it*100_000_000L,0,null,true).ready) }
  }
  @Test fun repeatedAndReprojectedFramesDoNotCompleteWarmup() {
    val g=LocalDepthReadiness()
    repeat(3) { assertFalse(g.update(base+it*100_000_000L,base,good,true).ready) }
    assertFalse(g.update(base+300_000_000L,base,good,true).ready)
  }
  @Test fun independentNearFramesEnableAfterMinimumTimeSpan() {
    val g=LocalDepthReadiness();assertTrue(warm(g).ready)
  }
  @Test fun fifteenMeterAndSparseSamplesDoNotInitialize() {
    for (sample in listOf(good.copy(millimeters=IntArray(64) { 15000 }),good.copy(millimeters=IntArray(64) { if(it<20) 700 else 0 }))) {
      val g=LocalDepthReadiness()
      repeat(5) { val t=base+it*200_000_000L;assertFalse(g.update(t,t,sample,true).ready) }
    }
  }
  @Test fun briefGapsRetainReadinessButExpiredEvidenceRequiresWarmup() {
    val g=LocalDepthReadiness();warm(g)
    assertTrue(g.update(base+600_000_000L,0,null,true).ready)
    assertFalse(g.update(base+3_500_000_000L,0,null,true).ready)
    assertFalse(g.update(base+3_600_000_000L,base+3_600_000_000L,good,true).ready)
  }
  @Test fun trackingLossAndClockRollbackDiscardReadiness() {
    val g=LocalDepthReadiness();warm(g)
    assertFalse(g.update(base+500_000_000L,0,null,false).ready)
    warm(g);assertFalse(g.update(base-1,base-1,good,true).ready)
  }
  @Test fun futureAndExpiredRawFramesCannotInitialize() {
    val g=LocalDepthReadiness()
    repeat(4) { val t=base+it*100_000_000L;assertFalse(g.update(t,t+1,good,true).ready) }
    assertFalse(g.update(base+1_000_000_000L,base,good,true).ready)
  }
}
