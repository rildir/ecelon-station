// Start a project with one click, together with what it needs (its backend, a database container…).
//
// The first time, a small model is asked once to write a "launch plan" from a short digest of the projects on this
// station (their scripts, the ports their configuration names; never secrets: .env files and connection strings are
// not read, only localhost addresses are kept). The plan is shown to the user, who approves (and may edit) it before
// anything runs; it is saved in data/launch/<team>.json. From then on, a click runs the plan without the model:
// each step is started with the run panel's machinery, in order, and the next one waits until the step is ready
// (its port answers, or its output shows an address). A step whose port already answers is left alone.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { t, langName } from "./i18n.js";
import { dataPath, mkdirPrivate, writePrivate } from "./paths.js";
import * as runs from "./runs.js";
import { oneShot } from "./runner.js";

export const LAUNCH_MODEL = "claude-haiku-5-5";
const DIR = dataPath("launch");
const READY_MS = 300000; // a cold Angular or .NET build can take minutes
const states = new Map(); // team → { state, steps: [{ label, project, port, state, run, note }], error, at }
let emit = () => {};
export function init(broadcast) { emit = broadcast; }

const file = (team) => path.join(DIR, `${String(team).replace(/[^\w-]/g, "")}.json`);
export function loadPlan(team) { try { return JSON.parse(fs.readFileSync(file(team), "utf8")); } catch { return null; } }
function savePlan(team, plan) { mkdirPrivate(DIR); writePrivate(file(team), JSON.stringify(plan, null, 2)); return plan; }

// ---------------------------------------------------------------- what the model is shown
const read = (p, max = 60000) => { try { const s = fs.statSync(p); return s.isFile() && s.size <= max ? fs.readFileSync(p, "utf8") : null; } catch { return null; } };
const json = (p) => { const s = read(p); if (!s) return null; try { return JSON.parse(s.replace(/^\uFEFF/, "").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "")); } catch { return null; } };
const SKIP = new Set(["node_modules", ".git", "dist", "build", "bin", "obj", ".angular", ".nx", ".next", "coverage", "vendor", ".vs", ".idea", "out", "tmp"]);
/** Files under `root`, at most `depth` folders down, whose name matches `re`. */
function find(root, re, depth = 3, out = [], rel = "") {
  if (out.length >= 40) return out;
  let ents = []; try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) { if (depth > 0 && !SKIP.has(e.name) && !e.name.startsWith(".")) find(root, re, depth - 1, out, r); }
    else if (re.test(e.name)) out.push(r);
    if (out.length >= 40) break;
  }
  return out;
}
const LOCAL = /\b(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\*|\+)(?::\d{2,5})?[^\s"'`,;)]*/gi;
const locals = (s) => [...new Set((s || "").match(LOCAL) || [])].slice(0, 12);

/** A short, secret-free description of one project folder: how it is started and which local addresses it names. */
export function digest(cwd) {
  const lines = [];
  for (const rel of find(cwd, /^package\.json$/, 2).slice(0, 8)) {
    const p = json(path.join(cwd, rel)); if (!p) continue;
    const dir = path.dirname(rel) === "." ? "" : path.dirname(rel);
    const pm = fs.existsSync(path.join(cwd, dir, "pnpm-lock.yaml")) ? "pnpm" : fs.existsSync(path.join(cwd, dir, "yarn.lock")) ? "yarn" : "npm";
    const scripts = Object.entries(p.scripts || {}).filter(([k]) => /^(start|dev|serve|watch)|:(start|dev|serve)|^(start|serve|dev):/i.test(k)).slice(0, 10);
    const deps = Object.keys({ ...p.dependencies, ...p.devDependencies }).filter((d) => /^(@angular\/core|react|next|vue|@nestjs\/core|express|vite|nx|@nx\/|electron|fastify|nodemon)/.test(d)).slice(0, 8);
    lines.push(`package.json${dir ? " in " + dir : ""} (${pm}): ${scripts.map(([k, v]) => `${k} = ${v}`).join("; ") || "no start script"}${deps.length ? " | uses " + deps.join(", ") : ""}`);
  }
  for (const rel of find(cwd, /^(angular\.json|project\.json)$/, 3).slice(0, 8)) {
    const s = read(path.join(cwd, rel)); if (!s) continue;
    const ports = [...new Set([...s.matchAll(/"port"\s*:\s*(\d{2,5})/g)].map((m) => m[1]))], proxy = [...new Set([...s.matchAll(/"proxyConfig"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))];
    const serve = /"serve"\s*:/.test(s);
    if (ports.length || proxy.length || serve) lines.push(`${rel}: ${serve ? "has a serve target" : ""}${ports.length ? "; port " + ports.join(", ") : ""}${proxy.length ? "; proxy " + proxy.join(", ") : ""}`);
  }
  for (const rel of find(cwd, /^proxy\.conf.*\.(json|js|mjs|cjs)$/i, 4).slice(0, 4)) { const u = locals(read(path.join(cwd, rel))); if (u.length) lines.push(`${rel}: forwards to ${u.join(", ")}`); }
  for (const rel of find(cwd, /^environment[\w.-]*\.ts$/i, 6).slice(0, 6)) { const u = locals(read(path.join(cwd, rel))); if (u.length) lines.push(`${rel}: calls ${u.join(", ")}`); }
  for (const rel of find(cwd, /^launchSettings\.json$/i, 4).slice(0, 4)) {
    const j = json(path.join(cwd, rel)); const profiles = Object.entries(j?.profiles || {}).filter(([, v]) => v?.commandName === "Project" || v?.applicationUrl).slice(0, 4);
    if (profiles.length) lines.push(`${rel}: ${profiles.map(([k, v]) => `profile ${k} → ${locals(v.applicationUrl || "").join(" ") || v.applicationUrl || "?"}`).join("; ")}`);
  }
  for (const rel of find(cwd, /^(server|index|app|main)\.(c?js|mjs|ts)$/i, 2).slice(0, 6)) {
    const src = read(path.join(cwd, rel), 120000) || "";
    const ports = [...new Set([...src.matchAll(/\.listen\(\s*(\d{2,5})|\bPORT\b[^\n]{0,30}?\|\|\s*(\d{2,5})|\bport\s*[:=]\s*(\d{2,5})/g)].map((m) => m[1] || m[2] || m[3]))].slice(0, 4);
    if (ports.length) lines.push(`${rel}: listens on port ${ports.join(", ")}`);
  }
  for (const rel of find(cwd, /^application(-[\w]+)?\.(properties|ya?ml)$/i, 5).slice(0, 4)) {
    const m = /server\.port\s*[=:]\s*(\d{2,5})|^\s*port:\s*(\d{2,5})/m.exec(read(path.join(cwd, rel)) || ""); if (m) lines.push(`${rel}: server port ${m[1] || m[2]}`);
  }
  const sln = find(cwd, /\.sln$/i, 1), csproj = find(cwd, /\.csproj$/i, 3);
  if (sln.length || csproj.length) lines.push(`.NET: ${[...sln, ...csproj].slice(0, 8).join(", ")}`);
  for (const rel of find(cwd, /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i, 1).slice(0, 2)) {
    const s = read(path.join(cwd, rel)) || ""; const svc = [...s.matchAll(/^ {2}([\w.-]+):\s*$/gm)].map((m) => m[1]).slice(0, 10), ports = [...new Set([...s.matchAll(/["']?(\d{2,5}):\d{2,5}["']?/g)].map((m) => m[1]))].slice(0, 10);
    lines.push(`${rel}: services ${svc.join(", ") || "?"}${ports.length ? "; host ports " + ports.join(", ") : ""}`);
  }
  if (fs.existsSync(path.join(cwd, "artisan"))) lines.push("Laravel (artisan): php artisan serve");
  if (fs.existsSync(path.join(cwd, "manage.py"))) lines.push("Django (manage.py): python manage.py runserver");
  const readme = find(cwd, /^readme(\.md)?$/i, 0)[0];
  if (readme) { const s = read(path.join(cwd, readme), 200000) || ""; const run = s.split(/\r?\n/).filter((l) => /\b(npm (run |start)|pnpm |yarn |nx (serve|run)|ng serve|dotnet (run|watch)|docker[- ]compose|php artisan serve|go run|python .*run)/i.test(l)).slice(0, 8); if (run.length) lines.push(`README run lines: ${run.map((l) => l.trim().slice(0, 140)).join(" | ")}`); }
  return lines.join("\n").slice(0, 3500);
}

// ---------------------------------------------------------------- asking for a plan
/** The prompt for one target project; `projects` are { team, name, cwd } of every project on the station. */
export function planPrompt(target, projects) {
  const others = projects.filter((p) => p.team !== target.team);
  const block = (p) => `### ${p.name}\nfolder: ${p.cwd}\n${digest(p.cwd) || "(nothing recognised)"}`;
  return `You prepare the steps that start a software project on a developer's computer for local development.\n\n` +
    `The project to start:\n${block(target)}\n\nOther projects on this computer (a step may belong to one of them when the target needs it, for example a backend API it calls):\n${others.map(block).join("\n\n") || "(none)"}\n\n` +
    `Rules:\n- Start only what the target needs: the target itself, and a dependency only when the target clearly calls it (a local address or proxy target of the target matches a port the other project serves).\n- Dependencies come first, the target last. At most 5 steps.\n- Each command is the normal development start command, run from the given folder (a path relative to that project's folder, "" for its root). Never a build-only, test, install or deploy command. No "cd", no "&&".\n- port: the local port the step listens on when it is ready, if you can tell it from the facts above; otherwise null.\n- Use only commands and ports supported by the facts above. If the target cannot be started from them, return an empty list.\n\n` +
    `Reply with ONLY a JSON object, no other text:\n{"steps": [{"project": "<project name exactly as above>", "label": "<short label>", "cmd": "<command>", "dir": "<relative folder or empty>", "port": <number or null>}], "note": "<one sentence on what was found>"}\nWrite "label" and "note" in ${langName()}.`;
}
const pickJson = (s) => { const a = String(s).indexOf("{"), b = String(s).lastIndexOf("}"); if (a < 0 || b <= a) return null; try { return JSON.parse(String(s).slice(a, b + 1)); } catch { return null; } };

/** The steps of a plan that are well formed and point at real folders of known projects. */
export function cleanSteps(raw, projects) {
  const steps = Array.isArray(raw) ? raw : [];
  return steps.slice(0, 5).map((s) => {
    const p = projects.find((x) => x.name === s?.project) || projects.find((x) => x.team === s?.team);
    const cmd = typeof s?.cmd === "string" ? s.cmd.trim() : "", dir = typeof s?.dir === "string" ? s.dir.trim().replace(/^\.\/?/, "").replace(/\\/g, "/") : "";
    const port = Number.isInteger(s?.port) && s.port > 0 && s.port < 65536 ? s.port : null;
    if (!p || !cmd || cmd.length > 300 || /[\r\n]/.test(cmd) || dir.split("/").includes("..") || path.isAbsolute(dir)) return null;
    if (!fs.existsSync(path.join(p.cwd, dir || "."))) return null;
    return { team: p.team, project: p.name, label: (typeof s.label === "string" && s.label.trim() ? s.label.trim() : cmd).slice(0, 60), cmd, dir, port };
  }).filter(Boolean);
}

export async function discover(target, projects) {
  const out = await oneShot(planPrompt(target, projects), { cwd: target.cwd, model: LAUNCH_MODEL, timeout: 120000 });
  const j = pickJson(out); if (!j) throw new Error(t("The plan could not be read. Try again."));
  const steps = cleanSteps(j.steps, projects);
  if (!steps.length) throw new Error(t("No way to start this project was found. Add the steps yourself."));
  return { steps, note: typeof j.note === "string" ? j.note.slice(0, 300) : "", approved: false, madeAt: new Date().toISOString() };
}
export function approve(team, steps, projects) {
  const clean = cleanSteps(steps, projects); if (!clean.length) throw new Error(t("The plan has no valid step."));
  return savePlan(team, { steps: clean, approved: true, madeAt: new Date().toISOString() });
}
export function forget(team) { try { fs.unlinkSync(file(team)); } catch { /* there was none */ } states.delete(team); emit({ type: "launch", team, state: "none" }); }

// ---------------------------------------------------------------- running a plan
/** Whether something answers on localhost at this port (IPv4 or IPv6, as dev servers bind either). */
export function portOpen(port, ms = 800) {
  // never throws and always settles: a hard timer, not only the socket's own timeout (which Windows may not honour while connecting)
  const one = (host) => new Promise((res) => {
    let s = null, over = false;
    const done = (v) => { if (over) return; over = true; clearTimeout(timer); try { s?.destroy(); } catch { /* gone */ } res(v); };
    const timer = setTimeout(() => done(false), ms);
    try { s = net.connect({ host, port }); s.once("connect", () => done(true)); s.once("error", () => done(false)); } catch { done(false); }
  });
  return Promise.all([one("127.0.0.1"), one("::1")]).then(([a, b]) => a || b, () => false);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const view = (team) => { const s = states.get(team); return s ? { state: s.state, error: s.error || null, at: s.at, steps: s.steps.map(({ label, project, port, state, run, note }) => ({ label, project, port, state, run, note })) } : { state: "none" }; };
const send = (team) => emit({ type: "launch", team, ...view(team) });

export function status(team) {
  const plan = loadPlan(team), s = states.get(team);
  return { plan: plan?.approved ? plan : null, ...(s ? view(team) : { state: plan?.approved ? "idle" : "none" }) };
}

export async function up(team, projects) {
  const plan = loadPlan(team); if (!plan?.approved) throw new Error(t("Approve a launch plan first."));
  const cur = states.get(team); if (cur?.state === "starting") return view(team);
  const s = { state: "starting", steps: plan.steps.map((x) => ({ ...x, state: "waiting", run: null, note: "" })), error: null, at: Date.now() };
  states.set(team, s); send(team);
  (async () => {
   try {
    for (const st of s.steps) {
      if (states.get(team) !== s) return; // stopped meanwhile
      const p = projects.find((x) => x.team === st.team); if (!p) { st.state = "failed"; st.note = t("The project is no longer on the station"); break; }
      if (st.port && await portOpen(st.port)) { st.state = "up"; st.note = t("Already running"); send(team); continue; }
      st.state = "starting"; send(team);
      let r;
      try { r = runs.start({ team: st.team, cwd: p.cwd, cmd: st.cmd, dir: st.dir, label: st.label }); }
      catch (e) { const same = runs.list(st.team).find((x) => x.cmd === st.cmd && x.dir === st.dir && x.status === "running"); if (!same) { st.state = "failed"; st.note = e.message; break; } r = same; }
      const waitNote = st.port ? t("Waiting for port {port}…", { port: st.port }) : t("Waiting for it to be ready…");
      st.run = r.id; st.note = waitNote; send(team);
      const t0 = Date.now(); let ok = false;
      while (Date.now() - t0 < READY_MS) {
        if (states.get(team) !== s) return;
        const now = runs.get(r.id);
        if (!now || now.status !== "running") { st.note = t("The command ended (exit code {code}) before it was ready", { code: now?.code ?? "?" }); break; }
        if (st.port ? await portOpen(st.port) : now.url || Date.now() - t0 > 20000) { ok = true; break; }
        await sleep(1000);
      }
      if (!ok) { st.state = "failed"; if (st.note === waitNote) st.note = t("Not ready after {n} minutes", { n: READY_MS / 60000 }); break; }
      st.state = "up"; st.note = ""; send(team);
    }
   } catch (e) {
    // anything unexpected ends the launch visibly instead of leaving the button on "starting" for ever
    console.error("[launch]", e?.stack || e);
    const cur = s.steps.find((x) => x.state === "starting" || x.state === "waiting") || s.steps[0];
    if (cur) { cur.state = "failed"; cur.note = e?.message || String(e); }
   }
    if (states.get(team) !== s) return;
    const bad = s.steps.find((x) => x.state === "failed");
    s.state = bad ? "failed" : "up"; s.error = bad ? `${bad.label}: ${bad.note}` : null; s.at = Date.now(); send(team);
  })();
  return view(team);
}
/** Stops what this launch started (a step that was already running before is left alone). */
export function down(team) {
  const s = states.get(team); if (!s) return { state: "idle" };
  states.delete(team);
  for (const st of s.steps) if (st.run && st.note !== t("Already running")) { try { runs.stop(st.run); } catch { /* already gone */ } }
  emit({ type: "launch", team, state: "idle", steps: [] });
  return { state: "idle" };
}
/** Called when a run ends: a launch that was up and lost one of its steps is no longer up. */
export function onRunEnded(runId) {
  for (const [team, s] of states) {
    const st = s.steps.find((x) => x.run === runId); if (!st || s.state !== "up") continue;
    st.state = "failed"; st.note = t("It stopped"); s.state = "failed"; s.error = `${st.label}: ${st.note}`; send(team);
  }
}
