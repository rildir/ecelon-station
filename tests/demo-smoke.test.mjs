// Starts the station in demo mode on a free port with an empty data folder and walks through the
// requirement flow the way the UI does: extract → compare → verify. No Claude Code needed.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { tempData, rm } from "./_setup.mjs";

const DATA = tempData("ecelon-demo-");
const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const base = `http://127.0.0.1:${port}`;
const api = async (p, body) => { const r = await fetch(base + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}); return r.json(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let child;

test.before(async () => {
  // the server itself (not the bin/ wrapper) so that child.kill() really stops it on Windows too
  child = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, MOCK: "1", ECELON_DEMO: "1", PORT: String(port), ECELON_DATA: DATA }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 300; i++) { try { const m = await api("/api/meta"); if (m.mock) return; } catch {} await sleep(200); }
  throw new Error("server did not start:\n" + log);
});
test.after(async () => { child?.kill(); await sleep(500); rm(DATA); });

const until = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(500); } throw new Error("timeout"); };
const delegate = (id, role, task) => until(async () => { const r = await api(`/api/agents/${id}/delegate`, { role, task }); return r.ok ? r : null; });

test("demo seed creates three projects with full teams and a linked document", async () => {
  const agents = await api("/api/agents");
  assert.equal(agents.length, 12);
  assert.deepEqual([...new Set(agents.map((a) => a.name))].sort(), ["aurora-api", "aurora-mobile", "aurora-shop"]);
  const lib = await api("/api/library");
  assert.equal(lib.docs.length, 1);
  const api_ = agents.find((a) => a.name === "aurora-api" && a.role === "dev");
  assert.deepEqual(lib.docs[0].agents, [api_.id]);
  const c = await api(`/api/reqs/${api_.id}/coverage`);
  assert.equal(c.stats.total, 10);
});

test("extract → compare → verify leaves one verified, one failed and one out-of-scope item awaiting approval", async () => {
  const agents = await api("/api/agents");
  const team = agents.find((a) => a.name === "aurora-api" && a.role === "dev").id;
  const analyst = agents.find((a) => a.team === team && a.role === "analyst").id;
  const tester = agents.find((a) => a.team === team && a.role === "tester").id;
  await delegate(analyst, "analyst", "Extract the requirements from the linked document and save them.");
  await until(async () => (await api(`/api/reqs/${team}`)).items.length === 5);
  await delegate(analyst, "analyst", "Compare the requirements with the code and update their status.");
  await until(async () => (await api(`/api/reqs/${team}/summary`)).dropPending === 1);
  await delegate(tester, "tester", "Verify the mismatched requirements.");
  const s = await until(async () => { const s = await api(`/api/reqs/${team}/summary`); return s.failed === 1 && s.done === 1 ? s : null; });
  assert.equal(s.total, 5); assert.equal(s.mismatches, 1); assert.equal(s.dropPending, 1);
  assert.equal(s.coverage.linked, 5); assert.equal(s.coverage.byAgent, 1);
  const items = (await api(`/api/reqs/${team}`)).items;
  assert.equal(items[0].verify.state, "verified");
  assert.match(items[0].evidence, /\.js:1$/);
  assert.equal(items[0].verify.refs.length, 1);
});
