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
  @Volatile var reason="请将脖子降到最低并确认后摄平视，再保持当前姿态";private set
  val isLocked get()=locked!=null
  @Synchronized fun reset() { readyAt=0;stableAt=0;candidate=null;locked=null }
  @Synchronized fun begin(now: Long) { reset();readyAt=now+800;reason="保持当前最低姿态，等待稳定；不会自动回正或抬头" }
  @Synchronized fun observe(pose: RoutePose?,height: Float?,now: Long): Boolean {
    if (pose==null || height==null || !height.isFinite()) return false
    locked?.let {
      if(abs(wrapYaw(pose.pitch-it.pitch))>.12f || abs(wrapYaw(pose.roll-it.roll))>.12f || abs(height-lockedHeight)>.025f) {
        reset();reason="脖子高度或俯仰已改变，请重新确认最低导航姿态";return false
      }
      return true
    }
    if (readyAt==0L || now<readyAt) return false
    val old=candidate
    if(old==null || abs(wrapYaw(pose.pitch-old.pitch))>.025f || abs(wrapYaw(pose.roll-old.roll))>.025f || abs(height-candidateHeight)>.005f) {
      candidate=pose;candidateHeight=height;stableAt=now;return false
    }
    if(now-stableAt<600) return false
    locked=pose;lockedHeight=height;readyAt=0;reason="当前导航姿态已固定，不自动回正或抬头";return true
  }
}
