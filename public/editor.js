// Code editor: VS Code's editor (Monaco) + file explorer + search in project.
// If the agent writes to the same file: with no unsaved changes the file is reloaded silently, otherwise a warning and the diff are shown.
import { t } from "./i18n.js";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const base = (p) => String(p).split("/").pop();
const dirOf = (p) => { const i = String(p).lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
const IMG = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i;

let monacoP = null;
function loadMonaco() {
  if (monacoP) return monacoP;
  monacoP = new Promise((ok, no) => {
    window.MonacoEnvironment = { getWorkerUrl: () => "/vendor/monaco/vs/base/worker/workerMain.js" };
    const s = document.createElement("script"); s.src = "/vendor/monaco/vs/loader.js";
    s.onload = () => {
      window.require.config({ paths: { vs: "/vendor/monaco/vs" } });
      window.require(["vs/editor/editor.main"], () => {
        const m = window.monaco;
        m.editor.defineTheme("ecelon", { base: "vs-dark", inherit: true, rules: [
          { token: "comment", foreground: "7a7fa6", fontStyle: "italic" }, { token: "keyword", foreground: "f6a23a" }, { token: "string", foreground: "8ff0bd" },
          { token: "number", foreground: "ffcf91" }, { token: "type", foreground: "5fd0ff" }, { token: "delimiter", foreground: "c9c4e6" } ],
          colors: { "editor.background": "#141829", "editor.lineHighlightBackground": "#1b2038", "editorLineNumber.foreground": "#4f5680", "editorLineNumber.activeForeground": "#c9c4e6",
            "editor.selectionBackground": "#3a4270", "editorCursor.foreground": "#f6a23a", "editorIndentGuide.background1": "#232948", "editorWidget.background": "#1b2038",
            "editorGutter.background": "#141829", "minimap.background": "#141829", "scrollbarSlider.background": "#3a427066", "diffEditor.insertedTextBackground": "#2fd27f22", "diffEditor.removedTextBackground": "#ff4d6a26" } });
        ok(m);
      }, no);
    };
    s.onerror = () => no(new Error(t("Could not load the editor (monaco-editor is not installed)")));
    document.head.append(s);
  });
  return monacoP;
}

export function createEditor(ctx) {
  // ctx: { api, toast, confirmBox, prompt, onOpen, onClose, insertRef(agent, path), isBusyTeam(agent), openInFolder(agent, path) }
  const root = $("#editor");
  const projects = new Map(); // agentId -> { agent, tabs: [], active, expanded:Set, tree: Map(dir -> entries), files:null }
  let P = null, monaco = null, ed = null, diffEd = null, pollT = null, sideTab = "files";

  const pr = (a) => { if (!projects.has(a.id)) projects.set(a.id, { agent: a, tabs: [], active: null, expanded: new Set([""]), tree: new Map(), files: null, search: { q: "", cs: false, word: false, regex: false, include: "", exclude: "" } }); const p = projects.get(a.id); p.agent = a; return p; };
  const api = (path, opts) => ctx.api(`/api/agents/${P.agent.id}/fs/${path}`, opts);
  const tabOf = (path) => P.tabs.find((t) => t.path === path);
  const isDirty = (t) => t.model && t.model.getAlternativeVersionId() !== t.saved;
  const anyDirty = () => [...projects.values()].some((p) => p.tabs.some(isDirty));

  async function open(agent, filePath, line) {
    P = pr(agent);
    root.hidden = false; ctx.onOpen?.();
    $("#ed-title").textContent = agent.name;
    renderSide();
    try { monaco = await loadMonaco(); } catch (e) { $("#ed-main").innerHTML = `<div class="lib-empty"><b>${t("Could not load the editor")}</b><p>${esc(e.message)}</p></div>`; return; }
    if (!ed) {
      ed = monaco.editor.create($("#ed-monaco"), { theme: "ecelon", automaticLayout: true, fontFamily: "JetBrains Mono, Consolas, monospace", fontSize: 13.5, lineHeight: 21, minimap: { enabled: true, renderCharacters: false },
        smoothScrolling: true, cursorBlinking: "smooth", unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: true } /* so the Turkish dotless/dotted i are not flagged as ambiguous */, renderWhitespace: "selection", bracketPairColorization: { enabled: true }, guides: { bracketPairs: true }, scrollBeyondLastLine: false, tabSize: 2, stickyScroll: { enabled: true } });
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save());
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => quickOpen());
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => showSearch());
      ed.onDidChangeCursorPosition(() => renderStatus());
      ed.onDidChangeModelContent(() => { const t = activeTab(); if (t?.preview) { t.preview = false; } renderTabs(); });
    }
    await loadDir("");
    if (filePath) await openFile(filePath, { line, pin: true });
    else { showActive(); if (!activeTab()) $(".ed-qopen").focus(); }
    startPoll();
  }
  function close() {
    if (P) { const t = activeTab(); if (t && ed && t.model) t.view = ed.saveViewState(); }
    if (!$("#ed-diff").hidden) { dropDiff(); $("#ed-diff").hidden = true; $("#ed-monaco").hidden = !(activeTab()?.kind === "text"); }
    root.hidden = true; stopPoll(); closeMenu(); ctx.onClose?.();
  }
  const activeTab = () => P?.tabs.find((t) => t.path === P.active);

  // ---------- file tree
  async function loadDir(dir) {
    try { const r = await api(`list?dir=${encodeURIComponent(dir)}`); P.tree.set(dir, r.entries); }
    catch (e) { P.tree.set(dir, []); if (!dir) ctx.toast(e.message, "bad"); }
    renderTree();
  }
  async function refreshTree() { const dirs = [...P.expanded]; P.tree.clear(); P.files = null; for (const d of dirs) { try { P.tree.set(d, (await api(`list?dir=${encodeURIComponent(d)}`)).entries); } catch { P.expanded.delete(d); } } renderTree(); }
  function renderTree() {
    if (sideTab !== "files") return;
    const box = $("#ed-tree"); const rows = [];
    const walk = (dir, depth) => {
      for (const e of P.tree.get(dir) || []) {
        const p = dir ? `${dir}/${e.name}` : e.name;
        const open = e.dir && P.expanded.has(p);
        rows.push(`<div tabindex="-1" class="et-row${e.dir ? " dir" : ""}${e.dim ? " dim" : ""}${!e.dir && p === P.active ? " active" : ""}${!e.dir && tabOf(p) && isDirty(tabOf(p)) ? " dirty" : ""}" data-p="${esc(p)}" data-dir="${e.dir ? 1 : ""}" style="--d:${depth}" draggable="false" title="${esc(p)}">
          ${e.dir ? `<svg class="tw${open ? " open" : ""}" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4"/></svg>` : `<i class="fi ${fileIcon(e.name)}"></i>`}<span>${esc(e.name)}</span></div>`);
        if (open) { if (P.tree.has(p)) walk(p, depth + 1); else rows.push(`<div class="et-row loading" style="--d:${depth + 1}">…</div>`); }
      }
    };
    walk("", 0);
    box.innerHTML = rows.join("") || `<div class="et-empty">${t("Folder is empty")}</div>`;
  }
  function fileIcon(n) {
    const e = n.split(".").pop().toLowerCase();
    if (["ts", "tsx"].includes(e)) return "fi-ts"; if (["js", "jsx", "mjs", "cjs"].includes(e)) return "fi-js"; if (e === "json") return "fi-json";
    if (["cs", "csproj", "sln"].includes(e)) return "fi-cs"; if (["html", "htm", "cshtml", "razor"].includes(e)) return "fi-html"; if (["css", "scss", "less"].includes(e)) return "fi-css";
    if (["md", "txt"].includes(e)) return "fi-md"; if (["sql"].includes(e)) return "fi-sql"; if (IMG.test(n)) return "fi-img"; if (["py"].includes(e)) return "fi-py"; if (["php"].includes(e)) return "fi-php";
    return "";
  }
  $("#ed-tree").addEventListener("click", async (e) => {
    const r = e.target.closest(".et-row[data-p]"); if (!r) return;
    const p = r.dataset.p; P.selDir = r.dataset.dir ? p : dirOf(p);
    if (r.dataset.dir) { if (P.expanded.has(p)) P.expanded.delete(p); else { P.expanded.add(p); if (!P.tree.has(p)) { renderTree(); await loadDir(p); return; } } renderTree(); return; }
    openFile(p, { pin: false });
  });
  $("#ed-tree").addEventListener("dblclick", async (e) => { const r = e.target.closest(".et-row[data-p]"); if (r && !r.dataset.dir) { await openFile(r.dataset.p, { pin: true }); const t = tabOf(r.dataset.p); if (t) { t.preview = false; renderTabs(); } } });
  // F2: rename, Delete: delete, Enter: open, ↑/↓: navigate
  $("#ed-tree").tabIndex = 0;
  $("#ed-tree").addEventListener("keydown", (e) => {
    const rows = [...$("#ed-tree").querySelectorAll(".et-row[data-p]")];
    let cur = document.activeElement?.closest?.(".et-row[data-p]") || rows.find((r) => r.classList.contains("active"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const i = rows.indexOf(cur); const n = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]; n?.focus(); return; }
    if (!cur) return;
    if (e.key === "F2") { e.preventDefault(); renameItem(cur.dataset.p); }
    else if (e.key === "Delete") { e.preventDefault(); deleteItem(cur.dataset.p, !!cur.dataset.dir); }
    else if (e.key === "Enter") { e.preventDefault(); cur.click(); }
  });
  $("#ed-tree").addEventListener("contextmenu", (e) => { e.preventDefault(); const r = e.target.closest(".et-row[data-p]"); treeMenu(r?.dataset.p || "", !!r?.dataset.dir || !r, e.clientX, e.clientY); });

  // ---------- tabs
  async function openFile(path, { line, col, pin = true } = {}) {
    let t = tabOf(path);
    if (!t) {
      let d; try { d = await api(`file?path=${encodeURIComponent(path)}`); } catch (e) { ctx.toast(e.message, "bad"); return; }
      t = { path, mtime: d.mtime, bom: d.bom, eol: d.eol, preview: !pin, kind: d.binary ? (IMG.test(path) ? "image" : "binary") : d.tooBig ? "big" : "text", size: d.size };
      if (t.kind === "text") {
        const uri = monaco.Uri.parse(`file:///${P.agent.id}/${path.split("/").map(encodeURIComponent).join("/")}`);
        monaco.editor.getModel(uri)?.dispose();
        t.model = monaco.editor.createModel(d.text, undefined, uri);
        t.model.setEOL(d.eol === "CRLF" ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
        t.saved = t.model.getAlternativeVersionId();
      } else if (IMG.test(path)) t.kind = "image";
      // preview tab: replaced by the new one unless dirty (like VS Code)
      const prev = P.tabs.findIndex((x) => x.preview && !isDirty(x));
      if (!pin && prev >= 0) { disposeTab(P.tabs[prev]); P.tabs.splice(prev, 1, t); }
      else P.tabs.push(t);
    } else if (pin) t.preview = false;
    switchTo(path);
    if (line && ed && t.model) { ed.revealLineInCenter(line); ed.setPosition({ lineNumber: line, column: col || 1 }); if (col) { ed.setSelection(new monaco.Selection(line, col, line, col)); } ed.focus(); }
  }
  function disposeTab(t) { if (diffEd && t.model && diffEd.getModel()?.modified === t.model) dropDiff(); t.model?.dispose(); }
  function switchTo(path) {
    const cur = activeTab(); if (cur && ed && cur.model && cur.path !== path) cur.view = ed.saveViewState();
    P.active = path; showActive();
  }
  function dropDiff() { // when the diff view closes, release the "version on disk" model (a new model is created on every open)
    if (!diffEd) return;
    const m = diffEd.getModel(); if (!m) return;
    try { diffEd.setModel(null); } catch {}
    try { m.original?.dispose(); } catch {}
  }
  function showActive() {
    const tb = activeTab();
    $("#ed-monaco").hidden = !(tb && tb.kind === "text");
    $("#ed-other").hidden = !!(tb && tb.kind === "text");
    if (!$("#ed-diff").hidden) dropDiff();
    $("#ed-diff").hidden = true;
    if (!tb) { $("#ed-other").innerHTML = `<div class="lv-none"><b>${t("Open a file")}</b><p>${t("Select one on the left or type its name with <kbd>Ctrl</kbd>+<kbd>P</kbd>. To search the project, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>.")}</p></div>`; }
    else if (tb.kind === "text") { ed.setModel(tb.model); if (tb.view) ed.restoreViewState(tb.view); setTimeout(() => ed.focus(), 0); }
    else if (tb.kind === "image") $("#ed-other").innerHTML = `<div class="ed-img"><img src="/api/agents/${P.agent.id}/fs/raw?path=${encodeURIComponent(tb.path)}&t=${tb.mtime}" alt=""><small>${esc(tb.path)} · ${Math.round(tb.size / 1024)} KB</small></div>`;
    else $("#ed-other").innerHTML = `<div class="lv-none"><b>${tb.kind === "big" ? t("File too large") : t("Binary file")}</b><p>${t("{path} ({kb} KB) cannot be opened here.", { path: esc(tb.path), kb: Math.round(tb.size / 1024) })}</p><button type="button" class="btn ghost sm" data-ed="reveal">${t("Show in file manager")}</button></div>`;
    renderTabs(); renderTree(); renderStatus(); renderBanner();
  }
  function renderTabs() {
    $("#ed-tabs").innerHTML = P.tabs.map((tb) => `<div class="ed-tab${tb.path === P.active ? " active" : ""}${tb.preview ? " preview" : ""}${isDirty(tb) ? " dirty" : ""}${tb.conflict ? " conflict" : ""}" data-p="${esc(tb.path)}" title="${esc(tb.path)}">
      <i class="fi ${fileIcon(base(tb.path))}"></i><span>${esc(base(tb.path))}</span>${P.tabs.filter((x) => base(x.path) === base(tb.path)).length > 1 ? `<small>${esc(dirOf(tb.path).split("/").pop())}</small>` : ""}
      <button type="button" class="ed-x" data-x title="${t("Close (Ctrl+W)")}" aria-label="${t("Close")}"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>`).join("");
    $("#ed-tabs").querySelector(".active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  $("#ed-tabs").addEventListener("mousedown", (e) => { if (e.button === 1) { const tb = e.target.closest(".ed-tab"); if (tb) { e.preventDefault(); closeTab(tb.dataset.p); } } });
  $("#ed-tabs").addEventListener("click", (e) => { const tb = e.target.closest(".ed-tab"); if (!tb) return; if (e.target.closest("[data-x]")) return closeTab(tb.dataset.p); switchTo(tb.dataset.p); });
  $("#ed-tabs").addEventListener("dblclick", (e) => { const tb = e.target.closest(".ed-tab"); const t = tb && tabOf(tb.dataset.p); if (t) { t.preview = false; renderTabs(); } });
  async function closeTab(path) {
    const i = P.tabs.findIndex((t) => t.path === path); if (i < 0) return;
    const tb = P.tabs[i];
    if (isDirty(tb)) {
      const r = await ctx.confirmBox({ title: t("{file} is not saved", { file: base(path) }), body: t("Do you want to save your changes?"), ok: t("Save and close"), alt: t("Close without saving"), altDanger: true, focusOk: true });
      if (!r) return;
      if (r === true) { await save(tb); if (isDirty(tb)) return; }
    }
    disposeTab(tb); P.tabs.splice(i, 1);
    if (P.active === path) P.active = (P.tabs[i] || P.tabs[i - 1])?.path || null;
    showActive();
  }

  // ---------- save / external change
  async function save(tb = activeTab(), force = false) {
    if (!tb || !tb.model) return;
    try {
      const r = await api("file", { method: "PUT", body: { path: tb.path, text: tb.model.getValue(), base: tb.mtime, bom: tb.bom, force } });
      tb.mtime = r.mtime; tb.saved = tb.model.getAlternativeVersionId(); tb.conflict = null; tb.preview = false;
      renderTabs(); renderTree(); renderBanner(); renderStatus(t("Saved"));
    } catch (e) {
      if (e.status === 409 || /değişti/.test(e.message)) { tb.conflict = { mtime: e.mtime || Date.now() }; renderTabs(); renderBanner(); ctx.toast(t("The file changed on disk; look at the diff first"), "bad"); }
      else ctx.toast(e.message, "bad");
    }
  }
  async function saveAll() { for (const t of P.tabs) if (isDirty(t)) await save(t); }
  function startPoll() { stopPoll(); pollT = setInterval(poll, 2500); }
  function stopPoll() { clearInterval(pollT); pollT = null; }
  async function poll() {
    if (!P || root.hidden || document.hidden) return;
    const texts = P.tabs.filter((t) => t.kind === "text"); if (!texts.length) return;
    let st; try { st = await api("stat", { method: "POST", body: { paths: texts.map((t) => t.path) } }); } catch { return; }
    for (const t of texts) {
      const s = st[t.path];
      if (!s) { if (!t.gone) { t.gone = true; renderBanner(); } continue; }
      t.gone = false;
      if (Math.abs(s.mtime - t.mtime) <= 1 || t.conflict) continue;
      if (!isDirty(t)) await reload(t, true);
      else { t.conflict = { mtime: s.mtime }; renderTabs(); if (t.path === P.active) renderBanner(); }
    }
  }
  async function reload(tb, quiet) {
    let d; try { d = await api(`file?path=${encodeURIComponent(tb.path)}`); } catch { return; }
    if (d.text == null) return;
    const view = tb.path === P.active && ed ? ed.saveViewState() : tb.view;
    tb.model.pushEditOperations([], [{ range: tb.model.getFullModelRange(), text: d.text }], () => null);
    tb.mtime = d.mtime; tb.saved = tb.model.getAlternativeVersionId(); tb.conflict = null;
    if (tb.path === P.active && view) ed.restoreViewState(view); else tb.view = view;
    renderTabs(); renderBanner();
    if (quiet) { renderStatus(t("Agent updated it: the version on disk was loaded")); flash(tb); }
  }
  function flash(t) { const el = $(`#ed-tabs .ed-tab[data-p="${CSS.escape(t.path)}"]`); el?.classList.add("flash"); setTimeout(() => el?.classList.remove("flash"), 1600); }
  function renderBanner() {
    const tb = activeTab(); const b = $("#ed-banner"); const busy = P && ctx.isBusyTeam(P.agent);
    if (tb?.conflict) {
      b.hidden = false; b.className = "ed-banner bad";
      b.innerHTML = `<span>${t("<b>{file} changed on disk</b> (probably written by the agent) and you have unsaved changes.", { file: esc(base(tb.path)) })}</span>
        <button type="button" class="btn ghost sm" data-ed="diff">${t("View diff")}</button><button type="button" class="btn ghost sm" data-ed="take">${t("Take the version on disk")}</button><button type="button" class="btn sm" data-ed="keep">${t("Save mine")}</button>`;
    } else if (tb?.gone) { b.hidden = false; b.className = "ed-banner bad"; b.innerHTML = `<span>${t("<b>{file} no longer exists on disk</b> (deleted or moved).", { file: esc(base(tb.path)) })}</span><button type="button" class="btn ghost sm" data-ed="keep">${t("Recreate")}</button>`; }
    else if (busy) { b.hidden = false; b.className = "ed-banner"; b.innerHTML = `<span><i class="dot st-tool"></i> ${t("The team is working in this project. If the agent writes to an open file it shows up here; if you have unsaved changes you will be warned.")}</span>`; }
    else b.hidden = true;
  }
  async function showDiff() {
    const tb = activeTab(); if (!tb) return;
    let d; try { d = await api(`file?path=${encodeURIComponent(tb.path)}`); } catch (e) { return ctx.toast(e.message, "bad"); }
    $("#ed-monaco").hidden = true; $("#ed-diff").hidden = false;
    // renderMarginRevertIcon: shows a ← arrow next to every change hunk on the right; clicking reverts that hunk to the left (on-disk) version
    if (!diffEd) diffEd = monaco.editor.createDiffEditor($("#ed-diff-host"), { theme: "ecelon", automaticLayout: true, readOnly: false, originalEditable: false, renderSideBySide: true, renderMarginRevertIcon: true, renderIndicators: true,
      fontFamily: "JetBrains Mono, Consolas, monospace", fontSize: 13, unicodeHighlight: { ambiguousCharacters: false } });
    const orig = monaco.editor.createModel(d.text ?? "", tb.model.getLanguageId());
    diffEd.getModel()?.original?.dispose();
    diffEd.setModel({ original: orig, modified: tb.model });
    tb.diffBase = d.mtime;
    $("#ed-diff-head").innerHTML = `<span>${t("<b>On the left the version on disk</b> (written by the agent), <b>on the right yours</b>. Hover over a hunk and press the <b>←</b> arrow that appears in the middle to revert that hunk to the agent's version; you can also edit the right side by hand.")}</span>
      <button type="button" class="btn ghost sm" data-ed="dprev" title="${t("Previous diff")}">↑</button><button type="button" class="btn ghost sm" data-ed="dnext" title="${t("Next diff")}">↓</button>
      <button type="button" class="btn ghost sm" data-ed="diffclose">${t("Back to editor")}</button><button type="button" class="btn primary sm" data-ed="mergesave" title="${t("Write the merged version on the right to disk")}">${t("Save merged")}</button>`;
    setTimeout(() => diffEd.goToDiff?.("next"), 300);
  }

  // ---------- status bar
  function renderStatus(msg) {
    const tb = activeTab(); const s = $("#ed-status");
    if (!tb) { s.innerHTML = ""; return; }
    const pos = tb.kind === "text" && ed ? ed.getPosition() : null;
    const lang = tb.model ? monaco.languages.getLanguages().find((l) => l.id === tb.model.getLanguageId())?.aliases?.[0] || tb.model.getLanguageId() : "";
    s.innerHTML = `<span class="es-path">${esc(tb.path)}</span>${msg ? `<span class="es-msg">${esc(msg)}</span>` : ""}<span class="cb-spacer"></span>` +
      (pos ? `<span>${t("Ln {line}, Col {col}", { line: pos.lineNumber, col: pos.column })}</span>` : "") + (tb.model ? `<span>${esc(lang)}</span><span>${tb.eol === "CRLF" ? "CRLF" : "LF"}</span><span>UTF-8${tb.bom ? " BOM" : ""}</span>` : "") +
      (tb.model ? `<span class="${isDirty(tb) ? "es-dirty" : "es-ok"}">${isDirty(tb) ? t("● Unsaved") : t("Saved")}</span>` : `<span>${t("{kind} · read-only", { kind: tb.kind === "image" ? t("Image") : tb.kind === "big" ? t("Too large") : t("Binary file") })}</span>`);
    if (msg) { clearTimeout(renderStatus.t); renderStatus.t = setTimeout(() => renderStatus(), 2500); }
  }

  // ---------- Ctrl+P quick open
  async function quickOpen() {
    const dlg = $("#dlg-qopen"), inp = $("#qo-q"), ul = $("#qo-list");
    if (!P.files) { try { P.files = (await api("all")).files; } catch (e) { return ctx.toast(e.message, "bad"); } }
    let idx = 0, rows = [];
    const score = (f, q) => { // simple fuzzy match: the letters must appear in order; name matches rank first
      if (!q) return 1; const lf = f.toLowerCase(), b = base(lf); let i = 0, s = 0, last = -2;
      for (const ch of q) { const j = lf.indexOf(ch, i); if (j < 0) return 0; s += j === last + 1 ? 3 : 1; if (j >= lf.length - b.length) s += 2; last = j; i = j + 1; }
      if (b.startsWith(q)) s += 20; if (b.includes(q)) s += 10; return s - f.length / 100;
    };
    const draw = () => {
      const q = inp.value.trim().toLowerCase().replace(/:\d+(?::\d+)?$/, "").replace(/\s+/g, ""); // "file:12" → go to line 12
      const recent = P.tabs.map((t) => t.path);
      rows = (q ? P.files.map((f) => [f, score(f, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([f]) => f) : [...recent, ...P.files.filter((f) => !recent.includes(f))].slice(0, 60));
      if (idx >= rows.length) idx = 0;
      ul.innerHTML = rows.map((f, i) => `<li role="option" aria-selected="${i === idx}" data-i="${i}"><i class="fi ${fileIcon(base(f))}"></i><b>${esc(base(f))}</b><span>${esc(dirOf(f))}</span></li>`).join("") || `<li class="sw-none">${t("No files found")}</li>`;
      ul.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    };
    const lineOf = () => { const m = /:(\d+)(?::(\d+))?\s*$/.exec(inp.value); return m ? { line: +m[1], col: m[2] ? +m[2] : 1 } : {}; };
    const go = (i) => { const f = rows[i]; if (!f) return; const { line, col } = lineOf(); dlg.close(); openFile(f, { pin: true, line, col }); };
    inp.value = ""; draw(); dlg.showModal(); inp.focus();
    inp.oninput = () => { idx = 0; draw(); };
    inp.onkeydown = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(rows.length - 1, idx + 1); draw(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(0, idx - 1); draw(); }
      else if (e.key === "Enter") { e.preventDefault(); go(idx); }
    };
    ul.onclick = (e) => { const li = e.target.closest("[data-i]"); if (li) go(+li.dataset.i); };
    dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  }

  // ---------- search in project
  function renderSide() {
    $("#ed-sidetabs").innerHTML = `<button type="button" data-st="files" aria-selected="${sideTab === "files"}">${t("Files")}</button><button type="button" data-st="search" aria-selected="${sideTab === "search"}">${t("Search")}</button>`;
    $("#ed-tree").hidden = sideTab !== "files"; $("#ed-search").hidden = sideTab !== "search"; $("#ed-treebar").hidden = sideTab !== "files";
    if (sideTab === "files") renderTree();
    else { const s = P.search; $("#es-q").value = s.q; $("#es-inc").value = s.include; $("#es-exc").value = s.exclude; for (const k of ["cs", "word", "regex"]) $(`#es-${k}`).setAttribute("aria-pressed", s[k]); }
  }
  function showSearch() {
    sideTab = "search"; renderSide();
    const sel = ed?.getModel() && ed.getSelection() && !ed.getSelection().isEmpty() ? ed.getModel().getValueInRange(ed.getSelection()) : "";
    if (sel && !sel.includes("\n")) { $("#es-q").value = sel; P.search.q = sel; runSearch(); }
    setTimeout(() => { $("#es-q").focus(); $("#es-q").select(); }, 20);
  }
  let searchSeq = 0, searchT;
  async function runSearch() {
    const s = P.search; const seq = ++searchSeq; const box = $("#es-results");
    if (!s.q) { box.innerHTML = ""; $("#es-sum").textContent = ""; return; }
    $("#es-sum").textContent = t("Searching…");
    let r; try { r = await api(`search?${new URLSearchParams({ q: s.q, cs: s.cs ? 1 : 0, word: s.word ? 1 : 0, regex: s.regex ? 1 : 0, include: s.include, exclude: s.exclude })}`); }
    catch (e) { if (seq === searchSeq) { $("#es-sum").textContent = e.message; box.innerHTML = ""; } return; }
    if (seq !== searchSeq) return;
    $("#es-sum").textContent = r.total ? `${t("{n} {n|result|results} in {files} {files|file|files}", { n: r.total, files: r.files })}${r.limited ? ` ${t("(first results; narrow the search)")}` : ""}` : t("No results");
    const hl = (h) => { let out = "", at = 0; for (const [a, b] of h.ranges) { const s1 = a - h.off, s2 = b - h.off; if (s1 < 0 || s1 >= h.text.length) continue; out += esc(h.text.slice(at, s1)) + `<mark>${esc(h.text.slice(s1, Math.min(s2, h.text.length)))}</mark>`; at = Math.min(s2, h.text.length); } return out + esc(h.text.slice(at)); };
    box.innerHTML = r.results.map((f) => `<details open class="es-file"><summary title="${esc(f.path)}"><i class="fi ${fileIcon(base(f.path))}"></i><b>${esc(base(f.path))}</b><span>${esc(dirOf(f.path))}</span><em>${f.hits.length}</em></summary>
      ${f.hits.map((h) => `<div class="es-hit" data-p="${esc(f.path)}" data-l="${h.line}" data-c="${h.col}"><small>${h.line}</small><code>${hl(h)}</code></div>`).join("")}</details>`).join("");
  }
  const schedSearch = () => { clearTimeout(searchT); searchT = setTimeout(runSearch, 280); };
  $("#es-q").addEventListener("input", (e) => { P.search.q = e.target.value; schedSearch(); });
  $("#es-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } });
  $("#es-inc").addEventListener("input", (e) => { P.search.include = e.target.value; schedSearch(); });
  $("#es-exc").addEventListener("input", (e) => { P.search.exclude = e.target.value; schedSearch(); });
  for (const k of ["cs", "word", "regex"]) $(`#es-${k}`).addEventListener("click", (e) => { P.search[k] = !P.search[k]; e.currentTarget.setAttribute("aria-pressed", P.search[k]); runSearch(); });
  $("#es-results").addEventListener("click", (e) => { const h = e.target.closest(".es-hit"); if (h) openFile(h.dataset.p, { line: +h.dataset.l, col: +h.dataset.c, pin: false }); });
  $("#ed-sidetabs").addEventListener("click", (e) => { const b = e.target.closest("[data-st]"); if (!b) return; if (b.dataset.st === "search") showSearch(); else { sideTab = "files"; renderSide(); } });

  // ---------- right click / file operations
  let menuEl = null;
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  function treeMenu(p, isDir, x, y) {
    closeMenu();
    const dir = isDir ? p : dirOf(p);
    const items = [
      [t("New file…"), () => newItem(dir, false)], [t("New folder…"), () => newItem(dir, true)],
      ...(p ? ["-", [t("Rename…"), () => renameItem(p)], [t("Copy path"), () => navigator.clipboard.writeText(p).then(() => ctx.toast(t("Copied")))],
        ...(!isDir ? [[t("Reference in chat (@)"), () => { ctx.insertRef(P.agent, p); close(); }]] : []),
        [t("Show in file manager"), () => ctx.openInFolder(P.agent, p)], "-", [t("Delete…"), () => deleteItem(p, isDir), "danger"]] : ["-", [t("Refresh"), () => refreshTree()]]),
    ];
    const m = document.createElement("div"); m.className = "pop lib-menu ctx-menu";
    if (p) { const t = document.createElement("p"); t.className = "lm-title"; t.textContent = base(p); m.append(t); }
    for (const it of items) { if (it === "-") { m.append(document.createElement("hr")); continue; } const b = document.createElement("button"); b.type = "button"; b.textContent = it[0]; if (it[2]) b.className = it[2]; b.onclick = () => { closeMenu(); it[1](); }; m.append(b); }
    document.body.append(m); menuEl = m;
    m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + "px"; m.style.top = Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) + "px";
  }
  document.addEventListener("pointerdown", (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  async function newItem(dir, isDir) {
    const name = (await ctx.prompt(isDir ? t("New folder") : t("New file"), isDir ? t("e.g. services") : t("e.g. src/utils/date.ts"), "", { ok: t("Create") }))?.trim(); if (!name) return;
    const p = (dir ? `${dir}/` : "") + name.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    try { await api("create", { method: "POST", body: { path: p, dir: isDir } }); P.expanded.add(dir); for (let d = dirOf(p); d; d = dirOf(d)) P.expanded.add(d); await refreshTree(); if (!isDir) openFile(p, { pin: true }); }
    catch (e) { ctx.toast(e.message, "bad"); }
  }
  async function renameItem(p) {
    const to = (await ctx.prompt(t("New name"), "", base(p), { ok: t("Rename") }))?.trim(); if (!to || to === base(p)) return;
    const np = (dirOf(p) ? `${dirOf(p)}/` : "") + to;
    try {
      await api("rename", { method: "POST", body: { from: p, to: np } });
      for (const t of P.tabs) if (t.path === p || t.path.startsWith(p + "/")) { const nn = np + t.path.slice(p.length); if (P.active === t.path) P.active = nn; t.path = nn; if (t.model) { const txt = t.model.getValue(); const dirty = isDirty(t); const old = t.model; t.model = monaco.editor.createModel(txt, undefined, monaco.Uri.parse(`file:///${P.agent.id}/${nn.split("/").map(encodeURIComponent).join("/")}`)); t.saved = dirty ? -1 : t.model.getAlternativeVersionId(); old.dispose(); } }
      await refreshTree(); showActive();
    } catch (e) { ctx.toast(e.message, "bad"); }
  }
  async function deleteItem(p, isDir) {
    if (!(await ctx.confirmBox({ title: t("Delete {name}?", { name: base(p) }), body: isDir ? t("The folder and its contents are moved to the station's trash; you can undo right after.") : t("The file is moved to the station's trash; you can undo right after."), ok: t("Delete"), danger: true }))) return;
    try {
      const r = await api("delete", { method: "POST", body: { path: p } });
      for (const t of [...P.tabs]) if (t.path === p || t.path.startsWith(p + "/")) { disposeTab(t); P.tabs.splice(P.tabs.indexOf(t), 1); if (P.active === t.path) P.active = P.tabs[0]?.path || null; }
      await refreshTree(); showActive();
      ctx.toast(t("{name} deleted", { name: base(p) }), "", { label: t("Undo"), fn: async () => { try { await api("restore", { method: "POST", body: { trash: r.trash } }); await refreshTree(); } catch (e) { ctx.toast(e.message, "bad"); } } });
    } catch (e) { ctx.toast(e.message, "bad"); }
  }

  // ---------- general events
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-ed]"); if (!b) return;
    const k = b.dataset.ed, tb = activeTab();
    if (k === "close") return close();
    if (k === "qopen") return quickOpen();
    if (k === "saveall") return saveAll();
    if (k === "refresh") return refreshTree();
    if (k === "newfile") return newItem(P.selDir ?? (P.active ? dirOf(P.active) : ""), false);
    if (k === "newdir") return newItem(P.selDir ?? (P.active ? dirOf(P.active) : ""), true);
    if (k === "collapse") { P.expanded = new Set([""]); return renderTree(); }
    if (k === "reveal" && tb) return ctx.openInFolder(P.agent, tb.path);
    if (k === "diff") return showDiff();
    if (k === "diffclose") return showActive();
    if (k === "take" && tb) return reload(tb);
    if (k === "keep" && tb) {
      if (tb.conflict && !(await ctx.confirmBox({ title: t("Overwrite the agent's change?"), body: t("{file} on disk will be replaced with your version; what the agent wrote is lost. Merging first with 'View diff' is safer.", { file: base(tb.path) }), ok: t("Overwrite"), alt: t("View diff"), danger: true }).then((r) => (r === "alt" ? (showDiff(), false) : r)))) return;
      tb.gone = false; return save(tb, true);
    }
    if (k === "dnext") return diffEd?.goToDiff?.("next");
    if (k === "dprev") return diffEd?.goToDiff?.("previous");
    if (k === "mergesave" && tb) { await save(tb, true); if (!isDirty(tb)) { ctx.toast(t("Merged version saved")); showActive(); } return; }
  });
  document.addEventListener("keydown", (e) => {
    if (root.hidden || document.querySelector("dialog[open]")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); if (e.shiftKey) saveAll(); else save(); }
    else if (mod && e.key.toLowerCase() === "p" && !e.shiftKey) { e.preventDefault(); quickOpen(); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); showSearch(); }
    else if (mod && e.key.toLowerCase() === "w") { e.preventDefault(); if (P.active) closeTab(P.active); }
    else if (mod && (e.key === "Tab" || e.key === "PageDown" || e.key === "PageUp") && P.tabs.length > 1) {
      e.preventDefault(); const i = P.tabs.findIndex((t) => t.path === P.active); const dir = e.key === "PageUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
      switchTo(P.tabs[(i + dir + P.tabs.length) % P.tabs.length].path);
    }
    else if (e.key === "Escape" && e.defaultPrevented) return;
    else if (e.key === "Escape" && menuEl) { e.preventDefault(); closeMenu(); }
    else if (e.key === "Escape" && !root.contains(document.activeElement?.closest(".monaco-editor"))) { e.preventDefault(); close(); }
  });
  addEventListener("beforeunload", (e) => { if (anyDirty()) { e.preventDefault(); e.returnValue = ""; } });

  return {
    open, close, get isOpen() { return !root.hidden; },
    hasDirty: anyDirty,
    onFs(ev) { const p = [...projects.values()].find((x) => (x.agent.team || x.agent.id) === ev.team); if (p) p.files = null; if (P && p === P && !root.hidden) { refreshTree(); poll(); } },
    onStatus(ev) { if (P && !root.hidden) { renderBanner(); poll(); if (ev?.status === "done" || ev?.status === "error") { P.files = null; refreshTree(); } } },
  };
}
