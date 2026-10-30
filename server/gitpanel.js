// Git panel: the counterpart of Source Control in VS Code. Status, diff, stage/unstage/discard,
// commit, push/pull/fetch, history. Commands run with the user's own git and identity.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { t } from "./i18n.js";
import { gitArgs } from "./gitsafe.js";
import { resolveIn } from "./files.js";

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };
const git = (cwd, args, { timeout = 30000, input } = {}) => new Promise((resolve, reject) => {
  const p = execFile("git", gitArgs(args), { cwd, env: ENV, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true }, (err, stdout, stderr) => {
    if (err) { const e = new Error(String(stderr || err.message).trim().split("\n").slice(-6).join("\n")); e.code = err.code; return reject(e); }
    resolve(stdout);
  });
  if (input !== undefined) { p.stdin.on("error", () => {}); p.stdin.end(input); }
});

// A repository-local core.sshCommand is attacker-controlled; for network commands replace it with plain ssh
// (the user's global/system value and GIT_SSH_COMMAND keep working).
async function sshGuard(cwd) {
  try { const o = await git(cwd, ["config", "--show-scope", "--get", "core.sshCommand"]); if (/^(local|worktree)\s/.test(o)) return ["-c", "core.sshCommand=ssh"]; } catch {}
  return [];
}
const XY = { M: "M", A: "A", D: "D", R: "R", C: "R", T: "M", U: "U" };
export async function status(cwd) {
  const out = await git(cwd, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]);
  const parts = out.split("\0");
  const res = { branch: null, upstream: null, ahead: 0, behind: 0, staged: [], changes: [], conflicts: [] };
  for (let i = 0; i < parts.length; i++) {
    const l = parts[i]; if (!l) continue;
    if (l.startsWith("# branch.head ")) res.branch = l.slice(14);
    else if (l.startsWith("# branch.upstream ")) res.upstream = l.slice(18);
    else if (l.startsWith("# branch.ab ")) { const m = /\+(\d+) -(\d+)/.exec(l); if (m) { res.ahead = +m[1]; res.behind = +m[2]; } }
    else if (l[0] === "1" || l[0] === "2") {
      const f = l.split(" "); const xy = f[1];
      const p = l[0] === "1" ? f.slice(8).join(" ") : f.slice(9).join(" ");
      const from = l[0] === "2" ? parts[++i] : null;
      if (xy[0] !== ".") res.staged.push({ path: p, from, st: XY[xy[0]] || xy[0] });
      if (xy[1] !== ".") res.changes.push({ path: p, st: XY[xy[1]] || xy[1] });
    } else if (l[0] === "u") res.conflicts.push({ path: l.split(" ").slice(10).join(" "), st: "U" });
    else if (l[0] === "?") res.changes.push({ path: l.slice(2), st: "U?", untracked: true });
  }
  if (res.branch === "(detached)") res.branch = null;
  return res;
}

export async function summary(cwd) {
  try { const s = await status(cwd); return { ok: true, branch: s.branch, ahead: s.ahead, behind: s.behind, changed: s.staged.length + s.changes.length + s.conflicts.length, upstream: !!s.upstream }; }
  catch { return { ok: false }; }
}

// every request path goes through the shared symlink-aware check (files.js resolveIn)
const safePath = (cwd, p) => { resolveIn(cwd, p); return p; };
const paths = (cwd, list) => (Array.isArray(list) ? list : []).map(String).filter(Boolean).slice(0, 2000).map((p) => safePath(cwd, p));

export async function diff(cwd, p, { staged = false, untracked = false } = {}) {
  const { abs } = resolveIn(cwd, p);
  if (untracked) {
    const st = fs.statSync(abs);
    if (st.size > 2e6) return t("(large file: {kb} KB)", { kb: Math.round(st.size / 1024) });
    const buf = fs.readFileSync(abs); if (buf.includes(0)) return t("(binary file)");
    return t("@@ new file @@") + "\n" + buf.toString("utf8").split(/\r?\n/).map((l) => "+" + l).join("\n");
  }
  return git(cwd, ["diff", "--no-color", "-M", ...(staged ? ["--cached"] : []), "--", p]);
}
export const stage = (cwd, list) => git(cwd, ["add", "-A", "--", ...paths(cwd, list)]);
export const stageAll = (cwd) => git(cwd, ["add", "-A"]);
export const unstage = async (cwd, list) => {
  const ps = paths(cwd, list);
  try { await git(cwd, ["restore", "--staged", "--", ...ps]); } catch { await git(cwd, ["reset", "-q", "HEAD", "--", ...ps]); } // before the first commit
};
export async function discard(cwd, list, untracked = []) {
  const tracked = paths(cwd, list); const fresh = paths(cwd, untracked);
  if (tracked.length) await git(cwd, ["restore", "--worktree", "--", ...tracked]);
  for (const p of fresh) fs.rmSync(resolveIn(cwd, p).abs, { force: true });
}
export async function commit(cwd, message, { all = false } = {}) {
  message = String(message || "").trim(); if (!message) throw new Error(t("The commit message is empty"));
  if (all) await stageAll(cwd);
  const out = await git(cwd, ["commit", "-F", "-"], { input: message });
  return out.split("\n")[0];
}
export async function push(cwd) {
  const s = await status(cwd);
  if (!s.branch) throw new Error(t("You are not on a branch (detached HEAD)"));
  const args = s.upstream ? ["push"] : ["push", "-u", "origin", s.branch];
  await git(cwd, [...(await sshGuard(cwd)), ...args], { timeout: 180000 });
  return s.upstream ? t("Pushed") : t("Pushed; branch {branch} is now tracking origin", { branch: s.branch });
}
export const pull = async (cwd) => git(cwd, [...(await sshGuard(cwd)), "pull", "--ff-only"], { timeout: 180000 });
export const fetch = async (cwd) => git(cwd, [...(await sshGuard(cwd)), "fetch", "--prune"], { timeout: 180000 });

export async function log(cwd, n = 40) {
  let out = "";
  try { out = await git(cwd, ["log", `-n${n}`, "--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e"]); } catch { return []; } // no commits yet
  let unpushed = new Set();
  try { unpushed = new Set((await git(cwd, ["rev-list", "@{u}..HEAD"])).split("\n").filter(Boolean)); } catch {}
  return out.split("\x1e").map((r) => r.trim()).filter(Boolean).map((r) => { const [sha, short, author, at, subject] = r.split("\x1f"); return { sha, short, author, at: +at * 1000, subject, unpushed: unpushed.has(sha) }; });
}
export async function show(cwd, sha, p) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error(t("Invalid commit"));
  if (p) return git(cwd, ["show", "--no-color", "-M", "--format=", sha, "--", safePath(cwd, p)]);
  const out = await git(cwd, ["show", "--name-status", "-M", "--format=%B", sha]);
  const lines = out.split("\n"); const files = []; const body = [];
  for (const l of lines) { const m = /^([AMDRCTU])\d*\t([^\t]+)(?:\t(.+))?$/.exec(l); if (m) files.push({ st: m[1] === "C" ? "R" : m[1], path: m[3] || m[2], from: m[3] ? m[2] : null }); else if (!files.length) body.push(l); }
  return { message: body.join("\n").trim(), files };
}
// Summary of the changes for the commit message suggestion (staged ones; otherwise all)
export async function changesForMessage(cwd) {
  const s = await status(cwd);
  const staged = s.staged.length > 0;
  const stat = await git(cwd, ["diff", "--stat", ...(staged ? ["--cached"] : [])]).catch(() => "");
  let d = await git(cwd, ["diff", "--no-color", "-U2", ...(staged ? ["--cached"] : [])]).catch(() => "");
  if (d.length > 12000) d = d.slice(0, 12000) + "\n" + t("… (truncated)");
  const fresh = staged ? [] : s.changes.filter((c) => c.untracked).map((c) => c.path);
  return { staged, stat, diff: d, untracked: fresh, files: (staged ? s.staged : s.changes).map((f) => f.path) };
}

// ---------- branches
const validRef = (n) => { n = String(n || "").trim(); if (!n || /[\s~^:?*[\\]|\.\.|@\{|^-|\/$|\.lock$|^\.|\/\./.test(n)) throw new Error(t("Invalid branch name (do not use spaces or ~ ^ : ? * [ \\)")); return n; };
export async function branches(cwd) {
  const out = await git(cwd, ["for-each-ref", "--format=%(refname)%1f%(refname:short)%1f%(objectname:short)%1f%(committerdate:unix)%1f%(upstream:short)%1f%(upstream:track)%1f%(subject)", "refs/heads", "refs/remotes"]);
  const s = await status(cwd).catch(() => ({}));
  const list = out.split("\n").filter(Boolean).map((l) => { const [ref, name, sha, at, up, track, subject] = l.split("\x1f"); return { remote: ref.startsWith("refs/remotes/"), name, sha, at: +at * 1000, upstream: up, track, subject }; })
    .filter((b) => !(b.remote && /\/HEAD$/.test(b.name)));
  return { current: s.branch || null, local: list.filter((b) => !b.remote).sort((a, b) => b.at - a.at), remote: list.filter((b) => b.remote).sort((a, b) => b.at - a.at), merging: mergeState(cwd) };
}
export async function checkout(cwd, name, { create = false, from = "" } = {}) {
  name = validRef(name);
  if (create) await git(cwd, ["switch", "-c", name, ...(from ? [validRef(from)] : [])]);
  else if (/^[^/]+\/.+/.test(name) && !(await git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]).catch(() => ""))) {
    // remote branch (origin/x) → create a local tracking branch
    const local = name.replace(/^[^/]+\//, "");
    await git(cwd, ["switch", "--track", "-c", local, name]).catch(async () => git(cwd, ["switch", local]));
  } else await git(cwd, ["switch", name]);
  return { ok: true };
}
export async function deleteBranch(cwd, name, force = false) { await git(cwd, ["branch", force ? "-D" : "-d", validRef(name)]); return { ok: true }; }
// Merge: on conflict return a state instead of an error
export async function merge(cwd, name) {
  try { const out = await git(cwd, ["merge", "--no-edit", validRef(name)], { timeout: 120000 }); return { ok: true, message: /Already up to date/i.test(out) ? t("Already up to date") : t("Merged") }; }
  catch (e) { if (mergeState(cwd)) return { ok: false, conflicts: true, message: t("There are conflicts; resolve the files one by one") }; throw e; }
}
export async function pullMerge(cwd) {
  try { await git(cwd, [...(await sshGuard(cwd)), "pull", "--no-rebase", "--no-edit"], { timeout: 180000 }); return { ok: true }; }
  catch (e) { if (mergeState(cwd)) return { ok: false, conflicts: true, message: t("Conflicts came up while pulling; resolve the files one by one") }; throw e; }
}
export function mergeState(cwd) {
  const g = path.join(cwd, ".git");
  if (fs.existsSync(path.join(g, "MERGE_HEAD"))) { let msg = ""; try { msg = fs.readFileSync(path.join(g, "MERGE_MSG"), "utf8").split("\n")[0]; } catch {} return { kind: "merge", message: msg }; }
  if (fs.existsSync(path.join(g, "rebase-merge")) || fs.existsSync(path.join(g, "rebase-apply"))) return { kind: "rebase" };
  if (fs.existsSync(path.join(g, "CHERRY_PICK_HEAD"))) return { kind: "cherry-pick" };
  return null;
}
export async function mergeAbort(cwd) {
  const st = mergeState(cwd);
  if (st?.kind === "rebase") await git(cwd, ["rebase", "--abort"]);
  else if (st?.kind === "cherry-pick") await git(cwd, ["cherry-pick", "--abort"]);
  else await git(cwd, ["merge", "--abort"]);
  return { ok: true };
}
export async function mergeContinue(cwd) {
  const s = await status(cwd);
  if (s.conflicts.length) throw new Error(t("{n} {n|file|files} have unresolved conflicts", { n: s.conflicts.length }));
  const st = mergeState(cwd);
  if (st?.kind === "rebase") await git(cwd, ["-c", "core.editor=true", "rebase", "--continue"]);
  else await git(cwd, ["commit", "--no-edit"]);
  return { ok: true };
}
// Conflicted file: marked parts (<<<<<<< / ======= / >>>>>>>)
export function conflictFile(cwd, p) {
  const text = fs.readFileSync(resolveIn(cwd, p).abs, "utf8");
  const lines = text.split(/\r?\n/); const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const parts = []; let i = 0, buf = [];
  while (i < lines.length) {
    if (lines[i].startsWith("<<<<<<<")) {
      if (buf.length) parts.push({ type: "text", lines: buf }), (buf = []);
      const oursLabel = lines[i].slice(7).trim(); const ours = [], base = [], theirs = []; let mode = "ours", theirsLabel = ""; i++;
      while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
        if (lines[i].startsWith("|||||||")) mode = "base"; else if (lines[i] === "=======" || lines[i].startsWith("======= ")) mode = "theirs";
        else (mode === "ours" ? ours : mode === "base" ? base : theirs).push(lines[i]);
        i++;
      }
      theirsLabel = (lines[i] || "").slice(7).trim(); i++;
      parts.push({ type: "conflict", ours, theirs, base, oursLabel, theirsLabel });
    } else { buf.push(lines[i]); i++; }
  }
  if (buf.length) parts.push({ type: "text", lines: buf });
  return { path: p, eol, parts, count: parts.filter((x) => x.type === "conflict").length };
}
// choices: for each conflict "ours" | "theirs" | "both" | "both-rev" | { custom: "text" }
export async function resolveFile(cwd, p, choices, { stage: doStage = true } = {}) {
  const f = conflictFile(cwd, p); let k = 0; const out = [];
  for (const part of f.parts) {
    if (part.type === "text") { out.push(...part.lines); continue; }
    const c = choices[k++];
    if (c === "ours") out.push(...part.ours); else if (c === "theirs") out.push(...part.theirs);
    else if (c === "both") out.push(...part.ours, ...part.theirs); else if (c === "both-rev") out.push(...part.theirs, ...part.ours);
    else if (c && typeof c.custom === "string") out.push(...c.custom.split(/\r?\n/));
    else throw new Error(t("No choice was made for conflict {n}", { n: k }));
  }
  fs.writeFileSync(resolveIn(cwd, p).abs, out.join(f.eol));
  if (doStage) await git(cwd, ["add", "--", p]);
  return { ok: true };
}
export async function resolveWhole(cwd, p, side) {
  safePath(cwd, p);
  await git(cwd, ["checkout", side === "theirs" ? "--theirs" : "--ours", "--", p]);
  await git(cwd, ["add", "--", p]);
  return { ok: true };
}
