package com.myyaya.navigationprobe

/** Visits only reachable registered places. A virtual return node attaches through real known paths. */
internal object HomeInspectionPlanner {
  fun hasLocalRoute(a: HomeAtlas,at: HomePose)=a.links.any {e->e.enabled && e.points.zipWithNext().any {(u,v)->HomeRoutePlanner.segmentDistance(at,u,v)<=.25}}
  data class Stop(val id: String,val name: String,val pose: HomePose,val arc: Double)
  data class Plan(val points: List<HomePose>,val stops: List<Stop>,val meters: Double)
  fun plan(a: HomeAtlas,current: HomePose,origin: HomePose,targets: List<String>,radius: Double,gridRoute: ((HomePose,HomePose)->List<HomePose>?)?=null): Plan {
    require(targets.size<=64 && targets.distinct().size==targets.size){"单次最多登记64个房间观察点"}
    val points=mutableListOf(current);val stops=mutableListOf<Stop>();var at=current;var meters=0.0
    fun append(path: List<HomePose>){for(p in path.drop(1)){meters+=points.last().distance(p);points.add(p)}}
    for(id in targets){
      val destination=requireNotNull(a.named(id)){"没有这个观察地点"}
      val path=gridRoute?.invoke(at,destination.pose) ?: HomeRoutePlanner.plan(a,at,id,radius).points
      append(path);stops.add(Stop(id,destination.name,destination.pose,meters));at=destination.pose
    }
    val directReturn=if(at.distance(origin)>.04)gridRoute?.invoke(at,origin) else null
    if(directReturn!=null)append(directReturn)
    else if(at.distance(origin)>.04) {
      val attachments=a.places.sortedBy {it.pose.distance(origin)}.take(4).mapNotNull {p->
        runCatching {
          val back=HomeRoutePlanner.plan(a,origin,p.id,radius).points.reversed()
          val to=HomeRoutePlanner.plan(a,at,p.id,radius).points
          val combined=to+back.drop(1)
          combined to combined.zipWithNext().sumOf {(u,v)->u.distance(v)}
        }.getOrNull()
      }
      val best=attachments.minByOrNull {it.second} ?: error("出发位置没有可用返回路线")
      append(best.first)
    }
    require(meters<=200){"本轮往返路线超过200米，请缩小巡查范围；未开始行驶"}
    return Plan(points,stops,meters)
  }
}
