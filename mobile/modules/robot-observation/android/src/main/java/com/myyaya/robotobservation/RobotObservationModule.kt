package com.myyaya.robotobservation

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Phone gravity only: no camera, BLE writes, or claimed mechanical head position. */
class RobotObservationModule : Module(), SensorEventListener {
  private data class Sample(val atMs: Double, val x: Float, val y: Float, val z: Float, val accuracy: Int)
  private val samples = ArrayDeque<Sample>()
  private var manager: SensorManager? = null
  private var sensor: Sensor? = null
  private var requested = false
  private var foreground = true
  private var active = false

  override fun definition() = ModuleDefinition {
    Name("RobotObservation")
    Function("start") {
      requested = true
      startSensor()
    }
    Function("stop") { requested = false; stopSensor() }
    Function("snapshot") {
      val now = SystemClock.elapsedRealtimeNanos() / 1_000_000.0
      val recent = synchronized(samples) { samples.filter { now - it.atMs <= 5000.0 } }
      mapOf("available" to (sensor != null), "active" to active, "nowMs" to now,
        "sensor" to "android-gravity", "samples" to recent.map {
          mapOf("atMs" to it.atMs, "x" to it.x, "y" to it.y, "z" to it.z, "accuracy" to it.accuracy)
        })
    }
    OnActivityEntersBackground { foreground = false; stopSensor() }
    OnActivityEntersForeground { foreground = true; if (requested) startSensor() }
    OnDestroy { requested = false; stopSensor() }
  }

  private fun startSensor(): Boolean {
    if (active) return true
    if (!foreground) return false
    manager = appContext.reactContext?.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    sensor = manager?.getDefaultSensor(Sensor.TYPE_GRAVITY)
    val gravity = sensor ?: return false
    synchronized(samples) { samples.clear() }
    active = manager?.registerListener(this, gravity, 50_000, Handler(Looper.getMainLooper())) == true
    return active
  }

  private fun stopSensor() {
    manager?.unregisterListener(this)
    active = false
    synchronized(samples) { samples.clear() }
  }

  override fun onSensorChanged(event: SensorEvent) {
    if (!active || event.sensor.type != Sensor.TYPE_GRAVITY) return
    val item = Sample(event.timestamp / 1_000_000.0, event.values[0], event.values[1], event.values[2], event.accuracy)
    synchronized(samples) {
      samples.addLast(item)
      while (samples.size > 120) samples.removeFirst()
    }
  }
  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
