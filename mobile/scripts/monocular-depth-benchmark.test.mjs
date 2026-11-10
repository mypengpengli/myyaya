import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url), ts = require("typescript");
const data = Buffer.from(Uint8Array.from({ length: 252 * 252 }, (_, i) => i % 256)).toString("base64");
function rig(mode = "ok") {
  const state = { created: 0, released: 0, writes: 0, runs: 0 };
  const session = { sessionId: "test", inputNames: ["image"], inputTypes: ["uint8"], release: async () => { state.released++; } };
  const mocks = {
    "expo-file-system/legacy": {
      EncodingType: { Base64: "base64" },
      cacheDirectory: "file:///cache/",
      makeDirectoryAsync: async () => {},
      getInfoAsync: async (uri) => ({ exists: true, isDirectory: false, size: uri.endsWith("onnx") ? 27342208 : mode === "bad-input" ? 0 : 256 * 256 * 3 }),
      readAsStringAsync: async () => "fixed-input",
      writeAsStringAsync: async (uri) => { assert.ok(uri.startsWith("file:///cache/monocular-benchmark/")); state.writes++; },
    },
    "expo-crypto": { CryptoDigestAlgorithm: { SHA256: "sha256" }, digestStringAsync: async (_algorithm, text) => { assert.equal(typeof text, "string"); return createHash("sha256").update(text, "utf8").digest("hex"); } },
    "@siteed/sherpa-onnx.rn": {
      base64ToTypedArray: (value) => new Uint8Array(Buffer.from(value, "base64")),
      OnnxInference: {
        createSession: async ({ numThreads }) => { assert.equal(numThreads, 4); state.created++; return session; },
        run: async (_id, feeds) => {
          state.runs++; assert.deepEqual(feeds.image.dims, [1, 256, 256, 3]); assert.equal(feeds.image.type, "uint8");
          if (mode === "native-error") return { success: false, error: "native failure" };
          return { success: true, outputs: { depth: { type: "uint8", dims: mode === "bad-output" ? [1, 2, 2] : [1, 252, 252], data: mode === "constant" ? Buffer.alloc(252 * 252).toString("base64") : data } } };
        },
      },
    },
    "../../modules/navigation-probe": { getNavigationProbeStatus: async () => ({ dataDirectory: "/test" }) },
    "../core/ambient-motion": { holdAmbientMotionFor: () => {} },
    "../core/social-attention": { holdSocialAttentionMotionFor: () => {} },
  };
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync("src/diagnostics/monocular-depth-benchmark.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", js)((name) => { assert.ok(name in mocks, `unexpected dependency: ${name}`); return mocks[name]; }, module, module.exports);
  return { state, run: module.exports.runMonocularDepthBenchmark };
}
const good = rig(); const result = await good.run();
assert.equal(result.samples.length, 4); assert.equal(result.autonomousMotionAuthorized, false); assert.equal(result.metricDepthValidated, false);
assert.equal(result.samples[0].sha256Base64, createHash("sha256").update(data, "utf8").digest("hex"));
assert.equal(result.samples[0].sampledValues.length, 256);
assert.deepEqual(good.state, { created: 1, released: 1, writes: 4, runs: 4 });
const invalid = rig("bad-input"); await assert.rejects(invalid.run(), /图像不完整/); assert.equal(invalid.state.created, 0);
for (const mode of ["bad-output", "native-error", "constant"]) {
  const failed = rig(mode); await assert.rejects(failed.run()); assert.equal(failed.state.released, 1); assert.equal(failed.state.writes, 0);
}
console.log("Monocular benchmark: fixed inputs, native cleanup, invalid output and no motion authorization: PASS");
