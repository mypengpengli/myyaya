import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
function load(file, mocks = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file,"utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function("require","module","exports",js)((id)=>mocks[id]??require(id),module,module.exports);
  return module.exports;
}
const drain = async () => { for(let i=0;i<180;i++) await Promise.resolve(); };
const lease = load("src/core/navigation-control-lease.ts");
const chinese = load("src/voice/chinese-command.ts");
const app = { currentState:"active", addEventListener:(_event,cb)=>{ lifecycle=cb;return {remove(){ lifecycle=undefined; }}; } };
let event, token, close, lifecycle, voiceResult, voiceStops=0, releasedCamera=0, releasedMic=0;
let deferredStop, connected=true,homeStarts=0;
const homeCommands=[];
const pulses=[],acks=[],pending=[],nativeStops=[],heads=[];
const native = {
  subscribeRouteMotion(cb){event=cb;return {remove(){event=undefined;}};},
  getHomeStatus:async()=>({task:"{}"}),sendHomeCommand:async v=>{homeCommands.push(v);return {notice:"saved"};},publishRouteRobotState:async()=>{},
  acknowledgeRouteMotion:async(_token,id,ok)=>{acks.push({id,ok});},
  stopNativeTaughtRoute:async(t)=>{nativeStops.push(t);},
  openNativeTaughtRoutes(t){token=t;return new Promise(resolve=>{close=resolve;});},
};
const robot = {
  getLooiRobotRuntimeState:()=>({connected}), subscribeLooiRobotRuntimeState:()=>()=>{},
  navigationDrivePermits:()=>({back:true,turn:true}),setLooiHead:async(direction)=>{heads.push(direction);},
  stopLooiMotion:async(reason)=>{ if(reason==="navigation-stop" && deferredStop) await new Promise(resolve=>{deferredStop=resolve;}); },
  moveLooiNavigationPulse:(dir,ms,owner)=>{lease.assertNavigationControl(owner);pulses.push({dir,ms});return new Promise(resolve=>pending.push(()=>resolve({completed:true})));},
  moveLooiOperatorTurnCalibration:(dir,owner)=>{lease.assertNavigationControl(owner);pulses.push({dir,ms:350});return new Promise(resolve=>pending.push(()=>resolve({completed:true})));},
};
const voice={stop:async()=>{},pauseCaptureForRecording:async()=>async()=>{releasedMic++;}};
const voiceListeners=new Map();
const vosk={stopChineseSpeech(){},speakChinese:async()=>{},prepareChinese:async()=>({sessionId:44}),startChineseCapture:async()=>({running:true}),stopChineseCapture:async()=>{voiceStops++;},
  addListener:(name,cb)=>{
    if(!voiceListeners.has(name))voiceListeners.set(name,new Set());voiceListeners.get(name).add(cb);
    voiceResult=event=>voiceListeners.get("onCommandResult")?.forEach(fn=>fn(event));
    return {remove(){voiceListeners.get(name)?.delete(cb);}};
  }};
const session=load("src/navigation/route-robot-session.ts",{
  "react-native":{AppState:app,PermissionsAndroid:{PERMISSIONS:{CAMERA:"camera",RECORD_AUDIO:"mic"},RESULTS:{GRANTED:"granted"},request:async()=>"granted",check:async()=>true}},
  "../../modules/navigation-probe":native,
  "./current-home":load("src/navigation/current-home.ts"),
  "../voice/chinese-voice-session":load("src/voice/chinese-voice-session.ts",{"./chinese-command":chinese,"./conversation-feedback":load("src/voice/conversation-feedback.ts")}),
  "../voice/chinese-voice-preferences":{getChineseAsrMode:()=>"local",getChineseEndSilence:()=>1.8},
  "expo-file-system/legacy":{},
  "../diagnostics/diagnostic-log":{recordDiagnosticEvent(){}},
  "./navigation-speech":load("src/navigation/navigation-speech.ts"),
  "../core/background-process-exit":{withExternalActivityLease:async(_r,fn)=>fn()},
  "../core/navigation-control-lease":lease,
  "../core/social-attention":{pauseSocialCamera:async()=>()=>{releasedCamera++;}},
  "../core/app-bootstrap":{pauseAppRuntime:async(r)=>{assert.equal(r,"navigation");},resumeAppRuntime:async()=>{}},
  "../device-tools/looi-robot":robot,
  "../device-tools/looi-robot-autoconnect":{forceReconnectSavedLooiRobot:async()=>({ok:true})},
  "../voice/chinese-command":chinese,
  "./home-voice":load("src/navigation/home-voice.ts",{"../voice/chinese-command":chinese}),
  "./home-mission":{waitForHomeMission:async()=>{},runHomeMission:async()=>{homeStarts++;}},
  "../voice/chinese-voice-runtime":{chineseVoice:voice,resumeAutomaticChineseVoice(){}},
  "../../modules/vosk-command-recognizer":{default:vosk,__esModule:true},
});
const task=session.openTaughtRouteSession();await drain();assert.ok(token);assert.equal(lease.hasNavigationControl(),true);
await assert.rejects(session.openTaughtRouteSession(),/已经打开/);
event({token:"other",sequence:1,action:"back",durationMs:100});await drain();assert.equal(pulses.length,0);
event({token,sequence:1,action:"back",durationMs:100});await drain();assert.equal(pulses.length,1);
deferredStop=true;
event({token,sequence:2,action:"stop",durationMs:0});await drain();
event({token,sequence:3,action:"back",durationMs:100});await drain();assert.equal(pulses.length,1,"new drive waits for STOP completion");
pending.shift()();await drain();assert.equal(acks.length,0,"cancelled request cannot acknowledge success late");
deferredStop();await drain();assert.equal(pulses.length,2);
pending.shift()();await drain();assert.deepEqual(acks,[{id:3,ok:true}]);
event({token,sequence:2,action:"head_center",durationMs:0});await drain();assert.equal(acks.length,1);
event({token,sequence:4,action:"head_down",durationMs:0});await drain();assert.deepEqual(heads,["down"]);
event({token,sequence:5,action:"calibration_left",durationMs:600});await drain();assert.equal(pulses.length,2,"wrong duration cannot dispatch a larger turn");
event({token,sequence:6,action:"calibration_left",durationMs:350});await drain();assert.deepEqual(pulses.at(-1),{dir:"left",ms:350});
pending.shift()();await drain();
voiceResult({sessionId:44,text:"小丫小丫，停止导航",partial:true});await drain();assert.deepEqual(nativeStops,[token]);
voiceResult({sessionId:45,text:"停止",partial:true});await drain();assert.equal(nativeStops.length,1);
voiceResult({sessionId:45,text:"取消导航",partial:true});await drain();assert.equal(nativeStops.length,1,"stale recognizer cannot cancel a new task");
voiceResult({sessionId:44,text:"取消导航",partial:true});await drain();assert.equal(homeCommands.at(-1).op,"cancel");
app.currentState="background";lifecycle("background");await drain();assert.ok(voiceStops>0);
event({token,sequence:7,action:"back",durationMs:100});await drain();assert.equal(pulses.length,3,"background cannot drive");
close(null);await task;assert.equal(lease.hasNavigationControl(),false);assert.equal(event,undefined);
assert.equal(releasedCamera,1);assert.equal(releasedMic,1);
app.currentState="active";deferredStop=undefined;
const second=session.openTaughtRouteSession();await drain();
deferredStop=true;event({token,sequence:1,action:"stop",durationMs:0});await drain();
event({token,sequence:2,action:"home_navigate",durationMs:0});await drain();
event({token,sequence:3,action:"head_down",durationMs:0});await drain();
deferredStop();await drain();assert.equal(homeStarts,0,"queued navigation superseded during STOP must never start later");
close(null);await second;
console.log("Route session: ownership, STOP serialization, late ack, foreground, Chinese stop and cleanup: PASS");
