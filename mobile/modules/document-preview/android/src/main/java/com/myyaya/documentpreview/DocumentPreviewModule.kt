package com.myyaya.documentpreview

import android.content.Intent
import android.content.ClipData
import android.app.Activity
import android.provider.OpenableColumns
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.zip.ZipFile
import java.util.UUID
import kotlin.math.min

class DocumentPreviewModule : Module() {
  private var picker: Promise? = null
  private data class Export(val file: File, val promise: Promise)
  private var exporter: Export? = null
  private var opener: Promise? = null
  private val extensions = mapOf("application/pdf" to "pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document" to "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation" to "pptx", "application/msword" to "doc", "application/vnd.ms-powerpoint" to "ppt",
    "text/plain" to "txt", "text/markdown" to "md", "application/json" to "json", "image/png" to "png", "image/jpeg" to "jpg", "image/webp" to "webp", "video/mp4" to "mp4")
  private fun context() = requireNotNull(appContext.reactContext)
  private fun artifact(uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "仅允许预览本应用保存的文件" }
    val root = File(context().filesDir, "myyaya-artifacts").canonicalFile
    val file = File(requireNotNull(parsed.path)).canonicalFile
    require(file.path.startsWith(root.path + File.separator) && file.isFile && file.length() <= 25L * 1024 * 1024) { "文件不存在或超出预览范围" }
    return file
  }
  private fun pdf(file: File) = PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY))
  private fun office(file: File, mime: String): List<Map<String, String>> {
    ZipFile(file).use { zip ->
      require(zip.size() <= 10_000) { "文档条目过多" }
      val ppt = mime.contains("presentationml")
      val entries = zip.entries().asSequence().filter {
        if (ppt) Regex("ppt/slides/slide[0-9]+\\.xml").matches(it.name) else it.name == "word/document.xml"
      }.sortedBy { if (ppt) Regex("[0-9]+").find(it.name)?.value?.toIntOrNull() ?: 0 else 0 }.take(101).toList()
      require(entries.isNotEmpty() && entries.size <= 100) { "文档为空、格式不支持或页数过多" }
      var total = 0
      return entries.mapIndexed { index, entry ->
        val bytes = zip.getInputStream(entry).use { it.readBytesBounded(2 * 1024 * 1024) }
        total += bytes.size; require(total <= 8 * 1024 * 1024) { "文档内容过大" }
        // Reject DTD/entity declarations; no network or executable content is rendered.
        val xml = bytes.toString(Charsets.UTF_8)
        require(!xml.contains("<!DOCTYPE", true) && !xml.contains("<!ENTITY", true)) { "不支持含实体声明的文档" }
        val parser = XmlPullParserFactory.newInstance().newPullParser()
        parser.setInput(xml.reader())
        val text = StringBuilder()
        while (parser.eventType != XmlPullParser.END_DOCUMENT) {
          if (parser.eventType == XmlPullParser.START_TAG && parser.name.substringAfter(':') == "t") text.append(parser.nextText())
          else if (parser.eventType == XmlPullParser.START_TAG && parser.name.substringAfter(':') in listOf("tab", "br")) text.append(' ')
          else if (parser.eventType == XmlPullParser.END_TAG && parser.name.substringAfter(':') in listOf("p", "tr")) text.append('\n')
          require(text.length <= 300_000) { "文档文字过多" }; parser.next()
        }
        mapOf("title" to if (ppt) "第 ${index + 1} 页" else "文档内容", "text" to text.toString().trim())
      }
    }
  }
  private fun java.io.InputStream.readBytesBounded(max: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) { val count = read(buffer); if (count < 0) break; require(output.size() + count <= max) { "文件内容过大" }; output.write(buffer, 0, count) }
    return output.toByteArray()
  }
  override fun definition() = ModuleDefinition {
    Name("DocumentPreview")
    AsyncFunction("pickFile") { promise: Promise ->
      val activity = appContext.currentActivity
      if (picker != null || exporter != null || activity == null) promise.reject("ERR_PICKER_BUSY", "请保持手机在前台并等待当前文件选择结束", null)
      else {
        picker = promise
        try { activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          putExtra(Intent.EXTRA_MIME_TYPES, extensions.keys.toTypedArray())
        }, 37412) } catch (error: Exception) { picker = null; promise.reject("ERR_PICKER", "无法打开文件选择器", error) }
      }
    }
    AsyncFunction("saveOriginal") { uri: String, mime: String, title: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (picker != null || exporter != null || activity == null) promise.reject("ERR_PICKER_BUSY", "请保持手机在前台并等待当前文件选择结束", null)
      else try {
        val file = artifact(uri)
        val extension = extensions[mime] ?: throw IllegalArgumentException("暂不支持此文件类型")
        require(file.extension.lowercase() == extension) { "文件类型与原文件不符" }
        val name = title.replace(Regex("[\\\\/\\x00-\\x1f]"), "_").trim().take(180).ifEmpty { "小丫文件.$extension" }
        exporter = Export(file, promise)
        activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
          type = mime; addCategory(Intent.CATEGORY_OPENABLE)
          putExtra(Intent.EXTRA_TITLE, if (name.endsWith(".$extension", true)) name else "$name.$extension")
        }, 37413)
      } catch (error: Exception) { exporter = null; promise.reject("ERR_EXPORT", "无法保存原文件，请重新选择保存位置", error) }
    }
    OnActivityResult { _, result ->
      if (result.requestCode == 37414) { opener?.resolve(null); opener = null; return@OnActivityResult }
      if (result.requestCode == 37413) {
        val pending = exporter ?: return@OnActivityResult
        exporter = null
        val destination = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || destination == null) pending.promise.resolve(false)
        else Thread {
          try {
            require(destination.scheme == "content") { "保存位置无效" }
            val file = artifact(Uri.fromFile(pending.file).toString())
            context().contentResolver.openOutputStream(destination, "wt").use { output ->
              requireNotNull(output) { "保存位置不可写" }
              file.inputStream().use { input -> input.copyTo(output) }
            }
            pending.promise.resolve(true)
          } catch (error: Exception) { pending.promise.reject("ERR_EXPORT", "保存失败，请检查目标位置和剩余空间；原文件仍保留在作品中", error) }
        }.start()
        return@OnActivityResult
      }
      if (result.requestCode != 37412) return@OnActivityResult
      val promise = picker ?: return@OnActivityResult
      picker = null
      val source = result.data?.data
      if (result.resultCode != Activity.RESULT_OK || source == null) promise.resolve(null)
      else Thread {
        var target: File? = null
        try {
          val resolver = context().contentResolver
          val mime = resolver.getType(source) ?: "application/octet-stream"
          val extension = extensions[mime] ?: throw IllegalArgumentException("暂不支持此文件类型")
          var title = "导入文件.$extension"
          resolver.query(source, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor -> if (cursor.moveToFirst()) title = cursor.getString(0).take(180) }
          val id = UUID.randomUUID().toString()
          val directory = File(context().filesDir, "myyaya-artifacts").apply { mkdirs() }
          target = File(directory, "$id.$extension")
          resolver.openInputStream(source).use { input ->
            requireNotNull(input) { "无法读取所选文件" }
            target!!.outputStream().use { output ->
              val buffer = ByteArray(32768); var count = 0L
              while (true) { val read = input.read(buffer); if (read < 0) break; count += read; require(count <= 25L * 1024 * 1024) { "文件不能超过 25 MB" }; output.write(buffer, 0, read) }
              require(count > 0) { "文件为空" }
            }
          }
          promise.resolve(mapOf("id" to id, "uri" to Uri.fromFile(target).toString(), "mimeType" to mime, "title" to title))
        } catch (error: Exception) { target?.delete(); promise.reject("ERR_IMPORT", "文件导入失败：类型不支持、文件过大或无法读取", error) }
      }.start()
    }
    OnActivityDestroys {
      picker?.reject("ERR_PICKER_CLOSED", "文件选择已取消", null); picker = null
      exporter?.promise?.reject("ERR_PICKER_CLOSED", "文件保存已取消，原文件仍保留在作品中", null); exporter = null
      opener?.reject("ERR_VIEWER_CLOSED", "文件查看已结束", null); opener = null
    }
    AsyncFunction("inspect") { uri: String, mime: String ->
      val file = artifact(uri)
      if (mime == "application/pdf") pdf(file).use { renderer ->
        require(renderer.pageCount in 1..300) { "PDF 页数超出范围" }
        mapOf("format" to "pdf", "pages" to emptyList<Any>(), "pageCount" to renderer.pageCount, "simplified" to false)
      } else if (mime in listOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.presentationml.presentation")) {
        val pages = office(file, mime)
        mapOf("format" to if (mime.contains("presentationml")) "pptx" else "docx", "pages" to pages, "pageCount" to pages.size, "simplified" to true)
      } else {
        require(mime in listOf("text/plain", "text/markdown", "application/json")) { "此格式请用外部应用打开" }
        val text = file.inputStream().use { it.readBytesBounded(1024 * 1024) }.toString(Charsets.UTF_8)
        mapOf("format" to "text", "pages" to listOf(mapOf("title" to "文档内容", "text" to text)), "pageCount" to 1, "simplified" to false)
      }
    }
    AsyncFunction("renderPdf") { uri: String, index: Int ->
      val file = artifact(uri)
      pdf(file).use { renderer ->
        require(index in 0 until renderer.pageCount)
        renderer.openPage(index).use { page ->
          val scale = min(1200.0 / page.width, 1600.0 / page.height)
          val bitmap = Bitmap.createBitmap((page.width * scale).toInt().coerceAtLeast(1), (page.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
          try {
            bitmap.eraseColor(Color.WHITE); page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            val directory = File(context().cacheDir, "myyaya-pdf").apply { mkdirs() }
            // Keep a bounded cache; rendering a new page replaces the oldest cached page.
            directory.listFiles()?.sortedBy { it.lastModified() }?.dropLast(7)?.forEach { it.delete() }
            val target = File(directory, "${file.nameWithoutExtension}-$index.png")
            target.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            Uri.fromFile(target).toString()
          } finally { bitmap.recycle() }
        }
      }
    }
    AsyncFunction("openOriginal") { uri: String, mime: String, title: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (opener != null || activity == null) promise.reject("ERR_VIEWER_BUSY", "请先返回小丫，再打开文件", null)
      else try {
        val file = artifact(uri)
        val displayName = title.replace(Regex("[\\\\/\\x00-\\x1f]"), "_").trim().take(180).ifEmpty { file.name }
        val content = FileProvider.getUriForFile(context(), context().packageName + ".myyaya.documents", file, displayName)
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(content, mime).apply {
          clipData = ClipData.newRawUri(file.name, content); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context().packageManager.queryIntentActivities(intent, 0).forEach {
          context().grantUriPermission(it.activityInfo.packageName, content, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        opener = promise
        activity.startActivityForResult(intent, 37414)
      } catch (error: Exception) { opener = null; promise.reject("ERR_VIEWER", "未找到可打开此文件的应用", error) }
    }
    AsyncFunction("download") { url: String, token: String, sha: String, bytes: Double, id: String, extension: String ->
      require(Regex("[a-f0-9]{64}").matches(sha) && bytes >= 1 && bytes <= 25 * 1024 * 1024 && bytes % 1.0 == 0.0)
      require(Regex("[A-Za-z0-9_-]{1,160}").matches(id) && Regex("[a-z0-9]{1,8}").matches(extension))
      val address = URL(url)
      require(address.protocol == "https" && address.userInfo == null && address.query == null && address.ref == null)
      require(Regex("/myyaya/v1/tasks/[A-Za-z0-9_-]+/files/[A-Za-z0-9_-]+").matches(address.path))
      val directory = File(context().filesDir, "myyaya-artifacts").apply { mkdirs() }
      val target = File(directory, "$id.$extension")
      val temporary = File.createTempFile("download-", ".part", directory)
      val connection = address.openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false; connection.connectTimeout = 15_000; connection.readTimeout = 20_000
      connection.setRequestProperty("Authorization", "Bearer $token")
      try {
        require(connection.responseCode == 200) { "文件下载失败，请检查服务器连接" }
        require(connection.contentLengthLong < 0 || connection.contentLengthLong == bytes.toLong()) { "文件大小与清单不符" }
        val digest = MessageDigest.getInstance("SHA-256"); var received = 0L
        connection.inputStream.use { input -> temporary.outputStream().use { output ->
          val buffer = ByteArray(32768)
          while (true) { val count = input.read(buffer); if (count < 0) break
            received += count; require(received <= bytes.toLong()) { "下载文件超出清单大小" }
            digest.update(buffer, 0, count); output.write(buffer, 0, count)
          }
        } }
        require(received == bytes.toLong() && digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) } == sha) { "文件完整性校验失败" }
        require(temporary.renameTo(target)) { "无法保存文件" }
        Uri.fromFile(target).toString()
      } finally { connection.disconnect(); temporary.delete() }
    }
  }
}
