// Ajan kayıtları: data/agents.json içinde tutulur.
// Bir ajan = bir proje klasörü + o klasörde çalışan Claude Code oturumu.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = path.resolve("data");
const FILE = path.join(DATA_DIR, "agents.json");

export const MODELS = [
  "sonnet", "opus", "fable", "haiku",                       // takma adlar: hep en yeni sürüm
  "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", // sabit sürümler
];
// Listede olmayan (eski) modeller için tam model adı da yazılabilir
const validModel = (m) => typeof m === "string" && /^[A-Za-z0-9][A-Za-z0-9._\-\[\]]{1,63}$/.test(m);
export const PERMISSIONS = ["acceptEdits", "plan", "bypassPermissions"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function load() {
  if (!fs.existsSync(FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return []; }
}

function save(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

// Her ajana kalıcı bir karakter (0–17); eskiler şu anki görünümlerini (sıra numarası) korur
export function listAgents() {
  const list = load();
  if (list.some((a) => !Number.isInteger(a.char))) {
    list.forEach((a, i) => { if (!Number.isInteger(a.char)) a.char = i % 18; });
    save(list);
  }
  return list;
}
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
  if (list.some((a) => a.cwd === cwd)) throw new Error("Bu klasör için zaten bir ajan var.");
  if (!validModel(model)) throw new Error("Geçersiz model adı.");
  if (!EFFORTS.includes(effort)) throw new Error("Geçersiz efor.");
  if (!PERMISSIONS.includes(permission)) throw new Error("Geçersiz izin modu.");
  const agent = {
    id: randomUUID().slice(0, 8),
    name: name || path.basename(cwd),
    cwd,
    model,
    effort,
    permission,
    char: freeChar(list),
    sessionId: null,          // ilk konuşmadan sonra Claude Code'un verdiği oturum kimliği
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    totalCostUsd: 0,
  };
  list.push(agent);
  save(list);
  return agent;
}

export function updateAgent(id, patch) {
  const list = load();
  const a = list.find((x) => x.id === id);
  if (!a) throw new Error("Ajan bulunamadı.");
  if (patch.model !== undefined) {
    if (!validModel(patch.model)) throw new Error("Geçersiz model adı.");
    a.model = patch.model;
  }
  if (patch.effort !== undefined) {
    if (!EFFORTS.includes(patch.effort)) throw new Error("Geçersiz efor.");
    a.effort = patch.effort;
  }
  if (patch.permission !== undefined) {
    if (!PERMISSIONS.includes(patch.permission)) throw new Error("Geçersiz izin modu.");
    a.permission = patch.permission;
  }
  if (patch.name !== undefined) a.name = String(patch.name).slice(0, 40);
  if (patch.sessionId !== undefined) a.sessionId = patch.sessionId;
  if (patch.lastUsedAt !== undefined) a.lastUsedAt = patch.lastUsedAt;
  if (patch.context !== undefined) a.context = patch.context;
  if (Array.isArray(patch.convs)) a.convs = patch.convs;
  if (patch.activeConv !== undefined) a.activeConv = patch.activeConv;
  if (Array.isArray(patch.allowedTools)) a.allowedTools = [...new Set(patch.allowedTools.map(String))].slice(0, 100);
  if (typeof patch.addCostUsd === "number") a.totalCostUsd = +(a.totalCostUsd + patch.addCostUsd).toFixed(4);
  save(list);
  return a;
}

export function removeAgent(id) {
  const list = load();
  const idx = list.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error("Ajan bulunamadı.");
  const [removed] = list.splice(idx, 1);
  save(list);
  return removed;
}

// Sürükle-bırak ile yeni sıra (istasyondaki yerleşim bu sırayla yapılır)
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
