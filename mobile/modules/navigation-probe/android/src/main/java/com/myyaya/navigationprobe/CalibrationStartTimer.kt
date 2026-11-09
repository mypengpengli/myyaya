package com.myyaya.navigationprobe

/** Native UI supplies the scheduler. Cancellation invalidates all delayed callbacks. */
internal class CalibrationStartTimer(private val schedule: (Long,()->Unit)->(()->Unit),
  private val show: (Int)->Unit,private val go: ()->Unit) {
  private var generation=0
  private val cancelTasks=ArrayList<()->Unit>()
  fun start() {
    cancel();val token=generation
    for(i in 0..2) cancelTasks.add(schedule(i*1000L) { if(token==generation) show(3-i) })
    cancelTasks.add(schedule(3000) { if(token==generation) { cancel();go() } })
  }
  fun cancel() { generation++;cancelTasks.forEach { it() };cancelTasks.clear() }
}
