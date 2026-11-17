export type InspectionObservation = {
  id: string; roomId?: string; room: string; at: number; x: number; y: number;
  artifactId?: string; analysis: "pending" | "completed" | "failed"; summary: string;
};
export type InspectionTask = {
  id: string; mapId: string; action: "observe" | "photo" | "rescan"; createdAt: number; updatedAt: number;
  phase: "running" | "paused" | "cancelled" | "analyzing" | "completed";
  returned: boolean; mapping: "existing" | "local-new" | "rescan"; observations: InspectionObservation[];
  notice: string; notified: boolean;
};
export interface InspectionStorage { list(): InspectionTask[]; save(task: InspectionTask): void; }
export function inspectionContext(tasks: InspectionTask[]) {
  return tasks.slice(0,4).map(t=>({id:t.id,action:t.action,phase:t.phase,returned:t.returned,mapping:t.mapping,createdAt:t.createdAt,notice:t.notice,
    observations:t.observations.slice(-3).map(o=>({...o,summary:o.summary.slice(0,400)}))}));
}
/** All sensor evidence is persisted before navigation is allowed to leave an observation point. */
export class InspectionService {
  constructor(private storage: InspectionStorage) {}
  list() { return this.storage.list().sort((a,b)=>b.updatedAt-a.updatedAt); }
  find(id: string) { return this.list().find(t=>t.id===id); }
  begin(id: string, mapId: string, action: InspectionTask["action"], mapping: InspectionTask["mapping"]) {
    const old=this.find(id);
    if(old?.phase==="completed" || old?.phase==="cancelled")throw new Error("旧巡查已结束，请新建任务");
    const task:InspectionTask=old?{...old,phase:"running",returned:false,notice:"已恢复巡查，仍需实际返回",notified:false}:
      {id,mapId,action,mapping,createdAt:Date.now(),updatedAt:Date.now(),phase:"running",returned:false,observations:[],notice:"正在巡查",notified:false};
    if(task.mapId!==mapId)throw new Error("巡查地图不一致");this.save(task);return task;
  }
  add(id:string,observation:InspectionObservation) {
    const task=this.required(id);if(task.phase!=="running")throw new Error("巡查已暂停，不能加入旧照片");
    if(task.observations.some(o=>o.id===observation.id))return;
    if(task.observations.length>=24)throw new Error("本轮观察点已达上限，请返回后另开任务");
    if(![observation.x,observation.y,observation.at].every(Number.isFinite)||!observation.room.trim())throw new Error("观察位置或时间无效");
    this.save({...task,observations:[...task.observations,observation]});
  }
  finishTravel(id:string,returned:boolean,notice:string,cancelled=false) {
    const task=this.required(id);
    this.save({...task,returned,phase:cancelled?"cancelled":returned?"analyzing":"paused",notice,notified:false});
  }
  describe(id:string,observationId:string,summary:string,success:boolean) {
    const task=this.required(id);const observations=task.observations.map(o=>o.id===observationId?{...o,analysis:success?"completed" as const:"failed" as const,summary:summary.slice(0,1200)}:o);
    this.save({...task,observations});
  }
  settle(id:string) {
    const task=this.required(id);if(!task.returned || task.phase!=="analyzing" || task.observations.some(o=>o.analysis==="pending"))return;
    this.save({...task,phase:"completed",notice:task.observations.some(o=>o.artifactId)?"已返回，照片和分析状态已保存":"已返回，但未取得有效观察照片",notified:false});
  }
  recover() { for(const task of this.list())if(task.phase==="running")this.save({...task,phase:"paused",notice:"应用重开，任务已暂停；重新定位后才可继续",notified:false}); }
  retryDescriptions(id:string) {
    const task=this.required(id);if(task.phase==="running" || task.phase==="cancelled")throw new Error("当前任务不能重新分析");
    this.save({...task,phase:task.returned?"analyzing":"paused",notified:false,observations:task.observations.map(o=>o.artifactId && o.analysis==="failed"?{...o,analysis:"pending",summary:"正在重新分析原照片"}:o)});
  }
  notified(id:string,revision:number) {const t=this.required(id);if(t.updatedAt===revision)this.storage.save({...t,notified:true});}
  summaries(room?:string) {return this.list().map(t=>({...t,observations:t.observations.filter(o=>!room||o.room.includes(room)).slice(-12)})).filter(t=>!room||t.observations.length).slice(0,20);}
  private required(id:string){const task=this.find(id);if(!task)throw new Error("没有找到巡查任务");return task;}
  private save(task:InspectionTask){this.storage.save({...task,updatedAt:Math.max(Date.now(),task.updatedAt+1)});}
}
