import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
const core = await import("@earendil-works/pi-agent-core");
const compat = Object.assign({}, ...await Promise.all(["transcript", "event-stream", "identity", "json-parse", "validation"]
  .map((name) => import(`@earendil-works/pi-ai/utils/${name}`))));
const { Type } = await import("typebox");
function load(path, mocks) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const { createNewApiStream, toNewApiMessages } = load("src/agent/newapi-stream.ts", { "./pi-mobile-compat": compat });
const { CompanionAgent } = load("src/agent/companion-agent.ts", { "@earendil-works/pi-agent-core": core });
const config = { version: 1, baseUrl: "https://example.invalid/v1", apiKey: "test-only-not-a-real-key", model: "test-model" };
function sse(chunks, truncate = false) {
  const wire = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join("") + (truncate ? "" : "data: [DONE]\n\n");
  const bytes = new TextEncoder().encode(wire);
  return new Response(new ReadableStream({ start(controller) {
    // Deliberately split inside multibyte Chinese and JSON argument strings.
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}
const choice = (delta, finish_reason = null) => ({ choices: [{ delta, finish_reason }] });
let executions = 0, requests = 0;
const progress = [];
const transport = async (_url, init) => {
  assert.equal(init.redirect, "error");
  assert.equal(init.headers.Authorization, "Bearer test-only-not-a-real-key");
  const body = JSON.parse(init.body); requests++;
  assert.equal(body.tools[0].function.name, "read_phone");
  if (requests === 1) {
    assert.equal(body.messages.at(-1).content[0].text, "底座连上了吗？");
    return sse([choice({ tool_calls: [{ index: 0, id: "call_a", function: { name: "read_phone", arguments: '{"label":' } }] }),
      choice({ tool_calls: [{ index: 0, function: { arguments: '"底座"}' } }] }), choice({}, "tool_calls")]);
  }
  assert.equal(body.messages.at(-1).role, "tool");
  assert.equal(body.messages.at(-1).tool_call_id, "call_a");
  assert.equal(body.messages.at(-1).content, "底座已连接");
  return sse([choice({ content: "已经" }), choice({ content: "连接好了。" }), choice({}, "stop")]);
};
const agent = new CompanionAgent(config, createNewApiStream(config, transport), [{ name: "read_phone", label: "正在检查底座",
  description: "读取状态", parameters: Type.Object({ label: Type.String() }), execute: async (_id, args) => {
    executions++; assert.equal(args.label, "底座"); return { content: [{ type: "text", text: "底座已连接" }], details: {} };
  } }], (value) => progress.push(value));
assert.equal(await agent.reply("底座连上了吗？", new AbortController().signal), "已经连接好了。");
assert.equal(executions, 1); assert.equal(requests, 2);
assert.ok(progress.some((item) => item.label === "正在检查底座"));

// Official Pi must reject invalid parameters; malformed calls never reach hardware.
let invalidRequests = 0;
const invalid = new CompanionAgent(config, createNewApiStream(config, async (_url, init) => {
  invalidRequests++;
  if (invalidRequests === 1) return sse([choice({ tool_calls: [{ index: 0, id: "bad", function: { name: "read_phone", arguments: '{"label":42}' } }] }), choice({}, "tool_calls")]);
  assert.match(JSON.parse(init.body).messages.at(-1).content, /label|valid/i);
  return sse([choice({ content: "参数有误。" }), choice({}, "stop")]);
}), [{ name: "read_phone", label: "检查", description: "读取", parameters: Type.Object({ label: Type.String() }),
  execute: async () => { throw new Error("invalid arguments reached tool"); } }], () => {});
assert.equal(await invalid.reply("检查", new AbortController().signal), "参数有误。");

const broken = new CompanionAgent(config, createNewApiStream(config, async () => sse([choice({ content: "不应当被朗读" })], true)), [], () => {});
await assert.rejects(broken.reply("你好", new AbortController().signal), /连接中断/);
const httpError = new CompanionAgent(config, createNewApiStream(config, async () => new Response("secret private provider body", { status: 401 })), [], () => {});
await assert.rejects(httpError.reply("你好", new AbortController().signal), /HTTP 401/);
const abort = new AbortController(); abort.abort();
await assert.rejects(agent.reply("不能发出请求", abort.signal), /停止/);
assert.equal(requests, 2);
const converted = toNewApiMessages([{ role: "assistant", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "公开回复" }], timestamp: 0 }]);
assert.equal(converted[0].content, "公开回复");
assert.equal(JSON.stringify(converted).includes("private"), false);
console.log("Actual Pi agent + NewAPI: fragmented UTF-8 SSE, tool replay/validation, public progress, truncation, HTTP errors and cancellation: PASS");
