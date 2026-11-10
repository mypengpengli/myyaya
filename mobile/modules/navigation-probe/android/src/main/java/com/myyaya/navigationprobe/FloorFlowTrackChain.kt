package com.myyaya.navigationprobe

/** Every link uses ARCore's common gravity-aligned XZ basis, never its translation.
 * A new unlinked feature seed cannot restore the old origin or silently publish zero.
 */
internal class FloorFlowTrackChain {
  var originNs=0L;private set
  var keyframeNs=0L;private set
  var continuous=true;private set
  var links=0;private set
  var segments=0;private set
  var dx=0.0;private set
  var dz=0.0;private set
  private var segmentDx=0.0
  private var segmentDz=0.0
  fun reset() { originNs=0;keyframeNs=0;continuous=true;links=0;segments=0;dx=0.0;dz=0.0;segmentDx=0.0;segmentDz=0.0 }
  fun seed(time: Long) {
    require(time>0)
    if(originNs==0L) originNs=time else continuous=false
    keyframeNs=time;segments++;segmentDx=0.0;segmentDz=0.0
  }
  fun accept(from: Long,to: Long,step: FloorFlowGeometry.Estimate): Boolean {
    if(originNs==0L || from!=keyframeNs || to<=from || !step.dx.isFinite() || !step.dz.isFinite()) return false
    segmentDx+=step.dx;segmentDz+=step.dz
    if(continuous) { dx+=step.dx;dz+=step.dz }
    keyframeNs=to;links++;return true
  }
  fun report(available: Boolean): Map<String,Any?> = mapOf("originTimestampNs" to originNs,
    "keyframeTimestampNs" to keyframeNs,"originContinuity" to continuous,
    "cumulativePoseAvailable" to (available && continuous),"acceptedLinks" to links,"segments" to segments,
    "segmentDxMeters" to if(available) segmentDx else null,"segmentDzMeters" to if(available) segmentDz else null,
    "cumulativeCameraDxMeters" to if(available && continuous) dx else null,
    "cumulativeCameraDzMeters" to if(available && continuous) dz else null)
}
