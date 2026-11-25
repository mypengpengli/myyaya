package com.myyaya.navigationprobe

import android.util.AtomicFile
import android.util.Base64
import java.io.File
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

internal data class VisualKeyframe(val mapId: String,val referenceKey: String,val pose: RigidPose,
  val points: List<FloatArray>,val descriptors: ByteArray,val captureJpeg: ByteArray=byteArrayOf(),
  val intrinsics: FloatArray=floatArrayOf(),val width: Int=0,val height: Int=0)

/** Independent files preserve old room-map formats. Called only by the vision worker. */
internal class VisualLandmarkStore(private val directory: File) {
  companion object {const val MAX_FRAMES=48;const val MAX_BYTES=48_000_000}
  init {directory.mkdirs()}
  private fun file(id: String): AtomicFile {
    require(UUID.fromString(id).toString()==id)
    return AtomicFile(File(directory,"$id.landmarks"))
  }
  fun load(id: String): List<VisualKeyframe> {
    val f=file(id)
    if(!f.baseFile.exists() && !File(f.baseFile.path+".bak").exists()) return emptyList()
    require(maxOf(f.baseFile.length(),File(f.baseFile.path+".bak").length())<=MAX_BYTES)
    val root=JSONObject(f.readFully().toString(Charsets.UTF_8))
    if(root.getInt("version")==1)return emptyList()
    require(root.getInt("version")==2)
    val frames=root.getJSONArray("frames");require(frames.length()<=MAX_FRAMES)
    return (0 until frames.length()).map {i->
      val row=frames.getJSONObject(i);val points=row.getJSONArray("points");require(points.length() in 12..400)
      val xyz=(0 until points.length()).map {n->val p=points.getJSONArray(n);require(p.length()==3)
        FloatArray(3) {j->p.getDouble(j).toFloat().also {require(it.isFinite() && kotlin.math.abs(it)<50)}}}
      val bytes=Base64.decode(row.getString("descriptors"),Base64.NO_WRAP);require(bytes.size==xyz.size*512)
      fun floats(key: String,size: Int)=row.getJSONArray(key).let {a->require(a.length()==size);FloatArray(size) {a.getDouble(it).toFloat()}}
      val photo=Base64.decode(row.getString("captureJpeg"),Base64.NO_WRAP);require(photo.size<=500_000)
      val k=floats("intrinsics",4);require(k.all {it.isFinite()} && k[0]>0 && k[1]>0)
      val width=row.getInt("width");val height=row.getInt("height");require(width in 1..1280 && height in 1..960)
      VisualKeyframe(id,row.getString("referenceKey"),RigidPose(floats("t",3),floats("q",4)),xyz,bytes,photo,k,width,height)
    }
  }
  fun save(id: String,frames: List<VisualKeyframe>) {
    require(frames.size<=MAX_FRAMES && frames.all {it.mapId==id})
    val rows=JSONArray()
    frames.forEach {f->rows.put(JSONObject().put("referenceKey",f.referenceKey).put("t",JSONArray(f.pose.t.toList()))
      .put("q",JSONArray(f.pose.q.toList())).put("points",JSONArray(f.points.map {it.toList()}))
      .put("descriptors",Base64.encodeToString(f.descriptors,Base64.NO_WRAP))
      .put("captureJpeg",Base64.encodeToString(f.captureJpeg,Base64.NO_WRAP)).put("intrinsics",JSONArray(f.intrinsics.toList()))
      .put("width",f.width).put("height",f.height))}
    val bytes=JSONObject().put("version",2).put("frames",rows).toString().toByteArray();require(bytes.size<=MAX_BYTES)
    val atomic=file(id);val out=atomic.startWrite()
    try {out.write(bytes);atomic.finishWrite(out)}catch(e: Exception){atomic.failWrite(out);throw e}
  }
}
