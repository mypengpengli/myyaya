import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), module, module.exports);
  return module.exports;
}
const { ResultPresentation } = load("src/artifacts/presentation.ts");
let now = 0;
const view = new ResultPresentation(() => now);
const image = { id: "photo1", kind: "image", title: "照片", uri: "file:///photo.jpg" };
const video = { id: "video1", kind: "video", title: "录像", uri: "file:///video.mp4" };
view.offer(image); now = 99_000; view.tick(); assert.equal(view.getSnapshot().active.id, image.id, "loading never starts countdown");
view.loaded(image.id); assert.equal(view.getSnapshot().deadline, 109_000);
view.pin(); now += 100_000; view.tick(); assert.equal(view.getSnapshot().active.id, image.id);
view.offer(video); assert.equal(view.getSnapshot().queue.length, 1, "completion cannot steal a pinned result");
view.pin(); assert.equal(view.getSnapshot().deadline, now + 10_000);
now += 9999; view.interact(); assert.equal(view.getSnapshot().deadline, now + 10_000);
now += 10_000; view.tick(); assert.equal(view.getSnapshot().active.id, video.id);
view.loaded(video.id); assert.equal(view.getSnapshot().deadline, null, "video metadata is not playback completion");
now += 999_000; view.tick(); assert.equal(view.getSnapshot().active.id, video.id);
view.videoEnded(video.id); assert.equal(view.getSnapshot().deadline, now + 10_000);
view.videoResumedOrSeeking(video.id); assert.equal(view.getSnapshot().deadline, null, "replay/seek invalidates the previous completion timer");
view.videoEnded(video.id); view.loadingOrFailed(video.id); assert.equal(view.getSnapshot().deadline, null, "buffering/error cannot keep a stale timer");
view.videoEnded(video.id); view.suspend(true); now += 100_000; view.tick(); assert.equal(view.getSnapshot().active.id, video.id);
view.suspend(false); assert.equal(view.getSnapshot().deadline, now + 10_000);
now += 10_000; view.tick(); assert.equal(view.getSnapshot().active, null);
view.open(image); view.loaded("old-image"); assert.equal(view.getSnapshot().ready, false, "late previous media events cannot arm current countdown");

let pauses = 0, resumes = 0, releases = 0, saves = 0, videoStops = 0;
let lease = async () => () => { releases++; }, microphonePermission = true;
const offered = [];
const recording = load("src/artifacts/phone-recording.ts", {
  "react-native": { AppState: { currentState: "active" }, PermissionsAndroid: { PERMISSIONS: { CAMERA: "camera", RECORD_AUDIO: "mic" }, check: async (name) => name !== "mic" || microphonePermission } },
  "../voice/chinese-voice-runtime": { chineseVoice: { pauseCaptureForRecording: async () => { pauses++; return async () => { resumes++; }; } } },
  "../core/social-attention": { pauseSocialCamera: () => lease() },
  "./artifact-store": { saveVideoArtifact: async () => { saves++; return video; } },
  "./presentation": { resultPresentation: { offer: (item) => offered.push(item) } },
});
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
await recording.startPhoneRecording("back"); assert.equal(pauses, 1);
await assert.rejects(recording.startPhoneRecording("front"), /已有录像/);
let finishVideo;
const capture = recording.recordingCameraReady(recording.getPhoneRecording().id,
  () => new Promise((resolve) => { finishVideo = resolve; }), () => { videoStops++; finishVideo({ uri: "file:///cache/muted.mp4" }); });
await drain(); assert.equal(recording.getPhoneRecording().phase, "recording");
const a = recording.stopPhoneRecording(), b = recording.stopPhoneRecording();
assert.equal((await a).id, video.id); assert.equal((await b).id, video.id); await capture;
assert.equal(videoStops, 1); assert.equal(resumes, 1); assert.equal(saves, 1); assert.equal(releases, 1); assert.equal(offered.length, 1);
microphonePermission = false; await assert.rejects(recording.startPhoneRecording("back"), /麦克风权限/); microphonePermission = true;
let finishLease;
lease = () => new Promise((resolve) => { finishLease = resolve; });
const starting = recording.startPhoneRecording("front"); await drain();
const cancelling = recording.stopPhoneRecording(); await drain();
await assert.rejects(recording.startPhoneRecording("back"), /已有录像/, "cannot start another recording during cancellation");
finishLease(() => { releases++; }); await starting; await cancelling;
assert.equal(recording.getPhoneRecording().phase, "idle"); assert.equal(pauses, 1, "cancel before camera acquisition leaves recognition undisturbed");
console.log("Companion artifacts: load/end-based countdowns, pin/queue/replay/background safety and manual recording microphone ownership: PASS");
