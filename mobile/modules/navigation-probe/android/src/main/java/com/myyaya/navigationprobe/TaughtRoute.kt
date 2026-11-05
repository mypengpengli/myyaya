package com.myyaya.navigationprobe

import java.io.*
import java.util.UUID
import java.util.zip.CRC32
import kotlin.math.*

internal fun wrapYaw(a: Float): Float = atan2(sin(a),cos(a))
internal data class RoutePose(val x: Float,val z: Float,val yaw: Float,val pitch: Float=0f,val roll: Float=0f) {
  init { require(listOf(x,z,yaw,pitch,roll).all { it.isFinite() } && abs(x)<=50 && abs(z)<=50) }
  fun distance(b: RoutePose)=hypot(x-b.x,z-b.z)
  companion object {
    fun fromCamera(camera: RigidPose,rightOffset: Float=0f,viewOffset: Float=0f): RoutePose {
      val forward=camera.point(floatArrayOf(0f,0f,-1f));val dx=forward[0]-camera.t[0];val dz=forward[2]-camera.t[2]
      val horizontal=hypot(dx,dz);require(horizontal>.4f) { "后摄朝向过陡，请恢复固定头部姿态" }
      val yaw=atan2(dx,-dz)
      val right=camera.point(floatArrayOf(1f,0f,0f));val up=camera.point(floatArrayOf(0f,1f,0f))
      return RoutePose(camera.t[0]+cos(yaw)*rightOffset+sin(yaw)*viewOffset,
        camera.t[2]+sin(yaw)*rightOffset-cos(yaw)*viewOffset,yaw,atan2(forward[1]-camera.t[1],horizontal),atan2(right[1]-camera.t[1],up[1]-camera.t[1]))
    }
  }
}
internal data class RouteMount(val right: Float=0f,val alongView: Float=0f) {
  init { require(right.isFinite() && alongView.isFinite() && abs(right)<=.3f && abs(alongView)<=.3f) }
}
internal data class TaughtRoute(val id: String=UUID.randomUUID().toString(),val name: String,val mapId: String,
  val sessionId: String,val referenceKey: String,val mount: RouteMount,val points: List<RoutePose>,val pitch: Float,
  val createdAt: Long=System.currentTimeMillis()) {
  init {
    require(name.isNotBlank() && name.length<=40 && mapId.length in 1..100 && sessionId.length in 1..100)
    require(referenceKey.length<=128 && points.size in 2..512 && pitch.isFinite())
    require(points.zipWithNext().all { (a,b)->a.distance(b)<=.5f }) { "路线存在定位跳变，请重新教路线" }
    require(points.zipWithNext().sumOf { (a,b)->a.distance(b).toDouble() } in .15..30.0)
  }
  fun usableIn(map: String,session: String,key: String,referenceAligned: Boolean): Boolean =
    map==mapId && if (referenceKey.isNotEmpty()) referenceAligned && key==referenceKey else session==sessionId
}
/** A tracking interruption ends teaching; it never joins disconnected coordinates. */
internal class RouteTeacher(val mount: RouteMount) {
  private val points=ArrayList<RoutePose>()
  var failure: String?=null;private set
  @Synchronized fun observe(pose: RoutePose?,tracking: Boolean) {
    if (failure!=null) return
    if (!tracking || pose==null) { failure="定位中断，请重新教路线";return }
    val last=points.lastOrNull()
    if (last!=null && last.distance(pose)>.35f) { failure="位置跳变，请重新教路线";return }
    if (last==null || last.distance(pose)>=.06f || abs(wrapYaw(pose.yaw-last.yaw))>=.2f) {
      if (points.size>=512) { failure="路线过长，请拆成更短的路线";return }
      points.add(pose)
    }
  }
  @Synchronized fun finish(name: String,map: String,session: String,key: String): TaughtRoute {
    check(failure==null) { failure!! }
    check(points.size>=2) { "请先带领底座走一小段路线" }
    check(points.all { abs(wrapYaw(it.pitch-points.first().pitch))<=.12f && abs(wrapYaw(it.roll-points.first().roll))<=.12f }) { "教路线时头部姿态改变，请固定后重教" }
    return TaughtRoute(name=name,mapId=map,sessionId=session,referenceKey=key,mount=mount,points=points.toList(),pitch=points.first().pitch)
  }
  @Synchronized fun size()=points.size
}

internal enum class RouteClearance { CLEAR, OBSTACLE, DEPTH_UNKNOWN }
internal data class RouteObservation(val pose: RoutePose?,val atMs: Long,val tracking: Boolean,val actualFloor: Boolean,
  val clearance: RouteClearance,val connected: Boolean,val headFixed: Boolean,val playback: Boolean=false)
internal data class RoutePulse(val direction: String,val durationMs: Int)
internal data class RouteDriveDecision(val pulse: RoutePulse?=null,val stop: Boolean=false,val reason: String="")

/** Small-step feedback controller. No BLE, Android or language model dependencies. */
internal class RouteFollower(val route: TaughtRoute) {
  @Volatile var phase="IDLE";private set
  @Volatile var reason="";private set
  @Volatile var waypoint=1;private set
  private var previous: RouteObservation?=null
  private var started=0L
  private var progressedAt=0L
  private var bestDistance=Float.POSITIVE_INFINITY
  private var finalYaw=0f
  private var lastNow=0L
  private var pausedPhase="FOLLOWING"
  @Synchronized fun start(o: RouteObservation) {
    require(o.tracking && o.pose!=null && o.connected && o.headFixed && o.actualFloor && !o.playback) { "请恢复定位、连接底座并确认真实平整地面和固定头部" }
    require(o.pose.distance(route.points.first())<=.08f) { "请放回路线起点8厘米内" }
    require(abs(wrapYaw(o.pose.yaw-route.points.first().yaw))<=.35f) { "请恢复教路线时的起点朝向" }
    require(abs(wrapYaw(o.pose.pitch-route.pitch))<=.12f) { "头部姿态与教路线时不同" }
    require(abs(wrapYaw(o.pose.roll-route.points.first().roll))<=.12f) { "手机安装倾斜与教路线时不同" }
    phase="FOLLOWING";reason="";waypoint=1;started=o.atMs;progressedAt=o.atMs;lastNow=o.atMs
    previous=o;bestDistance=Float.POSITIVE_INFINITY
    finalYaw=wrapYaw(route.points.last().yaw+PI.toFloat())
  }
  @Synchronized fun pause(why: String): RouteDriveDecision { if (phase!="PAUSED") pausedPhase=phase;phase="PAUSED";reason=why;return RouteDriveDecision(stop=true,reason=why) }
  @Synchronized fun resume(o: RouteObservation) {
    require(phase=="PAUSED" && o.pose!=null && o.tracking && o.actualFloor && o.connected && o.headFixed && !o.playback)
    val p=o.pose
    require(abs(wrapYaw(p.pitch-route.pitch))<=.12f && o.clearance==RouteClearance.CLEAR) { "请恢复固定姿态和前方观测" }
    require(abs(wrapYaw(p.roll-route.points.first().roll))<=.12f) { "请恢复教路线时的手机倾斜姿态" }
    require(if (waypoint<route.points.size) distanceToSegment(p,route.points[waypoint-1],route.points[waypoint])<=.08f else p.distance(route.points.last())<=.08f) { "请放回暂停位置附近" }
    phase=if (pausedPhase=="FACING_USER") "FACING_USER" else "FOLLOWING";reason="";previous=o
    progressedAt=o.atMs;lastNow=o.atMs;started=o.atMs;bestDistance=Float.POSITIVE_INFINITY
  }
  @Synchronized fun cancel(): RouteDriveDecision { phase="CANCELLED";reason="用户停止";return RouteDriveDecision(stop=true,reason=reason) }
  @Synchronized fun step(o: RouteObservation,now: Long): RouteDriveDecision {
    if (phase!="FOLLOWING" && phase!="FACING_USER") return RouteDriveDecision()
    if (now<lastNow || now-o.atMs !in 0..350) return pause("定位数据过期")
    lastNow=now
    val p=o.pose ?: return pause("定位丢失")
    if (!o.tracking || !o.actualFloor || !o.connected || !o.headFixed || o.playback) return pause("定位、底座、地面或头部状态改变")
    if (abs(wrapYaw(p.pitch-route.pitch))>.12f) return pause("头部姿态改变，请恢复固定姿态")
    if (abs(wrapYaw(p.roll-route.points.first().roll))>.12f) return pause("手机安装倾斜改变")
    previous?.pose?.let { if (p.distance(it)>.20f) return pause("位置跳变") }
    previous=o
    if (now-started>180_000) return pause("本次路线超时")
    if (o.clearance==RouteClearance.OBSTACLE) return pause("前方有障碍，请移开后重新开始")
    // A brief depth gap stops translation and preserves progress; never drives blind.
    if (o.clearance==RouteClearance.DEPTH_UNKNOWN) return RouteDriveDecision(stop=true,reason="等待新鲜深度")
    if (phase=="FACING_USER") {
      val error=wrapYaw(finalYaw-p.yaw)
      if (abs(error)<.12f) { phase="COMPLETED";reason="已到达并转身";return RouteDriveDecision(stop=true,reason=reason) }
      if (now-progressedAt>20_000) return pause("到点转向未完成")
      return RouteDriveDecision(RoutePulse(if (error>0) "right" else "left",90))
    }
    while (waypoint<route.points.size && p.distance(route.points[waypoint])<=.07f) {
      waypoint++;bestDistance=Float.POSITIVE_INFINITY;progressedAt=now
    }
    if (waypoint>=route.points.size) { phase="FACING_USER";progressedAt=now;return RouteDriveDecision(stop=true,reason="已到点，准备转身") }
    val a=route.points[waypoint-1];val b=route.points[waypoint]
    if (distanceToSegment(p,a,b)>.08f) return pause("偏离已确认路线")
    val distance=p.distance(b)
    if (distance<bestDistance-.015f) { bestDistance=distance;progressedAt=now }
    if (now-progressedAt>12_000) return pause("底座未取得有效前进进展")
    val target=atan2(b.x-p.x,-(b.z-p.z));val error=wrapYaw(target-p.yaw)
    if (abs(error)>.16f) return RouteDriveDecision(RoutePulse(if (error>0) "right" else "left",if (abs(error)>.5f) 120 else 90))
    return RouteDriveDecision(RoutePulse("back",if (distance>.20f) 180 else 100))
  }
  companion object {
    fun distanceToSegment(p: RoutePose,a: RoutePose,b: RoutePose): Float {
      val dx=b.x-a.x;val dz=b.z-a.z;val dd=dx*dx+dz*dz
      val t=if (dd<.000001f) 0f else (((p.x-a.x)*dx+(p.z-a.z)*dz)/dd).coerceIn(0f,1f)
      return hypot(p.x-a.x-t*dx,p.z-a.z-t*dz)
    }
  }
}

internal object TaughtRouteCodec {
  fun encode(r: TaughtRoute): ByteArray {
    val body=ByteArrayOutputStream();DataOutputStream(body).use { o->
      o.writeInt(1);listOf(r.id,r.name,r.mapId,r.sessionId,r.referenceKey).forEach(o::writeUTF)
      o.writeLong(r.createdAt);o.writeFloat(r.mount.right);o.writeFloat(r.mount.alongView);o.writeFloat(r.pitch)
      o.writeInt(r.points.size);r.points.forEach { p->listOf(p.x,p.z,p.yaw,p.pitch,p.roll).forEach(o::writeFloat) }
    }
    val b=body.toByteArray();return ByteArrayOutputStream().also { stream->DataOutputStream(stream).use {
      it.writeInt(0x59525445);it.writeInt(b.size);it.write(b);it.writeLong(CRC32().apply { update(b) }.value)
    } }.toByteArray()
  }
  fun decode(bytes: ByteArray): TaughtRoute {
    require(bytes.size in 32..64_000)
    val i=DataInputStream(ByteArrayInputStream(bytes));require(i.readInt()==0x59525445)
    val size=i.readInt();require(size==bytes.size-16);val b=ByteArray(size);i.readFully(b)
    require(i.readLong()==CRC32().apply { update(b) }.value) { "路线校验失败" }
    return DataInputStream(ByteArrayInputStream(b)).use { d->
      require(d.readInt()==1);val id=d.readUTF();require(UUID.fromString(id).toString()==id)
      val name=d.readUTF();val map=d.readUTF();val session=d.readUTF();val key=d.readUTF();val created=d.readLong()
      val mount=RouteMount(d.readFloat(),d.readFloat());val pitch=d.readFloat();val n=d.readInt();require(n in 2..512)
      val ps=List(n) { RoutePose(d.readFloat(),d.readFloat(),d.readFloat(),d.readFloat(),d.readFloat()) };require(d.available()==0)
      TaughtRoute(id,name,map,session,key,mount,ps,pitch,created)
    }
  }
}
