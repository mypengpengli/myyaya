import { AppState, PermissionsAndroid, Platform } from "react-native";
import VoskCommandRecognizer from "../../modules/vosk-command-recognizer";
import { executeChineseRobotCommand } from "../device-tools/chinese-robot-control";
import { getAppMode } from "../setup/setup-storage";
import { useUserStore } from "../store/user";
import { ChineseVoiceSession } from "./chinese-voice-session";
import { stopLooiMotion } from "../device-tools/looi-robot";
import { isChineseWakeEnabled, subscribeChineseWake } from "./chinese-voice-preferences";
import { hasCompletedRobotOnboarding } from "../setup/setup-storage";
import { resultPresentation } from "../artifacts/presentation";
import { videoControl } from "../artifacts/video-control";
import { ViewerVoice } from "./viewer-voice";

let focused = 0;
let focusGeneration = 0;
let automaticResume: () => void = () => {};
export function resumeAutomaticChineseVoice(): void { automaticResume(); }
const photoSession = () => (require("../artifacts/phone-camera") as typeof import("../artifacts/phone-camera")).photoCapture;
export const chineseVoice = new ChineseVoiceSession(VoskCommandRecognizer, async () => {
  if (Platform.OS !== "android") return false;
  return await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO) === PermissionsAndroid.RESULTS.GRANTED;
}, () => focused !== 0 && Platform.OS === "android" && AppState.currentState === "active" &&
  getAppMode() === "local" && !useUserStore.getState().robotSleeping, async (command) => {
    if (command.kind !== "stop") return executeChineseRobotCommand(command);
    // Stop motors immediately, while the video/audio mux finalizes separately.
    const motion = executeChineseRobotCommand(command);
    const recording = await import("../artifacts/phone-recording");
    const artifact = await recording.stopPhoneRecording();
    const notice = await motion;
    return artifact ? "录像已保存" : notice;
  },
  () => stopLooiMotion("chinese-voice-capture-closed"),
  async (text, signal, feedback) => (await import("../agent/companion-runtime")).replyToCompanion(text, signal, feedback),
  command => photoSession().handleVoice(command),
  () => {
    const review = photoSession().getSnapshot();
    if (review.phase === "saving") return "正在保存照片。";
    if (review.phase === "capturing") return "还在等待相机拍回照片。";
    if (review.phase === "review") return !review.photo ? "没有拍到照片，请按屏幕提示选择。"
      : review.notice.includes("保存失败") ? "这张还没保存，请按屏幕提示选择。" : "照片已经拍好，正在等你选择。";
  }, new ViewerVoice(resultPresentation, videoControl, () => photoSession().getSnapshot().phase === "idle"));

export function focusChineseVoiceScreen({ autoStart = false }: { autoStart?: boolean } = {}): () => void {
  const owner = ++focusGeneration;
  focused = owner;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resume = () => {
    if (timer) clearTimeout(timer);
    if (!autoStart) return;
    timer = setTimeout(() => {
      void (async () => {
        if (Platform.OS !== "android" || !await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) return;
        if (focused !== owner || AppState.currentState !== "active" || !hasCompletedRobotOnboarding() || !isChineseWakeEnabled() ||
          useUserStore.getState().robotSleeping || getAppMode() !== "local" || chineseVoice.isCapturePaused()) return;
        const phase = chineseVoice.getSnapshot().phase;
        if (phase === "off" || phase === "error") await chineseVoice.start("wake");
      })().catch(() => {});
    }, 250);
  };
  const state = AppState.addEventListener("change", (next) => {
    if (focused !== owner) return;
    if (next !== "active") void chineseVoice.stop("已进入后台，语音已暂停");
    else resume();
  });
  let wasSleeping = useUserStore.getState().robotSleeping;
  const sleeping = useUserStore.subscribe((user) => {
    if (focused !== owner || user.robotSleeping === wasSleeping) return;
    wasSleeping = user.robotSleeping;
    if (user.robotSleeping) void chineseVoice.stop("小丫已休眠，语音已暂停");
    else resume();
  });
  const preferences = subscribeChineseWake(() => {
    if (focused !== owner || !autoStart) return;
    if (isChineseWakeEnabled()) resume();
    else void chineseVoice.stop("语音唤醒已关闭");
  });
  const syncFace = () => {
    if (focused !== owner || getAppMode() !== "local") return;
    const user = useUserStore.getState();
    const phase = chineseVoice.getSnapshot().phase;
    const next = user.robotSleeping || AppState.currentState !== "active" ? "sleeping"
      : phase === "speaking" || chineseVoice.getSnapshot().interim ? "speaking" : phase === "loading" || phase === "thinking" ? "processing" : phase === "listening" && chineseVoice.getSnapshot().awake ? "listening" : "attention";
    if (user.voiceState !== next) user.setVoiceState(next);
  };
  const expression = chineseVoice.subscribe(syncFace);
  syncFace();
  if (autoStart) automaticResume = resume;
  resume();
  return () => {
    if (timer) clearTimeout(timer);
    if (automaticResume === resume) automaticResume = () => {};
    state.remove(); sleeping(); preferences(); expression();
    if (focused === owner) { focused = 0; void chineseVoice.stop("已离开页面，中文语音已关闭"); }
  };
}
