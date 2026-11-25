import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),ts=require("typescript");
let time=0;
function load(file,mocks={}){const m={exports:{}};new Function("require","module","exports","Date","setTimeout",ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>mocks[n]??require(n),m,m.exports,{now:()=>time},fn=>{queueMicrotask(fn);return 0;});return m.exports;}
const route=load("src/navigation/home-route.ts"),local=load("src/navigation/local-goal-controller.ts"),coverage=load("src/inspection/inspection-coverage.ts",{"../navigation/home-route":route});
const {wantsExplorationObservation:wants}=load("src/inspection/exploration-observation.ts");
assert.equal(wants([],{x:0,y:0,yaw:0}),true);assert.equal(wants([{x:0,y:0,yaw:0}],{x:.1,y:.1,yaw:.2}),false);assert.equal(wants([{x:0,y:0,yaw:0}],{x:0,y:0,yaw:1.5}),true);
async function run(mode){time=0;let active=false,goal={x:0,y:.15,yaw:0},final=false,scanYaw=null,frontierUsed=false,photoReadyDelay=0;
 const events=[],photos=[],reports=[];let labels=false,finished;
 let state={token:"drive",pose:{x:0,y:0,yaw:0},phase:"IDLE",stopAcknowledged:true,stopEpoch:1};
 const g={widthMeters:.15,lengthMeters:.1,marginMeters:.02,centerRightMeters:.07,alongViewMeters:.05};
 const plan={mode:"explore",taskId:"explore",mapId:"map",revision:1,poseRevision:1,origin:{x:0,y:0,yaw:0},points:[],targetName:"探索",zones:[],robotRadius:.1,explorationStart:'{"x":0,"y":0,"yaw":0}',inspectionId:"observations"};
 const status=()=>({...state,active,poseReady:true,frameNs:1e9,pose:{...state.pose}});
 const native={getHomePlan:async()=>plan,getHomeStatus:async()=>({atlas:{mapId:"map",revision:1},poseRevision:1,connectionConfirmed:true,localized:true,task:'{"phase":"RUNNING"}'}),
 getContinuousStatus:async()=>status(),getNavigationProbeStatus:async()=>({navigationGeometry:g,measuredCameraHeightMeters:.08}),prepareHomeCapture:async()=>{},
 startNativeContinuous:async()=>{active=true;events.push("start");return status();},stopNativeContinuous:async()=>{active=false;state.stopAcknowledged=true;events.push("stop");},
 retargetNativeContinuous:async(_t,p,last)=>{goal=p;final=last;events.push("retarget");},lookNativeContinuous:async(_t,yaw)=>{scanYaw=yaw;},
 observeNativeContinuous:async()=>{
   if(scanYaw!==null){state.pose.yaw=scanYaw;state.phase="VIEW_READY";state.stopAcknowledged=true;return;}
   const d=Math.hypot(goal.x-state.pose.x,goal.y-state.pose.y);
   if(d>.001){const step=Math.min(.05,d);state.pose.x+=(goal.x-state.pose.x)/d*step;state.pose.y+=(goal.y-state.pose.y)/d*step;}
   if(Math.hypot(goal.x-state.pose.x,goal.y-state.pose.y)<.06){
     if(photoReadyDelay++%2===0){state.phase="DRIVING";state.stopAcknowledged=false;}
     else{state.phase=final?"AT_GOAL":"WAYPOINT_REACHED";state.stopAcknowledged=true;if(final)active=false;}
   }else{state.phase="DRIVING";state.stopAcknowledged=false;}
 },publishHomeProgress:async v=>reports.push(v),sendHomeCommand:async v=>{
   if(v.op==="spatial_frontier"){
     if(!frontierUsed){frontierUsed=true;return {spatialPath:[{...state.pose},{x:0,y:.45,yaw:0}]};}
     return {spatialPath:null};
   }
   if(v.op==="spatial_route")return {spatialPath:[{...state.pose},v.target]};
   if(v.op==="spatial_observe")return {observedCells:1234};
   if(v.op==="auto_rooms"){events.push("rooms");return {};}
   return {};
 }};
 const inspection={count:()=>photos.length,observations:()=>photos,capture:async(_key,_room,p)=>{
   assert.ok(["VIEW_READY","WAYPOINT_REACHED"].includes(state.phase));assert.equal(state.stopAcknowledged,true);
   events.push("photo");photos.push({...p});
 },relabelRooms:async()=>{assert.ok(events.includes("rooms"));labels=true;},finish:(success)=>{finished=success;}};
 const module=load("src/navigation/home-exploration-mission.ts",{"../../modules/navigation-probe":native,"../core/navigation-control-lease":{getNavigationControlOwner:()=>"owner"},
 "../device-tools/looi-robot":{prepareNativeNavigationDrive:async()=>({device:"ble",finish(){}})},"./home-route":route,"./home-explorer":load("src/navigation/home-explorer.ts",{"../../modules/navigation-probe":native,"./home-route":route}),"./local-goal-controller":local,
 "../inspection/inspection-coverage":coverage,"../inspection/exploration-observation":{wantsExplorationObservation:wants},"../inspection/inspection-mission":{beginInspection:async()=>inspection},"./navigation-speech":{announceNavigation:async()=>false},
 "../diagnostics/floor-vision-probe":{releaseContinuousVision:async()=>{},runFloorVisionProbe:async()=>{time+=1000;if(time>180_000)throw Error("simulator stalled");return {frame:{imageTimestampNs:1e9,navigationPose:status()},selectedFloorRegion:{left:.1,top:.7,right:.5,bottom:.9},navigationCells:[[.07,.3,1,20]]};}},"react-native":{AppState:{currentState:"background"}}});
 await module.runHomeExplorationMission(plan);
 assert.equal(reports.at(-1).phase,"COMPLETED",JSON.stringify(reports.at(-1)));assert.equal(reports.at(-1).exploredCells,1234);assert.equal(finished,true);assert.equal(labels,true);assert.ok(photos.length>=2);assert.ok(events.indexOf("stop")<events.indexOf("rooms"));assert.ok(Math.hypot(state.pose.x,state.pose.y)<.06);
}
await run();
console.log("Full exploration mission: real stop-gated photos, scan views, return, room association and stored completion: PASS");
