import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),ts=require("typescript"),m={exports:{}};
new Function("module","exports",ts.transpileModule(readFileSync("src/navigation/navigation-camera-handoff.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);
const {parkNavigationForCamera}=m.exports;
function rig(mode){let phase="RUNNING",polls=0,stops=0;const signal=new AbortController();return {signal,stops:()=>stops,deps:{
 getHomeStatus:async()=>({task:JSON.stringify({id:"original",phase})}),
 sendHomeCommand:async()=>{phase=mode==="cancelled"?"CANCELLED":"PAUSED";if(mode==="aborted")signal.abort();},
 stopMotion:async()=>{stops++;},finish:async()=>{},getContinuousStatus:async()=>{
  polls++;if(mode==="idle")return {};
  return {token:mode==="replacement" && polls>1?"replacement":"original-drive",active:polls<3,stopAcknowledged:polls>=3};
 }}};}
const good=rig("ok");await parkNavigationForCamera(good.deps,good.signal.signal);assert.equal(good.stops(),1);
const idle=rig("idle");await parkNavigationForCamera(idle.deps,idle.signal.signal);assert.equal(idle.stops(),1);
for(const mode of ["cancelled","aborted","replacement"]){const r=rig(mode);await assert.rejects(parkNavigationForCamera(r.deps,r.signal.signal),/变化|取消/);}
console.log("Navigation camera handoff: waits for parked receipt, idle camera release, cancellation and replacement-task isolation: PASS");
