package com.myyaya.navigationprobe

import android.content.Intent
import android.app.Dialog
import android.Manifest
import android.content.pm.PackageManager
import android.view.WindowManager
import com.google.ar.core.ArCoreApk
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class NavigationProbeModule : Module() {
  private var pending: Promise? = null
  private var routeDialog: Dialog?=null
  private var routeScreen: NavigationProbeScreen?=null
  private var gateway: RouteMotorGateway?=null

  override fun definition() = ModuleDefinition {
    Name("NavigationProbe")
    Events("onRouteMotion")
    AsyncFunction("listTaughtRoutes") {
      val context=requireNotNull(appContext.reactContext)
      val routes: List<Map<String,Any>> = File(context.filesDir,"taught-routes").listFiles()?.filter { it.extension=="yayaroute" && it.length() in 32..64000 }
        ?.mapNotNull { file->runCatching { TaughtRouteCodec.decode(file.readBytes()).let {
          mapOf<String,Any>("id" to it.id,"name" to it.name,"mapId" to it.mapId,"requiresReference" to it.referenceKey.isNotEmpty(),"waypoints" to it.points.size)
        } }.getOrNull() } ?: emptyList()
      routes
    }
    AsyncFunction("stopTaughtRoute") { token: String ->
      if(gateway?.token==token) appContext.currentActivity?.runOnUiThread { routeScreen?.stopNavigation("语音停止");gateway?.stop("语音停止") }
    }

    AsyncFunction("openRoutes") { token: String, name: String, promise: Promise ->
      val activity=appContext.currentActivity
      if (activity==null) promise.reject("ERR_NAVIGATION_ACTIVITY","请在应用前台打开路线导航",null)
      else activity.runOnUiThread {
        if (pending!=null || routeDialog!=null) promise.reject("ERR_NAVIGATION_BUSY","地图或导航已经打开",null)
        else if (activity.checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)
          promise.reject("ERR_NAVIGATION_CAMERA","需要相机权限",null)
        else {
          pending=promise
          try {
            val dialog=Dialog(activity,android.R.style.Theme_Material_NoActionBar_Fullscreen)
            val motor=RouteMotorGateway(token) { event->sendEvent("onRouteMotion",event) }
            gateway=motor;routeDialog=dialog
            var result: String?=null
            val screen=NavigationProbeScreen(activity,Intent().putExtra("mapping",true).putExtra("routeName",name),
              {dialog.setContentView(it)},{report->result=report;dialog.dismiss()},motor)
            routeScreen=screen
            dialog.setOnDismissListener {
              motor.close();screen.onPause();screen.onDestroy()
              gateway=null;routeScreen=null;routeDialog=null;pending=null
              promise.resolve(result)
            }
            dialog.setOnCancelListener { screen.finish() }
            screen.onCreate(null);dialog.show()
            dialog.window?.setLayout(WindowManager.LayoutParams.MATCH_PARENT,WindowManager.LayoutParams.MATCH_PARENT)
            dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            screen.onResume()
          } catch (error: Exception) {
            gateway?.close();routeDialog?.dismiss();routeScreen=null;routeDialog=null;gateway=null;pending=null
            promise.reject("ERR_NAVIGATION_OPEN",error.message,error)
          }
        }
      }
    }
    AsyncFunction("routeRobotState") { token: String, connected: Boolean, voiceStop: Boolean -> if (gateway?.token==token) gateway?.state(connected,voiceStop) }
    AsyncFunction("acknowledgeRouteMotion") { token: String, sequence: Int, ok: Boolean, message: String ->
      if (gateway?.token==token) gateway?.acknowledge(sequence,ok,message)
    }
    OnActivityEntersBackground { appContext.currentActivity?.runOnUiThread { gateway?.setForeground(false);routeScreen?.onPause() } }
    OnActivityEntersForeground { appContext.currentActivity?.runOnUiThread { gateway?.setForeground(true);routeScreen?.onResume() } }

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
        "dataDirectory" to last.parentFile!!.absolutePath,
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

    AsyncFunction("openMap") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) promise.reject("ERR_NAVIGATION_ACTIVITY", "需要在应用前台打开房间地图", null)
      else activity.runOnUiThread {
        if (pending != null) promise.reject("ERR_NAVIGATION_BUSY", "房间地图或视觉探针已经打开", null)
        else {
          pending = promise
          try { activity.startActivityForResult(Intent(activity, NavigationProbeActivity::class.java).putExtra("mapping", true), REQUEST) }
          catch (error: Exception) { pending = null; promise.reject("ERR_NAVIGATION_OPEN", error.message, error) }
        }
      }
    }

    OnActivityResult { _, payload ->
      routeScreen?.onActivityResult(payload.requestCode,payload.resultCode,payload.data)
      if (payload.requestCode == REQUEST) {
        val promise = pending
        pending = null
        promise?.resolve(payload.data?.getStringExtra("report"))
      }
    }

    OnDestroy {
      gateway?.close();routeDialog?.dismiss()
      pending?.reject("ERR_NAVIGATION_DESTROYED", "应用会话已结束", null)
      pending = null
    }
  }

  companion object { private const val REQUEST = 28431 }
}
