import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function load(file,mocks={}){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(id=>{assert.ok(id in mocks,id);return mocks[id];},m,m.exports);return m.exports;}
const nav=load('src/navigation/local-goal-controller.ts'),route=load('src/navigation/home-route.ts');
const origin={x:5,y:4,yaw:Math.PI/2};
for(const p of [{x:0,y:3,yaw:.4},{x:-1,y:2,yaw:-.5}]){
 const actual=route.homeToLocal(route.localToHome(p,origin),origin);assert.ok(Math.hypot(actual.x-p.x,actual.y-p.y)<1e-8);
}
const longRoute=new route.HomeRouteCursor([{x:0,y:0,yaw:0},{x:0,y:49,yaw:0}]);assert.equal(longRoute.total,49);
const corner=new route.HomeRouteCursor([{x:0,y:0,yaw:0},{x:0,y:1,yaw:0},{x:1,y:1,yaw:Math.PI/2}]);
const before=corner.select({x:0,y:.7,yaw:0});assert.equal(before.target.x,0);assert.equal(before.target.y,1,'lookahead must stop at corner');
assert.ok(corner.select({x:0,y:.96,yaw:0}).target.x>0);
assert.throws(()=>corner.select({x:3,y:3,yaw:0}),/偏离/);
const repeated=new route.HomeRouteCursor([{x:0,y:0,yaw:0},{x:0,y:0,yaw:1},{x:0,y:1,yaw:1}]);assert.ok(repeated.total===1);
const grid=new nav.LocalGoalController({x:0,y:.5},{centerRightMeters:.07,alongViewMeters:.05,widthMeters:.15,lengthMeters:.1,marginMeters:.02},0);
grid.pose={x:0,y:3,yaw:0};grid.setGoal({x:0,y:3.4});assert.equal(grid.plan().phase,'ADVANCE','rolling window must work beyond old 1.5m origin');
grid.setForbidden([{x:0,y:3.2,radius:.1}]);
for(let n=0;n<3;n++)grid.observe([[.07,.25,1,100]]);
assert.ok(grid.occupiedCells().some(c=>Math.abs(c.x)<.03&&Math.abs(c.y-3.2)<.03),'floor cannot erase configured keepout');

const precise=new nav.LocalGoalController({x:0,y:.15},{centerRightMeters:.07,alongViewMeters:.05,widthMeters:.15,lengthMeters:.1,marginMeters:.02},0,.01);
precise.setGoal({x:0,y:.02});assert.notEqual(precise.plan().phase,'AT_GOAL','a 2cm target must not be declared reached without movement');
precise.pose={x:0,y:.015,yaw:0};assert.equal(precise.plan().phase,'AT_GOAL');
const chinese=load('src/voice/chinese-command.ts');
const {parseHomeVoice}=load('src/navigation/home-voice.ts',{'../voice/chinese-command':chinese});
assert.deepEqual(parseHomeVoice('小丫小丫，这里是客厅。'),{op:'remember',name:'客厅',room:'客厅',kind:'room'});
assert.deepEqual(parseHomeVoice('小丫小丫，我们搬家了，这里叫新家。'),{op:'new_location',name:'新家'});
assert.deepEqual(parseHomeVoice('新建地点办公室'),{op:'new_location',name:'办公室'});
assert.equal(parseHomeVoice('上次搬家了以后很忙'),null);
assert.deepEqual(parseHomeVoice('把这里记为客厅门口'),{op:'remember',name:'客厅门口',kind:'door'});
assert.deepEqual(parseHomeVoice('请去客厅吧'),{op:'go',target:'客厅'});
assert.deepEqual(parseHomeVoice('把客厅改名为大厅'),{op:'rename',id:'客厅',name:'大厅'});
assert.deepEqual(parseHomeVoice('继续导航'),{op:'resume'});assert.deepEqual(parseHomeVoice('取消导航'),{op:'cancel'});
assert.equal(parseHomeVoice('我觉得客厅挺好的'),null);
assert.deepEqual(parseHomeVoice('你到周围转一圈'),{op:'patrol'});
assert.deepEqual(parseHomeVoice('去附近看看再回来'),{op:'patrol'});
assert.notEqual(parseHomeVoice('原地转一圈')?.op,'patrol');

function rig(mode='success') {
 let state={stopEpoch:3,active:false},homeCalls=0,planCalls=0;
 const calls={starts:0,observes:0,stops:0,releases:0,finishes:0,retargets:0,reports:[]};
 const g={centerRightMeters:.07,alongViewMeters:.05,widthMeters:.15,lengthMeters:.1,marginMeters:.02};
 const pts=[{x:0,y:0,yaw:0},{x:0,y:1,yaw:0},{x:0,y:2,yaw:0},{x:0,y:3,yaw:0}].map(p=>route.localToHome(p,origin));
 const plan={taskId:'task',mapId:'home',revision:1,poseRevision:2,origin,points:pts,zones:[],targetName:'客厅'};
 let goal={x:0,y:.4},final=false;
 const native={
  getHomePlan:async()=>{planCalls++;return {...plan,revision:mode==='changed-before-start'&&planCalls>1?2:1};},
  prepareHomeCapture:async()=>{},getNavigationProbeStatus:async()=>({measuredCameraHeightMeters:.08,navigationGeometry:g}),
  getHomeStatus:async()=>{homeCalls++;if(mode==='replacement-task'){state={...state,token:'replacement',stopAcknowledged:true};throw new Error('session replaced');}return {atlas:{mapId:'home',revision:mode==='changed-during-run'&&homeCalls>1?2:1},poseRevision:2,connectionConfirmed:true,localized:true};},
  getContinuousStatus:async()=>({...state,pose:state.pose?{...state.pose}:undefined}),
  startNativeContinuous:async(_device,epoch,x,y)=>{
   assert.equal(epoch,3);assert.ok(Math.hypot(x,y)<=1);calls.starts++;state={...state,token:'one-task',active:true,poseReady:true,frameNs:1e9,pose:{x:0,y:0,yaw:0}};return state;
  },
  retargetNativeContinuous:async(token,target,last)=>{assert.equal(token,'one-task');assert.ok(Math.hypot(target.x-state.pose.x,target.y-state.pose.y)<=1.2);goal=target;final=last;calls.retargets++;},
  observeNativeContinuous:async(token,data)=>{
   assert.equal(token,'one-task');assert.ok(data.path.length);calls.observes++;
   state.pose.y=Math.min(goal.y,state.pose.y+.10);
   if(final && Math.hypot(goal.x-state.pose.x,goal.y-state.pose.y)<=.06){state.phase='AT_GOAL';state.active=false;}
  },
  stopNativeContinuous:async()=>{calls.stops++;state.active=false;state.stopAcknowledged=true;},
  sendHomeCommand:async()=>({}),
  publishHomeProgress:async v=>calls.reports.push(v)
 };
 const probe={releaseContinuousVision:async()=>calls.releases++,runFloorVisionProbe:async()=>{
  if(mode==='inference-error')throw new Error('model failed');
  return {frame:{imageTimestampNs:1e9,navigationPose:{...state,pose:state.pose?{...state.pose}:undefined}},selectedFloorRegion:{left:.35,top:.75,right:.65,bottom:.94},navigationCells:[[.07,.4,1,30]]};
 }};
 const mod=load('src/navigation/home-mission.ts',{'../../modules/navigation-probe':native,'../device-tools/looi-robot':{prepareNativeNavigationDrive:async()=>({device:'same-ble-owner',finish:()=>calls.finishes++})},
  '../core/navigation-control-lease':{getNavigationControlOwner:()=> 'owner'},'./local-goal-controller':nav,'../diagnostics/floor-vision-probe':probe,'./home-route':route,'../inspection/inspection-coverage':load('src/inspection/inspection-coverage.ts',{'../navigation/home-route':route})});
 return {run:mod.runHomeMission,calls};
}
const good=rig();await good.run();assert.equal(good.calls.starts,1,'whole multi-meter route must share one native task');
assert.ok(good.calls.retargets>5);assert.ok(good.calls.observes>20);assert.equal(good.calls.reports.at(-1).phase,'COMPLETED');assert.equal(good.calls.stops,1);assert.equal(good.calls.releases,1);assert.equal(good.calls.finishes,1);
for(const mode of ['changed-before-start','changed-during-run','inference-error']){
 const bad=rig(mode);await bad.run();assert.equal(bad.calls.reports.at(-1).phase,'BLOCKED');assert.equal(bad.calls.stops,mode==='changed-during-run'?1:0);assert.equal(bad.calls.releases,1);
 if(mode!=='changed-during-run')assert.equal(bad.calls.starts,0,'failure before arming must not start motors');
}
const replaced=rig('replacement-task');await replaced.run();assert.equal(replaced.calls.stops,0,'old finally must never stop a replacement native task');
let owner='navigation',currentMap='home';const commands=[];
const atlas={mapId:'home',revision:1,requiresReference:true,places:[{id:'living',name:'客厅',room:'客厅',kind:'room',pose:{x:0,y:1,yaw:0}}],links:[],zones:[]};
const tools=load('src/agent/home-tools.ts',{'typebox':await import('typebox'),'react-native':{AppState:{currentState:'active'},Alert:{}},
 '../navigation/current-home':load('src/navigation/current-home.ts'),'../core/navigation-control-lease':{getNavigationControlOwner:()=>owner},'../../modules/navigation-probe':{
  listHomeAtlases:async()=>[atlas],getHomeStatus:async()=>({atlas:{mapId:currentMap}}),sendHomeCommand:async v=>{commands.push(v);return {notice:'saved'};}
 }}).createHomeTools();
const tool=name=>tools.find(t=>t.name===name);
await tool('navigate_home').execute('go',{place_id:'living'},new AbortController().signal);assert.equal(commands.at(-1).op,'go');
await assert.rejects(tool('navigate_home').execute('bad',{place_id:'invented'}),/真实|准确/);
currentMap='another';await assert.rejects(tool('navigate_home').execute('wrong',{map_id:'home',place_id:'living'}),/另一张地图/);currentMap='home';
const cancel=new AbortController();cancel.abort();const count=commands.length;await assert.rejects(tool('navigate_home').execute('cancel',{place_id:'living'},cancel.signal));assert.equal(commands.length,count);
await tool('edit_home_passage').execute('zone',{operation:'zone',place_id:'living',radius:.2});assert.equal(commands.at(-1).placeId,'living');
assert.equal('x' in tool('edit_home_passage').parameters.properties,false,'model cannot fabricate a coordinate');
owner='';const saved=await tool('home_navigation_control').execute('status',{operation:'status'});assert.equal(JSON.parse(saved.content[0].text).moving,false);
console.log('Home navigation: rotated coordinates, corners, rolling map, keepouts, voice, one-task 3m route, version changes and failure cleanup: PASS');
