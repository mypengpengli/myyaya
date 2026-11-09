import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), module, module.exports);
  return module.exports;
}
const tilt = load("src/device-tools/head-tilt.ts");
const vector = (degrees) => ({ x: 0, y: 9.81 * Math.sin(degrees * Math.PI / 180), z: 9.81 * Math.cos(degrees * Math.PI / 180) });
const samples = (degrees, start = 0) => Array.from({ length: 20 }, (_, n) => ({ ...vector(degrees), atMs: start + n * 50, accuracy: 3 }));
const snapshot = (s, nowMs = s.at(-1).atMs) => ({ available: true, active: true, nowMs, samples: s });
assert.ok(Math.abs(tilt.tiltDegrees(vector(0), vector(35)) - 35) < 1e-7);
assert.equal(tilt.tiltDegrees({ x: 0, y: 0, z: 0 }, vector(0)), null);
assert.equal(tilt.tiltDegrees({ x: NaN, y: 0, z: 9 }, vector(0)), null);
assert.ok(tilt.stableGravity(snapshot(samples(0))));
assert.equal(tilt.stableGravity(snapshot(samples(0), 1400)), null, "stale sensor data never counts as current pose");
assert.equal(tilt.stableGravity(snapshot(samples(0).map((s) => ({ ...s, accuracy: 0 })))), null);
assert.equal(tilt.stableGravity(snapshot(samples(0).map((s, n) => ({ ...s, ...vector(n % 2 ? 15 : 0) })))), null, "unstable baseline is rejected");
assert.equal(tilt.classifyHeadTilt(vector(0), samples(0), vector(0)).status, "no-observed-tilt-change");
assert.equal(tilt.classifyHeadTilt(vector(0), samples(30), vector(30)).status, "tilt-changed");
const returned = tilt.classifyHeadTilt(vector(0), [...samples(30), ...samples(0, 1000)], vector(0));
assert.equal(returned.status, "changed-then-returned"); assert.equal(returned.physicalPosition, "unknown");
assert.equal(tilt.classifyHeadTilt(null, samples(30), vector(30)).status, "unavailable");
assert.equal(tilt.classifyHeadTilt(vector(0), [], vector(0)).status, "unavailable");

const { assertIntegrationCommandFresh: fresh } = load("src/diagnostics/integration-command-age.ts");
assert.throws(() => fresh({ kind: "chat", receivedAtEpochMs: 1 }, 16002), /过期/);
assert.throws(() => fresh({ kind: "tool", tool: "robot_action", args: { action: "head_up" } }), /过期/);
assert.doesNotThrow(() => fresh({ kind: "tool", tool: "robot_action", args: { action: "stop" } }));
assert.doesNotThrow(() => fresh({ kind: "tool", receivedAtEpochMs: 100 }, 15100));
assert.throws(() => fresh({ kind: "tool", receivedAtEpochMs: 20000 }, 1), /过期/);

const sdk = load("packages/looi-sdk/src/index.ts");
const headFrames = [];
const headSdk = new sdk.LooiRobot({ write: async (key, hex, options) => headFrames.push({ key, hex, options }) });
await headSdk.setHead("down");
await headSdk.setHead("down", { response: true });
assert.deepEqual(headFrames, [
  { key: "head", hex: "ff", options: { response: false, expectedBytes: 1 } },
  { key: "head", hex: "ff", options: { response: true, expectedBytes: 1 } },
], "head A/B uses identical bytes and preserves the production write default");
let probeCalls = [];
const probe = load("src/diagnostics/head-protocol-probe.ts", {
  "../device-tools/chinese-robot-control": { executeChineseRobotCommand: async (...args) => { probeCalls.push(args); return "sent"; } },
});
await probe.runHeadProtocolProbe({ direction: "down", response: true });
assert.deepEqual(probeCalls, [[{ kind: "head", direction: "down" }, { headWriteResponse: true }]]);
for (const input of [{ direction: "forward", response: true }, { direction: "ff", response: true }, { direction: "up", response: "true" }]) {
  await assert.rejects(probe.runHeadProtocolProbe(input), /参数/);
}
assert.equal(probeCalls.length, 1, "diagnostic cannot send raw bytes or wheels");
const uuid = (short) => `0000${short}-0000-1000-8000-00805f9b34fb`;
const device = { id: "test-base", name: "LOOI Robot" };
let head = { uuid: uuid("fed1"), isReadable: true, isNotifiable: true, isWritableWithoutResponse: true };
let infoCharacteristics = [];
let writes = 0, reads = 0, monitors = 0, listener, disconnect;
const manager = {
  state: async () => "PoweredOn", devices: async () => [device], connectedDevices: async () => [device], isDeviceConnected: async () => true,
  onDeviceDisconnected: (_id, callback) => { disconnect = callback; return { remove() {} }; },
  discoverAllServicesAndCharacteristicsForDevice: async () => device,
  servicesForDevice: async () => [{ uuid: uuid("00ff") }], characteristicsForDevice: async () => [head, ...infoCharacteristics], requestMTUForDevice: async () => {},
  monitorCharacteristicForDevice: (_id, _service, _uuid, callback) => { monitors++; listener = callback; return { remove() {} }; },
  readCharacteristicForDevice: async () => { reads++; return { value: Buffer.from([0x87]).toString("base64") }; },
  writeCharacteristicWithoutResponseForDevice: async () => { writes++; },
  writeCharacteristicWithResponseForDevice: async () => { writes++; },
  stopDeviceScan: async () => {}, cancelDeviceConnection: async () => {},
};
const transportModule = load("src/device-tools/react-native-ble-transport.ts", {
  "react-native": { Platform: { OS: "android" } }, "../setup/device-permissions": { requestBluetoothPermissions: async () => {} },
  "./looi-discovery": load("src/device-tools/looi-discovery.ts"),
  "react-native-ble-plx": { BleManager: class {}, State: { PoweredOn: "PoweredOn" } },
  "@sourcebug/looi-sdk": sdk, "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
});
const transport = new transportModule.ReactNativeBleLooiTransport({ manager, deviceId: device.id });
await transport.connect();
const first = await transport.inspectHeadChannel();
assert.equal(writes, 0, "reading and subscribing must never write actuator commands");
assert.equal(first.read.hex, "87"); assert.equal(first.physicalPosition, "unknown", "echoed command is not an encoder position");
assert.equal(first.properties.readable, true);
listener(null, { value: Buffer.from([0x40]).toString("base64") });
const second = await transport.inspectHeadChannel();
assert.equal(monitors, 1, "repeated status calls do not replace notification subscriptions");
assert.ok(second.events.some((e) => e.source === "notification" && e.hex === "40"));
const normalRead = manager.readCharacteristicForDevice;
manager.readCharacteristicForDevice = async () => { throw new Error("read not permitted"); };
assert.equal((await transport.inspectHeadChannel()).read.status, "failed");
let cancelledRead = 0;
manager.cancelTransaction = async () => { cancelledRead++; };
manager.readCharacteristicForDevice = () => new Promise(() => {});
const timeoutRead = await transport.inspectHeadChannel();
assert.equal(timeoutRead.read.status, "failed"); assert.match(timeoutRead.read.error, /超时/); assert.equal(cancelledRead, 1);
manager.readCharacteristicForDevice = normalRead;
await transport.write("head", "ff", { response: false, expectedBytes: 1 });
const third = await transport.inspectHeadChannel();
assert.equal(writes, 1); assert.ok(third.events.some((e) => e.source === "write-returned" && e.hex === "ff"));
head.isWritableWithResponse = true;
disconnect(); await assert.rejects(transport.inspectHeadChannel(), /connect/i);
head = { ...head, isReadable: false, isNotifiable: false };
await transport.connect(); const readsBefore = reads;
const unsupported = await transport.inspectHeadChannel();
assert.equal(unsupported.read.status, "unsupported"); assert.equal(reads, readsBefore);
assert.equal(writes, 1, "unsupported read does not trigger a fallback write");
await transport.write("head", "ff", { response: true, expectedBytes: 1 });
assert.ok((await transport.inspectHeadChannel()).events.some((e) => e.source === "write-returned" && e.writeType === "with-response"));
await transport.disconnect();
infoCharacteristics = ["fed8", "2a27", "2a28"].map((key) => ({ uuid: uuid(key), isReadable: true }));
const readIds = [];
manager.readCharacteristicForDevice = async (_id, _service, id) => {
  readIds.push(id);
  return { value: Buffer.from(id === uuid("fed8") ? [73, 0] : [49, 46, 50]).toString("base64") };
};
await transport.connect();
const info = await transport.inspectHeadChannel();
assert.equal(info.deviceInfo.battery.hex, "4900"); assert.equal(info.deviceInfo.firmware.hex, "312e32");
assert.deepEqual(readIds, [uuid("fed8"), uuid("2a27"), uuid("2a28")], "device diagnostics only reads the allowlisted characteristics");
assert.equal(writes, 2, "device information never emits actuator writes");
console.log("Head observation: tilt/return/staleness, command expiry, read-only GATT and unknown physical position: PASS");
