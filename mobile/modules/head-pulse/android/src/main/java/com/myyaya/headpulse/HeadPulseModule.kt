package com.myyaya.headpulse

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import com.bleplx.BlePlxModule
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicInteger

/** ADB-only callers use the existing BLE manager; this module never scans/connects or writes FED0. */
class HeadPulseModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  @Volatile private var foreground = true
  private var target: String? = null
  private var ble: BlePlxModule? = null
  private var serial = 0L
  private val epoch = AtomicInteger(0)
  private var pendingStart: String? = null
  private val controller = HeadPulseController(
    { SystemClock.elapsedRealtime() },
    { delay, work -> val task = Runnable { work() }; handler.postDelayed(task, delay); { handler.removeCallbacks(task) } },
    { payload, complete ->
      val module = requireNotNull(ble)
      val transaction = "native-head-${++serial}"
      if (payload[1].toInt() == 0) {
        pendingStart?.let { module.cancelTransaction(it, PromiseImpl(Callback {}, Callback {})) }
      } else pendingStart = transaction
      val result: (Boolean) -> Unit = { ok -> handler.post {
        if (pendingStart == transaction) pendingStart = null
        complete(ok)
      } }
      module.writeCharacteristicForDevice(requireNotNull(target), "000000ff-0000-1000-8000-00805f9b34fb",
        "0000fed1-0000-1000-8000-00805f9b34fb", Base64.encodeToString(payload, Base64.NO_WRAP), true,
        transaction, PromiseImpl(Callback { result(true) }, Callback { result(false) }))
    }
  )

  override fun definition() = ModuleDefinition {
    Name("HeadPulse")
    Function("generation") { epoch.get() }
    AsyncFunction("pulse") { deviceId: String, signedSpeed: Int, durationMs: Int, expectedGeneration: Int, promise: Promise ->
      handler.post {
        try {
          check(foreground) { "请保持前台测试头部" }
          check(epoch.get() == expectedGeneration) { "头部短时请求已取消" }
          check(controller.canStart()) { "上次头部停止尚未确认" }
          require(Regex("([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}").matches(deviceId)) { "无效蓝牙设备" }
          ble = requireNotNull((appContext.reactContext as? ReactContext)?.getNativeModule(BlePlxModule::class.java)) { "现有蓝牙模块不可用" }
          target = deviceId
          controller.start(signedSpeed, durationMs) { promise.resolve(it) }
        } catch (error: Exception) { promise.reject("HEAD_PULSE_REJECTED", error.message, error) }
      }
    }
    Function("stop") { epoch.incrementAndGet(); handler.post { controller.stop("explicit-stop") }; true }
    Function("status") { controller.snapshot() }
    OnActivityEntersBackground { foreground = false; epoch.incrementAndGet(); handler.post { controller.stop("background") } }
    OnActivityEntersForeground { foreground = true }
    OnDestroy { foreground = false; epoch.incrementAndGet(); handler.post { controller.stop("module-destroyed") } }
  }
}
