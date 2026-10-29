import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
const core = await import("@earendil-works/pi-agent-core");
const compat = Object.assign({}, ...await Promise.all(["transcript", "event-stream", "identity", "json-parse", "validation"]
  .map((name) => import(`@earendil-works/pi-ai/utils/${name}`))));
const { Type } = await import("typebox");
function load(path, mocks, clock = { setTimeout, clearTimeout }) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", code)((name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports, clock.setTimeout, clock.clearTimeout);
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
// A gateway can leave its HTTP stream open after [DONE]. Finish without waiting for EOF/timeout.
let cancelledOpenStream = false;
const openStream = new CompanionAgent(config, createNewApiStream(config, async () => new Response(new ReadableStream({
  start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(choice({ content: "已经完成" }))}\n\ndata: ${JSON.stringify(choice({}, "stop"))}\n\ndata: [DONE]\n\n`)); },
  cancel() { cancelledOpenStream = true; },
}))), [], () => {});
assert.equal(await openStream.reply("完成了吗", new AbortController().signal), "已经完成");
assert.equal(cancelledOpenStream, true);
// Some compatible gateways omit [DONE]; native cancellation may never settle.
const finishWithoutDone = new CompanionAgent(config, createNewApiStream(config, async () => new Response(new ReadableStream({
  start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(choice({ content: "完整回复" }))}\n\ndata: ${JSON.stringify(choice({}, "stop"))}\n\n`)); },
  cancel() { return new Promise(() => {}); },
}))), [], () => {});
let finishTimer;
try {
  assert.equal(await Promise.race([finishWithoutDone.reply("完成了吗", new AbortController().signal), new Promise((_, reject) => {
    finishTimer = setTimeout(() => reject(Error("terminal SSE frame must finish without network EOF/cancel acknowledgement")), 1000);
  })]), "完整回复");
} finally { clearTimeout(finishTimer); }
// Advance a local clock, without a real 100-second wait. Incoming chunks rearm
// the idle deadline; the absolute bound still prevents endless heartbeat streams.
let virtualTime = 0, timerId = 0, nativeController, requestSignal;
const timers = new Map();
const virtualClock = {
  setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: virtualTime + delay }); return id; },
  clearTimeout(id) { timers.delete(id); },
};
const advance = (ms) => { virtualTime += ms; for (const [id, value] of [...timers]) if (value.at <= virtualTime) { timers.delete(id); value.fn(); } };
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const idleAdapter = load("src/agent/newapi-stream.ts", { "./pi-mobile-compat": compat }, virtualClock);
const gradual = new CompanionAgent(config, idleAdapter.createNewApiStream(config, async (_url, init) => {
  requestSignal = init.signal;
  return new Response(new ReadableStream({ start(controller) { nativeController = controller; } }));
}), [], () => {});
const slowReply = gradual.reply("慢慢回复", new AbortController().signal); await flush();
advance(50_000); nativeController.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(choice({ content: "持续" }))}\n\n`)); await flush();
advance(50_000); assert.equal(requestSignal.aborted, false, "an active reply can last longer than sixty seconds");
nativeController.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(choice({ content: "回复" }))}\n\ndata: ${JSON.stringify(choice({}, "stop"))}\n\n`));
assert.equal(await slowReply, "持续回复"); assert.equal(timers.size, 0);
assert.equal(requestSignal.aborted, true, "a completed open stream releases the actual native request, not only its JS reader");

// CR-only framing is valid SSE. A compatible relay may omit the final newline.
for (const separator of ["\r", "\r\n", "\n"]) {
  let nativeSignal, cleanup = false;
  const diagnostics = [];
  const framed = new CompanionAgent(config, createNewApiStream(config, async (_url, init) => {
    nativeSignal = init.signal;
    assert.match(init.headers["X-Client-Request-Id"], /^myyaya-chat-/);
    return new Response(new ReadableStream({ start(controller) {
      const data = `data: ${JSON.stringify(choice({ content: "完整中文回复" }))}${separator}${separator}data: ${JSON.stringify(choice({}, "stop"))}`;
      const bytes = new TextEncoder().encode(data);
      for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5));
      // Keep the native connection open after a complete terminal JSON object.
    }, cancel() { cleanup = true; return new Promise(() => {}); } }), {
      headers: { "content-type": "text/event-stream", "x-request-id": "server-request-fixture" },
    });
  }, (value) => diagnostics.push(value)), [], () => {});
  let deadline;
  try {
    assert.equal(await Promise.race([framed.reply("private user text", new AbortController().signal), new Promise((_, reject) => {
      deadline = setTimeout(() => reject(Error("complete terminal JSON must not wait for a missing newline")), 1000);
    })]), "完整中文回复");
  } finally { clearTimeout(deadline); }
  assert.ok(nativeSignal.aborted && cleanup);
  assert.equal(diagnostics.at(-1).stage, "complete");
  assert.equal(diagnostics.at(-1).status, 200);
  assert.equal(diagnostics.at(-1).requestId, "server-request-fixture");
  assert.equal(diagnostics.at(-1).completionSeen, true);
  assert.ok(diagnostics.at(-1).receivedBytes > 0);
  assert.equal(/private user text|完整中文回复|test-only-not-a-real-key/.test(JSON.stringify(diagnostics)), false);
}
// A transport that ignores AbortSignal must not strand Pi indefinitely.
for (const phase of ["request", "body"]) {
  const diagnostics = [];
  const idle = new CompanionAgent(config, idleAdapter.createNewApiStream(config, async () => phase === "request"
    ? new Promise(() => {})
    : new Response(new ReadableStream({ start() {}, cancel() { return new Promise(() => {}); } }), {
      headers: { "content-type": "text/event-stream", "x-request-id": "server-idle-fixture" },
    }), (value) => diagnostics.push(value)), [], () => {});
  const response = idle.reply("bounded wait", new AbortController().signal);
  // Register the rejection handler before advancing the virtual deadline.
  const rejected = assert.rejects(response, phase === "request" ? /等待模型响应超时/ : /接收模型回复超时/);
  await flush(); advance(60_001); await flush(); await rejected;
  assert.equal(diagnostics.at(-1).reason, "idle-timeout");
  assert.equal(diagnostics.at(-1).receivedBytes, 0);
  assert.equal(diagnostics.at(-1).status, phase === "request" ? undefined : 200);
  assert.equal(diagnostics.at(-1).requestId, phase === "request" ? undefined : "server-idle-fixture");
  assert.equal(timers.size, 0);
}
// The user must hear a real submission receipt when only the following model
// reply fails; a new turn may not reuse that receipt or replay generation.
let submissions = 0, receiptRequests = 0;
const receiptAgent = new CompanionAgent(config, createNewApiStream(config, async () => {
  if (++receiptRequests === 1) return sse([choice({ tool_calls: [{ index: 0, id: "media-call", function: { name: "create_media", arguments: "{}" } }] }), choice({}, "tool_calls")]);
  return new Response("private provider body", { status: 502 });
}), [{ name: "create_media", description: "fixture", parameters: Type.Object({}), execute: async () => {
  submissions++; return { content: [{ type: "text", text: JSON.stringify({ id: "persisted-media-job", status: "submitting", resolution: "2K" }) }], details: {} };
} }], () => {});
assert.match(await receiptAgent.reply("generate once", new AbortController().signal), /2K.*任务已在手机建立.*回答没有收完整/);
assert.equal(submissions, 1);
await assert.rejects(receiptAgent.reply("an unrelated next turn", new AbortController().signal), /HTTP 502/);
assert.equal(submissions, 1, "a final model failure never replays an accepted media tool");
console.log("Actual Pi agent + NewAPI: fragmented UTF-8 SSE, tool replay/validation, public progress, truncation, HTTP errors and cancellation: PASS");
