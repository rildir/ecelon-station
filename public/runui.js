// Run panel: commands (saved + suggested from the project), live output, stop/restart, a simple terminal
// and "Problems": the file:line list extracted from build/lint output (click to open in the editor).
import { t } from "./i18n.js";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ago = (ts) => { const s = (Date.now() - ts) / 1000; return s < 60 ? t("just now") : s < 3600 ? t("{n} min ago", { n: Math.floor(s / 60) }) : t("{n} h ago", { n: Math.floor(s / 3600) }); };

// ANSI colors → HTML (only basic SGR: color, bold, reset)
const COLORS = ["#4b5275", "#ff6b81", "#7ee2a8", "#ffd27a", "#6fb6ff", "#d79bff", "#6fe3ff", "#e6e8f5"];
const BRIGHT = ["#8f8ab4", "#ff8095", "#9ff2c4", "#ffe29a", "#9ccfff", "#e4b8ff", "#9ff0ff", "#ffffff"];
function ansiLine(line) {
  let out = "", open = false, st = {};
  const style = () => { const css = []; if (st.fg) css.push(`color:${st.fg}`); if (st.bold) css.push("font-weight:700"); if (st.dim) css.push("opacity:.6"); return css.join(";"); };
  const parts = String(line).replace(/\x1b\][^\x07]*\x07/g, "").split(/\x1b\[([0-9;]*)m/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { const txt = parts[i].replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""); if (txt) out += open ? esc(txt) : esc(txt); continue; }
    const codes = parts[i].split(";").filter(Boolean).map(Number); if (!codes.length) codes.push(0);
    for (const c of codes) {
      if (c === 0) st = {}; else if (c === 1) st.bold = true; else if (c === 2) st.dim = true; else if (c === 22) { st.bold = st.dim = false; }
      else if (c >= 30 && c <= 37) st.fg = COLORS[c - 30]; else if (c >= 90 && c <= 97) st.fg = BRIGHT[c - 90]; else if (c === 39) st.fg = null;
    }
    if (open) out += "</span>";
    const css = style(); open = !!css; if (open) out += `<span style="${css}">`;
  }
  if (open) out += "</span>";
  return out;
}

export function createRuns(ctx) {
  // ctx: { api, toast, confirmBox, prompt, onOpen, onClose, openCode(agent, file, line, col), sendFix(agent, text), onCount(team, n) }
  const root = $("#runs");
  // docked: bottom panel like in VS Code (chat and scene stay visible); toggles with full screen
  let docked = (() => { try { return localStorage.getItem("runs.docked") === "1"; } catch { return false; } })();
  let agent = null, team = null, data = { commands: [], detected: [], runs: [] }, sel = null, tab = "out", out = null, hist = [], hi = -1, probs = [];
  const T = () => encodeURIComponent(agent.id);

  async function open(a, { tab: tb } = {}) {
    agent = a; team = a.team || a.id; root.hidden = false; root.classList.toggle("docked", docked); ctx.onOpen?.(docked);
    if (tb) tab = tb;
    $("#rn-title").textContent = a.name; renderDock();
    await load();
    if (!sel) sel = data.runs.find((r) => r.status === "running")?.id || data.runs[0]?.id || null;
    await select(sel);
    setTimeout(() => $("#rn-input").focus({ preventScroll: true }), 30);
  }
  function close() { root.hidden = true; agent = null; ctx.onClose?.(); }
  function renderDock() { const b = $("#rn-dock"); if (b) { b.textContent = docked ? t("Full screen") : t("Dock at the bottom"); b.title = docked ? t("Make the panel full screen") : t("Keep the chat and the station visible (like the bottom panel in VS Code)"); } }
  async function load() {
    try { data = await ctx.api(`/api/agents/${T()}/run`); } catch (e) { ctx.toast(e.message, "bad"); }
    renderSide(); await loadProblems();
  }
  async function loadProblems() {
    try { probs = (await ctx.api(`/api/agents/${T()}/problems`)).groups; } catch { probs = []; }
    renderTabs(); if (tab === "problems") renderProblems();
  }

  // ---------- left: commands and runs
  function renderSide() {
    const running = new Map(data.runs.filter((r) => r.status === "running").map((r) => [r.cmd + "|" + r.dir, r]));
    const btn = (c) => { const r = running.get(c.cmd + "|" + (c.dir || "")); return r ? `<button type="button" class="rn-play stop" data-stop="${r.id}" title="${t("Stop")}"><svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg></button>` : `<button type="button" class="rn-play" data-run title="${t("Run")}"><svg viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5z"/></svg></button>`; };
    const row = (c, saved) => `<div class="rn-cmd" data-cid="${esc(c.id)}" data-saved="${saved ? 1 : ""}" title="${esc(c.cmd)}${c.dir ? `  ${t("(folder: {dir})", { dir: esc(c.dir) })}` : ""}">${btn(c)}<span><b>${esc(c.label)}</b><code>${esc(c.cmd)}</code></span>${c.check ? `<em title="${t("Its output is parsed into the Problems list")}">${t("check")}</em>` : ""}${saved ? "" : `<button type="button" class="rn-save" data-save title="${t("Add to my commands")}">+</button>`}</div>`;
    const savedSet = new Set(data.commands.map((c) => c.cmd + "|" + (c.dir || "")));
    const det = data.detected.filter((c) => !savedSet.has(c.cmd + "|" + (c.dir || "")));
    $("#rn-cmds").innerHTML =
      `<h5>${t("My commands")} <button type="button" class="linkish" data-add>${t("+ Add")}</button></h5>` +
      (data.commands.length ? data.commands.map((c) => row(c, true)).join("") : `<p class="rn-hint">${t("Add the commands you run often; you can also take them from the suggested ones with <b>+</b>.")}</p>`) +
      (det.length ? `<h5>${t("Found in the project")}</h5>` + det.map((c) => row(c, false)).join("") : "") +
      `<h5>${t("Runs")}</h5>` + (data.runs.length ? data.runs.map((r) => `<div class="rn-run${r.id === sel ? " active" : ""}" data-rid="${r.id}">
        <i class="dot ${r.status === "running" ? "st-tool" : r.stopped ? "st-idle" : r.code === 0 ? "st-done" : "st-error"}"></i><span><b>${esc(r.label)}</b><small>${r.status === "running" ? t("running") : r.stopped ? t("stopped") : r.code === 0 ? t("finished (success)") : t("finished (error, code {code})", { code: r.code })} · ${ago(r.startedAt)}${r.problems ? ` · ${t("{n} {n|problem|problems}", { n: r.problems })}` : ""}</small></span>
        ${r.url ? `<button type="button" class="rn-url" data-url="${esc(r.url)}" title="${t("Open in browser")}">${esc(r.url.replace(/^https?:\/\//, ""))}</button>` : ""}</div>`).join("") : `<p class="rn-hint">${t("You have not run anything yet.")}</p>`);
    const n = data.runs.filter((r) => r.status === "running").length; ctx.onCount?.(team, n);
  }
  const cmdById = (id) => data.commands.find((c) => c.id === id) || data.detected.find((c) => c.id === id);
  async function runCmd(c) {
    try { const r = await ctx.api(`/api/agents/${T()}/run/start`, { method: "POST", body: { cmd: c.cmd, label: c.label, dir: c.dir || "", check: c.check } }); sel = r.id; tab = "out"; await load(); await select(r.id); }
    catch (e) { ctx.toast(e.message, "bad"); }
  }
  async function stopRun(id) { try { await ctx.api(`/api/agents/${T()}/run/${id}/stop`, { method: "POST" }); } catch (e) { ctx.toast(e.message, "bad"); } }
  async function saveCmds(list) { try { data.commands = (await ctx.api(`/api/agents/${T()}/run/commands`, { method: "PUT", body: { commands: list } })).commands; renderSide(); } catch (e) { ctx.toast(e.message, "bad"); } }
  async function editCmd(c) {
    const cmd = (await ctx.prompt(c ? t("Command") : t("New command"), t("e.g. npm run dev"), c?.cmd || "", { ok: t("Next") }))?.trim(); if (!cmd) return;
    const label = (await ctx.prompt(t("Button name"), t("e.g. Start the frontend"), c?.label || cmd.replace(/^npm run /, ""), { ok: t("Next") }))?.trim(); if (!label) return;
    const dir = (await ctx.prompt(t("In which folder? (relative to the project root; empty = root)"), t("e.g. frontend"), c?.dir || "", { ok: t("Save") })) ?? "";
    const item = { id: c?.id, label, cmd, dir: dir.trim(), check: /build|lint|tsc|typecheck|type-check|test/i.test(cmd) };
    await saveCmds(c ? data.commands.map((x) => (x.id === c.id ? { ...x, ...item } : x)) : [...data.commands, item]);
  }

  // ---------- right: output
  async function select(id) {
    sel = id; renderSide();
    const box = $("#rn-out");
    if (!id) { out = null; $("#rn-head").innerHTML = `<b>${t("Output")}</b><span>${t("Run a command on the left or type one below.")}</span>`; box.innerHTML = ""; updInput(); return; }
    try { out = await ctx.api(`/api/agents/${T()}/run/${id}`); } catch { out = null; return select(null); }
    box.innerHTML = out.lines.map((l) => `<div>${ansiLine(l) || "&nbsp;"}</div>`).join("");
    box.scrollTop = box.scrollHeight; renderHead(); updInput();
    if (tab === "out") showTab("out");
  }
  function renderHead() {
    if (!out) return;
    const run = out.status === "running";
    $("#rn-head").innerHTML = `<i class="dot ${run ? "st-tool" : out.stopped ? "st-idle" : out.code === 0 ? "st-done" : "st-error"}"></i><b>${esc(out.label)}</b><code>${esc(out.cmd)}${out.dir ? ` · ${esc(out.dir)}` : ""}</code>
      <span class="cb-spacer"></span>${out.url ? `<button type="button" class="btn ghost sm" data-url="${esc(out.url)}">${t("Open in browser")}</button>` : ""}
      ${run ? `<button type="button" class="btn ghost sm" data-act="stop">${t("Stop")}</button>` : `<button type="button" class="btn ghost sm" data-act="rerun">${t("Run again")}</button>`}
      <button type="button" class="btn ghost sm" data-act="copy" title="${t("Copy output")}">${t("Copy")}</button>
      <button type="button" class="btn ghost sm" data-newterm title="${t("This process keeps running; you can type a new command below")}">${t("+ New command")}</button>
      ${run ? "" : `<button type="button" class="btn ghost sm" data-act="remove" title="${t("Remove from the list")}">${t("Remove")}</button>`}`;
  }
  function updInput() {
    const run = out?.status === "running";
    $("#rn-input").placeholder = run ? t("Type to the running process (e.g. y, Enter)… · press Stop first for a new command") : t("Type a command and press Enter (runs in the project folder) · ↑ previous commands");
    $("#rn-mode").textContent = run ? "stdin" : "$";
  }
  function onOut(ev) {
    if (!out || ev.id !== out.id || root.hidden) return;
    const box = $("#rn-out"); const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const frag = document.createDocumentFragment();
    for (const l of ev.lines) { const d = document.createElement("div"); d.innerHTML = ansiLine(l) || "&nbsp;"; frag.append(d); }
    box.append(frag);
    while (box.childElementCount > 4000) box.firstElementChild.remove();
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
  $("#rn-input").addEventListener("keydown", async (e) => {
    const inp = e.target;
    if (e.key === "ArrowUp" && hist.length && !(out?.status === "running")) { e.preventDefault(); hi = Math.min(hist.length - 1, hi + 1); inp.value = hist[hist.length - 1 - hi]; return; }
    if (e.key === "ArrowDown" && hi >= 0) { e.preventDefault(); hi--; inp.value = hi >= 0 ? hist[hist.length - 1 - hi] : ""; return; }
    if (e.key !== "Enter") return;
    e.preventDefault(); const v = inp.value; if (!v.trim() && !(out?.status === "running")) return;
    inp.value = ""; hi = -1;
    try {
      if (out?.status === "running") await ctx.api(`/api/agents/${T()}/run/${out.id}/input`, { method: "POST", body: { text: v } });
      else { hist.push(v.trim()); hist = hist.slice(-50); await runCmd({ cmd: v.trim(), label: v.trim().slice(0, 40), dir: "" }); }
    } catch (err) { ctx.toast(err.message, "bad"); }
  });

  // ---------- problems
  function renderTabs() {
    const n = probs.reduce((s, g) => s + g.items.filter((x) => x.severity === "error").length, 0), w = probs.reduce((s, g) => s + g.items.filter((x) => x.severity !== "error").length, 0);
    $("#rn-tabs").innerHTML = `<button type="button" data-tab="out" aria-selected="${tab === "out"}">${t("Output")}</button><button type="button" data-tab="problems" aria-selected="${tab === "problems"}">${t("Problems")} <span class="${n ? "bad" : w ? "warn" : ""}">${n || w ? `${n}${w ? ` / ${t("{n} {n|warning|warnings}", { n: w })}` : ""}` : "0"}</span></button>`;
  }
  function showTab(name) { tab = name; renderTabs(); $("#rn-outwrap").hidden = name !== "out"; $("#rn-probs").hidden = name !== "problems"; if (name === "problems") renderProblems(); }
  function renderProblems() {
    const box = $("#rn-probs"); const checks = [...data.commands, ...data.detected].filter((c) => c.check);
    const all = probs.flatMap((g) => g.items.map((x) => ({ ...x, src: g.label })));
    const head = `<div class="pb-top"><span>${all.length ? t("{errors} errors, {warnings} {warnings|warning|warnings} · {sources}", { errors: all.filter((x) => x.severity === "error").length, warnings: all.filter((x) => x.severity !== "error").length, sources: probs.map((g) => esc(g.label)).join(", ") }) : probs.length ? t("No problems found in the last check.") : t("No check has been run yet.")}</span><span class="cb-spacer"></span>
      ${checks.length ? `<select id="pb-check">${checks.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join("")}</select><button type="button" class="btn ghost sm" data-act="check">${t("Check")}</button>` : ""}
      ${all.length ? `<button type="button" class="btn primary sm" data-act="fix" title="${t("Have the team lead fix the errors")}">${t("Have the team fix")}</button>` : ""}</div>`;
    if (!all.length) { box.innerHTML = head + `<div class="lv-none"><b>${probs.length ? t("Clean") : t("Problem list is empty")}</b><p>${t("When you run a build, type check or lint command, the errors in its output are listed here as file:line; click one to open it in the editor.")}</p></div>`; return; }
    const byFile = new Map(); for (const x of all) { if (!byFile.has(x.file)) byFile.set(x.file, []); byFile.get(x.file).push(x); }
    box.innerHTML = head + [...byFile].map(([f, items]) => `<details open class="pb-file"><summary><b>${esc(f.split("/").pop())}</b><span>${esc(f)}</span><em>${items.length}</em></summary>
      ${items.map((x) => `<div class="pb-item sv-${x.severity}" data-f="${esc(x.file)}" data-l="${x.line}" data-c="${x.col}"><i></i><span>${esc(x.message)}${x.code ? ` <code>${esc(x.code)}</code>` : ""}</span><small>${x.line}:${x.col}</small></div>`).join("")}</details>`).join("");
  }

  // ---------- events
  root.addEventListener("click", async (e) => {
    const el = e.target;
    if (el.closest("[data-close]")) return close();
    if (el.closest("[data-dock]")) { docked = !docked; try { localStorage.setItem("runs.docked", docked ? "1" : "0"); } catch {} root.classList.toggle("docked", docked); ctx.onDock?.(docked); renderDock(); return; }
    if (el.closest("[data-newterm]")) { tab = "out"; showTab("out"); await select(null); $("#rn-input").focus(); return; }
    const tb = el.closest("[data-tab]"); if (tb) return showTab(tb.dataset.tab);
    const url = el.closest("[data-url]"); if (url) { e.stopPropagation(); return ctx.api("/api/open-url", { method: "POST", body: { url: url.dataset.url } }).catch((err) => ctx.toast(err.message, "bad")); }
    const st = el.closest("[data-stop]"); if (st) { e.stopPropagation(); return stopRun(st.dataset.stop); }
    if (el.closest("[data-add]")) return editCmd(null);
    const cm = el.closest(".rn-cmd");
    if (cm) {
      const c = cmdById(cm.dataset.cid);
      if (el.closest("[data-save]")) return saveCmds([...data.commands, { label: c.label, cmd: c.cmd, dir: c.dir, check: c.check }]);
      if (el.closest("[data-run]") || !el.closest("button")) {
        const r = data.runs.find((x) => x.cmd === c.cmd && (x.dir || "") === (c.dir || "") && x.status === "running");
        return r ? select(r.id) : runCmd(c);
      }
    }
    const rr = el.closest(".rn-run"); if (rr) { tab = "out"; return select(rr.dataset.rid); }
    const pi = el.closest(".pb-item"); if (pi) return ctx.openCode(agent, pi.dataset.f, +pi.dataset.l, +pi.dataset.c);
    const act = el.closest("[data-act]")?.dataset.act;
    if (act === "stop" && out) return stopRun(out.id);
    if (act === "rerun" && out) return runCmd({ cmd: out.cmd, label: out.label, dir: out.dir, check: out.check });
    if (act === "copy" && out) return navigator.clipboard.writeText($("#rn-out").innerText).then(() => ctx.toast(t("Copied")));
    if (act === "remove" && out) { await ctx.api(`/api/agents/${T()}/run/${out.id}`, { method: "DELETE" }).catch(() => {}); sel = null; await load(); return select(data.runs[0]?.id || null); }
    if (act === "check") { const c = cmdById($("#pb-check").value); if (c) { await runCmd({ ...c, check: true }); tab = "problems"; } return; }
    if (act === "fix") {
      const all = probs.flatMap((g) => g.items).slice(0, 60);
      const text = t("Fix these build/lint errors (from the Problems panel, {n} {n|entry|entries}):", { n: all.length }) + "\n\n" + all.map((x) => `- ${x.file}:${x.line}:${x.col} [${x.severity}${x.code ? " " + x.code : ""}] ${x.message}`).join("\n") +
        "\n\n" + t("After fixing, run the same check again and confirm no errors remain; write a short summary.");
      ctx.sendFix(agent, text); close(); return;
    }
  });
  root.addEventListener("contextmenu", (e) => {
    const cm = e.target.closest('.rn-cmd[data-saved="1"]'); if (!cm) return;
    e.preventDefault(); const c = cmdById(cm.dataset.cid);
    (async () => {
      const ok = await ctx.confirmBox({ title: c.label, body: `${c.cmd}${c.dir ? `\n${t("Folder: {dir}", { dir: c.dir })}` : ""}\n\n${t("Do you want to edit or delete this command?")}`, ok: t("Edit") });
      if (ok) return editCmd(c);
      if (await ctx.confirmBox({ title: t("Delete {name}?", { name: c.label }), body: t("It is only removed from the saved command list."), ok: t("Delete"), danger: true })) saveCmds(data.commands.filter((x) => x.id !== c.id));
    })();
  });
  document.addEventListener("keydown", (e) => { if (!root.hidden && e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open]")) { e.preventDefault(); close(); } });

  let reloadT;
  return {
    open, close, get isOpen() { return !root.hidden; },
    onEvent(ev) {
      if (ev.type === "run-out") return onOut(ev);
      if (ev.type === "run") {
        if (agent && ev.team === team && !root.hidden) {
          clearTimeout(reloadT); reloadT = setTimeout(async () => { await load(); if (out && ev.id === out.id) { try { out = { ...out, ...(await ctx.api(`/api/agents/${T()}/run/${out.id}`)), lines: undefined }; } catch {} renderHead(); updInput(); } }, 150);
        } else if (ev.status) ctx.refreshCount?.(ev.team);
      }
    },
  };
}
