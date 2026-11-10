package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class DepthPairDiagnosticTest {
  private val sample=DepthSamples.Result(2,2,intArrayOf(0,300,12000,450),.75,300,450)
  @Suppress("UNCHECKED_CAST") private fun input(report: Map<String,Any?>,key: String)=report[key] as Map<String,Any?>
  @Test fun unreadyRawStillReportsIndependentSmoothObservations() {
    val r=DepthPairDiagnostic.report(2_000_000_000,1_900_000_000,1_950_000_000,null,sample,false,"WAITING_FOR_RAW_DEPTH")
    assertFalse(input(r,"raw")["available"] as Boolean)
    assertEquals(2,input(r,"smooth")["nearPixels"])
    assertEquals(3,input(r,"smooth")["validPixels"])
    assertEquals(450,input(r,"smooth")["medianMm"])
    assertEquals(false,r["navigationEvidenceEnabled"]);assertEquals(false,r["autonomousMotionAuthorized"])
  }
  @Test fun farRawAndEmptyRawAreNotReportedAsUsefulLocalDepth() {
    val far=sample.copy(millimeters=intArrayOf(0,0,12000,13000),medianMm=13000)
    val r=DepthPairDiagnostic.report(2_000_000_000,1_900_000_000,0,far,null,false,"RAW_OUT_OF_LOCAL_RANGE")
    assertEquals(0,input(r,"raw")["nearPixels"])
    assertEquals(13000,input(r,"raw")["medianMm"])
    val empty=sample.copy(millimeters=IntArray(4),medianMm=null)
    assertNull(input(DepthPairDiagnostic.report(2_000_000_000,1_900_000_000,0,empty,null,false,"SPARSE_NEAR_DEPTH"),"raw")["medianMm"])
  }
  @Test fun staleFutureAndMissingTimestampsRemainVisibleAndNotFresh() {
    for(t in listOf(0L,1_000_000_000L,2_010_000_000L)) {
      val r=DepthPairDiagnostic.report(2_000_000_000,t,t,sample,sample,false,"WAITING_FOR_FRESH_DEPTH")
      assertEquals(false,input(r,"raw")["fresh"])
      assertEquals(true,input(r,"raw")["available"])
    }
  }
  @Test fun recorderBudgetDoesNotRequireFreshRawButStillCapsWrites() {
    val schedule=DepthCaptureSchedule(3)
    assertFalse(schedule.accept(0))
    assertTrue(schedule.accept(1_000_000_000))
    assertFalse(schedule.accept(1_100_000_000))
    assertFalse(schedule.accept(900_000_000))
    assertTrue(schedule.accept(1_250_000_000))
    assertTrue(schedule.accept(1_500_000_000))
    assertFalse(schedule.accept(1_750_000_000))
  }
}
