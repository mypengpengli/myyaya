import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const probeScreen=fs.readFileSync("modules/navigation-probe/android/src/main/java/com/myyaya/navigationprobe/NavigationProbeScreen.kt","utf8");
const drawFrame=probeScreen.slice(probeScreen.indexOf("override fun onDrawFrame"));
assert.ok(drawFrame.indexOf("roomMap?.offerVisualFrame(frame)")>=0 &&
  drawFrame.indexOf("roomMap?.offerVisualFrame(frame)")<drawFrame.indexOf("cadence.poll(now)"),
  "visual image acquisition must remain independent of the slower depth/report cadence");
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
let headObservationEntered, finishHeadBaseline;
let onHeadWrite;
const robot = load("src/device-tools/looi-robot.ts", {
  "@sourcebug/looi-sdk": sdk,
  "./fed9-sensors": fed9,
  "../core/navigation-control-lease": lease,
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "./head-observation": { observeHeadCommand: async (_direction, send) => {
    headObservationEntered?.();
    await new Promise((resolve) => { finishHeadBaseline = resolve; });
    await send(); return "observed";
  } },
});
robot.configureLooiRobotTransport({
  connect: async () => {}, disconnect: async () => {},
  hasCharacteristic: (key) => key === "drive" || key === "dockNotify",
  startNotifications: async (key, callback) => { if (key === "dockNotify") notify = callback; },
  write: async (key, payload) => { writes.push({ key, payload });if(key==="head") onHeadWrite?.(payload); },
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
await assert.rejects(robot.moveLooiNavigationPulse("back", 450, "route-owner"), /参数/, "autonomous pulse cap stays unchanged");
const beforeOperator=writes.length;
await robot.moveLooiOperatorBackCalibration("route-owner");
assert.ok(writes.slice(beforeOperator).some((w)=>w.key==="drive" && w.payload==="86fc"));
assert.equal(writes.at(-1).payload,"0000");
await assert.rejects(robot.moveLooiOperatorBackCalibration("stale-owner"), /导航/);
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
const entered = new Promise((resolve) => { headObservationEntered = resolve; });
const delayedHead = robot.setLooiHead("down", undefined, true);
await entered;
const headWritesBefore = writes.filter((w) => w.key === "head").length;
await robot.stopLooiMotion("cancel-during-head-sensor-baseline");
finishHeadBaseline();
await assert.rejects(delayedHead, /取消/);
assert.equal(writes.filter((w) => w.key === "head").length, headWritesBefore, "STOP during the sensor baseline prevents a late head write");
const reconnectEntered=new Promise((resolve)=>{headObservationEntered=resolve;});
const staleHead=robot.setLooiHead("up",undefined,true);
const staleHeadRejected=assert.rejects(staleHead,/取消/);
await reconnectEntered;
const beforeReconnectHeads=writes.filter(w=>w.key==="head").length;
robot.handleLooiRobotTransportDisconnected("test link loss");
await robot.connectLooiRobot();finishHeadBaseline();await staleHeadRejected;
assert.equal(writes.filter(w=>w.key==="head").length,beforeReconnectHeads,"a pending head command cannot cross a disconnect/reconnect epoch");
const lowered=new Promise((resolve)=>{onHeadWrite=(payload)=>{if(payload==="ff") resolve();};});
const annoyed=robot.performLooiCharacterReaction("annoyed");
const annoyedRejected=assert.rejects(annoyed,/取消|interrupted/);
await lowered;onHeadWrite=undefined;
const beforeReactionDisconnect=writes.filter(w=>w.key==="head").length;
robot.handleLooiRobotTransportDisconnected("gesture link loss");
await robot.connectLooiRobot();await annoyedRejected;
assert.equal(writes.filter(w=>w.key==="head").length,beforeReactionDisconnect,"a cancelled reaction never sends its delayed center frame after reconnect");
await robot.disconnectLooiRobot();
console.log("Navigation motor ownership, real BLE pulse and cancellation tests passed");
