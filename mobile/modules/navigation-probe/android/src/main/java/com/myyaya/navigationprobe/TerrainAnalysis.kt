package com.myyaya.navigationprobe

import kotlin.math.*

internal data class RobotEnvelope(val width: Float,val length: Float,val height: Float,val margin: Float) {
  init {
    require(listOf(width,length,height,margin).all { it.isFinite() })
    require(width in .1f..1f && length in .1f..1f && height in .1f..2f && margin in .02f..0.3f)
  }
  // Circumscribed disc covers the entire rectangle even while turning.
  val radius get()=hypot(width,length)/2+margin
}

internal data class GroundPlane(val origin: FloatArray,val normal: FloatArray) {
  init {
    require(origin.size==3 && normal.size==3 && (origin+normal).all { it.isFinite() })
    require(abs(normal.sumOf { (it*it).toDouble() }-1)<.01 && normal[1]>=.984f)
  }
  fun distance(p: FloatArray)=(0..2).sumOf { ((p[it]-origin[it])*normal[it]).toDouble() }.toFloat()
  companion object {
    fun fromPose(pose: RigidPose): GroundPlane {
      val up=pose.point(floatArrayOf(0f,1f,0f))
      return GroundPlane(pose.t.clone(),FloatArray(3) { up[it]-pose.t[it] })
    }
  }
}

internal enum class TerrainKind { GROUND, OBSTACLE, DROP, UNCERTAIN }
internal data class TerrainCell(val x: Int,val z: Int,val kind: TerrainKind,val candidate: Boolean=false)
internal data class TerrainSnapshot(val groundSelected: Boolean,val status: String,val cells: List<TerrainCell> = emptyList(),
  val camera: RigidPose? = null,val cameraHeight: Float? = null,val envelope: RobotEnvelope? = null,val floorConfirmed: Boolean=true) {
  fun report(): Map<String,Any?> = mapOf("groundSelected" to (groundSelected && floorConfirmed),
    "referenceSurfaceSelected" to groundSelected,"surfaceRole" to if (!groundSelected) "none" else if (floorConfirmed) "floor-confirmed" else "bench-test","status" to status,
    "groundCells" to cells.count { it.kind==TerrainKind.GROUND },"obstacleCells" to cells.count { it.kind==TerrainKind.OBSTACLE },
    "dropCells" to cells.count { it.kind==TerrainKind.DROP },"uncertainCells" to cells.count { it.kind==TerrainKind.UNCERTAIN },
    "candidateCenterCells" to if (floorConfirmed) cells.count { it.candidate } else 0,
    "benchCandidateCenterCells" to if (!floorConfirmed) cells.count { it.candidate } else 0,"cameraHeightMeters" to cameraHeight,
    "cellMeters" to TerrainAnalysis.CELL,"evidenceTtlMs" to TerrainAnalysis.TTL/1_000_000,
    "robotDimensionsSet" to (envelope!=null),"robotWidthMeters" to envelope?.width,"robotLengthMeters" to envelope?.length,
    "robotHeightMeters" to envelope?.height,"marginMeters" to envelope?.margin,"footprintRadiusMeters" to envelope?.radius,
    "coordinateFrame" to "current-room-map","persistent" to false,"motorControl" to false,"motionAuthorized" to false)
}

/** Session-local, short-lived diagnostic evidence. Never authorizes motor commands. */
internal class TerrainAnalysis {
  private data class Evidence(var groundAt: Long=0,val groundFrames: ArrayDeque<Long> = ArrayDeque(),
    val quadrants: LongArray = LongArray(4),var obstacleAt: Long=0,var dropAt: Long=0,var uncertainAt: Long=0)
  private data class FrameCell(var quadrants: Int=0,var minHeight: Float=Float.POSITIVE_INFINITY,
    var maxHeight: Float=Float.NEGATIVE_INFINITY,var obstacle: Boolean=false,var drop: Boolean=false,var uncertain: Boolean=false)
  private val cells=HashMap<Pair<Int,Int>,Evidence>()
  private var ground: GroundPlane?=null
  private var floorConfirmed=false
  private var envelope: RobotEnvelope?=null
  private var lastDepth=0L
  private var lastTime=0L
  @Synchronized fun reset() { cells.clear(); ground=null; floorConfirmed=false; lastDepth=0; lastTime=0 }
  @Synchronized fun setEnvelope(value: RobotEnvelope?) { envelope=value; cells.clear(); lastDepth=0 }
  @Synchronized fun selectGround(value: GroundPlane,actualFloor: Boolean=true) { cells.clear(); ground=value; floorConfirmed=actualFloor; lastDepth=0 }
  @Synchronized fun hasGround()=ground!=null

  /** Repeated/reprojected or old depth never increases evidence votes or refreshes TTL. */
  @Synchronized fun update(camera: RigidPose, plane: GroundPlane, now: Long, depth: Long, points: List<FloatArray>): TerrainSnapshot {
    val previous=ground ?: return TerrainSnapshot(false,"SELECT_GROUND",envelope=envelope)
    if (now<=0 || now<lastTime) { reset(); return TerrainSnapshot(false,"CLOCK_RESET",envelope=envelope) }
    val dot=(0..2).sumOf { (previous.normal[it]*plane.normal[it]).toDouble() }
    if (abs(previous.distance(plane.origin))>.03f || dot<.9986) {
      cells.clear(); ground=plane; lastDepth=0
    }
    lastTime=now
    // Keep a stable datum until the plane meaningfully changes.
    val datum=ground!!
    prune(now,camera)
    val height=datum.distance(camera.t)
    if (height !in .03f..2.5f) {
      cells.clear()
      return TerrainSnapshot(true,"CAMERA_HEIGHT_INVALID",camera=camera,cameraHeight=height,envelope=envelope,floorConfirmed=floorConfirmed)
    }
    if (depth>0 && depth>lastDepth && depth<=now && now-depth<=250_000_000L) {
      lastDepth=depth
      val observed=HashMap<Pair<Int,Int>,FrameCell>()
      for (p in points) {
        if (p.size!=3 || p.any { !it.isFinite() || abs(it)>25f } || hypot(p[0]-camera.t[0],p[2]-camera.t[2])>RANGE) continue
        val h=datum.distance(p)
        val ix=floor(p[0]/CELL).toInt(); val iz=floor(p[2]/CELL).toInt()
        val cell=observed.getOrPut(ix to iz) { FrameCell() }
        when {
          h < -.04f -> cell.drop=true
          h > .03f && h <= (envelope?.height?.plus(.05f) ?: 2.5f) -> cell.obstacle=true
          abs(h)<=.025f -> {
            val quadrant=(if (p[0]/CELL-ix>=.5f) 1 else 0)+(if (p[2]/CELL-iz>=.5f) 2 else 0)
            cell.quadrants=cell.quadrants or (1 shl quadrant)
            cell.minHeight=min(cell.minHeight,h); cell.maxHeight=max(cell.maxHeight,h)
          }
          // High surfaces alone do not establish clear volume underneath.
          else -> cell.uncertain=true
        }
      }
      for ((key,frame) in observed) {
        if (key !in cells && cells.size>=MAX_CELLS) continue
        val cell=cells.getOrPut(key) { Evidence() }
        if (frame.obstacle) cell.obstacleAt=now
        if (frame.drop) cell.dropAt=now
        if (frame.uncertain) cell.uncertainAt=now
        if (frame.quadrants!=0) {
          if (frame.maxHeight-frame.minHeight>.03f) cell.uncertainAt=now
          else {
            cell.groundAt=now; cell.groundFrames.addLast(now)
            while (cell.groundFrames.size>3) cell.groundFrames.removeFirst()
            for (i in 0..3) if (frame.quadrants and (1 shl i)!=0) cell.quadrants[i]=now
          }
        }
      }
    }
    return snapshot(camera,now,height)
  }
  private fun prune(now: Long,camera: RigidPose) {
    cells.entries.removeAll { (key,value) ->
      now-maxOf(value.groundAt,value.obstacleAt,value.dropAt,value.uncertainAt)>TTL ||
        hypot((key.first+.5f)*CELL-camera.t[0],(key.second+.5f)*CELL-camera.t[2])>RANGE
    }
  }
  private fun snapshot(camera: RigidPose,now: Long,height: Float): TerrainSnapshot {
    fun recent(stamp: Long)=stamp>0 && now-stamp<=TTL
    val kinds=cells.mapValues { (_,c) -> when {
      recent(c.dropAt) -> TerrainKind.DROP
      recent(c.obstacleAt) -> TerrainKind.OBSTACLE
      recent(c.uncertainAt) -> TerrainKind.UNCERTAIN
      recent(c.groundAt) && c.groundFrames.count { recent(it) }>=3 && c.quadrants.count { recent(it) }>=3 -> TerrainKind.GROUND
      else -> TerrainKind.UNCERTAIN
    } }
    val radius=envelope?.radius
    val offsets=if (radius!=null) {
      val reach=ceil(radius/CELL+.5f).toInt()
      (-reach..reach).flatMap { x -> (-reach..reach).mapNotNull { z ->
        // Every grid cell intersecting the disc must have actual ground evidence.
        if (hypot(max(0f,(abs(x)-.5f)*CELL),max(0f,(abs(z)-.5f)*CELL))<=radius) x to z else null
      } }
    } else emptyList()
    val result=kinds.map { (key,kind) -> TerrainCell(key.first,key.second,kind,
      radius!=null && kind==TerrainKind.GROUND && offsets.all { (x,z) -> kinds[(key.first+x) to (key.second+z)]==TerrainKind.GROUND }) }
    return TerrainSnapshot(true,if (radius==null) "DIMENSIONS_REQUIRED" else "OBSERVING",result,camera,height,envelope,floorConfirmed)
  }
  companion object { const val CELL=.1f; const val RANGE=3f; const val TTL=3_000_000_000L; const val MAX_CELLS=4000 }
}
