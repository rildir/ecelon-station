// Run panel: project-specific commands (npm run dev, dotnet run…), live output, stop, simple terminal.
// Build/lint errors in the output are parsed into the "Problems" list (file:line).
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { t } from "./i18n.js";
import { dataPath, mkdirPrivate, writePrivate } from "./paths.js";

const DIR = dataPath("commands");
const MAX_LINES = 4000;
const WIN = process.platform === "win32";
const runs = new Map(); // id -> run
let emit = () => {};
export function init(broadcast) { emit = broadcast; }

const file = (team) => path.join(DIR, `${String(team).replace(/[^\w-]/g, "")}.json`);
export function loadCommands(team) { try { return JSON.parse(fs.readFileSync(file(team), "utf8")); } catch { return []; } }
export function saveCommands(team, list) {
  mkdirPrivate(DIR);
  const clean = (Array.isArray(list) ? list : []).slice(0, 40).map((c) => ({ id: c.id || randomUUID().slice(0, 8), label: String(c.label || c.cmd || "").trim().slice(0, 40), cmd: String(c.cmd || "").trim().slice(0, 1000), dir: String(c.dir || "").trim().slice(0, 300), check: !!c.check })).filter((c) => c.cmd && c.label);
  writePrivate(file(team), JSON.stringify(clean, null, 2));
  return clean;
}

// Commands suggested by looking at the project (package.json scripts, .NET, PHP/Laravel, Python, Godot)
export function detect(cwd) {
  const out = []; const add = (label, cmd, dir = "", check = false) => { if (!out.some((x) => x.cmd === cmd && x.dir === dir)) out.push({ id: "auto:" + (dir ? dir + ":" : "") + cmd, label, cmd, dir, check, auto: true }); };
  const scan = (dir) => {
    const abs = path.join(cwd, dir);
    let pkg = null; try { pkg = JSON.parse(fs.readFileSync(path.join(abs, "package.json"), "utf8")); } catch {}
    if (pkg) {
      const pm = fs.existsSync(path.join(abs, "pnpm-lock.yaml")) ? "pnpm" : fs.existsSync(path.join(abs, "yarn.lock")) ? "yarn" : "npm";
      const scripts = Object.keys(pkg.scripts || {});
      const pref = ["dev", "start", "serve", "build", "test", "lint", "typecheck", "type-check", "watch"];
      for (const s of [...pref.filter((x) => scripts.includes(x)), ...scripts.filter((x) => !pref.includes(x))].slice(0, 12))
        add((dir ? `${dir}: ` : "") + s, pm === "npm" ? (s === "start" || s === "test" ? `npm ${s}` : `npm run ${s}`) : `${pm} ${s}`, dir, ["build", "lint", "typecheck", "type-check"].includes(s));
      if (fs.existsSync(path.join(abs, "tsconfig.json")) && !scripts.some((x) => /typecheck|type-check/.test(x))) add((dir ? `${dir}: ` : "") + t("type check"), "npx tsc --noEmit -p .", dir, true);
    }
    let ents = []; try { ents = fs.readdirSync(abs); } catch {}
    const sln = ents.find((f) => f.endsWith(".sln")), csproj = ents.find((f) => f.endsWith(".csproj"));
    if (sln || csproj) { add((dir ? `${dir}: ` : "") + "dotnet build", `dotnet build ${sln || csproj}`, dir, true); if (csproj) add((dir ? `${dir}: ` : "") + "dotnet run", "dotnet run", dir); add((dir ? `${dir}: ` : "") + "dotnet test", "dotnet test", dir); }
    if (ents.includes("artisan")) { add("php artisan serve", "php artisan serve", dir); add("php artisan test", "php artisan test", dir); }
    if (ents.includes("composer.json")) { try { const c = JSON.parse(fs.readFileSync(path.join(abs, "composer.json"), "utf8")); for (const s of Object.keys(c.scripts || {}).slice(0, 5)) add(`composer ${s}`, `composer run ${s}`, dir); } catch {} }
    if (ents.includes("project.godot")) add(t("godot (headless test)"), "godot --headless --quit", dir);
    if (ents.includes("manage.py")) add("django runserver", "python manage.py runserver", dir);
    if (ents.includes("pytest.ini") || ents.includes("pyproject.toml")) add("pytest", "python -m pytest", dir);
    return ents;
  };
  const top = scan("");
  // one level of subfolders (frontend/, backend/, src/Api …)
  for (const d of top.slice(0, 60)) {
    if (d.startsWith(".") || ["node_modules", "dist", "build", "bin", "obj", "vendor"].includes(d)) continue;
    try { if (fs.statSync(path.join(cwd, d)).isDirectory() && (fs.existsSync(path.join(cwd, d, "package.json")) || fs.readdirSync(path.join(cwd, d)).some((f) => /\.(csproj|sln)$/.test(f)))) scan(d); } catch {}
  }
  return out.slice(0, 30);
}

// ---------- processes
const URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?[^\s'"<>)]*/i;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, "");
export function start({ team, cwd, cmd, label, dir = "", kind = "cmd", check = false }) {
  const root = path.resolve(cwd); const at = path.resolve(root, dir || ".");
  const rel = path.relative(root, at); if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(t("Folder outside the project"));
  if (!fs.existsSync(at)) throw new Error(t("No such folder: {dir}", { dir }));
  // if the same command is already running do not start it again: stop it first
  for (const r of runs.values()) if (r.team === team && r.cmd === cmd && r.dir === dir && r.status === "running" && kind === "cmd") throw new Error(t("This command is already running"));
  const id = randomUUID().slice(0, 8);
  const env = { ...process.env, FORCE_COLOR: "1", npm_config_color: "always", CI: process.env.CI || "" };
  const child = WIN
    ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${cmd}"`], { cwd: at, env, windowsHide: true, windowsVerbatimArguments: true })
    : spawn("bash", ["-lc", cmd], { cwd: at, env, detached: true });
  const r = { id, team, cmd, label: label || cmd, dir, kind, check, root, at, status: "running", code: null, startedAt: Date.now(), endedAt: null, lines: [], partial: "", url: null, pid: child.pid, child };
  runs.set(id, r);
  const onData = (buf) => {
    const txt = r.partial + buf.toString("utf8");
    const parts = txt.split(/\r?\n/); r.partial = parts.pop();
    if (r.partial.length > 4000) { parts.push(r.partial); r.partial = ""; }
    if (!parts.length) return;
    for (const p of parts) { r.lines.push(p); if (!r.url) { const m = URL_RE.exec(stripAnsi(p)); if (m) { r.url = m[0].replace("0.0.0.0", "localhost"); emit({ type: "run", id, team, status: r.status, url: r.url }); } } }
    if (r.lines.length > MAX_LINES) r.lines.splice(0, r.lines.length - MAX_LINES);
    emit({ type: "run-out", id, team, lines: parts });
  };
  child.stdout.on("data", onData); child.stderr.on("data", onData);
  child.on("error", (e) => { const l = t("[could not start] {message}", { message: e.message }); r.lines.push(l); emit({ type: "run-out", id, team, lines: [l] }); });
  child.on("close", (code, sig) => {
    if (r.partial) { r.lines.push(r.partial); emit({ type: "run-out", id, team, lines: [r.partial] }); r.partial = ""; }
    r.status = "exited"; r.code = code ?? (sig ? -1 : 0); if (r.stopping) r.stopped = true; r.endedAt = Date.now(); r.child = null;
    r.problems = parseProblems(r.lines.join("\n"), root, at);
    emit({ type: "run", id, team, status: r.status, code: r.code, problems: r.problems.length });
  });
  emit({ type: "run", id, team, status: "running", cmd, label: r.label });
  // clean up old, finished runs (last 12 per project)
  const mine = [...runs.values()].filter((x) => x.team === team && x.status !== "running").sort((a, b) => b.startedAt - a.startedAt);
  for (const x of mine.slice(12)) runs.delete(x.id);
  return view(r);
}
export function write(id, text) {
  const r = runs.get(id); if (!r || r.status !== "running" || !r.child) throw new Error(t("No running process"));
  r.child.stdin.on("error", () => {}); r.child.stdin.write(String(text) + (WIN ? "\r\n" : "\n"));
  r.lines.push(`› ${text}`); emit({ type: "run-out", id, team: r.team, lines: [`› ${text}`] });
}
export function stop(id) {
  const r = runs.get(id); if (!r || r.status !== "running") return false;
  r.stopping = true;
  if (!r.pid) { r.status = "exited"; r.code = -1; r.endedAt = Date.now(); return true; }
  if (WIN) execFile("taskkill", ["/pid", String(r.pid), "/T", "/F"], { windowsHide: true }, () => {});
  else { try { process.kill(-r.pid, "SIGTERM"); } catch {} setTimeout(() => { try { process.kill(-r.pid, "SIGKILL"); } catch {} }, 3000); }
  return true;
}
export function remove(id) { const r = runs.get(id); if (r && r.status === "running") stop(id); runs.delete(id); }
export function stopAll() { for (const r of runs.values()) if (r.status === "running") stop(r.id); }
const view = (r, withLines = false) => ({ id: r.id, stopped: !!r.stopped, team: r.team, cmd: r.cmd, label: r.label, dir: r.dir, kind: r.kind, check: r.check, status: r.status, code: r.code, startedAt: r.startedAt, endedAt: r.endedAt, url: r.url,
  problems: r.problems?.length, ...(withLines ? { lines: r.lines } : {}) });
export const list = (team) => [...runs.values()].filter((r) => r.team === team).sort((a, b) => b.startedAt - a.startedAt).map((r) => view(r));
export const get = (id) => { const r = runs.get(id); return r ? view(r, true) : null; };
export const runningCount = (team) => [...runs.values()].filter((r) => r.team === team && r.status === "running").length;

// ---------- Problems: turn compiler/lint output into a file:line list
export function problemsFor(team) {
  // the latest check run of each command
  const latest = new Map();
  for (const r of [...runs.values()].filter((x) => x.team === team && x.kind === "cmd").sort((a, b) => a.startedAt - b.startedAt)) latest.set(r.cmd + "|" + r.dir, r);
  return [...latest.values()].map((r) => {
    const items = r.status === "running" ? parseProblems(r.lines.join("\n"), r.root, r.at) : r.problems || [];
    return { run: r.id, label: r.label, cmd: r.cmd, code: r.code, status: r.status, at: r.endedAt || r.startedAt, items };
  }).filter((g) => g.items.length || g.status === "exited");
}
const SEV = (s) => (/warn|uyar/i.test(s) ? "warning" : /info|hint|note/i.test(s) ? "info" : "error");
export function parseProblems(text, root, at = root) {
  const out = []; const seen = new Set();
  const norm = (f) => {
    f = f.trim().replace(/^file:\/\//, "");
    if (/["'`<>|]|^>/.test(f)) return null; // command echo (npm "> node -e ...") etc.
    const abs = path.isAbsolute(f) ? f : path.resolve(at, f);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.startsWith("..") || !fs.existsSync(abs)) return null; // only files that really exist in the project
    return rel;
  };
  const push = (f, line, col, sev, msg, code) => {
    const file = norm(f); if (!file) return;
    const k = `${file}:${line}:${col}:${msg}`; if (seen.has(k)) return; seen.add(k);
    out.push({ file, line: +line || 1, col: +col || 1, severity: SEV(sev || "error"), message: String(msg).trim().slice(0, 500), code: code || "" });
  };
  const lines = stripAnsi(text).split(/\r?\n/).filter((l) => !/^\s*>\s/.test(l)); // npm script echoes
  let eslintFile = null;
  for (const l of lines) {
    let m;
    // MSBuild / dotnet / tsc (old): path(line,col): error CS0103: message [project]
    if ((m = /^\s*(.+?)\((\d+),(\d+)(?:,\d+,\d+)?\):\s*(error|warning|info)\s+([A-Z]+\d+)?\s*:?\s*(.+?)(?:\s+\[[^\]]+\])?$/i.exec(l))) { push(m[1], m[2], m[3], m[4], m[6], m[5]); eslintFile = null; continue; }
    // tsc / Angular / Vite: path:line:col - error TS2322: message
    if ((m = /^\s*(?:Error:\s*|ERROR\s+(?:in\s+)?)?(.+?\.\w+):(\d+):(\d+)\s*-\s*(error|warning)\s*([A-Z]+\d+)?:?\s*(.+)$/i.exec(l))) { push(m[1], m[2], m[3], m[4], m[6], m[5]); continue; }
    // gcc style / eslint unix: path:line:col: error: message
    if ((m = /^\s*([^\s:][^:]*?\.\w+):(\d+):(\d+):\s*(?:(error|warning|note)\s*:?\s*)?(.+)$/i.exec(l)) && !/^https?$/i.test(m[1])) { push(m[1], m[2], m[3], m[4] || (/warning/i.test(m[5]) ? "warning" : "error"), m[5]); continue; }
    // PHP: PHP Parse error: message in /path/file.php on line 12
    if ((m = /(?:PHP\s+)?(Parse error|Fatal error|Warning|Notice)\s*:\s*(.+?)\s+in\s+(.+?\.php)\s+on line\s+(\d+)/i.exec(l))) { push(m[3], m[4], 1, m[1], m[2]); continue; }
    // ESLint "stylish": the file line first, then "  12:5  error  message  rule"
    if (/^(?:[A-Za-z]:)?[\\/][^:]+\.\w+$/.test(l.trim()) || /^[\w./\\-]+\.(?:[jt]sx?|vue|mjs|cjs)$/.test(l.trim())) { eslintFile = l.trim(); continue; }
    if (eslintFile && (m = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}([\w@/-]+))?$/.exec(l))) { push(eslintFile, m[1], m[2], m[3], m[4], m[5]); continue; }
    if (!l.trim()) eslintFile = null;
  }
  return out.slice(0, 1000);
}
export function summary() { const o = {}; for (const r of runs.values()) if (r.status === "running") o[r.team] = (o[r.team] || 0) + 1; return o; }
