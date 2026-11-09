package com.myyaya.navigationprobe

/** Unrotated CPU-image region. A user selection is a floor hypothesis, never free-space evidence. */
internal data class FloorFlowRegion(val left: Float=.05f,val top: Float=.67f,val right: Float=.88f,val bottom: Float=.95f) {
  init {
    require(listOf(left,top,right,bottom).all { it.isFinite() && it in 0f..1f })
    require(right-left>=.1f && bottom-top>=.08f)
  }
  fun corners(width: Int,height: Int)=floatArrayOf(left*width,top*height,right*width,top*height,
    right*width,bottom*height,left*width,bottom*height)
  fun report()=mapOf("left" to left,"top" to top,"right" to right,"bottom" to bottom,
    "coordinateFrame" to "unrotated-cpu-image-normalized","floorVerified" to false)
  companion object { val LOWER_CENTER=FloorFlowRegion(.3f,.8f,.88f,.95f) }
}
