import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),ts=require("typescript");
function load(path,mocks={}){const m={exports:{}};new Function("require","module","exports","setTimeout",ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>mocks[name]??require(name),m,m.exports,fn=>{queueMicrotask(fn);return 0;});return m.exports;}
const route=load("src/navigation/home-route.ts"),nav=load("src/navigation/local-goal-controller.ts");
const geometry={centerRightMeters:.07,alongViewMeters:.05,widthMeters:.15,lengthMeters:.10,marginMeters:.02};
async function run(mode="roundtrip") {
  let state={stopEpoch:3,active:false,stopAcknowledged:true,pose:{x:0,y:0,yaw:0}},goal={x:0,y:.4},final=false;
  const photos=[],reports=[],finishes=[];let starts=0,stops=0,observations=0;
  const target=mode==="at-origin"?0:.4;
  const plan={taskId:"native-task",mapId:"home",revision:1,poseRevision:1,origin:{x:0,y:0,yaw:0},points:[{x:0,y:0,yaw:0},{x:0,y:target,yaw:0},{x:0,y:0,yaw:0}],targetName:"出发位置",zones:[],mode:"inspection",inspectionId:"inspection",inspectionStops:[{id:"kitchen",name:"厨房",pose:{x:0,y:target,yaw:0},arc:target}]};
  const native={getHomePlan:async()=>plan,getContinuousStatus:async()=>({...state}),getNavigationProbeStatus:async()=>({navigationGeometry:geometry,measuredCameraHeightMeters:.08}),prepareHomeCapture:async()=>{},
    getHomeStatus:async()=>({atlas:{mapId:"home",revision:1},poseRevision:1,localized:true,connectionConfirmed:mode!=="lost-link"||photos.length===0,task:JSON.stringify({phase:"RUNNING"})}),
    startNativeContinuous:async(_device,_epoch,x,y,_height,_region,last)=>{starts++;goal={x,y};final=last;assert.ok(Math.hypot(x,y)>=.03);state={...state,token:"one-native-token",active:true,poseReady:true,phase:"WAITING_PATH",frameNs:1e9};return state;},
    retargetNativeContinuous:async(token,next,last)=>{assert.equal(token,"one-native-token");goal=next;final=last;},
    observeNativeContinuous:async()=>{
      if(++observations>200)throw new Error("simulated route made no progress");
      const dx=goal.x-state.pose.x,dy=goal.y-state.pose.y,d=Math.hypot(dx,dy),step=Math.min(.04,d);
      if(d>.001)state.pose={x:state.pose.x+dx/d*step,y:state.pose.y+dy/d*step,yaw:Math.atan2(dx,dy)};
      if(Math.hypot(goal.x-state.pose.x,goal.y-state.pose.y)<=.06){state.phase=final?"AT_GOAL":"WAYPOINT_REACHED";if(final)state.active=false;}
      else state.phase="DRIVING";
    },sendHomeCommand:async()=>({}),stopNativeContinuous:async()=>{stops++;state.active=false;state.stopAcknowledged=true;},publishHomeProgress:async data=>reports.push(data)};
  const mod=load("src/navigation/home-mission.ts",{
    "../../modules/navigation-probe":native,"../device-tools/looi-robot":{prepareNativeNavigationDrive:async()=>({device:"same-ble",finish(){}})},
    "../core/navigation-control-lease":{getNavigationControlOwner:()=>"owner"},"./local-goal-controller":nav,"./home-route":route,
    "../inspection/inspection-coverage":load("src/inspection/inspection-coverage.ts",{"../navigation/home-route":route}),
    "../inspection/inspection-mission":{beginInspection:async()=>({capture:async(...args)=>{assert.equal(state.phase,"WAYPOINT_REACHED");photos.push(args);},finish:(...args)=>finishes.push(args)})},
    "../diagnostics/floor-vision-probe":{releaseContinuousVision:async()=>{},runFloorVisionProbe:async()=>({selectedFloorRegion:{left:.1,top:.7,right:.3,bottom:.95},frame:{imageTimestampNs:1e9,navigationPose:{...state,pose:{...state.pose}}},navigationCells:[[.07,.25,1,30]]})},
    "react-native":{AppState:{currentState:"background"}}
  });
  await mod.runHomeMission();return {state,photos,reports,finishes,starts,stops};
}
const good=await run();assert.equal(good.starts,1);assert.equal(good.stops,1);assert.equal(good.photos.length,1);
assert.equal(good.reports.at(-1).phase,"COMPLETED");assert.equal(good.finishes.at(-1)[0],true);assert.ok(Math.hypot(good.state.pose.x,good.state.pose.y)<=.06);
assert.ok(good.reports.some(r=>r.inspectionDone?.includes("kitchen")));
const atOrigin=await run("at-origin");assert.equal(atOrigin.photos.length,1,"already at the requested point must still take a photo");assert.equal(atOrigin.finishes.at(-1)[0],true);
const lost=await run("lost-link");assert.equal(lost.finishes.at(-1)[0],false);assert.equal(lost.reports.at(-1).phase,"BLOCKED");
console.log("Inspection actual home mission: one native token, mandatory photo stop, roundtrip cannot shortcut to completion, exact original return and failed-link preservation: PASS");
