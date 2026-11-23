package com.myyaya.navigationprobe

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.*
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.widget.*
import androidx.core.content.FileProvider
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.json.JSONObject
import org.json.JSONArray
import kotlin.math.*

/** Semantic graph/editor and live home coordinates. Motor timing stays in the existing owner. */
internal class HomeNavigationPanel(private val activity: Activity,private val motor: RouteMotorGateway,
  private val metadata: ()->RoomMapData?,private val saveMap: ()->Unit,private val snapshot: ()->RoomMapData?=metadata) {
  private val store=HomeAtlasStore(activity)
  private val tracker=HomePoseTracker()
  private val main=Handler(Looper.getMainLooper())
  private var atlas: HomeAtlas?=null
  private var loadError: String?=null
  private var task=JSONObject().put("phase","IDLE")
  private var teaching=false;private var from: String?=null
  private val trace=ArrayList<HomePose>();private var teachingRevision=0
  private var confirmedConnection=-1L
  private var mountAngles: Pair<Float,Float>?=null
  private var confirmedAngles: Pair<Float,Float>?=null
  private var held: String?=null;private var holdUntil=0L
  private var lastRender=0L;private var lastTeachingFrame=0L
  private var frameTimestampNs=0L;private var frameAtMs=0L;private var frameSession=""
  private var pendingTarget=""
  private val pendingCommands=HomeCommandInbox<JSONObject>()
  private var currentMap=""
  private var selected: String?=null
  private var activeRoute=emptyList<HomePose>()
  private var coverage=JSONArray()
  private lateinit var label: TextView
  private lateinit var view: HomeView
  private var notice="先建立家庭地图、确认最低姿态，再带领经过房间和门口。"
  private fun mount()=activity.getSharedPreferences("navigation-mount",0)
  fun floorHeight()=activity.getSharedPreferences("terrain-camera",0).getFloat("height",0f).takeIf {it in .03f.. .5f}
  private fun referenceKey(m: RoomMapData): String {
    val p=mount();return MessageDigest.getInstance("SHA-256").digest(m.referenceJpeg+
      "${m.referenceWidth}:${p.getFloat("right",0f)}:${p.getFloat("alongView",0f)}:${floorHeight()}".toByteArray()).joinToString(""){"%02x".format(it)}
  }
  @Synchronized private fun sync(): HomeAtlas {
    val m=requireNotNull(metadata()) {"请先新建或打开家庭地图"}
    if(currentMap!=m.id) {
      stop("切换家庭地图");if(tracker.mapIdentifier!=m.id)tracker.reset();currentMap=m.id;atlas=null;loadError=null;coverage=JSONArray()
      runCatching {store.load(m.id)}.onSuccess {atlas=it ?: HomeAtlas(m.id,referenceKey(m)).also(store::save)}
        .onFailure {loadError="家庭路线文件损坏，请导出记录后恢复备份：${it.message}"}
      runCatching {store.coverage(m.id)}.getOrNull()?.let {saved->if(saved.optString("referenceKey")==referenceKey(m))coverage=saved.optJSONArray("cells") ?: JSONArray()}
      task=runCatching {store.task(m.id)}.getOrElse {JSONObject().put("phase","RECOVERY_REQUIRED").put("reason","旧任务无法读取，请导出记录；家庭地图仍可使用")} ?: JSONObject().put("phase","IDLE")
      if(task.optString("phase") in setOf("RUNNING","PREPARING","PAUSED","WAITING_LOCALIZATION")) {
        task.put("phase","PAUSED_RESTART").put("reason","已恢复旧任务；请重新定位并选择继续，不会自动发车")
      }
    }
    check(loadError==null){loadError!!};val a=requireNotNull(atlas)
    if(a.referenceKey!=referenceKey(m) && a.places.isEmpty()) {atlas=HomeAtlas(m.id,referenceKey(m));coverage=JSONArray();return atlas!!}
    check(a.referenceKey==referenceKey(m)) {"参照图或安装标定已变化，请重新建立家庭路线"};return a
  }
  @Synchronized private fun persist(a: HomeAtlas) {store.save(a);atlas=a;activeRoute=emptyList();saveMap();render()}
  private fun say(s: String) {notice=s;activity.runOnUiThread {render()}}
  private fun attempt(block: ()->Unit) {runCatching(block).onFailure {say(it.message ?: "操作未完成")}}
  private fun button(text: String,block: ()->Unit)=Button(activity).apply {this.text=text;textSize=12f;isAllCaps=false;setOnClickListener {attempt(block)}}
  fun buildView(): View=LinearLayout(activity).apply {
    orientation=1
    addView(TextView(activity).apply {text="家庭导航 · 建图、房间与路线";setTextColor(Color.WHITE);textSize=17f})
    label=TextView(activity).apply {textSize=13f;setTextColor(Color.CYAN)};addView(label)
    view=HomeView();addView(view,LinearLayout.LayoutParams(-1,(220*resources.displayMetrics.density).toInt()))
    fun row(vararg items: Pair<String,()->Unit>) {addView(LinearLayout(activity).apply {for((s,f) in items)addView(button(s,f),LinearLayout.LayoutParams(0,-2,1f))})}
    row("已最低，确认姿态" to {confirm()},"开始带领" to {ask("带领起点名称","起点"){beginTeaching(it)}},
      "结束带领" to {ask("终点名称",if(trace.zipWithNext().sumOf {(a,b)->a.distance(b)}<.1) atlas?.named(from ?: "")?.name ?: "终点" else "终点"){finishTeaching(it)}})
    row("记住房间/地点" to {ask("记住当前位置","客厅"){mark(it,"room",it)}},
      "记住门口" to {ask("门口名称","客厅门口"){mark(it,"door","")}},"选择目的地" to {chooseDestination()})
    row("编辑地图" to {editMenu()},"暂停" to {command(JSONObject().put("op","pause"))},
      "继续" to {command(JSONObject().put("op","resume"))},"取消任务" to {command(JSONObject().put("op","cancel"))})
    row("恢复定位" to {command(JSONObject().put("op","relocalize"))},"导出导航记录" to {export()})
    row("附近逛一圈再回来" to {command(JSONObject().put("op","patrol"))})
    row("巡视登记房间并返回" to {command(JSONObject().put("op","inspect").put("scope","all"))},"到点拍照并返回" to {
      val a=sync();check(a.places.isNotEmpty()){"请先登记地点"}
      AlertDialog.Builder(activity).setTitle("选择拍照地点").setItems(a.places.map {it.name}.toTypedArray()){_,i->attempt {command(JSONObject().put("op","inspect").put("scope","place").put("action","photo").put("target",a.places[i].id))}}.setNegativeButton("取消",null).show()
    })
    addView(TextView(activity).apply {text="带领时保持手机安装和最低高度；按住方向键行驶，松开停车。每次长按约3秒，再按可继续。";setTextColor(Color.LTGRAY);textSize=11f})
    addView(LinearLayout(activity).apply {
      for((title,direction) in listOf("左转" to "left","朝镜头走" to "back","右转" to "right"))addView(Button(activity).apply {
        text=title;setOnTouchListener {_,e->when(e.actionMasked){MotionEvent.ACTION_DOWN->{attempt {startHold(direction)};true}
          MotionEvent.ACTION_UP,MotionEvent.ACTION_CANCEL->{endHold();true};else->true}}
      },LinearLayout.LayoutParams(0,-2,1f))
    })
    render()
  }
  @Synchronized fun confirm() {check(motor.isConnected()){ "请先连接LOOI" };check(floorHeight()!=null){"请填写镜头高度"}
    check(mountAngles!=null){"请先打开实时相机"};confirmedAngles=mountAngles
    confirmedConnection=motor.connectionRevision;say("已记录最低姿态确认；断连后需要再次确认。")
    pendingCommands.pending?.let {request->command(request);pendingCommands.completed(request)}
  }
  @Synchronized fun queue(request: JSONObject) {sync();pendingCommands.queue(request);say("已打开所需操作，请恢复地图定位并确认最低姿态后执行。")}
  private fun freshPose()=frameAtMs>0 && SystemClock.elapsedRealtime()-frameAtMs in 0..300 && tracker.ready(frameTimestampNs)
  @Synchronized private fun pose(): HomePose {check(freshPose()){tracker.reason};return requireNotNull(tracker.pose)}
  @Synchronized fun status(): Map<String,Any?> {
    val a=runCatching {sync()}.getOrNull()
    return mapOf("atlas" to a?.let {mapOf("mapId" to it.mapId,"revision" to it.revision,"requiresReference" to it.referenceKey.isNotEmpty())},"pose" to tracker.pose?.report(),"localized" to freshPose(),
      "poseRevision" to tracker.revision,"connectionConfirmed" to (confirmedConnection==motor.connectionRevision && motor.isConnected()),
      "teaching" to teaching,"task" to task.toString(),"notice" to notice,"localizationReason" to (loadError ?: tracker.reason))
  }
  @Synchronized fun frame(raw: RigidPose?,mapped: RigidPose?,mapId: String,session: String,ns: Long,flow: Map<String,Any?>) {
    if(frameSession!=session){frameSession=session;frameTimestampNs=0;frameAtMs=0}
    if(ns>frameTimestampNs){frameTimestampNs=ns;frameAtMs=SystemClock.elapsedRealtime()}
    if(currentMap!=mapId)runCatching {sync()}.onFailure {loadError=it.message}
    if(raw==null){tracker.lost();if(teaching){teaching=false;held=null;motor.stop("带领相机跟踪丢失");say("带领已中断：定位丢失，最后未完成路段没有保存")};return}
    val p=mount();val r=p.getFloat("right",0f).toDouble();val f=p.getFloat("alongView",0f).toDouble()
    val angle=RoutePose.fromCamera(raw,r.toFloat(),f.toFloat()).let {it.pitch to it.roll};mountAngles=angle
    confirmedAngles?.let {old->if(confirmedConnection==motor.connectionRevision && (abs(wrapYaw(angle.first-old.first))>.10f || abs(wrapYaw(angle.second-old.second))>.08f)) {
      confirmedConnection=-1;stop("手机或脖子倾角改变");say("安装姿态改变，请恢复最低并重新确认")
    }}
    fun yaw(c: RigidPose): Double {val q=c.q;return atan2(-2.0*(q[0]*q[2]+q[1]*q[3]),1.0-2.0*(q[0]*q[0]+q[1]*q[1]))}
    val known=mapped?.let {val y=yaw(it);HomePose(it.t[0]+cos(y)*r+sin(y)*f,-it.t[2]-sin(y)*r+cos(y)*f,y)}
    tracker.frame(mapId,session,ns,yaw(raw),known,flow,r,f)
    if(teaching) {
      if(tracker.revision!=teachingRevision || !tracker.ready(ns) && lastTeachingFrame>0 && ns-lastTeachingFrame>800_000_000L) {
        teaching=false;held=null;motor.stop("带领定位中断");say("带领已中断，当前未完成路段没有保存，请重新定位")
      } else if(tracker.ready(ns)) {
        lastTeachingFrame=ns;val now=tracker.pose!!;val last=trace.lastOrNull()
        if(last==null || now.distance(last)>=.06 || abs(atan2(sin(now.yaw-last.yaw),cos(now.yaw-last.yaw)))>=.2) {
          if(trace.size>=4096 || last?.distance(now)?.let {it>.35}==true){teaching=false;held=null;motor.stop("带领数据超限");say("请结束并拆分这段路线")}
          else trace.add(now)
        }
      }
    }
    if(SystemClock.elapsedRealtime()-lastRender>500){lastRender=SystemClock.elapsedRealtime();activity.runOnUiThread {render()}}
  }
  @Synchronized fun expectFlowReset() {tracker.expectFlowReset()}
  @Synchronized fun canInitializeVisualMap()=atlas?.let {it.places.isEmpty() && it.links.isEmpty()}==true &&
    !teaching && task.optString("phase") !in setOf("RUNNING","PREPARING","PAUSED","PAUSED_RESTART","WAITING_LOCALIZATION")
  @Synchronized fun beginTeaching(name: String) {
    val a=sync();HomeWorkflow.requireTeaching(task.optString("phase"),teaching);val at=pose()
    check(metadata()?.referenceJpeg?.isNotEmpty()==true){"家庭路线重开后需要固定参照图；请在新地图首次扫描前登记"}
    check(confirmedConnection==motor.connectionRevision && motor.isConnected()){ "请确认连接和最低姿态" }
    val old=a.named(name);check(old==null || old.pose.distance(at)<=.15){"请回到这个起点，或使用新起点名称"}
    val next=if(old==null)a.remember(name,"","point",at) else a
    persist(next);from=next.named(name)!!.id;trace.clear();trace.add(next.named(name)!!.pose);trace.add(at)
    teachingRevision=tracker.revision;lastTeachingFrame=frameTimestampNs;teaching=true;say("正在带领；经过房间或门口时记名，末尾选择结束带领。")
  }
  @Synchronized fun mark(name: String,kind: String,room: String) {
    check(task.optString("phase") !in setOf("RUNNING","PREPARING")){"请先暂停导航再登记地点"}
    val a=sync();val at=pose();val clean=name.trim();val old=a.named(clean)
    if(teaching && old!=null)check(old.pose.distance(at)<=.12){"同名地点不在这里；请结束带领后用移动地点更新"}
    var next=if(teaching && old!=null)a else a.remember(clean,room,kind,at)
    val node=next.named(clean)!!
    if(teaching && from!=node.id) {
      val path=trace.toMutableList();if(path.last().distance(node.pose)>.025)path.add(node.pose)
      next=next.teach(requireNotNull(from),node.id,path);from=node.id;trace.clear();trace.add(node.pose)
    }
    persist(next);say("已记住${node.name}${if(teaching) "，继续带领" else ""}")
  }
  @Synchronized fun finishTeaching(name: String) {
    check(teaching){"尚未开始带领"}
    val clean=name.trim();val last=sync().named(from ?: "")
    if(clean.isEmpty())check(last!=null && last.pose.distance(pose())<=.12){"请为终点命名，例如结束带领到客厅"}
    else mark(clean,"point","")
    teaching=false;endHold();saveMap();say("带领路线已保存，可选择目的地试运行。")
  }
  @Synchronized fun command(v: JSONObject): Map<String,Any?> {
    val op=v.getString("op")
    if(op=="export"){export();return status()}
    sync()
    when(op) {
      "status"->Unit
      "confirm"->confirm()
      "teach"->beginTeaching(v.getString("name"))
      "finish"->finishTeaching(v.getString("name"))
      "remember"->mark(v.getString("name"),v.optString("kind","point"),v.optString("room",""))
      "rename"->{stop("修改地图");persist(sync().rename(v.getString("id"),v.getString("name")))}
      "move"->{stop("移动地点");val a=sync();val n=requireNotNull(a.named(v.getString("id")));persist(a.remember(n.name,n.room,n.kind,pose()));say("地点已移到当前位置，请重新带领相关路线")}
      "remove"->{stop("删除地点");persist(sync().remove(v.getString("id")))}
      "link_enabled"->{stop("修改通道");val a=sync();val id=v.getString("id");check(a.links.any {it.id==id});persist(a.copy(revision=a.revision+1,links=a.links.map {if(it.id==id)it.copy(enabled=v.getBoolean("enabled")) else it}))}
      "zone"->{stop("修改禁行区");val a=sync();val at=if(v.has("placeId")) requireNotNull(a.named(v.getString("placeId"))){"没有这个地点"}.pose
        else if(v.has("x"))HomePose(v.getDouble("x"),v.getDouble("y")) else pose()
        persist(a.copy(revision=a.revision+1,zones=a.zones+HomeZone(name=v.optString("name","禁行区"),x=at.x,y=at.y,radius=v.optDouble("radius",.15))))}
      "remove_zone"->{stop("修改禁行区");val a=sync();val id=v.getString("id");check(a.zones.any {it.id==id}){"没有这个禁行区"};persist(a.copy(revision=a.revision+1,zones=a.zones.filter {it.id!=id}))}
      "go"->{check(!teaching){"请先结束带领"};pendingTarget=v.getString("target");launch()}
      "patrol"->launchPatrol(false)
      "inspect"->{if(v.optString("scope","current")=="current")launchPatrol(false,v.optString("action","observe")) else launchInspection(v,false)}
      "pause"->{stop("用户暂停");task.put("phase","PAUSED");saveTask()}
      "cancel"->{stop("用户取消");task.put("phase","CANCELLED");saveTask();pendingTarget=""}
      "resume"->{check(task.has("destination") && task.optString("phase") in setOf("PAUSED","PAUSED_RESTART","WAITING_LOCALIZATION","BLOCKED","FAILED")){"没有可继续的任务"};when(task.optString("kind")){"patrol"->launchPatrol(true);"inspection"->launchInspection(JSONObject(),true);else->{pendingTarget=task.getString("destination");launch()}}}
      "relocalize"->{stop("重新定位");tracker.reset();say("请让后摄看见原位置的固定参照图；未恢复定位不会发车")}
      else->error("不支持的家庭地图操作")
    }
    render();return status()
  }
  @Synchronized private fun launchPatrol(resume: Boolean,action: String="observe") {
    val a=sync();HomeWorkflow.requireNavigation(task.optString("phase"),teaching)
    check(!motor.busy && motor.continuous?.pilot?.active!=true){"上一动作尚未停车，请稍后重试"}
    check(confirmedConnection==motor.connectionRevision && motor.isConnected()){ "请确认连接和最低姿态" }
    val at=pose()
    store.save(a);saveMap()
    val saved=runCatching {store.coverage(a.mapId)}.getOrNull()
    coverage=if(saved?.optString("referenceKey")==a.referenceKey)saved.optJSONArray("cells") ?: JSONArray() else JSONArray()
    if(resume) {
      check(task.optInt("mapRevision")==a.revision){"地图已编辑，请重新开始附近巡游"}
      val start=task.getJSONObject("patrolStart");check(at.distance(HomePose(start.getDouble("x"),start.getDouble("y")))<=.92){"离原巡游起点过远，请重新定位"}
      task.put("id",UUID.randomUUID().toString()).put("phase","PREPARING")
    } else task=JSONObject().put("id",UUID.randomUUID().toString()).put("kind","patrol").put("phase","PREPARING")
      .put("destination","__patrol__").put("destinationName","附近巡游起点").put("patrolStart",JSONObject(at.report()))
      .put("patrolTrail",JSONArray().put(JSONObject(at.report()))).put("patrolElapsedMs",0).put("mapRevision",a.revision).put("startedAt",System.currentTimeMillis())
    if(!resume)task.put("inspectionId",task.getString("id")).put("inspectionAction",action)
      .put("mapping",if(action=="rescan")"rescan" else if(HomeInspectionPlanner.hasLocalRoute(a,at) || (0 until coverage.length()).count {i->val c=coverage.getJSONArray(i);c.getInt(2)==1 && hypot(c.getDouble(0)-at.x,c.getDouble(1)-at.y)<.35}>=4)"existing" else "local-new")
      .put("roomName",a.places.filter {it.kind=="room" && it.pose.distance(at)<.8}.minByOrNull {it.pose.distance(at)}?.name ?: "当前位置")
    saveTask()
    try {motor.homeNavigate()}catch(e: Exception){task.put("phase","BLOCKED").put("reason",e.message ?: "控制通道未就绪");saveTask();throw e}
    say("准备附近短巡游：半径最多80厘米、整轮最多2分钟，记录新观察地面并沿实际轨迹返回。不是全屋建图。")
  }
  @Synchronized private fun launchInspection(v: JSONObject,resume: Boolean) {
    val a=sync();HomeWorkflow.requireNavigation(task.optString("phase"),teaching)
    check(!motor.busy && motor.continuous?.pilot?.active!=true){"上一任务尚未停车"}
    check(confirmedConnection==motor.connectionRevision && motor.isConnected()){ "请确认连接和最低姿态" }
    val at=pose()
    val targets=if(resume)(0 until task.getJSONArray("inspectionTargets").length()).map {task.getJSONArray("inspectionTargets").getString(it)}
      else if(v.optString("scope")=="all")a.places.filter {it.kind=="room"}.sortedBy {it.pose.distance(at)}.map {it.id}
      else listOf(requireNotNull(a.named(v.getString("target"))){"尚未登记这个房间或地点"}.id)
    check(targets.isNotEmpty()){"尚未登记房间，可先在当前位置短巡查补图"}
    val original=if(resume)task.getJSONObject("inspectionStart").let {HomePose(it.getDouble("x"),it.getDouble("y"),it.getDouble("yaw"))} else at
    val done=if(resume)task.optJSONArray("inspectionDone") ?: JSONArray() else JSONArray()
    val doneIds=(0 until done.length()).map {done.getString(it)}
    HomeInspectionPlanner.plan(a,at,original,targets.filter {it !in doneIds},robotRadius())
    if(resume){check(task.optInt("mapRevision")==a.revision){"地图已编辑，原任务需重新安排"};task.put("id",UUID.randomUUID().toString()).put("phase","PREPARING")}
    else task=JSONObject().put("id",UUID.randomUUID().toString()).put("kind","inspection").put("phase","PREPARING")
      .put("destination","__inspection__").put("destinationName","巡查出发位置").put("inspectionTargets",JSONArray(targets))
      .put("inspectionStart",JSONObject(original.report())).put("inspectionDone",done).put("inspectionAction",v.optString("action","observe"))
      .put("mapping",if(v.optString("action")=="rescan")"rescan" else "existing").put("mapRevision",a.revision).put("startedAt",System.currentTimeMillis())
    if(!resume)task.put("inspectionId",task.getString("id"))
    saveTask();try {motor.homeNavigate()}catch(e:Exception){task.put("phase","BLOCKED").put("reason",e.message);saveTask();throw e}
    say("已有地点与路线，准备前往观察、保存照片，再返回出发位置。")
  }
  @Synchronized private fun launch() {
    val a=sync();HomeWorkflow.requireNavigation(task.optString("phase"),teaching)
    check(!motor.busy && motor.continuous?.pilot?.active!=true){"上一动作尚未停车，请稍后重试"}
    val n=requireNotNull(a.named(pendingTarget)){"还没有这个目的地，请先带领并记名"}
    check(confirmedConnection==motor.connectionRevision && motor.isConnected()){ "请确认连接和最低姿态" }
    val route=HomeRoutePlanner.plan(a,pose(),n.id,robotRadius())
    task=JSONObject().put("id",UUID.randomUUID().toString()).put("phase","PREPARING").put("destination",n.id)
      .put("destinationName",n.name).put("mapRevision",a.revision).put("meters",route.meters).put("startedAt",System.currentTimeMillis())
    saveTask()
    try {motor.homeNavigate()}catch(e: Exception){task.put("phase","BLOCKED").put("reason",e.message ?: "控制通道未就绪");saveTask();throw e}
    say("准备前往${n.name}，正在检查实时地板与定位。")
  }
  fun robotRadius(): Double {val p=activity.getSharedPreferences("terrain-envelope",0);return (max(p.getFloat("width",.15f),p.getFloat("length",.1f))/2+p.getFloat("margin",.02f)).toDouble()}
  @Synchronized fun plan(): Map<String,Any?> {
    val a=sync();check(task.optString("phase")=="PREPARING");val start=pose()
    if(task.optString("kind")=="patrol")return mapOf("taskId" to task.getString("id"),"mapId" to a.mapId,"revision" to a.revision,"poseRevision" to tracker.revision,
      "origin" to start.report(),"targetName" to "附近巡游起点","mode" to "patrol","patrolStart" to task.getJSONObject("patrolStart").toString(),
      "inspectionId" to task.optString("inspectionId"),"inspectionAction" to task.optString("inspectionAction","observe"),"mapping" to task.optString("mapping","existing"),"roomName" to task.optString("roomName","当前位置"),
      "patrolTrail" to task.getJSONArray("patrolTrail").toString(),"patrolElapsedMs" to task.optLong("patrolElapsedMs"),"coverage" to coverage.toString(),
      "points" to listOf(start.report(),HomePose(start.x,start.y+.15).report()),"zones" to a.zones.map {mapOf("x" to it.x,"y" to it.y,"radius" to it.radius)},"robotRadius" to robotRadius())
    if(task.optString("kind")=="inspection") {
      val done=task.getJSONArray("inspectionDone");val ids=(0 until done.length()).map {done.getString(it)}
      val targets=task.getJSONArray("inspectionTargets");val original=task.getJSONObject("inspectionStart").let {HomePose(it.getDouble("x"),it.getDouble("y"),it.getDouble("yaw"))}
      val trip=HomeInspectionPlanner.plan(a,start,original,(0 until targets.length()).map {targets.getString(it)}.filter {it !in ids},robotRadius())
      activeRoute=trip.points
      return mapOf("taskId" to task.getString("id"),"mapId" to a.mapId,"revision" to a.revision,"poseRevision" to tracker.revision,"origin" to start.report(),
        "targetName" to "巡查出发位置","mode" to "inspection","inspectionId" to task.getString("inspectionId"),"inspectionAction" to task.optString("inspectionAction","observe"),
        "mapping" to task.optString("mapping","existing"),"coverage" to coverage.toString(),"inspectionDone" to ids,"inspectionStops" to trip.stops.map {mapOf("id" to it.id,"name" to it.name,"pose" to it.pose.report(),"arc" to it.arc)},
        "points" to trip.points.map(HomePose::report),"zones" to a.zones.map {mapOf("x" to it.x,"y" to it.y,"radius" to it.radius)},"robotRadius" to robotRadius())
    }
    val route=HomeRoutePlanner.plan(a,start,task.getString("destination"),robotRadius())
    activeRoute=route.points
    return mapOf("taskId" to task.getString("id"),"mapId" to a.mapId,"revision" to a.revision,"poseRevision" to tracker.revision,
      "origin" to start.report(),"targetName" to route.destination.name,"points" to route.points.map(HomePose::report),
      "zones" to a.zones.map {mapOf("x" to it.x,"y" to it.y,"radius" to it.radius)},"robotRadius" to robotRadius())
  }
  @Synchronized fun progress(v: JSONObject) {
    check(v.getString("taskId")==task.optString("id")){"旧任务不能覆盖新任务"}
    if(task.optString("phase") in setOf("CANCELLED","PAUSED","PAUSED_RESTART"))return
    if(v.has("inspectionDone")){val done=v.getJSONArray("inspectionDone");require(done.length()<=6);task.put("inspectionDone",done)}
    if(task.optString("kind") in setOf("patrol","inspection")) {
      if(v.has("patrolTrail")) {
        val trail=v.getJSONArray("patrolTrail");require(trail.length() in 1..128)
        for(i in 0 until trail.length()){val p=trail.getJSONObject(i);HomePose(p.getDouble("x"),p.getDouble("y"),p.getDouble("yaw"))}
        task.put("patrolTrail",trail)
        activeRoute=(0 until trail.length()).map {val p=trail.getJSONObject(it);HomePose(p.getDouble("x"),p.getDouble("y"),p.getDouble("yaw"))}
      }
      if(v.has("patrolElapsedMs"))task.put("patrolElapsedMs",v.getLong("patrolElapsedMs").coerceIn(0,120_000))
      if(v.has("coverage")) {
        val cells=v.getJSONArray("coverage");require(cells.length()<=8000)
        for(i in 0 until cells.length()){val c=cells.getJSONArray(i);require(c.length()==3 && abs(c.getDouble(0))<=50 && abs(c.getDouble(1))<=50 && c.getInt(2) in 1..4)}
        coverage=cells;store.coverage(currentMap,JSONObject().put("referenceKey",sync().referenceKey).put("cells",cells));saveMap()
      }
    }
    for(k in listOf("phase","reason","waypoint","total","remainingMeters","pose","nativeToken"))if(v.has(k))task.put(k,v.get(k))
    notice=if(task.optString("kind")=="patrol")when(task.optString("phase")){"COMPLETED"->"附近短巡游已回到起点并停车；不代表整个房间建图完成";"BLOCKED"->"巡游已暂停：${task.optString("reason")}";else->v.optString("reason","正在附近巡游")}
      else when(task.optString("phase")){"COMPLETED"->"已到达${task.optString("destinationName")}并停车";"BLOCKED"->"导航已暂停，可处理后继续原目的地";else->"正在前往${task.optString("destinationName")}，黄色为计划路线"}
    store.event(currentMap,mapOf("task" to task.toString()));saveTask();render()
  }
  private fun saveTask() {if(currentMap.isNotEmpty())store.task(currentMap,task)}
  @Synchronized fun stop(why: String) {pendingCommands.clear();held=null;teaching=false;if(task.optString("phase") in setOf("RUNNING","PREPARING")){task.put("phase","PAUSED").put("reason",why);saveTask()};motor.stop(why);render()}
  private fun startHold(direction: String) {check(teaching){"请先开始带领"};pose();check(confirmedConnection==motor.connectionRevision){"请重新确认最低姿态"}
    held=direction;holdUntil=SystemClock.elapsedRealtime()+3000;stepHold()}
  private fun stepHold() {
    val d=held ?: return
    if(SystemClock.elapsedRealtime()>holdUntil || !teaching || !freshPose() || !motor.isConnected()){endHold();return}
    motor.request(d,200){ok,s->if(!ok){held=null;say(s)} else if(held==d)main.postDelayed({stepHold()},30)}
  }
  private fun endHold() {held=null;motor.stop("带领方向键松开")}
  private fun ask(title: String,initial: String,done: (String)->Unit) {
    val input=EditText(activity).apply {setSingleLine();setText(initial)}
    AlertDialog.Builder(activity).setTitle(title).setView(input).setNegativeButton("取消",null)
      .setPositiveButton("确定"){_,_->attempt {done(input.text.toString())}}.show()
  }
  private fun chooseDestination() {val a=sync();check(a.places.isNotEmpty()){ "请先带领并记住地点" }
    AlertDialog.Builder(activity).setTitle("去哪里").setItems(a.places.map {it.name}.toTypedArray()){_,i->attempt {pendingTarget=a.places[i].id;launch()}}.setNegativeButton("取消",null).show()}
  private fun editMenu() {
    val a=sync();val items=a.places.map {"地点 · ${it.name}"}+a.links.map {"${if(it.enabled) "停用" else "启用"}路线 · ${a.named(it.from)?.name} ↔ ${a.named(it.to)?.name}"}+a.zones.map {"删除禁行区 · ${it.name}"}
    AlertDialog.Builder(activity).setTitle("编辑家庭地图").setItems(items.toTypedArray()){_,i->attempt {
      when {i<a.places.size->editPlace(a.places[i]);i<a.places.size+a.links.size->{val e=a.links[i-a.places.size];command(JSONObject().put("op","link_enabled").put("id",e.id).put("enabled",!e.enabled))}
        else->command(JSONObject().put("op","remove_zone").put("id",a.zones[i-a.places.size-a.links.size].id))}
    }}.setNegativeButton("关闭",null).show()
  }
  private fun editPlace(p: HomePlace) {selected=p.id;view.invalidate()
    AlertDialog.Builder(activity).setTitle(p.name).setItems(arrayOf("修改名称","移动到当前位置（需重教相关路线）","删除地点和关联路线")){_,i->attempt {
      when(i){0->ask("地点名称",p.name){command(JSONObject().put("op","rename").put("id",p.id).put("name",it))};1->command(JSONObject().put("op","move").put("id",p.id));2->command(JSONObject().put("op","remove").put("id",p.id))}
    }}.setNegativeButton("取消",null).show()}
  private fun render() {if(Looper.myLooper()!=Looper.getMainLooper()){activity.runOnUiThread {render()};return};if(!::label.isInitialized)return
    val phase=mapOf("IDLE" to "待命","PREPARING" to "准备出发","RUNNING" to "正在前往","PAUSED" to "已暂停","PAUSED_RESTART" to "待恢复定位","BLOCKED" to "等待处理","COMPLETED" to "已经到达","CANCELLED" to "已取消","RECOVERY_REQUIRED" to "旧记录待恢复")[task.optString("phase")] ?: "等待定位"
    label.text="$notice\n${tracker.reason} · ${if(teaching) "正在带领 ${trace.size}点" else phase} ${task.optString("destinationName","")} ${task.optString("reason","")}";view.invalidate()}
  private fun export() {
    val map=requireNotNull(snapshot()) {"请先打开家庭地图"};require(UUID.fromString(map.id).toString()==map.id)
    val folder=File(activity.cacheDir,"diagnostics").apply {mkdirs()};val out=File(folder,"home-navigation-${System.currentTimeMillis()}.zip")
    val sources=store.directory.listFiles().orEmpty().filter {it.name.startsWith(map.id+".")}
    ZipOutputStream(out.outputStream()).use {zip->zip.putNextEntry(ZipEntry(map.id+".yayamap"));zip.write(RoomMapCodec.encode(map));zip.closeEntry()
      for(f in sources.filter {it.isFile && it.length()<=8_000_000}){zip.putNextEntry(ZipEntry(f.name));f.inputStream().use {it.copyTo(zip)};zip.closeEntry()}
      zip.putNextEntry(ZipEntry("status.json"));zip.write(JSONObject(status()).toString().toByteArray());zip.closeEntry()}
    val uri=FileProvider.getUriForFile(activity,activity.packageName+".myyaya.reference-photo",out)
    activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/zip").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),"导出家庭地图与导航记录"))
  }
  private inner class HomeView: View(activity) {
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG);private var scale=1f;private var cx=0.0;private var cy=0.0
    private fun sx(x: Double)=width/2f+((x-cx)*scale).toFloat()
    private fun sy(y: Double)=height/2f-((y-cy)*scale).toFloat()
    override fun onDraw(c: Canvas) {
      c.drawColor(Color.rgb(18,30,40));val a=atlas ?: return
      val observed=(0 until coverage.length()).map {coverage.getJSONArray(it)}
      val all=a.places.map {it.pose}+a.links.flatMap {it.points}+listOfNotNull(tracker.pose)+observed.map {HomePose(it.getDouble(0),it.getDouble(1))}
      if(all.isEmpty())return
      val minX=all.minOf {it.x}-.4;val maxX=all.maxOf {it.x}+.4;val minY=all.minOf {it.y}-.4;val maxY=all.maxOf {it.y}+.4
      cx=(minX+maxX)/2;cy=(minY+maxY)/2;scale=min(width/(maxX-minX),height/(maxY-minY)).toFloat()
      paint.strokeWidth=1f;paint.color=Color.DKGRAY
      var x=floor(minX*2)/2;while(x<=maxX){c.drawLine(sx(x),0f,sx(x),height.toFloat(),paint);x+=.5}
      var y=floor(minY*2)/2;while(y<=maxY){c.drawLine(0f,sy(y),width.toFloat(),sy(y),paint);y+=.5}
      for(cell in observed){val px=cell.getDouble(0);val py=cell.getDouble(1);paint.color=if(cell.getInt(2)==1)0x774caf82 else 0x88e17055.toInt()
        c.drawRect(sx(px-.025),sy(py+.025),sx(px+.025),sy(py-.025),paint)}
      for(z in a.zones){paint.color=0x88ff5555.toInt();c.drawCircle(sx(z.x),sy(z.y),(z.radius*scale).toFloat(),paint)}
      for(e in a.links){paint.color=if(e.enabled) Color.rgb(65,175,190) else Color.GRAY;paint.strokeWidth=4f
        e.points.zipWithNext().forEach {(u,v)->c.drawLine(sx(u.x),sy(u.y),sx(v.x),sy(v.y),paint)}}
      paint.color=Color.YELLOW;paint.strokeWidth=5f
      activeRoute.zipWithNext().forEach {(u,v)->c.drawLine(sx(u.x),sy(u.y),sx(v.x),sy(v.y),paint)}
      paint.textSize=24f
      for(p in a.places){paint.color=if(p.id==task.optString("destination")) Color.MAGENTA else if(p.id==selected)Color.YELLOW else Color.WHITE
        c.drawCircle(sx(p.pose.x),sy(p.pose.y),7f,paint);c.drawText(p.name,sx(p.pose.x)+9,sy(p.pose.y)-8,paint)}
      tracker.pose?.let {p->paint.color=if(freshPose())Color.GREEN else Color.GRAY;c.drawCircle(sx(p.x),sy(p.y),9f,paint)
        c.drawLine(sx(p.x),sy(p.y),sx(p.x+sin(p.yaw)*.12),sy(p.y+cos(p.yaw)*.12),paint)}
    }
    override fun onTouchEvent(e: MotionEvent): Boolean {
      if(e.action!=MotionEvent.ACTION_UP)return true
      attempt {val a=sync();val x=cx+(e.x-width/2)/scale;val y=cy-(e.y-height/2)/scale
        val p=a.places.minByOrNull {hypot(it.pose.x-x,it.pose.y-y)}
        if(p!=null && hypot(p.pose.x-x,p.pose.y-y)*scale<40)editPlace(p)
        else AlertDialog.Builder(activity).setTitle("添加禁行区").setMessage("在此处添加半径15厘米的禁行区？")
          .setNegativeButton("取消",null).setPositiveButton("添加"){_,_->attempt {command(JSONObject().put("op","zone").put("x",x).put("y",y).put("radius",.15))}}.show()}
      return true
    }
  }
}
