import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function load(path,mocks={}){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(name in mocks,name);return mocks[name];},m,m.exports);return m.exports;}
const navigation=load('src/navigation/local-goal-controller.ts'),guard=load('src/navigation/near-step-guard.ts');
const geometry={centerRightMeters:.07,alongViewMeters:.05,widthMeters:.15,lengthMeters:.1,marginMeters:.05};
function rig(fail=false) {
 const calls={begins:0,stops:0,moves:0,observations:0},pose={x:0,y:0,yaw:0};
 const flow=(x,z)=>({cumulativePoseAvailable:true,originContinuity:true,originTimestampNs:1,cumulativeCameraDxMeters:x,cumulativeCameraDzMeters:z});
 const native={getNavigationProbeStatus:async()=>({dataDirectory:'/test'}),beginNativeLocalMission:async()=>{calls.begins++;return {batchId:'one-persistent-task'};},
 publishNativeLocalMission:async()=>{},setNativeLocalMissionRegion:async token=>assert.equal(token,'one-persistent-task'),stopNativeOperatorObservation:async()=>{calls.stops++;},
 runNativeFieldDiagnostic:async(direction,confirmed,ms,token)=>{
  assert.equal(confirmed,true);assert.equal(token,'one-persistent-task');calls.moves++;
  if(fail)return {phase:'STOPPED',reason:'USER_STOP'};
  const old={...pose};
  if(direction==='back_step'){const distance=ms===250?.025:.015;pose.x+=Math.sin(pose.yaw)*distance;pose.y+=Math.cos(pose.yaw)*distance;assert.ok(Math.hypot(pose.x,pose.y-.25)>.11);}
  else pose.yaw+=(direction==='right_step'?1:-1)*Math.min(.2,ms*.0014);
  const ox=y=>Math.cos(y)*.07+Math.sin(y)*.05,oy=y=>-Math.sin(y)*.07+Math.cos(y)*.05;
  const dx=pose.x-old.x-ox(pose.yaw)+ox(old.yaw),dz=-(pose.y-old.y-oy(pose.yaw)+oy(old.yaw));
  return {phase:'READY',lastSegment:{completed:true,motorStopAcknowledged:true,rawPoseYawRadians:pose.yaw-old.yaw,floorFlowBefore:flow(0,0),floorFlowAfter:flow(dx,dz)}};
 }};
 const probe={runFloorVisionProbe:async()=>{
  calls.observations++;const c=Math.cos(pose.yaw),s=Math.sin(pose.yaw),dx=-pose.x,dy=.25-pose.y;
  const cx=c*dx-s*dy+.07,cy=s*dx+c*dy+.05;
  return {geometry,selectedFloorRegion:{left:.05,top:.68,right:.28,bottom:.93},frame:{cameraQuaternion:[0,-Math.sin(pose.yaw/2),0,Math.cos(pose.yaw/2)],requestId:String(calls.observations)},
   navigationCells:cy>0?[[cx,cy,2,30]]:[],analysis:{reason:'OBSTACLE_IN_VIEW_CORRIDOR',nearFloorObserved:true,corridorDropPixels:0,nearestObstacleEstimateMeters:Math.abs(cx-.07)<.15&&cy>0?cy:null,fitInlierRatio:1,heldoutFloorP90HeightErrorMeters:0}};
 }};
 const {runLocalGoalMission}=load('src/diagnostics/local-goal-mission.ts',{'expo-file-system/legacy':{writeAsStringAsync:async()=>{}},'../../modules/navigation-probe':native,'../navigation/local-goal-controller':navigation,'../navigation/near-step-guard':guard,'./floor-vision-probe':probe});
 return {run:runLocalGoalMission,calls};
}
const args={operatorConfirmed:true,heightCm:8,goalForwardMeters:.5,maximumSteps:80};
const complete=rig(),r=await complete.run(args);assert.equal(r.phase,'AT_GOAL',JSON.stringify({error:r.error,pose:r.pose,last:r.history.slice(-4)}));assert.ok(r.remainingMeters<=.06);assert.ok(complete.calls.moves>3);assert.equal(complete.calls.begins,1);assert.equal(complete.calls.stops,1);
const cancelled=rig(true),s=await cancelled.run(args);assert.equal(s.phase,'INTERRUPTED');assert.equal(cancelled.calls.moves,1);assert.equal(cancelled.calls.begins,1);assert.equal(cancelled.calls.stops,1);
const invalid=rig();await assert.rejects(invalid.run({...args,operatorConfirmed:false}));assert.equal(invalid.calls.begins,0);
console.log('Local mission: complete >3-step detour to a goal, one persistent native budget, realignment, stop/cancel ends without re-arming: PASS');
