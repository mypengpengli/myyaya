package com.superlooi.diagnosticarchive

import android.app.ActivityManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Debug
import android.os.Process
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class DiagnosticArchiveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DiagnosticArchive")

    AsyncFunction("createZip") { sourceDirectoryUri: String, outputFileUri: String ->
      createZip(sourceDirectoryUri, outputFileUri)
    }

    AsyncFunction("getPerformanceSnapshot") {
      getPerformanceSnapshot()
    }

    AsyncFunction("getPreviousProcessExitReasons") { maxCount: Int ->
      getPreviousProcessExitReasons(maxCount)
    }
  }

  private fun getPerformanceSnapshot(): Map<String, Any?> {
    val context = appContext.reactContext ?: throw IllegalStateException("React context unavailable")
    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val memoryInfo = ActivityManager.MemoryInfo().also { activityManager.getMemoryInfo(it) }
    val runtime = Runtime.getRuntime()
    val javaUsed = runtime.totalMemory() - runtime.freeMemory()
    val pssKb = Debug.getPss().toLong()
    val nativeHeapBytes = Debug.getNativeHeapAllocatedSize()

    return mapOf(
      "pid" to Process.myPid(),
      "elapsedRealtimeMs" to SystemClock.elapsedRealtime(),
      "pssKb" to pssKb,
      "rssKb" to readSelfRssKb(),
      "javaHeapUsedBytes" to javaUsed,
      "javaHeapTotalBytes" to runtime.totalMemory(),
      "javaHeapMaxBytes" to runtime.maxMemory(),
      "nativeHeapBytes" to nativeHeapBytes,
      "systemAvailMemBytes" to memoryInfo.availMem,
      "systemTotalMemBytes" to memoryInfo.totalMem,
      "systemLowMemory" to memoryInfo.lowMemory,
      "systemLowMemoryThresholdBytes" to memoryInfo.threshold
    )
  }

  private fun readSelfRssKb(): Long? {
    return try {
      val line = File("/proc/self/status").useLines { lines -> lines.firstOrNull { it.startsWith("VmRSS:") } }
      line?.trim()?.split(Regex("\\s+"))?.getOrNull(1)?.toLongOrNull()
    } catch (_: Throwable) {
      null
    }
  }

  private fun getPreviousProcessExitReasons(maxCount: Int): List<Map<String, Any?>> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
    val context = appContext.reactContext ?: throw IllegalStateException("React context unavailable")
    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val count = maxCount.coerceIn(1, 5)
    return activityManager.getHistoricalProcessExitReasons(context.packageName, 0, count).map { info ->
      mapOf(
        "reason" to info.reason,
        "reasonName" to exitReasonName(info.reason),
        "status" to info.status,
        "importance" to info.importance,
        "pssKb" to info.pss,
        "rssKb" to info.rss,
        "timestampMs" to info.timestamp,
        "description" to (info.description?.take(240) ?: "")
      )
    }
  }

  private fun exitReasonName(reason: Int): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return reason.toString()
    return when (reason) {
      android.app.ApplicationExitInfo.REASON_EXIT_SELF -> "EXIT_SELF"
      android.app.ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
      android.app.ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY"
      android.app.ApplicationExitInfo.REASON_CRASH -> "CRASH"
      android.app.ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
      android.app.ApplicationExitInfo.REASON_ANR -> "ANR"
      android.app.ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INITIALIZATION_FAILURE"
      android.app.ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "PERMISSION_CHANGE"
      android.app.ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE_USAGE"
      android.app.ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED"
      android.app.ApplicationExitInfo.REASON_USER_STOPPED -> "USER_STOPPED"
      android.app.ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "DEPENDENCY_DIED"
      android.app.ApplicationExitInfo.REASON_OTHER -> "OTHER"
      else -> "UNKNOWN_$reason"
    }
  }

  private fun createZip(sourceDirectoryUri: String, outputFileUri: String): Map<String, Any?> {
    val sourceDirectory = fileFromUri(sourceDirectoryUri)
    val outputFile = fileFromUri(outputFileUri)
    if (!sourceDirectory.exists() || !sourceDirectory.isDirectory) {
      throw IllegalArgumentException("Diagnostic source directory does not exist: ${sourceDirectory.path}")
    }

    val sourceCanonical = sourceDirectory.canonicalFile
    val outputCanonical = outputFile.canonicalFile
    if (outputCanonical.path.startsWith(sourceCanonical.path + File.separator)) {
      throw IllegalArgumentException("Diagnostic ZIP output must be outside the source directory")
    }

    outputCanonical.parentFile?.mkdirs()
    if (outputCanonical.exists() && !outputCanonical.delete()) {
      throw IllegalStateException("Unable to replace diagnostic ZIP: ${outputCanonical.path}")
    }

    var entries = 0
    var uncompressedBytes = 0L
    ZipOutputStream(BufferedOutputStream(FileOutputStream(outputCanonical))).use { zip ->
      sourceCanonical.walkTopDown()
        .filter { it.isFile }
        .sortedBy { it.relativeTo(sourceCanonical).invariantSeparatorsPath }
        .forEach { file ->
          val relative = file.relativeTo(sourceCanonical).invariantSeparatorsPath
          zip.putNextEntry(ZipEntry(relative))
          BufferedInputStream(FileInputStream(file)).use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              if (read == 0) continue
              zip.write(buffer, 0, read)
              uncompressedBytes += read.toLong()
            }
          }
          zip.closeEntry()
          entries += 1
        }
    }

    return mapOf(
      "outputUri" to outputFileUri,
      "entries" to entries,
      "uncompressedBytes" to uncompressedBytes
    )
  }

  private fun fileFromUri(value: String): File {
    val uri = Uri.parse(value)
    return when (uri.scheme) {
      null, "" -> File(value)
      "file" -> File(uri.path ?: throw IllegalArgumentException("Invalid file URI: $value"))
      else -> throw IllegalArgumentException("Only file:// diagnostic paths are supported: $value")
    }
  }
}
