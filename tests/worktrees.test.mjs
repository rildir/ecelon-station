// Isolated tasks: a task's own worktree and branch, its diff, merging it back, and a conflict that must not be
// left half-done in the user's working copy.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tempData, rm } from "./_setup.mjs";

// git identity first: server/worktrees.js copies process.env when it loads, and CI runners have no global identity
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "T"; process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "t@t";
const DATA = tempData();
const wt = await import("../server/worktrees.js");
test.after(() => rm(DATA));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
function repo(name) {
  const d = path.join(DATA, "repos", name); fs.mkdirSync(path.join(d, "app"), { recursive: true });
  git(d, "init", "-q", "-b", "main"); fs.writeFileSync(path.join(d, "a.txt"), "one\n"); fs.writeFileSync(path.join(d, "app", "x.js"), "1\n");
  git(d, "add", "-A"); git(d, "commit", "-qm", "init"); return d;
}

test("a task gets its own copy and branch; merging brings the work back and cleans up", async () => {
  const r = repo("ok"), w = await wt.create(r, "team1", "T-001");
  assert.equal(w.branch, "ecelon/t-001"); assert.ok(w.dir.startsWith(DATA)); assert.ok(fs.existsSync(path.join(w.dir, "a.txt")));
  fs.writeFileSync(path.join(w.dir, "new.txt"), "hi\n"); fs.appendFileSync(path.join(w.dir, "a.txt"), "two\n");
  assert.equal(fs.existsSync(path.join(r, "new.txt")), false, "the user's copy is not touched while the task works");
  const s = await wt.summary(w); assert.deepEqual([s.files, s.added, s.removed], [2, 2, 0]);
  assert.match(await wt.diff(w), /new\.txt/);
  const m = await wt.merge(w, "T-001: test"); assert.equal(m.ok, true); assert.equal(m.into, "main");
  assert.equal(fs.readFileSync(path.join(r, "new.txt"), "utf8").replace(/\r\n/g, "\n"), "hi\n"); // git on Windows may check the file out with CRLF
  assert.equal(fs.existsSync(w.dir), false); assert.equal(git(r, "branch", "--list", w.branch), "");
});

test("a project in a subfolder of the repository works in the same subfolder of the copy", async () => {
  const r = repo("sub"), w = await wt.create(path.join(r, "app"), "team2", "T-002");
  assert.equal(w.cwd, path.join(w.dir, "app")); await wt.discard(w);
});

test("a conflict is aborted: the user's copy stays clean and the branch is kept", async () => {
  const r = repo("conflict"), w = await wt.create(r, "team3", "T-003");
  fs.writeFileSync(path.join(w.dir, "a.txt"), "from task\n");
  fs.writeFileSync(path.join(r, "a.txt"), "from main\n"); git(r, "commit", "-qam", "main");
  const m = await wt.merge(w, "T-003: test");
  assert.equal(m.ok, false); assert.equal(m.conflicts, true);
  assert.equal(git(r, "status", "--porcelain"), ""); assert.equal(fs.existsSync(path.join(r, ".git", "MERGE_HEAD")), false);
  assert.notEqual(git(r, "branch", "--list", w.branch), "");
  await wt.discard(w); assert.equal(git(r, "branch", "--list", w.branch), "");
});

test("not a repository, or no commit yet: a clear error, nothing created", async () => {
  const plain = path.join(DATA, "plain"); fs.mkdirSync(plain, { recursive: true });
  await assert.rejects(wt.create(plain, "t", "T-1"));
  const empty = path.join(DATA, "empty"); fs.mkdirSync(empty, { recursive: true }); git(empty, "init", "-q");
  await assert.rejects(wt.create(empty, "t", "T-2"));
});
