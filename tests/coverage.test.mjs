import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tempData, rm } from "./_setup.mjs";

const DATA = tempData();
const cov = await import("../server/coverage.js");
const reqs = await import("../server/requirements.js");
const TEAM = "c1";
test.after(() => rm(DATA));
const DOC = fs.readFileSync("demo/docs/Inventory Module - Analysis v3.md", "utf8");

test("segment() turns headings, list items, table rows and numbered rules into sections", () => {
  const segs = cov.segment(DOC);
  assert.equal(segs.length, 10);
  assert.equal(segs[2].kind, "item"); assert.match(segs[2].text, /Stock card list/);
  assert.equal(segs[5].kind, "row"); assert.match(segs[5].text, /StockCode/);
  assert.equal(segs[7].kind, "item"); assert.match(segs[7].text, /^3\.1/);
  assert.equal(cov.doneHint(segs[2].text), true, "'Status: Completed' counts as a 'done' hint");
  assert.equal(cov.REQ_LIKE.test(segs[7].text), true, "'must be rejected' looks like a rule");
  assert.equal(cov.REQ_LIKE.test("Durum: Tamamlandı. Transfer onaydan geçmelidir."), true, "Turkish rules are detected too");
});

test("sync + compute: open sections, links, agent marks awaiting approval, confirm", () => {
  cov.sync(TEAM, [{ id: "d1", name: "Analysis.md", text: DOC, at: 1 }]);
  let st = cov.compute(TEAM, []).stats;
  assert.equal(st.total, 10); assert.equal(st.open, 10); assert.equal(st.pct, 0);
  // an agent may not mark a rule-like section as "contains none"
  const bad = cov.mark(TEAM, ["D1-008"], { reason: "just text", by: "Analyst", agent: true });
  assert.ok(bad.error);
  const ok = cov.mark(TEAM, ["D1-001"], { reason: "Introduction text", by: "Analyst", agent: true });
  assert.equal(ok.count, 1);
  st = cov.compute(TEAM, []).stats;
  assert.equal(st.byAgent, 1, "agent mark awaits approval"); assert.equal(st.pct, 0, "not counted until confirmed");
  cov.confirm(TEAM, ["D1-001"]);
  st = cov.compute(TEAM, []).stats;
  assert.equal(st.byAgent, 0); assert.equal(st.ignored, 1); assert.equal(st.pct, 10);
  // linking through a requirement
  reqs.upsertMany(TEAM, [{ title: "Stock card list must be filterable", segs: ["D1-003"] }], "merge");
  st = cov.compute(TEAM, reqs.load(TEAM).items).stats;
  assert.equal(st.linked, 1); assert.equal(st.open, 8);
  assert.equal(cov.claimHintFor(cov.load(TEAM), ["D1-003"]), true);
});

test("a new document version marks changed sections and resets agent marks", () => {
  const v2 = DOC.replace("Stock card list — filterable by stock code and name.", "Stock card list — filterable by stock code, name and supplier.");
  const r = cov.sync(TEAM, [{ id: "d1", name: "Analysis.md", text: v2, at: 2 }]);
  assert.equal(r.changedSegs.length, 1);
  const st = cov.compute(TEAM, reqs.load(TEAM).items).stats;
  assert.equal(st.changed, 1);
  const seg = cov.compute(TEAM, []).segments.find((s) => s.id === "D1-003");
  assert.match(seg.prev, /by stock code and name\./);
});
