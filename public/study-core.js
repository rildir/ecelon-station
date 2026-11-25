// The rules of the JS Study module, as plain functions: no page, no network, no clock of its own. Everything that
// needs "today" gets it as an argument, so the rules can be tested (and the date moved a day forward) without
// touching the system clock. The page (study.js) and the server (study.js there) both use this one file.
//
// What the module keeps, apart from each other:
//   content   topics, hints, questions, tasks      (a pack; imported, never worn out by use)
//   progress  answers, attempts, sessions, notes   (what the user did; stays on this computer in data/study.json)

export const STATUSES = ["oturdu", "orta", "zayif", "yeni"]; // what a pack may say about a topic; "tekrar" is only ever computed
export const REPEAT_DAYS = 7;   // a settled topic not asked for this many days is due for a repeat
export const SETTLE_DAYS = 3;   // correct answers on this many different days in a row settle a topic
export const WINDOW = 5;        // weak: this many latest answers are looked at ...
export const WEAK_WRONG = 2;    // ... and this many wrong ones make the topic weak
const plain = (s, p) => (p ? String(s).replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (m, k, one, many) => (k in p ? (Number(p[k]) === 1 ? one : many) : m)).replace(/\{(\w+)\}/g, (m, k) => (k in p ? String(p[k]) : m)) : String(s));

// ---------------------------------------------------------------- days
const pad = (n) => String(n).padStart(2, "0");
/** "2026-11-25": the local calendar day of a date (or of an ISO timestamp). */
export const dayKey = (d = new Date()) => { const x = d instanceof Date ? d : new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const dayNum = (key) => { const [y, m, d] = String(key).split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);
export const addDays = (key, n) => { const x = new Date(dayNum(key) * 86400000 + n * 86400000); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; };

// ---------------------------------------------------------------- topic status
const byTime = (a, b) => (a.tarih < b.tarih ? -1 : a.tarih > b.tarih ? 1 : 0);

/** Where a topic stands. `answers` are the answers to this topic's questions. The rules:
 *   - correct answers on 3 different days in a row (no wrong answer between) settle a topic: oturdu;
 *   - a settled topic not asked for 7 days is due: tekrar. A wrong answer on a settled topic makes it zayif;
 *   - at least 2 wrong answers among the latest 5: zayif (it stays so until two correct answers in a row);
 *   - anything else that has been asked: orta. With no answers at all, the pack's own starting status stands. */
export function topicState(topic, answers, today) {
  const list = [...answers].sort(byTime), win = [];
  let sat = topic.status === "oturdu", fell = topic.status === "zayif", run = new Set(), okRow = 0;
  for (const a of list) {
    win.push(!!a.dogruMu); if (win.length > WINDOW) win.shift();
    if (a.dogruMu) { run.add(a.gun); okRow++; if (okRow >= 2) fell = false; if (run.size >= SETTLE_DAYS) sat = true; }
    else { if (sat) fell = true; sat = false; run = new Set(); okRow = 0; }
  }
  const last = list.length ? list[list.length - 1].gun : null, wrong = win.filter((x) => !x).length;
  let status;
  if (!list.length) status = STATUSES.includes(topic.status) ? topic.status : "yeni";
  else if (sat) status = daysBetween(last, today) >= REPEAT_DAYS ? "tekrar" : "oturdu";
  else if (fell || wrong >= WEAK_WRONG) status = "zayif";
  else status = "orta";
  return { status, last, total: list.length, correct: list.filter((a) => a.dogruMu).length, recent: list.slice(-10).reverse() };
}
/** { topicId: state } for every topic of the content. */
export function allStates(content, answers, today) {
  const by = {}; for (const a of answers) (by[a.topic] ||= []).push(a);
  return Object.fromEntries(content.topics.map((tp) => [tp.id, topicState(tp, by[tp.id] || [], today)]));
}

// ---------------------------------------------------------------- streak
/** Days in a row with at least one finished warm-up. Today may still be empty: the streak then counts up to yesterday. */
export function streak(sessions, today) {
  const days = new Set(sessions.filter((s) => s.tur === "isinma").map((s) => s.gun));
  const doneToday = days.has(today); let n = 0, d = doneToday ? today : addDays(today, -1);
  while (days.has(d)) { n++; d = addDays(d, -1); }
  const sorted = [...days].sort(); let best = 0, cur = 0;
  sorted.forEach((k, i) => { cur = i && daysBetween(sorted[i - 1], k) === 1 ? cur + 1 : 1; best = Math.max(best, cur); });
  return { count: n, doneToday, best };
}

// ---------------------------------------------------------------- picking questions
/** A random generator that repeats itself for the same seed (for tests). */
export function seeded(seed = 1) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
export function shuffled(list, rng = Math.random) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/** The question with its options in a new order; `correct` follows the right option. */
export function shuffleOptions(q, rng = Math.random) {
  const order = shuffled(q.options.map((_, i) => i), rng);
  return { ...q, options: order.map((i) => q.options[i]), correct: order.indexOf(q.correct) };
}
const lastAnswers = (answers) => { const m = new Map(); for (const a of [...answers].sort(byTime)) m.set(a.questionId, a); return m; };
// one from each topic in turn, so a warm-up does not become five questions about one subject
function spread(questions, rng) {
  const by = new Map(); for (const q of shuffled(questions, rng)) { if (!by.has(q.topic)) by.set(q.topic, []); by.get(q.topic).push(q); }
  const out = [], lists = shuffled([...by.values()], rng);
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}
/** The daily warm-up: 1) questions got wrong on an earlier day (the latest day first), 2) questions of topics due for
 *  a repeat, 3) of weak topics, 4) anything else. Questions already answered today come last, only if nothing else is left. */
export function pickWarmup(content, answers, today, rng = Math.random, n = 5) {
  const states = allStates(content, answers, today), last = lastAnswers(answers), picked = [], seen = new Set();
  const answeredToday = new Set(answers.filter((a) => a.gun === today).map((a) => a.questionId));
  const take = (list) => { for (const q of list) { if (picked.length >= n) return; if (!seen.has(q.id)) { seen.add(q.id); picked.push(q); } } };
  const fresh = (q) => !seen.has(q.id) && !answeredToday.has(q.id);
  const wrongBefore = content.questions.filter((q) => { const a = last.get(q.id); return a && !a.dogruMu && a.gun < today; })
    .sort((x, y) => { const a = last.get(x.id), b = last.get(y.id); return a.gun === b.gun ? byTime(a, b) : a.gun < b.gun ? 1 : -1; });
  take(wrongBefore);
  for (const wanted of ["tekrar", "zayif"]) take(spread(content.questions.filter((q) => fresh(q) && states[q.topic]?.status === wanted), rng));
  take(shuffled(content.questions.filter(fresh), rng));
  take(shuffled(content.questions.filter((q) => !seen.has(q.id)), rng)); // what was answered today, if there is nothing else
  return picked;
}
export const pickTopicTest = (content, topicId, rng = Math.random, n = 10) => shuffled(content.questions.filter((q) => q.topic === topicId), rng).slice(0, n);
export const pickMixed = (content, rng = Math.random, n = 10) => shuffled(content.questions, rng).slice(0, n);

// ---------------------------------------------------------------- comparing output
// A line that is an array or an object is compared by its structure: spaces and the way keys are quoted do not matter
// ([ 10, 30 ] = [10,30], { a: 1 } = {"a":1}). Any other line is compared as text with its spaces tidied. Line order counts.
function structure(s) {
  let out = "", i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") { // a string: always written with double quotes
      let j = i + 1, body = ""; while (j < s.length && s[j] !== c) { if (s[j] === "\\" && j + 1 < s.length) { body += s[j] + s[j + 1]; j += 2; } else body += s[j++]; }
      if (c === "'") body = body.replace(/\\.|"/g, (m) => (m === '"' ? '\\"' : m === "\\'" ? "'" : m));
      out += '"' + body + '"'; i = j + 1; continue;
    }
    if (!/\s/.test(c)) out += c; i++;
  }
  return out.replace(/"([A-Za-z_$][\w$]*)":/g, "$1:"); // {"a":1} and { a: 1 } are the same object
}
export const canonLine = (line) => { const s = String(line).trim(); return /^[[{]/.test(s) ? structure(s) : s.replace(/\s+/g, " "); };
const linesOf = (x) => (Array.isArray(x) ? x : String(x ?? "").split("\n")).flatMap((l) => String(l).split("\n")).map(canonLine).filter((l) => l !== "");
/** { match, diff }: diff is the 0-based number of the first line that differs, or -1. */
export function compareOutput(actual, expected) {
  const a = linesOf(actual), e = linesOf(expected), n = Math.max(a.length, e.length);
  for (let i = 0; i < n; i++) if (a[i] !== e[i]) return { match: false, diff: i };
  return { match: true, diff: -1 };
}

// ---------------------------------------------------------------- packs: checking and merging
const ID = /^[A-Za-z0-9_.-]{1,80}$/;
const LIMITS = { list: 3000, title: 200, code: 6000, ask: 300, option: 300, why: 1500, desc: 4000, line: 400, lines: 100, hint: 600, taskHints: 20 };
const isStr = (x) => typeof x === "string";
const norm = (s) => String(s).replace(/\r\n/g, "\n");
const emptyContent = () => ({ topics: [], hints: [], questions: [], tasks: [] });
export const emptyProgress = () => ({ answers: [], attempts: [], sessions: [], notes: [], drafts: {} });

/** Check a pack (the parsed JSON) against the schema. `existing` is the content already kept: a question may belong to
 *  a topic that is not in the pack but is already there. Returns { ok: true, pack } with only the known fields, or
 *  { ok: false, errors }. Nothing is changed here. `t` translates the messages (the tests leave it out). */
export function validatePack(raw, existing = emptyContent(), t = plain) {
  const errors = [], bad = (where, msg) => { errors.push(where + ": " + msg); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: [t("The pack must be a JSON object with topics, hints, questions and tasks.")] };
  if (raw.version !== undefined && raw.version !== 1) bad("version", t("must be 1"));
  const pack = emptyContent(), lists = ["topics", "hints", "questions", "tasks"];
  for (const k of lists) {
    if (raw[k] === undefined) continue;
    if (!Array.isArray(raw[k])) { bad(k, t("must be a list")); continue; }
    if (raw[k].length > LIMITS.list) bad(k, t("too many items (the limit is {n})", { n: LIMITS.list }));
  }
  if (errors.length) return { ok: false, errors };
  const str = (where, v, key, max) => {
    if (!isStr(v[key]) || !v[key].trim()) { bad(where, t("{key} must be a non-empty text", { key })); return ""; }
    if (v[key].length > max) { bad(where, t("{key} is too long (the limit is {n} characters)", { key, n: max })); return ""; }
    return norm(v[key]);
  };
  const ids = (k) => { const seen = new Set(); return (v, i) => { const where = `${k}[${i}]`; if (!v || typeof v !== "object" || Array.isArray(v)) { bad(where, t("must be an object")); return null; } if (!isStr(v.id) || !ID.test(v.id)) { bad(where, t("id must be 1-80 letters, digits, - _ .")); return null; } if (seen.has(v.id)) { bad(`${k} (${v.id})`, t("id appears twice in the pack")); return null; } seen.add(v.id); return `${k}[${i}] (${v.id})`; }; };
  const topicOk = (tp) => ID.test(tp);

  const pid = ids("topics");
  (raw.topics || []).forEach((tp, i) => { const where = pid(tp, i); if (!where) return;
    const title = str(where, tp, "title", LIMITS.title), status = tp.status === "zay\u0131f" ? "zayif" : tp.status;
    if (!STATUSES.includes(status)) bad(where, t("status must be one of {list}", { list: STATUSES.join(", ") }));
    if (title && STATUSES.includes(status)) pack.topics.push({ id: tp.id, title, status }); });
  const known = new Set([...existing.topics.map((x) => x.id), ...(raw.topics || []).filter((x) => x && isStr(x.id)).map((x) => x.id)]);

  (raw.hints || []).forEach((h, i) => { const where = `hints[${i}]`; if (!h || typeof h !== "object" || Array.isArray(h)) return bad(where, t("must be an object"));
    const text = str(where, h, "text", LIMITS.hint); if (!isStr(h.topic) || !topicOk(h.topic)) return bad(where, t("topic must be a topic id"));
    if (h.topic !== "genel" && !known.has(h.topic)) return bad(where, t("topic {id} does not exist", { id: h.topic }));
    if (text) pack.hints.push({ topic: h.topic, text }); });

  const qid = ids("questions");
  (raw.questions || []).forEach((q, i) => { const where = qid(q, i); if (!where) return; const before = errors.length;
    const code = str(where, q, "code", LIMITS.code), ask = str(where, q, "ask", LIMITS.ask), why = str(where, q, "why", LIMITS.why);
    if (!isStr(q.topic) || !known.has(q.topic)) bad(where, t("topic {id} does not exist", { id: String(q.topic) }));
    const opts = Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 6 && q.options.every((o) => isStr(o) && o.trim() && o.length <= LIMITS.option);
    if (!opts) bad(where, t("options must be 2 to 6 non-empty texts"));
    else if (new Set(q.options.map((o) => o.trim())).size !== q.options.length) bad(where, t("options must differ from each other"));
    if (opts && !(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length)) bad(where, t("correct must be the number of the right option, counting from 0"));
    if (errors.length === before) pack.questions.push({ id: q.id, topic: q.topic, code, ask, options: q.options.map(norm), correct: q.correct, why }); });

  const tid = ids("tasks");
  (raw.tasks || []).forEach((k, i) => { const where = tid(k, i); if (!where) return; const before = errors.length;
    const title = str(where, k, "title", LIMITS.title), description = str(where, k, "description", LIMITS.desc);
    if (!isStr(k.topic) || !known.has(k.topic)) bad(where, t("topic {id} does not exist", { id: String(k.topic) }));
    const list = (key, max) => { const v = k[key]; if (v === undefined) return []; if (!Array.isArray(v) || v.length > max || !v.every((x) => isStr(x) && x.length <= LIMITS.line)) { bad(where, t("{key} must be a list of at most {n} short texts", { key, n: max })); return []; } return v.map(norm); };
    const expectedOutput = list("expectedOutput", LIMITS.lines), hints = list("hints", LIMITS.taskHints);
    if (errors.length === before) pack.tasks.push({ id: k.id, topic: k.topic, title, description, expectedOutput, hints }); });

  if (!errors.length && !lists.some((k) => pack[k].length)) errors.push(t("The pack is empty: it has no topics, hints, questions or tasks."));
  return errors.length ? { ok: false, errors } : { ok: true, pack };
}

/** Put a checked pack into the content: the same id is overwritten, a new id is added. Hints have no id: the same
 *  topic and text is the same hint. Returns the new content and what happened; the old content is not touched. */
export function mergePack(content, pack) {
  const next = { topics: [...content.topics], hints: [...content.hints], questions: [...content.questions], tasks: [...content.tasks] }, report = {};
  for (const k of ["topics", "questions", "tasks"]) {
    const r = report[k] = { added: 0, updated: 0 };
    for (const item of pack[k]) { const i = next[k].findIndex((x) => x.id === item.id); if (i < 0) { next[k].push(item); r.added++; } else { if (JSON.stringify(next[k][i]) !== JSON.stringify(item)) r.updated++; next[k][i] = item; } }
  }
  const r = report.hints = { added: 0, updated: 0 };
  for (const h of pack.hints) if (!next.hints.some((x) => x.topic === h.topic && x.text === h.text)) { next.hints.push(h); r.added++; }
  return { content: next, report };
}

// ---------------------------------------------------------------- what the user may paste into another chat
/** "25 November" in the interface language (the month names come from the browser's own locale data). */
export const dateLabel = (key, loc = "en-US") => new Date(dayNum(key) * 86400000).toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: "UTC" });
export const letter = (i) => String.fromCharCode(65 + i);
/** The text of a finished test, one line per answered question. `rows`: { topic, ok, picked, right } with picked and
 *  right as { i, text } (the position in the order shown, and the option's text). */
export function quizText({ title, day, rows, total }, t = plain, loc = "en-US") {
  const good = rows.filter((r) => r.ok).length;
  const head = `${title} ${dateLabel(day, loc)}: ${good} / ${total} (${t("{n} {n|question|questions} answered", { n: rows.length })})`;
  const lines = rows.map((r, i) => `${i + 1}) ${r.topic}: ` + (r.ok ? `${t("correct")} (${letter(r.right.i)})` : `${t("WRONG")}, ${t("I chose")} ${letter(r.picked.i)} = ${r.picked.text} / ${t("the answer is")} ${letter(r.right.i)} = ${r.right.text}`));
  return [head, ...lines].join("\n");
}

/** The schema, as text the user can paste into the chat that writes the next pack. */
export const SCHEMA_TEXT = `Write a JSON content pack for a JavaScript study tool. Output only the JSON.
{
  "version": 1,
  "topics":    [ { "id": "closure", "title": "Closure", "status": "yeni" } ],
  "hints":     [ { "topic": "closure", "text": "one short memorable sentence" } ],
  "questions": [ { "id": "q-closure-2", "topic": "closure", "code": "console.log(1);", "ask": "What does the console print?",
                   "options": ["A", "B", "C", "D"], "correct": 2, "why": "one or two sentences" } ],
  "tasks":     [ { "id": "y4", "topic": "closure", "title": "Y4: a counter", "description": "what to write",
                   "expectedOutput": ["1", "[1,2]"], "hints": ["first hint", "second hint"] } ]
}
Rules: every id is unique and uses only letters, digits, - _ . ; status is one of oturdu, orta, zayif, yeni (a new topic is "yeni");
a question has 2 to 6 different options and "correct" is the 0-based index of the right one; a hint's topic is a topic id or "genel";
expectedOutput is what console.log prints, one item per line (arrays and objects are compared by structure, spaces do not matter).
Any list may be left out. The same id as before overwrites that item.`;
