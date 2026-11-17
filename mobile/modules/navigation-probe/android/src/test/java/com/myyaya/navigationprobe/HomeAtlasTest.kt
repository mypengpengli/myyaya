package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class HomeAtlasTest {
  private fun line(a: HomePose,b: HomePose)=List(11){i->val t=i/10.0;HomePose(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t)}
  private fun rig(): HomeAtlas {
    var a=HomeAtlas("house","reference").remember("书房","书房","room",HomePose(0.0,0.0))
      .remember("门口","","door",HomePose(0.0,1.0)).remember("客厅","客厅","room",HomePose(1.0,1.0))
    a=a.teach(a.named("书房")!!.id,a.named("门口")!!.id,line(HomePose(0.0,0.0),HomePose(0.0,1.0)))
    return a.teach(a.named("门口")!!.id,a.named("客厅")!!.id,line(HomePose(0.0,1.0),HomePose(1.0,1.0)))
  }
  @Test fun connectsRoomsThroughTaughtDoorAndCanReturn() {
    val a=rig();val p=HomeRoutePlanner.plan(a,HomePose(0.0,0.0),"客厅",.1)
    assertEquals(2,p.links.size);assertEquals(2.0,p.meters,.001);assertTrue(p.points.any {it.x==0.0 && it.y==1.0})
    assertEquals(2.0,HomeRoutePlanner.plan(a,HomePose(1.0,1.0),"书房",.1).meters,.001)
  }
  @Test fun resumesFromInsideKnownCorridor() {assertEquals(1.5,HomeRoutePlanner.plan(rig(),HomePose(0.0,.5),"客厅",.1).meters,.001)}
  @Test fun unknownStartingPositionDoesNotInventConnection() {assertThrows(IllegalStateException::class.java){HomeRoutePlanner.plan(rig(),HomePose(3.0,3.0),"客厅",.1)}}
  @Test fun disconnectedRoomHasNoSyntheticEdge() {
    val a=rig().remember("厨房","厨房","room",HomePose(3.0,3.0))
    assertThrows(IllegalStateException::class.java){HomeRoutePlanner.plan(a,HomePose(0.0,0.0),"厨房",.1)}
  }
  @Test fun disabledCorridorCannotBeUsed() {
    val a=rig();val blocked=a.copy(links=a.links.mapIndexed {i,e->if(i==0)e.copy(enabled=false) else e})
    assertThrows(IllegalStateException::class.java){HomeRoutePlanner.plan(blocked,HomePose(0.0,0.0),"客厅",.1)}
  }
  @Test fun keepoutBlocksEntireRobotFootprint() {
    val a=rig().copy(zones=listOf(HomeZone(name="电线区",x=.18,y=.5,radius=.1)))
    assertThrows(IllegalStateException::class.java){HomeRoutePlanner.plan(a,HomePose(0.0,0.0),"客厅",.1)}
  }
  @Test fun renamePreservesGeometryAndUpdatesRoomLabels() {
    val a=rig();val renamed=a.rename("客厅","大厅")
    assertEquals(a.links,renamed.links);assertEquals("大厅",renamed.named("大厅")!!.room)
  }
  @Test fun moveDeletesOldTaughtConnections() {
    val a=rig().remember("门口","","door",HomePose(0.0,1.4));assertTrue(a.links.isEmpty())
  }
  @Test fun deleteRemovesIncidentEdges() {val a=rig();assertTrue(a.remove(a.named("门口")!!.id).links.isEmpty())}
  @Test fun codecSurvivesRestartAndRejectsCorruption() {
    val a=rig();val b=HomeAtlasCodec.encode(a);assertEquals(a,HomeAtlasCodec.decode(b));b[b.size/2]=(b[b.size/2].toInt() xor 1).toByte()
    assertThrows(IllegalArgumentException::class.java){HomeAtlasCodec.decode(b)}
  }
}
