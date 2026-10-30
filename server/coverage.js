// Document coverage check: "no part of the document may slip through".
// The station itself splits every document linked to the project into sections (paragraph, item, table row) and
// gives each section a permanent code (D1-004). Each section must either be linked to at least one requirement or
// be marked "contains no requirement" with the analyst's reason. A section left open = not covered.
// When the document changes with a new version the sections are matched: items linked to changed/removed sections are flagged.
//   data/requirements/<team>.coverage.json
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { t, locale } from "./i18n.js";
import { dataPath, mkdirPrivate, writePrivate } from "./paths.js";

const DIR = dataPath("requirements");
const file = (team) => path.join(DIR, `${String(team).replace(/[^\w-]/g, "")}.coverage.json`);
const MAX_SEG = 3000;
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
const norm = (s) => String(s).toLocaleLowerCase(locale()).replace(/[*_`#>|\\]/g, " ").replace(/\s+/g, " ").trim();
// Section kind ids, stored in the coverage data files; the UI and kindName() map them to labels.
export const KIND = { paragraph: "paragraph", item: "item", row: "row", heading: "heading", image: "image", warning: "warning" };
// Older data files used Turkish kind ids; they are migrated on load.
const OLD_KIND = { paragraf: "paragraph", madde: "item", "sat\u0131r": "row", "ba\u015fl\u0131k": "heading", "g\u00f6rsel": "image", "uyar\u0131": "warning" };
export const kindName = (k) => ({ [KIND.paragraph]: t("paragraph"), [KIND.item]: t("item"), [KIND.row]: t("row"), [KIND.heading]: t("heading"), [KIND.image]: t("image"), [KIND.warning]: t("warning") })[k] ?? k;

export function load(team) {
  let cov; try { cov = JSON.parse(fs.readFileSync(file(team), "utf8")); } catch { return { docs: {}, next: 1 }; }
  for (const d of Object.values(cov.docs || {})) for (const s of d.segments || []) if (s.kind in OLD_KIND) s.kind = OLD_KIND[s.kind];
  return cov;
}
function save(team, cov) {
  mkdirPrivate(DIR);
  cov.updatedAt = Date.now();
  const tmp = file(team) + ".tmp"; writePrivate(tmp, JSON.stringify(cov)); fs.renameSync(tmp, file(team));
}

// ---- segmentation (markdown / plain text)
// Sentence patterns that look like a requirement (obligation, prohibition, capability, passive rule, numeric limit), in
// Turkish and English. Both keeps the agent from saying "contains none" and tells whether a heading/table row is a requirement.
export const REQ_LIKE = /\p{L}(?:mal[ıi]|meli|mamal[ıi]|memeli)(?:d[ıi]r)?(?!\p{L})|zorunlu|gerek(?:ir|li|mekte|iyor)|edilecek|yap[ıi]lacak|olacakt[ıi]r|\p{L}+(?:a|e)bil(?:ir|melidir|mez|ecek)(?!\p{L})|\p{L}+m(?:a|e)z(?:d[ıi]r)?(?!\p{L})|\p{L}+[ıiuü]l[ıiuü]r(?!\p{L})|\p{L}+[ıiuü]n[ıiuü]r(?!\p{L})|verilmez|istenir|reddedil|iptal edil|kontrol edil|\b(?:en az|en fazla|azami|asgari|yalnızca|sadece|otomatik)\b|\d+\s*(?:%|gün|saat|dakika|adet|kalem|karakter|hane|days?|hours?|minutes?|items?|characters?|digits?)|%\s*\d+|\b(?:must|shall|required|should|mandatory|cannot|may not|must not|only|at least|at most|maximum|minimum|automatically|is rejected|is cancelled|is canceled|is validated|is checked)\b/iu;
// Structure labels such as "2.3 Stock Movements" / "2. Screens" are headings; numbered lines containing a rule sentence count as items
const isHeadingLike = (l) => l.length < 90 && !/[.:;!?]$/.test(l) && !REQ_LIKE.test(l) && (/^\d+(\.\d+)+\.?\s+\S/.test(l) || (/^\d+[.)]\s+\S/.test(l) && l.split(/\s+/).length <= 5));
const NUMBERED_RE = /^\d+(\.\d+)*[.)]?\s+\S/;
const LIST_RE = /^\s*(?:[-*+•▪◦]|\d+[.)]|[a-zA-ZçğıöşüÇĞİÖŞÜ][.)])\s+/;
const DONE_RE = /(?:tamamland[ıi]|tamamlanm[ıi]şt[ıi]r|yap[ıi]ld[ıi]|yap[ıi]lm[ıi]şt[ıi]r|bitti|bitirildi|geliştirildi|uyguland[ıi]|mevcut(?:tur)?|hazır|canl[ıi]da|\bdone\b|\bcompleted\b|\bimplemented\b|\bfinished\b|\bdeployed\b|\bin production\b|\bready\b|[✓✔☑]|%\s*100\b|\b100\s*%)/iu;
export const doneHint = (t) => DONE_RE.test(String(t || ""));
export function segment(text) {
  const lines = String(text || "").replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const segs = []; const heads = [];
  let para = null, table = null, shortRun = [], imgN = 0;
  const headPath = () => heads.filter(Boolean).join(" › ");
  const pushShort = () => { if (shortRun.length) { const txt = shortRun.join("; "); shortRun = []; segs.push({ kind: KIND.item, h: headPath(), text: txt }); } };
  const push = (kind, txt) => {
    txt = txt.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
    if (/^\[(?:görsel|image)\]$/i.test(txt) || /^!\[/.test(txt)) { pushShort(); segs.push({ kind: KIND.image, h: headPath(), text: t("[Image {n}] An image in the document (screen mock-up, flow chart, etc.). Its text cannot be extracted; see the original document.", { n: ++imgN }) }); return; }
    const alnum = txt.replace(/[^\p{L}\p{N}]/gu, "").length;
    if (alnum < 2) return;
    if (alnum < 8 || (kind === KIND.item && txt.split(/\s+/).length <= 2)) { if (kind !== KIND.heading) { shortRun.push(txt); if (shortRun.length >= 8) pushShort(); } return; } // short items are merged into one section
    pushShort();
    // split a very long paragraph (common in PDFs) at a sentence boundary
    while (txt.length > 900) {
      let cut = txt.lastIndexOf(". ", 700); if (cut < 300) cut = 700;
      segs.push({ kind, h: headPath(), text: txt.slice(0, cut + 1).trim() }); txt = txt.slice(cut + 1).trim();
    }
    if (txt) segs.push({ kind, h: headPath(), text: txt });
  };
  const flushPara = () => { if (para) push(para.kind, para.text); para = null; };
  const flushTable = () => { table = null; };
  // Heading: if it is only a structure label (short, no rule) it does not become a section; long or rule-like headings do
  const headingSeg = (t) => { const c = t.replace(/[#*]/g, "").trim(); if (REQ_LIKE.test(c) || c.split(/\s+/).length > 7 || /[.!?;]$/.test(c)) push(KIND.heading, c); };
  // Table header: if one of the cells contains a sentence/rule or a status mark it is actually a data row
  const headerLooksLikeData = (cells) => cells.some((c) => doneHint(c) || c.split(/\s+/).length > 6 || (REQ_LIKE.test(c) && c.split(/\s+/).length > 3));
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { flushPara(); flushTable(); continue; }
    const hm = /^(#{1,6})\s+(.*)$/.exec(l);
    if (hm) { flushPara(); flushTable(); const lv = hm[1].length; heads.length = lv; heads[lv - 1] = hm[2].replace(/\*+/g, "").trim().slice(0, 80); headingSeg(hm[2]); continue; }
    if (l.startsWith("|")) {
      flushPara();
      const cells = l.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || !c)) continue; // separator row
      if (!table) {
        if (headerLooksLikeData(cells)) { table = { head: cells.map((c, i) => t("Column {n}", { n: i + 1 })) }; push(KIND.row, cells.filter(Boolean).join(" · ")); continue; } // header-less table: the first row is data too
        table = { head: cells }; continue;
      }
      const txt = cells.map((c, i) => (c ? (table.head[i] ? `${table.head[i]}: ${c}` : c) : "")).filter(Boolean).join(" · ");
      push(KIND.row, txt); continue;
    }
    flushTable();
    if (/^(?:\[(?:görsel|image)\]|!\[[^\]]*\]\([^)]*\))$/i.test(l)) { flushPara(); push(KIND.image, "[image]"); continue; }
    if (isHeadingLike(l)) { flushPara(); const lv = l.split(" ")[0].split(".").filter(Boolean).length; heads.length = Math.min(lv + 1, 6); heads[Math.min(lv, 5)] = l.slice(0, 80); headingSeg(l); continue; }
    if (LIST_RE.test(l)) { flushPara(); para = { kind: KIND.item, text: l.replace(LIST_RE, "") }; continue; }
    if (NUMBERED_RE.test(l)) { flushPara(); para = { kind: KIND.item, text: l }; continue; } // numbered requirement line such as "1.2.3 Transfer ... is cancelled"
    if (para) para.text += " " + l; else para = { kind: KIND.paragraph, text: l };
  }
  flushPara(); pushShort();
  if (segs.length > MAX_SEG) { const extra = segs.length - MAX_SEG; segs.length = MAX_SEG; segs.push({ kind: KIND.warning, h: "", text: t("⚠ DOCUMENT TRUNCATED: {extra} more sections, but the limit ({max}) was exceeded. Split the document into parts and link them as separate documents.", { extra, max: MAX_SEG }) }); }
  return segs;
}

const words = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 2));
function similar(a, b) {
  const A = words(a), B = words(b); if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}

// ---- sync: docs = [{ id, name, text }] (documents linked to the project whose text can be read)
// Returns: { changedDocs, changedSegs:[id], removedSegs:[id], addedSegs:[id] }
export function sync(team, docs, unreadable = []) {
  const cov = load(team); cov.docs ||= {}; cov.next ||= 1;
  const out = { changedDocs: [], changedSegs: [], removedSegs: [], addedSegs: [] };
  const present = new Set(docs.map((d) => d.id));
  let dirty = false;
  for (const [id, d] of Object.entries(cov.docs)) {
    const det = !present.has(id);
    if (!!d.detached !== det) { d.detached = det; dirty = true; }
  }
  for (const d of docs) {
    const sig = sha(d.text);
    let cd = cov.docs[d.id];
    if (cd && cd.sig === sig && !cd.detached) { if (cd.name !== d.name) { cd.name = d.name; dirty = true; } continue; }
    const segs = segment(d.text).map((s) => ({ ...s, hash: sha(norm(s.text)) }));
    if (!cd) {
      cd = cov.docs[d.id] = { prefix: `D${cov.next++}`, name: d.name, sig, n: 0, segments: [], removed: [], at: Date.now() };
      for (const s of segs) cd.segments.push({ id: `${cd.prefix}-${String(++cd.n).padStart(3, "0")}`, ...s });
      dirty = true; continue;
    }
    // new version: match the old sections with the new ones
    const old = cd.segments; const used = new Set(); const next = [];
    const byHash = new Map(); old.forEach((o, i) => { if (!byHash.has(o.hash)) byHash.set(o.hash, []); byHash.get(o.hash).push(i); });
    const pending = [];
    segs.forEach((s, j) => {
      const cands = (byHash.get(s.hash) || []).filter((i) => !used.has(i));
      const cand = cands.find((i) => old[i].h === s.h) ?? cands[0]; // the same text may sit under two headings: prefer the same heading
      if (cand !== undefined) { used.add(cand); next[j] = { ...old[cand], kind: s.kind, h: s.h, text: s.text }; }
      else pending.push(j);
    });
    for (const j of pending) {
      const s = segs[j]; let best = -1, bs = 0;
      old.forEach((o, i) => { if (used.has(i)) return; const sc = similar(o.text, s.text) + (o.h === s.h ? 0.1 : 0); if (sc > bs) { bs = sc; best = i; } });
      if (best >= 0 && bs >= 0.5) {
        used.add(best);
        const o = old[best];
        next[j] = { ...o, kind: s.kind, h: s.h, text: s.text, hash: s.hash, prev: o.text, changed: Date.now() };
        delete next[j].ack; // every new change must be "seen" again
        if (next[j].ignore) next[j].ignore = { ...next[j].ignore, stale: true }; // the "contains none" mark asks for re-approval for the new text
        out.changedSegs.push(o.id);
      } else {
        next[j] = { id: `${cd.prefix}-${String(++cd.n).padStart(3, "0")}`, ...s, added: Date.now() };
        out.addedSegs.push(next[j].id);
      }
    }
    old.forEach((o, i) => { if (!used.has(i)) { cd.removed.push({ id: o.id, h: o.h, text: o.text, at: Date.now() }); out.removedSegs.push(o.id); } });
    cd.removed = cd.removed.slice(-500);
    cd.segments = next; cd.sig = sig; cd.name = d.name; cd.at = Date.now(); cd.detached = false;
    if (out.changedSegs.length || out.removedSegs.length || out.addedSegs.length) out.changedDocs.push(d.name);
    dirty = true;
  }
  const unr = unreadable.map((u) => u.name).sort().join("|");
  if ((cov.unreadable || []).join("|") !== unr) { cov.unreadable = unreadable.map((u) => u.name).sort(); dirty = true; }
  if (dirty) save(team, cov);
  return out;
}

// ---- helpers
const activeDocs = (cov) => Object.entries(cov.docs || {}).filter(([, d]) => !d.detached).map(([id, d]) => ({ id, ...d }));
export function allSegments(cov) { return activeDocs(cov).flatMap((d) => d.segments.map((s) => ({ ...s, doc: d.name, docId: d.id }))); }
export function segIndex(cov) { const m = new Map(); for (const s of allSegments(cov)) m.set(s.id, s); return m; }

// "D1-004, D1-010..D1-020, D1-030..035" → codes
export function expandIds(list, cov) {
  const idx = segIndex(cov); const out = []; const bad = [];
  for (const raw of (Array.isArray(list) ? list : String(list || "").split(/[,\s]+/)).map((x) => String(x).trim().toUpperCase()).filter(Boolean)) {
    const r = /^(D\d+)-(\d+)\s*(?:\.\.|–|—|-)\s*(?:(D\d+)-)?(\d+)$/.exec(raw);
    if (r && (!r[3] || r[3] === r[1])) {
      const a = +r[2], b = +r[4]; if (b < a || b - a > 2000) { bad.push(raw); continue; }
      let any = false;
      for (let n = a; n <= b; n++) { const id = `${r[1]}-${String(n).padStart(3, "0")}`; if (idx.has(id)) { out.push(id); any = true; } }
      if (!any) bad.push(raw);
      continue;
    }
    const m = /^(D\d+)-(\d+)$/.exec(raw);
    const id = m ? `${m[1]}-${String(+m[2]).padStart(3, "0")}` : raw;
    if (idx.has(id)) out.push(id); else bad.push(raw);
  }
  return { ids: [...new Set(out)], bad };
}

// Section state: linked (to a requirement) | ignored (contains no requirement) | open
export function compute(team, items) {
  const cov = load(team);
  const links = new Map();
  // links of (approved) out-of-scope items do not count: linking a rule to an out-of-scope item must not turn coverage green
  for (const it of items) { if (it.status === "dropped" && !it.dropPending) continue; for (const s of it.segs || []) { if (!links.has(s)) links.set(s, []); links.get(s).push(it.code); } }
  const segs = allSegments(cov).map((s) => ({ ...s, items: links.get(s.id) || [], state: links.has(s.id) ? "linked" : s.ignore ? "ignored" : "open", pending: !!(s.ignore && (s.ignore.agent || s.ignore.stale)) && !links.has(s.id) }));
  const removed = activeDocs(cov).flatMap((d) => (d.removed || []).filter((r) => !r.ack).map((r) => ({ ...r, doc: d.name, items: links.get(r.id) || [] })));
  const st = { total: segs.length, linked: 0, ignored: 0, open: 0, changed: 0, removed: removed.length, byAgent: 0, images: 0, truncated: false };
  for (const s of segs) { st[s.state]++; if (s.changed && !s.ack) st.changed++; if (s.pending) st.byAgent++; if (s.kind === KIND.image && s.state === "open") st.images++; if (s.kind === KIND.warning) st.truncated = true; }
  // the percentage counts only definite coverage: linked + user-approved "contains none"; unapproved agent marks do not count
  st.pct = st.total ? Math.round(((st.linked + (st.ignored - st.byAgent)) / st.total) * 100) : null;
  st.open_or_pending = st.open + st.byAgent;
  st.unreadable = (cov.unreadable || []).length;
  return { stats: st, segments: segs, removed, docs: activeDocs(cov).map((d) => ({ id: d.id, prefix: d.prefix, name: d.name, count: d.segments.length, at: d.at })), unreadable: cov.unreadable || [] };
}

// If one of the linked sections mentions "done/completed/✓" the document is taken to claim it (even if the analyst did not write it)
export function claimHintFor(cov, segIds) { const idx = segIndex(cov); return (segIds || []).some((id) => doneHint(idx.get(id)?.text)); }
// Analyst: "contains no requirement" (with a reason) or remove the mark
export function mark(team, ids, { reason, by, clear = false, agent = false }) {
  const cov = load(team);
  const { ids: list, bad } = expandIds(ids, cov);
  if (agent && !clear) { // agent: cannot mark sections that look like a requirement as "contains none"
    const idx = segIndex(cov);
    const risky = list.filter((id) => { const g = idx.get(id); return g && (g.kind === KIND.image || g.kind === KIND.warning || REQ_LIKE.test(g.text || "") || doneHint(g.text)); });
    if (risky.length) return { error: t("These sections look like requirements (they contain an obligation/rule/screen/field expression); they cannot be marked 'contains none': {list}. Link them to an item or add a new item. If they really are not requirements, ask the user; the user can mark them by hand on the Scope screen.", { list: risky.join(", ") }) };
  }
  if (!list.length) return { error: t("Section not found: {list}. You can see the codes with document_sections.", { list: bad.join(", ") || t("(empty)") }) };
  reason = String(reason || "").trim().slice(0, 300);
  if (!clear && reason.length < 4) return { error: t("Write a reason (e.g. 'Introduction/definition text', 'Revision table', 'Signature page').") };
  const want = new Set(list); let n = 0;
  for (const d of Object.values(cov.docs)) for (const s of d.segments) if (want.has(s.id)) {
    if (clear) delete s.ignore; else s.ignore = { reason, by, at: Date.now(), ...(agent ? { agent: true } : {}) };
    n++;
  }
  save(team, cov);
  return { ok: true, count: n, bad };
}
// close a changed/removed section as "seen"
export function ack(team, ids) {
  const cov = load(team); const want = new Set((ids || []).map(String)); let n = 0;
  for (const d of Object.values(cov.docs)) {
    for (const s of d.segments) if (want.has(s.id) && s.changed && !s.ack) { s.ack = Date.now(); n++; }
    for (const r of d.removed || []) if (want.has(r.id) && !r.ack) { r.ack = Date.now(); n++; }
  }
  if (n) save(team, cov);
  return { ok: true, count: n };
}
// Changed sections linked to a code list become "seen" by themselves once the analyst updates the item
export function ackLinked(team, segIds) { if (segIds?.length) ack(team, segIds); }

const short = (t, n = 220) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
// Filter ids: the English ids are canonical; the older internal ids are still accepted.
const FILTERS = { bagsiz: "open", degisen: "changed", isaretli: "marked", onay: "pending", silinen: "removed", hepsi: "all" };
// Text list for agents
export function listText(team, items, { filter = "open", doc, from = 0, limit = 150 } = {}) {
  filter = FILTERS[filter] || filter;
  const c = compute(team, items);
  if (!c.docs.length) return c.unreadable.length ? t("The text of the linked documents could not be read: {list}. (For PDF install the Document reading tool.)", { list: c.unreadable.join(", ") }) : t("No document with readable text is linked to the project. Link the document to this project from the Documents screen.");
  let segs = c.segments;
  if (doc) segs = segs.filter((s) => s.doc.toLowerCase().includes(String(doc).toLowerCase()) || s.id.startsWith(String(doc).toUpperCase() + "-"));
  if (filter === "open") segs = segs.filter((s) => s.state === "open");
  else if (filter === "changed") segs = segs.filter((s) => s.changed && !s.ack);
  else if (filter === "marked") segs = segs.filter((s) => s.state === "ignored");
  else if (filter === "pending") segs = segs.filter((s) => s.pending);
  const head = t("Coverage: {linked} linked, {ignored} \"contains no requirement\", {open} OPEN ({total} {total|section|sections} in total, {pct}%).", { linked: c.stats.linked, ignored: c.stats.ignored, open: c.stats.open, total: c.stats.total, pct: c.stats.pct ?? 0 }) +
    (c.stats.changed ? ` ${t("Changed in the new version: {n}.", { n: c.stats.changed })}` : "") + (c.stats.removed ? ` ${t("Removed: {n}.", { n: c.stats.removed })}` : "") +
    `\n${t("Documents: {list}", { list: c.docs.map((d) => t("{prefix} = {name} ({n} {n|section|sections})", { prefix: d.prefix, name: d.name, n: d.count })).join("; ") })}`;
  let body = "";
  if (filter === "removed") body = c.removed.map((r) => `${r.id} [${t("REMOVED")}] (${r.h || "—"}) ${short(r.text)}${r.items.length ? ` — ${t("linked: {list}", { list: r.items.join(", ") })}` : ""}`).join("\n");
  else {
    const page = segs.slice(from, from + limit);
    body = page.map((s) => `${s.id} [${kindName(s.kind)}${s.changed && !s.ack ? `, ${t("CHANGED")}` : ""}${s.state === "ignored" ? `, ${t("contains no requirement: {reason}", { reason: s.ignore.reason })}${s.pending ? ` ${t("(awaiting approval)")}` : ""}` : ""}${s.items.length ? `, ${t("linked: {list}", { list: s.items.join(" ") })}` : ""}${doneHint(s.text) ? `, ${t("THE DOCUMENT SAYS 'DONE'")}` : ""}] (${s.h || "—"}) ${s.text}` +
      (s.changed && !s.ack && s.prev ? `\n    ${t("PREVIOUS: {text}", { text: short(s.prev, 300) })}` : "")).join("\n");
    if (segs.length > from + limit) body += `\n${t("… {n} more sections (continue with start={next}).", { n: segs.length - from - limit, next: from + limit })}`;
  }
  return head + "\n\n" + (body || (filter === "open" ? t("No open sections — the whole document is covered.") : t("No records.")));
}

// User: approve the agent's "contains none" marks (no longer an agent decision but a human one)
export function confirm(team, ids) {
  const cov = load(team); const want = ids?.length ? new Set(ids) : null; let n = 0;
  for (const d of Object.values(cov.docs)) for (const s of d.segments) if ((s.ignore?.agent || s.ignore?.stale) && (!want || want.has(s.id))) { delete s.ignore.agent; delete s.ignore.stale; s.ignore.confirmedAt = Date.now(); n++; }
  if (n) save(team, cov);
  return { ok: true, count: n };
}
