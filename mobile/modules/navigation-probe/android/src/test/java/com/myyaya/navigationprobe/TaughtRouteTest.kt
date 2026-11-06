package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class TaughtRouteTest {
  private fun route()=TaughtRoute(name="客厅",mapId="map",sessionId="session",referenceKey="",mount=RouteMount(),
    points=listOf(RoutePose(0f,0f,0f),RoutePose(0f,-.1f,0f),RoutePose(0f,-.2f,0f),RoutePose(0f,-.3f,0f),
      RoutePose(.1f,-.3f,PI.toFloat()/2),RoutePose(.2f,-.3f,PI.toFloat()/2),RoutePose(.3f,-.3f,PI.toFloat()/2)),pitch=0f)
  private fun o(p: RoutePose?=RoutePose(0f,0f,0f),at: Long=1000,clear: RouteClearance=RouteClearance.CLEAR)=
    RouteObservation(p,at,p!=null,true,clear,true,true)
  @Test fun simulatedReverseRouteTurnsAndCompletesWithFinalTurn() {
    val f=RouteFollower(route());var p=RoutePose(0f,0f,0f);var now=1000L;f.start(o(p,now));var steps=0
    while(f.phase in listOf("FOLLOWING","FACING_USER") && steps++<500) {
      val d=f.step(o(p,now),now)
      d.pulse?.let {
        val dt=it.durationMs/1000f
        p=when(it.direction) {
          "back"->p.copy(x=p.x+sin(p.yaw)*.15f*dt,z=p.z-cos(p.yaw)*.15f*dt)
          "left"->p.copy(yaw=wrapYaw(p.yaw-2f*dt))
          else->p.copy(yaw=wrapYaw(p.yaw+2f*dt))
        }
      }
      now+=200
    }
    assertEquals("COMPLETED",f.phase);assertTrue(p.distance(route().points.last())<=.08f)
    assertTrue(abs(wrapYaw(p.yaw+PI.toFloat()/2))<.13f)
  }
  @Test fun wrongStartAndDirectionAreRejected() {
    assertThrows(IllegalArgumentException::class.java) { RouteFollower(route()).start(o(RoutePose(1f,0f,0f))) }
    assertThrows(IllegalArgumentException::class.java) { RouteFollower(route()).start(o(RoutePose(0f,0f,PI.toFloat()))) }
  }
  @Test fun obstacleStopsAndExplicitResumePreservesProgress() {
    val f=RouteFollower(route());f.start(o());f.step(o(RoutePose(0f,-.08f,0f),1200),1200)
    val next=f.waypoint
    assertTrue(f.step(o(RoutePose(0f,-.08f,0f),1400,RouteClearance.OBSTACLE),1400).stop)
    assertEquals("PAUSED",f.phase);assertNull(f.step(o(at=1500),1500).pulse)
    f.resume(o(RoutePose(0f,-.08f,0f),1600));assertEquals(next,f.waypoint)
    assertNotNull(f.step(o(RoutePose(0f,-.08f,0f),1800),1800).pulse)
  }
  @Test fun staleDepthWaitsWithoutDrivingAndDoesNotLoseWaypoint() {
    val f=RouteFollower(route());f.start(o());val d=f.step(o(at=1200,clear=RouteClearance.DEPTH_UNKNOWN),1200)
    assertTrue(d.stop);assertNull(d.pulse);assertEquals("FOLLOWING",f.phase)
  }
  @Test fun trackingHeadConnectionAndPlaybackLossStop() {
    for (bad in listOf(o().copy(tracking=false),o().copy(headFixed=false),o().copy(connected=false),o().copy(playback=true),o().copy(actualFloor=false))) {
      val f=RouteFollower(route());f.start(o());assertTrue(f.step(bad.copy(atMs=1200),1200).stop);assertEquals("PAUSED",f.phase)
    }
  }
  @Test fun jumpAndOffRouteCannotTriggerBlindCorrection() {
    val f=RouteFollower(route());f.start(o());assertTrue(f.step(o(RoutePose(.3f,0f,0f),1200),1200).stop)
    val g=RouteFollower(route());g.start(o());assertTrue(g.step(o(RoutePose(.17f,0f,0f),1200),1200).stop)
  }
  @Test fun cancelCannotProduceLaterPulse() {
    val f=RouteFollower(route());f.start(o());f.cancel();assertNull(f.step(o(at=1200),1200).pulse)
  }
  @Test fun teachingDoesNotConnectAcrossTrackingLoss() {
    val t=RouteTeacher(RouteMount());t.observe(RoutePose(0f,0f,0f),true);t.observe(null,false);t.observe(RoutePose(0f,-.2f,0f),true)
    assertThrows(IllegalStateException::class.java) { t.finish("客厅","map","session","") }
  }
  @Test fun codecRoundTripAndCorruptionChecks() {
    val r=route();val b=TaughtRouteCodec.encode(r);val d=TaughtRouteCodec.decode(b)
    assertEquals(r.id,d.id);assertEquals(r.points,d.points);assertEquals(r.mount,d.mount)
    b[b.size/2]=(b[b.size/2].toInt() xor 1).toByte()
    assertThrows(IllegalArgumentException::class.java) { TaughtRouteCodec.decode(b) }
  }
  @Test fun referenceOrSameSessionIsRequired() {
    val r=route();assertTrue(r.usableIn("map","session","",false));assertFalse(r.usableIn("map","new","",false))
    val fixed=r.copy(referenceKey="image-hash");assertTrue(fixed.usableIn("map","new","image-hash",true))
    assertFalse(fixed.usableIn("map","new","changed",true));assertFalse(fixed.usableIn("map","new","image-hash",false))
  }
  @Test fun mountOffsetsFollowCameraYaw() {
    val c=RigidPose(floatArrayOf(0f,.1f,0f),floatArrayOf(0f,0f,0f,1f));val p=RoutePose.fromCamera(c,.03f,.04f)
    assertEquals(.03f,p.x,.0001f);assertEquals(-.04f,p.z,.0001f)
  }
  @Test fun remotePointsCannotClearCorridorAndLocalObstaclesStillStop() {
    val plane=GroundPlane(floatArrayOf(0f,0f,0f),floatArrayOf(0f,1f,0f));val p=RoutePose(0f,0f,0f)
    val clear=List(40) { floatArrayOf(.4f,0f,-.8f) }
    assertEquals(RouteClearance.DEPTH_UNKNOWN,RoutePerception.evaluate(clear,plane,p,true,.15f,.1f,.11f,.1f))
    val hazard=clear+List(3) { floatArrayOf(0f,.08f,-.25f) }
    assertEquals(RouteClearance.OBSTACLE,RoutePerception.evaluate(hazard,plane,p,true,.15f,.1f,.11f,.1f))
    assertEquals(RouteClearance.DEPTH_UNKNOWN,RoutePerception.evaluate(hazard,plane,p,false,.15f,.1f,.11f,.1f))
  }
}
