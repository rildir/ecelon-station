// Project files for the code editor: tree, read/write (conflict-protected), create, rename, delete (restorable).
// All paths must stay inside the project folder; nothing is written into .git.
import fs from "node:fs";
import path from "node:path";
import { t, locale } from "./i18n.js";
import { dataPath } from "./paths.js";

export const IGNORE_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "bin", "obj", ".vs", ".idea", ".angular", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv", "vendor", "packages", ".gradle", "target", ".godot", ".import"]);
const HIDE = new Set([".git"]);
const MAX_READ = 5 * 1024 * 1024;
const TRASH = dataPath("fs-trash");

// Resolve a request path inside the project root. Lexical containment is checked first; then the real path of
// the deepest EXISTING ancestor (or the target itself, if it exists) is resolved with realpath and must stay
// inside realpath(root), so a symlink/junction cannot lead out of the project. A missing leaf is allowed
// (creating a new file). A dangling symlink is rejected (writing through it would create the target elsewhere).
// Links that point inside the project keep working. Returns the lexical { abs, rel }.
export function resolveIn(cwd, rel = "") {
  const root = path.resolve(cwd);
  const abs = path.resolve(root, String(rel ?? ""));
  const r = path.relative(root, abs);
  if (r.startsWith("..") || path.isAbsolute(r)) throw new Error(t("Path outside the project"));
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch (e) { if (e.code === "ENOENT") throw e; throw new Error(t("Path outside the project")); }
  let cur = abs;
  for (;;) {
    let exists = true;
    try { fs.lstatSync(cur); } catch (e) { if (e.code === "ENOENT" || e.code === "ENOTDIR") exists = false; else throw e; }
    if (exists) {
      let real;
      try { real = fs.realpathSync(cur); } catch { throw new Error(t("This path points outside the project through a link")); } // dangling link / loop
      const rr = path.relative(realRoot, real);
      if (rr.startsWith("..") || path.isAbsolute(rr)) throw new Error(t("This path points outside the project through a link"));
      break;
    }
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return { abs, rel: r.split(path.sep).join("/") };
}
// Names invalid on Windows (blocked on every platform so the project can be opened on Windows too)
function checkName(rel) {
  for (const part of rel.split("/")) {
    if (/[<>:"|?*\u0000-\u001f\\]/.test(part)) throw new Error(t("\"{name}\" contains an invalid character (< > : \" | ? * cannot be used)", { name: part }));
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part)) throw new Error(t("\"{name}\" is a reserved name on Windows; choose another name", { name: part }));
    if (/[. ]$/.test(part)) throw new Error(t("\"{name}\" cannot end with a dot or a space", { name: part }));
  }
}
const guardWrite = (rel) => {
  if (rel) checkName(rel);
  const low = String(rel).toLowerCase(); // on Windows ".GIT" is the same folder
  if (low === ".git" || low.startsWith(".git/") || low.includes("/.git/") || low.endsWith("/.git")) throw new Error(t("Cannot write into the .git folder"));
  if (!rel) throw new Error(t("Invalid path"));
};
// Contents of one folder (lazy tree)
export function list(cwd, rel = "") {
  const { abs } = resolveIn(cwd, rel);
  const ents = fs.readdirSync(abs, { withFileTypes: true });
  const out = [];
  for (const e of ents) {
    if (HIDE.has(e.name)) continue;
    const dir = e.isDirectory() || (e.isSymbolicLink() && (() => { try { return fs.statSync(path.join(abs, e.name)).isDirectory(); } catch { return false; } })());
    out.push({ name: e.name, dir, dim: dir && IGNORE_DIRS.has(e.name) });
  }
  out.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, locale(), { numeric: true, sensitivity: "base" })));
  return out;
}

// Flat file list for Ctrl+P (ignored folders excluded)
export function allFiles(cwd, limit = 30000) {
  const root = path.resolve(cwd); const out = []; const stack = [""];
  while (stack.length && out.length < limit) {
    const rel = stack.pop(); let ents;
    try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name) && !HIDE.has(e.name)) stack.push(r); }
      else if (e.isFile()) { out.push(r); if (out.length >= limit) break; }
    }
  }
  return { files: out.sort(), truncated: out.length >= limit };
}

const isBinary = (buf) => { const n = Math.min(buf.length, 8000); for (let i = 0; i < n; i++) if (buf[i] === 0) return true; return false; };
export function read(cwd, rel) {
  const { abs, rel: r } = resolveIn(cwd, rel);
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error(t("Not a file"));
  if (st.size > MAX_READ) return { path: r, size: st.size, mtime: st.mtimeMs, tooBig: true };
  const buf = fs.readFileSync(abs);
  if (isBinary(buf)) return { path: r, size: st.size, mtime: st.mtimeMs, binary: true };
  let text = buf.toString("utf8"); let bom = false;
  if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); bom = true; }
  const eol = /\r\n/.test(text.slice(0, 20000)) ? "CRLF" : "LF";
  return { path: r, size: st.size, mtime: st.mtimeMs, text, bom, eol };
}
export function write(cwd, rel, text, { base, bom = false, force = false } = {}) {
  const { abs, rel: r } = resolveIn(cwd, rel); guardWrite(r);
  if (!force && base != null && fs.existsSync(abs)) {
    const m = fs.statSync(abs).mtimeMs;
    if (Math.abs(m - Number(base)) > 1) { const e = new Error(t("The file changed on disk while you were editing (probably an agent wrote it).")); e.code = "CONFLICT"; e.mtime = m; throw e; }
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, (bom ? "﻿" : "") + String(text ?? ""));
  return { path: r, mtime: fs.statSync(abs).mtimeMs, size: fs.statSync(abs).size };
}
export function stat(cwd, rels) {
  const out = {};
  for (const rel of rels.slice(0, 50)) { try { const { abs, rel: r } = resolveIn(cwd, rel); const st = fs.statSync(abs); out[r] = { mtime: st.mtimeMs, size: st.size }; } catch { out[rel] = null; } }
  return out;
}
export function create(cwd, rel, { dir = false } = {}) {
  const { abs, rel: r } = resolveIn(cwd, rel); guardWrite(r);
  if (fs.existsSync(abs)) throw new Error(t("A file or folder with this name already exists"));
  if (dir) fs.mkdirSync(abs, { recursive: true });
  else { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, ""); }
  return { path: r };
}
export function rename(cwd, from, to) {
  const a = resolveIn(cwd, from), b = resolveIn(cwd, to); guardWrite(a.rel); guardWrite(b.rel);
  if (!fs.existsSync(a.abs)) throw new Error(t("Source not found"));
  if (fs.existsSync(b.abs) && a.abs.toLowerCase() !== b.abs.toLowerCase()) throw new Error(t("Something with the same name exists at the target"));
  fs.mkdirSync(path.dirname(b.abs), { recursive: true });
  fs.renameSync(a.abs, b.abs);
  return { path: b.rel };
}
// A deleted file/folder is moved to the station's trash (data/fs-trash) and can be restored
export function remove(cwd, rel) {
  const { abs, rel: r } = resolveIn(cwd, rel); guardWrite(r);
  if (!fs.existsSync(abs)) throw new Error(t("Not found"));
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; const dest = path.join(TRASH, id);
  fs.mkdirSync(dest, { recursive: true });
  const target = path.join(dest, path.basename(abs));
  fs.writeFileSync(path.join(dest, ".meta.json"), JSON.stringify({ cwd: path.resolve(cwd), rel: r, at: Date.now() })); // meta first: restorable even if interrupted
  try { fs.renameSync(abs, target); }
  catch (e) { // different drive or locked file: copy, then delete; if the delete is interrupted, roll the copy back
    fs.cpSync(abs, target, { recursive: true });
    try { fs.rmSync(abs, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (e2) { try { fs.cpSync(target, abs, { recursive: true, force: false, errorOnExist: false }); } catch {} fs.rmSync(dest, { recursive: true, force: true }); throw new Error(t("Could not delete (the file may be open in another program): {code}", { code: e2.code || e2.message })); }
  }
  // purge trash older than 14 days
  try { for (const d of fs.readdirSync(TRASH)) if (Date.now() - Number(d) > 14 * 864e5) fs.rmSync(path.join(TRASH, d), { recursive: true, force: true }); } catch {}
  return { trash: id };
}
export function restore(id) {
  const dest = path.join(TRASH, String(id).replace(/\D/g, ""));
  const meta = JSON.parse(fs.readFileSync(path.join(dest, ".meta.json"), "utf8"));
  const { abs } = resolveIn(meta.cwd, meta.rel);
  if (fs.existsSync(abs)) throw new Error(t("Another file now exists in the same place"));
  const src = path.join(dest, path.basename(abs));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  try { fs.renameSync(src, abs); } catch { fs.cpSync(src, abs, { recursive: true }); }
  fs.rmSync(dest, { recursive: true, force: true });
  return { path: meta.rel };
}

// Search in the project (like VS Code's "Search" panel). q: text or regex; case, whole word, include/exclude globs.
const globRe = (g) => new RegExp("^" + g.trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "\u0001").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0001/g, "(?:.*/)?").replace(/\u0000/g, ".*") + "$", "i");
const globList = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean).map((g) => (g.includes("/") ? g : `**/${g}`)).map((g) => [globRe(g), globRe(g.replace(/\/?$/, "/**"))]);
export function search(cwd, { q, regex = false, cs = false, word = false, include = "", exclude = "", max = 3000 } = {}) {
  q = String(q || ""); if (!q) return { results: [], total: 0 };
  let src = regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (word) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  let re; try { re = new RegExp(src, (cs ? "" : "i") + "gu"); } catch (e) { throw new Error(t("Invalid regular expression: {message}", { message: e.message })); }
  const inc = globList(include), exc = globList(exclude);
  const root = path.resolve(cwd); const { files } = allFiles(cwd, 50000);
  const results = []; let total = 0, scanned = 0, limited = false;
  const t0 = Date.now();
  for (const rel of files) {
    if (inc.length && !inc.some(([a, b]) => a.test(rel) || b.test(rel))) continue;
    if (exc.some(([a, b]) => a.test(rel) || b.test(rel))) continue;
    let buf; try { const st = fs.statSync(path.join(root, rel)); if (st.size > 2e6) continue; buf = fs.readFileSync(path.join(root, rel)); } catch { continue; }
    if (isBinary(buf)) continue;
    scanned++;
    const lines = buf.toString("utf8").split(/\r?\n/); const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]; re.lastIndex = 0; let m; const ranges = [];
      while ((m = re.exec(line))) { ranges.push([m.index, m.index + m[0].length]); if (!m[0].length) re.lastIndex++; if (ranges.length > 50) break; }
      if (ranges.length) {
        total += ranges.length;
        const from = Math.max(0, ranges[0][0] - 60);
        hits.push({ line: i + 1, col: ranges[0][0] + 1, text: line.slice(from, from + 240), off: from, ranges });
        if (total >= max) { limited = true; break; }
      }
    }
    if (hits.length) results.push({ path: rel, hits });
    if (limited || Date.now() - t0 > 8000) { limited = true; break; }
  }
  return { results, total, files: results.length, scanned, limited };
}
