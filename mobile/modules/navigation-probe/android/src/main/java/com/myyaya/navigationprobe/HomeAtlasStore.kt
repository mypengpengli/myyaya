package com.myyaya.navigationprobe

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.util.UUID
import org.json.JSONObject

internal class HomeAtlasStore(context: Context) {
  val directory=File(context.filesDir,"home-navigation").apply {mkdirs()}
  private fun file(id: String,suffix: String): File {require(UUID.fromString(id).toString()==id);return File(directory,"$id.$suffix")}
  fun load(id: String): HomeAtlas? {
    val atomic=AtomicFile(file(id,"yayaatlas"));if(!atomic.baseFile.exists() && !File(atomic.baseFile.path+".bak").exists())return null
    return HomeAtlasCodec.decode(atomic.readFully()).also {require(it.mapId==id)}
  }
  fun save(a: HomeAtlas) {
    val atomic=AtomicFile(file(a.mapId,"yayaatlas"));val stream=atomic.startWrite()
    try {stream.write(HomeAtlasCodec.encode(a));atomic.finishWrite(stream)}catch(e: Exception){atomic.failWrite(stream);throw e}
  }
  fun list(): List<Map<String,Any?>> = directory.listFiles()?.mapNotNull {f->
    when {f.name.endsWith(".yayaatlas")->f.name.removeSuffix(".yayaatlas");f.name.endsWith(".yayaatlas.bak")->f.name.removeSuffix(".yayaatlas.bak");else->null}
  }?.distinct()?.mapNotNull {id->runCatching {load(id)?.let {a->
    a.report()+mapOf("task" to runCatching {task(a.mapId)?.toString()}.getOrElse {JSONObject().put("phase","RECOVERY_REQUIRED").put("reason","旧任务文件无法读取，地图仍可用").toString()})
  }}.getOrNull()} ?: emptyList()
  fun task(id: String): JSONObject? {
    val atomic=AtomicFile(file(id,"task.json"))
    if(!atomic.baseFile.exists() && !File(atomic.baseFile.path+".bak").exists())return null
    val bytes=atomic.readFully();require(bytes.size<=100_000)
    return JSONObject(bytes.toString(Charsets.UTF_8))
  }
  fun task(id: String,data: JSONObject) {
    val text=data.toString();require(text.length<=100_000)
    val atomic=AtomicFile(file(id,"task.json"));val out=atomic.startWrite()
    try {out.write(text.toByteArray(Charsets.UTF_8));atomic.finishWrite(out)}catch(e: Exception){atomic.failWrite(out);throw e}
  }
  fun event(id: String,event: Map<String,Any?>) {
    val f=file(id,"events.ndjson");if(f.length()>1_000_000)f.writeText("")
    f.appendText(JSONObject(event+mapOf("at" to System.currentTimeMillis())).toString()+"\n")
  }
}
