// The rules of the JS Study module (public/study-core.js): plain functions, no page and no clock.
import test from "node:test";
import assert from "node:assert/strict";
import { topicState, streak, pickWarmup, compareOutput, validatePack, mergePack, shuffleOptions, seeded, quizText, addDays, dayKey, allStates, nextSteps, emptyProgress } from "../public/study-core.js";

const T = (status = "yeni") => ({ id: "x", title: "X", status });
let n = 0;
const ans = (day, ok, q = "q1", topic = "x") => ({ id: "a" + ++n, questionId: q, topic, gun: day, tarih: day + "T10:00:" + String(n % 60).padStart(2, "0"), dogruMu: ok, secilen: "s" });
const D = (k) => addDays("2026-11-01", k); // a day by its number

test("three correct answers on three different days settle a topic; the same day does not count twice", () => {
  assert.equal(topicState(T(), [ans(D(0), true), ans(D(0), true), ans(D(0), true)], D(0)).status, "orta");
  assert.equal(topicState(T(), [ans(D(0), true), ans(D(1), true), ans(D(2), true)], D(2)).status, "oturdu");
  assert.equal(topicState(T(), [ans(D(0), true), ans(D(1), true), ans(D(2), false), ans(D(3), true)], D(3)).status, "orta"); // a wrong answer in between starts the count again
});

test("a settled topic is due for a repeat after 7 quiet days; a wrong answer then makes it weak", () => {
  const settled = [ans(D(0), true), ans(D(1), true), ans(D(2), true)];
  assert.equal(topicState(T(), settled, D(8)).status, "oturdu");
  assert.equal(topicState(T(), settled, D(9)).status, "tekrar");
  assert.equal(topicState(T(), [...settled, ans(D(9), false)], D(9)).status, "zayif");
  assert.equal(topicState(T(), [...settled, ans(D(9), true)], D(9)).status, "oturdu");
});

test("two wrong answers among the latest five make a topic weak; two correct in a row after a fall lift it", () => {
  assert.equal(topicState(T(), [ans(D(0), true), ans(D(0), false), ans(D(0), true), ans(D(0), false), ans(D(0), true)], D(0)).status, "zayif");
  assert.equal(topicState(T(), [ans(D(0), false), ans(D(0), true), ans(D(0), true), ans(D(0), true), ans(D(0), true), ans(D(0), true)], D(0)).status, "orta"); // the wrong one left the window
  assert.equal(topicState(T("oturdu"), [ans(D(0), false)], D(0)).status, "zayif");
  assert.equal(topicState(T("oturdu"), [ans(D(0), false), ans(D(1), true)], D(1)).status, "zayif");
  assert.equal(topicState(T("oturdu"), [ans(D(0), false), ans(D(1), true), ans(D(2), true)], D(2)).status, "orta");
});

test("with no answers the pack's own status stands; the first answer replaces it", () => {
  for (const s of ["oturdu", "orta", "zayif", "yeni"]) assert.equal(topicState(T(s), [], D(0)).status, s);
  assert.equal(topicState(T("oturdu"), [ans(D(0), true)], D(0)).status, "oturdu"); // a settled topic stays settled until a wrong answer
  assert.equal(topicState(T("zayif"), [ans(D(0), true)], D(0)).status, "zayif");
  assert.equal(topicState(T("yeni"), [ans(D(0), true)], D(0)).status, "orta");
});

test("the streak counts days with a finished warm-up; today may still be empty; a broken streak is just shown", () => {
  const s = (...days) => days.map((d) => ({ tur: "isinma", gun: D(d) }));
  assert.deepEqual(streak(s(0, 1, 2), D(2)), { count: 3, doneToday: true, best: 3 });
  assert.equal(streak(s(0, 1, 2), D(3)).count, 3); // yesterday was the last day: still alive
  assert.equal(streak(s(0, 1, 2), D(4)).count, 0); // broken
  assert.equal(streak(s(0, 1, 2), D(4)).best, 3);
  assert.equal(streak([{ tur: "konu", gun: D(0) }], D(0)).count, 0); // only a warm-up counts
});

const content = {
  topics: [{ id: "a", title: "A", status: "yeni" }, { id: "b", title: "B", status: "yeni" }, { id: "c", title: "C", status: "zayif" }],
  hints: [],
  questions: ["a", "b", "c"].flatMap((tp) => [1, 2, 3].map((i) => ({ id: `q-${tp}${i}`, topic: tp, code: "1", ask: "?", options: ["1", "2", "3", "4"], correct: 0, why: "." }))),
  tasks: [],
};
const log = (day, q, ok) => ({ ...ans(day, ok, q, q[2]) });

test("a question got wrong comes first in the next day's warm-up, the latest day first", () => {
  const today = D(5), rng = seeded(7);
  const answers = [log(D(3), "q-a1", false), log(D(4), "q-b2", false), log(D(4), "q-b3", true)];
  assert.deepEqual(pickWarmup(content, answers, today, rng).slice(0, 2).map((q) => q.id), ["q-b2", "q-a1"]);
  assert.equal(pickWarmup(content, answers, today, rng).length, 5);
  // wrong today: not again today, but first tomorrow (the clock moved a day forward)
  const wrongToday = [log(today, "q-c3", false)];
  assert.ok(!pickWarmup(content, wrongToday, today, seeded(1), 8).slice(0, 7).some((q) => q.id === "q-c3"));
  assert.equal(pickWarmup(content, wrongToday, addDays(today, 1), seeded(1))[0].id, "q-c3");
  // answered right afterwards: no longer waiting, so it is not forced to the front any more
  const fixed = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => pickWarmup(content, [log(D(3), "q-a1", false), log(D(4), "q-a1", true)], today, seeded(k), 1)[0].id);
  assert.ok(new Set(fixed).size > 1);
});

test("after the wrong ones come the topics due for a repeat, then the weak ones, then anything", () => {
  const today = D(20), rng = seeded(3);
  const settled = [log(D(0), "q-a1", true), log(D(1), "q-a2", true), log(D(2), "q-a3", true)]; // topic a: settled, quiet for a long time
  const first = pickWarmup(content, settled, today, rng, 3).map((q) => q.topic);
  assert.deepEqual(first, ["a", "a", "a"]); // a is due for a repeat; c is weak, but a comes first
  const more = pickWarmup(content, settled, today, rng, 5).map((q) => q.topic);
  assert.deepEqual(more.slice(0, 3), ["a", "a", "a"]);
  assert.equal(more[3], "c"); // the weak topic (the pack called it weak) next
  assert.equal(new Set(pickWarmup(content, [], today, rng, 9).map((q) => q.id)).size, 9); // never the same question twice
  assert.equal(pickWarmup({ ...content, questions: content.questions.slice(0, 2) }, [], today, rng).length, 2); // fewer questions than five: all of them
});

test("comparing output ignores spaces inside arrays and objects, not the order of lines", () => {
  assert.equal(compareOutput(["[ 10, 30 ]", "40", "1"], ["[10,30]", "40", "1"]).match, true);
  assert.equal(compareOutput(["{ a: 1, b: [ 2, 3 ] }"], ['{"a":1,"b":[2,3]}']).match, true);
  assert.equal(compareOutput(["['x', 'y']"], ['["x","y"]']).match, true);
  assert.equal(compareOutput(["[ 'a b' ]"], ['["a b"]']).match, true); // spaces inside a string are kept
  assert.equal(compareOutput(["[1, 2]"], ["[1,3]"]).match, false);
  assert.deepEqual(compareOutput(["a", "b"], ["b", "a"]), { match: false, diff: 0 });
  assert.deepEqual(compareOutput(["a"], ["a", "b"]), { match: false, diff: 1 });
  assert.equal(compareOutput(["hata:   stok bitti", ""], ["hata: stok bitti"]).match, true);
  assert.equal(compareOutput("a\nb\n", ["a", "b"]).match, true);
});

const pack = {
  version: 1,
  topics: [{ id: "t1", title: "One", status: "zayıf" }],
  hints: [{ topic: "t1", text: "h" }, { topic: "genel", text: "g" }],
  questions: [{ id: "q1", topic: "t1", code: "console.log(1)", ask: "?", options: ["1", "2", "3", "4"], correct: 0, why: "w" }],
  tasks: [{ id: "k1", topic: "t1", title: "K", description: "d", expectedOutput: ["1"], hints: ["x"] }],
};
const empty = { topics: [], hints: [], questions: [], tasks: [] };

test("a good pack is accepted and only its known fields are kept", () => {
  const r = validatePack({ ...pack, extra: 1, topics: [{ ...pack.topics[0], x: 1 }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.pack.topics, [{ id: "t1", title: "One", status: "zayif" }]);
  assert.equal(r.pack.questions.length + r.pack.tasks.length + r.pack.hints.length, 4);
});

test("a broken pack is refused with a clear message and changes nothing", () => {
  const cases = [
    [null, /JSON object/], [{}, /empty/], [{ topics: {} }, /topics: must be a list/],
    [{ topics: [{ id: "a b", title: "x", status: "yeni" }] }, /id must be/],
    [{ topics: [{ id: "a", title: "x", status: "meh" }] }, /status must be/],
    [{ topics: [{ id: "a", title: "x", status: "yeni" }, { id: "a", title: "y", status: "yeni" }] }, /twice/],
    [{ ...pack, questions: [{ ...pack.questions[0], correct: 4 }] }, /correct must be/],
    [{ ...pack, questions: [{ ...pack.questions[0], options: ["1", "1", "2", "3"] }] }, /differ/],
    [{ ...pack, questions: [{ ...pack.questions[0], options: ["1"] }] }, /2 to 6/],
    [{ ...pack, questions: [{ ...pack.questions[0], topic: "nope" }] }, /topic nope does not exist/],
    [{ ...pack, hints: [{ topic: "nope", text: "h" }] }, /topic nope does not exist/],
    [{ ...pack, tasks: [{ ...pack.tasks[0], expectedOutput: "1" }] }, /expectedOutput must be a list/],
    [{ version: 2, topics: pack.topics }, /version: must be 1/],
  ];
  for (const [raw, re] of cases) { const before = JSON.stringify(empty); const r = validatePack(raw, empty); assert.equal(r.ok, false, JSON.stringify(raw)); assert.match(r.errors.join("\n"), re); assert.equal(JSON.stringify(empty), before); }
  assert.equal(validatePack({ questions: [pack.questions[0]] }, { ...empty, topics: [{ id: "t1", title: "One", status: "yeni" }] }).ok, true); // the topic may already be there
});

test("merging overwrites the same id, adds a new one, and leaves the old content untouched", () => {
  const a = mergePack(empty, validatePack(pack).pack);
  assert.deepEqual(a.report.questions, { added: 1, updated: 0 });
  const changed = validatePack({ questions: [{ ...pack.questions[0], why: "new" }, { ...pack.questions[0], id: "q2" }] }, a.content).pack;
  const b = mergePack(a.content, changed);
  assert.deepEqual(b.report.questions, { added: 1, updated: 1 });
  assert.equal(b.content.questions.find((q) => q.id === "q1").why, "new");
  assert.equal(a.content.questions.length, 1); // the old object is as it was
  assert.deepEqual(mergePack(b.content, validatePack(pack).pack).report.hints, { added: 0, updated: 0 }); // the same hint twice is one hint
});

test("shuffling the options keeps the right answer pointing at the right text", () => {
  const q = { options: ["a", "b", "c", "d"], correct: 2 }; let moved = false;
  for (let s = 1; s < 40; s++) { const r = shuffleOptions(q, seeded(s)); assert.equal(r.options[r.correct], "c"); assert.deepEqual([...r.options].sort(), ["a", "b", "c", "d"]); if (r.correct !== 2) moved = true; }
  assert.ok(moved);
});

test("the text of a result has the shape the user pastes into another chat", () => {
  const rows = [{ topic: "then", ok: true, picked: { i: 3, text: "x" }, right: { i: 3, text: "x" } }, { topic: "prototype", ok: false, picked: { i: 0, text: "10 true true" }, right: { i: 2, text: "10 false true" } }];
  const tr = (s, p) => ({ correct: "doğru", WRONG: "YANLIŞ", "I chose": "seçtiğim", "the answer is": "doğrusu" }[s] ?? (p ? s.replace("{n} {n|question|questions} answered", p.n + " soru cevaplandı") : s));
  assert.equal(quizText({ title: "JS Isınma", day: "2026-11-25", rows, total: 5 }, tr, "tr-TR"), "JS Isınma 25 Kasım: 1 / 5 (2 soru cevaplandı)\n1) then: doğru (D)\n2) prototype: YANLIŞ, seçtiğim A = 10 true true / doğrusu C = 10 false true");
});

test("days: a local day key, and the states of all topics at once", () => {
  assert.equal(dayKey(new Date(2026, 10, 25, 23, 59)), "2026-11-25");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(allStates(content, [log(D(0), "q-a1", false)], D(0)).a.status, "orta");
});

test("a topic page (group, lesson) is kept when valid; a broken lesson is refused as a whole", () => {
  const lesson = { summary: "kısa", points: ["bir", "iki"], example: "console.log(1);", mistake: "hata", say: "söyle", talk: [{ ask: "Soru?", answer: "Cevap." }] };
  const ok = validatePack({ topics: [{ id: "a", title: "A", status: "yeni", group: "1. Temel", lesson }] });
  assert.ok(ok.ok);
  assert.deepEqual(ok.pack.topics[0].lesson, lesson);
  assert.equal(ok.pack.topics[0].group, "1. Temel");
  const old = validatePack({ topics: [{ id: "a", title: "A", status: "yeni" }] }); // a topic without a page is still valid
  assert.ok(old.ok && !("lesson" in old.pack.topics[0]));
  for (const bad of [{ ...lesson, points: "x" }, { ...lesson, talk: [{ ask: "q" }] }, { ...lesson, summary: "" }, "metin"]) {
    const r = validatePack({ topics: [{ id: "a", title: "A", status: "yeni", lesson: bad }] });
    assert.equal(r.ok, false);
  }
});

test("merging a pack with a page keeps the topic's place and replaces its page", () => {
  const base = { topics: [{ id: "a", title: "A", status: "orta" }, { id: "b", title: "B", status: "yeni" }], hints: [], questions: [], tasks: [] };
  const v = validatePack({ topics: [{ id: "b", title: "B", status: "yeni", lesson: { summary: "özet" } }] }, base);
  const m = mergePack(base, v.pack);
  assert.deepEqual(m.content.topics.map((x) => x.id), ["a", "b"]);
  assert.equal(m.content.topics[1].lesson.summary, "özet");
  assert.equal(m.report.topics.updated, 1);
});

test("the next step: warm-up when something is due, then the lesson left half-way, then the first unread lesson", () => {
  const content = { topics: [{ id: "a", title: "A", status: "yeni", lesson: { summary: "x", steps: [{ text: "1" }, { text: "2" }] } }, { id: "b", title: "B", status: "yeni", lesson: { summary: "y" } }, { id: "c", title: "C", status: "yeni" }],
    questions: [{ id: "q1", topic: "a", code: "1", ask: "?", options: ["1", "2"], correct: 0, why: "w" }], hints: [], tasks: [] };
  const kinds = (p) => nextSteps(content, { ...emptyProgress(), ...p }, allStates(content, p.answers || [], "2026-01-10"), "2026-01-10").map((s) => s.kind + (s.id ? ":" + s.id : "") + (s.resume ? ":resume" : ""));
  assert.deepEqual(kinds({}), ["lesson:a", "warmup-plain"]); // nothing yet: start the first lesson
  assert.deepEqual(kinds({ lessons: { a: { step: 1, done: false, at: "2026-01-09T10:00:00Z" } } }), ["lesson:a:resume", "lesson:b", "warmup-plain"]);
  assert.deepEqual(kinds({ lessons: { a: { step: 2, done: true }, b: { step: 0, done: true } } }), ["warmup-plain"]); // c has no lesson to read
  const wrong = [{ id: "x", questionId: "q1", topic: "a", tarih: "2026-01-09T10:00:00Z", gun: "2026-01-09", dogruMu: false, secilen: "2" }];
  assert.equal(kinds({ answers: wrong })[0], "warmup"); // yesterday's wrong answer comes before any lesson
  const done = kinds({ answers: wrong, sessions: [{ id: "s", tur: "isinma", tarih: "2026-01-10T08:00:00Z", gun: "2026-01-10", dogru: 1, toplam: 1 }] });
  assert.ok(!done.includes("warmup")); // today's warm-up is done: it is not suggested again
});
