// Gerçek koşucu: proje klasöründe `claude -p` başlatır, stream-json çıktısını
// satır satır okuyup arayüzün anladığı sade olaylara çevirir.
//
// Prompt metni argüman olarak değil STDIN üzerinden verilir: Windows'ta
// `claude.cmd` shell ile açılmak zorunda ve shell'e giden argümanlarda tırnak
// kaçırma derdi çıkar; stdin'de böyle bir dert yok.
import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Windows'ta Claude Code `claude.exe` (yerel kurulum), `claude.cmd` (npm) ya da masaüstü uygulamasının
// içindeki sürüm olabilir. Önce CLAUDE_BIN, sonra PATH, sonra bilinen yerler denenir.
let _bin;
export function resolveClaude() {
  if (_bin !== undefined) return _bin;
  const fileOk = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
  if (process.env.CLAUDE_BIN) return (_bin = fileOk(process.env.CLAUDE_BIN) ? process.env.CLAUDE_BIN : null);
  if (process.platform !== "win32") return (_bin = "claude");
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
  // Claude masaüstü uygulamasının gömülü sürümü: %APPDATA%\Claude\claude-code\<sürüm>\claude.exe
  for (const root of [path.join(appdata, "Claude", "claude-code"), path.join(local, "Claude", "claude-code")]) {
    try {
      const vers = fs.readdirSync(root).sort().reverse();
      for (const v of vers) { const f = path.join(root, v, "claude.exe"); if (fileOk(f)) return (_bin = f); }
    } catch {}
  }
  return (_bin = null);
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
  // Kullanıcının eklediği görseller bu klasöre kaydedilir; ajan okuyabilsin diye erişim verilir.
  const up = uploadsDir(agent.id);
  args.push("--add-dir", up);
  args.push("--append-system-prompt", UI_NOTE);
  // kullanıcının "izin ver" dediği araçlar (kalıcı + bu seferlik)
  const allow = [...new Set([...(agent.allowedTools || []), ...(agent._allowOnce || [])])];
  if (allow.length) args.push("--allowedTools", ...allow);
  if (agent.sessionId) args.push("--resume", agent.sessionId);
  return args;
}

const cut = (s, n) => (typeof s === "string" && s.length > n ? s.slice(0, n) + `\n… (${s.length - n} karakter daha)` : s);
// Arayüzde gösterilecek araç girdisi (büyükleri kısaltılmış)
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
// İzin listesi kuralı: Bash için tam komut, diğerleri için araç adı
export function allowSpec(name, input = {}) {
  if (name === "Bash" && input?.command) {
    const c = String(input.command).trim();
    // parantezli komutlar kural sözdizimini bozar; o zaman ilk iki kelimeyle önek kuralı
    return /[()]/.test(c) ? `Bash(${c.split(/\s+/).slice(0, 2).join(" ")}:*)` : `Bash(${c})`;
  }
  return name;
}
function resultText(content) {
  if (typeof content === "string") return cut(content, 6000);
  if (Array.isArray(content)) return cut(content.filter((c) => c.type === "text").map((c) => c.text).join("\n"), 6000);
  return "";
}

// Ajanın, arayüzün görsel gösterebildiğini bilmesi için eklenen kısa not
export const UI_NOTE = "Bu oturum, Ecelon Station adlı yerel bir arayüzden yönetiliyor. Arayüz sohbette görselleri gösterebiliyor: " +
  "bir görsel dosyasını (png, jpg, gif, webp) kullanıcıya göstermek için yanıtında o dosyanın tam yolunu yazman yeterli; arayüz onu otomatik olarak resim olarak açar. " +
  "Kullanıcının eklediği görseller mesajda 'Ekli görsel:' satırıyla tam yoluyla verilir; onları Read aracıyla okuyabilirsin.";

export function uploadsDir(agentId) {
  const d = path.resolve("data", "uploads", String(agentId));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Özet: tool_use girdisini tek satıra indirir (dosya yolu, komut vs.)
export function summarizeToolInput(name, input = {}) {
  const pick = input.file_path || input.path || input.command || input.pattern || input.query || input.url || input.description || "";
  const s = typeof pick === "string" ? pick : JSON.stringify(pick);
  return s.length > 120 ? s.slice(0, 117) + "..." : s;
}

/**
 * @param {object} agent  agents.json kaydı
 * @param {string} prompt kullanıcının emri
 * @param {(ev: object) => void} emit  normalize edilmiş olay
 * @returns {{ promise: Promise<object>, kill: () => void }}
 */
export function runClaude(agent, prompt, emit) {
  const bin = resolveClaude();
  if (!bin) {
    const res = { type: "result", isError: true, subtype: "spawn_error", sessionId: agent.sessionId,
      text: "Claude Code bulunamadı. PowerShell'de `where.exe claude` çıktısındaki yolu CLAUDE_BIN olarak ver: set CLAUDE_BIN=C:\\yol\\claude.exe&& npm start" };
    emit(res); emit({ type: "status", status: "error" });
    return { promise: Promise.resolve(res), kill: () => {} };
  }
  const needShell = /\.(cmd|bat)$/i.test(bin);   // .cmd shim'i Windows'ta shell ister; .exe istemez
  // .cmd için shell kullanılırken boşluklu argümanlar tırnaklanmalı
  const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  const argv = needShell ? buildArgs(agent).map(quote) : buildArgs(agent);
  const child = spawn(needShell ? `"${bin}"` : bin, argv, {
    cwd: agent.cwd,
    shell: needShell,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdin.write(prompt);
  child.stdin.end();

  let sessionId = agent.sessionId;
  let finalResult = null;
  let stderrBuf = "";
  let currentText = "";
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
          sessionId = msg.session_id || sessionId;
          emit({ type: "init", sessionId, model: msg.model, tools: (msg.tools || []).length });
        } else if (msg.subtype === "api_retry") {
          emit({ type: "status", status: "thinking", note: `API yeniden deneniyor (${msg.attempt}/${msg.max_retries})` });
        }
        break;

      case "stream_event": {
        const ev = msg.event || {};
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          currentText += ev.delta.text;
          emit({ type: "text_delta", text: ev.delta.text });
        } else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && ev.delta.thinking) {
          emit({ type: "thinking_delta", text: ev.delta.thinking });
        } else if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
          emit({ type: "status", status: "tool", tool: ev.content_block.name });
        } else if (ev.type === "message_start") {
          currentText = "";
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
            currentText = "";
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
        finalResult = {
          type: "result",
          isError: msg.is_error || (msg.subtype && msg.subtype !== "success"),
          subtype: msg.subtype,
          text: msg.result || "",
          costUsd: msg.total_cost_usd ?? null,
          durationMs: msg.duration_ms ?? null,
          numTurns: msg.num_turns ?? null,
          sessionId: msg.session_id || sessionId,
          contextTokens: lastContext || null,
          contextWindow: Object.values(msg.modelUsage || {})[0]?.contextWindow || null,
          permissionDenials: (msg.permission_denials || []).map((d) => ({ tool: d.tool_name, input: slimInput(d.tool_name, d.tool_input), spec: allowSpec(d.tool_name, d.tool_input) })),
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
          text: stderrBuf.trim() || `claude süreci ${code} koduyla bitti, sonuç gelmedi`,
          costUsd: null, durationMs: null, numTurns: null, sessionId,
        };
      }
      emit({ ...finalResult });
      emit({ type: "status", status: finalResult.isError ? "error" : "done" });
      resolve(finalResult);
    });
    child.on("error", (err) => {
      emit({ type: "result", isError: true, subtype: "spawn_error", text: `claude başlatılamadı: ${err.message}. Claude Code kurulu ve PATH'te mi?`, sessionId });
      emit({ type: "status", status: "error" });
      resolve({ isError: true, sessionId });
    });
  });

  return { promise, kill: () => child.kill("SIGINT") };
}
