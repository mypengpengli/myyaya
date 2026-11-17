import { LocalGoalController, type GoalPose } from "./local-goal-controller";

const distance = (a: GoalPose, b: GoalPose) => Math.hypot(a.x-b.x,a.y-b.y);
/** A bounded local exploration tour, not a claim that an entire room has been mapped. */
export class NearbyPatrol {
  readonly radius = .8;
  readonly maximumMs = 120_000;
  readonly trail: GoalPose[];
  returning = false;
  reason = "正在观察附近尚未记录的地面";
  private visited: GoalPose[] = [];
  private target?: GoalPose;
  private best = Infinity;
  private progressAt = 0;
  private returnIndex = -1;
  private travelled = 0;
  private previous?: GoalPose;
  get moved() { return this.travelled >= .12; }
  constructor(readonly start: GoalPose = {x:0,y:0,yaw:0}, trail: GoalPose[] = [], private mapped: GoalPose[] = []) {
    if (![start.x,start.y,start.yaw,...trail.flatMap(p=>[p.x,p.y,p.yaw])].every(Number.isFinite) || trail.length>128) throw new Error("巡游起点记录无效");
    this.trail = trail.length ? trail.map(p=>({...p})) : [{...start}];
    this.travelled = this.trail.slice(1).reduce((sum,p,i)=>sum+distance(p,this.trail[i]),0);
  }
  select(controller: LocalGoalController, elapsedMs: number): {target:GoalPose;final:boolean;returning:boolean} {
    const pose=controller.pose;
    if(distance(pose,this.start)>this.radius+.12)throw new Error("超出附近巡游范围，请定位后返回");
    if(this.previous)this.travelled+=distance(pose,this.previous);this.previous={...pose};
    if(!this.returning && distance(pose,this.trail.at(-1)!)>=.08)this.trail.push({...pose});
    if(!this.returning && (elapsedMs>=45_000 || this.travelled>=1 || this.trail.length>=100))this.returnHome("附近观察结束，沿实际走过的路线返回");
    if(!this.returning && this.target) {
      const d=distance(pose,this.target);
      if(d<this.best-.015){this.best=d;this.progressAt=elapsedMs;}
      if(d<.08 || elapsedMs-this.progressAt>12_000) {
        this.visited.push(this.target);this.target=undefined;
      }
    }
    if(!this.returning && !this.target) {
      const candidates=[...controller.cells.values()].filter(c=>c.label===1).map(c=>({x:c.x*controller.cellMeters,y:c.y*controller.cellMeters,yaw:0}))
        .filter(p=>distance(p,pose)>=.17 && distance(p,pose)<=.40 && distance(p,this.start)<=this.radius-.08 && !this.visited.some(v=>distance(v,p)<.16))
        .map(p=>{
          let unknown=0;for(let x=-2;x<=2;x++)for(let y=-2;y<=2;y++)if(!controller.cells.has(`${Math.round(p.x/controller.cellMeters)+x},${Math.round(p.y/controller.cellMeters)+y}`))unknown++;
          const old=this.mapped.some(m=>distance(m,p)<.10);
          const turn=Math.abs(Math.atan2(Math.sin(Math.atan2(p.x-pose.x,p.y-pose.y)-pose.yaw),Math.cos(Math.atan2(p.x-pose.x,p.y-pose.y)-pose.yaw)));
          return {p,score:unknown*.03+(old?0:.35)-distance(p,pose)*.2-turn*.06};
        }).sort((a,b)=>b.score-a.score).slice(0,32);
      for(const {p} of candidates) {
        controller.setGoal(p);const plan=controller.plan();
        if(plan.path.length && plan.path.every(q=>distance({...q,yaw:0},this.start)<=this.radius-.02)) {this.target=p;this.progressAt=elapsedMs;this.best=distance(p,pose);break;}
      }
      if(!this.target)this.returnHome("附近没有新的可达观察点，返回起点");
    }
    if(this.returning) {
      while(this.returnIndex>=0 && distance(pose,this.trail[this.returnIndex])<.10)this.returnIndex--;
      const target=this.returnIndex>=0?this.trail[this.returnIndex]:this.start;
      if(distance(pose,target)>1.2)throw new Error("返回路线位姿不连续，请重新定位");
      return {target,final:this.returnIndex<0,returning:true};
    }
    return {target:this.target!,final:false,returning:false};
  }
  returnHome(reason: string) {
    if(this.returning)return;
    this.returning=true;this.reason=reason;this.returnIndex=this.trail.length-1;
  }
}
