// Agent records: kept in data/agents.json.
// An agent = a project folder + the Claude Code session running in that folder.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ROLES, roleOf } from "./roles.js";
import { t } from "./i18n.js";
import { DATA, mkdirPrivate, writePrivate } from "./paths.js";

const DATA_DIR = DATA;
const FILE = path.join(DATA_DIR, "agents.json");

export const MODELS = [
  "sonnet", "opus", "fable", "haiku",                       // aliases: always the newest version
  "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", // pinned versions
];
// A full model name can also be given for (older) models not in the list
const validModel = (m) => typeof m === "string" && /^[A-Za-z0-9][A-Za-z0-9._\-\[\]]{1,63}$/.test(m);
export const PERMISSIONS = ["acceptEdits", "plan", "bypassPermissions"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

let loadedOk = false;
function load() {
  if (!fs.existsSync(FILE)) { loadedOk = true; return []; }
  try { const l = JSON.parse(fs.readFileSync(FILE, "utf8")); loadedOk = true; return l; }
  catch (e) {
    // corrupt file: do not overwrite it and lose the project list; back it up and use the last good backup if there is one
    try { fs.copyFileSync(FILE, FILE + ".bozuk-" + Date.now()); } catch {}
    try { const l = JSON.parse(fs.readFileSync(FILE + ".bak", "utf8")); console.error("[ecelon] agents.json is corrupt; read from the .bak backup"); loadedOk = true; return l; } catch {}
    console.error("[ecelon] agents.json could not be read:", e.message); loadedOk = false; return [];
  }
}
function save(list) {
  if (!loadedOk && fs.existsSync(FILE)) { console.error("[ecelon] agents.json is corrupt; not overwritten"); return; }
  mkdirPrivate(DATA_DIR);
  // atomic: write to tmp first, then swap; keep the previous good state as .bak
  const tmp = FILE + ".tmp";
  writePrivate(tmp, JSON.stringify(list, null, 2));
  try { if (fs.existsSync(FILE)) { fs.copyFileSync(FILE, FILE + ".bak"); fs.chmodSync(FILE + ".bak", 0o600); } } catch {}
  fs.renameSync(tmp, FILE);
}

// Every agent gets a permanent character (0–17); older ones keep their current look (index number)
// Team: agents working in the same project folder share the same `team` value (the first agent's id).
// Older records become a one-person team with the developer role.
export function listAgents() {
  const list = load();
  let changed = false;
  list.forEach((a, i) => {
    if (!Number.isInteger(a.char)) { a.char = i % 18; changed = true; }
    if (!a.team) { a.team = a.id; changed = true; }
    if (!a.role) { a.role = "dev"; changed = true; }
  });
  if (changed) save(list);
  return list;
}
export const teamOf = (id, list = listAgents()) => {
  const a = list.find((x) => x.id === id); if (!a) return [];
  return list.filter((x) => x.team === a.team).sort((x, y) => ROLES[roleOf(x)].order - ROLES[roleOf(y)].order);
};
function freeChar(list) {
  const used = new Set(list.map((a) => a.char));
  for (let i = 0; i < 18; i++) if (!used.has(i)) return i;
  return list.length % 18;
}

export function getAgent(id) {
  return load().find((a) => a.id === id) || null;
}

export function addAgent({ name, cwd, model = "claude-sonnet-5-5", effort = "medium", permission = "acceptEdits" }) {
  const list = load();
  if (list.some((a) => a.cwd === cwd)) throw new Error(t("There is already a project for this folder. To add a role to the team, open the project and use the + Role button."));
  if (!validModel(model)) throw new Error(t("Invalid model name."));
  if (!EFFORTS.includes(effort)) throw new Error(t("Invalid effort."));
  if (!PERMISSIONS.includes(permission)) throw new Error(t("Invalid permission mode."));
  const id = randomUUID().slice(0, 8);
  const agent = {
    id, team: id, role: "dev",
    name: name || path.basename(cwd),
    cwd,
    model,
    effort,
    permission,
    char: freeChar(list),
    sessionId: null,          // the session id Claude Code gives after the first conversation
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    totalCostUsd: 0,
  };
  list.push(agent);
  save(list);
  return agent;
}

// Every project comes with a full team: fill in the missing roles. Roles cost nothing until used
// (the session opens only on the first task).
export function ensureFullTeams() {
  const list = listAgents();
  const teams = new Map();
  for (const a of list) { const k = a.team || a.id; if (!teams.has(k)) teams.set(k, []); teams.get(k).push(a); }
  let added = 0;
  for (const members of teams.values()) {
    const lead = members.find((m) => roleOf(m) === "dev") || members[0];
    for (const role of Object.keys(ROLES)) if (!members.some((m) => roleOf(m) === role)) { try { addMember(lead.id, role); added++; } catch {} }
  }
  return added;
}

// New role for the project (same folder, its own session, the role's default model)
export function addMember(teamOfId, role) {
  const list = load();
  const lead = list.find((a) => a.id === teamOfId);
  if (!lead) throw new Error(t("Project not found."));
  const r = ROLES[role]; if (!r) throw new Error(t("Invalid role."));
  const team = list.filter((a) => (a.team || a.id) === (lead.team || lead.id));
  if (team.some((a) => roleOf(a) === role)) throw new Error(t("This project already has a {role}.", { role: r.label }));
  if (team.length >= 4) throw new Error(t("A project can have at most 4 roles."));
  const agent = {
    id: randomUUID().slice(0, 8), team: lead.team || lead.id, role,
    name: lead.name, cwd: lead.cwd, model: r.model, effort: r.effort, permission: r.permission,
    char: freeChar(list), sessionId: null, createdAt: new Date().toISOString(), lastUsedAt: null, totalCostUsd: 0,
  };
  // keep team members next to each other in the list
  const last = Math.max(...team.map((a) => list.indexOf(a)));
  list.splice(last + 1, 0, agent);
  save(list);
  return agent;
}

export function updateAgent(id, patch) {
  const list = load();
  const a = list.find((x) => x.id === id);
  if (!a) throw new Error(t("Agent not found."));
  if (patch.model !== undefined) {
    if (!validModel(patch.model)) throw new Error(t("Invalid model name."));
    a.model = patch.model;
  }
  if (patch.effort !== undefined) {
    if (!EFFORTS.includes(patch.effort)) throw new Error(t("Invalid effort."));
    a.effort = patch.effort;
  }
  if (patch.permission !== undefined) {
    if (!PERMISSIONS.includes(patch.permission)) throw new Error(t("Invalid permission mode."));
    a.permission = patch.permission;
  }
  if (patch.name !== undefined) { // project name: the same for everyone in the team
    const n = String(patch.name).slice(0, 40);
    for (const m of list) if ((m.team || m.id) === (a.team || a.id)) m.name = n;
  }
  if (patch.sessionId !== undefined) a.sessionId = patch.sessionId;
  if (patch.lastUsedAt !== undefined) a.lastUsedAt = patch.lastUsedAt;
  if (patch.context !== undefined) a.context = patch.context;
  if (Array.isArray(patch.convs)) a.convs = patch.convs;
  if (patch.activeConv !== undefined) a.activeConv = patch.activeConv;
  if (Array.isArray(patch.links)) a.links = [...new Set(patch.links.map(String))].slice(0, 20);
  if (Array.isArray(patch.allowedTools)) a.allowedTools = [...new Set(patch.allowedTools.map(String))].slice(0, 100);
  if (patch.attention !== undefined) { if (patch.attention) a.attention = patch.attention; else delete a.attention; } // awaiting permission / error
  if (typeof patch.addCostUsd === "number") a.totalCostUsd = +(a.totalCostUsd + patch.addCostUsd).toFixed(4);
  save(list);
  return a;
}

// whole: remove the project with its whole team; otherwise only this role (the team key does not change).
export function removeAgent(id, { whole = false } = {}) {
  const list = load();
  const a = list.find((x) => x.id === id);
  if (!a) throw new Error(t("Agent not found."));
  const team = a.team || a.id;
  const gone = whole ? list.filter((x) => (x.team || x.id) === team) : [a];
  const rest = list.filter((x) => !gone.includes(x));
  save(rest);
  return gone;
}

// New order via drag and drop (the station layout follows this order)
export function reorderAgents(ids) {
  const list = load();
  const pos = new Map(ids.map((id, i) => [id, i]));
  list.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  save(list);
  return list;
}

export function resetSession(id) {
  return updateAgent(id, { sessionId: null });
}
