import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
const { Type } = await import("typebox");
function load(path, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), module, module.exports);
  return module.exports;
}
const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const { PhotoCaptureSession } = load("src/artifacts/photo-capture-session.ts");
let captures = 0, saves = [], failSave = false;
const frame = (n) => ({ base64: `frame-${n}`, mimeType: "image/jpeg", cameraFacing: "front" });
const photo = new PhotoCaptureSession(async () => frame(++captures), async (image) => {
  if (failSave) throw Error("storage");
  saves.push(image.base64); return { id: "saved-" + saves.length, kind: "image" };
});
const accepted = photo.begin("front"); await drain();
assert.equal(photo.getSnapshot().phase, "review"); assert.equal(saves.length, 0);
photo.retake(); await drain(); assert.equal(photo.getSnapshot().photo.base64, "frame-2");
await photo.confirm();
assert.equal((await accepted).photo.base64, "frame-2");
assert.deepEqual(saves, ["frame-2"], "discarded retakes are never saved or returned to the model");
assert.equal(photo.getSnapshot().phase, "idle");
const aborted = new AbortController(), cancelled = photo.begin("back", aborted.signal);
aborted.abort(); assert.equal(await cancelled, null); await drain(); assert.equal(photo.getSnapshot().phase, "idle");
assert.equal(saves.length, 1);
failSave = true;
const retrySave = photo.begin("front"); await drain(); await photo.confirm();
assert.equal(photo.getSnapshot().phase, "review"); assert.match(photo.getSnapshot().notice, /保存失败/);
failSave = false; await photo.confirm(); assert.ok(await retrySave);
let finishCapture;
const late = new PhotoCaptureSession(() => new Promise((resolve) => { finishCapture = resolve; }), async () => { throw Error("must not save"); });
const stale = late.begin("front"); late.cancel(); finishCapture(frame(9)); await drain();
assert.equal(await stale, null); assert.equal(late.getSnapshot().phase, "idle");

const app = { currentState: "active" };
let permission = true, recording = "idle", runtimeCaptures = 0, runtimeSaves = 0;
const camera = load("src/artifacts/phone-camera.ts", {
  "react-native": { AppState: app, PermissionsAndroid: { PERMISSIONS: { CAMERA: "camera" }, check: async () => permission } },
  "../../modules/local-face-attention": { getLocalFaceAttentionModule: () => ({ captureStill: async (facing) => ({ ...frame(++runtimeCaptures), cameraFacing: facing }) }) },
  "./phone-recording": { getPhoneRecording: () => ({ phase: recording }) },
  "./artifact-store": { savePhotoArtifact: async () => ({ id: "observed-" + ++runtimeSaves, kind: "image" }) },
  "./photo-capture-session": { PhotoCaptureSession },
  "../core/ambient-motion": { holdAmbientMotionFor() {} }, "../core/social-attention": { holdSocialAttentionMotionFor() {} },
});
const observed = await camera.observeScene("front");
assert.equal(observed.artifact.id, "observed-1"); assert.equal(camera.photoCapture.getSnapshot().phase, "idle", "observation never opens photo review");
permission = false; await assert.rejects(camera.observeScene("front"), /相机权限/); permission = true;
recording = "recording"; await assert.rejects(camera.observeScene("front"), /正在录像/); recording = "idle";
app.currentState = "background"; await assert.rejects(camera.observeScene("front"), /前台/); app.currentState = "active";
assert.equal(runtimeCaptures, 1);
let homeNavigations = 0;
const cameraTools = load("src/agent/camera-tools.ts", { typebox: { Type }, "../artifacts/phone-camera": camera,
  "expo-router": { router: { navigate: () => homeNavigations++ } } });
const imageResult = await cameraTools.observeSceneTool.execute("look", {}, new AbortController().signal);
assert.equal(imageResult.content[1].type, "image");
assert.match(imageResult.content[0].text, /默认不要弹图/);
assert.equal(homeNavigations, 0, "observation must not change the current screen");
const draft = cameraTools.photoTool.execute("photo", {}, new AbortController().signal);
await drain(); assert.equal(camera.photoCapture.getSnapshot().phase, "review");
assert.equal(homeNavigations, 1, "explicit photo requests bring their confirmation UI into view");
const savedBeforeConfirm = runtimeSaves;
camera.photoCapture.retake(); await drain(); assert.equal(runtimeSaves, savedBeforeConfirm);
await camera.photoCapture.confirm();
assert.equal((await draft).content[1].type, "image");

// Real community SDK emits the existing two-byte FED0 frames through the tool/controller chain.
const { LooiRobot } = load("packages/looi-sdk/src/index.ts");
const frames = [];
const sdk = new LooiRobot({ write: async (key, payload) => frames.push([key, payload]) });
let connected = true, blocked = false, pendingDrive;
const hardware = {
  getLooiRobotRuntimeState: () => ({ connected, safety: { lastMotionBlockReason: blocked ? "test-cliff" : null } }),
  stopLooiMotion: async () => { await sdk.move("stop"); }, disconnectLooiRobot: async () => { connected = false; },
  moveLooi: async (direction, duration) => { assert.equal(duration, 450); if (blocked) throw Error("blocked"); await sdk.move(direction); if (pendingDrive) await pendingDrive; await sdk.move("stop"); return { completed: true }; },
  turnLooi: async (direction, degrees) => { assert.equal(degrees, 90); await sdk.move(direction); await sdk.move("stop"); return { completed: true }; },
  setLooiHead: async () => {}, setLooiLight: async () => {}, performLooiDance: async () => {}, performLooiHeadGesture: async () => {},
};
const holds = { holdAmbientMotionFor() {} }, social = { holdSocialAttentionMotionFor() {} };
const controller = load("src/device-tools/chinese-robot-control.ts", {
  "react-native": { AppState: app }, "../setup/setup-storage": { getAppMode: () => "local" },
  "../core/ambient-motion": holds, "../core/social-attention": social, "../core/robot-inactivity": { markRobotInteraction() {} }, "./looi-robot": hardware,
});
const tools = load("src/agent/robot-tools.ts", { typebox: { Type }, "react-native": { AppState: app },
  "../device-tools/chinese-robot-control": controller, "../device-tools/looi-robot": hardware,
  "../device-tools/looi-robot-autoconnect": { forceReconnectSavedLooiRobot: async () => ({ ok: connected, connected }) },
  "../core/ambient-motion": holds, "../core/social-attention": social,
});
await tools.robotActionTool.execute("move", { action: "forward" }, new AbortController().signal);
assert.deepEqual(frames.slice(-2), [["drive", "7707"], ["drive", "0000"]]);
await tools.robotActionTool.execute("move", { action: "left" }, new AbortController().signal);
assert.deepEqual(frames.slice(-2), [["drive", "047a"], ["drive", "0000"]]);
blocked = true; await assert.rejects(tools.robotActionTool.execute("move", { action: "forward" }), /传感器保护/); blocked = false;
app.currentState = "background"; await assert.rejects(tools.robotActionTool.execute("move", { action: "forward" }), /前台/); app.currentState = "active";
connected = false; await assert.rejects(tools.robotActionTool.execute("move", { action: "forward" }), /连接 LOOI/); connected = true;
let finishDrive; pendingDrive = new Promise((resolve) => { finishDrive = resolve; });
const abortMotion = new AbortController(), moving = tools.robotActionTool.execute("move", { action: "forward" }, abortMotion.signal);
await drain(); abortMotion.abort(); await drain(); assert.deepEqual(frames.at(-1), ["drive", "0000"]);
finishDrive(); await assert.rejects(moving, /停止/); pendingDrive = undefined;

// Real Pi validates action enums and replays the camera image as a model vision block.
const core = await import("@earendil-works/pi-agent-core");
const compat = Object.assign({}, ...await Promise.all(["transcript", "event-stream", "identity", "json-parse", "validation"].map((name) => import(`@earendil-works/pi-ai/utils/${name}`))));
const { CompanionAgent } = load("src/agent/companion-agent.ts", { "@earendil-works/pi-agent-core": core });
const { createNewApiStream } = load("src/agent/newapi-stream.ts", { "./pi-mobile-compat": compat });
async function roundTrip(tool, args, check, reply) {
  let requests = 0;
  const config = { baseUrl: "https://example.invalid/v1", apiKey: "test-only", model: "test" };
  const stream = createNewApiStream(config, async (_url, init) => {
    const messages = JSON.parse(init.body).messages;
    const delta = ++requests === 1 ? { tool_calls: [{ index: 0, id: "call", function: { name: tool.name, arguments: JSON.stringify(args) } }] } : { content: reply };
    if (requests === 2) check(messages);
    return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: requests === 1 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  });
  const agent = new CompanionAgent(config, stream, [tool], () => {});
  assert.equal(await agent.reply("执行用户要求", new AbortController().signal), reply); assert.equal(requests, 2);
}
await roundTrip(tools.robotActionTool, { action: "back" }, (messages) => assert.match(messages.at(-1).content, /指令执行结束/), "已经向后短移。");
assert.deepEqual(frames.slice(-2), [["drive", "86fc"], ["drive", "0000"]]);
await roundTrip(cameraTools.observeSceneTool, {}, (messages) => assert.match(messages.at(-1).content[0].image_url.url, /^data:image\/jpeg;base64,frame-/), "已根据眼前照片回答。");
console.log("Robot/camera tools: Pi to SDK drive frames, guards/STOP, observation vision replay, confirm/retake/cancel and stale capture/save isolation: PASS");
