// JS Study: problems. A function to write, from easy to hard, judged by test calls that run in the sandbox: for every
// call the page shows what was expected and what the learner's code gave. Hints open one by one, the tutor can be
// asked for a nudge (never the answer), and the reference solution opens once the problem is solved, or on request.
// The rules for running and judging are in study-core.js (problemProgram, judgeProblem).
import { t } from "./i18n.js";
import * as core from "./study-core.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function createProblems(env) {
  // env: { $, content, progress, run, loadMonaco, tutorUI, toast, confirmBox, codeBlock, saveProblems, isOpen }
  const { $ } = env;
  let cur = null, ed = null, monaco = null, filter = 0, last = null, hintsShown = 0, saveT = 0, busy = false, built = false;
  const models = new Map();

  const LEVEL = () => ({ 1: t("Easy"), 2: t("Medium"), 3: t("Hard") });
  const all = () => [...(env.content().problems || [])].sort((a, b) => a.level - b.level);
  const state = () => (env.progress().problems ||= {});
  const of = (id) => (state()[id] ||= { solved: false, tries: 0, at: "", code: "", seen: false });
  const problem = () => all().find((x) => x.id === cur);
  const queueSave = () => { clearTimeout(saveT); saveT = setTimeout(flush, 1200); };
  const flush = () => { clearTimeout(saveT); saveT = 0; env.saveProblems(); };
  const levelChip = (n) => `<span class="sp-lv" data-lv="${n}">${esc(LEVEL()[n])}</span>`;

  /** The next problem not solved yet, in order of difficulty (for the Today screen and the "next" button). */
  const nextOpen = (after) => { const list = all(), from = after ? list.findIndex((x) => x.id === after) + 1 : 0; return list.slice(from).find((x) => !state()[x.id]?.solved) || list.find((x) => !state()[x.id]?.solved) || null; };

  function renderList() {
    const list = all(), solved = list.filter((x) => state()[x.id]?.solved).length, shown = list.filter((x) => !filter || x.level === filter);
    $("#sp-list").innerHTML = `<div class="sp-top"><b>${esc(t("{a} of {b} solved", { a: solved, b: list.length }))}</b>` +
      `<div class="sp-filter">${[0, 1, 2, 3].map((n) => `<button type="button" data-act="spfilter" data-lv="${n}" class="${filter === n ? "on" : ""}">${esc(n ? LEVEL()[n] : t("All"))}</button>`).join("")}</div></div>` +
      shown.map((x) => { const s = state()[x.id]; return `<button type="button" class="st-task sp-item${x.id === cur ? " on" : ""}" data-act="spopen" data-id="${esc(x.id)}">` +
        `<span><i class="st-mk" data-m="${s?.solved ? "done" : s?.tries ? "open" : "new"}">${s?.solved ? "✓" : ""}</i>${esc(x.title)}</span><small>${levelChip(x.level)}${x.tag ? " " + esc(x.tag) : ""}</small></button>`; }).join("");
  }

  function renderHead() {
    const k = problem(), s = of(k.id), examples = k.tests.slice(0, 2);
    $("#sp-head").innerHTML = `<div class="st-task-h"><h3>${esc(k.title)}</h3>${levelChip(k.level)}${s.solved ? `<span class="sp-solved">${esc(t("Solved"))}</span>` : ""}</div>` +
      `<p class="st-desc">${esc(k.description)}</p>` +
      `<div class="sp-ex">${examples.map((x) => `<div><code>${esc(x.call)}</code><span>→</span><code>${esc(JSON.stringify(x.expect))}</code></div>`).join("")}</div>` +
      (k.hints.length ? `<div class="st-hintbox"><ol>${k.hints.slice(0, hintsShown).map((h) => `<li>${esc(h)}</li>`).join("")}</ol>` +
        `<button type="button" class="btn ghost sm" data-act="sphint" ${hintsShown >= k.hints.length ? "disabled" : ""}>${esc(hintsShown >= k.hints.length ? t("All hints shown") : t("Show a hint ({a} of {b})", { a: hintsShown + 1, b: k.hints.length }))}</button></div>` : "");
  }

  function renderResult() {
    const box = $("#sp-result"), k = problem(), s = of(k.id);
    if (!last || last.id !== k.id) { box.hidden = true; box.innerHTML = ""; $("#sp-after").innerHTML = s.solved ? afterHtml(k, s) : ""; return; }
    const r = last.verdict;
    const head = r.timedOut ? t("Stopped after 3 seconds: is there a loop that never ends?") : !r.ran ? t("The code stopped before the tests could run") : r.ok ? t("All {n} tests passed", { n: r.total }) : t("{a} of {b} tests passed", { a: r.passed, b: r.total });
    box.hidden = false;
    box.innerHTML = `<p class="st-verdict ${r.ok ? "ok" : "bad"}">${esc(head)}</p>` +
      (r.errors.length ? `<div class="st-errs">${r.errors.map((e) => `<div class="st-l err">${esc(e)}</div>`).join("")}</div>` : "") +
      (r.ran ? `<div class="sp-rows">${r.rows.map((x) => `<div class="sp-row ${x.ok ? "ok" : "bad"}"><b>${x.ok ? "✓" : "✗"}</b><code>${esc(x.call)}</code>` +
        (x.ok ? "" : `<dl><dt>${esc(t("Expected"))}</dt><dd><code>${esc(x.want)}</code></dd><dt>${esc(x.error ? t("Error") : t("Yours"))}</dt><dd><code>${esc(x.error ?? x.got ?? "–")}</code></dd></dl>`) + `</div>`).join("")}</div>` : "") +
      (r.output.length ? `<div class="st-real"><h4>${esc(t("Your console output"))}</h4>${r.output.slice(0, 40).map((l) => `<div class="st-l">${esc(l) || "&nbsp;"}</div>`).join("")}</div>` : "");
    $("#sp-after").innerHTML = s.solved || s.seen ? afterHtml(k, s) : "";
  }
  // what opens once a problem is solved (or the solution was asked for): why it works, a reference solution, the next one
  function afterHtml(k, s) {
    const nx = nextOpen(k.id);
    return `<section class="sp-after">` + (k.explain ? `<h4>${esc(t("Why it works"))}</h4><p class="st-say">${esc(k.explain)}</p>` : "") +
      (k.solution ? `<h4>${esc(t("A reference solution"))}</h4>${env.codeBlock(k.solution)}` : "") +
      (s.solved && nx && nx.id !== k.id ? `<div class="st-q-b"><button type="button" class="btn primary" data-act="spopen" data-id="${esc(nx.id)}">${esc(t("Next problem"))}: ${esc(nx.title)}</button></div>` : "") + `</section>`;
  }

  function select(id) {
    const k = all().find((x) => x.id === id); if (!k || !ed) return;
    if (saveT) flush();
    cur = id; last = null; hintsShown = 0;
    let m = models.get(id);
    if (!m) { m = monaco.editor.createModel(of(id).code || k.starter, "javascript"); m.onDidChangeContent(() => { of(id).code = m.getValue(); queueSave(); }); models.set(id, m); }
    ed.setModel(m);
    $("#sp-tutor").hidden = true; $("#sp-tutor").innerHTML = "";
    renderList(); renderHead(); renderResult(); syncButtons();
    $("#sp-work").scrollTop = 0;
  }
  function syncButtons() {
    const k = problem(), s = k ? of(k.id) : null;
    $("#sp-run").disabled = busy; $("#sp-run").textContent = busy ? t("Running…") : t("Run the tests");
    $("#sp-ask").hidden = !last; $("#sp-solution").hidden = !k?.solution || !!(s?.solved || s?.seen);
  }

  async function run() {
    const k = problem(); if (!k || busy || !ed) return;
    const code = ed.getValue(); busy = true; syncButtons();
    const res = await env.run(core.problemProgram(code, k.tests));
    busy = false; if (!env.isOpen() || cur !== k.id) { syncButtons(); return; }
    const verdict = core.judgeProblem(k.tests, res.lines, res.timedOut), s = of(k.id);
    s.tries++; s.at = new Date().toISOString(); if (verdict.ok) s.solved = true;
    last = { id: k.id, verdict, code }; flush();
    renderList(); renderHead(); renderResult(); syncButtons();
    $("#sp-result").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function build() {
    $("#sp-work").innerHTML = `<div id="sp-head"></div><div id="sp-editor" class="st-editor sp-editor"></div>` +
      `<div class="st-run-b"><button type="button" id="sp-run" class="btn primary sm"></button><span class="sp-key">Ctrl+Enter</span>` +
      `<button type="button" id="sp-ask" class="btn ghost sm" hidden>${esc(t("Ask the tutor"))}</button>` +
      `<button type="button" id="sp-reset" class="btn ghost sm">${esc(t("Start over"))}</button>` +
      `<button type="button" id="sp-solution" class="btn ghost sm">${esc(t("Show the solution"))}</button></div>` +
      `<div id="sp-result" class="st-result" hidden></div><div id="sp-tutor" hidden></div><div id="sp-after"></div>`;
    $("#sp-run").onclick = run;
    $("#sp-reset").onclick = async () => { const k = problem(); if (!k) return; if (!(await env.confirmBox({ title: t("Start this problem over?"), body: t("Your code for this problem is replaced by the starting code."), ok: t("Start over") }))) return; models.get(k.id)?.setValue(k.starter); };
    $("#sp-solution").onclick = async () => { const k = problem(); if (!k) return; if (!(await env.confirmBox({ title: t("Open the solution?"), body: t("You learn more from one more try or a hint. The problem stays unsolved until your own code passes."), ok: t("Show the solution") }))) return; of(k.id).seen = true; flush(); renderResult(); syncButtons(); };
    $("#sp-ask").onclick = (e) => {
      const k = problem(); if (!k || !last) return; const r = last.verdict;
      const results = r.rows.map((x) => `${x.ok ? "PASS" : "FAIL"} ${x.call} expected ${x.want}${x.ok ? "" : x.error ? " threw " + x.error : " got " + x.got}`).join("\n") + (r.timedOut ? "\nTimed out after 3 seconds." : "") + (r.errors.length ? "\nErrors: " + r.errors.join(" | ") : "");
      e.currentTarget.hidden = true;
      env.tutorUI.mount($("#sp-tutor"), { base: { kind: "problem", problemId: k.id, code: last.code, results, solved: r.ok }, msgs: [] });
    };
    built = true;
  }

  async function open(id) {
    const list = all(), pane = $("#st-prob");
    if (!list.length) { $("#sp-list").innerHTML = ""; $("#sp-work").innerHTML = `<div class="lib-empty"><b>${esc(t("No problems yet"))}</b><p>${esc(t("Import a pack that has problems."))}</p><button type="button" class="btn primary sm" data-act="import">${esc(t("Import pack"))}</button></div>`; built = false; return; }
    if (!built) build();
    renderList();
    if (!ed) {
      try { monaco = await env.loadMonaco(); } catch (e) { $("#sp-editor").innerHTML = `<div class="lib-empty"><b>${esc(t("Could not load the editor"))}</b><p>${esc(e.message)}</p></div>`; return; }
      if (!env.isOpen() || pane.hidden || ed) return;
      let px = 14; try { const v = Number(localStorage.getItem("ecelon.practiceFont")); if (v >= 8 && v <= 40) px = v; } catch { /* storage off */ }
      ed = monaco.editor.create($("#sp-editor"), { model: null, theme: "ecelon", automaticLayout: true, fontFamily: "JetBrains Mono, Consolas, monospace", fontSize: px, mouseWheelZoom: false, minimap: { enabled: false }, scrollBeyondLastLine: false, tabSize: 2, padding: { top: 10 }, unicodeHighlight: { ambiguousCharacters: false } });
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => run());
    }
    select(id && list.some((x) => x.id === id) ? id : cur && list.some((x) => x.id === cur) ? cur : (nextOpen() || list[0]).id);
  }

  /** A click inside the problems pane. Returns true when it was one of ours. */
  function click(act, el) {
    switch (act) {
      case "spopen": if (ed) select(el.dataset.id); else open(el.dataset.id); return true;
      case "spfilter": filter = Number(el.dataset.lv); renderList(); return true;
      case "sphint": { const k = problem(); if (k && hintsShown < k.hints.length) { hintsShown++; renderHead(); } return true; }
      default: return false;
    }
  }
  function dispose() { if (saveT) flush(); for (const m of models.values()) m.dispose(); models.clear(); ed?.dispose(); ed = null; built = false; last = null; }

  return { open, click, dispose, nextOpen, run, get count() { return all().length; }, get solved() { return all().filter((x) => state()[x.id]?.solved).length; } };
}
