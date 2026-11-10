package com.myyaya.navigationprobe

import kotlin.math.*

internal data class PulseMeasurement(val valid: Boolean,val reason: String,val direction: String,val durationMs: Int,
  val displacementMeters: Float=0f,val alongViewMeters: Float=0f,val yawRadians: Float=0f,
  val peakDisplacementMeters: Float=0f,val postAckResidualMeters: Float=0f,val samples: Int=0,
  val ackAtMs: Long?=null,val trace: List<Map<String,Any?>> = emptyList()) {
  fun report(): Map<String,Any?> = mapOf("valid" to valid,"reason" to reason,"direction" to direction,"durationMs" to durationMs,
    "displacementMeters" to displacementMeters,"alongViewMeters" to alongViewMeters,"yawRadians" to yawRadians,
    "peakDisplacementMeters" to peakDisplacementMeters,"postAckResidualMeters" to postAckResidualMeters,
    "samples" to samples,"ackAtMs" to ackAtMs,"trace" to trace,"traceClock" to "elapsedRealtime",
    "stoppingDistanceValidated" to false,"autonomousMotionAuthorized" to false)
}

/** Observe an already-authorized calibration pulse. No BLE or Android dependencies.
 * Post-ACK motion is measured separately: a delayed ACK is NOT a physical stop
 * timestamp and its residual cannot be called a certified stopping distance.
 */
internal class PulseMeasurementTrial(val direction: String,val durationMs: Int,val before: RoutePose,val startedMs: Long) {
  private data class Sample(val pose: RoutePose,val atMs: Long)
  private val samples=ArrayList<Sample>()
  private var ackMs: Long?=null
  private var ackPose: RoutePose?=null
  var result: PulseMeasurement?=null;private set
  init { require(direction in listOf("back","left","right") && (durationMs in 1..250 || direction=="back" && durationMs==450 || direction in listOf("left","right") && durationMs==350)) }
  fun acknowledge(ok: Boolean,atMs: Long) {
    if(result!=null || ackMs!=null) return
    if(!ok || atMs<startedMs) { fail("ACTION_FAILED");return }
    ackMs=atMs;ackPose=samples.lastOrNull()?.pose ?: before
  }
  private fun measured(valid: Boolean,reason: String,pose: RoutePose): PulseMeasurement {
    val distance=before.distance(pose)
    val along=(pose.x-before.x)*sin(before.yaw)-(pose.z-before.z)*cos(before.yaw)
    val yaw=wrapYaw(pose.yaw-before.yaw);val anchor=ackPose ?: before;val ack=ackMs
    val trace=(listOf(Sample(before,startedMs))+samples.takeLast(64)).map {
      mapOf<String,Any?>("atMs" to it.atMs,"x" to it.pose.x,"z" to it.pose.z,"yaw" to it.pose.yaw,"pitch" to it.pose.pitch,"roll" to it.pose.roll)
    }
    return PulseMeasurement(valid,reason,direction,durationMs,distance,along,yaw,
      samples.maxOfOrNull { before.distance(it.pose) } ?: 0f,
      if(ack!=null) samples.filter { it.atMs>=ack }.maxOfOrNull { anchor.distance(it.pose) } ?: 0f else 0f,
      samples.size,ack,trace)
  }
  fun fail(reason: String) { if(result==null) result=measured(false,reason,samples.lastOrNull()?.pose ?: before) }
  fun observe(pose: RoutePose?,atMs: Long) {
    if(result!=null) return
    if(pose==null) { fail("LOCALIZATION_LOST");return }
    val last=samples.lastOrNull()
    if(atMs<startedMs || last!=null && atMs<last.atMs) { fail("CLOCK_RESET");return }
    if(last!=null && atMs==last.atMs) return
    if(last!=null && atMs-last.atMs>400) { fail("POSE_GAP");return }
    if(abs(wrapYaw(pose.pitch-before.pitch))>.12f || abs(wrapYaw(pose.roll-before.roll))>.12f) { fail("MOUNT_MOVED");return }
    if(before.distance(pose)>.2f || abs(wrapYaw(pose.yaw-before.yaw))>.8f) { fail("POSE_OR_MOTION_JUMP");return }
    samples.add(Sample(pose,atMs))
    val ack=ackMs
    if(ack==null) { if(atMs-startedMs>4500) fail("ACK_TIMEOUT");return }
    if(atMs-ack>2200) { fail("NOT_SETTLED");return }
    val stable=samples.filter { it.atMs>=ack+400 && atMs-it.atMs<=350 }
    if(stable.size<3 || stable.last().atMs-stable.first().atMs<250 || stable.any {
      it.pose.distance(pose)>.003f || abs(wrapYaw(it.pose.yaw-pose.yaw))>.015f }) return
    val distance=before.distance(pose)
    val along=(pose.x-before.x)*sin(before.yaw)-(pose.z-before.z)*cos(before.yaw)
    val yaw=wrapYaw(pose.yaw-before.yaw)
    val valid=if(direction=="back") distance in .008f.. .12f && along>distance*.7f && abs(yaw)<.15f
      else abs(yaw) in .025f.. .65f && distance<=.035f
    val reason=if(valid) "MEASURED_AND_SETTLED" else "DIRECTION_OR_DISPLACEMENT_INVALID"
    result=measured(valid,reason,pose)
  }
}
