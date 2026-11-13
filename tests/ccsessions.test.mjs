import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CFG = fs.mkdtempSync(path.join(os.tmpdir(), "ecelon-cc-")); process.env.CLAUDE_CONFIG_DIR = CFG;
const { listSessions, readSession, slugOf } = await import("../server/ccsessions.js");
test.after(() => fs.rmSync(CFG, { recursive: true, force: true }));

const CWD = "C:\\Users\\a.b\\Desktop\\my proj";
const dir = path.join(CFG, "projects", slugOf(CWD)); fs.mkdirSync(dir, { recursive: true });
const L = (o) => JSON.stringify(o);
fs.writeFileSync(path.join(dir, "aaaa-1111.jsonl"), [
  L({ type: "mode", mode: "normal" }),
  L({ type: "user", timestamp: "2026-11-10T08:00:00Z", message: { role: "user", content: "<command-name>/clear</command-name>" } }),
  L({ type: "user", timestamp: "2026-11-10T08:00:01Z", message: { role: "user", content: "Add paging to the order list" } }),
  L({ type: "assistant", timestamp: "2026-11-10T08:00:05Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "Looking at the list first." }, { type: "tool_use", id: "tu1", name: "Bash", input: { command: "npm test" } }] } }),
  L({ type: "user", timestamp: "2026-11-10T08:00:09Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "12 passed" }] }] } }),
  L({ type: "assistant", isSidechain: true, timestamp: "2026-11-10T08:00:10Z", message: { role: "assistant", content: [{ type: "text", text: "subagent chatter" }] } }),
  "{ broken line",
  L({ type: "assistant", timestamp: "2026-11-10T08:00:12Z", message: { role: "assistant", content: [{ type: "text", text: "Done: paging added." }] } }),
].join("\n") + "\n");
fs.writeFileSync(path.join(dir, "bbbb-2222.jsonl"), L({ type: "user", timestamp: "2026-11-09T08:00:00Z", message: { role: "user", content: "older one" } }) + "\n");
fs.writeFileSync(path.join(dir, "cccc-3333.jsonl"), L({ type: "mode", mode: "normal" }) + "\n"); // nobody typed anything
fs.utimesSync(path.join(dir, "bbbb-2222.jsonl"), new Date("2026-11-09T08:00:00Z"), new Date("2026-11-09T08:00:00Z"));

test("the folder name follows Claude Code's rule", () => assert.equal(slugOf(CWD), "C--Users-a-b-Desktop-my-proj"));

test("sessions are listed newest first, titled by the first thing a person typed; empty ones are left out", () => {
  const list = listSessions(CWD, { known: new Set(["bbbb-2222"]) });
  assert.deepEqual(list.map((s) => [s.id, s.title, s.known]), [["aaaa-1111", "Add paging to the order list", false], ["bbbb-2222", "older one", true]]);
  assert.deepEqual(listSessions("C:\\nowhere"), []);
});

test("a session becomes the station's events: no wrappers, no thinking, no subagent turns", () => {
  const { events } = readSession(CWD, "aaaa-1111");
  assert.deepEqual(events.map((e) => e.type), ["user", "text", "tool_use", "tool_result", "text"]);
  assert.equal(events[2].input.command, "npm test"); assert.equal(events[3].content, "12 passed"); assert.equal(events[3].toolUseId, "tu1");
});

test("an id cannot point outside the folder", () => {
  assert.equal(readSession(CWD, "../../secret"), null); assert.equal(readSession(CWD, "a/b"), null); assert.equal(readSession(CWD, "nope"), null);
});

test("the name is the one Claude Code gave the session; otherwise what was typed, without editor and paste wrappers", () => {
  const w = (id, lines) => fs.writeFileSync(path.join(dir, id + ".jsonl"), lines.map(L).join("\n") + "\n");
  const u = (text) => ({ type: "user", timestamp: "2026-11-11T08:00:00Z", message: { role: "user", content: text } });
  w("dddd-4444", [u("bana her gün githubtan mail geliyor"), { type: "ai-title", aiTitle: "GitHub bildirim e-postaları" }, { type: "ai-title", aiTitle: "GitHub publish hatası" }]);
  w("eeee-5555", [u("<ide_opened_file>The user opened the file c:\\x\\y.ts in the IDE.</ide_opened_file>projeyi ayağa kaldırır mısın")]);
  w("ffff-6666", [u('<pasted_content id="ef48"> Bu proje Ecelon Station')]);
  w("gggg-7777", [u("ilk mesaj"), { type: "ai-title", aiTitle: "Otomatik ad" }, { type: "custom-title", customTitle: "Benim verdiğim ad" }]);
  const by = Object.fromEntries(listSessions(CWD).map((s) => [s.id, s.title]));
  assert.equal(by["dddd-4444"], "GitHub publish hatası");
  assert.equal(by["eeee-5555"], "projeyi ayağa kaldırır mısın");
  assert.equal(by["ffff-6666"], "Bu proje Ecelon Station");
  assert.equal(by["gggg-7777"], "Benim verdiğim ad");
});
