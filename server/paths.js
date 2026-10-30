// Where things live on disk. The server never relies on the current working directory, so
// the data folder also works when started from another directory.
//   ROOT   – the package (repo) folder: public/, server/, node_modules/
//   DATA   – agents, requirements, library, uploads… When running from a clone it is <ROOT>/data
//            (so an existing installation keeps its files); when installed as an npm package it is
//            ~/.ecelon-station. ECELON_DATA overrides both.
//   LOGS   – chat logs: <ROOT>/logs for a clone, <DATA>/logs otherwise.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installed = /[\\/]node_modules[\\/]/.test(ROOT);
export const DATA = path.resolve(process.env.ECELON_DATA || (installed ? path.join(os.homedir(), ".ecelon-station") : path.join(ROOT, "data")));
export const LOGS = process.env.ECELON_DATA || installed ? path.join(DATA, "logs") : path.join(ROOT, "logs");
export const PUBLIC = path.join(ROOT, "public");
export const dataPath = (...p) => path.join(DATA, ...p);
export const rootPath = (...p) => path.join(ROOT, ...p);

/** Folder of an installed npm package (works when the package is hoisted to a parent node_modules). */
const require_ = createRequire(import.meta.url);
export function pkgDir(name) {
  try { return path.dirname(require_.resolve(`${name}/package.json`)); }
  catch { return path.join(ROOT, "node_modules", name); }
}

// Local data (projects, chat logs, MCP tokens, documents) is for this OS user only: folders 0700, files 0600.
// Modes only take effect on POSIX; on Windows the calls are harmless no-ops.
export function mkdirPrivate(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (path.resolve(dir) !== DATA) { try { fs.chmodSync(dir, 0o700); } catch {} } // tighten a folder an older version created
}
export function writePrivate(file, data) {
  fs.writeFileSync(file, data, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {} // the mode of writeFileSync applies to new files only
}
export function ensureDirs() { for (const d of [DATA, LOGS]) mkdirPrivate(d); }
