package com.myyaya.navigationprobe

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.util.UUID

/** Typed command bridge to the existing JS/community BLE controller. No second GATT owner. */
internal class RouteMotorGateway(val token: String=UUID.randomUUID().toString(),private val emit: (Map<String,Any>)->Unit) {
  private val handler=Handler(Looper.getMainLooper())
  private var sequence=0
  @Volatile var connected=false;private set
  @Volatile var connectionRevision=0L;private set
  @Volatile var foreground=true;private set
  @Volatile private var stateAt=0L
  @Volatile var voiceStopReady=false;private set
  @Volatile private var pending: Pair<Int,(Boolean,String)->Unit>?=null
  val busy get()=pending!=null
  @Volatile var continuous: NativeContinuousDrive?=null
  @Volatile var stopEpoch=0;private set
  @Volatile private var backAllowed=false
  @Volatile private var turnAllowed=false
  @Synchronized fun continuousGoal() {
    check(isConnected() && !busy && continuous?.pilot?.active!=true)
    emit(mapOf("token" to token,"sequence" to ++sequence,"action" to "continuous_goal","durationMs" to 0))
  }
  fun seedSensors() { continuous?.pilot?.sensors(SystemClock.elapsedRealtime(),isConnected(),backAllowed,turnAllowed) }
  @Synchronized fun cancelContinuous(reason: String) { stopEpoch++;continuous?.stop(reason) }
  @Synchronized fun localGoal() {
    check(isConnected() && !busy)
    emit(mapOf("token" to token,"sequence" to ++sequence,"action" to "local_goal","durationMs" to 0))
  }
  fun isConnected()=connected && foreground && SystemClock.elapsedRealtime()-stateAt<=1500
  @Synchronized fun state(connected: Boolean,voiceStop: Boolean,back: Boolean,turn: Boolean) {
    if(this.connected!=connected) connectionRevision++
    this.connected=connected;voiceStopReady=voiceStop;stateAt=SystemClock.elapsedRealtime()
    backAllowed=back;turnAllowed=turn
    continuous?.pilot?.sensors(stateAt,connected && foreground,back,turn)
  }
  @Synchronized fun request(action: String,durationMs: Int=0,callback: (Boolean,String)->Unit={_,_->}) {
    if (!foreground || pending!=null || continuous?.pilot?.active==true) { callback(false,"控制通道未就绪");return }
    require(action in setOf("connect","head_down","back","left","right","calibration_back","calibration_left","calibration_right"))
    require(when(action) { "calibration_back"->durationMs==450;"calibration_left","calibration_right"->durationMs==350;else->durationMs in 0..250 })
    val id=++sequence;pending=id to callback
    emit(mapOf("token" to token,"sequence" to id,"action" to action,"durationMs" to durationMs))
    handler.postDelayed({ if (pending?.first==id) {
      val cb=pending?.second;pending=null;stop("底座动作回执超时");cb?.invoke(false,"底座动作回执超时")
    } },if(action=="connect") 45_000 else 4500)
  }
  fun acknowledge(id: Int,ok: Boolean,message: String) {
    handler.post {
      synchronized(this) {
        if (pending?.first!=id) return@synchronized
        val cb=pending?.second;pending=null;cb?.invoke(ok,message.take(200))
      }
    }
  }
  @Synchronized fun stop(reason: String,notifyPending: Boolean=true) {
    stopEpoch++;continuous?.stop(reason)
    val old=pending;pending=null
    emit(mapOf("token" to token,"sequence" to ++sequence,"action" to "stop","durationMs" to 0,"reason" to reason))
    if(notifyPending) old?.second?.invoke(false,reason)
  }
  fun setForeground(value: Boolean) { foreground=value;if (!value) stop("导航界面进入后台") }
  fun close() { setForeground(false);continuous?.close();handler.removeCallbacksAndMessages(null) }
}
