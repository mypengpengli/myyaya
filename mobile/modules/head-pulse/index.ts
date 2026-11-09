import { requireOptionalNativeModule } from "expo";
export type HeadPulseReport = { active: boolean; startAcknowledged: boolean; stopAcknowledged: boolean; reason: string;
  requestedDurationMs: number; signedSpeed: number; nativeWatchdog: boolean; physicalPosition: "unknown" };
type HeadPulseNative = { generation(): number; pulse(deviceId: string, signedSpeed: number, durationMs: number, generation: number): Promise<HeadPulseReport>; stop(): boolean; status(): HeadPulseReport };
const native = () => requireOptionalNativeModule<HeadPulseNative>("HeadPulse");
export async function pulseHeadNative(deviceId: string, signedSpeed: number, durationMs: number) {
  const module = native(); if (!module) throw new Error("此版本不支持原生头部短时控制");
  return module.pulse(deviceId, signedSpeed, durationMs, module.generation());
}
export const stopHeadPulseNative = () => native()?.stop();
export const headPulseStatus = () => native()?.status() ?? null;
