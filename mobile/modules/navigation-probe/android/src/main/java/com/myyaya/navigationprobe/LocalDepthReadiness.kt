package com.myyaya.navigationprobe

/** Startup evidence only, not a metric accuracy claim or a motion authorization. */
internal class LocalDepthReadiness {
  data class State(val ready: Boolean=false,val reason: String="WAITING_FOR_RAW_DEPTH",val frames: Int=0,val nearPoints: Int=0) {
    fun report(): Map<String,Any> = mapOf("ready" to ready,"reason" to reason,"stableFrames" to frames,
      "nearRawPoints" to nearPoints,"requiredFrames" to 3,"minimumNearPoints" to 32,"evidenceTtlMs" to 3000)
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
    if (lastGood>0 && now-lastGood>3_000_000_000L) { established=false;goodFrames=0;firstGood=0 }
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
      } else { goodFrames=0;firstGood=0 }
    } else if (!fresh) reason="WAITING_FOR_FRESH_DEPTH"
    return State(established,if (established) "READY" else reason,goodFrames,near)
  }
}
