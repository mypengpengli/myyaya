import type {AgentTool} from "@earendil-works/pi-agent-core";
import {Type} from "typebox";
import {Alert,AppState} from "react-native";
import {getNavigationControlOwner} from "../core/navigation-control-lease";

// Load hardware only when a home tool executes; ordinary dialogue/media must not require ARCore.
async function listHomeAtlases(){return (await import("../../modules/navigation-probe")).listHomeAtlases();}
async function sendHomeCommand(data:Record<string,unknown>){return (await import("../../modules/navigation-probe")).sendHomeCommand(data);}
async function homeSummaries(){return (await listHomeAtlases()).map(h=>({mapId:h.mapId,revision:h.revision,requiresReference:h.requiresReference,
  places:h.places.map(({id,name,room,kind})=>({id,name,room,kind})),links:h.links.map(({id,from,to,taught,enabled,points})=>({id,from,to,taught,enabled,samples:points.length})),zones:h.zones,savedTask:h.task}));}

const text=(value:unknown)=>({content:[{type:"text" as const,text:JSON.stringify(value)}],details:{}});
async function request(mapId:string|undefined,command:Record<string,unknown>,signal?:AbortSignal) {
  if(signal?.aborted || AppState.currentState!=="active")throw new Error("请在应用前台使用家庭地图");
  if(getNavigationControlOwner()) {
    const current=await (await import("../../modules/navigation-probe")).getHomeStatus();
    if(mapId && current.atlas?.mapId!==mapId)throw new Error("当前打开的是另一张地图，请先切换地图");
    return text(await sendHomeCommand(command));
  }
  const homes=await listHomeAtlases();
  if(mapId && !homes.some(h=>h.mapId===mapId))throw new Error("没有找到这张家庭地图");
  if(!mapId && homes.length>1)throw new Error("有多张家庭地图，请提供map_id");
  setTimeout(()=>{if(signal?.aborted)return;void import("../navigation/route-robot-session").then(n=>signal?.aborted?null:n.openHomeNavigation({mapId,command}))
    .catch(error=>Alert.alert("家庭导航",error instanceof Error?error.message:String(error)));},0);
  return text({status:"opening_home_setup",saved:false,moving:false,notice:"已打开家庭地图操作，需恢复实际位置并确认最低姿态；尚未记住新地点或到达目的地。"});
}
export function createHomeTools():AgentTool[] {return [
  {name:"inspect_home",label:"正在安排房间巡查与返回",description:"用户要求逛房间、巡视各个房间、去厨房拍照再回来时使用。scope=current在当前位置短巡查补图；all依次巡视已登记可达房间；place指定真实地点。已有地图复用，不因建过图跳过观察。action=photo自动拍照保存再返回；observe记录见闻；rescan只补扫指定位置，不声称重建全屋。需定位和姿态准备，opening不是已发车。返回原出发位置后才汇报返回成功，无可用路线明确失败。",parameters:Type.Object({map_id:Type.Optional(Type.String()),scope:Type.Union([Type.Literal("current"),Type.Literal("all"),Type.Literal("place")]),action:Type.Optional(Type.Union([Type.Literal("observe"),Type.Literal("photo"),Type.Literal("rescan")])),place_id:Type.Optional(Type.String())}),execute:async(_id,p,signal)=>{
    const a=p as {map_id?:string;scope:string;action?:string;place_id?:string};
    if(a.scope==="place") {
      const matches=(await listHomeAtlases()).filter(h=>(!a.map_id||h.mapId===a.map_id)&&h.places.some(n=>n.id===a.place_id));
      if(matches.length!==1)throw new Error("请查询地图并提供准确地点编号，不能猜厨房位置");a.map_id=matches[0].mapId;
    }
    return request(a.map_id,{op:"inspect",scope:a.scope,action:a.action??"observe",target:a.place_id},signal);
  }},
  {name:"inspection_reports",label:"正在查询巡查照片与见闻",description:"查询手机持久保存的巡查任务、房间、观察时间、照片编号和是否返回。时间是过去观察时刻，不能说成现在仍然如此；分析失败或未拍到必须说明。默认query只读，不重新执行巡查。用户明确要求重试失败照片分析时operation=retry_analysis并传task_id，只重分析原照片，不发车或重拍。",parameters:Type.Object({task_id:Type.Optional(Type.String()),room:Type.Optional(Type.String({maxLength:40})),operation:Type.Optional(Type.Union([Type.Literal("query"),Type.Literal("retry_analysis")]))}),execute:async(_id,p)=>{
    const a=p as {task_id?:string;room?:string;operation?:string};const m=await import("../inspection/inspection-runtime");
    if(a.operation==="retry_analysis"){if(!a.task_id)throw new Error("请提供原巡查任务编号");m.getInspectionService().retryDescriptions(a.task_id);m.startInspectionMonitor();}
    return text(m.getInspectionService().summaries(a.room).filter(t=>!a.task_id||t.id===a.task_id).slice(0,6).map(t=>({...t,observations:t.observations.slice(-4).map(o=>({...o,summary:o.summary.slice(0,600)}))})));
  }},
  {name:"patrol_nearby",label:"正在准备附近短巡游",description:"用户说逛一圈、在附近转转然后回来时使用；只在起点80厘米半径内观察、补记新地面，最多2分钟并沿实际轨迹返回。已观察位置复用记录但仍实时避障；不是全屋自主建图。需要本地相机定位、底座连接和最低姿态确认，opening只代表准备。指定房间请用navigate_home，不能用本工具猜房间。",parameters:Type.Object({map_id:Type.Optional(Type.String())}),execute:async(_id,p,signal)=>request((p as {map_id?:string}).map_id,{op:"patrol"},signal)},
  {name:"home_maps",label:"正在查看家庭地图",description:"查询已保存家庭地图、房间/门口/停车点、实际带领路线和禁行区。savedTask是上次保存的记录，不表示现在正在移动。去客厅先查真实地点；没有路线不能编造已到达。",parameters:Type.Object({}),execute:async()=>text(await homeSummaries())},
  {name:"navigate_home",label:"正在准备前往目的地",description:"用户要求去已登记房间/地点时，选择真实家庭地图与地点编号，打开定位准备，随后由本地导航执行带领路线和避障。返回opening不是已经发车或到达；需要先带领登记，不能用robot_action循环代替。",parameters:Type.Object({map_id:Type.Optional(Type.String()),place_id:Type.String()}),execute:async(_id,p,signal)=>{
    const a=p as {map_id?:string;place_id:string},homes=await listHomeAtlases();const matches=homes.filter(h=>(!a.map_id||h.mapId===a.map_id)&&h.places.some(n=>n.id===a.place_id));
    if(matches.length!==1)throw new Error("请先查询家庭地图并选择准确的地点编号");return request(matches[0].mapId,{op:"go",target:a.place_id},signal);
  }},
  {name:"edit_home_map",label:"正在编辑家庭地图",description:"用户说这里是客厅、记为沙发旁时，用remember记录实际定位；rename改名，move把已有地点移到实际当前位置并清除相关旧路线，remove删除地点。地图不是聊天记忆，禁止编造坐标或路线。界面未打开会先打开准备流程，返回saved=false不能声称保存成功。",parameters:Type.Object({map_id:Type.Optional(Type.String()),operation:Type.Union([Type.Literal("remember"),Type.Literal("rename"),Type.Literal("move"),Type.Literal("remove")]),place_id:Type.Optional(Type.String()),name:Type.Optional(Type.String({minLength:1,maxLength:40})),kind:Type.Optional(Type.Union([Type.Literal("room"),Type.Literal("door"),Type.Literal("point")])),room:Type.Optional(Type.String({maxLength:40}))}),execute:async(_id,p,signal)=>{
    const a=p as {map_id?:string;operation:string;place_id?:string;name?:string;kind?:string;room?:string};
    if(a.operation!=="remember"&&!a.place_id || ["remember","rename"].includes(a.operation)&&!a.name)throw new Error("缺少地点编号或名称");
    return request(a.map_id,{op:a.operation,id:a.place_id,name:a.name,kind:a.kind??"point",room:a.room??""},signal);
  }},
  {name:"home_navigation_control",label:"正在处理导航任务",description:"暂停、继续或取消家庭导航；查询status返回真实任务和定位状态。重开后继续会打开定位准备，不会把旧任务自动重新发车。",parameters:Type.Object({map_id:Type.Optional(Type.String()),operation:Type.Union([Type.Literal("pause"),Type.Literal("resume"),Type.Literal("cancel"),Type.Literal("status")])}),execute:async(_id,p,signal)=>{
    const a=p as {operation:string;map_id?:string};
    if(!getNavigationControlOwner() && a.operation==="status")return text({livePositionKnown:false,moving:false,maps:await homeSummaries()});
    return request(a.map_id,{op:a.operation},signal);
  }},
  {name:"edit_home_passage",label:"正在编辑通道与禁行区",description:"启用/停用已带领通道；在实际当前位置或已有地点周围添加禁行区；删除已有禁行区。新房间连接必须通过带领记录，不能生成虚构路线和坐标。",parameters:Type.Object({map_id:Type.Optional(Type.String()),operation:Type.Union([Type.Literal("link_enabled"),Type.Literal("zone"),Type.Literal("remove_zone")]),id:Type.Optional(Type.String()),place_id:Type.Optional(Type.String()),enabled:Type.Optional(Type.Boolean()),name:Type.Optional(Type.String({minLength:1,maxLength:40})),radius:Type.Optional(Type.Number({minimum:.05,maximum:3}))}),execute:async(_id,p,signal)=>{
    const a=p as {map_id?:string;operation:string;id?:string;place_id?:string;enabled?:boolean;name?:string;radius?:number};
    if(a.operation!=="zone"&&!a.id || a.operation==="link_enabled"&&typeof a.enabled!=="boolean")throw new Error("缺少真实通道/禁行区编号或启用状态");
    return request(a.map_id,{op:a.operation,id:a.id,placeId:a.place_id,enabled:a.enabled,name:a.name??"禁行区",radius:a.radius??.15},signal);
  }}
]}
