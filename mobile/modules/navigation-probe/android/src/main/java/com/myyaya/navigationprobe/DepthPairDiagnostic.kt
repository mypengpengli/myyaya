package com.myyaya.navigationprobe

/** Observe both inputs even during initialization. This report is never navigation evidence. */
internal object DepthPairDiagnostic {
  fun report(now: Long,rawNs: Long,denseNs: Long,raw: DepthSamples.Result?,dense: DepthSamples.Result?,
    navigationReady: Boolean,readinessReason: String): Map<String,Any?> {
    fun input(sample: DepthSamples.Result?,timestamp: Long): Map<String,Any?> {
      val values=sample?.millimeters
      return mapOf("available" to (sample!=null),"timestampNs" to timestamp,
        "ageMs" to if(timestamp>0) (now-timestamp)/1_000_000.0 else null,
        "fresh" to (timestamp>0 && timestamp<=now && now-timestamp<=250_000_000L),
        "pixels" to (values?.size ?: 0),"validPixels" to (values?.count { it>0 } ?: 0),
        "nearPixels" to (values?.count { it in 200..4000 } ?: 0),"medianMm" to sample?.medianMm)
    }
    return mapOf("raw" to input(raw,rawNs),"smooth" to input(dense,denseNs),
      "readinessReason" to readinessReason,"navigationEvidenceEnabled" to navigationReady,
      "diagnosticOnly" to true,"autonomousMotionAuthorized" to false)
  }
}

/** Limits local writes by frame time, independently of raw-depth freshness or availability. */
internal class DepthCaptureSchedule(private val limit: Int) {
  private var lastNs=0L
  private var scheduled=0
  init { require(limit in 1..360) }
  @Synchronized fun accept(now: Long): Boolean {
    if(now<=0 || scheduled>=limit || lastNs>0 && now-lastNs<250_000_000L) return false
    lastNs=now;scheduled++;return true
  }
}
