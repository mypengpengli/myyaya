import type { HomePlan, HomePose } from "../../modules/navigation-probe";

/** Lazy boundary: plain navigation never needs the inspection database or image-analysis model. */
export async function beginInspection(plan:HomePlan) {
  if(!plan.inspectionId)return undefined;
  const runtime=await import("./inspection-runtime"),store=runtime.getInspectionService(),id=plan.inspectionId;
  store.begin(id,plan.mapId,plan.inspectionAction ?? "observe",plan.mapping ?? "existing");
  const {announceNavigation}=await import("../navigation/navigation-speech");
  await announceNavigation(plan.mode==="explore"?"我会探索可达区域，保存地图和见闻，再返回。":plan.mapping==="existing"?"这里已有地图，我会复用路线巡视并记录，完成后回来。":plan.mapping==="rescan"?"我会到指定位置补充观察和地图记录，再返回。":"这里尚无完整记录，我会在附近补图、观察，再回来。").catch(()=>{});
  return {
    id,
    observations:()=>store.find(id)?.observations ?? [],
    count:()=>store.find(id)?.observations.length ?? 0,
    async capture(key:string,room:string,pose:HomePose,token:string,roomId?:string) {
      const observationId=`${id}-${key}`;
      if(store.find(id)?.observations.some(o=>o.id===observationId))return;
      try {await runtime.captureInspectionObservation({id,key:observationId,room,roomId,pose,token});}
      catch(error) {
        const native=await import("../../modules/navigation-probe"),status=await native.getContinuousStatus();
        if(status.token!==token || !["WAYPOINT_REACHED","VIEW_READY"].includes(String(status.phase)) || status.stopAcknowledged!==true)throw error;
        store.add(id,{id:observationId,room,roomId,x:pose.x,y:pose.y,at:Date.now(),analysis:"failed",summary:`该观察点未取得有效照片：${error instanceof Error?error.message:"相机失败"}`});
      }
    },
    async relabelRooms(){
      const native=await import("../../modules/navigation-probe");
      for(const o of store.find(id)?.observations ?? []){
        const result=await native.sendHomeCommand({op:"spatial_room",mapId:plan.mapId,x:o.x,y:o.y});
        if(result.spatialRoom)store.assignRoom(id,o.id,result.spatialRoom.id,result.spatialRoom.name);
      }
    },
    finish(returned:boolean,notice:string,cancelled=false){store.finishTravel(id,returned,notice,cancelled);runtime.startInspectionMonitor();}
  };
}
