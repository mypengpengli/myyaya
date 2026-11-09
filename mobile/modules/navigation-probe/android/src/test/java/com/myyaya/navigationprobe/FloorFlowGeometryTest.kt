package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class FloorFlowGeometryTest {
  private val q=floatArrayOf(0f,0f,0f,1f)
  private fun grid()=(0..7).flatMap { x->(0..4).map { z->FloorFlowGeometry.Point(-.15+x*.04,-.18-z*.04) } }
  @Test fun calibratedRayHitsKnownHeightFloor() {
    val p=FloorFlowGeometry.project(320.0,400.0,400.0,400.0,320.0,240.0,q,.1f)!!
    assertEquals(0.0,p.x,1e-7);assertEquals(-.25,p.z,1e-6)
  }
  @Test fun horizonInvalidHeightAndBadQuaternionReject() {
    assertNull(FloorFlowGeometry.project(320.0,240.0,400.0,400.0,320.0,240.0,q,.1f))
    assertNull(FloorFlowGeometry.project(320.0,400.0,400.0,400.0,320.0,240.0,q,0f))
    assertNull(FloorFlowGeometry.project(320.0,400.0,400.0,400.0,320.0,240.0,floatArrayOf(0f,0f,0f,0f),.1f))
  }
  @Test fun forwardThreeCentimetersHasCorrectSignAndMagnitude() {
    val a=grid();val b=a.map { FloorFlowGeometry.Point(it.x,it.z+.03) }
    val e=FloorFlowGeometry.estimate(a,b)!!
    assertEquals(0.0,e.dx,1e-7);assertEquals(-.03,e.dz,1e-7);assertEquals(a.size,e.inliers)
  }
  @Test fun stationarySceneDoesNotInventMovement() {
    val a=grid();val e=FloorFlowGeometry.estimate(a,a)!!
    assertEquals(0.0,hypot(e.dx,e.dz),1e-8)
  }
  @Test fun minorityMovingObjectsAreRejectedAsOutliers() {
    val a=grid();val b=a.mapIndexed { i,p->if(i%5==0) FloorFlowGeometry.Point(p.x+.2,p.z+.1) else FloorFlowGeometry.Point(p.x-.002,p.z+.035) }
    val e=FloorFlowGeometry.estimate(a,b)!!
    assertEquals(.002,e.dx,1e-7);assertEquals(-.035,e.dz,1e-7);assertEquals(32,e.inliers)
  }
  @Test fun WrongPlaneScaleAndSparseMatchesDoNotYieldPose() {
    val a=grid();assertNull(FloorFlowGeometry.estimate(a,a.map { FloorFlowGeometry.Point(it.x*1.3,it.z*1.3) }))
    assertNull(FloorFlowGeometry.estimate(a.take(5),a.take(5)))
  }
  @Test fun largeRotationOutsideShortFrameContractRejects() {
    val a=grid();val angle=.2;val b=a.map { FloorFlowGeometry.Point(cos(angle)*it.x-sin(angle)*it.z,sin(angle)*it.x+cos(angle)*it.z) }
    assertNull(FloorFlowGeometry.estimate(a,b))
  }
}
