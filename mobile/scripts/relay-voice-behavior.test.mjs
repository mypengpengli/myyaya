import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),ts=require("typescript");
function load(file,mocks={}){const m={exports:{}};new Function("require","module","exports",ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>mocks[n]??require(n),m,m.exports);return m.exports;}
const command=load("src/voice/chinese-command.ts"),feedback=load("src/voice/conversation-feedback.ts");
const {ChineseVoiceSession}=load("src/voice/chinese-voice-session.ts",{"./chinese-command":command,"./conversation-feedback":feedback});
const drain=async()=>{for(let i=0;i<90;i++)await Promise.resolve();};
function rig(){const listeners=new Map(),uploads=[],requests=[],discarded=[],actions=[];let resolve,reject;
 const native={prepareChinese:async()=>({sessionId:1}),configureChineseConversation:async()=>{},startChineseCapture:async()=>({running:true}),stopChineseCapture:async()=>{},speakChinese:async()=>{},stopChineseSpeech(){},addListener(n,f){listeners.set(n,f);return {remove:()=>listeners.delete(n)};}};
 const voice=new ChineseVoiceSession(native,async()=>true,()=>true,async c=>{actions.push(c);return "停止";},async()=>{},async text=>{requests.push(text);return "答复";},undefined,undefined,undefined,undefined,
 {settings:()=>({relay:true,silence:1.8}),transcribe:(uri,signal)=>{uploads.push({uri,signal});return new Promise((a,b)=>{resolve=a;reject=b;});},discard:async uri=>{discarded.push(uri);}});
 return {voice,uploads,requests,discarded,actions,resolve:v=>resolve(v),reject:()=>reject(new Error("network")),emit:(text,audioUri,partial=false)=>listeners.get("onCommandResult")?.({sessionId:1,text,audioUri,partial})};
}
const ambient=rig();await ambient.voice.start();ambient.emit("今天很忙","file:///ambient.wav");await drain();assert.equal(ambient.uploads.length,0);assert.equal(ambient.requests.length,0);assert.equal(ambient.discarded.length,1);
ambient.emit("小丫小丫","file:///wake.wav");await drain();assert.equal(ambient.uploads.length,0,"wake alone stays local");await ambient.voice.stop();
const success=rig();await success.voice.start();success.emit("小丫小丫今天甜气如何","file:///request.wav");await drain();assert.equal(success.uploads.length,1);assert.equal(success.requests.length,0);success.resolve("今天天气如何");await drain();assert.deepEqual(success.requests,["今天天气如何"]);assert.equal(success.discarded.length,1);await success.voice.stop();
const failed=rig();await failed.voice.start();failed.emit("小丫小丫帮我查天气","file:///failed.wav");await drain();failed.reject();await drain();assert.deepEqual(failed.requests,["小丫小丫帮我查天气"].map(v=>command.splitChineseWake(v).command));await failed.voice.stop();
const stopped=rig();await stopped.voice.start();stopped.emit("小丫小丫查天气","file:///late.wav");await drain();stopped.emit("停止",undefined,true);await drain();assert.equal(stopped.actions.at(-1).kind,"stop");assert.equal(stopped.uploads[0].signal.aborted,true);stopped.resolve("后退十厘米");await drain();assert.equal(stopped.requests.length,0);assert.equal(stopped.actions.length,1,"late relay result cannot drive");await stopped.voice.stop();
const local=rig();await local.voice.start();local.emit("小丫小丫后退十五厘米","file:///move.wav");await drain();assert.equal(local.uploads.length,0);assert.equal(local.actions[0].distanceCm,15);await local.voice.stop();
const continuing=rig();await continuing.voice.start();continuing.emit("小丫小丫帮我把这张照片","file:///part1.wav");await drain();
continuing.emit("改成",undefined,true);await drain();assert.equal(continuing.uploads[0].signal.aborted,true);
continuing.emit("改成水彩画","file:///part2.wav");await drain();continuing.resolve("改成水彩画");await drain();assert.deepEqual(continuing.requests,["帮我把这张照片改成水彩画"]);await continuing.voice.stop();
const complete=rig();await complete.voice.start();complete.emit("小丫小丫把灯关掉",undefined);await drain();assert.deepEqual(complete.requests,["把灯关掉"]);await complete.voice.stop();
const long=rig();await long.voice.start();long.emit("小丫小丫听我说完",undefined);await drain();long.emit("帮我做一份旅行计划",undefined);await drain();assert.equal(long.requests.length,0);long.emit("要包括住宿和交通，说完了",undefined);await drain();assert.deepEqual(long.requests,["帮我做一份旅行计划要包括住宿和交通，"]);await long.voice.stop();
const continuation=rig();await continuation.voice.start();continuation.emit("小丫小丫帮我把这个文件",undefined);await drain();assert.equal(continuation.requests.length,0);continuation.emit("改成蓝色主题",undefined);await drain();assert.deepEqual(continuation.requests,["帮我把这个文件改成蓝色主题"]);await continuation.voice.stop();
const transfer=rig();assert.equal(transfer.voice.continueRecognizedTurn("帮我查天气"),false);
await transfer.voice.start();assert.equal(transfer.voice.continueRecognizedTurn("帮我查天气"),true);await drain();assert.deepEqual(transfer.requests,["帮我查天气"]);await transfer.voice.stop();
console.log("Relay voice: no ambient upload, local wake/actions/STOP, single fallback, stale cancellation and general long-instruction hold: PASS");
