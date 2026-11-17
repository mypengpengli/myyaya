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
  fun list(): List<Map<String,Any?>> = directory.listFiles()?.filter {it.extension=="yayaatlas"}?.mapNotNull {f->
    runCatching {load(f.nameWithoutExtension)?.let {a->a.report()+mapOf("task" to task(a.mapId)?.toString())}}.getOrNull()
  } ?: emptyList()
  fun task(id: String): JSONObject? {
    val f=file(id,"task.json");if(!f.exists())return null
    require(f.length()<=100_000);return JSONObject(f.readText())
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
