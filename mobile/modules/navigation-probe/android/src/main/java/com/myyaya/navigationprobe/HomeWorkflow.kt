package com.myyaya.navigationprobe

/** Pending setup commands are intents, not permissions that survive a stop or map change. */
internal class HomeCommandInbox<T: Any> {
  var pending: T?=null;private set
  fun queue(value: T){pending=value}
  fun clear(){pending=null}
  fun completed(value: T){if(pending===value)pending=null}
}

internal object HomeWorkflow {
  private val movingPhases=setOf("RUNNING","PREPARING")
  fun requireTeaching(phase: String,teaching: Boolean) {
    check(phase !in movingPhases){"请先暂停导航，再开始带领"}
    check(!teaching){"已在带领中，请先结束当前路段"}
  }
  fun requireNavigation(phase: String,teaching: Boolean) {
    check(!teaching){"请先结束带领，再启动导航"}
    check(phase !in movingPhases){"已有导航任务，请先暂停或取消"}
  }
}
