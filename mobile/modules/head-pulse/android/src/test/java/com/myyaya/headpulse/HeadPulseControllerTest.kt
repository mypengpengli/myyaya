package com.myyaya.headpulse

import org.junit.Assert.*
import org.junit.Test

class HeadPulseControllerTest {
  private class Rig {
    var now=0L
    data class Task(val at:Long,val run:()->Unit,var cancelled:Boolean=false)
    val tasks=mutableListOf<Task>()
    val frames=mutableListOf<List<Int>>()
    val acks=mutableListOf<(Boolean)->Unit>()
    var result:Map<String,Any?>?=null
    val controller=HeadPulseController({now},{delay,work ->
      val task=Task(now+delay,work);tasks.add(task);{task.cancelled=true}
    },{bytes,ack -> frames.add(bytes.map { it.toInt() and 255 });acks.add(ack)})
    fun advance(ms:Long) {
      val end=now+ms
      while(true) {
        val task=tasks.filter { !it.cancelled && it.at<=end }.minByOrNull { it.at } ?: break
        task.cancelled=true;now=task.at;task.run()
      }
      now=end
    }
    fun start(speed:Int=40,ms:Int=350) {controller.start(speed,ms) {result=it}}
  }
  @Test fun nativeDeadlineSendsHeadZeroWithoutJsOrStartAck() {
    val r=Rig();r.start();assertEquals(listOf(0,40),r.frames[0]);r.advance(350)
    assertEquals(listOf(0,0),r.frames[1]);assertNull(r.result)
    r.acks[1](true);assertEquals(true,r.result!!["stopAcknowledged"])
    assertEquals(false,r.result!!["startAcknowledged"])
    r.acks[0](true);assertEquals(2,r.frames.size)
  }
  @Test fun successfulPulseReportsBothAcksAndUnknownPosition() {
    val r=Rig();r.start();r.acks[0](true);r.advance(350);r.acks[1](true)
    assertEquals(true,r.result!!["startAcknowledged"]);assertEquals("unknown",r.result!!["physicalPosition"])
    assertTrue(r.controller.canStart());r.advance(5000);assertEquals(2,r.frames.size)
  }
  @Test fun backgroundOrExplicitStopInterruptsBeforeDuration() {
    val r=Rig();r.start();r.acks[0](true);r.advance(50);r.controller.stop("background")
    assertEquals(listOf(0,0),r.frames.last());r.acks[1](true)
    assertEquals("background",r.result!!["reason"]);r.advance(5000);assertEquals(2,r.frames.size)
  }
  @Test fun failedStopLatchesUntilRecoveryIsAcknowledged() {
    val r=Rig();r.start();r.acks[0](true);r.advance(350);r.acks[1](false)
    assertFalse(r.controller.canStart());assertEquals("stop-write-failed",r.result!!["reason"])
    try {r.start();fail("must reject")} catch(_:IllegalStateException) {}
    r.controller.stop("manual-recovery");r.acks[2](true);assertTrue(r.controller.canStart())
  }
  @Test fun missingAckTimesOutWithoutRetryingMotion() {
    val r=Rig();r.start();r.advance(1850)
    assertEquals("stop-unconfirmed",r.result!!["reason"]);assertFalse(r.controller.canStart());assertEquals(2,r.frames.size)
  }
  @Test fun badArgumentsAndOverlappingPulsesNeverSendExtraMotion() {
    val r=Rig()
    for((speed,ms) in listOf(0 to 350,127 to 350,40 to 501,40 to 99)) {
      try {r.start(speed,ms);fail("must reject")} catch(_:IllegalArgumentException) {}
    }
    assertTrue(r.frames.isEmpty());r.start()
    try {r.start();fail("must reject")} catch(_:IllegalStateException) {}
    assertEquals(1,r.frames.size)
  }
  @Test fun failedStartStillSendsStopAndCompletesOnlyAfterStopAck() {
    val r=Rig();r.start();r.acks[0](false);assertEquals(listOf(0,0),r.frames.last());assertNull(r.result)
    r.acks[1](true);assertEquals("start-write-failed",r.result!!["reason"])
  }
}
