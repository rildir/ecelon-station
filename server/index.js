// Ecelon Station — sunucu
// REST: ajan CRUD + prompt gönderme; WebSocket: canlı olay akışı.
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import { listAgents, getAgent, addAgent, updateAgent, removeAgent, resetSession, reorderAgents, MODELS, EFFORTS, PERMISSIONS } from "./agents.js";
import { runClaude, resolveClaude, uploadsDir } from "./runner.js";
import { runMock } from "./mockRunner.js";

const PORT = Number(process.env.PORT || 4777);
const MOCK = process.env.MOCK === "1";
const LOG_DIR = path.resolve("logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

const app = express();
// ---------- güvenlik: yalnızca bu bilgisayardaki kendi arayüzümüz konuşabilir ----------
// Tarayıcıda açık başka bir site 127.0.0.1'e istek atabilir (CSRF) ya da DNS rebinding ile
// sunucumuzu kendi alanı gibi gösterebilir. Host ve Origin başlıklarını sıkı denetliyoruz.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const originOk = (origin) => !origin || ALLOWED_ORIGINS.has(origin);
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(req.headers.host)) return res.status(403).send("Bu sunucuya yalnızca 127.0.0.1 üzerinden erişilebilir.");
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (unsafe && (!originOk(req.headers.origin) || req.headers["sec-fetch-site"] === "cross-site")) return res.status(403).json({ error: "Başka bir siteden gelen istek reddedildi." });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: "40mb" })); // görsel yüklemeleri için
app.use(express.static(path.resolve("public")));
// three.js'i bundler'sız, doğrudan node_modules'tan servis et
app.use("/vendor/three", express.static(path.resolve("node_modules/three")));
app.use("/vendor/fonts", express.static(path.resolve("node_modules/@fontsource")));

const server = http.createServer(app);
const wss = new WebSocketServer({
  server, path: "/ws",
  // başka sitelerin sohbetleri okumasını engelle
  verifyClient: ({ origin, req }) => ALLOWED_HOSTS.has(req.headers.host) && originOk(origin),
});

function broadcast(ev) {
  const data = JSON.stringify(ev);
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}

// ---------- konuşmalar: her ajanın birden çok konuşması olur, her biri ayrı kayıt + ayrı Claude oturumu ----------
const logFile = (agentId, convId) => path.join(LOG_DIR, String(agentId), `${convId}.jsonl`);
const newConvId = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
function firstUserText(file) {
  try { for (const l of fs.readFileSync(file, "utf8").split("\n")) { if (!l) continue; const e = JSON.parse(l); if (e.type === "user") return e.text; } } catch {}
  return "";
}
// Eski tek dosyalı kaydı ilk konuşma olarak taşı
function ensureConvs(agent) {
  if (Array.isArray(agent.convs) && agent.convs.length && agent.activeConv) return agent;
  const id = newConvId(), now = Date.now();
  fs.mkdirSync(path.join(LOG_DIR, agent.id), { recursive: true });
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

function appendLog(agentId, ev, convId) {
  if (ev.type === "text_delta" || ev.type === "thinking_delta" || ev.type === "status" || ev.type === "raw") return; // gürültü logda tutulmaz
  if (!convId) { const a = getAgent(agentId); if (!a) return; convId = ensureConvs(a).activeConv; }
  fs.mkdirSync(path.join(LOG_DIR, String(agentId)), { recursive: true });
  fs.appendFileSync(logFile(agentId, convId), JSON.stringify({ ...ev, t: Date.now() }) + "\n");
}

function readLog(agentId, limit = 400, convId) {
  if (!convId) { const a = getAgent(agentId); if (!a) return []; convId = ensureConvs(a).activeConv; }
  const f = logFile(agentId, convId);
  if (!fs.existsSync(f)) return [];
  const lines = fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// Çalışan koşular: agentId -> { kill }
const running = new Map();
const status = new Map(); // agentId -> "idle" | "thinking" | "tool" | "done" | "error"

function setStatus(agentId, s, extra = {}) {
  status.set(agentId, s);
  broadcast({ type: "status", agentId, status: s, ...extra });
}

// ---------- REST ----------
app.get("/api/meta", (_req, res) => res.json({ mock: MOCK, models: MODELS, efforts: EFFORTS, permissions: PERMISSIONS, platform: process.platform }));

// ---------- kullanım limitleri (Claude Code'un rate_limit_event'inden) ----------
const USAGE_FILE = path.resolve("data", "usage.json");
let usage = {};
try { usage = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")); } catch {}
function saveUsage(info) {
  if (!info?.kind) return;
  usage[info.kind] = { ...usage[info.kind], ...Object.fromEntries(Object.entries(info).filter(([, v]) => v !== null)), seenAt: Date.now() };
  try { fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true }); fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2)); } catch {}
  broadcast({ type: "usage", usage });
}
app.get("/api/usage", (_req, res) => res.json(usage));

// ---------- görseller ----------
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const isImage = (p) => typeof p === "string" && IMG_EXT.test(p.trim());
const _seen = new Map();
const seenImages = (id) => { if (!_seen.has(id)) _seen.set(id, new Set()); return _seen.get(id); };
// Metindeki görsel yolları (Windows ve POSIX)
function findImagePaths(text) {
  const out = new Set();
  const re = /(?:[A-Za-z]:[\\/]|\/)[^\s`"'<>|*?]+?\.(?:png|jpe?g|gif|webp|bmp)\b/gi;
  for (const m of String(text || "").matchAll(re)) out.add(m[0]);
  return [...out];
}
const inside = (root, p) => { const rel = path.relative(path.resolve(root), path.resolve(p)); return !rel.startsWith("..") && !path.isAbsolute(rel); };

// Açılışta eski sohbet kayıtlarından görülmüş görselleri geri yükle
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

// @dosya: proje içindeki dosyaları ara (önbellekli)
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

// Kullanıcının eklediği görseli kaydet (data:URL olarak gelir)
app.post("/api/agents/:id/upload", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Ajan bulunamadı" });
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/s.exec(String(req.body?.dataUrl || ""));
  if (!m) return res.status(400).json({ error: "Yalnızca png, jpg, gif ya da webp görsel eklenebilir." });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 20 * 1024 * 1024) return res.status(400).json({ error: "Görsel 20 MB'tan büyük olamaz." });
  const base = String(req.body?.name || "gorsel").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 40) || "gorsel";
  const file = path.join(uploadsDir(agent.id), `${Date.now()}-${base}.${m[1] === "jpeg" ? "jpg" : m[1]}`);
  fs.writeFileSync(file, buf);
  seenImages(agent.id).add(file.toLowerCase());
  res.json({ path: file });
});

// Görseli sun: yalnızca proje klasörü, yüklemeler ya da ajanın bu oturumda dokunduğu görseller
app.get("/api/agents/:id/image", (req, res) => {
  const agent = getAgent(req.params.id);
  const p = String(req.query.path || "");
  if (!agent || !isImage(p)) return res.status(404).end();
  const abs = path.resolve(p);
  const ok = inside(agent.cwd, abs) || inside(uploadsDir(agent.id), abs) || seenImages(agent.id).has(abs.toLowerCase());
  if (!ok) return res.status(403).end();
  if (!fs.existsSync(abs)) return res.status(404).end();
  res.sendFile(abs);
});

// İşletim sisteminin klasör seçme penceresini açar, seçilen yolu döndürür.
// Windows: PowerShell + FolderBrowserDialog (öne gelsin diye TopMost bir sahip pencereyle).
app.post("/api/pick-folder", (_req, res) => {
  let cmd, args;
  if (process.platform === "win32") {
    // modern Gezgin tarzı seçici (server/pick-folder.ps1); başlangıç klasörü istekten gelir
    const start = String(_req.body?.start || "");
    cmd = "powershell.exe";
    args = ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", path.resolve("server", "pick-folder.ps1"), "-Start", start && fs.existsSync(start) ? start : path.join(os.homedir(), "Desktop")];
  } else if (process.platform === "darwin") {
    cmd = "osascript"; args = ["-e", 'POSIX path of (choose folder with prompt "Ajanın çalışacağı proje klasörünü seç")'];
  } else {
    cmd = "zenity"; args = ["--file-selection", "--directory", "--title=Proje klasörünü seç"];
  }
  let out = "", done = false;
  const finish = (code, body) => { if (!done) { done = true; res.status(code).json(body); } };
  try {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: false });
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.on("error", () => finish(501, { error: "Bu sistemde klasör seçme penceresi açılamadı; yolu elle yapıştır." }));
    child.on("close", () => {
      const p = out.trim().replace(/\/$/, "");
      if (!p) return finish(200, { cancelled: true });
      finish(200, { path: p, name: path.basename(p) });
    });
  } catch { finish(501, { error: "Klasör seçme penceresi açılamadı." }); }
});

// Bir klasörün alt klasörlerini listeler (arayüzde "Tara" ile proje seçmek için)
app.get("/api/scan", (req, res) => {
  const dir = String(req.query.dir || "").trim();
  if (!dir) return res.status(400).json({ error: "dir gerekli" });
  try {
    const have = new Set(listAgents().map((a) => path.resolve(a.cwd).toLowerCase()));
    const items = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
      .slice(0, 300)
      .map((d) => { const full = path.join(dir, d.name); return { name: d.name, path: full, hasAgent: have.has(path.resolve(full).toLowerCase()) }; });
    res.json(items);
  } catch (e) { res.status(400).json({ error: "Klasör okunamadı: " + dir }); }
});

app.get("/api/agents", (_req, res) => {
  res.json(listAgents().map((a) => ({ ...a, status: status.get(a.id) || "idle", busy: running.has(a.id) })));
});

app.post("/api/agents/reorder", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
  if (!ids) return res.status(400).json({ error: "ids gerekli" });
  reorderAgents(ids); broadcast({ type: "agents_changed" }); res.json({ ok: true });
});

app.post("/api/agents", (req, res) => {
  try {
    const { name, cwd, model, effort, permission } = req.body || {};
    if (!cwd) return res.status(400).json({ error: "cwd gerekli" });
    if (!MOCK && !fs.existsSync(cwd)) return res.status(400).json({ error: "Klasör bulunamadı: " + cwd });
    const a = addAgent({ name, cwd, model, effort, permission });
    broadcast({ type: "agents_changed" });
    res.json(a);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.patch("/api/agents/:id", (req, res) => {
  try {
    const a = updateAgent(req.params.id, req.body || {});
    broadcast({ type: "agents_changed" });
    res.json(a);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/agents/:id", (req, res) => {
  try {
    const r = running.get(req.params.id); if (r) r.kill();
    const removed = removeAgent(req.params.id);
    broadcast({ type: "agents_changed" });
    res.json(removed);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Konuşma listesi
app.get("/api/agents/:id/convs", (req, res) => {
  const a0 = getAgent(req.params.id); if (!a0) return res.status(404).json({ error: "Ajan bulunamadı" });
  const a = ensureConvs(a0);
  res.json((a.convs || []).filter((c) => c.id === a.activeConv || fs.existsSync(logFile(a.id, c.id)))
    .map((c) => ({ ...c, active: c.id === a.activeConv })).sort((x, y) => y.updatedAt - x.updatedAt));
});
function startNewConv(agentId) {
  const a = ensureConvs(getAgent(agentId));
  const cur = activeConv(a);
  // şu anki konuşma boşsa yenisini açmaya gerek yok
  if (cur && !fs.existsSync(logFile(a.id, cur.id))) return a;
  const id = newConvId(), now = Date.now();
  const kept = a.convs.filter((c) => fs.existsSync(logFile(a.id, c.id))); // boş konuşmalar birikmesin
  return updateAgent(a.id, { convs: [...kept, { id, sessionId: null, title: "", createdAt: now, updatedAt: now, context: null }], activeConv: id, sessionId: null, context: null });
}
app.post("/api/agents/:id/convs", (req, res) => {
  if (!getAgent(req.params.id)) return res.status(404).json({ error: "Ajan bulunamadı" });
  if (running.has(req.params.id)) return res.status(409).json({ error: "Ajan çalışırken yeni konuşma açılamaz; önce durdur." });
  const a = startNewConv(req.params.id); broadcast({ type: "agents_changed" }); res.json({ activeConv: a.activeConv });
});
app.post("/api/agents/:id/convs/:cid/activate", (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).json({ error: "Ajan bulunamadı" });
  if (running.has(a.id)) return res.status(409).json({ error: "Ajan çalışırken konuşma değiştirilemez; önce durdur." });
  const c = (a.convs || []).find((x) => x.id === req.params.cid); if (!c) return res.status(404).json({ error: "Konuşma bulunamadı" });
  updateAgent(a.id, { activeConv: c.id, sessionId: c.sessionId || null, context: c.context || null });
  broadcast({ type: "agents_changed" }); res.json({ ok: true });
});
app.delete("/api/agents/:id/convs/:cid", (req, res) => {
  const a = getAgent(req.params.id); if (!a) return res.status(404).json({ error: "Ajan bulunamadı" });
  if (running.has(a.id) && a.activeConv === req.params.cid) return res.status(409).json({ error: "Çalışan konuşma silinemez." });
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
  try { if (running.has(req.params.id)) return res.status(409).json({ error: "Ajan çalışıyor; önce durdur." }); res.json(startNewConv(req.params.id)); broadcast({ type: "agents_changed" }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/agents/:id/log", (req, res) => res.json(readLog(req.params.id, 400, req.query.conv ? String(req.query.conv) : undefined)));

// Proje klasörünü (ya da içindeki bir dosyayı) işletim sisteminin dosya yöneticisinde aç.
// Güvenlik: yalnızca ajanın kendi klasörünün içindeki yollar açılır.
app.post("/api/agents/:id/open", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Ajan bulunamadı" });
  const root = path.resolve(agent.cwd);
  let target = root;
  if (req.body?.path) {
    const p = String(req.body.path);
    target = path.resolve(path.isAbsolute(p) ? p : path.join(root, p));
    const rel = path.relative(root, target);
    const outside = rel.startsWith("..") || path.isAbsolute(rel);
    if (outside && !seenImages(agent.id).has(target.toLowerCase()) && !inside(uploadsDir(agent.id), target)) return res.status(400).json({ error: "Bu yol projenin dışında." });
  }
  if (!fs.existsSync(target)) return res.status(404).json({ error: "Dosya bulunamadı: " + path.basename(target) });
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
  } catch (e) { res.status(500).json({ error: "Açılamadı: " + e.message }); }
});

app.post("/api/agents/:id/stop", (req, res) => {
  const r = running.get(req.params.id);
  if (!r) return res.status(400).json({ error: "Çalışan iş yok" });
  r.kill();
  res.json({ ok: true });
});

app.post("/api/agents/:id/prompt", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Ajan bulunamadı" });
  let text = String(req.body?.text || "").trim();
  const images = (Array.isArray(req.body?.images) ? req.body.images : []).map(String).filter((p) => isImage(p) && fs.existsSync(p)).slice(0, 10);
  if (!text && !images.length) return res.status(400).json({ error: "Boş mesaj" });
  if (!text) text = "Ekteki görsele bak.";
  const promptText = images.length ? `${text}\n\n${images.map((p) => "Ekli görsel: " + p).join("\n")}` : text;
  if (running.has(agent.id)) return res.status(409).json({ error: "Ajan meşgul; önce durdur ya da bitmesini bekle" });

  for (const p of images) seenImages(agent.id).add(path.resolve(p).toLowerCase());
  const convId = ensureConvs(agent).activeConv;
  { const c = activeConv(getAgent(agent.id)); patchConv(agent.id, convId, { updatedAt: Date.now(), ...(c && !c.title ? { title: text.slice(0, 80) } : {}) }); }
  const userEv = { type: "user", agentId: agent.id, convId, text, images };
  appendLog(agent.id, userEv, convId);
  broadcast(userEv);

  const emit = (ev) => {
    if (ev.type === "rate_limit") { saveUsage(ev.info); return; }
    const full = { ...ev, agentId: agent.id };
    // ajanın dokunduğu görsel yolları: sohbette gösterilebilsin
    if (ev.type === "tool_use" && isImage(ev.summary)) seenImages(agent.id).add(path.resolve(ev.summary).toLowerCase());
    if (ev.type === "text") for (const p of findImagePaths(ev.text)) seenImages(agent.id).add(path.resolve(p).toLowerCase());
    if (ev.type === "status") { setStatus(agent.id, ev.status, { tool: ev.tool, note: ev.note }); return; }
    if (ev.type === "init" && ev.sessionId) {
      if (getAgent(agent.id)?.activeConv === convId) updateAgent(agent.id, { sessionId: ev.sessionId });
      patchConv(agent.id, convId, { sessionId: ev.sessionId });
    }
    full.convId = convId;
    appendLog(agent.id, full, convId);
    broadcast(full);
  };

  const allowOnce = (Array.isArray(req.body?.allowOnce) ? req.body.allowOnce : []).map(String).slice(0, 20);
  const runAgent = { ...agent, _allowOnce: allowOnce };
  const run = MOCK ? runMock(runAgent, promptText, emit) : runClaude(runAgent, promptText, emit);
  running.set(agent.id, run);
  res.json({ started: true });

  const result = await run.promise;
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
});

// Birden çok ajana aynı emir: kota için sırayla (biri bitmeden öbürü başlamaz)
app.post("/api/broadcast", (req, res) => {
  const { ids, text } = req.body || {};
  const targets = (ids && ids.length ? ids : listAgents().map((a) => a.id));
  res.json({ queued: targets.length });
  (async () => {
    for (const id of targets) {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/agents/${id}/prompt`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
      }).catch(() => null);
      if (!r || !r.ok) continue;
      while (running.has(id)) await new Promise((x) => setTimeout(x, 300));
    }
  })();
});

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello", mock: MOCK }));
});

// public/ altı değişince açık tarayıcılar kendini yeniler
try {
  let t;
  fs.watch(path.resolve("public"), { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => broadcast({ type: "reload" }), 250); });
} catch {}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Ecelon Station → http://127.0.0.1:${PORT}  (${MOCK ? "MOCK mod" : "claude -p"})`);
  if (!MOCK) console.log(resolveClaude() ? `Claude Code: ${resolveClaude()}` : "UYARI: Claude Code bulunamadı. `where.exe claude` yolunu CLAUDE_BIN olarak ver (README).");
});
