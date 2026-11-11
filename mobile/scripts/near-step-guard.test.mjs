import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),ts=require("typescript");
function load(file,mocks={}) {const m={exports:{}};const js=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;new Function("require","module","exports",js)(name=>{assert.ok(name in mocks,name);return mocks[name];},m,m.exports);return m.exports;}
const {assessNearStep}=load("src/navigation/near-step-guard.ts");
const near={reason:"NEAR_FLOOR_OBSERVED_FAR_UNKNOWN",nearFloorObserved:true,corridorDropPixels:0,nearestObstacleEstimateMeters:.7,fitInlierRatio:.95,heldoutFloorP90HeightErrorMeters:.01};
assert.equal(assessNearStep(near).allowed,true);assert.equal(assessNearStep(near).durationMs,150);
for(const change of [{nearFloorObserved:false},{corridorDropPixels:20},{nearestObstacleEstimateMeters:.25},{nearestObstacleEstimateMeters:NaN},{fitInlierRatio:.2},{fitInlierRatio:Infinity}]) assert.equal(assessNearStep({...near,...change}).allowed,false);
let captures=0,motions=0;let report=near;
const probe=load("src/diagnostics/near-step-probe.ts",{
 "./floor-vision-probe":{runFloorVisionProbe:async()=>{captures++;return {analysis:report};}},
 "../../modules/navigation-probe":{runNativeFieldDiagnostic:async(direction,confirmed)=>{assert.equal(direction,"back_step");assert.equal(confirmed,true);motions++;return {phase:"READY"};}},
 "../navigation/near-step-guard":{assessNearStep},
});
await assert.rejects(probe.runNearStepProbe({heightCm:8}));assert.equal(captures,0);assert.equal(motions,0);
report={...near,nearestObstacleEstimateMeters:.25};assert.equal((await probe.runNearStepProbe({heightCm:8,operatorConfirmed:true})).motionRequested,false);assert.equal(motions,0);
report=near;assert.equal((await probe.runNearStepProbe({heightCm:8,operatorConfirmed:true})).motionRequested,true);assert.equal(motions,1);
console.log("Near step: far unknown permits only observed near strip; obstacle/drop/invalid data block; explicit confirmation; single bounded call: PASS");
