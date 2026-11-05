package com.myyaya.navigationprobe

/** Startup evidence only, not a metric accuracy claim or a motion authorization. */
internal class LocalDepthReadiness {
  data class State(val ready: Boolean=false,val reason: String="WAITING_FOR_RAW_DEPTH",val frames: Int=0,val nearPoints: Int=0,val ageMs: Long?=null) {
    fun report(): Map<String,Any> = mapOf("ready" to ready,"reason" to reason,"stableFrames" to frames,
      "nearRawPoints" to nearPoints,"requiredFrames" to 3,"minimumNearPoints" to 32,
      "nearEvidenceFresh" to (ageMs!=null && ageMs<=3000),"initializedUntilTrackingLost" to true)
  }
  private var lastNow=0L
  private var lastRaw=0L
  private var firstGood=0L
  private var lastGood=0L
  private var goodFrames=0
  private var established=false
  @Synchronized fun reset() {
    lastNow=0;lastRaw=0;firstGood=0;lastGood=0;goodFrames=0;established=false
  }
  @Synchronized fun update(now: Long,rawNs: Long,sample: DepthSamples.Result?,tracking: Boolean): State {
    if (!tracking || now<=0) { reset();return State(reason="TRACKING_LOST") }
    if (now<lastNow) reset()
    lastNow=now
    // Initialization survives a stationary camera. The terrain's separate TTL
    // still expires observations; a depth gap must not prevent selecting a plane.
    if (!established && lastGood>0 && now-lastGood>3_000_000_000L) { goodFrames=0;firstGood=0 }
    val near=sample?.millimeters?.count { it in 200..4000 } ?: 0
    var reason=when {
      sample==null -> "WAITING_FOR_RAW_DEPTH"
      near==0 && sample.millimeters.any { it>0 } -> "RAW_OUT_OF_LOCAL_RANGE"
      near<32 -> "SPARSE_NEAR_DEPTH"
      else -> "WARMING_UP"
    }
    val fresh=rawNs>0 && rawNs<=now && now-rawNs<=250_000_000L
    if (fresh && rawNs>lastRaw) {
      lastRaw=rawNs
      if (near>=32) {
        if (goodFrames==0) firstGood=rawNs
        goodFrames++;lastGood=rawNs
        if (goodFrames>=3 && rawNs-firstGood>=300_000_000L) established=true
      } else if (!established) { goodFrames=0;firstGood=0 }
    } else if (!fresh) reason="WAITING_FOR_FRESH_DEPTH"
    val age=if (lastGood>0) (now-lastGood)/1_000_000L else null
    return State(established,if (established) if (age!=null && age<=3000) "READY" else "INITIALIZED_DEPTH_STALE" else reason,goodFrames,near,age)
  }
}
