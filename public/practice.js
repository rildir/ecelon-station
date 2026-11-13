// Practice: a scratch pad for JavaScript — an editor, a Run button and a console, nothing to do with any project.
// The code never runs in the station's page. It runs in a worker inside a sandboxed frame with an origin of its
// own: it cannot reach the station's API, its storage or the DOM, and an endless loop is stopped from outside
// instead of freezing the window. Files live in this browser (localStorage); nothing is sent to the server.
import { t } from "./i18n.js";
import { loadMonaco } from "./editor.js";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT_KEY = "ecelon.practiceFont", FONT_MIN = 8, FONT_MAX = 40, FONT_DEFAULT = 14;
const KEY = "ecelon.practice", MAX_LINES = 400, SYNC_MS = 3000, TOTAL_MS = 15000;

// ---- shared by both runners: how values are printed, and a console that reports through out(kind, text)
const CORE = String.raw`
const seen = () => new WeakSet();
function show(v, depth, ws) {
  const ty = typeof v;
  if (v === null) return "null"; if (ty === "undefined") return "undefined";
  if (ty === "string") return depth ? JSON.stringify(v) : v;
  if (ty === "number" || ty === "boolean") return String(v); if (ty === "bigint") return v + "n";
  if (ty === "symbol") return v.toString();
  if (ty === "function") return "[Function" + (v.name ? ": " + v.name : " (anonymous)") + "]";
  if (v instanceof Error) return (v.stack && String(v.stack).split("\n")[0]) || (v.name + ": " + v.message);
  if (ws.has(v)) return "[Circular]"; ws.add(v);
  if (depth > 3) return Array.isArray(v) ? "[Array]" : "[Object]";
  if (v instanceof Promise) return "Promise {…}";
  if (v instanceof Date) return isNaN(v) ? "Invalid Date" : v.toISOString();
  if (v instanceof RegExp) return String(v);
  if (v instanceof Map) return "Map(" + v.size + ") {" + [...v].slice(0, 50).map(([k, x]) => show(k, depth + 1, ws) + " => " + show(x, depth + 1, ws)).join(", ") + "}";
  if (v instanceof Set) return "Set(" + v.size + ") {" + [...v].slice(0, 50).map((x) => show(x, depth + 1, ws)).join(", ") + "}";
  if (Array.isArray(v)) return "[" + v.slice(0, 100).map((x) => show(x, depth + 1, ws)).join(", ") + (v.length > 100 ? ", … " + (v.length - 100) + " more" : "") + "]";
  const keys = Object.keys(v), name = v.constructor && v.constructor.name && v.constructor.name !== "Object" ? v.constructor.name + " " : "";
  return name + "{" + (keys.length ? " " + keys.slice(0, 50).map((k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ": " + show(v[k], depth + 1, ws)).join(", ") + (keys.length > 50 ? ", …" : "") + " " : "") + "}";
}
const line = (args) => args.map((a) => show(a, 0, seen())).join(" ");
const counts = {}, timers = {};
const con = {
  log: (...a) => out("log", line(a)), info: (...a) => out("info", line(a)), debug: (...a) => out("log", line(a)),
  warn: (...a) => out("warn", line(a)), error: (...a) => out("error", line(a)),
  table: (rows) => {
    try {
      const list = Array.isArray(rows) ? rows : Object.entries(rows).map(([k, v]) => ({ "(key)": k, ...(v && typeof v === "object" ? v : { value: v }) }));
      const cols = [...new Set(list.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : ["value"])))];
      const cell = (r, c) => show(r && typeof r === "object" ? r[c] : c === "value" ? r : undefined, 1, seen());
      const data = [["#", ...cols], ...list.map((r, i) => [String(i), ...cols.map((c) => cell(r, c))])];
      const w = data[0].map((_, i) => Math.min(40, Math.max(...data.map((r) => r[i].length))));
      out("log", data.map((r) => r.map((c, i) => c.slice(0, 40).padEnd(w[i])).join("  ")).join("\n"));
    } catch { out("log", line([rows])); }
  },
  dir: (v) => out("log", line([v])), clear: () => out("clear", ""),
  assert: (ok, ...a) => { if (!ok) out("error", "Assertion failed" + (a.length ? ": " + line(a) : "")); },
  count: (l = "default") => { counts[l] = (counts[l] || 0) + 1; out("log", l + ": " + counts[l]); },
  time: (l = "default") => { timers[l] = performance.now(); },
  timeEnd: (l = "default") => { if (l in timers) { out("log", l + ": " + (performance.now() - timers[l]).toFixed(2) + " ms"); delete timers[l]; } },
  group: (...a) => { if (a.length) out("log", line(a)); }, groupEnd: () => {}, trace: (...a) => out("log", line(a)),
};
self.console = con;
`;
// ---- what runs inside the worker (plain JavaScript files): the console, then the user's code as an async function
const WORKER = "const out = (kind, text) => postMessage({ kind, text });\n" + CORE + String.raw`
// the line of the user's code an error came from: the code is the body of an async function, two lines down
const where = (e) => { const m = /<anonymous>:(\d+):(\d+)/.exec(String((e && e.stack) || "")); return m ? { line: Math.max(1, Number(m[1]) - 2), col: Number(m[2]) } : null; };
const fail = (e) => postMessage({ kind: "throw", text: e instanceof Error ? e.name + ": " + e.message : "Uncaught " + line([e]), at: where(e) });
self.addEventListener("unhandledrejection", (ev) => { ev.preventDefault(); fail(ev.reason); });
self.onmessage = async (ev) => {
  let fn;
  try { fn = new (Object.getPrototypeOf(async function () {}).constructor)(ev.data.code); }
  catch (e) { postMessage({ kind: "throw", text: e.name + ": " + e.message, at: null }); postMessage({ kind: "done" }); return; }
  const p = fn(); postMessage({ kind: "sync" });
  try { const r = await p; if (r !== undefined) out("result", show(r, 0, seen())); } catch (e) { fail(e); }
  postMessage({ kind: "done" });
};
`;
// ---- the sandboxed frame: starts the worker, relays its messages, stops it when told. No network except https
// (so fetch to a public API can be practised); the station itself is out of reach either way.
const FRAME = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src https:">
<script>
let w = null; const src = ${JSON.stringify(WORKER)};
addEventListener("message", (ev) => {
  const m = ev.data || {};
  if (m.cmd === "stop") { if (w) { w.terminate(); w = null; } return; }
  if (m.cmd !== "run") return;
  if (w) w.terminate();
  try {
    w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    w.onmessage = (e) => parent.postMessage({ practice: m.run, ...e.data }, "*");
    w.onerror = (e) => { parent.postMessage({ practice: m.run, kind: "throw", text: e.message || "Error", at: e.lineno ? { line: Math.max(1, e.lineno - 2), col: e.colno || 1 } : null }, "*"); parent.postMessage({ practice: m.run, kind: "done" }, "*"); };
    w.postMessage({ code: m.code });
  } catch (e) { parent.postMessage({ practice: m.run, kind: "throw", text: String(e && e.message || e), at: null }, "*"); parent.postMessage({ practice: m.run, kind: "done" }, "*"); }
});
parent.postMessage({ practice: 0, kind: "ready" }, "*");
</` + `script>`;


// ---- web pages (HTML + CSS + JS): the page is built into one document and shown in a sandboxed frame of its own
// origin. Its console and its errors are reported to the station; it cannot reach the station either.
const WEB_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: data:; connect-src https:";
// A page's script runs on the page's own thread, and here that thread is shared with the station: a loop that never
// ends would freeze the whole window. So every braced for / while / do loop gets a guard as its first statement.
// The guard throws when the page has not been able to breathe for two seconds. Nothing is added on new lines, so
// the line numbers of errors stay the user's own. If the guarded text does not parse but the original does, the
// original is used as it is (better no guard than an error the user did not write).
export function guardLoops(js) {
  const src = String(js || ""), n = src.length, out = []; let i = 0, last = 0;
  const skipStr = (q) => { i++; while (i < n && src[i] !== q) { if (src[i] === "\\") i++; i++; } i++; };
  const skipWs = () => { for (;;) { while (i < n && /\s/.test(src[i])) i++; if (src.startsWith("//", i)) { while (i < n && src[i] !== "\n") i++; } else if (src.startsWith("/*", i)) { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; } else return; } };
  const skipParens = () => { let d = 0; while (i < n) { const c = src[i]; if (c === '"' || c === "'" || c === "`") { skipStr(c); continue; } if (c === "(") d++; else if (c === ")" && --d === 0) { i++; return true; } i++; } return false; };
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { skipStr(c); continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    if (/[A-Za-z_$]/.test(c) && !/[\w$.]/.test(src[i - 1] || " ")) {
      let j = i; while (j < n && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j); i = j;
      if (word === "for" || word === "while" || word === "do") {
        skipWs();
        if (word === "for" && src.startsWith("await", i)) { i += 5; skipWs(); }
        if (word !== "do") { if (src[i] !== "(" || !skipParens()) continue; skipWs(); }
        if (src[i] === "{") { out.push(src.slice(last, i + 1), "__lg();"); last = i + 1; i++; }
      }
      continue;
    }
    i++;
  }
  if (!out.length) return src;
  const guarded = out.join("") + src.slice(last), parses = (code) => { try { new Function(code); return true; } catch { return false; } };
  return parses(guarded) || !parses(src) ? guarded : src;
}
function webDoc(f, run, stoppedText) {
  const shim = `(() => { const RUN = ${run}; const out = (kind, text) => parent.postMessage({ practice: RUN, kind, text }, "*");\n${CORE}\n` +
    `let beat = performance.now(), turns = 0; setInterval(() => { beat = performance.now(); }, 100); window.__lg = () => { if (++turns % 2000 === 0 && performance.now() - beat > 2000) { beat = performance.now(); throw new Error(${JSON.stringify(stoppedText)}); } };\n` +
    `window.addEventListener("error", (e) => { parent.postMessage({ practice: RUN, kind: "throw", text: e.error instanceof Error ? e.error.name + ": " + e.error.message : (e.message || "Error"), line: e.lineno || 0, col: e.colno || 1 }, "*"); });\n` +
    `window.addEventListener("unhandledrejection", (e) => { const r = e.reason; parent.postMessage({ practice: RUN, kind: "throw", text: r instanceof Error ? r.name + ": " + r.message : "Uncaught (in promise) " + line([r]), line: 0 }, "*"); });\n})();`;
  const safe = (code, tag) => String(code || "").replace(new RegExp("</" + tag, "gi"), "<\\/" + tag);
  const head = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${WEB_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1"><script>${safe(shim, "script")}</` + `script><style>${safe(f.css, "style")}</style></head><body>${f.html || ""}\n<script>`;
  // jsLine: the line of the document on which the user's script starts (errors report document lines)
  return { doc: head + safe(guardLoops(f.js), "script") + `\n</` + `script></body></html>`, jsLine: head.split("\n").length };
}

const PARTS = [["html", "HTML", "html"], ["css", "CSS", "css"], ["js", "JS", "javascript"]];
const ICONS = {
  right: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M9.5 3v10"/></svg>',
  bottom: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 9h12"/></svg>',
};

export function createPractice(ctx) {
  // ctx: { toast, confirmBox, prompt, askHint(text), onOpen, onClose }
  const root = $("#practice"), main = $("#pr-main");
  let monaco = null, ed = null, frame = null, frameReady = null, run = 0, running = false, alive = false, lines = 0, syncT = 0, totalT = 0, saveT = 0, liveT = 0, lastError = "", jsLine = 0;
  const models = new Map(); // "fileId:part" -> monaco model
  const sample = () => `// ${t("Write JavaScript here and press Ctrl+Enter to run it.")}\nconst people = [{ name: "Ada", age: 36 }, { name: "Linus", age: 28 }];\nconsole.log(people.filter((p) => p.age > 30).map((p) => p.name));\n`;
  const webSample = () => ({ html: `<h1>${t("Hello")}</h1>\n<button id="btn">${t("Click me")}</button>\n<p id="out"></p>\n`, css: `body { font-family: system-ui, sans-serif; padding: 24px; }\nbutton { padding: 8px 14px; border: 0; border-radius: 6px; background: #4d7bff; color: #fff; cursor: pointer; }\n`, js: `let n = 0;\ndocument.querySelector("#btn").addEventListener("click", () => {\n  n++;\n  document.querySelector("#out").textContent = n;\n  console.log("click", n);\n});\n` });
  const fresh = () => ({ files: [{ id: "f1", name: "script-1.js", kind: "js", code: sample() }], active: "f1", ui: {} });
  let state = fresh();
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && Array.isArray(s.files) && s.files.length) state = s; } catch { /* first time, or storage is off */ }
  state.ui = state.ui || {}; for (const f of state.files) { f.kind = f.kind === "web" ? "web" : "js"; if (f.kind === "web") f.part = f.part || "html"; }
  const active = () => state.files.find((f) => f.id === state.active) || state.files[0];
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage is off or full: files then last for this visit only */ } }, 300); };
  const partOf = (f) => (f.kind === "web" ? f.part || "html" : "code");

  // ---- layout: the output sits to the right of the editor or below it, and the line between them can be dragged
  function applyLayout() {
    const dock = state.ui.dock === "bottom" ? "bottom" : "right", size = Math.min(80, Math.max(15, Number(state.ui[dock]) || (dock === "right" ? 42 : 38)));
    main.dataset.dock = dock; main.style.setProperty("--pr-size", size + "%");
    const b = $("#pr-dock"), next = dock === "right" ? "bottom" : "right";
    b.innerHTML = ICONS[next]; b.title = next === "bottom" ? t("Move the output below the editor") : t("Move the output next to the editor"); b.setAttribute("aria-label", b.title);
    const sp = $("#pr-split"); sp.setAttribute("aria-orientation", dock === "right" ? "vertical" : "horizontal"); sp.setAttribute("aria-valuenow", String(Math.round(size)));
    ed?.layout();
  }
  function setSize(pct) { const dock = main.dataset.dock; state.ui[dock] = Math.round(Math.min(80, Math.max(15, pct)) * 10) / 10; applyLayout(); persist(); }
  {
    const sp = $("#pr-split");
    sp.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return; e.preventDefault(); sp.setPointerCapture(e.pointerId); root.classList.add("pr-dragging");
      const move = (ev) => { const r = main.getBoundingClientRect(); setSize(main.dataset.dock === "right" ? ((r.right - ev.clientX) / r.width) * 100 : ((r.bottom - ev.clientY) / r.height) * 100); };
      const up = () => { root.classList.remove("pr-dragging"); sp.removeEventListener("pointermove", move); sp.removeEventListener("pointerup", up); sp.removeEventListener("pointercancel", up); };
      sp.addEventListener("pointermove", move); sp.addEventListener("pointerup", up); sp.addEventListener("pointercancel", up);
    });
    sp.addEventListener("keydown", (e) => { // the divider is reachable with Tab; arrows move it
      const cur = Number(main.style.getPropertyValue("--pr-size").replace("%", "")) || 40, grow = main.dataset.dock === "right" ? "ArrowLeft" : "ArrowUp", shrink = main.dataset.dock === "right" ? "ArrowRight" : "ArrowDown";
      if (e.key === grow) { e.preventDefault(); setSize(cur + 3); } else if (e.key === shrink) { e.preventDefault(); setSize(cur - 3); }
    });
    sp.addEventListener("dblclick", () => { delete state.ui[main.dataset.dock]; applyLayout(); persist(); });
    $("#pr-dock").onclick = () => { state.ui.dock = main.dataset.dock === "right" ? "bottom" : "right"; applyLayout(); persist(); };
  }

  function renderFiles() {
    $("#pr-files").innerHTML = state.files.map((f) => `<div class="pr-file${f.id === state.active ? " on" : ""}" data-id="${esc(f.id)}"><button type="button" class="pr-open" title="${esc(f.name)}"><i class="pr-kind">${f.kind === "web" ? "HTML" : "JS"}</i>${esc(f.name)}</button>` +
      `<button type="button" class="pr-x" data-act="ren" title="${esc(t("Rename"))}" aria-label="${esc(t("Rename {name}", { name: f.name }))}"><svg viewBox="0 0 16 16"><path d="M11 2.5 13.5 5 6 12.5H3.5V10Z"/></svg></button>` +
      `<button type="button" class="pr-x del" data-act="del" title="${esc(t("Delete"))}" aria-label="${esc(t("Delete {name}", { name: f.name }))}"><svg viewBox="0 0 16 16"><path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.6 8a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8"/></svg></button></div>`).join("");
  }
  function modelFor(f, part) {
    const key = f.id + ":" + part; let m = models.get(key);
    if (!m) {
      m = monaco.editor.createModel(String(f[part] ?? ""), part === "code" ? "javascript" : PARTS.find((p) => p[0] === part)[2]); models.set(key, m);
      m.onDidChangeContent(() => { f[part] = m.getValue(); persist(); if (f.kind === "web" && part !== "js" && f.id === state.active) { clearTimeout(liveT); liveT = setTimeout(() => { if (!root.hidden && active() === f) runCode(true); }, 500); } });
    }
    return m;
  }
  // show the active file: its tabs (a web page has three parts), its model in the editor, its kind of output
  function showActive(focus = true) {
    const f = active(); renderFiles();
    const web = f.kind === "web"; root.dataset.kind = f.kind;
    $("#pr-tabs").hidden = !web;
    if (web) $("#pr-tabs").innerHTML = PARTS.map(([id, label]) => `<button type="button" role="tab" aria-selected="${f.part === id}" class="${f.part === id ? "on" : ""}" data-part="${id}">${label}</button>`).join("");
    if (ed) { ed.setModel(modelFor(f, partOf(f))); if (focus) ed.focus(); }
    $("#pr-out").textContent = ""; lines = 0; lastError = ""; $("#pr-empty").hidden = false;
    $("#pr-empty").textContent = web ? t("The page appears above. What it prints with console.log appears here.") : t("Run the code to see what it prints. Ctrl+Enter runs it.");
    stop(); if (web) { if (ed) runCode(true); } else $("#pr-view").removeAttribute("srcdoc");
  }
  function select(id) { state.active = id; persist(); showActive(); }

  function print(kind, text, at) {
    const box = $("#pr-out"); $("#pr-empty").hidden = true;
    if (kind === "clear") { box.textContent = ""; lines = 0; return; }
    if (++lines > MAX_LINES) { if (lines === MAX_LINES + 1) { const d = document.createElement("div"); d.className = "pr-line k-note"; d.textContent = t("Output is cut here: more than {n} lines.", { n: MAX_LINES }); box.append(d); } return; }
    const d = document.createElement("div"); d.className = "pr-line k-" + kind;
    d.textContent = String(text).length > 6000 ? String(text).slice(0, 6000) + " …" : text;
    if (at) {
      const b = document.createElement("button"); b.type = "button"; b.className = "pr-at"; b.textContent = t("line {n}", { n: at.line });
      b.onclick = () => { const f = active(); if (f.kind === "web" && f.part !== "js") { f.part = "js"; showActive(false); } ed?.revealLineInCenter(at.line); ed?.setPosition({ lineNumber: at.line, column: at.col || 1 }); ed?.focus(); };
      d.append(" ", b);
    }
    box.append(d); box.scrollTop = box.scrollHeight;
  }
  const setRunning = (on) => { running = on; $("#pr-run").hidden = on; $("#pr-stop").hidden = !on; };
  // "running" is what the buttons show; "alive" is the worker itself, which is left alone after the code has
  // returned so that timers and promises the code started can still print (it is stopped at the next run or in time)
  function kill() { if (!alive) return; alive = false; frame?.contentWindow?.postMessage({ cmd: "stop" }, "*"); run++; clearTimeout(syncT); clearTimeout(totalT); }
  function stop(note) { const was = running; kill(); if (was) { if (note) print("note", note); setRunning(false); } }

  function ensureFrame() {
    if (frameReady) return frameReady;
    frameReady = new Promise((ok) => {
      frame = document.createElement("iframe"); frame.setAttribute("sandbox", "allow-scripts"); frame.setAttribute("aria-hidden", "true"); frame.tabIndex = -1; frame.className = "pr-frame";
      const onReady = (ev) => { if (ev.source === frame.contentWindow && ev.data?.kind === "ready") { removeEventListener("message", onReady); ok(); } };
      addEventListener("message", onReady);
      frame.srcdoc = FRAME; root.append(frame);
    });
    return frameReady;
  }
  addEventListener("message", (ev) => {
    const m = ev.data; if (!m || typeof m !== "object" || !("practice" in m)) return;
    const view = $("#pr-view");
    if (ev.source === view.contentWindow) { // the page preview
      if (m.practice !== run) return;
      if (m.kind === "throw") { const at = m.line > jsLine ? { line: m.line - jsLine + 1, col: m.col || 1 } : null; lastError = m.text + (at ? ` (${t("line {n}", { n: at.line })})` : ""); print("error", m.text, at); }
      else print(m.kind, m.text);
      return;
    }
    if (!frame || ev.source !== frame.contentWindow || m.practice !== run || !alive) return;
    if (m.kind === "sync") { clearTimeout(syncT); return; }
    if (m.kind === "done") { clearTimeout(syncT); setRunning(false); return; }
    if (m.kind === "throw") { lastError = m.text + (m.at ? ` (${t("line {n}", { n: m.at.line })})` : ""); print("error", m.text, m.at); return; }
    print(m.kind, m.text);
  });
  async function runCode(quiet = false) {
    if (!ed) return; stop();
    const f = active(); persist();
    $("#pr-out").textContent = ""; lines = 0; lastError = ""; $("#pr-empty").hidden = f.kind !== "web";
    if (f.kind === "web") { const id = ++run, built = webDoc(f, id, t("Loop stopped: it ran for 2 seconds without a pause. Is there a loop that never ends?")); jsLine = built.jsLine; $("#pr-view").srcdoc = built.doc; return; } // a page has no "finished": it lives until the next run
    await ensureFrame(); const id = ++run; alive = true; setRunning(true);
    frame.contentWindow.postMessage({ cmd: "run", run: id, code: f.code }, "*");
    syncT = setTimeout(() => { if (run === id) stop(t("Stopped: the code ran for {n} seconds without a pause. Is there a loop that never ends?", { n: SYNC_MS / 1000 })); }, SYNC_MS);
    totalT = setTimeout(() => { if (run === id) stop(t("Stopped after {n} seconds.", { n: TOTAL_MS / 1000 })); }, TOTAL_MS); // silent when the code had already returned
  }

  async function open() {
    root.hidden = false; ctx.onOpen?.(); applyLayout(); renderFiles();
    if (ed) { ed.layout(); ed.focus(); return; }
    try { monaco = await loadMonaco(); } catch (e) { $("#pr-editor").innerHTML = `<div class="lib-empty"><b>${esc(t("Could not load the editor"))}</b><p>${esc(e.message)}</p></div>`; return; }
    if (ed || root.hidden) return;
    ed = monaco.editor.create($("#pr-editor"), { model: null, theme: "ecelon", automaticLayout: true, fontFamily: "JetBrains Mono, Consolas, monospace", fontSize: savedFont(), mouseWheelZoom: false, minimap: { enabled: false }, scrollBeyondLastLine: false, tabSize: 2, padding: { top: 12 }, unicodeHighlight: { ambiguousCharacters: false } });
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runCode());
    // text size: Ctrl + wheel, Ctrl +/-, Ctrl 0 — like an IDE; the size is shown in the status bar and remembered
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => zoom(1));
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadAdd, () => zoom(1));
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => zoom(-1));
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadSubtract, () => zoom(-1));
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0, () => setFont(FONT_DEFAULT));
    ed.onDidChangeCursorPosition(renderStatus);
    ed.onDidChangeModel(renderStatus);
    showActive();
  }
  // ---- text size and the status bar under the editor
  function savedFont() { try { const v = Number(localStorage.getItem(FONT_KEY)); if (v >= FONT_MIN && v <= FONT_MAX) return v; } catch { /* storage off */ } return FONT_DEFAULT; }
  const fontNow = () => (ed ? ed.getOption(monaco.editor.EditorOption.fontSize) : savedFont());
  function setFont(px) {
    const v = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(px)));
    if (ed && v !== fontNow()) ed.updateOptions({ fontSize: v });
    try { localStorage.setItem(FONT_KEY, String(v)); } catch { /* storage off */ }
    renderStatus();
  }
  const zoom = (d) => setFont(fontNow() + d);
  function renderStatus() {
    if (!ed) return;
    const pos = ed.getPosition(), m = ed.getModel();
    $("#pr-pos").textContent = pos ? t("Ln {l}, Col {c}", { l: pos.lineNumber, c: pos.column }) : "";
    $("#pr-lang").textContent = m ? ({ javascript: "JavaScript", html: "HTML", css: "CSS" }[m.getLanguageId()] || m.getLanguageId()) : "";
    $("#pr-lines").textContent = m ? t("{n} {n|line|lines}", { n: m.getLineCount() }) : "";
    $("#pr-font").textContent = fontNow() + " px"; $("#pr-font").classList.toggle("changed", fontNow() !== FONT_DEFAULT);
    $("#pr-font").title = t("Text size. Ctrl + mouse wheel or Ctrl +/- changes it; click to reset to {n} px.", { n: FONT_DEFAULT });
  }
  // Ctrl + wheel over the editor: the editor's text grows or shrinks, not the whole window
  $("#pr-editor").addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey) || !ed) return;
    e.preventDefault(); e.stopPropagation();
    zoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false, capture: true });
  $("#pr-font").onclick = () => { setFont(FONT_DEFAULT); ed?.focus(); };
  $("#pr-font-dn").onclick = () => { zoom(-1); ed?.focus(); };
  $("#pr-font-up").onclick = () => { zoom(1); ed?.focus(); };

  function close() { stop(); clearTimeout(liveT); root.hidden = true; ctx.onClose?.(); }

  $("#pr-run").onclick = () => runCode();
  $("#pr-stop").onclick = () => stop(t("Stopped."));
  $("#pr-clear").onclick = () => { $("#pr-out").textContent = ""; lines = 0; $("#pr-empty").hidden = false; };
  $("#pr-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-part]"); if (!b) return; const f = active(); f.part = b.dataset.part; persist(); $("#pr-tabs").querySelectorAll("button").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-selected", String(on)); }); ed?.setModel(modelFor(f, f.part)); ed?.focus(); });
  const addFile = (kind) => {
    const ext = kind === "web" ? "html" : "js", stem = kind === "web" ? "page" : "script";
    let n = 1; while (state.files.some((f) => f.name === `${stem}-${n}.${ext}`)) n++;
    const f = { id: "f" + Date.now().toString(36), name: `${stem}-${n}.${ext}`, kind, ...(kind === "web" ? { part: "html", ...webSample() } : { code: "" }) };
    state.files.push(f); $("#pr-newmenu").hidden = true; select(f.id);
  };
  $("#pr-new").onclick = (e) => { e.stopPropagation(); const m = $("#pr-newmenu"); m.hidden = !m.hidden; $("#pr-new").setAttribute("aria-expanded", String(!m.hidden)); };
  $("#pr-newmenu").addEventListener("click", (e) => { const b = e.target.closest("[data-kind]"); if (b) addFile(b.dataset.kind); });
  document.addEventListener("click", (e) => { if (!$("#pr-newmenu").hidden && !e.target.closest("#pr-newmenu")) $("#pr-newmenu").hidden = true; });
  $("#pr-hint").onclick = () => {
    const f = active(), body = f.kind === "web" ? PARTS.map(([id, , lang]) => (f[id] || "").trim() ? "```" + (lang === "javascript" ? "js" : lang) + "\n" + f[id].trimEnd() + "\n```" : "").filter(Boolean).join("\n\n") : (f.code || "").trim() ? "```js\n" + f.code.trimEnd() + "\n```" : "";
    if (!body) return ctx.toast(t("Write some code first"), "bad");
    const ask = f.kind === "web" ? t("I am stuck on this HTML, CSS and JavaScript. Do not give me the solution: give me one hint, and tell me where to look.") : t("I am stuck on this JavaScript. Do not give me the solution: give me one hint, and tell me which line to look at.");
    const err = lastError; close(); ctx.askHint(`${ask}\n\n${body}${err ? `\n\n${t("Error")}: ${err}` : ""}`);
  };
  $("#pr-files").addEventListener("click", async (e) => {
    const row = e.target.closest(".pr-file"); if (!row) return; const f = state.files.find((x) => x.id === row.dataset.id); if (!f) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "ren") { const name = (await ctx.prompt(t("Rename file"), "script.js", f.name, { ok: t("Save") }))?.trim(); if (name) { f.name = name.slice(0, 60); renderFiles(); persist(); } return; }
    if (act === "del") {
      if (!(await ctx.confirmBox({ title: t("Delete {name}?", { name: f.name }), body: t("The file is deleted from this browser. This cannot be undone."), ok: t("Delete"), danger: true }))) return;
      for (const [k, m] of models) if (k.startsWith(f.id + ":")) { if (ed?.getModel() === m) ed.setModel(null); m.dispose(); models.delete(k); }
      state.files = state.files.filter((x) => x !== f); if (!state.files.length) state = { ...fresh(), ui: state.ui };
      if (!state.files.some((x) => x.id === state.active)) state.active = state.files[0].id;
      persist(); showActive(); return;
    }
    if (f.id !== state.active) select(f.id);
  });
  root.addEventListener("click", (e) => { if (e.target.closest('[data-act="close"]')) close(); });
  document.addEventListener("keydown", (e) => {
    if (root.hidden || document.querySelector("dialog[open]")) return;
    const inEditor = e.target instanceof Element && !!e.target.closest(".monaco-editor");
    if (e.key === "Escape" && !e.defaultPrevented) { if (running) { e.preventDefault(); stop(t("Stopped.")); } else if (!inEditor) { e.preventDefault(); close(); } } // in the editor Esc belongs to the editor (suggestions, find)
    else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !inEditor) { e.preventDefault(); runCode(); }
  });
  return { open, close, get isOpen() { return !root.hidden; } };
}
