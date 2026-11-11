import { runFloorVisionProbe } from "./floor-vision-probe";
import { runNativeFieldDiagnostic,stopNativeOperatorObservation,beginNativeFieldBatch } from "../../modules/navigation-probe";
import { assessNearStep } from "../navigation/near-step-guard";
import type { FloorRegion } from "../navigation/vision-floor-analysis";

/** Supervised single step. No loop, no general navigation authority. */
export async function runNearStepProbe(args: { operatorConfirmed?: unknown; heightCm?: unknown; roi?: FloorRegion; batchId?: string }) {
  if(args?.operatorConfirmed!==true) throw new Error("需要操作者确认当前地板、最低姿态、空地及线缆");
  const ownBatch=!args.batchId;
  const batchId=args.batchId ?? (await beginNativeFieldBatch(true,args.roi)).batchId;
  try {
  const observation=await runFloorVisionProbe(args), decision=assessNearStep(observation.analysis,observation.geometry);
  if(!decision.allowed) {if(!ownBatch) await stopNativeOperatorObservation();return {observation,decision,motionRequested:false};}
  const trial=await runNativeFieldDiagnostic("back_step",true,decision.durationMs,batchId);
  return {observation,decision,trial,motionRequested:true,autonomousNavigationValidated:false};
  } finally {if(ownBatch) await stopNativeOperatorObservation();}
}
