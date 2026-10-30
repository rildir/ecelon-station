// Real runner: starts `claude -p` in the project folder, reads the stream-json output
// line by line and turns it into simple events the UI understands.
//
// The prompt text is given over STDIN, not as an argument: on Windows `claude.cmd`
// has to be opened through a shell, and arguments going to the shell have quote-escaping
// trouble; stdin has no such problem.
import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { roleArgs } from "./roles.js";
import { t } from "./i18n.js";
import { dataPath } from "./paths.js";

// On Windows Claude Code may be `claude.exe` (native install), `claude.cmd` (npm) or the version inside
// the desktop app. CLAUDE_BIN is tried first, then PATH, then the known locations.
let _bin;
/** What to tell the user when Claude Code cannot be found (the hint depends on the platform). */
export function claudeMissingHint() {
  return process.platform === "win32"
    ? t("Claude Code not found. Install it (https://docs.claude.com/en/docs/claude-code), or set the path from the `where.exe claude` output in PowerShell as CLAUDE_BIN: set CLAUDE_BIN=C:\\path\\claude.exe&& npm start")
    : t("Claude Code not found. Install it (https://docs.claude.com/en/docs/claude-code), or set its path: CLAUDE_BIN=$(which claude) npm start. You can also try the app without it: npm run demo");
}
export function resolveClaude() {
  if (_bin !== undefined) return _bin;
  const fileOk = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
  if (process.env.CLAUDE_BIN) return (_bin = fileOk(process.env.CLAUDE_BIN) ? process.env.CLAUDE_BIN : null);
  if (process.platform !== "win32") {
    const exec = (f) => { try { return fs.statSync(f).isFile() && (fs.accessSync(f, fs.constants.X_OK), true); } catch { return false; } };
    const home = os.homedir();
    const dirs = [...(process.env.PATH || "").split(":").filter(Boolean), path.join(home, ".local", "bin"), path.join(home, ".claude", "local"),
      path.join(home, ".npm-global", "bin"), "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"];
    for (const d of dirs) { const f = path.join(d, "claude"); if (exec(f)) return (_bin = f); }
    return (_bin = null);
  }
  const exts = [".exe", ".cmd", ".bat"];
  for (const dir of (process.env.PATH || "").split(";").filter(Boolean))
    for (const e of exts) { const f = path.join(dir, "claude" + e); if (fileOk(f)) return (_bin = f); }
  const home = os.homedir();
  const appdata = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const fixed = [
    path.join(home, ".local", "bin", "claude.exe"),
    path.join(appdata, "npm", "claude.cmd"),
    path.join(local, "Programs", "claude", "claude.exe"),
    path.join(local, "Microsoft", "WinGet", "Links", "claude.exe"),
  ];
  for (const f of fixed) if (fileOk(f)) return (_bin = f);
  // The Claude desktop app's embedded version: %APPDATA%\Claude\claude-code\<version>\claude.exe
  for (const root of [path.join(appdata, "Claude", "claude-code"), path.join(local, "Claude", "claude-code")]) {
    try {
      const vers = fs.readdirSync(root).sort().reverse();
      for (const v of vers) { const f = path.join(root, v, "claude.exe"); if (fileOk(f)) return (_bin = f); }
    } catch {}
  }
  return (_bin = null);
}

// On Windows npm's claude.cmd shim opens through cmd.exe: "Stop" kills only cmd, the command line is limited to 8 K,
// quoted arguments break. So the cli.js the shim points to is found and started directly with node (no shell).
let _spawnSpec;
export function spawnSpec() {
  if (_spawnSpec) return _spawnSpec;
  const bin = resolveClaude(); if (!bin) return (_spawnSpec = null);
  if (/\.(cmd|bat)$/i.test(bin)) {
    try {
      const txt = fs.readFileSync(bin, "utf8");
      const m = /%dp0%[\\/]*([^"\r\n]+?\.(?:m?js|cjs))"/i.exec(txt) || /"([^"]+?[\\/]cli\.js)"/i.exec(txt);
      if (m) { const js = path.resolve(path.dirname(bin), m[1].replace(/^[\\/]+/, "")); if (fs.existsSync(js)) return (_spawnSpec = { cmd: process.execPath, pre: [js], shell: false, via: "node " + js }); }
    } catch {}
    return (_spawnSpec = { cmd: `"${bin}"`, pre: [], shell: true, via: bin }); // the old way if it cannot be resolved
  }
  return (_spawnSpec = { cmd: bin, pre: [], shell: false, via: bin });
}
// CLI version (to pick flag support): "2.1.312" → [2,1,312]
let _ver = null, _verP = null;
export function claudeVersion() {
  if (_verP) return _verP;
  _verP = new Promise((resolve) => {
    const sp = spawnSpec(); if (!sp) return resolve(null);
    try {
      const c = spawn(sp.cmd, [...sp.pre, "--version"], { shell: sp.shell, env: childEnv(), windowsHide: true });
      let out = ""; c.stdout.on("data", (d) => (out += d)); c.on("error", () => resolve(null));
      c.on("close", () => { const m = /(\d+)\.(\d+)\.(\d+)/.exec(out); _ver = m ? [+m[1], +m[2], +m[3]] : null; resolve(_ver); });
      setTimeout(() => { try { c.kill(); } catch {} resolve(_ver); }, 15000).unref();
    } catch { resolve(null); }
  });
  return _verP;
}
export const cliInfo = () => ({ bin: resolveClaude(), via: spawnSpec()?.via || null, version: _ver ? _ver.join(".") : null });
const verAtLeast = (a, b, c) => !!_ver && (_ver[0] > a || (_ver[0] === a && (_ver[1] > b || (_ver[1] === b && _ver[2] >= c))));
// If the station was started from a Claude Code session, that session's identity must not pass to the child
function childEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === "CLAUDECODE" || /^CLAUDE_CODE_(REMOTE|SSE|ENTRYPOINT)/.test(k)) delete env[k];
  return env;
}
// No signals on Windows: close the process tree with taskkill (grandchild node.exe included)
export function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") { try { spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => {}); } catch {} }
  else { try { child.kill("SIGINT"); } catch {} setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 8000).unref(); }
}

const PERMISSION_MODE = process.env.CLAUDE_PERMISSION_MODE || "acceptEdits";

export function buildArgs(agent) {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model", agent.model,
    "--effort", agent.effort,
    "--permission-mode", agent.permission || PERMISSION_MODE,
  ];
  // Images the user attaches are saved in this folder; access is granted so the agent can read them.
  const up = uploadsDir(agent.id);
  // document library: so the agent can read the reference documents
  const lib = dataPath("library");
  fs.mkdirSync(lib, { recursive: true });
  args.push("--add-dir", up, lib);
  const role = roleArgs(agent, agent._team || []);
  let note = uiNote();
  if (role.note) note += "\n\n" + role.note;
  if (agent._linkedDocs) note += `\n\n${t("Reference documents linked to this project (read with Read when needed; for .docx/.xlsx read the text version given):")}\n${agent._linkedDocs}`;
  args.push("--append-system-prompt", note);
  // tools the user said "allow" to (permanent + this time only) + the role's preset permissions.
  // Given through a settings file instead of the command line: no length limit, rules with quotes/commas do not break.
  const allow = [...new Set([...(agent.allowedTools || []), ...(agent._allowOnce || []), ...role.allow, ...(agent._mcpTools || []).map((n) => "mcp__team__" + n)])];
  const deny = [...new Set([...(role.disallow || []), `Edit(${lib}/**)`, `Write(${lib}/**)`, `MultiEdit(${lib}/**)`])]; // the document library holds source documents; the agent does not change them
  const dir = dataPath("mcp"); fs.mkdirSync(dir, { recursive: true });
  const settingsFile = path.join(dir, `${agent.id}.settings.json`);
  fs.writeFileSync(settingsFile, JSON.stringify({ permissions: { allow, deny } }, null, 2));
  args.push("--settings", settingsFile);
  if (verAtLeast(2, 1, 259)) args.push("--permission-prompts", "none"); // so it does not keep trying things it cannot ask about
  if (verAtLeast(2, 1, 265)) args.push("--system-prompt-snapshot", "off"); // so linked document/team changes reach an older conversation too
  // team lead: task delegation tool (local MCP server)
  if (agent._mcpConfig) args.push("--mcp-config", agent._mcpConfig);
  if (agent.sessionId) args.push("--resume", agent.sessionId);
  return args;
}

const cut = (s, n) => (typeof s === "string" && s.length > n ? s.slice(0, n) + "\n" + t("… ({n} more characters)", { n: s.length - n }) : s);
// Tool input to show in the UI (large ones truncated)
export function slimInput(name, input = {}) {
  if (!input || typeof input !== "object") return null;
  switch (name) {
    case "Edit": return { file_path: input.file_path, old_string: cut(input.old_string, 4000), new_string: cut(input.new_string, 4000) };
    case "MultiEdit": return { file_path: input.file_path, edits: (input.edits || []).slice(0, 12).map((e) => ({ old_string: cut(e.old_string, 2000), new_string: cut(e.new_string, 2000) })) };
    case "Write": return { file_path: input.file_path, content: cut(input.content, 6000) };
    case "Bash": return { command: cut(input.command, 2000), description: input.description };
    case "TodoWrite": return { todos: (input.todos || []).map((t) => ({ content: t.content, status: t.status, activeForm: t.activeForm })) };
    case "ExitPlanMode": return { plan: cut(input.plan, 20000) };
    case "WebFetch": case "WebSearch": return { url: input.url, query: input.query };
    default: return null;
  }
}
// Allow-list rule: the full command for Bash, the tool name for the others
// Claude Code matches compound commands (&&, ||, ;, |) per sub-command; a separate rule is produced for each.
// Shell wrappers (bash -c, node -e, powershell -Command) get no prefix rule: it would open up everything.
const WRAPPER = /^(?:bash|sh|zsh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh|node|python3?|eval|xargs|sudo)\b/i;
export function allowSpecs(name, input = {}) {
  if (name !== "Bash" || !input?.command) return [name];
  const parts = String(input.command).split(/\s*(?:&&|\|\||;|\|&|\||\r?\n)\s*/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const c of parts.slice(0, 6)) {
    if (WRAPPER.test(c) && /[-\s](c|e|Command)\b/.test(c)) { out.push(`Bash(${c})`); continue; } // the full command, not a prefix
    out.push(/[()]/.test(c) ? `Bash(${c.split(/\s+/).slice(0, 2).join(" ")}:*)` : `Bash(${c})`);
  }
  return [...new Set(out)];
}
export const allowSpec = (name, input) => allowSpecs(name, input)[0];
function resultText(content) {
  if (typeof content === "string") return cut(content, 6000);
  if (Array.isArray(content)) return cut(content.filter((c) => c.type === "text").map((c) => c.text).join("\n"), 6000);
  return "";
}

// Short note so the agent knows the UI can show images (built at call time so a language change applies)
export const uiNote = () => [
  t("This session is managed from a local UI called Ecelon Station. The UI can show images in the chat:"),
  t("to show an image file (png, jpg, gif, webp) to the user it is enough to write that file's full path in your reply; the UI opens it as a picture automatically."),
  t("Images the user attaches are given in the message with an 'Attached image:' line and their full path; you can read them with the Read tool."),
  t("The user can give reference documents from the document library (e.g. an ERP analysis document): read the paths under 'Reference documents' with Read; for .docx and .xlsx read the 'readable text version' given next to them."),
  t("The documents in the library are the user's source documents; do not change them unless the user explicitly asks."),
].join(" ");

export function uploadsDir(agentId) {
  const d = dataPath("uploads", String(agentId));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Summary: reduces a tool_use input to one line (file path, command etc.)
export function summarizeToolInput(name, input = {}) {
  const role = input.role ?? input.rol, task = input.task ?? input.gorev;
  if (role && task) return `${role}: ${String(task).slice(0, 100)}`;
  const pick = input.file_path || input.path || input.command || input.pattern || input.query || input.url || input.description || "";
  const s = typeof pick === "string" ? pick : JSON.stringify(pick);
  return s.length > 120 ? s.slice(0, 117) + "..." : s;
}

/**
 * @param {object} agent  the agents.json record
 * @param {string} prompt the user's instruction
 * @param {(ev: object) => void} emit  normalized event
 * @returns {{ promise: Promise<object>, kill: () => void }}
 */
export function runClaude(agent, prompt, emit) {
  const bin = resolveClaude();
  if (!bin) {
    const res = { type: "result", isError: true, subtype: "spawn_error", sessionId: agent.sessionId,
      text: claudeMissingHint() };
    emit(res); emit({ type: "status", status: "error" });
    return { promise: Promise.resolve(res), kill: () => {} };
  }
  const sp = spawnSpec();
  const needShell = sp.shell;   // a shell remains only for a .cmd whose cli.js could not be resolved
  const quote = (a) => { a = a.replace(/\r?\n/g, " "); return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a; }; // in cmd a line break splits the command
  const built = buildArgs(agent);
  const argv = [...sp.pre, ...(needShell ? built.map(quote) : built)];
  const child = spawn(sp.cmd, argv, {
    cwd: agent.cwd,
    shell: needShell,
    env: childEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdin.on("error", () => {}); // if claude exits without reading the prompt, EPIPE must not crash the process
  child.stdin.write(prompt);
  child.stdin.end();

  let sessionId = agent.sessionId, initModel = agent.model, killed = false;
  let finalResult = null;
  let stderrBuf = "";
  let lastContext = 0;

  emit({ type: "status", status: "thinking" });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { emit({ type: "raw", line }); return; }
    handle(msg);
  });

  function handle(msg) {
    switch (msg.type) {
      case "system":
        if (msg.subtype === "init") {
          sessionId = msg.session_id || sessionId; initModel = msg.model || initModel;
          const mcp = (msg.mcp_servers || []).map((s) => ({ name: s.name, status: s.status }));
          const mcpErr = msg.mcp_server_errors || null;
          emit({ type: "init", sessionId, model: msg.model, tools: (msg.tools || []).length, mcp, mcpErr });
        } else if (msg.subtype === "api_retry") {
          emit({ type: "status", status: "thinking", note: t("Retrying the API ({attempt}/{max})", { attempt: msg.attempt, max: msg.max_retries }) });
        }
        break;

      case "stream_event": {
        const ev = msg.event || {};
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          emit({ type: "text_delta", text: ev.delta.text });
        } else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && ev.delta.thinking) {
          emit({ type: "thinking_delta", text: ev.delta.thinking });
        } else if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
          emit({ type: "status", status: "tool", tool: ev.content_block.name });
        } else if (ev.type === "message_start") {
          emit({ type: "status", status: "thinking" });
        }
        break;
      }

      case "rate_limit_event": {
        const i = msg.rate_limit_info || msg.rateLimitInfo || {};
        emit({ type: "rate_limit", info: {
          kind: i.rateLimitType ?? i.rate_limit_type ?? "unknown",
          status: i.status ?? null,
          utilization: typeof i.utilization === "number" ? i.utilization : null,
          resetsAt: i.resetsAt ?? i.resets_at ?? null,
        } });
        break;
      }

      case "assistant": {
        const u = msg.message?.usage;
        if (u) lastContext = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
        const blocks = msg.message?.content || [];
        for (const b of blocks) {
          if (b.type === "thinking" && b.thinking) {
            emit({ type: "thinking", text: b.thinking });
          } else if (b.type === "text" && b.text) {
            emit({ type: "text", text: b.text });
          } else if (b.type === "tool_use") {
            emit({ type: "tool_use", name: b.name, summary: summarizeToolInput(b.name, b.input), toolUseId: b.id, input: slimInput(b.name, b.input) });
            emit({ type: "status", status: "tool", tool: b.name });
          }
        }
        break;
      }

      case "user": {
        const blocks = msg.message?.content || [];
        for (const b of blocks) {
          if (b.type === "tool_result") {
            emit({ type: "tool_result", toolUseId: b.tool_use_id, isError: !!b.is_error, content: resultText(b.content) });
          }
        }
        emit({ type: "status", status: "thinking" });
        break;
      }

      case "result": {
        const errs = Array.isArray(msg.errors) ? msg.errors.map(String) : [];
        const resumeLost = errs.some((e) => /No conversation found|session .* not found/i.test(e));
        const mu = msg.modelUsage || {};
        finalResult = {
          type: "result",
          isError: msg.is_error || (msg.subtype && msg.subtype !== "success"),
          subtype: msg.subtype,
          text: msg.result || errs.join("\n") || "",
          errors: errs,
          resumeLost,
          costUsd: msg.total_cost_usd ?? null,
          durationMs: msg.duration_ms ?? null,
          numTurns: msg.num_turns ?? null,
          sessionId: resumeLost ? null : (msg.session_id || sessionId),
          contextTokens: lastContext || null,
          contextWindow: (mu[initModel] || Object.values(mu).sort((a, b) => (b.inputTokens || 0) - (a.inputTokens || 0))[0])?.contextWindow || null,
          // only real tool denials go on the permission card; plan approval and question tools are always denied in -p
          permissionDenials: (msg.permission_denials || []).filter((d) => !["ExitPlanMode", "AskUserQuestion"].includes(d.tool_name))
            .map((d) => ({ tool: d.tool_name, input: slimInput(d.tool_name, d.tool_input), spec: allowSpec(d.tool_name, d.tool_input), specs: allowSpecs(d.tool_name, d.tool_input) })),
        };
        break;
      }
      default:
        break;
    }
  }

  child.stderr.on("data", (d) => { stderrBuf += d.toString(); });

  const promise = new Promise((resolve) => {
    child.on("close", (code) => {
      rl.close();
      if (!finalResult) {
        finalResult = {
          type: "result",
          isError: true,
          subtype: "process_exit",
          text: (stderrBuf.trim() || t("the claude process ended with code {code}, no result came", { code })).slice(-4000),
          costUsd: null, durationMs: null, numTurns: null, sessionId,
        };
      }
      if (killed) finalResult = { ...finalResult, isError: true, subtype: "interrupted", text: t("Stopped."), permissionDenials: [], resumeLost: false };
      emit({ ...finalResult });
      emit({ type: "status", status: finalResult.isError ? "error" : "done" });
      resolve(finalResult);
    });
    child.on("error", (err) => {
      emit({ type: "result", isError: true, subtype: "spawn_error", text: t("claude could not be started: {message}. Is Claude Code installed and on PATH?", { message: err.message }), sessionId });
      emit({ type: "status", status: "error" });
      resolve({ isError: true, sessionId });
    });
  });

  return { promise, kill: () => { killed = true; killTree(child); }, pid: child.pid };
}

// One-off short answer without tools (e.g. commit message suggestion). Opens no session, writes nothing to the chat.
export function oneShot(prompt, { cwd, model = "claude-haiku-5-5", timeout = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    const sp = spawnSpec(); if (!sp) return reject(new Error(t("Claude Code not found")));
    const needShell = sp.shell;
    const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
    const args = ["-p", "--model", model, "--output-format", "text", "--max-turns", "1",
      "--disallowedTools", "Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Agent", "Task", "TodoWrite"];
    const child = spawn(sp.cmd, [...sp.pre, ...(needShell ? args.map(quote) : args)], { cwd, shell: needShell, env: childEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { killTree(child); reject(new Error(t("Timed out"))); }, timeout);
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 && out.trim() ? resolve(out.trim()) : reject(new Error((err || out || t("exit code {code}", { code })).trim().slice(0, 300))); });
    child.stdin.on("error", () => {}); child.stdin.end(prompt);
  });
}
