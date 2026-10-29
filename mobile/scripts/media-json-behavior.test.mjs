import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript"), module = { exports: {} };
new Function("module", "exports", ts.transpileModule(readFileSync("src/artifacts/media-json.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(module, module.exports);
const { readMediaJson, MediaJsonReadError } = module.exports;
const original = { data: [{ b64_json: "example", caption: '小丫 {inside} "quoted" \\ end' }] };
const bytes = new TextEncoder().encode("\uFEFF \n" + JSON.stringify(original));
let cancelled = false;
const reports = [];
const open = new Response(new ReadableStream({
  start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); },
  cancel() { cancelled = true; return new Promise(() => {}); },
}), { headers: { "content-type": "application/json; charset=utf-8", "x-request-id": "req-test-1" } });
let timer;
try {
  assert.deepEqual(await Promise.race([readMediaJson(open, { report: (item) => reports.push(item) }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error("complete JSON must not wait for EOF/cancel acknowledgement")), 1000); })]), original);
} finally { clearTimeout(timer); }
assert.equal(cancelled, true);
assert.equal(reports.at(-1).stage, "complete");
assert.equal(reports.at(-1).requestId, "req-test-1");
assert.equal(reports.at(-1).receivedBytes, bytes.length);
assert.equal(JSON.stringify(reports).includes("caption"), false);
for (const [body, type, reason] of [["", "application/json", "empty"], ["<html>private error body</html>", "text/html", "non-json"],
  ['{"data":[', "application/json", "incomplete"], ['{"data":]}', "application/json", "invalid-json"], ['{}garbage', "application/json", "invalid-json"]]) {
  await assert.rejects(readMediaJson(new Response(body, { headers: { "content-type": type } })),
    (error) => error instanceof MediaJsonReadError && error.diagnostic.reason === reason && !error.message.includes("private"));
}
await assert.rejects(readMediaJson(new Response('{"data":"too long"}'), { maxBytes: 4 }), (error) => error.diagnostic.reason === "too-large");
await assert.rejects(readMediaJson(new Response(new ReadableStream({ start(controller) { controller.error(Error("private transport error")); } }))),
  (error) => error.diagnostic.reason === "read-failed" && !JSON.stringify(error).includes("private"));
const abort = new AbortController(); abort.abort();
await assert.rejects(readMediaJson(new Response("{}"), { signal: abort.signal }), (error) => error.diagnostic.reason === "aborted");
const during = new AbortController();
const stuck = readMediaJson(new Response(new ReadableStream({ cancel() { return new Promise(() => {}); } })), { signal: during.signal });
during.abort();
await assert.rejects(stuck, (error) => error.diagnostic.reason === "aborted", "deadline returns even if native reads and cancellation never settle");
console.log("Media JSON: bounded fragmented UTF-8, complete object without EOF, non-blocking cancel and body-free failure diagnostics: PASS");
