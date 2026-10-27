package com.superlooi.voskcommand

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

/** Uses the community recognizer; captures 16 kHz locally without any provider API. */
internal class ChineseSpeechBridge(
  private val context: Context,
  private val feed: (FloatArray) -> Unit,
  private val captureError: (String) -> Unit
) {
  private val running = AtomicBoolean(false)
  private var recorder: AudioRecord? = null
  private var thread: Thread? = null
  private val main = Handler(Looper.getMainLooper())
  private var tts: TextToSpeech? = null
  private var initialized = false
  private var pending: Promise? = null
  private var utteranceId: String? = null
  private var initTimeout: Runnable? = null
  private var ttsGeneration = 0
  @Volatile private var closed = false

  @Synchronized fun startCapture(): Map<String, Any> {
    check(!closed) { "Speech module closed" }
    if (running.get()) return mapOf("running" to true, "sampleRate" to 16000)
    check(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      "Microphone permission is required"
    }
    val minimum = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    check(minimum > 0) { "16 kHz audio capture is unavailable" }
    val capture = AudioRecord.Builder()
      .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
      .setAudioFormat(AudioFormat.Builder().setSampleRate(16000).setChannelMask(AudioFormat.CHANNEL_IN_MONO)
        .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
      .setBufferSizeInBytes(max(minimum * 4, 12800)).build()
    if (capture.state != AudioRecord.STATE_INITIALIZED) { capture.release(); error("Microphone initialization failed") }
    try {
      capture.startRecording()
      check(capture.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Microphone recording did not start" }
    } catch (error: Throwable) { capture.release(); throw error }
    recorder = capture
    running.set(true)
    thread = Thread({
      Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
      val buffer = ShortArray(640)
      try {
        while (running.get()) {
          val count = capture.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
          if (!running.get()) break
          check(count > 0) { "Microphone read failed ($count)" }
          feed(FloatArray(count) { buffer[it].toFloat() })
        }
      } catch (error: Throwable) {
        if (running.getAndSet(false)) captureError(error.message ?: "Microphone capture failed")
      }
    }, "myyaya-chinese-capture").also { it.start() }
    return mapOf("running" to true, "sampleRate" to 16000)
  }

  @Synchronized fun stopCapture() {
    running.set(false)
    try { recorder?.stop() } catch (_: Throwable) {}
    try { thread?.join(1500) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    try { recorder?.release() } catch (_: Throwable) {}
    thread = null
    recorder = null
  }

  fun speak(text: String, promise: Promise) {
    main.post {
      if (closed) { promise.reject("E_SPEECH_CLOSED", "Speech module closed", null); return@post }
      cancelPending()
      val value = text.trim().take(3500)
      if (value.isEmpty()) { promise.resolve(null); return@post }
      pending = promise
      if (initialized) { play(value); return@post }
      initTimeout = Runnable {
        pending?.reject("E_TTS_UNAVAILABLE", "请在系统文字转语音设置中安装中文离线音色", null)
        pending = null
        tts?.shutdown(); tts = null; initialized = false
      }.also { main.postDelayed(it, 8000) }
      val generation = ++ttsGeneration
      tts = TextToSpeech(context) { status -> main.post initialized@{
        if (generation != ttsGeneration || closed || pending == null) return@initialized
        initTimeout?.let { main.removeCallbacks(it) }; initTimeout = null
        if (status != TextToSpeech.SUCCESS) {
          pending?.reject("E_TTS_UNAVAILABLE", "系统中文语音引擎不可用", null); pending = null
        } else {
          initialized = true
          play(value)
        }
      } }
    }
  }

  private fun play(text: String) {
    try {
    val engine = tts ?: return
    // Explicitly select an offline Chinese voice. Never silently depend on a cloud engine.
    val voice = engine.voices?.filter { it.locale.language in setOf("zh", "cmn") && !it.isNetworkConnectionRequired }
      ?.sortedByDescending { it.quality }?.firstOrNull()
    if (voice == null) {
      pending?.reject("E_CHINESE_VOICE_MISSING", "请在系统文字转语音设置中安装中文离线音色；Azure 晓悠待配置", null)
      pending = null
      return
    }
    engine.setLanguage(Locale.SIMPLIFIED_CHINESE)
    engine.voice = voice
    engine.setPitch(1.12f)
    engine.setSpeechRate(0.95f)
    engine.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
    val id = UUID.randomUUID().toString()
    utteranceId = id
    engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) {}
      override fun onDone(utteranceId: String?) = finish(utteranceId, false)
      @Deprecated("Platform callback") override fun onError(utteranceId: String?) = finish(utteranceId, true)
    })
    if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.ERROR) finish(id, true)
    } catch (error: Throwable) {
      utteranceId = null
      pending?.reject("E_TTS_FAILED", "系统中文语音引擎不可用，请检查系统文字转语音设置", error)
      pending = null
    }
  }

  private fun finish(id: String?, failed: Boolean) { main.post {
    if (id != utteranceId) return@post
    utteranceId = null
    if (failed) pending?.reject("E_TTS_FAILED", "系统中文朗读失败", null) else pending?.resolve(null)
    pending = null
  } }

  private fun cancelPending() {
    initTimeout?.let { main.removeCallbacks(it) }; initTimeout = null
    tts?.stop()
    utteranceId = null
    pending?.reject("E_SPEECH_CANCELLED", "朗读已停止", null); pending = null
    if (!initialized) { ttsGeneration++; tts?.shutdown(); tts = null }
  }

  fun stopSpeech() { main.post { cancelPending() } }
  fun close() {
    closed = true
    stopCapture()
    main.post { cancelPending(); tts?.shutdown(); tts = null; initialized = false }
  }
}
