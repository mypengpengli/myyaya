import type {HomePose} from "../../modules/navigation-probe";

export function homeToLocal(p:HomePose,origin:HomePose):HomePose {
  const x=p.x-origin.x,y=p.y-origin.y,c=Math.cos(origin.yaw),s=Math.sin(origin.yaw);
  return {x:c*x-s*y,y:s*x+c*y,yaw:p.yaw-origin.yaw};
}
export function localToHome(p:HomePose,origin:HomePose):HomePose {
  const c=Math.cos(origin.yaw),s=Math.sin(origin.yaw);
  return {x:origin.x+c*p.x+s*p.y,y:origin.y-s*p.x+c*p.y,yaw:origin.yaw+p.yaw};
}
const distance=(a:HomePose,b:HomePose)=>Math.hypot(a.x-b.x,a.y-b.y);
/** Arc-length progress on the taught corridor. Lookahead stops at sharp corners. */
export class HomeRouteCursor {
  readonly points:HomePose[];
  readonly lengths:number[]=[0];
  progress=0;
  constructor(points:HomePose[]) {
    if(points.length<2 || points.length>12000 || points.some(p=>![p.x,p.y,p.yaw].every(Number.isFinite)))throw new Error("家庭路线无效");
    this.points=points.filter((p,i)=>i===0 || distance(p,points[i-1])>.005);
    if(this.points.length<2)throw new Error("路线没有有效长度");
    for(let i=1;i<this.points.length;i++)this.lengths.push(this.lengths.at(-1)!+distance(this.points[i-1],this.points[i]));
    if(this.total>40)throw new Error("本次路线过长，请拆分目的地");
  }
  get total(){return this.lengths.at(-1)!;}
  select(p:HomePose) {
    let best=Infinity,bestArc=this.progress,offRoute=Infinity;
    for(let i=1;i<this.points.length;i++) {
      if(this.lengths[i]<this.progress-.1 || this.lengths[i-1]>this.progress+.65)continue;
      const a=this.points[i-1],b=this.points[i],dx=b.x-a.x,dy=b.y-a.y,dd=dx*dx+dy*dy;
      const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/dd));
      const d=Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy),arc=this.lengths[i-1]+t*Math.sqrt(dd);
      offRoute=Math.min(offRoute,d);const score=d+Math.abs(arc-this.progress)*.02;
      if(score<best){best=score;bestArc=arc;}
    }
    if(offRoute>.40)throw new Error("已偏离带领路线，请暂停后重新定位");
    this.progress=Math.max(this.progress,bestArc);
    let targetArc=Math.min(this.total,this.progress+.40);
    for(let i=1;i<this.points.length-1;i++) {
      const arc=this.lengths[i];if(arc<this.progress+.09 || arc>targetArc)continue;
      const a=this.points[i-1],b=this.points[i],c=this.points[i+1];
      const angle=Math.atan2(c.x-b.x,c.y-b.y)-Math.atan2(b.x-a.x,b.y-a.y);
      if(Math.abs(Math.atan2(Math.sin(angle),Math.cos(angle)))>.35){targetArc=arc;break;}
    }
    let i=1;while(i<this.lengths.length-1 && this.lengths[i]<targetArc)i++;
    const a=this.points[i-1],b=this.points[i],t=(targetArc-this.lengths[i-1])/(this.lengths[i]-this.lengths[i-1]);
    return {target:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,yaw:b.yaw},final:targetArc>=this.total-.001,
      progress:this.progress,total:this.total,index:i,offRoute};
  }
}
