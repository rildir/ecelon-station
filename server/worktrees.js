// Isolated tasks: a task can run in its own git worktree, on its own branch, so that several agents can work on
// one project at the same time without writing over each other. The worktree lives in the station's data folder
// (data/worktrees/<team>/<task>), never inside the user's project. When the work is done the user looks at the
// diff and either merges the branch into the branch the project is on, or throws it away.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { t } from "./i18n.js";
import { gitArgs } from "./gitsafe.js";
import { dataPath } from "./paths.js";

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
const git = (cwd, args, { timeout = 60000 } = {}) => new Promise((resolve, reject) => {
  execFile("git", gitArgs(args), { cwd, env: ENV, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true }, (err, stdout, stderr) => {
    if (err) { const e = new Error(String([stderr, stdout].filter((x) => String(x || "").trim()).join("\n") || err.message).trim().split("\n").slice(-8).join("\n")); e.code = err.code; return reject(e); } // a merge conflict is reported on stdout
    resolve(stdout);
  });
});
const safe = (s) => String(s).replace(/[^\w-]/g, "");
export const branchFor = (taskId) => "ecelon/" + safe(taskId).toLowerCase();
const MAX_DIFF = 400000;

// The repository the project folder belongs to, and where the project sits inside it (a project can be a subfolder)
async function repoOf(cwd) {
  let top;
  try { top = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim(); } catch { throw new Error(t("This project is not a git repository")); }
  try { await git(top, ["rev-parse", "--verify", "HEAD"]); } catch { throw new Error(t("The repository has no commit yet; make a first commit, then start the task again.")); }
  const rel = path.relative(fs.realpathSync.native(top), fs.realpathSync.native(cwd)); // .native: the JS version keeps Windows 8.3 short names (RUNNER~1) that git's path does not have
  return { top, rel: rel.startsWith("..") ? "" : rel };
}

/** Make the worktree for a task. Returns what the task keeps: { dir, cwd, branch, base, top }. */
export async function create(projectCwd, team, taskId) {
  const { top, rel } = await repoOf(projectCwd);
  const base = (await git(top, ["rev-parse", "HEAD"])).trim();
  const dir = dataPath("worktrees", safe(team), safe(taskId));
  if (fs.existsSync(dir)) throw new Error(t("This task already has its own copy. Merge or discard it first."));
  let branch = branchFor(taskId), n = 1;
  while (await git(top, ["rev-parse", "--verify", "--quiet", "refs/heads/" + branch]).then(() => true, () => false)) branch = branchFor(taskId) + "-" + ++n;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await git(top, ["worktree", "add", "-b", branch, dir, base], { timeout: 180000 });
  return { dir, cwd: rel ? path.join(dir, rel) : dir, branch, base, top };
}

// Everything the task changed compared with where it started: commits on its branch and what is not committed yet.
// "git add -A" only touches the worktree's own index, never the user's working copy.
async function stageAll(wt) { await git(wt.dir, ["add", "-A"]); }
export async function summary(wt) {
  if (!fs.existsSync(wt.dir)) return { ok: false, missing: true, files: 0, added: 0, removed: 0 };
  await stageAll(wt);
  const out = await git(wt.dir, ["diff", "--cached", "--numstat", wt.base]);
  let files = 0, added = 0, removed = 0;
  for (const l of out.split("\n")) { const m = /^(\d+|-)\t(\d+|-)\t/.exec(l); if (!m) continue; files++; added += +m[1] || 0; removed += +m[2] || 0; }
  return { ok: true, files, added, removed, branch: wt.branch };
}
export async function diff(wt) {
  await stageAll(wt);
  const out = await git(wt.dir, ["diff", "--cached", "--no-color", "-M", wt.base]);
  return out.length > MAX_DIFF ? out.slice(0, MAX_DIFF) + "\n" + t("… (truncated)") : out;
}

/** Commit what is left in the worktree, merge the branch into the project's current branch, then clean up.
 *  A conflict is not left half-done in the user's working copy: the merge is aborted and the branch stays. */
export async function merge(wt, message) {
  await stageAll(wt);
  const pending = (await git(wt.dir, ["diff", "--cached", "--name-only"])).trim();
  if (pending) {
    try { await git(wt.dir, ["commit", "-m", message]); }
    catch (e) { throw new Error(/user\.(email|name)|identity/i.test(e.message) ? t("Git does not know who you are yet. Run git config --global user.name and user.email once, then merge again.") : e.message); }
  }
  const ahead = +(await git(wt.top, ["rev-list", "--count", `${wt.base}..${wt.branch}`])).trim();
  if (!ahead) { await discard(wt); return { ok: true, empty: true, message: t("The task changed nothing; its copy was removed.") }; }
  const into = (await git(wt.top, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  try { await git(wt.top, ["merge", "--no-ff", "--no-edit", "-m", `Merge ${wt.branch}: ${message}`, wt.branch], { timeout: 180000 }); }
  catch (e) {
    try { await git(wt.top, ["merge", "--abort"]); } catch { /* nothing to abort: git refused before starting */ }
    const conflict = /CONFLICT|Automatic merge failed/i.test(e.message), dirty = /would be overwritten|commit your changes or stash/i.test(e.message);
    return { ok: false, conflicts: conflict, message: conflict ? t("The branch conflicts with {into}. It was not merged; it is kept as {branch} so you can merge it from the Git screen.", { into, branch: wt.branch })
      : dirty ? t("Your project has uncommitted changes in the same files. Commit or discard them, then merge again.") : e.message };
  }
  await discard(wt, { keepBranch: false });
  return { ok: true, into, message: t("Merged into {into}", { into }) };
}

export async function discard(wt, { keepBranch = false } = {}) {
  try { await git(wt.top, ["worktree", "remove", "--force", wt.dir]); } catch { /* already gone */ }
  try { fs.rmSync(wt.dir, { recursive: true, force: true }); } catch { /* Windows may hold a file a little longer */ }
  try { await git(wt.top, ["worktree", "prune"]); } catch { /* ignore */ }
  if (!keepBranch) { try { await git(wt.top, ["branch", "-D", wt.branch]); } catch { /* merged branches go with -D too; missing is fine */ } }
  return { ok: true };
}
