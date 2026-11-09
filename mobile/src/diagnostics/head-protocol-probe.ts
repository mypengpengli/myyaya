import { executeChineseRobotCommand } from "../device-tools/chinese-robot-control";
/** Permission-protected ADB diagnostic only; no raw payload, velocity, wheels or production default change. */
export async function runHeadProtocolProbe(command: { direction?: unknown; response?: unknown }) {
  const { direction, response } = command;
  if ((direction !== "up" && direction !== "down" && direction !== "center") || typeof response !== "boolean") throw new Error("头部对照参数无效");
  const notice = await executeChineseRobotCommand({ kind: "head", direction }, { headWriteResponse: response });
  return { direction, response, notice, physicalPosition: "unknown" };
}
