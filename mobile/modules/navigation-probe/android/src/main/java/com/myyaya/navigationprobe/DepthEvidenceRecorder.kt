package com.myyaya.navigationprobe

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executor

/** Bounded local replay data. No camera photographs, network requests or credentials. */
internal class DepthEvidenceRecorder(private val directory: File,private val io: Executor) {
  private val file=File(directory,"depth-evidence-${UUID.randomUUID()}.ndjson")
  private var lastNs=0L
  private var lastDepth=0L
  private var scheduled=0
  @Volatile private var written=0
  @Volatile private var failed=false
  fun report(): Map<String,Any?> = mapOf("file" to file.name,"frames" to written,"limit" to 120,"writeFailed" to failed)
  fun record(now: Long,rawNs: Long,denseNs: Long,raw: DepthSamples.Result,dense: DepthSamples.Result?,
    camera: RigidPose,plane: GroundPlane,intrinsics: FloatArray,dimensions: IntArray,fusion: Map<String,Any?>) {
    if (scheduled>=120 || rawNs<=lastDepth || rawNs>now || now-rawNs>250_000_000L || now-lastNs<250_000_000L) return
    lastNs=now;lastDepth=rawNs;scheduled++
    io.execute {
      try {
        directory.mkdirs()
        if (written==0) directory.listFiles()?.filter { it.name.startsWith("depth-evidence-") && it!=file }
          ?.sortedByDescending { it.lastModified() }?.drop(2)?.forEach { it.delete() }
        fun image(s: DepthSamples.Result): JSONObject {
          val bytes=ByteArray(s.millimeters.size*2)
          s.millimeters.forEachIndexed { i,value -> bytes[i*2]=value.toByte();bytes[i*2+1]=(value shr 8).toByte() }
          return JSONObject().put("width",s.width).put("height",s.height).put("sourceWidth",s.sourceWidth)
            .put("sourceHeight",s.sourceHeight).put("step",s.step).put("u16leBase64",Base64.encodeToString(bytes,Base64.NO_WRAP))
        }
        val row=JSONObject().put("schemaVersion",1).put("frameNs",now).put("rawNs",rawNs).put("denseNs",denseNs)
          .put("cameraTranslation",JSONArray(camera.t.toList())).put("cameraQuaternion",JSONArray(camera.q.toList()))
          .put("planeOrigin",JSONArray(plane.origin.toList())).put("planeNormal",JSONArray(plane.normal.toList()))
          .put("intrinsics",JSONArray(intrinsics.toList())).put("textureDimensions",JSONArray(dimensions.toList()))
          .put("raw",image(raw)).put("dense",dense?.let { image(it) } ?: JSONObject.NULL).put("fusion",JSONObject(fusion))
        file.appendText(row.toString()+"\n");written++
      } catch (_: Exception) { failed=true }
    }
  }
}
