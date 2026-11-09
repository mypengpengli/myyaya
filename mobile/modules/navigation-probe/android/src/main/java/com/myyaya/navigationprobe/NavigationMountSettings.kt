package com.myyaya.navigationprobe

import android.app.Activity
import android.app.AlertDialog
import android.widget.EditText
import android.widget.LinearLayout
import java.util.Locale

/** One measured horizontal camera-to-base transform, shared by every map UI.
 * Device measurements belong in local settings, never in app-wide defaults.
 */
internal class NavigationMountSettings(private val activity: Activity) {
  private val prefs=activity.getSharedPreferences("navigation-mount",0)
  @Volatile var value: RouteMount?=runCatching {
    if(prefs.getInt("schema",0)==1 && prefs.contains("right") && prefs.contains("alongView"))
      RouteMount(prefs.getFloat("right",0f),prefs.getFloat("alongView",0f)) else null
  }.getOrNull();private set
  @Volatile var revision=0;private set
  fun report(): Map<String,Any?> = mapOf("measured" to (value!=null),"rightMeters" to value?.right,
    "alongViewMeters" to value?.alongView,"source" to if(value!=null) "user-measured" else "unconfigured",
    "reference" to "camera-to-track-center-horizontal","positiveAxes" to listOf("rear-image-right","rear-camera-view-forward"),
    "revision" to revision,"pulseCalibrationValidated" to false)
  fun edit(onSaved: ()->Unit) {
    val current=value
    val box=LinearLayout(activity).apply { orientation=1 }
    fun field(hintText: String,v: Float?)=EditText(activity).apply {
      hint=hintText;inputType=12290;setSingleLine()
      if(v!=null) setText(String.format(Locale.US,"%.1f",v*100))
      box.addView(this)
    }
    val right=field("向后摄画面右侧（厘米，反向为负）",current?.right)
    val ahead=field("沿后摄看出去方向（厘米，反向为负）",current?.alongView)
    val dialog=AlertDialog.Builder(activity).setTitle("镜头到底座中心的水平偏移")
      .setMessage("保持测量时的最低脖子位置。填写从后摄主镜头到两履带中间中心的水平距离。保存后地图和路线共用；换手机位置或头部安装后重新测量。动作距离、转角和停车仍须另行标定。")
      .setView(box).setNegativeButton("取消",null).setPositiveButton("保存实测值",null).create()
    dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
      val mount=runCatching { RouteMount(right.text.toString().toFloat()/100,ahead.text.toString().toFloat()/100) }.getOrNull()
      if(mount==null) { right.error="请填写正负30厘米内的两个实测值";return@setOnClickListener }
      if(!prefs.edit().putInt("schema",1).putFloat("right",mount.right).putFloat("alongView",mount.alongView).commit()) {
        right.error="保存失败，请重试";return@setOnClickListener
      }
      value=mount;revision++;onSaved();dialog.dismiss()
    } }
    dialog.show()
  }
}
