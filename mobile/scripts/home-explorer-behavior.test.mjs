import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
let now=100_000;
const require=createRequire(import.meta.url),ts=require("typescript");
function load(file,mocks={}){const m={exports:{}};new Function("require","module","exports","Date",ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>mocks[n]??require(n),m,m.exports,{now:()=>now});return m.exports;}
const {currentHomeId,homeOpeningSelection}=load("src/navigation/current-home.ts");
assert.equal(currentHomeId([]),undefined);assert.equal(currentHomeId([{mapId:"one"}]),"one");
assert.equal(currentHomeId([{mapId:"old"},{mapId:"current",active:true}]),"current");
assert.throws(()=>currentHomeId([{mapId:"one"},{mapId:"two"}]),/选择当前地点/);
assert.deepEqual(homeOpeningSelection([{mapId:"one"},{mapId:"two"}]),{chooseMap:true});
assert.deepEqual(homeOpeningSelection([{mapId:"one",active:true},{mapId:"two",active:true}]),{chooseMap:true});
assert.deepEqual(homeOpeningSelection([{mapId:"one"},{mapId:"two",active:true}]),{mapId:"two"});
assert.deepEqual(homeOpeningSelection([{mapId:"one"},{mapId:"two"}],"one"),{mapId:"one"});
assert.deepEqual(homeOpeningSelection([],undefined,true),{});
assert.deepEqual(homeOpeningSelection([{mapId:"one"}]),{mapId:"one"});
const route=load("src/navigation/home-route.ts");
const pose=(x,y)=>({x,y,yaw:0});let requests=[],frontiers=[pose(0,.4),pose(.4,.4)],current=pose(0,0),fail=false;
const native={sendHomeCommand:async v=>{requests.push(v);if(fail)throw Error("old task");if(v.op==="spatial_frontier")return {spatialPath:frontiers.length?[current,frontiers.shift()]:null};return {spatialPath:[current,v.target]};}};
const {HomeExplorer}=load("src/navigation/home-explorer.ts",{"../../modules/navigation-probe":native,"./home-route":route});
async function finishScan(explorer,p,elapsed){
 let next;
 for(let i=0;i<18;i++){now+=1500;next=await explorer.select(p,elapsed+i*1500);if(next.scanYaw===undefined)return next;assert.equal(next.final,false);assert.equal(next.target.x,p.x);assert.equal(next.target.y,p.y);p.yaw=next.scanYaw;}
 throw new Error("scan did not terminate");
}
const explorer=new HomeExplorer("task",pose(0,0),pose(0,0));
let next=await explorer.select(current,0);assert.equal(next.final,false);assert.equal(next.returning,false);
now+=10_000;current=pose(0,.4);next=await explorer.select(current,10_000);assert.equal(next.target.x,.4);assert.equal(explorer.visited.length,1);
now+=10_000;current=pose(.4,.4);next=await finishScan(explorer,current,20_000);assert.equal(next.returning,true);assert.equal(requests.at(-1).op,"spatial_route");assert.deepEqual(requests.at(-1).target,pose(0,0));
assert.ok(explorer.reason.includes("不代表未知房间全部完成"));current=pose(0,0);next=await explorer.select(current,30_000);assert.equal(next.final,true);assert.equal(next.returning,true);
// A restarted task uses its persisted original start, not the new current pose.
frontiers=[];current=pose(1,1);const resumed=new HomeExplorer("restored",pose(1,1),pose(0,0),[pose(.4,.4)]);now+=7000;await finishScan(resumed,pose(0,0),60_000);assert.deepEqual(requests.at(-1).target,pose(0,0));assert.equal(requests.at(-1).taskId,"restored");
// No frontier at the original start must not invent a drive path or a completed house.
const idle=new HomeExplorer("idle",pose(0,0),pose(0,0));current=pose(0,0);now+=7000;const result=await finishScan(idle,current,0);assert.equal(result.final,true);assert.equal(idle.moved,false);
fail=true;await assert.rejects(new HomeExplorer("stale",pose(0,0),pose(0,0)).select(pose(0,0),0),/old task/);
console.log("Home exploration: sequential measured frontiers, original-start return, persisted visited points, no fake whole-house completion and stale-task rejection: PASS");
