import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
function load(path, mocks) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)((name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const values = new Map();
const config = load("src/search/tavily-config.ts", { "expo-secure-store": {
  getItemAsync: async (key) => values.get(key) ?? null, setItemAsync: async (key, value) => values.set(key, value),
  deleteItemAsync: async (key) => values.delete(key),
} });
const key = "tvly-" + "test-only-".repeat(4);
await assert.rejects(config.saveTavilyKey("https://not-a-key.invalid"), /有效/);
await config.saveTavilyKey(` Bearer ${key} `);
assert.equal(await config.readTavilyKey(), key);
let calls = [], mode = "ok";
const search = load("src/search/tavily-search.ts", { "./tavily-config": config, "expo/fetch": { fetch: async (url, init) => {
  calls.push({ url, init });
  if (mode === "wait") return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error(key)), { once: true }));
  if (mode === "network") throw new Error(`headers contain ${key}`);
  if (mode === "unauthorized") return new Response(JSON.stringify({ error: key }), { status: 401 });
  if (mode === "quota") return new Response(JSON.stringify({ error: key }), { status: 432 });
  if (mode === "bad") return new Response(JSON.stringify({ detail: key }));
  return new Response(JSON.stringify({ results: [
    { title: "官方来源", url: "https://example.org/news", content: "这是摘录 " + key, published_date: "2026-10-28" },
    { title: "恶意地址", url: "javascript:alert(1)", content: "不应进入结果" },
    { title: "含账号地址", url: "https://account:password@" + "example.org/", content: "不应进入结果" },
  ] }));
} } });
const result = await search.searchWeb({ query: "最新机器人资料", topic: "news", timeRange: "week" });
assert.equal(calls[0].url, "https://api.tavily.com/search");
assert.equal(calls[0].init.redirect, "error");
assert.equal(calls[0].init.headers.Authorization, `Bearer ${key}`);
const body = JSON.parse(calls[0].init.body);
assert.deepEqual([body.search_depth, body.max_results, body.auto_parameters, body.time_range, body.safe_search], ["basic", 5, false, "week", true]);
assert.equal(JSON.stringify(body).includes(key), false);
assert.equal(result.sources.length, 1);
assert.equal(result.sources[0].publishedAt, "2026-10-28");
assert.equal(JSON.stringify(result).includes(key), false);
assert.ok(Number.isFinite(Date.parse(result.searchedAt)));
await assert.rejects(search.searchWeb({ query: " " }), /1 到 500/);
const before = calls.length;
const stopped = new AbortController(); stopped.abort();
await assert.rejects(search.searchWeb({ query: "不应发送" }, stopped.signal), /取消/);
assert.equal(calls.length, before);
for (const [next, pattern] of [["unauthorized", /Key 无效/], ["quota", /配额/], ["network", /连接失败/], ["bad", /格式异常/]]) {
  mode = next;
  await assert.rejects(search.searchWeb({ query: "测试" }), (error) => pattern.test(error.message) && !error.message.includes(key));
}
mode = "wait";
const controller = new AbortController();
const pending = search.searchWeb({ query: "需要停止的搜索" }, controller.signal);
for (let i = 0; i < 20; i++) await Promise.resolve();
controller.abort(); await assert.rejects(pending, /取消/);
mode = "ok";
const rotated = key + "new";
await config.saveTavilyKey(rotated);
await search.searchWeb({ query: "更换后的配置" });
assert.equal(calls.at(-1).init.headers.Authorization, `Bearer ${rotated}`);
await config.clearTavilyKey();
const count = calls.length;
await assert.rejects(search.searchWeb({ query: "没有配置" }), /尚未配置/);
assert.equal(calls.length, count);

// Exercise the real Pi loop, including tool schema validation and result replay.
await config.saveTavilyKey(key);
const core = await import("@earendil-works/pi-agent-core");
const { Type } = await import("typebox");
const compat = Object.assign({}, ...await Promise.all(["transcript", "event-stream", "identity", "json-parse", "validation"]
  .map((name) => import(`@earendil-works/pi-ai/utils/${name}`))));
const { webSearchTool } = load("src/search/web-search-tool.ts", { typebox: { Type }, "./tavily-search": search });
const { CompanionAgent } = load("src/agent/companion-agent.ts", { "@earendil-works/pi-agent-core": core });
const { createNewApiStream } = load("src/agent/newapi-stream.ts", { "./pi-mobile-compat": compat });
let requests = 0; const progress = [];
const stream = createNewApiStream({ baseUrl: "https://example.invalid/v1", apiKey: "model-test-only" }, async (_url, init) => {
  const messages = JSON.parse(init.body).messages;
  assert.equal(JSON.stringify(messages).includes(key), false, "search credentials never enter the model transcript");
  const delta = ++requests === 1 ? { tool_calls: [{ index: 0, id: "search-1", function: { name: "web_search", arguments: JSON.stringify({ query: "查最新机器人资料", topic: "news" }) } }] }
    : { content: "根据官方来源，已经查到资料。" };
  if (requests === 2) assert.match(messages.at(-1).content, /example\.org\/news/);
  return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: requests === 1 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } });
});
const agent = new CompanionAgent({ baseUrl: "https://example.invalid/v1", model: "test", apiKey: "model-test-only" }, stream, [webSearchTool], (event) => progress.push(event));
assert.match(await agent.reply("帮我上网查资料", new AbortController().signal), /官方来源/);
assert.equal(requests, 2);
assert.ok(progress.some((event) => event.label === "正在搜索网络资料"));
console.log("Tavily: secure configuration, bounded sourced results, failures, cancellation, key rotation and real Pi tool replay: PASS");
