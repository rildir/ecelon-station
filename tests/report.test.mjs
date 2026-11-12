import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempData, rm } from "./_setup.mjs";

const DATA = tempData();
const reqs = await import("../server/requirements.js");
const { proofReport } = await import("../server/report.js");
const TEAM = "rep1";
const cwd = path.join(DATA, "proj"); fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
fs.writeFileSync(path.join(cwd, "src", "a.js"), "const a = 1;\nconst secret = '<b>x</b>';\nexport default a;\n");
fs.writeFileSync(path.join(DATA, "outside.txt"), "TOP-SECRET-OUTSIDE");
test.after(() => rm(DATA));

const make = () => proofReport({ team: TEAM, name: "My <Project>", cwd, coverage: { pct: 50 }, payroll: { items: [{ code: "R-001", costUsd: 0.5, runs: 2 }], totalUsd: 0.5 }, version: "9.9.9" });

test("the report shows the chain of a verified item with the code lines, and escapes everything", async () => {
  reqs.upsertMany(TEAM, [{ title: "Filter <script>alert(1)</script>", doc_claim: "done", doc_quote: "Status: Completed" }, { title: "Second item", doc_claim: "done" }], "merge", "Analyst");
  const v = reqs.verify(TEAM, "R-001", { result: "verified", how: "ran the filter scenario", evidence: "src/a.js:2", by: "Tester" }, cwd);
  assert.ok(v.ok, JSON.stringify(v));
  const html = await make();
  assert.ok(!html.includes("<script"), "no script tag may survive");
  assert.ok(html.includes("My &lt;Project&gt;"));
  assert.ok(html.includes("Status: Completed") && html.includes("ran the filter scenario") && html.includes("src/a.js:2"));
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"), "the evidence line itself is shown, escaped");
  assert.ok(html.includes("$0.50"));
  assert.match(html, /id="R-002"[\s\S]*Mismatch|Mismatch[\s\S]*id="R-002"/); // says done, nobody verified
});

test("evidence that changed after verification is not reported as verified", async () => {
  fs.writeFileSync(path.join(cwd, "src", "a.js"), "const a = 2;\nconst other = 5;\nexport default a;\n");
  const html = await make();
  assert.match(html, /<article class="req warn[^"]*" id="R-001">/);
});

test("a reference that points outside the project is never read", async () => {
  const d = reqs.load(TEAM); d.items[0].verify.refs = [{ ref: "../outside.txt:1", file: "../outside.txt", from: 1, to: 1 }]; d.items[0].verify.state = "verified"; reqs.save(TEAM, d);
  const html = await make();
  assert.ok(!html.includes("TOP-SECRET-OUTSIDE"));
});
