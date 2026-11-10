package com.myyaya.navigationprobe

import kotlin.math.abs

/** Flat-floor mounting check. Confirming a pose never sends a head command. */
internal class NavigationPoseLock {
  private var readyAt=0L
  private var stableAt=0L
  private var candidate: RoutePose?=null
  private var candidateHeight=0f
  @Volatile private var locked: RoutePose?=null
  private var lockedHeight=0f
  private var boundConnection: Long?=null
  @Volatile private var diagnostics: Map<String,Any?> = mapOf("state" to "WAITING")
  @Volatile var reason="请将脖子降到最低并确认后摄平视，再保持当前姿态";private set
  val isLocked get()=locked!=null
  @Synchronized fun reset() { readyAt=0;stableAt=0;candidate=null;locked=null;boundConnection=null;diagnostics=mapOf("state" to "WAITING") }
  fun report()=diagnostics
  @Synchronized fun begin(now: Long,connectionRevision: Long=0) { reset();boundConnection=connectionRevision;readyAt=now+800;reason="保持当前最低姿态，等待稳定；不会自动回正或抬头" }
  @Synchronized fun observe(pose: RoutePose?,height: Float?,now: Long,connected: Boolean=true,connectionRevision: Long=0): Boolean {
    if(boundConnection?.let { !connected || it!=connectionRevision }==true) {
      reset();diagnostics=mapOf("state" to "CONNECTION_CHANGED","connectionRevision" to connectionRevision)
      reason="底座断连或重连后可能抬头，请手动压回最低，再选择保持当前位置"
      return false
    }
    if (pose==null || height==null || !height.isFinite()) { diagnostics=mapOf("state" to "TRACKING_MISSING");return false }
    locked?.let {
      val pitch=wrapYaw(pose.pitch-it.pitch);val roll=wrapYaw(pose.roll-it.roll);val dy=height-lockedHeight
      val state=if(abs(pitch)>.12f || abs(roll)>.12f) "TILT_CHANGED" else if(abs(dy)>.025f) "MAP_HEIGHT_CHANGED" else "LOCKED"
      val check=mapOf("state" to state,"mapCameraY" to height,"lockedMapCameraY" to lockedHeight,
        "heightDeltaMeters" to dy,"pitchDeltaRadians" to pitch,"rollDeltaRadians" to roll,
        "heightLimitMeters" to .025f,"tiltLimitRadians" to .12f)
      if(state!="LOCKED") {
        reset();diagnostics=check
        reason=if(state=="MAP_HEIGHT_CHANGED") "地图中的相机高度变化，请核对定位与最低脖子姿态后重新确认" else "相机倾斜变化，请核对定位与固定安装后重新确认"
        return false
      }
      diagnostics=check
      return true
    }
    if (readyAt==0L || now<readyAt) return false
    val old=candidate
    if(old==null || abs(wrapYaw(pose.pitch-old.pitch))>.025f || abs(wrapYaw(pose.roll-old.roll))>.025f || abs(height-candidateHeight)>.005f) {
      candidate=pose;candidateHeight=height;stableAt=now;return false
    }
    if(now-stableAt<600) return false
    locked=pose;lockedHeight=height;readyAt=0;diagnostics=mapOf("state" to "LOCKED","mapCameraY" to height,"lockedMapCameraY" to height)
    reason="当前导航姿态已固定，不自动回正或抬头";return true
  }
}
