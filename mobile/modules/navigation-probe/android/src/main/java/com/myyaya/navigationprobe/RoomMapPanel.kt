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
import kotlin.math.*

/** Native mapping UI. No motor APIs. All ARCore objects are accessed on the GL thread. */
internal class RoomMapPanel(private val activity: Activity, private val stopAndReset: () -> Unit,
  private val pauseOnly: () -> Unit) {
  private val directory = File(activity.filesDir,"room-maps").apply { mkdirs() }
  private val io = Executors.newSingleThreadExecutor()
  @Volatile private var mapper: RoomMapper? = null
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
  @Volatile private var referenceState = "NOT_SEEN"
  @Volatile private var referenceMethod = "NOT_SEEN"
  @Volatile private var knownReferenceImages = 0
  @Volatile private var configuredReferenceImages = 0
  private val terrain=TerrainAnalysis()
  @Volatile private var terrainSnapshot=TerrainSnapshot(false,"SELECT_GROUND")
  @Volatile private var groundArmed=false
  @Volatile private var horizontalPlanes=0
  @Volatile private var groundTap: FloatArray?=null
  @Volatile private var pendingGround: Plane?=null
  @Volatile private var selectedGround: Plane?=null
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

  private fun label(value: String) = TextView(activity).apply {
    text=value; textSize=14f; setTextColor(Color.WHITE); setPadding(12,8,12,8)
  }
  private fun button(text: String, block: () -> Unit) = Button(activity).apply {
    this.text=text; textSize=13f; isAllCaps=false; setOnClickListener { block() }
  }
  fun buildColumn(): View = LinearLayout(activity).apply {
    orientation=LinearLayout.VERTICAL
    title=label("房间表面地图"); addView(title)
    state=label("新建地图后开始扫描。青色是观测到的表面，黑色是未知，不代表可通行区域。"); addView(state)
    addView(label("地面与通行判断 · 本次会话实验"))
    val terrainActions=LinearLayout(activity)
    terrainActions.addView(button("点选地面") {
      if (!active) toast("请先开始扫描并恢复当前地图定位")
      else { groundArmed=true; terrainState.text="请点击左侧后摄画面中的实际地面。不要选择桌面或架子。" }
    },LinearLayout.LayoutParams(0,-2,1f))
    terrainActions.addView(button("底座尺寸") { editEnvelope() },LinearLayout.LayoutParams(0,-2,1f))
    terrainActions.addView(button("清除判断") { clearTerrain(); renderTerrain() },LinearLayout.LayoutParams(0,-2,1f))
    addView(terrainActions)
    terrainState=label("开始扫描后点选实际地面；灰色未知、青色地面、红色障碍、橙色落差、绿色候选中心。")
    addView(terrainState)
    terrainView=TerrainView(activity); addView(terrainView,LinearLayout.LayoutParams(-1,(160*resources.displayMetrics.density).toInt()))
    addView(label("绿色需完整占地范围都有近期地面观测，只作候选；未标定相机与底座外参，不授权行驶。").apply { textSize=12f })
    mapView=SurfaceMapView(activity); addView(mapView,LinearLayout.LayoutParams(-1,(130*resources.displayMetrics.density).toInt()))
    places=label("尚无地点。扫描时可将当前位置命名为客厅、沙发旁等。"); addView(places)
    addView(label("保存并重新打开地图后，只有识别到已登记的固定参照图，才会恢复当前位置。未设置参照图的旧地图仅供查看。"))
    val first=LinearLayout(activity)
    first.addView(button("新建地图") { newMap() },LinearLayout.LayoutParams(0,-2,1f))
    first.addView(button("打开地图") { openMap() },LinearLayout.LayoutParams(0,-2,1f))
    first.addView(button("设置参照图") { chooseReference() },LinearLayout.LayoutParams(0,-2,1f))
    addView(first,1)
  }
  fun addActions(actions: LinearLayout) {
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
    val dialog=AlertDialog.Builder(activity).setTitle("整车尺寸与余量").setMessage("按整车最大投影尺寸填写，默认余量5厘米。白圈按长宽对角线包络，不表示相机已标定到底座中心。")
      .setView(ScrollView(activity).apply { addView(content) }).setNegativeButton("取消",null).setPositiveButton("保存",null).create()
    dialog.setOnShowListener {
      dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
        val value=runCatching { RobotEnvelope(width.text.toString().toFloat()/100,length.text.toString().toFloat()/100,
          height.text.toString().toFloat()/100,margin.text.toString().toFloat()/100) }.getOrNull()
        if (value==null) { toast("请在提示范围内填写完整长、宽、高和余量"); return@setOnClickListener }
        activity.getSharedPreferences("terrain-envelope",0).edit().putFloat("width",value.width).putFloat("length",value.length)
          .putFloat("height",value.height).putFloat("margin",value.margin).apply()
        terrain.setEnvelope(value); terrainSnapshot=TerrainSnapshot(terrain.hasGround(),"OBSERVING",envelope=value)
        renderTerrain(); dialog.dismiss()
      }
    }
    dialog.show()
  }
  private fun clearTerrain(status: String="SELECT_GROUND") {
    groundArmed=false; groundTap=null; pendingGround=null; selectedGround=null; terrain.reset()
    terrainSnapshot=TerrainSnapshot(false,status,envelope=readEnvelope())
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
      "SELECT_GROUND","CLOCK_RESET" -> "请点选实际地面，再缓慢移动手机补充原始深度。"
      else -> "地面 ${r["groundCells"]} · 障碍 ${r["obstacleCells"]} · 落差 ${r["dropCells"]} · 未定 ${r["uncertainCells"]} · 候选 ${r["candidateCenterCells"]}\n相机距所选平面 ${s.cameraHeight?.let { "%.0f厘米".format(it*100) } ?: "待测"}；${if (s.envelope==null) "请填写底座尺寸" else "仅作观测，禁止据此直接行驶"}"
    }
    if (!groundArmed) terrainState.text=message+"\n灰未知 / 青地面 / 红障碍 / 橙落差 / 绿候选"
    terrainView.snapshot=s; terrainView.invalidate()
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
  fun pause() { generation++; active=false; mapper?.invalidate(); clearTerrain(); renderTerrain(); if (::mapView.isInitialized) { mapView.position=null; mapView.forward=null; mapView.invalidate(); state.text="扫描已暂停，当前位置无效。地图可保存或重新打开。" } }
  fun close() { io.shutdown() }
  fun report(): Map<String,Any?>? = mapper?.summary()?.let { it + mapOf("lastSavedAt" to if (it["mapId"]==savedId) savedAt else 0L,
    "referenceTrackingState" to referenceState,"referenceTrackingMethod" to referenceMethod,
    "configuredReferenceImages" to configuredReferenceImages,
    "knownReferenceImages" to knownReferenceImages,"stableReferenceSamples" to stableCount,
    "terrain" to (terrainSnapshot.report()+mapOf("trackedHorizontalPlanes" to horizontalPlanes))) }
  fun canStart() = mapper != null && !saving && !restoring
  /** GL thread, throttled by the host to 2 Hz. */
  fun frame(session: Session, frame: Frame, sample: DepthSamples.Result?, depthNs: Long) {
    val token=generation
    val current=mapper ?: return
    val tracking=frame.camera.trackingState==TrackingState.TRACKING
    horizontalPlanes=if (tracking) session.getAllTrackables(Plane::class.java).count {
      it.trackingState==TrackingState.TRACKING && it.type==Plane.Type.HORIZONTAL_UPWARD_FACING && it.subsumedBy==null
    } else 0
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
    if (located && sample!=null) {
      val intrinsics=frame.camera.textureIntrinsics; val f=intrinsics.focalLength; val c=intrinsics.principalPoint; val dim=intrinsics.imageDimensions
      current.fuse(sessionId,rigid(frame.camera.pose),sample,f[0],f[1],c[0],c[1],dim[0],dim[1],frame.timestamp,depthNs)
    }
    if (located) analyzeTerrain(current,frame,sample,depthNs,token)
    else clearTerrain("LOCALIZATION_REQUIRED")
    val map=current.snapshot(); val position=current.livePosition?.clone(); val direction=current.liveForward?.clone()
    val text=if (located) "定位有效 · ${if (hasReference) "固定参照图对齐" else "仅本次会话"}\n原始深度 ≥60% 置信度 · 0.2～4 米 · ${map.voxels.size}/${RoomMapper.MAX_CELLS} 表面点"
      else if (!tracking) "定位已中断，暂停融合；请缓慢移动恢复跟踪${if (hasReference) "，并对准参照图" else ""}。"
      else if (hasReference) "等待固定参照图：请让整张实物图像占画面至少四分之一，保持约两秒。\n检测：$referenceState / $referenceMethod · 稳定 $stableCount 次"
      else "旧地图仅供查看：未登记固定参照图，不能在新会话中恢复坐标。"
    activity.runOnUiThread {
      if (!activity.isDestroyed && token==generation) {
        render(map,text + if (saveFailed) "\n最近保存失败，请检查存储空间并重新保存。" else "")
        mapView.position=position; mapView.forward=direction; mapView.invalidate()
        renderTerrain()
      }
    }
  }
  /** GL thread only: ARCore planes are proposals, never automatically declared floor. */
  private fun analyzeTerrain(current: RoomMapper,frame: Frame,sample: DepthSamples.Result?,depthNs: Long,token: Int) {
    val tap=groundTap; groundTap=null
    if (tap!=null) {
      val hit=frame.hitTest(tap[0],tap[1]).firstOrNull {
        val plane=it.trackable as? Plane
        plane!=null && plane.trackingState==TrackingState.TRACKING && plane.type==Plane.Type.HORIZONTAL_UPWARD_FACING &&
          plane.isPoseInPolygon(it.hitPose) && it.distance in .15f..4f
      }
      val plane=hit?.trackable as? Plane
      if (plane==null) activity.runOnUiThread { if (token==generation) toast("此处未检测到向上的水平面，请缓慢扫描实际地面后再点选") }
      else {
        val cameraHeight=frame.camera.pose.ty()-requireNotNull(hit).hitPose.ty()
        activity.runOnUiThread {
          if (token!=generation || activity.isDestroyed) return@runOnUiThread
          AlertDialog.Builder(activity).setTitle("确认实际地面")
            .setMessage("这是实际地面，而不是桌面、架子或台阶吗？\n相机距所选平面约%.0f厘米（未校准）。".format(cameraHeight*100))
            .setNegativeButton("重新选择") { _,_ -> if (token==generation) groundArmed=true }
            .setPositiveButton("确认是地面") { _,_ -> if (token==generation && active) pendingGround=plane }.show()
        }
      }
    }
    pendingGround?.let { plane ->
      pendingGround=null
      val ground=current.poseInMap(sessionId,rigid(plane.centerPose))?.let { runCatching { GroundPlane.fromPose(it) }.getOrNull() }
      if (plane.trackingState==TrackingState.TRACKING && ground!=null) {
        selectedGround=plane; terrain.selectGround(ground)
      }
    }
    var plane=selectedGround ?: run {
      terrainSnapshot=TerrainSnapshot(false,"SELECT_GROUND",envelope=readEnvelope()); return
    }
    repeat(10) { plane.subsumedBy?.let { plane=it } }
    selectedGround=plane
    val ground=current.poseInMap(sessionId,rigid(plane.centerPose))?.let { runCatching { GroundPlane.fromPose(it) }.getOrNull() }
    val camera=current.poseInMap(sessionId,rigid(frame.camera.pose))
    if (plane.trackingState!=TrackingState.TRACKING || plane.subsumedBy!=null || ground==null || camera==null) {
      clearTerrain("GROUND_LOST"); return
    }
    val points=ArrayList<FloatArray>()
    if (sample!=null && depthNs>0 && depthNs<=frame.timestamp && frame.timestamp-depthNs<=250_000_000L) {
      val k=frame.camera.textureIntrinsics; val f=k.focalLength; val c=k.principalPoint; val d=k.imageDimensions
      DepthProjection.points(sample,camera,f[0],f[1],c[0],c[1],d[0],d[1]) { points.add(it) }
    }
    terrainSnapshot=terrain.update(camera,ground,frame.timestamp,depthNs,points)
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
  var map: RoomMapData?=null
  var position: FloatArray?=null
  var forward: FloatArray?=null
  private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
  override fun onDraw(canvas: Canvas) {
    canvas.drawColor(Color.rgb(7,15,22))
    val map=map ?: return
    val xs=map.voxels.map { it[0]*RoomMapper.CELL }+map.path.map { it[0] }
    val zs=map.voxels.map { it[2]*RoomMapper.CELL }+map.path.map { it[2] }
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
    canvas.drawText("网格 1m · 表面投影 / 黄线轨迹 / 绿点当前位置",10f,height-9f,paint)
  }
}
