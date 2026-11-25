type View={x:number;y:number;yaw?:number};
/** Capture distinct parked views, not dozens of nearly identical frames from one frontier. */
export function wantsExplorationObservation(previous:View[],pose:View){
  if(previous.length>=96)return false;
  return !previous.some(old=>Math.hypot(old.x-pose.x,old.y-pose.y)<.4 &&
    Math.abs(Math.atan2(Math.sin((old.yaw??0)-(pose.yaw??0)),Math.cos((old.yaw??0)-(pose.yaw??0))))<.9);
}
