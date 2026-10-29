import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url), ts = require("typescript");
const mocks = {}, modules = new Map();
function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    const local = path.resolve(path.dirname(file), name + ".ts");
    return name.startsWith(".") && existsSync(local) ? load(local) : require(name);
  }, module, module.exports);
  return module.exports;
}
let saved;
mocks["expo-secure-store"] = { getItemAsync: async () => saved, setItemAsync: async (_key, value) => { saved = value; } };
const configApi = load("src/agent/newapi-config.ts");
const oldConfig = { version: 1, baseUrl: "https://example.test/v1", apiKey: "test-only-fixture", model: "old-chat" };
saved = JSON.stringify(oldConfig);
assert.equal((await configApi.readNewApiConfig()).imageModel, "agnes-image-2.5-flash", "existing installations need no re-entry of their key");
await configApi.saveNewApiConfig({ ...oldConfig, model: "new-chat", imageModel: " owner-image-alias ", videoModel: "owner-video-alias" });
assert.equal((await configApi.readNewApiConfig()).imageModel, "owner-image-alias");
assert.equal((await configApi.readNewApiConfig()).model, "new-chat");
assert.throws(() => configApi.validateNewApiConfig({ ...oldConfig, imageModel: "bad\nname" }), /图片模型/);

const rows = new Map(), posts = [];
let counter = 0, dimensions = { width: 3000, height: 4000 };
mocks["expo-sqlite"] = { openDatabaseSync: () => ({ execSync() {}, getAllSync: () => [...rows.values()].map((job) => ({ data: JSON.stringify(job) })), runSync: (_sql, id, data) => rows.set(id, JSON.parse(data)) }) };
mocks["expo-crypto"] = { randomUUID: () => `job-${++counter}`, digestStringAsync: async () => "same-account", CryptoDigestAlgorithm: { SHA256: "sha256" } };
mocks["expo-file-system"] = { File: class { exists = true; size = 50; async base64() { return "fixture-image"; } } };
mocks["expo-file-system/legacy"] = { documentDirectory: "file:///documents/", makeDirectoryAsync: async () => {}, writeAsStringAsync: async () => {} };
mocks["react-native"] = { AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) }, Image: { getSize: async () => dimensions } };
mocks["./artifact-store"] = { findArtifact: () => ({ id: "parent", kind: "image", uri: "file:///photo.jpg", mimeType: "image/jpeg" }) };
mocks["./presentation"] = { resultPresentation: { offer() {} } };
mocks["../diagnostics/diagnostic-log"] = { recordDiagnosticEvent() {}, getDiagnosticLogEntries: () => [] };
mocks["expo/fetch"] = { fetch: async (url, init) => {
  const body = JSON.parse(init.body); posts.push({ url, body });
  // A definite rejection terminates each fixture without ever generating remote media.
  return new Response(JSON.stringify({ error: { message: "fixture parameter rejection" } }), { status: 400, headers: { "Content-Type": "application/json" } });
} };
const media = load("src/artifacts/media-jobs.ts");
async function submit(input) {
  const job = await media.submitMediaJob(input);
  for (let i = 0; i < 100 && rows.get(job.id).status === "submitting"; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(rows.get(job.id).status, "failed");
  return rows.get(job.id);
}
const image = await submit({ kind: "image", prompt: "A portrait cat", aspectRatio: "9:16", resolution: "2K" });
assert.equal(posts.at(-1).body.ratio, "9:16"); assert.equal(posts.at(-1).body.model, "owner-image-alias");
assert.equal(posts.at(-1).body.size, "2K");
assert.deepEqual(posts.at(-1).body.extra_body, { response_format: "url" });
const edit = await submit({ kind: "edit", prompt: "Extend to a landscape", parentId: "parent", aspectRatio: "16:9", resolution: "4K" });
assert.equal(posts.at(-1).body.ratio, "16:9"); assert.equal(posts.at(-1).body.size, "4K");
assert.equal(posts.at(-1).body.model, "owner-image-alias"); assert.match(posts.at(-1).body.image, /^data:image\/jpeg/);
await submit({ kind: "edit", prompt: "Keep framing", parentId: "parent" });
assert.equal(posts.at(-1).body.size, "768x1024"); assert.equal(posts.at(-1).body.ratio, undefined);
await submit({ kind: "edit", prompt: "Increase resolution only", parentId: "parent", resolution: "2K" });
assert.equal(posts.at(-1).body.size, "2K"); assert.equal(posts.at(-1).body.ratio, "3:4");
const video = await submit({ kind: "video", prompt: "Walk upright", aspectRatio: "9:16" });
assert.equal(posts.at(-1).body.aspect_ratio, "9:16"); assert.equal(posts.at(-1).body.mode, "text");
assert.equal(posts.at(-1).body.model, "owner-video-alias");
await submit({ kind: "video", prompt: "Animate", parentId: "parent", aspectRatio: "1:1" });
assert.equal(posts.at(-1).body.aspect_ratio, "1:1"); assert.equal(posts.at(-1).body.mode, "keyframe");
assert.match(posts.at(-1).body.first_frame, /^data:image\/jpeg/);
const before = rows.size;
await assert.rejects(media.submitMediaJob({ kind: "video", prompt: "unsupported", aspectRatio: "2:3" }), /视频不支持/);
assert.equal(rows.size, before, "unsupported ratios are rejected before creating/persisting/posting any task");
await assert.rejects(media.submitMediaJob({ kind: "video", prompt: "wrong tier", resolution: "2K" }), /720P/);
await assert.rejects(media.submitMediaJob({ kind: "image", prompt: "wrong tier", resolution: "8K" }), /1K.*4K/);
assert.equal(rows.size, before, "invalid resolutions cannot create, persist or post a task");
await configApi.saveNewApiConfig({ ...oldConfig, imageModel: "next-image-alias", videoModel: "next-video-alias" });
await submit({ kind: "image", prompt: "Next image", aspectRatio: "1:1" });
assert.equal(posts.at(-1).body.model, "next-image-alias");
const { MediaJobService } = load("src/artifacts/media-job-service.ts");
const restored = new MediaJobService({ list: () => [...rows.values()], save() {} }, () => "unused");
assert.equal(restored.list().find((job) => job.id === image.id).model, "owner-image-alias");
assert.equal(restored.list().find((job) => job.id === edit.id).aspectRatio, "16:9");
assert.equal(restored.list().find((job) => job.id === image.id).resolution, "2K");
assert.equal(restored.list().find((job) => job.id === edit.id).resolution, "4K");
assert.equal(restored.list().find((job) => job.id === video.id).model, "owner-video-alias");
assert.equal(posts.length, 7, "settings changes/restart never resubmit previous tasks");
// The diagnostic must inspect local pixels, not echo the requested tier as proof.
const completed = media.getMediaJobs().create({ kind: "image", prompt: "local fixture", resolution: "2K" }, "same-account");
await media.getMediaJobs().submit(completed.id, "same-account", { submit: async () => ({ artifactId: "saved-image" }) });
const probe = await media.probeMediaJobs();
assert.deepEqual(probe.images[0], { id: completed.id, artifactId: "saved-image", width: 3000, height: 4000 });
assert.equal(posts.length, 7, "inspecting local pixels cannot submit media");
mocks["react-native"].Image.getSize = async () => { throw Error("file unavailable"); };
assert.equal((await media.probeMediaJobs()).images[0].unavailable, true);
// Exercise the actual voice-agent tool boundary as well as the HTTP transport.
for (const name of ["expo-router", "../device-tools/looi-robot", "../memory/memory-service", "../hermes/task-runtime",
  "../artifacts/artifact-focus", "../artifacts/phone-recording", "../search/web-search-tool", "./robot-tools", "./camera-tools", "./viewer-tools", "../artifacts/presentation"]) mocks[name] = {};
mocks.typebox = await import("typebox");
mocks["../artifacts/artifact-store"] = { selectedImage: (id) => ({ id: id || "selected-reference" }) };
const calls = [];
mocks["../artifacts/media-jobs"] = { submitMediaJob: async (input) => { calls.push(input); return { ...input, id: "fixture-job", status: "submitting" }; } };
const { phoneTools } = load("src/agent/phone-tools.ts");
const createTool = phoneTools.find((tool) => tool?.name === "create_media");
assert.ok(createTool.parameters.properties.aspectRatio.anyOf.some((value) => value.const === "9:16"));
assert.deepEqual(createTool.parameters.properties.resolution.anyOf.map((value) => value.const), ["1K", "2K", "3K", "4K"]);
for (const args of [
  { kind: "image", source: "text", prompt: "portrait", aspectRatio: "9:16", resolution: "2K" },
  { kind: "edit", prompt: "wide", parentId: "specific-reference", aspectRatio: "16:9", resolution: "4K" },
  { kind: "video", source: "text", prompt: "square", aspectRatio: "1:1" },
  { kind: "video", source: "image", prompt: "portrait motion", aspectRatio: "9:16" },
]) {
  await createTool.execute("voice-fixture", args);
  assert.equal(calls.at(-1).aspectRatio, args.aspectRatio);
  assert.equal(calls.at(-1).resolution, args.resolution);
}
assert.equal(calls[1].parentId, "specific-reference"); assert.equal(calls[3].parentId, "selected-reference");
console.log("Media options: secure config migration, model edits, all four generation paths, explicit/source ratios, task snapshots and rejection before POST: PASS");
