import fs from "node:fs";
import path from "node:path";
// Mock runner: where Claude Code is not installed (cloud, demo, screenshots)
// it imitates the shape of the real flow. Enabled with MOCK=1.
import { randomUUID } from "node:crypto";
import { t } from "./i18n.js";
import { summarizeToolInput } from "./runner.js";

const wait = (ms) => new Promise((r) => setTimeout(r, process.env.MOCK_FAST === "1" ? 0 : ms)); // MOCK_FAST=1: the tests do not sit through the pauses
// a real source file of the project for the fake edit/evidence steps (falls back to src/player.js)
function pickFile(cwd) {
  try {
    for (const dir of ["src", "."]) {
      const d = path.join(cwd, dir); if (!fs.existsSync(d)) continue;
      const walk = (p, depth) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { if (e.name.startsWith(".") || e.name === "node_modules") continue; const f = path.join(p, e.name); if (e.isFile() && /\.(jsx?|tsx?|mjs|py|gd|go|rs|cs|java)$/.test(e.name)) return f; if (e.isDirectory() && depth < 2) { const r = walk(f, depth + 1); if (r) return r; } } return null; };
      const f = walk(d, 0); if (f) return path.relative(cwd, f).split(path.sep).join("/");
    }
  } catch {}
  return "src/player.js";
}

// A request about the low stock warning in the sample API project gets a real, working change (a route built on the
// model's own belowMinimum), so the change card, the diff and the Git screen show code instead of a comment.
// Only in demo mode and only while the sample file still looks the way it was shipped; anything else gets the generic script.
function recipeFor(agent, prompt) {
  if (process.env.ECELON_DEMO !== "1" && process.env.MOCK_WRITE !== "1") return null;
  if (!/low[- ]stock|stock warning|below .{0,12}minimum|minimum stok|stok uyar|düşük stok/i.test(prompt)) return null;
  const file = "src/routes/inventory.js", f = path.join(agent.cwd, file);
  const from = 'import { listCards } from "../models/stock.js";\n\nconst r = Router();\n';
  const to = 'import { listCards, belowMinimum } from "../models/stock.js";\n\nconst r = Router();\n\n// GET /inventory/low\n// Cards whose total stock is under their minimum, for the low stock warning.\nr.get("/low", (req, res) => {\n  res.json(belowMinimum().map((c) => ({ code: c.code, name: c.name, min: c.min })));\n});\n';
  try {
    const raw = fs.readFileSync(f, "utf8"), eol = raw.includes("\r\n") ? "\r\n" : "\n", src = raw.replace(/\r\n/g, "\n");
    if (!src.includes(from)) return null;
    let pkg = {}; try { pkg = JSON.parse(fs.readFileSync(path.join(agent.cwd, "package.json"), "utf8")); } catch {}
    return { file, from, to, stat: "+7 −1", what: t("`GET /inventory/low` returns the cards under their minimum"), files: "src/models/stock.js\nsrc/routes/inventory.js\nsrc/routes/transfers.js\nsrc/server.js\ntests/inventory.test.js",
      apply: () => fs.writeFileSync(f, src.replace(from, to).replace(/\n/g, eol)),
      testOut: `> ${pkg.name || "aurora-stock"}@${pkg.version || "0.4.2"} test\n> node --test\n\n✔ stock cards can be looked up by code (0.6ms)\n✔ a transfer never takes more than the source has (0.2ms)\n✔ listCards returns copies (0.1ms)\nℹ tests 3\nℹ pass 3\nℹ fail 0` };
  } catch { return null; }
}
// "Task T-003 from the task board: …" (the board's Start button): the id, and the title without that prefix
const BOARD = /(?:Task (T-\d+) from the task board: |Görev panosundan (T-\d+) numaralı görev: )/;
const boardTask = (prompt) => { const m = BOARD.exec(prompt); return m ? m[1] || m[2] : ""; };

const SCRIPTS = {
  // o: { file, from, to, apply, stat, what, files, testOut } from a recipe; canPush: `git push` is already allowed
  default: (agent, prompt, o = {}, file = o.file || pickFile(agent.cwd), task = prompt.split("\n\n")[0].replace(BOARD, "").replace(/\s+/g, " ").trim().slice(0, 80)) => ([
    { kind: "text", text: t('OK, looking at the structure first for "{task}" in the {name} project.', { name: agent.name, task: task.slice(0, 60) }) },
    { kind: "tool", name: "TodoWrite", summary: "", input: { todos: [
      { content: t("Examine the existing structure"), status: "in_progress", activeForm: t("Examining the structure") },
      { content: t("Apply the change"), status: "pending", activeForm: t("Applying the change") },
      { content: t("Run the tests"), status: "pending", activeForm: t("Running the tests") } ] } },
    { kind: "tool", name: "Glob", summary: "**/*.{ts,js,jsx,gd}", out: o.files || `${file}\ntests/`+ file.split("/").pop().replace(/\.(\w+)$/, ".test.$1") },
    { kind: "tool", name: "Read", summary: `${agent.cwd}/README.md`, out: t("# Project") + "\n" + t("Short description…") },
    { kind: "tool", name: "TodoWrite", summary: "", input: { todos: [
      { content: t("Examine the existing structure"), status: "completed" },
      { content: t("Apply the change"), status: "in_progress" },
      { content: t("Run the tests"), status: "pending" } ] } },
    { kind: "text", text: t("Structure understood. Making the change in `{file}`.", { file }) },
    { kind: "tool", name: "Edit", summary: `${agent.cwd}/${file}`, note: task, apply: o.apply, input: { file_path: `${agent.cwd}/${file}`,
      old_string: o.from || "// TODO: implement\nexport function handle(input) {\n  return input;\n}", new_string: o.to || `export function handle(input) {\n  // ${task}\n  return validate(input);\n}` } },
    { kind: "tool", name: "Bash", summary: "npm test", input: { command: "npm test", description: t("Run the tests") }, out: o.testOut || `> test\n> vitest run\n\n ✓ tests/${file.split("/").pop().replace(/\.(\w+)$/, ".test.$1")} (3)\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)` },
    o.canPush ? { kind: "tool", name: "Bash", summary: "git push", input: { command: "git push" }, out: t("Demo: nothing is really pushed.") }
      : { kind: "tool", name: "Bash", summary: "git push", input: { command: "git push" }, error: true, out: t("This command needs permission.") },
    { kind: "tool", name: "TodoWrite", summary: "", input: { todos: [
      { content: t("Examine the existing structure"), status: "completed" }, { content: t("Apply the change"), status: "completed" }, { content: t("Run the tests"), status: "completed" } ] } },
    { kind: "final", text: [t("## Summary"), "", t("The change is in and the tests pass:"), "", "- " + t("`{file}` updated: {task}", { file, task: o.what || task }), "- " + t("3 tests, 3 passed"), "",
      `| ${t("File")} | ${t("Change")} |`, "|---|---|", `| ${file} | ${o.stat || "+3 −2"} |`, "",
      o.canPush ? t("`git push` ran too; in the demo nothing really leaves this computer.") : t("I had no permission for `git push`; you can grant it below if you want.") + (o.apply ? "" : " " + t("Details: [Vitest docs](https://vitest.dev)"))].join("\n") },
  ]),
};

export function runMock(agent, prompt, emit) {
  let killed = false;
  const sessionId = agent.sessionId || randomUUID();
  const canPush = agent.permission === "bypassPermissions" || [...(agent._allowOnce || []), ...(agent.allowedTools || [])].includes("Bash(git push)");
  const steps = SCRIPTS.default(agent, prompt, { ...(recipeFor(agent, prompt.split("\n\n")[0]) || {}), canPush });
  let thought = t("First I should look at the project structure. I will read the README and the main file and decide where the change goes.");
  // team scenarios (demo mode): the lead distributes tasks, the member writes a short report
  const first = prompt.split("\n\n")[0];
  // requirement code by position in the scope list (existing data may still use G-… codes, new items get R-…)
  const codeAt = async (n) => {
    const fallback = `R-${String(n).padStart(3, "0")}`;
    try { const r = await agent._tool("list_requirements", {}); return [...String(r.message || "").matchAll(/^([A-Z]+-\d+)\b/gm)].map((m) => m[1])[n - 1] || fallback; } catch { return fallback; }
  };
  // document section id whose text matches (the demo document and a user's own document segment differently)
  const secByText = async (re, fallback) => {
    try { const r = await agent._tool("document_sections", { filter: "all" }); const m = [...String(r.message || "").matchAll(/^(D\d+-\d+) \[[^\]]*\] \([^)]*\) (.*)$/gm)].find((x) => re.test(x[2])); return m ? m[1] : fallback; } catch { return fallback; }
  };
  // Prompts from the station are generated in the UI language: the triggers match both the English and the Turkish wording
  if (/^(Permission granted, continue|İzin verdim, kaldığın yerden)/.test(prompt)) {
    // "Allow once and continue" / "Always allow": only the refused step is repeated; the work is not done a second time
    thought = t("The permission is there now. Only the step that was refused has to be repeated.");
    steps.splice(0, steps.length,
      { kind: "tool", name: "Bash", summary: "git push", input: { command: "git push" }, out: t("Demo: nothing is really pushed.") },
      { kind: "final", text: t("Thanks. `git push` ran with your permission; in the demo nothing really leaves this computer. Nothing else is waiting.") });
  } else if (agent.role === "analyst" && /gereksinim|requirement/i.test(prompt) && /çıkar|extract/i.test(prompt)) {
    thought = t("The linked document comes first: its sections, then one requirement for every rule or screen, each with the sentence it comes from.");
    steps.splice(0, steps.length,
      { kind: "mcp", name: "document_sections", args: { filter: "all" } },
      { kind: "mcp", name: "save_requirements", args: async () => ({ mode: "merge", items: [
        { title: t("Stock card list must be filterable"), section: t("Stock"), source: t("Stock Analysis v3, 2. Screens"), doc_claim: "done", doc_quote: t("Status column: Completed (v3, p.4)"),
          sections: [await secByText(/stock card|stok kart/i, "D1-004")], acceptance_criteria: [t("Filtering by stock code lists only the matching cards"), t("Partial search by name is case-insensitive")] },
        { title: t("Warehouse transfer slip must go through the approval flow"), section: t("Stock"), source: t("Meeting Notes 21 October"), doc_claim: "partial", doc_quote: t("Approval step added, rejection flow pending"), sections: [await secByText(/transfer slip|transfer fiş/i, "D1-005")], acceptance_criteria: [t("An unapproved slip creates no stock movement"), t("A rejected slip is closed with a reason")] },
        { title: t("Month-end stock count slip must be creatable"), section: t("Stock"), source: t("Stock Analysis v3, 2. Screens"), doc_claim: "done", doc_quote: t("✓ Stock count slip (v3, p.5)"), sections: [await secByText(/count slip|sayım fiş/i, "D1-006")] },
        { title: t("A warning must be given when stock falls below the minimum"), section: t("Stock"), source: t("Stock Analysis v3, 1. Scope"), sections: [await secByText(/below (its|the) minimum|minimum stok/i, "")].filter(Boolean) },
        { title: t("StockCode must be nvarchar(30) and required"), section: t("Data model"), source: t("Stock Analysis v3, table"), sections: [await secByText(/StockCode|StokKodu/i, "")].filter(Boolean) },
      ] }) },
      { kind: "mcp", name: "mark_sections", args: async () => ({ sections: [await secByText(/this document|bu doküman/i, "D1-001")], reason: t("Introduction and definition text") }) },
      { kind: "final", text: t("I extracted 5 requirements from the linked documents and saved them to the Scope list.") });
  } else if (agent.role === "analyst" && /kapsamasını tamamla|complete\b.*\bcoverage/i.test(prompt)) {
    steps.splice(0, steps.length,
      { kind: "mcp", name: "document_sections", args: { filter: "open" } },
      { kind: "mcp", name: "save_requirements", args: async () => {
        const r = await agent._tool("document_sections", { filter: "open" });
        const ids = [...String(r.message || "").matchAll(/^(D\d+-\d+) /gm)].map((m) => m[1]);
        return { mode: "merge", items: ids.slice(0, 2).map((id, i) => ({ title: t("Requirement {n} added from the document", { n: i + 1 }), section: t("Stock"), sections: [id], acceptance_criteria: [t("The scenario works end to end")] })) };
      } },
      { kind: "mcp", name: "mark_sections", args: async () => {
        const r = await agent._tool("document_sections", { filter: "open" });
        const ids = [...String(r.message || "").matchAll(/^(D\d+-\d+) /gm)].map((m) => m[1]);
        return { sections: ids.length ? ids : ["D1-999"], reason: t("Explanatory text, no requirement") };
      } },
      { kind: "final", text: t("I completed the open sections: 2 new items, the rest contain no requirement.") });
  } else if (agent.role === "reviewer" && /kinci göz|second[- ]review|independent/i.test(prompt)) {
    steps.splice(0, steps.length,
      { kind: "mcp", name: "document_sections", args: { filter: "all" } },
      { kind: "mcp", name: "report_missing_requirements", args: { items: [{ title: t("The same warehouse must not be selectable on a transfer slip"), section: t("Stock"), sections: ["D1-004"], why: t("The rule in the table is not in the list") }] } },
      { kind: "final", text: t("Second review: I reported 1 possibly missing requirement.") });
  } else if (agent.role === "analyst" && /gereksinim|requirement/i.test(prompt) && /karşılaştır|compare/i.test(prompt)) {
    thought = t("For every requirement I look for the code that implements it. Where I find none I say so instead of guessing.");
    steps.splice(0, steps.length,
      { kind: "tool", name: "Grep", summary: "transfer" },
      { kind: "mcp", name: "set_requirement_status", args: async () => ({ code: await codeAt(1), status: "done", evidence: "src/stock/list.ts:42" }) },
      { kind: "mcp", name: "set_requirement_status", args: async () => ({ code: await codeAt(2), status: "doing", evidence: "src/stock/transfer.ts:10", note: t("Approval step exists, no rejection flow") }) },
      { kind: "mcp", name: "set_requirement_status", args: async () => ({ code: await codeAt(4), status: "unclear", note: t("The document does not say who receives the warning") }) },
      // what only the person can decide goes to the task board instead of being asked in chat
      { kind: "mcp", name: "create_task", args: async () => ({ role: "user", title: t("Decide who receives the low stock warning"), requirements: [await codeAt(4)],
        detail: t("The document asks for a warning when stock falls below the minimum but does not say who gets it: the warehouse keeper, purchasing, or both. Write the decision here; the requirement stays unclear until then.") }) },
      { kind: "mcp", name: "set_requirement_status", args: async () => ({ code: await codeAt(5), status: "out_of_scope", note: t("Not in this release; the document says 'later'") }) },
      { kind: "final", text: t("I compared the requirements with the code: 1 done, 1 in progress, 1 unclear, 1 proposed as out of scope; the others do not exist yet.") });
  } else if (agent.role === "tester" && /doğrula|verify/i.test(prompt)) {
    thought = t("I did not write this code. I run the scenarios and call an item verified only when a test or a line proves it.");
    steps.splice(0, steps.length,
      { kind: "mcp", name: "list_requirements", args: { only_mismatches: true } },
      { kind: "tool", name: "Bash", summary: "npm test -- stock", out: t("✓ stock list filter test passed") },
      // in demo mode the evidence must point to a real file (the station rejects evidence that does not exist)
      { kind: "mcp", name: "verify_requirement", args: async () => { let file = pickFile(agent.cwd); if (!fs.existsSync(path.join(agent.cwd, file))) { try { fs.mkdirSync(path.join(agent.cwd, "src"), { recursive: true }); fs.writeFileSync(path.join(agent.cwd, "src", "player.js"), "// demo\n"); file = "src/player.js"; } catch {} }
        return { code: await codeAt(1), result: "verified", how: t("I tested the filter scenario: the code and name filters returned the right results (npm test -- stock)."), evidence: `${file}:1`, criteria: [{ no: 1, result: "pass" }, { no: 2, result: "pass" }] }; } },
      { kind: "mcp", name: "verify_requirement", args: async () => ({ code: await codeAt(3), result: "failed", how: t("The stock count slip screen and service could not be found; the document says 'done' but there is no counterpart in the code.") }) },
      // the missing piece is the developer's work: it becomes a task on the board
      { kind: "mcp", name: "create_task", args: async () => ({ role: "dev", priority: "high", title: t("Implement the stock count slip"), requirements: [await codeAt(3)],
        detail: t("The document marks the month-end stock count slip as done, but the project has no route or model for it (README: 'not implemented yet'). Add POST /counts with its model and a test; the tester verifies again afterwards.") }) },
      { kind: "final", text: async () => [t("## Verification"), "", "- " + t("{code} verified (test + code)", { code: await codeAt(1) }), "- " + t("**{code} failed:** the document says 'done' but the stock count slip is not in the code.", { code: await codeAt(3) })].join("\n") });
  } else if (agent._auto === "team" || /^(Ekipten sonuçlar geldi|Results from the team)/.test(prompt)) {
    thought = t("The results are in. I check whether anything still needs fixing before I report back.");
    steps.splice(0, steps.length, { kind: "final", text: t("I looked at the results from the team: the tester reports that the scenarios pass, no further fix is needed. Work done.") });
  } else if (agent._task || /^(Ekip lideri|The team lead)/.test(prompt)) {
    thought = t("A task from the lead. I run the checks it asks for and report what I see.");
    steps.splice(0, steps.length, { kind: "tool", name: "Bash", summary: "npm test", out: t("✓ 12 tests passed") }, { kind: "final", text: [t("## Test report"), "", "- " + t("Result: **passed** (12/12)"), "- " + t("Ran: `npm test`"), "- " + t("No errors found.")].join("\n") });
  } else if (agent._lead && /test|dene|doğrula|verify/i.test(first)) {
    { const i = steps.findIndex((x) => x.summary === "git push"); if (i >= 0) steps.splice(i, 1); } // nothing is pushed before the tester has looked at it
    steps.splice(steps.length - 1, 1,
      { kind: "text", text: t("I made the change; handing it to the tester for verification.") },
      { kind: "delegate", role: "tester", task: t("I changed {file} ({task}). Test this change and the scenarios around it, report the errors.", { file: pickFile(agent.cwd), task: first.replace(/\s+/g, " ").trim().slice(0, 80) }) },
      { kind: "final", text: t("Handed to the tester; I will summarize the result for you when it arrives.") });
  } else if (agent._lead && /analiz|incele|doküman|analy[sz]|examine|document/i.test(first)) {
    steps.splice(0, steps.length,
      { kind: "delegate", role: "analyst", task: t("Compare the stock requirements in the analysis document with the current code; list the gaps.") },
      { kind: "final", text: t("Handed to the analyst; we will look at the result together when it arrives.") });
  }
  const att = [...prompt.matchAll(/(?:Ekli görsel|Attached image): (.+)/g)].map((m) => m[1].trim());
  if (att.length) {
    steps.splice(0, steps.length,
      { kind: "text", text: t("Looking at the image you attached.") },
      ...att.map((p) => ({ kind: "tool", name: "Read", summary: p })),
      { kind: "final", text: t("I examined the image. The interface has a header, a menu on the left and cards on the right.") + "\n\n" + t("The same image for comparison: {path}", { path: att[0] }) });
  }

  // a task started from the board is closed on the board when the work is done (the real agents are told to do the same)
  const tid = boardTask(prompt);
  if (tid && agent._tool) steps.splice(steps.length - 1, 0, { kind: "mcp", name: "update_task", args: { id: tid, status: "done", note: t("Done; the result is in the conversation.") } });

  const promise = (async () => {
    const t0 = Date.now();
    emit({ type: "status", status: "thinking" });
    await wait(400);
    emit({ type: "init", sessionId, model: `${agent.model} (mock)`, tools: 12 });

    {
      const th = thought;
      emit({ type: "status", status: "thinking" });
      for (const w of th.split(/(\s+)/)) { if (killed) break; emit({ type: "thinking_delta", text: w }); await wait(40); }
      emit({ type: "thinking", text: th });
    }
    for (const step of steps) {
      if (killed) break;
      if (step.kind === "text" || step.kind === "final") {
        if (typeof step.text === "function") step.text = await step.text();
        emit({ type: "status", status: "thinking" });
        await wait(500);
        for (const word of step.text.split(/(\s+)/)) {
          if (killed) break;
          emit({ type: "text_delta", text: word });
          await wait(18);
        }
        emit({ type: "text", text: step.text });
      } else if (step.kind === "mcp") {
        const toolUseId = randomUUID().slice(0, 8);
        const args = typeof step.args === "function" ? await step.args() : step.args; // first, so the row can say what it is about
        emit({ type: "tool_use", name: "mcp__team__" + step.name, summary: summarizeToolInput("mcp__team__" + step.name, args), toolUseId, input: null });
        emit({ type: "status", status: "tool", tool: step.name });
        await wait(600);
        const r = agent._tool ? await agent._tool(step.name, args) : { error: t("no tool") };
        emit({ type: "tool_result", toolUseId, isError: !!r.error, content: r.error || r.message });
      } else if (step.kind === "delegate") {
        const toolUseId = randomUUID().slice(0, 8);
        emit({ type: "tool_use", name: "mcp__team__assign_task", summary: `${step.role}: ${step.task}`, toolUseId, input: null });
        emit({ type: "status", status: "tool", tool: "assign_task" });
        const r = agent._delegate ? await agent._delegate(step.role, step.task) : { error: t("no team") };
        emit({ type: "tool_result", toolUseId, isError: !!r.error, content: r.error || r.message });
      } else if (step.kind === "tool") {
        // for development testing: with MOCK_WRITE=1 the edit steps really write into the project folder
        // (demo mode does it too, so the change card with its diff and Undo shows up; only inside the project folder)
        if ((process.env.MOCK_WRITE === "1" || process.env.ECELON_DEMO === "1") && ["Edit", "Write"].includes(step.name) && step.summary) {
          try {
            const f = path.isAbsolute(step.summary) ? step.summary : path.join(agent.cwd, step.summary);
            if (path.relative(agent.cwd, f).startsWith("..")) throw new Error("outside the project");
            if (step.apply) step.apply(); else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, `// ${step.note || "demo change"}\n`); }
          } catch {}
        }
        const toolUseId = randomUUID().slice(0, 8);
        emit({ type: "tool_use", name: step.name, summary: step.summary, toolUseId, input: step.input || null });
        emit({ type: "status", status: "tool", tool: step.name });
        await wait(900);
        emit({ type: "tool_result", toolUseId, isError: !!step.error, content: step.out || "" });
      }
    }

    emit({ type: "rate_limit", info: { kind: "five_hour", status: "allowed", utilization: 0.23, resetsAt: Date.now() + 2.5 * 3600e3 } });
    emit({ type: "rate_limit", info: { kind: "seven_day", status: "allowed", utilization: 0.41, resetsAt: Date.now() + 3 * 86400e3 } });
    const result = {
      type: "result",
      isError: killed,
      subtype: killed ? "interrupted" : "success",
      text: killed ? t("Stopped.") : steps.at(-1).text,
      costUsd: 0.0123,
      durationMs: Date.now() - t0, // what this run really took and did, so "Completed, 2 s, 2 steps" matches what was on screen
      numTurns: steps.filter((x) => x.kind !== "text" && x.kind !== "final").length + 1,
      sessionId,
      contextTokens: 48200,
      // a permission request only when this run really had a refused `git push` (the analyst and the tester never push)
      permissionDenials: !killed && steps.some((x) => x.kind === "tool" && x.error && x.summary === "git push") ? [{ tool: "Bash", input: { command: "git push" }, spec: "Bash(git push)" }] : [],
      contextWindow: 1000000,
    };
    emit(result);
    emit({ type: "status", status: killed ? "error" : "done" });
    return result;
  })();

  return { promise, kill: () => { killed = true; } };
}
