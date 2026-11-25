package com.myyaya.navigationprobe

import java.util.ArrayDeque
import java.util.UUID
import kotlin.math.*

/** Persistent world grid. Unknown space is an exploration boundary, never a drive corridor. */
internal class HomeSpatialMap {
  data class Cell(val x: Int,val y: Int) { fun pose()=HomePose((x+.5)*STEP,(y+.5)*STEP) }
  data class Region(val id: String=UUID.randomUUID().toString(),val name: String,val cells: Set<Cell>)
  data class Block(val x: Double,val y: Double,val radius: Double,val until: Long)
  val cells=LinkedHashMap<Cell,Int>()
  val blocks=ArrayList<Block>()
  val regions=ArrayList<Region>()
  private val history=ArrayDeque<List<Region>>()
  var revision=0
  companion object {
    const val STEP=.05
    const val MAX_CELLS=120_000
    fun cell(p: HomePose)=Cell(floor(p.x/STEP).toInt(),floor(p.y/STEP).toInt())
  }
  fun observe(points: List<Triple<Double,Double,Int>>) {
    require(points.size<=8000)
    for((x,y,label) in points) {
      require(x.isFinite() && y.isFinite() && abs(x)<=50 && abs(y)<=50 && label in 1..4)
      val c=cell(HomePose(x,y));if(c !in cells && cells.size>=MAX_CELLS)error("地图已达容量，请保存后新建独立地点")
      // A later real observation can clear a moved obstacle. Unknown/no-depth cannot clear it.
      if(label in 1..3)cells[c]=label
    }
    revision++
  }
  private fun traversable(radius: Double,zones: List<HomeZone>,now: Long): Set<Cell> {
    require(radius in .03.. .6)
    blocks.removeAll {it.until<=now}
    val offsets=ArrayList<Pair<Int,Int>>();val n=ceil(radius/STEP).toInt()
    for(x in -n..n)for(y in -n..n)if(hypot(x*STEP,y*STEP)<=radius+.018)offsets.add(x to y)
    return cells.keys.filterTo(HashSet()) {c->
      cells[c]==1 && offsets.all {(x,y)->cells[Cell(c.x+x,c.y+y)]==1} &&
        zones.none {z->c.pose().distance(HomePose(z.x,z.y))<=radius+z.radius} &&
        blocks.none {b->c.pose().distance(HomePose(b.x,b.y))<=radius+b.radius}
    }
  }
  private fun neighbors(c: Cell)=listOf(Cell(c.x+1,c.y),Cell(c.x-1,c.y),Cell(c.x,c.y+1),Cell(c.x,c.y-1))
  private fun reachable(start: HomePose,radius: Double,zones: List<HomeZone>,now: Long): Pair<Cell,Map<Cell,Cell?>> {
    val free=traversable(radius,zones,now)
    // Never snap across a wall or through unknown cells to a disconnected free component.
    val root=free.filter {it.pose().distance(start)<=STEP*1.5}.minByOrNull {it.pose().distance(start)}
      ?: error("当前位置周围尚无足够宽的实测地面，请保持定位并观察周围")
    val parent=HashMap<Cell,Cell?>();val queue=ArrayDeque<Cell>();parent[root]=null;queue.add(root)
    while(queue.isNotEmpty()){val c=queue.removeFirst();for(n in neighbors(c))if(n in free && n !in parent){parent[n]=c;queue.add(n)}}
    return root to parent
  }
  private fun path(start: HomePose,target: Cell,parent: Map<Cell,Cell?>): List<HomePose> {
    val reverse=ArrayList<HomePose>();var c: Cell?=target
    while(c!=null){reverse.add(c.pose());c=parent[c]}
    reverse.reverse();val points=listOf(start)+reverse
    // Remove only collinear intermediate grid cells; no straight-line shortcuts across unknown space.
    return points.filterIndexed {i,p->i==0 || i==points.lastIndex ||
      abs((p.x-points[i-1].x)*(points[i+1].y-p.y)-(p.y-points[i-1].y)*(points[i+1].x-p.x))>1e-8}
  }
  fun route(start: HomePose,target: HomePose,radius: Double,zones: List<HomeZone>,now: Long): List<HomePose> {
    val (_,parent)=reachable(start,radius,zones,now)
    val end=parent.keys.filter {it.pose().distance(target)<=STEP*.72}.minByOrNull {it.pose().distance(target)}
      ?: error("目的地没有已观测、足够宽的连通路径")
    return path(start,end,parent)+target
  }
  fun frontier(start: HomePose,radius: Double,zones: List<HomeZone>,now: Long,visited: List<HomePose>): List<HomePose>? {
    val (_,parent)=reachable(start,radius,zones,now)
    // Stop inside known free space, near the unknown boundary. Vision must extend the map before driving on.
    val ring=ceil((radius+.1)/STEP).toInt()
    val candidates=parent.keys.filter {c->c.pose().distance(start)>=.15 && visited.none {it.distance(c.pose())<.18} &&
      listOf(Cell(c.x+ring,c.y),Cell(c.x-ring,c.y),Cell(c.x,c.y+ring),Cell(c.x,c.y-ring)).any {it !in cells}}
    val end=candidates.minByOrNull {it.pose().distance(start)} ?: return null
    return path(start,end,parent)
  }
  fun block(p: HomePose,radius: Double,now: Long) {require(radius in .025.. .5);blocks.add(Block(p.x,p.y,radius,now+120_000));while(blocks.size>128)blocks.removeAt(0);revision++}
  private fun checkpoint(){history.addLast(regions.toList());while(history.size>12)history.removeFirst()}
  fun rename(id: String,name: String){require(name.trim().length in 1..40 && regions.none {it.id!=id && it.name==name.trim()}){"房间名称为空、过长或已被使用"};val i=regions.indexOfFirst {it.id==id};require(i>=0);checkpoint();regions[i]=regions[i].copy(name=name.trim());revision++}
  fun merge(ids: Set<String>){require(ids.size>=2);val selected=regions.filter {it.id in ids};require(selected.size==ids.size);checkpoint();regions.removeAll(selected.toSet());regions.add(selected.first().copy(cells=selected.flatMap {it.cells}.toSet()));revision++}
  fun split(id: String,a: HomePose,b: HomePose){require(a.distance(b)>.05 && regions.size<64);val old=regions.firstOrNull {it.id==id} ?: error("没有此房间")
    val (left,right)=old.cells.partition {(it.pose().x-a.x)*(b.y-a.y)-(it.pose().y-a.y)*(b.x-a.x)>=0}
    require(left.size>=16 && right.size>=16){"分界线两侧都需有已绘制区域"};checkpoint();regions.remove(old)
    regions.add(old.copy(cells=left.toSet()));regions.add(Region(name=old.name.take(30)+" 分区 "+UUID.randomUUID().toString().take(4),cells=right.toSet()));revision++
  }
  fun boundary(id: String,polygon: List<HomePose>) {
    require(polygon.size in 3..64);val old=regions.firstOrNull {it.id==id} ?: error("没有此房间")
    fun inside(p: HomePose): Boolean {var yes=false;var j=polygon.lastIndex;for(i in polygon.indices){val a=polygon[i];val b=polygon[j];if((a.y>p.y)!=(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;j=i};return yes}
    val selected=cells.filter {it.value==1 && inside(it.key.pose())}.keys;require(selected.size>=16)
    checkpoint();val claimed=selected.toSet();for(i in regions.indices)regions[i]=regions[i].copy(cells=if(regions[i].id==id)claimed else regions[i].cells-claimed);regions.removeAll {it.cells.isEmpty()};revision++
  }
  fun undo(){require(history.isNotEmpty()){ "没有可撤销的分区修改" };regions.clear();regions.addAll(history.removeLast());revision++}
  /** Erode narrow doorways, label room cores, then expand labels over measured floor cells. */
  fun segment() {
    val free=cells.filterValues {it==1}.keys
    val cores=free.filterTo(HashSet()){c->(-9..9).all {x->(-9..9).all {y->hypot(x.toDouble(),y.toDouble())>9 || Cell(c.x+x,c.y+y) in free}}}
    val labels=HashMap<Cell,Int>();val components=ArrayList<MutableSet<Cell>>();val unseen=cores.toMutableSet()
    while(unseen.isNotEmpty()){val seed=unseen.first();unseen.remove(seed);val group=HashSet<Cell>();val q=ArrayDeque<Cell>();q.add(seed)
      while(q.isNotEmpty()){val c=q.removeFirst();group.add(c);neighbors(c).forEach {if(unseen.remove(it))q.add(it)}}
      if(group.size>=64)components.add(group)
    }
    require(components.size<=64){"初分区域超过64个，请缩小地点范围"}
    require(components.isNotEmpty()){ "地面覆盖还不足以自动分房，请继续建图或手动调整" }
    val q=ArrayDeque<Cell>();components.forEachIndexed {i,group->group.forEach {labels[it]=i;q.add(it)}}
    while(q.isNotEmpty()){val c=q.removeFirst();for(n in neighbors(c))if(n in free && n !in labels){labels[n]=labels.getValue(c);q.add(n)}}
    checkpoint();val previous=regions.toList();regions.clear()
    components.indices.forEach {i->val group=labels.filterValues {it==i}.keys;val match=previous.maxByOrNull {r->r.cells.count {it in group}}
      regions.add(if(match!=null && match.cells.count {it in group}>group.size/2 && regions.none {it.id==match.id})match.copy(cells=group) else Region(name="待命名房间 ${i+1}",cells=group))};revision++
  }
}
