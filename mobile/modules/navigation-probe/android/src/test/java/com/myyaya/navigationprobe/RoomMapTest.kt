package com.myyaya.navigationprobe

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import kotlin.math.sqrt

class RoomMapTest {
  private fun pose(x: Float=0f,y: Float=0f,z: Float=0f) = RigidPose(floatArrayOf(x,y,z),floatArrayOf(0f,0f,0f,1f))
  private fun mapper(reference: Boolean=false): RoomMapper = RoomMapper(RoomMapData(name="room",sessionId="a",
    referenceJpeg=if (reference) byteArrayOf(1,2,3) else byteArrayOf(),referenceWidth=if (reference) .2f else 0f)).apply { bindSession("a") }
  private fun sample(vararg depth: Int) = DepthSamples.Result(depth.size,1,depth,1.0,null,null)
  private fun fuse(m: RoomMapper,s: DepthSamples.Result=sample(1000),stamp: Long=1_000_000_000L,frame: Long=stamp) =
    m.fuse("a",pose(),s,1f,1f,0f,0f,s.sourceWidth,s.sourceHeight,frame,stamp)

  @Test fun poseInverseAndCompositionRespectRotatedCameraCoordinates() {
    val q=sqrt(.5f); val transform=RigidPose(floatArrayOf(2f,3f,4f),floatArrayOf(0f,q,0f,q))
    val p=floatArrayOf(1f,2f,-3f)
    assertArrayEquals(p,transform.inverse().point(transform.point(p)),.00001f)
    assertArrayEquals(transform.point(pose(1f).point(p)),transform.compose(pose(1f)).point(p),.00001f)
  }
  @Test fun projectionUsesNegativeCameraZAndPositiveCameraY() {
    val m=mapper(); assertTrue(m.observePose("a",pose(),true))
    assertEquals(2,fuse(m,sample(1000,1000)))
    val cells=m.snapshot().voxels
    assertTrue(cells.any { it[0]==0 && it[1]==0 && it[2]== -20 })
    assertTrue(cells.any { it[0]==20 && it[1]==0 && it[2]== -20 })
  }
  @Test fun depthProjectionUsesTextureDimensionsAndOriginalSampleStep() {
    val m=mapper(); m.observePose("a",pose(),true)
    val sample=DepthSamples.Result(2,1,intArrayOf(1000,1000),1.0,null,null,4,2,2)
    m.fuse("a",pose(),sample,4f,4f,2f,2f,8,4,100L,100L)
    val cells=m.snapshot().voxels
    assertTrue(cells.any { it[0]== -10 && it[1]==10 && it[2]== -20 })
    assertTrue(cells.any { it[0]==10 && it[1]==10 && it[2]== -20 })
  }
  @Test fun staleFutureAndRepeatedDepthCannotAccumulateCells() {
    val m=mapper(); m.observePose("a",pose(),true)
    assertEquals(0,fuse(m,frame=1_250_000_001L))
    assertEquals(0,fuse(m,frame=999_999_999L))
    assertEquals(1,fuse(m)); assertEquals(0,fuse(m))
    assertEquals(1,m.snapshot().voxels.single()[3])
  }
  @Test fun unknownTooNearAndOutOfRangePixelsNeverBecomeSurface() {
    val m=mapper(); m.observePose("a",pose(),true)
    fuse(m,sample(0,199,4001,60000))
    assertTrue(m.snapshot().voxels.isEmpty())
  }
  @Test fun mappingConfidenceThresholdDoesNotReuseWeakerPreviewThreshold() {
    val depth=ByteBuffer.wrap(byteArrayOf(-24,3,-24,3))
    val sample=DepthSamples.read(2,1,DepthSamples.Plane(depth,4,2),DepthSamples.Plane(ByteBuffer.wrap(byteArrayOf(100,-1)),2,1),153)
    assertArrayEquals(intArrayOf(0,1000),sample.millimeters)
  }
  @Test fun reloadedUnreferencedMapCannotLocateInAnotherSession() {
    val m=mapper(); m.observePose("a",pose(),true); fuse(m)
    val loaded=RoomMapper(RoomMapCodec.decode(RoomMapCodec.encode(m.snapshot())))
    loaded.bindSession("b")
    assertFalse(loaded.observePose("b",pose(7f),true)); assertNull(loaded.livePosition)
    assertEquals(0,loaded.fuse("a",pose(),sample(1000),1f,1f,0f,0f,1,1,2L,2L))
    assertEquals(1,loaded.snapshot().voxels.size)
  }
  @Test fun fixedImageRestoresNamedPlaceInNewSessionCoordinates() {
    val m=mapper(true)
    assertFalse(m.observePose("a",pose(),true))
    assertTrue(m.alignReference("a",pose(2f)))
    assertTrue(m.observePose("a",pose(3f),true)); m.addPlace("sofa")
    val loaded=RoomMapper(RoomMapCodec.decode(RoomMapCodec.encode(m.snapshot())))
    loaded.bindSession("b"); assertFalse(loaded.observePose("b",pose(10f),true))
    assertFalse(loaded.alignReference("a",pose(9f)))
    assertTrue(loaded.alignReference("b",pose(9f)))
    assertTrue(loaded.observePose("b",pose(10f),true))
    assertArrayEquals(loaded.snapshot().places.single().position,loaded.livePosition,.00001f)
    assertEquals(1f,loaded.livePosition!![0],.00001f)
  }
  @Test fun lostTrackingBreaksPathAndForbidsPlaceUpdatesAndFusion() {
    val m=mapper(); m.observePose("a",pose(),true); m.addPlace("sofa")
    m.observePose("a",pose(1f),false)
    assertNull(m.livePosition); assertEquals(0,fuse(m))
    assertThrows(IllegalStateException::class.java) { m.addPlace("bad") }
    m.observePose("a",pose(2f),true)
    val path=m.snapshot().path
    assertNotEquals(path[0][3],path.last()[3])
    m.addPlace("sofa"); assertEquals(1,m.snapshot().places.size)
  }
  @Test fun codecRoundTripPreservesSurfaceReferencePathAndPlaces() {
    val m=mapper(true); m.alignReference("a",pose()); m.observePose("a",pose(),true); fuse(m); m.addPlace("room")
    val a=m.snapshot(); val b=RoomMapCodec.decode(RoomMapCodec.encode(a))
    assertEquals(a.id,b.id); assertEquals(a.name,b.name); assertEquals(a.createdAt,b.createdAt)
    assertArrayEquals(a.referenceJpeg,b.referenceJpeg); assertArrayEquals(a.voxels.single(),b.voxels.single())
    assertArrayEquals(a.path.single(),b.path.single(),0f); assertArrayEquals(a.places.single().position,b.places.single().position,0f)
    assertArrayEquals(a.imageFromMap!!.q,b.imageFromMap!!.q,0f)
  }
  @Test fun corruptTruncatedAndTrailingBytesAreRejectedBeforeUse() {
    val original=RoomMapCodec.encode(mapper().snapshot())
    val damaged=original.clone().apply { this[20]=(this[20].toInt() xor 1).toByte() }
    for (bytes in listOf(damaged,original.copyOf(9),original+byteArrayOf(0)))
      assertThrows(IllegalArgumentException::class.java) { RoomMapCodec.decode(bytes) }
  }
  @Test fun mapCopyDoesNotAllowMutatingLiveSurfaceState() {
    val m=mapper(); m.observePose("a",pose(),true); fuse(m)
    m.snapshot().voxels.single()[3]=0
    assertEquals(1,m.snapshot().voxels.single()[3])
  }
}
