package com.myyaya.navigationprobe

import kotlin.math.abs

/** Bounded cross-stream skew; raw freshness and original timestamps stay intact. */
internal object DepthTimeAlignment {
  const val MAX_DENSE_LEAD_NS=5_000_000L
  const val MAX_AGE_NS=250_000_000L
  data class State(val accepted: Boolean,val reason: String,val rawAgeMs: Double?,val denseLeadMs: Double?,val pairSkewMs: Double?) {
    fun report(): Map<String,Any?> = mapOf("accepted" to accepted,"reason" to reason,"rawAgeMs" to rawAgeMs,
      "denseLeadMs" to denseLeadMs,"pairSkewMs" to pairSkewMs,"maxDenseLeadMs" to MAX_DENSE_LEAD_NS/1e6,
      "maxAgeMs" to MAX_AGE_NS/1e6,"timestampsRewritten" to false)
  }
  fun check(raw: Long,dense: Long,frame: Long): State {
    val rawAge=if(raw>0 && frame>0) (frame-raw)/1e6 else null
    val lead=if(dense>0 && frame>0) (dense-frame)/1e6 else null
    val skew=if(raw>0 && dense>0) abs(dense-raw)/1e6 else null
    val reason=when {
      frame<=0 || raw<=0 || dense<=0 -> "MISSING_TIMESTAMP"
      raw>frame -> "RAW_IN_FUTURE"
      dense-frame>MAX_DENSE_LEAD_NS -> "DENSE_CLOCK_AHEAD"
      frame-raw>MAX_AGE_NS || frame-dense>MAX_AGE_NS -> "STALE_PAIR"
      abs(raw-dense)>MAX_AGE_NS -> "PAIR_SKEW"
      dense>frame -> "BOUNDED_DENSE_LEAD"
      else -> "ALIGNED"
    }
    return State(reason=="ALIGNED" || reason=="BOUNDED_DENSE_LEAD",reason,rawAge,lead,skew)
  }
}
