import {getContinuousStatus,getNavigationProbeStatus,startNativeContinuous,observeNativeContinuous,stopNativeContinuous,saveContinuousReport,publishNativeLocalMission} from "../../modules/navigation-probe";
import {prepareNativeNavigationDrive} from "../device-tools/looi-robot";
import {getNavigationControlOwner} from "../core/navigation-control-lease";
import {LocalGoalController} from "../navigation/local-goal-controller";
import {runFloorVisionProbe,releaseContinuousVision} from "./floor-vision-probe";
import type {FloorRegion} from "../navigation/vision-floor-analysis";

let active=false;
/** Neural planner supplies observations; native feedback and watchdog own the motor clock. */
export async function runContinuousGoalMission(args:{operatorConfirmed?:unknown;navigationOwner?:string;goalRightMeters?:unknown;goalForwardMeters?:unknown;roi?:FloorRegion}) {
  if(active)throw new Error("连续导航已经启动");
  if(args.operatorConfirmed!==true)throw new Error("需要确认实际地板和线缆");
  const goal={x:args.goalRightMeters ?? 0,y:args.goalForwardMeters ?? .4};
  if(typeof goal.x!=="number" || typeof goal.y!=="number" || ![goal.x,goal.y].every(Number.isFinite) || Math.hypot(goal.x,goal.y)<.15 || Math.hypot(goal.x,goal.y)>1)throw new Error("目标应在15厘米至1米内");
  active=true;const started=Date.now();let prepared:Awaited<ReturnType<typeof prepareNativeNavigationDrive>>|undefined,token="",error:string|undefined;
  const history:unknown[]=[];let observations=0,failures=0;
  const save=async()=>{const runtime=await getContinuousStatus();const report={...runtime,started,observations,failures,history,error,mode:"native-feedback-continuous",speedCalibration:"provisional",globalLocalizationValidated:false};await saveContinuousReport(report);return report;};
  try {
    const owner=args.navigationOwner ?? getNavigationControlOwner();if(!owner)throw new Error("请先打开路线导航页面");
    const before=await getContinuousStatus(),settings=await getNavigationProbeStatus(),g=settings.navigationGeometry;
    if(!g || !settings.measuredCameraHeightMeters)throw new Error("请先填写车身和镜头实测参数");
    await publishNativeLocalMission("连续绕障：静止预热视觉，选择通过校验的地板区域。");
    const preflight=await runFloorVisionProbe({heightCm:settings.measuredCameraHeightMeters*100,roi:args.roi,navigationCells:false,showOverlay:false,autoFloorRegion:true,liveOnly:true});
    const region=preflight.selectedFloorRegion ?? args.roi ?? {left:.05,top:.68,right:.28,bottom:.93};
    const controller=new LocalGoalController(goal as {x:number;y:number},g,0);
    prepared=await prepareNativeNavigationDrive(owner,()=>{void stopNativeContinuous("运动控制已停止").catch(()=>{});});
    const start=await startNativeContinuous(prepared.device,before.stopEpoch,goal.x as number,goal.y as number,settings.measuredCameraHeightMeters,region);
    token=start.token!;
    await publishNativeLocalMission("连续绕障：正在定位和观察，随后持续调整速度。点停止或说停止可取消。");
    while(Date.now()-started<550_000) {
      const status=await getContinuousStatus();if(status.token!==token || !status.active)break;
      try {
        const result=await runFloorVisionProbe({heightCm:settings.measuredCameraHeightMeters*100,roi:region,navigationCells:true,showOverlay:false,autoFloorRegion:false,liveOnly:true});
        const capture=result.frame.navigationPose as typeof status|undefined;
        if(!capture || capture.token!==token || !capture.poseReady || !capture.pose || Math.abs(Number(result.frame.imageTimestampNs)-Number(capture.frameNs))>150_000_000) {await new Promise(r=>setTimeout(r,100));continue;}
        if(!result.navigationCells)throw new Error("缺少地面分类");
        controller.pose={...capture.pose};controller.observe(result.navigationCells);
        const latest=await getContinuousStatus();if(latest.token!==token || !latest.active)break;
        controller.pose={...latest.pose!};controller.positionUncertaintyMeters=Number(latest.positionUncertaintyMeters ?? 0);
        const plan=controller.plan();
        const obstacles=[...controller.cells.values()].filter(c=>c.label!==1).map(c=>({x:c.x*.05,y:c.y*.05,label:c.label}));
        await observeNativeContinuous(token,{imageNs:result.frame.imageTimestampNs,capture:capture.pose,cells:result.navigationCells,path:plan.path,obstacles});
        observations++;failures=0;
        if(history.length<700)history.push({atMs:Date.now()-started,pose:latest.pose,phase:latest.phase,remaining:latest.remainingMeters,perceptionMs:latest.perceptionAgeMs,plan:plan.phase,speed:latest.sentSpeed,turn:latest.sentTurn,timings:result.timings,path:plan.path.slice(0,15)});
        if(observations%3===0){await save();await publishNativeLocalMission(`连续绕障 · ${latest.phase} · 剩余估计${Math.round(Number(latest.remainingMeters)*100)}厘米 · 视觉更新${observations}次`);}
      } catch(e) {
        failures++;if(history.length<700)history.push({atMs:Date.now()-started,error:e instanceof Error?e.message:String(e)});
        if(failures>=5)throw e;
      }
      await new Promise(r=>setTimeout(r,30));
    }
  } catch(e) {error=e instanceof Error?e.message:String(e);}
  finally {
    await stopNativeContinuous(error ?? "连续任务结束").catch(()=>{});
    for(let n=0;n<10;n++){await new Promise(r=>setTimeout(r,100));const stopped=await getContinuousStatus().catch(()=>null);if(stopped?.stopAcknowledged===true)break;}
    prepared?.finish();await releaseContinuousVision().catch(()=>{});active=false;
  }
  const result=await save();await publishNativeLocalMission(error ? `连续导航已停车：${error}` : `连续导航：${result.phase}，已停车`);return result;
}
