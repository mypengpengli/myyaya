package com.myyaya.navigationprobe

/** Acquire short-lived raw depth more often than we publish UI/log snapshots. */
internal class ProbeCadence(private val mapping: Boolean) {
  data class Tick(val publish: Boolean)
  val sampleIntervalMs get() = if (mapping) 100L else 500L
  val reportIntervalMs = 500L
  private var sampledAt = -1L
  private var reportedAt = -1L
  fun reset() { sampledAt = -1; reportedAt = -1 }
  fun poll(now: Long): Tick? {
    require(now >= 0)
    if (now < sampledAt) reset()
    if (sampledAt >= 0 && now - sampledAt < sampleIntervalMs) return null
    sampledAt = now
    val publish = reportedAt < 0 || now - reportedAt >= reportIntervalMs
    if (publish) reportedAt = now
    return Tick(publish)
  }
}
