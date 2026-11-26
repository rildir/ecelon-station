// JS Study: the tutor. Four small jobs given to Claude Code as one-off questions without tools (runner.oneShot):
// explain a wrong answer, grade an answer written in the user's own words, comment on the code of a task, and write
// new questions for a topic. This file only builds the prompts and reads the answers; it runs nothing. Questions the
// model writes are never trusted as they come: the page runs each one in its sandbox and keeps it only when the real
// output is one of the options (public/study.js).
export const TUTOR_MODEL = "claude-sonnet-5-5";
const cut = (s, n) => String(s ?? "").slice(0, n);
const langName = (lang) => (lang === "tr" ? "Turkish" : "English");
const about = (topic) => (topic ? `Topic: ${topic.title}\n` + (topic.lesson?.summary ? `What the lesson says: ${topic.lesson.summary}\n` : "") : "");

/** The prompt for one job, or null when something it needs is missing. `c` is the content, `d` what the page sent. */
export function tutorPrompt(kind, c, d = {}, lang = "en") {
  const L = langName(lang), topicOf = (id) => c.topics.find((x) => x.id === id);
  const head = `You are a patient, exact JavaScript tutor. Write in ${L}. Plain text only: no markdown headings, no code fences unless you show code, no greetings.\n`;
  if (kind === "why") {
    const q = c.questions.find((x) => x.id === d.questionId); if (!q) return null;
    return head + about(topicOf(q.topic)) + `The learner answered a multiple-choice question wrongly.\n\nCode:\n${q.code}\n\nQuestion: ${q.ask}\nRight answer: ${q.options[q.correct]}\nThe learner chose: ${cut(d.picked, 300)}\nThe short official explanation: ${q.why}\n\n` +
      `In at most 130 words: 1) say which line of thinking most likely led to the chosen answer, 2) walk through the code step by step to the right answer, 3) end with one short rule to remember. Speak to the learner directly.`;
  }
  if (kind === "talk") {
    const tp = topicOf(d.topic), item = tp?.lesson?.talk?.[d.n]; if (!item || !String(d.mine || "").trim()) return null;
    return head + about(tp) + `The learner was asked to explain something in their own words, as they would say it aloud to a senior engineer.\n\nQuestion: ${item.ask}\nA model answer: ${item.answer}\nThe learner's answer: ${cut(d.mine, 2000)}\n\n` +
      `Judge the learner's answer for correctness and completeness, not for style. Reply with ONLY a JSON object, no other text:\n{"score": <whole number 0-100>, "good": ["what was right, short"], "missing": ["what was missing or wrong, short"], "better": "one improved version of the learner's own answer, at most 70 words"}\nUse at most 3 items in each list. Write the texts in ${L}.`;
  }
  if (kind === "code") {
    const k = c.tasks.find((x) => x.id === d.taskId); if (!k || !String(d.code || "").trim()) return null;
    return head + about(topicOf(k.topic)) + `The learner wrote code for a small task.\n\nTask: ${k.title}\n${k.description}\nExpected console output:\n${k.expectedOutput.join("\n")}\n\nThe learner's code:\n${cut(d.code, 6000)}\n\nWhat it really printed:\n${cut(d.output, 2000) || "(nothing)"}\nMatched the expected output: ${d.matched ? "yes" : "no"}\n\n` +
      (d.matched ? `In at most 130 words: say what is good, then one or two concrete improvements a senior reviewer would ask for (naming, edge cases, a cleaner idiom). Do not rewrite the whole solution.`
        : `In at most 130 words: point to the exact cause of the difference and give a hint that lets the learner fix it themselves. Do NOT give the corrected code.`);
  }
  if (kind === "follow") {
    // a follow-up question on an answer the tutor gave: the same facts again, then the talk so far
    const base = d.base && typeof d.base === "object" ? d.base : null, ask = String(d.ask || "").trim();
    if (!base || !["why", "talk", "code"].includes(base.kind) || !ask) return null;
    const first = tutorPrompt(base.kind, c, base, lang); if (!first) return null;
    const facts = first.slice(head.length).split("\n\n").slice(0, -1).join("\n\n"); // everything but the instruction of the first job
    const talk = (Array.isArray(d.thread) ? d.thread : []).slice(-6).filter((m) => m && typeof m.text === "string").map((m) => (m.who === "me" ? "Learner: " : "Tutor: ") + cut(m.text, 1500)).join("\n\n");
    return head + facts + `\n\nThe conversation so far:\n${talk || "(nothing yet)"}\n\nThe learner now asks: ${cut(ask, 600)}\n\n` +
      `Answer this question in at most 150 words. Stay on this topic; if a tiny code example makes it clearer, show one (at most 8 lines). If the question shows a wrong idea, name it and correct it.`;
  }
  if (kind === "more") {
    const tp = topicOf(d.topic); if (!tp) return null;
    const have = c.questions.filter((q) => q.topic === tp.id).slice(-12).map((q) => "- " + q.code.split("\n").slice(0, 3).join(" ").slice(0, 140)).join("\n");
    const n = Math.min(Math.max(Number(d.count) || 4, 1), 6), level = ["easy", "medium", "hard"].includes(d.level) ? d.level : "medium";
    return `You write practice questions for a JavaScript study tool.\n` + about(tp) + (tp.lesson?.points?.length ? `Points of the lesson:\n${tp.lesson.points.map((p) => "- " + p).join("\n")}\n` : "") +
      `\nWrite ${n} NEW "what does the console print" questions on this topic, difficulty: ${level}. Each must test a different point or trap. Do not repeat these existing ones:\n${have || "(none)"}\n\n` +
      `Hard rules, the tool runs every question and throws away any whose real output is not among the options:\n- The code is plain JavaScript that runs alone in a web worker: no DOM, no imports, no network, no random numbers, no dates, finishes within one second.\n- It prints only with console.log, and only strings, numbers, booleans, null or undefined. Print arrays and objects through JSON.stringify or join.\n- 3 to 12 lines of code.\n- Exactly 4 options, all different. Each option is the WHOLE console output with the printed lines joined by one space. An error is shown as the name it prints, never as "error".\n- "correct" is the 0-based index of the right option.\n- "why" explains the answer in one or two sentences, in ${L}. "ask" is the question in ${L}.\n\n` +
      `Reply with ONLY a JSON object, no other text:\n{"questions": [{"code": "...", "ask": "...", "options": ["...", "...", "...", "..."], "correct": 0, "why": "..."}]}`;
  }
  return null;
}

/** The first JSON object in a text the model wrote (it may have wrapped it in a code fence or a sentence). */
export function pickJson(text) {
  const s = String(text ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a < 0 || b <= a) return null;
  try { const v = JSON.parse(s.slice(a, b + 1)); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

const strs = (v, n, max) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x) => cut(x.trim(), max)) : []);
/** What is kept of a graded answer. */
export function cleanGrade(v) {
  if (!v || !Number.isFinite(Number(v.score))) return null;
  return { score: Math.min(100, Math.max(0, Math.round(Number(v.score)))), good: strs(v.good, 3, 300), missing: strs(v.missing, 3, 300), better: cut(typeof v.better === "string" ? v.better.trim() : "", 800) };
}
/** The questions of an answer that have the right shape (the page still has to run them). They get ids of their own. */
export function cleanQuestions(v, topic, stamp = Date.now().toString(36)) {
  const list = Array.isArray(v?.questions) ? v.questions : [];
  return list.filter((q) => q && typeof q.code === "string" && q.code.trim() && q.code.length <= 3000 && typeof q.ask === "string" && q.ask.trim() && typeof q.why === "string" && q.why.trim()
    && Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 6 && q.options.every((o) => typeof o === "string" && o.trim() && o.length <= 300) && new Set(q.options.map((o) => o.trim())).size === q.options.length
    && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length)
    .slice(0, 6).map((q, i) => ({ id: `g-${topic}-${stamp}-${i + 1}`.slice(0, 80), topic, code: q.code.replace(/\r\n/g, "\n").trim(), ask: cut(q.ask.trim(), 300), options: q.options.map((o) => o.trim()), correct: q.correct, why: cut(q.why.trim(), 1500) }));
}
