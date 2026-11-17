import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
let now = 0, nextTimer = 0;
const timers = new Map();
const clock = { setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); } };
function load(path, mocks = {}) {
  const module = { exports: {} }, code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", "Date", code)(name => mocks[name] ?? require(name), module, module.exports, clock.setTimeout, clock.clearTimeout, { now: () => now });
  return module.exports;
}
const feedbackModule = load("src/voice/conversation-feedback.ts"), commands = load("src/voice/chinese-command.ts");
const { ChineseVoiceSession } = load("src/voice/chinese-voice-session.ts", { "./chinese-command": commands, "./conversation-feedback": feedbackModule });
const events = new Map(), spoken = [], requests = [];
let sessionId = 0, resolveReply, rejectReply, report;
const native = {
  prepareChinese: async () => ({ sessionId: ++sessionId }), startChineseCapture: async () => ({ running: true }), stopChineseCapture: async () => {},
  speakChinese: async text => { spoken.push(text); }, stopChineseSpeech() {},
  addListener(name, listener) { events.set(name, listener); return { remove: () => events.delete(name) }; },
};
const voice = new ChineseVoiceSession(native, async () => true, () => true, async () => "已停止", async () => {},
  (text, signal, feedback) => { requests.push({ text, signal }); report = feedback; return new Promise((resolve, reject) => { resolveReply = resolve; rejectReply = reject; }); });
const flush = async () => { for (let i = 0; i < 70; i++) await Promise.resolve(); };
const advance = async ms => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await flush(); };
const emit = (text, partial = false) => events.get("onCommandResult")?.({ sessionId, text, partial });
await voice.start();
assert.equal(voice.getSnapshot().captureActive, true); assert.equal(voice.getSnapshot().awake, false);
emit("小丫小丫", true); assert.equal(voice.getSnapshot().awake, true, "partial wake lights the ready indicator without submitting a model request");
emit("小丫小丫"); await flush(); assert.equal(spoken.at(-1), "我在听");
await advance(45_000); assert.equal(voice.getSnapshot().awake, true);
emit("我想请你帮我查一个东西", true); await advance(40_000);
assert.equal(voice.getSnapshot().awake, true, "ongoing user speech extends the speaking window");
emit("查一下天气"); await flush(); assert.equal(spoken.at(-1), "好的，我来处理。");
assert.equal(requests.length, 1);
report({ kind: "stage", text: "正在联网搜索。" }); await flush(); assert.equal(spoken.at(-1), "正在联网搜索。");
report({ kind: "stage", text: "正在联网搜索。" }); await flush(); assert.equal(spoken.filter(v => v === "正在联网搜索。").length, 1);
report({ kind: "assistant", text: "我找到资料了。", message: 1 }); await flush();
assert.equal(spoken.at(-1), "我找到资料了。", "public sentences are audible before the whole Pi turn resolves");
await advance(80_000); assert.equal(voice.getSnapshot().awake, true, "long tools/model waits do not close the follow-up window");
resolveReply("我找到资料了。今天有雨。"); await flush();
assert.equal(spoken.at(-1), "今天有雨。"); assert.equal(spoken.filter(v => v === "我找到资料了。").length, 1);
assert.equal(voice.getSnapshot().phase, "listening");
await advance(59_000); assert.equal(voice.getSnapshot().awake, true);
await advance(1001); assert.equal(voice.getSnapshot().awake, false);
emit("这句不应该提交"); await flush(); assert.equal(requests.length, 1);
emit("小丫小丫继续"); await flush();
const lateReport = report, lateReply = resolveReply, beforeStop = spoken.length;
emit("停止", true); lateReport({ kind: "stage", text: "旧进度不能念" }); lateReply("旧结果不能念"); await flush();
assert.equal(requests.at(-1).signal.aborted, true); assert.equal(spoken.length, beforeStop);
assert.equal(voice.getSnapshot().awake, false);
emit("小丫小丫再试"); await flush(); rejectReply(new Error("模型请求失败（HTTP 401）")); await flush();
assert.equal(spoken.at(-1), "模型请求失败（HTTP 401）"); assert.equal(voice.getSnapshot().phase, "listening");
await voice.stop(); assert.equal(timers.size, 0);

const sentences = [];
const chunker = new feedbackModule.PublicReplySentences(v => sentences.push(v));
chunker.start(); chunker.append("第一句"); assert.equal(sentences.length, 0); chunker.append("。第二句！");
assert.deepEqual(sentences.map(v => v.text), ["第一句。", "第二句！"]);
chunker.append("没有收完"); chunker.finish(false); assert.equal(sentences.length, 2);
const { quickPhotoRequest } = load("src/voice/quick-photo-request.ts", { "./chinese-command": commands });
assert.deepEqual(quickPhotoRequest("帮我拍张照片"), { camera: "front" });
assert.deepEqual(quickPhotoRequest("请帮我用后置摄像头拍一张照片"), { camera: "back" });
for (const text of ["不要拍张照片", "如果我说拍张照片", "帮我拍张照片然后编辑", "帮我看看周围", "讲讲怎么拍照片"]) assert.equal(quickPhotoRequest(text), null);
console.log("Voice turn feedback: real readiness, 60s renewal, immediate receipt, public streamed sentences, no duplicates, long tasks, cancellation and exact camera shortcut: PASS");
