package com.myyaya.navigationprobe

import kotlin.math.*

internal data class LocalTile(val x: Int,val z: Int)
internal enum class LocalSpace { UNKNOWN, SUPPORT_ONLY, FREE, WEAK_OBSTACLE, OBSTACLE, DROP }
internal data class LocalTileState(val tile: LocalTile,val space: LocalSpace,val floorFrames: Int,val lastSeenNs: Long)
internal data class LocalMapSnapshot(val tiles: Map<LocalTile,LocalTileState> = emptyMap(),val atNs: Long=0,
  val lastDepthNs: Long=0,val state: String="GROUND_REFERENCE_REQUIRED",val generation: Int=0) {
  fun space(tile: LocalTile)=tiles[tile]?.space ?: LocalSpace.UNKNOWN
  fun report(): Map<String,Any?> = mapOf("state" to state,"generation" to generation,
    "cellMeters" to LocalNavigationMap.CELL,"supportTileMeters" to LocalNavigationMap.TILE,
    "retainedFloorTiles" to tiles.values.count { it.floorFrames>=2 },
    "recentFreeTiles" to tiles.values.count { it.space==LocalSpace.FREE },
    "weakObstacleTiles" to tiles.values.count { it.space==LocalSpace.WEAK_OBSTACLE },
    "obstacleTiles" to tiles.values.count { it.space==LocalSpace.OBSTACLE },
    "dropTiles" to tiles.values.count { it.space==LocalSpace.DROP },
    "supportOnlyTiles" to tiles.values.count { it.space==LocalSpace.SUPPORT_ONLY },
    "lastRawAgeMs" to if(lastDepthNs>0) (atNs-lastDepthNs)/1_000_000 else null,
    "clearanceMaxAgeMs" to LocalNavigationMap.CLEAR_NS/1_000_000,
    "unknownIsFree" to false,"staticSupportExpiresWithShortDepthTtl" to false,
    "occupancyExpiresIntoFree" to false,"persistentAcrossTrackingLoss" to false,
    "motionAuthorized" to false,"scope" to "session-local-diagnostic")
}

/** Floor support, occupied volume and recent observations have independent lifetimes.
 * Each 5cm cell has four measured 2.5cm support tiles; holes are never interpolated.
 * A single raw hazard blocks immediately; repeat frames distinguish stable occupancy.
 * Only later rays through the actual occupied height (or repeated floor for a drop)
 * clear hazards. Timeout alone never clears them. No initial blind area is seeded.
 */
internal class LocalNavigationMap {
  private data class Evidence(var floorVotes: Int=0,var floorNs: Long=0,var seenNs: Long=0,
    var hazardVotes: Int=0,var hazardNs: Long=0,var drop: Boolean=false,var point: FloatArray?=null,
    var clearVotes: Int=0,var clearNs: Long=0)
  private val evidence=HashMap<LocalTile,Evidence>()
  private var basis: GroundPlane?=null
  private var lastDepth=0L
  private var lastNow=0L
  private var previousCamera: RigidPose?=null
  private var generation=0
  @Synchronized fun reset() { evidence.clear();basis=null;lastDepth=0;lastNow=0;previousCamera=null;generation++ }

  @Synchronized fun update(camera: RigidPose,plane: GroundPlane,now: Long,depth: Long,
    points: List<FloatArray>,height: Float): LocalMapSnapshot {
    if(now<=0 || now<lastNow) { reset();return snapshot(now,"CLOCK_RESET") }
    val old=basis
    // Retain a fixed datum through small AR refinements; a cumulative change resets
    // the whole evidence basis instead of gradually moving old measurements.
    if(old!=null && (abs(old.distance(plane.origin))>.02f ||
      (0..2).sumOf { (old.normal[it]*plane.normal[it]).toDouble() }<.9994)) reset()
    val prior=previousCamera
    if(prior!=null && now-lastNow<=350_000_000L &&
      hypot(camera.t[0]-prior.t[0],camera.t[2]-prior.t[2])>.25f) reset()
    if(basis==null) basis=plane
    lastNow=now;previousCamera=camera
    val datum=basis!!
    val cameraHeight=datum.distance(camera.t)
    if(cameraHeight !in .03f..2.5f) { reset();return snapshot(now,"CAMERA_HEIGHT_INVALID") }
    evidence.entries.removeAll { (t,_) -> hypot((t.x+.5f)*TILE-camera.t[0],(t.z+.5f)*TILE-camera.t[2])>RANGE }
    val state=when {
      depth<=0 -> "RAW_UNAVAILABLE"
      depth>now -> "RAW_FUTURE"
      now-depth>250_000_000L -> "RAW_STALE"
      depth<=lastDepth -> "RAW_REPROJECTED"
      else -> "OBSERVING"
    }
    if(state!="OBSERVING") return snapshot(now,state)
    lastDepth=depth
    val valid=points.filter { p -> p.size==3 && p.all { it.isFinite() && abs(it)<=25 } &&
      hypot(p[0]-camera.t[0],p[2]-camera.t[2])<=RANGE }
    val floors=HashSet<LocalTile>()
    val hazards=HashMap<LocalTile,Pair<FloatArray,Boolean>>()
    for(p in valid) {
      val h=datum.distance(p);val tile=tile(p[0],p[2])
      when {
        h< -.04f -> hazards[tile]=p to true
        h>.03f && h<=height+.05f -> if(hazards[tile]?.second!=true) hazards[tile]=p to false
        abs(h)<=.025f -> floors.add(tile)
      }
    }
    for(t in floors+hazards.keys) {
      if(t !in evidence && evidence.size>=MAX_TILES) continue
      val e=evidence.getOrPut(t) { Evidence() };e.seenNs=depth
      if(t in floors) { e.floorVotes=min(2,e.floorVotes+1);e.floorNs=depth }
      val h=hazards[t]
      if(h!=null) {
        e.hazardVotes=min(2,e.hazardVotes+1);e.hazardNs=depth;e.drop=e.drop || h.second
        e.point=h.first.copyOf();e.clearVotes=0
      }
    }
    // Raw-only ray clearing. High surfaces cannot prove low volume empty. A ray
    // must pass the actual hazard's XY position and height, not just its grid cell.
    // Bucket ray crossings to bound work to local rays rather than hazards*image.
    val rays=HashMap<LocalTile,MutableList<FloatArray>>()
    val relevant=evidence.filterValues { it.hazardVotes>0 && !it.drop }.keys
    if(relevant.isNotEmpty()) for(p in valid) {
      val dx=p[0]-camera.t[0];val dz=p[2]-camera.t[2];val distance=hypot(dx,dz)
      val steps=ceil(distance/(TILE/2)).toInt().coerceAtLeast(1)
      val visited=HashSet<LocalTile>()
      for(i in 1 until steps) {
        val f=i.toFloat()/steps;val t=tile(camera.t[0]+dx*f,camera.t[2]+dz*f)
        if(t in relevant && visited.add(t)) rays.getOrPut(t) { ArrayList() }.add(p)
      }
    }
    for((t,e) in evidence) {
      if(e.hazardVotes==0 || t in hazards || depth<=e.hazardNs || e.clearNs==depth) continue
      val h=e.point ?: continue
      val cleared=if(e.drop) t in floors else rays[t]?.any { p ->
        val dx=p[0]-camera.t[0];val dz=p[2]-camera.t[2];val d2=dx*dx+dz*dz
        if(d2<.001f) false else {
          val f=((h[0]-camera.t[0])*dx+(h[2]-camera.t[2])*dz)/d2
          f>0 && f<1 && (1-f)*sqrt(d2)>.02f &&
            hypot(camera.t[0]+dx*f-h[0],camera.t[2]+dz*f-h[2])<.008f &&
            abs(camera.t[1]+(p[1]-camera.t[1])*f-h[1])<.012f
        }
      }==true
      if(cleared) {
        e.clearNs=depth;e.clearVotes++
        if(e.clearVotes>=3) { e.hazardVotes=0;e.drop=false;e.point=null;e.clearVotes=0 }
      }
    }
    return snapshot(now,state)
  }
  private fun snapshot(now: Long,state: String): LocalMapSnapshot {
    val result=evidence.mapValues { (t,e) ->
      val kind=when {
        e.hazardVotes>0 && e.drop -> LocalSpace.DROP
        e.hazardVotes>=2 -> LocalSpace.OBSTACLE
        e.hazardVotes==1 -> LocalSpace.WEAK_OBSTACLE
        e.floorVotes<2 -> LocalSpace.UNKNOWN
        now-e.floorNs>CLEAR_NS -> LocalSpace.SUPPORT_ONLY
        else -> LocalSpace.FREE
      }
      LocalTileState(t,kind,e.floorVotes,e.seenNs)
    }
    return LocalMapSnapshot(result,now,lastDepth,state,generation)
  }
  companion object {
    const val CELL=.05f
    const val TILE=.025f
    const val RANGE=1.5f
    const val CLEAR_NS=2_000_000_000L
    const val MAX_TILES=16000
    fun tile(x: Float,z: Float)=LocalTile(floor(x/TILE).toInt(),floor(z/TILE).toInt())
  }
}
