import * as FileSystem from "expo-file-system/legacy";
import { beginNativeLocalMission,getNavigationProbeStatus,publishNativeLocalMission,runNativeFieldDiagnostic,setNativeLocalMissionRegion,stopNativeOperatorObservation } from "../../modules/navigation-probe";
import { LocalGoalController,cameraYaw } from "../navigation/local-goal-controller";
import { assessNearStep } from "../navigation/near-step-guard";
import { runFloorVisionProbe } from "./floor-vision-probe";
import type { FloorRegion } from "../navigation/vision-floor-analysis";

let active=false;
/** One persistent goal/task. Pauses and user stop invalidate the native token, never auto re-arm. */
export async function runLocalGoalMission(args:{operatorConfirmed?:unknown;heightCm?:unknown;roi?:FloorRegion;goalRightMeters?:unknown;goalForwardMeters?:unknown;maximumSteps?:unknown}) {
  if(active) throw new Error("已有局部导航任务");
  if(args?.operatorConfirmed!==true || typeof args.heightCm!=="number" || !Number.isFinite(args.heightCm) || args.heightCm<3 || args.heightCm>50) throw new Error("需要确认地板、线缆与实测镜头高度");
  const goal={x:args.goalRightMeters ?? 0,y:args.goalForwardMeters ?? .4},maximumSteps=args.maximumSteps ?? 80;
  if(typeof goal.x!=="number" || typeof goal.y!=="number" || ![goal.x,goal.y].every(Number.isFinite) || Math.hypot(goal.x,goal.y)<.15 || Math.hypot(goal.x,goal.y)>1
    || typeof maximumSteps!=="number" || !Number.isInteger(maximumSteps) || maximumSteps<1 || maximumSteps>80) throw new Error("目标应在15厘米至1米内，动作不超过80次");
  active=true;const started=Date.now(),history:Record<string,unknown>[]=[];
  let controller:LocalGoalController|undefined,batchId="",phase="STARTING",error:string|undefined,scanCount=0;
  let path="";
  const save=async(note:string)=>{
    const report={phase,batchId,goal,pose:controller?.pose,remainingMeters:controller?.distance(),steps:history.length,elapsedMs:Date.now()-started,history,error,estimatedArrival:phase==="AT_GOAL",globalLocalizationValidated:false};
    if(path) await FileSystem.writeAsStringAsync(path,JSON.stringify(report));await publishNativeLocalMission(`${note}\n局部目标前${(goal.y as number)*100}厘米 / 右${(goal.x as number)*100}厘米 · 动作${history.length}/${maximumSteps}${controller?` · 剩余估计${Math.round(controller.distance()*100)}厘米`:""}`);return report;
  };
  try {
    const status=await getNavigationProbeStatus();path=`file://${status.dataDirectory}/local-goal-mission.json`;
    const batch=await beginNativeLocalMission(true,args.roi);batchId=batch.batchId;
    for(let n=0;n<maximumSteps && Date.now()-started<550_000;n++) {
      phase="OBSERVING";await save("绕障任务：观察地面和障碍");
      const observation=await runFloorVisionProbe({...args,navigationCells:true,showOverlay:false,autoFloorRegion:true});
      if(!observation.geometry || !observation.navigationCells) throw new Error("缺少实测车身参数或局部观测");
      const heading=cameraYaw(observation.frame.cameraQuaternion as number[]);
      controller ??=new LocalGoalController(goal as {x:number;y:number},observation.geometry,heading);
      controller.setHeading(heading);controller.observe(observation.navigationCells);
      const plan=controller.plan();phase=plan.phase;
      if(phase==="AT_GOAL") return await save("局部目标已到达估计范围，已停车");
      if(phase==="NO_PROGRESS") throw new Error("长时间无有效进展，需要重新观察");
      let direction:"left_step"|"right_step"|"back_step",durationMs:number,decision=assessNearStep(observation.analysis,observation.geometry);
      if(plan.turn) {direction=plan.turn;durationMs=plan.turnMs!;scanCount=0;}
      else if(phase==="ADVANCE" && decision.allowed) {direction="back_step";durationMs=controller.distance()<.11?150:decision.durationMs;scanCount=0;}
      else {if(scanCount++>=8) throw new Error(`观察后仍无可行方向：${decision.reason}`);direction=scanCount<=4?"right_step":"left_step";durationMs=150;phase="OBSERVE_SIDE";}
      // In-place sweep includes the actual body radius; thin <=2cm surfaces are floor labels.
      if(direction!=="back_step") {
        const g=observation.geometry,radius=Math.hypot(g.widthMeters,g.lengthMeters)/2+.005;
        if(observation.navigationCells.some(([x,y,label])=>label!==1 && Math.hypot(x-g.centerRightMeters,y-g.alongViewMeters)<radius)) throw new Error("实体障碍进入原地转身范围");
      }
      await setNativeLocalMissionRegion(batchId,observation.selectedFloorRegion);
      await save(direction==="back_step"?"绕障任务：前进并重看地面":direction==="right_step"?"绕障任务：向右调整路线":"绕障任务：向左调整路线");
      const trial=await runNativeFieldDiagnostic(direction,true,durationMs,batchId),segment=trial.lastSegment as Record<string,any>|undefined;
      if(!["READY","COMPLETE"].includes(String(trial.phase)) || !segment?.completed) throw new Error(String(trial.startFailureDetail || trial.reason || "本段运动中断"));
      controller.applyMotion(segment);
      history.push({n:n+1,direction,durationMs,pose:{...controller.pose},obstacleMeters:observation.analysis.nearestObstacleEstimateMeters,
        chosenFloorRegion:observation.selectedFloorRegion,frame:observation.frame.requestId,path:plan.path.slice(0,10),headingError:plan.headingError,remainingMeters:controller.distance(),stopAcknowledged:segment.motorStopAcknowledged});
      await save("本段已停稳，继续规划至同一个目标");
    }
    phase="TASK_LIMIT";return await save("达到本轮时间或动作上限，已停车，目标尚未确认到达");
  } catch(value) {phase="INTERRUPTED";error=value instanceof Error?value.message:String(value);return await save(`绕障任务暂停：${error}`);}
  finally {try {await stopNativeOperatorObservation();} finally {active=false;await publishNativeLocalMission(phase==="AT_GOAL"?"绕障任务：已到达局部目标估计范围，已停车":`绕障任务：${error ?? phase}，已停车`);}}
}
