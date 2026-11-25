package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class HomeInspectionPlannerTest {
  private fun atlas(): HomeAtlas {
    var a=HomeAtlas("home","reference").remember("书房","书房","room",HomePose(0.0,0.0)).remember("厨房","厨房","room",HomePose(0.0,1.0))
    return a.teach(a.named("书房")!!.id,a.named("厨房")!!.id,List(11){HomePose(0.0,it/10.0)})
  }
  @Test fun photographKitchenThenReturnExactDepartureInsideCorridor() {
    val a=atlas();val start=HomePose(0.0,.3);val plan=HomeInspectionPlanner.plan(a,start,start,listOf(a.named("厨房")!!.id),.1)
    assertEquals(1,plan.stops.size);assertEquals(.7,plan.stops.first().arc,.001)
    assertEquals(1.4,plan.meters,.001);assertTrue(plan.points.last().distance(start)<.001)
  }
  @Test fun resumeSkipsPhotographedRoomAndReturnsOriginalStart() {
    val a=atlas();val p=HomeInspectionPlanner.plan(a,HomePose(0.0,1.0),HomePose(0.0,.3),emptyList(),.1)
    assertTrue(p.stops.isEmpty());assertEquals(.7,p.meters,.001);assertTrue(p.points.last().distance(HomePose(0.0,.3))<.001)
  }
  @Test fun alreadyAtObservationPointStillHasAStop() {
    val a=atlas();val p=HomeInspectionPlanner.plan(a,HomePose(0.0,0.0),HomePose(0.0,0.0),listOf(a.named("书房")!!.id),.1)
    assertEquals(1,p.stops.size);assertEquals(0.0,p.stops.first().arc,.001)
  }
  @Test fun mapsElsewhereDoNotMeanCurrentAreaWasMapped() {
    val a=atlas();assertTrue(HomeInspectionPlanner.hasLocalRoute(a,HomePose(0.0,.5)))
    assertFalse(HomeInspectionPlanner.hasLocalRoute(a,HomePose(2.0,2.0)))
  }
  @Test fun unknownRoomNeverGetsInventedConnection() {
    val a=atlas().remember("阳台","阳台","room",HomePose(2.0,2.0))
    assertThrows(IllegalStateException::class.java){HomeInspectionPlanner.plan(a,HomePose(0.0,0.0),HomePose(0.0,0.0),listOf(a.named("阳台")!!.id),.1)}
  }
  @Test fun keepoutIsAppliedToOutboundAndReturnPlanning() {
    val a=atlas().copy(zones=listOf(HomeZone(name="禁止",x=0.0,y=.5,radius=.1)))
    assertThrows(IllegalStateException::class.java){HomeInspectionPlanner.plan(a,HomePose(0.0,0.0),HomePose(0.0,0.0),listOf(a.named("厨房")!!.id),.1)}
  }
  @Test fun measuredGridCanConnectUntaughtRoomsWithoutSkippingStops() {
    val start=HomePose(0.0,0.0);val kitchen=HomePlace(id="k",name="厨房",room="厨房",kind="room",pose=HomePose(0.0,1.0))
    val atlas=HomeAtlas("grid-home","",places=listOf(kitchen))
    val calls=ArrayList<Pair<HomePose,HomePose>>()
    val plan=HomeInspectionPlanner.plan(atlas,start,start,listOf("k"),.1){a,b->calls.add(a to b);listOf(a,b)}
    assertEquals(2,calls.size);assertEquals(listOf("k"),plan.stops.map {it.id});assertEquals(start,plan.points.last())
    assertEquals(2.0,plan.meters,.001)
  }
  @Test fun moreThanSixRoomsAndFortyMetersPreserveEveryStop(){
    val places=(1..8).map {HomePlace(id="room-$it",name="房间$it",room="",kind="room",pose=HomePose(it*3.0,0.0))}
    val atlas=HomeAtlas("rooms","",places=places)
    val trip=HomeInspectionPlanner.plan(atlas,HomePose(0.0,0.0),HomePose(0.0,0.0),places.map {it.id},.1){a,b->listOf(a,b)}
    assertEquals(8,trip.stops.size);assertEquals(48.0,trip.meters,.001);assertEquals(HomePose(0.0,0.0),trip.points.last())
  }
  @Test fun fullPlaceCapacityDoesNotNeedAnExtraReturnNode(){
    var a=atlas()
    for(i in 0 until 126)a=a.remember("点$i","","point",HomePose(4.0+i*.001,4.0))
    val start=HomePose(0.0,.3)
    val trip=HomeInspectionPlanner.plan(a,start,start,listOf(a.named("厨房")!!.id),.1)
    assertEquals(128,a.places.size);assertTrue(trip.points.last().distance(start)<.001)
  }
}
