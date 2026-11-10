import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
function rig(mode = "ok") {
  const state = { captured: 0, shown: 0, released: 0 };
  const values = Uint8Array.from({ length: 252 * 252 }, (_, i) => i % 256);
  const mocks = {
    "expo-file-system/legacy": { cacheDirectory: "file:///cache/", EncodingType: { Base64: "base64" },
      getInfoAsync: async () => ({ exists: true, isDirectory: false, size: 27342208 }),
      readAsStringAsync: async (uri) => { assert.equal(uri, "file:///cache/live.rgb"); return "rgb"; }, writeAsStringAsync: async () => {} },
    "@siteed/sherpa-onnx.rn": { base64ToTypedArray: () => values,
      OnnxInference: { createSession: async () => ({ sessionId: "session", inputNames: ["image"], inputTypes: ["uint8"], release: async () => { state.released++; } }),
        run: async (_id, feeds) => { assert.deepEqual(feeds.image.dims, [1, 256, 256, 3]); return { success: true, outputs: { output: { type: "uint8", dims: mode === "bad-output" ? [1, 2, 2] : [1, 252, 252], data: "depth" } } }; } } },
    "../../modules/navigation-probe": {
      getNavigationProbeStatus: async () => ({ dataDirectory: "/test" }),
      captureNativeMonocularFrame: async () => { state.captured++; if (mode === "closed") throw new Error("camera closed"); return { requestId: "frame", inputUri: "file:///cache/live.rgb" }; },
      showNativeMonocularFrame: async (id, data) => { assert.equal(id, "frame"); assert.equal(data, "depth"); if (mode === "stale") throw new Error("stale frame"); state.shown++; },
      exportNativeMonocularBenchmark: async () => ({ directory: "/exports", files: ["live.depth"] }),
    },
    "../core/ambient-motion": { holdAmbientMotionFor: () => {} }, "../core/social-attention": { holdSocialAttentionMotionFor: () => {} },
  };
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync("src/diagnostics/monocular-live-probe.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", js)((name) => { assert.ok(name in mocks, `unexpected dependency: ${name}`); return mocks[name]; }, module, module.exports);
  return { state, run: module.exports.runMonocularLiveProbe };
}
const good = rig(); const result = await good.run(); assert.equal(result.autonomousMotionAuthorized, false);
assert.deepEqual(good.state, { captured: 1, shown: 1, released: 1 });
for (const mode of ["closed", "stale", "bad-output"]) {
  const r = rig(mode); await assert.rejects(r.run()); assert.equal(r.state.released, 1); assert.equal(r.state.shown, 0);
}
console.log("Monocular live sample: explicit capture, stale/closed rejection, output validation and cleanup: PASS");
