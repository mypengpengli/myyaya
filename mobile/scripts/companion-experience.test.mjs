import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(file, mocks, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "module", "require", ...Object.keys(globals), code)(module.exports, module,
    (name) => { assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`); return mocks[name]; }, ...Object.values(globals));
  return module.exports;
}
const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

// Android 12+ uses Nearby Devices without requesting foreground/background GPS.
const permissionNames = Object.fromEntries(["BLUETOOTH_SCAN", "BLUETOOTH_CONNECT", "ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "RECORD_AUDIO", "CAMERA"].map((name) => [name, name]));
const granted = new Set();
const requests = [];
let leaseDepth = 0;
let deny = false;
const platform = { OS: "android", Version: 35 };
const permissions = load("src/setup/device-permissions.ts", {
  "react-native": { Platform: platform, Linking: {}, PermissionsAndroid: {
    PERMISSIONS: permissionNames, RESULTS: { GRANTED: "granted" },
    check: async (name) => granted.has(name),
    requestMultiple: async (names) => {
      assert.ok(leaseDepth > 0); requests.push(names);
      if (!deny) names.forEach((name) => granted.add(name));
      return Object.fromEntries(names.map((name) => [name, deny ? "denied" : "granted"]));
    },
    request: async (name) => { assert.ok(leaseDepth > 0); requests.push([name]); granted.add(name); return "granted"; },
  } },
  "../core/background-process-exit": { withExternalActivityLease: async (_reason, work) => {
    leaseDepth++; try { return await work(); } finally { leaseDepth--; }
  } },
});
assert.deepEqual(permissions.bluetoothPermissions(31), ["BLUETOOTH_SCAN", "BLUETOOTH_CONNECT"]);
assert.deepEqual(permissions.bluetoothPermissions(30), ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"]);
await permissions.readDevicePermissions();
assert.equal(requests.length, 0, "checking readiness must not prompt");
deny = true;
await assert.rejects(permissions.requestBluetoothPermissions(), /附近设备/);
deny = false; requests.length = 0;
assert.deepEqual(await permissions.requestDevicePermissions(), { bluetooth: true, microphone: true, camera: true });
assert.deepEqual(requests, [["BLUETOOTH_SCAN", "BLUETOOTH_CONNECT"], ["RECORD_AUDIO"], ["CAMERA"]]);
requests.length = 0; await permissions.requestDevicePermissions();
assert.equal(requests.length, 0, "already granted capabilities must not repeat dialogs");
assert.equal(leaseDepth, 0);

// Reapply the real config plugin to a previously generated manifest with old permissions.
const plugin = { exports: {} };
new Function("require", "module", readFileSync("plugins/with-companion-permissions.js", "utf8"))(
  () => ({ withAndroidManifest: (config, apply) => apply(config) }), plugin);
const manifest = { "uses-permission": [{ $: { "android:name": "android.permission.BLUETOOTH_SCAN" } }] };
const mod = { modResults: { manifest } };
plugin.exports(mod); plugin.exports(mod);
const entries = manifest["uses-permission"];
assert.equal(entries.filter((item) => item.$["android:name"] === "android.permission.BLUETOOTH_SCAN").length, 1);
assert.equal(entries.find((item) => item.$["android:name"].endsWith("BLUETOOTH_SCAN")).$["android:usesPermissionFlags"], "neverForLocation");
assert.equal(entries.find((item) => item.$["android:name"].endsWith("ACCESS_FINE_LOCATION")).$["android:maxSdkVersion"], "30");

// Cached name, scan response name and short service UUIDs are all recognized.
const discovery = load("src/device-tools/looi-discovery.ts", {});
assert.ok(discovery.isLooiAdvertisement({ name: "", localName: "LOOI-123" }));
assert.ok(discovery.isLooiAdvertisement({ name: "stale", localName: "looi robot" }));
assert.ok(discovery.isLooiAdvertisement({ serviceUUIDs: ["00FF"] }));
assert.equal(discovery.isLooiAdvertisement({ name: "Headphones", serviceUUIDs: ["180f"] }), false);
assert.equal(discovery.looiAdvertisementName({ name: "stale", localName: "LOOI Robot" }), "LOOI Robot");

// Run actual scanning: incremental candidates arrive before timeout; abort
// waits for stop/destroy, and a powered-off adapter produces an actionable error.
let scanCallback;
let adapterState = "PoweredOn";
let stopped = 0, destroyed = 0, scans = 0;
const manager = {
  state: async () => adapterState,
  startDeviceScan: async (_filters, options, callback) => { scans++; assert.equal(options.allowDuplicates, true); scanCallback = callback; },
  stopDeviceScan: async () => { stopped++; }, destroy: async () => { destroyed++; },
};
const transport = load("src/device-tools/react-native-ble-transport.ts", {
  "react-native": { Platform: platform },
  "react-native-ble-plx": { BleManager: class { constructor() { return manager; } }, ScanMode: { LowLatency: 2 },
    State: { PoweredOn: "PoweredOn", PoweredOff: "PoweredOff", Unauthorized: "Unauthorized", Unsupported: "Unsupported" } },
  "@sourcebug/looi-sdk": {}, "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../setup/device-permissions": { requestBluetoothPermissions: permissions.requestBluetoothPermissions },
  "./looi-discovery": discovery,
});
const controller = new AbortController();
const updates = [];
const scanning = transport.scanLooiRobotCandidates({ signal: controller.signal, onCandidates: (items) => updates.push(items) });
await drain(); assert.equal(scans, 1);
scanCallback(null, { id: "test", name: "", localName: "LOOI", rssi: -40 });
assert.equal(updates[0][0].name, "LOOI");
controller.abort(); assert.deepEqual(await scanning, []);
assert.equal(stopped, 1); assert.equal(destroyed, 1);
scanCallback(null, { id: "late", localName: "LOOI" });
assert.equal(updates.length, 1, "cancelled scans cannot publish late candidates");
adapterState = "PoweredOff";
await assert.rejects(transport.scanLooiRobotCandidates(), /蓝牙未开启/);
assert.equal(scans, 1); assert.equal(destroyed, 2);

// Auto wake is a foreground lifecycle policy, not an extra microphone dialog.
const timers = new Map(); let timerId = 0;
const schedule = (fn) => { timers.set(++timerId, fn); return timerId; };
const flush = async () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); await drain(); };
let appListener, userListener, preferenceListener;
let microphone = false, completed = false, wakeEnabled = true;
let starts = 0, stops = 0;
let resolveCheck;
let check = async () => microphone;
const user = { robotSleeping: false, voiceState: "idle", setVoiceState(next) { this.voiceState = next; } };
const app = { currentState: "active", addEventListener: (_name, fn) => { appListener = fn; return { remove() {} }; } };
class FakeSession {
  phase = "off";
  getSnapshot = () => ({ phase: this.phase });
  subscribe = () => () => {};
  async start() { starts++; this.phase = "listening"; }
  async stop() { stops++; this.phase = "off"; }
}
const runtime = load("src/voice/chinese-voice-runtime.ts", {
  "react-native": { AppState: app, Platform: platform, PermissionsAndroid: { PERMISSIONS: permissionNames, check: () => check() } },
  "../../modules/vosk-command-recognizer": {}, "../device-tools/chinese-robot-control": { executeChineseRobotCommand() {} },
  "../setup/setup-storage": { getAppMode: () => "local", hasCompletedRobotOnboarding: () => completed },
  "../store/user": { useUserStore: { getState: () => user, subscribe: (fn) => { userListener = fn; return () => {}; } } },
  "./chinese-voice-session": { ChineseVoiceSession: FakeSession }, "../device-tools/looi-robot": { stopLooiMotion() {} },
  "./chinese-voice-preferences": { isChineseWakeEnabled: () => wakeEnabled, subscribeChineseWake: (fn) => { preferenceListener = fn; return () => {}; } },
}, { setTimeout: schedule, clearTimeout: (id) => timers.delete(id) });
let release = runtime.focusChineseVoiceScreen({ autoStart: true });
await flush(); assert.equal(starts, 0, "no permission means no auto prompt/capture");
microphone = true; appListener("active"); await flush();
assert.equal(starts, 0, "guide must finish before auto capture");
completed = true; appListener("active"); await flush(); assert.equal(starts, 1);
app.currentState = "background"; appListener("background"); await drain();
assert.equal(runtime.chineseVoice.phase, "off");
app.currentState = "active"; appListener("active"); await flush(); assert.equal(starts, 2);
wakeEnabled = false; preferenceListener(); await drain();
appListener("active"); await flush(); assert.equal(starts, 2);
wakeEnabled = true; preferenceListener(); await flush(); assert.equal(starts, 3);
user.robotSleeping = true; userListener(user); await drain();
appListener("active"); await flush(); assert.equal(starts, 3);
user.robotSleeping = false; userListener(user); await flush(); assert.equal(starts, 4);
release(); await drain();
check = () => new Promise((resolve) => { resolveCheck = resolve; });
release = runtime.focusChineseVoiceScreen({ autoStart: true });
const pending = flush(); await drain(); assert.ok(resolveCheck);
release(); resolveCheck(true); await pending;
assert.equal(starts, 4, "an old permission-check completion cannot capture after navigation");
assert.ok(stops >= 4);
console.log("Companion setup permissions, Android manifest, incremental BLE discovery/cancellation and automatic wake lifecycle: PASS");
