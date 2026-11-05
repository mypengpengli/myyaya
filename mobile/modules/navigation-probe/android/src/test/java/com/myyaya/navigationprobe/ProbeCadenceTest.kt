package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class ProbeCadenceTest {
  @Test fun mappingCapturesShortFreshWindowsBetweenReports() {
    val cadence=ProbeCadence(true)
    var accepted=0; var reports=0
    // New depth arrives just after each 500ms report, and is valid for 250ms.
    for (now in 0L..1999L step 33) {
      val tick=cadence.poll(now) ?: continue
      if (tick.publish) reports++
      if (now%500 in 50L..300L) accepted++
    }
    assertTrue("Fresh windows must be sampled between UI reports",accepted>=6)
    assertEquals(4,reports)
  }
  @Test fun standaloneProbeRetainsLowFrequencySampling() {
    val cadence=ProbeCadence(false)
    val ticks=(0L..1999L step 10).mapNotNull { cadence.poll(it) }
    assertEquals(4,ticks.size); assertTrue(ticks.all { it.publish })
  }
  @Test fun repeatedCameraFramesDoNotCreateExtraPolls() {
    val cadence=ProbeCadence(true)
    assertNotNull(cadence.poll(10))
    repeat(20) { assertNull(cadence.poll(10)) }
    assertNull(cadence.poll(109)); assertNotNull(cadence.poll(110))
  }
  @Test fun pauseResetAndClockRollbackPublishImmediately() {
    val cadence=ProbeCadence(true)
    assertTrue(cadence.poll(2000)!!.publish)
    assertTrue(cadence.poll(1000)!!.publish)
    cadence.reset(); assertTrue(cadence.poll(1001)!!.publish)
  }
}
