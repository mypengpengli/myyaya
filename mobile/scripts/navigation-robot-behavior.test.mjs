import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(file, overrides = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", "module", output)((id) => overrides[id] ?? require(id), module.exports, module);
  return module.exports;
}
const lease = load("src/core/navigation-control-lease.ts");
const sdk = load("packages/looi-sdk/src/index.ts");
const fed9 = load("src/device-tools/fed9-sensors.ts");
const writes = [];
let notify;
const robot = load("src/device-tools/looi-robot.ts", {
  "@sourcebug/looi-sdk": sdk,
  "./fed9-sensors": fed9,
  "../core/navigation-control-lease": lease,
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
});
robot.configureLooiRobotTransport({
  connect: async () => {}, disconnect: async () => {},
  hasCharacteristic: (key) => key === "drive" || key === "dockNotify",
  startNotifications: async (key, callback) => { if (key === "dockNotify") notify = callback; },
  write: async (key, payload) => { writes.push({ key, payload }); },
});
await robot.connectLooiRobot();
notify({ characteristic: "dockNotify", hex: "0101010101", bytes: new Uint8Array([1, 1, 1, 1, 1]) });
notify({ characteristic: "dockNotify", hex: "0ee803", bytes: new Uint8Array([0x0e, 0xe8, 0x03]) });
await new Promise((resolve) => setTimeout(resolve, 300));
lease.acquireNavigationControl("route-owner");
await assert.rejects(robot.moveLooi("forward", 100), /导航/);
await assert.rejects(robot.setLooiHead("up"), /导航/);
await assert.rejects(robot.performLooiHeadGesture("nod"), /导航/);
await assert.rejects(robot.performLooiDance("bounded-wiggle-v1"), /导航/);
const before = writes.length;
await robot.moveLooiNavigationPulse("left", 90, "route-owner");
assert.ok(writes.slice(before).some((w) => w.key === "drive" && w.payload === "047a"), "route uses real community turn frame");
assert.equal(writes.at(-1).payload, "0000");
await assert.rejects(robot.moveLooiNavigationPulse("left", 900, "route-owner"), /参数/);
await assert.rejects(robot.moveLooiNavigationPulse("back", 100, "stale-owner"), /导航/);
const beforeCancel = writes.length;
const pending = robot.moveLooiNavigationPulse("back", 100, "route-owner");
await robot.stopLooiMotion("cancel-before-drive");
lease.releaseNavigationControl("route-owner");
await assert.rejects(pending, /取消|导航/);
assert.equal(writes.slice(beforeCancel).filter((w) => w.key === "drive" && w.payload !== "0000").length, 0, "cancelled pending pulse cannot write late motion");
await assert.rejects(robot.setLooiHead("center", "route-owner"), /导航/);
lease.acquireNavigationControl("new-owner");
await robot.startLooiMotion("stop");
assert.equal(writes.at(-1).payload, "0000", "stop bypasses exclusive ownership");
lease.releaseNavigationControl("new-owner");
await robot.disconnectLooiRobot();
console.log("Navigation motor ownership, real BLE pulse and cancellation tests passed");
