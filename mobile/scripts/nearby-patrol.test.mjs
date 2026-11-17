import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url),ts=require("typescript");
function load(path,mocks={},clock={now:Date.now}) {
  const module={exports:{}},code=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function("require","module","exports","Date","setTimeout",code)(name=>mocks[name]??require(name),module,module.exports,{now:clock.now},fn=>{queueMicrotask(fn);return 0;});return module.exports;
}
const nav=load("src/navigation/local-goal-controller.ts"),route=load("src/navigation/home-route.ts");
const patrol=load("src/navigation/nearby-patrol.ts",{"./local-goal-controller":nav});
const geometry={widthMeters:.15,lengthMeters:.10,marginMeters:.02,centerRightMeters:.07,alongViewMeters:.05};
const floor=[];for(let x=-.25;x<=.25;x+=.05)for(let y=.10;y<=.50;y+=.05)floor.push([x+.07,y+.05,1,30]);
const controller=new nav.LocalGoalController({x:0,y:.15},geometry,0),tour=new patrol.NearbyPatrol();
let finished=false;
for(let i=0;i<110;i++) {
  controller.observe(floor);const next=tour.select(controller,i*1000);
  assert.ok(Math.hypot(next.target.x,next.target.y)<=.8);
  assert.ok(next.final?next.returning:true);
  const dx=next.target.x-controller.pose.x,dy=next.target.y-controller.pose.y,d=Math.hypot(dx,dy);
  if(d<=.06 && next.final){finished=true;break;}
  const step=Math.min(.05,d);controller.pose={x:controller.pose.x+dx/d*step,y:controller.pose.y+dy/d*step,yaw:Math.atan2(dx,dy)};
}
assert.equal(finished,true);assert.equal(tour.moved,true);assert.ok(tour.trail.length>2);
assert.ok(Math.hypot(controller.pose.x,controller.pose.y)<=.06);
const noFloor=new nav.LocalGoalController({x:0,y:.15},geometry,0),empty=new patrol.NearbyPatrol();
assert.equal(empty.select(noFloor,0).final,true);assert.equal(empty.moved,false,"an empty view must not be reported as a successful tour");
noFloor.pose.x=1;assert.throws(()=>empty.select(noFloor,100),/范围/);
assert.throws(()=>new patrol.NearbyPatrol({x:NaN,y:0,yaw:0}),/起点/);

async function mission(mode="ok") {
  let time=0,calls=0,token="",active=false,goal={x:0,y:.15,yaw:0},final=false,state={pose:{x:0,y:0,yaw:0},phase:"IDLE",stopAcknowledged:true};
  const photos=[],reports=[],actions={starts:0,stops:0,observations:0,finishes:0};
  const plan={mode:"patrol",taskId:"tour",mapId:"map",revision:1,poseRevision:1,origin:{x:0,y:0,yaw:0},
    patrolStart:JSON.stringify({x:0,y:0,yaw:0}),patrolTrail:JSON.stringify([{x:0,y:0,yaw:0}]),coverage:"[]",zones:[],...(mode==="inspection"?{inspectionId:"inspection"}:{})};
  const status=()=>({...state,token,active,poseReady:true,stopEpoch:3,frameNs:1e9});
  const native={getNavigationProbeStatus:async()=>({measuredCameraHeightMeters:.08,navigationGeometry:geometry}),prepareHomeCapture:async()=>{},
    getHomePlan:async()=>({...plan,revision:mode==="changed"?2:1}),getHomeStatus:async()=>({atlas:{mapId:"map",revision:1},poseRevision:1,connectionConfirmed:true,localized:true,task:'{"phase":"RUNNING"}'}),
    getContinuousStatus:async()=>status(),startNativeContinuous:async()=>{token="tour-native";active=true;actions.starts++;return status();},
    retargetNativeContinuous:async(t,p,last)=>{assert.equal(t,token);goal=p;final=last;},
    observeNativeContinuous:async(_t,data)=>{
      actions.observations++;assert.ok(data.path.every(p=>Math.hypot(p.x,p.y)<=.8));
      const dx=goal.x-state.pose.x,dy=goal.y-state.pose.y,d=Math.hypot(dx,dy);
      if(d>.001){const step=Math.min(.05,d);state.pose={x:state.pose.x+dx/d*step,y:state.pose.y+dy/d*step,yaw:Math.atan2(dx,dy)};}
      if(Math.hypot(goal.x-state.pose.x,goal.y-state.pose.y)<=.06){state.phase=final?"AT_GOAL":"WAYPOINT_REACHED";if(final)active=false;}else state.phase="DRIVING";
    },stopNativeContinuous:async()=>{actions.stops++;active=false;state.stopAcknowledged=true;},publishHomeProgress:async v=>reports.push(v)};
  const mod=load("src/navigation/nearby-patrol-mission.ts",{
    "../../modules/navigation-probe":native,"../device-tools/looi-robot":{prepareNativeNavigationDrive:async()=>({device:"same-ble",finish:()=>actions.finishes++})},
    "../core/navigation-control-lease":{getNavigationControlOwner:()=>"owner"},"./local-goal-controller":nav,"./home-route":route,"./nearby-patrol":patrol,
    "../inspection/inspection-mission":{beginInspection:async()=>({count:()=>photos.length,capture:async(...args)=>{assert.equal(state.phase,"WAYPOINT_REACHED");photos.push(args);},finish(){}})},
    "../diagnostics/floor-vision-probe":{releaseContinuousVision:async()=>{},runFloorVisionProbe:async()=>{
      time+=1200;calls++;if(mode==="model-error")throw new Error("model failed");
      return {selectedFloorRegion:{left:.1,top:.7,right:.4,bottom:.95},frame:{imageTimestampNs:1e9,navigationPose:status()},navigationCells:mode==="no-floor"?[]:floor};
    }},"react-native":{AppState:{currentState:"background"}}
  },{now:()=>time});
  await mod.runNearbyPatrolMission(plan);return {reports,actions,state,photos};
}
const success=await mission();assert.equal(success.reports.at(-1).phase,"COMPLETED");assert.equal(success.actions.starts,1);assert.equal(success.actions.stops,1);
assert.ok(success.actions.observations>8);assert.ok(success.reports.some(r=>r.coverage?.length));assert.ok(success.reports.some(r=>r.patrolTrail?.length>2));
assert.ok(Math.hypot(success.state.pose.x,success.state.pose.y)<=.06);
const observed=await mission("inspection");assert.equal(observed.reports.at(-1).phase,"COMPLETED",JSON.stringify({reason:observed.reports.at(-1).reason,photos:observed.photos.length,state:observed.state}));assert.ok(observed.photos.length>0 && observed.photos.length<=4);
for(const reason of ["changed","model-error","no-floor"]) {
  const failed=await mission(reason);assert.equal(failed.reports.at(-1).phase,"BLOCKED");
  if(reason!=="no-floor"){assert.equal(failed.actions.starts,0);assert.equal(failed.actions.stops,0);}
}
console.log("Nearby patrol: bounded frontier choices, fresh floor observations, breadcrumb return, saved coverage, one native task and no fake completion: PASS");
