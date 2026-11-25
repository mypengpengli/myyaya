import { AppState, PermissionsAndroid } from "react-native";
import { openNativeTaughtRoutes, subscribeRouteMotion, publishRouteRobotState, acknowledgeRouteMotion, stopNativeTaughtRoute,sendHomeCommand,listHomeAtlases } from "../../modules/navigation-probe";
import { withExternalActivityLease } from "../core/background-process-exit";
import { acquireNavigationControl, releaseNavigationControl, assertNavigationControl } from "../core/navigation-control-lease";
import { pauseSocialCamera } from "../core/social-attention";
import { getLooiRobotRuntimeState, navigationDrivePermits, subscribeLooiRobotRuntimeState, moveLooiNavigationPulse, moveLooiOperatorBackCalibration, moveLooiOperatorTurnCalibration, setLooiHead, stopLooiMotion } from "../device-tools/looi-robot";
import { forceReconnectSavedLooiRobot } from "../device-tools/looi-robot-autoconnect";
import { compactChinese, isChineseStop } from "../voice/chinese-command";
import {currentHomeId} from "./current-home";
import {parseHomeVoice} from "./home-voice";

export async function openHomeNavigation(options:{mapId?:string;command?:Record<string,unknown>}={}) {
  const homes=await listHomeAtlases();
  const mapId=options.command?.op==="new_location"?undefined:options.mapId ?? currentHomeId(homes);
  return openTaughtRouteSession("home:"+JSON.stringify({...options,...(mapId?{mapId}:{})}));
}

let opening = false;
export async function openTaughtRouteSession(name = ""): Promise<string | null> {
  if (opening) throw new Error("路线导航已经打开");
  if (AppState.currentState !== "active") throw new Error("请在应用前台打开路线导航");
  opening = true;
  try {
    const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error("路线导航需要相机权限");
    return await withExternalActivityLease("taught-route", async () => {
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const releaseCamera = await pauseSocialCamera();
      const { pauseAppRuntime, resumeAppRuntime } = await import("../core/app-bootstrap");
      let removeListener: (() => void) | undefined;
      let removeState: (() => void) | undefined;
      let timer: ReturnType<typeof setInterval> | undefined;
      let lastSequence = 0;
      let closed = false;
      let cameraHandoff="";
      let stopping: Promise<unknown> = Promise.resolve();
      let voiceReady = false;
      let stopVoice: (() => Promise<void>) | undefined;
      let releaseVoice: (() => Promise<void>) | undefined;
      try {
        await stopLooiMotion("navigation-screen-open");
        const { chineseVoice } = await import("../voice/chinese-voice-runtime");
        await chineseVoice.stop("路线导航使用本地停止监听");
        releaseVoice = await chineseVoice.pauseCaptureForRecording();
        acquireNavigationControl(token);
        await pauseAppRuntime("navigation");
        // One recognizer owns both emergency STOP and wake-addressed free conversation.
        if (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) {
          const {default:vosk}=await import("../../modules/vosk-command-recognizer");
          const {ChineseVoiceSession}=await import("../voice/chinese-voice-session");
          const {getChineseAsrMode,getChineseEndSilence}=await import("../voice/chinese-voice-preferences");
          const files=await import("expo-file-system/legacy");
          const navigationVoice=new ChineseVoiceSession(vosk,async()=>true,()=>!closed && AppState.currentState==="active",
            async command=>{
              if(command.kind==="stop"){
                cameraHandoff="";
                await stopLooiMotion("navigation-voice-stop");await stopNativeTaughtRoute(token);await sendHomeCommand({op:command.cancelNavigation?"cancel":"pause"});return command.cancelNavigation?"导航已取消":"导航已暂停";
              }
              if(command.kind==="move" && command.distanceCm!==undefined){
                await sendHomeCommand({op:"distance",direction:command.direction,centimeters:command.distanceCm});
                return "已设置距离目标，正在根据定位和实时地面规划，尚未到达。";
              }
              throw new Error("导航期间请先暂停，再执行独立转向或头部动作");
            },()=>stopLooiMotion("navigation-speech-owner-closed"),async(text,signal,feedback)=>{
              const photo=(await import("../voice/quick-photo-request")).quickPhotoRequest(text);
              if(photo || /(?:开始录像|帮我录像|拍一段视频|看看眼前|看看周围(?:环境|有什么)|看看这里)/u.test(compactChinese(text))){
                const native=await import("../../modules/navigation-probe");
                await(await import("./navigation-camera-handoff")).parkNavigationForCamera({
                  getContinuousStatus:native.getContinuousStatus,getHomeStatus:native.getHomeStatus,sendHomeCommand,
                  stopMotion:()=>stopLooiMotion("navigation-camera-handoff")
                },signal);
                if(signal.aborted)throw new Error("已取消");
                cameraHandoff=text;
                try{await native.finishNativeHomeSession(token);}catch(error){cameraHandoff="";throw error;}
                return "导航已暂停，正在切换相机。";
              }
              const home=parseHomeVoice(text);
              if(home){
                if(signal.aborted)throw new Error("已取消");
                const result=await sendHomeCommand(home);
                return ["remember","rename"].includes(String(home.op)) ? result.notice : "导航请求已处理，"+result.notice;
              }
              return (await import("../agent/companion-runtime")).replyToCompanion(text,signal,feedback);
            },undefined,undefined,undefined,
            (event,details)=>{void import("../diagnostics/diagnostic-log").then(m=>m.recordDiagnosticEvent("stt","navigation-"+event,details)).catch(()=>{});},
            {settings:()=>({relay:getChineseAsrMode()==="relay",silence:getChineseEndSilence()}),
             transcribe:async(uri,signal)=>(await(await import("../voice/speech-sample")).transcribeChineseAudio(uri,signal)).text,
             discard:async uri=>{if(files.cacheDirectory && uri.startsWith(files.cacheDirectory+"chinese-utterances/"))await files.deleteAsync(uri,{idempotent:true});}});
          let voiceLabel="";
          const unbindSpeaker=(await import("./navigation-speech")).bindNavigationSpeaker(text=>navigationVoice.announce(text));
          const sub=navigationVoice.subscribe(()=>{
            const state=navigationVoice.getSnapshot();voiceReady=state.captureActive;
            const label=state.captureActive ? state.awake ? state.notice || "已唤醒，正在听" : "待唤醒，可说“小丫小丫”" : state.notice;
            if(label!==voiceLabel){voiceLabel=label;void sendHomeCommand({op:"voice_state",text:label}).catch(()=>{});}
          });
          const lifecycle=AppState.addEventListener("change",state=>{
            if(state!=="active"){cameraHandoff="";void navigationVoice.stop("进入后台，导航语音暂停");}
            else if(!closed)void navigationVoice.start();
          });
          stopVoice=async()=>{unbindSpeaker();sub();lifecycle.remove();voiceReady=false;await navigationVoice.stop();};
          await navigationVoice.start();voiceReady=navigationVoice.getSnapshot().captureActive;
        }
        const listener = subscribeRouteMotion((event) => {
          if (closed || event.token !== token || !Number.isInteger(event.sequence) || event.sequence <= lastSequence) return;
          lastSequence = event.sequence;
          const requestSequence = event.sequence;
          void (async () => {
            try {
              if (event.action === "stop") { stopping=stopLooiMotion("navigation-stop").catch(() => {});await stopping;return; }
              if(event.action === "home_navigate") {
                await stopping;const home=await import("./home-mission");await home.waitForHomeMission();
                if(closed || requestSequence!==lastSequence || AppState.currentState!=="active")return;
                assertNavigationControl(token);await home.runHomeMission();
                if(!closed && requestSequence===lastSequence) {
                  const n=await import("../../modules/navigation-probe"),status=await n.getHomeStatus(),task=JSON.parse(status.task);
                  if(task.inspectionId && task.phase==="COMPLETED")await n.finishNativeHomeSession(token);
                }
                return;
              }
              if(event.action === "continuous_goal") {
                await stopping;if(closed || requestSequence!==lastSequence)return;assertNavigationControl(token);
                await (await import("../diagnostics/continuous-goal-mission")).runContinuousGoalMission({operatorConfirmed:true,navigationOwner:token});return;
              }
              if(event.action === "local_goal") {
                await stopping;if(closed || requestSequence!==lastSequence)return;assertNavigationControl(token);
                const {getNavigationProbeStatus}=await import("../../modules/navigation-probe");
                const status=await getNavigationProbeStatus();
                await (await import("../diagnostics/local-goal-mission")).runLocalGoalMission({operatorConfirmed:true,heightCm:(status.measuredCameraHeightMeters ?? 0)*100,goalForwardMeters:.4,goalRightMeters:0});
                return;
              }
              await stopping;
              if (closed || requestSequence !== lastSequence) return;
              assertNavigationControl(token);
              if (AppState.currentState !== "active") throw new Error("导航界面不在前台");
              if (event.action === "connect") {
                const result = await forceReconnectSavedLooiRobot();
                if (!result.ok) throw new Error("请先在连接页配对并保存 LOOI 底座");
              }
              else if (event.action === "head_down") await setLooiHead("down", token);
              else if (event.action === "calibration_back") {
                if(event.durationMs!==450 || !getLooiRobotRuntimeState().connected) throw new Error("操作者标定参数或连接无效");
                const result=await moveLooiOperatorBackCalibration(token);
                if(!result.completed) throw new Error("标定动作已停止");
              }
              else if (event.action === "calibration_left" || event.action === "calibration_right") {
                if(event.durationMs!==350 || !getLooiRobotRuntimeState().connected) throw new Error("操作者转向标定参数或连接无效");
                const result=await moveLooiOperatorTurnCalibration(event.action==="calibration_left" ? "left" : "right",token);
                if(!result.completed) throw new Error("转向标定动作已停止");
              }
              else if (["back", "left", "right"].includes(event.action)) {
                if (!getLooiRobotRuntimeState().connected) throw new Error("底座连接已断开");
                const result = await moveLooiNavigationPulse(event.action as "back" | "left" | "right", event.durationMs, token);
                if (!result.completed) throw new Error("导航动作已停止");
              } else throw new Error("未知导航动作");
              if (closed || requestSequence !== lastSequence) return;
              await acknowledgeRouteMotion(token, requestSequence, true, "动作结束");
            } catch (error) {
              if (!closed && requestSequence === lastSequence) {
                await stopLooiMotion("navigation-action-failed").catch(() => {});
                await acknowledgeRouteMotion(token, requestSequence, false, error instanceof Error ? error.message : String(error)).catch(() => {});
              }
            }
          })();
        });
        removeListener = () => listener.remove();
        const publish = () => { if (!closed) void publishRouteRobotState(token, getLooiRobotRuntimeState().connected, voiceReady,navigationDrivePermits().back,navigationDrivePermits().turn).catch(() => {}); };
        removeState = subscribeLooiRobotRuntimeState(publish);
        timer = setInterval(publish, 200);
        const screen = openNativeTaughtRoutes(token, name);
        if (name.startsWith("home:") && JSON.parse(name.slice(5)).command?.op === "inspect") {
          const connected = getLooiRobotRuntimeState().connected;
          void import("../../modules/vosk-command-recognizer").then(({default: vosk}) => {
            if (closed) return;
            return vosk.speakChinese(connected
              ? "请让相机恢复定位，并确认底座在最低水平姿态。"
              : "底座尚未连接，请先连接，再确认最低水平姿态和定位。");
          }).catch(() => {});
        }
        return await screen;
      } finally {
        closed = true;
        removeListener?.(); removeState?.(); if (timer) clearInterval(timer);
        await stopLooiMotion("navigation-screen-closed").catch(() => {});
        await stopVoice?.();await releaseVoice?.();
        releaseNavigationControl(token); releaseCamera();
        if (AppState.currentState === "active") {
          await resumeAppRuntime();
          const { resumeAutomaticChineseVoice,chineseVoice:normalVoice } = await import("../voice/chinese-voice-runtime");
          if(cameraHandoff){
            await normalVoice.start();
            if(!normalVoice.continueRecognizedTurn(cameraHandoff)){
              await(await import("../../modules/vosk-command-recognizer")).default.speakChinese("导航已经暂停，请回到表情页继续拍摄。").catch(()=>{});
            }
          }else resumeAutomaticChineseVoice();
        }
      }
    });
  } finally { opening = false; }
}
