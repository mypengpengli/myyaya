package com.myyaya.headpulse

/** No Android/JS timers here: the owner supplies a native scheduler and a single FED1 writer. */
class HeadPulseController(
  private val clock: () -> Long,
  private val schedule: (Long, () -> Unit) -> (() -> Unit),
  private val write: (ByteArray, (Boolean) -> Unit) -> Unit
) {
  private var generation = 0
  private var active = false
  private var startAck = false
  private var stopAck = true
  private var stopSent = false
  private var reason = "idle"
  private var startedAt = 0L
  private var stopAt: Long? = null
  private var finishedAt: Long? = null
  private var speed = 0
  private var duration = 0
  private var cancelStop: (() -> Unit)? = null
  private var cancelDeadline: (() -> Unit)? = null
  private var completion: ((Map<String, Any?>) -> Unit)? = null

  @Synchronized fun canStart() = !active && stopAck
  @Synchronized fun start(signedSpeed: Int, durationMs: Int, complete: (Map<String, Any?>) -> Unit) {
    require(signedSpeed in -50..-20 || signedSpeed in 20..50) { "头部速度超出联调范围" }
    require(durationMs in 100..500) { "头部脉冲限100至500毫秒" }
    check(canStart()) { "头部仍在执行或停止尚未确认" }
    val token = ++generation
    active = true; startAck = false; stopAck = false; stopSent = false
    reason = "running"; startedAt = clock(); stopAt = null; finishedAt = null
    speed = signedSpeed; duration = durationMs; completion = complete
    cancelStop = schedule(durationMs.toLong()) { stop("duration") }
    cancelDeadline = schedule(durationMs + 1500L) {
      synchronized(this) { if (active && token == generation) { reason = "stop-unconfirmed"; finish() } }
    }
    try {
      write(byteArrayOf(0, signedSpeed.toByte())) { ok ->
        synchronized(this) {
          if (token != generation || !active) return@write
          startAck = ok
          if (!ok) stop("start-write-failed")
        }
      }
    } catch (_: Exception) { stop("start-write-failed") }
  }

  @Synchronized fun stop(cause: String) {
    if ((!active && stopAck) || stopSent && active) return
    val token = generation
    stopSent = true; reason = cause; stopAt = clock(); cancelStop?.invoke()
    try {
      write(byteArrayOf(0, 0)) { ok ->
        synchronized(this) {
          if (token != generation) return@write
          stopAck = ok
          if (ok) { if (active) finish() else reason = "recovery-stop-confirmed" }
          else if (active) { reason = "stop-write-failed"; finish() }
        }
      }
    } catch (_: Exception) { if (active) { reason = "stop-write-failed"; finish() } }
  }

  private fun finish() {
    active = false; finishedAt = clock(); cancelStop?.invoke(); cancelDeadline?.invoke()
    val callback = completion; completion = null; callback?.invoke(snapshot())
  }

  @Synchronized fun snapshot(): Map<String, Any?> = mapOf(
    "active" to active, "startAcknowledged" to startAck, "stopAcknowledged" to stopAck,
    "reason" to reason, "signedSpeed" to speed, "requestedDurationMs" to duration,
    "startedAtMs" to startedAt, "stopRequestedAtMs" to stopAt, "finishedAtMs" to finishedAt,
    "physicalPosition" to "unknown", "nativeWatchdog" to true
  )
}
