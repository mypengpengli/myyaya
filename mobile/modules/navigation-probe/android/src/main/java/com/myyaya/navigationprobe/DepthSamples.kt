package com.myyaya.navigationprobe

import java.nio.ByteBuffer
import kotlin.math.max

/** No Android dependency: handle real Image plane strides without assuming packed pixels. */
internal object DepthSamples {
  data class Plane(val bytes: ByteBuffer, val rowStride: Int, val pixelStride: Int)
  data class Result(
    val width: Int, val height: Int, val millimeters: IntArray,
    val validRatio: Double, val nearP05Mm: Int?, val medianMm: Int?
  )

  fun read(width: Int, height: Int, depth: Plane, confidence: Plane? = null): Result {
    require(width > 0 && height > 0 && depth.pixelStride >= 2)
    require(depth.rowStride >= (width - 1) * depth.pixelStride + 2)
    if (confidence != null) require(confidence.rowStride >= (width - 1) * confidence.pixelStride + 1 && confidence.pixelStride >= 1)
    val step = max(1, (max(width, height) + 159) / 160)
    val outWidth = (width + step - 1) / step
    val outHeight = (height + step - 1) / step
    val values = IntArray(outWidth * outHeight)
    val valid = ArrayList<Int>()
    val depthBase = depth.bytes.position()
    val confidenceBase = confidence?.bytes?.position() ?: 0
    for (y in 0 until outHeight) for (x in 0 until outWidth) {
      val sx = x * step
      val sy = y * step
      val offset = depthBase + sy * depth.rowStride + sx * depth.pixelStride
      require(offset + 1 < depth.bytes.limit()) { "Depth plane is truncated" }
      val mm = (depth.bytes.get(offset).toInt() and 255) or ((depth.bytes.get(offset + 1).toInt() and 255) shl 8)
      val confident = if (confidence == null) true else {
        val c = confidenceBase + sy * confidence.rowStride + sx * confidence.pixelStride
        require(c < confidence.bytes.limit()) { "Confidence plane is truncated" }
        // Preview/diagnostic threshold only; never a motion authorization.
        (confidence.bytes.get(c).toInt() and 255) >= 77
      }
      if (mm > 0 && confident) {
        values[y * outWidth + x] = mm
        valid.add(mm)
      }
    }
    valid.sort()
    return Result(outWidth, outHeight, values, valid.size.toDouble() / values.size,
      valid.takeIf { it.isNotEmpty() }?.get(((valid.size - 1) * 0.05).toInt()),
      valid.takeIf { it.isNotEmpty() }?.get(valid.size / 2))
  }
}
