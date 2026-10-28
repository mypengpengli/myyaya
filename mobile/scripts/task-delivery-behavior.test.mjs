import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
function load(path, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), module, module.exports);
  return module.exports;
}
const protocol = load("src/hermes/run-protocol.ts"), types = load("src/artifacts/file-types.ts");
const { HermesTaskService } = load("src/hermes/task-service.ts", { "./run-protocol": protocol });
const { CompletionCoordinator } = load("src/hermes/completion-service.ts", { "./run-protocol": protocol });
const stored = new Map(), artifacts = new Map(), downloads = [];
let requestCount = 0;
const manifest = { version: 1, task_id: "task-fixture", files: [{ id: "file1", name: "报告.pdf", mimeType: "application/pdf", bytes: 128, sha256: "a".repeat(64) }] };
let response = () => new Response(JSON.stringify(manifest));
const { parseFileManifest, receiveTaskFiles } = load("src/hermes/file-results.ts", {
  "expo/fetch": { fetch: async (url, options) => {
    requestCount++; assert.ok(url.startsWith("https://hermes.example/myyaya/v1/tasks/")); assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer fixture-token"); return response();
  } }, "../artifacts/file-types": types,
  "../../modules/document-preview": { documentNative: () => ({ download: async (...args) => { downloads.push(args); return `file:///private/myyaya-artifacts/${args[4]}.${args[5]}`; } }) },
  "../artifacts/artifact-store": { findArtifact: (id) => artifacts.get(id), registerArtifactFile: (file) => { artifacts.set(file.id, file); return file; } },
});
assert.equal(parseFileManifest(manifest, "task-fixture").length, 1);
for (const patch of [{ task_id: "another-task" }, { version: 2 }, { files: [...manifest.files, ...manifest.files] }, { files: [{ ...manifest.files[0], name: "../private.pdf" }] }, { files: [{ ...manifest.files[0], bytes: 30 * 1024 * 1024 }] }, { files: [{ ...manifest.files[0], sha256: "invalid" }] }, { files: [{ ...manifest.files[0], mimeType: "text/html" }] }]) {
  assert.throws(() => parseFileManifest({ ...manifest, ...patch }, "task-fixture"));
}
const repository = { list: () => [...stored.values()], save: (task) => stored.set(task.id, task) };
let tasks = new HermesTaskService(repository, () => "task-fixture");
const task = tasks.create("制作报告文件", "https://hermes.example", "fixture-account", true);
assert.match(task.payload, /task-fixture/); assert.match(task.payload, /file_bridge/);
tasks.applySnapshot(task.id, { run_id: "run-fixture", status: "completed", output: "报告生成好了。" });
const connection = { version: 1, baseUrl: task.baseUrl, token: "fixture-token" };
let foreground = true, received = 0, announced = 0, readyToSpeak = false;
const notices = new Map();
response = () => new Response("not available", { status: 404 });
const coordinator = new CompletionCoordinator(tasks, async (value) => { received++; return receiveTaskFiles(value, connection, async () => foreground); },
  async () => { if (!readyToSpeak) return false; announced++; return true; }, (id, text) => notices.set(id, text), async () => foreground);
await coordinator.process(task.baseUrl, "wrong-account"); assert.equal(received, 0);
await coordinator.process(task.baseUrl, task.accountId); assert.equal(tasks.list()[0].delivery.files, "failed");
await coordinator.process(task.baseUrl, task.accountId); assert.equal(received, 1, "failed file downloads need an explicit retry, not an infinite loop");
assert.equal(notices.size, 1); assert.equal(announced, 0, "busy voice cannot be interrupted by a completion");
tasks.updateDelivery(task.id, { files: "pending" }); response = () => new Response(JSON.stringify(manifest)); readyToSpeak = true;
await coordinator.process(task.baseUrl, task.accountId);
assert.equal(downloads.length, 1); assert.equal(downloads[0][2], manifest.files[0].sha256);
assert.equal(tasks.list()[0].delivery.files, "saved"); assert.equal(tasks.list()[0].delivery.notified, true); assert.equal(announced, 1);
tasks = new HermesTaskService(repository, () => "unused");
await new CompletionCoordinator(tasks, () => { throw Error("must not redownload"); }, async () => { throw Error("must not repeat"); }, () => {}, async () => true).process(task.baseUrl, task.accountId);
await receiveTaskFiles(task, connection, async () => true); assert.equal(downloads.length, 1, "persisted artifact ID deduplicates downloads");
foreground = false; await assert.rejects(receiveTaskFiles(task, connection, async () => foreground), /暂停/);
foreground = true; response = () => new Response("x".repeat(40_000)); await assert.rejects(receiveTaskFiles(task, connection, async () => true), /过大/);
assert.ok(requestCount >= 3);
let leaseDepth = 0, finishPicker, failPicker = false;
const pickerMocks = {
  "../../modules/document-preview": { documentNative: () => ({ pickFile: () => { assert.equal(leaseDepth, 1); if (failPicker) throw Error("picker failed"); return new Promise((resolve) => { finishPicker = resolve; }); } }) },
  "../core/background-process-exit": { withExternalActivityLease: async (_reason, work) => { leaseDepth++; try { return await work(); } finally { leaseDepth--; } } },
  "./artifact-store": { registerArtifactFile: (file) => { assert.equal(leaseDepth, 1, "picker/process lease survives until the file is registered"); return file; } },
};
const { importLocalArtifact } = load("src/artifacts/artifact-import.ts", pickerMocks);
const selecting = importLocalArtifact(); await Promise.resolve(); assert.equal(leaseDepth, 1);
finishPicker({ id: "imported" }); assert.equal((await selecting).id, "imported"); assert.equal(leaseDepth, 0);
const cancelledPicker = importLocalArtifact(); finishPicker(null); assert.equal(await cancelledPicker, null); assert.equal(leaseDepth, 0);
failPicker = true; await assert.rejects(importLocalArtifact(), /picker failed/); assert.equal(leaseDepth, 0);
let finishSave, failSave = false, saveArgs;
const { exportOriginalArtifact } = load("src/artifacts/artifact-export.ts", {
  "../../modules/document-preview": { documentNative: () => ({ saveOriginal: (...args) => { assert.equal(leaseDepth, 1); saveArgs = args; if (failSave) throw Error("save failed"); return new Promise((resolve) => { finishSave = resolve; }); } }) },
  "../core/background-process-exit": pickerMocks["../core/background-process-exit"],
});
const original = { id: "original-docx", kind: "document", uri: "file:///private/myyaya-artifacts/original-docx.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", title: "报告.docx" };
const exporting = exportOriginalArtifact(original); await Promise.resolve(); assert.equal(leaseDepth, 1);
assert.deepEqual(saveArgs, [original.uri, original.mimeType, original.title], "save must hand off the original, never a PDF preview or extracted text");
finishSave(true); assert.equal(await exporting, true); assert.equal(leaseDepth, 0);
const cancelledSave = exportOriginalArtifact(original); finishSave(false); assert.equal(await cancelledSave, false); assert.equal(leaseDepth, 0);
failSave = true; await assert.rejects(exportOriginalArtifact(original), /save failed/); assert.equal(leaseDepth, 0);
console.log("Task delivery: fixed-origin manifests, bounded validated files, retry/deduplication, account/foreground fences, persisted completion and idle-only reports: PASS");
