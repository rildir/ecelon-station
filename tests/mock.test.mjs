// The scripted runner behind demo mode: which scenario a prompt gets, when a permission request is raised,
// and that the sample request really changes the sample project.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tempData, rm } from "./_setup.mjs";

const DATA = tempData("ecelon-mock-");
process.env.MOCK_FAST = "1"; process.env.ECELON_DEMO = "1";
const { runMock } = await import("../server/mockRunner.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mock-"));
const proj = path.join(tmp, "aurora-api");
fs.cpSync(path.resolve("demo/projects/aurora-api"), proj, { recursive: true });
test.after(() => { rm(tmp); rm(DATA); });

// runs one prompt and returns the events; `calls` collects what the agent did with the station's tools
async function play(agent, prompt) {
  const evs = [], calls = [];
  const a = { name: "aurora-api", cwd: proj, model: "sonnet", role: "dev", ...agent,
    _tool: async (name, args) => { calls.push([name, args]); return { message: name === "list_requirements" ? "R-001 a\nR-002 b\nR-003 c\nR-004 d\nR-005 e" : "ok" }; } };
  const result = await runMock(a, prompt, (e) => evs.push(e)).promise;
  return { evs, calls, result, tools: evs.filter((e) => e.type === "tool_use").map((e) => `${e.name} ${e.summary}`.trim()) };
}
const route = () => fs.readFileSync(path.join(proj, "src/routes/inventory.js"), "utf8");

test("the analyst and the tester never raise a permission request, and leave tasks for what they cannot settle", async () => {
  const extract = await play({ role: "analyst" }, "Extract the requirements from the linked documents and save them to the Scope list.");
  assert.deepEqual(extract.result.permissionDenials, []);
  assert.ok(extract.calls.some(([n]) => n === "save_requirements"));

  const compare = await play({ role: "analyst" }, "Compare the requirements with the code and update their status.");
  assert.deepEqual(compare.result.permissionDenials, []);
  const mine = compare.calls.find(([n]) => n === "create_task")[1];
  assert.equal(mine.role, "user"); assert.deepEqual(mine.requirements, ["R-004"]);

  const verify = await play({ role: "tester" }, "Verify the requirements with evidence.");
  assert.deepEqual(verify.result.permissionDenials, []);
  const dev = verify.calls.find(([n]) => n === "create_task")[1];
  assert.equal(dev.role, "dev"); assert.deepEqual(dev.requirements, ["R-003"]);
  assert.ok(verify.tools.includes("mcp__team__verify_requirement R-001 · verified"), verify.tools.join(" | "));
});

test("the sample request writes a working route, then asks before pushing", async () => {
  const before = route();
  const r = await play({ _lead: true }, "Add an endpoint for the low stock warning");
  const after = route();
  assert.notEqual(after, before);
  assert.match(after, /import \{ listCards, belowMinimum \} from "\.\.\/models\/stock\.js";/);
  assert.match(after, /r\.get\("\/low"/);
  assert.ok(!after.includes("// Add an endpoint"), "a real change, not a comment line");
  assert.equal(spawnSync(process.execPath, ["--check", path.join(proj, "src/routes/inventory.js")]).status, 0, "the file still parses");
  const edit = r.evs.find((e) => e.type === "tool_use" && e.name === "Edit");
  assert.ok(before.includes(edit.input.old_string) && after.includes(edit.input.new_string), "the tool row shows what was really written");
  assert.deepEqual(r.result.permissionDenials.map((d) => d.spec), ["Bash(git push)"]);
  assert.match(r.result.text, /inventory\.js/);
  // the model the route builds on really exports what it imports
  const stock = await import(new URL(`file://${path.join(proj, "src/models/stock.js").replace(/\\/g, "/")}`).href);
  assert.equal(typeof stock.belowMinimum, "function");
});

test("after the permission only the refused step is repeated", async () => {
  const before = route();
  for (const text of ["Permission granted, continue where you left off.", "İzin verdim, kaldığın yerden devam et."]) {
    const r = await play({ _lead: true, _allowOnce: ["Bash(git push)"] }, text);
    assert.deepEqual(r.tools, ["Bash git push"]);
    assert.deepEqual(r.result.permissionDenials, []);
    assert.ok(!r.evs.some((e) => e.type === "tool_result" && e.isError));
  }
  assert.equal(route(), before, "the project is not edited a second time");
});

test("an allowed push is not refused, and a board task is closed on the board", async () => {
  const always = await play({ _lead: true, allowedTools: ["Bash(git push)"] }, "Rename the transfer route");
  assert.deepEqual(always.result.permissionDenials, []);
  assert.ok(!always.evs.some((e) => e.type === "tool_result" && e.isError));

  const task = await play({ _lead: true }, "Task T-002 from the task board: Implement the stock count slip\n\nAdd POST /counts.");
  const up = task.calls.find(([n]) => n === "update_task")[1];
  assert.equal(up.id, "T-002"); assert.equal(up.status, "done");
  assert.ok(task.evs.some((e) => e.type === "text" && /"Implement the stock count slip"/.test(e.text)), "the title, without the board prefix");
});
