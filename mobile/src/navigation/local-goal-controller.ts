import type { NearStepGeometry } from "./near-step-guard";

export type GoalPose={x:number;y:number;yaw:number};
export type GroundCell=[number,number,number,number];
export type GoalPlan={phase:string;path:Array<{x:number;y:number}>;reason?:string;diagnostic?:{rootBlocked:boolean;freeNeighbors:number;expanded:number;goalBlockers:Array<{x:number;y:number;label:number}>;nearBlockers:Array<{x:number;y:number;label:number}>};turn?:"left_step"|"right_step";turnMs?:100|150;headingError?:number};
const CELL=.025,wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
export function cameraYaw(q:number[]) {
  if(q.length!==4 || !q.every(Number.isFinite) || Math.abs(Math.hypot(...q)-1)>.02) throw new Error("无效相机朝向");
  const [x,y,z,w]=q;return Math.atan2(-2*(x*z+y*w),1-2*(x*x+y*y));
}
/** Local grid plans through unknown at extra cost; every actual translation is observed again. */
export class LocalGoalController {
  readonly cellMeters=CELL;
  pose:GoalPose={x:0,y:0,yaw:0};
  positionUncertaintyMeters=0;
  readonly cells=new Map<string,{x:number;y:number;label:number;clearVotes:number;obstacleFrame?:number;floorFrame?:number}>();
  lastClearedCells=0;
  private observationFrame=0;
  private originYaw:number;
  private bestDistance:number;
  private stagnant=0;
  private forbidden:Array<{x:number;y:number;radius:number}>=[];
  setGoal(goal:{x:number;y:number}) {
    if(![goal.x,goal.y].every(Number.isFinite) || Math.hypot(goal.x-this.pose.x,goal.y-this.pose.y)>1.2)throw new Error("下一个路线点超出局部范围");
    Object.assign(this.goal,goal);this.bestDistance=this.distance();this.stagnant=0;
  }
  setForbidden(zones:Array<{x:number;y:number;radius:number}>) {
    if(zones.length>64 || zones.some(z=>![z.x,z.y,z.radius].every(Number.isFinite)||z.radius<.05||z.radius>3))throw new Error("无效禁行区域");
    this.forbidden=zones;
  }
  occupiedCells() {
    const out=[...this.cells.values()].filter(c=>c.label!==1).map(c=>({x:c.x*CELL,y:c.y*CELL,label:c.label}));
    for(const z of this.forbidden)for(let x=Math.ceil(Math.max(z.x-z.radius,this.pose.x-1.8)/CELL);x*CELL<=Math.min(z.x+z.radius,this.pose.x+1.8);x++)
      for(let y=Math.ceil(Math.max(z.y-z.radius,this.pose.y-1.8)/CELL);y*CELL<=Math.min(z.y+z.radius,this.pose.y+1.8);y++)
        if(Math.hypot(x*CELL-z.x,y*CELL-z.y)<=z.radius+CELL*Math.SQRT1_2)out.push({x:x*CELL,y:y*CELL,label:2});
    return out;
  }
  constructor(readonly goal:{x:number;y:number},readonly geometry:NearStepGeometry,initialYaw:number,readonly stopTolerance=.06) {
    if(!Number.isFinite(stopTolerance)||stopTolerance<.01||stopTolerance>.06)throw new Error("无效停车容差");
    if(![goal.x,goal.y,initialYaw].every(Number.isFinite) || Math.hypot(goal.x,goal.y)<.15 || Math.hypot(goal.x,goal.y)>1) throw new Error("局部目标应在15厘米至1米内");
    this.originYaw=initialYaw;this.bestDistance=Math.hypot(goal.x,goal.y);
  }
  setHeading(worldYaw:number) {this.pose.yaw=wrap(worldYaw-this.originYaw);}
  observe(cells:GroundCell[]) {
    for(const [key,p] of this.cells)if(Math.abs(p.x*CELL-this.pose.x)>1.8 || Math.abs(p.y*CELL-this.pose.y)>1.8)this.cells.delete(key);
    const c=Math.cos(this.pose.yaw),s=Math.sin(this.pose.yaw),frame=++this.observationFrame;
    this.lastClearedCells=0;
    const floors:Array<{x:number;y:number;count:number}>=[];
    for(const [cameraX,cameraY,label,count] of cells) {
      if(![cameraX,cameraY,label,count].every(Number.isFinite)||![1,2,3].includes(label)||count<3) continue;
      const x=cameraX-this.geometry.centerRightMeters,y=cameraY-this.geometry.alongViewMeters;
      const gx=Math.round((this.pose.x+c*x+s*y)/CELL),gy=Math.round((this.pose.y-s*x+c*y)/CELL),key=`${gx},${gy}`,old=this.cells.get(key);
      if(!old || label!==1)this.cells.set(key,{x:gx,y:gy,label,clearVotes:0,obstacleFrame:label!==1?frame:undefined});
      if(label===1 && count>=12)floors.push({x:gx,y:gy,count});
    }
    // A 5cm observation bucket moves between adjacent 2.5cm map cells as the camera
    // moves. Clear that quantization footprint, once per image, after two images.
    // Obstacles seen in this image and unseen parts of the map remain occupied.
    for(const floor of floors)for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      const old=this.cells.get(`${floor.x+dx},${floor.y+dy}`);
      if(!old || old.label===1 || old.obstacleFrame===frame || old.floorFrame===frame)continue;
      old.floorFrame=frame;
      if(++old.clearVotes>=2){old.label=1;this.lastClearedCells++;}
    }
  }
  applyMotion(segment:Record<string,any>) {
    const a=segment.floorFlowBefore,b=segment.floorFlowAfter;
    const dyaw=segment.rawPoseYawRadians;
    const continuous=!!a?.cumulativePoseAvailable && !!b?.cumulativePoseAvailable && a.originTimestampNs===b.originTimestampNs && a.originContinuity && b.originContinuity;
    if(segment.completed && segment.motorStopAcknowledged && ["left_step","right_step"].includes(segment.direction) && Number.isFinite(dyaw) && Math.abs(dyaw)<=.6 && !continuous) {
      // Differential-track pivot: angular feedback remains usable when floor features leave view.
      // Position is held as an explicit approximation, never replaced by drifting ARCore translation.
      this.pose.yaw=wrap(this.pose.yaw+dyaw);this.positionUncertaintyMeters+=.01;return;
    }
    if(!segment.completed || !segment.motorStopAcknowledged || !a?.cumulativePoseAvailable || !b?.cumulativePoseAvailable
      || a.originTimestampNs!==b.originTimestampNs || !a.originContinuity || !b.originContinuity) throw new Error("本段视觉位姿不连续，不能累计到目标");
    const dx=b.cumulativeCameraDxMeters-a.cumulativeCameraDxMeters,dz=b.cumulativeCameraDzMeters-a.cumulativeCameraDzMeters;
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
  plan():GoalPlan {
    if(this.positionUncertaintyMeters>.1) return {phase:"LOCALIZATION_UNCERTAIN",path:[]};
    if(this.distance()<=this.stopTolerance) return {phase:"AT_GOAL",path:[]};
    if(this.stagnant>32) return {phase:"NO_PROGRESS",path:[]};
    const radius=Math.max(this.geometry.widthMeters,this.geometry.lengthMeters)/2+this.geometry.marginMeters+.01;
    const blocked=new Set<string>();
    const occupied=this.occupiedCells();
    for(const point of occupied) {
      const cell={x:Math.round(point.x/CELL),y:Math.round(point.y/CELL)};
      const r=Math.ceil(radius/CELL);
      for(let x=-r;x<=r;x++) for(let y=-r;y<=r;y++) if(Math.hypot(x,y)*CELL<=radius+CELL*Math.SQRT1_2) blocked.add(`${cell.x+x},${cell.y+y}`);
    }
    const sx=Math.round(this.pose.x/CELL),sy=Math.round(this.pose.y/CELL),tx=Math.round(this.goal.x/CELL),ty=Math.round(this.goal.y/CELL);
    const key=(x:number,y:number)=>`${x},${y}`,root=key(sx,sy),target=key(tx,ty);
    const blockers=occupied.map(c=>({x:Math.round(c.x/CELL),y:Math.round(c.y/CELL),label:c.label}));
    const diagnostic={rootBlocked:blocked.has(root),freeNeighbors:0,expanded:0,
      goalBlockers:blockers.filter(c=>Math.hypot(c.x*CELL-this.goal.x,c.y*CELL-this.goal.y)<=radius+.06+CELL*Math.SQRT1_2).slice(0,12).map(c=>({x:c.x*CELL,y:c.y*CELL,label:c.label})),
      nearBlockers:blockers.filter(c=>Math.hypot(c.x*CELL-this.pose.x,c.y*CELL-this.pose.y)<=radius+.08).slice(0,12).map(c=>({x:c.x*CELL,y:c.y*CELL,label:c.label}))};
    const steps=[[-1,0],[1,0],[0,1],[0,-1],[-1,1],[1,1],[-1,-1],[1,-1]];
    diagnostic.freeNeighbors=steps.filter(([dx,dy])=>!blocked.has(key(sx+dx,sy+dy)) && !(dx&&dy&&(blocked.has(key(sx+dx,sy))||blocked.has(key(sx,sy+dy))))).length;
    const gridTolerance=Math.max(this.stopTolerance,CELL*Math.SQRT1_2);
    const goalRadius=Math.ceil(gridTolerance/CELL);
    let freeGoal=false;
    for(let dx=-goalRadius;dx<=goalRadius;dx++)for(let dy=-goalRadius;dy<=goalRadius;dy++)
      if(Math.hypot((tx+dx)*CELL-this.goal.x,(ty+dy)*CELL-this.goal.y)<=gridTolerance && !blocked.has(key(tx+dx,ty+dy)))freeGoal=true;
    if(!freeGoal)return {phase:"OBSERVE_SIDE",path:[],reason:"GOAL_REGION_OCCUPIED",diagnostic};
    const open=[{x:sx,y:sy,g:0,f:Math.hypot(tx-sx,ty-sy)}],cost=new Map([[root,0]]),parent=new Map<string,string>();
    let found:string|undefined,expanded=0;
    while(open.length && expanded++<10000) {
      let best=0;for(let n=1;n<open.length;n++) if(open[n].f<open[best].f) best=n;
      const p=open.splice(best,1)[0],pk=key(p.x,p.y);if(p.g!==(cost.get(pk) ?? Infinity)) continue;
      if(pk!==root && Math.hypot(p.x*CELL-this.goal.x,p.y*CELL-this.goal.y)<=gridTolerance){found=pk;break;}
      for(const [dx,dy] of steps) {
        const x=p.x+dx,y=p.y+dy,k=key(x,y);
        if(Math.abs(x*CELL-this.pose.x)>1.5||Math.abs(y*CELL-this.pose.y)>1.5||blocked.has(k) || (dx&&dy&&(blocked.has(key(p.x+dx,p.y))||blocked.has(key(p.x,p.y+dy))))) continue;
        const g=p.g+Math.hypot(dx,dy)*(this.cells.get(k)?.label===1?1:2.5);
        if(g>=(cost.get(k) ?? Infinity)) continue;cost.set(k,g);parent.set(k,pk);open.push({x,y,g,f:g+Math.hypot(tx-x,ty-y)});
      }
    }
    diagnostic.expanded=expanded;
    if(!found) return {phase:"OBSERVE_SIDE",path:[],reason:open.length?"SEARCH_LIMIT":diagnostic.freeNeighbors===0?"START_ENCLOSED":"DISCONNECTED_GRID",diagnostic};
    const path:Array<{x:number;y:number}>=[];let k:string|undefined=found;
    while(k && k!==root){const [x,y]=k.split(",").map(Number);path.unshift({x:x*CELL,y:y*CELL});k=parent.get(k);}
    if(this.stopTolerance<.06 && path.length){
      const last=path.at(-1)!;let clear=true;
      for(let t=0;t<=1;t+=.1)if(blocked.has(key(Math.round((last.x+(this.goal.x-last.x)*t)/CELL),Math.round((last.y+(this.goal.y-last.y)*t)/CELL))))clear=false;
      if(clear)path.push({...this.goal});
    }
    let look=path[0];
    // Only shorten a path when its continuous segment avoids the inflated obstacles.
    for(const p of path) {
      const d=Math.hypot(p.x-this.pose.x,p.y-this.pose.y);if(d>.14) break;
      let clear=true;for(let t=0;t<=1;t+=.1) if(blocked.has(key(Math.round((this.pose.x+(p.x-this.pose.x)*t)/CELL),Math.round((this.pose.y+(p.y-this.pose.y)*t)/CELL)))) clear=false;
      if(clear) look=p;else break;
    }
    if(!look) return {phase:"OBSERVE_SIDE",path:[],reason:"EMPTY_PATH",diagnostic};
    const error=wrap(Math.atan2(look.x-this.pose.x,look.y-this.pose.y)-this.pose.yaw);
    return Math.abs(error)>.16 ? {phase:"TURN",path,diagnostic,turn:error>0?"right_step":"left_step",turnMs:Math.abs(error)>.35?150:100,headingError:error}
      : {phase:"ADVANCE",path,diagnostic,headingError:error};
  }
}
