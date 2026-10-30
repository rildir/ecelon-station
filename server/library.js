// Document library: keeps reference files such as ERP analysis documents in one place.
//   data/library/index.json      → collections + document records
//   data/library/files/<name.ext> → the file itself (with its meaningful name; agents read this path too)
//   data/library/text/<id>.md    → plain text extracted from .docx/.xlsx (agents + search)
//   data/library/versions/<id>/  → older versions (automatic on edit / new version upload)
//   data/library/trash/          → deleted documents (can be restored within 7 days)
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import mammoth from "mammoth";
import { readXlsx, sheetsToMarkdown } from "./xlsx.js";
import * as md from "./markitdown.js";
import { t, locale } from "./i18n.js";
import { dataPath, mkdirPrivate, writePrivate } from "./paths.js";
md.detect().catch(() => {});

export const LIB_DIR = dataPath("library");
const FILES = path.join(LIB_DIR, "files");
const TEXT = path.join(LIB_DIR, "text");
const VERS = path.join(LIB_DIR, "versions");
const TRASH = path.join(LIB_DIR, "trash");
const INDEX = path.join(LIB_DIR, "index.json");
mkdirPrivate(LIB_DIR);
for (const d of [FILES, TEXT, VERS, TRASH]) mkdirPrivate(d);

const MAX_VERSIONS = 25;
const KINDS = {
  pdf: ["pdf"],
  pptx: ["pptx"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
  markdown: ["md", "markdown"],
  table: ["csv", "tsv"],
  text: ["txt", "log", "json", "xml", "yaml", "yml", "sql", "html", "htm", "js", "ts", "css", "ini", "cs", "java", "py", "php", "graphql", "proto", "http", "env"],
  docx: ["docx"],
  xlsx: ["xlsx", "xlsm"],
};
const extOf = (f) => path.extname(f).slice(1).toLowerCase();
export const kindOf = (f) => { const e = extOf(f); for (const [k, list] of Object.entries(KINDS)) if (list.includes(e)) return k; return "other"; };
const EDITABLE = new Set(["markdown", "text", "table"]);
const EXTRACT = new Set(["docx", "xlsx"]);
// If MarkItDown is installed text is extracted from these too (PDF, PowerPoint, .xls, EPUB)
const viaMd = (f) => md.ready() && md.MD_EXT.has(extOf(f));
const hasText = (f) => EXTRACT.has(kindOf(f)) || viaMd(f);

// ---------- index
let db = { collections: [], docs: [] };
try { db = { collections: [], docs: [], ...JSON.parse(fs.readFileSync(INDEX, "utf8")) }; } catch {}
let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { const tmp = INDEX + ".tmp"; writePrivate(tmp, JSON.stringify(db, null, 2)); fs.renameSync(tmp, INDEX); }, 80);
}
const nid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const filePath = (d) => path.join(FILES, d.file);
const textPath = (d) => path.join(TEXT, d.id + ".md");
const live = () => db.docs.filter((d) => !d.deletedAt);
const getDoc = (id) => db.docs.find((d) => d.id === id && !d.deletedAt);

// purge trash older than 7 days
{
  const week = 7 * 864e5;
  const old = db.docs.filter((d) => d.deletedAt && Date.now() - d.deletedAt > week);
  for (const d of old) { try { fs.rmSync(path.join(TRASH, d.id), { recursive: true, force: true }); fs.rmSync(path.join(VERS, d.id), { recursive: true, force: true }); fs.rmSync(textPath(d), { force: true }); } catch {} }
  if (old.length) { db.docs = db.docs.filter((d) => !old.includes(d)); save(); }
}

function cleanName(n) {
  let s = String(n || "").normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/^[.\s]+|[.\s]+$/g, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = "_" + s;
  return s.slice(0, 140) || "belge";
}
// unique (case-insensitive) name inside files/
function uniqueFile(name, exceptId) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  const taken = new Set(db.docs.filter((d) => d.id !== exceptId && !d.deletedAt).map((d) => d.file.toLowerCase()));
  let cand = name, i = 2;
  while (taken.has(cand.toLowerCase()) || (fs.existsSync(path.join(FILES, cand)) && !db.docs.some((d) => d.id === exceptId && d.file.toLowerCase() === cand.toLowerCase()))) cand = `${base} (${i++})${ext}`;
  return cand;
}

// Catch files changed externally in Word/Excel
function syncStat(d) {
  try {
    const st = fs.statSync(filePath(d));
    if (Math.round(st.mtimeMs) !== d.mtime || st.size !== d.size) {
      d.mtime = Math.round(st.mtimeMs); d.size = st.size; d.updatedAt = Date.now(); d.textAt = 0;
      return true;
    }
  } catch { if (!d.missing) { d.missing = true; return true; } }
  return false;
}
const view = (d) => ({
  id: d.id, name: d.file, title: d.title || "", kind: kindOf(d.file), ext: extOf(d.file), size: d.size,
  collection: d.collection || null, tags: d.tags || [], note: d.note || "", agents: d.agents || [],
  createdAt: d.createdAt, updatedAt: d.updatedAt, mtime: d.mtime, editable: EDITABLE.has(kindOf(d.file)), missing: !!d.missing,
  path: filePath(d), textPath: hasText(d.file) ? textPath(d) : null,
  versions: countVersions(d.id),
});
function countVersions(id) { try { return fs.readdirSync(path.join(VERS, id)).length; } catch { return 0; } }

// Word's "Title" styles become headings too (the Turkish Word style names "Konu Başlığı" / "Alt Konu Başlığı", written with escapes)
const DOCX_OPTS = { styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Konu Ba\u015fl\u0131\u011f\u0131'] => h1:fresh", "p[style-name='Alt Konu Ba\u015fl\u0131\u011f\u0131'] => h2:fresh"] };
// ---------- text extraction (cached)
const extracting = new Map();
export async function ensureText(d) {
  const k = kindOf(d.file);
  if (!hasText(d.file)) return null;
  const out = textPath(d);
  if (d.textAt && d.textAt >= (d.mtime || 0) && fs.existsSync(out)) return out;
  if (extracting.has(d.id)) return extracting.get(d.id);
  const job = (async () => {
    try {
      let txt;
      if (!EXTRACT.has(k)) txt = await md.convert(filePath(d)); // MarkItDown
      else {
      const buf = fs.readFileSync(filePath(d));
      if (k === "docx") {
        txt = htmlToMarkdown((await mammoth.convertToHtml({ buffer: buf }, DOCX_OPTS)).value);
      } else txt = sheetsToMarkdown(await readXlsx(buf, { maxRows: 5000, maxCols: 60 }));
      }
      fs.writeFileSync(out, `<!-- ${t("Text automatically extracted from {file}. Original document: {path}", { file: d.file, path: filePath(d) })} -->\n\n${txt}`);
      d.textAt = Date.now(); save();
      return out;
    } catch (e) { console.warn("text could not be extracted:", d.file, e.message); return null; }
    finally { extracting.delete(d.id); }
  })();
  extracting.set(d.id, job);
  return job;
}
// mammoth's plain HTML → markdown (tables included; for agents to read)
function htmlToMarkdown(html) {
  const dec = (t) => t.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const inl = (s) => dec(s.replace(/<img[^>]*>/gi, t("[image]")).replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, "**$2**").replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, "*$2*").replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, u, x) => (u.startsWith("#") ? x : `[${x}](${u})`))).trim();
  let out = html;
  out = out.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (m, body) => {
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => inl(c[1].replace(/<\/p>\s*<p>/gi, " ")).replace(/\|/g, "\\|")));
    if (!rows.length) return "";
    const w = Math.max(...rows.map((r) => r.length));
    const line = (r) => "| " + Array.from({ length: w }, (_, i) => r[i] || "").join(" | ") + " |";
    return "\n\n" + [line(rows[0]), "|" + " --- |".repeat(w), ...rows.slice(1).map(line)].join("\n") + "\n\n";
  });
  out = out.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, t) => `\n\n${"#".repeat(+n)} ${inl(t)}\n\n`);
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m, t) => `\n- ${inl(t.replace(/<\/?(ul|ol)[^>]*>/gi, " "))}`);
  out = out.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");
  out = out.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (m, t) => `\n\n${inl(t)}\n\n`);
  return dec(out).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
// Plain text of any file (e.g. an old version) for comparison
async function textOfFile(abs, name) {
  const k = kindOf(name);
  if (EDITABLE.has(k)) return fs.readFileSync(abs, "utf8");
  if (k === "docx") return htmlToMarkdown((await mammoth.convertToHtml({ buffer: fs.readFileSync(abs) }, DOCX_OPTS)).value);
  if (k === "xlsx") return sheetsToMarkdown(await readXlsx(fs.readFileSync(abs), { maxRows: 5000, maxCols: 60 }));
  if (viaMd(name)) { const ext = path.extname(name); const tmp = abs + ".cmp" + ext; fs.copyFileSync(abs, tmp); try { return await md.convert(tmp); } finally { fs.rmSync(tmp, { force: true }); } }
  return null;
}
function plainText(d) {
  const k = kindOf(d.file);
  try {
    if (EDITABLE.has(k)) return fs.statSync(filePath(d)).size < 4e6 ? fs.readFileSync(filePath(d), "utf8") : "";
    if (hasText(d.file) && fs.existsSync(textPath(d))) return fs.readFileSync(textPath(d), "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  } catch {}
  return "";
}

// ---------- versions
function snapshot(d, reason) {
  const dir = path.join(VERS, d.id); mkdirPrivate(dir);
  try { fs.copyFileSync(filePath(d), path.join(dir, `${Date.now()}__${reason}__${d.file}`)); } catch { return; }
  const all = fs.readdirSync(dir).sort();
  for (const f of all.slice(0, Math.max(0, all.length - MAX_VERSIONS))) fs.rmSync(path.join(dir, f), { force: true });
}
const reasonName = (r) => ({ edit: t("Before editing"), replace: t("Before the new version"), restore: t("Before restoring") })[r] || r;
function listVersions(id) {
  const dir = path.join(VERS, id);
  let files = []; try { files = fs.readdirSync(dir); } catch {}
  return files.map((f) => {
    const [ts, reason, ...rest] = f.split("__");
    const st = fs.statSync(path.join(dir, f));
    return { id: f, at: Number(ts), reason: reasonName(reason), name: rest.join("__"), size: st.size };
  }).sort((a, b) => b.at - a.at);
}

// Programs and scripts must never be launched through the OS "open" association (that would run them)
const RISKY_EXT = new Set("exe bat cmd com msi ps1 psm1 vbs vbe js jse wsf wsh lnk scr jar sh command app appimage desktop reg hta cpl dll py pyw pl rb url scf inf msp msc jnlp pif ws run bin".split(" "));
const openBlocked = (name) => { const e = path.extname(String(name).replace(/[. ]+$/, "")).slice(1).toLowerCase(); return !e || RISKY_EXT.has(e); }; // no extension = unknown type
function openWith(target, reveal) {
  let cmd, args;
  if (process.platform === "win32") { cmd = "explorer.exe"; args = reveal ? ["/select,", target] : [target]; }
  else if (process.platform === "darwin") { cmd = "open"; args = reveal ? ["-R", target] : [target]; }
  else { cmd = "xdg-open"; args = [reveal ? path.dirname(target) : target]; }
  const c = spawn(cmd, args, { detached: true, stdio: "ignore" }); c.on("error", () => {}); c.unref();
}

// Reference list given to agents
export async function describeDocs(ids) {
  const out = [];
  for (const id of ids) {
    const d = getDoc(id); if (!d || d.missing) continue;
    const t = await ensureText(d);
    out.push({ id: d.id, name: d.file, kind: kindOf(d.file), path: filePath(d), textPath: t });
  }
  return out;
}
export const referenceLines = (docs) => docs.map((d) => `- ${d.name}: ${d.path}${d.textPath ? `  (${t("readable text version: {path}", { path: d.textPath })})` : ""}`).join("\n");
export const linkedDocIds = (agentId) => live().filter((d) => (d.agents || []).includes(agentId)).map((d) => d.id);
// For the coverage check: text of the documents linked to agents (unreadable ones listed separately)
export async function docsTextFor(agentIds) {
  const ids = new Set(agentIds); const docs = [], unreadable = [];
  for (const d of live()) {
    if (!(d.agents || []).some((a) => ids.has(a)) || d.missing) continue;
    const k = kindOf(d.file); if (k === "image") continue;
    syncStat(d);
    if (hasText(d.file)) await ensureText(d);
    const t = plainText(d);
    if (t && t.trim().length > 20) docs.push({ id: d.id, name: d.file, text: t }); else unreadable.push({ id: d.id, name: d.file });
  }
  return { docs, unreadable };
}
/** Copy a file from disk into the library (used by the demo seed). Returns the document view. */
export async function importFile(src, { agents = [], name } = {}) {
  const file = uniqueFile(cleanName(name || path.basename(src)));
  fs.copyFileSync(src, path.join(FILES, file));
  const st = fs.statSync(path.join(FILES, file));
  const d = { id: nid("d"), file, collection: null, tags: [], note: "", agents: [...agents], size: st.size, mtime: Math.round(st.mtimeMs), createdAt: Date.now(), updatedAt: Date.now() };
  db.docs.push(d); save();
  await ensureText(d);
  return view(d);
}
export function forgetAgent(agentId) {
  let ch = false;
  for (const d of db.docs) if (d.agents?.includes(agentId)) { d.agents = d.agents.filter((x) => x !== agentId); ch = true; }
  if (ch) save();
}

// ---------- HTTP
export function libraryRouter({ broadcast }) {
  const r = express.Router();
  const changed = () => { save(); broadcast({ type: "library" }); };
  const need = (req, res) => { const d = getDoc(req.params.id); if (!d) res.status(404).json({ error: t("Document not found") }); return d; };
  const rawBody = express.raw({ type: () => true, limit: "250mb" });

  // Watch for external changes (Word, Excel, agent)
  try {
    let t;
    fs.watch(FILES, () => { clearTimeout(t); t = setTimeout(() => { let ch = false; for (const d of live()) ch = syncStat(d) || ch; if (ch) changed(); }, 600); });
  } catch {}

  r.get("/", (_req, res) => {
    let ch = false; for (const d of live()) ch = syncStat(d) || ch; if (ch) save();
    res.json({ dir: FILES, collections: db.collections, docs: live().map(view) });
  });

  // search in content (text documents + text extracted from docx/xlsx)
  r.get("/search", async (req, res) => {
    const q = String(req.query.q || "").trim().toLocaleLowerCase(locale());
    if (q.length < 2) return res.json([]);
    const hits = [];
    for (const d of live()) {
      if (hasText(d.file)) await ensureText(d);
      const txt = plainText(d); if (!txt) continue;
      const low = txt.toLocaleLowerCase(locale()); const i = low.indexOf(q); if (i < 0) continue;
      let n = 0, j = i; while (j >= 0 && n < 50) { n++; j = low.indexOf(q, j + q.length); }
      const a = Math.max(0, i - 60);
      hits.push({ id: d.id, count: n, snippet: ((a ? "…" : "") + txt.slice(a, i + q.length + 80) + "…").replace(/<!--[\s\S]*?-->|[#*_`>|]+|-{3,}/g, " ").replace(/\s+/g, " ").trim() });
    }
    res.json(hits);
  });

  r.post("/upload", rawBody, async (req, res) => {
    const name = cleanName(req.query.name);
    if (!extOf(name)) return res.status(400).json({ error: t("The file has no extension") });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: t("The file is empty") });
    const coll = db.collections.find((c) => c.id === req.query.collection) ? String(req.query.collection) : null;
    const file = uniqueFile(name);
    fs.writeFileSync(path.join(FILES, file), req.body);
    const st = fs.statSync(path.join(FILES, file));
    const d = { id: nid("d"), file, collection: coll, tags: [], note: "", agents: [], size: st.size, mtime: Math.round(st.mtimeMs), createdAt: Date.now(), updatedAt: Date.now() };
    db.docs.push(d); changed();
    ensureText(d); // in the background
    res.json(view(d));
  });

  r.get("/:id/raw", (req, res) => {
    const d = need(req, res); if (!d) return;
    let target = filePath(d), name = d.file;
    if (req.query.v) {
      const v = path.basename(String(req.query.v));
      target = path.join(VERS, d.id, v); name = v.split("__").slice(2).join("__") || d.file;
    }
    if (!fs.existsSync(target)) return res.status(404).json({ error: t("The file is not on disk") });
    const k = kindOf(name), ext = extOf(name);
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Cache-Control", "no-cache");
    const disp = req.query.download ? "attachment" : "inline";
    res.setHeader("Content-Disposition", `${disp}; filename*=UTF-8''${encodeURIComponent(name)}`);
    // types that could run scripts must never be interpreted as html/svg
    if (k === "pdf") res.type("application/pdf");
    else if (k === "image") { res.type(ext === "jpg" ? "jpeg" : ext); if (ext === "svg") res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox"); }
    else if (EDITABLE.has(k) && !req.query.download) res.type("text/plain; charset=utf-8");
    else res.type("application/octet-stream");
    res.sendFile(target);
  });

  r.get("/:id/preview", async (req, res) => {
    const d = need(req, res); if (!d) return;
    const k = kindOf(d.file);
    try {
      if (d.missing) return res.json({ kind: k, missing: true });
      if (EDITABLE.has(k)) {
        const size = fs.statSync(filePath(d)).size;
        if (size > 5e6) return res.json({ kind: k, tooBig: true });
        return res.json({ kind: k, text: fs.readFileSync(filePath(d), "utf8") });
      }
      if (k === "docx") {
        const r2 = await mammoth.convertToHtml({ buffer: fs.readFileSync(filePath(d)) }, DOCX_OPTS);
        return res.json({ kind: k, html: r2.value });
      }
      if (k === "xlsx") return res.json({ kind: k, sheets: await readXlsx(fs.readFileSync(filePath(d)), { maxRows: 1500, maxCols: 60 }) });
      // PowerPoint / .xls / EPUB: show with the MarkItDown text
      if (k !== "pdf" && viaMd(d.file)) { const t = await ensureText(d); if (t) return res.json({ kind: k, markdown: fs.readFileSync(t, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "") }); }
      if (k === "pptx" || k === "other") return res.json({ kind: k, needsTool: md.MD_EXT.has(extOf(d.file)), tool: md.status() });
      res.json({ kind: k });
    } catch (e) { res.json({ kind: k, error: t("Preview could not be created: {message}", { message: e.message }) }); }
  });

  r.put("/:id/content", (req, res) => {
    const d = need(req, res); if (!d) return;
    if (!EDITABLE.has(kindOf(d.file))) return res.status(400).json({ error: t("This type cannot be edited here") });
    const text = String(req.body?.text ?? "");
    if (req.body?.base && Number(req.body.base) !== d.mtime) return res.status(409).json({ error: t("The document changed elsewhere while you were editing. Reload before saving.") });
    snapshot(d, "edit");
    fs.writeFileSync(filePath(d), text);
    syncStat(d); changed();
    res.json(view(d));
  });

  r.patch("/:id", (req, res) => {
    const d = need(req, res); if (!d) return;
    const b = req.body || {};
    if (typeof b.name === "string") {
      let n = cleanName(b.name);
      if (extOf(n) !== extOf(d.file)) n += "." + extOf(d.file); // the extension is kept
      if (n !== d.file) {
        const nf = uniqueFile(n, d.id);
        try { fs.renameSync(filePath(d), path.join(FILES, nf)); } catch (e) { return res.status(409).json({ error: t("Could not rename (the file may be open in another program): {code}", { code: e.code }) }); }
        d.file = nf; d.textAt = 0;
      }
    }
    if ("collection" in b) d.collection = db.collections.some((c) => c.id === b.collection) ? b.collection : null;
    if (Array.isArray(b.tags)) d.tags = [...new Set(b.tags.map((t) => String(t).trim().slice(0, 32)).filter(Boolean))].slice(0, 12);
    if (typeof b.note === "string") d.note = b.note.slice(0, 2000);
    if (Array.isArray(b.agents)) d.agents = [...new Set(b.agents.map(String))].slice(0, 50);
    d.updatedAt = Date.now(); changed();
    res.json(view(d));
  });

  r.post("/:id/replace", rawBody, (req, res) => {
    const d = need(req, res); if (!d) return;
    const name = cleanName(req.query.name);
    if (extOf(name) !== extOf(d.file)) return res.status(400).json({ error: t("The new version must also be .{ext}", { ext: extOf(d.file) }) });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: t("The file is empty") });
    snapshot(d, "replace");
    try { fs.writeFileSync(filePath(d), req.body); } catch (e) { return res.status(409).json({ error: t("Could not write (the file may be open in another program): {code}", { code: e.code }) }); }
    syncStat(d); d.missing = false; changed(); ensureText(d);
    res.json(view(d));
  });

  r.get("/:id/versions", (req, res) => { const d = need(req, res); if (!d) return; res.json(listVersions(d.id)); });
  // version diff: text of the old version and the current text (the client compares line by line)
  r.get("/:id/versions/:vid/text", async (req, res) => {
    const d = need(req, res); if (!d) return;
    const src = path.join(VERS, d.id, path.basename(req.params.vid));
    if (!fs.existsSync(src)) return res.status(404).json({ error: t("Version not found") });
    try {
      const old = await textOfFile(src, d.file);
      if (old == null) return res.status(400).json({ error: t("The text of this document type cannot be extracted (for PDF install the Document reading tool)") });
      if (hasText(d.file)) await ensureText(d);
      const cur = plainText(d) || (await textOfFile(filePath(d), d.file)) || "";
      res.json({ old: old.replace(/^<!--[\s\S]*?-->\s*/, ""), cur });
    } catch (e) { res.status(500).json({ error: t("Text could not be extracted: {message}", { message: e.message }) }); }
  });
  r.post("/:id/versions/:vid/restore", (req, res) => {
    const d = need(req, res); if (!d) return;
    const src = path.join(VERS, d.id, path.basename(req.params.vid));
    if (!fs.existsSync(src)) return res.status(404).json({ error: t("Version not found") });
    snapshot(d, "restore");
    try { fs.copyFileSync(src, filePath(d)); } catch (e) { return res.status(409).json({ error: t("Could not restore: {code}", { code: e.code }) }); }
    syncStat(d); d.missing = false; changed(); ensureText(d);
    res.json(view(d));
  });

  r.post("/:id/open", (req, res) => {
    const d = need(req, res); if (!d) return;
    if (!fs.existsSync(filePath(d))) return res.status(404).json({ error: t("The file is not on disk") });
    const reveal = req.body?.mode === "folder";
    if (!reveal && openBlocked(d.file)) return res.status(400).json({ error: t("This file type could be a program or script, so it is not opened from here. Use \"Show in folder\" instead.") });
    openWith(filePath(d), reveal);
    res.json({ ok: true });
  });

  r.delete("/:id", (req, res) => {
    const d = need(req, res); if (!d) return;
    const dir = path.join(TRASH, d.id); mkdirPrivate(dir);
    try { fs.renameSync(filePath(d), path.join(dir, d.file)); } catch (e) { if (e.code !== "ENOENT") return res.status(409).json({ error: t("Could not delete (the file may be open in another program): {code}", { code: e.code }) }); }
    d.deletedAt = Date.now(); changed();
    res.json({ ok: true });
  });
  r.post("/:id/undelete", (req, res) => {
    const d = db.docs.find((x) => x.id === req.params.id && x.deletedAt);
    if (!d) return res.status(404).json({ error: t("No document to restore") });
    const nf = uniqueFile(d.file, d.id);
    try { fs.renameSync(path.join(TRASH, d.id, d.file), path.join(FILES, nf)); } catch {}
    d.file = nf; delete d.deletedAt; syncStat(d); changed();
    res.json(view(d));
  });

  // MarkItDown status and in-app installation
  r.get("/tools", async (req, res) => res.json(await md.detect(req.query.refresh === "1")));
  r.post("/tools/install", async (_req, res) => {
    const st = await md.detect(true);
    if (!st.pythonOk) return res.status(400).json({ error: st.python ? t("Python {version} is too old; 3.10 or newer is required.", { version: st.python }) : t("Python not found.") });
    if (st.installing) return res.json({ started: true });
    res.json({ started: true });
    broadcast({ type: "library-tool", installing: true });
    const ok = await md.install((line) => broadcast({ type: "library-tool", line }));
    if (ok) { for (const d of live()) { d.textAt = 0; if (hasText(d.file)) ensureText(d); } save(); }
    broadcast({ type: "library-tool", installing: false, ok, status: md.status() });
    broadcast({ type: "library" });
  });

  // collections (e.g. "Accounting module", "Stock", "Meeting notes")
  r.post("/collections", (req, res) => {
    const name = String(req.body?.name || "").trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: t("Name required") });
    if (db.collections.some((c) => c.name.toLocaleLowerCase(locale()) === name.toLocaleLowerCase(locale()))) return res.status(409).json({ error: t("A collection with this name exists") });
    const c = { id: nid("k"), name }; db.collections.push(c); changed(); res.json(c);
  });
  r.patch("/collections/:cid", (req, res) => {
    const c = db.collections.find((x) => x.id === req.params.cid); if (!c) return res.status(404).json({ error: t("No such collection") });
    const name = String(req.body?.name || "").trim().slice(0, 40); if (name) c.name = name;
    changed(); res.json(c);
  });
  r.delete("/collections/:cid", (req, res) => {
    db.collections = db.collections.filter((x) => x.id !== req.params.cid);
    for (const d of db.docs) if (d.collection === req.params.cid) d.collection = null;
    changed(); res.json({ ok: true });
  });
  return r;
}
