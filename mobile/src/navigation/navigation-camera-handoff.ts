type Connection={token?:string;active?:boolean;stopAcknowledged?:unknown};
type Dependencies={
  getContinuousStatus():Promise<Connection>;
  getHomeStatus():Promise<{task:string}>;
  sendHomeCommand(command:Record<string,unknown>):Promise<unknown>;
  stopMotion():Promise<void>;
};

/** Camera ownership changes only after the original drive acknowledges parking. */
export async function parkNavigationForCamera(d:Dependencies,signal:AbortSignal){
  const before=await d.getContinuousStatus(),task=JSON.parse((await d.getHomeStatus()).task);
  if(signal.aborted)throw new Error("已取消相机切换");
  await d.sendHomeCommand({op:"pause"});await d.stopMotion();
  const until=Date.now()+4000;
  while(Date.now()<until){
    if(signal.aborted)throw new Error("已取消相机切换");
    const current=await d.getContinuousStatus();
    if(current.token!==before.token)throw new Error("导航控制已变化，没有切换相机");
    if(!current.token || !current.active && current.stopAcknowledged===true){
      const saved=JSON.parse((await d.getHomeStatus()).task);
      if(signal.aborted || saved.id!==task.id || saved.phase!=="PAUSED")throw new Error("原任务已变化，没有继续相机请求");
      return;
    }
    await new Promise(r=>setTimeout(r,75));
  }
  throw new Error("尚未确认停车，相机暂未切换");
}
