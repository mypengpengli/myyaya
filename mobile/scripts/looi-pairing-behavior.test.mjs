import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
const module = { exports: {} };
new Function("module", "exports", ts.transpileModule(readFileSync("src/device-tools/looi-pairing-session.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(module, module.exports);
const { LooiPairingSession } = module.exports;
const robot = (id, selected = false) => ({ id, name: "LOOI", rssi: -40, selected });
let clock = 0, scans = 0, linked = false, choices = [], releases = 0;
const deps = {
  prepare: async () => {}, now: () => clock, connected: () => linked,
  disconnect: async () => { releases++; linked = false; },
  connect: async (item) => { choices.push(item.id); linked = true; },
  scan: async () => { clock += 12000; return ++scans < 3 ? [] : [robot("mine")]; },
};
const delayed = new LooiPairingSession(deps);
await delayed.start();
assert.equal(scans, 3, "a user can take more than one scan round to enable the yellow light");
assert.equal(delayed.getSnapshot().phase, "connected"); assert.deepEqual(choices, ["mine"]);

linked = false; clock = 0; choices = [];
const saved = new LooiPairingSession({ ...deps, scan: async (signal, update) => {
  update([robot("other"), robot("saved", true)]);
  assert.equal(signal.aborted, true, "stop scanning before connecting the saved robot"); return [];
} });
await saved.start(); assert.deepEqual(choices, ["saved"]);

linked = false; clock = 0; choices = [];
const multiple = new LooiPairingSession({ ...deps, scan: async () => { clock += 12000; return [robot("a"), robot("b")]; } }, 24000);
await multiple.start(); assert.deepEqual(choices, [], "multiple unfamiliar robots require a choice");
assert.equal(multiple.getSnapshot().phase, "timeout");

linked = false; clock = 0; let finish;
const cancelled = new LooiPairingSession({ ...deps, scan: async () => [robot("mine")],
  connect: async () => { await new Promise((resolve) => { finish = resolve; }); linked = true; } });
const pending = cancelled.start();
while (!finish) await Promise.resolve();
cancelled.cancel(); finish(); await pending;
assert.equal(linked, false); assert.equal(releases, 1, "leaving during GATT connection releases late success");
assert.equal(cancelled.getSnapshot().phase, "cancelled");

clock = 0; scans = 0; let retrySession;
retrySession = new LooiPairingSession({ ...deps, scan: async (signal) => {
  scans++; if (scans === 1) { retrySession.retry(); assert.equal(signal.aborted, true); return []; }
  return [robot("mine")];
} });
await retrySession.start(); assert.equal(scans, 2); assert.equal(retrySession.getSnapshot().phase, "connected");
console.log("LOOI pairing: delayed yellow light, repeated discovery, saved-device selection, explicit choice, immediate rescan and late cancellation: PASS");
