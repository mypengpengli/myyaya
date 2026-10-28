package com.myyaya.integration

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import org.json.JSONObject

/** ADB shell has DUMP; ordinary applications cannot invoke this receiver. No user-facing chat UI. */
class IntegrationReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != "io.github.mypengpengli.myyaya.INTEGRATION_COMMAND") return
    try {
      val encoded = intent.getStringExtra("payload") ?: return
      require(encoded.length <= 20000)
      val command = String(Base64.decode(encoded, Base64.DEFAULT), Charsets.UTF_8)
      val data = JSONObject(command)
      require(Regex("[A-Za-z0-9_-]{1,80}").matches(data.getString("id")))
      require(data.getString("kind") in listOf("chat", "tool", "status", "probe"))
      context.getSharedPreferences("myyaya-adb-integration", Context.MODE_PRIVATE).edit().putString("pending", command).commit()
      resultCode = 0
    } catch (_: Exception) { resultCode = 1 }
  }
}

class IntegrationControlModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("IntegrationControl")
    Function("takeCommand") {
      val preferences = requireNotNull(appContext.reactContext).getSharedPreferences("myyaya-adb-integration", Context.MODE_PRIVATE)
      val value = preferences.getString("pending", null)
      if (value != null) preferences.edit().remove("pending").commit()
      value
    }
    Function("reportResult") { value: String ->
      require(value.length <= 24000)
      val directory = requireNotNull(appContext.reactContext).getExternalFilesDir(null)
      File(requireNotNull(directory), "myyaya-integration-result.json").writeText(value)
      val id = JSONObject(value).getString("id")
      require(Regex("[A-Za-z0-9_-]{1,80}").matches(id))
      File(directory, "myyaya-integration-$id.json").writeText(value)
      directory.listFiles()?.filter { it.name.startsWith("myyaya-integration-") && it.name != "myyaya-integration-result.json" }?.sortedByDescending { it.lastModified() }?.drop(32)?.forEach { it.delete() }
    }
  }
}
