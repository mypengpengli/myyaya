import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const load = (path, mocks = {}) => {
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), module, module.exports);
  return module.exports;
};
const commands = load("src/voice/chinese-command.ts");
const { ChineseCommandGate, parseChineseRobotCommand, isChineseStop } = commands;
assert.deepEqual(parseChineseRobotCommand("小 丫 小 丫，往 前 走 一 下。"), { kind: "move", direction: "forward" });
assert.deepEqual(parseChineseRobotCommand("请右转"), { kind: "turn", direction: "right", degrees: 90 });
assert.deepEqual(parseChineseRobotCommand("小鸭小鸭，点头"), { kind: "nod" });
for (const text of ["不要前进", "如果我说前进怎么办", "解释左转", "前进然后右转", "向前走五米", "我刚才说小丫小丫前进", "小丫小丫别开灯"]) {
  assert.equal(parseChineseRobotCommand(text), null, text);
}
assert.ok(isChineseStop("小丫小丫 停下来"));
assert.equal(isChineseStop("不要停止"), false);
const gate = new ChineseCommandGate();
assert.deepEqual(gate.accept("前进", false, 100), {});
assert.deepEqual(gate.accept("小丫小丫前进", true, 100), {});
assert.ok(gate.accept("小丫小丫", false, 100).wake);
assert.equal(gate.accept("前进", false, 101).command?.kind, "move");
assert.deepEqual(gate.accept("前进", false, 16000), {});
assert.equal(gate.accept("停止", true, 16000).command?.kind, "stop");

const { ChineseVoiceSession } = load("src/voice/chinese-voice-session.ts", { "./chinese-command": commands });
const events = new Map();
let starts = 0, stops = 0, nativeId = 0, permission = true, allowed = true;
let prepare = async () => ({ sessionId: ++nativeId });
let finishSpeech;
let hardwareStops = 0;
const executed = [];
const native = {
  prepareChinese: () => prepare(), startChineseCapture: async () => { starts++; }, stopChineseCapture: async () => { stops++; },
  speakChinese: () => new Promise((resolve, reject) => { finishSpeech = { resolve, reject }; }),
  stopChineseSpeech: () => { finishSpeech?.reject(new Error("cancelled")); finishSpeech = null; },
  addListener: (name, fn) => { const callbacks = events.get(name) ?? new Set(); callbacks.add(fn); events.set(name, callbacks); return { remove: () => callbacks.delete(fn) }; },
};
const session = new ChineseVoiceSession(native, async () => permission, () => allowed,
  async (command) => { executed.push(command); return "done"; }, async () => { hardwareStops++; });
const emit = (text, partial = false, sessionId = nativeId) => events.get("onCommandResult")?.forEach((fn) => fn({ text, partial, sessionId }));
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
await session.start();
assert.equal(session.getSnapshot().phase, "listening");
emit("前进"); await drain(); assert.equal(executed.length, 0);
emit("小鸭小鸭前进"); await drain(); assert.equal(executed.at(-1).kind, "move");
emit("后退", false, nativeId - 1); await drain(); assert.equal(executed.length, 1, "old native sessions cannot drive");
const late = [...events.get("onCommandResult")];
await session.stop(); late.forEach((fn) => fn({ text: "小鸭小鸭前进", partial: false, sessionId: nativeId }));
await drain(); assert.equal(executed.length, 1, "late callbacks after blur cannot drive");
await session.start("dictation"); emit("小丫小丫前进"); await drain();
assert.equal(executed.length, 1, "dictation never executes physical actions");
assert.equal(session.getSnapshot().transcript, "小丫小丫前进");
assert.equal(session.getSnapshot().phase, "off");
await session.start("dictation"); emit("停止", true); await drain(); assert.equal(executed.at(-1).kind, "stop");
await session.stop();
permission = false; await session.start(); assert.equal(session.getSnapshot().phase, "error");
permission = true;
let resolvePrepare;
prepare = () => new Promise((resolve) => { resolvePrepare = resolve; });
const before = starts;
const starting = session.start(); await drain(); assert.ok(resolvePrepare);
const stopping = session.stop(); resolvePrepare({ sessionId: ++nativeId }); await starting; await stopping;
assert.equal(starts, before, "stop during model initialization must prevent microphone startup");
assert.equal(session.getSnapshot().phase, "off");
prepare = async () => ({ sessionId: ++nativeId });
await session.start(); allowed = false; emit("小丫小丫前进"); await drain(); assert.equal(executed.length, 2);
await session.stop(); allowed = true;
const speaking = session.speak("你好"); await drain(); assert.ok(finishSpeech);
assert.equal(session.getSnapshot().phase, "speaking");
await session.stop(); await speaking; assert.equal(session.getSnapshot().phase, "off");
assert.equal([...events.values()].reduce((sum, set) => sum + set.size, 0), 0);
assert.ok(stops > 0);
assert.ok(hardwareStops >= 6, "leaving voice ownership or starting TTS must cancel pending hardware actions");

// Reproduce a manifest-only model stage: compilation alone cannot catch this.
// Use a Chinese path as well, so copy omissions cannot silently ship again.
const fixture = mkdtempSync(join(tmpdir(), "myyaya-模型-"));
try {
  const pluginModule = { exports: {} };
  new Function("require", "module", "exports", readFileSync("plugins/with-chinese-voice-model.js", "utf8"))(
    (name) => name === "expo/config-plugins" ? { withDangerousMod: (config, [, apply]) => ({ ...config, apply }) } : require(name),
    pluginModule, pluginModule.exports);
  const mod = { modRequest: { projectRoot: fixture, platformProjectRoot: join(fixture, "android") } };
  const stage = join(fixture, ".build-assets/vosk/vosk-command-cn-0.22");
  mkdirSync(stage, { recursive: true });
  const manifest = { sha256: "3af8b0e7e0f835ae9d414ce5df580237a3cfb08d586c9fbbb0f7ff29ad5b14ba" };
  const saveManifest = () => writeFileSync(join(stage, "myyaya-model-source.json"), JSON.stringify(manifest));
  saveManifest();
  const apply = pluginModule.exports({}).apply;
  await assert.rejects(apply(mod), /Incomplete Chinese model/);
  const data = Buffer.from("model-fixture");
  manifest.files = ["am/final.mdl", "conf/model.conf", "graph/HCLr.fst", "graph/Gr.fst", "LICENSE"].map((path) => ({
    path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"),
  }));
  saveManifest();
  for (const file of manifest.files) {
    mkdirSync(join(stage, file.path, ".."), { recursive: true }); writeFileSync(join(stage, file.path), data);
  }
  await apply(mod);
  const target = join(fixture, "android/app/src/main/assets/vosk-command-cn-0.22/am/final.mdl");
  assert.ok(existsSync(target)); assert.deepEqual(readFileSync(target), data);
  writeFileSync(join(stage, "am/final.mdl"), "corrupt");
  await assert.rejects(apply(mod), /missing or altered/);
} finally {
  assert.ok(fixture.startsWith(join(tmpdir(), "myyaya-模型-")));
  rmSync(fixture, { recursive: true, force: true });
}
console.log("Chinese voice: wake gating, strict commands, dictation isolation, permission/foreground gates, initialization cancellation and TTS stop: PASS");
