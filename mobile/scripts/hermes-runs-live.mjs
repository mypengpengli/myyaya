// Called by scripts/check-hermes.py --run-smoke. Credential enters over stdin only.
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("exports", "require", "module", code)(mod.exports, (name) => {
    if (!(name in mocks)) throw new Error("unexpected_import"); return mocks[name];
  }, mod);
  return mod.exports;
}
try {
  let stdin = "";
  for await (const chunk of process.stdin) stdin += chunk;
  const credentials = JSON.parse(stdin); stdin = "";
  const connection = load("src/hermes/connection.ts", { "expo-secure-store": {}, "expo/fetch": { fetch: globalThis.fetch } });
  const protocol = load("src/hermes/run-protocol.ts");
  const { createRunClient } = load("src/hermes/run-client.ts", {
    "./connection": connection, "./run-protocol": protocol, "expo/fetch": { fetch: globalThis.fetch },
  });
  const client = createRunClient({ version: 1, baseUrl: credentials.baseUrl, token: credentials.token });
  await client.discover();
  const id = randomUUID();
  const payload = JSON.stringify({ input: "这是 myyaya APK 的只读联调。请只运行一次终端命令 pwd，不修改文件，不调用其他工具。用中文简短报告当前目录。", session_id: `myyaya-smoke-${id}` });
  let run = await client.submit(payload, id);
  const controller = new AbortController();
  const seen = new Set();
  const stream = client.events(run.run_id, controller.signal, (event) => seen.add(event.event)).catch(() => {});
  const replay = await client.submit(payload, id);
  assert.equal(replay.run_id, run.run_id);
  const deadline = Date.now() + 120_000;
  while (!protocol.terminalRun(run.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    run = await client.status(run.run_id);
  }
  controller.abort(); await stream;
  assert.equal(run.status, "completed");
  assert.ok(typeof run.output === "string" && /\/[A-Za-z]/.test(run.output));
  assert.ok(seen.has("tool.started") && seen.has("tool.completed"));
  console.log(JSON.stringify({ passed: true, runId: run.run_id, status: run.status, idempotencyReplayedSameRun: true,
    events: [...seen].filter((name) => ["tool.started", "tool.completed", "run.completed"].includes(name)), directoryResultReceived: true }));
} catch (error) {
  console.log(JSON.stringify({ passed: false, errorType: error?.constructor?.name ?? "Error" }));
  process.exitCode = 1;
}
