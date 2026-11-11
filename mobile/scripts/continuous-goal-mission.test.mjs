import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function load(path,mocks={}){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(name in mocks,name);return mocks[name];},m,m.exports);return m.exports;}
const navigation=load('src/navigation/local-goal-controller.ts');
function rig(mode='success') {
  const calls={starts:0,observes:0,stops:0,releases:0,finishes:0,frames:0};
  let status={stopEpoch:3},saved;
  const pose={x:0,y:0,yaw:0},geometry={centerRightMeters:.07,alongViewMeters:.05,widthMeters:.15,lengthMeters:.1,marginMeters:.02};
  const native={
    getContinuousStatus:async()=>({...status,pose:{...pose}}),
    getNavigationProbeStatus:async()=>({measuredCameraHeightMeters:.08,navigationGeometry:geometry}),
    startNativeContinuous:async(device,epoch)=>{assert.equal(device,'shared-device');assert.equal(epoch,3);calls.starts++;status={...status,token:'one-task',active:true,phase:'DRIVING',remainingMeters:.4,poseReady:true,frameNs:1e9};return status;},
    observeNativeContinuous:async(token,data)=>{assert.equal(token,'one-task');assert.deepEqual(data.capture,{x:0,y:0,yaw:0});assert.ok(data.path.length);calls.observes++;status.active=false;status.phase='AT_GOAL';status.remainingMeters=.04;},
    stopNativeContinuous:async()=>{calls.stops++;status.active=false;},saveContinuousReport:async v=>{saved=v;},publishNativeLocalMission:async()=>{}
  };
  const probe={releaseContinuousVision:async()=>{calls.releases++;},runFloorVisionProbe:async args=>{
    assert.equal(args.liveOnly,true);calls.frames++;
    if(mode==='error')throw new Error('inference failed');
    if(mode==='cancel')status={...status,phase:'CANCELLED',active:false};
    if(mode==='stale' && calls.frames===1)return {frame:{imageTimestampNs:2e9,navigationPose:{...status,pose:{...pose}}}};
    return {frame:{imageTimestampNs:1e9,navigationPose:{...status,pose:{...pose}}},navigationCells:[[.07,.4,1,30]]};
  }};
  const {runContinuousGoalMission}=load('src/diagnostics/continuous-goal-mission.ts',{'../../modules/navigation-probe':native,'../device-tools/looi-robot':{prepareNativeNavigationDrive:async(owner)=>{assert.equal(owner,'route-owner');return {device:'shared-device',finish:()=>calls.finishes++};}},'../core/navigation-control-lease':{getNavigationControlOwner:()=> 'route-owner'},'../navigation/local-goal-controller':navigation,'./floor-vision-probe':probe});
  return {run:runContinuousGoalMission,calls,get saved(){return saved;}};
}
const a=rig();const r=await a.run({operatorConfirmed:true});assert.equal(r.phase,'AT_GOAL');assert.equal(a.calls.starts,1);assert.equal(a.calls.observes,1);assert.equal(a.calls.releases,1);assert.equal(a.calls.finishes,1);
const b=rig('cancel');await b.run({operatorConfirmed:true});assert.equal(b.calls.observes,0);assert.equal(b.calls.starts,1);assert.equal(b.calls.stops,1);
const c=rig('stale');await c.run({operatorConfirmed:true});assert.equal(c.calls.frames,2);assert.equal(c.calls.observes,1);
const d=rig('error');const e=await d.run({operatorConfirmed:true});assert.equal(d.calls.frames,5);assert.match(e.error,/inference failed/);assert.equal(d.calls.stops,1);assert.equal(d.calls.releases,1);
const invalid=rig();await assert.rejects(invalid.run({operatorConfirmed:false}));assert.equal(invalid.calls.starts,0);
console.log('Continuous mission: one native task, capture-time pose, late image rejection, STOP during inference and failure cleanup: PASS');
