package com.myyaya.navigationprobe

import java.io.*
import java.util.UUID
import java.util.zip.CRC32
import kotlin.math.*

/** Geometry and durable surface maps, independent of Android/ARCore and motor control. */
internal data class RigidPose(val t: FloatArray, val q: FloatArray) {
  init {
    require(t.size == 3 && q.size == 4 && (t + q).all { it.isFinite() })
    require(abs(q.sumOf { (it * it).toDouble() } - 1.0) < .01) { "Invalid quaternion" }
  }
  fun point(p: FloatArray): FloatArray {
    val u = floatArrayOf(q[0], q[1], q[2])
    fun cross(a: FloatArray, b: FloatArray) = floatArrayOf(a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
    val c = cross(u, p); val d = cross(u, c)
    return FloatArray(3) { p[it] + 2*q[3]*c[it] + 2*d[it] + t[it] }
  }
  fun inverse(): RigidPose {
    val rotation = RigidPose(floatArrayOf(0f,0f,0f), floatArrayOf(-q[0],-q[1],-q[2],q[3]))
    return RigidPose(rotation.point(FloatArray(3) { -t[it] }), rotation.q)
  }
  fun compose(b: RigidPose): RigidPose {
    val a = q; val r = b.q
    return RigidPose(point(b.t), floatArrayOf(
      a[3]*r[0]+a[0]*r[3]+a[1]*r[2]-a[2]*r[1],
      a[3]*r[1]-a[0]*r[2]+a[1]*r[3]+a[2]*r[0],
      a[3]*r[2]+a[0]*r[1]-a[1]*r[0]+a[2]*r[3],
      a[3]*r[3]-a[0]*r[0]-a[1]*r[1]-a[2]*r[2]))
  }
  companion object { val IDENTITY = RigidPose(floatArrayOf(0f,0f,0f), floatArrayOf(0f,0f,0f,1f)) }
}

internal data class MapPlace(val name: String, val position: FloatArray)
internal data class RoomMapData(
  val id: String = UUID.randomUUID().toString(), val name: String,
  val createdAt: Long = System.currentTimeMillis(), val sessionId: String,
  val voxels: List<IntArray> = emptyList(), val path: List<FloatArray> = emptyList(),
  val places: List<MapPlace> = emptyList(), val referenceJpeg: ByteArray = byteArrayOf(),
  val referenceWidth: Float = 0f, val imageFromMap: RigidPose? = null,
  val origin: RigidPose? = null
)

internal class RoomMapper(initial: RoomMapData) {
  private var data = initial
  private val cells = LinkedHashMap<String, IntArray>()
  private val path = ArrayList<FloatArray>()
  private val places = ArrayList<MapPlace>()
  private var worldFromMap: RigidPose? = null
  private var currentSession: String? = null
  private var segment = (initial.path.maxOfOrNull { it[3].toInt() } ?: 0) + 1
  private var lastDepth = 0L
  @Volatile var livePosition: FloatArray? = null; private set
  @Volatile var liveForward: FloatArray? = null; private set
  var rejectedFrames = 0; private set
  var acceptedFrames = 0; private set
  init {
    initial.voxels.forEach { cells[key(it[0], it[1], it[2])] = it.clone() }
    path.addAll(initial.path.map { it.clone() }); places.addAll(initial.places)
  }
  @Synchronized fun snapshot() = data.copy(voxels = cells.values.map { it.clone() },
    path = path.map { it.clone() }, places = places.map { it.copy(position = it.position.clone()) })
  @Synchronized fun referenceEnabled() = data.referenceJpeg.isNotEmpty()
  @Synchronized fun summary(): Map<String, Any?> = mapOf("mapId" to data.id,"mapName" to data.name,
    "surfaceCells" to cells.size,"pathSamples" to path.size,"places" to places.map { it.name },
    "fixedReference" to data.referenceJpeg.isNotEmpty(),
    "savedReferenceTransform" to (data.imageFromMap != null),
    "referenceAligned" to (data.referenceJpeg.isNotEmpty() && worldFromMap != null && livePosition != null),
    "localized" to (livePosition != null),"position" to livePosition?.toList(),
    "acceptedDepthFrames" to acceptedFrames,"rejectedDepthFrames" to rejectedFrames,
    "freeSpaceInferred" to false,"motorControl" to false)
  @Synchronized fun bindSession(id: String) {
    if (id != currentSession) { currentSession = id; worldFromMap = null; lastDepth = 0; invalidate() }
  }
  @Synchronized fun invalidate() { if (livePosition != null) segment++; livePosition = null; liveForward = null }
  /** Called only for a fully tracked, stable, physically fixed reference image. */
  @Synchronized fun alignReference(session: String, worldFromImage: RigidPose): Boolean {
    if (session != currentSession || data.referenceJpeg.isEmpty()) return false
    val relation = data.imageFromMap ?: run {
      // Gravity-aligned map: image's horizontal X axis fixes yaw, Y is ARCore gravity.
      val x = worldFromImage.point(floatArrayOf(1f,0f,0f))
      val dx = x[0]-worldFromImage.t[0]; val dz = x[2]-worldFromImage.t[2]
      if (hypot(dx, dz) < .5f) return false
      val yaw = atan2(-dz, dx)
      val origin = RigidPose(worldFromImage.t.clone(), floatArrayOf(0f,sin(yaw/2),0f,cos(yaw/2)))
      worldFromImage.inverse().compose(origin).also { data = data.copy(imageFromMap = it) }
    }
    worldFromMap = worldFromImage.compose(relation)
    return true
  }
  @Synchronized fun observePose(session: String, pose: RigidPose, tracking: Boolean): Boolean {
    if (!tracking || session != currentSession) { invalidate(); return false }
    if (worldFromMap == null && data.referenceJpeg.isEmpty() && session == data.sessionId) {
      val origin = data.origin ?: RigidPose(pose.t.clone(), RigidPose.IDENTITY.q)
      data = data.copy(origin = origin); worldFromMap = origin
    }
    val transform = worldFromMap?.inverse() ?: return false
    val local = transform.compose(pose)
    if (local.t.any { abs(it) > 25f }) { invalidate(); return false }
    livePosition = local.t.clone()
    val forward = local.point(floatArrayOf(0f,0f,-1f))
    liveForward = FloatArray(3) { forward[it]-local.t[it] }
    val last = path.lastOrNull()
    if (last == null || last[3].toInt() != segment || (0..2).sumOf { ((last[it]-local.t[it]).pow(2)).toDouble() } > .0004) {
      path.add(floatArrayOf(local.t[0],local.t[1],local.t[2],segment.toFloat()))
      if (path.size > MAX_PATH) path.removeAt(0)
    }
    return true
  }
  @Synchronized fun fuse(session: String, pose: RigidPose, sample: DepthSamples.Result,
    fx: Float, fy: Float, cx: Float, cy: Float, textureWidth: Int, textureHeight: Int,
    frameNs: Long, depthNs: Long): Int {
    if (session != currentSession || livePosition == null || worldFromMap == null ||
      depthNs <= 0 || depthNs <= lastDepth || depthNs > frameNs || frameNs-depthNs > 250_000_000L) {
      rejectedFrames++; return 0
    }
    require(fx.isFinite() && fy.isFinite() && fx > 0 && fy > 0 && cx.isFinite() && cy.isFinite() && textureWidth > 0 && textureHeight > 0)
    val dx = sample.sourceWidth.toFloat()/textureWidth; val dy = sample.sourceHeight.toFloat()/textureHeight
    val cameraToMap = worldFromMap!!.inverse().compose(pose)
    lastDepth = depthNs
    var added = 0
    for (y in 0 until sample.height) for (x in 0 until sample.width) {
      val mm = sample.millimeters[y*sample.width+x]
      // Conservative observation range. This is a surface cloud, NEVER free-space evidence.
      if (mm !in 200..4000) continue
      val d = mm/1000f
      val p = cameraToMap.point(floatArrayOf(d*(x*sample.step-cx*dx)/(fx*dx), d*(cy*dy-y*sample.step)/(fy*dy), -d))
      if (p.any { !it.isFinite() || abs(it) > 25f }) continue
      val ix = floor(p[0]/CELL).toInt(); val iy = floor(p[1]/CELL).toInt(); val iz = floor(p[2]/CELL).toInt()
      val key = key(ix,iy,iz); val existing = cells[key]
      if (existing != null) existing[3] = min(65535,existing[3]+1)
      else if (cells.size < MAX_CELLS) cells[key] = intArrayOf(ix,iy,iz,1)
      else continue
      added++
    }
    acceptedFrames++
    return added
  }
  @Synchronized fun addPlace(name: String) {
    val clean = name.trim(); require(clean.isNotEmpty() && clean.length <= 40)
    val p = livePosition?.clone() ?: error("请先恢复当前地图定位")
    require(places.size < MAX_PLACES || places.any { it.name == clean }) { "地点数量已达上限" }
    places.removeAll { it.name == clean }; places.add(MapPlace(clean,p))
  }
  companion object {
    const val CELL = .05f; const val MAX_CELLS = 60000; const val MAX_PATH = 8000; const val MAX_PLACES = 128
    private fun key(x: Int,y: Int,z: Int) = "$x,$y,$z"
  }
}

/** Versioned/checksummed, bounded map files. Atomic replacement is handled by Android's AtomicFile. */
internal object RoomMapCodec {
  const val MAX_BYTES = 8_000_000
  fun encode(map: RoomMapData): ByteArray {
    require(map.voxels.size <= RoomMapper.MAX_CELLS && map.path.size <= RoomMapper.MAX_PATH && map.places.size <= RoomMapper.MAX_PLACES)
    val body = ByteArrayOutputStream()
    DataOutputStream(body).use { out ->
      out.writeInt(1); out.writeUTF(map.id); out.writeUTF(map.name); out.writeLong(map.createdAt); out.writeUTF(map.sessionId)
      fun pose(p: RigidPose?) { out.writeBoolean(p != null); if (p != null) (p.t+p.q).forEach(out::writeFloat) }
      pose(map.origin); pose(map.imageFromMap)
      out.writeFloat(map.referenceWidth); out.writeInt(map.referenceJpeg.size); out.write(map.referenceJpeg)
      out.writeInt(map.voxels.size); map.voxels.forEach { it.forEach(out::writeInt) }
      out.writeInt(map.path.size); map.path.forEach { it.forEach(out::writeFloat) }
      out.writeInt(map.places.size); map.places.forEach { out.writeUTF(it.name); it.position.forEach(out::writeFloat) }
    }
    val bytes = body.toByteArray(); require(bytes.size <= MAX_BYTES-16)
    return ByteArrayOutputStream().also { sink -> DataOutputStream(sink).use {
      it.writeInt(0x59415941); it.writeInt(bytes.size); it.write(bytes); it.writeLong(CRC32().apply { update(bytes) }.value)
    } }.toByteArray()
  }
  fun decode(bytes: ByteArray): RoomMapData {
    require(bytes.size in 16..MAX_BYTES)
    val input = DataInputStream(ByteArrayInputStream(bytes))
    require(input.readInt() == 0x59415941)
    val size = input.readInt(); require(size == bytes.size-16)
    val body = ByteArray(size); input.readFully(body)
    require(input.readLong() == CRC32().apply { update(body) }.value) { "地图校验失败" }
    return DataInputStream(ByteArrayInputStream(body)).use { data ->
      require(data.readInt() == 1) { "不支持的地图版本" }
      val id = data.readUTF(); require(UUID.fromString(id).toString() == id)
      val name = data.readUTF(); require(name.isNotBlank() && name.length <= 40)
      val created = data.readLong(); val session = data.readUTF(); require(session.length in 1..100)
      fun floats(count: Int) = FloatArray(count) { data.readFloat().also { require(it.isFinite() && abs(it) <= 1000) } }
      fun pose(): RigidPose? = if (data.readBoolean()) RigidPose(floats(3),floats(4)) else null
      val origin = pose(); val relation = pose(); val width = data.readFloat()
      val length = data.readInt(); require(length in 0..2_000_000 && length <= data.available())
      val jpeg = ByteArray(length); data.readFully(jpeg)
      require(width.isFinite() && (length == 0 && width == 0f && relation == null || length > 0 && width in .05f..3f))
      fun count(max: Int) = data.readInt().also { require(it in 0..max) }
      val voxels = List(count(RoomMapper.MAX_CELLS)) { intArrayOf(data.readInt(),data.readInt(),data.readInt(),data.readInt()).also {
        require(it.take(3).all { v -> v in -501..500 } && it[3] in 1..65535)
      } }
      require(voxels.map { "${it[0]},${it[1]},${it[2]}" }.toSet().size == voxels.size)
      val path = List(count(RoomMapper.MAX_PATH)) {
        val p = floats(3); val segment = data.readFloat()
        require(segment.isFinite() && segment >= 0 && segment <= 1_000_000 && segment == floor(segment))
        floatArrayOf(p[0],p[1],p[2],segment)
      }
      val places = List(count(RoomMapper.MAX_PLACES)) { MapPlace(data.readUTF().also { require(it.isNotBlank() && it.length <= 40) },floats(3)) }
      require(places.map { it.name }.toSet().size == places.size && data.available() == 0)
      RoomMapData(id,name,created,session,voxels,path,places,jpeg,width,relation,origin)
    }
  }
}
