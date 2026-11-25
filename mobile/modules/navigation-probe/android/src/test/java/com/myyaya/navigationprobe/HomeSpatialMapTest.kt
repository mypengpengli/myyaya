package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class HomeSpatialMapTest {
  private fun floor(map: HomeSpatialMap,x1: Int,y1: Int,x2: Int,y2: Int){for(x in x1..x2)for(y in y1..y2)map.cells[HomeSpatialMap.Cell(x,y)]=1}
  @Test fun unknownIsNeverAConnection(){val m=HomeSpatialMap();floor(m,0,0,10,10);floor(m,15,0,25,10)
    assertThrows(IllegalStateException::class.java){m.route(HomePose(.25,.25),HomePose(1.0,.25),.075,emptyList(),0)}}
  @Test fun smallGapCannotFitBody(){val m=HomeSpatialMap();floor(m,0,0,30,20);for(y in 0..20)if(y!=10)m.cells[HomeSpatialMap.Cell(15,y)]=2
    assertThrows(IllegalStateException::class.java){m.route(HomePose(.25,.5),HomePose(1.25,.5),.095,emptyList(),0)}}
  @Test fun blockedPassageChoosesOtherSideThenExpires(){val m=HomeSpatialMap();floor(m,0,0,40,30)
    val start=HomePose(.25,.75);val end=HomePose(1.75,.75);m.block(HomePose(1.0,.75),.25,0)
    val detour=m.route(start,end,.075,emptyList(),1);assertTrue(detour.any {kotlin.math.abs(it.y-.75)>.3})
    val restored=m.route(start,end,.075,emptyList(),120_001);assertTrue(restored.all {kotlin.math.abs(it.y-.75)<.06})}
  @Test fun destinationDoesNotSnapThroughWall(){val m=HomeSpatialMap();floor(m,0,0,20,20);for(y in 0..20)m.cells[HomeSpatialMap.Cell(10,y)]=2
    assertThrows(IllegalStateException::class.java){m.route(HomePose(.25,.5),HomePose(.55,.5),.075,emptyList(),0)}}
  @Test fun zonesRemainExcluded(){val m=HomeSpatialMap();floor(m,0,0,40,30);val zone=HomeZone(name="禁行",x=1.0,y=.75,radius=.25)
    assertTrue(m.route(HomePose(.25,.75),HomePose(1.75,.75),.075,listOf(zone),0).all {it.distance(HomePose(1.0,.75))>.325})}
  @Test fun frontiersStayOnKnownGroundAndRespectVisited(){val m=HomeSpatialMap();floor(m,0,0,25,25)
    val path=m.frontier(HomePose(.6,.6),.075,emptyList(),0,emptyList());assertNotNull(path)
    assertTrue(path!!.all {m.cells[HomeSpatialMap.cell(it)]==1})
    assertNull(m.frontier(HomePose(.6,.6),.075,emptyList(),0,m.cells.keys.map {it.pose()}))}
  @Test fun splitMergeAndUndoPreserveCoverage(){val m=HomeSpatialMap();floor(m,0,0,30,30);m.segment();assertEquals(1,m.regions.size)
    val all=m.regions.first().cells;m.split(m.regions.first().id,HomePose(.75,0.0),HomePose(.75,2.0));assertEquals(2,m.regions.size)
    assertEquals(all,m.regions.flatMap {it.cells}.toSet());m.merge(m.regions.map {it.id}.toSet());assertEquals(1,m.regions.size)
    m.undo();assertEquals(2,m.regions.size);m.undo();assertEquals(all,m.regions.single().cells)}
  @Test fun doorwaySeparatesRoomCores(){val m=HomeSpatialMap();floor(m,0,0,39,39);floor(m,50,0,89,39);floor(m,40,14,49,25)
    m.segment();assertEquals(2,m.regions.size);assertEquals(m.cells.size,m.regions.sumOf {it.cells.size})}
  @Test fun laterObservationClearsMovedObstacleButUnknownDoesNot(){val m=HomeSpatialMap();m.observe(listOf(Triple(.1,.1,2)));m.observe(listOf(Triple(.1,.1,4)));assertEquals(2,m.cells[HomeSpatialMap.cell(HomePose(.1,.1))]);m.observe(listOf(Triple(.1,.1,1)));assertEquals(1,m.cells[HomeSpatialMap.cell(HomePose(.1,.1))])}
  @Test fun invalidCoordinatesAndHugeBatchesRejected(){val m=HomeSpatialMap();assertThrows(IllegalArgumentException::class.java){m.observe(listOf(Triple(Double.NaN,0.0,1)))};assertThrows(IllegalArgumentException::class.java){m.observe(List(8001){Triple(0.0,0.0,1)})}}
}
