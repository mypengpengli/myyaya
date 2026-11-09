import { executeChineseRobotCommand } from "../device-tools/chinese-robot-control";
import { AppState } from "react-native";
import { getAppMode } from "../setup/setup-storage";
import { holdAmbientMotionFor } from "../core/ambient-motion";
import { holdSocialAttentionMotionFor } from "../core/social-attention";
/** Permission-protected ADB diagnostic only; no raw payload, wheels or production default change. */
export async function runHeadProtocolProbe(command: { direction?: unknown; response?: unknown; mode?: unknown; durationMs?: unknown }) {
  const { direction, response } = command;
  if (command.mode === "velocity") {
    if ((direction !== "up" && direction !== "down") || !Number.isInteger(command.durationMs) || Number(command.durationMs) < 100 || Number(command.durationMs) > 500) throw new Error("头部短时参数无效");
    if (AppState.currentState !== "active" || getAppMode() !== "local") throw new Error("请保持前台本地模式");
    holdAmbientMotionFor(15000, "head-velocity-diagnostic"); holdSocialAttentionMotionFor(15000, "head-velocity-diagnostic");
    return (await import("../device-tools/looi-robot")).pulseLooiHeadForDiagnostics(direction, Number(command.durationMs));
  }
  if (command.mode !== undefined && command.mode !== "angle") throw new Error("头部对照模式无效");
  if ((direction !== "up" && direction !== "down" && direction !== "center") || typeof response !== "boolean") throw new Error("头部对照参数无效");
  const notice = await executeChineseRobotCommand({ kind: "head", direction }, { headWriteResponse: response });
  return { direction, response, notice, physicalPosition: "unknown" };
}
