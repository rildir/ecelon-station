#!/usr/bin/env node
// Ecelon Station launcher — `npx ecelon-station [--demo] [--port 4777] [--lang en] [--no-open]`
// Starts the local server and opens the station in the default browser.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
for (const a of args) if (a.startsWith("-") && !["--help", "-h", "--version", "-v", "--demo", "--port", "--lang", "--data", "--no-open", "--watch"].includes(a)) { console.error(`Unknown option: ${a}\nRun "ecelon-station --help" to see the options.`); process.exit(1); }

if (has("--help") || has("-h")) {
  console.log(`Ecelon Station — a control room for Claude Code agent teams

Usage: ecelon-station [options]

  --demo          start with scripted fake agents (no Claude Code needed) and three sample projects
  --port <n>      port to listen on (default 4777, always 127.0.0.1 only)
  --lang <code>   UI language: en (default) or tr — can be changed later from the top bar
  --data <dir>    where to keep projects, requirements and the document library
  --no-open       do not open the browser
  --watch         restart the server when its files change (development)
  --version       print the version

Requires Node.js 20+ and, outside demo mode, Claude Code (\`claude --version\` must work).`);
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (has("--version") || has("-v")) {
  const { readFileSync } = await import("node:fs");
  console.log(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version); process.exit(0);
}
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) { console.error(`Ecelon Station needs Node.js 20 or newer (you have ${process.versions.node}).`); process.exit(1); }

const port = Number(val("--port", process.env.PORT || 4777));
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error(`Invalid port: ${val("--port", process.env.PORT)}. Use a number between 1 and 65535.`); process.exit(1); }
if (val("--lang") && !["en", "tr"].includes(val("--lang"))) { console.error(`Unsupported language: ${val("--lang")}. Available: en, tr.`); process.exit(1); }
const env = { ...process.env, PORT: String(port) };
if (has("--demo")) { env.MOCK = "1"; env.ECELON_DEMO = "1"; }
if (val("--lang")) env.ECELON_LANG = val("--lang");
if (val("--data")) env.ECELON_DATA = path.resolve(val("--data"));

const nodeArgs = has("--watch") ? ["--watch", path.join(root, "server", "index.js")] : [path.join(root, "server", "index.js")];
const child = spawn(process.execPath, nodeArgs, { env, stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { try { child.kill(sig); } catch {} });

// open the browser once the server answers
const url = `http://127.0.0.1:${port}/`;
if (!has("--no-open")) {
  const t0 = Date.now();
  const poll = () => {
    if (child.exitCode !== null) return;
    http.get(`${url}api/meta`, (res) => { res.resume(); if (res.statusCode === 200) openBrowser(url); else retry(); }).on("error", retry);
  };
  const retry = () => { if (Date.now() - t0 < 30000) setTimeout(poll, 400); };
  setTimeout(poll, 600);
}
function openBrowser(u) {
  console.log(`Opening ${u} in your browser (if nothing happens, open that address yourself)`);
  const [cmd, a] = process.platform === "win32" ? ["cmd", ["/c", "start", "", u]] : process.platform === "darwin" ? ["open", [u]] : ["xdg-open", [u]];
  try { spawn(cmd, a, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch {}
}
