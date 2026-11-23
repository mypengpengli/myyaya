import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url),ts=require("typescript");
function load(path,mocks={}){const m={exports:{}};new Function("require","module","exports",ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>mocks[name]??require(name),m,m.exports);return m.exports;}
const commands=load("src/voice/chinese-command.ts"),quick=load("src/voice/quick-photo-request.ts",{"./chinese-command":commands});
let photos=0,reads=0,releases=0,cancelled=false,seenArgs,learned;
const logs=[],stages=[];
const runtime=load("src/agent/companion-runtime.ts",{
  "expo/fetch":{},"./companion-agent":{CompanionAgent:class {constructor(){throw new Error("shortcut must not create Pi");}}},
  "./newapi-config":{readNewApiConfig:async()=>{reads++;throw new Error("shortcut must not read a model key");}},"./newapi-stream":{},
  "../memory/recent-dialogue":load("src/memory/recent-dialogue.ts"),
  "../diagnostics/diagnostic-log":{},"./phone-tools":{phoneTools:[]},"../memory/memory-service":{mirrorSessionTouch(){},mirrorSessionMessage:(_id,m)=>logs.push(m)},
  "../hermes/task-runtime":{},"../artifacts/artifact-store":{},"../artifacts/artifact-focus":{},"../artifacts/presentation":{resultPresentation:{holdCountdown:()=>()=>{releases++;}}},
  "../artifacts/media-jobs":{},"expo-crypto":{},"./restored-context":{},"../skills/skill-runtime":{observeSkillTool:(...args)=>{learned=args;}},
  "../voice/quick-photo-request":quick,"./camera-tools":{photoTool:{execute:async(_id,args,signal)=>{photos++;seenArgs=args;assert.equal(signal.aborted,false);return {content:[],details:{cancelled}};}}},
  "./companion-progress":{updateCompanionProgress:v=>stages.push(v)}
});
const signal=new AbortController().signal,feedback=[];
assert.equal(await runtime.replyToCompanion("帮我用后置摄像头拍一张照片",signal,v=>feedback.push(v)),"照片已经确认并保存。");
assert.equal(photos,1);assert.equal(reads,0);assert.deepEqual(seenArgs,{camera:"back"});assert.equal(learned[0],"phone_photo");
assert.equal(stages.at(-1).phase,"idle");assert.match(feedback[0].text,/取景.*摆好姿势/);assert.doesNotMatch(feedback[0].text,/确定|重拍|取消/);assert.equal(logs.length,2);
cancelled=true;assert.equal(await runtime.replyToCompanion("拍张照片",signal),"拍照已取消。");
const aborted=new AbortController();aborted.abort();await assert.rejects(runtime.replyToCompanion("拍张照片",aborted.signal),/停止/);
assert.equal(photos,2);assert.equal(releases,3);
console.log("Quick photo runtime: no model key/request, exact facing, confirmation/cancel receipts, learning, history and abort: PASS");
