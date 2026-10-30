// Requirement tracking (Scope): items extracted from the analysis document, per project.
// data/requirements/<team>.json — agents update via MCP tools, the user via the UI.
//
// Main goal: an item that looks "done" in the document but is not actually done must not slip through.
// So each item carries three separate facts:
//   claim   — what the document says (done / partial / todo / unspecified)
//   status  — work status (todo / doing / done / unclear / out of scope)
//   verify  — verification: only the tester or the user can do it, WITH EVIDENCE (file:line, test name).
//             If an evidence file changes later the verification becomes "stale" and asks for re-verification.
// Mismatch = the document says "done" but the item is not verified (or verification failed/stale).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { t } from "./i18n.js";
import { dataPath, mkdirPrivate, writePrivate } from "./paths.js";

const DIR = dataPath("requirements");
export const STATUSES = ["todo", "doing", "done", "unclear", "dropped"];
// Display names, translated at call time (no t() at module top level).
export const statusName = (s) => ({ todo: t("not done"), doing: t("in progress"), done: t("complete"), unclear: t("unclear"), dropped: t("out of scope") })[s] ?? s;
export const claimName = (c) => ({ done: t("done"), partial: t("partial"), todo: t("not done") })[c] ?? c;
export const verifyName = (v) => ({ none: t("not verified"), verified: t("verified"), failed: t("verification failed"), stale: t("needs re-verification") })[v] ?? v;
// Lookup objects kept for callers that index by id (lazy getters: translated on access).
const lazy = (keys, f) => Object.defineProperties({}, Object.fromEntries(keys.map((k) => [k, { get: () => f(k), enumerable: true }])));
export const STATUS_TR = lazy(STATUSES, statusName);
export const CLAIM_TR = lazy(["done", "partial", "todo"], claimName);
export const VERIFY_TR = lazy(["none", "verified", "failed", "stale"], verifyName);
// Accepted aliases for agent/user input (ASCII-folded: "yapılmadı" and "yapilmadi" both match).
const fold = (s) => String(s).trim().toLowerCase().replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const STATUS_ALIAS = { "yapilmadi": "todo", "yapiliyor": "doing", "tamam": "done", "bitti": "done", "belirsiz": "unclear", "kapsam disi": "dropped", "out_of_scope": "dropped" };
const CLAIM_ALIAS = { "yapildi": "done", "tamamlandi": "done", "tamam": "done", "kismen": "partial", "yapilmadi": "todo", "belirtilmemis": null, "unspecified": null };
const normStatus = (s) => { s = fold(s || ""); return STATUSES.includes(s) ? s : STATUS_ALIAS[s] || null; };
const normClaim = (s) => { if (s == null || s === "") return undefined; s = fold(s); if (["done", "partial", "todo"].includes(s)) return s; return s in CLAIM_ALIAS ? CLAIM_ALIAS[s] : undefined; };
const file = (team) => path.join(DIR, `${String(team).replace(/[^\w-]/g, "")}.json`);
const clip = (s, n) => String(s ?? "").trim().slice(0, n);

export function load(team) {
  try { const d = JSON.parse(fs.readFileSync(file(team), "utf8")); for (const it of d.items) it.verify ||= { state: "none" }; return d; }
  catch { return { items: [], updatedAt: null }; }
}
export function save(team, data) {
  mkdirPrivate(DIR);
  data.updatedAt = Date.now();
  const tmp = file(team) + ".tmp"; writePrivate(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file(team));
  return data;
}
// New codes are R-001 style; the counter takes the highest number of any <LETTERS>-<digits> code (older data may have G-… codes).
const nextCode = (items) => { let n = 0; for (const it of items) { const m = /^[A-Z]+-(\d+)$/.exec(it.code); if (m) n = Math.max(n, +m[1]); } return `R-${String(n + 1).padStart(3, "0")}`; };
// Mismatch: the document says "done" (the analyst wrote it, or the linked section mentions ✓/completed) but the item is not verified.
// An agent's "out of scope" does not count as an escape until the user approves it.
export const isDropped = (it) => it.status === "dropped" && !it.dropPending;
export const isMismatch = (it) => !isDropped(it) && (it.claim === "done" || (!it.claim && it.claimHint)) && it.verify?.state !== "verified";

// Analyst: save the list. mode "merge": update items whose code matches (flag if the content changed), add new ones.
// mode "replace": remove items that are not in the list.
export function upsertMany(team, items, mode = "merge", by = "") {
  const replace = mode === "replace" || mode === "degistir";
  const data = load(team); const seen = new Set(); let added = 0, changed = 0;
  for (const raw of (Array.isArray(items) ? items : []).slice(0, 2000)) {
    const title = clip(raw.title || raw.baslik, 300); if (!title) continue;
    let code = clip(raw.code || raw.kod, 24).toUpperCase();
    let it = code && data.items.find((x) => x.code === code);
    if (!it && !code) it = data.items.find((x) => x.title.toLowerCase() === title.toLowerCase());
    const detail = clip(raw.detail || raw.detay, 2000), section = clip(raw.section || raw.bolum, 80), source = clip(raw.source || raw.kaynak, 200);
    const claim = normClaim(raw.claim ?? raw.doc_claim ?? raw.dokuman_durumu), claimText = clip(raw.claimText ?? raw.doc_quote ?? raw.dokuman_alinti, 400);
    const segs = Array.isArray(raw.segs) ? raw.segs : null; // coverage: linked document sections (validated beforehand)
    const crit = (Array.isArray(raw.criteria ?? raw.acceptance_criteria ?? raw.kabul_kriterleri) ? (raw.criteria ?? raw.acceptance_criteria ?? raw.kabul_kriterleri) : null);
    const criteria = crit && crit.map((c) => clip(typeof c === "string" ? c : c?.text || c?.kriter, 400)).filter(Boolean).slice(0, 20);
    if (it) {
      if (segs) it.segs = [...new Set([...(replace ? [] : it.segs || []), ...segs])];
      if (criteria?.length && JSON.stringify(criteria) !== JSON.stringify((it.criteria || []).map((c) => c.text))) {
        const old = new Map((it.criteria || []).map((c) => [c.text, c]));
        it.criteria = criteria.map((x) => old.get(x) || { text: x, state: "none" });
        if (it.verify?.state === "verified" && it.criteria.some((c) => c.state !== "pass")) it.verify = { ...it.verify, state: "stale", staleRefs: [t("acceptance criteria changed")] };
      }
      if (it.title !== title || (detail && it.detail !== detail)) { it.changed = true; changed++; }
      if (it.title !== title || (detail && it.detail !== detail) || criteria?.length) delete it.docChange; // the analyst really revisited the item
      Object.assign(it, { title, ...(detail ? { detail } : {}), ...(section ? { section } : {}), ...(source ? { source } : {}), updatedAt: Date.now(), updatedBy: by });
      if (claim !== undefined && (claim !== null || raw.claim === null)) { it.claim = claim; if (claimText) it.claimText = claimText; } // "unspecified" does not erase an existing claim
      if (typeof raw.claimHint === "boolean") it.claimHint = raw.claimHint;
      const st = normStatus(raw.status || raw.durum); if (st && st !== "done") it.status = st; // "done" only through verification
    } else {
      const st = normStatus(raw.status || raw.durum);
      it = { code: code || nextCode(data.items), title, detail, section: section || t("General"), source, status: st && st !== "done" ? st : "todo",
        claim: claim ?? null, claimText, claimHint: !!raw.claimHint, verify: { state: "none" }, ...(raw.origin ? { origin: raw.origin } : {}), segs: segs || [], criteria: (criteria || []).map((x) => ({ text: x, state: "none" })), evidence: "", note: "", createdAt: Date.now(), updatedAt: Date.now(), updatedBy: by };
      data.items.push(it); added++;
    }
    seen.add(it.code);
  }
  let removed = 0;
  if (replace) { const before = data.items.length; data.items = data.items.filter((x) => seen.has(x.code)); removed = before - data.items.length; }
  save(team, data);
  return { added, changed, removed, total: data.items.length, mismatches: data.items.filter(isMismatch).length };
}

// Work status. "done" is NOT verification: the item shows "not verified" until it is verified.
export function setStatus(team, code, { status, evidence, note, claim, by = "", agent = false } = {}) {
  const data = load(team);
  const it = data.items.find((x) => x.code === String(code || "").trim().toUpperCase());
  if (!it) return { error: t("Requirement not found: {code}. You can see the codes with list_requirements.", { code }) };
  if (status !== undefined) {
    const st = normStatus(status); if (!st) return { error: t("Invalid status: {status}. One of: {list}", { status, list: STATUSES.join(", ") }) };
    if (st !== "done" && it.verify?.state === "verified") { it.verify = { state: "none", note: t("Status set to '{status}' ({by})", { status: statusName(st), by }) }; for (const c of it.criteria || []) if (c.state === "pass") c.state = "none"; }
    it.status = st;
    // an agent's "out of scope" decision awaits the user's approval (still counted in mismatches and coverage)
    if (st === "dropped" && agent) it.dropPending = { by, at: Date.now() }; else delete it.dropPending;
  }
  if (claim !== undefined) it.claim = normClaim(claim) ?? null;
  if (evidence !== undefined) it.evidence = clip(evidence, 500);
  if (note !== undefined) it.note = clip(note, 1000);
  if (!agent) it.changed = false; // only a user/analyst review clears the "changed in the document" flag
  it.updatedAt = Date.now(); it.updatedBy = by;
  save(team, data);
  return { ok: true, item: it };
}

// Acceptance criteria: the user edits them (text list) or marks the result of a single criterion by hand
export function setCriteria(team, code, { list, index, state, by = t("User") } = {}) {
  const data = load(team);
  const it = data.items.find((x) => x.code === String(code || "").trim().toUpperCase());
  if (!it) return { error: t("Requirement not found: {code}", { code }) };
  if (Array.isArray(list)) {
    const old = new Map((it.criteria || []).map((c) => [c.text, c]));
    it.criteria = list.map((x) => clip(x, 400)).filter(Boolean).slice(0, 20).map((x) => old.get(x) || { text: x, state: "none" });
    if (it.verify?.state === "verified" && it.criteria.some((c) => c.state !== "pass")) it.verify = { ...it.verify, state: "stale", staleRefs: [t("acceptance criteria changed")] };
  } else if (Number.isInteger(index) && it.criteria?.[index]) {
    if (!["none", "pass", "fail"].includes(state)) return { error: t("Invalid state") };
    it.criteria[index] = { ...it.criteria[index], state, by, at: Date.now(), note: state === "none" ? "" : t("by hand") };
    if (state === "fail" && it.verify?.state === "verified") it.verify = { ...it.verify, state: "failed", how: t("criterion {n} marked 'failed' by hand", { n: index + 1 }) };
  }
  it.updatedAt = Date.now(); it.updatedBy = by;
  save(team, data);
  return { ok: true, item: it };
}
// ---- verification (tester / user). Evidence: "src/a.ts:42, src/b.ts:10-20, test: stock transfer approval"
function parseEvidence(text, cwd) {
  const refs = [], tests = [], bad = [];
  for (const part of String(text || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const tm = /^test\s*:\s*(.+)$/i.exec(part); if (tm) { tests.push(clip(tm[1], 200)); continue; }
    const m = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/.exec(part); if (!m) { bad.push(part); continue; }
    const abs = path.resolve(cwd, m[1]); const rel = path.relative(path.resolve(cwd), abs);
    if (rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { bad.push(part); continue; }
    if (m[2]) { // the line number must be inside the file
      let n = 0; try { n = fs.readFileSync(abs, "utf8").split(/\r?\n/).length; } catch {}
      if (+m[2] > n || (m[3] && +m[3] > n)) { bad.push(t("{ref} (file has {n} {n|line|lines})", { ref: part, n })); continue; }
    }
    refs.push({ ref: part, file: rel.split(path.sep).join("/"), from: m[2] ? +m[2] : null, to: m[3] ? +m[3] : m[2] ? +m[2] : null });
  }
  // "test: name" must not be made up: the name must appear in the project's test files
  const missingTests = tests.filter((name) => !testNameExists(cwd, name));
  return { refs, tests: tests.filter((name) => !missingTests.includes(name)), bad: [...bad, ...missingTests.map((name) => t("test: {name} (no such test found in the project)", { name }))] };
}
const TEST_FILE = /(?:^|[\\/])(?:tests?|__tests__|spec|specs|e2e|cypress|features)(?:[\\/]|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|Tests?\.cs$|_test\.(?:go|py)$|test_.*\.py$|Test\.php$|\.feature$/i;
function testNameExists(cwd, name) {
  const needle = String(name).trim().toLowerCase(); if (needle.length < 3) return false;
  const root = path.resolve(cwd); const stack = [root]; let scanned = 0;
  while (stack.length && scanned < 400) {
    const dir = stack.pop(); let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/^(node_modules|\.git|dist|build|bin|obj|vendor|\.venv|venv)$/.test(e.name)) stack.push(p); continue; }
      if (!TEST_FILE.test(p)) continue;
      scanned++;
      try { const st = fs.statSync(p); if (st.size > 1.5e6) continue; if (fs.readFileSync(p, "utf8").toLowerCase().includes(needle)) return true; } catch {}
    }
  }
  return false;
}
function hashRef(cwd, r) {
  try {
    const txt = fs.readFileSync(path.join(cwd, r.file), "utf8");
    let body = txt;
    if (r.from) { const lines = txt.split(/\r?\n/); if (r.from > lines.length) return null; const to = r.to || r.from; const pad = Math.max(3, Math.ceil((12 - (to - r.from + 1)) / 2)); body = lines.slice(Math.max(0, r.from - 1 - pad), to + pad).join("\n"); }
    return crypto.createHash("sha1").update(body.replace(/\s+/g, " ")).digest("hex").slice(0, 16);
  } catch { return null; }
}
export function verify(team, code, { result, how, evidence, criteria, by = "", manual = false } = {}, cwd) {
  const data = load(team);
  const it = data.items.find((x) => x.code === String(code || "").trim().toUpperCase());
  if (!it) return { error: t("Requirement not found: {code}", { code }) };
  const ok = ["verified", "dogrulandi"].includes(fold(result));
  const failed = ["failed", "basarisiz"].includes(fold(result));
  if (!ok && !failed) return { error: t("result must be 'verified' or 'failed'") };
  how = clip(how, 800);
  if (!how) return { error: t("Write how you verified it (which scenario you ran, what you saw).") };
  // acceptance criteria: each one must have been tried separately
  const crit = it.criteria || [];
  if (crit.length && Array.isArray(criteria)) {
    for (const c of criteria) {
      const i = (+(c.no ?? c.n) || 0) - 1; if (!crit[i]) continue;
      const pass = ["gecti", "pass", "ok", "dogrulandi"].includes(fold(c.result ?? c.sonuc));
      crit[i] = { ...crit[i], state: pass ? "pass" : "fail", note: clip(c.note ?? c.not, 300), by, at: Date.now() };
    }
  }
  if (ok && crit.length && !manual) {
    const missing = crit.map((c, i) => (c.state !== "pass" ? i + 1 : 0)).filter(Boolean);
    if (missing.length) return { error: t("This item has {n} acceptance criteria; try each one and report its result in the 'criteria' field. Missing or failed: {list}.", { n: crit.length, list: missing.join(", ") }) + "\n" + crit.map((c, i) => `${i + 1}. ${c.text}`).join("\n") };
  }
  if (ok && manual && crit.some((c) => c.state === "none")) return { error: t("First mark each acceptance criterion ({n} criteria look untried): click the criteria under the item and choose passed/failed.", { n: crit.filter((c) => c.state === "none").length }) };
  if (ok && crit.some((c) => c.state === "fail")) return { error: t("The item cannot be verified while a failed acceptance criterion remains.") };
  // a single-line evidence window would be small (±3 lines); a block of at least 12 lines is hashed so nearby changes are not missed
  const ev = parseEvidence(evidence, cwd);
  if (ok && !manual && !ev.refs.length && !ev.tests.length) return { error: t("Verification cannot be without evidence: give at least one file:line (existing in the project) or 'test: <test name>'.") + (ev.bad.length ? " " + t("Not found: {list}", { list: ev.bad.join(", ") }) : "") };
  if (ok && ev.bad.length) return { error: t("This evidence was not found in the project: {list}. Give the correct path or remove it.", { list: ev.bad.join(", ") }) };
  for (const r of ev.refs) { r.hash = hashRef(cwd, r); r.hv = 2; }
  it.verify = { state: ok ? "verified" : "failed", by, at: Date.now(), how, refs: ev.refs, tests: ev.tests };
  if (ok) it.status = "done"; else if (it.status === "done") it.status = "doing";
  if (evidence) it.evidence = clip(evidence, 500);
  it.updatedAt = Date.now(); it.updatedBy = by; it.changed = false;
  save(team, data);
  return { ok: true, item: it };
}
// Did the evidence of verified items change? (cheap check during GET)
export function refreshStale(team, cwd) {
  const data = load(team); let n = 0;
  for (const it of data.items) {
    if (it.verify?.state !== "verified" || !it.verify.refs?.length) continue;
    let migrated = false;
    for (const r of it.verify.refs) if (r.hv !== 2) { r.hash = hashRef(cwd, r); r.hv = 2; migrated = true; } // old (narrow-window) hashes are refreshed silently
    if (migrated) n += 0, save(team, data);
    const moved = it.verify.refs.filter((r) => r.hash && hashRef(cwd, r) !== r.hash).map((r) => r.ref);
    if (moved.length) { it.verify = { ...it.verify, state: "stale", staleRefs: moved, staleAt: Date.now() }; for (const c of it.criteria || []) if (c.state === "pass") c.state = "none"; n++; }
  }
  if (n) save(team, data);
  return { data, staled: n };
}

export function addItem(team, { title, section, detail, claim }) {
  return upsertMany(team, [{ title, section, detail, claim }], "merge", t("User"));
}
export function removeItem(team, code) {
  const data = load(team); const n = data.items.length;
  data.items = data.items.filter((x) => x.code !== code); save(team, data);
  return { removed: n - data.items.length };
}
export function summary(team) {
  const all = load(team).items; const items = all.filter((x) => !isDropped(x));
  return { total: items.length, done: items.filter((x) => x.verify?.state === "verified").length, mismatches: items.filter(isMismatch).length, noCriteria: items.filter((x) => !x.criteria?.length).length,
    docChanged: items.filter((x) => x.docChange || x.changed).length, stale: items.filter((x) => x.verify?.state === "stale").length, failed: items.filter((x) => x.verify?.state === "failed").length,
    dropPending: all.filter((x) => x.dropPending).length, review: items.filter((x) => x.origin === "review").length, dropped: all.filter(isDropped).length };
}

// Short list for agents
export function listText(team, status, onlyMismatch = false) {
  const st = status ? normStatus(status) : null;
  const items = load(team).items.filter((x) => (!st || x.status === st) && (!onlyMismatch || isMismatch(x)) && (!onlyMismatch || !isDropped(x)));
  if (!items.length) return onlyMismatch ? t("No mismatches.") : st ? t("No requirement with status \"{status}\".", { status: statusName(st) }) : t("No requirement list yet. The analyst should extract it from the linked documents.");
  return items.map((x) => `${x.code} [${t("work: {status}", { status: statusName(x.status) })}${x.dropPending ? ` ${t("(awaiting approval)")}` : ""} | ${t("document: {claim}", { claim: x.claim ? claimName(x.claim) : x.claimHint ? t("done (the section mentions ✓/completed)") : t("unspecified") })} | ${t("verification: {state}", { state: verifyName(x.verify?.state || "none") })}]${isMismatch(x) ? ` ${t("⚠ MISMATCH")}` : ""} (${x.section}) ${x.title}` +
    `${x.segs?.length ? ` — ${t("sections: {list}", { list: x.segs.join(" ") })}` : ""}${x.criteria?.length ? ` — ${t("acceptance criteria: {passed}/{total} passed", { passed: x.criteria.filter((c) => c.state === "pass").length, total: x.criteria.length })}` : ""}${x.evidence ? ` — ${t("evidence: {evidence}", { evidence: x.evidence })}` : ""}${x.verify?.staleRefs ? ` — ${t("changed evidence: {list}", { list: x.verify.staleRefs.join(", ") })}` : ""}${x.changed ? ` — ${t("CHANGED IN THE DOCUMENT")}` : ""}`).join("\n");
}

// The document arrived in a new version: flag the items linked to changed/removed sections
export function flagDocChange(team, changed = [], removed = []) {
  const data = load(team); const ch = new Set(changed), rm = new Set(removed); const hit = [];
  for (const it of data.items) {
    const c = (it.segs || []).filter((s) => ch.has(s)), r = (it.segs || []).filter((s) => rm.has(s));
    if (!c.length && !r.length) continue;
    it.docChange = { changed: c, removed: r, at: Date.now() }; it.changed = true;
    if (it.verify?.state === "verified") it.verify = { ...it.verify, state: "stale", staleRefs: [t("document changed: {list}", { list: [...c, ...r].join(", ") })], staleAt: Date.now() };
    for (const k of it.criteria || []) if (k.state === "pass") k.state = "none";
    if (r.length) it.segs = it.segs.filter((s) => !rm.has(s));
    hit.push(it.code);
  }
  if (hit.length) save(team, data);
  return hit;
}
// One item with all its details (the tester reads the acceptance criteria here)
export function detailText(team, code, segIdx = new Map()) {
  const it = load(team).items.find((x) => x.code === String(code || "").trim().toUpperCase());
  if (!it) return null;
  const L = [`${it.code} — ${it.title}`, `${t("Section: {section}", { section: it.section })}${it.source ? ` | ${t("Source: {source}", { source: it.source })}` : ""}`,
    `${t("Work: {status}", { status: statusName(it.status) })} | ${t("Document: {claim}", { claim: `${it.claim ? claimName(it.claim) : t("unspecified")}${it.claimText ? ` ("${it.claimText}")` : ""}` })} | ${t("Verification: {state}", { state: verifyName(it.verify?.state || "none") })}`];
  if (it.detail) L.push(t("Detail: {text}", { text: it.detail }));
  if (it.claimHint && !it.claim) L.push(t("The linked section of the document mentions 'done/completed/✓': the document considers this finished; it is a MISMATCH until verified."));
  if (it.dropPending) L.push(t("The out-of-scope decision awaits the user's approval."));
  if (it.criteria?.length) { L.push(t("Acceptance criteria (report the result of each one when verifying):")); it.criteria.forEach((c, i) => L.push(`  ${i + 1}. [${c.state === "pass" ? t("passed") : c.state === "fail" ? t("FAILED") : t("not tried")}] ${c.text}${c.note ? ` — ${c.note}` : ""}`)); }
  if (it.segs?.length) { L.push(t("Counterpart in the document:")); for (const s of it.segs) { const g = segIdx.get(s); L.push(`  ${s}${g ? ` (${g.h || "—"}) ${g.text}` : ` ${t("(this section is no longer in the document, or the document changed)")}`}`); } }
  if (it.docChange) L.push(t("⚠ CHANGED IN THE DOCUMENT: {list}", { list: [...it.docChange.changed, ...it.docChange.removed.map((x) => t("{id} (removed)", { id: x }))].join(", ") }));
  if (it.evidence) L.push(t("Evidence: {text}", { text: it.evidence }));
  if (it.verify?.how) L.push(t("Last verification ({by}): {how}", { by: it.verify.by || "?", how: it.verify.how }));
  if (it.note) L.push(t("Note: {text}", { text: it.note }));
  return L.join("\n");
}
