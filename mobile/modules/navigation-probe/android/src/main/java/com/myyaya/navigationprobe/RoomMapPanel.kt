package com.myyaya.navigationprobe

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.*
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import androidx.core.content.FileProvider
import android.util.AtomicFile
import android.view.View
import android.widget.*
import com.google.ar.core.*
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

/** Native mapping UI. No motor APIs. All ARCore objects are accessed on the GL thread. */
internal class RoomMapPanel(private val activity: Activity, private val stopAndReset: () -> Unit,
  private val pauseOnly: () -> Unit, motor: RouteMotorGateway?=null) {
  private val directory = File(activity.filesDir,"room-maps").apply { mkdirs() }
  private val io = Executors.newSingleThreadExecutor()
  private val depthRecorder=DepthEvidenceRecorder(activity.getExternalFilesDir("navigation-probe") ?: activity.filesDir,io)
  private var depthOverlay: DepthOverlayView?=null
  @Volatile private var overlayEnabled=true
  private var lastOverlayNs=0L
  private var lastOutlineNs=0L
  @Volatile private var hybridReport: Map<String,Any?> = mapOf("status" to "WAITING")
  @Volatile private var localAssessment=RouteAssessment(RouteClearance.DEPTH_UNKNOWN,"GROUND_REFERENCE_REQUIRED")
  private val localMap=LocalNavigationMap()
  private val localPlannerWorker=Executors.newSingleThreadExecutor()
  private val localPlannerBusy=AtomicBoolean(false)
  @Volatile private var localSnapshot=LocalMapSnapshot()
  @Volatile private var localGoal: LocalGoal?=null
  @Volatile private var localPose: RoutePose?=null
  @Volatile private var localPlan=LocalPlan("WAITING",reason="GOAL_REQUIRED")
  @Volatile private var localPlanSampleNs=0L
  @Volatile private var localSweeps: Map<String,LocalSweepResult> = emptyMap()
  @Volatile private var lastLocalPlanNs=0L
  private lateinit var localView: LocalNavigationView
  private lateinit var localState: TextView
  @Volatile private var mapper: RoomMapper? = null
  private val taughtRoutes=motor?.let { TaughtRoutePanel(activity,it,{ mapper?.metadata() },{save(true)}) }
  @Volatile private var observedGround: GroundPlane?=null
  @Volatile private var freshMap = false
  @Volatile private var sessionId = ""
  @Volatile private var active = false
  @Volatile private var saving = false
  @Volatile private var pendingSave: RoomMapData? = null
  private val saveLock = Any()
  private var anchor: Anchor? = null
  private var stableImage: RigidPose? = null
  private var stableSince = 0L
  private var stableCount = 0
  private var lastTerrainUiNs = 0L
  @Volatile private var referenceState = "NOT_SEEN"
  @Volatile private var referenceMethod = "NOT_SEEN"
  @Volatile private var knownReferenceImages = 0
  @Volatile private var configuredReferenceImages = 0
  private val terrain=TerrainAnalysis()
  private val depthReadiness=LocalDepthReadiness()
  @Volatile private var depthState=LocalDepthReadiness.State()
  @Volatile private var terrainSnapshot=TerrainSnapshot(false,"SELECT_GROUND")
  @Volatile private var groundArmed=false
  @Volatile private var horizontalPlanes=0
  @Volatile private var groundTap: FloatArray?=null
  private data class GroundChoice(val plane: Plane?,val actualFloor: Boolean,val fitted: GroundPlane?=null)
  private data class HeightChoice(val height: Float,val actualFloor: Boolean)
  @Volatile private var pendingGround: GroundChoice?=null
  @Volatile private var pendingHeight: HeightChoice?=null
  @Volatile private var selectedGround: Plane?=null
  private var fittedGround: GroundPlane?=null
  private var calibratedHeight: Float?=null
  private var surfaceAnchor: Anchor?=null
  private val surfaceAnchorsToRelease=ConcurrentLinkedQueue<Anchor>()
  @Volatile private var surfaceAnchorState="NONE"
  @Volatile private var surfaceSource="NONE"
  private lateinit var terrainState: TextView
  private lateinit var terrainView: TerrainView
  private var capturedPhoto: File? = null
  @Volatile private var restoring = false
  private var deferredPhotoResult: (() -> Unit)? = null
  private var name = ""
  private lateinit var title: TextView
  private lateinit var state: TextView
  private lateinit var mapView: SurfaceMapView
  private lateinit var places: TextView
  private var exportBytes: ByteArray? = null
  @Volatile private var savedAt = 0L
  @Volatile private var savedId: String? = null
  @Volatile private var generation = 0
  @Volatile private var saveFailed = false

  init { terrain.setEnvelope(readEnvelope()) }
  fun attachDepthOverlay(view: DepthOverlayView) { depthOverlay=view }

  private fun label(value: String) = TextView(activity).apply {
    text=value; textSize=14f; setTextColor(Color.WHITE); setPadding(12,8,12,8)
  }
  private fun button(text: String, block: () -> Unit) = Button(activity).apply {
    this.text=text; textSize=13f; isAllCaps=false; setOnClickListener { block() }
  }
  fun buildColumn(): View = LinearLayout(activity).apply {
    orientation=LinearLayout.VERTICAL
    title=label("房间表面地图"); addView(title)
    state=label("新建地图后开始扫描。青色是观测到的表面，黑色是未知，不代表可通行区域。")
    val terrainActions=LinearLayout(activity)
    terrainActions.addView(button("点选平面") {
      if (!active) toast("请先开始扫描并恢复当前地图定位")
      else if (!depthState.ready) toast("深度正在准备，请先缓慢左右平移，稳住后再点选平面")
      else { groundArmed=true; terrainState.text="请点击左侧画面中的地板或测试台面，随后确认用途。" }
    }.apply { setOnLongClickListener { if (active) editCameraHeight() else toast("请先开始扫描");true } },LinearLayout.LayoutParams(0,-2,1f))
    terrainActions.addView(button("底座尺寸") { editEnvelope() },LinearLayout.LayoutParams(0,-2,1f))
    terrainActions.addView(button("清除判断") { clearTerrain(); renderTerrain() },LinearLayout.LayoutParams(0,-2,1f))
    terrainActions.addView(Button(activity).apply {
      text="叠加：开";textSize=13f;isAllCaps=false
      setOnClickListener { overlayEnabled=!overlayEnabled;text=if (overlayEnabled) "叠加：开" else "叠加：关"
        depthOverlay?.let { it.enabledOverlay=overlayEnabled;it.invalidate() } }
    },LinearLayout.LayoutParams(0,-2,1f))
    addView(terrainActions)
    terrainState=label("开始扫描后点选平面并确认用途；灰未知、青平面、红障碍、橙落差、绿候选。").apply { textSize=12f }
    addView(terrainState)
    terrainView=TerrainView(activity); addView(terrainView,LinearLayout.LayoutParams(-1,(130*resources.displayMetrics.density).toInt()))
    localState=label("局部分层：点下图选目标，只预览路线，不驱动底座。").apply { textSize=12f };addView(localState)
    localView=LocalNavigationView(activity) { goal -> localGoal=goal;localPlan=LocalPlan("WAITING",reason="PLANNING");localPlanSampleNs=0;lastLocalPlanNs=0L }.apply {
      contentDescription="局部分层地图，点选诊断目标，不驱动底座"
    }
    addView(localView,LinearLayout.LayoutParams(-1,(160*resources.displayMetrics.density).toInt()))
    addView(label(if(taughtRoutes==null) "绿色仅为候选，实际通行范围待验证；本页不会驱动底座。"
      else "路线试验仅在实际地面、姿态与方向校验通过后驱动；绿色仅为候选。").apply { textSize=11f })
    addView(state)
    mapView=SurfaceMapView(activity); addView(mapView,LinearLayout.LayoutParams(-1,(130*resources.displayMetrics.density).toInt()))
    places=label("尚无地点。扫描时可将当前位置命名为客厅、沙发旁等。"); addView(places)
    addView(label("保存并重新打开地图后，只有识别到已登记的固定参照图，才会恢复当前位置。未设置参照图的旧地图仅供查看。"))
    val first=LinearLayout(activity)
    first.addView(button("新建地图") { newMap() },LinearLayout.LayoutParams(0,-2,1f))
    first.addView(button("打开地图") { openMap() },LinearLayout.LayoutParams(0,-2,1f))
    first.addView(button("设置参照图") { chooseReference() },LinearLayout.LayoutParams(0,-2,1f))
    addView(first,1)
    taughtRoutes?.let { addView(it.buildView(),2) }
  }
  fun addActions(actions: LinearLayout) {
    taughtRoutes?.let { panel->actions.addView(button("停止导航") { panel.stop("用户停止") }.apply {
      setBackgroundColor(Color.rgb(180,38,38));setTextColor(Color.WHITE)
    },LinearLayout.LayoutParams(0,-2,1f)) }
    actions.addView(button("保存地图") { save() },LinearLayout.LayoutParams(0,-2,1f))
    actions.addView(button("标记地点") { addPlace() },LinearLayout.LayoutParams(0,-2,1f))
    actions.addView(button("导出地图") { export() },LinearLayout.LayoutParams(0,-2,1f))
  }

  private fun toast(message: String) { Toast.makeText(activity,message,Toast.LENGTH_LONG).show() }
  private fun readEnvelope(): RobotEnvelope? = runCatching {
    val prefs=activity.getSharedPreferences("terrain-envelope",0)
    RobotEnvelope(prefs.getFloat("width",0f),prefs.getFloat("length",0f),prefs.getFloat("height",0f),prefs.getFloat("margin",.05f))
  }.getOrNull()
  private fun editEnvelope() {
    val saved=readEnvelope()
    val content=LinearLayout(activity).apply { orientation=LinearLayout.VERTICAL; setPadding(28,4,28,4) }
    fun field(hint: String,value: Float?): EditText = EditText(activity).apply {
      this.hint=hint; inputType=8194; setSingleLine()
      if (value!=null) setText(java.lang.String.format(java.util.Locale.US,"%.1f",value*100))
      content.addView(this)
    }
    val width=field("最大宽度（厘米，10～100）",saved?.width)
    val length=field("最大前后长度（厘米，10～100）",saved?.length)
    val height=field("装好手机后的最高高度（厘米，10～200）",saved?.height)
    val margin=field("额外余量（厘米，2～30）",saved?.margin ?: .05f)
    val scroll=ScrollView(activity).apply { addView(content) }
    val dialog=AlertDialog.Builder(activity).setTitle("整车尺寸与余量").setMessage("按装好手机后的最大尺寸填写。默认余量5厘米，后续可调整。")
      .setView(scroll).setNegativeButton("取消",null).setPositiveButton("保存",null).create()
    dialog.setOnShowListener {
      // Constrain the custom panel so the save button stays visible in landscape.
      scroll.layoutParams=android.widget.FrameLayout.LayoutParams(-1,(activity.resources.displayMetrics.heightPixels*.35f).toInt())
      dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
        val value=runCatching { RobotEnvelope(width.text.toString().toFloat()/100,length.text.toString().toFloat()/100,
          height.text.toString().toFloat()/100,margin.text.toString().toFloat()/100) }.getOrNull()
        if (value==null) { toast("请在提示范围内填写完整长、宽、高和余量"); return@setOnClickListener }
        activity.getSharedPreferences("terrain-envelope",0).edit().putFloat("width",value.width).putFloat("length",value.length)
          .putFloat("height",value.height).putFloat("margin",value.margin).apply()
        terrain.setEnvelope(value);localMap.reset();localSnapshot=LocalMapSnapshot();localSweeps=emptyMap();localPlan=LocalPlan("WAITING")
        terrainSnapshot=terrainSnapshot.copy(status="OBSERVING",cells=emptyList(),envelope=value,depthEvidence=TerrainDepthEvidence())
        renderTerrain(); dialog.dismiss()
      }
    }
    dialog.show()
  }
  private fun clearTerrain(status: String="SELECT_GROUND") {
    observedGround=null
    surfaceAnchor?.let { surfaceAnchorsToRelease.add(it) };surfaceAnchor=null;surfaceAnchorState="NONE"
    groundArmed=false; groundTap=null; pendingGround=null; pendingHeight=null;selectedGround=null;fittedGround=null;calibratedHeight=null;surfaceSource="NONE";terrain.reset()
    terrainSnapshot=TerrainSnapshot(false,status,envelope=readEnvelope())
    hybridReport=mapOf("status" to "WAITING")
    localAssessment=RouteAssessment(RouteClearance.DEPTH_UNKNOWN,"GROUND_REFERENCE_REQUIRED")
    localMap.reset();localSnapshot=LocalMapSnapshot();localPose=null;localGoal=null;localSweeps=emptyMap()
    localPlan=LocalPlan("WAITING",reason="GROUND_REFERENCE_REQUIRED");localPlanSampleNs=0;lastLocalPlanNs=0
    activity.runOnUiThread { depthOverlay?.let { it.dots=emptyList();it.outlines=emptyList();it.invalidate() } }
  }
  private fun editCameraHeight() {
    if (!depthState.ready) { toast("请先缓慢平移，等待近处深度就绪；再将底座放平，按实测姿态标定");return }
    val input=EditText(activity).apply {
      inputType=8194;setSingleLine();hint="主镜头中心距平面的垂直高度（厘米）"
      val value=activity.getSharedPreferences("terrain-camera",0).getFloat("height",0f)
      if (value>0) setText(java.lang.String.format(java.util.Locale.US,"%.1f",value*100))
    }
    val dialog=AlertDialog.Builder(activity).setTitle("镜头高度标定")
      .setMessage("底座放平，在测量时的头部姿态填写镜头中心高度，不是整机高度。\n高度只用于建立初始参考面；之后抬头、低头或升降用实时相机位姿补偿，不强行保持同一镜头高度。跟踪丢失后需重新确认。")
      .setView(input).setNegativeButton("取消",null).setNeutralButton("台面试验",null).setPositiveButton("实际地面",null).create()
    dialog.setOnShowListener {
      fun choose(actualFloor: Boolean) {
        val h=input.text.toString().toFloatOrNull()?.div(100)
        if (h==null || !h.isFinite() || h !in .03f..2.5f) { input.error="请填写3～250厘米的实测镜头高度";return }
        if (!active || !depthState.ready) { toast("深度暂不可用，请恢复扫描后再确认标定");dialog.dismiss();return }
        activity.getSharedPreferences("terrain-camera",0).edit().putFloat("height",h).apply()
        pendingHeight=HeightChoice(h,actualFloor);dialog.dismiss()
      }
      dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener { choose(false) }
      dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { choose(true) }
    }
    dialog.show()
  }
  fun cameraTapped(x: Float,y: Float): Boolean {
    if (!groundArmed || !x.isFinite() || !y.isFinite()) return false
    groundArmed=false; groundTap=floatArrayOf(x,y); return true
  }
  private fun renderTerrain() {
    if (!::terrainState.isInitialized) return
    val s=terrainSnapshot; val r=s.report()
    val message=when (s.status) {
      "LOCALIZATION_REQUIRED" -> "定位无效，已清除本次判断。请恢复定位后重新点选地面。"
      "GROUND_LOST" -> "所选平面跟踪已丢失，请重新点选实际地面。"
      "CAMERA_HEIGHT_INVALID" -> "相机不在所选地面上方的有效高度内，请重新确认实际地面。"
      "SELECT_GROUND","CLOCK_RESET" -> if (horizontalPlanes>0) "已检测水平面 $horizontalPlanes 个，请点击青色边界内的地板或台面并确认用途。" else "尚在检测水平面，请缓慢扫描后点选地板或台面。"
      else -> "${if (s.floorConfirmed) "地面判断" else "台面试验（非地板）"} · ${when (surfaceSource) { "MEASURED_HEIGHT" -> "已测镜头高度参考面";"RAW_DEPTH_PATCH" -> "深度邻域拟合参考面";else -> "已选水平面" }}\n已测地面格 ${r["groundCells"]} / 障碍 ${r["obstacleCells"]} / 整车覆盖中心 ${if (s.floorConfirmed) r["candidateCenterCells"] else r["benchCandidateCenterCells"]} · 相机高 ${s.cameraHeight?.let { "%.0f厘米".format(it*100) } ?: "待测"}"
    }
    val sampling=when (s.depthEvidence.blockingReason) {
      "DEPTH_UNAVAILABLE","DEPTH_STALE" -> "深度尚未更新，请缓慢左右平移。"
      "NO_PROJECTED_POINTS" -> "有效深度不足，请扫描较近且有纹理的区域。"
      "NO_PLANE_OBSERVATIONS" -> "尚无贴近平面的有效深度，请核对所选平面并向下扫描。"
      "PLANE_EVIDENCE_INSUFFICIENT" -> "平面采样还不充分，请缓慢扫描有纹理的区域。"
      "PLANE_HEIGHT_CONFLICT" -> "平面观测中混有高度差，请核对平面并扫描开阔区域。"
      "FOOTPRINT_NOT_COVERED" -> "已看到局部平面，整车范围仍有未知或障碍。"
      else -> ""
    }
    val warmup=if (active && !depthState.ready) "深度准备中：请缓慢左右平移，等待近处观测。${if (!s.groundSelected) "就绪后再点选平面或标定高度。" else "当前参考面保留，旧观测会过期。"}\n" else ""
    val local=when(localAssessment.clearance) {
      RouteClearance.OBSTACLE -> "车前观测：有障碍/落差点"
      RouteClearance.CLEAR -> "车前取样通过；仍需路线与动作校验"
      else -> when(localAssessment.reason) {
        "LOCAL_COVERAGE_INCOMPLETE" -> "车前缺观测："+localAssessment.sectorSamples.indices.filter { localAssessment.sectorSamples[it]<2 }.joinToString("、") { RouteAssessment.SECTORS[it] }
        "FRESH_RAW_REQUIRED" -> "车前观测：等待新鲜原始深度"
        "GROUND_REFERENCE_REQUIRED" -> "车前观测：先建立参考面"
        "LOCALIZATION_REQUIRED" -> "车前观测：等待定位"
        else -> "车前观测：原始深度不足"
      }
    }
    if (!groundArmed) terrainState.text=warmup+message+(if (s.groundSelected && sampling.isNotEmpty()) "\n$sampling" else "")+"\n$local\n灰未知 / 青地面 / 红障碍 / 橙落差 / 绿整车覆盖（诊断）"
    terrainView.snapshot=s; terrainView.invalidate()
    if(::localView.isInitialized) {
      val rLocal=localSnapshot.report()
      fun describe(result: LocalSweepResult?)=when(result?.state) {
        "GEOMETRY_CLEAR"->"几何检查通过（仅预览）"
        "OBSTACLE_IN_SWEEP"->"障碍阻挡"
        "DROP_IN_SWEEP"->"落差阻挡"
        "UNOBSERVED_SWEEP"->"缺观测${result.unknown}格（车下${result.initialUnknown}）"
        "OBSERVATION_EXPIRED"->"需更新观测${result.stale}格"
        else->"等待新鲜深度/参考面"
      }
      val waiting=when(localPlan.reason) {
        "FRESH_RAW_REQUIRED"->"等待新鲜深度"
        "UNOBSERVED_SWEEP"->"起步或下一段还有未观察范围"
        "OBSTACLE_IN_SWEEP"->"这段范围有障碍"
        "DROP_IN_SWEEP"->"这段范围有落差"
        "OBSERVATION_EXPIRED"->"需要更新这段地面观测"
        "SEARCH_BUDGET_NO_REACHABLE_FRONTIER"->"当前范围内暂未找到可达边界"
        "NO_REACHABLE_FREE_FRONTIER"->"周围暂时没有已验证的可达边界"
        "PLANNING","OBSERVATION_OR_POSE_CHANGED"->"正在更新路线"
        "GROUND_CHANGED","GROUND_REFERENCE_REQUIRED"->"请先确认地面参考"
        "PLANNING_FAILED"->"本次规划未完成，请重新选目标"
        else->"等待有效定位和地面观测"
      }
      localState.text="局部分层：保留地面${rLocal["retainedFloorTiles"]} / 近期空地${rLocal["recentFreeTiles"]} / 障碍${rLocal["obstacleTiles"]} / 单帧告警${rLocal["weakObstacleTiles"]}\n"+
        "假设直行2厘米：${describe(localSweeps["straight2cm"])}；左/右转10°：${describe(localSweeps["left10deg"])}/${describe(localSweeps["right10deg"])}\n"+
        when(localPlan.state) {
          "PATH_TO_GOAL"->"已找到局部路线，仅预览；脉冲距离与安装偏移待实测"
          "PATH_TO_FRONTIER"->"先到已知空地边界再观察，仅预览"
          "AT_GOAL"->"已在所选目标附近，仅预览"
          else->if(localGoal==null) "点下图选目标，仅预览；黑色未知不当空地" else "路线等待：$waiting"
        }
      localView.snapshot=localSnapshot;localView.pose=localPose;localView.goal=localGoal;localView.plan=localPlan
      localView.robot=s.envelope;localView.invalidate()
    }
  }
  private fun newMap() {
    if (saving) { toast("正在保存地图，请稍后"); return }
    val input=EditText(activity).apply { hint="例如：客厅"; setSingleLine() }
    AlertDialog.Builder(activity).setTitle("新建房间地图").setView(input)
      .setMessage("当前地图会先保存。先人工带领扫描，不会驱动底座。")
      .setNegativeButton("取消",null).setPositiveButton("新建") { _,_ ->
        val clean=input.text.toString().trim().take(40)
        if (clean.isEmpty()) { toast("请填写地图名称"); return@setPositiveButton }
        replaceAfterSave {
          name=clean; freshMap=true
          mapper=RoomMapper(RoomMapData(name=clean,sessionId="pending"))
          render(mapper!!.snapshot(),"新地图已建立。可先设置参照图，再点击开始扫描。")
        }
      }.show()
  }
  private fun replaceAfterSave(action: () -> Unit) {
    stopAndReset()
    val previous=mapper?.snapshot()
    saving=true
    io.execute {
      val result=runCatching { if (previous != null) write(previous) }
      activity.runOnUiThread {
        saving=false
        if (!activity.isDestroyed) {
          if (result.isSuccess) action() else toast("当前地图保存失败，未切换：${result.exceptionOrNull()?.message}")
        }
      }
    }
  }
  private fun openMap() {
    if (saving) { toast("正在保存地图，请稍后"); return }
    // Read on IO thread; corrupt maps never replace the current map.
    io.execute {
      val maps=directory.listFiles()?.filter { it.extension=="yayamap" }?.sortedByDescending { it.lastModified() }
        ?.mapNotNull { file -> runCatching { read(file) }.getOrNull() } ?: emptyList()
      activity.runOnUiThread {
        if (activity.isDestroyed) return@runOnUiThread
        if (maps.isEmpty()) { toast("暂无可打开的地图；损坏的文件不会载入。"); return@runOnUiThread }
        AlertDialog.Builder(activity).setTitle("打开房间地图")
          .setItems(maps.map { "${it.name} · ${it.voxels.size} 表面点 · ${it.places.size} 地点" }.toTypedArray()) { _,index ->
            replaceAfterSave {
              val selected=maps[index]
              val map=mapper?.snapshot()?.takeIf { it.id==selected.id } ?: selected
              mapper=RoomMapper(map); freshMap=false; name=map.name
              render(map,if (map.referenceJpeg.isEmpty()) "旧地图已打开，仅供查看。未登记固定参照图，不能恢复位置或追加扫描。"
                else "旧地图已打开，当前位置无效。开始扫描后，将后摄对准原位置的参照图。")
            }
          }.setNegativeButton("取消",null).show()
      }
    }
  }
  private fun chooseReference() {
    if (saving || restoring) { toast("正在保存或恢复地图，请稍后"); return }
    val map=mapper?.snapshot() ?: run { toast("请先新建地图"); return }
    if (map.voxels.isNotEmpty() || map.path.isNotEmpty()) { toast("参照图需在首次扫描前设置；已有地图请新建后设置。"); return }
    AlertDialog.Builder(activity).setTitle("登记固定参照图")
      .setMessage("选择固定平面照片或海报的原图，也可选实物照片并校正四角。之后输入图像实际宽高。不要选二维码、简单线条或重复纹理；登记后实物不能移动。")
      .setNegativeButton("取消",null).setNeutralButton("用后摄拍摄") { _,_ -> captureReference() }
      .setPositiveButton("选择图片") { _,_ ->
        stopAndReset()
        activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          type="image/*"; addCategory(Intent.CATEGORY_OPENABLE)
        },SELECT_REFERENCE)
      }.show()
  }
  private fun captureReference() {
    stopAndReset()
    val map=mapper?.snapshot() ?: return
    saving=true
    io.execute {
      val result=runCatching {
        write(map)
        val dir=File(activity.cacheDir,"reference-photo").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        File.createTempFile("reference-",".jpg",dir)
      }
      activity.runOnUiThread {
        saving=false
        if (activity.isDestroyed || activity.isFinishing) return@runOnUiThread
        val file=result.getOrNull() ?: run { toast("拍摄准备失败，请重试"); return@runOnUiThread }
        capturedPhoto=file
        val uri=photoUri(file)
        try {
          activity.startActivityForResult(Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT,uri)
            putExtra("android.intent.extras.CAMERA_FACING",0)
            clipData=android.content.ClipData.newRawUri("参照图",uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
          },CAPTURE_REFERENCE)
        } catch (_: Exception) { clearCapturedPhoto(); toast("未找到可用相机，请拍摄后从相册选择") }
      }
    }
  }
  private fun photoUri(file: File)=FileProvider.getUriForFile(activity,activity.packageName+".myyaya.reference-photo",file)
  private fun clearCapturedPhoto() {
    capturedPhoto?.let { file ->
      runCatching { activity.revokeUriPermission(photoUri(file),Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
      file.delete()
    }
    capturedPhoto=null
  }
  fun saveState(out: Bundle) {
    out.putString("room-map-id",mapper?.snapshot()?.id)
    out.putString("room-reference-photo",capturedPhoto?.name)
    save(true)
  }
  fun restoreState(saved: Bundle?) {
    val id=saved?.getString("room-map-id") ?: return
    if (runCatching { UUID.fromString(id).toString()==id }.getOrDefault(false).not()) return
    saved.getString("room-reference-photo")?.takeIf { it.matches(Regex("reference-[A-Za-z0-9-]+\\.jpg")) }?.let {
      capturedPhoto=File(activity.cacheDir,"reference-photo/$it")
    }
    restoring=true
    io.execute {
      val result=runCatching { read(File(directory,"$id.yayamap")) }
      activity.runOnUiThread {
        restoring=false
        if (activity.isDestroyed) return@runOnUiThread
        result.onSuccess { mapper=RoomMapper(it); freshMap=it.sessionId=="pending"; name=it.name; render(it,"地图已恢复，开始扫描后重新定位。") }
          .onFailure { toast("地图恢复失败，请重新打开地图") }
        deferredPhotoResult?.also { deferredPhotoResult=null; it() }
      }
    }
  }
  fun activityResult(request: Int,result: Int,data: Intent?): Boolean {
    if (request==CAPTURE_REFERENCE) {
      if (restoring) { deferredPhotoResult={ activityResult(request,result,data); Unit }; return true }
      val file=capturedPhoto
      if (result==Activity.RESULT_OK && file!=null && file.length()>0 && mapper!=null) editReference(photoUri(file),true)
      else { clearCapturedPhoto(); toast("已取消拍摄，原参照图未修改") }
      return true
    }
    if (request != SELECT_REFERENCE && request != EXPORT_MAP) return false
    if (result != Activity.RESULT_OK) return true
    val uri=data?.data ?: return true
    if (request==EXPORT_MAP) {
      val bytes=exportBytes ?: return true; exportBytes=null
      io.execute {
        val saved=runCatching { requireNotNull(activity.contentResolver.openOutputStream(uri,"w")).use { it.write(bytes) } }
        activity.runOnUiThread { toast(if (saved.isSuccess) "地图已导出，包含参照图（若有）、地点与表面点。" else "导出失败，请重试") }
      }
    } else editReference(uri,false)
    return true
  }
  private fun editReference(uri: Uri,fromCamera: Boolean) {
    io.execute {
      val decoded=runCatching { decodeReference(uri) }
      activity.runOnUiThread {
        if (fromCamera) clearCapturedPhoto()
        if (activity.isDestroyed) { decoded.getOrNull()?.recycle(); return@runOnUiThread }
        val image=decoded.getOrNull()
        if (image==null) { toast("图片无法读取，请选择清晰的静态图片"); return@runOnUiThread }
        ReferenceImageEditor(activity,image) { bytes,meters ->
          val map=mapper?.snapshot() ?: return@ReferenceImageEditor
          mapper=RoomMapper(map.copy(referenceJpeg=bytes,referenceWidth=meters,imageFromMap=null))
          render(mapper!!.snapshot(),"参照图已登记。开始扫描，将后摄对准固定图片，保持约两秒以对齐地图。")
          save(true)
        }.show()
      }
    }
  }
  private fun decodeReference(uri: Uri): Bitmap {
    val options=BitmapFactory.Options().apply { inJustDecodeBounds=true }
    activity.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it,null,options) }
    require(options.outWidth >= 300 && options.outHeight >= 300)
    require(options.outWidth <= 30000 && options.outHeight <= 30000)
    var scale=1; while (max(options.outWidth,options.outHeight)/scale > 4096) scale*=2
    val bitmap=activity.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it,null,BitmapFactory.Options().apply { inSampleSize=scale }) } ?: error("图片解码失败")
    val orientation=runCatching { activity.contentResolver.openInputStream(uri).use { android.media.ExifInterface(requireNotNull(it)).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION,1) } }.getOrDefault(1)
    if (orientation==1) return bitmap
    val matrix=Matrix().apply { when (orientation) {
      2 -> postScale(-1f,1f); 3 -> postRotate(180f); 4 -> postScale(1f,-1f)
      5 -> { postScale(-1f,1f); postRotate(270f) }; 6 -> postRotate(90f)
      7 -> { postScale(-1f,1f); postRotate(90f) }; 8 -> postRotate(270f)
    } }
    return Bitmap.createBitmap(bitmap,0,0,bitmap.width,bitmap.height,matrix,true).also { if (it!==bitmap) bitmap.recycle() }
  }
  private fun addPlace() {
    val current=mapper ?: run { toast("请先新建或打开地图"); return }
    if (!active || current.livePosition==null) { toast("当前地图定位无效，请先开始扫描并恢复定位"); return }
    val input=EditText(activity).apply { hint="例如：客厅 / 沙发旁"; setSingleLine() }
    AlertDialog.Builder(activity).setTitle("将当前位置记为地点").setView(input)
      .setMessage("记录的是后摄位置。同名地点会更新；此版本不会自动行驶。")
      .setNegativeButton("取消",null).setPositiveButton("保存地点") { _,_ ->
        runCatching {
          check(active) { "采集已暂停，请恢复定位后重试" }
          current.addPlace(input.text.toString()); save()
        }.onFailure { toast(it.message ?: "无法添加地点") }
      }.show()
  }
  fun save(quiet: Boolean=false) {
    val map=mapper?.snapshot() ?: run { if (!quiet) toast("暂无地图"); return }
    synchronized(saveLock) {
      if (saving) { pendingSave=map; if (!quiet) toast("正在保存最新地图"); return }
      saving=true
    }
    io.execute {
      var next: RoomMapData? = map
      var result: Result<Unit> = Result.success(Unit)
      while (next != null) {
        val current=next
        result=runCatching { write(current) }
        saveFailed=result.isFailure
        synchronized(saveLock) {
          next=pendingSave; pendingSave=null
          if (next==null) saving=false
        }
      }
      val success=result.isSuccess
      activity.runOnUiThread {
        if (!quiet && !activity.isDestroyed) toast(if (success) "地图已保存：${map.name}（${map.voxels.size} 表面点）" else "保存失败，请检查存储空间后重试")
      }
    }
  }
  private fun export() {
    pauseOnly()
    val map=mapper?.snapshot() ?: run { toast("暂无地图"); return }
    io.execute {
      val result=runCatching { write(map); RoomMapCodec.encode(map) }
      activity.runOnUiThread {
        if (activity.isDestroyed) return@runOnUiThread
        exportBytes=result.getOrNull() ?: run { toast("地图保存失败，无法导出"); return@runOnUiThread }
        activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
          type="application/octet-stream"; addCategory(Intent.CATEGORY_OPENABLE)
          putExtra(Intent.EXTRA_TITLE,"${map.name}.yayamap")
        },EXPORT_MAP)
      }
    }
  }
  private fun write(map: RoomMapData) {
    val target=AtomicFile(File(directory,"${map.id}.yayamap"))
    val bytes=RoomMapCodec.encode(map)
    val output=target.startWrite()
    try { output.write(bytes); target.finishWrite(output) }
    catch (error: Throwable) { target.failWrite(output); throw error }
    savedId=map.id; savedAt=System.currentTimeMillis()
  }
  private fun read(file: File): RoomMapData {
    val atomic=AtomicFile(file)
    return atomic.openRead().use { input ->
      val bytes=input.readBytesLimited(RoomMapCodec.MAX_BYTES)
      RoomMapCodec.decode(bytes).also { require(file.name=="${it.id}.yayamap") }
    }
  }
  private fun java.io.InputStream.readBytesLimited(limit: Int): ByteArray {
    val out=ByteArrayOutputStream(); val buffer=ByteArray(8192)
    while (true) { val n=read(buffer); if (n<0) break; require(out.size()+n<=limit); out.write(buffer,0,n) }
    return out.toByteArray()
  }

  /** Before Session.configure. Called on UI thread while GL is stopped. */
  fun configure(session: Session,id: String,config: Config) {
    lastTerrainUiNs=0
    depthReadiness.reset();depthState=LocalDepthReadiness.State()
    generation++
    clearTerrain()
    horizontalPlanes=0
    referenceState="NOT_SEEN"; referenceMethod="NOT_SEEN"; knownReferenceImages=0
    configuredReferenceImages=0
    runCatching { anchor?.detach() }; anchor=null; stableImage=null; stableCount=0; stableSince=0
    sessionId=id
    if (freshMap) {
      mapper=mapper?.snapshot()?.let { RoomMapper(it.copy(sessionId=id)) }; freshMap=false
    }
    val current=mapper ?: return
    current.bindSession(id)
    val map=current.snapshot()
    if (map.referenceJpeg.isNotEmpty()) {
      val bitmap=BitmapFactory.decodeByteArray(map.referenceJpeg,0,map.referenceJpeg.size) ?: error("参照图无法解码")
      try {
        config.augmentedImageDatabase=AugmentedImageDatabase(session).apply { addImage("room-reference",bitmap,map.referenceWidth) }
        configuredReferenceImages=config.augmentedImageDatabase.numImages
        check(configuredReferenceImages==1) { "参照图库未正确配置" }
      } finally { bitmap.recycle() }
    }
  }
  fun pause() { taughtRoutes?.pause();generation++; active=false; depthReadiness.reset();depthState=LocalDepthReadiness.State();mapper?.invalidate(); clearTerrain(); renderTerrain(); if (::mapView.isInitialized) { mapView.position=null; mapView.forward=null; mapView.invalidate(); state.text="扫描已暂停，当前位置无效。地图可保存或重新打开。" } }
  fun close() { io.shutdown();localPlannerWorker.shutdown() }
  fun report(): Map<String,Any?>? = mapper?.summary()?.let { it + mapOf("lastSavedAt" to if (it["mapId"]==savedId) savedAt else 0L,
    "taughtRoute" to taughtRoutes?.report(),
    "referenceTrackingState" to referenceState,"referenceTrackingMethod" to referenceMethod,
    "configuredReferenceImages" to configuredReferenceImages,
    "knownReferenceImages" to knownReferenceImages,"stableReferenceSamples" to stableCount,
    "terrain" to (terrainSnapshot.report()+mapOf("trackedHorizontalPlanes" to horizontalPlanes,"surfaceSource" to surfaceSource,
      "calibratedCameraHeightMeters" to calibratedHeight,"hybridDepth" to hybridReport,"localObservation" to localAssessment.report(),
      "layeredLocalMap" to (localSnapshot.report()+mapOf("source" to "confidence-filtered-raw-only",
        "initialFootprintSeeded" to false,"mountCalibrated" to false,"hypotheticalStopDistanceMeters" to .01f,
        "poseUncertaintyMeters" to .01f,"shortSweeps" to localSweeps.mapValues { it.value.report() },
        "goal" to localGoal?.let { listOf(it.x,it.z) },"planSampleNs" to localPlanSampleNs,"plan" to localPlan.report())),
      "surfaceAnchorTrackingState" to surfaceAnchorState,
      "depthReadiness" to depthState.report(),
      "depthCapture" to depthRecorder.report()))) }
  fun canStart() = mapper != null && !saving && !restoring
  fun stopTaughtRoute(reason: String) { taughtRoutes?.stop(reason) }
  fun openTaughtRoute(id: String) {
    runCatching {
      require(UUID.fromString(id).toString()==id)
      val file=File(activity.filesDir,"taught-routes/$id.yayaroute");require(file.length() in 32..64000)
      val route=TaughtRouteCodec.decode(file.readBytes());require(UUID.fromString(route.mapId).toString()==route.mapId)
      val map=read(File(directory,"${route.mapId}.yayamap"));mapper=RoomMapper(map);freshMap=false;name=map.name
      taughtRoutes?.selectInitial(route);render(map,"已打开路线所属地图。开始扫描后识别同一固定参照图恢复定位。")
    }.onFailure { toast("无法打开指定路线：${it.message}") }
  }
  fun newPlaybackMap() {
    mapper=RoomMapper(RoomMapData(name="录制回放",sessionId="pending"));freshMap=true
    mapper?.snapshot()?.let { render(it,"录制回放，不驱动底座。点击开始扫描后可分析已录场景。") }
  }
  /** GL thread, depth sampled at up to 10 Hz; view snapshots limited to 2 Hz. */
  fun frame(session: Session, frame: Frame, sample: DepthSamples.Result?, depthNs: Long,
    dense: DepthSamples.Result?=null,denseNs: Long=0) {
    while (true) {
      val old=surfaceAnchorsToRelease.poll() ?: break
      runCatching { old.detach() }
    }
    val token=generation
    val current=mapper ?: return
    val tracking=frame.camera.trackingState==TrackingState.TRACKING
    horizontalPlanes=if (tracking) session.getAllTrackables(Plane::class.java).count {
      it.trackingState==TrackingState.TRACKING && it.type==Plane.Type.HORIZONTAL_UPWARD_FACING && it.subsumedBy==null
    } else 0
    if (tracking && frame.timestamp-lastOutlineNs>=500_000_000L) {
      lastOutlineNs=frame.timestamp
      drawPlaneOutlines(session,frame,token)
    }
    val hasReference=current.snapshotReference()
    if (!tracking) { anchor?.detach(); anchor=null; stableImage=null; stableCount=0 }
    if (anchor?.trackingState==TrackingState.STOPPED) { anchor?.detach(); anchor=null; stableImage=null; stableCount=0 }
    if (hasReference && tracking && anchor==null) {
      // Frame.getUpdatedTrackables contains only this frame's changes. Polling
      // at 2 Hz can miss a transition from the 30 Hz Session.update loop.
      // Consult the current session's known objects, never a previous session.
      val known=session.getAllTrackables(AugmentedImage::class.java).filter {
        it.name=="room-reference" && it.trackingState!=TrackingState.STOPPED
      }
      knownReferenceImages=known.size
      val image=known.firstOrNull {
        it.trackingState==TrackingState.TRACKING && it.trackingMethod==AugmentedImage.TrackingMethod.FULL_TRACKING
      }
      (image ?: known.firstOrNull())?.let { referenceState=it.trackingState.name; referenceMethod=it.trackingMethod.name }
        ?: run { referenceState="NOT_SEEN"; referenceMethod="NOT_SEEN" }
      if (image==null) { stableImage=null; stableCount=0 }
      else {
        val pose=rigid(image.centerPose); val previous=stableImage
        val stable=previous!=null && (0..2).sumOf { ((pose.t[it]-previous.t[it]).pow(2)).toDouble() } < .0025 &&
          abs((0..3).sumOf { (pose.q[it]*previous.q[it]).toDouble() }) > .996
        if (!stable) { stableSince=frame.timestamp; stableCount=0 }
        stableImage=pose; stableCount++
        if (stableCount >= 3 && frame.timestamp-stableSince >= 1_000_000_000L) {
          anchor=image.createAnchor(image.centerPose)
        }
      }
    }
    if (hasReference) {
      val fixed=anchor
      if (fixed!=null && fixed.trackingState==TrackingState.TRACKING && tracking) current.alignReference(sessionId,rigid(fixed.pose))
      else current.invalidate()
    }
    val located=current.observePose(sessionId,rigid(frame.camera.pose),tracking && (!hasReference || anchor?.trackingState==TrackingState.TRACKING))
    active=located
    depthState=depthReadiness.update(frame.timestamp,depthNs,sample,located)
    if (located && depthState.ready && sample!=null) {
      val intrinsics=frame.camera.textureIntrinsics; val f=intrinsics.focalLength; val c=intrinsics.principalPoint; val dim=intrinsics.imageDimensions
      current.fuse(sessionId,rigid(frame.camera.pose),sample,f[0],f[1],c[0],c[1],dim[0],dim[1],frame.timestamp,depthNs)
    }
    if (located) analyzeTerrain(session,current,frame,if (depthState.ready) sample else null,
      if (depthState.ready) depthNs else 0,token,dense,denseNs)
    else clearTerrain("LOCALIZATION_REQUIRED")
    run {
      val panel=taughtRoutes
      val camera=if(located) current.poseInMap(sessionId,rigid(frame.camera.pose)) else null
      val points=ArrayList<FloatArray>()
      val fresh=sample!=null && depthNs>0 && depthNs<=frame.timestamp && frame.timestamp-depthNs<=250_000_000L
      if (fresh && camera!=null && sample!=null) {
        val k=frame.camera.textureIntrinsics;val f=k.focalLength;val c=k.principalPoint;val d=k.imageDimensions
        DepthProjection.points(sample,camera,f[0],f[1],c[0],c[1],d[0],d[1]) { points.add(it) }
      }
      val pose=camera?.let { runCatching { panel?.basePose(it) ?: RoutePose.fromCamera(it) }.getOrNull() }
      val envelope=readEnvelope()
      localAssessment=if(envelope!=null) RoutePerception.assess(points,observedGround,pose,fresh,
        envelope.width,envelope.length,envelope.height,max(.10f,envelope.margin),true)
        else RouteAssessment(RouteClearance.DEPTH_UNKNOWN,"DIMENSIONS_REQUIRED")
      localPose=pose
      val plane=observedGround
      if(camera!=null && plane!=null && envelope!=null) {
        localSnapshot=localMap.update(camera,plane,frame.timestamp,depthNs,points,envelope.height)
        val origin=localPlan.path.firstOrNull()
        if(localPlanSampleNs>0 && (frame.timestamp-localPlanSampleNs !in 0..750_000_000L || pose==null ||
          origin!=null && (origin.distance(pose)>.025f || abs(wrapYaw(origin.yaw-pose.yaw))>.1f))) {
          localPlan=LocalPlan("WAITING",reason="OBSERVATION_OR_POSE_CHANGED");localPlanSampleNs=0
        }
        if(pose!=null && (lastLocalPlanNs==0L || frame.timestamp-lastLocalPlanNs>=500_000_000L)) {
          lastLocalPlanNs=frame.timestamp
          localSweeps=mapOf(
            "straight2cm" to LocalTrajectory.check(localSnapshot,pose,
              pose.copy(x=pose.x+sin(pose.yaw)*.02f,z=pose.z-cos(pose.yaw)*.02f),envelope),
            "left10deg" to LocalTrajectory.check(localSnapshot,pose,pose.copy(yaw=pose.yaw-.174533f),envelope,0f,-.05f),
            "right10deg" to LocalTrajectory.check(localSnapshot,pose,pose.copy(yaw=pose.yaw+.174533f),envelope,0f,.05f))
          val goal=localGoal
          if(goal==null) localPlan=LocalPlan("WAITING",reason="GOAL_REQUIRED")
          else if(localPlannerBusy.compareAndSet(false,true)) {
            val snapshot=localSnapshot
            runCatching { localPlannerWorker.execute {
              try {
                val result=LocalPlanner.plan(snapshot,pose,goal,envelope)
                val latest=localPose
                // A planner result computed in a different datum, for another
                // goal or before a camera movement must not become a live hint.
                if(token==generation && localGoal==goal && localSnapshot.generation==snapshot.generation &&
                  localSnapshot.atNs-snapshot.atNs in 0..750_000_000L && latest!=null &&
                  latest.distance(pose)<.025f && abs(wrapYaw(latest.yaw-pose.yaw))<.1f) {
                  localPlan=result;localPlanSampleNs=snapshot.atNs
                }
              } catch(e: Exception) {
                if(token==generation && localGoal==goal) localPlan=LocalPlan("WAITING",reason="PLANNING_FAILED")
              } finally { localPlannerBusy.set(false) }
            } }.onFailure { localPlannerBusy.set(false) }
          }
        }
      }
      panel?.frame(sessionId,camera,located && terrainSnapshot.groundSelected && terrainSnapshot.floorConfirmed,localAssessment.clearance)
    }
    // Depth/terrain run at up to 10 Hz; map copies and Android view updates stay at 2 Hz.
    if (lastTerrainUiNs>0 && frame.timestamp>=lastTerrainUiNs && frame.timestamp-lastTerrainUiNs<500_000_000L) return
    lastTerrainUiNs=frame.timestamp
    val map=current.snapshot(); val position=current.livePosition?.clone(); val direction=current.liveForward?.clone()
    val text=if (located) "定位有效 · ${if (hasReference) "固定参照图对齐" else "仅本次会话"}\n原始深度 ≥60% 置信度 · 0.2～4 米 · ${map.voxels.size}/${RoomMapper.MAX_CELLS} 表面点"
      else if (!tracking) "定位已中断，暂停融合；请缓慢移动恢复跟踪${if (hasReference) "，并对准参照图" else ""}。"
      else if (hasReference) "等待固定参照图：请让整张实物图像占画面至少四分之一，保持约两秒。\n检测：$referenceState / $referenceMethod · 稳定 $stableCount 次"
      else "旧地图仅供查看：未登记固定参照图，不能在新会话中恢复坐标。"
    activity.runOnUiThread {
      if (!activity.isDestroyed && token==generation) {
        render(map,text + if (saveFailed) "\n最近保存失败，请检查存储空间并重新保存。" else "")
        mapView.position=position; mapView.forward=direction;mapView.route=taughtRoutes?.previewPoints() ?: emptyList();mapView.invalidate()
        renderTerrain()
      }
    }
  }
  /** GL thread only: ARCore planes are proposals, never automatically declared floor. */
  private fun analyzeTerrain(session: Session,current: RoomMapper,frame: Frame,sample: DepthSamples.Result?,depthNs: Long,token: Int,
    dense: DepthSamples.Result?,denseNs: Long) {
    // Do not establish a physical-height anchor before metric depth initializes.
    // A later depth gap preserves an existing reference; terrain evidence still expires.
    if (!depthState.ready) { groundArmed=false;groundTap=null;pendingGround=null;pendingHeight=null }
    val tap=groundTap; groundTap=null
    if (tap!=null) {
      val hits=frame.hitTest(tap[0],tap[1])
      val hit=hits.firstOrNull {
        val plane=it.trackable as? Plane
        plane!=null && plane.trackingState==TrackingState.TRACKING && plane.type==Plane.Type.HORIZONTAL_UPWARD_FACING &&
          plane.isPoseInPolygon(it.hitPose) && it.distance in .15f..4f
      }
      val plane=hit?.trackable as? Plane
      var fitted: GroundPlane?=null
      val mapCamera=current.poseInMap(sessionId,rigid(frame.camera.pose))
      if (plane==null && sample!=null && mapCamera!=null && depthNs>0 && depthNs<=frame.timestamp && frame.timestamp-depthNs<=250_000_000L) {
        val input=ByteBuffer.allocateDirect(8).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(tap);position(0) }
        val output=ByteBuffer.allocateDirect(8).order(ByteOrder.nativeOrder()).asFloatBuffer()
        frame.transformCoordinates2d(Coordinates2d.VIEW,input,Coordinates2d.TEXTURE_NORMALIZED,output)
        val k=frame.camera.textureIntrinsics;val f=k.focalLength;val c=k.principalPoint;val d=k.imageDimensions
        val depthHit=hits.firstOrNull { it.trackable is DepthPoint && it.distance in .15f..4f }?.let { current.poseInMap(sessionId,rigid(it.hitPose))?.t }
        fitted=SurfaceReference.fitPatch(sample,mapCamera,output.get(0),output.get(1),f[0],f[1],c[0],c[1],d[0],d[1],depthHit).plane
      }
      if (plane==null && fitted==null) activity.runOnUiThread {
        if (token==generation) AlertDialog.Builder(activity).setTitle("此处参考面证据不足")
          .setMessage("此处还没有可用的平面多边形或足够平整的深度邻域。可以继续扫描，也可以用已量好的镜头高度建立水平参考面。")
          .setNegativeButton("继续扫描",null).setPositiveButton("填写镜头高度") { _,_ -> editCameraHeight() }.show()
      } else {
        val fittedChoice=fitted
        val cameraHeight=if (plane!=null) frame.camera.pose.ty()-requireNotNull(hit).hitPose.ty() else requireNotNull(fitted).distance(requireNotNull(mapCamera).t)
        activity.runOnUiThread {
          if (token!=generation || activity.isDestroyed) return@runOnUiThread
          AlertDialog.Builder(activity).setTitle("确认平面用途")
            .setMessage("真正地板请选择“实际地面”，桌面请选择“台面试验”。\n相机距所选平面约%.0f厘米（未校准）。".format(cameraHeight*100))
            .setNegativeButton("重新选择") { _,_ -> if (token==generation) groundArmed=true }
            .setNeutralButton("台面试验") { _,_ -> if (token==generation && active) pendingGround=GroundChoice(plane,false,fittedChoice) }
            .setPositiveButton("实际地面") { _,_ -> if (token==generation && active) pendingGround=GroundChoice(plane,true,fittedChoice) }.show()
        }
      }
    }
    val camera=current.poseInMap(sessionId,rigid(frame.camera.pose))
    pendingGround?.let { choice ->
      pendingGround=null
      val plane=choice.plane
      val ground=if (plane!=null) current.poseInMap(sessionId,rigid(plane.centerPose))?.let { runCatching { GroundPlane.fromPose(it) }.getOrNull() } else choice.fitted
      if ((plane==null || plane.trackingState==TrackingState.TRACKING) && ground!=null) {
        surfaceAnchor?.let { surfaceAnchorsToRelease.add(it) };surfaceAnchor=null;surfaceAnchorState="NONE"
        selectedGround=plane;fittedGround=if (plane==null) ground else null;calibratedHeight=null
        if (plane==null && camera!=null) {
          val worldFromMap=rigid(frame.camera.pose).compose(camera.inverse())
          val world=worldFromMap.point(ground.origin)
          surfaceAnchor=runCatching { session.createAnchor(Pose.makeTranslation(world)) }.getOrNull()
          surfaceAnchorState=surfaceAnchor?.trackingState?.name ?: "LOCAL_REFERENCE"
        }
        surfaceSource=if (plane!=null) "ARCORE_PLANE" else "RAW_DEPTH_PATCH";terrain.selectGround(ground,choice.actualFloor)
        localMap.reset();lastLocalPlanNs=0;localPlanSampleNs=0;localPlan=LocalPlan("WAITING",reason="GROUND_CHANGED")
      }
    }
    pendingHeight?.let { choice ->
      pendingHeight=null
      if (camera!=null) {
        calibratedHeight=choice.height;selectedGround=null;surfaceSource="MEASURED_HEIGHT"
        fittedGround=SurfaceReference.measuredHeight(camera,choice.height)
        surfaceAnchor?.let { surfaceAnchorsToRelease.add(it) }
        val world=frame.camera.pose.translation.clone().apply { this[1]-=choice.height }
        surfaceAnchor=runCatching { session.createAnchor(Pose.makeTranslation(world)) }.getOrNull()
        surfaceAnchorState=surfaceAnchor?.trackingState?.name ?: "LOCAL_REFERENCE"
        terrain.selectGround(fittedGround!!,choice.actualFloor)
        localMap.reset();lastLocalPlanNs=0;localPlanSampleNs=0;localPlan=LocalPlan("WAITING",reason="GROUND_CHANGED")
      }
    }
    var plane=selectedGround
    if (plane==null && fittedGround==null && calibratedHeight==null) {
      terrainSnapshot=TerrainSnapshot(false,"SELECT_GROUND",envelope=readEnvelope()); return
    }
    repeat(10) { plane?.subsumedBy?.let { plane=it } }
    selectedGround=plane
    val reference=surfaceAnchor
    if (reference!=null) surfaceAnchorState=reference.trackingState.name
    val ground=when {
      reference!=null && reference.trackingState==TrackingState.TRACKING -> current.poseInMap(sessionId,rigid(reference.pose))?.let { runCatching { GroundPlane.fromPose(it) }.getOrNull() }
      reference!=null -> null
      plane!=null -> current.poseInMap(sessionId,rigid(plane!!.centerPose))?.let { runCatching { GroundPlane.fromPose(it) }.getOrNull() }
      else -> fittedGround
    }
    if ((plane!=null && (plane!!.trackingState!=TrackingState.TRACKING || plane!!.subsumedBy!=null)) || ground==null || camera==null) {
      clearTerrain("GROUND_LOST"); return
    }
    observedGround=ground
    val points=ArrayList<FloatArray>()
    if (sample!=null && depthNs>0 && depthNs<=frame.timestamp && frame.timestamp-depthNs<=250_000_000L) {
      val k=frame.camera.textureIntrinsics; val f=k.focalLength; val c=k.principalPoint; val d=k.imageDimensions
      val fusion=HybridDepth.fuse(sample,dense,camera,ground,f[0],f[1],c[0],c[1],d[0],d[1],depthNs,denseNs,frame.timestamp)
      hybridReport=fusion.report()
      DepthProjection.points(fusion.sample,camera,f[0],f[1],c[0],c[1],d[0],d[1]) { points.add(it) }
      depthRecorder.record(frame.timestamp,depthNs,denseNs,sample,dense,camera,ground,floatArrayOf(f[0],f[1],c[0],c[1]),d,hybridReport)
      if (frame.timestamp-lastOverlayNs>=500_000_000L) {
        lastOverlayNs=frame.timestamp
        drawDepthOverlay(frame,camera,ground,fusion.sample,fusion.filled,f,c,d,token)
      }
    } else if (frame.timestamp-lastOverlayNs>1_000_000_000L) {
      activity.runOnUiThread { if (token==generation) depthOverlay?.let { it.dots=emptyList();it.invalidate() } }
    }
    terrainSnapshot=terrain.update(camera,ground,frame.timestamp,depthNs,points)
  }
  private fun drawDepthOverlay(frame: Frame,camera: RigidPose,ground: GroundPlane,sample: DepthSamples.Result,
    filled: BooleanArray,f: FloatArray,c: FloatArray,d: IntArray,token: Int) {
    if (!overlayEnabled) return
    val colors=ArrayList<Int>();val sources=ArrayList<Boolean>();val uv=ArrayList<Float>();var count=0
    DepthProjection.indexedPoints(sample,camera,f[0],f[1],c[0],c[1],d[0],d[1]) { i,p ->
      if (count++%5==0 && colors.size<700) {
        val h=ground.distance(p)
        colors.add(when { abs(h)<=.025f -> Color.CYAN;h< -.04f -> Color.rgb(255,158,45);h>.03f -> Color.RED;else -> Color.LTGRAY })
        sources.add(filled[i]);uv.add((i%sample.width)*sample.step.toFloat()/sample.sourceWidth)
        uv.add((i/sample.width)*sample.step.toFloat()/sample.sourceHeight)
      }
    }
    val input=ByteBuffer.allocateDirect(uv.size*4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(uv.toFloatArray());position(0) }
    val output=ByteBuffer.allocateDirect(uv.size*4).order(ByteOrder.nativeOrder()).asFloatBuffer()
    if (uv.isNotEmpty()) frame.transformCoordinates2d(Coordinates2d.TEXTURE_NORMALIZED,input,Coordinates2d.VIEW_NORMALIZED,output)
    val dots=colors.indices.map { DepthOverlayView.Dot(output.get(it*2),output.get(it*2+1),colors[it],sources[it]) }
    activity.runOnUiThread { if (token==generation) depthOverlay?.let {
      it.dots=dots;it.updatedAt=android.os.SystemClock.elapsedRealtime();it.invalidate()
    } }
  }
  private fun drawPlaneOutlines(session: Session,frame: Frame,token: Int) {
    if (!overlayEnabled) return
    val cameraFromWorld=frame.camera.pose.inverse();val k=frame.camera.textureIntrinsics
    val f=k.focalLength;val c=k.principalPoint;val d=k.imageDimensions
    val outlines=session.getAllTrackables(Plane::class.java).filter {
      it.trackingState==TrackingState.TRACKING && it.type==Plane.Type.HORIZONTAL_UPWARD_FACING && it.subsumedBy==null
    }.sortedByDescending { it.extentX*it.extentZ }.take(3).mapNotNull { plane ->
      val polygon=plane.polygon;val vertices=ArrayList<FloatArray>()
      for (i in 0 until polygon.limit() step 2) vertices.add(cameraFromWorld.transformPoint(plane.centerPose.transformPoint(floatArrayOf(polygon.get(i),0f,polygon.get(i+1)))))
      val uv=DepthProjection.polygonUv(vertices,f[0],f[1],c[0],c[1],d[0],d[1])
      if (uv.isEmpty()) null else {
        val input=ByteBuffer.allocateDirect(uv.size*4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(uv);position(0) }
        val output=ByteBuffer.allocateDirect(uv.size*4).order(ByteOrder.nativeOrder()).asFloatBuffer()
        frame.transformCoordinates2d(Coordinates2d.TEXTURE_NORMALIZED,input,Coordinates2d.VIEW_NORMALIZED,output)
        FloatArray(uv.size).also { output.position(0);output.get(it) }
      }
    }
    activity.runOnUiThread { if (token==generation) depthOverlay?.let {
      it.outlines=outlines;it.outlinesUpdatedAt=android.os.SystemClock.elapsedRealtime();it.invalidate()
    } }
  }
  private fun RoomMapper.snapshotReference() = referenceEnabled()
  private fun rigid(pose: Pose)=RigidPose(pose.translation,pose.rotationQuaternion)
  private fun render(map: RoomMapData,text: String) {
    title.text="${map.name} · ${map.places.size} 个地点"
    state.text=text
    places.text=if (map.places.isEmpty()) "尚无命名地点" else map.places.joinToString("   ") { "${it.name} (%.2f, %.2f)m".format(it.position[0],it.position[2]) }
    mapView.map=map; mapView.position=null; mapView.forward=null; mapView.invalidate()
  }
  companion object { const val SELECT_REFERENCE=841; const val EXPORT_MAP=842; const val CAPTURE_REFERENCE=843 }
}

/** Top-down surface view; no occupancy/free-space or path planning is inferred. */
internal class SurfaceMapView(activity: Activity): View(activity) {
  var route: List<RoutePose> = emptyList()
  var map: RoomMapData?=null
  var position: FloatArray?=null
  var forward: FloatArray?=null
  private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
  override fun onDraw(canvas: Canvas) {
    canvas.drawColor(Color.rgb(7,15,22))
    val map=map ?: return
    val xs=map.voxels.map { it[0]*RoomMapper.CELL }+map.path.map { it[0] }+route.map { it.x }
    val zs=map.voxels.map { it[2]*RoomMapper.CELL }+map.path.map { it[2] }+route.map { it.z }
    val minX=min(-1f,xs.minOrNull() ?: -1f); val maxX=max(1f,xs.maxOrNull() ?: 1f)
    val minZ=min(-1f,zs.minOrNull() ?: -1f); val maxZ=max(1f,zs.maxOrNull() ?: 1f)
    val scale=min((width-70)/max(2f,maxX-minX),(height-65)/max(2f,maxZ-minZ))
    val left=(width-(maxX-minX)*scale)/2
    val top=(height-40-(maxZ-minZ)*scale)/2
    fun x(v: Float)=left+(v-minX)*scale
    fun z(v: Float)=top+(v-minZ)*scale
    paint.color=Color.rgb(40,55,66); paint.strokeWidth=1f
    for (i in floor(minX).toInt()..ceil(maxX).toInt()) canvas.drawLine(x(i.toFloat()),z(minZ),x(i.toFloat()),z(maxZ),paint)
    for (i in floor(minZ).toInt()..ceil(maxZ).toInt()) canvas.drawLine(x(minX),z(i.toFloat()),x(maxX),z(i.toFloat()),paint)
    val radius=max(1.2f,RoomMapper.CELL*scale/2)
    map.voxels.forEach { point ->
      paint.color=if (point[3] >= 2) Color.rgb(63,180,197) else Color.rgb(38,91,105)
      canvas.drawCircle(x((point[0]+.5f)*RoomMapper.CELL),z((point[2]+.5f)*RoomMapper.CELL),radius,paint)
    }
    paint.color=Color.rgb(237,199,75); paint.strokeWidth=2f
    for (i in 1 until map.path.size) {
      val a=map.path[i-1]; val b=map.path[i]
      if (a[3]==b[3]) canvas.drawLine(x(a[0]),z(a[2]),x(b[0]),z(b[2]),paint)
    }
    paint.color=Color.MAGENTA;paint.strokeWidth=4f
    route.zipWithNext().forEach { (a,b)->canvas.drawLine(x(a.x),z(a.z),x(b.x),z(b.z),paint) }
    paint.textSize=22f
    map.places.forEach { place ->
      paint.color=Color.WHITE; canvas.drawCircle(x(place.position[0]),z(place.position[2]),5f,paint)
      canvas.drawText(place.name,x(place.position[0])+7,z(place.position[2])-7,paint)
    }
    position?.let { p ->
      paint.color=Color.GREEN; paint.strokeWidth=5f
      canvas.drawCircle(x(p[0]),z(p[2]),7f,paint)
      forward?.let { canvas.drawLine(x(p[0]),z(p[2]),x(p[0]+it[0]*.35f),z(p[2]+it[2]*.35f),paint) }
    }
    paint.color=Color.LTGRAY; paint.textSize=19f
    canvas.drawText("网格1m · 黄线轨迹 / 紫线所选路线 / 绿点当前位置",10f,height-9f,paint)
  }
}
