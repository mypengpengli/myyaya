import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
function rig(mode = "ok") {
  const calls = [];
  const mocks = {
    "../../modules/navigation-probe": {
      captureNativeMonocularFrame: async () => { calls.push("capture"); if (mode === "closed") throw new Error("closed"); return { requestId: "fresh" }; },
      analyzeNativeUprightReference: async (id, h, w) => { calls.push([id, h, w]); if (mode === "stale") throw new Error("stale"); return { settingsChanged: false, autonomousMotionAuthorized: false }; },
    },
    "../core/ambient-motion": { holdAmbientMotionFor: () => {} },
    "../core/social-attention": { holdSocialAttentionMotionFor: () => {} },
  };
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync("src/diagnostics/upright-reference-probe.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", js)((name) => { assert.ok(name in mocks, `unexpected dependency: ${name}`); return mocks[name]; }, module, module.exports);
  return { calls, run: module.exports.runUprightReferenceProbe };
}
const good = rig(), result = await good.run({ heightCm: 11.5, diameterCm: 6.5 });
assert.deepEqual(good.calls, ["capture", ["fresh", .115, .065]]);
assert.equal(result.result.settingsChanged, false); assert.equal(result.result.autonomousMotionAuthorized, false);
for (const args of [undefined, {}, { heightCm: "11.5", diameterCm: 6.5 }, { heightCm: NaN, diameterCm: 6.5 }, { heightCm: 11.5, diameterCm: 0 }]) {
  const r = rig(); await assert.rejects(r.run(args)); assert.deepEqual(r.calls, []);
}
for (const mode of ["closed", "stale"]) { const r = rig(mode); await assert.rejects(r.run({ heightCm: 11.5, diameterCm: 6.5 })); }
console.log("Upright reference: measured input, fresh frame, stale/closed failures, no settings or motion dependency: PASS");
