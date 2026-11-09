import { AppState } from "react-native";
import { acquireRobotObservation, robotGravitySnapshot } from "../../modules/robot-observation";
import { classifyHeadTilt, stableGravity } from "./head-tilt";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";

type StableGravity = ReturnType<typeof stableGravity>;
let lastObservation: ReturnType<typeof classifyHeadTilt> & { direction: string; atEpochMs: number; commandSent: boolean;
  beforeGravity: StableGravity; afterGravity: StableGravity; sampleCount: number } | null = null;
export const getLastHeadObservation = () => lastObservation;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function observeHeadCommand(direction: string, send: () => Promise<unknown>) {
  const release = acquireRobotObservation();
  let interrupted = false;
  const listener = AppState.addEventListener("change", (state) => { if (state !== "active") interrupted = true; });
  try {
    await delay(450);
    if (interrupted || AppState.currentState !== "active") throw new Error("请保持前台操作头部");
    const before = stableGravity(robotGravitySnapshot());
    const start = robotGravitySnapshot().nowMs;
    await send();
    await delay(1800);
    const after = robotGravitySnapshot();
    const samples = after.samples.filter((s) => s.atMs >= start), final = stableGravity(after);
    const result = classifyHeadTilt(interrupted ? null : before, samples, final);
    lastObservation = { ...result, direction, atEpochMs: Date.now(), commandSent: true,
      beforeGravity: interrupted ? null : before, afterGravity: final, sampleCount: samples.length };
    recordDiagnosticEvent("robot", "head-phone-tilt-observation", { ...result, direction, sampleCount: samples.length });
    return `已发送${direction === "up" ? "抬头" : direction === "down" ? "低头" : "回正"}指令；${result.notice}`;
  } finally { listener.remove(); release(); }
}
