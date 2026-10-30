import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempData, rm } from "./_setup.mjs";

const DATA = tempData();
const reqs = await import("../server/requirements.js");
const TEAM = "t1";
const cwd = path.join(DATA, "proj"); fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
fs.writeFileSync(path.join(cwd, "src", "a.js"), "line1\nline2\nline3\n");
test.after(() => rm(DATA));

test("upsertMany creates R- codes and merges by code/title", () => {
  const r = reqs.upsertMany(TEAM, [{ title: "Stock list must be filterable", section: "Stock", doc_claim: "done", acceptance_criteria: ["by code", "by name"] }, { title: "Transfers need approval" }], "merge", "Analyst");
  assert.equal(r.added, 2);
  const d = reqs.load(TEAM);
  assert.deepEqual(d.items.map((x) => x.code), ["R-001", "R-002"]);
  assert.equal(d.items[0].claim, "done");
  assert.equal(d.items[0].criteria.length, 2);
  const r2 = reqs.upsertMany(TEAM, [{ code: "R-002", title: "Transfers need approval (changed)" }], "merge", "Analyst");
  assert.equal(r2.added, 0); assert.equal(reqs.load(TEAM).items.length, 2);
});

test("a 'done' claim without verification is a mismatch; status 'done' does not clear it", () => {
  reqs.setStatus(TEAM, "R-001", { status: "done", by: "Analyst", agent: true });
  const it = reqs.load(TEAM).items[0];
  assert.equal(it.status, "done");
  assert.equal(reqs.isMismatch(it), true);
  assert.equal(reqs.summary(TEAM).mismatches, 1);
});

test("an agent's out-of-scope decision waits for the user; the user confirms it", () => {
  const r = reqs.setStatus(TEAM, "R-002", { status: "out_of_scope", by: "Analyst", agent: true });
  assert.equal(r.ok, true);
  let it = reqs.load(TEAM).items[1];
  assert.equal(it.status, "dropped"); assert.ok(it.dropPending); assert.equal(reqs.isDropped(it), false);
  assert.equal(reqs.summary(TEAM).dropPending, 1);
  reqs.setStatus(TEAM, "R-002", { status: "dropped", by: "User" });
  it = reqs.load(TEAM).items[1];
  assert.equal(it.dropPending, undefined); assert.equal(reqs.isDropped(it), true);
});

test("verification needs real evidence and every acceptance criterion", () => {
  let r = reqs.verify(TEAM, "R-001", { result: "verified", how: "ran the tests", evidence: "src/missing.js:1", criteria: [{ no: 1, result: "pass" }, { no: 2, result: "pass" }] }, cwd);
  assert.match(r.error, /not found|could not be found|bulunamadı/i);
  r = reqs.verify(TEAM, "R-001", { result: "verified", how: "ran the tests", evidence: "src/a.js:99" }, cwd);
  assert.ok(r.error, "out-of-range line is rejected");
  r = reqs.verify(TEAM, "R-001", { result: "verified", how: "ran the tests", evidence: "src/a.js:2", criteria: [{ no: 1, result: "pass" }] }, cwd);
  assert.ok(r.error, "a criterion left untried is rejected");
  r = reqs.verify(TEAM, "R-001", { result: "verified", how: "ran the tests", evidence: "src/a.js:2", criteria: [{ no: 1, result: "pass" }, { no: 2, result: "pass" }] }, cwd);
  assert.equal(r.ok, true);
  const it = reqs.load(TEAM).items[0];
  assert.equal(it.verify.state, "verified"); assert.equal(reqs.isMismatch(it), false);
});

test("a verified item goes stale when its evidence file changes", () => {
  fs.writeFileSync(path.join(cwd, "src", "a.js"), "changed\nchanged\nchanged\n");
  const { staled } = reqs.refreshStale(TEAM, cwd);
  assert.equal(staled, 1);
  assert.equal(reqs.load(TEAM).items[0].verify.state, "stale");
  assert.equal(reqs.summary(TEAM).stale, 1);
});

test("listText and detailText mention the codes and the mismatch flag", () => {
  reqs.upsertMany(TEAM, [{ title: "Count slip", doc_claim: "done" }], "merge");
  const txt = reqs.listText(TEAM, undefined, true);
  assert.match(txt, /R-003/); assert.match(txt, /MISMATCH|UYUŞMAZLIK/);
  assert.match(reqs.detailText(TEAM, "R-001"), /R-001/);
});
