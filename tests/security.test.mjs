// Security regressions: symlink escapes, traversal, executable "open", UNC image paths, git config hardening.
// Starts the station in demo mode on a free port (empty data folder) with a throw-away project folder.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { tempData, rm } from "./_setup.mjs";

const DATA = tempData("ecelon-sec-");
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "ecelon-sec-proj-"));
const PROJ = path.join(SANDBOX, "proj"), OUTSIDE = path.join(SANDBOX, "outside");
fs.mkdirSync(PROJ); fs.mkdirSync(OUTSIDE);
const SECRET = path.join(OUTSIDE, "secret.txt");
fs.writeFileSync(SECRET, "TOP-SECRET");
fs.writeFileSync(path.join(PROJ, "ok.txt"), "hello");
fs.writeFileSync(path.join(PROJ, "real.txt"), "inside");

let links = true;
const link = (target, at, type) => { try { fs.symlinkSync(target, at, type); } catch { links = false; } };
link(SECRET, path.join(PROJ, "leak.txt"));
link(OUTSIDE, path.join(PROJ, "outdir"), "dir");
link(path.join(OUTSIDE, "nonexistent.txt"), path.join(PROJ, "dangling.txt"));
link("real.txt", path.join(PROJ, "inlink.txt")); // a link that stays inside the project keeps working

const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const base = `http://127.0.0.1:${port}`;
const call = async (method, p, body) => {
  const r = await fetch(base + p, { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let child, id;
const q = (o) => "?" + new URLSearchParams(o);

test.before(async () => {
  spawnSync("git", ["init", "-q"], { cwd: PROJ });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: PROJ });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: PROJ });
  child = spawn(process.execPath, ["bin/ecelon-station.js", "--demo", "--no-open", "--port", String(port), "--data", DATA], { stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { try { up = (await call("GET", "/api/meta")).json?.mock; } catch {} if (!up) await sleep(150); }
  if (!up) throw new Error("server did not start:\n" + log);
  const a = await call("POST", "/api/agents", { name: "sec", cwd: PROJ });
  assert.equal(a.status, 200, a.text); id = a.json.id;
});
test.after(() => { child?.kill(); rm(DATA); rm(SANDBOX); });

const fsApi = (p) => `/api/agents/${id}/fs/${p}`;

test("normal reads, writes and in-project links still work", async () => {
  assert.equal((await call("GET", fsApi("file") + q({ path: "ok.txt" }))).json.text, "hello");
  assert.equal((await call("PUT", fsApi("file"), { path: "new/dir/n.txt", text: "x", force: true })).status, 200);
  assert.equal(fs.readFileSync(path.join(PROJ, "new/dir/n.txt"), "utf8"), "x");
  assert.equal((await call("POST", fsApi("create"), { path: "made.txt" })).status, 200);
  if (links) assert.equal((await call("GET", fsApi("file") + q({ path: "inlink.txt" }))).json.text, "inside");
});

test("path traversal is refused", async () => {
  for (const p of ["../outside/secret.txt", "..\\..\\x", "a/../../outside/secret.txt", SECRET]) {
    const r = await call("GET", fsApi("file") + q({ path: p }));
    assert.ok(r.status >= 400, p + " -> " + r.status);
    assert.ok(!/TOP-SECRET/.test(r.text));
  }
  assert.ok((await call("GET", fsApi("raw") + q({ path: "../outside/secret.txt" }))).status >= 400);
  assert.ok((await call("PUT", fsApi("file"), { path: "../outside/pwn.txt", text: "x", force: true })).status >= 400);
  assert.ok(!fs.existsSync(path.join(OUTSIDE, "pwn.txt")));
});

test("symlinks that leave the project cannot be read, written, created through, renamed or served raw", async (t) => {
  if (!links) return t.skip("cannot create symlinks here");
  for (const p of ["leak.txt", "outdir/secret.txt", "dangling.txt"]) {
    const r = await call("GET", fsApi("file") + q({ path: p }));
    assert.ok(r.status >= 400 && !/TOP-SECRET/.test(r.text), "read " + p + " -> " + r.status);
    const raw = await call("GET", fsApi("raw") + q({ path: p }));
    assert.ok(raw.status >= 400 && !/TOP-SECRET/.test(raw.text), "raw " + p + " -> " + raw.status);
  }
  // write through a link to an existing file, through a linked folder (new leaf), and through a dangling link
  for (const p of ["leak.txt", "outdir/planted.txt", "dangling.txt"]) {
    const r = await call("PUT", fsApi("file"), { path: p, text: "PWNED", force: true });
    assert.ok(r.status >= 400, "write " + p + " -> " + r.status);
  }
  assert.equal(fs.readFileSync(SECRET, "utf8"), "TOP-SECRET");
  assert.ok(!fs.existsSync(path.join(OUTSIDE, "planted.txt")));
  assert.ok(!fs.existsSync(path.join(OUTSIDE, "nonexistent.txt")));
  assert.ok((await call("POST", fsApi("create"), { path: "outdir/created.txt" })).status >= 400);
  assert.ok(!fs.existsSync(path.join(OUTSIDE, "created.txt")));
  // rename: source behind a link, and target behind a linked folder
  assert.ok((await call("POST", fsApi("rename"), { from: "leak.txt", to: "moved.txt" })).status >= 400);
  assert.ok((await call("POST", fsApi("rename"), { from: "real.txt", to: "outdir/real.txt" })).status >= 400);
  assert.ok(fs.existsSync(SECRET) && fs.existsSync(path.join(PROJ, "real.txt")) && !fs.existsSync(path.join(OUTSIDE, "real.txt")));
  assert.ok((await call("POST", fsApi("delete"), { path: "outdir/secret.txt" })).status >= 400);
  assert.ok(fs.existsSync(SECRET));
});

test("git panel: diff and discard do not follow links out of the project", async (t) => {
  if (!links) return t.skip("cannot create symlinks here");
  const d = await call("GET", `/api/agents/${id}/git/diff` + q({ path: "outdir/secret.txt", untracked: "1" }));
  assert.ok(d.status >= 400 && !/TOP-SECRET/.test(d.text), "untracked diff -> " + d.status);
  const d2 = await call("GET", `/api/agents/${id}/git/diff` + q({ path: "leak.txt", untracked: "1" }));
  assert.ok(d2.status >= 400 && !/TOP-SECRET/.test(d2.text));
  const x = await call("POST", `/api/agents/${id}/git/discard`, { paths: [], untracked: ["outdir/secret.txt", "leak.txt"] });
  assert.ok(x.status >= 400);
  assert.ok(fs.existsSync(SECRET), "the file behind the link is still there");
  assert.ok((await call("GET", `/api/agents/${id}/git/diff` + q({ path: "../outside/secret.txt" }))).status >= 400);
});

test("library: programs and scripts are not opened, only revealed", async () => {
  for (const name of ["evil.bat", "run.ps1", "Setup.EXE"]) {
    const up = await fetch(`${base}/api/library/upload?name=${name}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: "echo hi" });
    const doc = await up.json(); assert.equal(up.status, 200, JSON.stringify(doc));
    const r = await call("POST", `/api/library/${doc.id}/open`, {});
    assert.equal(r.status, 400, name + " -> " + r.status);
    assert.match(r.json.error, /program or script|betik/);
  }
});

test("xlsx: oversized archives are refused before and after inflating", async () => {
  const { readXlsx } = await import("../server/xlsx.js");
  const { default: JSZip } = await import("jszip");
  await assert.rejects(readXlsx(Buffer.alloc(26 * 1024 * 1024)), /too large|çok büyük/);
  const z = new JSZip(); z.file("xl/workbook.xml", Buffer.alloc(201 * 1024 * 1024));
  const bomb = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
  assert.ok(bomb.length < 25 * 1024 * 1024);
  await assert.rejects(readXlsx(bomb), /too much data|çok fazla veri/);
});

test("UNC / network image paths are refused on every platform", async () => {
  for (const p of ["//attacker.example/share/x.png", "\\\\attacker.example\\share\\x.png", "\\\\?\\C:\\x.png", "//127.0.0.1/c$/x.png"]) {
    const r = await call("GET", `/api/agents/${id}/image` + q({ path: p }));
    assert.ok(r.status === 400 || r.status === 404 || r.status === 403, p + " -> " + r.status);
  }
  const bad = await call("POST", "/api/agents", { name: "unc", cwd: "//attacker.example/share" });
  assert.equal(bad.status, 400);
  // a plain local image inside the project is still served
  fs.writeFileSync(path.join(PROJ, "p.png"), Buffer.from("iVBORw0KGgo=", "base64"));
  assert.equal((await call("GET", `/api/agents/${id}/image` + q({ path: path.join(PROJ, "p.png") }))).status, 200);
});

test("PATCH only accepts plain session ids", async () => {
  assert.equal((await call("PATCH", `/api/agents/${id}`, { sessionId: "--dangerously-skip-permissions x" })).status, 400);
  assert.equal((await call("PATCH", `/api/agents/${id}`, { sessionId: "abc-123_DEF" })).status, 200);
  assert.equal((await call("PATCH", `/api/agents/${id}`, { sessionId: null })).status, 200);
});

test("git config in the project cannot run programs (core.fsmonitor)", async (t) => {
  if (process.platform === "win32") return t.skip("uses a POSIX shell command");
  const marker = path.join(SANDBOX, "pwned-marker");
  const evil = fs.mkdtempSync(path.join(SANDBOX, "evilrepo-"));
  spawnSync("git", ["init", "-q"], { cwd: evil });
  fs.writeFileSync(path.join(evil, "a.txt"), "a");
  fs.appendFileSync(path.join(evil, ".git", "config"), `[core]\n\tfsmonitor = "touch ${marker}; echo"\n`);
  // control: plain git does run it (otherwise this git version makes the test meaningless)
  spawnSync("git", ["status"], { cwd: evil }); const control = fs.existsSync(marker); fs.rmSync(marker, { force: true });
  const a = await call("POST", "/api/agents", { name: "evil", cwd: evil });
  assert.equal(a.status, 200, a.text);
  assert.equal((await call("GET", `/api/agents/${a.json.id}/git`)).status, 200);
  await call("GET", "/api/git/summary");
  await call("POST", `/api/agents/${a.json.id}/git/stage`, { all: true });
  await sleep(300);
  assert.equal(fs.existsSync(marker), false, "the station must not run the fsmonitor command" + (control ? "" : " (control did not trigger on this git)"));
});
