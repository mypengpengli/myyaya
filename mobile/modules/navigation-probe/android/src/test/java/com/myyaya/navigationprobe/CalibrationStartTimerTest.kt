package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class CalibrationStartTimerTest {
  private class Rig {
    var now=0L
    val calls=ArrayList<Pair<Long,()->Unit>>()
    val shown=ArrayList<Int>()
    var moves=0
    val timer=CalibrationStartTimer({delay,work->val entry=now+delay to work;calls.add(entry);{calls.remove(entry);Unit}},{shown.add(it)},{moves++})
    fun advance(ms:Long) { val end=now+ms;while(true) {val next=calls.filter {it.first<=end}.minByOrNull {it.first} ?: break;calls.remove(next);now=next.first;next.second()};now=end }
  }
  @Test fun threeVisibleSignalsPrecedeOnlyOneGo() {
    val r=Rig();r.timer.start();r.advance(2999);assertEquals(listOf(3,2,1),r.shown);assertEquals(0,r.moves)
    r.advance(1);assertEquals(1,r.moves);r.advance(10000);assertEquals(1,r.moves)
  }
  @Test fun cancelPreventsMovementAndRemainingSignals() {
    val r=Rig();r.timer.start();r.advance(1000);r.timer.cancel();r.advance(10000)
    assertEquals(listOf(3,2),r.shown);assertEquals(0,r.moves)
  }
  @Test fun restartingCancelsOldCallbacks() {
    val r=Rig();r.timer.start();r.advance(1500);r.timer.start();r.advance(1500);assertEquals(0,r.moves)
    r.advance(1500);assertEquals(1,r.moves)
  }
}
