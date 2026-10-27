import { AppState, PermissionsAndroid, Platform } from "react-native";
import VoskCommandRecognizer from "../../modules/vosk-command-recognizer";
import { executeChineseRobotCommand } from "../device-tools/chinese-robot-control";
import { getAppMode } from "../setup/setup-storage";
import { useUserStore } from "../store/user";
import { ChineseVoiceSession } from "./chinese-voice-session";
import { stopLooiMotion } from "../device-tools/looi-robot";

let focused = 0;
let focusGeneration = 0;
export const chineseVoice = new ChineseVoiceSession(VoskCommandRecognizer, async () => {
  if (Platform.OS !== "android") return false;
  return await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO) === PermissionsAndroid.RESULTS.GRANTED;
}, () => focused !== 0 && Platform.OS === "android" && AppState.currentState === "active" &&
  getAppMode() === "local" && !useUserStore.getState().robotSleeping, executeChineseRobotCommand,
  () => stopLooiMotion("chinese-voice-capture-closed"));

export function focusChineseVoiceScreen(): () => void {
  const owner = ++focusGeneration;
  focused = owner;
  const state = AppState.addEventListener("change", (next) => {
    if (focused === owner && next !== "active") void chineseVoice.stop("已进入后台，中文语音已关闭；返回后可手动开启");
  });
  const sleeping = useUserStore.subscribe((user) => {
    if (focused === owner && user.robotSleeping) void chineseVoice.stop("小丫已休眠，中文语音已关闭");
  });
  return () => {
    state.remove(); sleeping();
    if (focused === owner) { focused = 0; void chineseVoice.stop("已离开页面，中文语音已关闭"); }
  };
}
