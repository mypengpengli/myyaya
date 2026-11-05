package com.myyaya.navigationprobe

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.os.SystemClock
import android.util.AtomicFile
import android.widget.*
import java.io.File
import java.security.MessageDigest
import kotlin.math.*

/** Route UI and observation adapter. Motor requests go through the existing BLE owner. */
internal class TaughtRoutePanel(private val activity: Activity,private val motor: RouteMotorGateway,
  private val metadata: ()->RoomMapData?,private val saveMap: ()->Unit) {
  private val directory=File(activity.filesDir,"taught-routes").apply { mkdirs() }
  private var mount=RouteMount()
  @Volatile private var teacher: RouteTeacher?=null
  @Volatile private var follower: RouteFollower?=null
  @Volatile private var selected: TaughtRoute?=null
  @Volatile private var observation: RouteObservation?=null
  @Volatile private var currentSession=""
  @Volatile private var headFixed=false
  @Volatile private var fixedPitch=0f
  @Volatile private var fixedRoll=0f
  @Volatile private var headSettlesAt=0L
  @Volatile private var backChecked=false
  @Volatile private var turnChecked=false
  private var invertTurns=false
  @Volatile private var calibration: Triple<String,RoutePose,Long>?=null
  private var lastStop=0L
  private var lastIssued=0L
  private var lastUi=0L
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
    val items=arrayOf("连接保存的底座","固定头部（回正）","设置镜头到底座偏移","开始教路线","完成并保存路线","选择已教路线",
      "短后退方向校验","短左转方向校验","开始复走","移开障碍后继续","停止")
    AlertDialog.Builder(activity).setTitle("已教路线导航 · 真实平整地面试验").setItems(items) { _,i->
      runCatching { when(i) {
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
      } }.onFailure { message(it.message ?: "操作未完成") }
    }.setNegativeButton("返回",null).show()
  }
  private fun current(): RouteObservation = observation?.takeIf { SystemClock.elapsedRealtime()-it.atMs<=500 }
    ?: error("请先开始扫描并恢复定位")
  private fun requireFloor(): RouteObservation {
    val o=current();check(o.tracking && o.pose!=null) { "请先恢复当前地图定位" }
    check(o.actualFloor && !o.playback) { "需要在真实平整地面选择实际地面；台面/回放不允许驱动" }
    check(o.headFixed) { "请先固定头部，之后不要抬头或低头" }
    return o
  }
  private fun fixHead() {
    check(follower?.phase !in listOf("FOLLOWING","FACING_USER")) { "请先停止复走" }
    motor.stop("固定头部前停止")
    headFixed=false;backChecked=false;turnChecked=false
    motor.request("head_center") { ok,s->
      if (ok) { headSettlesAt=SystemClock.elapsedRealtime()+800;message("头部已回正，保持装稳，等待姿态稳定。") }
      else message("头部回正失败：$s")
    }
  }
  private fun editMount() {
    check(teacher==null && follower?.phase !in listOf("FOLLOWING","FACING_USER")) { "请先停止教路线或复走" }
    val box=LinearLayout(activity).apply { orientation=1 }
    val x=EditText(activity).apply { hint="镜头到中心：沿屏幕右方向厘米，可负值";inputType=12290;setText("${mount.right*100}") }
    val z=EditText(activity).apply { hint="镜头到中心：沿后摄观察方向厘米，可负值";inputType=12290;setText("${mount.alongView*100}") }
    box.addView(x);box.addView(z)
    AlertDialog.Builder(activity).setTitle("固定安装偏移").setMessage("填写镜头到履带底座中心的水平偏移。0表示近似共点；第一版另留10厘米余量，仍需在地面验证。").setView(box)
      .setNegativeButton("取消",null).setPositiveButton("保存") { _,_->runCatching {
        mount=RouteMount(x.text.toString().toFloat()/100,z.text.toString().toFloat()/100);backChecked=false;turnChecked=false
      }.onFailure { message("偏移需为正负30厘米内的数字") } }.show()
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
  fun selectInitial(route: TaughtRoute) { selected=route;mount=route.mount;message("已选${route.name}，请开始扫描并恢复原地图定位，然后固定头部和做短动作校验。") }
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
    val o=requireFloor();check(o.clearance==RouteClearance.CLEAR) { "请先恢复新鲜近处深度并移开障碍" }
    check(motor.isConnected() && !motor.busy && teacher==null && follower?.phase !in listOf("FOLLOWING","FACING_USER")) { "请连接底座并停止当前操作" }
    motor.request(direction,if(direction=="back") 200 else 120) { ok,s->
      if (ok) { calibration=Triple(direction,o.pose!!,SystemClock.elapsedRealtime()+400);message("短动作结束，正在核对实际位姿。") }
      else message("校验动作未完成：$s")
    }
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
    teacher=null;calibration=null;follower?.cancel();motor.stop(reason);message(reason)
  }
  @Synchronized fun pause() {
    teacher?.observe(null,false);follower?.pause("界面或定位已暂停");calibration=null;headFixed=false;headSettlesAt=0
    backChecked=false;turnChecked=false;motor.stop("扫描已暂停")
  }
  @Synchronized fun holdForUi() {
    val f=follower
    if (f?.phase in listOf("FOLLOWING","FACING_USER")) { f?.pause("正在操作界面，请点继续复走恢复");motor.stop("导航操作菜单") }
  }
  fun basePose(camera: RigidPose)=RoutePose.fromCamera(camera,mount.right,mount.alongView)
  fun previewPoints()=selected?.points ?: emptyList()
  @Synchronized fun frame(session: String,camera: RigidPose?,actualFloor: Boolean,clearance: RouteClearance) {
    val now=SystemClock.elapsedRealtime();currentSession=session
    val p=camera?.let { runCatching { RoutePose.fromCamera(it,mount.right,mount.alongView) }.getOrNull() }
    if (headSettlesAt>0 && now>=headSettlesAt && p!=null) { headFixed=true;fixedPitch=p.pitch;fixedRoll=p.roll;headSettlesAt=0 }
    val fixed=headFixed && p!=null && abs(wrapYaw(p.pitch-fixedPitch))<=.12f && abs(wrapYaw(p.roll-fixedRoll))<=.12f
    val o=RouteObservation(p,now,p!=null,actualFloor,clearance,motor.isConnected(),fixed)
    observation=o;teacher?.observe(p,p!=null && fixed)
    calibration?.let { (direction,before,at)->if(now>=at) {
      calibration=null
      if(p==null) message("校验时定位丢失")
      else if(direction=="back") {
        val distance=p.distance(before);val along=(p.x-before.x)*sin(before.yaw)-(p.z-before.z)*cos(before.yaw)
        backChecked=distance in .008f.. .12f && along>distance*.7f && abs(wrapYaw(p.yaw-before.yaw))<.15f
        message(if(backChecked) "后退方向已通过，位移约${(distance*100).roundToInt()}厘米" else "后退位移或方向不稳定，请核对安装和定位后重试")
      } else {
        val yaw=wrapYaw(p.yaw-before.yaw);turnChecked=abs(yaw) in .025f.. .65f;invertTurns=yaw>0
        message(if(turnChecked) "转向已通过${if(invertTurns) "，已校正左右映射" else ""}" else "转向变化不足或定位异常，请重新校验")
      }
    } }
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
      activity.runOnUiThread { if(::status.isInitialized) status.text="$text\n底座${if(motor.isConnected()) "已连接" else "未连接"} · 头部${if(fixed) "固定" else "待固定"} · 语音停止${if(motor.voiceStopReady) "已开" else "未开，请用停止按钮"}" }
    }
  }
  fun report(): Map<String,Any?> = mapOf("phase" to (if(teacher!=null) "TEACHING" else follower?.phase ?: "IDLE"),
    "routeName" to (follower?.route?.name ?: selected?.name),"waypoint" to follower?.waypoint,"headFixed" to headFixed,
    "backDirectionChecked" to backChecked,"turnDirectionChecked" to turnChecked,"connected" to motor.isConnected(),"reason" to (follower?.reason ?: notice))
  companion object {
    fun referenceKey(map: RoomMapData): String {
      if(map.referenceJpeg.isEmpty() || map.imageFromMap==null) return ""
      val digest=MessageDigest.getInstance("SHA-256");digest.update(map.referenceJpeg)
      digest.update((map.referenceWidth.toString()+map.imageFromMap.t.joinToString()+map.imageFromMap.q.joinToString()).toByteArray())
      return digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    }
  }
}
