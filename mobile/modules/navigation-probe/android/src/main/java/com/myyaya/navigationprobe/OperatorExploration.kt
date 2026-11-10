package com.myyaya.navigationprobe

import kotlin.math.abs

/** Operator-confirmed flat area, bounded data collection. Never grants autonomous free space. */
internal class OperatorExploration(initial: Sample) {
  data class Sample(val at: Long,val pose: RoutePose?,val cameraY: Float?,val session: String,
    val connected: Boolean,val revision: Long,val recording: Boolean,val playback: Boolean,val hazard: Boolean)
  private val origin=initial
  private var latest=initial
  private var pulseStart: Sample?=null
  private var ackAt=0L
  private var lastAt=initial.at
  @Volatile var phase="READY";private set
  var reason="OPERATOR_CONFIRMED_AREA";private set
  var segments=0;private set
  @Volatile var result: Map<String,Any?>?=null;private set
  val moving get()=phase in listOf("RUNNING","SETTLING")
  init { require(failure(initial,initial.at)==null) { "需要实时定位、录像及底座连接" } }
  private fun failure(s: Sample,now: Long): String? = when {
    now<s.at || now-s.at>500 || s.at<lastAt->"STALE_CAMERA"
    s.at-origin.at>90_000->"CONFIRMATION_EXPIRED"
    s.playback->"PLAYBACK"
    !s.recording->"RECORDING_STOPPED"
    !s.connected || s.revision!=origin.revision->"CONNECTION_CHANGED"
    s.session!=origin.session->"SESSION_CHANGED"
    s.pose==null || s.cameraY?.isFinite()!=true->"TRACKING_LOST"
    s.hazard->"OBSERVED_HAZARD"
    abs(wrapYaw(s.pose.pitch-origin.pose!!.pitch))>.12f || abs(wrapYaw(s.pose.roll-origin.pose.roll))>.12f->"TILT_CHANGED"
    else->null
  }
  @Synchronized fun cancel(why: String) { phase="STOPPED";reason=why }
  @Synchronized fun observe(s: Sample,now: Long) {
    if(phase in listOf("STOPPED","COMPLETE")) return
    failure(s,now)?.let { cancel(it);return }
    latest=s;lastAt=s.at
    if(phase=="SETTLING" && now-ackAt>=1500) {
      val start=requireNotNull(pulseStart);val a=start.pose!!;val b=s.pose!!
      result=mapOf("segment" to segments,"durationMs" to 450,"direction" to "back",
        "rawPoseDisplacementMeters" to a.distance(b),"rawPoseYawRadians" to wrapYaw(b.yaw-a.yaw),
        "rawCameraYDeltaMeters" to (s.cameraY!!-start.cameraY!!),
        "pitchDeltaRadians" to wrapYaw(b.pitch-a.pitch),"rollDeltaRadians" to wrapYaw(b.roll-a.roll),
        "clearAreaSource" to "operator-confirmed-flat-area","metricNavigationValidated" to false,
        "depthClearanceClaimed" to false,"stopSource" to "timed-pulse-acknowledged")
      phase=if(segments>=3) "COMPLETE" else "READY";reason="SEGMENT_STOPPED"
    }
  }
  @Synchronized fun issue(now: Long) {
    check(phase=="READY" && segments<3) { "请等待上一段停止或重新确认空地" }
    failure(latest,now)?.let { cancel(it);error(it) }
    segments++;pulseStart=latest;phase="RUNNING";reason="TIMED_PULSE"
  }
  @Synchronized fun acknowledge(ok: Boolean,now: Long) {
    if(phase!="RUNNING") return
    if(!ok) cancel("ACTION_FAILED") else { ackAt=now;phase="SETTLING";reason="WAITING_AFTER_STOP" }
  }
  fun report(): Map<String,Any?> = mapOf("phase" to phase,"reason" to reason,"segments" to segments,"maximumSegments" to 3,
    "durationMs" to 450,"lastSegment" to result,"mapHeightRequired" to false,"autonomousMotionAuthorized" to false)
}
