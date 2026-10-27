import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const storage = new Map();
const secureStore = {
  getItemAsync: async (key) => storage.get(key) ?? null,
  setItemAsync: async (key, value) => storage.set(key, value),
  deleteItemAsync: async (key) => storage.delete(key),
};
const code = ts.transpileModule(fs.readFileSync("src/hermes/connection.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("exports", "require", "module", code)(module.exports, (name) => {
  if (name === "expo/fetch") return { fetch: (...args) => globalThis.fetch(...args) };
  assert.equal(name, "expo-secure-store");
  return secureStore;
}, module);
const api = module.exports;
const origin = api.DEFAULT_HERMES_ORIGIN;
const fixture = "fixture-hermes-token-value";

assert.equal(await api.readHermesConnection(), null, "first launch must allow an unconfigured connection");
assert.equal(api.normalizeHermesOrigin(origin + "/v1/"), origin);
const credentialUrl = new URL("https://example.com");
credentialUrl.username = "fixture";
credentialUrl.password = "fixture";
for (const url of ["http://example.com", credentialUrl.toString(), origin + "/admin", origin + "?token=fixture", origin + "#fragment"]) {
  assert.throws(() => api.normalizeHermesOrigin(url));
}
assert.equal(api.normalizeHermesToken(` Bearer ${fixture} `), fixture);
assert.throws(() => api.normalizeHermesToken("API_SERVER_KEY=" + fixture));
assert.throws(() => api.normalizeHermesToken("first\nsecond"));
assert.throws(() => api.resolveHermesConnection(origin, "", null));
const connection = api.resolveHermesConnection(origin, fixture, null);
await api.saveHermesConnection(connection);
assert.deepEqual(await api.readHermesConnection(), connection, "settings must survive a new read");
assert.deepEqual(api.resolveHermesConnection(origin, "", connection), connection, "empty input preserves the saved token");
assert.throws(() => api.resolveHermesConnection("https://other.example.com", "", connection),
  "a saved token must not silently move to another host");

const previousFetch = globalThis.fetch;
const calls = [];
let capabilitiesStatus = 200;
globalThis.fetch = async (url, options) => {
  calls.push({ url, options });
  const path = new URL(url).pathname;
  const authenticated = Boolean(options.headers.Authorization);
  const status = path === "/v1/capabilities" ? capabilitiesStatus : path === "/v1/models" && !authenticated ? 401 : 200;
  return {
    url, status, ok: status === 200,
    json: async () => path === "/v1/models" ? { data: [{ id: "hermes-agent" }] }
      : { features: { run_submission: true, run_status: true, run_events_sse: true, run_stop: true } },
  };
};
try {
  const result = await api.probeHermesConnection(connection);
  assert.equal(result.passed, true);
  assert.equal(calls.length, 4);
  assert.equal(calls.filter(({ options }) => options.headers.Authorization === `Bearer ${fixture}`).length, 2);
  assert.ok(calls.every(({ url, options }) => new URL(url).origin === origin && options.method === "GET" && options.redirect === "error"));
  assert.ok(calls.every(({ url }) => !url.includes(fixture) && !url.includes("/runs")), "probe must not submit tasks or put tokens in URLs");
  capabilitiesStatus = 401;
  assert.equal((await api.probeHermesConnection(connection)).passed, false, "failed auth must not be reported as connected");
} finally { globalThis.fetch = previousFetch; }

await api.clearHermesConnection();
assert.equal(await api.readHermesConnection(), null);
storage.set("myyaya.hermes.connection.v1", "corrupt");
assert.equal(await api.readHermesConnection(), null);
console.log("Hermes connection validation, SecureStore persistence and read-only discovery: PASS");
