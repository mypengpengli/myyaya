package com.superlooi.localfaceattention

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.media.Image
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import android.util.Base64
import android.util.Range
import android.util.Size
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs
import kotlin.math.max

class LocalFaceAttentionModule : Module() {
  private val lock = Any()
  private val detectorBusy = AtomicBoolean(false)
  private val framesAnalyzed = AtomicLong(0)
  private var running = false
  private var cameraId: String? = null
  private var lensFacingName = "unknown"
  private var sensorOrientation = 0
  private var cameraDevice: CameraDevice? = null
  private var captureSession: CameraCaptureSession? = null
  private var imageReader: ImageReader? = null
  private var stillImageReader: ImageReader? = null
  private var cameraThread: HandlerThread? = null
  private var cameraHandler: Handler? = null
  private var targetFpsRange: Range<Int>? = null
  private var detector: FaceDetector? = null
  private var pendingDetectorClose: FaceDetector? = null
  private var lastAnalysisAtMs = 0L
  private var pendingCapturePromise: Promise? = null
  private var pendingCaptureStopAfter = false
  private var pendingCaptureRestoreFacing: String? = null
  private var pendingCaptureTimeout: Runnable? = null
  private var pendingCaptureWarmupFallback: Runnable? = null
  private var pendingCaptureEarliestAtMs = 0L
  private var pendingCaptureWarmupDeadlineMs = 0L
  private var pendingStillCaptureIssued = false
  private var activeAfMode = CaptureRequest.CONTROL_AF_MODE_OFF
  private var flashAvailable = false
  private var latestAeState: Int? = null
  private var latestAwbState: Int? = null
  private var latestAfState: Int? = null
  private var latestExposureTimeNs: Long? = null
  private var latestSensitivityIso: Int? = null

  override fun definition() = ModuleDefinition {
    Name("LocalFaceAttention")
    Events("onFaceFrame", "onFaceAttentionError")

    AsyncFunction("start") Coroutine ::startCamera
    AsyncFunction("stop") Coroutine ::stopCameraAndStatus
    AsyncFunction("getStatus") Coroutine ::status
    AsyncFunction("captureStill") { cameraFacing: String, promise: Promise -> captureStill(cameraFacing, promise) }

    OnDestroy {
      stopCamera()
    }
  }

  private fun context(): Context = appContext.reactContext?.applicationContext
    ?: throw IllegalStateException("Android application context is unavailable")

  private fun hasPermission(): Boolean = ContextCompat.checkSelfPermission(
    context(),
    Manifest.permission.CAMERA
  ) == PackageManager.PERMISSION_GRANTED


  private fun createDetector(): FaceDetector {
    val options = FaceDetectorOptions.Builder()
      .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
      .setMinFaceSize(0.12f)
      .enableTracking()
      .build()
    return FaceDetection.getClient(options)
  }

  private fun selectTargetFpsRange(characteristics: CameraCharacteristics): Range<Int>? {
    val ranges = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
      ?.toList()
      .orEmpty()
    return ranges.firstOrNull { it.lower == 15 && it.upper == 15 }
      ?: ranges.filter { it.upper <= 20 }.maxByOrNull { it.upper }
  }

  private fun stopCameraAndStatus(): Map<String, Any?> {
    stopCamera()
    return status()
  }

  private fun startCamera(): Map<String, Any?> = startCameraForFacing("front")

  private fun startCameraForFacing(requestedFacing: String): Map<String, Any?> {
    synchronized(lock) {
      val facing = normalizeFacing(requestedFacing)
      if (running && lensFacingName == facing) return status()
      if (running) throw IllegalStateException("Camera is already running with a different lens")
      if (!hasPermission()) throw SecurityException("Camera permission is required for local face attention")

      val manager = context().getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val selected = selectCamera(manager, facing)
        ?: throw IllegalStateException("No $facing camera is available")

      cameraId = selected.id
      lensFacingName = selected.facingName
      val characteristics = selected.characteristics
      sensorOrientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
      targetFpsRange = selectTargetFpsRange(characteristics)
      activeAfMode = selectAutofocusMode(characteristics)
      flashAvailable = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
      latestAeState = null
      latestAwbState = null
      latestAfState = null
      latestExposureTimeNs = null
      latestSensitivityIso = null
      detector = if (lensFacingName == "front") createDetector() else null

      val thread = HandlerThread("my-looi-face-attention")
      thread.start()
      cameraThread = thread
      cameraHandler = Handler(thread.looper)
      lastAnalysisAtMs = 0L
      framesAnalyzed.set(0)

      val analysisSize = selectAnalysisSize(characteristics)
      val reader = ImageReader.newInstance(
        analysisSize.width,
        analysisSize.height,
        ImageFormat.YUV_420_888,
        2
      )
      imageReader = reader
      reader.setOnImageAvailableListener({ source ->
        val image = source.acquireLatestImage() ?: return@setOnImageAvailableListener
        analyze(image)
      }, cameraHandler)

      val stillSize = selectStillSize(characteristics, lensFacingName)
      val stillReader = ImageReader.newInstance(
        stillSize.width,
        stillSize.height,
        ImageFormat.JPEG,
        2
      )
      stillImageReader = stillReader
      stillReader.setOnImageAvailableListener({ source -> handleStillImage(source) }, cameraHandler)

      running = true
      try {
        manager.openCamera(selected.id, cameraStateCallback, cameraHandler)
      } catch (error: Throwable) {
        running = false
        stopCameraLocked()
        throw error
      }
      return status()
    }
  }

  private fun selectAnalysisSize(characteristics: CameraCharacteristics): Size {
    val sizes = characteristics
      .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
      ?.getOutputSizes(ImageFormat.YUV_420_888)
      ?.toList()
      .orEmpty()
    if (sizes.isEmpty()) return Size(ANALYSIS_WIDTH, ANALYSIS_HEIGHT)
    val targetArea = ANALYSIS_WIDTH * ANALYSIS_HEIGHT
    return sizes.minByOrNull { size -> abs(size.width * size.height - targetArea) } ?: sizes.first()
  }

  private fun selectStillSize(characteristics: CameraCharacteristics, facing: String): Size {
    val sizes = characteristics
      .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
      ?.getOutputSizes(ImageFormat.JPEG)
      ?.toList()
      .orEmpty()
    if (sizes.isEmpty()) return if (facing == "back") Size(BACK_STILL_TARGET_WIDTH, BACK_STILL_TARGET_HEIGHT) else Size(FRONT_STILL_TARGET_WIDTH, FRONT_STILL_TARGET_HEIGHT)
    val targetWidth = if (facing == "back") BACK_STILL_TARGET_WIDTH else FRONT_STILL_TARGET_WIDTH
    val targetHeight = if (facing == "back") BACK_STILL_TARGET_HEIGHT else FRONT_STILL_TARGET_HEIGHT
    val targetArea = targetWidth.toLong() * targetHeight.toLong()
    val maxArea = if (facing == "back") BACK_STILL_MAX_AREA else FRONT_STILL_MAX_AREA
    val bounded = sizes.filter { size ->
      val area = size.width.toLong() * size.height.toLong()
      size.width >= 1920 && size.height >= 1080 && area <= maxArea
    }
    val candidates = if (bounded.isNotEmpty()) bounded else sizes
    return candidates.minByOrNull { size ->
      abs(size.width.toLong() * size.height.toLong() - targetArea)
    } ?: sizes.first()
  }

  private data class CameraSelection(
    val id: String,
    val facingName: String,
    val characteristics: CameraCharacteristics
  )

  private fun selectCamera(manager: CameraManager, requestedFacing: String): CameraSelection? {
    val requestedLensFacing = if (requestedFacing == "back") CameraCharacteristics.LENS_FACING_BACK else CameraCharacteristics.LENS_FACING_FRONT
    val candidates = manager.cameraIdList.mapNotNull { id ->
      val characteristics = manager.getCameraCharacteristics(id)
      val facing = characteristics.get(CameraCharacteristics.LENS_FACING)
      if (facing != requestedLensFacing) return@mapNotNull null
      CameraSelection(id, requestedFacing, characteristics)
    }
    if (candidates.isEmpty()) return null
    if (requestedFacing == "front") return candidates.first()
    return candidates.maxByOrNull { selection -> backCameraScore(selection.characteristics) }
  }

  private fun backCameraScore(characteristics: CameraCharacteristics): Long {
    val capabilities = characteristics.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.toSet().orEmpty()
    val logical = capabilities.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA)
    val afModes = characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)?.toSet().orEmpty()
    val continuousAf = afModes.contains(CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
    val anyAf = afModes.any { it != CaptureRequest.CONTROL_AF_MODE_OFF }
    val maxJpegArea = characteristics
      .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
      ?.getOutputSizes(ImageFormat.JPEG)
      ?.maxOfOrNull { it.width.toLong() * it.height.toLong() }
      ?: 0L
    return (if (logical) 1_000_000_000_000L else 0L) +
      (if (continuousAf) 100_000_000_000L else if (anyAf) 50_000_000_000L else 0L) +
      maxJpegArea.coerceAtMost(20_000_000L)
  }

  private fun selectAutofocusMode(characteristics: CameraCharacteristics): Int {
    val modes = characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)?.toSet().orEmpty()
    return when {
      modes.contains(CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE) -> CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
      modes.contains(CaptureRequest.CONTROL_AF_MODE_AUTO) -> CaptureRequest.CONTROL_AF_MODE_AUTO
      else -> CaptureRequest.CONTROL_AF_MODE_OFF
    }
  }

  private fun normalizeFacing(value: String): String = if (value.trim().lowercase() == "back") "back" else "front"

  private val cameraStateCallback = object : CameraDevice.StateCallback() {
    override fun onOpened(camera: CameraDevice) {
      synchronized(lock) {
        if (!running) {
          camera.close()
          return
        }
        cameraDevice = camera
        createCaptureSession(camera)
      }
    }

    override fun onDisconnected(camera: CameraDevice) {
      camera.close()
      synchronized(lock) {
        if (cameraDevice === camera) cameraDevice = null
        running = false
      }
      failPendingCapture("ERR_CAPTURE_CAMERA", "Camera disconnected", null)
      emitError("camera-disconnected", "Camera disconnected")
    }

    override fun onError(camera: CameraDevice, error: Int) {
      camera.close()
      synchronized(lock) {
        if (cameraDevice === camera) cameraDevice = null
        running = false
      }
      failPendingCapture("ERR_CAPTURE_CAMERA", "Camera error $error", null)
      emitError("camera-open", "Camera error $error")
    }
  }

  @Suppress("DEPRECATION")
  private fun createCaptureSession(camera: CameraDevice) {
    val reader = imageReader ?: return
    val stillReader = stillImageReader ?: return
    camera.createCaptureSession(
      listOf(reader.surface, stillReader.surface),
      object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(session: CameraCaptureSession) {
          synchronized(lock) {
            if (!running || cameraDevice !== camera) {
              session.close()
              return
            }
            captureSession = session
            try {
              val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                addTarget(reader.surface)
                set(CaptureRequest.CONTROL_AF_MODE, activeAfMode)
                set(CaptureRequest.CONTROL_AE_MODE, previewAeMode())
                targetFpsRange?.let { set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, it) }
              }.build()
              session.setRepeatingRequest(request, previewCaptureCallback, cameraHandler)
              if (pendingCapturePromise != null) {
                maybeIssuePendingStillCaptureLocked()
              }
            } catch (error: Throwable) {
              emitError("capture-start", error.message ?: error.javaClass.simpleName)
            }
          }
        }

        override fun onConfigureFailed(session: CameraCaptureSession) {
          session.close()
          failPendingCapture("ERR_CAPTURE_CONFIGURE", "Could not configure camera capture", null)
          emitError("capture-configure", "Could not configure local face-attention capture")
        }
      },
      cameraHandler
    )
  }

  private fun captureStill(cameraFacing: String, promise: Promise) {
    val facing = normalizeFacing(cameraFacing)
    val shouldStart: Boolean
    val shouldSwitch: Boolean
    synchronized(lock) {
      if (!hasPermission()) {
        promise.reject("ERR_CAPTURE_PERMISSION", "Camera permission is required", null)
        return
      }
      if (pendingCapturePromise != null) {
        promise.reject("ERR_CAPTURE_BUSY", "Another visual capture is already in progress", null)
        return
      }
      pendingCapturePromise = promise
      pendingCaptureStopAfter = !running
      pendingCaptureRestoreFacing = if (running && lensFacingName != facing) lensFacingName else null
      pendingStillCaptureIssued = false
      shouldStart = !running
      shouldSwitch = running && lensFacingName != facing
    }

    try {
      if (shouldSwitch) switchCameraForExplicitCapture(facing)
      else if (shouldStart) startCameraForFacing(facing)
      synchronized(lock) {
        val handler = cameraHandler
        if (handler == null) {
          failPendingCapture("ERR_CAPTURE_CAMERA", "Camera handler is unavailable", null)
          return
        }
        val now = System.currentTimeMillis()
        val openingNewLens = shouldStart || shouldSwitch
        pendingCaptureEarliestAtMs = now + if (openingNewLens) STILL_CAMERA_MIN_WARMUP_MS else 0L
        pendingCaptureWarmupDeadlineMs = now + if (openingNewLens) STILL_CAMERA_CONVERGENCE_TIMEOUT_MS else STILL_EXISTING_CAMERA_SETTLE_TIMEOUT_MS

        val timeout = Runnable {
          failPendingCapture("ERR_CAPTURE_TIMEOUT", "Camera snapshot timed out", null)
        }
        pendingCaptureTimeout = timeout
        handler.postDelayed(timeout, STILL_CAPTURE_TIMEOUT_MS)

        val warmupFallback = Runnable {
          synchronized(lock) { maybeIssuePendingStillCaptureLocked(force = true) }
        }
        pendingCaptureWarmupFallback = warmupFallback
        handler.postDelayed(warmupFallback, max(0L, pendingCaptureWarmupDeadlineMs - now))
        maybeIssuePendingStillCaptureLocked()
      }
    } catch (error: Throwable) {
      failPendingCapture("ERR_CAPTURE_CAMERA", error.message ?: error.javaClass.simpleName, error)
    }
  }

  private fun switchCameraForExplicitCapture(facing: String) {
    synchronized(lock) {
      running = false
      stopCameraLocked()
    }
    startCameraForFacing(facing)
  }

  private fun exposureReadyForStill(): Boolean {
    val aeReady = latestAeState == CaptureResult.CONTROL_AE_STATE_CONVERGED ||
      latestAeState == CaptureResult.CONTROL_AE_STATE_FLASH_REQUIRED ||
      latestAeState == CaptureResult.CONTROL_AE_STATE_LOCKED
    val awbReady = latestAwbState == CaptureResult.CONTROL_AWB_STATE_CONVERGED ||
      latestAwbState == CaptureResult.CONTROL_AWB_STATE_LOCKED
    return aeReady && awbReady
  }

  private fun maybeIssuePendingStillCaptureLocked(force: Boolean = false) {
    if (pendingCapturePromise == null || pendingStillCaptureIssued) return
    val now = System.currentTimeMillis()
    if (!force && now < pendingCaptureEarliestAtMs) return
    if (!force && now < pendingCaptureWarmupDeadlineMs && !exposureReadyForStill()) return
    issuePendingStillCaptureLocked()
  }

  private fun issuePendingStillCaptureLocked() {
    if (pendingCapturePromise == null || pendingStillCaptureIssued) return
    val camera = cameraDevice ?: return
    val session = captureSession ?: return
    val reader = stillImageReader ?: return

    pendingStillCaptureIssued = true
    pendingCaptureWarmupFallback?.let { cameraHandler?.removeCallbacks(it) }
    pendingCaptureWarmupFallback = null
    try {
      val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
        addTarget(reader.surface)
        set(CaptureRequest.CONTROL_AF_MODE, activeAfMode)
        set(CaptureRequest.CONTROL_AE_MODE, stillAeMode())
        set(CaptureRequest.JPEG_QUALITY, STILL_JPEG_QUALITY.toByte())
        set(CaptureRequest.JPEG_ORIENTATION, imageRotationDegrees())
      }.build()
      session.capture(request, object : CameraCaptureSession.CaptureCallback() {
        override fun onCaptureFailed(
          session: CameraCaptureSession,
          request: CaptureRequest,
          failure: android.hardware.camera2.CaptureFailure
        ) {
          failPendingCapture("ERR_CAPTURE_FAILED", "Camera could not capture the requested image", null)
        }
      }, cameraHandler)
    } catch (error: Throwable) {
      pendingStillCaptureIssued = false
      failPendingCapture("ERR_CAPTURE_FAILED", error.message ?: error.javaClass.simpleName, error)
    }
  }

  private fun handleStillImage(source: ImageReader) {
    val image = source.acquireLatestImage() ?: return
    try {
      val buffer = image.planes.firstOrNull()?.buffer
        ?: throw IllegalStateException("JPEG image buffer is unavailable")
      val bytes = ByteArray(buffer.remaining())
      buffer.get(bytes)
      val exposureMs = latestExposureTimeNs?.div(1_000_000.0)
      val payload = mapOf(
        "mimeType" to "image/jpeg",
        "base64" to Base64.encodeToString(bytes, Base64.NO_WRAP),
        "width" to image.width,
        "height" to image.height,
        "timestampMs" to System.currentTimeMillis(),
        "cameraFacing" to lensFacingName,
        "cameraId" to cameraId,
        "autofocusMode" to activeAfMode,
        "flashAvailable" to flashAvailable,
        "aeState" to latestAeState,
        "awbState" to latestAwbState,
        "afState" to latestAfState,
        "exposureTimeMs" to exposureMs,
        "sensitivityIso" to latestSensitivityIso,
        "lowLightLikely" to isLowLightLikely(exposureMs, latestSensitivityIso)
      )
      resolvePendingCapture(payload)
    } catch (error: Throwable) {
      failPendingCapture("ERR_CAPTURE_ENCODE", error.message ?: error.javaClass.simpleName, error)
    } finally {
      image.close()
    }
  }

  private fun resolvePendingCapture(payload: Map<String, Any?>) {
    val promise: Promise?
    val stopAfter: Boolean
    val restoreFacing: String?
    synchronized(lock) {
      promise = pendingCapturePromise
      if (promise == null) return
      stopAfter = pendingCaptureStopAfter
      restoreFacing = pendingCaptureRestoreFacing
      pendingCapturePromise = null
      pendingCaptureStopAfter = false
      pendingCaptureRestoreFacing = null
      pendingCaptureTimeout?.let { cameraHandler?.removeCallbacks(it) }
      pendingCaptureTimeout = null
      pendingCaptureWarmupFallback?.let { cameraHandler?.removeCallbacks(it) }
      pendingCaptureWarmupFallback = null
      pendingCaptureEarliestAtMs = 0L
      pendingCaptureWarmupDeadlineMs = 0L
      pendingStillCaptureIssued = false
    }
    promise?.resolve(payload)
    val handler = cameraHandler
    if (stopAfter || restoreFacing != null) {
      handler?.post {
        if (restoreFacing != null) {
          try { switchCameraForExplicitCapture(restoreFacing) } catch (_: Throwable) {}
        } else if (stopAfter) stopCamera()
      } ?: run {
        if (restoreFacing != null) {
          try { switchCameraForExplicitCapture(restoreFacing) } catch (_: Throwable) {}
        } else if (stopAfter) stopCamera()
      }
    }
  }

  private fun failPendingCapture(code: String, message: String, error: Throwable?) {
    val promise: Promise?
    val stopAfter: Boolean
    val restoreFacing: String?
    synchronized(lock) {
      promise = pendingCapturePromise
      if (promise == null) return
      stopAfter = pendingCaptureStopAfter
      restoreFacing = pendingCaptureRestoreFacing
      pendingCapturePromise = null
      pendingCaptureStopAfter = false
      pendingCaptureRestoreFacing = null
      pendingCaptureTimeout?.let { cameraHandler?.removeCallbacks(it) }
      pendingCaptureTimeout = null
      pendingCaptureWarmupFallback?.let { cameraHandler?.removeCallbacks(it) }
      pendingCaptureWarmupFallback = null
      pendingCaptureEarliestAtMs = 0L
      pendingCaptureWarmupDeadlineMs = 0L
      pendingStillCaptureIssued = false
    }
    promise?.reject(code, message, error)
    if (restoreFacing != null) {
      try { switchCameraForExplicitCapture(restoreFacing) } catch (_: Throwable) {}
    } else if (stopAfter) stopCamera()
  }

  private val previewCaptureCallback = object : CameraCaptureSession.CaptureCallback() {
    override fun onCaptureCompleted(session: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
      latestAeState = result.get(CaptureResult.CONTROL_AE_STATE)
      latestAwbState = result.get(CaptureResult.CONTROL_AWB_STATE)
      latestAfState = result.get(CaptureResult.CONTROL_AF_STATE)
      latestExposureTimeNs = result.get(CaptureResult.SENSOR_EXPOSURE_TIME)
      latestSensitivityIso = result.get(CaptureResult.SENSOR_SENSITIVITY)
      synchronized(lock) {
        maybeIssuePendingStillCaptureLocked()
      }
    }
  }

  private fun previewAeMode(): Int = if (lensFacingName == "back" && flashAvailable) {
    CaptureRequest.CONTROL_AE_MODE_ON_AUTO_FLASH
  } else {
    CaptureRequest.CONTROL_AE_MODE_ON
  }

  private fun stillAeMode(): Int = if (lensFacingName == "back" && flashAvailable) {
    CaptureRequest.CONTROL_AE_MODE_ON_AUTO_FLASH
  } else {
    CaptureRequest.CONTROL_AE_MODE_ON
  }

  private fun isLowLightLikely(exposureMs: Double?, iso: Int?): Boolean {
    if (exposureMs == null || iso == null) return false
    return exposureMs >= 24.0 && iso >= 500
  }

  private fun analyze(image: Image) {
    if (!running) {
      image.close()
      return
    }

    val now = System.currentTimeMillis()
    if (now - lastAnalysisAtMs < MIN_ANALYSIS_INTERVAL_MS || !detectorBusy.compareAndSet(false, true)) {
      image.close()
      return
    }
    lastAnalysisAtMs = now

    val activeDetector = detector
    if (activeDetector == null) {
      detectorBusy.set(false)
      image.close()
      return
    }

    val rotation = imageRotationDegrees()
    val input = try {
      InputImage.fromMediaImage(image, rotation)
    } catch (error: Throwable) {
      detectorBusy.set(false)
      image.close()
      emitError("input-image", error.message ?: error.javaClass.simpleName)
      return
    }

    activeDetector.process(input)
      .addOnSuccessListener { faces ->
        framesAnalyzed.incrementAndGet()
        if (running) emitFaces(faces, image.width, image.height, rotation)
      }
      .addOnFailureListener { error ->
        emitError("face-detection", error.message ?: error.javaClass.simpleName)
      }
      .addOnCompleteListener {
        image.close()
        detectorBusy.set(false)
        synchronized(lock) {
          val pending = pendingDetectorClose
          pendingDetectorClose = null
          try { pending?.close() } catch (_: Throwable) {}
        }
      }
  }

  private fun emitFaces(faces: List<Face>, rawWidth: Int, rawHeight: Int, rotation: Int) {
    val rotated = rotation == 90 || rotation == 270
    val width = max(1, if (rotated) rawHeight else rawWidth).toFloat()
    val height = max(1, if (rotated) rawWidth else rawHeight).toFloat()
    val primary = faces.maxByOrNull { it.boundingBox.width().toLong() * it.boundingBox.height().toLong() }
    val normalized = primary?.let { face ->
      val rect = face.boundingBox
      val left = (rect.left / width).coerceIn(0f, 1f)
      val top = (rect.top / height).coerceIn(0f, 1f)
      val right = (rect.right / width).coerceIn(0f, 1f)
      val bottom = (rect.bottom / height).coerceIn(0f, 1f)
      mapOf(
        "left" to left,
        "top" to top,
        "right" to right,
        "bottom" to bottom,
        "centerX" to ((left + right) / 2f),
        "centerY" to ((top + bottom) / 2f),
        "width" to (right - left).coerceAtLeast(0f),
        "height" to (bottom - top).coerceAtLeast(0f)
      )
    }

    sendEvent("onFaceFrame", mapOf(
      "timestampMs" to System.currentTimeMillis(),
      "faceCount" to faces.size,
      "primary" to normalized
    ))
  }

  @Suppress("DEPRECATION")
  private fun imageRotationDegrees(): Int {
    val activity = appContext.currentActivity
    val displayRotation = activity?.windowManager?.defaultDisplay?.rotation ?: Surface.ROTATION_0
    val deviceDegrees = when (displayRotation) {
      Surface.ROTATION_90 -> 90
      Surface.ROTATION_180 -> 180
      Surface.ROTATION_270 -> 270
      else -> 0
    }
    return if (lensFacingName == "front") {
      (sensorOrientation + deviceDegrees) % 360
    } else {
      (sensorOrientation - deviceDegrees + 360) % 360
    }
  }

  private fun stopCamera() {
    val pending: Promise?
    synchronized(lock) {
      pending = pendingCapturePromise
      pendingCapturePromise = null
      pendingCaptureStopAfter = false
      pendingCaptureRestoreFacing = null
      pendingCaptureTimeout?.let { cameraHandler?.removeCallbacks(it) }
      pendingCaptureTimeout = null
      pendingCaptureWarmupFallback?.let { cameraHandler?.removeCallbacks(it) }
      pendingCaptureWarmupFallback = null
      pendingCaptureEarliestAtMs = 0L
      pendingCaptureWarmupDeadlineMs = 0L
      pendingStillCaptureIssued = false
      running = false
      stopCameraLocked()
    }
    pending?.reject("ERR_CAPTURE_STOPPED", "Camera stopped before the snapshot completed", null)
  }

  private fun stopCameraLocked() {
    try { captureSession?.stopRepeating() } catch (_: Throwable) {}
    try { captureSession?.abortCaptures() } catch (_: Throwable) {}
    try { captureSession?.close() } catch (_: Throwable) {}
    captureSession = null
    try { cameraDevice?.close() } catch (_: Throwable) {}
    cameraDevice = null
    try { imageReader?.close() } catch (_: Throwable) {}
    imageReader = null
    try { stillImageReader?.close() } catch (_: Throwable) {}
    stillImageReader = null

    val thread = cameraThread
    cameraHandler = null
    cameraThread = null
    try { thread?.quitSafely() } catch (_: Throwable) {}

    val detectorToClose = detector
    detector = null
    if (detectorToClose != null) {
      if (detectorBusy.get() && pendingDetectorClose == null) {
        pendingDetectorClose = detectorToClose
      } else {
        try { detectorToClose.close() } catch (_: Throwable) {}
      }
    }
    targetFpsRange = null
    // Do not clear detectorBusy here: an in-flight ML Kit task still owns its Image.
    // Its completion listener is the only place that releases that image and gate,
    // then closes the detector that belonged to the stopped camera session.
  }

  private fun emitError(stage: String, message: String) {
    sendEvent("onFaceAttentionError", mapOf("stage" to stage, "message" to message))
  }

  private fun status(): Map<String, Any?> = mapOf(
    "supported" to true,
    "running" to running,
    "permissionGranted" to hasPermission(),
    "cameraId" to cameraId,
    "lensFacing" to lensFacingName,
    "framesAnalyzed" to framesAnalyzed.get(),
    "analysisWidth" to ANALYSIS_WIDTH,
    "analysisHeight" to ANALYSIS_HEIGHT,
    "stillWidth" to stillImageReader?.width,
    "stillHeight" to stillImageReader?.height,
    "autofocusMode" to activeAfMode,
    "flashAvailable" to flashAvailable,
    "targetFps" to targetFpsRange?.upper
  )

  companion object {
    private const val ANALYSIS_WIDTH = 640
    private const val ANALYSIS_HEIGHT = 480
    private const val MIN_ANALYSIS_INTERVAL_MS = 140L
    private const val FRONT_STILL_TARGET_WIDTH = 2592
    private const val FRONT_STILL_TARGET_HEIGHT = 1944
    private const val FRONT_STILL_MAX_AREA = 5_500_000L
    private const val BACK_STILL_TARGET_WIDTH = 3264
    private const val BACK_STILL_TARGET_HEIGHT = 2448
    private const val BACK_STILL_MAX_AREA = 8_500_000L
    private const val STILL_JPEG_QUALITY = 95
    private const val STILL_CAPTURE_TIMEOUT_MS = 8_000L
    private const val STILL_CAMERA_MIN_WARMUP_MS = 450L
    private const val STILL_CAMERA_CONVERGENCE_TIMEOUT_MS = 1_600L
    private const val STILL_EXISTING_CAMERA_SETTLE_TIMEOUT_MS = 500L
  }
}
