package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class UprightReferenceGeometryTest {
  private fun camera(pitch: Double=0.0)=UprightReferenceGeometry.Camera(450.0,450.0,320.0,240.0,
    floatArrayOf(sin(pitch/2).toFloat(),0f,0f,cos(pitch/2).toFloat()))
  private fun pixel(k: UprightReferenceGeometry.Camera,x: Float,y: Float,z: Float): UprightReferenceGeometry.Pixel {
    val p=RigidPose(FloatArray(3),k.q).inverse().point(floatArrayOf(x,y,z))
    return UprightReferenceGeometry.Pixel(k.cx+k.fx*p[0]/-p[2],k.cy-k.fy*p[1]/-p[2])
  }
  private fun sample(k: UprightReferenceGeometry.Camera,width: Double=.065)=UprightReferenceGeometry.estimate(k,
    pixel(k,0f,.04f,-.55f),pixel(k,0f,-.075f,-.55f),pixel(k,-.0325f,-.0175f,-.55f),pixel(k,.0325f,-.0175f,-.55f),.115,width)
  @Test fun recoversKnownHeightAndIndependentWidth() {
    val c=sample(camera())!!;assertEquals(.075,c.height,1e-6);assertEquals(.55,c.range,1e-6)
    assertEquals(.065,c.width,1e-6);assertTrue(c.independentWidthCheck)
  }
  @Test fun pitchedCameraUsesSeparateEndpointDistances() {
    for(pitch in listOf(-.25,.25)) {
      val c=sample(camera(pitch))!!;assertEquals(.075,c.height,1e-6);assertEquals(.55,c.range,1e-6)
    }
  }
  @Test fun wrongDiameterFailsHeldoutCheckWithoutRefittingHeight() {
    val c=sample(camera(),.1)!!;assertFalse(c.independentWidthCheck);assertEquals(.075,c.height,1e-6)
  }
  @Test fun noCandidateForReversedEndpointsOrInvalidCalibration() {
    val k=camera();val a=UprightReferenceGeometry.Pixel(320.0,200.0);val b=UprightReferenceGeometry.Pixel(320.0,300.0)
    assertNull(UprightReferenceGeometry.estimate(k,b,a,a,b,.115,.065))
    assertNull(UprightReferenceGeometry.estimate(k.copy(fx=Double.NaN),a,b,UprightReferenceGeometry.Pixel(300.0,250.0),UprightReferenceGeometry.Pixel(340.0,250.0),.115,.065))
    assertNull(UprightReferenceGeometry.estimate(k.copy(q=floatArrayOf(0f,0f,0f,0f)),a,b,UprightReferenceGeometry.Pixel(300.0,250.0),UprightReferenceGeometry.Pixel(340.0,250.0),.115,.065))
    assertNull(sample(k,Double.NaN))
  }
  @Test fun referenceAboveHorizonDoesNotProduceFloorCalibration() {
    val k=camera();fun p(x: Double,y: Double)=UprightReferenceGeometry.Pixel(x,y)
    assertNull(UprightReferenceGeometry.estimate(k,p(320.0,100.0),p(320.0,180.0),p(300.0,140.0),p(340.0,140.0),.115,.065))
  }
  @Test fun referenceMustBeVerticallyConsistentInWorld() {
    val k=camera();fun p(x: Double,y: Double)=UprightReferenceGeometry.Pixel(x,y)
    assertNull(UprightReferenceGeometry.estimate(k,p(390.0,200.0),p(320.0,300.0),p(310.0,250.0),p(370.0,250.0),.115,.065))
  }
  @Test fun smallQuaternionNormalizationErrorIsHandledWithoutThrowing() {
    val k=camera();val scaled=k.copy(q=floatArrayOf(0f,0f,0f,1.005f))
    val top=pixel(k,0f,.04f,-.55f);val bottom=pixel(k,0f,-.075f,-.55f)
    val c=UprightReferenceGeometry.estimate(scaled,top,bottom,pixel(k,-.0325f,-.0175f,-.55f),pixel(k,.0325f,-.0175f,-.55f),.115,.065)!!
    assertEquals(.075,c.height,1e-6)
  }
}
