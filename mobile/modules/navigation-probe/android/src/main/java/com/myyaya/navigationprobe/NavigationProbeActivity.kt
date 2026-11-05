package com.myyaya.navigationprobe

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/** Standalone diagnostics remain isolated from BLE. */
class NavigationProbeActivity : Activity() {
  private lateinit var screen: NavigationProbeScreen
  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    screen=NavigationProbeScreen(this,intent,{setContentView(it)},{report->
      setResult(RESULT_OK,Intent().putExtra("report",report));super.finish()
    })
    screen.onCreate(state)
  }
  override fun onResume() { super.onResume();screen.onResume() }
  override fun onPause() { screen.onPause();super.onPause() }
  override fun onDestroy() { screen.onDestroy();super.onDestroy() }
  override fun finish() { if (::screen.isInitialized) screen.finish() else super.finish() }
  override fun onSaveInstanceState(state: Bundle) { screen.onSaveInstanceState(state);super.onSaveInstanceState(state) }
  override fun onActivityResult(request: Int,result: Int,data: Intent?) { super.onActivityResult(request,result,data);screen.onActivityResult(request,result,data) }
  override fun onRequestPermissionsResult(request: Int,permissions: Array<out String>,grants: IntArray) {
    super.onRequestPermissionsResult(request,permissions,grants);screen.onRequestPermissionsResult(request,permissions,grants)
  }
}
