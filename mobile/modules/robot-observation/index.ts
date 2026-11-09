import { requireOptionalNativeModule } from "expo";
export type GravitySample = { atMs: number; x: number; y: number; z: number; accuracy: number };
export type GravitySnapshot = { available: boolean; active: boolean; nowMs: number; sensor: string; samples: GravitySample[] };
type NativeObservation = { start(): boolean; stop(): void; snapshot(): GravitySnapshot };
let users = 0;
const native = () => requireOptionalNativeModule<NativeObservation>("RobotObservation");
export function acquireRobotObservation() {
  const module = native();
  if (users++ === 0) module?.start();
  let released = false;
  return () => { if (released) return; released = true; if (--users === 0) module?.stop(); };
}
export function robotGravitySnapshot(): GravitySnapshot {
  return native()?.snapshot() ?? { available: false, active: false, nowMs: 0, sensor: "unavailable", samples: [] };
}
