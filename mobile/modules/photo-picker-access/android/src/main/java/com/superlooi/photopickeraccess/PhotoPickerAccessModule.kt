package com.superlooi.photopickeraccess

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.exifinterface.media.ExifInterface
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import kotlin.math.max

class PhotoPickerAccessModule : Module() {
  private var pendingPickerPromise: Promise? = null
  private val selectedUris = LinkedHashSet<String>()
  private val persistedUris = LinkedHashSet<String>()
  private var activePickerContract: ActivityResultContracts.PickMultipleVisualMedia? = null

  override fun definition() = ModuleDefinition {
    Name("PhotoPickerAccess")

    AsyncFunction("selectPhotos") { maxItems: Int, promise: Promise ->
      if (pendingPickerPromise != null) {
        promise.reject("ERR_PHOTO_PICKER_BUSY", "Another photo picker is already active", null)
        return@AsyncFunction
      }
      if (maxItems !in 2..MAX_SELECTABLE_PHOTOS) {
        promise.reject(
          "ERR_PHOTO_PICKER_LIMIT",
          "Photo picker maxItems must be between 2 and $MAX_SELECTABLE_PHOTOS",
          null
        )
        return@AsyncFunction
      }
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_PHOTO_PICKER_ACTIVITY", "Photo selection requires an active Android activity", null)
        return@AsyncFunction
      }

      val contract = ActivityResultContracts.PickMultipleVisualMedia(maxItems)
      val request = PickVisualMediaRequest.Builder()
        .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly)
        .setMaxItems(maxItems)
        .setOrderedSelection(true)
        .build()
      val intent = contract.createIntent(activity, request)

      clearSelectionState()
      pendingPickerPromise = promise
      activePickerContract = contract
      try {
        activity.startActivityForResult(intent, PHOTO_PICKER_REQUEST_CODE)
      } catch (error: Exception) {
        pendingPickerPromise = null
        activePickerContract = null
        promise.reject("ERR_PHOTO_PICKER_LAUNCH", error.message, error)
      }
    }

    AsyncFunction("readSelectedPhotoForRealtime") Coroutine { uriValue: String ->
      readSelectedPhotoForRealtime(uriValue)
    }

    AsyncFunction("clearSelection") Coroutine ::clearSelectionState

    OnActivityResult { activity, payload ->
      if (payload.requestCode != PHOTO_PICKER_REQUEST_CODE) return@OnActivityResult
      val promise = pendingPickerPromise ?: return@OnActivityResult
      val contract = activePickerContract
      pendingPickerPromise = null
      activePickerContract = null

      if (contract == null) {
        selectedUris.clear()
        promise.reject("ERR_PHOTO_PICKER_STATE", "Photo picker result arrived without an active contract", null)
        return@OnActivityResult
      }

      try {
        val uris = contract.parseResult(payload.resultCode, payload.data)
        selectedUris.clear()
        if (payload.resultCode != Activity.RESULT_OK || uris.isEmpty()) {
          promise.resolve(emptyList<Map<String, Any?>>())
          return@OnActivityResult
        }
        val bounded = uris.take(MAX_SELECTABLE_PHOTOS)
        bounded.forEach { selectedUris.add(it.toString()) }
        val persistedByUri = bounded.associateWith { uri -> persistReadGrant(activity, uri) }
        promise.resolve(bounded.map { uri -> inspectSelectedUri(activity, uri, persistedByUri[uri] == true) })
      } catch (error: Exception) {
        clearSelectionState()
        promise.reject("ERR_PHOTO_PICKER_RESULT", error.message, error)
      }
    }

    OnActivityDestroys {
      pendingPickerPromise?.reject(
        "ERR_PHOTO_PICKER_ACTIVITY_DESTROYED",
        "Android activity was destroyed while selecting photos",
        null
      )
      pendingPickerPromise = null
      activePickerContract = null
      clearSelectionState()
    }
  }

  private fun clearSelectionState() {
    val resolver = appContext.reactContext?.contentResolver ?: appContext.currentActivity?.contentResolver
    if (resolver != null) {
      persistedUris.toList().forEach { uriValue ->
        try {
          resolver.releasePersistableUriPermission(
            Uri.parse(uriValue),
            Intent.FLAG_GRANT_READ_URI_PERMISSION
          )
        } catch (_: Exception) {
          // The grant may already have been revoked by Android/provider teardown.
        }
      }
    }
    persistedUris.clear()
    selectedUris.clear()
  }

  private fun persistReadGrant(activity: Activity, uri: Uri): Boolean {
    return try {
      activity.contentResolver.takePersistableUriPermission(
        uri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION
      )
      persistedUris.add(uri.toString())
      true
    } catch (_: SecurityException) {
      // Some picker/provider implementations expose only a temporary scoped
      // grant. The JS side reads those selections immediately after return.
      false
    } catch (_: UnsupportedOperationException) {
      false
    } catch (_: IllegalArgumentException) {
      false
    }
  }

  private fun inspectSelectedUri(activity: Activity, uri: Uri, persistedGrant: Boolean): Map<String, Any?> {
    val resolver = activity.contentResolver
    val mimeType = resolver.getType(uri)?.takeIf { it.startsWith("image/") } ?: "image/*"
    var sizeBytes: Long? = null
    try {
      resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val index = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (index >= 0 && !cursor.isNull(index)) sizeBytes = cursor.getLong(index)
        }
      }
    } catch (_: Exception) {
      // Size is diagnostic/UI metadata only; read access is validated later.
    }
    return mapOf(
      "uri" to uri.toString(),
      "mimeType" to mimeType,
      "sizeBytes" to sizeBytes?.toDouble(),
      "persistedGrant" to persistedGrant
    )
  }

  private fun readSelectedPhotoForRealtime(uriValue: String): Map<String, Any?> {
    val uriString = uriValue.trim()
    require(uriString.startsWith("content://")) { "A valid selected content URI is required" }
    if (!selectedUris.contains(uriString)) {
      throw SecurityException("My LOOI can read only photos selected in the current Photo Picker session")
    }

    val resolver = appContext.reactContext?.contentResolver
      ?: throw IllegalStateException("Android ContentResolver is unavailable")
    val uri = Uri.parse(uriString)
    val originalMimeType = resolver.getType(uri)?.takeIf { it.startsWith("image/") } ?: "image/*"

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    decodeBounds(resolver, uri, bounds)
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Selected item is not a decodable image" }

    var sampleSize = 1
    while (
      (bounds.outWidth.toLong() / sampleSize) * (bounds.outHeight.toLong() / sampleSize) > MAX_DECODE_PIXELS ||
      max(bounds.outWidth / sampleSize, bounds.outHeight / sampleSize) > MAX_IMAGE_EDGE
    ) {
      sampleSize *= 2
    }

    val decodeOptions = BitmapFactory.Options().apply {
      inSampleSize = sampleSize
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val decoded = decodeBitmap(resolver, uri, decodeOptions)
      ?: throw IllegalStateException("Selected photo could not be decoded")

    val orientation = readExifOrientation(resolver, uri)

    var prepared = applyExifOrientation(decoded, orientation)
    if (prepared !== decoded) decoded.recycle()

    if (max(prepared.width, prepared.height) > MAX_IMAGE_EDGE ||
      prepared.width.toLong() * prepared.height.toLong() > MAX_OUTPUT_PIXELS
    ) {
      val scale = minOf(
        MAX_IMAGE_EDGE.toDouble() / max(prepared.width, prepared.height).toDouble(),
        kotlin.math.sqrt(MAX_OUTPUT_PIXELS.toDouble() / (prepared.width.toDouble() * prepared.height.toDouble()))
      ).coerceAtMost(1.0)
      val targetWidth = max(1, (prepared.width * scale).toInt())
      val targetHeight = max(1, (prepared.height * scale).toInt())
      val scaled = Bitmap.createScaledBitmap(prepared, targetWidth, targetHeight, true)
      if (scaled !== prepared) {
        prepared.recycle()
        prepared = scaled
      }
    }

    if (prepared.hasAlpha()) {
      val opaque = Bitmap.createBitmap(prepared.width, prepared.height, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(opaque)
      canvas.drawColor(Color.WHITE)
      canvas.drawBitmap(prepared, 0f, 0f, null)
      prepared.recycle()
      prepared = opaque
    }

    val encoded = encodeBoundedJpeg(prepared)
    val width = prepared.width
    val height = prepared.height
    prepared.recycle()

    return mapOf(
      "uri" to uriString,
      "mimeType" to "image/jpeg",
      "base64" to Base64.encodeToString(encoded, Base64.NO_WRAP),
      "width" to width,
      "height" to height,
      "encodedBytes" to encoded.size,
      "originalMimeType" to originalMimeType
    )
  }

  private fun decodeBounds(
    resolver: android.content.ContentResolver,
    uri: Uri,
    options: BitmapFactory.Options
  ) {
    var decoded = false
    try {
      resolver.openFileDescriptor(uri, "r")?.use { descriptor ->
        BitmapFactory.decodeFileDescriptor(descriptor.fileDescriptor, null, options)
        decoded = true
      }
    } catch (_: Exception) {
      // Fall through to stream mode for providers that do not expose an FD.
    }
    if (decoded) return
    resolver.openInputStream(uri)?.use { input ->
      BitmapFactory.decodeStream(input, null, options)
      decoded = true
    }
    if (!decoded) throw IllegalStateException("Selected photo could not be opened")
  }

  private fun decodeBitmap(
    resolver: android.content.ContentResolver,
    uri: Uri,
    options: BitmapFactory.Options
  ): Bitmap? {
    try {
      resolver.openFileDescriptor(uri, "r")?.use { descriptor ->
        BitmapFactory.decodeFileDescriptor(descriptor.fileDescriptor, null, options)?.let { return it }
      }
    } catch (_: Exception) {
      // Fall through to stream mode for providers that do not expose an FD.
    }
    return resolver.openInputStream(uri)?.use { input ->
      BitmapFactory.decodeStream(input, null, options)
    }
  }

  private fun readExifOrientation(resolver: android.content.ContentResolver, uri: Uri): Int {
    try {
      resolver.openFileDescriptor(uri, "r")?.use { descriptor ->
        return ExifInterface(descriptor.fileDescriptor).getAttributeInt(
          ExifInterface.TAG_ORIENTATION,
          ExifInterface.ORIENTATION_NORMAL
        )
      }
    } catch (_: Exception) {
      // Fall through to stream mode.
    }
    return try {
      resolver.openInputStream(uri)?.use { input ->
        ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      } ?: ExifInterface.ORIENTATION_NORMAL
    } catch (_: Exception) {
      ExifInterface.ORIENTATION_NORMAL
    }
  }

  private fun applyExifOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.setRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.setRotate(-90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
      else -> return bitmap
    }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
  }

  private fun encodeBoundedJpeg(bitmap: Bitmap): ByteArray {
    for (quality in intArrayOf(95, 92, 88, 84)) {
      val output = ByteArrayOutputStream()
      if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
        throw IllegalStateException("Selected photo could not be encoded for Realtime")
      }
      val bytes = output.toByteArray()
      if (bytes.size <= MAX_ENCODED_BYTES) return bytes
      if (quality == 84) break
    }
    throw IllegalStateException("Selected photo could not be encoded within the supported size")
  }

  companion object {
    private const val PHOTO_PICKER_REQUEST_CODE = 6407
    private const val MAX_SELECTABLE_PHOTOS = 4
    private const val MAX_IMAGE_EDGE = 4096
    private const val MAX_DECODE_PIXELS = 12_000_000L
    private const val MAX_OUTPUT_PIXELS = 10_000_000L
    private const val MAX_ENCODED_BYTES = 9 * 1024 * 1024
  }
}
