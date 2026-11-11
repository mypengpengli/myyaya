import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),ts=require("typescript");
function load(file,mocks={}) {const m={exports:{}};const js=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;new Function("require","module","exports",js)(name=>{assert.ok(name in mocks,name);return mocks[name];},m,m.exports);return m.exports;}
const {assessNearStep}=load("src/navigation/near-step-guard.ts");
const geometry={centerRightMeters:.07,alongViewMeters:.05,widthMeters:.15,lengthMeters:.1,marginMeters:.05};
const near={reason:"NEAR_FLOOR_OBSERVED_FAR_UNKNOWN",nearFloorObserved:true,corridorDropPixels:0,nearestObstacleEstimateMeters:.7,fitInlierRatio:.95,heldoutFloorP90HeightErrorMeters:.01};
assert.equal(assessNearStep(near,geometry).allowed,true);assert.equal(assessNearStep(near,geometry).durationMs,250);
assert.equal(assessNearStep({...near,nearestObstacleEstimateMeters:.27},geometry).durationMs,250);
assert.equal(assessNearStep({...near,nearestObstacleEstimateMeters:.24},geometry).durationMs,150);
assert.equal(assessNearStep({...near,nearestObstacleEstimateMeters:.27},{...geometry,alongViewMeters:.1}).allowed,false);
assert.equal(assessNearStep(near).allowed,false);
for(const change of [{nearFloorObserved:false},{corridorDropPixels:20},{nearestObstacleEstimateMeters:.2},{nearestObstacleEstimateMeters:NaN},{fitInlierRatio:.2},{fitInlierRatio:Infinity}]) assert.equal(assessNearStep({...near,...change},geometry).allowed,false);
let captures=0,motions=0,stops=0,batches=0;let report=near;
const probe=load("src/diagnostics/near-step-probe.ts",{
 "./floor-vision-probe":{runFloorVisionProbe:async()=>{captures++;return {analysis:report,geometry};}},
 "../../modules/navigation-probe":{beginNativeFieldBatch:async(confirmed)=>{assert.equal(confirmed,true);batches++;return {batchId:"test-batch"};},stopNativeOperatorObservation:async()=>{stops++;},runNativeFieldDiagnostic:async(direction,confirmed,ms,batchId)=>{assert.equal(direction,"back_step");assert.equal(confirmed,true);assert.equal(ms,250);assert.equal(batchId,"test-batch");motions++;return {phase:"READY"};}},
 "../navigation/near-step-guard":{assessNearStep},
});
await assert.rejects(probe.runNearStepProbe({heightCm:8}));assert.equal(captures,0);assert.equal(motions,0);assert.equal(batches,0);
report={...near,nearestObstacleEstimateMeters:.2};assert.equal((await probe.runNearStepProbe({heightCm:8,operatorConfirmed:true})).motionRequested,false);assert.equal(motions,0);assert.equal(stops,1);
report=near;assert.equal((await probe.runNearStepProbe({heightCm:8,operatorConfirmed:true})).motionRequested,true);assert.equal(motions,1);assert.equal(batches,2);assert.equal(stops,2);
console.log("Near step: measured body clearance; 27 cm permits 250 ms, closer distance shrinks then stops; invalid/unknown/drop block; single bounded call: PASS");
