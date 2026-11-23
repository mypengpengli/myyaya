import { AppState, PermissionsAndroid } from "react-native";
import { openNativeTaughtRoutes, subscribeRouteMotion, publishRouteRobotState, acknowledgeRouteMotion, stopNativeTaughtRoute,sendHomeCommand,listHomeAtlases } from "../../modules/navigation-probe";
import { withExternalActivityLease } from "../core/background-process-exit";
import { acquireNavigationControl, releaseNavigationControl, assertNavigationControl } from "../core/navigation-control-lease";
import { pauseSocialCamera } from "../core/social-attention";
import { getLooiRobotRuntimeState, navigationDrivePermits, subscribeLooiRobotRuntimeState, moveLooiNavigationPulse, moveLooiOperatorBackCalibration, moveLooiOperatorTurnCalibration, setLooiHead, stopLooiMotion } from "../device-tools/looi-robot";
import { forceReconnectSavedLooiRobot } from "../device-tools/looi-robot-autoconnect";
import { compactChinese, isChineseStop } from "../voice/chinese-command";
import {parseHomeVoice} from "./home-voice";

export async function openHomeNavigation(options:{mapId?:string;command?:Record<string,unknown>}={}) {
  const homes=await listHomeAtlases();
  const mapId=options.mapId ?? homes[0]?.mapId;
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
        // A dedicated stop-only listener owns the existing Chinese recognizer;
        // normal conversation and head commands do not compete with navigation.
        if (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) {
          const { default: vosk } = await import("../../modules/vosk-command-recognizer");
          try {
            const model = await vosk.prepareChinese();
            let lastStop = 0;
            let lastHomeSequence="";
            const sub = vosk.addListener("onCommandResult", (event) => {
              if (closed || event.sessionId !== model.sessionId || AppState.currentState !== "active") return;
              const value = compactChinese(event.text);
              const home=parseHomeVoice(event.text);
              if(home && !["pause","cancel"].includes(String(home.op))) {
                const sequence=`${event.resetGeneration}:${event.sequence}`;
                if(event.partial || sequence===lastHomeSequence)return;lastHomeSequence=sequence;
                void sendHomeCommand(home).then(()=>vosk.speakChinese(["remember","rename"].includes(String(home.op))?"地点已保存":home.op==="patrol"?"正在观察地面，准备附近巡视。":"指令已收到"))
                  .catch(error=>import("../../modules/navigation-probe").then(n=>Promise.all([n.publishNativeLocalMission(error instanceof Error?error.message:String(error)),vosk.speakChinese(error instanceof Error?error.message:String(error)).catch(()=>{})])));return;
              }
              if (!home && !isChineseStop(event.text) && !/^(?:小丫小丫)?(?:请)?(?:停止导航|停止复走|取消导航|别走了)$/u.test(value)) return;
              if (Date.now() - lastStop < 800) return;
              lastStop = Date.now();
              void stopLooiMotion("navigation-voice-stop").catch(() => {});
              void stopNativeTaughtRoute(token).catch(() => {});
              if(home?.op==="cancel")void sendHomeCommand({op:"cancel"}).catch(()=>{});
            });
            const lifecycle = AppState.addEventListener("change", (state) => {
              if (state !== "active") { voiceReady=false;void vosk.stopChineseCapture().catch(() => {}); }
              else if (!closed) void vosk.startChineseCapture().then(() => { voiceReady=true; }).catch(() => {});
            });
            stopVoice = async () => { sub.remove();lifecycle.remove();voiceReady=false;await vosk.stopChineseCapture().catch(() => {}); };
            await vosk.startChineseCapture();voiceReady=true;
          } catch { await stopVoice?.();voiceReady=false; }
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
          const { resumeAutomaticChineseVoice } = await import("../voice/chinese-voice-runtime");resumeAutomaticChineseVoice();
        }
      }
    });
  } finally { opening = false; }
}
