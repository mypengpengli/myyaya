package com.myyaya.navigationprobe

/** Copy padded/interleaved camera planes into NV21; never assume packed YUV. */
internal object Yuv420Pack {
  data class Plane(val bytes: ByteArray,val rowStride: Int,val pixelStride: Int)
  fun nv21(width: Int,height: Int,y: Plane,u: Plane,v: Plane): ByteArray {
    require(width in 2..4096 && height in 2..4096 && width%2==0 && height%2==0)
    fun read(p: Plane,x: Int,row: Int): Byte {
      require(p.rowStride>0 && p.pixelStride>0)
      val index=row*p.rowStride+x*p.pixelStride
      require(index in p.bytes.indices) { "Camera plane is truncated" }
      return p.bytes[index]
    }
    val out=ByteArray(width*height*3/2);var index=0
    for(row in 0 until height) for(x in 0 until width) out[index++]=read(y,x,row)
    for(row in 0 until height/2) for(x in 0 until width/2) {
      out[index++]=read(v,x,row);out[index++]=read(u,x,row)
    }
    return out
  }
}
