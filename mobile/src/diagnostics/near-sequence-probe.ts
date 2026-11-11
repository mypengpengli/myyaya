import { beginNativeFieldBatch,stopNativeOperatorObservation } from "../../modules/navigation-probe";
import { runNearStepProbe } from "./near-step-probe";
import type { FloorRegion } from "../navigation/vision-floor-analysis";

/** One explicitly confirmed task, native token and three-step budget. Never auto re-arms. */
export async function runNearSequenceProbe(args: {operatorConfirmed?:unknown;heightCm?:unknown;roi?:FloorRegion;maximumSteps?:unknown}) {
  if(args?.operatorConfirmed!==true) throw new Error("需要确认当前实际地板与线缆");
  if(typeof args.heightCm!=="number" || !Number.isFinite(args.heightCm) || args.heightCm<3 || args.heightCm>50) throw new Error("需要实测镜头高度");
  const count=args.maximumSteps ?? 3;
  if(typeof count!=="number" || !Number.isInteger(count) || count<1 || count>3) throw new Error("一轮仅支持1～3步");
  const batch=await beginNativeFieldBatch(true,args.roi), results: Awaited<ReturnType<typeof runNearStepProbe>>[]=[];
  try {
    for(let i=0;i<count;i++) {
      const result=await runNearStepProbe({...args,batchId:batch.batchId});results.push(result);
      if(!result.motionRequested) return {phase:"perception_stop",batchId:batch.batchId,completedSteps:i,results};
      if(!["READY","COMPLETE"].includes(String(result.trial!.phase))) return {phase:"interrupted",batchId:batch.batchId,completedSteps:i,results};
    }
    return {phase:"budget_complete",batchId:batch.batchId,completedSteps:count,results,goalArrivalClaimed:false};
  } catch(error) {
    return {phase:"error",batchId:batch.batchId,completedSteps:results.filter(r=>r.motionRequested && ["READY","COMPLETE"].includes(String(r.trial?.phase))).length,
      results,error:error instanceof Error?error.message:"观察任务中断"};
  } finally {await stopNativeOperatorObservation();}
}
