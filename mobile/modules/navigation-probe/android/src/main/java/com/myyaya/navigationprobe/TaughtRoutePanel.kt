package com.myyaya.navigationprobe

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.os.SystemClock
import android.os.Handler
import android.os.Looper
import android.media.AudioManager
import android.media.ToneGenerator
import android.util.AtomicFile
import android.widget.*
import java.io.File
import java.security.MessageDigest
import kotlin.math.*

/** Route UI and observation adapter. Motor requests go through the existing BLE owner. */
internal class TaughtRoutePanel(private val activity: Activity,private val motor: RouteMotorGateway,
  private val metadata: ()->RoomMapData?,private val saveMap: ()->Unit,private val mountSettings: NavigationMountSettings,
  private val floorFlow: ()->Map<String,Any?> = { emptyMap() }) {
  private var countdown: CalibrationStartTimer?=null
  private var countdownDialog: AlertDialog?=null
  private var countdownTone: ToneGenerator?=null
  private val directory=File(activity.filesDir,"taught-routes").apply { mkdirs() }
  private val mount get()=mountSettings.value ?: RouteMount()
  @Volatile private var teacher: RouteTeacher?=null
  @Volatile private var follower: RouteFollower?=null
  @Volatile private var selected: TaughtRoute?=null
  @Volatile private var observation: RouteObservation?=null
  @Volatile private var currentSession=""
  @Volatile private var headFixed=false
  private val poseLock=NavigationPoseLock()
  @Volatile private var backChecked=false
  @Volatile private var turnChecked=false
  private var invertTurns=false
  @Volatile private var calibration: PulseMeasurementTrial?=null
  @Volatile private var calibrationFlowStart: Map<String,Any?> = emptyMap()
  @Volatile private var lastMeasurement: Map<String,Any?>?=null
  private var lastStop=0L
  private var lastIssued=0L
  private var lastUi=0L
  @Volatile private var field: OperatorExploration?=null
  @Volatile private var fieldSample: OperatorExploration.Sample?=null
  @Volatile private var savedFieldResult: Map<String,Any?>?=null
  @Volatile private var notice="先连接底座并固定头部；教路线前请确认真实平整地面。"
  private lateinit var status: TextView
  fun buildView()=android.widget.LinearLayout(activity).apply {
    orientation=1
    addView(Button(activity).apply { text="教路线与复走 · 操作";setOnClickListener { menu() } })
    status=TextView(activity).apply { setTextColor(Color.CYAN);textSize=12f;text=notice };addView(status)
  }
  private fun message(s: String) { notice=s;activity.runOnUiThread { if (::status.isInitialized) status.text=s } }
  private fun menu() {
    holdForUi()
    val items=arrayOf("连接保存的底座","固定最低导航姿态（不回正）","设置镜头到底座偏移","开始教路线","完成并保存路线","选择已教路线",
      "短后退方向校验","短左转方向校验","开始复走","移开障碍后继续","停止","短右转方向校验","空地分段采集（450毫秒）")
    AlertDialog.Builder(activity).setTitle("已教路线导航 · 真实平整地面试验").setItems(items) { _,i->
      runCatching {
        if(i !in listOf(10,12)) {
          check(field?.moving!=true) { "请等本段停止，或点击停止" }
          field?.cancel("OTHER_OPERATION")
        }
        when(i) {
        0->motor.request("connect") { ok,s->message(if(ok && motor.isConnected()) "底座已连接" else "连接未完成：$s") }
        1->fixHead()
        2->editMount()
        3->beginTeaching()
        4->finishTeaching()
        5->chooseRoute()
        6->calibrate("back")
        7->calibrate("left")
        8->startFollowing()
        9->resumeFollowing()
        10->stop("用户停止")
        11->calibrate("right")
        12->confirmFieldSegment()
      } }.onFailure { message(it.message ?: "操作未完成") }
    }.setNegativeButton("返回",null).show()
  }
  private fun current(): RouteObservation = observation?.takeIf { SystemClock.elapsedRealtime()-it.atMs<=500 }
    ?: error("请先开始扫描并恢复定位")
  private fun requireFloor(): RouteObservation {
    val o=current();check(o.tracking && o.pose!=null) { "请先恢复当前地图定位" }
    check(o.actualFloor && !o.playback) { "需要在真实平整地面选择实际地面；台面/回放不允许驱动" }
    check(o.headFixed) { "请先固定头部，之后不要抬头或低头" }
    check(mountSettings.value!=null) { "请先填写镜头到底座中心的实测水平偏移" }
    return o
  }
  private fun fixHead() {
    check(follower?.phase !in listOf("FOLLOWING","FACING_USER")) { "请先停止复走" }
    AlertDialog.Builder(activity).setTitle("保持最低导航姿态")
      .setMessage("断连或重连后脖子可能抬起，请先手动压回最低，确认后摄平视前方且能看到近处地面。保持当前位置不会发回正或抬头指令。也可尝试社区降头动作，之后仍需核对画面。")
      .setNegativeButton("取消",null).setPositiveButton("保持当前位置") { _,_->prepareHead(false) }
      .setNeutralButton("降到最低") { _,_->prepareHead(true) }.show()
  }
  private fun prepareHead(lower: Boolean) {
    runCatching {
      check(current().tracking && motor.isConnected()) { "请先开始扫描、恢复定位并连接底座" }
      motor.stop("固定导航姿态前停止")
      headFixed=false;poseLock.reset();backChecked=false;turnChecked=false
      if (!lower) { poseLock.begin(SystemClock.elapsedRealtime(),motor.connectionRevision);message(poseLock.reason) }
      else motor.request("head_down") { ok,s->
        if(ok) { poseLock.begin(SystemClock.elapsedRealtime(),motor.connectionRevision);message("已发送降头指令，确认后摄平视；保持最低位置，不自动回正。") }
        else message("降头未完成：$s")
      }
    }.onFailure { message(it.message ?: "无法固定导航姿态") }
  }
  private fun editMount() {
    check(teacher==null && follower?.phase !in listOf("FOLLOWING","FACING_USER")) { "请先停止教路线或复走" }
    mountSettings.edit { mountChanged() }
  }
  @Synchronized fun mountChanged() {
    if(teacher!=null || follower?.phase in listOf("FOLLOWING","FACING_USER","PAUSED")) stop("安装偏移已改变，请重新教路线或恢复原安装")
    backChecked=false;turnChecked=false;headFixed=false;poseLock.reset();calibration=null
    message("实测偏移已保存，请重新固定最低姿态并做短动作校验。")
  }
  private fun beginTeaching() {
    requireFloor();check(follower?.phase !in listOf("FOLLOWING","FACING_USER")) { "请先停止复走" }
    AlertDialog.Builder(activity).setTitle("开始教路线").setMessage("手机与底座装稳、头部固定。在真实平整地面人工带领同一安装姿态走一条短路线，经过处应能容下底座与转向余量。第一版沿该走廊复走，发现障碍停车，不自动绕行。")
      .setNegativeButton("取消",null).setPositiveButton("开始记录") { _,_->runCatching {
        val o=requireFloor();teacher=RouteTeacher(mount).also { it.observe(o.pose,true) };follower=null;message("正在教路线，走到终点后选完成保存。")
      }.onFailure { message(it.message ?: "无法开始") } }.show()
  }
  private fun finishTeaching() {
    val teaching=teacher ?: error("尚未开始教路线")
    val input=EditText(activity).apply { hint="例如：去客厅";setSingleLine() }
    AlertDialog.Builder(activity).setTitle("保存路线").setView(input).setNegativeButton("取消",null)
      .setPositiveButton("保存") { _,_->runCatching {
        val map=metadata() ?: error("当前地图不可用")
        val r=teaching.finish(input.text.toString().trim(),map.id,currentSession,referenceKey(map))
        val file=AtomicFile(File(directory,"${r.id}.yayaroute"));val out=file.startWrite()
        try { out.write(TaughtRouteCodec.encode(r));file.finishWrite(out) } catch(e: Exception) { file.failWrite(out);throw e }
        teacher=null;selected=r
        saveMap()
        message("已保存${r.name}，${r.points.size}个路点。${if(r.referenceKey.isEmpty()) "仅本次定位会话可复走；重开需有固定参照图。" else "重新打开需先识别同一固定参照图。"}")
      }.onFailure { message(it.message ?: "保存失败") } }.show()
  }
  fun selectInitial(route: TaughtRoute) { selected=route;message("已选${route.name}，请开始扫描并恢复原地图定位，然后固定头部和做短动作校验。") }
  private fun chooseRoute() {
    check(teacher==null && follower?.phase !in listOf("FOLLOWING","FACING_USER")) { "请先停止当前操作" }
    val routes=directory.listFiles()?.filter { it.extension=="yayaroute" && it.length()<=64000 }
      ?.mapNotNull { runCatching { TaughtRouteCodec.decode(it.readBytes()) }.getOrNull() } ?: emptyList()
    if (routes.isEmpty()) { message("还没有已保存的路线");return }
    AlertDialog.Builder(activity).setTitle("选择已教路线").setItems(routes.map { it.name }.toTypedArray()) { _,i->
      selected=routes[i];message("已选${routes[i].name}，请放回指定起点并恢复教路线时的朝向。")
    }.show()
  }
  private fun calibrate(direction: String) {
    if(direction=="back") {
      AlertDialog.Builder(activity).setTitle("后退标定时长")
        .setMessage("可选更明显的一次后退。实际距离尚未校准，均会自动停止；开始前有三声提示音与倒计时。")
        .setNegativeButton("取消",null).setNeutralButton("200毫秒") { _,_->confirmCalibration(direction,200) }
        .setPositiveButton("450毫秒（更明显）") { _,_->confirmCalibration(direction,450) }.show()
    } else {
      AlertDialog.Builder(activity).setTitle("${if(direction=="left") "左" else "右"}转标定时长")
        .setMessage("120毫秒变化较小。350毫秒用于更明显的单次观察，实际角度尚未标定；两种均有三秒倒计时并自动停止。")
        .setNegativeButton("取消",null).setNeutralButton("120毫秒（小动作）") { _,_->confirmCalibration(direction,120) }
        .setPositiveButton("350毫秒（加大幅度）") { _,_->confirmCalibration(direction,350) }.show()
    }
  }
  private fun confirmCalibration(direction: String,ms: Int) {
    runCatching {
    val o=requireFloor();check(o.clearance!=RouteClearance.OBSTACLE) { "已看到车前障碍/落差，请先移开并重新观察" }
    check(motor.isConnected() && !motor.busy && teacher==null && follower?.phase !in listOf("FOLLOWING","FACING_USER")) { "请连接底座并停止当前操作" }
    check(calibration==null) { "请等上一轮动作位姿测量完成" }
    AlertDialog.Builder(activity).setTitle("一次短动作标定")
      .setMessage("${if(o.clearance==RouteClearance.DEPTH_UNKNOWN) "相机近处仍有盲区，这不是已测空地。" else "将测量实际车身位移和转角。"}请目视确认底座四周至少30厘米为平整空地、无物品和落差，USB线留有余量。此次只${if(direction=="back") "沿后摄方向短后退" else if(direction=="left") "短左转" else "短右转"}${ms}毫秒，自动停止并观察停稳；不启动自主行驶。")
      .setNegativeButton("取消",null).setPositiveButton("空地已确认，做一次") { _,_->runCatching {
        beginCountdown(direction,ms)
      }.onFailure { message(it.message ?: "无法准备标定") } }.show()
    }.onFailure { message(it.message ?: "标定条件已变化，请重新观察") }
  }
  private fun confirmFieldSegment() {
    check(!motor.busy && calibration==null && teacher==null && follower?.phase !in listOf("FOLLOWING","FACING_USER")) { "请先停止其他动作" }
    check(field?.moving!=true) { "请等待本段停稳" }
    val s=requireNotNull(fieldSample) { "请先开始实时扫描和录像" }
    check(SystemClock.elapsedRealtime()-s.at in 0..500 && s.pose!=null && !s.playback && s.recording && motor.isConnected()) { "请开始实时相机/IMU录制并连接底座" }
    val newBatch=field?.phase!="READY"
    val number=if(newBatch) 1 else field!!.segments+1
    AlertDialog.Builder(activity).setTitle("空地采集 · 第${number}/3段")
      .setMessage("请确认实际地板平整、脖子最低，后摄方向约50厘米空地且线缆有余量。三声提示后朝后摄方向行驶450毫秒并停止，记录相机与IMU；每段停稳后需再次选择下一段，最多三段。\n本项使用人工确认的场地，地图高度漂移仅作记录；仍监测倾斜、定位、断连和已见障碍。不启动自主导航，也不把未知深度当空地。")
      .setNegativeButton("取消",null).setPositiveButton("场地已确认，采集一段") { _,_->runCatching {
        if(newBatch) field=OperatorExploration(requireNotNull(fieldSample))
        beginCountdown("back",450,true)
      }.onFailure { message(it.message ?: "采集条件未满足") } }.show()
  }
  private fun cancelCountdown() {
    countdown?.cancel();countdown=null
    val dialog=countdownDialog;countdownDialog=null;dialog?.dismiss()
    countdownTone?.release();countdownTone=null
  }
  private fun beginCountdown(direction: String,ms: Int,operatorTrial: Boolean=false) {
    cancelCountdown()
    val handler=Handler(Looper.getMainLooper())
    countdownTone=runCatching { ToneGenerator(AudioManager.STREAM_MUSIC,75) }.getOrNull()
    val dialog=AlertDialog.Builder(activity).setTitle("即将开始一次标定")
      .setMessage("请看底座：3秒后短${if(direction=="back") "后退" else "转向"}，随后自动停止。")
      .setNegativeButton("取消本次动作") { _,_->cancelCountdown() }.create()
    countdownDialog=dialog;dialog.setOnCancelListener { cancelCountdown() };dialog.show()
    countdown=CalibrationStartTimer({delay,work -> val task=Runnable { work() };handler.postDelayed(task,delay);{handler.removeCallbacks(task)} },{remaining->
      dialog.setMessage("${remaining}秒后${if(direction=="back") "后退" else "转向"}${ms}毫秒，随后自动停止。\n请留意三声提示音；无需估计距离。")
      runCatching { countdownTone?.startTone(ToneGenerator.TONE_PROP_BEEP,130) }
    },{
      cancelCountdown()
      runCatching {
        if(operatorTrial) {
          check(motor.isConnected() && !motor.busy && calibration==null) { "连接或控制状态已变化" }
          val trial=requireNotNull(field);trial.issue(SystemClock.elapsedRealtime())
          motor.request("calibration_back",450) { ok,s->
            trial.acknowledge(ok,SystemClock.elapsedRealtime())
            message(if(ok) "本段已限时停止，正在记录停稳后的画面。" else "采集动作未完成：$s")
          }
        } else {
        val current=requireFloor()
        check(current.clearance!=RouteClearance.OBSTACLE && motor.isConnected() && !motor.busy && calibration==null) { "姿态、障碍或连接已变化，请重新确认" }
        val trial=PulseMeasurementTrial(direction,ms,current.pose!!,SystemClock.elapsedRealtime())
        calibrationFlowStart=floorFlow()
        calibration=trial
        val action=when {
          direction=="back" && ms==450->"calibration_back"
          direction in listOf("left","right") && ms==350->"calibration_$direction"
          else->direction
        }
        motor.request(action,ms) { ok,s->
          synchronized(this) { if(calibration===trial) trial.acknowledge(ok,SystemClock.elapsedRealtime()) }
          message(if(ok) "动作已停止，正在等待位姿稳定并记录余移。" else "校验动作未完成：$s")
        }
        }
      }.onFailure { message(it.message ?: "倒计时后条件已变化，未开始动作") }
    }).also { it.start() }
  }
  private fun checkBinding(r: TaughtRoute) {
    val map=metadata() ?: error("当前地图不可用")
    check(r.usableIn(map.id,currentSession,referenceKey(map),current().tracking)) { "路线不属于当前定位坐标，请打开原地图并识别固定参照图" }
    check(abs(r.mount.right-mount.right)<.001f && abs(r.mount.alongView-mount.alongView)<.001f) { "请恢复教路线时的安装偏移" }
  }
  private fun startFollowing() {
    check(teacher==null && !motor.busy && backChecked && turnChecked) { "请先完成后退和左转两项短动作校验" }
    val r=selected ?: error("请先选择已教路线");checkBinding(r)
    val o=requireFloor();check(o.clearance==RouteClearance.CLEAR) { "等待新鲜深度或移开障碍" }
    follower=RouteFollower(r).also { it.start(o) };message("正在复走${r.name}，可随时点停止。")
  }
  private fun resumeFollowing() {
    check(backChecked && turnChecked && !motor.busy) { "请先恢复固定安装并完成短动作校验" }
    val f=follower ?: error("没有可继续的路线");checkBinding(f.route);f.resume(requireFloor());message("继续复走${f.route.name}")
  }
  @Synchronized fun stop(reason: String) {
    activity.runOnUiThread { cancelCountdown() }
    teacher=null;calibration=null;field?.cancel(reason);follower?.cancel();motor.stop(reason);message(reason)
  }
  @Synchronized fun pause() {
    activity.runOnUiThread { cancelCountdown() }
    teacher?.observe(null,false);follower?.pause("界面或定位已暂停");calibration=null;field?.cancel("CAMERA_PAUSED");fieldSample=null;headFixed=false;poseLock.reset()
    backChecked=false;turnChecked=false;motor.stop("扫描已暂停")
  }
  @Synchronized fun holdForUi() {
    val f=follower
    if (f?.phase in listOf("FOLLOWING","FACING_USER")) { f?.pause("正在操作界面，请点继续复走恢复");motor.stop("导航操作菜单") }
  }
  fun basePose(camera: RigidPose)=RoutePose.fromCamera(camera,mount.right,mount.alongView)
  fun previewPoints()=selected?.points ?: emptyList()
  /** Live camera session coordinates, independent of map anchoring and floor-plane drift. */
  @Synchronized fun operatorFrame(camera: RigidPose?,session: String,recording: Boolean,playback: Boolean,hazard: Boolean) {
    val now=SystemClock.elapsedRealtime()
    val pose=camera?.let { runCatching { basePose(it) }.getOrNull() }
    val sample=OperatorExploration.Sample(now,pose,camera?.t?.get(1),session,motor.isConnected(),motor.connectionRevision,recording,playback,hazard)
    fieldSample=sample
    field?.let { trial ->
      val moving=trial.moving;trial.observe(sample,now)
      if(moving && trial.phase=="STOPPED") { motor.stop("空地采集中断：${trial.reason}");message("采集已停止：${trial.reason}") }
      trial.result?.let { result -> if(result!==savedFieldResult) {
        savedFieldResult=result
        val record=result+mapOf("atEpochMs" to System.currentTimeMillis(),"recordingSession" to session)
        activity.getSharedPreferences("navigation-field-exploration",0).edit().putString("latest",org.json.JSONObject(record).toString()).apply()
        message("第${trial.segments}/3段已停止并记录；${if(trial.phase=="COMPLETE") "本轮采集结束" else "观察新画面后可选择下一段"}。地图数值仅作诊断。")
      } }
    }
  }
  @Synchronized fun frame(session: String,camera: RigidPose?,actualFloor: Boolean,clearance: RouteClearance) {
    val now=SystemClock.elapsedRealtime();currentSession=session
    val p=camera?.let { runCatching { RoutePose.fromCamera(it,mount.right,mount.alongView) }.getOrNull() }
    val fixed=poseLock.observe(p,camera?.t?.get(1),now,motor.isConnected(),motor.connectionRevision)
    if(!headFixed && fixed) notice=poseLock.reason
    if(headFixed && !fixed && !poseLock.isLocked) { backChecked=false;turnChecked=false;notice=poseLock.reason }
    if(!fixed && poseLock.report()["state"]=="CONNECTION_CHANGED") notice=poseLock.reason
    headFixed=fixed
    val o=RouteObservation(p,now,p!=null,actualFloor,clearance,motor.isConnected(),fixed)
    observation=o;teacher?.observe(p,p!=null && fixed)
    calibration?.let { trial ->
      when {
        p==null->trial.fail("LOCALIZATION_LOST")
        !motor.isConnected()->trial.fail("DISCONNECTED")
        !actualFloor->trial.fail("GROUND_REFERENCE_INVALID")
        !fixed->trial.fail(poseLock.failureReason())
      }
      trial.observe(p,now)
      trial.result?.let { result ->
        calibration=null;lastMeasurement=result.report()+mapOf("mount" to mountSettings.report(),"atEpochMs" to System.currentTimeMillis(),
          "clearAreaSource" to "operator-confirmed-single-trial","poseLock" to poseLock.report(),"floorValid" to actualFloor,
          "connected" to motor.isConnected(),"mapCameraY" to camera?.t?.get(1),"floorFlowBefore" to calibrationFlowStart,"floorFlowDiagnostic" to floorFlow())
        if(result.direction=="back") backChecked=result.valid
        else if(result.direction=="left") { turnChecked=result.valid;if(result.valid) invertTurns=result.yawRadians>0 }
        if(!result.valid) motor.stop("标定位姿检查失败")
        val record=lastMeasurement!!
        activity.getSharedPreferences("navigation-pulse-measurements",0).edit().putString("latest",org.json.JSONObject(record).toString()).apply()
        val failure=when(result.reason) {
          "LOCALIZATION_LOST","POSE_GAP"->"定位中断或位姿更新间隔过长"
          "MOUNT_MOVED","MOUNT_CHECK_INVALID"->"固定姿态检查失效，请核对定位与手机安装"
          "MAP_HEIGHT_CHANGED"->"地图定位高度变化；这不代表脖子抬起，请先核对定位"
          "MOUNT_TILT_CHANGED"->"相机倾角发生变化，请核对手机安装与头部姿态"
          "CONNECTION_CHANGED"->"底座连接发生变化，请重新确认连接与最低姿态"
          "DISCONNECTED"->"底座连接已中断"
          "GROUND_REFERENCE_INVALID"->"地面参考或定位已失效"
          "PRECONDITION_CHANGED"->"连接、固定姿态或地面状态发生变化"
          "NOT_SETTLED"->"位姿尚未稳定"
          "ACK_TIMEOUT","ACTION_FAILED"->"动作回执失败或超时"
          "POSE_OR_MOTION_JUMP","CLOCK_RESET"->"定位跳变或时间异常"
          else->"实际方向、位移或转向中心与预期不符"
        }
        message(if(result.valid) "已测：位移%.1f厘米 / 转角%.1f° / 回执后余移%.1f厘米；停车边界尚未验收。".format(result.displacementMeters*100,result.yawRadians*180/PI,result.postAckResidualMeters*100)
          else "本轮测量未通过：$failure，请核对后再试。")
      }
    }
    val f=follower
    if (f!=null) {
      val decision=f.step(o,now)
      if(decision.stop && now-lastStop>300) { lastStop=now;motor.stop(decision.reason,false) }
      if(decision.pulse!=null && !motor.busy && now-lastIssued>180) {
        lastIssued=now
        val pulse=decision.pulse;val direction=if(invertTurns && pulse.direction!="back") if(pulse.direction=="left") "right" else "left" else pulse.direction
        motor.request(direction,pulse.durationMs) { ok,s->if(!ok && f.phase in listOf("FOLLOWING","FACING_USER")) { f.pause(s);message(s) } }
      }
    }
    if (now-lastUi>500) {
      lastUi=now
      val text=when {
        teacher!=null -> teacher?.failure ?: "教路线中 · ${teacher!!.size()}个路点"
        f!=null -> "${f.route.name} · ${f.phase} · ${f.waypoint.coerceAtMost(f.route.points.size)}/${f.route.points.size}\n${f.reason}"
        else -> notice
      }
      val poseStatus=if(fixed) "姿态已确认" else if(poseLock.failureReason()=="MAP_HEIGHT_CHANGED") "定位高度待核对" else "姿态待确认"
      activity.runOnUiThread { if(::status.isInitialized) status.text="$text\n底座${if(motor.isConnected()) "已连接" else "未连接"} · $poseStatus · 语音停止${if(motor.voiceStopReady) "已开" else "未开，请用停止按钮"}" }
    }
  }
  fun report(): Map<String,Any?> = mapOf("phase" to (if(teacher!=null) "TEACHING" else follower?.phase ?: "IDLE"),
    "routeName" to (follower?.route?.name ?: selected?.name),"waypoint" to follower?.waypoint,"headFixed" to headFixed,
    "backDirectionChecked" to backChecked,"turnDirectionChecked" to turnChecked,"connected" to motor.isConnected(),
    "mountMeasurement" to mountSettings.report(),"poseLock" to poseLock.report(),"pulseMeasurementRunning" to (calibration!=null),"lastPulseMeasurement" to lastMeasurement,
    "operatorExploration" to field?.report(),"reason" to (follower?.reason ?: notice))
  companion object {
    fun referenceKey(map: RoomMapData): String {
      if(map.referenceJpeg.isEmpty() || map.imageFromMap==null) return ""
      val digest=MessageDigest.getInstance("SHA-256");digest.update(map.referenceJpeg)
      digest.update((map.referenceWidth.toString()+map.imageFromMap.t.joinToString()+map.imageFromMap.q.joinToString()).toByteArray())
      return digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    }
  }
}
