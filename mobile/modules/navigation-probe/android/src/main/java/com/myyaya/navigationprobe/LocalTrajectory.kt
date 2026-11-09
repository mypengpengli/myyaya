package com.myyaya.navigationprobe

import kotlin.math.*

internal data class LocalSweepResult(val state: String,val tiles: Int=0,val unknown: Int=0,val stale: Int=0,
  val obstacles: Int=0,val drops: Int=0,val missing: List<LocalTile> = emptyList(),val initialUnknown: Int=0) {
  val clear get()=state=="GEOMETRY_CLEAR"
  fun report(): Map<String,Any?> = mapOf("state" to state,"checkedTiles" to tiles,"unknownTiles" to unknown,
    "staleObservationTiles" to stale,"obstacleTiles" to obstacles,"dropTiles" to drops,
    "initialFootprintUnknownTiles" to initialUnknown,"newSweepUnknownTiles" to unknown-initialUnknown,
    "missingTileExamples" to missing.take(8).map { listOf(it.x,it.z) },
    "motionAuthorized" to false,"requiresCalibratedPulseAndMount" to true)
}

/** Conservative continuous swept rectangle, discretized with an analytic error
 * bound: sample gap <=5mm of any corner's motion, half gap added to footprint.
 * Includes caller-supplied stopping distance/angle; no milliseconds-to-cm guess.
 */
internal object LocalTrajectory {
  fun check(map: LocalMapSnapshot,start: RoutePose,end: RoutePose,robot: RobotEnvelope,
    stoppingDistance: Float=.01f,stoppingAngle: Float=0f,uncertainty: Float=.01f): LocalSweepResult {
    require(stoppingDistance.isFinite() && stoppingDistance in 0f.. .3f)
    require(stoppingAngle.isFinite() && abs(stoppingAngle)<=.5f)
    require(uncertainty.isFinite() && uncertainty in 0f.. .3f)
    if(map.lastDepthNs<=0 || map.atNs-map.lastDepthNs !in 0..250_000_000L) return LocalSweepResult("FRESH_RAW_REQUIRED")
    val distance=start.distance(end);val angle=wrapYaw(end.yaw-start.yaw)
    if(distance>.3f || abs(angle)>PI.toFloat()/2) return LocalSweepResult("SHORT_STEP_LIMIT")
    val target=if(distance>1e-6f) end.copy(x=end.x+(end.x-start.x)/distance*stoppingDistance,
      z=end.z+(end.z-start.z)/distance*stoppingDistance,yaw=end.yaw+stoppingAngle) else end.copy(yaw=end.yaw+stoppingAngle)
    val totalDistance=start.distance(target);val totalAngle=wrapYaw(target.yaw-start.yaw)
    val halfWidth=robot.width/2+robot.margin+uncertainty
    val halfLength=robot.length/2+robot.margin+uncertainty
    val bound=totalDistance+hypot(halfWidth,halfLength)*abs(totalAngle)
    val steps=ceil(bound/.005f).toInt().coerceAtLeast(1)
    val error=bound/(2*steps)+.00001f
    val touched=HashSet<LocalTile>()
    val initial=footprint(start.x,start.z,start.yaw,halfWidth+error,halfLength+error)
    for(i in 0..steps) {
      val f=i.toFloat()/steps
      touched.addAll(footprint(start.x+(target.x-start.x)*f,start.z+(target.z-start.z)*f,
        start.yaw+totalAngle*f,halfWidth+error,halfLength+error))
    }
    var unknown=0;var stale=0;var obstacles=0;var drops=0
    val missing=ArrayList<LocalTile>()
    for(t in touched) when(map.space(t)) {
      LocalSpace.UNKNOWN -> { unknown++;if(missing.size<8) missing.add(t) }
      LocalSpace.SUPPORT_ONLY -> stale++
      LocalSpace.WEAK_OBSTACLE,LocalSpace.OBSTACLE -> obstacles++
      LocalSpace.DROP -> drops++
      LocalSpace.FREE -> Unit
    }
    val state=when { drops>0->"DROP_IN_SWEEP";obstacles>0->"OBSTACLE_IN_SWEEP";
      unknown>0->"UNOBSERVED_SWEEP";stale>0->"OBSERVATION_EXPIRED";else->"GEOMETRY_CLEAR" }
    return LocalSweepResult(state,touched.size,unknown,stale,obstacles,drops,missing,
      initial.count { map.space(it)==LocalSpace.UNKNOWN })
  }

  /** All grid squares intersecting the oriented rectangle, using SAT. */
  fun footprint(x: Float,z: Float,yaw: Float,halfWidth: Float,halfLength: Float): Set<LocalTile> {
    val c=cos(yaw);val s=sin(yaw);val cell=LocalNavigationMap.TILE;val h=cell/2
    val extentX=abs(c)*halfWidth+abs(s)*halfLength
    val extentZ=abs(s)*halfWidth+abs(c)*halfLength
    val result=HashSet<LocalTile>()
    for(ix in floor((x-extentX)/cell).toInt()..floor((x+extentX)/cell).toInt())
      for(iz in floor((z-extentZ)/cell).toInt()..floor((z+extentZ)/cell).toInt()) {
        val dx=(ix+.5f)*cell-x;val dz=(iz+.5f)*cell-z
        if(abs(dx)<=extentX+h && abs(dz)<=extentZ+h &&
          abs(dx*c+dz*s)<=halfWidth+h*(abs(c)+abs(s)) &&
          abs(dx*s-dz*c)<=halfLength+h*(abs(c)+abs(s))) result.add(LocalTile(ix,iz))
      }
    return result
  }
}
