import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("exports", "require", "module", code)(mod.exports, (name) => {
    assert.ok(name in mocks, `unexpected import ${name}`); return mocks[name];
  }, mod);
  return mod.exports;
}
const protocol = load("src/hermes/run-protocol.ts");
const { HermesTaskService } = load("src/hermes/task-service.ts", { "./run-protocol": protocol });
const { createRunClient, HermesHttpError } = load("src/hermes/run-client.ts", {
  "./run-protocol": protocol, "./connection": { resolveHermesConnection: (url, token) => ({ baseUrl: url, token }) },
  "expo/fetch": { fetch: (...args) => fetchMock(...args) },
});
const events = [];
const parser = new protocol.RunEventParser((event) => events.push(event));
const frames = ': keepalive\r\ndata: {"event":"tool.started","tool":"terminal"}\r\n\r\nevent: ignored-name\ndata: {"event":"message.interim",\ndata: "text":"中文进度"}\n\nevent: tool.completed\ndata: {"tool":"terminal","error":false}\n\ndata: invalid\n\n';
for (const char of frames) parser.push(char);
assert.deepEqual(events.map((event) => event.event), ["tool.started", "message.interim", "tool.completed"]);
assert.equal(events[1].text, "中文进度");
assert.throws(() => new protocol.RunEventParser(() => {}).push("x".repeat(1_048_577)));

// Exercise the real SQLite repository through node:sqlite, including a fresh service instance.
const sql = new DatabaseSync(":memory:");
const { hermesTaskRepository: repository } = load("src/hermes/run-store.ts", { "expo-sqlite": { openDatabaseSync: () => ({
  execSync: (statement) => sql.exec(statement),
  getAllSync: (statement) => sql.prepare(statement).all(),
  runSync: (statement, ...args) => sql.prepare(statement).run(...args),
}) } });
let clock = 1_000, sequence = 0;
const uuid = () => `fixture-task-${++sequence}`;
let service = new HermesTaskService(repository, uuid, () => clock);
const origin = "https://example.com", account = "fixture-account";
const task = service.create("  检查目录  ", origin, account);
assert.equal(repository.list()[0].input, "检查目录");
const calls = [];
let loseResponse = true;
const client = {
  discover: async () => {},
  submit: async (body, key) => { calls.push({ body, key }); assert.equal(repository.list()[0].id, key);
    if (loseResponse) throw new Error("network_after_server_acceptance");
    return { run_id: "run_fixture", status: "started" }; },
  status: async () => ({ run_id: "run_fixture", status: "running" }),
  stop: async () => ({ run_id: "run_fixture", status: "stopping" }),
};
await service.submit(task.id, origin, account, client);
assert.equal(service.list()[0].runId, null);
service = new HermesTaskService(repository, uuid, () => clock);
loseResponse = false;
await service.submit(task.id, origin, account, client);
assert.deepEqual(calls[0], calls[1], "lost-response retry must preserve exact payload and key after restart");
assert.equal(service.list()[0].runId, "run_fixture");
await service.submit(task.id, origin, account, client);
assert.equal(calls.length, 2, "known run IDs may only be polled, never resubmitted");
await assert.rejects(service.refresh(task.id, origin, "other-credential", client));
await assert.rejects(service.stop(task.id, "https://other.example.com", account, client));
service.acceptEvent(task.id, { event: "reasoning.delta", text: "private" });
service.acceptEvent(task.id, { event: "message.delta", text: "streamed-answer" });
assert.equal(service.list()[0].progress.length, 0);
for (const event of events) service.acceptEvent(task.id, event);
assert.equal(service.list()[0].progress.length, 3);
await service.stop(task.id, origin, account, client);
assert.equal(service.list()[0].status, "stopping", "stop ack must not falsely declare cancellation");
await service.refresh(task.id, origin, account, client);
assert.equal(service.list()[0].status, "stopping", "a pre-stop running poll cannot undo an acknowledged stop request");
client.status = async () => ({ run_id: "run_fixture", status: "cancelled" });
await service.refresh(task.id, origin, account, client);
service.applySnapshot(task.id, { run_id: "run_fixture", status: "running" });
assert.equal(service.list()[0].status, "cancelled", "late polls must not resurrect terminal tasks");
assert.throws(() => service.applySnapshot(task.id, { run_id: "wrong_id", status: "completed" }));
const old = service.create("past retry window", origin, account);
clock += 24 * 3600 * 1000;
await assert.rejects(service.submit(old.id, origin, account, client), /安全重试期限/);
const failing = new HermesTaskService({ list: () => [], save: () => { throw new Error("disk_full"); } }, uuid);
assert.throws(() => failing.create("must persist first", origin, account));
assert.deepEqual(failing.list(), [], "a failed durable write must not publish a phantom task");

// Real client stop contract and byte-stream decoding, not a parallel implementation.
let fetchCalls = [];
let fetchMock = async (url, options) => {
  fetchCalls.push({ url, options });
  if (url.endsWith("/stop")) return new Response(JSON.stringify({ status: "stopping" }));
  if (url.endsWith("/capabilities")) return new Response(JSON.stringify({ features: { run_submission: true, run_status: true, run_events_sse: true, run_stop: true } }));
  if (url.endsWith("/events")) {
    const bytes = new TextEncoder().encode(frames);
    return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }));
  }
  return new Response(JSON.stringify({ run_id: "run_fixture", status: "started" }));
};
const transport = createRunClient({ version: 1, baseUrl: origin, token: "fixture-token" });
await transport.discover();
assert.equal((await transport.stop("run_fixture")).status, "stopping");
await transport.submit(task.payload, task.id);
const delivered = [];
await transport.events("run_fixture", new AbortController().signal, (event) => delivered.push(event));
assert.deepEqual(delivered, events);
assert.ok(fetchCalls.every(({ url, options }) => !url.includes("fixture-token") && options.redirect === "error"));
assert.equal(fetchCalls[2].options.headers["Idempotency-Key"], task.id);
fetchMock = async () => new Response("secret_response_must_not_escape", { status: 401 });
await assert.rejects(transport.status("run_fixture"), (error) => error instanceof HermesHttpError && error.status === 401 && !error.message.includes("secret_response"));
sql.close();

// Run the production monitor with controlled app state and clock scheduling.
// Restoring a known run must use GET, never create another server job.
const nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
const scheduled = new Map(); let timerId = 0;
let currentConnection = { version: 1, baseUrl: origin, token: "fixture-token" };
let connectionRead = async () => currentConnection;
let onAppState = null;
const appState = { currentState: "active", addEventListener: (_name, listener) => {
  onAppState = listener; return { remove: () => { onAppState = null; } };
} };
const savedTasks = [ { ...task, runId: "run_restored", status: "running", output: "", progress: [] }, { ...task, id: "pending_restored", runId: null } ];
const memoryRepository = { list: () => savedTasks, save: (value) => {
  const index = savedTasks.findIndex((item) => item.id === value.id); savedTasks[index] = value;
} };
let queries = 0, creates = 0;
const attached = [];
const monitorClient = {
  status: async () => { queries++; return { run_id: "run_restored", status: "running" }; },
  submit: async () => { creates++; throw new Error("monitor_must_not_submit"); },
  events: async (_id, signal, emit) => {
    attached.push({ signal, emit });
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
  },
};
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let disposeMonitor;
try {
  globalThis.setTimeout = (fn, delay) => { const id = ++timerId; scheduled.set(id, { fn, delay }); return id; };
  globalThis.clearTimeout = (id) => { scheduled.delete(id); };
  const runtime = load("src/hermes/task-runtime.ts", {
    "expo-crypto": { randomUUID: uuid, CryptoDigestAlgorithm: { SHA256: "SHA256" },
      digestStringAsync: async (_algorithm, value) => value.endsWith("fixture-token") ? account : "other-account" },
    "react-native": { AppState: appState }, "./connection": { readHermesConnection: () => connectionRead() },
    "./run-client": { createRunClient: () => monitorClient }, "./run-protocol": protocol,
    "./run-store": { hermesTaskRepository: memoryRepository }, "./task-service": { HermesTaskService },
    "../artifacts/artifact-focus": { updateArtifactFocus() {} }, "./history-client": { createHermesHistoryClient() { throw Error("history not needed during monitor"); } },
  });
  const poll = async () => {
    const next = [...scheduled.entries()].find(([, value]) => value.delay === 3_000);
    assert.ok(next, "monitor must schedule its next bounded poll");
    scheduled.delete(next[0]); next[1].fn(); await drain();
  };
  disposeMonitor = runtime.startHermesTaskMonitor(); await drain();
  assert.equal(queries, 1); assert.equal(creates, 0); assert.equal(attached.length, 1);
  attached[0].emit({ event: "tool.started", tool: "terminal" });
  assert.equal(runtime.getHermesTaskService().list().find((item) => item.id === task.id).progress.length, 1);
  appState.currentState = "background"; onAppState("background"); await drain();
  assert.equal(attached[0].signal.aborted, true, "background must release the stream without stopping the server job");
  attached[0].emit({ event: "tool.completed", tool: "late" });
  await poll(); assert.equal(queries, 1, "background must not keep polling");
  appState.currentState = "active"; onAppState("active"); await poll();
  assert.equal(queries, 2); assert.equal(creates, 0);
  assert.equal(runtime.getHermesTaskService().list().find((item) => item.id === task.id).progress.length, 1,
    "events arriving after transport cancellation must not mutate restored task state");
  currentConnection = { ...currentConnection, token: "other-token" }; await poll();
  assert.equal(queries, 2, "changed credentials must not query or replay tasks from another binding");
  disposeMonitor(); await drain(); assert.equal(scheduled.size, 0);
  let resolveConnection;
  connectionRead = () => new Promise((resolve) => { resolveConnection = resolve; });
  disposeMonitor = runtime.startHermesTaskMonitor(); disposeMonitor();
  resolveConnection(currentConnection); await drain();
  assert.equal(scheduled.size, 0, "late configuration loading cannot revive a disposed monitor");
} finally {
  disposeMonitor?.(); globalThis.setTimeout = nativeSetTimeout; globalThis.clearTimeout = nativeClearTimeout;
}
console.log("Hermes runs: SQLite recovery, idempotency, stop reconciliation, UTF-8 SSE and foreground monitor lifecycle: PASS");
