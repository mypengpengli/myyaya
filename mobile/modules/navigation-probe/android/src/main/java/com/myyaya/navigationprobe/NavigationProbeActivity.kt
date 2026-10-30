package com.myyaya.navigationprobe

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.net.Uri
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.os.SystemClock
import android.text.Html
import android.text.method.LinkMovementMethod
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.WindowInsets
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.google.ar.core.ArCoreApk
import com.google.ar.core.CameraConfig
import com.google.ar.core.Config
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.NotYetAvailableException
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/** Standalone sensor probe. Deliberately has no BLE/motor dependency or navigation tools. */
class NavigationProbeActivity : Activity() {
  private lateinit var surface: GLSurfaceView
  private lateinit var status: TextView
  private lateinit var metrics: TextView
  private lateinit var depthLabel: TextView
  private lateinit var depthPreview: ImageView
  private lateinit var trajectory: TrajectoryView
  private lateinit var startButton: Button
  private lateinit var modeButton: Button
  private val io = Executors.newSingleThreadExecutor()
  private val reportLock = Any()
  private lateinit var directory: File
  private lateinit var logFile: File
  private var exportFile: File? = null
  private var lastReport = JSONObject()
  private var logRows = 0
  @Volatile private var session: Session? = null
  @Volatile private var sessionId: String? = null
  @Volatile private var running = false
  @Volatile private var resumed = false
  @Volatile private var rotation = 0
  @Volatile private var breakPath = true
  @Volatile private var activeMode = Config.DepthMode.DISABLED
  private var rawPreferred = true
  private var glResumed = false
  private var userWantsRunning = false
  private var permissionPending = false
  private var supportedAuto = false
  private var supportedRaw = false
  private var checking = false
  private var installRequested = false
  private var configuredDepthMode: Config.DepthMode? = null
  private var closingForModeChange = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
    directory = getExternalFilesDir("navigation-probe") ?: File(filesDir, "navigation-probe")
    directory.mkdirs()
    val probeId = UUID.randomUUID().toString()
    logFile = File(directory, "probe-$probeId.ndjson")
    directory.listFiles()?.filter { it.name.startsWith("probe-") && it.extension == "ndjson" }
      ?.sortedByDescending { it.lastModified() }?.drop(4)?.forEach { it.delete() }
    lastReport = JSONObject().put("schemaVersion", 1).put("probeId", probeId)
      .put("device", "${Build.MANUFACTURER} ${Build.MODEL}").put("sdk", Build.VERSION.SDK_INT)
      .put("coordinateFrame", "arcore-session-camera-not-base")
      .put("autonomousMotionEnabled", false).put("mapPersisted", false)
      .put("depthPollIntervalMs", 500).put("position", JSONObject.NULL).put("running", false)
    buildUi()
    record(JSONObject().put("event", "opened").put("trackingState", "NOT_STARTED"))
  }

  private fun label(value: String, size: Float = 15f) = TextView(this).apply {
    text = value; textSize = size; setTextColor(Color.WHITE); setPadding(10, 8, 10, 8)
  }
  private fun button(value: String, action: () -> Unit) = Button(this).apply {
    text = value; isAllCaps = false; textSize = 13f; setOnClickListener { action() }
  }

  private fun buildUi() {
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(12, 19, 28)) }
    root.setPadding(20, 12, 20, 12)
    // Android 15 enforces edge-to-edge. Keep controls and title outside both
    // system bars and camera cutouts on either landscape orientation.
    root.setOnApplyWindowInsetsListener { view, insets ->
      if (Build.VERSION.SDK_INT >= 30) {
        val safe = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
        view.setPadding(20 + safe.left, 12 + safe.top, 20 + safe.right, 12 + safe.bottom)
      } else {
        view.setPadding(20 + insets.systemWindowInsetLeft, 12 + insets.systemWindowInsetTop,
          20 + insets.systemWindowInsetRight, 12 + insets.systemWindowInsetBottom)
      }
      insets
    }
    root.addView(label("房间视觉探针 · 本次仅观察，不控制底座", 19f))
    val body = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    root.addView(body, LinearLayout.LayoutParams(-1, 0, 1f))
    val camera = FrameLayout(this)
    surface = GLSurfaceView(this).apply {
      setEGLContextClientVersion(2)
      preserveEGLContextOnPause = true
      setRenderer(ProbeRenderer())
      renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
      onPause()
    }
    camera.addView(surface, FrameLayout.LayoutParams(-1, -1))
    camera.addView(label("后摄画面", 13f).apply { setBackgroundColor(0x99000000.toInt()) },
      FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START))
    body.addView(camera, LinearLayout.LayoutParams(0, -1, 1.1f))
    val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    val scroll = ScrollView(this).apply { addView(column) }
    body.addView(scroll, LinearLayout.LayoutParams(0, -1, 1f))
    status = label("检查 AR 服务后，点击开始采集。")
    metrics = label("位置轨迹只在本次会话内有效，不是房间地图。", 13f)
    depthLabel = label("深度：尚未采集", 13f)
    depthPreview = ImageView(this).apply { scaleType = ImageView.ScaleType.FIT_CENTER; setBackgroundColor(Color.BLACK) }
    trajectory = TrajectoryView(this)
    column.addView(status); column.addView(metrics); column.addView(depthLabel)
    column.addView(label("", 12f).apply {
      text = Html.fromHtml("本功能包含 Google ARCore，使用适用 <a href=\"https://policies.google.com/terms\">Google 服务条款</a> 和 <a href=\"https://policies.google.com/privacy\">隐私政策</a>。", Html.FROM_HTML_MODE_LEGACY)
      movementMethod = LinkMovementMethod.getInstance()
      setLinkTextColor(Color.CYAN)
    })
    column.addView(depthPreview, LinearLayout.LayoutParams(-1, dp(115)))
    column.addView(label("相机平面轨迹 · 非可通行地图", 13f))
    column.addView(trajectory, LinearLayout.LayoutParams(-1, dp(115)))
    val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    startButton = button("开始采集") {
      if (running || userWantsRunning) { userWantsRunning = false; pauseCapture("user-paused") }
      else { userWantsRunning = true; startCapture() }
    }
    modeButton = button("模式：原始深度") {
      if (!running) { rawPreferred = !rawPreferred; modeButton.text = if (rawPreferred) "模式：原始深度" else "模式：平滑深度" }
    }
    actions.addView(startButton, LinearLayout.LayoutParams(0, -2, 1f))
    actions.addView(modeButton, LinearLayout.LayoutParams(0, -2, 1f))
    actions.addView(button("安装 AR 服务") { installService() }, LinearLayout.LayoutParams(0, -2, 1f))
    actions.addView(button("保存记录") { saveReport() }, LinearLayout.LayoutParams(0, -2, 1f))
    actions.addView(button("返回") { finish() }, LinearLayout.LayoutParams(0, -2, 1f))
    root.addView(actions)
    setContentView(root)
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

  override fun onResume() {
    super.onResume()
    resumed = true
    rotation = windowManager.defaultDisplay.rotation
    if (userWantsRunning) startCapture() else checkService()
  }

  private fun checkService() {
    if (checking) return
    checking = true
    ArCoreApk.getInstance().checkAvailabilityAsync(this) { availability ->
      checking = false
      if (isFinishing || isDestroyed || !resumed || running) return@checkAvailabilityAsync
      status.text = when (availability) {
        ArCoreApk.Availability.SUPPORTED_INSTALLED -> "AR 服务已安装。点击开始采集，实际验证定位与深度。"
        ArCoreApk.Availability.SUPPORTED_NOT_INSTALLED -> "尚未安装 AR 服务。请点击安装 AR 服务；安装后回来开始采集。"
        ArCoreApk.Availability.SUPPORTED_APK_TOO_OLD -> "AR 服务版本过旧，请先更新。"
        ArCoreApk.Availability.UNSUPPORTED_DEVICE_NOT_CAPABLE -> "当前系统未通过 ARCore 兼容性检查，暂不能采集。"
        else -> "暂未确认 ARCore 支持状态（${availability.name}）。可检查网络或稍后重试。"
      }
      record(JSONObject().put("event", "availability").put("availability", availability.name))
    }
  }

  private fun installService() {
    // Only the official SDK / installed system store handles installation.
    try {
      val result = ArCoreApk.getInstance().requestInstall(this, true)
      status.text = if (result == ArCoreApk.InstallStatus.INSTALLED) "AR 服务已就绪，点击开始采集。" else "请完成 AR 服务安装后返回。"
    } catch (error: Exception) {
      recordError("install", error)
      try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.ar.core")))
        status.text = "在官方应用商店安装或更新 Google Play Services for AR，然后返回。"
      } catch (_: Exception) {
        status.text = "请在小米应用商店搜索 Google Play Services for AR（ARCore），安装后再回来；也可查看 Google 官方设备支持说明。"
      }
    }
  }

  private fun startCapture() {
    if (!resumed || running || closingForModeChange) return
    if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      if (!permissionPending) {
        permissionPending = true
        requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION)
      }
      return
    }
    try {
      if (session == null) {
        if (ArCoreApk.getInstance().requestInstall(this, !installRequested) == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
          installRequested = true
          status.text = "请完成 AR 服务安装，返回后继续采集。"
          return
        }
        session = Session(this)
        sessionId = UUID.randomUUID().toString()
        record(JSONObject().put("event", "session-created").put("position", JSONObject.NULL))
      }
      val current = requireNotNull(session)
      check(current.cameraConfig.facingDirection == CameraConfig.FacingDirection.BACK) { "Navigation probe requires the rear camera" }
      supportedAuto = current.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
      supportedRaw = current.isDepthModeSupported(Config.DepthMode.RAW_DEPTH_ONLY)
      activeMode = if (rawPreferred && supportedRaw) Config.DepthMode.RAW_DEPTH_ONLY
        else if (supportedAuto) Config.DepthMode.AUTOMATIC else Config.DepthMode.DISABLED
      // On this phone, changing RAW_DEPTH_ONLY -> AUTOMATIC on an existing
      // Session produced implausible dense distances; a clean Session did not.
      // Compare modes in isolated sessions, never reusing their coordinates.
      if (configuredDepthMode != null && configuredDepthMode != activeMode) {
        closingForModeChange = true
        session = null
        configuredDepthMode = null
        trajectory.points = emptyArray()
        trajectory.invalidate()
        startButton.isEnabled = false
        modeButton.isEnabled = false
        status.text = "正在切换为独立采集会话，旧轨迹不会沿用。"
        record(JSONObject().put("event", "mode-change-session-ended").put("position", JSONObject.NULL))
        io.execute {
          val closed = runCatching { current.close() }
          runOnUiThread {
            closingForModeChange = false
            if (isDestroyed || isFinishing) return@runOnUiThread
            startButton.isEnabled = true
            modeButton.isEnabled = true
            if (closed.isFailure) {
              userWantsRunning = false
              status.text = "旧会话未能正常结束，请返回后重新打开探针。"
              recordError("mode-close", closed.exceptionOrNull() as? Exception ?: IllegalStateException("Session close failed"))
            } else if (userWantsRunning && resumed) startCapture()
          }
        }
        return
      }
      current.configure(Config(current).apply {
        depthMode = activeMode
        focusMode = Config.FocusMode.AUTO
        planeFindingMode = Config.PlaneFindingMode.DISABLED
      })
      configuredDepthMode = activeMode
      current.resume()
      breakPath = true
      running = true
      surface.onResume()
      glResumed = true
      startButton.text = "暂停采集"
      modeButton.isEnabled = false
      status.text = "正在采集后摄。缓慢移动手机，等待跟踪和深度；底座不会自动移动。"
      val imageSize = current.cameraConfig.imageSize
      record(JSONObject().put("event", "resumed").put("depthMode", activeMode.name)
        .put("automaticSupported", supportedAuto).put("rawSupported", supportedRaw)
        .put("cameraId", current.cameraConfig.cameraId)
        .put("cameraImageWidth", imageSize.width).put("cameraImageHeight", imageSize.height))
    } catch (error: Exception) {
      userWantsRunning = false
      pauseCapture("start-failed")
      status.text = "无法启动采集：${error.javaClass.simpleName}。${error.message ?: "请检查 AR 服务、相机权限或系统兼容性。"}"
      recordError("start", error)
    }
  }

  private fun pauseCapture(reason: String) {
    running = false
    breakPath = true
    // GL must stop accessing Session before pause/close or camera handover.
    if (glResumed) { surface.onPause(); glResumed = false }
    runCatching { session?.pause() }
    startButton.text = "开始采集"
    modeButton.isEnabled = true
    depthPreview.setImageDrawable(null)
    depthLabel.text = "深度：已暂停，旧画面不作为当前观测"
    metrics.text = "采集已暂停。恢复后先等待定位；轨迹不连接中断区间。"
    status.text = "已暂停采集。"
    record(JSONObject().put("event", reason).put("running", false)
      .put("trackingState", "PAUSED").put("position", JSONObject.NULL)
      .put("quaternion", JSONObject.NULL).put("depthFresh", false).put("depthAgeMs", JSONObject.NULL)
      .put("depthTimestampNs", JSONObject.NULL).put("depthValidRatio", JSONObject.NULL)
      .put("depthMedianMm", JSONObject.NULL).put("depthNearP05Mm", JSONObject.NULL))
  }

  override fun onPause() {
    resumed = false
    pauseCapture("activity-paused")
    super.onPause()
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == CAMERA_PERMISSION) {
      permissionPending = false
      if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED && userWantsRunning) startCapture()
      else { userWantsRunning = false; status.text = "未获得相机权限，无法采集。可在系统权限设置中开启后重试。" }
    }
  }

  private fun recordError(stage: String, error: Exception) {
    record(JSONObject().put("event", "error").put("errorStage", stage)
      .put("errorType", error.javaClass.simpleName).put("error", (error.message ?: "").take(500)))
  }

  private fun record(fields: JSONObject) = synchronized(reportLock) {
    fields.put("epochMs", System.currentTimeMillis()).put("elapsedMs", SystemClock.elapsedRealtime())
    fields.put("sessionId", sessionId ?: JSONObject.NULL)
    val keys = fields.keys()
    while (keys.hasNext()) { val key = keys.next(); lastReport.put(key, fields.get(key)) }
    try {
      if (logRows < 3000) { logFile.appendText(fields.toString() + "\n"); logRows++ }
      lastReport.put("logRows", logRows).put("logLimitReached", logRows >= 3000)
      lastReport.put("logFile", logFile.name)
      val temp = File(directory, "latest.json.tmp")
      temp.writeText(lastReport.toString())
      check(temp.renameTo(File(directory, "latest.json")))
    } catch (_: Exception) {
      // Sensor rendering must not crash when storage is unavailable/full.
      lastReport.put("storageWriteFailed", true)
    }
  }

  private fun saveReport() {
    userWantsRunning = false
    pauseCapture("export-paused")
    try {
      val copy = File(cacheDir, "navigation-probe-export.ndjson")
      synchronized(reportLock) {
        copy.outputStream().use { output ->
          output.write((lastReport.toString() + "\n").toByteArray())
          if (logFile.exists()) logFile.inputStream().use { it.copyTo(output) }
        }
      }
      exportFile = copy
      startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        type = "application/x-ndjson"
        addCategory(Intent.CATEGORY_OPENABLE)
        putExtra(Intent.EXTRA_TITLE, "myyaya-${logFile.name}")
      }, SAVE_REPORT)
    } catch (error: Exception) { status.text = "无法保存记录：${error.message}" }
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    val uri = data?.data
    if (requestCode != SAVE_REPORT || resultCode != RESULT_OK || uri == null) return
    val file = exportFile ?: return
    io.execute {
      val result = runCatching {
        requireNotNull(contentResolver.openOutputStream(uri, "w")).use { output -> file.inputStream().use { it.copyTo(output) } }
      }
      runOnUiThread {
        if (!isDestroyed) Toast.makeText(this, if (result.isSuccess) "记录已保存；不含相机照片。" else "保存失败，请重试。", Toast.LENGTH_LONG).show()
      }
    }
  }

  override fun finish() {
    userWantsRunning = false
    pauseCapture("closed")
    setResult(RESULT_OK, Intent().putExtra("report", synchronized(reportLock) { lastReport.toString() }))
    super.finish()
  }

  override fun onDestroy() {
    val old = session
    session = null
    io.execute { runCatching { old?.close() } }
    io.shutdown()
    super.onDestroy()
  }

  private inner class ProbeRenderer : GLSurfaceView.Renderer {
    private var width = 1
    private var height = 1
    private var texture = 0
    private var program = 0
    private var initializationError: Exception? = null
    private var boundSession: Session? = null
    private var pathSession: Session? = null
    private val vertices = floats(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f))
    private val uv = floats(FloatArray(8))
    private var lastUiMs = 0L
    private var lastFrameNs = 0L
    private var lastDepthNs = 0L
    private var intervalFrames = 0
    private var intervalStart = SystemClock.elapsedRealtime()
    private var frames = 0L
    private var newDepthSamples = 0L
    private var previousTracking = false
    private var wasRunning = false
    private var segment = 0
    private val path = ArrayList<FloatArray>()

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
      try {
        initializationError = null
        val ids = IntArray(1)
        GLES20.glGenTextures(1, ids, 0)
        texture = ids[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texture)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        val vertex = shader(GLES20.GL_VERTEX_SHADER, "attribute vec2 p; attribute vec2 t; varying vec2 v; void main(){gl_Position=vec4(p,0.,1.);v=t;}")
        val fragment = shader(GLES20.GL_FRAGMENT_SHADER, "#extension GL_OES_EGL_image_external : require\nprecision mediump float; varying vec2 v; uniform samplerExternalOES camera; void main(){gl_FragColor=texture2D(camera,v);}")
        program = GLES20.glCreateProgram()
        GLES20.glAttachShader(program, vertex); GLES20.glAttachShader(program, fragment); GLES20.glLinkProgram(program)
        val linked = IntArray(1); GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, linked, 0)
        check(linked[0] != 0) { GLES20.glGetProgramInfoLog(program) }
        GLES20.glDeleteShader(vertex); GLES20.glDeleteShader(fragment)
        boundSession = null
      } catch (error: Exception) { initializationError = error; failRender(error) }
    }

    override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) { width = max(1, w); height = max(1, h) }

    override fun onDrawFrame(gl: GL10?) {
      GLES20.glViewport(0, 0, width, height)
      GLES20.glClearColor(0f, 0f, 0f, 1f)
      GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
      if (!running) { wasRunning = false; return }
      initializationError?.let { failRender(it); return }
      if (program == 0) return
      val current = session ?: return
      try {
        if (!wasRunning || breakPath) {
          wasRunning = true
          intervalStart = SystemClock.elapsedRealtime()
          intervalFrames = 0
          lastUiMs = 0
        }
        if (pathSession !== current) {
          path.clear(); segment = 0; frames = 0; newDepthSamples = 0
          lastFrameNs = 0; lastDepthNs = 0; lastUiMs = 0
          previousTracking = false
          pathSession = current
        }
        if (boundSession !== current) {
          current.setCameraTextureName(texture)
          boundSession = current
        }
        current.setDisplayGeometry(rotation, width, height)
        val frame = current.update()
        if (frame.timestamp == 0L) return
        vertices.position(0); uv.position(0)
        frame.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, vertices, Coordinates2d.TEXTURE_NORMALIZED, uv)
        GLES20.glUseProgram(program)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texture)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(program, "camera"), 0)
        val p = GLES20.glGetAttribLocation(program, "p"); val t = GLES20.glGetAttribLocation(program, "t")
        vertices.position(0); uv.position(0)
        GLES20.glVertexAttribPointer(p, 2, GLES20.GL_FLOAT, false, 0, vertices)
        GLES20.glVertexAttribPointer(t, 2, GLES20.GL_FLOAT, false, 0, uv)
        GLES20.glEnableVertexAttribArray(p); GLES20.glEnableVertexAttribArray(t)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(p); GLES20.glDisableVertexAttribArray(t)
        if (lastFrameNs != frame.timestamp) { frames++; intervalFrames++; lastFrameNs = frame.timestamp }
        val now = SystemClock.elapsedRealtime()
        if (now - lastUiMs < 500) return
        lastUiMs = now
        val tracking = frame.camera.trackingState == TrackingState.TRACKING
        if (breakPath || !tracking || !previousTracking) { segment++; breakPath = false }
        previousTracking = tracking
        val pose = if (tracking) frame.camera.pose else null
        if (pose != null) {
          path.add(floatArrayOf(pose.tx(), pose.tz(), segment.toFloat()))
          if (path.size > 1200) path.removeAt(0)
        }
        val fps = intervalFrames * 1000.0 / max(1L, now - intervalStart)
        intervalStart = now; intervalFrames = 0
        val row = JSONObject().put("event", "sample").put("running", true).put("frameTimestampNs", frame.timestamp)
          .put("trackingState", frame.camera.trackingState.name).put("trackingFailureReason", frame.camera.trackingFailureReason.name)
          .put("position", pose?.let { JSONArray(it.translation.toList()) } ?: JSONObject.NULL)
          .put("quaternion", pose?.let { JSONArray(it.rotationQuaternion.toList()) } ?: JSONObject.NULL)
          .put("frames", frames).put("cameraFps", fps).put("depthMode", activeMode.name)
          .put("depthFresh", false).put("depthTimestampNs", JSONObject.NULL).put("depthAgeMs", JSONObject.NULL)
          .put("depthValidRatio", JSONObject.NULL).put("depthMedianMm", JSONObject.NULL).put("depthNearP05Mm", JSONObject.NULL)
          .put("depthUnavailable", JSONObject.NULL)
          .put("displayRotation", rotation).put("previewWidth", width).put("previewHeight", height)
          .put("imageFocalLength", JSONArray(frame.camera.imageIntrinsics.focalLength.toList()))
          .put("imagePrincipalPoint", JSONArray(frame.camera.imageIntrinsics.principalPoint.toList()))
          .put("imageDimensions", JSONArray(frame.camera.imageIntrinsics.imageDimensions.toList()))
          .put("textureFocalLength", JSONArray(frame.camera.textureIntrinsics.focalLength.toList()))
          .put("texturePrincipalPoint", JSONArray(frame.camera.textureIntrinsics.principalPoint.toList()))
          .put("textureDimensions", JSONArray(frame.camera.textureIntrinsics.imageDimensions.toList()))
        val thermal = if (Build.VERSION.SDK_INT >= 29) getSystemService(PowerManager::class.java).currentThermalStatus else -1
        row.put("thermalStatus", thermal)
        var bitmap: Bitmap? = null
        var depthText = if (activeMode == Config.DepthMode.DISABLED) "当前配置不支持深度，仅采集位姿" else "暂未取得深度，请缓慢移动；未知区域不是可通行区域"
        if (tracking && activeMode != Config.DepthMode.DISABLED) {
          try {
            val raw = activeMode == Config.DepthMode.RAW_DEPTH_ONLY
            (if (raw) frame.acquireRawDepthImage16Bits() else frame.acquireDepthImage16Bits()).use { depth ->
              val confidence = if (raw) frame.acquireRawDepthConfidenceImage() else null
              try {
                if (confidence != null) require(confidence.width == depth.width && confidence.height == depth.height)
                val d = depth.planes[0]; val c = confidence?.planes?.get(0)
                val sample = DepthSamples.read(depth.width, depth.height,
                  DepthSamples.Plane(d.buffer, d.rowStride, d.pixelStride),
                  c?.let { DepthSamples.Plane(it.buffer, it.rowStride, it.pixelStride) })
                val fresh = depth.timestamp != lastDepthNs
                if (fresh) newDepthSamples++
                lastDepthNs = depth.timestamp
                val age = max(0.0, (frame.timestamp - depth.timestamp) / 1_000_000.0)
                row.put("depthFresh", fresh).put("depthTimestampNs", depth.timestamp).put("depthAgeMs", age)
                  .put("depthValidRatio", sample.validRatio).put("depthMedianMm", sample.medianMm ?: JSONObject.NULL)
                  .put("depthNearP05Mm", sample.nearP05Mm ?: JSONObject.NULL)
                  .put("depthWidth", depth.width).put("depthHeight", depth.height).put("depthSamples", newDepthSamples)
                  .put("confidenceThreshold", if (raw) 77 else JSONObject.NULL)
                bitmap = depthBitmap(sample)
                val distances = if (sample.medianMm == null) "尚无有效距离" else String.format(Locale.US,
                  "距离统计 P05 %.2fm / 中位 %.2fm（未校准）", (sample.nearP05Mm ?: 0) / 1000.0, sample.medianMm / 1000.0)
                depthText = String.format(Locale.US, "%s：%s %.0f%% · %s · 数据龄 %.0fms\n%s\n红近蓝远，黑色未知；深度图为传感器原始方向。",
                  if (raw) "原始深度" else "平滑深度", if (raw) "置信度通过" else "非零像素（含插值）",
                  sample.validRatio * 100, if (fresh) "新采样" else "重投影", age, distances)
              } finally { confidence?.close() }
            }
          } catch (_: NotYetAvailableException) {
            row.put("depthUnavailable", "NOT_YET_AVAILABLE")
          }
        }
        record(row)
        val snapshot = path.toTypedArray()
        val positionText = pose?.let { String.format(Locale.US, "相机位置 x %.2f / y %.2f / z %.2f 米", it.tx(), it.ty(), it.tz()) } ?: "位置无效：等待重新跟踪"
        val trackingText = if (tracking) "正在跟踪 · ${activeMode.name}" else "跟踪未就绪：${frame.camera.trackingFailureReason.name}"
        val info = String.format(Locale.US, "%s\n帧率 %.1f · 帧数 %d · 热状态 %d\n仅为相机轨迹，未标定为底座位置。", positionText, fps, frames, thermal)
        val image = bitmap
        runOnUiThread {
          if (!running || !resumed || isDestroyed) return@runOnUiThread
          status.text = trackingText; metrics.text = info; depthLabel.text = depthText
          depthPreview.setImageBitmap(image); trajectory.points = snapshot; trajectory.invalidate()
        }
      } catch (error: Exception) { failRender(error) }
    }

    private fun failRender(error: Exception) {
      if (!running) return
      running = false
      runOnUiThread {
        if (isDestroyed) return@runOnUiThread
        userWantsRunning = false
        pauseCapture("render-stopped")
        recordError("render", error)
        status.text = "采集已停止：${error.javaClass.simpleName}。请暂停其他相机应用后重试。"
      }
    }
  }

  private fun floats(values: FloatArray): FloatBuffer = ByteBuffer.allocateDirect(values.size * 4)
    .order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(values); position(0) }

  private fun shader(type: Int, source: String): Int {
    val id = GLES20.glCreateShader(type)
    GLES20.glShaderSource(id, source); GLES20.glCompileShader(id)
    val success = IntArray(1); GLES20.glGetShaderiv(id, GLES20.GL_COMPILE_STATUS, success, 0)
    check(success[0] != 0) { GLES20.glGetShaderInfoLog(id) }
    return id
  }

  private fun depthBitmap(sample: DepthSamples.Result): Bitmap {
    val colors = IntArray(sample.millimeters.size) { index ->
      val mm = sample.millimeters[index]
      if (mm == 0) Color.BLACK else Color.HSVToColor(floatArrayOf(min(240f, mm / 8000f * 240f), 0.9f, 1f))
    }
    return Bitmap.createBitmap(colors, sample.width, sample.height, Bitmap.Config.ARGB_8888)
  }

  private class TrajectoryView(activity: Activity) : View(activity) {
    var points = emptyArray<FloatArray>()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onDraw(canvas: Canvas) {
      super.onDraw(canvas)
      canvas.drawColor(Color.rgb(17, 31, 42))
      if (points.isEmpty()) return
      val minX = min(0f, points.minOf { it[0] }); val maxX = max(0f, points.maxOf { it[0] })
      val minZ = min(0f, points.minOf { it[1] }); val maxZ = max(0f, points.maxOf { it[1] })
      val scale = min((width - 30) / max(1f, maxX - minX), (height - 30) / max(1f, maxZ - minZ))
      fun px(p: FloatArray) = 15 + (p[0] - minX) * scale
      fun py(p: FloatArray) = 15 + (p[1] - minZ) * scale
      paint.color = Color.CYAN; paint.strokeWidth = 3f
      for (i in 1 until points.size) if (points[i][2] == points[i - 1][2]) {
        canvas.drawLine(px(points[i - 1]), py(points[i - 1]), px(points[i]), py(points[i]), paint)
      }
      paint.color = Color.YELLOW
      canvas.drawCircle(px(points.last()), py(points.last()), 5f, paint)
    }
  }

  companion object { private const val CAMERA_PERMISSION = 831; private const val SAVE_REPORT = 832 }
}
