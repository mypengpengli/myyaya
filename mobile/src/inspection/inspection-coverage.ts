import type {HomePose} from "../../modules/navigation-probe";
import type {GroundCell} from "../navigation/local-goal-controller";
import {localToHome} from "../navigation/home-route";

/** Refresh measured buckets only; a rescan never paints unseen room space as free. */
export function mergeInspectionCoverage(previous:Array<[number,number,number]>,cells:GroundCell[],capture:HomePose,origin:HomePose,right:number,forward:number) {
  const out=new Map(previous.map(c=>[`${Math.round(c[0]*20)},${Math.round(c[1]*20)}`,c]));
  const cos=Math.cos(capture.yaw),sin=Math.sin(capture.yaw);
  for(const [x,y,label,count] of cells) {
    if(![x,y,label,count].every(Number.isFinite)||![1,2,3].includes(label)||count<3)continue;
    const p=localToHome({x:capture.x+cos*(x-right)+sin*(y-forward),y:capture.y-sin*(x-right)+cos*(y-forward),yaw:0},origin);
    if(Math.abs(p.x)>50||Math.abs(p.y)>50)continue;
    const gx=Math.round(p.x*20),gy=Math.round(p.y*20),key=`${gx},${gy}`;out.delete(key);out.set(key,[gx/20,gy/20,label]);
  }
  while(out.size>8000)out.delete(out.keys().next().value!);
  return [...out.values()];
}
