package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test

class DepthProjectionTest {
  @Test fun matchesOfficialTextureIntrinsicScalingAndCameraAxisConvention() {
    val values=IntArray(160*90);values[70*160+100]=700
    val sample=DepthSamples.Result(160,90,values,0.0,null,null)
    val points=ArrayList<FloatArray>()
    DepthProjection.points(sample,RigidPose.IDENTITY,1375f,1377f,989f,491f,1920,1080) { points.add(it) }
    val p=points.single()
    assertEquals(.7f*(100-989f*160/1920)/(1375f*160/1920),p[0],.000001f)
    assertEquals(.7f*(491f*90/1080-70)/(1377f*90/1080),p[1],.000001f)
    assertEquals(-.7f,p[2],.000001f)
  }
  @Test fun indexedProjectionKeepsPixelIdentityAndOriginalSamplingStep() {
    val s=DepthSamples.Result(2,2,intArrayOf(0,1000,0,0),0.0,null,null,4,4,2)
    var index= -1;var point=floatArrayOf()
    DepthProjection.indexedPoints(s,RigidPose(floatArrayOf(1f,2f,3f),RigidPose.IDENTITY.q),2f,2f,0f,0f,4,4) { i,p ->index=i;point=p }
    assertEquals(1,index);assertArrayEquals(floatArrayOf(2f,2f,2f),point,.000001f)
  }
}
