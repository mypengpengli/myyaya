package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class DepthTimeAlignmentTest {
  private val now=1_000_000_000L
  @Test fun observedMillisecondLeadIsBoundedAndReported() {
    val s=DepthTimeAlignment.check(now-100_000_000,now+2_000_000,now)
    assertTrue(s.accepted);assertEquals("BOUNDED_DENSE_LEAD",s.reason)
    assertEquals(2.0,s.denseLeadMs!!,0.0);assertEquals(false,s.report()["timestampsRewritten"])
  }
  @Test fun largeLeadAndFutureRawRemainRejected() {
    assertTrue(DepthTimeAlignment.check(now,now+5_000_000,now).accepted)
    assertEquals("DENSE_CLOCK_AHEAD",DepthTimeAlignment.check(now,now+5_000_001,now).reason)
    assertEquals("RAW_IN_FUTURE",DepthTimeAlignment.check(now+1,now,now).reason)
  }
  @Test fun acceptingSmallLeadDoesNotExtendRawAge() {
    assertTrue(DepthTimeAlignment.check(now-248_000_000,now+1_000_000,now).accepted)
    assertEquals("STALE_PAIR",DepthTimeAlignment.check(now-250_000_001,now+1_000_000,now).reason)
    assertEquals("PAIR_SKEW",DepthTimeAlignment.check(now-249_000_000,now+5_000_000,now).reason)
  }
  @Test fun absentOrOldDenseCannotPass() {
    assertFalse(DepthTimeAlignment.check(now,0,now).accepted)
    assertFalse(DepthTimeAlignment.check(now,now-250_000_001,now).accepted)
  }
}
