// Ecelon Station — server
// REST: agent CRUD + sending prompts; WebSocket: live event stream.
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import * as cp from "./checkpoint.js";
import * as reqs from "./requirements.js";
import * as gp from "./gitpanel.js";
import * as cov from "./coverage.js";
import * as fsx from "./files.js";
import * as runs from "./runs.js";
import { listAgents, getAgent, addAgent, addMember, teamOf, ensureFullTeams, updateAgent, removeAgent, reorderAgents, MODELS, EFFORTS, PERMISSIONS } from "./agents.js";
import { ROLES, roleOf, publicRoles } from "./roles.js";
import { runClaude, resolveClaude, claudeMissingHint, uploadsDir, oneShot, claudeVersion, cliInfo } from "./runner.js";
import { runMock } from "./mockRunner.js";
import { t, locale, langName, setLang, getLang, getDict, LANGS } from "./i18n.js";
import { seedDemo } from "./demo.js";
import { libraryRouter, describeDocs, referenceLines, linkedDocIds, forgetAgent, docsTextFor } from "./library.js";
import { dataPath, LOGS, PUBLIC, rootPath, pkgDir, mkdirPrivate, writePrivate } from "./paths.js";

const PORT = Number(process.env.PORT || 4777);
const MOCK = process.env.MOCK === "1";
const LOG_DIR = LOGS;
mkdirPrivate(LOG_DIR);

const app = express();
// ---------- security: only our own UI on this computer may talk to the server ----------
// Another site open in the browser could send requests to 127.0.0.1 (CSRF) or present our server
// as its own domain via DNS rebinding. We check the Host and Origin headers strictly.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const originOk = (origin) => !origin || ALLOWED_ORIGINS.has(origin);
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(req.headers.host)) return res.status(403).send(t("This server can only be reached via 127.0.0.1."));
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (unsafe && (!originOk(req.headers.origin) || req.headers["sec-fetch-site"] === "cross-site")) return res.status(403).json({ error: t("Request from another site rejected.") });
  // GETs must not be triggered from another site either (img/script tags): if the browser sends Sec-Fetch-Site it must be same-origin/none
  if (req.path.startsWith("/api/") && req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(req.headers["sec-fetch-site"])) return res.status(403).json({ error: t("Request from another site rejected.") });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: "40mb" })); // for image uploads
app.use(express.static(PUBLIC));
// serve three.js straight from node_modules, without a bundler
app.use("/vendor/three", express.static(pkgDir("three")));
app.use("/vendor/monaco", express.static(path.join(pkgDir("monaco-editor"), "min"), { maxAge: "7d" }));
app.use("/vendor/fonts", express.static(path.dirname(pkgDir("@fontsource/jetbrains-mono"))));

const server = http.createServer(app);
const wss = new WebSocketServer({
  server, path: "/ws",
  // keep other sites from reading the chats
  verifyClient: ({ origin, req }) => ALLOWED_HOSTS.has(req.headers.host) && originOk(origin),
});

function broadcast(ev) {
  const data = JSON.stringify(ev);
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}

// ---------- conversations: each agent has several conversations, each with its own log + its own Claude session ----------
// conversation id is letters/digits only: no escaping logs/ with "../"
const safeId = (s) => String(s || "").replace(/[^a-zA-Z0-9_-]/g, "");
const logFile = (agentId, convId) => path.join(LOG_DIR, safeId(agentId), `${safeId(convId)}.jsonl`);
const newConvId = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
function firstUserText(file) {
  try { for (const l of fs.readFileSync(file, "utf8").split("\n")) { if (!l) continue; const e = JSON.parse(l); if (e.type === "user") return e.text; } } catch {}
  return "";
}
// Move the old single-file log over as the first conversation
function ensureConvs(agent) {
  if (Array.isArray(agent.convs) && agent.convs.length && agent.activeConv) return agent;
  const id = newConvId(), now = Date.now();
  mkdirPrivate(path.join(LOG_DIR, agent.id));
  const old = path.join(LOG_DIR, `${agent.id}.jsonl`);
  let title = "";
  if (fs.existsSync(old)) { title = firstUserText(old); fs.renameSync(old, logFile(agent.id, id)); }
  const conv = { id, sessionId: agent.sessionId || null, title: title.slice(0, 80), createdAt: now, updatedAt: now, context: agent.context || null };
  return updateAgent(agent.id, { convs: [conv], activeConv: id });
}
const activeConv = (agent) => (agent.convs || []).find((c) => c.id === agent.activeConv);
function patchConv(agentId, convId, patch) {
  const a = getAgent(agentId); if (!a) return null;
  const convs = (a.convs || []).map((c) => (c.id === convId ? { ...c, ...patch } : c));
  return updateAgent(agentId, { convs });
}

// An unexpected error must not bring the server down: log it and carry on (agent processes and the UI connection keep living)
process.on("uncaughtException", (e) => { console.error("[ecelon] uncaught error:", e?.stack || e); });
process.on("unhandledRejection", (e) => { console.error("[ecelon] unhandled promise rejection:", e?.stack || e); });
const CONV_ID_RE = /^[a-z0-9]{6,40}$/i;
function appendLog(agentId, ev, convId) {
  if (ev.type === "text_delta" || ev.type === "thinking_delta" || ev.type === "status" || ev.type === "raw") return; // noise is not kept in the log
  if (!convId) { const a = getAgent(agentId); if (!a) return; convId = ensureConvs(a).activeConv; }
  if (!CONV_ID_RE.test(String(convId))) return;
  try {
    mkdirPrivate(path.join(LOG_DIR, String(agentId)));
    fs.appendFileSync(logFile(agentId, convId), JSON.stringify({ t: Date.now(), ...ev }) + "\n", { mode: 0o600 });
  } catch (e) { console.error("[ecelon] log could not be written:", e.message); } // a full disk / antivirus lock must not kill the process
}

function readLog(agentId, limit = 400, convId) {
  if (!convId) { const a = getAgent(agentId); if (!a) return []; convId = ensureConvs(a).activeConv; }
  const f = logFile(agentId, convId);
  if (!fs.existsSync(f)) return [];
  const lines = fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// Running runs: agentId -> { kill }
const running = new Map();
const status = new Map(); // agentId -> "idle" | "thinking" | "tool" | "done" | "error"

function setStatus(agentId, s, extra = {}) {
  status.set(agentId, s);
  broadcast({ type: "status", agentId, status: s, ...extra });
}

// ---------- REST ----------
app.use("/api/library", libraryRouter({ broadcast: (m) => { broadcast(m); if (m?.type === "library") syncAllCoverage(); } }));

app.get("/api/meta", (_req, res) => res.json({ mock: MOCK, models: MODELS, efforts: EFFORTS, permissions: PERMISSIONS, platform: process.platform, roles: publicRoles(), cli: MOCK ? null : cliInfo(), claudeMissing: MOCK ? null : (resolveClaude() ? null : claudeMissingHint()), lang: getLang(), langs: LANGS }));

// ---------- usage limits (from Claude Code's rate_limit_event) ----------
const USAGE_FILE = dataPath("usage.json");
let usage = {};
try { usage = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")); } catch {}
function saveUsage(info) {
  if (!info?.kind) return;
  usage[info.kind] = { ...usage[info.kind], ...Object.fromEntries(Object.entries(info).filter(([, v]) => v !== null)), seenAt: Date.now() };
  try { mkdirPrivate(path.dirname(USAGE_FILE)); writePrivate(USAGE_FILE, JSON.stringify(usage, null, 2)); } catch {}
  broadcast({ type: "usage", usage });
}
app.get("/api/usage", (_req, res) => res.json(usage));

// ---------- images ----------
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
// A UNC / device path (\\host\share, //host/x, \\?\) makes Windows reach out over SMB (NTLM hash leak) on any fs access:
// refused on every platform. Absolute paths must start with a drive letter + slash or a single slash.
const isSafeLocalPath = (p) => {
  p = String(p ?? "");
  if (/^[\\/]{2}/.test(p) || /^[\\/]{2}/.test(path.win32.parse(p).root)) return false;
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(p)) return true; // drive letter + slash, or exactly one slash (the UNC case is excluded above)
  return !/^[A-Za-z]:/.test(p); // relative; a drive-relative "C:foo" is not accepted
};
const isImage = (p) => typeof p === "string" && IMG_EXT.test(p.trim()) && isSafeLocalPath(p.trim());
const _seen = new Map();
const seenImages = (id) => { if (!_seen.has(id)) _seen.set(id, new Set()); return _seen.get(id); };
// Image paths in text (Windows and POSIX)
function findImagePaths(text) {
  const out = new Set();
  const re = /(?:[A-Za-z]:[\\/]|\/)[^\s`"'<>|*?]+?\.(?:png|jpe?g|gif|webp|bmp)\b/gi;
  for (const m of String(text || "").matchAll(re)) if (isSafeLocalPath(m[0])) out.add(m[0]);
  return [...out];
}
const inside = (root, p) => { const rel = path.relative(path.resolve(root), path.resolve(p)); return !rel.startsWith("..") && !path.isAbsolute(rel); };

// On startup, restore the images seen in old chat logs
try {
  const files = [];
  for (const f of fs.readdirSync(LOG_DIR, { withFileTypes: true })) {
    if (f.isFile() && f.name.endsWith(".jsonl")) files.push([f.name.slice(0, -6), path.join(LOG_DIR, f.name)]);
    if (f.isDirectory()) for (const g of fs.readdirSync(path.join(LOG_DIR, f.name))) if (g.endsWith(".jsonl")) files.push([f.name, path.join(LOG_DIR, f.name, g)]);
  }
  for (const [id, file] of files) {
    const evs = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    for (const ev of evs) {
      const add = (p) => seenImages(id).add(path.resolve(p).toLowerCase());
      if (ev.type === "tool_use" && isImage(ev.summary)) add(ev.summary);
      if (ev.type === "text") findImagePaths(ev.text).forEach(add);
      if (ev.type === "user") (ev.images || []).forEach(add);
    }
  }
} catch {}

// @file: search the files in the project (cached)
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "out", "coverage", ".venv", "venv", "__pycache__", ".godot", ".import", "vendor", "target", "bin", "obj"]);
const fileCache = new Map();
function listProjectFiles(root) {
  const c = fileCache.get(root);
  if (c && Date.now() - c.at < 30000) return c.files;
  const files = []; const stack = [[root, 0]];
  while (stack.length && files.length < 8000) {
    const [dir, depth] = stack.pop();
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.name.startsWith(".") && e.name !== ".env.example") { if (e.isDirectory()) continue; }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && depth < 8) stack.push([full, depth + 1]); }
      else files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  fileCache.set(root, { at: Date.now(), files });
  return files;
}
app.get("/api/agents/:id/files", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json([]);
  const q = String(req.query.q || "").toLowerCase();
  const files = listProjectFiles(path.resolve(agent.cwd));
  const score = (f) => { const l = f.toLowerCase(), base = l.split("/").pop(); if (!q) return 1; if (base.startsWith(q)) return 4; if (base.includes(q)) return 3; if (l.includes(q)) return 2; let i = 0; for (const ch of l) if (ch === q[i]) i++; return i === q.length ? 1 : 0; };
  res.json(files.map((f) => [f, score(f)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).slice(0, 30).map(([f]) => f));
});

// Save the image the user attached (arrives as a data: URL)
app.post("/api/agents/:id/upload", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: t("Agent not found") });
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/s.exec(String(req.body?.dataUrl || ""));
  if (!m) return res.status(400).json({ error: t("Only png, jpg, gif or webp images can be attached.") });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 20 * 1024 * 1024) return res.status(400).json({ error: t("The image cannot be larger than 20 MB.") });
  const base = String(req.body?.name || "gorsel").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 40) || "gorsel";
  const file = path.join(uploadsDir(agent.id), `${Date.now()}-${base}.${m[1] === "jpeg" ? "jpg" : m[1]}`);
  fs.writeFileSync(file, buf);
  seenImages(agent.id).add(file.toLowerCase());
  res.json({ path: file });
});

// Serve an image: only the project folder, the uploads, or images the agent touched in this session
app.get("/api/agents/:id/image", (req, res) => {
  const agent = getAgent(req.params.id);
  const p = String(req.query.path || "");
  if (!agent) return res.status(404).end();
  if (!isSafeLocalPath(p.trim())) return res.status(400).end();
  if (!isImage(p)) return res.status(404).end();
  const abs = path.resolve(p);
  const inProject = inside(agent.cwd, abs) && (() => { try { fsx.resolveIn(agent.cwd, abs); return true; } catch { return false; } })(); // a link inside the project must not lead out of it
  const ok = inProject || inside(uploadsDir(agent.id), abs) || seenImages(agent.id).has(abs.toLowerCase());
  if (!ok) return res.status(403).end();
  if (!fs.existsSync(abs)) return res.status(404).end();
  res.sendFile(abs);
});

// Opens the operating system's folder picker and returns the chosen path.
// Windows: PowerShell + FolderBrowserDialog (with a TopMost owner window so it comes to the front).
app.post("/api/pick-folder", (_req, res) => {
  let cmd, args;
  if (process.platform === "win32") {
    // modern Explorer-style picker (server/pick-folder.ps1); the start folder comes from the request
    const start = String(_req.body?.start || "");
    cmd = "powershell.exe";
    args = ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", rootPath("server", "pick-folder.ps1"), "-Start", start && isSafeLocalPath(start) && fs.existsSync(start) ? start : path.join(os.homedir(), "Desktop")];
  } else if (process.platform === "darwin") {
    cmd = "osascript"; args = ["-e", "on run argv", "-e", "return POSIX path of (choose folder with prompt (item 1 of argv))", "-e", "end run", t("Choose the project folder the agent will work in")]; // the text is an argument, never part of the script
  } else {
    cmd = "zenity"; args = ["--file-selection", "--directory", "--title=" + t("Choose the project folder")];
  }
  let out = "", done = false;
  const finish = (code, body) => { if (!done) { done = true; res.status(code).json(body); } };
  try {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: false });
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.on("error", () => finish(501, { error: t("The folder picker could not be opened on this system; paste the path by hand.") }));
    child.on("close", () => {
      const p = out.trim().replace(/\/$/, "");
      if (!p) return finish(200, { cancelled: true });
      finish(200, { path: p, name: path.basename(p) });
    });
  } catch { finish(501, { error: t("The folder picker could not be opened.") }); }
});

// Lists the subfolders of a folder (for picking a project with "Scan" in the UI)
app.get("/api/scan", (req, res) => {
  const dir = String(req.query.dir || "").trim();
  if (!dir) return res.status(400).json({ error: t("dir is required") });
  if (/^[\\/]{2}/.test(dir)) return res.status(400).json({ error: t("Network paths (UNC) are not scanned") });
  try {
    const have = new Set(listAgents().map((a) => path.resolve(a.cwd).toLowerCase()));
    const items = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
      .slice(0, 300)
      .map((d) => { const full = path.join(dir, d.name); return { name: d.name, path: full, hasAgent: have.has(path.resolve(full).toLowerCase()) }; });
    res.json(items);
  } catch (e) { res.status(400).json({ error: t("Folder could not be read: {dir}", { dir }) }); }
});

app.get("/api/agents", (_req, res) => {
  res.json(listAgents().map((a) => ({ ...a, status: status.get(a.id) || "idle", busy: running.has(a.id) })));
});

app.post("/api/agents/reorder", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
  if (!ids) return res.status(400).json({ error: t("ids is required") });
  reorderAgents(ids); broadcast({ type: "agents_changed" }); res.json({ ok: true });
});

app.post("/api/agents", (req, res) => {
  try {
    const { name, cwd, model, effort, permission } = req.body || {};
    if (!cwd) return res.status(400).json({ error: t("cwd is required") });
    if (!isSafeLocalPath(cwd)) return res.status(400).json({ error: t("Network paths (UNC) are not allowed") });
    if (!MOCK && !fs.existsSync(cwd)) return res.status(400).json({ error: t("Folder not found: {dir}", { dir: cwd }) });
    const a = addAgent({ name, cwd, model, effort, permission });
    ensureFullTeams(); // a new project comes with a full team
    broadcast({ type: "agents_changed" });
    res.json(a);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.patch("/api/agents/:id", (req, res) => {
  try {
    const b = req.body || {};
    // sessionId goes to `claude --resume`: only plain ids
    if (b.sessionId != null && !(typeof b.sessionId === "string" && /^[\w-]{1,64}$/.test(b.sessionId))) return res.status(400).json({ error: t("Invalid session id") });
    if (Array.isArray(b.convs) && b.convs.some((c) => c?.sessionId != null && !(typeof c.sessionId === "string" && /^[\w-]{1,64}$/.test(c.sessionId)))) return res.status(400).json({ error: t("Invalid session id") }); // a conversation's sessionId is resumed later
    const a = updateAgent(req.params.id, b);
    broadcast({ type: "agents_changed" });
    res.json(a);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Add a role to the project (analyst, tester, reviewer…)
app.post("/api/agents/:id/members", (req, res) => {
  try {
    const a = addMember(req.params.id, String(req.body?.role || ""));
    broadcast({ type: "agents_changed" });
    res.json(a);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/agents/:id", (req, res) => {
  try {
    const whole = req.query.whole === "1";
    const gone = removeAgent(req.params.id, { whole });
    for (const g of gone) { running.get(g.id)?.kill(); forgetAgent(g.id); }
    const removed = gone;
    broadcast({ type: "agents_changed" });
    res.json(removed);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Conversation list
app.get("/api/agents/:id/convs", (req, res) => {
  const a0 = getAgent(req.params.id); if (!a0) return res.status(404).json({ error: t("Agent not found") });
  const a = ensureConvs(a0);
  res.json((a.convs || []).filter((c) => c.id === a.activeConv || fs.existsSync(logFile(a.id, c.id)))
    .map((c) => ({ ...c, active: c.id === a.activeConv })).sort((x, y) => y.updatedAt - x.updatedAt));
});
function startNewConv(agentId) {
  const a = ensureConvs(getAgent(agentId));
  const cur = activeConv(a);
  // if the current conversation is empty there is no need to open a new one
  if (cur && !fs.existsSync(logFile(a.id, cur.id))) return a;
  const id = newConvId(), now = Date.now();
  const kept = a.convs.filter((c) => fs.existsSync(logFile(a.id, c.id))); // empty conversations must not pile up
  return updateAgent(a.id, { convs: [...kept, { id, sessionId: null, title: "", createdAt: now, updatedAt: now, context: null }], activeConv: id, sessionId: null, context: null });
}
app.post("/api/agents/:id/convs", (req, res) => {
  if (!getAgent(req.params.id)) return res.status(404).json({ error: t("Agent not found") });
  if (running.has(req.params.id)) return res.status(409).json({ error: t("A new conversation cannot be opened while the agent is running; stop it first.") });
  const a = startNewConv(req.params.id); broadcast({ type: "agents_changed" }); res.json({ activeConv: a.activeConv });
});
app.post("/api/agents/:id/convs/:cid/activate", (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).json({ error: t("Agent not found") });
  if (running.has(a.id)) return res.status(409).json({ error: t("The conversation cannot be switched while the agent is running; stop it first.") });
  const c = (a.convs || []).find((x) => x.id === req.params.cid); if (!c) return res.status(404).json({ error: t("Conversation not found") });
  updateAgent(a.id, { activeConv: c.id, sessionId: c.sessionId || null, context: c.context || null });
  broadcast({ type: "agents_changed" }); res.json({ ok: true });
});
app.delete("/api/agents/:id/convs/:cid", (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).json({ error: t("Agent not found") });
  if (!(a.convs || []).some((x) => x.id === req.params.cid)) return res.status(404).json({ error: t("Conversation not found") });
  if (running.has(a.id) && a.activeConv === req.params.cid) return res.status(409).json({ error: t("The running conversation cannot be deleted.") });
  const convs = (a.convs || []).filter((x) => x.id !== req.params.cid);
  try { fs.rmSync(logFile(a.id, req.params.cid), { force: true }); } catch {}
  if (a.activeConv === req.params.cid) {
    const next = convs.sort((x, y) => y.updatedAt - x.updatedAt)[0];
    if (next) updateAgent(a.id, { convs, activeConv: next.id, sessionId: next.sessionId || null, context: next.context || null });
    else { const id = newConvId(), now = Date.now(); updateAgent(a.id, { convs: [{ id, sessionId: null, title: "", createdAt: now, updatedAt: now, context: null }], activeConv: id, sessionId: null, context: null }); }
  } else updateAgent(a.id, { convs });
  broadcast({ type: "agents_changed" }); res.json({ ok: true });
});

app.post("/api/agents/:id/reset", (req, res) => {
  try { if (running.has(req.params.id)) return res.status(409).json({ error: t("Agent is running; stop it first.") }); res.json(startNewConv(req.params.id)); broadcast({ type: "agents_changed" }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/agents/:id/log", (req, res) => res.json(readLog(req.params.id, 400, req.query.conv ? String(req.query.conv) : undefined)));

// Open the project folder (or a file inside it) in the operating system's file manager.
// Security: only paths inside the agent's own folder are opened.
app.post("/api/agents/:id/open", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: t("Agent not found") });
  const root = path.resolve(agent.cwd);
  let target = root;
  if (req.body?.path) {
    const p = String(req.body.path);
    target = path.resolve(path.isAbsolute(p) ? p : path.join(root, p));
    const rel = path.relative(root, target);
    const outside = rel.startsWith("..") || path.isAbsolute(rel);
    if (outside && !seenImages(agent.id).has(target.toLowerCase()) && !inside(uploadsDir(agent.id), target)) return res.status(400).json({ error: t("This path is outside the project.") });
  }
  if (!fs.existsSync(target)) return res.status(404).json({ error: t("File not found: {name}", { name: path.basename(target) }) });
  const isFile = fs.statSync(target).isFile();
  let cmd, args;
  if (process.platform === "win32") { cmd = "explorer.exe"; args = isFile ? ["/select,", target] : [target]; }
  else if (process.platform === "darwin") { cmd = "open"; args = isFile ? ["-R", target] : [target]; }
  else { cmd = "xdg-open"; args = [isFile ? path.dirname(target) : target]; }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    res.json({ ok: true, opened: target });
  } catch (e) { res.status(500).json({ error: t("Could not open: {error}", { error: e.message }) }); }
});

// ---- Git panel (like Source Control in VS Code): driven only by the user's buttons
// ---- Run panel: commands, processes, problems
runs.init(broadcast);
// on shutdown: the processes in the Run panel and the running Claude sessions are closed too (no orphan processes)
let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return; shuttingDown = true;
  try { runs.stopAll(); } catch {}
  for (const [id, r] of running) { try { r.kill?.(); } catch {} running.delete(id); }
  if (sig !== "exit") setTimeout(() => process.exit(0), 400).unref();
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "exit"]) process.on(sig, () => shutdown(sig));
const runRoute = (fn) => async (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).json({ error: t("Agent not found") });
  try { const r = await fn(leadOfTeam(a), a.team || a.id, req.body || {}, req.query); res.json(r ?? { ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
};
app.get("/api/agents/:id/run", runRoute(async (l, team) => ({ commands: runs.loadCommands(team), detected: runs.detect(l.cwd), runs: runs.list(team) })));
app.put("/api/agents/:id/run/commands", runRoute(async (_l, team, b) => ({ commands: runs.saveCommands(team, b.commands) })));
app.post("/api/agents/:id/run/start", runRoute(async (l, team, b) => runs.start({ team, cwd: l.cwd, cmd: String(b.cmd || "").trim(), label: b.label, dir: b.dir || "", kind: b.kind === "term" ? "term" : "cmd", check: !!b.check })));
app.get("/api/agents/:id/run/:rid", (req, res) => { const r = runs.get(req.params.rid); if (!r) return res.status(404).json({ error: t("Run not found") }); res.json(r); });
app.post("/api/agents/:id/run/:rid/stop", (req, res) => { res.json({ ok: runs.stop(req.params.rid) }); });
app.post("/api/agents/:id/run/:rid/input", (req, res) => { try { runs.write(req.params.rid, String(req.body?.text ?? "")); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
// open a local address in the default browser (localhost only)
app.post("/api/open-url", (req, res) => {
  const u = String(req.body?.url || "");
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(u)) return res.status(400).json({ error: t("Only local addresses can be opened") });
  let href; try { href = new URL(u).href; } catch { return res.status(400).json({ error: t("Invalid address") }); }
  if (/[&|^%"'<>\s]/.test(href)) return res.status(400).json({ error: t("The address contains a disallowed character") });
  // no shell (cmd /c start): characters like "&" must not turn into command separators
  const [cmd, args] = process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", href]] : process.platform === "darwin" ? ["open", [href]] : ["xdg-open", [href]];
  try { const c = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }); c.on("error", () => {}); c.unref(); } catch {}
  res.json({ ok: true });
});
app.delete("/api/agents/:id/run/:rid", (req, res) => { runs.remove(req.params.rid); res.json({ ok: true }); });
app.get("/api/runs/summary", (_req, res) => res.json(runs.summary()));
app.get("/api/agents/:id/problems", runRoute(async (_l, team) => ({ groups: runs.problemsFor(team) })));

// ---- code editor: project files
const fsRoute = (fn) => async (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).json({ error: t("Agent not found") });
  try { const r = await fn(a, req.body || {}, req.query); if (r !== undefined) res.json(r); }
  catch (e) { res.status(e.code === "CONFLICT" ? 409 : e.code === "ENOENT" ? 404 : 400).json({ error: e.code === "ENOENT" ? t("File not found") : e.message, mtime: e.mtime }); }
};
const fsChanged = (a, paths) => { broadcast({ type: "fs", team: a.team || a.id, paths }); broadcast({ type: "git", team: a.team || a.id }); };
app.get("/api/agents/:id/fs/list", fsRoute(async (a, _b, q) => ({ entries: fsx.list(a.cwd, String(q.dir || "")) })));
app.get("/api/agents/:id/fs/all", fsRoute(async (a) => fsx.allFiles(a.cwd)));
app.get("/api/agents/:id/fs/file", fsRoute(async (a, _b, q) => fsx.read(a.cwd, String(q.path || ""))));
app.get("/api/agents/:id/fs/raw", (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).end();
  try {
    const { abs } = fsx.resolveIn(a.cwd, String(req.query.path || ""));
    // a project file must not run as HTML/SVG on the station's origin (a script inside it could reach the API)
    const ext = path.extname(abs).toLowerCase();
    const img = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"].includes(ext);
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:");
    if (!img) { res.type("text/plain; charset=utf-8"); res.setHeader("Content-Disposition", "inline"); }
    res.sendFile(abs, { dotfiles: "allow", ...(img ? {} : { headers: { "Content-Type": "text/plain; charset=utf-8" } }) }, (e) => e && !res.headersSent && res.status(404).end());
  }
  catch { res.status(400).end(); }
});
app.get("/api/agents/:id/fs/search", fsRoute(async (a, _b, q) => fsx.search(a.cwd, { q: q.q, regex: q.regex === "1", cs: q.cs === "1", word: q.word === "1", include: q.include, exclude: q.exclude })));
app.post("/api/agents/:id/fs/stat", fsRoute(async (a, b) => fsx.stat(a.cwd, Array.isArray(b.paths) ? b.paths.map(String) : [])));
app.put("/api/agents/:id/fs/file", fsRoute(async (a, b) => { const r = fsx.write(a.cwd, String(b.path || ""), b.text, { base: b.base, bom: !!b.bom, force: !!b.force }); fsChanged(a, [r.path]); return r; }));
app.post("/api/agents/:id/fs/create", fsRoute(async (a, b) => { const r = fsx.create(a.cwd, String(b.path || ""), { dir: !!b.dir }); fsChanged(a, [r.path]); return r; }));
app.post("/api/agents/:id/fs/rename", fsRoute(async (a, b) => { const r = fsx.rename(a.cwd, String(b.from || ""), String(b.to || "")); fsChanged(a, [b.from, r.path]); return r; }));
app.post("/api/agents/:id/fs/delete", fsRoute(async (a, b) => { const r = fsx.remove(a.cwd, String(b.path || "")); fsChanged(a, [b.path]); return r; }));
app.post("/api/agents/:id/fs/restore", fsRoute(async (a, b) => { const r = fsx.restore(String(b.trash || "")); fsChanged(a, [r.path]); return r; }));

const gitRoute = (fn) => async (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).json({ error: t("Agent not found") });
  if (!(await cp.isRepo(a.cwd))) return res.status(400).json({ error: t("This project is not a git repository"), norepo: true });
  try { const r = await fn(a, req.body || {}, req.query); if (r !== undefined) res.json(r); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { if (req.method !== "GET") broadcast({ type: "git", team: a.team || a.id }); }
};
app.get("/api/agents/:id/git", gitRoute(async (a) => ({ ...(await gp.status(a.cwd)), log: await gp.log(a.cwd), busy: teamOf(a.id).some((m) => running.has(m.id)), merging: gp.mergeState(a.cwd) })));
app.get("/api/agents/:id/git/diff", gitRoute(async (a, _b, q) => ({ diff: await gp.diff(a.cwd, String(q.path || ""), { staged: q.staged === "1", untracked: q.untracked === "1" }) })));
app.get("/api/agents/:id/git/show", gitRoute(async (a, _b, q) => (q.path ? { diff: await gp.show(a.cwd, String(q.sha), String(q.path)) } : await gp.show(a.cwd, String(q.sha)))));
app.post("/api/agents/:id/git/stage", gitRoute(async (a, b) => { if (b.all) await gp.stageAll(a.cwd); else await gp.stage(a.cwd, b.paths); return { ok: true }; }));
app.post("/api/agents/:id/git/unstage", gitRoute(async (a, b) => { await gp.unstage(a.cwd, b.paths); return { ok: true }; }));
app.post("/api/agents/:id/git/discard", gitRoute(async (a, b) => { await gp.discard(a.cwd, b.paths, b.untracked); return { ok: true }; }));
app.post("/api/agents/:id/git/commit", gitRoute(async (a, b) => ({ ok: true, summary: await gp.commit(a.cwd, b.message, { all: !!b.all }) })));
app.post("/api/agents/:id/git/push", gitRoute(async (a) => ({ ok: true, message: await gp.push(a.cwd) })));
app.post("/api/agents/:id/git/pull", gitRoute(async (a) => { await gp.pull(a.cwd); return { ok: true }; }));
app.get("/api/agents/:id/git/branches", gitRoute(async (a) => gp.branches(a.cwd)));
app.post("/api/agents/:id/git/checkout", gitRoute(async (a, b) => {
  if (teamOf(a.id).some((m) => running.has(m.id))) throw new Error(t("An agent in the team is working; wait for it to finish or stop it before switching branches"));
  return gp.checkout(a.cwd, b.name, { create: !!b.create, from: b.from || "" });
}));
app.post("/api/agents/:id/git/branch-delete", gitRoute(async (a, b) => gp.deleteBranch(a.cwd, b.name, !!b.force)));
app.post("/api/agents/:id/git/merge", gitRoute(async (a, b) => gp.merge(a.cwd, b.name)));
app.post("/api/agents/:id/git/pull-merge", gitRoute(async (a) => gp.pullMerge(a.cwd)));
app.post("/api/agents/:id/git/merge-abort", gitRoute(async (a) => gp.mergeAbort(a.cwd)));
app.post("/api/agents/:id/git/merge-continue", gitRoute(async (a) => gp.mergeContinue(a.cwd)));
app.get("/api/agents/:id/git/conflict", gitRoute(async (a, _b, q) => gp.conflictFile(a.cwd, String(q.path || ""))));
app.post("/api/agents/:id/git/resolve", gitRoute(async (a, b) => (b.side ? gp.resolveWhole(a.cwd, String(b.path), b.side) : gp.resolveFile(a.cwd, String(b.path), b.choices || []))));
app.post("/api/agents/:id/git/fetch", gitRoute(async (a) => { await gp.fetch(a.cwd); return { ok: true }; }));
// commit message suggestion: changes + related Scope items → short message in the UI language
app.post("/api/agents/:id/git/suggest", gitRoute(async (a) => {
  const ch = await gp.changesForMessage(a.cwd);
  if (!ch.files.length) throw new Error(t("No changes to commit"));
  const items = reqs.load(a.team || a.id).items.filter((x) => x.status !== "dropped").slice(0, 80).map((x) => `${x.code}: ${x.title}`).join("\n");
  if (MOCK) {
    const first = ch.files[0].split("/").pop();
    return { message: (ch.files.length > 1 ? t("{first} and {n} {n|file|files} updated", { first, n: ch.files.length - 1 }) : t("{first} updated", { first })) + `\n\n- ${ch.files.slice(0, 6).join("\n- ")}` };
  }
  const prompt = t("Write a short, meaningful commit message for the git changes below.") + " " +
    t("Rules: first line at most 72 characters, in {language}, imperative mood or stating the result; if needed, at most 4 bullet points after a blank line.", { language: langName() }) + " " +
    t("If the change is CLEARLY related to one of the requirements below, put its code at the start of the first line (e.g. 'R-012: ...'); if you are not sure, write no code.") + " " +
    t("Write ONLY the commit message, no other explanation, quotes or code block.") + "\n\n" +
    (items ? `${t("Requirements:")}\n${items}\n\n` : "") + `${t("File summary:")}\n${ch.stat}\n${ch.untracked.length ? `${t("New files: {files}", { files: ch.untracked.join(", ") })}\n` : ""}\n${t("Diff:")}\n${ch.diff}`;
  const msg = (await oneShot(prompt, { cwd: a.cwd })).replace(/^```\w*\n?|```$/g, "").trim();
  return { message: msg };
}));
// short git summary of all projects (for the list and the header badges)
app.get("/api/git/summary", async (_req, res) => {
  const leads = listAgents().filter((x) => roleOf(x) === "dev");
  const out = {};
  await Promise.all(leads.map(async (l) => { out[l.team || l.id] = (await cp.isRepo(l.cwd)) ? await gp.summary(l.cwd) : { ok: false }; }));
  res.json(out);
});

// ---- changes: file diff, revert, git init
const SHA = /^[0-9a-f]{7,64}$/;
app.get("/api/agents/:id/diff", async (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).json({ error: t("Agent not found") });
  const { a: x, b: y, path: p } = req.query;
  if (!SHA.test(String(x)) || !SHA.test(String(y)) || !p) return res.status(400).json({ error: t("Missing information") });
  try { res.type("text/plain; charset=utf-8").send(await cp.fileDiff(a.cwd, String(x), String(y), String(p))); }
  catch (e) { res.status(500).json({ error: e.stderr || e.message }); }
});
app.post("/api/agents/:id/revert", async (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).json({ error: t("Agent not found") });
  const { base, head, force } = req.body || {};
  if (!SHA.test(String(base)) || !SHA.test(String(head))) return res.status(400).json({ error: t("Missing information") });
  if (teamOf(a.id).some((m) => running.has(m.id))) return res.status(409).json({ error: t("An agent in the team is working; revert when it finishes.") });
  try {
    const r = await cp.revert(a.cwd, String(base), String(head), { force: !!force });
    if (r.conflict) return res.status(409).json({ conflict: r.conflict, error: t("These files changed again after the task: {files}", { files: r.conflict.slice(0, 5).join(", ") }) });
    const convId = ensureConvs(a).activeConv;
    const ev = { type: "reverted", agentId: a.id, convId, base, head, count: r.reverted };
    appendLog(a.id, ev, convId); broadcast(ev);
    res.json(r);
  } catch (e) { res.status(500).json({ error: t("Could not revert: {error}", { error: e.stderr || e.message }) }); }
});
app.post("/api/agents/:id/git-init", async (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).json({ error: t("Agent not found") });
  try { await cp.initRepo(a.cwd); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.stderr || e.message }); }
});

// A Stop pressed while the job is only starting (or the request is in flight) must count too: it is cut as soon as it starts
const stopAsked = new Map(); // agentId -> time
app.post("/api/agents/:id/stop", (req, res) => {
  const r = running.get(req.params.id);
  if (chains.has(req.params.id)) chains.get(req.params.id).cancelled = true; // the lead stopped: the team result must not come back
  if (!r || r.starting) { stopAsked.set(req.params.id, Date.now()); return res.json({ ok: true, pending: true }); }
  r.kill();
  res.json({ ok: true });
});

// ---- Hand the message to the agent and run it. Both the chat and the team lead/members go through here.
// opts.auto: a message from the station, not the user (team result); a note is shown in the chat instead of a bubble
// opts.task: a task given by the lead ({ from })
class PromptError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function startPrompt(agentId, body = {}, opts = {}) {
  const agent = getAgent(agentId);
  if (!agent) throw new PromptError(404, t("Agent not found"));
  let text = String(body.text || "").trim();
  const images = (Array.isArray(body.images) ? body.images : []).map(String).filter((p) => isImage(p) && fs.existsSync(p)).slice(0, 10);
  const docIds = (Array.isArray(body.docs) ? body.docs : []).map(String).slice(0, 20);
  if (!text && !images.length && !docIds.length) throw new PromptError(400, t("Empty message"));
  if (running.has(agent.id)) throw new PromptError(409, t("Agent is busy; stop it or wait for it to finish"));
  if (!opts.auto && !opts.task) stopAsked.delete(agent.id); // new user message: the old stop request is void
  running.set(agent.id, { kill() {}, starting: true }); // reserve the slot (no race)
  if (agent.attention) { try { updateAgent(agent.id, { attention: null }); broadcast({ type: "agents_changed" }); } catch {} }
  try {
    const docs = await describeDocs(docIds);
    const team = teamOf(agent.id);
    // manual handoff (@Role): the latest result of another role is attached to this message
    const from = body.handoffFrom ? team.find((m) => m.id === String(body.handoffFrom) && m.id !== agent.id) : null;
    if (!text) text = docs.length ? t("Review the attached documents.") : t("Look at the attached image.");
    let promptText = opts.prompt || text;
    if (images.length) promptText += `\n\n${images.map((p) => t("Attached image: {path}", { path: p })).join("\n")}`;
    if (docs.length) promptText += `\n\n${t("Reference documents (Ecelon document library):")}\n${referenceLines(docs)}`;
    if (from) {
      const sum = lastResult(from.id);
      promptText += `\n\n---\n${t("Team handoff: this work comes from the {role} role.", { role: ROLES[roleOf(from)].label })}` +
        (sum ? ` ${t("{role} finished its latest work like this:", { role: ROLES[roleOf(from)].label })}\n\n${sum}` : " " + t("(It has not written a result yet.)"));
    }
    for (const p of images) seenImages(agent.id).add(path.resolve(p).toLowerCase());
    const convId = ensureConvs(agent).activeConv;
    { const c = activeConv(getAgent(agent.id)); patchConv(agent.id, convId, { updatedAt: Date.now(), ...(c && !c.title && !opts.auto ? { title: text.slice(0, 80) } : {}) }); }
    const userEv = {
      type: "user", agentId: agent.id, convId, text, images,
      ...(docs.length ? { docs: docs.map((d) => ({ id: d.id, name: d.name, kind: d.kind })) } : {}),
      ...(from ? { handoff: { from: from.id, role: roleOf(from) } } : {}),
      ...(opts.task ? { handoff: { from: opts.task.from, role: roleOf(getAgent(opts.task.from)), task: true } } : {}),
      ...(opts.auto ? { auto: opts.auto } : {}),
      ...(opts.sibling ? { sibling: opts.sibling } : {}),
    };
    if (!opts._silentUser) { appendLog(agent.id, userEv, convId); broadcast(userEv); }

    const emit = (ev) => {
      if (ev.type === "rate_limit") { saveUsage(ev.info); return; }
      const full = { ...ev, agentId: agent.id };
      if (ev.type === "tool_use" && isImage(ev.summary)) seenImages(agent.id).add(path.resolve(ev.summary).toLowerCase());
      if (ev.type === "text") for (const p of findImagePaths(ev.text)) seenImages(agent.id).add(path.resolve(p).toLowerCase());
      if (ev.type === "status") { setStatus(agent.id, ev.status, { tool: ev.tool, note: ev.note }); return; }
      if (ev.type === "init" && ev.sessionId) {
        if (getAgent(agent.id)?.activeConv === convId) updateAgent(agent.id, { sessionId: ev.sessionId });
        patchConv(agent.id, convId, { sessionId: ev.sessionId });
        // if the team tool server could not start, the lead cannot assign tasks; do not pass over this silently
        if (team.length > 1 && Array.isArray(ev.mcp)) {
          const ek = ev.mcp.find((s) => s.name === "team");
          if (!ek || (ek.status && ek.status !== "connected")) teamEvent(leadOfTeam(agent).id, { kind: "note", text: "⚠ " + t("Team tools (task assignment, Scope) could not be loaded in this session{status}{error}.", { status: ek?.status ? ` (${ek.status})` : "", error: ev.mcpErr ? `: ${JSON.stringify(ev.mcpErr).slice(0, 200)}` : "" }) + " " + t("The Node path or the MCP configuration may be broken; look at data/server.log.") });
        }
      }
      full.convId = convId; full.t = Date.now(); // the same timestamp in the log and the live stream: the UI weeds out duplicates
      appendLog(agent.id, full, convId);
      broadcast(full);
    };

    const allowOnce = (Array.isArray(body.allowOnce) ? body.allowOnce : []).map(String).slice(0, 20);
    // model/effort/permission for this message only (the persistent setting does not change) — used by "Send to all"
    const ov = body.override || {};
    const once = {};
    if (typeof ov.model === "string" && /^[A-Za-z0-9][A-Za-z0-9._\-\[\]]{1,63}$/.test(ov.model)) once.model = ov.model;
    if (EFFORTS.includes(ov.effort)) once.effort = ov.effort;
    if (PERMISSIONS.includes(ov.permission)) once.permission = ov.permission;
    // documents are linked to the project: everyone in the team knows them
    const linked = await describeDocs([...new Set(team.flatMap((m) => linkedDocIds(m.id)))]);
    const lead = isLead(agent, team);
    // checkpoint: for roles that can write files, the state of the project is kept before the task
    const writes = !["analyst", "reviewer"].includes(roleOf(agent)) || team.length <= 1;
    const base = writes && (once.permission || agent.permission) !== "plan" ? await cp.snapshot(agent.cwd, "ecelon: before task") : null;
    let edited = false;
    const emit0 = emit;
    toolTrail.set(agent.id, []); // tools run in this turn (this is how we tell whether the tester really ran a test)
    const emitW = (ev) => { if (ev.type === "tool_use") { if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(ev.name)) edited = true; const tr = toolTrail.get(agent.id); if (tr && tr.length < 500) tr.push({ name: ev.name, summary: ev.summary }); } emit0(ev); };
    const runAgent = {
      ...agent, ...once, _allowOnce: allowOnce, _linkedDocs: linked.length ? referenceLines(linked) : "", _team: team,
      ...(team.length > 1 ? { ...mcpFor(agent, team), _tool: (name, args) => runTool(getAgent(agent.id), name, args) } : {}),
      ...(lead ? { _lead: true, _siblings: siblingsOf(agent).map((s) => s.name), _delegate: (role, task) => delegate(agent.id, role, task) } : {}),
      ...(opts.auto ? { _auto: opts.auto } : {}), ...(opts.task ? { _task: true } : {}), // where the prompt comes from (the mock runner picks its scenario from this, not from the prompt text)
    };
    const run = MOCK ? runMock(runAgent, promptText, emitW) : runClaude(runAgent, promptText, emitW);
    running.set(agent.id, run);
    if (Date.now() - (stopAsked.get(agent.id) || 0) < 15000) { stopAsked.delete(agent.id); run.kill(); }
    run.promise.then(async (result) => {
      // Claude Code deleted the old session (it cleans up after 30 days): reset the session and send the same message once more, with a new session
      if (result.resumeLost && !opts._retried) {
        running.delete(agent.id);
        patchConv(agent.id, convId, { sessionId: null });
        if (getAgent(agent.id)?.activeConv === convId) updateAgent(agent.id, { sessionId: null });
        emit0({ type: "note", text: t("Claude Code could not find the old session of this conversation (it may have expired).") + " " + t("A new session was opened and the message was sent again; the agent may not remember the previous conversation.") });
        try { await startPrompt(agentId, body, { ...opts, _retried: true, _silentUser: true }); } catch (e) { console.error("[ecelon] session renewal failed:", e.message); }
        return;
      }
      // after the task: what changed?
      if (base) {
        const head = await cp.snapshot(agent.cwd, "ecelon: after task");
        const files = head ? await cp.changes(agent.cwd, base, head).catch(() => []) : [];
        if (files.length) {
          const ev = { type: "changes", base, head, files: files.slice(0, 300), more: Math.max(0, files.length - 300) };
          emit0(ev);
          const owner = taskOwner.get(agent.id); if (owner) teamEvent(owner, { kind: "changes", from: agent.id, role: roleOf(agent), base, head, files: ev.files, more: ev.more });
        }
      } else if (edited && writes && !(await cp.isRepo(agent.cwd))) emit0({ type: "changes", norepo: true });
      running.delete(agent.id);
      const ctx = result.contextTokens ? { context: { tokens: result.contextTokens, window: result.contextWindow || null, at: Date.now() } } : {};
      patchConv(agent.id, convId, { updatedAt: Date.now(), ...(result.sessionId ? { sessionId: result.sessionId } : {}), ...ctx });
      const still = getAgent(agent.id)?.activeConv === convId;
      updateAgent(agent.id, {
        lastUsedAt: new Date().toISOString(),
        ...(still ? { sessionId: result.sessionId || agent.sessionId, ...ctx } : {}),
        addCostUsd: result.costUsd || 0,
      });
      broadcast({ type: "agents_changed" });
      onRunEnd(agent.id, result);
    }).catch((e) => { running.delete(agent.id); console.error("[ecelon] end of task could not be processed:", e?.stack || e); try { broadcast({ type: "agents_changed" }); } catch {} });
    return run;
  } catch (e) { if (running.get(agent.id)?.starting) running.delete(agent.id); throw e; }
}

app.post("/api/agents/:id/prompt", async (req, res) => {
  try {
    // the user wrote something new to the lead: a new work chain starts (the round counter resets)
    const a = getAgent(req.params.id);
    if (a && isLead(a, teamOf(a.id))) { const ch = chainOf(a.id); ch.rounds = 0; ch.cancelled = false; }
    await startPrompt(req.params.id, req.body || {});
    res.json({ started: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// =================== Team lead: task distribution ===================
// The lead (developer) gives a role a task with the `assign_task` tool. When the role finishes, its result is collected;
// when no pending task remains, the results go to the lead as a new message. The lead continues or
// writes the user a summary. There is a round limit against infinite loops.
const MAX_ROUNDS = 3;
const toolTrail = new Map(); // agentId -> [{name, summary}] (last turn)
const chains = new Map(); // leadId -> { pending: Map(memberId -> task), results: [], rounds, cancelled }
const chainOf = (leadId) => { if (!chains.has(leadId)) chains.set(leadId, { pending: new Map(), results: [], rounds: 0, cancelled: false }); return chains.get(leadId); };
const taskOwner = new Map(); // memberId -> leadId (the task running right now)
const isLead = (a, team) => team.length > 1 && roleOf(a) === "dev";
const teamTokens = new Map();
// constant-time token comparison (a length mismatch is simply "no")
function tokenOk(from, token) {
  const want = teamTokens.get(from); if (!want || typeof token !== "string") return false;
  const a = Buffer.from(want), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
const tokenFor = (id) => { if (!teamTokens.has(id)) teamTokens.set(id, randomUUID()); return teamTokens.get(id); };
// Tools open to the role + MCP config file (under data/; not committed to git)
function toolsFor(agent, team) {
  const role = roleOf(agent);
  const list = ["set_requirement_status", "list_requirements", "requirement_detail", "document_sections"];
  if (role === "analyst") list.push("save_requirements", "mark_sections");
  if (role === "tester") list.push("verify_requirement");
  if (role === "reviewer") list.push("report_missing_requirements");
  if (isLead(agent, team)) { list.push("assign_task"); if (siblingsOf(agent).length) list.push("notify_project"); }
  return list;
}
function mcpFor(agent, team) {
  const tools = toolsFor(agent, team);
  const dir = dataPath("mcp"); mkdirPrivate(dir);
  const file = path.join(dir, `${agent.id}.json`);
  const roles = team.filter((m) => m.id !== agent.id).map((m) => `${roleOf(m)}:${ROLES[roleOf(m)].label}`).join("|");
  const sibs = siblingsOf(agent).map((s) => `${s.team}:${s.name}`).join("|");
  const cfg = { mcpServers: { team: { type: "stdio", command: process.execPath, args: [rootPath("server", "team-mcp.js")],
    env: { ECELON_URL: `http://127.0.0.1:${PORT}`, ECELON_TOKEN: tokenFor(agent.id), ECELON_AGENT: agent.id, ECELON_ROLES: roles, ECELON_SIBLINGS: sibs, ECELON_TOOLS: tools.join(",") } } } };
  writePrivate(file, JSON.stringify(cfg, null, 2)); // holds the live ECELON_TOKEN: owner only
  return { _mcpConfig: file, _mcpTools: tools };
}
// Sibling projects: team keys in the lead's `links` field (kept two-way)
function siblingsOf(agent) {
  const lead = teamOf(agent.id).find((m) => roleOf(m) === "dev") || agent;
  const all = listAgents();
  return (lead.links || []).map((tk) => { const l = all.find((x) => (x.team || x.id) === tk && roleOf(x) === "dev") || all.find((x) => (x.team || x.id) === tk); return l ? { team: tk, name: l.name, lead: l } : null; }).filter(Boolean);
}
// write a team event into the lead's chat (shown as a card)
function teamEvent(leadId, ev) {
  const a = getAgent(leadId); if (!a) return;
  const convId = ensureConvs(a).activeConv;
  const full = { type: "team", agentId: leadId, convId, ...ev };
  appendLog(leadId, full, convId); broadcast(full);
}
const wait = (ms) => new Promise((x) => setTimeout(x, ms));
async function delegate(leadId, role, task) {
  const lead = getAgent(leadId); if (!lead) return { error: t("Lead not found") };
  const team = teamOf(leadId);
  const m = team.find((x) => roleOf(x) === role && x.id !== leadId);
  if (!m) return { error: t("There is no {role} in this team.", { role: ROLES[role]?.label || role }) + " " + t("Available roles: {roles}.", { roles: team.filter((x) => x.id !== leadId).map((x) => ROLES[roleOf(x)].label).join(", ") || t("none") }) + " " + t("Do the work yourself or suggest that the user adds this role.") };
  task = String(task || "").trim(); if (!task) return { error: t("Task text is empty") };
  const ch = chainOf(leadId);
  if (ch.pending.has(m.id)) return { error: t("{role} is already on a task; wait for its result.", { role: ROLES[role].label }) };
  if (ch.rounds > MAX_ROUNDS) return { error: t("The round limit ({n}) was reached; no new task can be given.", { n: MAX_ROUNDS }) + " " + t("Summarize the situation, the remaining problems and your suggestion for the user.") };
  ch.pending.set(m.id, task);
  teamEvent(leadId, { kind: "delegate", to: m.id, role, task });
  (async () => {
    while (running.has(m.id)) await wait(500); // if the role is on another job (e.g. the user wrote to it directly) wait for it to finish; that result must not go to the lead
    taskOwner.set(m.id, leadId);
    const prompt = `${t("The team lead ({role}) gave you this task:", { role: ROLES.dev.label })}\n\n${task}\n\n${t("When done, report the result briefly and clearly; the report is forwarded to the lead automatically.")}`;
    try { await startPrompt(m.id, { text: task }, { prompt, task: { from: leadId } }); }
    catch (e) { ch.pending.delete(m.id); taskOwner.delete(m.id); ch.results.push({ id: m.id, role, text: t("Task could not be started: {error}", { error: e.message }), ok: false }); maybeContinue(leadId); }
  })();
  return { message: t("Task given to the {role} role.", { role: ROLES[role].label }) + " " + t("Its result will come to you automatically as a new message when it finishes; if you have nothing else to do, end your turn with a short note.") };
}
// Direct task from the UI (quick commands): give it to the relevant role on the lead's behalf; the result returns to the lead, the lead summarizes
app.post("/api/agents/:id/delegate", async (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).json({ error: t("Agent not found") });
  const lead = leadOfTeam(a);
  const ch = chainOf(lead.id); if (!running.has(lead.id) && !ch.pending.size) { ch.rounds = 0; ch.cancelled = false; }
  const r = await delegate(lead.id, String(req.body?.role || ""), String(req.body?.task || ""));
  if (r.error) return res.status(400).json(r);
  res.json({ ok: true, message: r.message });
});
// Station side of the MCP tools (every call comes with the agent's own secret token)
app.post("/api/team/tool", async (req, res) => {
  const { token, from, tool, args = {} } = req.body || {};
  if (!from || !tokenOk(String(from), token)) return res.status(403).json({ error: t("Unauthorized") });
  const a = getAgent(String(from)); if (!a) return res.status(404).json({ error: t("Agent not found") });
  res.json(await runTool(a, tool, args));
});
async function runTool(a, tool, args = {}) {
  const team = teamOf(a.id);
  if (!toolsFor(a, team).includes(tool)) return { error: t("This tool is not available to you.") };
  const tk = a.team || a.id, by = ROLES[roleOf(a)].label;
  // tool enum → internal status ids (the station keeps "dropped" for out-of-scope items)
  const statusMap = { todo: "todo", doing: "doing", done: "done", unclear: "unclear", out_of_scope: "dropped" };
  try {
    switch (tool) {
      case "assign_task": return (await delegate(a.id, String(args.role || ""), args.task));
      case "notify_project": return (await notifySibling(a, String(args.project || ""), String(args.message || "")));
      case "save_requirements": {
        await syncCoverage(tk);
        const c = cov.load(tk); const badSegs = []; const touched = [];
        const items = (Array.isArray(args.items) ? args.items : []).map((m) => {
          if (m?.sections == null) return m;
          const { ids, bad } = cov.expandIds(m.sections, c); badSegs.push(...bad); touched.push(...ids);
          return { ...m, segs: ids, claimHint: cov.claimHintFor(c, ids) }; // if the linked section mentions "✓/completed" the document is saying "done"
        });
        const r = reqs.upsertMany(tk, items, args.mode === "replace" ? "replace" : "merge", by);
        cov.ackLinked(tk, touched);
        const cs = cov.compute(tk, reqs.load(tk).items).stats;
        broadcast({ type: "reqs", team: tk });
        teamEvent(leadOfTeam(a).id, { kind: "note", text: t("{by} updated the requirement list: {added} new, {changed} changed{removed} (total {total}).", { by, added: r.added, changed: r.changed, removed: r.removed ? `, ${t("{n} removed", { n: r.removed })}` : "", total: r.total }) + (r.mismatches ? ` ⚠ ${t("{n} {n|item|items}: the document says 'done' but {n|it is|they are} not verified", { n: r.mismatches })}.` : "") });
        const noCrit = reqs.load(tk).items.filter((x) => x.status !== "dropped" && !x.criteria?.length).length;
        return ({ message: t("Saved: {added} new, {changed} changed, {removed} removed; {total} {total|item|items} in total.", { added: r.added, changed: r.changed, removed: r.removed, total: r.total }) + " " + t("Document says 'done' but not verified: {n}.", { n: r.mismatches }) +
          (cs.total ? "\n" + t("Coverage: {open} of {total} document sections are still OPEN (not linked to any item and not marked 'contains no requirement').", { open: cs.open, total: cs.total }) + (cs.open ? " " + t("See the open ones with document_sections; link each one to an item (sections) or mark it with mark_sections giving a reason.") : " " + t("The whole document is covered.")) : "") +
          (noCrit ? "\n" + t("Items without acceptance criteria: {n}.", { n: noCrit }) + " " + t("Add measurable acceptance_criteria to every item.") : "") +
          (badSegs.length ? "\n" + t("Section codes not found (not linked): {codes}", { codes: [...new Set(badSegs)].join(", ") }) : "") });
      }
      case "set_requirement_status": {
        const r = reqs.setStatus(tk, args.code, { status: statusMap[args.status] || args.status, evidence: args.evidence, note: args.note, by, agent: true });
        if (r.error) return ({ error: r.error });
        broadcast({ type: "reqs", team: tk });
        return ({ message: `${r.item.code} → ${reqs.statusName(r.item.status)}${r.item.dropPending ? " " + t("(the out-of-scope decision awaits the user's approval; until then the item counts as open)") : ""}` });
      }
      case "requirement_detail": {
        await syncCoverage(tk); if (a.cwd) reqs.refreshStale(tk, a.cwd);
        const txt = reqs.detailText(tk, args.code, cov.segIndex(cov.load(tk)));
        return txt ? { message: txt } : { error: t("Requirement not found: {code}", { code: args.code }) };
      }
      case "document_sections": {
        await syncCoverage(tk);
        const f = ["open", "changed", "removed", "marked", "all"].includes(args.filter) ? args.filter : "open";
        return { message: cov.listText(tk, reqs.load(tk).items, { filter: f, doc: args.doc, from: Math.max(0, +args.start || 0) }) };
      }
      case "mark_sections": {
        await syncCoverage(tk);
        const r = cov.mark(tk, args.sections, { reason: args.reason, by, clear: !!args.remove, agent: true });
        if (r.error) return r;
        broadcast({ type: "reqs", team: tk });
        const st = cov.compute(tk, reqs.load(tk).items).stats;
        return { message: (args.remove ? t("{n} {n|section|sections} unmarked.", { n: r.count }) : t("{n} {n|section|sections} marked 'contains no requirement'.", { n: r.count })) + (r.bad.length ? " " + t("Not found: {codes}.", { codes: r.bad.join(", ") }) : "") + " " + t("Still open: {open}/{total}.", { open: st.open, total: st.total }) };
      }
      case "report_missing_requirements": {
        await syncCoverage(tk);
        const list = Array.isArray(args.items) ? args.items : [];
        if (!list.length) return { error: t("items is empty") };
        const c = cov.load(tk);
        const items = list.map((m) => ({ title: m.title, detail: [m.detail, m.why ? t("Reviewer's note: {why}", { why: m.why }) : ""].filter(Boolean).join("\n"), section: m.section, source: m.source, status: "unclear",
          segs: m.sections ? cov.expandIds(m.sections, c).ids : [], origin: "review" }));
        const r = reqs.upsertMany(tk, items, "merge", by);
        broadcast({ type: "reqs", team: tk });
        teamEvent(leadOfTeam(a).id, { kind: "note", text: "🔍 " + t("The reviewer found {n} possible requirements in the document that are not in the list (status: unclear).", { n: r.added }) + " " + t("The analyst should confirm.") });
        return { message: t("{n} {n|item|items} added as 'unclear'; the analyst will confirm.", { n: r.added }) };
      }
      case "list_requirements": {
        await syncCoverage(tk); if (a.cwd) reqs.refreshStale(tk, a.cwd); // stale verifications and document changes are processed before the list is read
        const s = reqs.summary(tk), cs = cov.compute(tk, reqs.load(tk).items).stats;
        const head = t("SUMMARY: {done}/{total} verified · mismatches {mismatches} · need re-verification {stale} · without acceptance criteria {noCriteria} · changed in the document {docChanged}", { done: s.done, total: s.total, mismatches: s.mismatches, stale: s.stale, noCriteria: s.noCriteria, docChanged: s.docChanged }) + (cs.total ? " · " + t("document coverage {pct}% (unmatched {open}, awaiting approval {pending})", { pct: cs.pct, open: cs.open, pending: cs.byAgent }) : " · " + t("no linked document"));
        return ({ message: head + "\n\n" + reqs.listText(tk, statusMap[args.status] || args.status, !!args.only_mismatches) });
      }
      case "verify_requirement": {
        if (a.cwd) reqs.refreshStale(tk, a.cwd);
        const ok = String(args.result || "").toLowerCase() === "verified";
        const ran = (toolTrail.get(a.id) || []).some((x) => ["Bash", "PowerShell"].includes(x.name));
        if (ok && !ran) return ({ error: t("You ran no command in this turn.") + " " + t("To say 'verified', REALLY try the item: run the relevant test (npm test, dotnet test, pytest…) or walk through the scenario with a command/request; then call verify_requirement again.") + " " + t("Reading the code is not verification.") });
        const r = reqs.verify(tk, args.code, { result: args.result, how: args.how, evidence: args.evidence, criteria: args.criteria, by }, a.cwd);
        if (r.error) return ({ error: r.error });
        broadcast({ type: "reqs", team: tk });
        if (r.item.verify.state === "failed" && r.item.claim === "done") teamEvent(leadOfTeam(a).id, { kind: "note", text: "⚠ " + t("{code}: the document says 'done' but the tester could not verify it — {how}", { code: r.item.code, how: r.item.verify.how }) });
        return ({ message: `${r.item.code} → ${reqs.verifyName(r.item.verify.state)}` });
      }
    }
    return { error: t("Unknown tool") };
  } catch (e) { return { error: e.message }; }
}
const leadOfTeam = (a) => teamOf(a.id).find((m) => roleOf(m) === "dev") || a;

// ---- notification to a sibling project: goes to the other project's lead as a message; its reply becomes a card in the sender's chat
const siblingOwner = new Map(); // receiving lead → sending lead
const siblingRate = new Map();  // "a>b" → timestamps (against loops)
async function notifySibling(from, projectName, message) {
  const sib = siblingsOf(from).find((s) => s.name.toLocaleLowerCase(locale()) === projectName.toLocaleLowerCase(locale()));
  if (!sib) return { error: t("Linked project not found: {name}.", { name: projectName }) + " " + t("Linked projects: {names}", { names: siblingsOf(from).map((s) => s.name).join(", ") || t("none") }) };
  message = message.trim(); if (!message) return { error: t("Message is empty") };
  const key = `${from.team || from.id}>${sib.team}`; const now = Date.now();
  const recent = (siblingRate.get(key) || []).filter((at) => now - at < 10 * 60e3);
  if (recent.length >= 3) return { error: t("3 notifications were sent to this project in the last 10 minutes; wait or ask the user so as not to enter a loop.") };
  recent.push(now); siblingRate.set(key, recent);
  const to = sib.lead;
  teamEvent(from.id, { kind: "sibling", to: to.id, project: to.name, task: message });
  (async () => {
    while (running.has(to.id)) await wait(800);
    const prompt = `${t('Notification from the team lead of the sibling project "{name}":', { name: from.name })}\n\n${message}\n\n` +
      t("If this affects your project, do what is needed (give your team a task if necessary).") + " " +
      t("When done, write briefly what you did; your reply is forwarded to the {name} team automatically.", { name: from.name }) + " " +
      t("You do not need to send a notification again as a reply.");
    try { siblingOwner.set(to.id, from.id); await startPrompt(to.id, { text: message }, { prompt, sibling: { from: from.id, project: from.name } }); }
    catch (e) { siblingOwner.delete(to.id); teamEvent(from.id, { kind: "note", text: t("Could not be forwarded to the {name} project: {error}", { name: to.name, error: e.message }) }); }
  })();
  return { message: t("The notification was forwarded to the lead of the {name} project.", { name: to.name }) + " " + t("When its reply arrives, it will land in the user's chat as a card.") };
}
app.post("/api/agents/:id/links", (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).json({ error: t("Agent not found") });
  const me = a.team || a.id; const all = listAgents();
  const want = new Set((Array.isArray(req.body?.teams) ? req.body.teams : []).map(String).filter((tk) => tk !== me && all.some((x) => (x.team || x.id) === tk)));
  const leadIdOf = (t) => (all.find((x) => (x.team || x.id) === t && roleOf(x) === "dev") || all.find((x) => (x.team || x.id) === t))?.id;
  const myLead = leadIdOf(me);
  const before = new Set(getAgent(myLead).links || []);
  updateAgent(myLead, { links: [...want] });
  // update the other sides too (two-way)
  for (const tk of new Set([...before, ...want])) {
    const lid = leadIdOf(tk); if (!lid) continue;
    const ls = new Set(getAgent(lid).links || []);
    if (want.has(tk)) ls.add(me); else ls.delete(me);
    updateAgent(lid, { links: [...ls] });
  }
  broadcast({ type: "agents_changed" });
  res.json({ links: [...want] });
});

// ---- user preferences (quick commands etc.) — data/prefs.json
const PREFS = dataPath("prefs.json");
const readPrefs = () => { try { return JSON.parse(fs.readFileSync(PREFS, "utf8")); } catch { return {}; } };
app.get("/api/i18n", (_req, res) => res.json({ lang: getLang(), dict: getDict() }));
app.get("/api/prefs", (_req, res) => res.json({ ...readPrefs(), lang: getLang() }));
app.put("/api/prefs", (req, res) => {
  const p = readPrefs(); const b = req.body || {};
  if (typeof b.lang === "string" && LANGS.includes(b.lang) && b.lang !== getLang()) { p.lang = b.lang; setLang(b.lang); setTimeout(() => broadcast({ type: "reload" }), 100); }
  if (Array.isArray(b.quick)) p.quick = b.quick.slice(0, 20).map((q) => ({ label: String(q?.label || "").trim().slice(0, 30), text: String(q?.text || "").trim().slice(0, 2000), ...(ROLES[q?.role] ? { role: q.role } : {}) })).filter((q) => q.label && q.text);
  mkdirPrivate(path.dirname(PREFS)); writePrivate(PREFS, JSON.stringify(p, null, 2));
  res.json(p);
});

// ---- document coverage: split the documents linked to the project into sections, mark the differences in a new version
const covJobs = new Map();
function syncCoverage(team) {
  if (covJobs.has(team)) return covJobs.get(team);
  const job = (async () => {
    try {
      const ids = listAgents().filter((x) => (x.team || x.id) === team).map((x) => x.id);
      const { docs, unreadable } = await docsTextFor(ids);
      const r = cov.sync(team, docs, unreadable);
      if (r.changedDocs.length) {
        const hit = reqs.flagDocChange(team, r.changedSegs, r.removedSegs);
        const l = listAgents().find((x) => (x.team || x.id) === team && roleOf(x) === "dev");
        if (l) teamEvent(l.id, { kind: "note", text: "📄 " + t("Document new version: {docs} — {changed} changed, {added} new, {removed} removed sections.", { docs: r.changedDocs.join(", "), changed: r.changedSegs.length, added: r.addedSegs.length, removed: r.removedSegs.length }) +
          (hit.length ? " " + t("Affected items: {items} (if verified, they now need re-verification).", { items: hit.join(", ") }) : "") + (r.addedSegs.length ? " " + t("The new sections are open; the analyst should link them.") : "") });
        broadcast({ type: "reqs", team });
      }
      return r;
    } catch (e) { console.warn("coverage could not be synced:", team, e.message); return null; }
    finally { covJobs.delete(team); }
  })();
  covJobs.set(team, job); return job;
}
let covAllT;
function syncAllCoverage() {
  clearTimeout(covAllT);
  covAllT = setTimeout(() => { for (const tk of new Set(listAgents().map((x) => x.team || x.id))) syncCoverage(tk); }, 400);
}
app.get("/api/reqs/:team/coverage", async (req, res) => {
  await syncCoverage(req.params.team);
  res.json(cov.compute(req.params.team, reqs.load(req.params.team).items));
});
app.post("/api/reqs/:team/coverage/mark", (req, res) => {
  const { ids, reason, clear } = req.body || {};
  const r = cov.mark(req.params.team, ids, { reason, by: t("User"), clear: !!clear });
  if (r.error) return res.status(400).json(r);
  broadcast({ type: "reqs", team: req.params.team }); res.json(r);
});
app.post("/api/reqs/:team/coverage/confirm", (req, res) => {
  const r = cov.confirm(req.params.team, Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null);
  broadcast({ type: "reqs", team: req.params.team }); res.json(r);
});
app.post("/api/reqs/:team/coverage/ack", (req, res) => {
  const r = cov.ack(req.params.team, (req.body?.ids || []).map(String));
  if (req.body?.items) { const d = reqs.load(req.params.team); for (const it of d.items) if (req.body.items.includes(it.code)) { delete it.docChange; it.changed = false; } reqs.save(req.params.team, d); }
  broadcast({ type: "reqs", team: req.params.team }); res.json(r);
});
// Add coverage data (links item → section)
app.post("/api/reqs/:team/:code/segs", (req, res) => {
  const d = reqs.load(req.params.team); const it = d.items.find((x) => x.code === req.params.code);
  if (!it) return res.status(404).json({ error: t("No such item") });
  const { ids, bad } = cov.expandIds(req.body?.ids || [], cov.load(req.params.team));
  it.segs = req.body?.replace ? ids : [...new Set([...(it.segs || []), ...ids])]; it.claimHint = cov.claimHintFor(cov.load(req.params.team), it.segs); reqs.save(req.params.team, d);
  broadcast({ type: "reqs", team: req.params.team }); res.json({ ok: true, segs: it.segs, bad });
});

// ---- requirements (Scope) UI endpoints
const teamCwd = (team) => listAgents().find((x) => (x.team || x.id) === team)?.cwd;
app.get("/api/reqs/:team", (req, res) => {
  const cwd = teamCwd(req.params.team);
  const { data, staled } = cwd ? reqs.refreshStale(req.params.team, cwd) : { data: reqs.load(req.params.team), staled: 0 };
  if (staled) { const l = listAgents().find((x) => (x.team || x.id) === req.params.team && roleOf(x) === "dev"); if (l) teamEvent(l.id, { kind: "note", text: "⚠ " + t("The evidence file of {n} verified items changed; they need re-verification.", { n: staled }) }); }
  res.json({ ...data, items: data.items.map((x) => ({ ...x, mismatch: reqs.isMismatch(x) })) });
});
app.get("/api/reqs/:team/summary", (req, res) => {
  const cwd = teamCwd(req.params.team); if (cwd) reqs.refreshStale(req.params.team, cwd);
  res.json({ ...reqs.summary(req.params.team), coverage: cov.compute(req.params.team, reqs.load(req.params.team).items).stats });
});
app.post("/api/reqs/:team/:code/criteria", (req, res) => {
  const r = reqs.setCriteria(req.params.team, req.params.code, { list: req.body?.list, index: req.body?.index, state: req.body?.state });
  if (r.error) return res.status(400).json(r);
  broadcast({ type: "reqs", team: req.params.team }); res.json(r);
});
app.post("/api/reqs/:team/:code/verify", (req, res) => {
  const { result, how, evidence } = req.body || {};
  const r = reqs.verify(req.params.team, req.params.code, { result, how: how || t("The user verified it by hand"), evidence, by: t("User"), manual: true }, teamCwd(req.params.team) || ".");
  if (r.error) return res.status(400).json(r);
  broadcast({ type: "reqs", team: req.params.team }); res.json(r);
});
app.patch("/api/reqs/:team/:code", (req, res) => {
  const { status, note, evidence, claim } = req.body || {};
  const r = reqs.setStatus(req.params.team, req.params.code, { status, note, evidence, claim, by: t("User") });
  if (r.error) return res.status(400).json(r);
  broadcast({ type: "reqs", team: req.params.team }); res.json(r);
});
app.post("/api/reqs/:team", (req, res) => {
  const title = String(req.body?.title || "").trim(); if (!title) return res.status(400).json({ error: t("Title is required") });
  const r = reqs.addItem(req.params.team, { title, section: req.body?.section, detail: req.body?.detail });
  broadcast({ type: "reqs", team: req.params.team }); res.json(r);
});
app.delete("/api/reqs/:team/:code", (req, res) => { const r = reqs.removeItem(req.params.team, req.params.code); broadcast({ type: "reqs", team: req.params.team }); res.json(r); });
// ---- notifications: work done / awaiting permission / error (silent if the lead will continue or it is a member)
function notify(agentId, result) {
  const a = getAgent(agentId); if (!a) return;
  { // a state that needs attention: shown in the list and the header; cleared by a new message
    const d = result.permissionDenials || [];
    const att = d.length ? { kind: "permission", text: t("Awaiting permission: {tools}", { tools: d.map((x) => x.spec || x.tool).slice(0, 2).join(", ") }), at: Date.now() } : result.isError && result.subtype !== "interrupted" ? { kind: "error", text: t("Finished with an error"), at: Date.now() } : null;
    if (att || a.attention) { try { updateAgent(agentId, { attention: att }); broadcast({ type: "agents_changed" }); } catch {} }
  }
  if (taskOwner.has(agentId)) return;
  if (running.has(agentId)) return;            // the lead continues with the team results
  if (chains.get(agentId)?.pending.size) return; // the team is still working
  const denials = result.permissionDenials || [];
  const kind = denials.length ? "permission" : result.isError ? "error" : "done";
  const team = teamOf(agentId);
  const who = team.length > 1 && roleOf(a) !== "dev" ? `${a.name} · ${ROLES[roleOf(a)].label}` : a.name;
  const first = (lastResult(agentId, 400) || "").replace(/[#*`>|_]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
  const body = kind === "permission" ? t("Awaiting permission: {tools}", { tools: denials.map((d) => d.spec || d.tool).slice(0, 2).join(", ") }) : kind === "error" ? `${t("Finished with an error.")} ${first}` : first || t("Done.");
  const ev = { type: "notify", agentId, kind, title: who, body };
  broadcast(ev);
  if (wss.clients.size === 0) windowsToast(`Ecelon · ${who}`, body);
}
function windowsToast(title, body) {
  // macOS / Linux: the system notifier, fire and forget (title and body are passed as arguments, never as script text)
  if (process.platform === "darwin") { try { spawn("osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title, body], { stdio: "ignore" }).on("error", () => {}); } catch {} return; }
  if (process.platform !== "win32") { try { spawn("notify-send", ["--", title, body], { stdio: "ignore" }).on("error", () => {}); } catch {} return; }
  const ps = '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;' +
    '$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);' +
    '$x = $t.GetElementsByTagName("text"); $x.Item(0).AppendChild($t.CreateTextNode($env:ECELON_T)) > $null; $x.Item(1).AppendChild($t.CreateTextNode($env:ECELON_B)) > $null;' +
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe").Show([Windows.UI.Notifications.ToastNotification]::new($t))';
  try {
    const c = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], { env: { ...process.env, ECELON_T: title, ECELON_B: body }, windowsHide: true, stdio: "ignore" });
    c.on("error", () => {});
  } catch {}
}

function onRunEnd(agentId, result) {
  // it processed the notification from the sibling project → the reply becomes a card in the sending lead's chat
  const sibFrom = siblingOwner.get(agentId);
  if (sibFrom && !(chains.get(agentId)?.pending.size)) {
    siblingOwner.delete(agentId);
    const a = getAgent(agentId);
    teamEvent(sibFrom, { kind: "sibling-result", from: agentId, project: a?.name, ok: !result.isError, text: (lastResult(agentId, 3000) || t("(no reply)")) });
  }
  // a member's task finished → write the result into the lead's slot
  const leadId = taskOwner.get(agentId);
  if (leadId) {
    taskOwner.delete(agentId);
    const ch = chainOf(leadId); ch.pending.delete(agentId);
    const a = getAgent(agentId);
    const text = lastResult(agentId, 8000) || (result.isError ? t("Finished with an error.") : t("(It wrote no reply.)"));
    const ok = !result.isError && !result.killed;
    ch.results.push({ id: agentId, role: roleOf(a), text, ok });
    teamEvent(leadId, { kind: "result", from: agentId, role: roleOf(a), ok, text: text.length > 1500 ? text.slice(0, 1500) + "…" : text });
    maybeContinue(leadId);
  }
  // the lead finished its own turn; if a result arrived meanwhile, continue
  if (chains.has(agentId)) maybeContinue(agentId);
  setTimeout(() => notify(agentId, result), 50);
}
async function maybeContinue(leadId) {
  const ch = chainOf(leadId);
  if (ch.pending.size || !ch.results.length || running.has(leadId)) return;
  const results = ch.results.splice(0);
  if (ch.cancelled) { teamEvent(leadId, { kind: "note", text: t("Because you stopped it, the team results were not forwarded to the lead.") }); return; }
  ch.rounds++;
  const over = ch.rounds > MAX_ROUNDS;
  const body = results.map((r) => `## ${ROLES[r.role]?.label || r.role}${r.ok ? "" : " " + t("(finished with problems)")}\n${r.text}`).join("\n\n");
  // before saying "work done" the lead must see the counters: document mismatch, stale verification, unmatched section
  let gate = "";
  try {
    const lead = getAgent(leadId); const tk = lead.team || lead.id;
    if (lead.cwd) reqs.refreshStale(tk, lead.cwd);
    const s = reqs.summary(tk); const cs = cov.compute(tk, reqs.load(tk).items).stats;
    const issues = [s.mismatches ? t("{n} {n|item|items}: the document says 'done' but {n|it is|they are} not verified", { n: s.mismatches }) : "", s.stale ? t("the verification of {n} {n|item|items} went stale (evidence file changed)", { n: s.stale }) : "", s.failed ? t("{n} {n|item|items} failed verification", { n: s.failed }) : "", s.docChanged ? t("{n} {n|item|items} changed in the new version of the document", { n: s.docChanged }) : "", cs.open ? t("{n} document {n|section is|sections are} not linked to any requirement", { n: cs.open }) : ""].filter(Boolean);
    if (s.total || cs.total) gate = "\n\n" + t("SCOPE STATUS: {done}/{total} verified.", { done: s.done, total: s.total }) + (issues.length ? " " + t("OPEN ISSUES: {issues}.", { issues: issues.join("; ") }) + " " + t("Do not tell the user 'work done' before these are closed; give what is needed to the relevant role or report it to the user explicitly as missing.") : " " + t("No open issues."));
  } catch {}
  const prompt = `${t("Results from the team:")}\n\n${body}${gate}\n\n` + (over
    ? t("The round limit ({n}) was reached: do NOT give a new task.", { n: MAX_ROUNDS }) + " " + t("Briefly summarize the situation, the remaining problems and your suggestion for the user.")
    : t("Continue based on these results: fix things and reassign if needed.") + " " + t("If the work is done, tell the user what was done and the result in a short summary."));
  if (over) teamEvent(leadId, { kind: "note", text: t("The round limit ({n}) was reached; the lead will summarize the situation.", { n: MAX_ROUNDS }) });
  try { await startPrompt(leadId, { text: results.map((r) => ROLES[r.role]?.label || r.role).join(", ") }, { prompt, auto: "team" }); }
  catch (e) { teamEvent(leadId, { kind: "note", text: t("The lead could not be continued: {error}", { error: e.message }) }); }
}


// The latest reply text in an agent's active conversation (what it wrote after the last user message)
function lastResult(agentId, max = 6000) {
  const a = getAgent(agentId); if (!a) return "";
  const evs = readLog(agentId, 400, a.activeConv);
  let i = evs.length - 1; while (i >= 0 && evs[i].type !== "user") i--;
  const txt = evs.slice(i + 1).filter((e) => e.type === "text" && e.text).map((e) => e.text).join("\n\n").trim();
  return txt.length > max ? "…" + txt.slice(-max) : txt;
}

// The same order to several agents: one after another for the quota (the next does not start before the previous finishes)
// Options: override (model/effort/permission for this message only), newConv (a new conversation for every agent),
// parallel (all at once; if off, one by one — for the usage limit)
app.post("/api/broadcast", (req, res) => {
  const { ids, text, override = {}, newConv = false, parallel = false } = req.body || {};
  if (!String(text || "").trim()) return res.status(400).json({ error: t("Empty message") });
  const targets = (Array.isArray(ids) && ids.length ? ids : listAgents().filter((a) => roleOf(a) === "dev").map((a) => a.id)).filter((id) => getAgent(id));
  res.json({ queued: targets.length });
  const wait = (ms) => new Promise((x) => setTimeout(x, ms));
  const sendOne = async (id) => {
    while (running.has(id)) await wait(400); // if the agent is busy wait for it to finish its job
    if (newConv) { startNewConv(id); broadcast({ type: "agents_changed" }); }
    const r = await fetch(`http://127.0.0.1:${PORT}/api/agents/${id}/prompt`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, override }),
    }).catch(() => null);
    if (r && r.ok && !parallel) { await wait(300); while (running.has(id)) await wait(400); }
  };
  (async () => {
    if (parallel) await Promise.all(targets.map(sendOne));
    else for (const id of targets) await sendOne(id);
  })();
});

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello", mock: MOCK }));
});

// when something under public/ changes, open browsers reload themselves
try {
  let tm;
  fs.watch(PUBLIC, { recursive: true }, () => { clearTimeout(tm); tm = setTimeout(() => broadcast({ type: "reload" }), 250); });
} catch {}

{ const n = ensureFullTeams(); if (n) console.log(`Teams completed: ${n} roles added`); }
if (MOCK && process.env.ECELON_DEMO === "1") await seedDemo().catch((e) => console.error("[demo] seed failed:", e.message));
const onListenError = (e) => {
  if (e.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use (is Ecelon Station already running?). Try another one: ecelon-station --port ${PORT + 1}`);
  else if (e.code === "EACCES") console.error(`No permission to listen on port ${PORT}. Try: ecelon-station --port 4777`);
  else console.error("The server could not start:", e.message);
  process.exit(1);
};
server.on("error", onListenError); wss.on("error", onListenError); // ws re-emits the server's errors on wss and throws if nobody listens
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Ecelon Station → http://127.0.0.1:${PORT}  (${MOCK ? "MOCK mode" : "claude -p"})`);
  if (!MOCK) {
    console.log(resolveClaude() ? `Claude Code: ${resolveClaude()}` : `WARNING: ${claudeMissingHint()}`);
    claudeVersion().then((v) => { const i = cliInfo(); console.log(`Claude Code version: ${v ? v.join(".") : "unknown"}${i.via && i.via !== i.bin ? ` (${i.via})` : ""}`); if (v && (v[0] < 2 || (v[0] === 2 && v[1] < 1))) console.log("WARNING: Claude Code is old; update it with `npm i -g @anthropic-ai/claude-code`."); });
  }
});
