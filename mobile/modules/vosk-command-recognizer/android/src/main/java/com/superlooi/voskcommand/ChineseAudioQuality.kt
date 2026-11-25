package com.superlooi.voskcommand

import kotlin.math.*

internal object ChineseAudioQuality {
  /** Level contrast is an estimate, not a measured microphone/room SNR. */
  fun summarize(samples: ShortArray): Map<String,Double> {
    if(samples.isEmpty())return mapOf("noiseDbfs" to -96.0,"levelContrastDb" to 0.0)
    val powers=samples.toList().chunked(320).map {block->max(1.0,block.sumOf {it.toDouble()*it}/block.size)}.sorted()
    val noise=powers[(powers.lastIndex*.2).toInt()];val loud=powers[(powers.lastIndex*.9).toInt()]
    return mapOf("noiseDbfs" to (10*log10(noise/(32768.0*32768))).coerceAtLeast(-96.0),
      "levelContrastDb" to (10*log10(loud/noise)).coerceIn(0.0,96.0))
  }
}
