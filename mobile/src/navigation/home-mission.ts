import {getContinuousStatus,getNavigationProbeStatus,startNativeContinuous,observeNativeContinuous,stopNativeContinuous,
  getHomeStatus,getHomePlan,publishHomeProgress,sendHomeCommand,prepareHomeCapture,retargetNativeContinuous,type HomePose} from "../../modules/navigation-probe";
import {prepareNativeNavigationDrive} from "../device-tools/looi-robot";
import {getNavigationControlOwner} from "../core/navigation-control-lease";
import {LocalGoalController} from "./local-goal-controller";
import {runFloorVisionProbe,releaseContinuousVision} from "../diagnostics/floor-vision-probe";
import {HomeRouteCursor,homeToLocal,localToHome} from "./home-route";

let active=false;
export async function waitForHomeMission(){while(active)await new Promise(r=>setTimeout(r,30));}
/** One native motor task for the entire taught graph route, including local detours. */
export async function runHomeMission() {
  if(active)throw new Error("家庭导航已经启动");active=true;
  try {for(let attempt=0;attempt<4;attempt++)if(!await executeHomeMission(attempt<3))break;}
  finally {active=false;}
}
async function executeHomeMission(allowReplan:boolean):Promise<boolean> {
  let retry=false,blockedPoint:HomePose|undefined,measuredDistanceCm:number|undefined,goalErrorCm:number|undefined;
  let prepared:Awaited<ReturnType<typeof prepareNativeNavigationDrive>>|undefined,token="",taskId="",failure="",targetName="",completed=false;
  let inspection:Awaited<ReturnType<typeof import("../inspection/inspection-mission").beginInspection>>;
  const stopOwn=async(reason:string)=>{
    if(token && (await getContinuousStatus()).token===token)await stopNativeContinuous(reason);
  };
  const started=Date.now();
  try {
    const owner=getNavigationControlOwner();if(!owner)throw new Error("请打开家庭导航");
    const initial=await getHomePlan();
    if(initial.mode==="explore"){await (await import("./home-exploration-mission")).runHomeExplorationMission(initial);return false;}
    if(initial.mode==="patrol"){await (await import("./nearby-patrol-mission")).runNearbyPatrolMission(initial);return false;}
    taskId=initial.taskId;
    const before=await getContinuousStatus(),settings=await getNavigationProbeStatus(),g=settings.navigationGeometry;
    if(!g || !settings.measuredCameraHeightMeters)throw new Error("请填写车身和镜头标定");
    await prepareHomeCapture();
    const preflight=await runFloorVisionProbe({heightCm:settings.measuredCameraHeightMeters*100,autoFloorRegion:true,navigationCells:initial.mode==="distance",showOverlay:false,liveOnly:true});
    // Warm-up may take seconds; re-read the actual position, task and map before issuing any motor frame.
    if(initial.mode==="distance"){
      const captured=preflight.frame.homePose as {pose:HomePose;mapId:string;poseRevision:number;frameNs:number}|undefined;
      if(!captured?.pose || captured.mapId!==initial.mapId || captured.poseRevision!==initial.poseRevision || Math.abs(Number(captured.frameNs)-Number(preflight.frame.imageTimestampNs))>150_000_000)throw new Error("缺少与地面帧同步的家庭定位");
      const cells=(await import("../inspection/inspection-coverage")).mergeInspectionCoverage([],preflight.navigationCells!,{x:0,y:0,yaw:0},captured.pose,g.centerRightMeters,g.alongViewMeters);
      await sendHomeCommand({op:"spatial_observe",taskId,cells});
    }
    const plan=await getHomePlan();if(plan.taskId!==taskId || plan.revision!==initial.revision)throw new Error("任务或地图已变化");
    if(plan.mode==="distance"){
      const result=await sendHomeCommand({op:"spatial_route",taskId,target:plan.points.at(-1)});
      if(!result.spatialPath?.length)throw new Error("没有已观察的距离行驶路径");
      plan.points=result.spatialPath;
    }
    targetName=plan.targetName;
    const origin=plan.origin,points=plan.points.map(p=>homeToLocal(p,origin));
    if(plan.inspectionId)inspection=await (await import("../inspection/inspection-mission")).beginInspection(plan);
    const stops=plan.inspectionStops ?? [];let stopIndex=0;
    const done=[...(plan.inspectionDone ?? [])];
    let coverage=JSON.parse(plan.coverage ?? "[]") as Array<[number,number,number]>;
    if(!inspection && plan.mode!=="distance" && Math.hypot(points.at(-1)!.x,points.at(-1)!.y)<=.06){completed=true;return false;}
    if(inspection && points.every(p=>Math.hypot(p.x,p.y)<.005))points.push({x:0,y:.035,yaw:0});
    const cursor=new HomeRouteCursor(points),first=cursor.select({x:0,y:0,yaw:0},stops[0]?.arc);
    if(inspection && Math.hypot(first.target.x,first.target.y)<.03)first.target={x:0,y:.035,yaw:0};
    const controller=new LocalGoalController({x:0,y:.15},g,0,plan.mode==="distance"?.01:.06);controller.setGoal(first.target);
    controller.setForbidden(plan.zones.map(z=>({...homeToLocal({...z,yaw:0},origin),radius:z.radius})));
    let region=preflight.selectedFloorRegion!,previous=first.target,previousFinal=first.final;
    prepared=await prepareNativeNavigationDrive(owner,()=>{void stopOwn("家庭导航控制已停止").catch(()=>{});});
    const start=await startNativeContinuous(prepared.device,before.stopEpoch,first.target.x,first.target.y,settings.measuredCameraHeightMeters,region,first.final,{goalToleranceMeters:plan.mode==="distance"?.01:.06,maximumMs:inspection?1_210_000:550_000});
    token=start.token!;
    await publishHomeProgress({taskId,phase:"RUNNING",nativeToken:token,total:cursor.total,waypoint:0});
    let errors=0,lostAt=0,bestProgress=0,progressAt=Date.now(),lastGlobal=0;
    while(Date.now()-started<(inspection?1_200_000:540_000)) {
      const status=await getContinuousStatus();if(status.token!==token)throw new Error("导航控制会话已变化");
      if(!status.active){completed=status.phase==="AT_GOAL" && stopIndex>=stops.length;if(completed && plan.mode==="distance" && status.pose){
          measuredDistanceCm=Math.round(Math.hypot(status.pose.x,status.pose.y)*1000)/10;
          const goal=points.at(-1)!;goalErrorCm=Math.round(Math.hypot(status.pose.x-goal.x,status.pose.y-goal.y)*1000)/10;
        }
        if(!completed){
          failure=String(status.reason ?? status.phase);
          if(allowReplan && status.phase==="BLOCKED" && status.pose){
            const p=status.pose;blockedPoint=localToHome({x:p.x+Math.sin(p.yaw)*.16,y:p.y+Math.cos(p.yaw)*.16,yaw:p.yaw},origin);
          }
        }break;}
      const home=await getHomeStatus();
      if(!home.atlas || home.atlas.mapId!==plan.mapId || home.atlas.revision!==plan.revision || home.poseRevision!==plan.poseRevision)throw new Error("地图或定位起点改变，请重新定位后继续");
      if(!home.connectionConfirmed)throw new Error("连接已变化，请重新确认最低姿态");
      if(!home.localized) {lostAt ||= Date.now();if(Date.now()-lostAt>1200)throw new Error("家庭位置暂时丢失，请恢复定位后继续");}
      else lostAt=0;
      try {
        const result=await runFloorVisionProbe({heightCm:settings.measuredCameraHeightMeters*100,roi:region,autoFloorRegion:true,navigationCells:true,showOverlay:false,liveOnly:true});
        region=result.selectedFloorRegion ?? region;
        const capture=result.frame.navigationPose as typeof status|undefined;
        if(!capture?.poseReady || capture.token!==token || !capture.pose || Math.abs(Number(result.frame.imageTimestampNs)-Number(capture.frameNs))>150_000_000)continue;
        const latest=await getContinuousStatus();if(latest.token!==token || !latest.active)continue;
        const pose=latest.pose!;controller.pose={...capture.pose};controller.observe(result.navigationCells!);controller.pose={...pose};
        controller.positionUncertaintyMeters=Number(latest.positionUncertaintyMeters ?? 0);
        const stop=stops[stopIndex];
        if(inspection && stop && latest.phase==="WAYPOINT_REACHED" && latest.stopAcknowledged===true && Math.hypot(pose.x-homeToLocal(stop.pose,origin).x,pose.y-homeToLocal(stop.pose,origin).y)<=.065) {
          await inspection.capture(stop.id,stop.name,localToHome(pose,origin),token,stop.id);done.push(stop.id);stopIndex++;cursor.advanceTo(stop.arc);
          if(plan.inspectionAction==="rescan")coverage=(await import("../inspection/inspection-coverage")).mergeInspectionCoverage(coverage,result.navigationCells!,capture.pose,origin,g.centerRightMeters,g.alongViewMeters);
          await publishHomeProgress({taskId,phase:"RUNNING",inspectionDone:done,...(plan.inspectionAction==="rescan"?{coverage}:{}),reason:"观察点结果已记录，继续任务并返回"});
        }
        const next=cursor.select(pose as HomePose,stops[stopIndex]?.arc);
        if(next.progress>bestProgress+.01){bestProgress=next.progress;progressAt=Date.now();}
        if(Date.now()-progressAt>18_000 && allowReplan){
          blockedPoint=localToHome({x:pose.x+Math.sin(pose.yaw)*.16,y:pose.y+Math.cos(pose.yaw)*.16,yaw:pose.yaw},origin);
          throw new Error("路线受阻，正在查询其他已观测通道");
        }
        if(Date.now()-progressAt>35_000)throw new Error("路线持续无进展，请检查障碍后继续");
        if(Date.now()-lastGlobal>2200){
          const cells=(await import("../inspection/inspection-coverage")).mergeInspectionCoverage([],result.navigationCells!,capture.pose,origin,g.centerRightMeters,g.alongViewMeters);
          await sendHomeCommand({op:"spatial_observe",taskId,cells});lastGlobal=Date.now();
        }
        if(Math.hypot(next.target.x-previous.x,next.target.y-previous.y)>.025 || next.final!==previousFinal) {
          controller.setGoal(next.target);await retargetNativeContinuous(token,next.target,next.final);previous=next.target;previousFinal=next.final;
        }
        const local=controller.plan();const obstacles=controller.occupiedCells();
        await observeNativeContinuous(token,{imageNs:result.frame.imageTimestampNs,capture:capture.pose,cells:result.navigationCells,path:local.path,obstacles});
        await publishHomeProgress({taskId,phase:"RUNNING",waypoint:next.progress,total:next.total,remainingMeters:Math.max(0,next.total-next.progress),pose,
          reason:local.reason ? "正在重新观察可通行路线" : String(latest.reason ?? "正在行驶")});
        errors=0;
      }catch(e) {if(++errors>=3)throw e;}
      await new Promise(r=>setTimeout(r,30));
    }
    if(!completed && !failure)failure="本轮导航达到时间上限，可定位后继续原目的地";
  } catch(e){failure=e instanceof Error?e.message:String(e);}
  finally {
    try {
    await stopOwn(failure || "家庭任务已结束").catch(()=>{});
    let stopped=false;
    for(let i=0;i<15;i++){const status=await getContinuousStatus().catch(()=>null);if(!token || status?.token===token && status.stopAcknowledged===true){stopped=true;break;}await new Promise(r=>setTimeout(r,100));}
    prepared?.finish();await releaseContinuousVision().catch(()=>{});
    if(inspection){const home=await getHomeStatus().catch(()=>null);const phase=home?JSON.parse(home.task).phase:"";inspection.finish(completed && stopped,completed && stopped?"已返回出发位置并停车":failure || "尚未确认停车或返回",phase==="CANCELLED");}
    if(taskId)await publishHomeProgress({taskId,phase:completed && stopped?"COMPLETED":"BLOCKED",measuredDistanceCm,goalErrorCm,reason:!stopped?"已请求停车，尚未收到回执":failure || "已到达并停车"}).catch(()=>{});
    if(taskId && stopped && blockedPoint && allowReplan){
      try {await sendHomeCommand({op:"replan",taskId,blocked:blockedPoint});retry=true;}catch{/* Preserve the original blocked task when there is no alternative. */}
    }
    if(taskId && !retry)await import("react-native").then(async n=>{
      if(n.AppState.currentState!=="active")return;
      const {announceNavigation}=await import("./navigation-speech");
      await announceNavigation(completed && stopped?measuredDistanceCm!==undefined?`已按视觉定位行驶并停车，估计移动${measuredDistanceCm}厘米。`:inspection?"已经返回出发位置，观察点结果已记录，正在整理。":`已经到达${targetName}`:`导航已暂停，${failure || "请查看屏幕提示"}`);
    }).catch(()=>{});
    } finally {/* The wrapper retains ownership across alternate routes. */}
  }
  return retry;
}
