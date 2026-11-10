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
  @Test fun rejectedScaleExplainsFailureWithoutPublishingTranslation() {
    val a=grid();val assessment=FloorFlowGeometry.assess(a,a.map { FloorFlowGeometry.Point(it.x*1.3,it.z*1.3) })
    assertEquals("SCALE_OUT_OF_RANGE",assessment.reason);assertNull(assessment.estimate)
    assertEquals(1.3,assessment.scale!!,1e-7);assertEquals(a.size,assessment.inliers)
    assertFalse(assessment.report().containsKey("cameraDxMeters"))
  }
  @Test fun mixedSurfacesFailTheOriginalConsensusThreshold() {
    val a=grid();val b=a.mapIndexed { i,p->FloorFlowGeometry.Point(p.x+if(i%2==0) .01 else .08,p.z+.03) }
    val assessment=FloorFlowGeometry.assess(a,b)
    assertEquals("LOW_INLIER_RATIO",assessment.reason);assertNull(assessment.estimate)
    assertTrue(assessment.inliers.toDouble()/assessment.correspondences<.65)
  }
  @Test fun rotationAndSparseFailuresRemainDistinct() {
    val a=grid();val b=a.map { FloorFlowGeometry.Point(cos(.2)*it.x-sin(.2)*it.z,sin(.2)*it.x+cos(.2)*it.z) }
    assertEquals("ROTATION_OUT_OF_RANGE",FloorFlowGeometry.assess(a,b).reason)
    assertEquals("INSUFFICIENT_CORRESPONDENCES",FloorFlowGeometry.assess(a.take(4),a.take(4)).reason)
  }
  @Test fun acceptedModelIdentifiesWhichTracksCanBecomeTheNextKeyframe() {
    val e=FloorFlowGeometry.Estimate(.01,-.03,1.01,.01,30,1.0,.001)
    val a=FloorFlowGeometry.Point(.1,-.3)
    val x=a.x-e.dx;val z=a.z-e.dz
    val b=FloorFlowGeometry.Point(e.scale*(cos(e.angle)*x-sin(e.angle)*z),e.scale*(sin(e.angle)*x+cos(e.angle)*z))
    assertTrue(FloorFlowGeometry.isInlier(a,b,e))
    assertFalse(FloorFlowGeometry.isInlier(a,FloorFlowGeometry.Point(b.x+.01,b.z),e))
  }
}
