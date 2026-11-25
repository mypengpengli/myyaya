import {getContinuousStatus,getNavigationProbeStatus,startNativeContinuous,observeNativeContinuous,stopNativeContinuous,
  getHomeStatus,getHomePlan,publishHomeProgress,lookNativeContinuous,prepareHomeCapture,retargetNativeContinuous,type HomePlan,type HomePose} from "../../modules/navigation-probe";
import {prepareNativeNavigationDrive} from "../device-tools/looi-robot";
import {getNavigationControlOwner} from "../core/navigation-control-lease";
import {LocalGoalController} from "./local-goal-controller";
import {runFloorVisionProbe,releaseContinuousVision} from "../diagnostics/floor-vision-probe";
import {homeToLocal,localToHome} from "./home-route";
import {wantsExplorationObservation} from "../inspection/exploration-observation";
import {HomeExplorer} from "./home-explorer";
import {mergeInspectionCoverage} from "../inspection/inspection-coverage";
import {sendHomeCommand} from "../../modules/navigation-probe";

/** Uses the same native feedback/obstacle checks as destination navigation; no timed blind walk. */
export async function runHomeExplorationMission(initial: HomePlan) {
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
    if(plan.taskId!==initial.taskId || plan.revision!==initial.revision || plan.mode!=="explore")throw new Error("探索任务或地图已变化");
    if(plan.inspectionId)inspection=await (await import("../inspection/inspection-mission")).beginInspection(plan);
    const origin=plan.origin;let observedCells=0;
    const tour=new HomeExplorer(plan.taskId,origin,JSON.parse(plan.explorationStart!),JSON.parse(plan.explorationVisited ?? "[]"));
    const controller=new LocalGoalController({x:0,y:.15},g,0);
    controller.setForbidden(plan.zones.map(z=>({...homeToLocal({...z,yaw:0},origin),radius:z.radius})));
    let region=warm.selectedFloorRegion!,lastGoal={x:0,y:.15,yaw:0},lastFinal=false,errors=0,lastSave=0,scanning=false,lastScanYaw=NaN;
        prepared=await prepareNativeNavigationDrive(owner,()=>{void stopOwn("探索已停止").catch(()=>{});});
    const start=await startNativeContinuous(prepared.device,before.stopEpoch,0,.15,settings.measuredCameraHeightMeters,region,false,{maximumMs:tour.maximumMs+10_000});
    token=start.token!;if(!token)throw new Error("未建立本地探索控制");
    await publishHomeProgress({taskId:plan.taskId,phase:"RUNNING",reason:"正在观察可达区域，尚未宣布房间建图完成"});
    while(Date.now()-started<tour.maximumMs) {
      const status=await getContinuousStatus();if(status.token!==token)throw new Error("导航控制会话已变化");
      if(!status.active){completed=returned && tour.moved && status.phase==="AT_GOAL";if(!completed)failure=!tour.moved?"当前没有可达探索前沿，地图已保存，尚未进行探索行驶":String(status.reason ?? status.phase);break;}
      const home=await getHomeStatus();
      if(home.atlas?.mapId!==plan.mapId || home.atlas.revision!==plan.revision || home.poseRevision!==plan.poseRevision)throw new Error("地图或定位起点已变化，探索暂停");
      if(!home.connectionConfirmed || !home.localized)throw new Error("连接、姿态或定位失效，探索暂停");
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
        const observedPose=localToHome(latest.pose,origin);
        if(inspection && !tour.returning && wantsExplorationObservation(inspection.observations(),observedPose)){
          const near=Math.hypot(latest.pose.x-lastGoal.x,latest.pose.y-lastGoal.y)<.08;
          const parked=["WAYPOINT_REACHED","VIEW_READY"].includes(String(latest.phase)) && latest.stopAcknowledged===true;
          if(parked){
            const key="view-"+Math.round(observedPose.x*5)+"_"+Math.round(observedPose.y*5)+"_"+Math.round(observedPose.yaw*2);
            await inspection.capture(key,"探索观察点",observedPose,token);
          }else waitingForPhotoStop=near;
        }
        const elapsed=Date.now()-started;
        const observation=await sendHomeCommand({op:"spatial_observe",taskId:plan.taskId,cells:mergeInspectionCoverage([],result.navigationCells,capture.pose,origin,g.centerRightMeters,g.alongViewMeters)});
        if(Number.isFinite(observation.observedCells))observedCells=Number(observation.observedCells);
        const next:Awaited<ReturnType<HomeExplorer["select"]>>=waitingForPhotoStop?{target:lastGoal,final:lastFinal,returning:tour.returning,scanYaw:scanning?lastScanYaw:undefined}:await tour.select(latest.pose,elapsed);returned=next.returning;
        if(next.scanYaw!==undefined){
          if(!scanning){
            void import("./navigation-speech").then(m=>m.announceNavigation("暂时还没有可达通道，我先原地转向看看。")).catch(()=>{});
          }
          if(!scanning || next.scanYaw!==lastScanYaw)await lookNativeContinuous(token,next.scanYaw);
          scanning=true;lastScanYaw=next.scanYaw;
        }else if(scanning){await lookNativeContinuous(token,null);scanning=false;}
        if(Math.hypot(next.target.x-lastGoal.x,next.target.y-lastGoal.y)>.01 || next.final!==lastFinal) {
          controller.setGoal(next.target);await retargetNativeContinuous(token,next.target,next.final);lastGoal=next.target;lastFinal=next.final;
        }
        const local=controller.plan();
        const path=local.path;
        await observeNativeContinuous(token,{imageNs:result.frame.imageTimestampNs,capture:capture.pose,cells:result.navigationCells,path,obstacles:controller.occupiedCells()});
        checkpoint={explorationVisited:tour.visited,exploredCells:observedCells,explorationElapsedMs:elapsed};
        if ((tour.moved && !departingSpoken) || (tour.moved && returned && !returningSpoken)) {
          const returning = returned;
          departingSpoken = true;
          if (returning) returningSpoken = true;
          void import("./navigation-speech").then(({announceNavigation}) =>
            announceNavigation(returning ? "观察点已记录，我开始返回起点。" : "已开始移动，正在观察可达区域。")).catch(()=>{});
        }
        if(Date.now()-lastSave>3000){lastSave=Date.now();await publishHomeProgress({taskId:plan.taskId,phase:"RUNNING",...checkpoint,
          reason:returned || scanning?tour.reason:"正在探索可达前沿，绿色为已观察地面"});}
        errors=0;
      }catch(e){if(++errors>=3)throw e;}
      await new Promise(r=>setTimeout(r,40));
    }
    if(!completed && !failure)failure="本轮探索达到时长上限，已停车并保存地图，尚未确认返回";
  }catch(e){failure=e instanceof Error?e.message:String(e);}
  finally {
    await stopOwn(failure || "附近探索结束").catch(()=>{});
    let stopped=!token;
    for(let i=0;token && i<15;i++){const s=await getContinuousStatus().catch(()=>null);if(s?.token===token && s.stopAcknowledged===true){stopped=true;break;}await new Promise(r=>setTimeout(r,100));}
    prepared?.finish();await releaseContinuousVision().catch(()=>{});
    const success=completed && stopped;
    let segmentation="";
    if(success)try{await sendHomeCommand({op:"auto_rooms"});segmentation="初步房间分区已保存，可在地图调整。";}catch(error){segmentation="地面图已保存，自动分房未完成："+(error instanceof Error?error.message:"请查看任务记录");}
    if(inspection){try{await inspection.relabelRooms();}catch(error){segmentation+=" 照片已保存，房间关联未完成："+(error instanceof Error?error.message:"可按任务编号查看照片");}const home=await getHomeStatus().catch(()=>null);const phase=home?JSON.parse(home.task).phase:"";inspection.finish(success,success?"已返回出发位置并停车。"+segmentation:failure || "尚未确认停车或返回",phase==="CANCELLED");}
    await publishHomeProgress({taskId:initial.taskId,phase:success?"COMPLETED":"BLOCKED",...checkpoint,
      reason:success?"本轮可达区域探索已返回起点并停车；未观察区域仍为未知。"+segmentation:!stopped?"已请求停车，尚未收到回执":failure}).catch(()=>{});
    await import("react-native").then(async n=>{
      if(n.AppState.currentState!=="active")return;
      const {announceNavigation}=await import("./navigation-speech");
      await announceNavigation(success?"本轮探索已返回起点，地图和观察照片已记录，正在整理见闻。":`探索已暂停，${failure || "请查看屏幕"}`);
    }).catch(()=>{});
  }
}
