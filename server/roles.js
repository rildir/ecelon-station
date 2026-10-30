// Team roles: several Claude Code sessions in the same project folder, each an expert in a single job.
// The developer is the only role that writes files; the others read, run, report.
// (If two agents write the same file they overwrite each other's work; the tester tests half-written code.)
import { t, langName } from "./i18n.js";

const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
// acceptEdits mode approves file commands like mkdir/rm/mv/cp/sed without asking; for roles that must not write, these are closed too (deny comes before everything)
const FS_CMDS = ["rm", "rmdir", "mv", "cp", "sed", "touch", "mkdir", "del", "move", "copy", "ren", "Remove-Item", "Move-Item", "Copy-Item", "Set-Content", "Out-File", "tee", "truncate", "dd"].map((c) => `Bash(${c}:*)`);
const GIT_READ = ["Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)"];
const TEST_CMDS = [
  "npm test", "npm run test", "npm run build", "npm run lint", "npx vitest", "npx jest", "npx playwright test", "npx tsc",
  "ng test", "ng build", "php artisan test", "vendor/bin/phpunit", "composer test", "dotnet test", "dotnet build",
  "pytest", "python -m pytest", "go test", "cargo test", "godot --headless",
].map((c) => `Bash(${c}:*)`);

// User-facing texts are getters: t() runs when the field is read, not at import time (language can change at runtime).
export const ROLES = {
  dev: {
    get label() { return t("Developer"); }, order: 1,
    get desc() { return t("Writes and changes code. The only agent in the project that writes files."); },
    model: "claude-sonnet-5-5", effort: "medium", permission: "acceptEdits",
    disallow: [], allow: GIT_READ,
    get note() {
      return t("Your role in the team: DEVELOPER. You are the only one who writes and changes code in the project.") + " " +
        t("When your work is done, finish with a short summary of what you changed, in which files, and how it can be tried; the tester and the reviewer work from this summary.");
    },
    get handoff() { return t("Do what is needed based on these findings; when done, summarize what you changed."); },
  },
  analyst: {
    get label() { return t("Analyst"); }, order: 0,
    get desc() { return t("Reads the analysis document; extracts requirements, gaps and a work list. Does not change files."); },
    model: "claude-opus-5-5", effort: "high", permission: "acceptEdits",
    disallow: [...EDIT_TOOLS, "Bash"], allow: [],
    get note() {
      return t("Your role in the team: ANALYST. You read the analysis documents in the document library and the existing code; you do not change files or run commands.") + " " +
        t("You extract the requirements, the ambiguities and the differences between the document and the code item by item, and give the developer an ordered, clear work list.") + " " +
        t("If you assume something that is not in the document, mark it explicitly as an 'assumption'.");
    },
    get handoff() { return t("Check this against the analysis document: are there missing, wrong or unclear requirements? Produce a work list for the developer."); },
  },
  tester: {
    get label() { return t("Tester"); }, order: 2,
    get desc() { return t("Runs the tests and the build, reports errors. Does not fix application code."); },
    model: "claude-sonnet-5-5", effort: "medium", permission: "acceptEdits",
    disallow: [], allow: [...TEST_CMDS, ...GIT_READ],
    get note() {
      return t("Your role in the team: TESTER. You run the tests and the build and verify the changes. You DO NOT FIX application code; if needed you only write or update test files.") + " " +
        t("Your report must follow this layout: result (pass/fail), the commands you ran, file:line for every error, expected and actual behavior, likely cause. If there are no errors, say so explicitly.");
    },
    get handoff() { return t("Test the latest changes. If you find an error, report where it is, the expected and the actual behavior."); },
  },
  reviewer: {
    get label() { return t("Reviewer"); }, order: 3,
    get desc() { return t("Reviews the changes: error risk, security, readability, conformance to the document. Does not change files."); },
    model: "claude-opus-5-5", effort: "high", permission: "acceptEdits",
    disallow: [...EDIT_TOOLS, ...FS_CMDS], allow: GIT_READ,
    get note() {
      return t("Your role in the team: REVIEWER. You review the latest changes (git diff, git log); you do not change files.") + " " +
        t("Write the findings in order of severity (critical / major / minor), each with file:line and a concrete suggestion. If there is no problem, approve briefly.");
    },
    get handoff() { return t("Review the latest changes; write the findings in order of severity."); },
  },
};
export const ROLE_IDS = Object.keys(ROLES);
export const roleOf = (a) => ROLES[a?.role] ? a.role : "dev";

// Plain definition sent to the client
export const publicRoles = () => Object.fromEntries(Object.entries(ROLES).map(([k, r]) =>
  [k, { label: r.label, desc: r.desc, order: r.order, model: r.model, effort: r.effort, handoff: r.handoff }]));

// Role settings for claude -p: denied/allowed tools + system note (who is in the team)
export function roleArgs(agent, team = []) {
  const r = ROLES[roleOf(agent)];
  const solo = team.length <= 1;
  const others = team.filter((m) => m.id !== agent.id).map((m) => ROLES[roleOf(m)].label);
  const note = solo ? "" :
    `${r.note}\n` + t("Your teammates work in the same project folder: {others}.", { others: others.join(", ") }) + " " +
    t("Do not take over another role's work; if needed, say at the end of your answer who it should be handed to (e.g. 'Should be handed to the tester').") + " " +
    t("If there is a 'Team handoff' section at the end of the message, that section is the result of your teammate's latest work.");
  const lead = agent._lead ? "\n\n" + t("YOU ARE THE TEAM LEAD. The user talks only to you; when needed, you distribute the work to the team.") + " " +
    t("Assign tasks with the `assign_task` tool: {roles}.", { roles: others.map((l) => l).join(", ") }) + " " + t("When to give work to whom:") + "\n" +
    team.filter((m) => m.id !== agent.id).map((m) => `- ${ROLES[roleOf(m)].label}: ${ROLES[roleOf(m)].desc}`).join("\n") +
    "\n" + t("Rules: Do code-related work yourself. If the user says 'test', 'try', 'verify' or you have finished a meaningful code change, give it to the tester; if they say 'according to the document', 'requirement', 'examine/analyze in depth', to the analyst; if they say 'review', 'code review', 'quality', to the reviewer.") + " " +
    t("Do not keep the team busy with small, one-line jobs. The task text must be understandable on its own (what changed, which files, what to verify).") + " " +
    t("After assigning a task, do NOT wait for the result and do not do the same work yourself: end your turn with a short note; the results come to you automatically in a 'Results from the team' message.") + " " +
    t("You can assign independent tasks at the same time. When the results arrive, fix things and reassign if needed; when the work is done, write the user a short summary.") : "";
  // requirement tracking (Scope): everyone can update the status, the analyst extracts the list
  const reqNote = solo ? "" : "\n\n" + t("REQUIREMENT TRACKING: The project may have a requirement list extracted from the analysis document (list_requirements).") + " " +
    t("The main goal is that items shown as 'done' in the document but not actually done are NOT OVERLOOKED. Saying 'done' is not verification; only the tester verifies an item, with evidence.") + " " +
    (roleOf(agent) === "analyst"
      ? t("If you are asked to extract requirements from the document, read the document WITH SECTION CODES using document_sections (filter 'all'); write every measurable item separately and save with save_requirements: give every item where it is in the document (sections) and measurable acceptance_criteria.") + " " +
        t("Before the work is done, document_sections 'open' must be empty: link every remaining section to an item, or if it contains no requirement, mark it with mark_sections giving a reason.") + " " +
        t("If the document arrived in a new version, review 'changed' and 'removed' and update the affected items.") + " " +
        t("Also write the document's claim for every item (status column, ✓, 'completed', 'done' and the like) in the doc_claim and doc_quote fields; do not trust the document and count the item as 'done'.") + " " +
        t("If you are asked to compare with the code, update the work status of every item with set_requirement_status; give file:line as evidence, say 'todo' if it has no counterpart, 'doing' if partly, 'unclear' if the document is not clear.") + " "
      : roleOf(agent) === "tester"
        ? t("Before verifying, read the item's acceptance criteria with requirement_detail; try every criterion separately and write its result in the 'criteria' field of verify_requirement.") + " " +
          t("If you are asked to verify, really try every item (run a test or walk through the scenario) and record the result with evidence using verify_requirement. Reading the code and saying 'it is there' is not verification. If you are not sure, say 'failed'.") + " " +
          t("Give priority to mismatches (list_requirements only_mismatches).") + " "
        : roleOf(agent) === "reviewer"
          ? t("If you are asked for a second review/document check, read the document INDEPENDENTLY of the requirement list (document_sections 'all'); report the sections that have no counterpart in the list or are wrongly marked 'contains no requirement' with report_missing_requirements.") + " " +
            t("If the acceptance criteria of existing items miss a number/rule/error case from the document, write it in your report.") + " "
        : t("If you worked on a requirement, update its work status with set_requirement_status (evidence: file:line).") + " " +
          t("When you finish an item, give the tester a task to verify it; before telling the user 'done', make sure no item shown as 'done' in the document remains unverified and no section of the document remains open (document_sections); if any remain, give them to the analyst.") + " ");
  const sib = agent._lead && agent._siblings?.length ? "\n\n" + t("SIBLING PROJECTS: {names}.", { names: agent._siblings.join(", ") }) + " " +
    t("When you change the API contract, the data model or something shared that affects them, notify them with notify_project (what changed, example request/response, what is expected from them). Do not send a notification again in reply to a notification from a sibling project.") : "";
  // Claude Code's own subagent / session tools must not get mixed up with the team layout (the lead was looking at other sessions with ListAgents and doing the work itself)
  const NO_SUBAGENTS = ["Task", "Agent", "ListAgents", "SendMessage"];
  const noSub = solo ? "" : "\n\n" + (agent._lead
    ? t("IMPORTANT: Your teammates are NOT Claude Code subagents or other Claude sessions. Do not use tools like Task/Agent/ListAgents/SendMessage; the only way to give work to the team is the mcp__team__assign_task tool. If the user asks for testing/analysis/review, do not do the work yourself, give it to the relevant role with assign_task.")
    : t("IMPORTANT: Your teammates are NOT Claude Code subagents or other Claude sessions. Do not use tools like Task/Agent/ListAgents/SendMessage; do your own work and report the result."));
  // The agent is told which language the user speaks (the Turkish entry of this key is simply "answer in Turkish")
  const langLine = t("Answer the user in {language}.", { language: langName() });
  const body = note + lead + reqNote + sib + noSub;
  // An agent working alone stays fully authorized as before (behaves like the developer)
  return { note: langLine + (body ? "\n\n" + body : ""), disallow: solo ? [] : [...r.disallow, ...NO_SUBAGENTS], allow: r.allow };
}
