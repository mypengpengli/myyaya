import {sendHomeCommand,type HomePose} from "../../modules/navigation-probe";
import {homeToLocal,localToHome,HomeRouteCursor} from "./home-route";

/** Select global frontiers but follow each corridor with the existing live local controller. */
export class HomeExplorer {
  readonly maximumMs=20*60_000;
  returning=false;
  moved=false;
  reason="正在扩展已观察地面";
  readonly visited:HomePose[];
  trail:HomePose[]=[];
  private cursor?:HomeRouteCursor;
  private endpoint?:HomePose;
  private lastProgress=Date.now();
  private lastDistance=Infinity;
  private lastSelection=Date.now();
  private scan?:{base:number;index:number;started:number;settled?:number};
  private scanView(pose:HomePose):number|undefined {
    const angles=[-Math.PI/4,Math.PI/4,-Math.PI/2,Math.PI/2,Math.PI];
    if(!this.scan){this.scan={base:pose.yaw,index:0,started:Date.now()};this.cursor=undefined;this.endpoint=undefined;}
    const s=this.scan;
    if(Date.now()-s.started>40_000 || s.index>=angles.length)return;
    let target=s.base+angles[s.index];
    if(Math.abs(Math.atan2(Math.sin(target-pose.yaw),Math.cos(target-pose.yaw)))<.1){
      s.settled ??=Date.now();
      if(Date.now()-s.settled>=700){s.index++;s.settled=undefined;if(s.index>=angles.length)return;target=s.base+angles[s.index];}
    }else s.settled=undefined;
    this.reason="暂未找到可达前沿，正在原地扫视其他方向";
    return target;
  }
  constructor(private taskId:string,private origin:HomePose,private start:HomePose,visited:HomePose[]=[]) {this.visited=visited;}
  async select(pose:HomePose,elapsed:number):Promise<{target:HomePose;final:boolean;returning:boolean;scanYaw?:number}> {
    const world=localToHome(pose,this.origin);
    if(!this.trail.length || Math.hypot(pose.x-this.trail.at(-1)!.x,pose.y-this.trail.at(-1)!.y)>.05)this.trail.push({...pose});
    this.moved ||= Math.hypot(pose.x,pose.y)>.08;
    if(this.trail.length>4096)throw new Error("本轮轨迹已达容量，地图已保存，请重新安排任务");
    const distance=this.endpoint?Math.hypot(pose.x-this.endpoint.x,pose.y-this.endpoint.y):Infinity;
    if(distance<this.lastDistance-.02){this.lastProgress=Date.now();this.lastDistance=distance;}
    if(this.returning && this.endpoint && distance<.05)return {target:this.endpoint,final:true,returning:true};
    const stuck=!!this.endpoint && Date.now()-this.lastProgress>18_000;
    if(!this.cursor || distance<.06 || stuck || elapsed>this.maximumMs-180_000 && !this.returning) {
      if(stuck && !this.returning && this.endpoint){
        const dx=this.endpoint.x-pose.x,dy=this.endpoint.y-pose.y,d=Math.hypot(dx,dy);
        if(d>.08)await sendHomeCommand({op:"spatial_block",taskId:this.taskId,blocked:localToHome({x:pose.x+dx/d*Math.min(.16,d),y:pose.y+dy/d*Math.min(.16,d),yaw:pose.yaw},this.origin)});
      }
      if(stuck && this.returning)throw new Error("返回路线受阻，已保存当前位置与地图，请处理通道后继续");
      if(this.endpoint && !this.returning){const endpoint=localToHome(this.endpoint,this.origin);if(this.visited.every(p=>Math.hypot(p.x-endpoint.x,p.y-endpoint.y)>.05))this.visited.push(endpoint);}
      if(this.visited.length>4096)throw new Error("本轮探索点已达容量");
      let path:HomePose[]|null|undefined;
      if(!this.returning && elapsed<=this.maximumMs-180_000) {
        try{const result=await sendHomeCommand({op:"spatial_frontier",taskId:this.taskId,visited:this.visited});path=result.spatialPath;}
        catch(error){if(!(error instanceof Error && error.message.includes("当前位置周围尚无足够宽")))throw error;}
        if(!path?.length && Date.now()-this.lastSelection<6000)return {target:{...pose},final:false,returning:false};
        if(!path?.length){const scanYaw=this.scanView(pose);if(scanYaw!==undefined)return {target:{...pose},final:false,returning:false,scanYaw};}
        else this.scan=undefined;
      }
      if(!path?.length){this.returning=true;this.reason=elapsed>this.maximumMs-180_000?"达到本轮探索时长，沿已知路线返回":"当前可达前沿已巡视，沿已知路线返回；不代表未知房间全部完成";
        if(Math.hypot(world.x-this.start.x,world.y-this.start.y)<.045){
          this.endpoint={...pose};return {target:this.endpoint,final:true,returning:true};
        }
        path=(await sendHomeCommand({op:"spatial_route",taskId:this.taskId,target:this.start})).spatialPath;
      }
      if(!path?.length)throw new Error("没有已观察的连通路径，地图已保存");
      this.lastSelection=Date.now();this.cursor=new HomeRouteCursor(path.map(p=>homeToLocal(p,this.origin)));
      this.endpoint=homeToLocal(path.at(-1)!,this.origin);this.lastProgress=Date.now();this.lastDistance=Infinity;
    }
    const next=this.cursor!.select(pose);
    return {target:next.target,final:this.returning && next.final,returning:this.returning};
  }
}
