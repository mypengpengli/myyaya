import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript'),m={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync('src/navigation/local-goal-controller.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);
const {LocalGoalController,cameraYaw}=m.exports,g={centerRightMeters:.07,alongViewMeters:.05,widthMeters:.15,lengthMeters:.1,marginMeters:.05};
assert.ok(Math.abs(cameraYaw([0,0,0,1]))<1e-8);assert.throws(()=>cameraYaw([0,0,0,0]));
function rig(){return new LocalGoalController({x:0,y:.5},g,0);}
const open=rig();assert.equal(open.plan().phase,'ADVANCE');
const obstacle=rig();obstacle.observe([[.07,.3,2,30]]);const plan=obstacle.plan();assert.equal(plan.phase,'TURN');assert.ok(plan.path.some(p=>Math.abs(p.x)>=.15));
const drop=rig();drop.observe([[.07,.3,3,30]]);assert.equal(drop.plan().phase,'TURN');
const wall=rig();wall.observe(Array.from({length:61},(_,i)=>[(i-30)*.05,.3,2,40]));assert.equal(wall.plan().phase,'OBSERVE_SIDE');
const flow=(x,z)=>({cumulativePoseAvailable:true,originContinuity:true,originTimestampNs:1,cumulativeCameraDxMeters:x,cumulativeCameraDzMeters:z});
const move=rig();move.applyMotion({completed:true,motorStopAcknowledged:true,rawPoseYawRadians:0,floorFlowBefore:flow(0,0),floorFlowAfter:flow(0,-.05)});assert.ok(Math.abs(move.pose.y-.05)<1e-8);
assert.throws(()=>move.applyMotion({completed:true,motorStopAcknowledged:true,rawPoseYawRadians:0,floorFlowBefore:flow(0,0),floorFlowAfter:{...flow(0,-.05),originTimestampNs:2}}));
const lostTurn=rig();lostTurn.applyMotion({direction:'right_step',completed:true,motorStopAcknowledged:true,rawPoseYawRadians:.2});assert.ok(Math.abs(lostTurn.pose.yaw-.2)<1e-8);assert.equal(lostTurn.pose.x,0);assert.equal(lostTurn.positionUncertaintyMeters,.01);
assert.throws(()=>lostTurn.applyMotion({direction:'back_step',completed:true,motorStopAcknowledged:true,rawPoseYawRadians:0}));
// Camera lever-arm motion from a pure turn must not move the estimated base center.
const angle=.2,turn=rig(),dx=-(Math.cos(angle)*g.centerRightMeters+Math.sin(angle)*g.alongViewMeters-g.centerRightMeters),dz=(-Math.sin(angle)*g.centerRightMeters+Math.cos(angle)*g.alongViewMeters-g.alongViewMeters);
turn.applyMotion({completed:true,motorStopAcknowledged:true,rawPoseYawRadians:angle,floorFlowBefore:flow(0,0),floorFlowAfter:flow(dx,dz)});assert.ok(Math.hypot(turn.pose.x,turn.pose.y)<1e-8);
const arrived=rig();arrived.pose.y=.46;assert.equal(arrived.plan().phase,'AT_GOAL');
assert.throws(()=>new LocalGoalController({x:0,y:5},g,0));
const sim=rig();sim.observe([[.07,.3,2,30]]);let iterations=0;
for(;iterations<80;iterations++) {
 const p=sim.plan();if(p.phase==='AT_GOAL') break;
 assert.ok(['TURN','ADVANCE'].includes(p.phase));
 if(p.phase==='TURN') sim.pose.yaw+=Math.sign(p.headingError)*Math.min(Math.abs(p.headingError),.2);
 else {sim.pose.x+=Math.sin(sim.pose.yaw)*.03;sim.pose.y+=Math.cos(sim.pose.yaw)*.03;assert.ok(Math.hypot(sim.pose.x,sim.pose.y-.25)>.12);}
}
assert.ok(iterations<80,'must reach the goal around the object, not merely stop at it');
console.log('Local goal: obstacle detour, real wall/no path, drop footprint, near goal, continuous floor motion, turn lever arm, invalid input: PASS');
