// Demo mode seed: when the station runs with --demo (MOCK=1) and has no projects yet, three sample
// projects are copied into the data folder, each gets a full team, and a sample analysis document
// is linked to the API project — so the first screen is a working office, not an empty station.
import fs from "node:fs";
import path from "node:path";
import { listAgents, addAgent, ensureFullTeams } from "./agents.js";
import { importFile } from "./library.js";
import { spawnSync } from "node:child_process";
import { dataPath, rootPath } from "./paths.js";

// Make each sample project a git repository (so change cards, undo and the Git panel work in the demo).
function gitInit(dir) {
  const git = (...a) => spawnSync("git", a, { cwd: dir, stdio: "ignore", windowsHide: true });
  if (git("--version").status !== 0 || fs.existsSync(path.join(dir, ".git"))) return;
  git("init", "-q"); git("config", "user.email", "demo@ecelon.local"); git("config", "user.name", "Ecelon Demo");
  git("add", "-A"); git("commit", "-q", "-m", "Initial import");
}

const SRC = rootPath("demo");

export async function seedDemo() {
  if (listAgents().length) return false;
  const ws = dataPath("demo-workspace");
  const projects = fs.existsSync(path.join(SRC, "projects")) ? fs.readdirSync(path.join(SRC, "projects")).sort() : [];
  if (!projects.length) return false;
  const made = [];
  for (const p of projects) {
    const dst = path.join(ws, p);
    fs.cpSync(path.join(SRC, "projects", p), dst, { recursive: true, force: false, errorOnExist: false });
    gitInit(dst);
    made.push(addAgent({ name: p, cwd: dst }));
  }
  ensureFullTeams();
  // link every demo document to the API project (the mock analyst extracts requirements from it)
  const api = made.find((a) => /api/i.test(a.name)) || made[0];
  const docs = fs.existsSync(path.join(SRC, "docs")) ? fs.readdirSync(path.join(SRC, "docs")).sort() : [];
  for (const f of docs) { try { await importFile(path.join(SRC, "docs", f), { agents: [api.id] }); } catch (e) { console.error("[demo] document could not be imported:", e.message); } }
  console.log(`Demo: ${made.length} sample projects created in ${ws}`);
  return true;
}
