// Converting PDF, PowerPoint, old Excel (.xls) and EPUB to markdown with Microsoft MarkItDown (MIT).
// Optional: used if Python 3.10+ and the `markitdown` package are on the computer, otherwise the
// library works as before (we have our own extractor for Word/Excel, agents can already read PDFs).
import { execFile, spawn } from "node:child_process";
import { t } from "./i18n.js";

const CANDIDATES = process.platform === "win32"
  ? [["py", ["-3"]], ["python", []], ["python3", []]]
  : [["python3", []], ["python", []]];
const PROBE = "import sys; print('PY', '%d.%d' % sys.version_info[:2]);\ntry:\n import markitdown; print('MD', markitdown.__version__)\nexcept Exception: print('MD -')";
export const MD_EXT = new Set(["pdf", "pptx", "xls", "epub"]);
const ENV = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };

let state = { checked: false, python: null, pyVersion: null, markitdown: null, cmd: null, installing: false, log: [] };
const exec = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { env: ENV, windowsHide: true, timeout: 20000, maxBuffer: 64 * 1024 * 1024, encoding: "utf8", ...opts }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || "") }));
});

export async function detect(force = false) {
  if (state.checked && !force) return status();
  Object.assign(state, { python: null, pyVersion: null, markitdown: null, cmd: null });
  for (const [cmd, pre] of CANDIDATES) {
    const r = await exec(cmd, [...pre, "-c", PROBE]);
    if (r.err) continue;
    const py = /PY (\d+)\.(\d+)/.exec(r.stdout); if (!py) continue;
    // "python" on Windows is sometimes a stub that redirects to the Microsoft Store; skip it if there is no output
    state.python = cmd; state.pyVersion = `${py[1]}.${py[2]}`; state.cmd = [cmd, pre];
    const md = /MD (\S+)/.exec(r.stdout); state.markitdown = md && md[1] !== "-" ? md[1] : null;
    if (+py[1] > 3 || (+py[1] === 3 && +py[2] >= 10)) break;
  }
  state.checked = true;
  return status();
}
export const ready = () => !!state.markitdown;
export function status() {
  const ok = state.pyVersion && (() => { const [a, b] = state.pyVersion.split(".").map(Number); return a > 3 || (a === 3 && b >= 10); })();
  return { checked: state.checked, python: state.pyVersion, pythonOk: !!ok, markitdown: state.markitdown, installing: state.installing, log: state.log.slice(-12) };
}

export async function convert(file) {
  if (!state.markitdown) return null;
  const [cmd, pre] = state.cmd;
  const r = await exec(cmd, [...pre, "-m", "markitdown", file], { timeout: 180000 });
  if (r.err) throw new Error((r.stderr || r.err.message).split("\n").filter(Boolean).slice(-2).join(" "));
  return r.stdout;
}

// In-app installation: into the user account (no administrator rights needed)
export function install(onLine) {
  if (state.installing) return Promise.resolve(false);
  if (!state.cmd) return Promise.reject(new Error(t("Python not found")));
  state.installing = true; state.log = [];
  const [cmd, pre] = state.cmd;
  return new Promise((resolve) => {
    const p = spawn(cmd, [...pre, "-m", "pip", "install", "--user", "--upgrade", "--disable-pip-version-check", "markitdown[pdf,docx,xlsx,xls,pptx]"], { env: ENV, windowsHide: true });
    const feed = (b) => { for (const l of String(b).split(/\r?\n/).filter(Boolean)) { state.log.push(l.slice(0, 200)); onLine?.(l); } };
    p.stdout.on("data", feed); p.stderr.on("data", feed);
    p.on("error", (e) => { feed(t("Error: {message}", { message: e.message })); });
    p.on("close", async (code) => { state.installing = false; await detect(true); resolve(code === 0 && ready()); });
  });
}
