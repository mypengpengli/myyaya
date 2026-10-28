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
const commands = load("src/voice/chinese-command.ts");
const { ChineseVoiceSession } = load("src/voice/chinese-voice-session.ts", { "./chinese-command": commands });
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const events = new Map(), calls = [], spoken = [], motions = [];
let id = 0, speech, pending, captureStops = 0, captureStarts = 0, foreground = true;
const native = {
  prepareChinese: async () => ({ sessionId: ++id }), startChineseCapture: async () => { captureStarts++; }, stopChineseCapture: async () => { captureStops++; },
  speakChinese: (text) => { spoken.push(text); return new Promise((resolve, reject) => { speech = { resolve, reject }; }); },
  stopChineseSpeech: () => { speech?.reject(new Error("cancelled")); speech = null; },
  addListener(name, fn) { const set = events.get(name) ?? new Set(); set.add(fn); events.set(name, set); return { remove: () => set.delete(fn) }; },
};
const voice = new ChineseVoiceSession(native, async () => true, () => foreground,
  async (command) => { motions.push(command); return "已停止"; }, async () => {},
  (text, signal) => { calls.push({ text, signal }); return new Promise((resolve, reject) => { pending = { resolve, reject }; }); });
const emit = (text, partial = false) => events.get("onCommandResult")?.forEach((fn) => fn({ text, partial, sessionId: id }));
await voice.start(); const stopsAtStart = captureStops;
emit("你叫什么名字"); await drain(); assert.equal(calls.length, 0, "ambient speech must not invoke the model");
emit("小丫小丫你叫什么名字", true); await drain(); assert.equal(calls.length, 0, "partial recognition cannot submit a conversation");
emit("小丫小丫你叫什么名字"); await drain();
assert.equal(calls[0].text, "你叫什么名字"); assert.equal(voice.getSnapshot().phase, "thinking");
pending.resolve("我叫小丫，很高兴认识你。"); await drain();
assert.equal(voice.getSnapshot().phase, "speaking");
assert.equal(captureStops, stopsAtStart, "wake and STOP capture stay alive during model/TTS");
emit("我叫小丫", false); await drain(); assert.equal(calls.length, 1, "speaker echo cannot start another conversation");
speech.resolve(); await drain(); assert.equal(voice.getSnapshot().phase, "listening");
emit("你会做什么"); await drain(); assert.equal(calls[1].text, "你会做什么", "follow-up needs no second wake");
const late = pending; emit("停止", true); await drain();
assert.equal(calls[1].signal.aborted, true); assert.equal(motions.at(-1).kind, "stop");
late.resolve("迟到的回复绝不能朗读"); await drain(); assert.equal(spoken.length, 1);
emit("继续解释"); await drain(); assert.equal(calls.length, 2, "STOP closes the follow-up window");
emit("小丫小丫"); await drain(); assert.equal(spoken.at(-1), "我在听"); speech.resolve(); await drain();
emit("今天天气怎么样"); await drain(); assert.equal(calls.length, 3);
const backgroundReply = pending;
foreground = false; await voice.stop(); backgroundReply.resolve("不应在后台播放"); await drain();
assert.equal(spoken.length, 2); assert.equal(voice.getSnapshot().phase, "off");
foreground = true; await voice.start(); emit("小丫小丫讲故事"); await drain();
pending.resolve("这个故事说到停止的时候。"); await drain();
emit("停止", true); await drain();
assert.equal(voice.getSnapshot().phase, "listening", "STOP wins even when its word occurs in the spoken reply");
await voice.stop();
await voice.start();
const resume = await voice.pauseCaptureForRecording(), beforeResume = captureStarts;
assert.equal(voice.isCapturePaused(), true);
await voice.stop(); await voice.start();
assert.equal(captureStarts, beforeResume, "settings/lifecycle restart cannot steal the recording microphone");
await resume(); assert.equal(voice.isCapturePaused(), false, "release clears ownership even after a voice generation change");
assert.equal(captureStarts, beforeResume, "an old capture lease cannot resurrect the stopped session");
await voice.start(); assert.equal(captureStarts, beforeResume + 1);
await voice.stop();
// Server reports preserve live STOP capture and wait until the user turn is idle.
const realNow = Date.now;
try {
  Date.now = () => realNow() + 10_000;
  await voice.start();
  const notification = voice.announce("后台任务完成了，文件已经保存。"); await drain();
  assert.equal(voice.getSnapshot().phase, "speaking");
  assert.equal(await voice.announce("不能插入第二条"), false);
  emit("停止", true); await drain();
  assert.equal(await notification, true, "an interrupted announcement is not repeated indefinitely");
  assert.equal(motions.at(-1).kind, "stop");
  foreground = false; assert.equal(await voice.announce("后台不能播报"), false); foreground = true;
  await voice.stop(); assert.equal(await voice.announce("关闭语音后不能播报"), false);
} finally { Date.now = realNow; }
console.log("Companion dialogue: wake, endpoint-only submission, follow-up, live STOP capture, echo guard, cancellation and background fences: PASS");
