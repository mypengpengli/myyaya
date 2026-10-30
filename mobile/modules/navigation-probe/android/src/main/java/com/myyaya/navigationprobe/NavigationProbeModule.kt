package com.myyaya.navigationprobe

import android.content.Intent
import com.google.ar.core.ArCoreApk
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class NavigationProbeModule : Module() {
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("NavigationProbe")

    AsyncFunction("getStatus") {
      val context = requireNotNull(appContext.reactContext)
      val service = runCatching { context.packageManager.getPackageInfo("com.google.ar.core", 0) }.getOrNull()
      val availability = ArCoreApk.getInstance().checkAvailability(context)
      val last = File(context.getExternalFilesDir("navigation-probe") ?: context.filesDir, "latest.json")
      mapOf(
        "available" to true,
        "availability" to availability.name,
        "serviceInstalled" to (service != null),
        "serviceVersion" to service?.versionName,
        "lastReport" to last.takeIf { it.isFile && it.length() <= 32_000 }?.readText()
      )
    }

    AsyncFunction("open") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_NAVIGATION_ACTIVITY", "需要在应用前台打开视觉探针", null)
      } else {
        activity.runOnUiThread {
          if (pending != null) {
            promise.reject("ERR_NAVIGATION_BUSY", "视觉探针已经打开", null)
          } else {
            pending = promise
            try {
              activity.startActivityForResult(Intent(activity, NavigationProbeActivity::class.java), REQUEST)
            } catch (error: Exception) {
              pending = null
              promise.reject("ERR_NAVIGATION_OPEN", error.message, error)
            }
          }
        }
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == REQUEST) {
        val promise = pending
        pending = null
        promise?.resolve(payload.data?.getStringExtra("report"))
      }
    }

    OnDestroy {
      pending?.reject("ERR_NAVIGATION_DESTROYED", "应用会话已结束", null)
      pending = null
    }
  }

  companion object { private const val REQUEST = 28431 }
}
