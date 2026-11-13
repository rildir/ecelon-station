// Task board: work that one role leaves for another (or for the user) instead of saying "I can't do that".
// data/tasks/<team>.json — agents add/update tasks through MCP tools, the user through the UI.
import fs from "node:fs";
import path from "node:path";
import { dataPath, mkdirPrivate, writePrivate } from "./paths.js";

const DIR = dataPath("tasks");
export const STATUSES = ["todo", "doing", "done", "blocked"];
export const PRIORITIES = ["high", "normal", "low"];
const file = (team) => path.join(DIR, `${String(team).replace(/[^\w-]/g, "")}.json`);
const clip = (s, n) => String(s ?? "").trim().slice(0, n);

export function load(team) {
  try { const d = JSON.parse(fs.readFileSync(file(team), "utf8")); return { items: Array.isArray(d.items) ? d.items : [], seq: d.seq || 0 }; }
  catch { return { items: [], seq: 0 }; }
}
function save(team, d) { mkdirPrivate(DIR); writePrivate(file(team), JSON.stringify(d, null, 1)); }

// role: target role id ("tester", "dev"…) or "user" (only the person can do it)
export function add(team, { title, detail, role, priority, req, by }) {
  title = clip(title, 160); if (!title) throw new Error("title is empty");
  const d = load(team); d.seq++;
  const now = Date.now();
  const it = { id: "T-" + String(d.seq).padStart(3, "0"), title, detail: clip(detail, 4000), role: clip(role, 20) || "user",
    priority: PRIORITIES.includes(priority) ? priority : "normal", req: Array.isArray(req) ? req.map((x) => clip(x, 20)).filter(Boolean).slice(0, 30) : [],
    status: "todo", by: clip(by, 40), note: "", createdAt: now, updatedAt: now };
  d.items.push(it); save(team, d); return it;
}
export function update(team, id, patch = {}) {
  const d = load(team); const it = d.items.find((x) => x.id === id); if (!it) return null;
  if (STATUSES.includes(patch.status)) it.status = patch.status;
  if (patch.note != null) it.note = clip(patch.note, 2000);
  if (patch.title != null && clip(patch.title, 160)) it.title = clip(patch.title, 160);
  if (patch.detail != null) it.detail = clip(patch.detail, 4000);
  if (patch.role != null && clip(patch.role, 20)) it.role = clip(patch.role, 20);
  if (PRIORITIES.includes(patch.priority)) it.priority = patch.priority;
  // an isolated task: { dir, cwd, branch, base, top, agent } while its own copy exists, null once merged or discarded
  if (patch.wt !== undefined) { if (patch.wt) it.wt = patch.wt; else delete it.wt; }
  it.updatedAt = Date.now(); save(team, d); return it;
}
export function remove(team, id) {
  const d = load(team); const n = d.items.length; d.items = d.items.filter((x) => x.id !== id);
  if (d.items.length !== n) save(team, d); return d.items.length !== n;
}
export const get = (team, id) => load(team).items.find((x) => x.id === id) || null;
export function summary(team) {
  const it = load(team).items; const open = it.filter((x) => x.status !== "done");
  return { total: it.length, open: open.length, doing: it.filter((x) => x.status === "doing").length, toUser: open.filter((x) => x.role === "user").length };
}
// counts per status plus what was finished today (for the office: whiteboard notes, printer report)
export function counts(team, since = 0, oldBefore = 0) {
  const it = load(team).items; const o = { todo: 0, doing: 0, done: 0, blocked: 0, doneSince: 0, toUser: 0, old: 0 };
  for (const x of it) {
    o[x.status] = (o[x.status] || 0) + 1; if (x.status === "done" && x.updatedAt >= since) o.doneSince++;
    if (x.status !== "done" && x.role === "user") o.toUser++;
    if (x.status !== "done" && oldBefore && x.updatedAt < oldBefore) o.old++; // open and untouched for days
  }
  return o;
}
