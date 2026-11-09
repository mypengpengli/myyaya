package com.myyaya.navigationprobe

import java.util.PriorityQueue
import kotlin.math.*

internal data class LocalGoal(val x: Float,val z: Float) {
  init { require(x.isFinite() && z.isFinite() && abs(x)<=50 && abs(z)<=50) }
}
internal data class LocalPlan(val state: String,val path: List<RoutePose> = emptyList(),val expanded: Int=0,
  val reason: String="",val firstStep: LocalSweepResult?=null) {
  fun report(): Map<String,Any?> = mapOf("state" to state,"reason" to reason,"expandedStates" to expanded,
    "path" to path.take(80).map { listOf(it.x,it.z,it.yaw) },"firstStep" to firstStep?.report(),
    "motorControl" to false,"motionAuthorized" to false,"scope" to "local-path-preview")
}

/** Bounded SE(2) A*: forward + left/right rotation primitives, all edges checked
 * by the same swept-footprint validator. Frontiers are reachable FREE poses next
 * to unknown, never steps into unknown. No motor execution or hidden exploration.
 */
internal object LocalPlanner {
  private data class Key(val x: Int,val z: Int,val heading: Int)
  private data class Entry(val key: Key,val g: Float,val f: Float)
  fun plan(map: LocalMapSnapshot,start: RoutePose,goal: LocalGoal,robot: RobotEnvelope,
    maxExpanded: Int=400): LocalPlan {
    require(maxExpanded in 1..2000)
    val initial=LocalTrajectory.check(map,start,start,robot,0f)
    if(!initial.clear) return LocalPlan("WAITING",reason=initial.state,firstStep=initial)
    val c=cos(start.yaw);val s=sin(start.yaw)
    fun pose(k: Key)=RoutePose(start.x+c*k.x*STEP+s*k.z*STEP,
      start.z+s*k.x*STEP-c*k.z*STEP,wrapYaw(start.yaw+k.heading*PI.toFloat()/4),start.pitch,start.roll)
    fun distance(p: RoutePose)=hypot(p.x-goal.x,p.z-goal.z)
    val root=Key(0,0,0)
    val queue=PriorityQueue<Entry>(compareBy<Entry> { it.f }.thenBy { it.g }.thenBy { it.key.heading })
    val costs=hashMapOf(root to 0f);val parent=HashMap<Key,Key>();val checked=HashSet<Key>()
    queue.add(Entry(root,0f,distance(start)))
    var frontier: Key?=null;var frontierScore=Float.POSITIVE_INFINITY;var expanded=0
    var reached: Key?=null
    while(queue.isNotEmpty() && expanded<maxExpanded) {
      val entry=queue.remove();val key=entry.key
      if(entry.g>costs.getValue(key)+.0001f || !checked.add(key)) continue
      expanded++;val p=pose(key)
      if(distance(p)<=.055f) { reached=key;break }
      val theta=key.heading*PI.toFloat()/4
      val forward=Key(key.x+sin(theta).roundToInt(),key.z+cos(theta).roundToInt(),key.heading)
      val neighbors=listOf(forward,key.copy(heading=(key.heading+1)%8),key.copy(heading=(key.heading+7)%8))
      for(next in neighbors) {
        if(abs(next.x)>20 || abs(next.z)>20) continue
        val q=pose(next);val moving=next==forward
        val sweep=LocalTrajectory.check(map,p,q,robot,if(moving) .01f else 0f,
          if(!moving) sign(wrapYaw(q.yaw-p.yaw))*.05f else 0f)
        if(!sweep.clear) {
          if(moving && sweep.obstacles==0 && sweep.drops==0 && sweep.unknown>0 && key!=root &&
            distance(p)<distance(start)-.01f) {
            val score=distance(p)+entry.g*.3f
            if(score<frontierScore) { frontier=key;frontierScore=score }
          }
          continue
        }
        val cost=entry.g+(if(moving) p.distance(q) else .04f)
        if(cost+.00001f<(costs[next] ?: Float.POSITIVE_INFINITY)) {
          costs[next]=cost;parent[next]=key
          queue.add(Entry(next,cost,cost+distance(q)))
        }
      }
    }
    val target=reached ?: frontier ?: return LocalPlan("WAITING",expanded=expanded,
      reason=if(queue.isNotEmpty()) "SEARCH_BUDGET_NO_REACHABLE_FRONTIER" else "NO_REACHABLE_FREE_FRONTIER")
    val keys=ArrayList<Key>();var k=target;keys.add(k)
    while(k!=root) { k=parent[k] ?: return LocalPlan("WAITING",expanded=expanded,reason="PATH_INVALID");keys.add(k) }
    val path=keys.asReversed().map { pose(it) }
    val first=path.getOrNull(1)?.let { q->LocalTrajectory.check(map,start,q,robot,
      if(start.distance(q)>.001f) .01f else 0f,
      if(start.distance(q)<=.001f) sign(wrapYaw(q.yaw-start.yaw))*.05f else 0f) }
    return LocalPlan(if(reached!=null) if(path.size==1) "AT_GOAL" else "PATH_TO_GOAL" else "PATH_TO_FRONTIER",
      path,expanded,if(reached!=null) "KNOWN_FREE_PATH" else "OBSERVE_AGAIN_AT_FREE_BOUNDARY",first)
  }
  const val STEP=.05f
}
