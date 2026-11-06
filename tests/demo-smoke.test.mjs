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

test("compact: the ring's token count drops, a note is logged, and the same session continues", async () => {
  const agents = await api("/api/agents");
  const a = agents.find((x) => x.name === "aurora-shop" && x.role === "dev");
  const none = await fetch(base + `/api/agents/${a.id}/compact`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(none.status, 400, "no conversation yet → nothing to compact");
  await api(`/api/agents/${a.id}/prompt`, { text: "Show a stock warning in the cart" });
  const before = await until(async () => { const x = (await api("/api/agents")).find((y) => y.id === a.id); return x.context?.tokens && x.sessionId ? x : null; });
  const r = await api(`/api/agents/${a.id}/compact`, {});
  assert.equal(r.started, true);
  const after = await until(async () => { const x = (await api("/api/agents")).find((y) => y.id === a.id); return x.context.tokens < before.context.tokens ? x : null; });
  assert.equal(after.sessionId, before.sessionId);
  assert.equal(after.context.window, before.context.window);
  const log = await api(`/api/agents/${a.id}/log`);
  assert.ok(log.some((e) => e.type === "note" && /compacted/i.test(e.text)));
});

test("task board: add, start for a role, mark done, delete", async () => {
  const agents = await api("/api/agents");
  const lead = agents.find((a) => a.name === "aurora-api" && a.role === "dev");
  const team = lead.team || lead.id;
  const call = (method, p, body) => fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const added = await call("POST", `/api/tasks/${team}`, { title: "Run the check-and-note tests", role: "tester", priority: "high", detail: "dotnet test; report the result" });
  assert.equal(added.status, 200); assert.match(added.body.id, /^T-\d{3}$/);
  const mine = await call("POST", `/api/tasks/${team}`, { title: "Approve the bank migration", role: "user" });
  assert.equal((await call("POST", `/api/tasks/${team}/${mine.body.id}/start`)).status, 400); // only the person can do it
  assert.equal((await call("POST", `/api/tasks/${team}`, { title: "  ", role: "tester" })).status, 400);
  assert.deepEqual(await api(`/api/tasks/${team}/summary`), { total: 2, open: 2, doing: 0, toUser: 1 });
  const started = await until(async () => { const r = await call("POST", `/api/tasks/${team}/${added.body.id}/start`); return r.status === 200 ? r : null; });
  assert.ok(started.body.ok);
  const list = await api(`/api/tasks/${team}`);
  assert.equal(list.items.find((x) => x.id === added.body.id).status, "doing");
  assert.equal((await call("PATCH", `/api/tasks/${team}/${added.body.id}`, { status: "done", note: "ok" })).body.status, "done");
  assert.equal((await call("DELETE", `/api/tasks/${team}/${mine.body.id}`)).status, 200);
  assert.equal((await api(`/api/tasks/${team}`)).items.length, 1);
});
