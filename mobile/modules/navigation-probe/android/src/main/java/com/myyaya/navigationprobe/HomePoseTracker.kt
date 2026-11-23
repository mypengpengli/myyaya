package com.myyaya.navigationprobe

import kotlin.math.*

/** Persistent coordinates are seeded only from live map alignment, then translated by floor flow. */
internal class HomePoseTracker {
  var pose: HomePose?=null;private set
  var revision=0;private set
  var reason="请开始扫描并恢复地图定位";private set
  private var session="";private var map=""
  val mapIdentifier get()=map
  private var flowOrigin=0L;private var sampleNs=0L;private var lastNs=0L
  private var dx0=0.0;private var dz0=0.0;private var rawYaw0=0.0
  private var seed: HomePose?=null;private var seedYaw=0.0
  private var acceptReset=false;private var needsAlignment=true
  fun reset() {pose=null;seed=null;flowOrigin=0;sampleNs=0;lastNs=0;needsAlignment=true;revision++;reason="请观察保存过的场景或固定参照图恢复定位"}
  fun expectFlowReset() {acceptReset=true}
  fun ready(nowNs: Long)=pose!=null && !needsAlignment && sampleNs>0 && nowNs-sampleNs in 0..500_000_000L && nowNs-lastNs in 0..300_000_000L
  fun frame(mapId: String,sessionId: String,nowNs: Long,worldYaw: Double,mapped: HomePose?,flow: Map<String,Any?>,right: Double,forward: Double) {
    if(map!=mapId || session!=sessionId){reset();map=mapId;session=sessionId}
    if(!worldYaw.isFinite()){reset();return};lastNs=nowNs
    val ns=(flow["sampleTimestampNs"] as? Number)?.toLong() ?: return
    val origin=(flow["originTimestampNs"] as? Number)?.toLong() ?: return
    if(flow["cumulativePoseAvailable"]!=true || flow["originContinuity"]!=true || nowNs-ns !in -100_000_000L..350_000_000L)return
    val dx=(flow["cumulativeCameraDxMeters"] as? Number)?.toDouble() ?: return
    val dz=(flow["cumulativeCameraDzMeters"] as? Number)?.toDouble() ?: return
    if(!dx.isFinite() || !dz.isFinite())return
    fun offset(yaw: Double)=Pair(cos(yaw)*right+sin(yaw)*forward,-sin(yaw)*right+cos(yaw)*forward)
    if(seed==null || origin!=flowOrigin) {
      val next=if(acceptReset && pose!=null && !needsAlignment)pose else mapped
      if(next==null){needsAlignment=true;reason="视觉起点改变，请重新恢复地图定位";return}
      if(seed!=null && !acceptReset)revision++
      seed=next;pose=next;seedYaw=next.yaw;rawYaw0=worldYaw;dx0=dx;dz0=dz;flowOrigin=origin
      acceptReset=false;needsAlignment=false
    }
    val a=requireNotNull(seed);val yaw=seedYaw+atan2(sin(worldYaw-rawYaw0),cos(worldYaw-rawYaw0))
    val delta=seedYaw-rawYaw0;val old=offset(seedYaw);val current=offset(yaw)
    val next=HomePose(a.x+cos(delta)*(dx-dx0)-sin(delta)*(dz-dz0)+current.first-old.first,
      a.y-sin(delta)*(dx-dx0)-cos(delta)*(dz-dz0)+current.second-old.second,yaw)
    if(pose?.distance(next)?.let {it>.20}==true){reset();reason="家庭坐标跳变，请重新定位";return}
    pose=next;sampleNs=ns;reason="地板视觉定位有效"
  }
  fun lost(){reset();reason="相机跟踪丢失，请观察保存过的场景或固定参照图"}
}
