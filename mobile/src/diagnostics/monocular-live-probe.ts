import * as FileSystem from "expo-file-system/legacy";
import { OnnxInference, base64ToTypedArray } from "@siteed/sherpa-onnx.rn";
import { getNavigationProbeStatus, captureNativeMonocularFrame, showNativeMonocularFrame, exportNativeMonocularBenchmark } from "../../modules/navigation-probe";
import { holdAmbientMotionFor } from "../core/ambient-motion";
import { holdSocialAttentionMotionFor } from "../core/social-attention";

/** One explicitly requested sample. Never promotes relative depth into route clearance. */
export async function runMonocularLiveProbe() {
  holdAmbientMotionFor(90_000, "monocular-live-probe");
  holdSocialAttentionMotionFor(90_000, "monocular-live-probe");
  const status = await getNavigationProbeStatus();
  const modelPath = `file://${status.dataDirectory}/monocular-benchmark/fused_model_int8_256.onnx`;
  const info = await FileSystem.getInfoAsync(modelPath);
  if (!info.exists || info.isDirectory || info.size !== 27_342_208) throw new Error("请先放入已核验的单目对照模型");
  const session = await OnnxInference.createSession({ modelPath, numThreads: 4 });
  try {
    if (session.inputNames.length !== 1 || session.inputTypes[0] !== "uint8") throw new Error("模型输入类型不符");
    const frame = await captureNativeMonocularFrame();
    const input = await FileSystem.readAsStringAsync(frame.inputUri, { encoding: FileSystem.EncodingType.Base64 });
    const started = Date.now();
    const result = await OnnxInference.run(session.sessionId, {
      [session.inputNames[0]]: { type: "uint8", dims: [1, 256, 256, 3], data: input },
    });
    const inferenceMs = Date.now() - started;
    if (!result.success || !result.outputs) throw new Error(result.error || "单目推理失败");
    const outputs = Object.values(result.outputs);
    if (outputs.length !== 1) throw new Error("模型输出数量不符");
    const output = outputs[0];
    if (output.type !== "uint8" || output.dims.join(",") !== "1,252,252") throw new Error("模型输出尺寸或类型不符");
    const values = base64ToTypedArray(output.data, "uint8") as Uint8Array;
    if (values.length !== 252 * 252) throw new Error("模型输出长度不符");
    let min = 255, max = 0;
    for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
    if (max <= min) throw new Error("模型返回常量深度");
    if (!FileSystem.cacheDirectory) throw new Error("缺少应用缓存目录");
    await FileSystem.writeAsStringAsync(`${FileSystem.cacheDirectory}monocular-benchmark/live.depth`, output.data, { encoding: FileSystem.EncodingType.Base64 });
    await showNativeMonocularFrame(frame.requestId, output.data, inferenceMs);
    const exported = await exportNativeMonocularBenchmark();
    return { frame, inferenceMs, min, max, exported, relativeDepthOnly: true, metricDepthValidated: false, autonomousMotionAuthorized: false };
  } finally {
    await session.release();
  }
}
