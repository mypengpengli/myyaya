import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadTs(file, mocks) {
  const filename = path.resolve(file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const mockedRequire = (name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name} in ${file}`);
    return mocks[name];
  };
  new Function("exports", "require", "module", code)(module.exports, mockedRequire, module);
  return module.exports;
}

const values = new Map();
let integrationBuild = false;
const storage = loadTs("src/setup/setup-storage.ts", {
  "./build-profile": { isHermesIntegrationBuild: () => integrationBuild },
  "react-native-mmkv": { createMMKV: () => ({
    getString: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    remove: (key) => values.delete(key),
  }) },
});
assert.equal(storage.getAppMode(), "local", "fresh installs must not enable old cloud voice");
values.set("looi.setup.v1", JSON.stringify({ version: 2, onboardingCompleted: true, skipped: { robot: true } }));
assert.equal(storage.getAppMode(), "local", "old completed setup must migrate to local without enabling cloud voice");
assert.equal(storage.getSetupStorageState().onboardingCompleted, true);
assert.equal(storage.getSetupStorageState().skipped.robot, true);
assert.equal(JSON.parse(values.get("looi.setup.v1")).version, 3);
values.set("looi.setup.v1", "corrupt");
assert.equal(storage.getAppMode(), "local");
assert.throws(() => storage.setAppMode("pi"), /Unsupported app mode/, "unimplemented Pi must not appear as a functioning runtime");
let notifications = 0;
const unsubscribe = storage.subscribeAppMode(() => { notifications += 1; });
storage.setAppMode("legacy_realtime");
storage.setAppMode("legacy_realtime");
assert.equal(notifications, 1);
storage.setAppMode("local");
unsubscribe();
integrationBuild = true;
values.set("looi.setup.v1", JSON.stringify({ version: 3, appMode: "legacy_realtime" }));
assert.equal(storage.getAppMode(), "local", "integration APK must not start legacy voice without its offline models");
assert.equal(storage.getSetupStorageState().appMode, "local", "readiness must see the effective build mode too");
assert.throws(() => storage.setAppMode("legacy_realtime"), /unavailable/);
integrationBuild = false;
storage.setAppMode("local");

let hasKey = false;
let hasModels = false;
let hasMic = false;
let cloudChecks = 0;
let modelChecks = 0;
let micChecks = 0;
const readiness = loadTs("src/setup/setup-readiness.ts", {
  "./setup-storage": storage,
  "@/src/device-tools/looi-robot": { getLooiRobotRuntimeState: () => ({ connected: false }) },
  "@/src/device-tools/looi-robot-autoconnect": { getSavedLooiRobot: async () => null },
  "@/src/openai/openai-api-key": { hasOpenAiApiKey: async () => { cloudChecks += 1; return hasKey; } },
  "@/src/voice/sherpa-models": { checkAllSherpaModelReadiness: async () => {
    modelChecks += 1;
    return Object.fromEntries(["asr", "kws", "speaker", "vad"].map((name) => [name, { ready: hasModels }]));
  } },
  "expo-audio": { getRecordingPermissionsAsync: async () => { micChecks += 1; return { granted: hasMic }; } },
});
let state = await readiness.computeSetupReadiness();
assert.equal(state.requiredReady, true, "offline local UI must open without any legacy prerequisites");
assert.equal(state.legacyVoiceReady, false, "local UI readiness is not permission to capture audio");
assert.equal(state.nextStep, "done");
assert.deepEqual([cloudChecks, modelChecks, micChecks], [0, 0, 0], "local setup must not inspect keys/models/audio permissions");
assert.equal(await readiness.isLegacyVoiceReady(), false);

storage.setAppMode("legacy_realtime");
for (const [key, models, mic, next] of [
  [false, false, false, "openai"], [true, false, true, "models"],
  [true, true, false, "permissions"], [true, true, true, "done"],
]) {
  [hasKey, hasModels, hasMic] = [key, models, mic];
  state = await readiness.computeSetupReadiness();
  assert.equal(state.nextStep, next);
  assert.equal(state.requiredReady, key && models && mic);
  assert.equal(state.legacyVoiceReady, key && models && mic);
}

let moduleLoads = 0;
const calls = [];
let nativeVoiceActive = false;
let observationHandler = null;
const observations = [];
const perceiver = Object.fromEntries([
  "start", "stop", "trigger", "interruptAndListen", "syncConversationMode", "syncWakewordRuntime",
  "rearmWakewordAfterNavigation", "resumeRealtimeConversationFromMain", "finishListening",
].map((method) => [method, async () => { calls.push(method); }]));
perceiver.start = async () => { nativeVoiceActive = true; calls.push("start"); };
perceiver.stop = async () => { nativeVoiceActive = false; calls.push("stop"); };
perceiver.onObservation = (handler) => {
  observationHandler = handler;
  return () => { if (observationHandler === handler) observationHandler = null; };
};
perceiver.prepareIdleCharacterReaction = async () => ({ ok: true, reason: "idle" });
const userState = { robotSleeping: false, voiceState: "sleeping", preferences: { wakeWordEnabled: true, conversationMode: "realtime_pcm", language: "en", listeningLanguage: "en" }, setVoiceState(value) { this.voiceState = value; } };
let loadBarrier = null;
let onLoad = null;
const runtimeExports = loadTs("src/perceivers/voice-runtime.ts", {
  "../core/perceiver": { BasePerceiver: class { isActive = false; emit(value) { observations.push(value); } } },
  "../core/runtime-profile": { getRuntimeProfile: () => ({ allowsWakewordAutostart: true }) },
  "../store/user": { useUserStore: { getState: () => userState }, isRealtimeConversationMode: () => true },
  "../voice/lazy-services": { getVoiceModule: async () => {
    moduleLoads += 1;
    onLoad?.();
    if (loadBarrier) await loadBarrier;
    return { voicePerceiver: perceiver };
  } },
  "../setup/setup-readiness": readiness,
  "../setup/setup-storage": storage,
  "../voice/realtime-conversation": { realtimeConversationService: { isActive: false } },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../store/conversation": { useConversationStore: { getState: () => ({}) } },
});
const runtime = runtimeExports.voiceRuntime;
storage.setAppMode("local");
async function exerciseEntryPoints() {
  await runtime.start(); await runtime.sync(); await runtime.trigger(); await runtime.interruptAndListen();
  await runtime.rearmWakewordAfterNavigation();
  await runtime.resumeMainScreenConversation("navigation-return");
  await runtime.resumeMainScreenConversation("foreground-resume");
  assert.equal(await runtime.applyLiveRealtimePreferences("test"), false);
  assert.equal((await runtime.prepareIdleCharacterReaction()).ok, true);
}
await exerciseEntryPoints();
assert.equal(moduleLoads, 0, "local boot, taps, navigation and foreground must never load old voice");
storage.setAppMode("legacy_realtime");
hasKey = false;
await runtime.start(); await runtime.trigger();
assert.equal(moduleLoads, 0, "selecting legacy without completing setup must not start capture");
hasKey = true;
await runtime.start(); await runtime.trigger();
assert.ok(calls.includes("start") && calls.includes("trigger"), "configured, explicitly selected legacy voice remains available");
storage.setAppMode("local");
await runtime.stop();
assert.ok(calls.includes("stop"), "switching back must release an already loaded legacy runtime");
const startsBefore = calls.filter((method) => method === "start").length;
await exerciseEntryPoints();
assert.equal(calls.filter((method) => method === "start").length, startsBefore);

// A mode switch while lazy loading must not apply a stale asynchronous start.
storage.setAppMode("legacy_realtime");
const racingRuntime = new runtimeExports.VoiceRuntime();
let releaseLoad;
loadBarrier = new Promise((resolve) => { releaseLoad = resolve; });
const enteredLoad = new Promise((resolve) => { onLoad = resolve; });
const pendingStart = racingRuntime.start();
await enteredLoad;
storage.setAppMode("local");
releaseLoad();
await pendingStart;
assert.equal(calls.filter((method) => method === "start").length, startsBefore, "stale lazy-load completion must not start voice in local mode");
loadBarrier = null; onLoad = null;

// Reviewer reproduction: stop during cold loading, without changing legacy
// mode (Android background/sleep). The old start must never follow the stop.
storage.setAppMode("legacy_realtime");
const stoppedDuringLoad = new runtimeExports.VoiceRuntime();
loadBarrier = new Promise((resolve) => { releaseLoad = resolve; });
const enteredColdLoad = new Promise((resolve) => { onLoad = resolve; });
const callsBeforeColdLoad = calls.length;
const coldStart = stoppedDuringLoad.start();
await enteredColdLoad;
const coldStop = stoppedDuringLoad.stop();
releaseLoad();
await Promise.all([coldStart, coldStop]);
assert.equal(stoppedDuringLoad.isActive, false);
assert.equal(nativeVoiceActive, false);
assert.equal(calls.slice(callsBeforeColdLoad).includes("start"), false, "background stop must invalidate cold startup even while mode stays legacy");
loadBarrier = null; onLoad = null;

// A slow old stop must finish before a new session can start after a quick
// local -> legacy switch. Its completion cannot turn the new session off.
await runtime.start();
const staleObservationHandler = observationHandler;
const fastSwitchLog = [];
let releaseStop;
let signalStop;
const stopEntered = new Promise((resolve) => { signalStop = resolve; });
const stopBarrier = new Promise((resolve) => { releaseStop = resolve; });
perceiver.stop = async () => {
  fastSwitchLog.push("stop:begin"); signalStop();
  await stopBarrier;
  nativeVoiceActive = false; fastSwitchLog.push("stop:end");
};
perceiver.start = async () => { nativeVoiceActive = true; fastSwitchLog.push("start"); calls.push("start"); };
storage.setAppMode("local");
await stopEntered;
const observationCount = observations.length;
staleObservationHandler?.({ type: "obsolete" });
assert.equal(observations.length, observationCount, "old observations must be suppressed immediately when stop is requested");
storage.setAppMode("legacy_realtime");
const restarted = runtime.start();
releaseStop();
await restarted;
assert.deepEqual(fastSwitchLog, ["stop:begin", "stop:end", "start"]);
assert.equal(runtime.isActive, true);
assert.equal(nativeVoiceActive, true);
perceiver.stop = async () => { nativeVoiceActive = false; calls.push("stop"); };
storage.setAppMode("local");
await runtime.stop();

// Stop must preempt interactions that can only settle when their native
// cancellation runs. It cannot sit behind the promise it needs to cancel.
storage.setAppMode("legacy_realtime");
for (const [entry, underlying] of [
  [() => runtime.trigger(), "trigger"],
  [() => runtime.resumeMainScreenConversation("foreground-resume"), "resumeRealtimeConversationFromMain"],
  [() => runtime.interruptAndListen(), "interruptAndListen"],
]) {
  await runtime.start();
  let entered;
  let release;
  const enteredInteraction = new Promise((resolve) => { entered = resolve; });
  const interactionBarrier = new Promise((resolve) => { release = resolve; });
  const originalInteraction = perceiver[underlying];
  perceiver[underlying] = async () => { entered(); await interactionBarrier; };
  let cancelled = false;
  perceiver.stop = async () => { nativeVoiceActive = false; cancelled = true; release(); };
  const interaction = entry();
  await enteredInteraction;
  const stopping = runtime.stop();
  let timer;
  const promptStop = await Promise.race([
    stopping.then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), 100); }),
  ]);
  clearTimeout(timer);
  assert.equal(promptStop, true, `${underlying}: native stop must not wait for the interaction to finish`);
  await interaction;
  assert.equal(cancelled, true);
  assert.equal(runtime.isActive, false);
  assert.equal(nativeVoiceActive, false);
  perceiver[underlying] = originalInteraction;
}
perceiver.stop = async () => { nativeVoiceActive = false; calls.push("stop"); };
storage.setAppMode("local");
await runtime.stop();

// The low-level recorder also blocks old Realtime teardown callbacks that try
// to rearm the classic microphone after switching back to local mode.
let nativeStarts = 0;
let releasePrepare;
let prepareEntered;
let prepareBarrier = null;
const { KwsAudioFeeder } = loadTs("src/voice/kws-audio-feeder.ts", {
  "../setup/setup-storage": storage,
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../device-tools/looi-robot": { getLooiRobotRuntimeState: () => ({ motionActive: false }) },
  "./driving-control-session": { isDrivingControlSessionActive: () => false },
  "@siteed/audio-studio": { AudioStudioModule: {
    getPermissionsAsync: async () => ({ granted: true }),
    addListener: () => ({ remove() {} }),
    prepareRecording: async () => { prepareEntered?.(); if (prepareBarrier) await prepareBarrier; },
    startRecording: async () => { nativeStarts += 1; }, stopRecording: async () => {},
  } },
});
const feeder = new KwsAudioFeeder();
await feeder.start();
assert.equal(nativeStarts, 0);
storage.setAppMode("legacy_realtime");
prepareBarrier = new Promise((resolve) => { releasePrepare = resolve; });
const enteredPrepare = new Promise((resolve) => { prepareEntered = resolve; });
const pendingCapture = feeder.start();
await enteredPrepare;
storage.setAppMode("local");
releasePrepare();
await pendingCapture;
assert.equal(nativeStarts, 0, "a recorder prepared in legacy mode must not start after switching to local");
assert.equal(feeder.isRunning, false);

// Boot and Android foreground restoration must keep the local UI alive while
// never scheduling STT prewarming or starting a legacy voice perceiver.
let perceiverStarts = 0;
let sttPrewarms = 0;
const localFeeder = { isRunning: false, setAppCaptureAllowed() {}, stop: async () => {}, diagnosticStatus: {} };
const bootstrap = loadTs("src/core/app-bootstrap.ts", {
  "./perceiver-manager": { perceiverManager: { register() {}, getRegisteredNames: () => ["voice"], start: async () => { perceiverStarts += 1; }, stopAll: () => runtime.stop() } },
  "../perceivers/voice-runtime": { voiceRuntime: runtime },
  "../store/user": { useUserStore: { getState: () => userState }, isRealtimeConversationMode: () => true },
  "../store/conversation": { useConversationStore: { getState: () => ({}) } },
  "./runtime-profile": { getRuntimeProfile: () => ({ allowsWakewordAutostart: true }) },
  "../voice/lazy-services": { getLoadedSttModule: () => null, getLoadedTtsModule: () => null },
  "../diagnostics/diagnostic-log": { recordDiagnosticEvent() {} },
  "../diagnostics/performance-monitor": { recordPerformanceSnapshot: async () => {} },
  "expo-audio": { setIsAudioActiveAsync: async () => {} },
  "./main-screen-presence": { isMainScreenFocused: () => true },
  "../device-tools/looi-robot-autoconnect": { resumeLooiRobotAutoConnection: async () => {}, suspendLooiRobotAutoConnection: async () => {} },
  "../voice/retired-experimental-voice-assets": { removeRetiredExperimentalVoiceAssets: async () => {} },
  "./legacy-network-credentials-retirement": { retireLegacyNetworkCredentials: async () => {} },
  "./ambient-motion": { startAmbientMotionController() {}, stopAmbientMotionController() {} },
  "./social-attention": { startSocialAttentionController() {}, stopSocialAttentionController: async () => {} },
  "../setup/setup-readiness": readiness, "../setup/setup-storage": storage,
  "../voice/kws-audio-feeder": { kwsAudioFeeder: localFeeder },
  "../voice/stt": { sttService: { initialize: async () => { sttPrewarms += 1; } } },
});
await bootstrap.bootstrapApp();
await bootstrap.pauseAppRuntime();
await bootstrap.resumeAppRuntime();
await bootstrap.syncVoiceRuntime();
assert.equal(perceiverStarts, 0, "bootstrap and Android resume must not activate old voice in local mode");
assert.equal(sttPrewarms, 0);

// The production onboarding request controller must reject out-of-order
// results and stale finally blocks, including switches back to the same mode.
const { createReadinessRefresher } = loadTs("src/setup/readiness-refresh.ts", {});
let setupMode = "legacy_realtime";
let renderedReadiness = null;
let loadingReadiness = false;
const setupRequests = [];
const refresher = createReadinessRefresher({
  getMode: () => setupMode,
  compute: () => new Promise((resolve, reject) => { setupRequests.push({ resolve, reject }); }),
  commit: (result) => { renderedReadiness = result; },
  setLoading: (loading) => { loadingReadiness = loading; },
});
const obsoleteLegacy = refresher.refresh();
setupMode = "local"; refresher.invalidate();
const localRefresh = refresher.refresh();
setupRequests[1].resolve({ appMode: "local", requiredReady: true, nextStep: "done" });
await localRefresh;
setupRequests[0].resolve({ appMode: "legacy_realtime", requiredReady: false, nextStep: "openai" });
assert.equal(await obsoleteLegacy, null);
assert.equal(renderedReadiness.appMode, "local");
assert.equal(renderedReadiness.requiredReady, true);
assert.equal(loadingReadiness, false, "late legacy result cannot disable the local enter button");
const olderLocal = refresher.refresh();
const newerLocal = refresher.refresh();
setupRequests[2].resolve({ appMode: "local", requiredReady: false });
await olderLocal;
assert.equal(loadingReadiness, true, "old finally must not clear the latest request's loading indicator");
assert.equal(renderedReadiness.requiredReady, true);
setupRequests[3].resolve({ appMode: "local", requiredReady: true });
await newerLocal;
assert.equal(loadingReadiness, false);
const unmounted = refresher.refresh();
refresher.invalidate();
setupRequests[4].resolve({ appMode: "local", requiredReady: false });
assert.equal(await unmounted, null);
assert.equal(renderedReadiness.requiredReady, true, "unmounted setup must not commit stale state");

// Execute the real Home component with a small JSX/hook harness. A retained
// legacy billing error must not mount either old overlay while in local mode.
const homeSource = fs.readFileSync("app/(tabs)/index.tsx", "utf8");
const homeMocks = Object.fromEntries([...homeSource.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => [match[1], {}]));
let screenMode = "local";
const conversationOverlay = () => {};
const imageOverlay = () => {};
const retainedConversation = { messages: [{ role: "user", content: "keep history" }], realtimeIssue: { kind: "no_credits" } };
Object.assign(homeMocks, {
  "react": { useCallback: (fn) => fn, useEffect() {}, useRef: (value) => ({ current: value }), useState: (value) => [typeof value === "function" ? value() : value, () => {}] },
  "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  "react-native": { StyleSheet: { create: (styles) => styles }, View: "View", Text: "Text", Pressable: "Pressable" },
  "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
  "expo-router": { useRouter: () => ({}), useFocusEffect() {} },
  "@/src/setup/use-app-mode": { useAppMode: () => screenMode },
  "@/src/ui/ConversationOverlay": { ConversationOverlay: conversationOverlay },
  "@/src/ui/ImageOverlay": { ImageOverlay: imageOverlay },
  "@/src/ui/looi-theme": { looiTheme: {} },
  "@/src/device-tools/looi-robot": { getLooiRobotRuntimeState: () => ({}) },
  "@/src/store/user": { useUserStore: Object.assign((select) => select(userState), { getState: () => userState }) },
  "@/src/store/conversation": { useConversationStore: { getState: () => retainedConversation } },
  "@/src/i18n/use-ui-text": { useUiText: () => ({ t: (key) => key }) },
  "@/src/language/response-language": { RESPONSE_LANGUAGE_OPTIONS: [] },
  "@/src/language/listening-language": { LISTENING_LANGUAGE_OPTIONS: [] },
});
const Home = loadTs("app/(tabs)/index.tsx", homeMocks).default;
const countType = (node, type) => !node ? 0 : Array.isArray(node)
  ? node.reduce((count, child) => count + countType(child, type), 0)
  : typeof node === "object" ? Number(node.type === type) + countType(node.props?.children, type) : 0;
assert.equal(countType(Home(), conversationOverlay), 0);
assert.equal(countType(Home(), imageOverlay), 0);
screenMode = "legacy_realtime";
assert.equal(countType(Home(), conversationOverlay), 1, "legacy overlay remains available only in its selected mode");
assert.equal(retainedConversation.messages[0].content, "keep history", "mode changes must not delete conversation history");

// Exercise the real WebRTC and PCM startup implementations, not a facade stub:
// an old client-secret success OR rejection must not mutate/stop a new session.
for (const [file, className] of [
  ["src/voice/realtime-conversation.ts", "RealtimeConversationService"],
  ["src/voice/realtime-pcm-conversation.ts", "RealtimePcmConversationService"],
]) {
  for (const oldResult of ["success", "failure"]) {
    const events = [];
    const secretRequests = [];
    const storeWrites = [];
    let nativeAcquisitions = 0;
    let wakeQuiesce = 0;
    const store = new Proxy({ realtimeIssue: null }, {
      get: (target, key) => key in target ? target[key] : (...args) => { storeWrites.push([key, args]); },
    });
    const source = fs.readFileSync(file, "utf8");
    const mocks = Object.fromEntries([...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => [match[1], {}]));
    Object.assign(mocks, {
      "react-native": { AppState: { currentState: "active" }, Platform: { OS: "android" } },
      "expo-audio": { setIsAudioActiveAsync: async () => {} },
      "react-native-webrtc": { RTCPeerConnection: class { constructor() { nativeAcquisitions += 1; throw Error("stale native acquisition"); } } },
      "../store/user": { useUserStore: { getState: () => userState }, isPcmRealtimeMode: () => false },
      "../store/conversation": { useConversationStore: { getState: () => store } },
      "../diagnostics/diagnostic-log": { recordDiagnosticEvent: (_category, event) => { events.push(event); } },
      "../memory/memory-service": { mirrorSessionTouch() {}, retrieveConversationMemories: async () => ({ facts: [], strategy: "test" }) },
      "../openai/openai-api-key": {
        createOpenAiRealtimeClientSecret: () => new Promise((resolve, reject) => { secretRequests.push({ resolve, reject }); }),
        createOpenAiRealtimeEphemeralWebSocket: () => { nativeAcquisitions += 1; throw Error("stale WebSocket acquisition"); },
      },
      "../openai/openai-api-status": { classifyOpenAiError: () => "invalid_key", setOpenAiApiStatus: async () => {} },
      "./realtime-config": { REALTIME_MODEL: "test", buildRealtimeSessionUpdate: () => ({ session: {} }) },
      "./kws-audio-feeder": { kwsAudioFeeder: {
        diagnosticStatus: { appCaptureAllowed: true }, isRunning: false,
        setAppCaptureAllowed() {}, setWakewordFeedingEnabled() {},
        start: async () => {}, stop: async () => {}, getRecentSamples: () => [],
      } },
      "./wakeword": { wakewordService: { start: async () => {}, stop: async () => { wakeQuiesce += 1; }, waitForFallbackIdle: async () => {} } },
      "../../modules/realtime-audio-route": { getRealtimeAudioRouteStatus: async () => ({ supported: false }), deactivateRealtimeSpeakerRoute: async () => ({}) },
      "../../modules/local-realtime-audio-capture/realtime-pcm": { getRealtimePcmAudioModule: () => ({ stopPlayback() {}, stopCapture: async () => ({}) }) },
    });
    const Service = loadTs(file, mocks)[className];
    const service = new Service();
    service.startStartupPrerollCapture = () => {};
    service.recordAndroidAudioDiagnosticSnapshot = async () => {};
    const waitForSecrets = async (count) => {
      for (let attempt = 0; attempt < 30 && secretRequests.length < count; attempt += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.equal(secretRequests.length, count);
    };
    if (className === "RealtimeConversationService") {
      let releaseRoute;
      service.speakerRouteRestorePromise = new Promise((resolve) => { releaseRoute = resolve; });
      const waitingForOldRoute = service.start();
      await service.stop("cancel-during-route-restore");
      releaseRoute();
      await waitingForOldRoute;
      assert.equal(service.isActive, false, "stop must invalidate startup waiting for an old audio route restore");
      assert.equal(secretRequests.length, 0);
      assert.equal(storeWrites.length, 0);
      service.speakerRouteRestorePromise = null;
    }
    const oldStart = service.start();
    await waitForSecrets(1);
    await service.stop("old-session-cancelled");
    const newStart = service.start();
    await waitForSecrets(2);
    const currentWrites = storeWrites.length;
    const currentStops = events.filter((event) => event === "session-stopped" || event === "pcm-session-stopped").length;
    if (oldResult === "success") secretRequests[0].resolve({ value: "obsolete", expiresAt: 0 });
    else secretRequests[0].reject(Error("obsolete authentication failed"));
    await oldStart;
    assert.equal(service.isActive, true, `${className}: old ${oldResult} cannot stop the new pending session`);
    assert.equal(nativeAcquisitions, 0);
    assert.equal(wakeQuiesce, 0, "obsolete startup must not stop the new session's microphone path");
    assert.equal(storeWrites.length, currentWrites, "obsolete startup must not write new-session UI state");
    assert.equal(events.filter((event) => event === "session-stopped" || event === "pcm-session-stopped").length, currentStops);
    await service.stop("test-cleanup");
    secretRequests[1].resolve({ value: "also-cancelled", expiresAt: 0 });
    await newStart;
  }
}

console.log("Local setup, lifecycle ordering, stale readiness and legacy overlay isolation: PASS");
