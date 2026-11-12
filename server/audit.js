// Audit trail: an append-only record of the things somebody may have to answer for later — which command ran,
// which file was written, who was allowed what and by whom, what was verified or undone. One JSON line per entry in
// data/audit.jsonl. Every entry carries the hash of the one before it, so a line that was edited or removed
// afterwards shows up as a broken chain (see verifyChain). It is evidence of tampering, not protection against it:
// whoever can write the file can also rewrite all of it.
import fs from "node:fs";
import crypto from "node:crypto";
import { dataPath, mkdirPrivate, DATA } from "./paths.js";

const FILE = dataPath("audit.jsonl");
export const KINDS = ["command", "file", "allow_once", "allow_always", "permission_mode", "denied", "verify", "revert", "project"];
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

let last = null; // hash of the newest entry
function tail(bytes) {
  const fd = fs.openSync(FILE, "r");
  try { const size = fs.fstatSync(fd).size, len = Math.min(bytes, size), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); const lines = buf.toString("utf8").split("\n"); return { lines: (len < size ? lines.slice(1) : lines).filter(Boolean), cut: len < size }; }
  finally { fs.closeSync(fd); }
}
function lastHash() {
  if (last !== null) return last;
  try { const { lines } = tail(64 * 1024); last = lines.length ? JSON.parse(lines[lines.length - 1]).h || "" : ""; } catch { last = ""; }
  return last;
}

/** @param {{ team?: string, agent?: string, who?: string, role?: string, kind: string, what: string, ok?: boolean, extra?: string }} e */
export function audit(e) {
  try {
    const body = { t: Date.now(), team: e.team || "", agent: e.agent || "", who: clip(e.who, 80), role: e.role || "", kind: e.kind, what: clip(e.what, 600), ...(e.ok === false ? { ok: false } : {}), ...(e.extra ? { extra: clip(e.extra, 300) } : {}), p: lastHash() };
    const h = sha(JSON.stringify(body));
    mkdirPrivate(DATA);
    fs.appendFileSync(FILE, JSON.stringify({ ...body, h }) + "\n", { mode: 0o600 });
    last = h;
  } catch (err) { console.error("[ecelon] audit entry could not be written:", err.message); }
}

/** Newest first. */
export function readAudit({ team = "", kinds = null, since = 0, limit = 500 } = {}) {
  let lines = []; try { lines = tail(8 * 1024 * 1024).lines; } catch { return []; }
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    let e; try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e.t < since) break;
    if (team && e.team !== team) continue;
    if (kinds && !kinds.includes(e.kind)) continue;
    out.push(e);
  }
  return out;
}

/** Walks the whole file: every entry must hash to its own `h` and point at the entry before it. */
export function verifyChain() {
  let text = ""; try { text = fs.readFileSync(FILE, "utf8"); } catch { return { ok: true, count: 0 }; }
  let prev = "", n = 0;
  for (const line of text.split("\n")) {
    if (!line) continue; n++;
    let e; try { e = JSON.parse(line); } catch { return { ok: false, count: n, brokenAt: n }; }
    const { h, ...body } = e;
    if (body.p !== prev || sha(JSON.stringify(body)) !== h) return { ok: false, count: n, brokenAt: n, at: e.t };
    prev = h;
  }
  return { ok: true, count: n };
}

const csvCell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; }; // no formula may run when the file is opened in a spreadsheet
export function auditCsv(rows, names = {}) {
  return "﻿" + [["time", "project", "who", "role", "kind", "what", "result", "detail", "hash"].join(","),
    ...rows.map((e) => [new Date(e.t).toISOString(), names[e.team] || e.team, e.who, e.role, e.kind, e.what, e.ok === false ? "failed" : "", e.extra || "", e.h].map(csvCell).join(","))].join("\r\n") + "\r\n";
}
