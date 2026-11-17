package com.myyaya.navigationprobe

/** Visits only reachable registered places. A virtual return node attaches through real known paths. */
internal object HomeInspectionPlanner {
  fun hasLocalRoute(a: HomeAtlas,at: HomePose)=a.links.any {e->e.enabled && e.points.zipWithNext().any {(u,v)->HomeRoutePlanner.segmentDistance(at,u,v)<=.25}}
  data class Stop(val id: String,val name: String,val pose: HomePose,val arc: Double)
  data class Plan(val points: List<HomePose>,val stops: List<Stop>,val meters: Double)
  fun plan(a: HomeAtlas,current: HomePose,origin: HomePose,targets: List<String>,radius: Double): Plan {
    require(targets.size<=6 && targets.distinct().size==targets.size){"一次最多巡查6个地点，请分批安排"}
    val points=mutableListOf(current);val stops=mutableListOf<Stop>();var at=current;var meters=0.0
    fun append(path: List<HomePose>){for(p in path.drop(1)){meters+=points.last().distance(p);points.add(p)}}
    for(id in targets){val r=HomeRoutePlanner.plan(a,at,id,radius);append(r.points);stops.add(Stop(id,r.destination.name,r.destination.pose,meters));at=r.destination.pose}
    if(at.distance(origin)>.04) {
      val returnId="inspection-return-origin"
      val attachments=a.places.sortedBy {it.pose.distance(origin)}.take(4).mapNotNull {p->runCatching {HomeRoutePlanner.plan(a,origin,p.id,radius)}.getOrNull()}
      check(attachments.isNotEmpty()){"出发位置没有可用返回路线"}
      val augmented=a.copy(places=a.places+HomePlace(returnId,"巡查返回临时点","","point",origin),
        links=a.links+attachments.map {r->HomeLink(from=returnId,to=r.destination.id,points=r.points)})
      append(HomeRoutePlanner.plan(augmented,at,returnId,radius).points)
    }
    require(meters<=40){"往返路线超过40米，请缩小巡查范围"}
    return Plan(points,stops,meters)
  }
}
