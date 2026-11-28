// Demo mode seed: when the station runs with --demo (MOCK=1) and has no projects yet, the sample
// projects (a fictional ERP, one room per module) are copied into the data folder, each gets a full team, and a sample analysis document
// is linked to the API project — so the first screen is a working office, not an empty station.
import fs from "node:fs";
import path from "node:path";
import { listAgents, addAgent, ensureFullTeams } from "./agents.js";
import { importFile } from "./library.js";
import { spawnSync } from "node:child_process";
import { dataPath, rootPath } from "./paths.js";
import { getLang } from "./i18n.js";

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
  // demo/projects.json lists the sample projects (fictional company "Aurora"), their names per language and which one carries the document
  let man = null; try { man = JSON.parse(fs.readFileSync(path.join(SRC, "projects.json"), "utf8")); } catch {}
  const lang = getLang();
  const list = (man?.projects || (fs.existsSync(path.join(SRC, "projects")) ? fs.readdirSync(path.join(SRC, "projects")).sort().map((d) => ({ dir: d, name: { en: d } })) : []))
    .filter((p) => fs.existsSync(path.join(SRC, "projects", p.dir)));
  if (!list.length) return false;
  const made = [];
  for (const p of list) {
    const dst = path.join(ws, p.dir);
    fs.cpSync(path.join(SRC, "projects", p.dir), dst, { recursive: true, force: false, errorOnExist: false });
    gitInit(dst);
    made.push({ dir: p.dir, agent: addAgent({ name: p.name?.[lang] || p.name?.en || p.dir, cwd: dst }) });
  }
  ensureFullTeams();
  // the lead project gets the analysis document (the mock analyst extracts requirements from it)
  const lead = (made.find((m) => m.dir === man?.lead) || made[0]).agent;
  const docDir = [path.join(SRC, "docs", lang), path.join(SRC, "docs", "en")].find((d) => fs.existsSync(d));
  const docs = docDir ? fs.readdirSync(docDir).sort() : [];
  for (const f of docs) { try { await importFile(path.join(docDir, f), { agents: [lead.id] }); } catch (e) { console.error("[demo] document could not be imported:", e.message); } }
  console.log(`Demo: ${made.length} sample projects created in ${ws}`);
  return true;
}
