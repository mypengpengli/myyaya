package com.myyaya.navigationprobe

import kotlin.math.abs

/** Operator-confirmed flat area, bounded data collection. Never grants autonomous free space. */
internal class OperatorExploration(initial: Sample) {
  data class Sample(val at: Long,val pose: RoutePose?,val cameraY: Float?,val session: String,
    val connected: Boolean,val revision: Long,val recording: Boolean,val playback: Boolean,val hazard: Boolean,
    val recordingRemainingMs: Long=90_000)
  private val origin=initial
  private var latest=initial
  private var pulseStart: Sample?=null
  private var ackAt=0L
  private var lastAt=initial.at
  private var direction="back"
  private var stepDuration=150
  private val durationMs get()=when(direction) { "back"->450;"back_step"->stepDuration;else->350 }
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
  private fun snapshot(s: Sample,completed: Boolean,why: String): Map<String,Any?> {
    val start=requireNotNull(pulseStart);val a=start.pose!!;val b=s.pose!!
    return mapOf("segment" to segments,"durationMs" to durationMs,"direction" to direction,
      "completed" to completed,"completionReason" to why,"motorStopAcknowledged" to (ackAt>0),
      "lastPoseAtMs" to s.at,"rawPoseDisplacementMeters" to a.distance(b),"rawPoseYawRadians" to wrapYaw(b.yaw-a.yaw),
      "rawCameraYDeltaMeters" to (s.cameraY!!-start.cameraY!!),
      "pitchDeltaRadians" to wrapYaw(b.pitch-a.pitch),"rollDeltaRadians" to wrapYaw(b.roll-a.roll),
      "clearAreaSource" to "operator-confirmed-flat-area","metricNavigationValidated" to false,
      "depthClearanceClaimed" to false,"stopSource" to if(ackAt>0) "timed-pulse-acknowledged" else "stop-request-required")
  }
  @Synchronized fun cancel(why: String) {
    if(moving) result=snapshot(latest,false,why)
    phase="STOPPED";reason=why
  }
  @Synchronized fun observe(s: Sample,now: Long) {
    if(phase in listOf("STOPPED","COMPLETE")) return
    failure(s,now)?.let { cancel(it);return }
    latest=s;lastAt=s.at
    if(phase=="SETTLING" && now-ackAt>=1500) {
      result=snapshot(s,true,"SEGMENT_STOPPED")
      phase=if(segments>=3) "COMPLETE" else "READY";reason="SEGMENT_STOPPED"
    }
  }
  @Synchronized fun issue(now: Long,requestedDirection: String="back",stepMs: Int=150) {
    require(requestedDirection in setOf("back","back_step","left","right")) { "Unsupported field direction" }
    require(stepMs in setOf(150,250) && (requestedDirection=="back_step" || stepMs==150)) { "Invalid bounded step duration" }
    check(phase=="READY" && segments<3) { "请等待上一段停止或重新确认空地" }
    failure(latest,now)?.let { cancel(it);error(it) }
    check(latest.recordingRemainingMs>=2500) { "录像即将结束，请先保存并开始新一轮录像" }
    direction=requestedDirection;stepDuration=stepMs;segments++;pulseStart=latest;ackAt=0;phase="RUNNING";reason="TIMED_PULSE"
  }
  @Synchronized fun acknowledge(ok: Boolean,now: Long) {
    if(phase!="RUNNING") return
    if(!ok) cancel("ACTION_FAILED") else { ackAt=now;phase="SETTLING";reason="WAITING_AFTER_STOP" }
  }
  fun report(): Map<String,Any?> = mapOf("phase" to phase,"reason" to reason,"segments" to segments,"maximumSegments" to 3,
    "durationMs" to durationMs,"direction" to direction,"lastSegment" to result,"mapHeightRequired" to false,"autonomousMotionAuthorized" to false)
}
