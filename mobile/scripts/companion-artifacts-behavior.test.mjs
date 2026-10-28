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

// Voice tools must set an explicit state; a retry cannot undo an earlier pin.
const { Type } = await import("typebox");
const viewerApp = { currentState: "active" };
const { VideoControl } = load("src/artifacts/video-control.ts");
const videoControl = new VideoControl();
const { DocumentControl } = load("src/artifacts/document-control.ts");
const documentControl = new DocumentControl();
const { viewerControlTool } = load("src/agent/viewer-tools.ts", {
  typebox: { Type }, "react-native": { AppState: viewerApp }, "../artifacts/presentation": { resultPresentation: view },
  "../artifacts/video-control": { videoControl },
  "../artifacts/document-control": { documentControl },
});
const control = (action, id, signal) => viewerControlTool.execute("viewer", { action, ...(id ? { id } : {}) }, signal);
view.loaded(image.id);
await control("pin", image.id); await control("pin", image.id);
assert.equal(view.getSnapshot().pinned, true); assert.equal(view.getSnapshot().deadline, null);
view.offer(video);
await assert.rejects(control("close", video.id), /当前未展示/);
assert.equal(view.getSnapshot().active.id, image.id, "stale target cannot close another active image");
await control("unpin"); const onceUnpinned = view.getSnapshot().deadline;
now += 9000; await control("unpin");
assert.equal(view.getSnapshot().deadline, onceUnpinned, "retry cannot extend an existing timer");
viewerApp.currentState = "background"; await assert.rejects(control("close"), /前台/); viewerApp.currentState = "active";
const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(control("close", undefined, cancelled.signal), /取消/);
await control("close");
assert.equal(view.getSnapshot().active, null, "explicit close restores the face even when another result is queued");
assert.equal(view.getSnapshot().queue[0].id, video.id, "close does not discard queued results or stored artifacts");
assert.match((await control("pin")).content[0].text, /没有展示/);
assert.equal(view.getSnapshot().pinned, false, "cannot pin an empty viewer");
view.open(image); assert.equal(view.getSnapshot().active.uri, image.uri, "a closed artifact can be opened again");

view.open(video);
const player = { playing: false, currentTime: 0, duration: 42, status: "readyToPlay", play() { this.playing = true; }, pause() { this.playing = false; } };
const releaseOld = videoControl.bind("old-video", player), releaseVideo = videoControl.bind(video.id, player);
releaseOld();
await control("play", video.id); assert.equal(player.playing, true);
await control("pause", video.id); assert.equal(player.playing, false);
await viewerControlTool.execute("seek", { action: "seek", seconds: 900 }); assert.equal(player.currentTime, 42, "seek is bounded to actual duration");
view.videoEnded(video.id); assert.notEqual(view.getSnapshot().deadline, null);
await control("replay"); assert.equal(player.currentTime, 0); assert.equal(player.playing, true); assert.equal(view.getSnapshot().deadline, null);
await assert.rejects(viewerControlTool.execute("seek", { action: "seek", seconds: -1 }), /有效/);
player.status = "loading"; await assert.rejects(control("play"), /加载/); await control("pause");
releaseVideo(); await assert.rejects(control("play"), /准备好/);
const document = { id: "doc1", kind: "document", title: "演示", uri: "file:///slides.pptx" };
view.open(document);
const documentPlayer = { page: 0, pageCount: 3, go(page) { this.page = page; } };
const releaseDocument = documentControl.bind(document.id, documentPlayer);
await control("next_page"); assert.equal(documentPlayer.page, 1);
await viewerControlTool.execute("page", { action: "go_page", page: 3 }); assert.equal(documentPlayer.page, 2);
await assert.rejects(control("next_page"), /边界/); assert.equal(documentPlayer.page, 2);
await control("previous_page"); assert.equal(documentPlayer.page, 1);
view.offer(image); view.offer(video);
const queueResult = JSON.parse((await control("status")).content[0].text); assert.equal(queueResult.queue.length, 2);
await control("next_result", video.id); assert.equal(view.getSnapshot().active.id, video.id);
assert.equal(view.getSnapshot().queue[0].id, image.id); releaseDocument();

let pauses = 0, resumes = 0, releases = 0, saves = 0, videoStops = 0;
let lease = async () => () => { releases++; }, microphonePermission = true;
const offered = [];
const recording = load("src/artifacts/phone-recording.ts", {
  "react-native": { AppState: { currentState: "active" }, PermissionsAndroid: { PERMISSIONS: { CAMERA: "camera", RECORD_AUDIO: "mic" }, check: async (name) => name !== "mic" || microphonePermission } },
  "../voice/chinese-voice-runtime": { chineseVoice: { pauseCaptureForRecording: async () => { pauses++; return async () => { resumes++; }; } }, resumeAutomaticChineseVoice() {} },
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
