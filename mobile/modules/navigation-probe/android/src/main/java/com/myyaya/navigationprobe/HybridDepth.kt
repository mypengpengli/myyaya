package com.myyaya.navigationprobe

import kotlin.math.*

/** Same-frame cross-validation; full depth never replaces a confident raw observation. */
internal object HybridDepth {
  data class Result(val sample: DepthSamples.Result,val filled: BooleanArray,val status: String,
    val anchors: Int=0,val overlap: Int=0,val medianError: Float?=null,val proposed: Int=0,val added: Int=0) {
    fun report(): Map<String,Any?> = mapOf("status" to status,"rawPlaneAnchors" to anchors,
      "overlapPixels" to overlap,"medianDifferenceMeters" to medianError,
      "smoothPlaneProposals" to proposed,"validatedSmoothPoints" to added,"maxAnchorDistanceMeters" to .20f)
  }
  fun fuse(raw: DepthSamples.Result,dense: DepthSamples.Result?,camera: RigidPose,plane: GroundPlane,
    fx: Float,fy: Float,cx: Float,cy: Float,tw: Int,th: Int,rawNs: Long,denseNs: Long,now: Long): Result {
    fun unchanged(status: String)=Result(raw,BooleanArray(raw.millimeters.size),status)
    if (dense==null) return unchanged("RAW_ONLY_UNAVAILABLE")
    if (rawNs<=0 || denseNs<=0 || rawNs>now || denseNs>now || now-rawNs>250_000_000L ||
      now-denseNs>250_000_000L || abs(rawNs-denseNs)>250_000_000L) return unchanged("RAW_ONLY_STALE_PAIR")
    if (raw.width!=dense.width || raw.height!=dense.height || raw.sourceWidth!=dense.sourceWidth ||
      raw.sourceHeight!=dense.sourceHeight || raw.step!=dense.step) return unchanged("RAW_ONLY_SIZE_MISMATCH")
    val errors=ArrayList<Float>(); val distances=ArrayList<Float>()
    for (i in raw.millimeters.indices) {
      val a=raw.millimeters[i];val b=dense.millimeters[i]
      if (a in 200..4000 && b in 200..4000) { errors.add(abs(a-b)/1000f);distances.add(a/1000f) }
    }
    if (errors.size<8) return unchanged("RAW_ONLY_INSUFFICIENT_OVERLAP")
    errors.sort();distances.sort()
    val median=errors[errors.size/2];val range=distances[distances.size/2]
    if (median>max(.04f,range*.05f) || errors[(errors.size*.9f).toInt().coerceAtMost(errors.lastIndex)]>max(.12f,range*.15f))
      return Result(raw,BooleanArray(raw.millimeters.size),"RAW_ONLY_PAIR_DISAGREES",overlap=errors.size,medianError=median)
    val anchors=HashMap<Pair<Int,Int>,MutableList<FloatArray>>()
    val hazards=HashMap<Pair<Int,Int>,MutableList<FloatArray>>()
    fun key(p: FloatArray)=floor(p[0]/.2f).toInt() to floor(p[2]/.2f).toInt()
    fun add(map: HashMap<Pair<Int,Int>,MutableList<FloatArray>>,p: FloatArray) { map.getOrPut(key(p)) { ArrayList() }.add(p) }
    var anchorCount=0
    DepthProjection.indexedPoints(raw,camera,fx,fy,cx,cy,tw,th) { i,p ->
      val h=plane.distance(p)
      if (abs(h)<=.025f && dense.millimeters[i] in 200..4000 && abs(raw.millimeters[i]-dense.millimeters[i])<=max(30f,raw.millimeters[i]*.05f)) {
        add(anchors,p);anchorCount++
      } else if (abs(h)>.03f) add(hazards,p)
    }
    if (anchorCount<6) return Result(raw,BooleanArray(raw.millimeters.size),"RAW_ONLY_INSUFFICIENT_PLANE_ANCHORS",anchorCount,errors.size,median)
    fun near(map: HashMap<Pair<Int,Int>,MutableList<FloatArray>>,p: FloatArray,radius: Float): Boolean {
      val k=key(p)
      for (x in -1..1) for (z in -1..1) {
        if (map[(k.first+x) to (k.second+z)]?.any { hypot(it[0]-p[0],it[2]-p[2])<=radius }==true) return true
      }
      return false
    }
    val values=raw.millimeters.clone();val filled=BooleanArray(values.size);var proposed=0;var added=0
    DepthProjection.indexedPoints(dense,camera,fx,fy,cx,cy,tw,th) { i,p ->
      if (abs(plane.distance(p))<=.025f) {
        proposed++
        if (values[i]==0 && near(anchors,p,.20f) && !near(hazards,p,.10f)) {
          values[i]=dense.millimeters[i];filled[i]=true;added++
        }
      }
    }
    return Result(raw.copy(millimeters=values),filled,"RAW_AND_VALIDATED_SMOOTH",anchorCount,errors.size,median,proposed,added)
  }
}
