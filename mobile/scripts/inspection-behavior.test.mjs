import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {DatabaseSync} from "node:sqlite";
const require=createRequire(import.meta.url),ts=require("typescript");
function load(path,mocks={}){const m={exports:{}};new Function("require","module","exports",ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>mocks[name]??require(name),m,m.exports);return m.exports;}
const {InspectionService}=load("src/inspection/inspection-service.ts"),{boundedRecentDialogue}=load("src/memory/recent-dialogue.ts");
const rows=new Map(),storage={list:()=>[...rows.values()].map(s=>JSON.parse(s)),save:t=>rows.set(t.id,JSON.stringify(t))};
let service=new InspectionService(storage);service.begin("task","map","observe","existing");
const observation={id:"photo",roomId:"kitchen",room:"厨房",at:1000,x:0,y:1,artifactId:"photo",analysis:"pending",summary:"尚未分析"};
service.add("task",observation);service.add("task",observation);assert.equal(service.find("task").observations.length,1);
service=new InspectionService(storage);service.recover();assert.equal(service.find("task").phase,"paused");assert.equal(service.find("task").returned,false);
service.begin("task","map","observe","existing");service.finishTravel("task",true,"已确认返回");service.settle("task");assert.equal(service.find("task").phase,"analyzing");
service.describe("task","photo","看到地板上的纸盒。",true);service.settle("task");assert.equal(service.find("task").phase,"completed");
assert.equal(service.summaries("厨房")[0].observations[0].at,1000);assert.equal(service.find("task").returned,true);
service.assignRoom("task","photo","region-kitchen","待命名房间1");
service.relabelRooms("other-map",[{id:"region-kitchen",name:"错误地点"}]);assert.equal(service.find("task").observations[0].room,"待命名房间1");
const observedOrder=service.find("task").updatedAt;service.relabelRooms("map",[{id:"region-kitchen",name:"厨房"}]);assert.equal(service.find("task").updatedAt,observedOrder,"room renaming must not make an old task look newly executed");assert.equal(service.summaries("厨房")[0].observations[0].at,1000);
assert.throws(()=>service.begin("task","map","observe","existing"),/结束/);
service.begin("cancel","map","photo","existing");service.finishTravel("cancel",false,"取消",true);assert.throws(()=>service.add("cancel",observation),/暂停/);
const history=JSON.parse(boundedRecentDialogue(Array.from({length:100},(_,i)=>({role:i%2?"assistant":"user",content:"历史"+i+"。".repeat(1500),timestamp:String(i)}))));
assert.ok(history.length<=48);assert.ok(history.reduce((s,r)=>s+r.content.length,0)<=12000);assert.equal(history.at(-1).timestamp,"99");
const sql=new DatabaseSync(":memory:");
const adapter={execAsync:async q=>sql.exec(q),runAsync:async(q,...args)=>sql.prepare(q).run(...args),getAllAsync:async(q,...args)=>sql.prepare(q).all(...args),getFirstAsync:async(q,...args)=>sql.prepare(q).get(...args)};
const dbMocks={"expo-sqlite":{openDatabaseAsync:async()=>adapter},"../diagnostics/diagnostic-log":{recordDiagnosticEvent(){}},"./local-memory-search":load("src/memory/local-memory-search.ts")};
const conversations=load("src/memory/local-memory-database.ts",dbMocks).localMemoryDatabase;
for(let i=0;i<55;i++)await conversations.addSessionMessage("first-process",{role:i%2?"assistant":"user",content:`问答${i}`});
const restarted=load("src/memory/local-memory-database.ts",dbMocks).localMemoryDatabase;
const recovered=await restarted.recentConversationMessages();assert.equal(recovered.length,48);assert.equal(recovered[0].content,"问答7");assert.equal(recovered.at(-1).content,"问答54");sql.close();

// Run the persisted SQLite facade, real camera orchestration and report worker with mocked hardware/network.
const persisted=new Map(),files=new Map([["file:///cache/monocular-benchmark/frame.jpg","actual-jpeg-base64"]]),artifacts=new Map(),announcements=[];
let owner="nav",nativeToken="native",cameraCalls=0,modelCalls=0,moving=false,phase="WAYPOINT_REACHED";
const native={getContinuousStatus:async()=>({token:nativeToken,sentSpeed:moving?100:0,sentTurn:0,stopAcknowledged:!moving,phase}),captureNativeSceneFrame:async()=>{cameraCalls++;return {jpegUri:"file:///cache/monocular-benchmark/frame.jpg"};}};
const runtime=()=>load("src/inspection/inspection-runtime.ts",{
  "expo-sqlite":{openDatabaseSync:()=>({execSync(){},getAllSync:()=>[...persisted.values()].map(data=>({data})),runSync:(_q,id,_time,data)=>persisted.set(id,data)})},
  "expo-file-system/legacy":{cacheDirectory:"file:///cache/",EncodingType:{Base64:"base64"},readAsStringAsync:async uri=>{if(!files.has(uri))throw Error("file missing");return files.get(uri);},deleteAsync:async()=>{}},
  "react-native":{AppState:{currentState:"active",addEventListener(){}}},"expo/fetch":{},"./inspection-service":{InspectionService},
  "../artifacts/artifact-store":{findArtifact:id=>artifacts.get(id),savePhotoArtifact:async(data,mime,title,_parent,options)=>{assert.equal(data,"actual-jpeg-base64");assert.equal(options.select,false);const item={id:options.id,uri:"file:///photo.jpg",mimeType:mime};artifacts.set(item.id,item);files.set(item.uri,data);return item;}},
  "../agent/companion-agent":{CompanionAgent:class{async reply(text,signal,_feedback,images){modelCalls++;assert.match(text,/不要猜人名/);assert.equal(images[0].data,"actual-jpeg-base64");return "看见地板和一个纸盒，人物活动看不清。";}}},
  "../agent/newapi-stream":{createNewApiStream:()=>{}},"../agent/newapi-config":{readNewApiConfig:async()=>({})},
  "../voice/chinese-voice-runtime":{chineseVoice:{announce:async text=>{announcements.push(text);return true;}}},
  "../core/navigation-control-lease":{getNavigationControlOwner:()=>owner},"../../modules/navigation-probe":native
});
let r=runtime();const db=r.getInspectionService();db.begin("trip","home","photo","existing");
moving=true;await assert.rejects(r.captureInspectionObservation({id:"trip",key:"trip-kitchen",room:"厨房",pose:{x:0,y:1},token:"native"}),/停车/);assert.equal(cameraCalls,0);
moving=false;await r.captureInspectionObservation({id:"trip",key:"trip-kitchen",room:"厨房",pose:{x:0,y:1},token:"native"});
assert.equal(cameraCalls,1);assert.equal(modelCalls,0,"taking a photo never waits on its semantic model");
await r.processInspectionReports();assert.equal(modelCalls,0,"a navigation owner excludes background image analysis");
db.finishTravel("trip",true,"停车回执通过");owner=undefined;await r.processInspectionReports();
assert.equal(modelCalls,1);assert.equal(db.find("trip").phase,"completed");assert.ok(announcements[0].includes("已经返回"));
await r.processInspectionReports();assert.equal(modelCalls,1);assert.equal(announcements.length,1);
r=runtime();assert.equal(r.getInspectionService().summaries("厨房")[0].observations[0].artifactId,"trip-kitchen");
assert.ok(r.getInspectionService().summaries("厨房")[0].observations[0].summary.includes("看不清"));
assert.ok(!r.inspectionReceipt({...db.find("trip"),returned:false,phase:"paused"}).includes("已经返回"));
const commands=load("src/voice/chinese-command.ts"),voice=load("src/navigation/home-voice.ts",{"../voice/chinese-command":commands});
assert.deepEqual(voice.parseHomeVoice("去厨房拍照再回来"),{op:"inspect",scope:"place",action:"photo",target:"厨房"});
assert.deepEqual(voice.parseHomeVoice("巡视各个房间"),{op:"inspect",scope:"all",action:"observe"});
console.log("Inspection persistence: pause/restart, bounded history, real parked-camera capture, deferred analysis, dated room reports and honest return receipts: PASS");
