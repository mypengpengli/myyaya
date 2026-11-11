import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url), ts=require("typescript"), module={exports:{}};
const js=ts.transpileModule(fs.readFileSync("src/navigation/vision-floor-analysis.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function("module","exports",js)(module,module.exports);
const analyze=module.exports.analyzeFloorDepth;
const camera={width:640,height:480,fx:450,fy:450,cx:320,cy:240,q:[0,0,0,1]}, roi={left:.05,top:.68,right:.28,bottom:.93}, size=128;
function scene(kind="floor") {
 const d=new Uint8Array(size*size);
 for(let j=0;j<size;j++)for(let i=0;i<size;i++){
  const u=(i+.5)/size,v=(j+.5)/size,ry=(240-v*480)/450;
  let inv=-ry/.08;
  if(u>.45&&u<.62&&v>.53&&v<.68) { if(kind==="obstacle") inv=4; if(kind==="drop") inv=.7; }
  d[j*size+i]=Math.max(0,Math.min(255,Math.round((inv+1)*32)));
 }
 return d;
}
const floor=analyze(scene(),size,size,camera,.08,roi);
assert.equal(floor.report.reason,"FLOOR_STRIP_OBSERVED");assert.equal(floor.report.autonomousMotionAuthorized,false);
assert.ok(floor.report.heldoutFloorMedianHeightErrorMeters<.002);
const blocked=analyze(scene("obstacle"),size,size,camera,.08,roi);
assert.equal(blocked.report.reason,"OBSTACLE_IN_VIEW_CORRIDOR");assert.ok(Math.abs(blocked.report.nearestObstacleEstimateMeters-.25)<.01);
const drop=analyze(scene("drop"),size,size,camera,.08,roi);assert.equal(drop.report.reason,"POSSIBLE_DROP_IN_CORRIDOR");
assert.throws(()=>analyze(new Uint8Array(size*size).fill(50),size,size,camera,.08,roi));
assert.throws(()=>analyze(scene(),size,size,{...camera,q:[0,0,0,0]},.08,roi));
assert.throws(()=>analyze(scene(),size,size,camera,.01,roi));
console.log("Known-height floor: calibrated plane, held-out check, obstacle, possible drop, invalid/constant depth rejection: PASS");
