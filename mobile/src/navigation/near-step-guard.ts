export type NearStepGeometry = { centerRightMeters:number; alongViewMeters:number; widthMeters:number; lengthMeters:number; marginMeters:number };
type ClearanceEvidence = {frontReachMeters:number;estimatedBodyGapMeters:number|null;conservativeBodyGapMeters:number|null;
  rangeAllowanceMeters:number|null;reserveMeters:number;provisionalAllowances:boolean};
export type NearStepDecision = ({allowed:false;reason:string} & Partial<ClearanceEvidence>) |
  ({allowed:true;reason:string;durationMs:150|250;plannedTravelBoundMeters:number} & ClearanceEvidence);

/** Camera distance is not body clearance. Allowances are provisional supervised-test bounds. */
export function assessNearStep(report: { reason: string; nearFloorObserved: boolean; corridorDropPixels: number;
  nearestObstacleEstimateMeters: number|null; fitInlierRatio: number; heldoutFloorP90HeightErrorMeters: number },geometry?: NearStepGeometry|null): NearStepDecision {
  if(!geometry || ![geometry.centerRightMeters,geometry.alongViewMeters,geometry.widthMeters,geometry.lengthMeters,geometry.marginMeters].every(Number.isFinite)
    || geometry.widthMeters<.1-1e-6 || geometry.widthMeters>1+1e-6 || geometry.lengthMeters<.1-1e-6 || geometry.lengthMeters>1+1e-6
    || geometry.marginMeters<.02-1e-6 || geometry.marginMeters>.3+1e-6 || Math.abs(geometry.alongViewMeters)>.3+1e-6 || Math.abs(geometry.centerRightMeters)>.3+1e-6) return {allowed:false,reason:"NAVIGATION_GEOMETRY_REQUIRED"};
  if(![report.corridorDropPixels,report.fitInlierRatio,report.heldoutFloorP90HeightErrorMeters].every(Number.isFinite)
    || report.fitInlierRatio<0 || report.fitInlierRatio>1 || report.corridorDropPixels<0
    || (report.nearestObstacleEstimateMeters!==null && (!Number.isFinite(report.nearestObstacleEstimateMeters) || report.nearestObstacleEstimateMeters<=0))) return {allowed:false,reason:"INVALID_OBSERVATION"};
  if(report.corridorDropPixels>=12 || report.reason==="POSSIBLE_DROP_IN_CORRIDOR") return {allowed:false,reason:"POSSIBLE_DROP"};
  const frontReachMeters=Math.max(0,geometry.alongViewMeters+geometry.lengthMeters/2), obstacle=report.nearestObstacleEstimateMeters;
  const rangeAllowanceMeters=obstacle===null ? null : Math.max(.02,obstacle*.2);
  const estimatedBodyGapMeters=obstacle===null ? null : obstacle-frontReachMeters;
  const conservativeBodyGapMeters=obstacle===null ? null : obstacle-frontReachMeters-rangeAllowanceMeters!;
  const reserveMeters=geometry.marginMeters+.01;
  const evidence={frontReachMeters,estimatedBodyGapMeters,conservativeBodyGapMeters,rangeAllowanceMeters,reserveMeters,provisionalAllowances:true};
  if(report.nearFloorObserved!==true || report.fitInlierRatio<.65 || report.heldoutFloorP90HeightErrorMeters>.03) return {allowed:false,reason:"NEAR_FLOOR_UNCERTAIN",...evidence};
  for(const [durationMs,plannedTravelBoundMeters] of [[250,.05],[150,.03]] as const) {
    if(conservativeBodyGapMeters===null || conservativeBodyGapMeters>=plannedTravelBoundMeters+reserveMeters) return {
      allowed:true,reason:"OBSERVED_NEAR_FLOOR_AND_BODY_CLEARANCE",durationMs,plannedTravelBoundMeters,...evidence };
  }
  return {allowed:false,reason:"BODY_CLEARANCE_RESERVE",...evidence};
}
