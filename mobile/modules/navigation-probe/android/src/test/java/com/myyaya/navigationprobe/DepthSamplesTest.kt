package com.myyaya.navigationprobe

import java.nio.ByteBuffer
import org.junit.Assert.*
import org.junit.Test

class DepthSamplesTest {
  private fun packed(vararg values: Int) = ByteBuffer.allocate(values.size * 2).apply {
    for (value in values) { put((value and 255).toByte()); put((value shr 8).toByte()) }
    flip()
  }

  @Test fun invalidAndLowConfidencePixelsRemainUnknown() {
    val result = DepthSamples.read(4, 1,
      DepthSamples.Plane(packed(0, 1000, 2000, 3000), 8, 2),
      DepthSamples.Plane(ByteBuffer.wrap(byteArrayOf(-1, 0, 76, 77)), 4, 1))
    assertArrayEquals(intArrayOf(0, 0, 0, 3000), result.millimeters)
    assertEquals(0.25, result.validRatio, 0.0001)
    assertEquals(3000, result.medianMm)
  }

  @Test fun paddedPlanesAndBufferOffsetsAreRespected() {
    val depth = ByteBuffer.allocate(24).apply {
      position(3)
      put(3, 0xe8.toByte()); put(4, 3)
      put(7, 0xd0.toByte()); put(8, 7)
      put(15, 0xb8.toByte()); put(16, 11)
      put(19, 0xa0.toByte()); put(20, 15)
    }
    val confidence = ByteBuffer.allocate(14).apply {
      position(1)
      for (offset in listOf(1, 3, 7, 9)) put(offset, -1)
    }
    val result = DepthSamples.read(2, 2, DepthSamples.Plane(depth, 12, 4), DepthSamples.Plane(confidence, 6, 2))
    assertArrayEquals(intArrayOf(1000, 2000, 3000, 4000), result.millimeters)
    assertEquals(3, depth.position())
    assertEquals(1, confidence.position())
  }

  @Test fun depthIsUnsignedLittleEndianEvenAboveSignedShortRange() {
    val result = DepthSamples.read(2, 1, DepthSamples.Plane(packed(40000, 65535), 4, 2))
    assertArrayEquals(intArrayOf(40000, 65535), result.millimeters)
  }

  @Test fun noValidDataDoesNotInventDistanceOrFreeSpace() {
    val result = DepthSamples.read(2, 1, DepthSamples.Plane(packed(0, 0), 4, 2))
    assertEquals(0.0, result.validRatio, 0.0)
    assertNull(result.nearP05Mm)
    assertNull(result.medianMm)
  }

  @Test fun previewDownsamplingRemainsBoundedForLargeImages() {
    val depth = ByteBuffer.allocate(640 * 480 * 2)
    val result = DepthSamples.read(640, 480, DepthSamples.Plane(depth, 1280, 2))
    assertEquals(160, result.width)
    assertEquals(120, result.height)
    assertEquals(19200, result.millimeters.size)
  }

  @Test(expected = IllegalArgumentException::class) fun truncatedDepthIsRejected() {
    DepthSamples.read(2, 1, DepthSamples.Plane(packed(1000), 4, 2))
  }

  @Test(expected = IllegalArgumentException::class) fun truncatedConfidenceIsRejected() {
    DepthSamples.read(2, 1, DepthSamples.Plane(packed(1000, 2000), 4, 2),
      DepthSamples.Plane(ByteBuffer.wrap(byteArrayOf(-1)), 2, 1))
  }

  @Test(expected = IllegalArgumentException::class) fun impossibleStrideIsRejected() {
    DepthSamples.read(2, 1, DepthSamples.Plane(packed(1000, 2000), 2, 2))
  }
}
