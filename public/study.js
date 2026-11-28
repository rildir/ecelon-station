// JS Study: a personal study room for JavaScript — a map of topics with their state, click-through quizzes, coding
// tasks with a guess-first rule, a cheat sheet with the user's own notes, and content packs that can be imported.
// Everything is local: the content and the progress live in data/study.json on this computer (server/study.js).
// Nothing runs while the module is closed: the code sandbox, the editor and the listeners are created when they
// are needed and taken away when the module closes. The rules (status of a topic, streak, what a warm-up holds,
// comparing output) are in study-core.js.
import { t, locale } from "./i18n.js";
import { loadMonaco } from "./editor.js";
import { FRAME } from "./practice.js";
import * as core from "./study-core.js";
import { createLearn } from "./study-learn.js";
import { createTutor } from "./study-tutor.js";
import { createProblems } from "./study-problems.js";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const LIMIT_MS = 3000;

// ---- the sandbox: the code runs in the same kind of worker the Playground uses, in a frame of its own. The code is
// started with a few lines that count its timers, so a run is over when the code has returned and no timer is left.
const PRE = [
  "(()=>{const S=self.setTimeout.bind(self),C=self.clearTimeout.bind(self),SI=self.setInterval.bind(self),CI=self.clearInterval.bind(self),open=new Set(),tell=()=>postMessage({kind:'timers',n:open.size});",
  "self.setTimeout=(f,ms,...a)=>{if(typeof f!=='function')return S(f,ms);let id;id=S(()=>{open.delete(id);try{f(...a)}finally{tell()}},ms);open.add(id);tell();return id};",
  "self.clearTimeout=(id)=>{C(id);if(open.delete(id))tell()};",
  "self.setInterval=(f,ms,...a)=>{if(typeof f!=='function')return SI(f,ms);const id=SI(()=>f(...a),ms);open.add(id);tell();return id};",
  "self.clearInterval=(id)=>{CI(id);if(open.delete(id))tell()};})();",
].join("");

function createRunner(host) {
  let frame = null, ready = null, readyOk = null, seq = 0, cur = null;
  const onMsg = (ev) => {
    const m = ev.data; if (!m || typeof m !== "object" || !("practice" in m) || !frame || ev.source !== frame.contentWindow) return;
    if (m.kind === "ready") readyOk?.(); else if (cur && cur.id === m.practice) cur.on(m);
  };
  function ensure() {
    if (ready) return ready;
    ready = new Promise((ok) => { readyOk = ok; frame = document.createElement("iframe"); frame.setAttribute("sandbox", "allow-scripts"); frame.setAttribute("aria-hidden", "true"); frame.tabIndex = -1; frame.className = "st-frame"; addEventListener("message", onMsg); frame.srcdoc = FRAME; host.append(frame); });
    return ready;
  }
  /** Runs the code; resolves with { lines: [{ kind, text }], timedOut } when the code and its timers are done, or after 3 seconds. */
  async function run(code) {
    await ensure(); cur?.end();
    return new Promise((resolve) => {
      const id = ++seq, lines = []; let timers = 0, done = false, quiet = 0, finished = false;
      const end = (timedOut) => { if (finished) return; finished = true; clearTimeout(quiet); clearTimeout(cap); frame?.contentWindow?.postMessage({ cmd: "stop" }, "*"); if (cur?.id === id) cur = null; resolve({ lines, timedOut }); };
      const settle = () => { clearTimeout(quiet); if (done && timers === 0) quiet = setTimeout(() => end(false), 150); }; // a short quiet time: a promise may still be about to print
      const cap = setTimeout(() => end(true), LIMIT_MS);
      cur = { id, end: () => end(false), on(m) { if (m.kind === "timers") timers = m.n; else if (m.kind === "done") done = true; else if (m.kind === "clear") lines.length = 0; else if (m.kind !== "sync") lines.push({ kind: m.kind, text: String(m.text ?? "") }); settle(); } };
      frame.contentWindow.postMessage({ cmd: "run", run: id, code: PRE + code }, "*");
    });
  }
  function dispose() { cur?.end(); removeEventListener("message", onMsg); frame?.remove(); frame = ready = readyOk = null; }
  return { run, dispose };
}

// ---- code shown one line at a time, with a few colours
const KW = "const|let|var|function|return|if|else|for|while|do|new|class|extends|async|await|true|false|null|undefined|this|throw|try|catch|finally|of|in|typeof|instanceof|break|continue|switch|case|default|yield|import|export|static|super|void|delete";
const TOKEN = new RegExp(`(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|\\b(${KW})\\b|\\b(\\d+(?:\\.\\d+)?)\\b`, "g");
function codeLines(code) {
  const lines = [[]]; let at = 0;
  const add = (txt, cls) => txt.split("\n").forEach((part, i) => { if (i) lines.push([]); if (part) lines[lines.length - 1].push(cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part)); });
  for (const m of String(code).matchAll(TOKEN)) { add(code.slice(at, m.index)); add(m[0], m[1] ? "c" : m[2] ? "s" : m[3] ? "k" : "n"); at = m.index + m[0].length; }
  add(code.slice(at));
  return lines.map((l) => l.join(""));
}
const codeBlock = (code) => `<div class="st-code" role="region" tabindex="0" aria-label="${esc(t("Code"))}">${codeLines(code).map((l, i) => `<div class="st-cl"><i>${i + 1}</i><span>${l || " "}</span></div>`).join("")}</div>`;

const statusLabel = (s) => ({ oturdu: t("Settled"), orta: t("Getting there"), zayif: t("Weak"), yeni: t("New"), tekrar: t("Review due") }[s] || s);
const chip = (s) => `<span class="st-s" data-s="${s}">${esc(statusLabel(s))}</span>`;
const firstLine = (code) => String(code).split("\n").find((l) => l.trim()) || "";

export function createStudy(ctx) {
  // ctx: { api, toast, confirmBox, onOpen, onClose }
  const root = $("#study");
  let data = null, tab = "today", sel = null, quiz = null, runner = null, monaco = null, ed = null, taskId = null, shown = 0, last = null, busy = false, saveT = 0, noteTopic = "genel";
  let opened = false;
  const models = new Map(), today = () => core.dayKey(), loc = () => locale();
  const content = () => data.content, progress = () => data.progress;
  const states = () => core.allStates(content(), progress().answers, today());
  const topicOf = (id) => content().topics.find((x) => x.id === id);
  const titleOf = (id) => (id === "genel" ? t("General") : topicOf(id)?.title || id);
  const save = (path, body, method = "POST") => ctx.api("/api/study" + path, { method, body }).catch((e) => { ctx.toast(t("Could not save: {msg}", { msg: e.message }), "bad"); });
  const copy = async (text, ok) => { try { await navigator.clipboard.writeText(text); ctx.toast(ok, "ok"); } catch { ctx.toast(t("Could not copy"), "bad"); } };
  const nice = (d) => new Date(d).toLocaleDateString(loc(), { day: "numeric", month: "short" });
  // the tutor (study-tutor.js): conversations are drawn there; a plain question with a busy button is asked here
  const tutorUI = createTutor({ api: ctx.api, toast: ctx.toast, lang: () => (loc().startsWith("tr") ? "tr" : "en") });
  async function askWith(btn, body) {
    const label = btn.textContent; btn.disabled = true; btn.textContent = t("The tutor is thinking…");
    try { return await tutorUI.ask(body); } finally { btn.disabled = false; btn.textContent = label; }
  }
  const flat = (x) => String(x).replace(/\s+/g, " ").trim();

  // ---------------------------------------------------------------- open / close / tabs
  async function open() {
    root.hidden = false; ctx.onOpen?.();
    try { data = await ctx.api("/api/study"); } catch (e) { ctx.toast(t("Could not open JS Study: {msg}", { msg: e.message }), "bad"); close(); return; }
    if (!sel || !topicOf(sel)) sel = null;
    if (!opened) { opened = true; try { tab = localStorage.getItem("ecelon.study.tab") || "today"; } catch { tab = "today"; } if (tab === "code" || tab === "prob") tab = "today"; }
    setTab(tab);
  }
  function close() {
    if (saveT) flushDrafts(); prob.dispose(); runner?.dispose(); runner = null;
    for (const m of models.values()) m.dispose(); models.clear(); ed?.dispose(); ed = null; taskId = null; // nothing of the module is left running
    root.hidden = true; ctx.onClose?.();
  }
  // The room has four places: Today, Learn, Practice (quiz, say it, code) and Notes. Each keeps where it was scrolled.
  const PANES = ["today", "learn", "quiz", "say", "code", "prob", "tips"], PRACTICE = ["quiz", "say", "code", "prob"], scrolls = new Map();
  let practice = "quiz";
  function setTab(name, focus, quiet) {
    if (!PANES.includes(name)) name = "today";
    const changed = name !== tab, before = $("#st-" + tab);
    if (changed && before) scrolls.set(tab, before.scrollTop);
    tab = name; if (PRACTICE.includes(name)) practice = name;
    try { localStorage.setItem("ecelon.study.tab", name); } catch { /* the place is remembered only when the browser allows it */ }
    const top = PRACTICE.includes(name) ? "practice" : name;
    for (const b of root.querySelectorAll("#st-tabs [data-tab]")) { const on = b.dataset.tab === top; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); }
    for (const b of root.querySelectorAll("#st-sub [data-tab]")) { const on = b.dataset.tab === name; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); }
    $("#st-sub").hidden = top !== "practice";
    for (const p of PANES) $("#st-" + p).hidden = p !== name;
    const pane = $("#st-" + name);
    if (!quiet) ({ today: () => learn.renderToday(pane), learn: () => learn.renderLearn(pane, focus), quiz: renderQuiz, say: renderSay, code: openCode, prob: () => prob.open(focus), tips: renderTips })[name]();
    if (changed) { pane.classList.remove("st-in"); void pane.offsetWidth; pane.classList.add("st-in"); if (name !== "learn" || focus === undefined) pane.scrollTop = name === "today" ? 0 : scrolls.get(name) || 0; }
    renderStrip();
  }
  const empty = () => `<div class="lib-empty"><b>${esc(t("No content yet"))}</b><p>${esc(t("Import a content pack (a JSON file) to get topics, questions and tasks."))}</p><button type="button" class="btn primary sm" data-act="import">${esc(t("Import pack"))}</button></div>`;
  const hasContent = () => content().topics.length || content().questions.length || content().tasks.length || (content().problems || []).length;

  // ---------------------------------------------------------------- 1. today, the path and the lessons (study-learn.js)
  function reason(s) {
    if (!s.total) return t("Starting status from the content pack. It updates as you answer.");
    return { oturdu: t("Right on 3 different days in a row. It comes back for a repeat after {d} days.", { d: core.REPEAT_DAYS }), tekrar: t("Settled, but not asked for {d} days or more. Answer it once more.", { d: core.REPEAT_DAYS }),
      zayif: t("At least 2 of the last 5 answers were wrong, or a settled topic went wrong. Two right answers in a row lift it."), orta: t("Asked, not settled yet: it needs right answers on 3 different days in a row."), yeni: t("Not asked yet.") }[s.status];
  }
  const runOut = (res) => `<h4>${esc(t("Real output"))}</h4>` + lines(res.lines.filter((l) => l.kind !== "result").flatMap((l) => l.text.split("\n")), -1) + (res.timedOut ? `<div class="st-l err">${esc(t("Stopped after 3 seconds."))}</div>` : "");
  const learn = createLearn({
    $: (q, r = root) => $(q, r), content, progress, states, topicOf, tasks: () => content().tasks, chip, codeBlock, reason, nice, firstLine, today,
    hasContent: () => hasContent(), empty: () => empty(),
    run: (code) => (runner ||= createRunner(root)).run(code), runOut,
    select: (id) => { sel = id; },
    saveLessons: () => save("/meta", { lessons: progress().lessons }, "PUT"),
    show: (name, focus) => setTab(name, focus, focus === undefined && name === "learn"),
    startQuiz: (kind, topic) => start(kind, topic),
    nextProblem: () => prob.nextOpen(),
  });
  const prob = createProblems({
    $: (q, r = root) => $(q, r), content, progress, codeBlock, loadMonaco, tutorUI, toast: ctx.toast, confirmBox: ctx.confirmBox,
    run: (code) => (runner ||= createRunner(root)).run(code),
    saveProblems: () => save("/meta", { problems: progress().problems }, "PUT"),
    isOpen: () => !root.hidden,
  });
  // new questions for the chosen topic: the tutor writes them, each is run in the sandbox, and one is kept only when
  // its real output is among its options (the right option is then set from the real output, not from what was claimed)
  async function moreQuestions(btn) {
    const tp = topicOf(sel); if (!tp) return; const s = states()[tp.id];
    const r = await askWith(btn, { kind: "more", topic: tp.id, count: 5, level: s.status === "oturdu" ? "hard" : s.status === "orta" || s.status === "tekrar" ? "medium" : "easy" }); if (!r) return;
    runner ||= createRunner(root); const keep = [];
    for (const q of r.questions) {
      const res = await runner.run(q.code); if (root.hidden) return;
      if (res.timedOut || res.lines.some((l) => l.kind === "error" || l.kind === "throw")) continue;
      const real = flat(res.lines.filter((l) => l.kind === "log" || l.kind === "info").map((l) => l.text).join(" ")), i = real ? q.options.findIndex((o) => flat(o) === real) : -1;
      if (i >= 0) keep.push({ ...q, correct: i });
    }
    const dropped = r.questions.length - keep.length;
    if (!keep.length) return ctx.toast(t("None of the new questions passed the check. Try again."), "bad");
    try { const out = await ctx.api("/api/study/import", { method: "POST", body: { pack: { questions: keep } } }); data.content = out.content; } catch (e) { return ctx.toast(e.message, "bad"); }
    ctx.toast(dropped ? t("{n} new {n|question|questions} added; {m} did not pass the check", { n: keep.length, m: dropped }) : t("{n} new {n|question|questions} added", { n: keep.length }), "ok");
  }

  // ---------------------------------------------------------------- 1b. say it: open questions with a model answer
  // You answer in your own words first (written or only in your head), then the model answer opens, and you mark
  // whether you had it. The marks only decide what comes first next time; they do not change a topic's status.
  let say = null;
  const talkItems = () => content().topics.flatMap((x) => (x.lesson?.talk || []).map((q, n) => ({ topic: x.id, n, ask: q.ask, answer: q.answer })));
  function startSay(topic) {
    const all = talkItems().filter((x) => !topic || x.topic === topic); if (!all.length) return ctx.toast(t("There are no open questions yet. Import a pack."), "bad");
    const last = new Map(); for (const r of progress().talks || []) last.set(r.topic + "/" + r.n, r);
    const rank = (x) => { const r = last.get(x.topic + "/" + x.n); return !r ? 0 : r.ok ? 2 : 1; }; // never asked, then missed, then had it
    const pool = core.shuffled(all).sort((a, b) => rank(a) - rank(b)).slice(0, 10);
    say = { items: pool.map((x) => ({ ...x, mine: "", mark: null, open: false })), i: 0, done: false, topic: topic || null }; setTab("say");
  }
  function renderSay() {
    const box = $("#st-say"), total = talkItems().length;
    if (!hasContent() || !total) { box.innerHTML = hasContent() ? `<div class="lib-empty"><b>${esc(t("No open questions yet"))}</b><p>${esc(t("Import a pack that has open questions."))}</p><button type="button" class="btn primary sm" data-act="import">${esc(t("Import pack"))}</button></div>` : empty(); return; }
    if (!say) {
      const withTalk = content().topics.filter((x) => x.lesson?.talk?.length);
      box.innerHTML = `<div class="st-saystart"><h3>${esc(t("Say it in your own words"))}</h3><p>${esc(t("You get an open question. Answer it aloud or in writing, then open the model answer and mark whether you had it. Questions you have not seen or missed come first."))}</p>` +
        `<div class="st-q-b"><button type="button" class="btn primary" data-act="saystart">${esc(t("Mixed, up to 10 questions"))}</button></div>` +
        `<div class="st-pickrow"><select id="st-saypick" aria-label="${esc(t("Topic"))}">${withTalk.map((x) => `<option value="${esc(x.id)}">${esc(x.title)} (${x.lesson.talk.length})</option>`).join("")}</select><button type="button" class="btn sm" data-act="saytopic2">${esc(t("Start this topic"))}</button></div></div>`; return;
    }
    if (say.done) { const had = say.items.filter((x) => x.mark === true).length, seen = say.items.filter((x) => x.mark !== null).length;
      box.innerHTML = `<div class="st-saystart"><h3>${esc(t("Done"))}</h3><p class="st-bigres">${had} / ${seen}</p><p>${esc(t("{a} of {b} answered fully", { a: had, b: seen }))}</p><div class="st-q-b"><button type="button" class="btn primary" data-act="sayagain">${esc(t("Back to the start"))}</button></div></div>`; return; }
    const it = say.items[say.i];
    box.innerHTML = `<div class="st-q"><div class="st-q-h"><h3>${esc(t("Question {n}", { n: say.i + 1 }))}</h3><span>${say.i + 1} / ${say.items.length}</span><button type="button" class="st-link" data-act="sayend">${esc(t("End"))}</button></div>` +
      `<p class="st-ask">${esc(it.ask)}</p><span class="st-s" data-s="yeni">${esc(titleOf(it.topic))}</span>` +
      `<textarea id="st-saymine" class="st-saymine" rows="4" placeholder="${esc(t("Your answer (optional)"))}" aria-label="${esc(t("Your answer (optional)"))}" ${it.open ? "disabled" : ""}>${esc(it.mine)}</textarea>` +
      (it.open ? `<div class="st-why"><h4>${esc(t("Model answer"))}</h4><p class="st-say">${esc(it.answer)}</p><div id="st-saytutor" hidden></div><div class="st-q-b">${it.mine.trim() && !it.talk ? `<button type="button" class="btn ghost sm" data-act="saygrade">${esc(t("Have the tutor grade my answer"))}</button>` : ""}<button type="button" class="btn primary sm" data-act="saymark" data-ok="1">${esc(t("I had it"))}</button><button type="button" class="btn sm" data-act="saymark" data-ok="0">${esc(t("I missed parts"))}</button></div></div>` : `<div class="st-q-b"><button type="button" class="btn primary sm" data-act="sayopen">${esc(t("Show the model answer"))}</button></div>`) + `</div>`;
    if (it.open && it.talk) tutorUI.mount($("#st-saytutor"), it.talk);
    else (it.open ? $("[data-act=saymark]", box) : $("#st-saymine", box))?.focus({ preventScroll: true });
  }
  function sayMark(ok) {
    const it = say.items[say.i]; it.mark = ok; const now = new Date();
    const rec = { id: uid(), topic: it.topic, n: it.n, tarih: now.toISOString(), gun: today(), ok, mine: it.mine };
    (progress().talks ||= []).push(rec); save("/log", { talks: [rec] });
    if (say.i + 1 < say.items.length) say.i++; else say.done = true; renderSay();
  }

  // ---------------------------------------------------------------- 2. quizzes
  function start(kind, topic) {
    const rng = Math.random; let qs;
    if (kind === "isinma") qs = core.pickWarmup(content(), progress().answers, today(), rng, 5);
    else if (kind === "konu") qs = core.pickTopicTest(content(), topic, rng, 10, progress().answers);
    else qs = core.pickMixed(content(), rng, 10, progress().answers);
    if (!qs.length) return ctx.toast(t("There are no questions yet. Import a pack."), "bad");
    quiz = { kind, topic, day: today(), i: 0, finished: false, qs: qs.map((q) => ({ q: core.shuffleOptions(q, rng), pick: null })) };
    setTab("quiz");
  }
  const kindTitle = (k) => ({ isinma: t("JS warm-up"), konu: t("JS topic quiz"), karisik: t("JS mixed quiz") }[k]);
  function renderQuiz() {
    const box = $("#st-quiz");
    if (!hasContent() || !content().questions.length) { box.innerHTML = hasContent() ? `<div class="lib-empty"><b>${esc(t("No questions yet"))}</b><p>${esc(t("Import a pack that has questions."))}</p><button type="button" class="btn primary sm" data-act="import">${esc(t("Import pack"))}</button></div>` : empty(); return; }
    if (!quiz) return renderStart(box);
    if (quiz.finished) return renderResult(box);
    const cur = quiz.qs[quiz.i], q = cur.q, done = cur.pick !== null;
    box.innerHTML = `<div class="st-q"><div class="st-q-h"><h3>${esc(t("Question {n}", { n: quiz.i + 1 }))}</h3><span>${quiz.i + 1} / ${quiz.qs.length}</span><button type="button" class="st-link" data-act="endquiz">${esc(t("End test"))}</button></div>` +
      codeBlock(q.code) + `<p class="st-ask">${esc(q.ask)}</p>` +
      `<div class="st-opts">${q.options.map((o, i) => `<button type="button" class="st-opt${done ? (i === q.correct ? " ok" : i === cur.pick ? " bad" : " dim") : ""}" data-i="${i}" ${done ? "disabled" : ""}><kbd>${core.letter(i)}</kbd><code>${esc(o)}</code></button>`).join("")}</div>` +
      (done ? `<div class="st-why"><p class="st-verdict ${cur.pick === q.correct ? "ok" : "bad"}">${esc(cur.pick === q.correct ? t("Correct") : t("Not quite"))} <span>${esc(titleOf(q.topic))}</span></p><p>${esc(q.why)}</p>` +
        `<div class="st-q-b"><button type="button" class="btn ghost sm" data-act="real">${esc(t("See the real output"))}</button>${cur.pick !== q.correct && !cur.talk ? `<button type="button" class="btn ghost sm" data-act="tutorwhy">${esc(t("Explain my mistake"))}</button>` : ""}<button type="button" class="btn primary sm" data-act="next">${esc(quiz.i + 1 < quiz.qs.length ? t("Next question") : t("Finish"))}</button></div><div id="st-real" class="st-real" hidden></div><div id="st-tutorout" hidden></div></div>` : "") + `</div>`;
    if (done && cur.talk) tutorUI.mount($("#st-tutorout"), cur.talk);
    (done ? $("[data-act=next]", box) : $(".st-opt", box))?.focus({ preventScroll: true });
  }
  function renderStart(box) {
    const st = states(), tr = content().topics.filter((x) => st[x.id].status === "tekrar").length, wk = content().topics.filter((x) => st[x.id].status === "zayif").length;
    const sk = core.streak(progress().sessions, today());
    const withQ = content().topics.filter((x) => content().questions.some((q) => q.topic === x.id));
    box.innerHTML = `<div class="st-start">` +
      `<section class="st-card"><h3>${esc(t("Daily warm-up"))}</h3><p>${esc(t("5 questions, picked for you: yesterday's mistakes first, then topics due for a repeat, then weak ones."))}</p>` +
      `<small>${esc(sk.doneToday ? t("Done today.") : t("Not done today."))} ${esc(t("{n} due for a repeat, {m} weak", { n: tr, m: wk }))}</small><button type="button" class="btn primary" data-act="start" data-kind="isinma">${esc(t("Start warm-up"))}</button></section>` +
      `<section class="st-card"><h3>${esc(t("Topic quiz"))}</h3><p>${esc(t("Up to 10 questions from one topic."))}</p><select id="st-pick" aria-label="${esc(t("Topic"))}">${withQ.map((x) => `<option value="${esc(x.id)}"${x.id === sel ? " selected" : ""}>${esc(x.title)}</option>`).join("")}</select><button type="button" class="btn" data-act="start" data-kind="konu">${esc(t("Start topic quiz"))}</button></section>` +
      `<section class="st-card"><h3>${esc(t("Mixed quiz"))}</h3><p>${esc(t("10 questions from every topic."))}</p><button type="button" class="btn" data-act="start" data-kind="karisik">${esc(t("Start mixed quiz"))}</button></section></div>`;
  }
  function answer(i) {
    const cur = quiz.qs[quiz.i]; if (cur.pick !== null) return;
    cur.pick = i; const q = cur.q, rec = { id: uid(), questionId: q.id, topic: q.topic, tarih: new Date().toISOString(), gun: today(), dogruMu: i === q.correct, secilen: q.options[i] };
    progress().answers.push(rec); save("/log", { answers: [rec] });
    renderQuiz(); renderStrip();
  }
  const rowsOf = () => quiz.qs.filter((x) => x.pick !== null).map((x) => ({ topic: titleOf(x.q.topic), ok: x.pick === x.q.correct, picked: { i: x.pick, text: x.q.options[x.pick] }, right: { i: x.q.correct, text: x.q.options[x.q.correct] } }));
  function finish() {
    const all = quiz.qs.every((x) => x.pick !== null), rows = rowsOf();
    if (all && !quiz.logged) { quiz.logged = true; const s = { id: uid(), tur: quiz.kind, tarih: new Date().toISOString(), gun: quiz.day, dogru: rows.filter((r) => r.ok).length, toplam: rows.length }; progress().sessions.push(s); save("/log", { sessions: [s] }); }
    quiz.finished = true; renderQuiz(); renderStrip();
  }
  const quizTitle = () => kindTitle(quiz.kind) + (quiz.kind === "konu" ? ": " + titleOf(quiz.topic) : "");
  const resultText = () => core.quizText({ title: quizTitle(), day: quiz.day, rows: rowsOf(), total: quiz.qs.length }, t, loc());
  function renderResult(box) {
    const rows = rowsOf(), good = rows.filter((r) => r.ok).length;
    box.innerHTML = `<div class="st-res"><h3>${esc(quizTitle())}</h3><p class="st-score"><b>${good} / ${quiz.qs.length}</b> <span>${esc(t("{n} {n|question|questions} answered", { n: rows.length }))}</span></p>` +
      `<ol class="st-hist big">${rows.map((r) => `<li class="${r.ok ? "ok" : "bad"}"><b>${r.ok ? "✓" : "✗"}</b><span class="rt">${esc(r.topic)}</span>` + (r.ok ? `<span>${core.letter(r.right.i)}</span>` : `<code>${esc(t("I chose"))} ${core.letter(r.picked.i)} = ${esc(r.picked.text)}</code><code>${esc(t("the answer is"))} ${core.letter(r.right.i)} = ${esc(r.right.text)}</code>`) + `</li>`).join("")}</ol>` +
      `<div class="st-q-b"><button type="button" class="btn primary sm" data-act="copyquiz">${esc(t("Copy result"))}</button><button type="button" class="btn ghost sm" data-act="again">${esc(t("New test"))}</button></div></div>`;
  }
  // the strip under the quiz: one mark per question, filled in as the answers come
  function renderStrip() {
    const bar = $("#st-strip"), on = tab === "quiz" && quiz && !!quiz.qs.length; bar.hidden = !on; if (!on) return;
    bar.innerHTML = quiz.qs.map((x, i) => { const st = x.pick === null ? "" : x.pick === x.q.correct ? "ok" : "bad";
      return `<button type="button" class="st-pip ${st}${!quiz.finished && i === quiz.i ? " cur" : ""}" data-i="${i}" ${x.pick === null && i !== quiz.i ? "disabled" : ""} aria-label="${esc(t("Question {n}", { n: i + 1 }))}"><span>${i + 1}</span>${x.pick === null ? "<em>·</em>" : `<em>${st === "ok" ? "✓" : "✗"}</em><kbd>${core.letter(x.pick)}</kbd>`}</button>`; }).join("");
  }

  // ---------------------------------------------------------------- 3. code tasks
  const tasks = () => content().tasks;
  const attemptsOf = (id) => progress().attempts.filter((a) => a.taskId === id);
  const draft = (id) => (progress().drafts[id] ||= { code: "", tahmin: "" });
  async function openCode() {
    renderTasks();
    if (!tasks().length) { $("#st-work").hidden = true; return; }
    $("#st-work").hidden = false;
    if (!ed) {
      try { monaco = await loadMonaco(); } catch (e) { $("#stc-editor").innerHTML = `<div class="lib-empty"><b>${esc(t("Could not load the editor"))}</b><p>${esc(e.message)}</p></div>`; return; }
      if (root.hidden || tab !== "code" || ed) return;
      let px = 14; try { const v = Number(localStorage.getItem("ecelon.practiceFont")); if (v >= 8 && v <= 40) px = v; } catch { /* storage off */ }
      ed = monaco.editor.create($("#stc-editor"), { model: null, theme: "ecelon", automaticLayout: true, fontFamily: "JetBrains Mono, Consolas, monospace", fontSize: px, mouseWheelZoom: false, minimap: { enabled: false }, scrollBeyondLastLine: false, tabSize: 2, padding: { top: 10 }, unicodeHighlight: { ambiguousCharacters: false } });
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runTask());
    }
    selectTask(taskId && tasks().some((k) => k.id === taskId) ? taskId : tasks()[0].id);
  }
  function renderTasks() {
    const box = $("#st-tasklist");
    box.innerHTML = tasks().length ? tasks().map((k) => { const at = attemptsOf(k.id), ok = at.some((a) => a.eslesti);
      return `<button type="button" class="st-task${k.id === taskId ? " on" : ""}" data-id="${esc(k.id)}"><span class="st-tt">${esc(k.title)}</span><small>${ok ? "✓ " + esc(t("Solved")) : at.length ? esc(t("{n} {n|try|tries}", { n: at.length })) : esc(t("Not tried"))}</small></button>`; }).join("")
      : `<div class="lib-empty"><b>${esc(t("No tasks yet"))}</b><p>${esc(t("Import a pack that has tasks."))}</p><button type="button" class="btn primary sm" data-act="import">${esc(t("Import pack"))}</button></div>`;
  }
  function selectTask(id) {
    if (saveT) flushDrafts(); taskId = id; shown = 0; last = null;
    const k = tasks().find((x) => x.id === id), d = draft(id);
    $("#stc-title").textContent = k.title; $("#stc-topic").textContent = titleOf(k.topic); $("#stc-desc").textContent = k.description;
    $("#stc-guess").value = d.tahmin; $("#stc-result").hidden = true; $("#stc-copy").hidden = true; $("#stc-tutor").hidden = true; $("#stc-tutorout").hidden = true; $("#stc-hints").innerHTML = "";
    let m = models.get(id); if (!m) { m = monaco.editor.createModel(d.code, "javascript"); m.onDidChangeContent(() => { draft(id).code = m.getValue(); queueSave(); }); models.set(id, m); }
    ed.setModel(m); renderTasks(); syncRun(); syncHint();
  }
  function syncHint() { const k = tasks().find((x) => x.id === taskId), n = k?.hints.length || 0, b = $("#stc-hint"); b.hidden = !n; b.disabled = shown >= n; b.textContent = shown >= n ? t("All hints shown") : t("Show a hint ({a} of {b})", { a: shown + 1, b: n }); }
  function syncRun() { const need = !$("#stc-guess").value.trim(); $("#stc-run").disabled = need || busy; $("#stc-runhint").textContent = need ? t("Write your guess first: what will the console print?") : busy ? t("Running…") : t("Ctrl+Enter runs the code."); }
  const queueSave = () => { clearTimeout(saveT); saveT = setTimeout(flushDrafts, 800); };
  function flushDrafts() { clearTimeout(saveT); saveT = 0; if (data) save("/meta", { drafts: progress().drafts }, "PUT"); }
  const lines = (arr, mark, cls = "") => arr.length ? arr.map((l, i) => `<div class="st-l${i === mark ? " diff" : ""}${cls}">${esc(l) || "&nbsp;"}</div>`).join("") : `<div class="st-l none">${esc(t("(nothing printed)"))}</div>`;
  async function runTask() {
    const k = tasks().find((x) => x.id === taskId); if (!k || busy || !ed) return;
    const guess = $("#stc-guess").value; if (!guess.trim()) { $("#stc-guess").focus(); return ctx.toast(t("Write your guess first"), "bad"); }
    busy = true; syncRun(); $("#stc-result").hidden = true; $("#stc-copy").hidden = true; $("#stc-tutor").hidden = true; $("#stc-tutorout").hidden = true; runner ||= createRunner(root); // the last result goes away while the new run is going
    const res = await runner.run(ed.getValue()); busy = false; if (root.hidden) return; syncRun(); if (taskId !== k.id) return;
    const out = res.lines.filter((l) => l.kind === "log" || l.kind === "info").flatMap((l) => l.text.split("\n")), errs = res.lines.filter((l) => l.kind === "error" || l.kind === "throw" || l.kind === "warn");
    const hasExp = k.expectedOutput.length > 0, cmp = hasExp ? core.compareOutput(out, k.expectedOutput) : { match: false, diff: -1 }, ok = hasExp && cmp.match && !res.timedOut && !errs.some((e) => e.kind !== "warn");
    const gcmp = core.compareOutput(guess, out), rec = { id: uid(), taskId: k.id, tarih: new Date().toISOString(), gun: today(), eslesti: ok, tahmin: guess, cikti: out.join("\n"), zamanAsimi: res.timedOut };
    progress().attempts.push(rec); save("/log", { attempts: [rec] });
    last = { k, guess, out, ok, timedOut: res.timedOut, errs, cmp, gcmp };
    const verdict = res.timedOut ? ["bad", t("Stopped after 3 seconds. Is there a loop that never ends?")] : !hasExp ? ["", t("This task has no expected output to compare with.")] : ok ? ["ok", t("Matched the expected output")] : cmp.match ? ["bad", t("The output matches, but the code reported an error")] : ["bad", t("Did not match: line {n} differs", { n: cmp.diff + 1 })];
    const r = $("#stc-result"); r.hidden = false;
    r.innerHTML = `<p class="st-verdict ${verdict[0]}">${esc(verdict[1])}</p>` + (errs.length ? `<div class="st-errs">${errs.map((e) => `<div class="st-l err">${esc(e.text)}</div>`).join("")}</div>` : "") +
      `<div class="st-cols"><section><h4>${esc(t("My guess"))}</h4>${lines(guess.split("\n").filter((l) => l.trim()), -1)}<small class="${gcmp.match ? "ok" : "bad"}">${esc(gcmp.match ? t("The guess matched what was printed.") : t("The guess did not match what was printed."))}</small></section>` +
      `<section><h4>${esc(t("Real output"))}</h4>${lines(out, hasExp && !cmp.match ? cmp.diff : -1)}</section>` +
      `<section><h4>${esc(t("Expected output"))}</h4>${lines(k.expectedOutput, hasExp && !cmp.match ? cmp.diff : -1)}</section></div>`;
    $("#stc-copy").hidden = false; $("#stc-tutor").hidden = false; renderTasks(); r.scrollIntoView({ block: "nearest" });
  }
  function taskText() {
    const { k, guess, out, ok } = last, fence = (x) => "```\n" + x + "\n```";
    return [`${t("JS task")} ${core.dateLabel(today(), loc())}: ${k.title} — ${ok ? t("matched") : t("did not match")}`, `${t("My guess")}:`, fence(guess.trim()), `${t("Real output")}:`, fence(out.join("\n")), `${t("Expected output")}:`, fence(k.expectedOutput.join("\n")), `${t("My code")}:`, fence(ed.getValue().trim())].join("\n");
  }

  // ---------------------------------------------------------------- 4. cheat sentences and notes
  function renderTips() {
    const box = $("#st-tips"); if (!hasContent()) { box.innerHTML = empty(); return; }
    const groups = [...content().topics.map((x) => x.id), "genel"], q = ($("#st-search")?.value || "").trim().toLocaleLowerCase(loc());
    const tops = groups.map((id) => ({ id, title: titleOf(id), hints: content().hints.filter((h) => h.topic === id), notes: progress().notes.filter((n) => n.topic === id) }))
      .map((g) => (q && !g.title.toLocaleLowerCase(loc()).includes(q) ? { ...g, hints: g.hints.filter((h) => h.text.toLocaleLowerCase(loc()).includes(q)), notes: g.notes.filter((n) => n.text.toLocaleLowerCase(loc()).includes(q)) } : g))
      .filter((g) => g.hints.length || g.notes.length);
    const keep = $("#st-search") === document.activeElement; const cur = $("#st-search")?.value || "";
    box.innerHTML = `<div class="st-tipbar"><input id="st-search" type="search" placeholder="${esc(t("Search the cheat sentences"))}" aria-label="${esc(t("Search the cheat sentences"))}" value="${esc(cur)}" autocomplete="off"></div>` +
      `<form id="st-noteform" class="st-noteform"><select id="st-notetopic" aria-label="${esc(t("Topic of the note"))}">${groups.map((id) => `<option value="${esc(id)}"${id === noteTopic ? " selected" : ""}>${esc(titleOf(id))}</option>`).join("")}</select><input id="st-notetext" maxlength="1000" placeholder="${esc(t("Add a note of your own"))}" aria-label="${esc(t("Add a note of your own"))}" autocomplete="off"><button type="submit" class="btn sm">${esc(t("Add note"))}</button></form>` +
      (tops.length ? tops.map((g) => `<section class="st-grp"><h3>${esc(g.title)}</h3><ul class="st-list">${g.hints.map((h) => `<li>${esc(h.text)}</li>`).join("")}${g.notes.map((n) => `<li class="mine"><span>${esc(n.text)}</span><button type="button" class="icon-btn" data-act="delnote" data-id="${esc(n.id)}" title="${esc(t("Delete note"))}" aria-label="${esc(t("Delete note"))}"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></li>`).join("")}</ul></section>`).join("") : `<p class="st-none">${esc(q ? t("Nothing found.") : t("None yet."))}</p>`);
    if (keep) { const s = $("#st-search"); s.focus(); s.setSelectionRange(cur.length, cur.length); }
  }
  const saveNotes = () => save("/meta", { notes: progress().notes }, "PUT");

  // ---------------------------------------------------------------- import
  const dlg = () => $("#dlg-stimport");
  let pending = null;
  function openImport() { $("#st-paste").value = ""; $("#st-file").value = ""; checkPack(); if (!dlg().open) dlg().showModal(); $("#st-paste").focus(); }
  function checkPack() {
    const msg = $("#st-imp-msg"), go = $("#st-imp-go"), txt = $("#st-paste").value.trim(); pending = null; go.disabled = true; msg.className = "st-imp-msg";
    if (!txt) { msg.textContent = t("Choose a JSON file or paste the JSON here."); return; }
    let raw; try { raw = JSON.parse(txt); } catch (e) { msg.classList.add("bad"); msg.textContent = t("This is not valid JSON: {msg}", { msg: e.message }); return; }
    const v = core.validatePack(raw, content(), t);
    if (!v.ok) { msg.classList.add("bad"); const more = v.errors.length - 8; msg.innerHTML = `<b>${esc(t("Nothing was imported: the pack has errors."))}</b><ul>${v.errors.slice(0, 8).map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` + (more > 0 ? `<p>${esc(t("…and {n} more.", { n: more }))}</p>` : ""); return; }
    const { report } = core.mergePack(content(), v.pack), names = { topics: t("Topics"), hints: t("Cheat sentences"), questions: t("Questions"), tasks: t("Tasks") };
    msg.classList.add("ok"); msg.innerHTML = `<b>${esc(t("The pack is valid."))}</b><ul>${Object.entries(report).filter(([, r]) => r.added || r.updated).map(([k, r]) => `<li>${esc(names[k])}: ${esc(t("{a} new, {b} overwritten", { a: r.added, b: r.updated }))}</li>`).join("")}</ul>`;
    pending = raw; go.disabled = false;
  }
  async function doImport() {
    if (!pending) return; const go = $("#st-imp-go"); go.disabled = true;
    try { const r = await ctx.api("/api/study/import", { method: "POST", body: { pack: pending } }); data.content = r.content; dlg().close(); ctx.toast(t("Pack imported"), "ok"); setTab(tab); }
    catch (e) { const msg = $("#st-imp-msg"); msg.className = "st-imp-msg bad"; msg.textContent = e.message; go.disabled = false; }
  }

  // ---------------------------------------------------------------- events
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act],[data-tab],.st-task,.st-opt,.st-pip"); if (!el || !root.contains(el)) return;
    if (el.dataset.tab) { setTab(el.dataset.tab === "practice" ? practice : el.dataset.tab); return; }
    if (el.dataset.act === "problem") { setTab("prob", el.dataset.id); return; }
    if (el.dataset.act && prob.click(el.dataset.act, el)) return;
    if (el.dataset.act && await learn.click(el.dataset.act, el, $("#st-" + tab))) return;
    if (el.classList.contains("st-task")) { if (el.dataset.id !== taskId) selectTask(el.dataset.id); return; }
    if (el.classList.contains("st-opt")) { answer(Number(el.dataset.i)); return; }
    if (el.classList.contains("st-pip")) { const i = Number(el.dataset.i); if (quiz && !el.disabled) { quiz.i = i; quiz.finished = false; renderQuiz(); renderStrip(); } return; }
    switch (el.dataset.act) {
      case "close": close(); break;
      case "import": openImport(); break;
      case "start": start(el.dataset.kind, el.dataset.kind === "konu" ? $("#st-pick")?.value : null); break;
      case "topictest": start("konu", sel); break;
      case "topicquiz": start("konu", el.dataset.id); break;
      case "opentask": taskId = el.dataset.id; setTab("code"); break;
      case "morequestions": moreQuestions(el); break;
      case "tutorwhy": { const cur = quiz?.qs[quiz.i]; if (!cur || cur.pick === null || cur.talk) break; cur.talk = { base: { kind: "why", questionId: cur.q.id, picked: cur.q.options[cur.pick] }, msgs: [] }; el.remove(); tutorUI.mount($("#st-tutorout"), cur.talk); break; }
      case "saygrade": { const it = say?.items[say.i]; if (!it || it.talk) break; it.talk = { base: { kind: "talk", topic: it.topic, n: it.n, mine: it.mine }, msgs: [] }; el.remove(); tutorUI.mount($("#st-saytutor"), it.talk); break; }
      case "saytopic": startSay(sel); break;
      case "saystart": startSay(null); break;
      case "saytopic2": startSay($("#st-saypick")?.value || null); break;
      case "sayopen": { const it = say.items[say.i]; it.mine = $("#st-saymine")?.value || ""; it.open = true; renderSay(); break; }
      case "saymark": sayMark(el.dataset.ok === "1"); break;
      case "sayend": say = null; renderSay(); break;
      case "sayagain": say = null; renderSay(); break;
      case "next": if (quiz.i + 1 < quiz.qs.length) { quiz.i++; renderQuiz(); renderStrip(); } else finish(); break;
      case "endquiz": if (quiz.qs.some((x) => x.pick !== null)) finish(); else { quiz = null; renderQuiz(); renderStrip(); } break;
      case "again": quiz = null; renderQuiz(); renderStrip(); break;
      case "copyquiz": copy(resultText(), t("Result copied")); break;
      case "real": { const b = el; b.disabled = true; runner ||= createRunner(root); const res = await runner.run(quiz.qs[quiz.i].q.code); b.disabled = false; const out = $("#st-real"); if (!out) break; out.hidden = false;
        const shown1 = res.lines.filter((l) => l.kind !== "result"); out.innerHTML = `<h4>${esc(t("Real output"))}</h4>` + lines(shown1.flatMap((l) => l.text.split("\n")), -1) + (res.timedOut ? `<div class="st-l err">${esc(t("Stopped after 3 seconds."))}</div>` : ""); break; }
      case "delnote": { const n = progress().notes.find((x) => x.id === el.dataset.id); if (!n) break; progress().notes = progress().notes.filter((x) => x !== n); saveNotes(); renderTips();
        ctx.toast(t("Note deleted"), "", { label: t("Undo"), fn: () => { progress().notes.push(n); saveNotes(); if (!root.hidden && tab === "tips") renderTips(); } }); break; }
      case "reset": if (await ctx.confirmBox({ title: t("Reset your progress?"), body: t("Your answers, tries, finished tests and streak are deleted from this computer. The content and your notes stay. This cannot be undone."), ok: t("Reset"), danger: true })) { await save("/progress", undefined, "DELETE"); progress().answers = []; progress().attempts = []; progress().sessions = []; progress().talks = []; progress().drafts = {}; for (const m of models.values()) m.dispose(); models.clear(); quiz = null; setTab(tab); } break;
      default:
    }
  });
  root.addEventListener("keydown", (e) => {
    learn.keydown(e);
    if (e.key === "Escape" && e.target.closest?.(".st-ask, .st-edit")) { e.stopPropagation(); e.target.blur(); } // Esc leaves the field, not the room
  });
  root.addEventListener("input", (e) => {
    learn.input(e);
    if (e.target.id === "st-search") renderTips();
    else if (e.target.id === "stc-guess") { draft(taskId).tahmin = e.target.value; queueSave(); syncRun(); }
  });
  root.addEventListener("change", (e) => { if (e.target.id === "st-notetopic") noteTopic = e.target.value; });
  root.addEventListener("submit", (e) => {
    if (e.target.id !== "st-noteform") return; e.preventDefault();
    const text = $("#st-notetext").value.trim(); if (!text) return;
    progress().notes.push({ id: uid(), topic: $("#st-notetopic").value, text: text.slice(0, 1000) }); saveNotes(); renderTips(); $("#st-notetext").focus();
  });
  $("#stc-hint").onclick = () => { const k = tasks().find((x) => x.id === taskId); if (!k || shown >= k.hints.length) return; const li = document.createElement("li"); li.textContent = k.hints[shown++]; $("#stc-hints").append(li); syncHint(); };
  $("#stc-run").onclick = () => runTask();
  $("#stc-copy").onclick = () => { if (last && last.k.id === taskId) copy(taskText(), t("Result copied")); };
  $("#stc-tutor").onclick = (e) => {
    if (!last || last.k.id !== taskId || !ed) return;
    const talk = { base: { kind: "code", taskId: last.k.id, code: ed.getValue(), output: [...last.out, ...last.errs.map((x) => x.text)].join("\n"), matched: last.ok }, msgs: [] };
    e.currentTarget.hidden = true; tutorUI.mount($("#stc-tutorout"), talk);
  };
  $("#st-import").onclick = openImport;
  $("#st-file").onchange = async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 5 * 1024 * 1024) { ctx.toast(t("That file is too large for a content pack."), "bad"); return; } $("#st-paste").value = await f.text(); checkPack(); };
  { let dt = 0; $("#st-paste").addEventListener("input", () => { clearTimeout(dt); dt = setTimeout(checkPack, 200); }); }
  $("#st-imp-go").onclick = doImport;
  $("#st-schema").onclick = () => copy(core.SCHEMA_TEXT, t("Schema copied"));
  document.addEventListener("keydown", (e) => {
    if (root.hidden || document.querySelector("dialog[open]")) return;
    const inEditor = e.target instanceof Element && !!e.target.closest(".monaco-editor");
    if (e.key === "Escape" && !e.defaultPrevented && !inEditor) { e.preventDefault(); close(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && tab === "code" && !inEditor) { e.preventDefault(); runTask(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && tab === "prob" && !inEditor) { e.preventDefault(); prob.run(); }
  });
  // Ctrl + wheel and Ctrl +/-/0 while the room is open (app.js hands them here). Reading panes zoom their content;
  // where a code editor is open (Code, Problems) the editor's font grows instead, as CSS zoom would break the editor.
  const ZOOM_KEY = "ecelon.studyZoom";
  let zoom = 1; try { zoom = Number(localStorage.getItem(ZOOM_KEY)) || 1; } catch { /* storage off */ }
  const applyZoom = () => { root.style.setProperty("--st-zoom", String(zoom)); };
  applyZoom();
  function zoomBy(step) { // step: +1, -1, or 0 for "back to normal"; returns the label to show
    if (tab === "code" || tab === "prob") {
      let px = 14; try { px = Number(localStorage.getItem("ecelon.practiceFont")) || 14; } catch { /* storage off */ }
      px = step === 0 ? 14 : Math.min(40, Math.max(8, px + step));
      try { localStorage.setItem("ecelon.practiceFont", String(px)); } catch { /* storage off */ }
      ed?.updateOptions({ fontSize: px }); prob.setFont(px);
      return t("Code size {n}px", { n: px });
    }
    zoom = step === 0 ? 1 : Math.min(2, Math.max(0.7, Math.round((zoom + step * 0.1) * 10) / 10));
    try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch { /* storage off */ }
    applyZoom();
    return t("Text size {n}%", { n: Math.round(zoom * 100) });
  }
  return { open, close, zoomBy, get isOpen() { return !root.hidden; } };
}
