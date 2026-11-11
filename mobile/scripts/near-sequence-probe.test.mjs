import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),ts=require("typescript");
function rig(mode="complete") {
 const calls={batch:0,stop:0,steps:0},m={exports:{}};
 const mocks={"../../modules/navigation-probe":{beginNativeFieldBatch:async()=>{calls.batch++;return {batchId:"same-native-budget",maximumSteps:3};},stopNativeOperatorObservation:async()=>{calls.stop++;}},
  "./near-step-probe":{runNearStepProbe:async(args)=>{assert.equal(args.batchId,"same-native-budget");calls.steps++;
   if(mode==="blocked" && calls.steps===2) return {motionRequested:false};
   if(mode==="cancelled" && calls.steps===2) return {motionRequested:true,trial:{phase:"STOPPED"}};
   if(mode==="failed") throw Error("camera closed");return {motionRequested:true,trial:{phase:"READY"}};}}};
 const js=ts.transpileModule(fs.readFileSync("src/diagnostics/near-sequence-probe.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function("require","module","exports",js)(name=>{assert.ok(name in mocks,name);return mocks[name];},m,m.exports);
 return {calls,run:m.exports.runNearSequenceProbe};
}
const args={operatorConfirmed:true,heightCm:8};
const full=rig();assert.equal((await full.run(args)).phase,"budget_complete");assert.deepEqual(full.calls,{batch:1,stop:1,steps:3});
const blocked=rig("blocked");assert.equal((await blocked.run(args)).phase,"perception_stop");assert.equal(blocked.calls.steps,2);
const cancelled=rig("cancelled");assert.equal((await cancelled.run(args)).phase,"interrupted");assert.equal(cancelled.calls.steps,2);
const failed=rig("failed");assert.equal((await failed.run(args)).phase,"error");assert.equal(failed.calls.stop,1);
for(const a of [{...args,maximumSteps:4},{...args,operatorConfirmed:false},{operatorConfirmed:true}]) {const r=rig();await assert.rejects(r.run(a));assert.equal(r.calls.batch,0);}
console.log("Bounded visual sequence: one native token, <=3 steps, fresh observation per step, obstacle/cancel/error stops without re-arming: PASS");
