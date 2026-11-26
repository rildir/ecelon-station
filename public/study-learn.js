// JS Study: the three views a learner moves through.
//   Today   one suggested next step (and what else is open), the numbers, and the path at a glance
//   Learn   the path: every topic in learning order, grouped, with what has been read
//   Lesson  one topic as a page: steps that open one after another, code that can be changed and run, then practice
// The rules for "what comes next" are in study-core.js (nextSteps); this file only draws and listens.
import { t } from "./i18n.js";
import * as core from "./study-core.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function createLearn(env) {
  // env: { $, content, progress, states, topicOf, tasks, chip, codeBlock, reason, nice, firstLine, empty, run, runOut, select, saveLessons, today }
  const { $ } = env;
  let reading = null;       // the topic whose lesson is open
  const edits = new Map();  // code the learner changed in the open lesson: cell key → text
  let pathScroll = 0;
  const ran = new Set();      // steps of the open lesson whose code was run
  const picked = new Map();   // steps of the open lesson whose question was answered: step → option

  const lessons = () => (env.progress().lessons ||= {});
  const groupsOf = () => {
    const out = [];
    for (const tp of env.content().topics) {
      const name = tp.group || t("Topics");
      if (out.at(-1)?.name !== name) out.push({ name, topics: [] });
      out.at(-1).topics.push(tp);
    }
    return out;
  };
  const readCount = (list) => list.filter((x) => x.lesson && lessons()[x.id]?.done).length;
  const withLesson = (list) => list.filter((x) => x.lesson).length;
  const bar = (a, b) => `<span class="st-bar" role="img" aria-label="${esc(t("{a} of {b}", { a, b }))}"><i style="width:${b ? Math.round((a / b) * 100) : 0}%"></i></span>`;
  const enter = (el) => { el.classList.remove("st-in"); void el.offsetWidth; el.classList.add("st-in"); };

  // ------------------------------------------------------------------ Today
  function describe(step) {
    const tp = step.id ? env.topicOf(step.id) : null;
    if (step.kind === "warmup") {
      const why = step.wrong ? t("{n} {n|question|questions} you got wrong before come first", { n: step.wrong })
        : step.due ? t("{n} {n|topic is|topics are} due for a repeat", { n: step.due }) : t("{n} weak {n|topic|topics} to work on", { n: step.weak });
      return { title: t("Warm-up: 5 questions"), sub: why, cta: t("Start the warm-up"), attrs: `data-act="start" data-kind="isinma"` };
    }
    if (step.kind === "warmup-plain") return { title: t("Warm-up: 5 questions"), sub: t("A short quiz to start the day"), cta: t("Start the warm-up"), attrs: `data-act="start" data-kind="isinma"` };
    if (step.kind === "mixed") return { title: t("Mixed quiz"), sub: t("10 questions from every topic"), cta: t("Start"), attrs: `data-act="start" data-kind="karisik"` };
    if (step.kind === "topic") return { title: tp.title, sub: t("A weak topic: a short quiz on it"), cta: t("Quiz on this topic"), attrs: `data-act="topicquiz" data-id="${esc(tp.id)}"` };
    const n = tp.lesson.steps?.length || 0;
    return step.resume
      ? { title: tp.title, sub: n ? t("Continue the lesson: step {a} of {b}", { a: Math.min(step.step + 1, n), b: n }) : t("Continue the lesson"), cta: t("Continue"), attrs: `data-act="lesson" data-id="${esc(tp.id)}"` }
      : { title: tp.title, sub: (tp.group ? tp.group + " · " : "") + t("The next lesson on your path"), cta: t("Start the lesson"), attrs: `data-act="lesson" data-id="${esc(tp.id)}"` };
  }

  function renderToday(box) {
    if (!env.hasContent()) { box.innerHTML = env.empty(); return; }
    const st = env.states(), p = env.progress(), steps = core.nextSteps(env.content(), p, st, env.today()).map(describe);
    const np = env.nextProblem?.();
    if (np) steps.push({ title: np.title, sub: t("A problem to solve") + " · " + ({ 1: t("Easy"), 2: t("Medium"), 3: t("Hard") })[np.level], cta: t("Solve it"), attrs: `data-act="problem" data-id="${esc(np.id)}"` });
    const [main, ...rest] = steps, all = env.content().topics;
    const sk = core.streak(p.sessions, env.today()), right = p.answers.filter((x) => x.dogruMu).length;
    const settled = all.filter((x) => st[x.id].status === "oturdu").length;
    box.innerHTML = `<div class="st-today">` +
      (main ? `<section class="st-next"><p class="st-kicker">${esc(t("Your next step"))}</p><h3>${esc(main.title)}</h3><p>${esc(main.sub)}</p><div><button type="button" class="btn primary" ${main.attrs}>${esc(main.cta)}</button></div></section>` : "") +
      (rest.length ? `<div class="st-alts">${rest.slice(0, 3).map((x) => `<button type="button" class="st-alt" ${x.attrs}><b>${esc(x.title)}</b><span>${esc(x.sub)}</span></button>`).join("")}</div>` : "") +
      `<dl class="st-nums">` +
        `<div><dt>${esc(t("Days in a row"))}</dt><dd>${sk.count}</dd></div>` +
        `<div><dt>${esc(t("Lessons read"))}</dt><dd>${readCount(all)}<small> / ${withLesson(all)}</small></dd></div>` +
        `<div><dt>${esc(t("Correct answers"))}</dt><dd>${p.answers.length ? Math.round((right / p.answers.length) * 100) + "%" : "–"}</dd></div>` +
        `<div><dt>${esc(t("Topics settled"))}</dt><dd>${settled}<small> / ${all.length}</small></dd></div>` +
      `</dl>` +
      `<section class="st-pathmini"><h4>${esc(t("Your path"))}</h4>${groupsOf().map((g, i) => {
        const a = readCount(g.topics), b = withLesson(g.topics);
        return `<button type="button" class="st-prow" data-act="group" data-i="${i}"><span>${esc(g.name)}</span>${bar(a, b)}<small>${a} / ${b}</small></button>`;
      }).join("")}</section></div>`;
    enter(box.firstElementChild);
  }

  // ------------------------------------------------------------------ Learn: the path
  const mark = (tp) => {
    const l = lessons()[tp.id];
    if (!tp.lesson) return `<i class="st-mk" data-m="none" title="${esc(t("No lesson yet"))}"></i>`;
    if (l?.done) return `<i class="st-mk" data-m="done" title="${esc(t("Read"))}">✓</i>`;
    if (l?.step > 0) return `<i class="st-mk" data-m="open" title="${esc(t("Started"))}"></i>`;
    return `<i class="st-mk" data-m="new" title="${esc(t("Not read yet"))}"></i>`;
  };
  function renderPath(box, focusGroup) {
    if (!env.hasContent()) { box.innerHTML = env.empty(); return; }
    const st = env.states(), qn = (id) => env.content().questions.filter((q) => q.topic === id).length;
    box.innerHTML = `<div class="st-path">${groupsOf().map((g, i) => {
      const a = readCount(g.topics), b = withLesson(g.topics);
      return `<section class="st-group" id="st-g-${i}"><header><h3>${esc(g.name)}</h3>${bar(a, b)}<small>${esc(t("{a} of {b} read", { a, b }))}</small>` +
        (a < b ? `<button type="button" class="st-link" data-act="groupdone" data-i="${i}" title="${esc(t("Use this when you already know these topics"))}">${esc(t("Mark all as read"))}</button>` : "") + `</header>` +
        `<div class="st-rows">${g.topics.map((tp) => {
          const s = st[tp.id], n = qn(tp.id);
          return `<button type="button" class="st-row" data-act="lesson" data-id="${esc(tp.id)}">${mark(tp)}<span class="st-rt">${esc(tp.title)}</span>${env.chip(s.status)}` +
            `<small>${esc(n ? t("{n} {n|question|questions}", { n }) : t("No questions yet"))}${s.total ? " · " + esc(t("{a} of {b} right", { a: s.correct, b: s.total })) : ""}</small></button>`;
        }).join("")}</div></section>`;
    }).join("")}<p class="st-foot"><button type="button" class="st-link" data-act="reset">${esc(t("Reset progress"))}</button></p></div>`;
    enter(box.firstElementChild);
    if (focusGroup !== undefined) $("#st-g-" + focusGroup)?.scrollIntoView({ block: "start" }); else box.scrollTop = pathScroll;
  }

  // ------------------------------------------------------------------ Lesson
  // a piece of code the learner can run as it is, or change first
  const cell = (key, code) => {
    const mine = edits.get(key);
    return `<div class="st-cell" data-cell="${esc(key)}">` +
      (mine === undefined ? env.codeBlock(code) : `<textarea class="st-edit" spellcheck="false" rows="${Math.min(Math.max(mine.split("\n").length, 3), 28)}" aria-label="${esc(t("Code you can change"))}">${esc(mine)}</textarea>`) +
      `<div class="st-q-b"><button type="button" class="btn sm" data-act="cellrun">${esc(t("Run it"))}</button>` +
      (mine === undefined ? `<button type="button" class="btn ghost sm" data-act="celledit">${esc(t("Change the code"))}</button>` : `<button type="button" class="btn ghost sm" data-act="cellreset">${esc(t("Back to the original"))}</button>`) +
      `</div><div class="st-real" hidden></div></div>`;
  };
  const codeOf = (key) => {
    const L = env.topicOf(reading)?.lesson || {};
    return key === "ex" ? L.example : L.steps?.[Number(key.slice(1))]?.code;
  };
  // the question under a step: once answered it shows which option was right and why
  const checkHtml = (c, i) => {
    const mine = picked.get(i), done = mine !== undefined;
    return `<div class="st-check" data-i="${i}"><p class="st-check-q">${esc(c.ask)}</p><div class="st-check-o">${c.options.map((o, n) =>
      `<button type="button" data-act="checkpick" data-i="${i}" data-o="${n}" ${done ? "disabled" : ""} class="${done ? (n === c.correct ? "ok" : n === mine ? "bad" : "") : ""}">${esc(o)}</button>`).join("")}</div>` +
      (done ? `<p class="st-check-w"><b>${esc(mine === c.correct ? t("Right.") : t("Not quite."))}</b> ${esc(c.why)}</p>` : "") + `</div>`;
  };
  const stepHtml = (x, i) => `<section class="st-step" id="st-step-${i}"><h4><b>${i + 1}</b>${esc(x.title || "")}</h4><p>${esc(x.text)}</p>${x.code ? cell("s" + i, x.code) : x.snippet ? env.codeBlock(x.snippet) : ""}${x.check ? checkHtml(x.check, i) : ""}</section>`;
  // what still has to be done on the last open step before the next one opens: run its code, answer its question
  const gate = (steps, shown) => {
    const i = shown - 1, x = steps[i]; if (!x) return null;
    if (x.code && !ran.has(i)) return t("Run the code first");
    if (x.check && !picked.has(i)) return t("Answer the question first");
    return null;
  };
  const moreHtml = (steps, shown) => {
    const wait = gate(steps, shown);
    return `<div class="st-more" id="st-more"><button type="button" class="btn primary" data-act="stepnext" ${wait ? "disabled" : ""}>${esc(wait || t("Got it, next step"))}</button><button type="button" class="st-link" data-act="stepall">${esc(t("Show all steps"))}</button></div>`;
  };
  const syncGate = () => { const tp = env.topicOf(reading), more = $("#st-more"); if (!tp || !more) return; const steps = tp.lesson.steps || []; more.outerHTML = moreHtml(steps, $("#st-steps").children.length); };

  function renderLesson(box) {
    const tp = env.topicOf(reading), L = tp.lesson || {}, st = env.states(), s = st[tp.id];
    const all = env.content().topics, at = all.indexOf(tp), prev = all[at - 1], next = all[at + 1];
    const state = lessons()[tp.id] || { step: 0, done: false }, steps = L.steps || [];
    const shown = state.done ? steps.length : Math.min(state.step + 1, steps.length), finished = shown >= steps.length;
    const hints = env.content().hints.filter((h) => h.topic === tp.id), notes = env.progress().notes.filter((n) => n.topic === tp.id);
    const qn = env.content().questions.filter((q) => q.topic === tp.id).length, talk = (L.talk || []).length, mine = env.tasks().filter((k) => k.topic === tp.id);
    const qOf = (id) => env.content().questions.find((q) => q.id === id);
    const sec = (title, html) => (html ? `<h3>${esc(title)}</h3>${html}` : "");
    env.select(tp.id);
    box.innerHTML = `<article class="st-lesson">` +
      `<p class="st-crumb"><button type="button" class="st-link" data-act="path">${esc(t("All topics"))}</button>${tp.group ? `<span>${esc(tp.group)}</span>` : ""}</p>` +
      `<h2>${esc(tp.title)}</h2><p class="st-reason">${env.chip(s.status)} <span>${esc(env.reason(s))}</span></p>` +
      (L.summary ? `<p class="st-lead">${esc(L.summary)}</p>` : "") +
      (steps.length ? `<div class="st-prog" id="st-prog">${bar(shown, steps.length)}<small>${esc(t("Step {a} of {b}", { a: shown, b: steps.length }))}</small></div>` +
        `<div id="st-steps">${steps.slice(0, shown).map(stepHtml).join("")}</div>` +
        (finished ? "" : moreHtml(steps, shown)) : "") +
      `<div id="st-rest" ${finished ? "" : "hidden"}>` +
        sec(t("Key points"), L.points?.length ? `<ul class="st-list">${L.points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "") +
        sec(t("Example"), L.example ? cell("ex", L.example) : "") +
        sec(t("A common mistake"), L.mistake ? `<p class="st-mist">${esc(L.mistake)}</p>` : "") +
        sec(t("Cheat sentences"), hints.length || notes.length ? `<ul class="st-list">${hints.map((h) => `<li>${esc(h.text)}</li>`).join("")}${notes.map((x) => `<li class="mine">${esc(x.text)}</li>`).join("")}</ul>` : "") +
        sec(t("How to say it"), L.say ? `<p class="st-say">${esc(L.say)}</p>` : "") +
        `<section class="st-done"><h3>${esc(state.done ? t("You have read this lesson") : t("Finish the lesson"))}</h3>` +
          `<p>${esc(qn ? t("Reading is half of it. Answer a few questions now, while it is fresh.") : t("There are no questions on this topic yet; the tutor can write some."))}</p>` +
          `<div class="st-q-b">` +
            (qn ? `<button type="button" class="btn primary" data-act="lessonquiz">${esc(state.done ? t("Quiz on this topic") : t("Finish and take the quiz"))}</button>` : "") +
            (state.done ? "" : `<button type="button" class="btn${qn ? "" : " primary"}" data-act="lessondone">${esc(t("Mark as read"))}</button>`) +
            (talk ? `<button type="button" class="btn" data-act="saytopic">${esc(t("Say it ({n})", { n: talk }))}</button>` : "") +
            `<button type="button" class="btn ghost" data-act="morequestions" title="${esc(t("The tutor writes new questions; each one is run here and kept only when its real output is among the options"))}">${esc(t("New questions from the tutor"))}</button>` +
          `</div>` +
          (mine.length ? `<p class="st-tasksh">${esc(t("Coding tasks on this topic"))}</p><div class="st-q-b">${mine.map((k) => `<button type="button" class="btn sm" data-act="opentask" data-id="${esc(k.id)}">${esc(k.title)}</button>`).join("")}</div>` : "") +
        `</section>` +
        (s.recent.length ? `<details class="st-past"><summary>${esc(t("My last 10 answers"))}</summary><ul class="st-hist">${s.recent.map((a) => `<li class="${a.dogruMu ? "ok" : "bad"}"><b>${a.dogruMu ? "✓" : "✗"}</b><time>${esc(env.nice(a.tarih))}</time><code>${esc(env.firstLine(qOf(a.questionId)?.code || ""))}</code><span>${esc(a.secilen)}</span></li>`).join("")}</ul></details>` : "") +
      `</div>` +
      `<nav class="st-lnav">${prev ? `<button type="button" class="btn ghost sm" data-act="lesson" data-id="${esc(prev.id)}">← ${esc(prev.title)}</button>` : "<span></span>"}${next ? `<button type="button" class="btn ghost sm" data-act="lesson" data-id="${esc(next.id)}">${esc(next.title)} →</button>` : ""}</nav></article>`;
  }

  function setLesson(id, patch) {
    const cur = lessons()[id] || { step: 0, done: false };
    lessons()[id] = { ...cur, ...patch, at: new Date().toISOString() };
    env.saveLessons();
  }
  function openLesson(id, box) {
    if (!env.topicOf(id)) return;
    if (!reading) pathScroll = box.scrollTop;
    reading = id; edits.clear(); ran.clear(); picked.clear();
    if (env.topicOf(id).lesson && !lessons()[id]) setLesson(id, { step: 0 });
    renderLesson(box); enter(box.firstElementChild); box.scrollTop = 0;
  }
  function revealNext(box, all) {
    const tp = env.topicOf(reading), steps = tp.lesson.steps || [], cur = lessons()[tp.id]?.step || 0;
    const to = all ? steps.length : Math.min(cur + 1, steps.length);
    setLesson(tp.id, { step: to });
    const host = $("#st-steps"), had = host.children.length, upto = Math.min(to + 1, steps.length);
    for (let i = had; i < upto; i++) host.insertAdjacentHTML("beforeend", stepHtml(steps[i], i));
    const fresh = host.children[had];
    $("#st-prog").innerHTML = `${bar(upto, steps.length)}<small>${esc(t("Step {a} of {b}", { a: upto, b: steps.length }))}</small>`;
    if (upto >= steps.length && to >= steps.length - 1) { $("#st-more")?.remove(); const rest = $("#st-rest"); rest.hidden = false; enter(rest); } else syncGate();
    if (fresh) { enter(fresh); fresh.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }

  /** A click inside the learning views. Returns true when it was one of ours. */
  async function click(act, el, box) {
    switch (act) {
      case "lesson": env.show("learn"); openLesson(el.dataset.id, $("#st-learn")); return true;
      case "path": reading = null; renderPath(box); return true;
      case "group": reading = null; env.show("learn", Number(el.dataset.i)); return true;
      case "groupdone": { for (const tp of groupsOf()[Number(el.dataset.i)].topics) if (tp.lesson && !lessons()[tp.id]?.done) lessons()[tp.id] = { step: tp.lesson.steps?.length || 0, done: true, at: new Date().toISOString() }; env.saveLessons(); pathScroll = box.scrollTop; renderPath(box); return true; }
      case "stepnext": revealNext(box, false); return true;
      case "stepall": revealNext(box, true); return true;
      case "lessondone": setLesson(reading, { done: true, step: env.topicOf(reading).lesson?.steps?.length || 0 }); { const top = box.scrollTop; renderLesson(box); box.scrollTop = top; } return true;
      case "lessonquiz": setLesson(reading, { done: true, step: env.topicOf(reading).lesson?.steps?.length || 0 }); env.startQuiz("konu", reading); return true;
      case "checkpick": { const i = Number(el.dataset.i), c = env.topicOf(reading)?.lesson?.steps?.[i]?.check; if (!c || picked.has(i)) return true; picked.set(i, Number(el.dataset.o)); el.closest(".st-check").outerHTML = checkHtml(c, i); syncGate(); return true; }
      case "celledit": { const c = el.closest(".st-cell"), key = c.dataset.cell; edits.set(key, codeOf(key)); c.outerHTML = cell(key, codeOf(key)); const ta = $(`.st-cell[data-cell="${key}"] textarea`); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return true; }
      case "cellreset": { const c = el.closest(".st-cell"), key = c.dataset.cell; edits.delete(key); c.outerHTML = cell(key, codeOf(key)); return true; }
      case "cellrun": {
        const c = el.closest(".st-cell"), key = c.dataset.cell, ta = $("textarea", c), code = ta ? ta.value : codeOf(key); if (!code?.trim()) return true;
        if (ta) edits.set(key, ta.value);
        el.disabled = true; const res = await env.run(code); el.disabled = false;
        const out = $(".st-real", c); if (out) { out.hidden = false; out.innerHTML = env.runOut(res); enter(out); }
        if (key[0] === "s") { ran.add(Number(key.slice(1))); syncGate(); }
        return true;
      }
      default: return false;
    }
  }
  /** Keys inside a code cell: Tab writes two spaces, Ctrl+Enter runs. */
  function keydown(e) {
    const ta = e.target.closest?.(".st-edit"); if (!ta) return;
    if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end"); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.closest(".st-cell").querySelector('[data-act="cellrun"]').click(); }
    else if (e.key === "Escape") e.stopPropagation(); // leaving the editor with Esc must not close the whole room
  }
  function input(e) { const ta = e.target.closest?.(".st-edit"); if (ta) { edits.set(ta.closest(".st-cell").dataset.cell, ta.value); ta.rows = Math.min(Math.max(ta.value.split("\n").length, 3), 28); } }

  return {
    renderToday,
    renderLearn(box, focusGroup) { if (reading && env.topicOf(reading) && focusGroup === undefined) { renderLesson(box); } else { reading = null; renderPath(box, focusGroup); } },
    click, keydown, input,
    get reading() { return reading; },
    leave() { reading = null; edits.clear(); ran.clear(); picked.clear(); pathScroll = 0; },
  };
}
