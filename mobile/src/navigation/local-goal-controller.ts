import type { NearStepGeometry } from "./near-step-guard";

export type GoalPose={x:number;y:number;yaw:number};
export type GroundCell=[number,number,number,number];
const CELL=.05,wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
export function cameraYaw(q:number[]) {
  if(q.length!==4 || !q.every(Number.isFinite) || Math.abs(Math.hypot(...q)-1)>.02) throw new Error("无效相机朝向");
  const [x,y,z,w]=q;return Math.atan2(-2*(x*z+y*w),1-2*(x*x+y*y));
}
/** Local grid plans through unknown at extra cost; every actual translation is observed again. */
export class LocalGoalController {
  pose:GoalPose={x:0,y:0,yaw:0};
  readonly cells=new Map<string,{x:number;y:number;label:number;clearVotes:number}>();
  private originYaw:number;
  private bestDistance:number;
  private stagnant=0;
  constructor(readonly goal:{x:number;y:number},readonly geometry:NearStepGeometry,initialYaw:number) {
    if(![goal.x,goal.y,initialYaw].every(Number.isFinite) || Math.hypot(goal.x,goal.y)<.15 || Math.hypot(goal.x,goal.y)>1) throw new Error("局部目标应在15厘米至1米内");
    this.originYaw=initialYaw;this.bestDistance=Math.hypot(goal.x,goal.y);
  }
  setHeading(worldYaw:number) {this.pose.yaw=wrap(worldYaw-this.originYaw);}
  observe(cells:GroundCell[]) {
    const c=Math.cos(this.pose.yaw),s=Math.sin(this.pose.yaw);
    for(const [cameraX,cameraY,label,count] of cells) {
      if(![cameraX,cameraY,label,count].every(Number.isFinite)||![1,2,3].includes(label)||count<3) continue;
      const x=cameraX-this.geometry.centerRightMeters,y=cameraY-this.geometry.alongViewMeters;
      const gx=Math.round((this.pose.x+c*x+s*y)/CELL),gy=Math.round((this.pose.y-s*x+c*y)/CELL),key=`${gx},${gy}`,old=this.cells.get(key);
      // Re-observed floor can clear model ghosts; hidden cells receive no clearing votes.
      if(!old || label!==1) this.cells.set(key,{x:gx,y:gy,label,clearVotes:0});
      else if(old.label!==1 && count>=12) {old.clearVotes++;if(old.clearVotes>=2) old.label=1;}
    }
  }
  applyMotion(segment:Record<string,any>) {
    const a=segment.floorFlowBefore,b=segment.floorFlowAfter;
    if(!segment.completed || !segment.motorStopAcknowledged || !a?.cumulativePoseAvailable || !b?.cumulativePoseAvailable
      || a.originTimestampNs!==b.originTimestampNs || !a.originContinuity || !b.originContinuity) throw new Error("本段视觉位姿不连续，不能累计到目标");
    const dx=b.cumulativeCameraDxMeters-a.cumulativeCameraDxMeters,dz=b.cumulativeCameraDzMeters-a.cumulativeCameraDzMeters;
    const dyaw=segment.rawPoseYawRadians;
    if(![dx,dz,dyaw].every(Number.isFinite) || Math.hypot(dx,dz)>.18 || Math.abs(dyaw)>.6) throw new Error("本段位姿跳变");
    const oldYaw=this.pose.yaw,newYaw=wrap(oldYaw+dyaw);
    // Floor-flow translation uses ARCore's gravity basis, never ARCore translation.
    const c=Math.cos(this.originYaw),s=Math.sin(this.originYaw),g=this.geometry;
    const ox=(yaw:number)=>Math.cos(yaw)*g.centerRightMeters+Math.sin(yaw)*g.alongViewMeters;
    const oy=(yaw:number)=>-Math.sin(yaw)*g.centerRightMeters+Math.cos(yaw)*g.alongViewMeters;
    this.pose.x+=c*dx+s*dz+ox(newYaw)-ox(oldYaw);
    this.pose.y+=s*dx-c*dz+oy(newYaw)-oy(oldYaw);
    this.pose.yaw=newYaw;
    const d=this.distance();if(d<this.bestDistance-.01){this.bestDistance=d;this.stagnant=0;}else this.stagnant++;
  }
  distance(){return Math.hypot(this.goal.x-this.pose.x,this.goal.y-this.pose.y);}
  plan():{phase:string;path:Array<{x:number;y:number}>;turn?:"left_step"|"right_step";turnMs?:100|150;headingError?:number} {
    if(this.distance()<=.06) return {phase:"AT_GOAL",path:[]};
    if(this.stagnant>32) return {phase:"NO_PROGRESS",path:[]};
    const radius=Math.max(this.geometry.widthMeters,this.geometry.lengthMeters)/2+this.geometry.marginMeters+.01;
    const blocked=new Set<string>();
    for(const cell of this.cells.values()) if(cell.label!==1) {
      const r=Math.ceil(radius/CELL);
      for(let x=-r;x<=r;x++) for(let y=-r;y<=r;y++) if(Math.hypot(x,y)*CELL<=radius+.025) blocked.add(`${cell.x+x},${cell.y+y}`);
    }
    const sx=Math.round(this.pose.x/CELL),sy=Math.round(this.pose.y/CELL),tx=Math.round(this.goal.x/CELL),ty=Math.round(this.goal.y/CELL);
    const key=(x:number,y:number)=>`${x},${y}`,root=key(sx,sy),target=key(tx,ty);
    const open=[{x:sx,y:sy,g:0,f:Math.hypot(tx-sx,ty-sy)}],cost=new Map([[root,0]]),parent=new Map<string,string>();
    let found:string|undefined,expanded=0;
    const steps=[[-1,0],[1,0],[0,1],[0,-1],[-1,1],[1,1],[-1,-1],[1,-1]];
    while(open.length && expanded++<2500) {
      let best=0;for(let n=1;n<open.length;n++) if(open[n].f<open[best].f) best=n;
      const p=open.splice(best,1)[0],pk=key(p.x,p.y);if(p.g!==(cost.get(pk) ?? Infinity)) continue;
      if(pk===target){found=pk;break;}
      for(const [dx,dy] of steps) {
        const x=p.x+dx,y=p.y+dy,k=key(x,y);
        if(Math.abs(x)>30||Math.abs(y)>30||blocked.has(k) || (dx&&dy&&(blocked.has(key(p.x+dx,p.y))||blocked.has(key(p.x,p.y+dy))))) continue;
        const g=p.g+Math.hypot(dx,dy)*(this.cells.get(k)?.label===1?1:2.5);
        if(g>=(cost.get(k) ?? Infinity)) continue;cost.set(k,g);parent.set(k,pk);open.push({x,y,g,f:g+Math.hypot(tx-x,ty-y)});
      }
    }
    if(!found) return {phase:"OBSERVE_SIDE",path:[]};
    const path:Array<{x:number;y:number}>=[];let k:string|undefined=found;
    while(k && k!==root){const [x,y]=k.split(",").map(Number);path.unshift({x:x*CELL,y:y*CELL});k=parent.get(k);}
    let look=path[0];
    // Only shorten a path when its continuous segment avoids the inflated obstacles.
    for(const p of path) {
      const d=Math.hypot(p.x-this.pose.x,p.y-this.pose.y);if(d>.14) break;
      let clear=true;for(let t=0;t<=1;t+=.1) if(blocked.has(key(Math.round((this.pose.x+(p.x-this.pose.x)*t)/CELL),Math.round((this.pose.y+(p.y-this.pose.y)*t)/CELL)))) clear=false;
      if(clear) look=p;else break;
    }
    if(!look) return {phase:"OBSERVE_SIDE",path:[]};
    const error=wrap(Math.atan2(look.x-this.pose.x,look.y-this.pose.y)-this.pose.yaw);
    return Math.abs(error)>.16 ? {phase:"TURN",path,turn:error>0?"right_step":"left_step",turnMs:Math.abs(error)>.35?150:100,headingError:error}
      : {phase:"ADVANCE",path,headingError:error};
  }
}
