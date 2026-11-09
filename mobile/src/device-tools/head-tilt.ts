import type { GravitySample, GravitySnapshot } from "../../modules/robot-observation";
export type GravityVector = { x: number; y: number; z: number };
export function tiltDegrees(a: GravityVector, b: GravityVector): number | null {
  const normA = Math.hypot(a.x, a.y, a.z), normB = Math.hypot(b.x, b.y, b.z);
  if (![normA, normB].every((n) => Number.isFinite(n) && n >= 7 && n <= 12)) return null;
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (normA * normB)))) * 180 / Math.PI;
}
export function stableGravity(snapshot: GravitySnapshot, windowMs = 300) {
  const end = snapshot.samples.at(-1);
  if (!snapshot.active || !end || snapshot.nowMs - end.atMs > 250 || end.atMs > snapshot.nowMs) return null;
  const samples = snapshot.samples.filter((s) => s.atMs >= end.atMs - windowMs);
  if (samples.length < 4 || end.atMs - samples[0].atMs < windowMs * 0.65 || samples.some((s) => s.accuracy <= 0)) return null;
  const mean = samples.reduce((v, s) => ({ x: v.x + s.x / samples.length, y: v.y + s.y / samples.length, z: v.z + s.z / samples.length }), { x: 0, y: 0, z: 0 });
  if (samples.some((s) => (tiltDegrees(mean, s) ?? 180) > 1)) return null;
  return { ...mean, atMs: end.atMs };
}
export function classifyHeadTilt(before: GravityVector | null, samples: GravitySample[], final: GravityVector | null) {
  const angles = before ? samples.filter((s) => s.accuracy > 0).map((s) => tiltDegrees(before, s)).filter((a): a is number => a !== null) : [];
  const finalDeltaDeg = before && final ? tiltDegrees(before, final) : null;
  const peakDeltaDeg = angles.length ? Math.max(...angles) : null;
  const status = finalDeltaDeg === null || peakDeltaDeg === null || samples.length < 8 ? "unavailable"
    : peakDeltaDeg < 2 ? "no-observed-tilt-change" : finalDeltaDeg < 2 ? "changed-then-returned" : "tilt-changed";
  return { status, peakDeltaDeg, finalDeltaDeg, physicalPosition: "unknown" as const,
    notice: status === "unavailable" ? "倾角观测不足，尚未确认头部到位"
      : status === "no-observed-tilt-change" ? "未观测到明显手机倾角变化，尚未确认头部到位"
      : status === "changed-then-returned" ? "观测到手机倾角变化后回到原角度，尚未确认头部到位"
      : "观测到手机倾角变化，尚未确认头部到位" };
}
