import { captureNativeMonocularFrame, analyzeNativeUprightReference } from "../../modules/navigation-probe";
import { holdAmbientMotionFor } from "../core/ambient-motion";
import { holdSocialAttentionMotionFor } from "../core/social-attention";

/** Explicit known-object experiment. Does not change measured settings or grant motion. */
export async function runUprightReferenceProbe(args: { heightCm?: unknown; diameterCm?: unknown }) {
  const { heightCm, diameterCm } = args ?? {};
  if (typeof heightCm !== "number" || !Number.isFinite(heightCm) || heightCm < 3 || heightCm > 50
    || typeof diameterCm !== "number" || !Number.isFinite(diameterCm) || diameterCm < 2 || diameterCm > 30) {
    throw new Error("请提供参照物实测高度与直径，单位厘米");
  }
  holdAmbientMotionFor(90_000, "upright-reference");
  holdSocialAttentionMotionFor(90_000, "upright-reference");
  const frame = await captureNativeMonocularFrame();
  return { frame, result: await analyzeNativeUprightReference(frame.requestId, heightCm / 100, diameterCm / 100) };
}
