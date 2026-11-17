package com.myyaya.navigationprobe

import java.io.*
import java.util.UUID
import java.util.zip.CRC32
import kotlin.math.*

/** A taught route graph, not a claim that unobserved map pixels are drivable. */
internal data class HomePose(val x: Double,val y: Double,val yaw: Double=0.0) {
  init { require(listOf(x,y,yaw).all { it.isFinite() } && abs(x)<=50 && abs(y)<=50) }
  fun distance(p: HomePose)=hypot(x-p.x,y-p.y)
  fun report()=mapOf("x" to x,"y" to y,"yaw" to yaw)
}
internal data class HomePlace(val id: String=UUID.randomUUID().toString(),val name: String,val room: String,
  val kind: String,val pose: HomePose)
internal data class HomeLink(val id: String=UUID.randomUUID().toString(),val from: String,val to: String,
  val points: List<HomePose>,val taught: Boolean=true,val enabled: Boolean=true)
internal data class HomeZone(val id: String=UUID.randomUUID().toString(),val name: String,val x: Double,val y: Double,val radius: Double)
internal data class HomeAtlas(val mapId: String,val referenceKey: String,val revision: Int=1,
  val places: List<HomePlace> = emptyList(),val links: List<HomeLink> = emptyList(),val zones: List<HomeZone> = emptyList()) {
  init {
    require(mapId.length in 1..100 && referenceKey.length<=100 && revision>0)
    require(places.size<=128 && links.size<=256 && zones.size<=64)
    require(places.map { it.id }.distinct().size==places.size && places.map { it.name }.distinct().size==places.size)
    require(links.map { it.id }.distinct().size==links.size && zones.map { it.id }.distinct().size==zones.size)
    places.forEach { require(it.name.isNotBlank() && it.name.length<=40 && it.room.length<=40 && it.kind in setOf("room","door","point")) }
    links.forEach { e->
      require(e.from!=e.to && places.any { it.id==e.from } && places.any { it.id==e.to })
      require(e.points.size in 2..4096 && e.points.zipWithNext().all { (a,b)->a.distance(b)<=.36 })
      require(e.points.first().distance(places.first { it.id==e.from }.pose)<=.12 && e.points.last().distance(places.first { it.id==e.to }.pose)<=.12)
    }
    zones.forEach { require(it.name.length in 1..40 && it.x.isFinite() && it.y.isFinite() && abs(it.x)<=50 && abs(it.y)<=50 && it.radius in .05..3.0) }
  }
  fun named(name: String)=places.firstOrNull { it.id==name || it.name==name }
  fun remember(name: String,room: String,kind: String,pose: HomePose): HomeAtlas {
    val clean=name.trim();val old=named(clean)
    val node=HomePlace(old?.id ?: UUID.randomUUID().toString(),clean,room.trim(),kind,pose)
    // Moving a node cannot silently move the measured ends of its taught edges.
    val kept=if(old!=null && old.pose.distance(pose)>.10) links.filter { it.from!=old.id && it.to!=old.id } else links
    return copy(revision=revision+1,places=places.filter { it.id!=node.id }+node,links=kept)
  }
  fun rename(id: String,name: String): HomeAtlas {
    val node=requireNotNull(named(id)) { "没有这个地点" };val clean=name.trim()
    require(places.none { it.name==clean && it.id!=node.id }) { "名称已被使用" }
    return copy(revision=revision+1,places=places.map { p->p.copy(name=if(p.id==node.id) clean else p.name,
      room=if(node.kind=="room" && p.room==node.name) clean else p.room) })
  }
  fun remove(id: String): HomeAtlas {require(places.any {it.id==id}) {"没有这个地点"};return copy(revision=revision+1,places=places.filter { it.id!=id },links=links.filter { it.from!=id && it.to!=id })}
  fun teach(from: String,to: String,points: List<HomePose>): HomeAtlas {
    require(points.zipWithNext().sumOf { (a,b)->a.distance(b) } in .10..30.0) { "路线应在10厘米至30米内" }
    return copy(revision=revision+1,links=links.filterNot { setOf(it.from,it.to)==setOf(from,to) }+HomeLink(from=from,to=to,points=points))
  }
  fun report(): Map<String,Any?> = mapOf("mapId" to mapId,"revision" to revision,"requiresReference" to referenceKey.isNotEmpty(),
    "places" to places.map { mapOf("id" to it.id,"name" to it.name,"room" to it.room,"kind" to it.kind,"pose" to it.pose.report()) },
    "links" to links.map { mapOf("id" to it.id,"from" to it.from,"to" to it.to,"taught" to it.taught,"enabled" to it.enabled,"points" to it.points.map(HomePose::report)) },
    "zones" to zones.map { mapOf("id" to it.id,"name" to it.name,"x" to it.x,"y" to it.y,"radius" to it.radius) })
}

internal object HomeRoutePlanner {
  data class Route(val destination: HomePlace,val points: List<HomePose>,val links: List<String>,val meters: Double)
  fun segmentDistance(p: HomePose,a: HomePose,b: HomePose): Double {
    val dx=b.x-a.x;val dy=b.y-a.y;val dd=dx*dx+dy*dy
    val t=if(dd<1e-9)0.0 else (((p.x-a.x)*dx+(p.y-a.y)*dy)/dd).coerceIn(0.0,1.0)
    return hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)
  }
  fun allowed(points: List<HomePose>,zones: List<HomeZone>,radius: Double)=points.zipWithNext().all { (a,b)->
    zones.none { segmentDistance(HomePose(it.x,it.y),a,b)<=it.radius+radius }
  }
  /** Start only at a known node/route, never connect across unknown space by proximity alone. */
  fun plan(atlas: HomeAtlas,start: HomePose,destination: String,radius: Double): Route {
    val target=requireNotNull(atlas.named(destination)) { "还没有登记这个地点" }
    require(atlas.zones.none { hypot(start.x-it.x,start.y-it.y)<=it.radius+radius }) { "当前位置位于禁行区" }
    data class Entry(val node: String,val path: List<HomePose>,val edges: List<String>,val cost: Double)
    val open=ArrayList<Entry>();val best=HashMap<String,Double>()
    fun offer(n: String,p: List<HomePose>,e: List<String>,cost: Double) {
      if(cost<(best[n] ?: Double.POSITIVE_INFINITY)) {best[n]=cost;open.add(Entry(n,p,e,cost))}
    }
    for(p in atlas.places) if(start.distance(p.pose)<=.20 && allowed(listOf(start,p.pose),atlas.zones,radius)) offer(p.id,listOf(start,p.pose),emptyList(),start.distance(p.pose))
    val links=atlas.links.filter { it.enabled && it.taught && allowed(it.points,atlas.zones,radius) }
    for(e in links) for(i in 0 until e.points.lastIndex) {
      val a=e.points[i];val b=e.points[i+1]
      if(segmentDistance(start,a,b)>.15)continue
      val dx=b.x-a.x;val dy=b.y-a.y;val dd=dx*dx+dy*dy
      val t=if(dd<1e-9)0.0 else (((start.x-a.x)*dx+(start.y-a.y)*dy)/dd).coerceIn(0.0,1.0)
      val join=HomePose(a.x+t*dx,a.y+t*dy)
      if(!allowed(listOf(start,join),atlas.zones,radius))continue
      for((n,path) in listOf(e.to to (listOf(start,join)+e.points.drop(i+1)),e.from to (listOf(start,join)+e.points.take(i+1).reversed())))
        offer(n,path,listOf(e.id),path.zipWithNext().sumOf { (u,v)->u.distance(v) })
    }
    while(open.isNotEmpty()) {
      val item=open.minByOrNull { it.cost }!!;open.remove(item)
      if(item.cost!=best[item.node])continue
      if(item.node==target.id) return Route(target,item.path,item.edges,item.cost)
      for(e in links) {
        val path=when(item.node) { e.from->e.points;e.to->e.points.reversed();else->continue }
        val next=if(item.node==e.from)e.to else e.from
        offer(next,item.path+path.drop(1),item.edges+e.id,item.cost+path.zipWithNext().sumOf { (a,b)->a.distance(b) })
      }
    }
    error("没有可用的已带领路线；请先带领经过门口，或检查禁行区和路线开关")
  }
}

/** Bounded CRC file independent of Android; old map/atlas bytes are never overwritten on decode failure. */
internal object HomeAtlasCodec {
  fun encode(a: HomeAtlas): ByteArray {
    val bytes=ByteArrayOutputStream();val o=DataOutputStream(bytes)
    fun pose(p: HomePose){o.writeDouble(p.x);o.writeDouble(p.y);o.writeDouble(p.yaw)}
    o.writeInt(1);o.writeUTF(a.mapId);o.writeUTF(a.referenceKey);o.writeInt(a.revision)
    o.writeInt(a.places.size);a.places.forEach {o.writeUTF(it.id);o.writeUTF(it.name);o.writeUTF(it.room);o.writeUTF(it.kind);pose(it.pose)}
    o.writeInt(a.links.size);a.links.forEach {e->o.writeUTF(e.id);o.writeUTF(e.from);o.writeUTF(e.to);o.writeBoolean(e.taught);o.writeBoolean(e.enabled);o.writeInt(e.points.size);e.points.forEach(::pose)}
    o.writeInt(a.zones.size);a.zones.forEach {o.writeUTF(it.id);o.writeUTF(it.name);o.writeDouble(it.x);o.writeDouble(it.y);o.writeDouble(it.radius)}
    val body=bytes.toByteArray();require(body.size<=1_999_984){"家庭路线数据过大，请拆分地图"}
    return ByteArrayOutputStream().also {s->DataOutputStream(s).use {it.writeInt(0x59484154);it.writeInt(body.size);it.write(body);it.writeLong(CRC32().apply {update(body)}.value)}}.toByteArray()
  }
  fun decode(bytes: ByteArray): HomeAtlas {
    require(bytes.size in 16..2_000_000);val i=DataInputStream(ByteArrayInputStream(bytes));require(i.readInt()==0x59484154)
    val size=i.readInt();require(size==bytes.size-16);val body=ByteArray(size);i.readFully(body);require(i.readLong()==CRC32().apply {update(body)}.value)
    val d=DataInputStream(ByteArrayInputStream(body));fun count(max: Int)=d.readInt().also {require(it in 0..max)}
    fun pose()=HomePose(d.readDouble(),d.readDouble(),d.readDouble())
    require(d.readInt()==1);val id=d.readUTF();val key=d.readUTF();val revision=d.readInt()
    val places=List(count(128)){HomePlace(d.readUTF(),d.readUTF(),d.readUTF(),d.readUTF(),pose())}
    val links=List(count(256)){
      val linkId=d.readUTF();val from=d.readUTF();val to=d.readUTF();val taught=d.readBoolean();val enabled=d.readBoolean()
      HomeLink(linkId,from,to,List(count(4096)){pose()},taught,enabled)
    }
    val zones=List(count(64)){HomeZone(d.readUTF(),d.readUTF(),d.readDouble(),d.readDouble(),d.readDouble())}
    require(d.available()==0);return HomeAtlas(id,key,revision,places,links,zones)
  }
}
