import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import { OnnxInference, base64ToTypedArray } from "@siteed/sherpa-onnx.rn";
import { getNavigationProbeStatus } from "../../modules/navigation-probe";
import { holdAmbientMotionFor } from "../core/ambient-motion";
import { holdSocialAttentionMotionFor } from "../core/social-attention";

/** ADB-only fixed local fixtures. Reuses the already-packaged runtime; no camera, download or motors. */
export async function runMonocularDepthBenchmark() {
  holdAmbientMotionFor(90_000, "monocular-depth-benchmark");
  holdSocialAttentionMotionFor(90_000, "monocular-depth-benchmark");
  const { dataDirectory } = await getNavigationProbeStatus();
  if (!dataDirectory?.startsWith("/")) throw new Error("缺少本机诊断目录");
  const root = `file://${dataDirectory}/monocular-benchmark/`;
  const modelPath = root + "fused_model_int8_256.onnx";
  const model = await FileSystem.getInfoAsync(modelPath);
  if (!model.exists || model.isDirectory || model.size !== 27_342_208) throw new Error("请先通过ADB放入已核验的27MB对照模型");
  const fixtures = ["can_before", "can_after", "turn_before", "turn_after"];
  // Validate all inputs before creating a native session.
  for (const name of fixtures) {
    const info = await FileSystem.getInfoAsync(`${root}${name}.rgb`);
    if (!info.exists || info.isDirectory || info.size !== 256 * 256 * 3) throw new Error(`输入图像不完整：${name}`);
  }
  if (!FileSystem.cacheDirectory) throw new Error("缺少应用缓存目录");
  const outputRoot = `${FileSystem.cacheDirectory}monocular-benchmark/`;
  await FileSystem.makeDirectoryAsync(outputRoot, { intermediates: true });
  const started = Date.now();
  const session = await OnnxInference.createSession({ modelPath, numThreads: 4 });
  const loadMs = Date.now() - started;
  try {
    if (session.inputNames.length !== 1 || session.inputTypes[0] !== "uint8") throw new Error("模型输入类型不符");
    const samples = [];
    for (const name of fixtures) {
      const data = await FileSystem.readAsStringAsync(`${root}${name}.rgb`, { encoding: FileSystem.EncodingType.Base64 });
      const begin = Date.now();
      const result = await OnnxInference.run(session.sessionId, {
        [session.inputNames[0]]: { type: "uint8", dims: [1, 256, 256, 3], data },
      });
      const bridgeInferenceMs = Date.now() - begin;
      if (!result.success || !result.outputs) throw new Error(result.error || "单目推理失败");
      const outputs = Object.values(result.outputs);
      if (outputs.length !== 1) throw new Error("模型输出数量不符");
      const output = outputs[0];
      if (output.type !== "uint8" || output.dims.join(",") !== "1,252,252") throw new Error("模型输出尺寸或类型不符");
      const values = base64ToTypedArray(output.data, "uint8") as Uint8Array;
      if (values.length !== 252 * 252) throw new Error("模型输出长度不符");
      let min = 255, max = 0;
      for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
      if (max <= min) throw new Error("模型返回常量深度，不能作为有效对照");
      await FileSystem.writeAsStringAsync(`${outputRoot}${name}.depth`, output.data, { encoding: FileSystem.EncodingType.Base64 });
      // String hashing already works in the app; avoid Expo's unsupported ArrayBuffer conversion.
      const sha256Base64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, output.data);
      const sampledValues = Array.from({ length: 256 }, (_, i) => values[Math.floor(i / 16) * 16 * 252 + (i % 16) * 16]);
      samples.push({ name, bridgeInferenceMs, min, max, outputBytes: values.length, sha256Base64, sampledValues });
    }
    return { model: "DepthAnythingV2-small-int8-256", loadMs, threads: 4, samples,
      relativeDepthOnly: true, metricDepthValidated: false, autonomousMotionAuthorized: false };
  } finally {
    await session.release();
  }
}
