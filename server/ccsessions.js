// Claude Code keeps every session of a folder as a .jsonl file under ~/.claude/projects/<folder with every
// non-alphanumeric character replaced by "-">/<session id>.jsonl. This module lists the sessions of a folder and
// turns one into the station's own log events, so a session started in a terminal or in the Claude Code app can be
// brought into the project here and continued (the session id is kept; Claude Code resumes it in the same folder).
// Read-only: nothing under ~/.claude is ever written or removed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
export const slugOf = (cwd) => String(cwd).replace(/[^a-zA-Z0-9]/g, "-");
const SID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HEAD = 256 * 1024, TAIL = 16 * 1024 * 1024;

function sessionFile(cwd, id) {
  if (!SID.test(String(id))) return null;
  const dir = path.join(ROOT(), slugOf(cwd)), f = path.join(dir, id + ".jsonl");
  return path.dirname(f) === dir ? f : null;
}
const textOf = (content) => (typeof content === "string" ? content : Array.isArray(content) ? content.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "");
// what Claude Code itself puts into "user" turns: command wrappers, reminders, hook output. Not something a person typed.
const isNoise = (s) => !s || /^\s*<(command-|local-command|system-reminder|user-prompt-submit-hook|task-notification)/.test(s) || /^\s*(Caveat: The messages below|This session is being continued from a previous conversation)/.test(s);

// what a person typed, without what the editor or the app wrapped around it (opened-file notes, paste markers, tags)
const clean = (s) => String(s).replace(/<(ide_opened_file|ide_selection|ide_diagnostics|system-reminder)>[\s\S]*?<\/\1>/g, " ").replace(/<\/?[a-zA-Z_][\w-]*(?:\s[^<>]*)?>/g, " ").replace(/\s+/g, " ").trim();
function typedIn(text) { // the first thing a person typed in that stretch of the file
  for (const line of text.split("\n")) {
    if (!line || line.indexOf('"user"') < 0) continue; let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain || e.type !== "user" || !e.message) continue;
    const raw = textOf(e.message.content).trim(); if (isNoise(raw)) continue;
    const txt = clean(raw); if (txt) return txt.slice(0, 80);
  }
  return "";
}
// Claude Code names a session itself (the name its own list shows); a name the user gave wins over that
function namedIn(text) {
  let ai = "", custom = "", summary = "";
  for (const line of text.split("\n")) {
    if (!line || line.length > 4000 || !/"(ai-title|custom-title|summary)"/.test(line)) continue; let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "ai-title" && typeof e.aiTitle === "string") ai = e.aiTitle;
    else if (e.type === "custom-title" && typeof (e.customTitle ?? e.title) === "string") custom = e.customTitle ?? e.title;
    else if (e.type === "summary" && typeof e.summary === "string") summary = e.summary;
  }
  return clean(custom || ai || summary).slice(0, 80);
}
const titles = new Map(); // file → { at, title }: a session's name is read once per change of the file
function titleOf(file, st) {
  const c = titles.get(file); if (c && c.at === st.mtimeMs) return c.title;
  let title = "";
  try {
    const head = readPart(file, 0, Math.min(HEAD, st.size)), big = st.size > HEAD;
    const tail = big ? readPart(file, Math.max(HEAD, st.size - 4 * HEAD), Math.min(4 * HEAD, st.size - HEAD)).split("\n").slice(1).join("\n") : "";
    title = namedIn(tail) || namedIn(head) || typedIn(head) || (big ? typedIn(tail.split("\n").reverse().join("\n")) : "");
  } catch {}
  if (titles.size > 2000) titles.clear();
  titles.set(file, { at: st.mtimeMs, title });
  return title;
}

function readPart(file, from, len) {
  const fd = fs.openSync(file, "r");
  try { const buf = Buffer.alloc(len); const n = fs.readSync(fd, buf, 0, len, from); return buf.toString("utf8", 0, n); } finally { fs.closeSync(fd); }
}

/** Sessions of a folder, newest first. `known` are session ids the station already has as conversations. */
export function listSessions(cwd, { known = new Set(), limit = 40 } = {}) {
  const dir = path.join(ROOT(), slugOf(cwd));
  let names = []; try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch { return []; }
  const out = [];
  for (const n of names) {
    const id = n.slice(0, -6); if (!SID.test(id)) continue;
    let st; try { st = fs.statSync(path.join(dir, n)); } catch { continue; }
    if (!st.isFile() || st.size < 2) continue;
    out.push({ id, updatedAt: st.mtimeMs, bytes: st.size, known: known.has(id) });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  const shown = out.slice(0, limit);
  for (const s of shown) { const f = path.join(dir, s.id + ".jsonl"); try { s.title = titleOf(f, fs.statSync(f)); } catch { s.title = ""; } }
  return shown.filter((s) => s.title || s.bytes > 8192); // a file where nobody typed anything is not a conversation
}

/** One session as the station's log events (oldest first). Long sessions are read from their tail. */
export function readSession(cwd, id, { maxEvents = 4000 } = {}) {
  const file = sessionFile(cwd, id); if (!file) return null;
  let st; try { st = fs.statSync(file); } catch { return null; }
  const from = Math.max(0, st.size - TAIL);
  let lines = readPart(file, from, st.size - from).split("\n"); if (from > 0) lines = lines.slice(1);
  const evs = [], clip = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
  for (const line of lines) {
    if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain || !e.message || (e.type !== "user" && e.type !== "assistant")) continue;
    const t = Date.parse(e.timestamp) || 0, c = e.message.content;
    if (e.type === "user") {
      if (typeof c === "string") { if (!isNoise(c)) evs.push({ t, type: "user", text: clip(c, 20000) }); continue; }
      for (const b of Array.isArray(c) ? c : []) {
        if (b?.type === "text") { if (!isNoise(b.text)) evs.push({ t, type: "user", text: clip(String(b.text), 20000) }); }
        else if (b?.type === "tool_result") evs.push({ t, type: "tool_result", toolUseId: b.tool_use_id, isError: !!b.is_error, content: clip(textOf(b.content) || (typeof b.content === "string" ? b.content : ""), 4000) });
      }
    } else {
      for (const b of Array.isArray(c) ? c : []) {
        if (b?.type === "text" && b.text?.trim()) evs.push({ t, type: "text", text: clip(b.text, 40000) });
        else if (b?.type === "tool_use") {
          const i = b.input || {}, summary = String(i.file_path || i.command || i.pattern || i.url || i.query || i.description || "").replace(/\s+/g, " ").slice(0, 200);
          evs.push({ t, type: "tool_use", name: b.name, summary, toolUseId: b.id, input: b.name === "Bash" ? { command: clip(String(i.command || ""), 2000), description: i.description } : i.file_path ? { file_path: i.file_path } : null });
        }
      }
    }
  }
  return { events: evs.slice(-maxEvents), cut: from > 0 || evs.length > maxEvents, updatedAt: st.mtimeMs };
}

/** The most recent sessions of every folder on this computer, newest first, each with the folder it belongs to. */
export function listAllSessions({ limit = 40 } = {}) {
  let dirs = []; try { dirs = fs.readdirSync(ROOT(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  const all = [];
  for (const d of dirs) {
    let names = []; try { names = fs.readdirSync(path.join(ROOT(), d)).filter((n) => n.endsWith(".jsonl")); } catch { continue; }
    for (const n of names) { const id = n.slice(0, -6); if (!SID.test(id)) continue; try { const st = fs.statSync(path.join(ROOT(), d, n)); if (st.isFile() && st.size > 2) all.push({ dir: d, id, updatedAt: st.mtimeMs, bytes: st.size }); } catch {} }
  }
  all.sort((a, b) => b.updatedAt - a.updatedAt);
  const out = [];
  for (const s of all.slice(0, limit * 3)) {
    if (out.length >= limit) break;
    let title = "", cwd = "";
    try {
      for (const line of readPart(path.join(ROOT(), s.dir, s.id + ".jsonl"), 0, Math.min(HEAD, s.bytes)).split("\n")) {
        if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
        if (!cwd && typeof e.cwd === "string") cwd = e.cwd;
        if (cwd) break;
      }
    } catch {}
    if (!cwd || slugOf(cwd) !== s.dir) continue;           // the folder must be known for certain: it is where the session can be continued
    try { const f = path.join(ROOT(), s.dir, s.id + ".jsonl"); title = titleOf(f, fs.statSync(f)); } catch {}
    if (!title && s.bytes <= 8192) continue;
    out.push({ id: s.id, cwd, title, updatedAt: s.updatedAt });
  }
  return out;
}

/** The name of a session as Claude Code shows it (or what was typed first, cleaned). */
export function sessionTitle(cwd, id) { const f = sessionFile(cwd, id); if (!f) return ""; try { return titleOf(f, fs.statSync(f)); } catch { return ""; } }

/** Size of a session file, or -1 when it is not there. */
export function sessionSize(cwd, id) { const f = sessionFile(cwd, id); if (!f) return -1; try { return fs.statSync(f).size; } catch { return -1; } }
