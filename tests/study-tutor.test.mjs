// The tutor of JS Study (server/study-tutor.js): building the prompts and reading what the model answered.
import test from "node:test";
import assert from "node:assert/strict";
import { tutorPrompt, pickJson, cleanGrade, cleanQuestions } from "../server/study-tutor.js";

const content = { topics: [{ id: "closure", title: "Closure", status: "yeni", lesson: { summary: "S", points: ["P1"], talk: [{ ask: "Nedir?", answer: "Cevap" }] } }],
  questions: [{ id: "q1", topic: "closure", code: "console.log(1);", ask: "?", options: ["1", "2"], correct: 0, why: "W" }],
  tasks: [{ id: "y1", topic: "closure", title: "Y1", description: "D", expectedOutput: ["1"], hints: [] }], hints: [] };

test("a prompt is built only when what it is about exists", () => {
  assert.match(tutorPrompt("why", content, { questionId: "q1", picked: "2" }, "tr"), /The learner chose: 2[\s\S]*Turkish|Turkish[\s\S]*The learner chose: 2/);
  assert.equal(tutorPrompt("why", content, { questionId: "nope" }), null);
  assert.equal(tutorPrompt("talk", content, { topic: "closure", n: 0, mine: "  " }), null); // nothing to grade
  assert.match(tutorPrompt("talk", content, { topic: "closure", n: 0, mine: "benim" }), /"score"/);
  assert.match(tutorPrompt("code", content, { taskId: "y1", code: "x", output: "2", matched: false }), /Do NOT give the corrected code/);
  assert.match(tutorPrompt("more", content, { topic: "closure", count: 99 }), /Write 6 NEW/); // the count is capped
  assert.equal(tutorPrompt("other", content, {}), null);
});

test("an answer is read even when the model wraps it; a broken one is refused", () => {
  assert.deepEqual(pickJson('Here:\n```json\n{"score": 70}\n```'), { score: 70 });
  assert.equal(pickJson("no json"), null);
  assert.deepEqual(cleanGrade({ score: 140.4, good: ["a", 5, ""], missing: "x", better: " b " }), { score: 100, good: ["a"], missing: [], better: "b" });
  assert.equal(cleanGrade({ good: [] }), null);
});

test("written questions keep only the well-formed ones and get ids of their own", () => {
  const ok = { code: "console.log(1)", ask: "?", options: ["1", "2", "3", "4"], correct: 0, why: "w" };
  const out = cleanQuestions({ questions: [ok, { ...ok, options: ["1", "1"] }, { ...ok, correct: 9 }, { ...ok, code: "" }] }, "closure", "s");
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { id: "g-closure-s-1", topic: "closure", ...ok });
  assert.deepEqual(cleanQuestions(null, "x"), []);
});
