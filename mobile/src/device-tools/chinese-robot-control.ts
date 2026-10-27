import { AppState } from "react-native";
import { getAppMode } from "../setup/setup-storage";
import { holdAmbientMotionFor } from "../core/ambient-motion";
import { holdSocialAttentionMotionFor } from "../core/social-attention";
import { markRobotInteraction } from "../core/robot-inactivity";
import type { ChineseRobotCommand } from "../voice/chinese-command";
import { getLooiRobotRuntimeState, moveLooi, turnLooi, performLooiHeadGesture,
  performLooiDance, setLooiHead, setLooiLight, stopLooiMotion } from "./looi-robot";

let executing = false;
export const isChineseRobotCommandExecuting = () => executing;
export async function executeChineseRobotCommand(command: ChineseRobotCommand): Promise<string> {
  markRobotInteraction("chinese-manual-control");
  holdAmbientMotionFor(15_000, "chinese-manual-control");
  holdSocialAttentionMotionFor(15_000, "chinese-manual-control");
  if (command.kind === "stop") {
    const connected = getLooiRobotRuntimeState().connected;
    await stopLooiMotion("chinese-local-stop");
    return connected ? "已发送停止指令" : "底座未连接，已取消本机动作；无法向断开的底座写入停止";
  }
  if (getAppMode() !== "local" || AppState.currentState !== "active") throw new Error("请回到前台本地模式操作");
  if (!getLooiRobotRuntimeState().connected) throw new Error("请先扫描并连接 LOOI 底座");
  if (executing) throw new Error("动作正在执行；停止按钮始终可用");
  executing = true;
  try {
    let result: { completed?: boolean; ok?: boolean } | undefined;
    switch (command.kind) {
      case "move": result = await moveLooi(command.direction, 450); break;
      case "turn": result = await turnLooi(command.direction, command.degrees); break;
      case "head": await setLooiHead(command.direction); break;
      case "nod": await performLooiHeadGesture("nod", 1); break;
      case "dance": await performLooiDance("bounded-wiggle-v1"); break;
      case "light": await setLooiLight(command.enabled); break;
    }
    return result?.completed === false ? "动作已被停止或中断" : "指令执行结束";
  } catch (error) {
    const reason = getLooiRobotRuntimeState().safety.lastMotionBlockReason;
    if (reason) throw new Error(`传感器保护阻止动作：${reason}`);
    throw error;
  } finally { executing = false; }
}
