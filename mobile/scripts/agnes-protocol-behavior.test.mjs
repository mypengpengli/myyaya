import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
const module = { exports: {} };
const code = ts.transpileModule(readFileSync("src/artifacts/agnes-protocol.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function("module", "exports", code)(module, module.exports);
const api = module.exports;
const basic = api.buildAgnesVideoRequest("agnes-video-2.5-flash", "A moving circle");
assert.deepEqual(basic, { model: "agnes-video-2.5-flash", prompt: "A moving circle", mode: "text", seconds: "5", size: "720P", aspect_ratio: "16:9", n: 1 });
const image = "data:image/jpeg;base64,example";
const keyframe = api.buildAgnesVideoRequest("agnes-video-2.5", "make it dance", image);
assert.equal(keyframe.mode, "keyframe"); assert.equal(keyframe.first_frame, image);
assert.equal("image" in keyframe, false, "2.5 does not use the old image/duration protocol");
const edit = api.buildAgnesImageRequest("make it blue", image);
assert.deepEqual(edit.extra_body, { image: [image], response_format: "url" }, "persist a compact image receipt before downloading the binary");
assert.equal(edit.image, image, "owner gateway compatibility includes the flattened image reference");
assert.deepEqual(edit.images, [image]);
assert.equal(edit.size, "1024x1024", "edit requests use the working site's concrete dimensions");
assert.equal("n" in edit, false);
assert.match(edit.prompt, /^Use the provided reference image as the visual source/);
assert.equal(api.buildAgnesImageRequest("preserve portrait", image, { width: 3000, height: 4000 }).size, "768x1024");
assert.equal(api.agnesEditSize(1920, 1080), "1024x576");
assert.equal(api.agnesEditSize(NaN, 0), "1024x1024");
assert.equal("response_format" in edit, false);
assert.deepEqual(api.buildAgnesImageRequest("draw a cat").extra_body, { response_format: "url" }, "text generation also persists a compact receipt instead of streaming a large base64 body");
assert.equal("return_base64" in api.buildAgnesImageRequest("draw a cat"), false);
for (const ratio of api.IMAGE_ASPECT_RATIOS) {
  const options = { model: "owner-image-alias", aspectRatio: ratio };
  const generated = api.buildAgnesImageRequest("draw a cat", undefined, undefined, options);
  const edited = api.buildAgnesImageRequest("extend the background", image, { width: 3000, height: 4000 }, options);
  assert.equal(generated.model, "owner-image-alias"); assert.equal(edited.model, "owner-image-alias");
  assert.equal(generated.ratio, ratio); assert.equal(edited.ratio, ratio);
  assert.equal(edited.size, "1K", "an explicit ratio overrides reference dimensions using documented tier + ratio");
  assert.deepEqual(edited.extra_body.image, [image], "changing aspect does not lose the source image");
}
for (const ratio of api.VIDEO_ASPECT_RATIOS) {
  assert.equal(api.buildAgnesVideoRequest("owner-video-alias", "move", undefined, ratio).aspect_ratio, ratio);
  assert.equal(api.buildAgnesVideoRequest("owner-video-alias", "move", image, ratio).aspect_ratio, ratio);
}
assert.throws(() => api.buildAgnesVideoRequest("video", "move", image, "2:3"), /视频不支持/);
assert.throws(() => api.buildAgnesImageRequest("draw", undefined, undefined, { aspectRatio: "7:5" }), /图片不支持/);
assert.deepEqual(api.parseAgnesVideoSubmission({ id: "relay_task", task_id: "provider_task", video_id: "video_id" }), { remoteId: "relay_task", videoId: "video_id" });
assert.deepEqual(api.parseAgnesVideoSubmission({ video_id: "only_video" }), { videoId: "only_video" });
assert.throws(() => api.parseAgnesVideoSubmission({ status: "queued" }), /任务编号/);
assert.deepEqual(api.agnesVideoPollPaths({ remoteId: "relay_task", videoId: "video_id", model: "agnes-video-2.5-flash" }),
  ["/agnesapi?video_id=video_id&model_name=agnes-video-2.5-flash", "/v1/videos/relay_task"]);
assert.equal(api.extractAgnesVideoUrl({ metadata: { url: "https://example.test/video.mp4" } }), "https://example.test/video.mp4");
assert.equal(api.extractAgnesVideoUrl({ output: { url: "file:///private" } }), undefined);
const nested404 = { code: "fail_to_fetch_task", message: JSON.stringify({ error: { code: "model_not_found", message: "Model not available in current group" } }) };
assert.match(api.mediaRejectionNotice(404, nested404), /当前分组/);
assert.equal(api.mediaRejectionNotice(404, { code: "fail_to_fetch_task", message: "temporary unknown" }), undefined, "ambiguous task-fetch failures cannot prove the POST was rejected");
assert.match(api.mediaRejectionNotice(401, {}), /凭据/);
assert.deepEqual(api.videoDownloadCandidates("https://relay.test/v1", "relay-task", "https://cdn.test/movie.mp4"),
  ["https://relay.test/v1/videos/relay-task/content", "https://cdn.test/movie.mp4"]);
assert.equal(api.mediaDownloadHeaders("https://relay.test/v1", "https://relay.test/v1/videos/task/content", "fixture-token").Authorization, "Bearer fixture-token");
assert.equal(api.mediaDownloadHeaders("https://relay.test/v1", "https://cdn.test/movie.mp4", "fixture-token").Authorization, undefined, "gateway credentials never follow a video URL to another host");
console.log("Agnes protocol: owner's site-compatible text/keyframe video, distinct task/video IDs, polling fallback, image reference JSON and nested group-error classification: PASS");
