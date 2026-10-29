import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript"), module = { exports: {} };
new Function("module", "exports", ts.transpileModule(readFileSync("src/artifacts/presentation.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(module, module.exports);
const { ResultPresentation, presentationHint } = module.exports;
let now = 0;
const view = new ResultPresentation(() => now);
const items = Array.from({ length: 5 }, (_, index) => ({ id: `result-${index}`, kind: index === 4 ? "video" : "image", title: `Result ${index}`, uri: `file:///result-${index}` }));
for (const item of items) view.offer(item);
view.offer(items[2]); assert.equal(view.getSnapshot().total, 5, "duplicate completion must not inflate the batch");
for (let index = 0; index < 4; index++) {
  const item = items[index]; view.loaded(item.id);
  assert.equal(view.getSnapshot().position, index + 1);
  assert.equal(view.getSnapshot().total, 5);
  assert.equal(presentationHint(view.getSnapshot(), now), `第 ${index + 1}/5 项 · 10 秒后展示下一项`);
  if (index === 2) {
    view.pin(true); now += 60_000; view.tick(); assert.equal(view.getSnapshot().active.id, item.id);
    assert.match(presentationHint(view.getSnapshot(), now), /第 3\/5 项 · 已固定/);
    view.pin(false);
  }
  now += 10_000; view.tick();
}
assert.equal(view.getSnapshot().position, 5);
view.loaded(items[4].id);
assert.equal(presentationHint(view.getSnapshot(), now), "第 5/5 项 · 播放结束 10 秒后返回表情");
now += 60_000; view.tick(); assert.equal(view.getSnapshot().active.id, items[4].id);
view.videoEnded(items[4].id);
assert.equal(presentationHint(view.getSnapshot(), now), "第 5/5 项 · 10 秒后返回表情");
now += 10_000; view.tick();
assert.equal(view.getSnapshot().active, null); assert.equal(view.getSnapshot().total, 0);
view.open(items[0]); view.loaded(items[0].id);
assert.equal(presentationHint(view.getSnapshot(), now), "第 1/1 项 · 10 秒后返回表情", "previously played files remain reopenable as a new round");
view.offer(items[1]); view.offer(items[2]); view.next(items[2].id);
assert.equal(view.getSnapshot().position, 2); assert.equal(view.getSnapshot().total, 3);
view.offer(items[3]); assert.equal(view.getSnapshot().total, 4, "later completions expand the same batch");
view.close(false); assert.equal(view.getSnapshot().queue.length, 2);
assert.equal(presentationHint(view.getSnapshot(), now), "");
view.next(); assert.equal(view.getSnapshot().position, 1); assert.equal(view.getSnapshot().total, 2);
const release = view.holdCountdown(); view.loaded(view.getSnapshot().active.id);
assert.match(presentationHint(view.getSnapshot(), now), /倒计时已暂停/); release();
console.log("Presentation sequence: five-result progress, automatic advance, final return, pin/hold, later completions and replay numbering: PASS");
