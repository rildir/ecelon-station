// Runs every tests/**/*.test.mjs with the built-in runner. Node 20's `--test` does not expand globs
// (added in Node 21), so the files are listed here and work the same on Node 20, 22 and later.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".test.mjs") ? [path.join(dir, e.name)] : []);

const files = walk(path.join(root, "tests")).sort();
if (!files.length) { console.error("no test files found under tests/"); process.exit(1); }
const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { stdio: "inherit", cwd: root });
process.exit(r.status ?? 1);
