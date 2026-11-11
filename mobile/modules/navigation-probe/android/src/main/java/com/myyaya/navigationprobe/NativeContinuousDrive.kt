package com.myyaya.navigationprobe

import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Base64
import com.bleplx.BlePlxModule
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl

/** Shares the existing BLE connection. No JS motor timer and no second GATT owner. */
internal class NativeContinuousDrive(private val ble: BlePlxModule,private val device: String,val pilot: ContinuousPilot) {
  val token=java.util.UUID.randomUUID().toString()
  private val thread=HandlerThread("looi-navigation-drive").apply {start()}
  private val handler=Handler(thread.looper)
  @Volatile private var stoppedAck=true
  @Volatile private var closed=false
  @Volatile private var stopRequested=false
  private val driveLock=Any()
  private var pending: String?=null
  private var pendingAt=0L
  private var serial=0
  private var lastSent=0L
  private var lastWasZero=true
  @Volatile private var writes=0
  @Volatile private var nonzeroWrites=0
  @Volatile private var longestMovingWriteGapMs=0L
  private var lastMovingWrite=0L
  private val loop=object:Runnable { override fun run() {
    if(closed)return
    try {
    val now=SystemClock.elapsedRealtime()
    if(pending!=null && now-pendingAt>250){ble.cancelTransaction(pending!!,PromiseImpl(Callback{},Callback{}));pending=null;pilot.cancel("蓝牙写入超时")}
    val command=pilot.tick(now,stoppedAck)
    if(now-lastSent>=95 && pending==null && (pilot.active || !lastWasZero || !stoppedAck)) send(command.first,command.second)
    } catch(error: Exception) { pilot.cancel("蓝牙控制异常："+error.javaClass.simpleName);runCatching { send(0,0) } }
    handler.postDelayed(this,50)
  }}
  init {require(Regex("([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}").matches(device));handler.post(loop)}
  private fun send(speed: Int,turn: Int): Unit = synchronized(driveLock) {
    require(speed in -45..0 && turn in -50..50)
    if((stopRequested || !pilot.active) && (speed!=0 || turn!=0)) return@synchronized
    val zero=speed==0 && turn==0;val id="navigation-drive-${token}-${++serial}";pending=id;pendingAt=SystemClock.elapsedRealtime();lastSent=pendingAt
    if(!zero)stoppedAck=false
    lastWasZero=zero;writes++
    if(!zero){nonzeroWrites++;if(lastMovingWrite>0)longestMovingWriteGapMs=maxOf(longestMovingWriteGapMs,pendingAt-lastMovingWrite);lastMovingWrite=pendingAt}else lastMovingWrite=0
    val finish:(Boolean)->Unit={ok->handler.post {
      if(pending==id){pending=null;if(zero && ok)stoppedAck=true;if(!ok)pilot.cancel("蓝牙写入失败")}
    }}
    ble.writeCharacteristicForDevice(device,"000000ff-0000-1000-8000-00805f9b34fb","0000fed0-0000-1000-8000-00805f9b34fb",
      Base64.encodeToString(byteArrayOf(speed.toByte(),turn.toByte()),Base64.NO_WRAP),zero,id,
      PromiseImpl(Callback{finish(true)},Callback{finish(false)}))
  }
  fun stop(reason: String) {synchronized(driveLock) {stopRequested=true;pilot.cancel(reason)};handler.post {
    runCatching { pending?.let {ble.cancelTransaction(it,PromiseImpl(Callback{},Callback{}))} };pending=null;runCatching { send(0,0) }
  }}
  fun report()=pilot.report(SystemClock.elapsedRealtime())+mapOf("token" to token,"writes" to writes,"nonzeroWrites" to nonzeroWrites,"longestMovingWriteGapMs" to longestMovingWriteGapMs,"stopAcknowledged" to stoppedAck,"nativeControl" to true)
  fun canReseed()=stoppedAck && pilot.needReseed
  fun close() {stop("导航控制已关闭");handler.postDelayed({closed=true;handler.removeCallbacksAndMessages(null);thread.quitSafely()},1200)}
}
