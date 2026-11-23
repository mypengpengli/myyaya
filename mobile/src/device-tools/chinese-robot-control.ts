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
export async function executeChineseRobotCommand(command: ChineseRobotCommand, options?: { headWriteResponse?: boolean }): Promise<string> {
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
      case "move": {
        const cm = command.distanceCm;
        if (cm !== undefined && (!Number.isFinite(cm) || cm < 2 || cm > 20)) throw new Error("一次估时短步支持 2 至 20 厘米，请重新给出距离");
        // Provisional short-step estimate from measured rearward field pulses.
        // Forward uses this as an estimate until a directional calibration is available.
        result = await moveLooi(command.direction, cm === undefined ? 450 : Math.round(cm * 450 / 6.5));
        if (!result.completed) return "移动已中断，距离未确认。";
        return cm === undefined ? "短步驱动和停止指令已写入，实际位移未测量。" :
          `已按目标${cm}厘米估时写入${command.direction === "forward" ? "前进" : "后退"}和停止指令，实际距离未测量。`;
      }
      case "turn": result = await turnLooi(command.direction, command.degrees); break;
      case "head": return (await setLooiHead(command.direction, undefined, true, options?.headWriteResponse)).notice;
      case "nod": await performLooiHeadGesture("nod", 1); break;
      case "dance": await performLooiDance("bounded-wiggle-v1"); break;
      case "light": await setLooiLight(command.enabled); break;
    }
    if (command.kind === "turn" && result?.completed) return "转向驱动和停止指令已写入，实际角度未测量。";
    return result?.completed === false ? "动作已被停止或中断" : command.kind === "nod" ? "已发送点头指令，尚未确认机械动作完成" : "指令执行结束";
  } catch (error) {
    const reason = getLooiRobotRuntimeState().safety.lastMotionBlockReason;
    if (reason && !(error instanceof Error && error.message.includes("停止写入失败"))) throw new Error(`传感器保护阻止动作：${reason}`);
    throw error;
  } finally { executing = false; }
}
