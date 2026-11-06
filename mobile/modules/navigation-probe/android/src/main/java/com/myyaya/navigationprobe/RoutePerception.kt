package com.myyaya.navigationprobe

import kotlin.math.*

/** Local sampling is necessary for a taught flat corridor, not a full trajectory proof. */
internal data class RouteAssessment(val clearance: RouteClearance,val reason: String,
  val totalPoints: Int=0,val sweepPoints: Int=0,val lowBandPoints: Int=0,val hazardPoints: Int=0,
  val sectorSamples: List<Int> = List(6) { 0 }) {
  fun report(): Map<String,Any?> = mapOf("clearance" to clearance.name,"reason" to reason,
    "totalPoints" to totalPoints,"sweepPoints" to sweepPoints,"lowBandPoints" to lowBandPoints,"hazardPoints" to hazardPoints,
    "sectorSamples" to sectorSamples,"requiredSectors" to 6,"minimumSamplesPerSector" to 2,
    "missingSectors" to sectorSamples.indices.filter { sectorSamples[it]<2 }.map { SECTORS[it] },
    "scope" to "taught-flat-corridor-observation","motionAuthorized" to false)
  companion object { val SECTORS=listOf("近左","近中","近右","远左","远中","远右") }
}
internal object RoutePerception {
  fun evaluate(points: List<FloatArray>,plane: GroundPlane?,pose: RoutePose?,fresh: Boolean,width: Float,
    length: Float,height: Float,margin: Float,turning: Boolean=false): RouteClearance =
    assess(points,plane,pose,fresh,width,length,height,margin,turning).clearance

  fun assess(points: List<FloatArray>,plane: GroundPlane?,pose: RoutePose?,fresh: Boolean,width: Float,
    length: Float,height: Float,margin: Float,turning: Boolean=false): RouteAssessment {
    fun unknown(reason: String)=RouteAssessment(RouteClearance.DEPTH_UNKNOWN,reason,totalPoints=points.size)
    if (!fresh) return unknown("FRESH_RAW_REQUIRED")
    if (plane==null) return unknown("GROUND_REFERENCE_REQUIRED")
    if (pose==null) return unknown("LOCALIZATION_REQUIRED")
    if (points.size<32) return unknown("SPARSE_RAW_DEPTH")
    val dx=sin(pose.yaw);val dz=-cos(pose.yaw)
    val half=width/2+margin;val radius=hypot(width,length)/2+margin
    val start=length/2+.05f;val end=.45f+length/2;val split=(start+end)/2
    val sectors=List(6) { HashSet<Pair<Int,Int>>() }
    var hazards=0;var sweep=0;var low=0
    for(p in points) {
      if(p.size!=3 || p.any { !it.isFinite() }) continue
      val x=p[0]-pose.x;val z=p[2]-pose.z
      val along=x*dx+z*dz;val lateral=x*cos(pose.yaw)+z*sin(pose.yaw)
      val inFront=along in 0f..end && abs(lateral)<=half
      if (!(inFront || turning && hypot(x,z)<=radius+.12f)) continue
      sweep++
      val h=plane.distance(p)
      if(h in -.04f..(height+.08f)) low++
      if(h< -.04f || h>.03f && h<height+.08f) hazards++
      if(inFront && along>=start && abs(h)<=.025f) {
        val side=if(lateral< -half/3) 0 else if(lateral>half/3) 2 else 1
        val range=if(along<split) 0 else 1
        // Repeated points cannot fill a sector. This is a sampling minimum,
        // not proof that the entire sector or an unobserved turn is free.
        sectors[range*3+side].add(floor(p[0]/.01f).toInt() to floor(p[2]/.01f).toInt())
      }
    }
    val samples=sectors.map { it.size }
    val clearance=if(hazards>=3) RouteClearance.OBSTACLE else if(samples.any { it<2 }) RouteClearance.DEPTH_UNKNOWN else RouteClearance.CLEAR
    val reason=when(clearance) { RouteClearance.OBSTACLE->"LOCAL_HAZARD";RouteClearance.DEPTH_UNKNOWN->"LOCAL_COVERAGE_INCOMPLETE";else->"LOCAL_SAMPLING_PRESENT" }
    return RouteAssessment(clearance,reason,points.size,sweep,low,hazards,samples)
  }
}
