import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = fs.readFileSync('src/updates/update-source.ts', 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'module', output)(mod.exports, mod);
const { resolveUpdateSource, requireHttpsUpdateUrl } = mod.exports;

assert.equal(resolveUpdateSource().repository, 'mypengpengli/myyaya');
assert.equal(resolveUpdateSource().feedUrl, 'https://api.github.com/repos/mypengpengli/myyaya/releases/latest');
assert.equal(resolveUpdateSource({ updateFeedUrl: 'https://updates.example.com/myyaya/latest.json' }).feedUrl,
  'https://updates.example.com/myyaya/latest.json');
assert.equal(resolveUpdateSource({ updateRepository: 'owner/downloads' }).feedUrl,
  'https://api.github.com/repos/owner/downloads/releases/latest');
const credentialUrl = new URL('https://example.com/app.apk');
credentialUrl.username = 'fixture';
for (const value of ['http://example.com/app.apk', 'file:///app.apk', credentialUrl.toString(), 'https://example.com/app.apk#hash']) {
  assert.throws(() => requireHttpsUpdateUrl(value));
}
assert.throws(() => resolveUpdateSource({ updateRepository: '../upstream' }));

const createConfig = require('../app.config.js');
const previous = process.env.MYYAYA_UPDATE_FEED_URL;
try {
  process.env.MYYAYA_UPDATE_FEED_URL = 'https://updates.example.com/myyaya/latest.json';
  const config = createConfig();
  assert.equal(config.android.package, 'io.github.mypengpengli.myyaya');
  assert.equal(config.ios.bundleIdentifier, config.android.package);
  assert.equal(config.name, 'myyaya');
  assert.equal(resolveUpdateSource(config.extra.myyaya).feedUrl, process.env.MYYAYA_UPDATE_FEED_URL);
  assert.equal(config.version, require('../package.json').version);
} finally {
  if (previous === undefined) delete process.env.MYYAYA_UPDATE_FEED_URL;
  else process.env.MYYAYA_UPDATE_FEED_URL = previous;
}
console.log('myyaya identity and update source tests: PASS');
