import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
const require = createRequire(import.meta.url), ts = require("typescript");
function load(path, mocks = {}) {
  const module = { exports: {} }, code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), module, module.exports); return module.exports;
}
const { resolveImageReference, artifactVersions } = load("src/artifacts/artifact-versions.ts");
const { ResultPresentation } = load("src/artifacts/presentation.ts");
let now = 0;
const timed = new ResultPresentation(() => now);
const releaseTurn = timed.holdCountdown();
timed.open({ id: "picture", kind: "image", title: "picture", uri: "file:///fixture.png" }); timed.loaded("picture");
now += 60_000; timed.tick(); assert.equal(timed.getSnapshot().active.id, "picture", "model/tool latency must not dismiss a result before pinning");
const otherTurn = timed.holdCountdown(); releaseTurn(); assert.equal(timed.getSnapshot().deadline, null);
timed.suspend(true); otherTurn(); assert.equal(timed.getSnapshot().deadline, null, "a finished command cannot release the background suspension");
timed.suspend(false); now += 9_999; timed.tick(); assert.ok(timed.getSnapshot().active);
now++; timed.tick(); assert.equal(timed.getSnapshot().active, null, "normal ten-second countdown resumes when the command and background holds end");
const pictures = [{ id: "original", kind: "image", createdAt: 1 }, { id: "edit1", kind: "image", parentId: "original", createdAt: 2 }, { id: "edit2", kind: "image", parentId: "edit1", createdAt: 3 }, { id: "video", kind: "video", parentId: "edit2", createdAt: 4 }, { id: "other", kind: "image", createdAt: 5 }];
assert.equal(resolveImageReference(pictures, undefined, undefined, "edit1").id, "edit1", "a later completion cannot silently replace the selected input");
assert.equal(resolveImageReference(pictures, "original", "edit2", "edit1").id, "original");
assert.equal(resolveImageReference(pictures, undefined, "edit2", "edit1").id, "edit2");
assert.throws(() => resolveImageReference(pictures), /多张/);
assert.deepEqual(artifactVersions(pictures, "edit1").map((item) => item.id), ["original", "edit1", "edit2", "video"]);
const sql = new DatabaseSync(":memory:");
const sqlite = { openDatabaseSync: () => ({ execSync: (s) => sql.exec(s), runSync: (s, ...a) => sql.prepare(s).run(...a), getFirstSync: (s, ...a) => sql.prepare(s).get(...a) }) };
let focus = load("src/artifacts/artifact-focus.ts", { "expo-sqlite": sqlite });
focus.updateArtifactFocus({ imageId: "edit1", artifactId: "edit1", taskId: "old-task" });
focus = load("src/artifacts/artifact-focus.ts", { "expo-sqlite": sqlite });
assert.equal(focus.readArtifactFocus().imageId, "edit1", "new JS runtime must recover selected IDs from SQLite");
focus.updateArtifactFocus({ artifactId: "report" }); assert.equal(focus.readArtifactFocus().imageId, "edit1");
const protocol = load("src/hermes/run-protocol.ts");
const { HermesTaskService } = load("src/hermes/task-service.ts", { "./run-protocol": protocol });
const values = new Map(), repository = { list: () => [...values.values()], save: (task) => values.set(task.id, task) };
let counter = 0, service = new HermesTaskService(repository, () => `task-${++counter}`);
const old = service.create("制作 Word 报告", "https://example.test", "account");
service.applySnapshot(old.id, { run_id: "run-old", session_id: "actual-session", status: "completed", output: "原报告已经完成" });
service.updateDelivery(old.id, { files: "saved", artifactIds: ["report"], notified: true });
service = new HermesTaskService(repository, () => `task-${++counter}`);
const { restoredCompanionContext } = load("src/agent/restored-context.ts");
const restored = JSON.parse(restoredCompanionContext(service.list(), pictures, [], { taskId: old.id, imageId: "edit1" }));
assert.equal(restored.tasks[0].result, "原报告已经完成"); assert.deepEqual(restored.tasks[0].files, ["report"]);
assert.equal(restored.tasks[0].sessionId, "actual-session");
const next = service.create("在这个报告增加一页", old.baseUrl, old.accountId, true, { sessionId: "actual-session", previousTaskId: old.id, history: [{ role: "assistant", content: "原报告已经完成" }] });
assert.notEqual(next.id, old.id); assert.equal(next.previousTaskId, old.id);
const payload = JSON.parse(next.payload); assert.equal(payload.session_id, "actual-session"); assert.equal(payload.conversation_history[0].content, "原报告已经完成");
const { MediaJobService } = load("src/artifacts/media-job-service.ts");
const mediaRows = new Map(), mediaRepository = { list: () => [...mediaRows.values()], save: (job) => mediaRows.set(job.id, job) };
let media = new MediaJobService(mediaRepository, () => "image-task"), posts = 0, polls = 0;
const job = media.create({ kind: "edit", parentId: "edit1", prompt: "change the background", resolution: "2K" }, "binding");
await media.submit(job.id, "binding", { submit: async () => { posts++; return { imageResultPath: "private/receipt.json" }; } });
media = new MediaJobService(mediaRepository, () => "unused");
const recovered = JSON.parse(restoredCompanionContext([], pictures, media.list(), { imageId: "edit1" }));
assert.equal(recovered.media[0].resolution, "2K", "the first Pi turn after restart can see the submitted resolution without generating again");
assert.equal(recovered.media[0].prompt, "change the background", "durable image descriptions distinguish an older requested subject from a newer completion");
await media.poll("binding", { poll: async (value) => { polls++; assert.equal(value.parentId, "edit1"); throw Error("download offline"); } });
assert.equal(media.list()[0].status, "running");
await media.poll("binding", { poll: async () => { polls++; return { status: "completed", artifactId: "result" }; } });
assert.equal(posts, 1); assert.equal(polls, 2); assert.equal(media.list()[0].artifactId, "result");
let announcements = 0, speaking = false;
const { reportMediaCompletions } = load("src/artifacts/media-completion-runtime.ts", {
  "../voice/chinese-voice-runtime": { chineseVoice: { announce: async () => { if (!speaking) return false; announcements++; return true; } } },
  "../agent/companion-runtime": { queueCompanionTaskResult() {} }, "./phone-camera": { photoCapture: { getSnapshot: () => ({ phase: "idle" }) } },
  "./phone-recording": { getPhoneRecording: () => ({ phase: "idle" }) },
});
await reportMediaCompletions(media, "binding", async () => true); assert.equal(announcements, 0);
speaking = true; await reportMediaCompletions(media, "binding", async () => true); assert.equal(announcements, 1);
media = new MediaJobService(mediaRepository, () => "unused"); await reportMediaCompletions(media, "binding", async () => true); assert.equal(announcements, 1);
let getCount = 0;
const { createHermesHistoryClient } = load("src/hermes/history-client.ts", { "expo/fetch": { fetch: async (url, options) => {
  getCount++; assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, "Bearer fixture");
  return new Response(JSON.stringify(url.includes("/messages?") ? { data: [{ role: "user", content: "之前的要求" }, { role: "tool", content: "not restored as commands" }, { role: "assistant", content: "之前的结果" }] } : { data: [{ id: "myyaya-task-old", title: "old task" }, { id: "unrelated-session" }] }));
} } });
const history = createHermesHistoryClient({ baseUrl: "https://example.test", token: "fixture" });
assert.equal((await history.list()).length, 1); assert.equal((await history.messages("myyaya-task-old")).length, 2);
await assert.rejects(history.messages("../private")); assert.equal(getCount, 2);
console.log("Continuity/media: durable focus and task references, explicit server history, continuation, version lineage, resumable image receipts and once-only reports: PASS");
