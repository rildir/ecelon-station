import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempData, rm } from "./_setup.mjs";

const DATA = tempData();
const { audit, readAudit, verifyChain, auditCsv } = await import("../server/audit.js");
const FILE = path.join(DATA, "audit.jsonl");
test.after(() => rm(DATA));

test("entries are chained, filtered by team and kind, newest first", () => {
  audit({ team: "a", who: "api", role: "dev", kind: "command", what: "npm test" });
  audit({ team: "a", who: "User", role: "user", kind: "allow_once", what: "Bash(git push)" });
  audit({ team: "b", who: "shop", role: "dev", kind: "file", what: "src/x.js", extra: "Write" });
  assert.deepEqual(verifyChain(), { ok: true, count: 3 });
  assert.deepEqual(readAudit({ team: "a" }).map((e) => e.kind), ["allow_once", "command"]);
  assert.equal(readAudit({ kinds: ["file"] }).length, 1);
  const lines = fs.readFileSync(FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines[0].p, ""); assert.equal(lines[1].p, lines[0].h); assert.equal(lines[2].p, lines[1].h);
});

test("a changed line and a removed line both break the chain", () => {
  const orig = fs.readFileSync(FILE, "utf8"), lines = orig.trim().split("\n");
  fs.writeFileSync(FILE, [lines[0], lines[1].replace("git push", "git status"), lines[2]].join("\n") + "\n");
  assert.deepEqual({ ok: verifyChain().ok, at: verifyChain().brokenAt }, { ok: false, at: 2 });
  fs.writeFileSync(FILE, [lines[0], lines[2]].join("\n") + "\n");
  assert.deepEqual({ ok: verifyChain().ok, at: verifyChain().brokenAt }, { ok: false, at: 2 });
  fs.writeFileSync(FILE, orig);
  assert.equal(verifyChain().ok, true);
});

test("the CSV cannot carry a spreadsheet formula", () => {
  audit({ team: "a", who: "api", role: "dev", kind: "command", what: '=HYPERLINK("http://x","y")' });
  const csv = auditCsv(readAudit({}), { a: "aurora-api" });
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"",""y"")"`));
  assert.ok(csv.includes('"aurora-api"'));
});
