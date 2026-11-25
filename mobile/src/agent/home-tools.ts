import type {AgentTool} from "@earendil-works/pi-agent-core";
import {Type} from "typebox";
import {Alert,AppState} from "react-native";
import {currentHomeId} from "../navigation/current-home";
import {getNavigationControlOwner} from "../core/navigation-control-lease";

// Load hardware only when a home tool executes; ordinary dialogue/media must not require ARCore.
async function listHomeAtlases(){return (await import("../../modules/navigation-probe")).listHomeAtlases();}
async function sendHomeCommand(data:Record<string,unknown>){return (await import("../../modules/navigation-probe")).sendHomeCommand(data);}
async function homeSummaries(){return (await listHomeAtlases()).map(h=>({mapId:h.mapId,mapName:h.mapName,revision:h.revision,active:h.active,requiresReference:h.requiresReference,regions:h.regions,
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
  if(!mapId && command.op!=="new_location")mapId=currentHomeId(homes);
  setTimeout(()=>{if(signal?.aborted)return;void import("../navigation/route-robot-session").then(n=>signal?.aborted?null:n.openHomeNavigation({mapId,command}))
    .catch(error=>Alert.alert("家庭导航",error instanceof Error?error.message:String(error)));},0);
  return text({status:"opening_home_setup",saved:false,moving:false,notice:"已打开家庭地图操作，需恢复实际位置并确认最低姿态；尚未记住新地点或到达目的地。"});
}
export async function startMeasuredVoiceMove(direction:"forward"|"back",centimeters:number):Promise<void>{
  const command={op:"distance",direction,centimeters};
  if(getNavigationControlOwner()){await sendHomeCommand(command);return;}
  const homes=await listHomeAtlases();
  const mapId=currentHomeId(homes);
  const {openHomeNavigation}=await import("../navigation/route-robot-session");
  void openHomeNavigation({mapId,command}).catch(async error=>{
    const message=error instanceof Error?error.message:"定位行驶未能开始";
    Alert.alert("距离行驶",message);
    if(AppState.currentState==="active")await(await import("../../modules/vosk-command-recognizer")).default.speakChinese(message).catch(()=>{});
  });
}
export async function startNearbyVoicePatrol(signal: AbortSignal): Promise<string> {
  if (signal.aborted || AppState.currentState !== "active") throw new Error("请在前台开始巡视");
  const command = {op:"inspect",scope:"current",action:"observe"};
  if (getNavigationControlOwner()) {
    await sendHomeCommand(command);
    return "已安排附近巡视，正在准备地面观察。";
  }
  const homes = await listHomeAtlases();
  const mapId=currentHomeId(homes);
  const {openHomeNavigation} = await import("../navigation/route-robot-session");
  if (signal.aborted) throw new Error("已取消巡视");
  void openHomeNavigation({mapId,command}).catch(async error => {
    const notice = error instanceof Error ? error.message : "巡视准备失败";
    Alert.alert("附近巡视", notice);
    if (AppState.currentState === "active") {
      await (await import("../../modules/vosk-command-recognizer")).default.speakChinese(notice).catch(() => {});
    }
  });
  return "正在打开附近巡视。";
}
export function createHomeTools():AgentTool[] {return [
  {name:"explore_home",label:"正在准备自主探索",description:"自主巡视当前可达未知区域，保存全局地面图并返回；不要求先人工带领。未知区域必须先实时观察，不可声称全屋已完成。每轮最多20分钟，受阻保存任务，后续明确继续。普通周围转一圈仍用附近巡游。",parameters:Type.Object({map_id:Type.Optional(Type.String())}),execute:async(_id,p,signal)=>request((p as {map_id?:string}).map_id,{op:"explore"},signal)},
  {name:"edit_home_regions",label:"正在编辑房间分区",description:"对已观察地面自动初分房间，或用真实房间编号改名、合并、撤销。拆分和重画边界在地图上点选，不能编造坐标。",parameters:Type.Object({map_id:Type.Optional(Type.String()),operation:Type.Union([Type.Literal("auto_rooms"),Type.Literal("region_rename"),Type.Literal("region_merge"),Type.Literal("region_undo")]),id:Type.Optional(Type.String()),ids:Type.Optional(Type.Array(Type.String())),name:Type.Optional(Type.String({maxLength:40}))}),execute:async(_id,p,signal)=>{const a=p as {map_id?:string;operation:string;id?:string;ids?:string[];name?:string};return request(a.map_id,{op:a.operation,id:a.id,ids:a.ids,name:a.name},signal);}},

  {name:"create_home_location",label:"正在建立新地点地图",description:"用户明确说搬家、来到全新场所并要求记为新地点时使用。创建独立地图，地图、房间、路线和视觉地标按地点隔离保存。普通的这里是厨房应使用edit_home_place记住房间。打开设置只表示准备，需实际扫描后才能记路。",parameters:Type.Object({name:Type.String({minLength:1,maxLength:40})}),execute:async(_id,p,signal)=>request(undefined,{op:"new_location",name:(p as {name:string}).name},signal)},
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
    for(const home of await listHomeAtlases())m.getInspectionService().relabelRooms(home.mapId,home.regions ?? []);
    return text(m.getInspectionService().summaries(a.room).filter(t=>!a.task_id||t.id===a.task_id).slice(0,6).map(t=>({...t,observations:t.observations.slice(-4).map(o=>({...o,summary:o.summary.slice(0,600)}))})));
  }},
  {name:"patrol_nearby",label:"正在准备附近短巡游",description:"用户说逛一圈、在附近转转然后回来时使用；只在起点80厘米半径内观察、补记新地面，最多2分钟并沿实际轨迹返回。已观察位置复用记录但仍实时避障；不是全屋自主建图。需要本地相机定位、底座连接和最低姿态确认，opening只代表准备。指定房间请用navigate_home，不能用本工具猜房间。",parameters:Type.Object({map_id:Type.Optional(Type.String())}),execute:async(_id,p,signal)=>request((p as {map_id?:string}).map_id,{op:"patrol"},signal)},
  {name:"home_maps",label:"正在查看家庭地图",description:"查询已保存家庭地图、房间/门口/停车点、实际带领路线和禁行区。savedTask是上次保存的记录，不表示现在正在移动。去客厅先查真实地点；没有路线不能编造已到达。",parameters:Type.Object({}),execute:async()=>text(await homeSummaries())},
  {name:"navigate_home",label:"正在准备前往目的地",description:"用户要求去已登记房间/地点时，选择真实家庭地图与地点编号，打开定位准备，随后由本地导航执行实测通路规划和避障。返回opening不是已经发车或到达；需要真实定位和已观测通路或带领路线，不能用robot_action循环代替。",parameters:Type.Object({map_id:Type.Optional(Type.String()),place_id:Type.String()}),execute:async(_id,p,signal)=>{
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
  {name:"edit_home_passage",label:"正在编辑通道与禁行区",description:"启用/停用已带领通道；在实际当前位置或已有地点周围添加禁行区；删除已有禁行区。新房间连接可由实际探索地面图或带领记录得到，不能生成虚构路线和坐标。",parameters:Type.Object({map_id:Type.Optional(Type.String()),operation:Type.Union([Type.Literal("link_enabled"),Type.Literal("zone"),Type.Literal("remove_zone")]),id:Type.Optional(Type.String()),place_id:Type.Optional(Type.String()),enabled:Type.Optional(Type.Boolean()),name:Type.Optional(Type.String({minLength:1,maxLength:40})),radius:Type.Optional(Type.Number({minimum:.05,maximum:3}))}),execute:async(_id,p,signal)=>{
    const a=p as {map_id?:string;operation:string;id?:string;place_id?:string;enabled?:boolean;name?:string;radius?:number};
    if(a.operation!=="zone"&&!a.id || a.operation==="link_enabled"&&typeof a.enabled!=="boolean")throw new Error("缺少真实通道/禁行区编号或启用状态");
    return request(a.map_id,{op:a.operation,id:a.id,placeId:a.place_id,enabled:a.enabled,name:a.name??"禁行区",radius:a.radius??.15},signal);
  }}
]}
