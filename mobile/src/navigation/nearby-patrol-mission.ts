import {getContinuousStatus,getNavigationProbeStatus,startNativeContinuous,observeNativeContinuous,stopNativeContinuous,
  getHomeStatus,getHomePlan,publishHomeProgress,prepareHomeCapture,retargetNativeContinuous,type HomePlan,type HomePose} from "../../modules/navigation-probe";
import {prepareNativeNavigationDrive} from "../device-tools/looi-robot";
import {getNavigationControlOwner} from "../core/navigation-control-lease";
import {LocalGoalController} from "./local-goal-controller";
import {runFloorVisionProbe,releaseContinuousVision} from "../diagnostics/floor-vision-probe";
import {homeToLocal,localToHome} from "./home-route";
import {NearbyPatrol} from "./nearby-patrol";

/** Uses the same native feedback/obstacle checks as destination navigation; no timed blind walk. */
export async function runNearbyPatrolMission(initial: HomePlan) {
  const started=Date.now();let token="",failure="",completed=false,returned=false, departingSpoken=false, returningSpoken=false;
  let prepared:Awaited<ReturnType<typeof prepareNativeNavigationDrive>>|undefined;
  let checkpoint:Record<string,unknown>={};
  let inspection:Awaited<ReturnType<typeof import("../inspection/inspection-mission").beginInspection>>;
  const stopOwn=async(reason:string)=>{if(token && (await getContinuousStatus()).token===token)await stopNativeContinuous(reason);};
  try {
    const owner=getNavigationControlOwner();if(!owner)throw new Error("请打开家庭地图");
    const settings=await getNavigationProbeStatus(),g=settings.navigationGeometry;
    if(!g || !settings.measuredCameraHeightMeters)throw new Error("请填写车身与镜头标定");
    const before=await getContinuousStatus();await prepareHomeCapture();
    const warm=await runFloorVisionProbe({heightCm:settings.measuredCameraHeightMeters*100,autoFloorRegion:true,navigationCells:false,showOverlay:false,liveOnly:true});
    const plan=await getHomePlan();
    if(plan.taskId!==initial.taskId || plan.revision!==initial.revision || plan.mode!=="patrol")throw new Error("巡游任务或地图已变化");
    if(plan.inspectionId)inspection=await (await import("../inspection/inspection-mission")).beginInspection(plan);
    const origin=plan.origin,returnPoint=homeToLocal(JSON.parse(plan.patrolStart!),origin);
    const trail=(JSON.parse(plan.patrolTrail!) as HomePose[]).map(p=>homeToLocal(p,origin));
    const saved=JSON.parse(plan.coverage ?? "[]") as Array<[number,number,number]>;
    if(saved.length>8000 || saved.some(c=>c.length!==3 || !c.every(Number.isFinite)))throw new Error("附近观察地图无效");
    const coverage=new Map(saved.map(c=>[`${Math.round(c[0]*20)},${Math.round(c[1]*20)}`,c]));
    const tour=new NearbyPatrol(returnPoint,trail,saved.filter(c=>c[2]===1).map(c=>homeToLocal({x:c[0],y:c[1],yaw:0},origin)));
    const controller=new LocalGoalController({x:0,y:.15},g,0);
    controller.setForbidden(plan.zones.map(z=>({...homeToLocal({...z,yaw:0},origin),radius:z.radius})));
    let region=warm.selectedFloorRegion!,lastGoal={x:0,y:.15,yaw:0},lastFinal=false,errors=0,lastSave=0;
    const offset=Number(plan.patrolElapsedMs ?? 0);
    if(offset>=tour.maximumMs)throw new Error("原巡游已达到2分钟上限，请重新开始或选择已知地点返回");
    prepared=await prepareNativeNavigationDrive(owner,()=>{void stopOwn("巡游已停止").catch(()=>{});});
    const start=await startNativeContinuous(prepared.device,before.stopEpoch,0,.15,settings.measuredCameraHeightMeters,region,false);
    token=start.token!;if(!token)throw new Error("未建立本地巡游控制");
    await publishHomeProgress({taskId:plan.taskId,phase:"RUNNING",reason:"正在观察附近地面，尚未宣布房间建图完成"});
    while(Date.now()-started+offset<tour.maximumMs) {
      const status=await getContinuousStatus();if(status.token!==token)throw new Error("导航控制会话已变化");
      if(!status.active){completed=returned && tour.moved && status.phase==="AT_GOAL";if(!completed)failure=!tour.moved?"附近尚无可达观察点，本轮未开始巡游":String(status.reason ?? status.phase);break;}
      const home=await getHomeStatus();
      if(home.atlas?.mapId!==plan.mapId || home.atlas.revision!==plan.revision || home.poseRevision!==plan.poseRevision)throw new Error("地图或定位起点已变化，巡游暂停");
      if(!home.connectionConfirmed || !home.localized)throw new Error("连接、姿态或定位失效，巡游暂停");
      try {
        const result=await runFloorVisionProbe({heightCm:settings.measuredCameraHeightMeters*100,roi:region,autoFloorRegion:true,navigationCells:true,showOverlay:false,liveOnly:true});
        region=result.selectedFloorRegion ?? region;
        const capture=result.frame.navigationPose as typeof status|undefined;
        if(!capture?.poseReady || capture.token!==token || !capture.pose || Math.abs(Number(result.frame.imageTimestampNs)-Number(capture.frameNs))>150_000_000){await new Promise(r=>setTimeout(r,60));continue;}
        const latest=await getContinuousStatus();if(latest.token!==token || !latest.active)continue;
        if(!result.navigationCells || !latest.pose)throw new Error("缺少实时地面或位姿");
        controller.pose={...capture.pose};controller.observe(result.navigationCells);controller.pose={...latest.pose};
        controller.positionUncertaintyMeters=Number(latest.positionUncertaintyMeters ?? 0);
        let waitingForPhotoStop=false;
        if(inspection && !tour.returning && inspection.count()<4) {
          const distance=Math.hypot(latest.pose.x-lastGoal.x,latest.pose.y-lastGoal.y);
          waitingForPhotoStop=distance<.08 && latest.phase!=="WAYPOINT_REACHED";
          if(latest.phase==="WAYPOINT_REACHED" && latest.stopAcknowledged===true)await inspection.capture(`point-${Math.round(lastGoal.x*10)}_${Math.round(lastGoal.y*10)}`,plan.roomName ?? "当前位置",localToHome(latest.pose,origin),token);
        }
        const elapsed=Date.now()-started+offset;
        const next:ReturnType<NearbyPatrol["select"]>=waitingForPhotoStop?{target:lastGoal,final:lastFinal,returning:tour.returning}:tour.select(controller,elapsed);returned=next.returning;
        if(Math.hypot(next.target.x-lastGoal.x,next.target.y-lastGoal.y)>.01 || next.final!==lastFinal) {
          controller.setGoal(next.target);await retargetNativeContinuous(token,next.target,next.final);lastGoal=next.target;lastFinal=next.final;
        }
        const local=controller.plan();
        const path=local.path.every(p=>Math.hypot(p.x-returnPoint.x,p.y-returnPoint.y)<=tour.radius)?local.path:[];
        await observeNativeContinuous(token,{imageNs:result.frame.imageTimestampNs,capture:capture.pose,cells:result.navigationCells,path,obstacles:controller.occupiedCells()});
        for(const c of controller.cells.values())if([1,2,3,4].includes(c.label)) {
          const p=localToHome({x:c.x*controller.cellMeters,y:c.y*controller.cellMeters,yaw:0},origin);
          if(Math.hypot(p.x-plan.origin.x,p.y-plan.origin.y)>2)continue;
          const x=Math.round(p.x*20),y=Math.round(p.y*20);coverage.delete(`${x},${y}`);coverage.set(`${x},${y}`,[x/20,y/20,c.label]);
        }
        while(coverage.size>8000)coverage.delete(coverage.keys().next().value!);
        checkpoint={patrolTrail:tour.trail.map(p=>localToHome(p,origin)),patrolElapsedMs:elapsed,coverage:[...coverage.values()]};
        if ((tour.moved && !departingSpoken) || (tour.moved && returned && !returningSpoken)) {
          const returning = returned;
          departingSpoken = true;
          if (returning) returningSpoken = true;
          void import("../../modules/vosk-command-recognizer").then(({default:voice}) =>
            voice.speakChinese(returning ? "观察点已记录，我开始返回起点。" : "已开始移动，正在观察附近地面。")).catch(()=>{});
        }
        if(Date.now()-lastSave>3000){lastSave=Date.now();await publishHomeProgress({taskId:plan.taskId,phase:"RUNNING",...checkpoint,
          reason:returned?tour.reason:"正在附近观察，绿色为已观察地面；最多80厘米范围"});}
        errors=0;
      }catch(e){if(++errors>=3)throw e;}
      await new Promise(r=>setTimeout(r,40));
    }
    if(!completed && !failure)failure="附近巡游达到2分钟上限，已停车，尚未确认返回起点";
  }catch(e){failure=e instanceof Error?e.message:String(e);}
  finally {
    await stopOwn(failure || "附近巡游结束").catch(()=>{});
    let stopped=!token;
    for(let i=0;token && i<15;i++){const s=await getContinuousStatus().catch(()=>null);if(s?.token===token && s.stopAcknowledged===true){stopped=true;break;}await new Promise(r=>setTimeout(r,100));}
    prepared?.finish();await releaseContinuousVision().catch(()=>{});
    const success=completed && stopped;
    if(inspection){const home=await getHomeStatus().catch(()=>null);const phase=home?JSON.parse(home.task).phase:"";inspection.finish(success,success?"已返回出发位置并停车":failure || "尚未确认停车或返回",phase==="CANCELLED");}
    await publishHomeProgress({taskId:initial.taskId,phase:success?"COMPLETED":"BLOCKED",...checkpoint,
      reason:success?"附近短巡游已返回起点并停车，不代表整个房间探索完毕":!stopped?"已请求停车，尚未收到回执":failure}).catch(()=>{});
    await import("react-native").then(async n=>{
      if(n.AppState.currentState!=="active")return;
      const {default:voice}=await import("../../modules/vosk-command-recognizer");
      await voice.speakChinese(success?"附近逛完，已经回到起点。":`巡游已暂停，${failure || "请查看屏幕"}`);
    }).catch(()=>{});
  }
}
