// Checkpoint: stores a snapshot of the project with git before and after a task.
// It does NOT touch the user's branch, index or working tree: `git add -A` + `write-tree` run with a
// temporary index file, and the result is kept as a commit under refs/ecelon/ (so git gc does not
// delete it). Revert writes back only the files that changed in that task.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { t } from "./i18n.js";
import { gitArgs } from "./gitsafe.js";
import { resolveIn } from "./files.js";

const run = (cwd, args, { env, buffer = false, input } = {}) => new Promise((resolve, reject) => {
  const p = execFile("git", gitArgs(args), { cwd, env: { ...process.env, ...env }, encoding: buffer ? "buffer" : "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
    if (err) { err.stderr = String(stderr || ""); return reject(err); }
    resolve(stdout);
  });
  if (input !== undefined) { p.stdin.on("error", () => {}); p.stdin.end(input); }
});

const repoCache = new Map();
export async function isRepo(cwd) {
  const k = path.resolve(cwd);
  if (repoCache.has(k)) return repoCache.get(k);
  let ok = false;
  try { ok = (await run(cwd, ["rev-parse", "--is-inside-work-tree"])).trim() === "true"; } catch {}
  repoCache.set(k, ok); setTimeout(() => repoCache.delete(k), 60000);
  return ok;
}

// The whole working tree (untracked files included, .gitignore excluded) → commit id
export async function snapshot(cwd, label = "ecelon") {
  if (!(await isRepo(cwd))) return null;
  const idx = path.join(os.tmpdir(), `ecelon-idx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const env = { GIT_INDEX_FILE: idx };
  try {
    // start the index from HEAD if there is one (speed), otherwise empty
    let head = null;
    try { head = (await run(cwd, ["rev-parse", "--verify", "-q", "HEAD"])).trim() || null; } catch {}
    if (head) await run(cwd, ["read-tree", head], { env });
    await run(cwd, ["add", "-A", "--", "."], { env });
    const tree = (await run(cwd, ["write-tree"], { env })).trim();
    const args = ["commit-tree", tree, "-m", label];
    if (head) args.splice(2, 0, "-p", head);
    const commit = (await run(cwd, args, { env: { GIT_AUTHOR_NAME: "Ecelon Station", GIT_AUTHOR_EMAIL: "station@ecelon.local", GIT_COMMITTER_NAME: "Ecelon Station", GIT_COMMITTER_EMAIL: "station@ecelon.local" } })).trim();
    await run(cwd, ["update-ref", `refs/ecelon/cp/${commit}`, commit]);
    pruneRefs(cwd).catch(() => {});
    return commit;
  } catch (e) { console.warn("checkpoint could not be taken:", cwd, e.stderr || e.message); return null; }
  finally { fs.rm(idx, { force: true }, () => {}); }
}

// Files between two checkpoints: [{ status: A|M|D|R, path, from?, add, del }]
export async function changes(cwd, a, b) {
  const ns = await run(cwd, ["diff", "--name-status", "-M", "-z", a, b]);
  const parts = ns.split("\0").filter(Boolean); const files = [];
  for (let i = 0; i < parts.length; ) {
    const st = parts[i++];
    if (st[0] === "R" || st[0] === "C") files.push({ status: "R", from: parts[i++], path: parts[i++] });
    else files.push({ status: st[0], path: parts[i++] });
  }
  if (!files.length) return files;
  const num = await run(cwd, ["diff", "--numstat", "-M", "-z", a, b]);
  // numstat -z: "add\tdel\tpath\0" or, for a rename, "add\tdel\t\0from\0to\0"
  const toks = num.split("\0"); const stats = new Map();
  for (let i = 0; i < toks.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(toks[i]); if (!m) continue;
    let p = m[3]; if (!p) { i += 2; p = toks[i]; }
    stats.set(p, { add: m[1] === "-" ? null : +m[1], del: m[2] === "-" ? null : +m[2] });
  }
  for (const f of files) Object.assign(f, stats.get(f.path) || { add: null, del: null });
  return files;
}

export const fileDiff = (cwd, a, b, p) => run(cwd, ["diff", "-M", "--no-color", "-U3", a, b, "--", p]);

// Go back to a (only the files changed between a..b). If a file changed again in between, `force` is required.
export async function revert(cwd, a, b, { force = false } = {}) {
  const files = await changes(cwd, a, b);
  if (!force) {
    const now = await snapshot(cwd, t("ecelon revert check"));
    if (now) {
      const later = new Set((await changes(cwd, b, now)).flatMap((f) => [f.path, f.from].filter(Boolean)));
      const clash = files.filter((f) => later.has(f.path) || (f.from && later.has(f.from))).map((f) => f.path);
      if (clash.length) return { conflict: clash };
    }
  }
  const root = (await run(cwd, ["rev-parse", "--show-toplevel"])).trim();
  const abs = (p) => resolveIn(root, p).abs; // a link inside the tree must not lead the write/delete out of the repository
  for (const f of files) {
    if (f.status === "A") { fs.rmSync(abs(f.path), { force: true }); pruneDirs(root, path.dirname(abs(f.path))); continue; }
    if (f.status === "R") { fs.rmSync(abs(f.path), { force: true }); }
    const src = f.status === "R" ? f.from : f.path;
    const blob = await run(cwd, ["show", `${a}:${src}`], { buffer: true });
    fs.mkdirSync(path.dirname(abs(src)), { recursive: true });
    fs.writeFileSync(abs(src), blob);
  }
  return { reverted: files.length };
}

// also remove folders left empty after added files are deleted (up to the project root)
function pruneDirs(root, dir) {
  while (dir.startsWith(root) && dir !== root) {
    try { if (fs.readdirSync(dir).length) return; fs.rmdirSync(dir); } catch { return; }
    dir = path.dirname(dir);
  }
}

export async function initRepo(cwd) {
  await run(cwd, ["init"]);
  repoCache.delete(path.resolve(cwd));
  return true;
}

// Prune old checkpoint refs: the newest 60 or those younger than 14 days stay (otherwise .git grows without bound)
const pruneAt = new Map();
export async function pruneRefs(cwd, { keep = 60, days = 14 } = {}) {
  const k = path.resolve(cwd); if (Date.now() - (pruneAt.get(k) || 0) < 3600e3) return; pruneAt.set(k, Date.now());
  const out = await run(cwd, ["for-each-ref", "--format=%(refname) %(committerdate:unix)", "refs/ecelon/cp/"]).catch(() => "");
  const refs = out.split("\n").filter(Boolean).map((l) => { const [ref, at] = l.split(" "); return { ref, at: +at * 1000 }; }).sort((a, b) => b.at - a.at);
  const cutoff = Date.now() - days * 864e5;
  const drop = refs.filter((r, i) => i >= keep && r.at < cutoff);
  for (const r of drop) await run(cwd, ["update-ref", "-d", r.ref]).catch(() => {});
  if (drop.length) await run(cwd, ["gc", "--auto", "--quiet"]).catch(() => {});
}
