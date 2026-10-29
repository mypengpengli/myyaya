import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
const require = createRequire(import.meta.url), ts = require("typescript");
const core = await import("@earendil-works/pi-agent-core"), { Type } = await import("typebox");
const compat = Object.assign({}, ...await Promise.all(["transcript", "event-stream", "identity", "json-parse", "validation"].map((name) => import(`@earendil-works/pi-ai/utils/${name}`))));
function load(file, mocks = {}) {
  const module = { exports: {} }, code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), module, module.exports); return module.exports;
}
const pure = load("src/skills/skill-service.ts");
const sql = new DatabaseSync(":memory:");
const sqlite = { openDatabaseSync: () => ({ execSync: (s) => sql.exec(s), runSync: (s, ...args) => sql.prepare(s).run(...args), getAllSync: (s) => sql.prepare(s).all() }) };
const openRuntime = () => load("src/skills/skill-runtime.ts", { "expo-sqlite": sqlite, "./skill-service": pure });
let runtime = openRuntime();
const base = { name: "photo-review", title: "照片回顾", description: "用户想回顾最近照片并固定展示时使用。", triggers: ["照片回顾"],
  instructions: "先列出当前作品，再打开本次找到的最近图片并固定。每次重新查编号；这是 reusable-photo-recipe。", requiredTools: ["list_artifacts", "show_artifact"], source: "experience" };
let latest = "original-photo", opened = [], stage = "perform", calls = 0;
function tools() {
  const skills = load("src/skills/skill-tools.ts", { typebox: { Type }, "./skill-runtime": runtime });
  const all = [
    { name: "list_artifacts", label: "查找作品", description: "列出作品", parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: JSON.stringify([{ id: latest, kind: "image" }]) }], details: {} }) },
    { name: "show_artifact", label: "展示作品", description: "打开作品", parameters: Type.Object({ id: Type.String(), pinned: Type.Boolean() }), execute: async (_id, args) => { opened.push(args); return { content: [{ type: "text", text: JSON.stringify({ id: args.id, pinned: args.pinned }) }], details: {} }; } },
  ];
  all.push(...skills.createSkillTools(() => all.map((tool) => tool.name))); return all;
}
let allTools = tools(), available = allTools.map((tool) => tool.name);
assert.throws(() => runtime.getSkillService().save(base, available, []), /成功调用依据/);
const { CompanionAgent } = load("src/agent/companion-agent.ts", { "@earendil-works/pi-agent-core": core });
const { createNewApiStream } = load("src/agent/newapi-stream.ts", { "./pi-mobile-compat": compat });
const config = { version: 1, baseUrl: "https://example.test/v1", apiKey: "test-only-fixture", model: "test-model" };
function response(call, args) {
  const delta = call ? { tool_calls: [{ index: 0, id: `call-${stage}-${calls}`, function: { name: call, arguments: JSON.stringify(args) } }] } : { content: "已经完成。" };
  const wire = [{ choices: [{ delta, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }].map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(wire, { headers: { "Content-Type": "text/event-stream" } });
}
const transport = async (_url, init) => {
  calls++; const body = JSON.parse(init.body);
  if (stage === "learn") return calls === 1 ? response("skill_save", base) : response();
  if (stage === "automatic") assert.ok(body.messages[0].content.includes("reusable-photo-recipe"), "matching trigger injects full instructions after restart, without an explicit skill request");
  if (stage === "semantic" && calls === 1) {
    assert.ok(body.messages[0].content.includes("photo-review"));
    assert.ok(!body.messages[0].content.includes("reusable-photo-recipe"), "unmatched skills advertise metadata only");
    return response("skill_read", { name: "photo-review" });
  }
  const step = calls - (stage === "semantic" ? 1 : 0);
  if (stage === "semantic" && step > 0) assert.ok(body.messages.some((message) => typeof message.content === "string" && message.content.includes("reusable-photo-recipe")), "skill_read returns real SKILL.md to Pi before executing the workflow");
  if (step === 1) return response("list_artifacts", {});
  if (step === 2) return response("show_artifact", { id: latest, pinned: true });
  return response();
};
function agent() { return new CompanionAgent(config, createNewApiStream(config, transport), allTools, () => {}, runtime.observeSkillTool, runtime.observeSkillReply); }
let companion = agent();
await companion.reply("打开最近照片并固定", new AbortController().signal);
assert.equal(opened.at(-1).id, "original-photo");
stage = "learn"; calls = 0;
await companion.reply("总结刚才成功的做法，保存为照片回顾技能", new AbortController().signal);
assert.equal(runtime.getSkillService().get("photo-review").current.source, "experience");
assert.deepEqual(runtime.getSkillService().get("photo-review").current.evidenceTools, ["list_artifacts", "show_artifact"]);
const verbal = runtime.getSkillService().save({ ...base, name: "story-outline", requiredTools: [], triggers: ["故事提纲"] }, available, runtime.skillEvidence());
assert.deepEqual(verbal.current.evidenceTools, ["assistant_reply"], "language-only methods can be learned from a successfully completed reply");
runtime.getSkillService().remove("story-outline");

// New JS runtime and fresh Pi transcript, same durable SQLite database.
runtime = openRuntime(); allTools = tools(); available = allTools.map((tool) => tool.name); companion = agent();
latest = "different-photo-after-restart"; stage = "automatic"; calls = 0;
companion.restoreContext("{}", runtime.prepareSkillContext("来一次照片回顾", available));
await companion.reply("来一次照片回顾", new AbortController().signal);
assert.equal(opened.at(-1).id, latest); assert.equal(opened.at(-1).pinned, true);
assert.equal(runtime.getSkillService().get("photo-review").uses, 1);
runtime.readSkillForAgent("photo-review", available);
assert.equal(runtime.getSkillService().get("photo-review").uses, 1, "repeated reads during one turn do not inflate usage");

companion = agent(); latest = "third-current-photo"; stage = "semantic"; calls = 0;
companion.restoreContext("{}", runtime.prepareSkillContext("重新看看最近存的图片", available));
await companion.reply("重新看看最近存的图片", new AbortController().signal);
assert.equal(opened.at(-1).id, latest);
assert.equal(runtime.getSkillService().get("photo-review").uses, 2);
const service = runtime.getSkillService();
const v2 = service.save({ ...base, source: "user", instructions: "更新后的步骤", expectedRevision: 1 }, available);
assert.equal(v2.current.revision, 2);
assert.throws(() => service.save({ ...base, source: "user", instructions: "stale update", expectedRevision: 1 }, available), /版本已变化/);
assert.equal(service.save({ ...base, source: "user", instructions: "更新后的步骤" }, available).current.revision, 2, "same-content retry does not create another revision");
assert.equal(service.restore("photo-review", 1).current.revision, 3);
assert.equal(service.get("photo-review").current.instructions, base.instructions);
service.setEnabled("photo-review", false);
assert.deepEqual(service.catalog(available), []); assert.deepEqual(service.matching("照片回顾", available), []);
assert.throws(() => runtime.readSkillForAgent("photo-review", available), /停用/);
service.setEnabled("photo-review", true);
assert.deepEqual(service.catalog(["show_artifact"]), []);
assert.throws(() => service.read("photo-review", ["show_artifact"]), /缺少工具/);
assert.throws(() => service.save({ ...base, name: "../escape", source: "user" }, available), /技能编号/);
assert.throws(() => service.save({ ...base, name: "new", requiredTools: ["invented_tool"], source: "user" }, available), /尚未接入/);
assert.throws(() => service.save({ ...base, name: "new", instructions: "sk-" + "a".repeat(40), source: "user" }, available), /不能保存/);
runtime.observeSkillTool("hermes_submit", false, { content: [{ type: "text", text: '{"accepted":true,"status":"running"}' }] });
assert.ok(!runtime.skillEvidence().includes("hermes_submit"), "accepted async work is not proof of a successful workflow");
runtime.observeSkillTool("hermes_status", false, { content: [{ type: "text", text: '[{"status":"completed"}]' }] });
assert.ok(runtime.skillEvidence().includes("hermes_submit"));
const broken = new pure.SkillService({ list: () => [], save() { throw Error("disk full"); }, remove() {} });
assert.throws(() => broken.save({ ...base, source: "user" }, available), /disk full/); assert.equal(broken.getSnapshot().length, 0);
service.remove("photo-review"); assert.equal(openRuntime().getSkillService().getSnapshot().length, 0);
console.log("Skills + actual Pi: successful-tool learning, durable SKILL.md, restart auto-use, lazy loading, fresh artifact IDs, versions/restore, disable, capability checks and atomic persistence: PASS");
