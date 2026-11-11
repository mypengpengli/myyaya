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
    AsyncFunction("showFloorLabels") { id: String,data: String,summary: String,promise: Promise ->
      val screen=routeScreen;val activity=appContext.currentActivity
      if(screen==null || activity==null) promise.reject("ERR_FLOOR_SCREEN","相机界面已关闭",null)
      else activity.runOnUiThread {
        runCatching { screen.showFloor(id,data,summary) }.onSuccess { promise.resolve(null) }
          .onFailure { promise.reject("ERR_FLOOR_SHOW",it.message,it) }
      }
    }
    AsyncFunction("diagnosticField") { direction: String,confirmed: Boolean,stepMs: Int,batchId: String,promise: Promise ->
      val screen=routeScreen;val activity=appContext.currentActivity
      if(screen==null || activity==null) promise.reject("ERR_FIELD_SCREEN","请打开教路线采集页面",null)
      else activity.runOnUiThread { screen.diagnosticField(direction,confirmed,stepMs,batchId,promise) }
    }
    AsyncFunction("beginDiagnosticBatch") { confirmed: Boolean,left: Double,top: Double,right: Double,bottom: Double,promise: Promise ->
      val screen=routeScreen;val activity=appContext.currentActivity
      if(screen==null || activity==null) promise.reject("ERR_FIELD_SCREEN","请打开教路线采集页面",null)
      else activity.runOnUiThread { runCatching {
        screen.beginDiagnosticBatch(confirmed,FloorFlowRegion(left.toFloat(),top.toFloat(),right.toFloat(),bottom.toFloat()),promise)
      }.onFailure { promise.reject("ERR_FIELD_REGION",it.message,it) } }
    }
    AsyncFunction("beginLocalMission") { confirmed: Boolean,left: Double,top: Double,right: Double,bottom: Double,promise: Promise ->
      val screen=routeScreen;val activity=appContext.currentActivity
      if(screen==null || activity==null) promise.reject("ERR_LOCAL_MISSION","请打开路线相机",null)
      else activity.runOnUiThread { runCatching { screen.beginLocalMission(confirmed,FloorFlowRegion(left.toFloat(),top.toFloat(),right.toFloat(),bottom.toFloat()),promise) }
        .onFailure { promise.reject("ERR_LOCAL_MISSION",it.message,it) } }
    }
    AsyncFunction("localMissionProgress") { value: String -> appContext.currentActivity?.runOnUiThread { routeScreen?.localMissionProgress(value) } }
    AsyncFunction("saveLocalMissionReport") { data: String ->
      require(data.length<=250_000);org.json.JSONObject(data)
      val context=requireNotNull(appContext.reactContext)
      val root=(context.getExternalFilesDir("navigation-probe") ?: File(context.filesDir,"navigation-probe")).apply { mkdirs() }
      val target=File(root,"local-goal-mission.json");val temporary=File(root,"local-goal-mission.tmp")
      temporary.writeText(data);check(temporary.renameTo(target)) { "无法保存本机任务记录" }
    }
    AsyncFunction("localMissionRegion") { token: String,left: Double,top: Double,right: Double,bottom: Double,promise: Promise ->
      val screen=routeScreen;val activity=appContext.currentActivity
      if(screen==null || activity==null) promise.reject("ERR_LOCAL_MISSION","路线页已关闭",null)
      else activity.runOnUiThread { runCatching { screen.localMissionRegion(token,FloorFlowRegion(left.toFloat(),top.toFloat(),right.toFloat(),bottom.toFloat())) }
        .onSuccess { promise.resolve(null) }.onFailure { promise.reject("ERR_LOCAL_MISSION",it.message,it) } }
    }
    AsyncFunction("stopOperatorObservation") { promise: Promise ->
      val activity=appContext.currentActivity
      if(activity==null) promise.resolve(null)
      else activity.runOnUiThread { routeScreen?.stopNavigation("视觉观察要求停车");promise.resolve(null) }
    }
    AsyncFunction("analyzeUprightReference") { id: String,height: Double,width: Double,promise: Promise ->
      val screen=routeScreen;val activity=appContext.currentActivity
      if(screen==null || activity==null) promise.reject("ERR_REFERENCE_SCREEN","请打开教路线相机并开始扫描",null)
      else activity.runOnUiThread { screen.analyzeUprightReference(id,height,width,promise) }
    }
    AsyncFunction("captureMonocularFrame") { promise: Promise ->
      val screen=routeScreen;val activity=appContext.currentActivity
      if(screen==null || activity==null) promise.reject("ERR_MONOCULAR_SCREEN","请打开教路线相机并开始扫描",null)
      else activity.runOnUiThread { screen.captureMonocular(promise) }
    }
    AsyncFunction("showMonocularFrame") { id: String,data: String,inferenceMs: Double,promise: Promise ->
      val screen=routeScreen;val activity=appContext.currentActivity
      if(screen==null || activity==null) promise.reject("ERR_MONOCULAR_SCREEN","相机界面已关闭",null)
      else activity.runOnUiThread {
        runCatching { screen.showMonocular(id,data,inferenceMs) }
          .onSuccess { promise.resolve(null) }.onFailure { promise.reject("ERR_MONOCULAR_SHOW",it.message,it) }
      }
    }
    AsyncFunction("exportMonocularBenchmark") {
      val context=requireNotNull(appContext.reactContext)
      val source=File(context.cacheDir,"monocular-benchmark")
      val destination=File(context.getExternalFilesDir("navigation-probe") ?: File(context.filesDir,"navigation-probe"),"monocular-outputs").apply { mkdirs() }
      val sizes=mapOf("can_before.depth" to 63504,"can_after.depth" to 63504,"turn_before.depth" to 63504,"turn_after.depth" to 63504,
        "live.depth" to 63504,"live.labels" to 63504,"live.rgb" to 196608)
      val copied=ArrayList<String>()
      for((name,size) in sizes) {
        val input=File(source,name)
        if(input.isFile && input.length()==size.toLong()) { input.copyTo(File(destination,name),true);copied.add(name) }
      }
      for(name in listOf("live.jpg","live.json","live.floor.json")) {
        val input=File(source,name)
        val limit=if(name.endsWith("jpg")) 2_000_000L else 8_000L
        if(input.isFile && input.length() in 1L..limit) {
          input.copyTo(File(destination,name),true);copied.add(name)
        }
      }
      mapOf("directory" to destination.absolutePath,"files" to copied)
    }
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
      val mount=context.getSharedPreferences("navigation-mount",0)
      val envelope=context.getSharedPreferences("terrain-envelope",0)
      val width=envelope.getFloat("width",0f);val length=envelope.getFloat("length",0f);val margin=envelope.getFloat("margin",.05f)
      val geometry=if(mount.getInt("schema",0)==1 && width in .1f..1f && length in .1f..1f && margin in .02f.. .3f)
        mapOf("centerRightMeters" to mount.getFloat("right",0f),"alongViewMeters" to mount.getFloat("alongView",0f),
          "widthMeters" to width,"lengthMeters" to length,"marginMeters" to margin,"source" to "user-measured-settings") else null
      mapOf(
        "available" to true,
        "availability" to availability.name,
        "serviceInstalled" to (service != null),
        "serviceVersion" to service?.versionName,
        "dataDirectory" to last.parentFile!!.absolutePath,
        "navigationGeometry" to geometry,
        "measuredCameraHeightMeters" to context.getSharedPreferences("terrain-camera",0).getFloat("height",0f),
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
