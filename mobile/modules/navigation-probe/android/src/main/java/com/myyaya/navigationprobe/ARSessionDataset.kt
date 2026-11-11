package com.myyaya.navigationprobe

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import com.google.ar.core.RecordingConfig
import com.google.ar.core.RecordingStatus
import com.google.ar.core.Session
import java.io.File
import java.util.UUID

/** Official camera/IMU datasets, bounded and local. Plain depth NDJSON is separate. */
internal class ARSessionDataset(context: Context) {
  private val directory=File(context.getExternalFilesDir("navigation-probe") ?: context.filesDir,"datasets").apply { mkdirs() }
  @Volatile private var active: File?=null
  private var started=0L
  @Volatile private var limitMs=90_000L
  var lastFile: String?=null;private set
  fun recordings()=directory.listFiles()?.filter { it.name.matches(Regex("dataset-[a-f0-9-]+\\.mp4")) && it.length()>0 }
    ?.sortedByDescending { it.lastModified() } ?: emptyList()
  fun file(name: String): File {
    require(name.matches(Regex("dataset-[a-f0-9-]+\\.mp4")))
    return File(directory,name).canonicalFile.also { require(it.parentFile==directory.canonicalFile && it.isFile && it.length() in 1..120_000_000L) }
  }
  fun start(session: Session) {
    check(active==null)
    recordings().drop(2).forEach { it.delete() }
    val f=File(directory,"dataset-${UUID.randomUUID()}.mp4")
    session.startRecording(RecordingConfig(session).setMp4DatasetUri(Uri.fromFile(f)).setAutoStopOnPause(true))
    active=f;started=SystemClock.elapsedRealtime();lastFile=f.name;limitMs=90_000L
  }
  fun stop(session: Session?) {
    if(active==null) return
    try { if(session?.recordingStatus==RecordingStatus.OK) session.stopRecording() } finally { active=null }
  }
  fun tick(session: Session) {
    val f=active ?: return
    if(SystemClock.elapsedRealtime()-started>limitMs || f.length()>100_000_000 || session.recordingStatus!=RecordingStatus.OK) stop(session)
  }
  fun recording()=active!=null
  fun extendForLocalMission() { check(active!=null);limitMs=600_000L }
  fun remainingMs()=if(active!=null) (limitMs-(SystemClock.elapsedRealtime()-started)).coerceAtLeast(0) else 0L
  fun report(): Map<String,Any?> = mapOf("recording" to recording(),"file" to lastFile,"maxSeconds" to limitMs/1000,"remainingMs" to remainingMs(),"localOnly" to true)
}
