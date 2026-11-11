/** Explicit operator experiment. Partial far view does not block an observed near strip. */
export function assessNearStep(report: { reason: string; nearFloorObserved: boolean; corridorDropPixels: number;
  nearestObstacleEstimateMeters: number|null; fitInlierRatio: number; heldoutFloorP90HeightErrorMeters: number }) {
  if(![report.corridorDropPixels,report.fitInlierRatio,report.heldoutFloorP90HeightErrorMeters].every(Number.isFinite)
    || report.fitInlierRatio<0 || report.fitInlierRatio>1 || report.corridorDropPixels<0
    || (report.nearestObstacleEstimateMeters!==null && (!Number.isFinite(report.nearestObstacleEstimateMeters) || report.nearestObstacleEstimateMeters<=0))) return {allowed:false,reason:"INVALID_OBSERVATION"};
  if(report.corridorDropPixels>=12 || report.reason==="POSSIBLE_DROP_IN_CORRIDOR") return {allowed:false,reason:"POSSIBLE_DROP"};
  if(report.nearestObstacleEstimateMeters!==null && report.nearestObstacleEstimateMeters<.35) return {allowed:false,reason:"OBSTACLE_RESERVE"};
  if(report.nearFloorObserved!==true || report.fitInlierRatio<.65 || report.heldoutFloorP90HeightErrorMeters>.03) return {allowed:false,reason:"NEAR_FLOOR_UNCERTAIN"};
  return {allowed:true,reason:"OPERATOR_AREA_AND_NEAR_FLOOR",durationMs:150};
}
