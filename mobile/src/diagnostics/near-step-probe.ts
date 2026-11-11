import { runFloorVisionProbe } from "./floor-vision-probe";
import { runNativeFieldDiagnostic } from "../../modules/navigation-probe";
import { assessNearStep } from "../navigation/near-step-guard";
import type { FloorRegion } from "../navigation/vision-floor-analysis";

/** Supervised single step. No loop, no general navigation authority. */
export async function runNearStepProbe(args: { operatorConfirmed?: unknown; heightCm?: unknown; roi?: FloorRegion }) {
  if(args?.operatorConfirmed!==true) throw new Error("需要操作者确认当前地板、最低姿态、空地及线缆");
  const observation=await runFloorVisionProbe(args), decision=assessNearStep(observation.analysis);
  if(!decision.allowed) return {observation,decision,motionRequested:false};
  const trial=await runNativeFieldDiagnostic("back_step",true);
  return {observation,decision,trial,motionRequested:true,autonomousNavigationValidated:false};
}
