// A small MCP server for the team tools (stdio, one JSON-RPC message per line).
// Claude Code starts it with `--mcp-config`. Each role only sees the tools opened to it
// (ECELON_TOOLS). Tool calls are forwarded to the station; the station does the work and returns a short reply.
import readline from "node:readline";

const URL_ = process.env.ECELON_URL;
const TOKEN = process.env.ECELON_TOKEN;
const FROM = process.env.ECELON_AGENT;
const ENABLED = new Set((process.env.ECELON_TOOLS || "").split(",").filter(Boolean));
const pairs = (s) => (s || "").split("|").filter(Boolean).map((r) => { const i = r.indexOf(":"); return [r.slice(0, i), r.slice(i + 1)]; });
const ROLES = pairs(process.env.ECELON_ROLES);       // [["tester","Tester"], …]
const SIBLINGS = pairs(process.env.ECELON_SIBLINGS); // [["teamKey","ERP Frontend"], …]
const STATUS = ["todo", "doing", "done", "unclear", "out_of_scope"];

const TOOLS = {
  assign_task: {
    description:
      `Give a task to a role in the team. Available roles: ${ROLES.map(([id, l]) => `${id} (${l})`).join(", ")}. The task runs in that role's own session; ` +
      "the tool result does not wait for it: the role's result comes to you automatically as a new message when it finishes. You can give independent tasks at the same time " +
      "by calling this back to back. The task text must be understandable on its own: what changed, which files, what it has to verify or review.",
    inputSchema: { type: "object", properties: {
      role: { type: "string", enum: ROLES.map(([id]) => id), description: "The role that receives the task" },
      task: { type: "string", description: "Full, self-contained description of the task" } }, required: ["role", "task"] },
  },
  notify_project: {
    description:
      `Send a notification to the team lead of a linked (sibling) project: ${SIBLINGS.map(([, n]) => n).join(", ")}. ` +
      "Use it when you change the API contract, the data model, a shared area or anything that affects the other project. The message must be understandable on its own: " +
      "what changed, example request/response, what is expected from them. When the other side finishes, its reply lands in your chat as a card (it does not run you again).",
    inputSchema: { type: "object", properties: {
      project: { type: "string", enum: SIBLINGS.map(([, n]) => n), description: "Name of the sibling project" },
      message: { type: "string", description: "Notification text" } }, required: ["project", "message"] },
  },
  save_requirements: {
    description:
      "Save the project's requirement (scope) list. Make every measurable requirement in the analysis document a separate item. " +
      "mode 'merge': updates the item whose code (e.g. R-012) is given, adds new items without a code; an item whose content changed is marked 'changed in the document'. " +
      "mode 'replace': deletes old items that are not in the list. If the document arrived in a new version, first use list_requirements, then merge.",
    inputSchema: { type: "object", properties: {
      mode: { type: "string", enum: ["merge", "replace"] },
      items: { type: "array", items: { type: "object", properties: {
        code: { type: "string", description: "Existing code if any (R-001). Leave empty for a new item." },
        title: { type: "string", description: "Short, measurable requirement" },
        detail: { type: "string" }, section: { type: "string", description: "Module/section, e.g. Stock, Accounting" },
        source: { type: "string", description: "Document name and section/page" },
        doc_claim: { type: "string", enum: ["done", "partial", "todo", "unspecified"], description: "The DOCUMENT's claim for this item (e.g. 'done' if the status column says 'Completed', ✓ or 'done'). Not the status of the code!" },
        doc_quote: { type: "string", description: "Short quote and location where the document makes this claim" },
        status: { type: "string", enum: STATUS, description: "Work status. 'done' cannot be given here; done only comes from the tester's verification." },
        sections: { type: "array", items: { type: "string" }, description: "Where this item is in the document: section codes (from document_sections, e.g. D1-014) or a range 'D1-020..D1-024'. Treat as MANDATORY: every section of the document must either be linked to an item or be marked with mark_sections." },
        acceptance_criteria: { type: "array", items: { type: "string" }, description: "Measurable acceptance criteria; the tester tries each one separately. E.g. 'If stock is insufficient the transfer is rejected and a warning is shown'. Turn the numbers, limits, fields, rules and error cases in the document into criteria." } }, required: ["title"] } } }, required: ["items"] },
  },
  document_sections: {
    description: "The documents linked to the project, split into sections automatically by the station: every paragraph, list item and table row is a coded section (D1-004). " +
      "Coverage rule: every section must be linked to at least one requirement or be marked 'contains no requirement' with a reason; otherwise it counts as OPEN (unmatched). " +
      "filter: 'open' (default), 'changed' (sections that changed in the new version of the document, with their previous text), 'removed', 'marked', 'all'. Paginate with start on a long list.",
    inputSchema: { type: "object", properties: {
      filter: { type: "string", enum: ["open", "changed", "removed", "marked", "all"] },
      doc: { type: "string", description: "Filter by document name or prefix (D1)" }, start: { type: "number" } } },
  },
  mark_sections: {
    description: "Mark the document sections that contain NO requirement, with a reason (cover page, revision table, table of contents, definition/introduction text, signatures etc.). " +
      "Sections that contain a rule, an obligation (must/shall, mandatory, required), a screen or a field are rejected. Your marks go to the user for approval. When in doubt do not mark, turn it into an item. remove=true removes the mark.",
    inputSchema: { type: "object", properties: {
      sections: { type: "array", items: { type: "string" }, description: "Codes or ranges: D1-001, D1-002..D1-009" },
      reason: { type: "string" }, remove: { type: "boolean" } }, required: ["sections"] },
  },
  requirement_detail: {
    description: "Full detail of a single requirement: acceptance criteria and their results, where it is in the document (section texts), document change warning, last verification.",
    inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  },
  report_missing_requirements: {
    description: "Second review: read the document independently of the list and report the requirements that have NO COUNTERPART in the list (also sections wrongly marked 'contains no requirement'). " +
      "Items are added with status 'unclear'; the analyst confirms them. Give each one its section code in the document.",
    inputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: {
      title: { type: "string" }, detail: { type: "string" }, section: { type: "string" }, source: { type: "string" },
      sections: { type: "array", items: { type: "string" } }, why: { type: "string", description: "Why you think it is missing" } }, required: ["title"] } } }, required: ["items"] },
  },
  set_requirement_status: {
    description: "Update the WORK status of a requirement (e.g. an item you are working on, finished or found missing). Give file:line as evidence. " +
      "NOTE: saying 'done' is not verification; the item shows as 'not verified' until the tester proves it with verify_requirement.",
    inputSchema: { type: "object", properties: {
      code: { type: "string", description: "Requirement code, e.g. R-012" },
      status: { type: "string", enum: STATUS }, evidence: { type: "string" }, note: { type: "string" } }, required: ["code", "status"] },
  },
  list_requirements: {
    description: "Get the project's requirement list: code, work status, the document's claim, verification status. only_mismatches: items that show as 'done' in the document but are not verified.",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: STATUS }, only_mismatches: { type: "boolean" } } },
  },
  verify_requirement: {
    description: "Verify a requirement by checking whether it REALLY works, or mark it failed. Reading the code is not enough: run the relevant test; " +
      "if there is none, try the scenario (command, request, write a test). Evidence is mandatory for 'verified': file:line that exists in the project (e.g. src/stock/transfer.ts:40-62) and/or 'test: <test name>'. " +
      "If you are not sure, say 'failed' and write why. If the evidence file changes later, the item automatically needs re-verification.",
    inputSchema: { type: "object", properties: {
      code: { type: "string" }, result: { type: "string", enum: ["verified", "failed"] },
      how: { type: "string", description: "What you ran, which scenario you tried, what you saw" },
      evidence: { type: "string", description: "Comma-separated: file:line or file:start-end, 'test: name'" },
      criteria: { type: "array", description: "If the item has acceptance criteria (requirement_detail), the result of EACH ONE. 'verified' is not accepted unless all of them are 'pass'.",
        items: { type: "object", properties: { no: { type: "number" }, result: { type: "string", enum: ["pass", "fail"] }, note: { type: "string" } }, required: ["no", "result"] } } }, required: ["code", "result", "how"] },
  },
};
const visible = () => Object.entries(TOOLS).filter(([n]) => ENABLED.has(n)).map(([name, t]) => ({ name, ...t }));

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications (notifications/initialized etc.)
  try {
    if (method === "initialize") return reply(id, { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "team", version: "1.1.0" } });
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") return reply(id, { tools: visible() });
    if (method === "tools/call") {
      const name = params?.name;
      if (!ENABLED.has(name)) return fail(id, -32602, "This tool is not available to you: " + name);
      const r = await fetch(`${URL_}/api/team/tool`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: TOKEN, from: FROM, tool: name, args: params.arguments || {} }),
      }).then((x) => x.json()).catch((e) => ({ error: "Could not reach the station: " + e.message }));
      return reply(id, { content: [{ type: "text", text: r.error || r.message }], isError: !!r.error });
    }
    fail(id, -32601, "Unsupported method: " + method);
  } catch (e) { fail(id, -32603, e.message); }
});
