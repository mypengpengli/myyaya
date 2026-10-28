import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { AppState } from "react-native";
import type { ChineseRobotCommand } from "../voice/chinese-command";
import { executeChineseRobotCommand } from "../device-tools/chinese-robot-control";
import { disconnectLooiRobot, getLooiRobotRuntimeState, stopLooiMotion } from "../device-tools/looi-robot";
import { forceReconnectSavedLooiRobot } from "../device-tools/looi-robot-autoconnect";
import { holdAmbientMotionFor } from "../core/ambient-motion";
import { holdSocialAttentionMotionFor } from "../core/social-attention";

const commands = {
  forward: { kind: "move", direction: "forward" }, back: { kind: "move", direction: "back" },
  left: { kind: "turn", direction: "left", degrees: 90 }, right: { kind: "turn", direction: "right", degrees: 90 },
  head_up: { kind: "head", direction: "up" }, head_down: { kind: "head", direction: "down" }, head_center: { kind: "head", direction: "center" },
  nod: { kind: "nod" }, dance: { kind: "dance" }, light_on: { kind: "light", enabled: true }, light_off: { kind: "light", enabled: false }, stop: { kind: "stop" },
} satisfies Record<string, ChineseRobotCommand>;
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: {} });
const hold = () => { holdAmbientMotionFor(15_000, "agent-robot-control"); holdSocialAttentionMotionFor(15_000, "agent-robot-control"); };

export const connectRobotTool: AgentTool = {
  name: "connect_robot", label: "正在连接 LOOI 底座", description: "连接手机里已经配对保存的 LOOI。首次连接或没有保存设备时，提示用户在菜单连接 LOOI 并将底座置于黄灯模式；不要自行挑选陌生底座。",
  parameters: Type.Object({}), execute: async (_id, _params, signal) => {
    if (signal?.aborted) throw new Error("已取消连接");
    if (AppState.currentState !== "active") throw new Error("请保持 App 在前台连接底座");
    hold();
    const result = await forceReconnectSavedLooiRobot();
    if (signal?.aborted || AppState.currentState !== "active") { await disconnectLooiRobot(); throw new Error("已取消连接"); }
    return text({ connected: getLooiRobotRuntimeState().connected,
      notice: result.ok ? "已连接保存的 LOOI" : "请从菜单连接 LOOI；首次配对时长按约 3 秒进入黄灯模式" });
  },
};
export const robotActionTool: AgentTool = {
  name: "robot_action", label: "正在控制 LOOI", description: "用户明确要求移动、转向、抬低头、点头、跳舞、灯光或停止时控制底座。前后是一次约 450 毫秒短动作，左右是估时 90 度转向；不代表已到达地点或精确距离。没有地图/跟随能力，禁止循环盲走。传感器保护、后台与本地停止仍优先。",
  parameters: Type.Object({ action: Type.Union(Object.keys(commands).map((action) => Type.Literal(action))) }),
  execute: async (_id, params, signal) => {
    const action = (params as { action: keyof typeof commands }).action;
    if (!Object.hasOwn(commands, action)) throw new Error("不支持的底座动作");
    if (signal?.aborted) throw new Error("动作已取消");
    hold();
    const stop = () => { void stopLooiMotion("agent-action-cancelled").catch(() => {}); };
    signal?.addEventListener("abort", stop, { once: true });
    try {
      if (signal?.aborted) throw new Error("动作已取消");
      const notice = await executeChineseRobotCommand(commands[action]);
      if (signal?.aborted) throw new Error("动作已停止");
      return text({ action, notice, connected: getLooiRobotRuntimeState().connected });
    } finally { signal?.removeEventListener("abort", stop); }
  },
};
