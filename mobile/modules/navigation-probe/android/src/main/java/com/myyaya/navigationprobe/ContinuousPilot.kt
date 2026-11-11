package com.myyaya.navigationprobe

import kotlin.math.*

/** Native feedback loop. Neural perception and path updates never own the motor clock. */
internal class ContinuousPilot(val gx: Double,val gy: Double,val width: Double,val length: Double,
  val margin: Double,val mountRight: Double,val mountForward: Double,val height: Float,private val started: Long) {
  data class Pose(val x: Double,val y: Double,val yaw: Double)
  data class Point(val x: Double,val y: Double,val label: Int)
  var phase="WAITING_POSE";private set
  var reason="等待地板定位";private set
  var pose=Pose(0.0,0.0,0.0);private set
  var uncertainty=0.0;private set
  var needReseed=false;private set
  var ticks=0;private set
  var motionTicks=0;private set
  var brakeCount=0;private set
  var perceptionCount=0;private set
  var sentSpeed=0;private set
  var sentTurn=0;private set
  private var originYaw: Double?=null
  private var anchorOrigin=0L
  private var anchorDx=0.0;private var anchorDz=0.0
  private var anchorPose=pose;private var anchorYaw=0.0
  private var frameAt=0L;private var frameNs=0L
  private var odomAt=0L;private var odomNs=0L
  private var perceptionNs=0L
  private var perceptionPose=pose
  private var receivedAgeMs=0L
  private var sensorAt=started;private var connected=false;private var backAllowed=false;private var turnAllowed=false
  private var points=emptyList<Point>();private var obstacles=emptyList<Point>();private var path=emptyList<Pose>()
  private var lastTick=started
  private var lostSince=0L;private var wasMoving=false
  private var best=hypot(gx,gy);private var progressedAt=started
  val active get()=phase !in setOf("AT_GOAL","CANCELLED","FAILED")
  init {require(listOf(gx,gy,width,length,margin,mountRight,mountForward).all {it.isFinite()} && abs(mountRight)<=.3 && abs(mountForward)<=.3 && height in .03f.. .5f && hypot(gx,gy) in .15..1.0 && width in .1..1.0 && length in .1..1.0 && margin in .019999.. .3)}
  @Synchronized fun sensors(now: Long,link: Boolean,back: Boolean,turn: Boolean) {sensorAt=now;connected=link;backAllowed=back;turnAllowed=turn}
  private fun offset(yaw: Double)=Pair(cos(yaw)*mountRight+sin(yaw)*mountForward,-sin(yaw)*mountRight+cos(yaw)*mountForward)
  @Synchronized fun frame(now: Long,ns: Long,worldYaw: Double,flow: Map<String,Any?>) {
    if(!active || ns<=frameNs) return
    frameNs=ns;frameAt=now
    val initial=originYaw ?: worldYaw.also {originYaw=it}
    val yaw=atan2(sin(worldYaw-initial),cos(worldYaw-initial));pose=pose.copy(yaw=yaw)
    val sample=(flow["sampleTimestampNs"] as? Number)?.toLong() ?: return
    val origin=(flow["originTimestampNs"] as? Number)?.toLong() ?: return
    if(flow["cumulativePoseAvailable"]!=true || flow["originContinuity"]!=true || ns-sample !in -100_000_000L..300_000_000L) return
    val dx=(flow["cumulativeCameraDxMeters"] as? Number)?.toDouble() ?: return
    val dz=(flow["cumulativeCameraDzMeters"] as? Number)?.toDouble() ?: return
    if(!dx.isFinite() || !dz.isFinite()) return
    if(anchorOrigin==0L) {anchorOrigin=origin;anchorDx=dx;anchorDz=dz;anchorPose=pose;anchorYaw=yaw}
    if(origin!=anchorOrigin) return
    val sampleYaw=((flow["sampleYawRadians"] as? Number)?.toDouble() ?: worldYaw)-initial
    val a=offset(anchorYaw);val b=offset(sampleYaw)
    val next=Pose(anchorPose.x+cos(initial)*(dx-anchorDx)+sin(initial)*(dz-anchorDz)+b.first-a.first,
      anchorPose.y+sin(initial)*(dx-anchorDx)-cos(initial)*(dz-anchorDz)+b.second-a.second,yaw)
    if(hypot(next.x-pose.x,next.y-pose.y)>.15) {cancel("地板定位跳变");return}
    pose=next
    if(sample>odomNs){odomNs=sample;odomAt=now}
  }
  @Synchronized fun observation(now: Long,ns: Long,capture: Pose,cells: List<Point>,route: List<Pose>,retainedObstacles: List<Point> = emptyList()) {
    if(!active || ns<=perceptionNs || frameNs-ns !in -100_000_000L..1_500_000_000L) return
    points=cells.map {p-> val x=p.x-mountRight;val y=p.y-mountForward
      Point(capture.x+cos(capture.yaw)*x+sin(capture.yaw)*y,capture.y-sin(capture.yaw)*x+cos(capture.yaw)*y,p.label) }
    obstacles=points.filter { it.label!=1 }+retainedObstacles.filter {it.label!=1}
    path=route;perceptionNs=ns;perceptionPose=capture;receivedAgeMs=(frameNs-ns)/1_000_000;perceptionCount++
  }
  @Synchronized fun reseeded() {if(!active || !needReseed)return;needReseed=false;anchorOrigin=0;odomAt=0;odomNs=0;lostSince=0;uncertainty+=.02;if(uncertainty>.1)cancel("位置不确定度过大")}
  @Synchronized fun cancel(why: String) {if(!active)return;phase="CANCELLED";reason=why;sentSpeed=0;sentTurn=0}
  private fun clearArc(speed: Double,turn: Double): Boolean {
    val radius=hypot(width,length)/2+margin+.01
    val v=-speed/127*.30;val w=-turn/127*3.0
    for(i in 0..5) {
      val t=i*.1;val a=pose.yaw+w*t
      val x=pose.x+if(abs(w)<.001) sin(pose.yaw)*v*t else v/w*(cos(pose.yaw)-cos(a))
      val y=pose.y+if(abs(w)<.001) cos(pose.yaw)*v*t else v/w*(sin(a)-sin(pose.yaw))
      if(obstacles.any {hypot(it.x-x,it.y-y)<radius}) return false
    }
    if(abs(speed)>1) for(side in listOf(-1,0,1)) {
      val x=pose.x+sin(pose.yaw)*.18+cos(pose.yaw)*side*(width/2+margin)*.75
      val y=pose.y+cos(pose.yaw)*.18-sin(pose.yaw)*side*(width/2+margin)*.75
      if(points.none {it.label==1 && hypot(it.x-x,it.y-y)<.07}) return false
    }
    return true
  }
  @Synchronized fun tick(now: Long,stopAcknowledged: Boolean): Pair<Int,Int> {
    ticks++;val dt=((now-lastTick)/1000.0).coerceIn(.001,.15);lastTick=now
    fun brake(why: String): Pair<Int,Int> {if(wasMoving)brakeCount++;wasMoving=false;sentSpeed=0;sentTurn=0;reason=why;return 0 to 0}
    if(!active)return brake(reason)
    if(now-started>550_000){phase="FAILED";return brake("任务时间上限")}
    if(!connected || now-sensorAt>900){phase="WAITING_LINK";return brake("控制心跳或连接未就绪")}
    if(frameAt==0L || now-frameAt>250){phase="WAITING_POSE";return brake("相机画面过期")}
    if(odomAt==0L || now-odomAt>300 || frameNs-odomNs>350_000_000L) {
      if(lostSince==0L)lostSince=now
      if(stopAcknowledged && now-lostSince>600 && anchorOrigin!=0L)needReseed=true
      phase="WAITING_POSE";return brake("等待新的地板定位")
    }
    lostSince=0
    val d=hypot(gx-pose.x,gy-pose.y)
    if(d<best-.01){best=d;progressedAt=now}
    if(d<=.06){phase="AT_GOAL";return brake("到达局部目标范围")}
    if(now-progressedAt>35_000){phase="FAILED";return brake("持续无进展")}
    val viewTravel=hypot(pose.x-perceptionPose.x,pose.y-perceptionPose.y)
    val viewTurn=abs(atan2(sin(pose.yaw-perceptionPose.yaw),cos(pose.yaw-perceptionPose.yaw)))
    if(perceptionNs==0L || frameNs-perceptionNs>2_200_000_000L || viewTravel>.10 || viewTurn>.55){phase="WAITING_PERCEPTION";return brake("等待更新视野：时间、位移或转角达到上限")}
    if(path.isEmpty()){phase="WAITING_PATH";return brake("等待可执行路线")}
    val target=path.firstOrNull {hypot(it.x-pose.x,it.y-pose.y)>=.10} ?: Pose(gx,gy,0.0)
    val error=atan2(sin(atan2(target.x-pose.x,target.y-pose.y)-pose.yaw),cos(atan2(target.x-pose.x,target.y-pose.y)-pose.yaw))
    val speedLimit=if(frameNs-perceptionNs>650_000_000L)24.0 else 30.0
    var v=if(abs(error)>.70)0.0 else -min(speedLimit,max(20.0,d*180))*cos(error).coerceAtLeast(0.0)
    var w=(-error*35).coerceIn(-24.0,24.0)
    if(v!=0.0 && !backAllowed || abs(w)>1 && !turnAllowed){phase="WAITING_INTERLOCK";return brake("底座传感器拦截")}
    if(!clearArc(v,w)) {
      v*=.45
      if(!clearArc(v,w)) {v=0.0;if(!clearArc(v,w)){phase="WAITING_CLEARANCE";return brake("近处路线被挡")}}
    }
    if(abs(v)<1 && abs(w)<1){phase="WAITING_CLEARANCE";return brake("近处通道尚未可用")}
    fun ramp(current: Int,target: Double,rate: Double)=target.coerceIn(current-rate*dt,current+rate*dt).roundToInt()
    sentSpeed=if(v==0.0)0 else ramp(sentSpeed,v,65.0)
    sentTurn=ramp(sentTurn,w,90.0);wasMoving=sentSpeed!=0 || sentTurn!=0
    if(!clearArc(sentSpeed.toDouble(),sentTurn.toDouble())){phase="WAITING_CLEARANCE";return brake("平滑后的实际运动进入障碍范围")}
    if(wasMoving)motionTicks++
    phase=if(v==0.0)"TURNING" else "DRIVING";reason="连续更新速度与方向"
    return sentSpeed to sentTurn
  }
  @Synchronized fun report(now: Long): Map<String,Any?> = mapOf("phase" to phase,"reason" to reason,"active" to active,
    "pose" to mapOf("x" to pose.x,"y" to pose.y,"yaw" to pose.yaw),"poseReady" to (odomAt>0 && now-odomAt<=300),
    "remainingMeters" to hypot(gx-pose.x,gy-pose.y),"goal" to listOf(gx,gy),"positionUncertaintyMeters" to uncertainty,
    "ticks" to ticks,"motionTicks" to motionTicks,"brakeCount" to brakeCount,"perceptionCount" to perceptionCount,
    "sentSpeed" to sentSpeed,"sentTurn" to sentTurn,"elapsedMs" to now-started,"frameNs" to frameNs,"frameAgeMs" to now-frameAt,
    "odomAgeMs" to now-odomAt,"perceptionAgeMs" to if(perceptionNs>0)(frameNs-perceptionNs)/1_000_000 else null,
    "perceptionReceivedAgeMs" to receivedAgeMs,"viewTravelMeters" to hypot(pose.x-perceptionPose.x,pose.y-perceptionPose.y),
    "maximumViewTravelMeters" to .10,"maximumViewAgeMs" to 2200)
}
