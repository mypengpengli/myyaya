package com.superlooi.voskcommand

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Audio follows decoder endpoints. Bounded storage prevents ambient capture from growing. */
internal class ChineseUtteranceAudio(private val capacity: Int = 16000 * 46) {
  private val samples = ShortArray(capacity)
  private var count = 0
  private var overflow = false
  private var energy = 0.0
  fun append(pcm: FloatArray) {
    for (sample in pcm) {
      if (count == capacity) { overflow = true; break }
      val value = sample.toInt().coerceIn(-32768, 32767).toShort()
      samples[count++] = value
      energy += value.toDouble() * value
    }
  }
  fun finish(): ByteArray? {
    val length = count
    val valid = !overflow && length >= 4000 && energy / length > 3600
    val result = if (valid) ByteBuffer.allocate(44 + length * 2).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray()); putInt(36 + length * 2); put("WAVEfmt ".toByteArray())
      putInt(16); putShort(1); putShort(1); putInt(16000); putInt(32000); putShort(2); putShort(16)
      put("data".toByteArray()); putInt(length * 2)
      for (i in 0 until length) putShort(samples[i])
    }.array() else null
    reset()
    return result
  }
  fun reset() { count = 0; energy = 0.0; overflow = false }
}
