package com.myyaya.navigationprobe

import android.util.AtomicFile
import java.io.File
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

internal class HomeSpatialStore(private val directory: File) {
  private fun file(id: String): AtomicFile {require(UUID.fromString(id).toString()==id);return AtomicFile(File(directory,"$id.spatial.json"))}
  fun load(id: String,key: String): HomeSpatialMap {
    val f=file(id);if(!f.baseFile.exists() && !File(f.baseFile.path+".bak").exists())return HomeSpatialMap()
    val bytes=f.readFully();require(bytes.size<=12_000_000)
    val v=JSONObject(bytes.toString(Charsets.UTF_8));require(v.getInt("version")==1 && v.getString("mapId")==id && v.getString("referenceKey")==key){"全局地面图与当前标定不一致"}
    val map=HomeSpatialMap();val cells=v.getJSONArray("cells");require(cells.length()<=HomeSpatialMap.MAX_CELLS)
    for(i in 0 until cells.length()){val c=cells.getJSONArray(i);val x=c.getInt(0);val y=c.getInt(1);val label=c.getInt(2);require(x in -1000..999 && y in -1000..999 && label in 1..3);map.cells[HomeSpatialMap.Cell(x,y)]=label}
    val regions=v.getJSONArray("regions");require(regions.length()<=256)
    for(i in 0 until regions.length()){val r=regions.getJSONObject(i);val points=r.getJSONArray("cells");require(points.length()<=HomeSpatialMap.MAX_CELLS)
      val set=(0 until points.length()).map {val p=points.getJSONArray(it);HomeSpatialMap.Cell(p.getInt(0),p.getInt(1))}.toSet();require(set.all {it in map.cells})
      map.regions.add(HomeSpatialMap.Region(r.getString("id"),r.getString("name"),set))}
    val blocks=v.optJSONArray("blocks") ?: JSONArray();require(blocks.length()<=128)
    for(i in 0 until blocks.length()){val b=blocks.getJSONObject(i);val x=b.getDouble("x");val y=b.getDouble("y");val radius=b.getDouble("radius");require(x.isFinite() && y.isFinite() && radius in .025.. .5)
      val until=b.getLong("until");if(until>System.currentTimeMillis())map.blocks.add(HomeSpatialMap.Block(x,y,radius,until))}
    map.revision=v.getInt("revision");return map
  }
  fun save(id: String,key: String,map: HomeSpatialMap) {
    val data=JSONObject().put("version",1).put("mapId",id).put("referenceKey",key).put("revision",map.revision)
      .put("cells",JSONArray(map.cells.map {(c,label)->listOf(c.x,c.y,label)}))
      .put("regions",JSONArray(map.regions.map {r->mapOf("id" to r.id,"name" to r.name,"cells" to r.cells.map {listOf(it.x,it.y)})}))
      .put("blocks",JSONArray(map.blocks.map {mapOf("x" to it.x,"y" to it.y,"radius" to it.radius,"until" to it.until)}))
    val bytes=data.toString().toByteArray(Charsets.UTF_8);require(bytes.size<=12_000_000)
    val atomic=file(id);val out=atomic.startWrite();try {out.write(bytes);atomic.finishWrite(out)}catch(e: Exception){atomic.failWrite(out);throw e}
  }
}
