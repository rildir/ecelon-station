// Scope: requirements extracted from the analysis document and their statuses (per project).
// The list is filled by the analyst via MCP tools; agents and the user update the statuses.
import { t, locale } from "./i18n.js";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const RSTATUS = {
  todo: { label: t("Not done"), cls: "rs-todo" },
  doing: { label: t("In progress"), cls: "rs-doing" },
  done: { label: t("Complete"), cls: "rs-done" },
  unclear: { label: t("Unclear"), cls: "rs-unclear" },
  dropped: { label: t("Out of scope"), cls: "rs-dropped" },
};

export const CLAIM = { done: t("Says done"), partial: t("Says partly done"), todo: t("Says not done") };
export const VERIFY = {
  none: { label: t("Not verified"), cls: "vf-none" }, verified: { label: t("Verified"), cls: "vf-ok" },
  failed: { label: t("Verification failed"), cls: "vf-bad" }, stale: { label: t("Needs re-verification"), cls: "vf-stale" },
};

const KIND_LABEL = { paragraph: t("paragraph"), item: t("item"), row: t("row"), heading: t("heading"), image: t("image"), warning: t("warning") };
const isDropped = (it) => it.status === "dropped" && !it.dropPending;
export function createReqs(ctx) {
  // ctx: { api, toast, confirmBox, project(agent) → {team, name, lead, analyst}, send(agent, text), openLibrary(agentId), linkedCount(agent), statusOf(id), onOpen, onClose }
  const root = $("#reqs");
  let proj = null, data = { items: [] }, filter = "all", q = "", menuEl = null;
  let view = "items", cov = null, cfilter = "open", climit = 300, focusSeg = null;

  async function open(agent) {
    proj = ctx.project(agent);
    root.hidden = false; ctx.onOpen?.();
    await load();
    setTimeout(() => $("#rq-q").focus({ preventScroll: true }), 30);
  }
  function close() { closeMenu(); root.hidden = true; proj = null; ctx.onClose?.(); }
  async function load() {
    if (!proj) return;
    const team = encodeURIComponent(proj.team);
    [data, cov] = await Promise.all([ctx.api(`/api/reqs/${team}`).catch(() => ({ items: [] })), ctx.api(`/api/reqs/${team}/coverage`).catch(() => null)]);
    render();
  }

  const counts = () => {
    const c = { all: data.items.length, changed: 0, mismatch: 0, verified: 0, unverified: 0, nocrit: 0, review: 0 };
    for (const k of Object.keys(RSTATUS)) c[k] = 0;
    c.droppending = 0; c.stale = 0;
    for (const it of data.items) {
      c[it.status]++; if (it.changed || it.docChange) c.changed++; if (it.mismatch) c.mismatch++;
      if (it.dropPending) c.droppending++; if (it.verify?.state === "stale") c.stale++;
      if (!isDropped(it) && !it.criteria?.length) c.nocrit++; if (it.origin === "review") c.review++;
      if (it.verify?.state === "verified") c.verified++; else if (!isDropped(it)) c.unverified++;
    }
    return c;
  };
  function visible() {
    const s = q.toLocaleLowerCase(locale());
    return data.items.filter((it) => (filter === "all" || (filter === "changed" ? it.changed || it.docChange : filter === "nocrit" ? !isDropped(it) && !it.criteria?.length : filter === "review" ? it.origin === "review" : filter === "droppending" ? !!it.dropPending : filter === "stale" ? it.verify?.state === "stale" : filter.startsWith("seg:") ? (it.segs || []).includes(filter.slice(4)) : filter === "mismatch" ? it.mismatch : filter === "unverified" ? it.verify?.state !== "verified" && !isDropped(it) : it.status === filter)) &&
      (!s || `${it.code} ${it.title} ${it.detail} ${it.section} ${it.evidence} ${it.note}`.toLocaleLowerCase(locale()).includes(s)));
  }
  function render() {
    if (!proj) return;
    const c = counts(); const active = data.items.filter((x) => !isDropped(x)).length;
    const pct = active ? Math.round((c.verified / active) * 100) : 0;
    $("#rq-title").textContent = proj.name;
    const cs = cov?.stats;
    $("#rq-sum").textContent = (data.items.length ? `${t("{verified} / {active} verified · {pct}%", { verified: c.verified, active, pct })}${c.mismatch ? ` · ${t("{n} {n|mismatch|mismatches}", { n: c.mismatch })}` : ""}` : t("No requirements yet")) + (cs?.total ? ` · ${t("document coverage {pct}%", { pct: cs.pct })}` : "");
    $("#rq-tabs").innerHTML = `<button type="button" role="tab" data-view="items" aria-selected="${view === "items"}">${t("Requirements")} <span>${data.items.length}</span></button>` +
      `<button type="button" role="tab" data-view="cov" aria-selected="${view === "cov"}">${t("Document coverage")} <span class="${cs?.open ? "bad" : cs?.total ? "ok" : ""}">${cs?.total ? (cs.open ? t("{n} unmatched", { n: cs.open }) : t("{n}%", { n: 100 })) : "—"}</span></button>`;
    if (view === "cov") return renderCov();
    const unread = cov?.unreadable?.length ? cov.unreadable : [];
    const a2 = cs?.open || cs?.changed || cs?.byAgent || unread.length || c.droppending;
    $("#rq-alert2").hidden = !a2;
    $("#rq-alert2").innerHTML = a2 ? `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1z"/><path d="M8 6v3.5M8 11.6v.2"/></svg><span>` +
      [unread.length ? t("<b>{docs} could not be split into sections</b> (the text cannot be read; for PDF install the 'Document reading' tool from Documents). Items in this document do not go through the coverage check.", { docs: unread.map(esc).join(", ") }) : "",
       cs?.open ? t("<b>{n} {n|section|sections} of the document {n|is|are} not linked to any requirement.</b>", { n: cs.open }) : "", cs?.byAgent ? t("{n} 'contains none' {n|mark is|marks are} awaiting your approval.", { n: cs.byAgent }) : "",
       cs?.changed ? t("{n} {n|section|sections} changed in the new version of the document.", { n: cs.changed }) : "", c.droppending ? t("An agent marked {n} {n|item|items} out of scope; your approval is needed.", { n: c.droppending }) : ""].filter(Boolean).join(" ") +
      `</span>${cs?.open || cs?.changed || cs?.byAgent ? `<button type="button" class="linkish" data-cf="${cs.open ? "open" : cs.byAgent ? "byagent" : "changed"}">${t("Show in document coverage")}</button>` : c.droppending ? `<button type="button" class="linkish" data-f="droppending">${t("Show")}</button>` : ""}` : "";
    $("#rq-alert").hidden = !c.mismatch;
    $("#rq-alert").innerHTML = c.mismatch ? `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1z"/><path d="M8 6v3.5M8 11.6v.2"/></svg>
      <span>${t("<b>{n} {n|item|items}: the document says 'done' but {n|it is|they are} not verified.</b> They may be missing from the code or half done.", { n: c.mismatch })}</span>
      <button type="button" class="btn sm" data-act="verify-mismatch">${t("Have the tester verify")}</button><button type="button" class="linkish" data-f="mismatch">${t("Show")}</button>` : "";
    $("#rq-bar").innerHTML = data.items.length ? Object.entries(RSTATUS).filter(([k]) => c[k]).map(([k, v]) => `<i class="${v.cls}" style="flex:${c[k]}" title="${v.label}: ${c[k]}"></i>`).join("") : "";
    const busy = [["analyst", t("Analyst")], ["tester", t("Tester")], ["reviewer", t("Reviewer")]].filter(([k]) => proj[k] && ["thinking", "tool"].includes(ctx.statusOf(proj[k].id)));
    $("#rq-analyst").innerHTML = busy.length ? `<i class="dot st-tool"></i>${t("{who} working…", { who: busy.map(([, l]) => l).join(", ") })}` : "";
    if (filter.startsWith("seg:")) c[filter] = visible().length;
    $("#rq-chips").innerHTML = [["all", t("All")], ["mismatch", t("⚠ Mismatch")], ["unverified", t("Unverified")], ...Object.entries(RSTATUS).map(([k, v]) => [k, v.label]), ["changed", t("Changed in document")], ["stale", t("Needs re-verification")], ["nocrit", t("No acceptance criteria")], ["review", t("From second review")], ["droppending", t("Out of scope · awaiting approval")], ...(filter.startsWith("seg:") ? [[filter, t("Section {id}", { id: filter.slice(4) })]] : [])]
      .filter(([k]) => k === "all" || c[k]).map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${filter === k}">${esc(l)} <span>${c[k]}</span></button>`).join("");
    const list = visible(); const box = $("#rq-list");
    if (!data.items.length) {
      const linked = ctx.linkedCount(proj.lead);
      box.innerHTML = `<div class="lib-empty"><div class="le-art"><svg viewBox="0 0 16 16"><path d="M3 4.5h10M3 8h10M3 11.5h6"/><path d="M11.5 11l1.2 1.2L15 10"/></svg></div><b>${t("Scope list is empty")}</b>
        <p>${linked ? t("{n} {n|document is|documents are} linked to the project. Press <b>Extract from document</b>; the analyst will turn the document into requirements item by item.", { n: linked }) : t("First link the analysis document to this project from the document library, then press <b>Extract from document</b>.")}</p>
        ${linked ? "" : `<button type="button" class="btn ghost sm" data-act="lib">${t("Open document library")}</button>`}</div>`;
      return;
    }
    if (!list.length) { box.innerHTML = `<div class="lib-empty"><b>${t("No items in this filter")}</b></div>`; return; }
    const groups = new Map(); for (const it of list) { const k = it.section || t("General"); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    box.innerHTML = [...groups].map(([sec, items]) => {
      const done = items.filter((x) => x.status === "done").length;
      return `<section class="rq-sec"><h4>${esc(sec)} <span>${done}/${items.length}</span></h4>
        ${items.map((it) => { const vf = VERIFY[it.verify?.state || "none"]; return `<div class="rq-row${it.changed ? " changed" : ""}${it.mismatch ? " mismatch" : ""}" data-code="${esc(it.code)}">
          <span class="rq-code">${esc(it.code)}</span>
          <div class="rq-main"><b>${esc(it.title)}</b>${it.detail ? `<p>${esc(it.detail)}</p>` : ""}
            <div class="rq-tags">
              ${it.claim ? `<span class="rq-claim cl-${it.claim}" title="${esc(it.claimText || t("The document's claim"))}">${t("Document: {claim}", { claim: esc(CLAIM[it.claim]) })}</span>` : it.claimHint ? `<span class="rq-claim cl-done" title="${t("The linked document section mentions 'done / completed / ✓'")}">${t("Document: mentions ✓")}</span>` : ""}
              ${it.dropPending ? `<span class="rq-mm rq-dp" title="${t("{who} marked it out of scope; the item counts as open until you approve", { who: esc(it.dropPending.by || t("Agent")) })}">${t("Out of scope · awaiting approval")}</span>` : ""}
              <span class="rq-vf ${vf.cls}" title="${esc(it.verify?.how ? `${it.verify.by || ""}: ${it.verify.how}` : vf.label)}">${vf.label}${it.verify?.by && it.verify.state !== "none" ? ` · ${esc(it.verify.by)}` : ""}</span>
              ${it.mismatch ? `<span class="rq-mm">${t("⚠ Mismatch")}</span>` : ""}
              ${it.origin === "review" ? `<span class="rq-rev" title="${t("The reviewer found it in the document; the analyst should confirm")}">${t("Second review")}</span>` : ""}
              ${it.status !== "dropped" && !it.criteria?.length ? `<span class="rq-nocrit" title="${t("The tester learns what to try from the acceptance criteria")}">${t("No acceptance criteria")}</span>` : ""}
            </div>
            ${it.docChange ? `<p class="rq-docchg">${t("⚠ Changed in the new version of the document: {list}", { list: [...it.docChange.changed, ...it.docChange.removed.map((x) => t("{id} (removed)", { id: x }))].map(esc).join(", ") })} <button type="button" class="linkish" data-ackitem>${t("Got it")}</button></p>` : ""}
            ${it.criteria?.length ? `<ol class="rq-crit" title="${t("Click a criterion to mark it pass / fail by hand")}">${it.criteria.map((k, ki) => `<li data-ki="${ki}" class="kc-${k.state}" title="${esc(k.state === "pass" ? t("Passed") : k.state === "fail" ? t("Failed") : t("Not tried"))}${k.note ? ": " + esc(k.note) : ""}">${esc(k.text)}</li>`).join("")}</ol>` : ""}
            ${it.claimText ? `<p class="rq-quote">“${esc(it.claimText)}”</p>` : ""}
            ${it.verify?.how && it.verify.state !== "none" ? `<p class="rq-how">${esc(it.verify.how)}${it.verify.staleRefs ? ` <em>${t("Changed evidence: {refs}", { refs: esc(it.verify.staleRefs.join(", ")) })}</em>` : ""}</p>` : ""}
            <div class="rq-meta">${(it.segs || []).length ? `<span class="rq-segs" title="${t("Where it is in the document")}">${it.segs.slice(0, 8).map((x) => `<button type="button" class="seg-chip" data-seg="${esc(x)}">${esc(x)}</button>`).join("")}${it.segs.length > 8 ? `+${it.segs.length - 8}` : ""}</span>` : ""}${it.source ? `<span title="${t("Source")}">${esc(it.source)}</span>` : ""}${it.evidence ? `<code title="${t("Evidence")}">${esc(it.evidence)}</code>` : ""}${it.changed ? `<em class="rq-chg">${t("Changed in the document")}</em>` : ""}${it.updatedBy ? `<span class="rq-by">${esc(it.updatedBy)}</span>` : ""}</div>
            <div class="rq-note" data-note tabindex="0" title="${t("Click to add a note")}">${it.note ? esc(it.note) : `<span class="ph">${t("Add a note…")}</span>`}</div></div>
          <button type="button" class="rq-st ${RSTATUS[it.status]?.cls || ""}" data-st>${esc(RSTATUS[it.status]?.label || it.status)}<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg></button>
        </div>`; }).join("")}</section>`;
    }).join("");
  }

  // ---- events
  root.addEventListener("click", async (e) => {
    const tab = e.target.closest("[data-view]"); if (tab) { view = tab.dataset.view; render(); return; }
    const cf = e.target.closest("[data-cf]"); if (cf) { cfilter = cf.dataset.cf; climit = 300; view = "cov"; render(); return; }
    const sc = e.target.closest("[data-seg]"); if (sc) { focusSeg = sc.dataset.seg; cfilter = "all"; view = "cov"; render(); return; }
    const ic = e.target.closest("[data-item]"); if (ic) { filter = "all"; q = ic.dataset.item; $("#rq-q").value = q; view = "items"; render(); return; }
    const f = e.target.closest("#rq-chips [data-f], #rq-alert [data-f]"); if (f) { filter = f.dataset.f; render(); return; }
    if (e.target.closest("[data-ackitem]")) { const code = e.target.closest(".rq-row").dataset.code; return ctx.api(`/api/reqs/${encodeURIComponent(proj.team)}/coverage/ack`, { method: "POST", body: { items: [code] } }).catch((err) => ctx.toast(err.message, "bad")); }
    const sa = e.target.closest("[data-sact]"); if (sa) return segAction(sa.dataset.sact, sa.closest("[data-sid]")?.dataset.sid);
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") return close();
    if (act === "lib") { close(); return ctx.openLibrary(proj?.lead.id); }
    if (act === "extract") return askAnalyst("extract");
    if (act === "compare") return askAnalyst("compare");
    if (act === "add") return addItem();
    if (act === "review") return askReviewer();
    if (act === "cover") return askAnalyst("cover");
    if (act === "changes") return askAnalyst("changes");
    if (act === "more") { climit += 500; return render(); }
    if (act === "confirm-all") { try { await ctx.api(`/api/reqs/${encodeURIComponent(proj.team)}/coverage/confirm`, { method: "POST", body: {} }); } catch (err) { ctx.toast(err.message, "bad"); } return; }
    if (act === "verify" || act === "verify-mismatch") return askVerify(act === "verify-mismatch" ? data.items.filter((x) => x.mismatch) : data.items.filter((x) => x.status !== "dropped" && x.verify?.state !== "verified" && (x.status === "done" || x.status === "doing" || x.claim)));
    if (act === "export") return exportMd();
    const st = e.target.closest("[data-st]");
    if (st) { const code = st.closest(".rq-row").dataset.code; return statusMenu(st, code); }
    const note = e.target.closest("[data-note]"); if (note && !note.isContentEditable) editNote(note);
    const kc = e.target.closest(".rq-crit li[data-ki]");
    if (kc) { // by hand: not tried → passed → failed → not tried
      const code = kc.closest(".rq-row").dataset.code; const it = data.items.find((x) => x.code === code); const k = it.criteria[+kc.dataset.ki];
      const next = { none: "pass", pass: "fail", fail: "none" }[k.state || "none"];
      try { await ctx.api(`/api/reqs/${encodeURIComponent(proj.team)}/${encodeURIComponent(code)}/criteria`, { method: "POST", body: { index: +kc.dataset.ki, state: next } }); } catch (err) { ctx.toast(err.message, "bad"); }
    }
  });
  $("#rq-q").addEventListener("input", (e) => { q = e.target.value.trim(); render(); });
  document.addEventListener("keydown", (e) => {
    if (root.hidden || e.key !== "Escape" || e.defaultPrevented) return;
    if (menuEl) { e.preventDefault(); closeMenu(); return; }
    if (document.querySelector("dialog[open]") || e.target.isContentEditable) return;
    e.preventDefault(); close();
  });

  async function askAnalyst(kind) {
    if (!proj.analyst) return ctx.toast(t("This project has no analyst"), "bad");
    if (kind === "extract" && !ctx.linkedCount(proj.lead)) { ctx.toast(t("First link the analysis document to this project"), "bad"); close(); return ctx.openLibrary(proj.lead.id); }
    if (kind === "compare" && !data.items.length) return ctx.toast(t("First extract requirements from the document"), "bad");
    if (kind !== "compare" && kind !== "extract" && !cov?.stats?.total) return ctx.toast(t("No linked document with readable text"), "bad");
    const text = kind === "extract"
      ? t("Extract the requirement list from the analysis documents linked to the project and save it with the save_requirements tool (mode: merge). Read the document from start to end with document_sections (filter: all), with section codes; if it paginates, continue to the end.") + " " +
        t("Make each measurable requirement a separate item: give section, source, where it is in the document (sections: e.g. D1-014) and measurable acceptance_criteria (numbers, limits, required fields, error cases). If a list already exists, look at it first with list_requirements and update it keeping the existing codes.") + " " +
        t("Before finishing, check with document_sections 'open': no section should remain unmatched; mark those that contain no requirement (cover page, revision table, table of contents, definition text) with mark_sections, giving a reason. Finally write a coverage summary.")
      : kind === "cover"
      ? t("Complete the document coverage: get the sections not linked to any requirement with document_sections (filter: open). For each one: if it contains a requirement, link it to an existing item (save_requirements, code + sections) or add a new item (with acceptance_criteria); if it does not, mark it with mark_sections giving a reason (only those that are clearly not requirements, such as cover page, table of contents, revision table, definitions/introduction; sections containing a rule, an obligation, a screen, a field or a report cannot be marked, turn them into items). When in doubt, turn it into an item. Your marks go to the user for approval. Continue until no unmatched section remains and finally write a summary.")
      : kind === "changes"
      ? t("The document arrived in a new version. With document_sections, review first the 'changed' sections (with their previous text), then 'removed' and 'open'. Update every affected item with save_requirements (title, detail, acceptance_criteria, sections); set items based on removed sections to 'out_of_scope' or link them to the new section; add items for new sections. Write a summary of the changes: which item changed and why, which ones need re-verification.")
      : t("Compare the requirement list (list_requirements) with the current code. For each item update the status with set_requirement_status: 'done' if it is fully present in the code, 'doing' if partly, 'todo' if missing, 'unclear' if the document is not clear. Give file:line as evidence; add a short note. Finally write a summary.");
    await ctx.send(proj.analyst, text);
    ctx.toast({ extract: t("The analyst is reading {docs}; the list will fill in live here", { docs: cov?.docs?.length ? cov.docs.map((d) => d.name).join(", ") : t("the linked documents") }), cover: t("The analyst is completing the unmatched sections"), changes: t("The analyst is reviewing the document changes") }[kind] || t("The analyst is reviewing the code; statuses will update here"));
    render();
  }
  async function askVerify(items) {
    const tester = proj.tester;
    if (!tester) return ctx.toast(t("This project has no tester"), "bad");
    if (!items.length) return ctx.toast(t("No items to verify"));
    const codes = items.map((x) => x.code);
    const text = t("Verify these requirements: {codes}. For each one look at its details and acceptance criteria with requirement_detail, REALLY try the item and every acceptance criterion (run the relevant test; if there is none, walk through the scenario or write a short test) and record the result with evidence using verify_requirement (give the result of each criterion in the 'criteria' field).", { codes: codes.join(", ") }) + " " +
      t("Do not trust the document saying 'done'; if it is missing from the code or half done, say 'failed' and explain why. Finally write a short report listing the verified and failed ones.");
    await ctx.send(tester, text);
    ctx.toast(t("{n} {n|item|items} handed to the tester; results will update live here", { n: codes.length }));
  }
  async function askReviewer() {
    if (!proj.reviewer) return ctx.toast(t("This project has no reviewer"), "bad");
    if (!cov?.stats?.total) return ctx.toast(t("No linked document with readable text"), "bad");
    const text = t("Second-review check: read the analysis document linked to the project from start to end, INDEPENDENTLY of the requirement list (document_sections, filter: all; paginating to the end).") + " " +
      t("The goal is to find the requirements the analyst missed. Look for: rules/screens/reports/fields/permissions with no counterpart in the list; sections marked 'contains no requirement' that actually contain one; rules buried in individual table rows; footnotes and exceptions.") + " " +
      t("Report what you find with report_missing_requirements, with section codes. Also, if an existing item's acceptance criteria miss a number, limit or error case from the document, write it in your report with the item code. Finally write a short report.");
    await ctx.send(proj.reviewer, text);
    ctx.toast(t("The reviewer is reading the document independently; the gaps found will appear in the 'From second review' filter"));
  }
  // ---- document coverage view
  const CST = { open: t("Unmatched"), linked: t("Linked"), ignored: t("Contains no requirement") };
  function renderCov() {
    const box = $("#rq-list"), st = cov?.stats;
    $("#rq-alert").hidden = true; $("#rq-alert2").hidden = true;
    if (!cov || !st?.total) {
      $("#rq-bar").innerHTML = ""; $("#rq-chips").innerHTML = "";
      box.innerHTML = `<div class="lib-empty"><b>${t("No document to split into sections")}</b><p>${cov?.unreadable?.length ? t("The text of these documents could not be read: {docs}. For PDF, install the <b>Document reading</b> tool from the Documents screen.", { docs: cov.unreadable.map(esc).join(", ") }) : t("Link the analysis document to this project from the document library; the station splits the document into sections automatically.")}</p><button type="button" class="btn ghost sm" data-act="lib">${t("Open document library")}</button></div>`;
      return;
    }
    if (st.open) {
      $("#rq-alert").hidden = false;
      $("#rq-alert").innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1z"/><path d="M8 6v3.5M8 11.6v.2"/></svg><span>${t("<b>{n} {n|section|sections} of the document {n|is|are} not linked to any requirement.</b> They may have been overlooked.", { n: st.open })}</span>
        <button type="button" class="btn sm" data-act="cover">${t("Have the analyst complete")}</button><button type="button" class="linkish" data-cf="open">${t("Show")}</button>`;
    }
    if (st.changed || st.removed) {
      $("#rq-alert2").hidden = false;
      $("#rq-alert2").innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4"/><path d="M12.5 1.5V4H10M3.5 14.5V12H6"/></svg><span>${t("<b>The document changed in the new version:</b> {changed} changed, {removed} removed sections.", { changed: st.changed, removed: st.removed })}</span>
        <button type="button" class="btn sm" data-act="changes">${t("Have the analyst review")}</button><button type="button" class="linkish" data-cf="changed">${t("Show")}</button>`;
    }
    if (!st.open && (st.images || st.truncated)) {
      $("#rq-alert").hidden = false;
      $("#rq-alert").innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1z"/><path d="M8 6v3.5M8 11.6v.2"/></svg><span>${st.images ? `${t("<b>The document has {n} {n|image|images}/diagrams.</b> They cannot be read as text; check their content by hand and link them or mark them 'contains none'.", { n: st.images })} ` : ""}${st.truncated ? t("<b>The document is very long;</b> sectioning hit the limit, the end may not be covered.") : ""}</span>`;
    }
    if (st.byAgent) {
      $("#rq-alert2").hidden = false;
      $("#rq-alert2").innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1z"/><path d="M8 6v3.5M8 11.6v.2"/></svg><span>${t("<b>The 'contains no requirement' marks of {n} {n|section|sections} are awaiting approval</b> (the analyst suggested them or the text changed). Take a look; approve if correct, otherwise remove the mark. They do not count toward the coverage percentage until approved.", { n: st.byAgent })}</span>
        <button type="button" class="btn sm" data-act="confirm-all">${t("Approve all")}</button><button type="button" class="linkish" data-cf="byagent">${t("Show")}</button>`;
    }
    $("#rq-bar").innerHTML = [["linked", "rs-done"], ["ignored", "rs-dropped"], ["open", "rs-todo cov-open"]].filter(([k]) => st[k]).map(([k, cls]) => `<i class="${cls}" style="flex:${st[k]}" title="${CST[k]}: ${st[k]}"></i>`).join("");
    const cnt = { all: st.total, open: st.open, linked: st.linked, ignored: st.ignored, changed: st.changed, removed: st.removed, byagent: st.byAgent };
    $("#rq-chips").innerHTML = [["open", t("Unmatched")], ["linked", t("Linked")], ["ignored", t("Contains no requirement")], ["byagent", t("Awaiting approval")], ["changed", t("Changed")], ["removed", t("Removed")], ["all", t("All")]]
      .filter(([k]) => k === "all" || k === "open" || cnt[k]).map(([k, l]) => `<button type="button" data-cf="${k}" aria-pressed="${cfilter === k}">${l} <span>${cnt[k]}</span></button>`).join("");
    $("#rq-chips").insertAdjacentHTML("beforeend", `<details class="cv-help"><summary>${t("What is this screen?")}</summary><p>${t("The station splits the document linked to the project into <b>sections</b> by itself: every paragraph, list item and table row is a section. <b>D1-004</b> = section 4 of document 1 ({doc}). The goal is that no part of the document is overlooked: every section must either be <b>linked</b> to a requirement or be marked 'contains no requirement' with a reason. Those that are neither are <b>unmatched</b>.", { doc: esc(cov.docs[0]?.name || "") + (cov.docs.length > 1 ? " …" : "") })}</p></details>`);
    const s = q.toLocaleLowerCase(locale());
    if (cfilter === "removed") {
      box.innerHTML = `<section class="rq-sec"><h4>${t("Sections removed in the new version")}</h4>${cov.removed.map((r) => `<div class="cv-row removed" data-sid="${esc(r.id)}"><span class="rq-code">${esc(r.id)}</span><div class="cv-main"><small>${esc(r.doc)}${r.h ? " › " + esc(r.h) : ""}</small><p>${esc(r.text)}</p>${r.items.length ? `<div class="cv-items">${t("Was linked to:")} ${r.items.map((x) => `<button type="button" class="seg-chip" data-item="${esc(x)}">${esc(x)}</button>`).join("")}</div>` : ""}</div><div class="cv-act"><button type="button" class="btn ghost sm" data-sact="ack">${t("Got it")}</button></div></div>`).join("") || `<div class="lib-empty"><b>${t("No removed sections")}</b></div>`}</section>`;
      return;
    }
    let segs = cov.segments.filter((g) => (cfilter === "all" || (cfilter === "changed" ? g.changed && !g.ack : cfilter === "byagent" ? g.pending : g.state === cfilter)) && (!s || `${g.id} ${g.text} ${g.h}`.toLocaleLowerCase(locale()).includes(s)));
    const total = segs.length; segs = segs.slice(0, climit);
    if (!segs.length) { box.innerHTML = `<div class="lib-empty"><b>${cfilter === "open" ? t("No unmatched sections") : t("No sections in this filter")}</b>${cfilter === "open" ? `<p>${t("Every section of the document is either linked to a requirement or marked with a reason.")}</p>` : ""}</div>`; return; }
    const groups = new Map();
    for (const g of segs) { const k = `${g.doc}\u0000${g.h || ""}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
    box.innerHTML = [...groups].map(([k, list]) => { const [doc, h] = k.split("\u0000"); return `<section class="rq-sec"><h4>${esc(h || doc)} <small class="cv-doc">${h ? esc(doc) : ""}</small></h4>${list.map((g) => `
      <div class="cv-row st-${g.state}${g.changed && !g.ack ? " chg" : ""}${focusSeg === g.id ? " focus" : ""}" data-sid="${esc(g.id)}">
        <span class="rq-code">${esc(g.id)}</span>
        <div class="cv-main"><p>${esc(g.text)}</p>
          ${g.changed && !g.ack && g.prev ? `<p class="cv-prev"><b>${t("Previous:")}</b> ${esc(g.prev)}</p>` : ""}
          <div class="cv-items"><span class="cv-st cs-${g.state}">${CST[g.state]}</span><span class="cv-kind">${esc(KIND_LABEL[g.kind] || g.kind)}</span>
            ${g.items.map((x) => `<button type="button" class="seg-chip" data-item="${esc(x)}">${esc(x)}</button>`).join("")}
            ${g.state === "ignored" ? `<em>${esc(g.ignore.reason)}</em><span class="cv-by${g.pending ? " agent" : ""}">${g.pending ? (g.ignore.stale ? t("text changed · awaiting re-approval") : t("{who} suggested · awaiting approval", { who: esc(g.ignore.by || t("Agent")) })) : esc(g.ignore.by || "")}</span>` : ""}</div></div>
        <div class="cv-act">${g.changed && !g.ack ? `<button type="button" class="btn ghost sm" data-sact="ack">${t("Got it")}</button>` : ""}
          ${g.state === "open" ? `<button type="button" class="btn ghost sm" data-sact="ignore" title="${t("No requirement in this section (cover, definitions, revision…)")}">${t("Contains none")}</button><button type="button" class="btn ghost sm" data-sact="link" title="${t("Link to an item")}">${t("Link")}</button>` : ""}
          ${g.pending ? `<button type="button" class="btn ghost sm" data-sact="confirm">${t("Approve")}</button>` : ""}
          ${g.state === "ignored" ? `<button type="button" class="btn ghost sm" data-sact="unignore">${t("Remove mark")}</button>` : ""}
          ${g.state === "linked" ? `<button type="button" class="btn ghost sm" data-sact="link">${t("Link")}</button>` : ""}</div>
      </div>`).join("")}</section>`; }).join("") + (total > segs.length ? `<div class="cv-more"><button type="button" class="btn ghost sm" data-act="more">${t("Show {n} more sections", { n: total - segs.length })}</button></div>` : "");
    if (focusSeg) { const el = box.querySelector(`[data-sid="${CSS.escape(focusSeg)}"]`); el?.scrollIntoView({ block: "center" }); focusSeg = null; }
  }
  async function segAction(kind, id) {
    if (!id) return;
    const team = encodeURIComponent(proj.team);
    try {
      if (kind === "ack") await ctx.api(`/api/reqs/${team}/coverage/ack`, { method: "POST", body: { ids: [id] } });
      else if (kind === "confirm") await ctx.api(`/api/reqs/${team}/coverage/confirm`, { method: "POST", body: { ids: [id] } });
      else if (kind === "unignore") await ctx.api(`/api/reqs/${team}/coverage/mark`, { method: "POST", body: { ids: [id], clear: true } });
      else if (kind === "ignore") {
        const reason = await ctx.prompt(t("{id}: why does it contain no requirement?", { id }), t("e.g. Introduction text, revision table, signature page"), "", { ok: t("Save"), list: [t("Cover / title"), t("Introduction and definition text"), t("Revision table"), t("Table of contents"), t("Signature page"), t("Example / explanation")] });
        if (!reason) return;
        await ctx.api(`/api/reqs/${team}/coverage/mark`, { method: "POST", body: { ids: [id], reason } });
      } else if (kind === "link") {
        const code = (await ctx.prompt(t("Which item should {id} be linked to?", { id }), t("Type a code or title, pick from the list"), "", { ok: t("Link"), list: data.items.map((x) => `${x.code} · ${x.title}`) }))?.trim().split(/\s|·/)[0].toUpperCase();
        if (!code) return;
        if (!data.items.some((x) => x.code === code)) return ctx.toast(t("{code} not found", { code }), "bad");
        await ctx.api(`/api/reqs/${team}/${encodeURIComponent(code)}/segs`, { method: "POST", body: { ids: [id] } });
      }
    } catch (err) { ctx.toast(err.message, "bad"); }
  }
  async function addItem() {
    const title = await ctx.prompt(t("New requirement"), t("e.g. A stock count difference report must be available"), "", { ok: t("Add") });
    if (!title) return;
    try { await ctx.api(`/api/reqs/${encodeURIComponent(proj.team)}`, { method: "POST", body: { title, section: filter === "all" ? "" : "" } }); } catch (err) { ctx.toast(err.message, "bad"); }
  }
  function statusMenu(anchor, code) {
    closeMenu();
    const m = document.createElement("div"); m.className = "pop lib-menu"; m.setAttribute("role", "menu");
    m.innerHTML = `<p class="lm-title">${t("Work status")}</p>` + Object.entries(RSTATUS).filter(([k]) => k !== "done").map(([k, v]) => `<button type="button" data-s="${k}"><i class="rq-dot ${v.cls}"></i>${v.label}</button>`).join("") +
      `<p class="lm-title">${t("Acceptance criteria")}</p><button type="button" data-s="__crit">${t("Edit acceptance criteria…")}</button>` +
      `<p class="lm-title">${t("Verification")}</p><button type="button" data-s="__tester">${t("Have the tester verify")}</button><button type="button" data-s="__ok">${t("I verified by hand…")}</button><button type="button" data-s="__fail">${t("Verification failed…")}</button>` +
      `<p class="lm-title">${t("The document's claim")}</p>` + [["done", t("Says done")], ["partial", t("Says partly done")], ["todo", t("Says not done")], ["", t("Not stated")]].map(([k, l]) => `<button type="button" data-c="${k}">${l}</button>`).join("") +
      (data.items.find((x) => x.code === code)?.dropPending ? `<button type="button" data-s="dropped">${t("Approve out of scope")}</button>` : "") +
      `<button type="button" data-s="__del" class="danger">${t("Delete item")}</button>`;
    document.body.append(m); menuEl = m;
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.min(innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth) + "px";
    m.style.top = (r.bottom + m.offsetHeight + 8 > innerHeight ? r.top - m.offsetHeight - 6 : r.bottom + 6) + "px";
    m.onclick = async (e) => {
      const c = e.target.closest("[data-c]");
      if (c) { closeMenu(); try { await ctx.api(`/api/reqs/${encodeURIComponent(proj.team)}/${encodeURIComponent(code)}`, { method: "PATCH", body: { claim: c.dataset.c || null } }); } catch (err) { ctx.toast(err.message, "bad"); } return; }
      const b = e.target.closest("[data-s]"); if (!b) return; closeMenu();
      try {
        if (b.dataset.s === "__tester") return askVerify(data.items.filter((x) => x.code === code));
        if (b.dataset.s === "__crit") {
          const it = data.items.find((x) => x.code === code);
          const v = await ctx.prompt(t("{code}: acceptance criteria (separate each with ' ; ')", { code }), t("e.g. Transfer is rejected if stock is insufficient ; A rejected slip is closed with a reason"), (it.criteria || []).map((c) => c.text).join(" ; "), { ok: t("Save") });
          if (v == null || v === "" && !(it.criteria || []).length) return;
          await ctx.api(`/api/reqs/${encodeURIComponent(proj.team)}/${encodeURIComponent(code)}/criteria`, { method: "POST", body: { list: v.split(/\s*;\s*/).filter(Boolean) } });
          return;
        }
        if (b.dataset.s === "__ok" || b.dataset.s === "__fail") {
          const ok = b.dataset.s === "__ok";
          const how = await ctx.prompt(ok ? t("{code}: how did you verify it?", { code }) : t("{code}: why did it fail?", { code }), ok ? t("e.g. I tried it on the screen, the transfer went to approval") : t("e.g. There is no stock count screen"), "", { ok: t("Save") });
          if (!how) return;
          await ctx.api(`/api/reqs/${encodeURIComponent(proj.team)}/${encodeURIComponent(code)}/verify`, { method: "POST", body: { result: ok ? "verified" : "failed", how } });
          return;
        }
        if (b.dataset.s === "__del") {
          if (!(await ctx.confirmBox({ title: t("Delete {code}?", { code }), body: t("The item is removed from the scope list."), ok: t("Delete"), danger: true }))) return;
          await ctx.api(`/api/reqs/${encodeURIComponent(proj.team)}/${encodeURIComponent(code)}`, { method: "DELETE" });
        } else await ctx.api(`/api/reqs/${encodeURIComponent(proj.team)}/${encodeURIComponent(code)}`, { method: "PATCH", body: { status: b.dataset.s } });
      } catch (err) { ctx.toast(err.message, "bad"); }
    };
  }
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  document.addEventListener("pointerdown", (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  function editNote(el) {
    const code = el.closest(".rq-row").dataset.code; const it = data.items.find((x) => x.code === code);
    el.textContent = it?.note || ""; el.contentEditable = "true"; el.focus();
    const fin = async (save) => {
      el.contentEditable = "false"; const v = el.textContent.trim();
      if (save && v !== (it?.note || "")) { try { await ctx.api(`/api/reqs/${encodeURIComponent(proj.team)}/${encodeURIComponent(code)}`, { method: "PATCH", body: { note: v } }); } catch (err) { ctx.toast(err.message, "bad"); } }
      render();
    };
    el.onblur = () => fin(true);
    el.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.blur(); } if (e.key === "Escape") { e.stopPropagation(); el.onblur = null; fin(false); } };
  }
  // Report that can be sent to a manager: summary, mismatches, coverage, then a short card per item (instead of a wide table)
  function exportMd() {
    const c = counts(); const line = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    const date = new Date().toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" });
    const fmt = (ts) => (ts ? new Date(ts).toLocaleDateString(locale(), { day: "numeric", month: "short" }) : "");
    const vf = (it) => { const v = it.verify || {}; if (!v.state || v.state === "none") return t("Not verified");
      return `${VERIFY[v.state].label}${v.by ? ` (${v.by}${v.by === t("User") ? ", " + t("by hand") : ""}${v.at ? ", " + fmt(v.at) : ""})` : ""}`; };
    const active = data.items.filter((x) => !isDropped(x)).length;
    let md = `# ${proj.name} · ${t("Scope report")}\n\n**${t("Date:")}** ${date}  \n**${t("Documents:")}** ${cov?.docs?.length ? cov.docs.map((d) => `${d.name} (${d.prefix})`).join(", ") : "—"}\n\n` +
      `## ${t("Summary")}\n\n- ${t("**{verified} / {active}** requirements verified with evidence ({pct}%)", { verified: c.verified, active, pct: active ? Math.round((c.verified / active) * 100) : 0 })}\n` +
      `- ${t("**{n}** {n|item|items}: the document says 'done' but {n|it is|they are} not verified", { n: c.mismatch })}\n- ${c.dropped ? t("Work status: {done} done, {doing} in progress, {todo} not done, {unclear} unclear, {dropped} out of scope", { done: c.done, doing: c.doing, todo: c.todo, unclear: c.unclear, dropped: c.dropped }) : t("Work status: {done} done, {doing} in progress, {todo} not done, {unclear} unclear", { done: c.done, doing: c.doing, todo: c.todo, unclear: c.unclear })}\n` +
      (cov?.stats?.total ? `- ${cov.stats.byAgent ? t("Document coverage: {pct}% ({open} {open|section|sections} are not linked to any requirement, {pending} 'contains none' marks awaiting approval)", { pct: cov.stats.pct, open: cov.stats.open, pending: cov.stats.byAgent }) : t("Document coverage: {pct}% ({open} {open|section|sections} are not linked to any requirement)", { pct: cov.stats.pct, open: cov.stats.open })}\n` : "") +
      (cov?.unreadable?.length ? `- ${t("⚠ **Documents whose text could not be read:** {docs} — the items of these documents did not go through the coverage check", { docs: cov.unreadable.join(", ") })}\n` : "") +
      (cov?.stats?.images ? `- ${t("⚠ The document has {n} {n|image|images}/diagrams; since they cannot be read as text, their content must be checked by hand", { n: cov.stats.images })}\n` : "") +
      (cov?.stats?.truncated ? `- ${t("⚠ The document is very long; sectioning hit the limit, the end may not be covered")}\n` : "") +
      (c.changed ? `- ${t("**{n}** items changed in the new version of the document; they need re-review", { n: c.changed })}\n` : "") +
      (c.stale ? `- ${t("**{n}** items' evidence files changed; they need re-verification", { n: c.stale })}\n` : "") +
      (c.droppending ? `- ${t("**{n}** items were marked out of scope by an agent; awaiting user approval (they count as open)", { n: c.droppending })}\n` : "") +
      (c.nocrit ? `- ${t("{n} {n|item|items} have no acceptance criteria", { n: c.nocrit })}\n` : "");
    const mm = data.items.filter((x) => x.mismatch);
    if (mm.length) {
      md += `\n## ${t("⚠ Items shown as 'done' in the document but not verified ({n})", { n: mm.length })}\n\n| ${t("Code")} | ${t("Requirement")} | ${t("What the document says")} | ${t("Verification")} |\n|---|---|---|---|\n`;
      md += mm.map((it) => `| ${it.code} | ${line(it.title)} | ${line(it.claimText || (it.claim ? t("done") : t("section mentions ✓/completed")))} | ${line(vf(it))}${it.verify?.how && it.verify.state === "failed" ? `: ${line(it.verify.how)}` : ""} |`).join("\n") + "\n";
    }
    const cs = cov?.stats;
    if (cs?.total && cs.open) {
      const open = cov.segments.filter((g) => g.state === "open");
      md += `\n## ${t("Document sections with no counterpart ({n})", { n: open.length })}\n\n` + open.map((g) => `- **${g.id}** ${g.h ? `(${line(g.h)}) ` : ""}${line(g.text.slice(0, 240))}`).join("\n") + "\n";
    }
    const groups = new Map(); for (const it of data.items) { const k = it.section || t("General"); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    md += `\n## ${t("Items")}\n`;
    for (const [sec, items] of groups) {
      md += `\n### ${sec}\n\n| ${t("Code")} | ${t("Requirement")} | ${t("Work")} | ${t("Verification")} | ${t("Criteria")} |\n|---|---|---|---|---|\n`;
      md += items.map((it) => `| ${it.code} | ${line(it.title)}${it.claim ? ` _(${t("document: {claim}", { claim: CLAIM[it.claim].toLocaleLowerCase(locale()) })})_` : ""} | ${RSTATUS[it.status]?.label} | ${line(vf(it))} | ${it.criteria?.length ? `${it.criteria.filter((k) => k.state === "pass").length}/${it.criteria.length}` : "—"} |`).join("\n") + "\n";
      const notes = items.filter((it) => (it.verify?.how && it.verify.state !== "none") || it.note || it.docChange);
      if (notes.length) md += "\n" + notes.map((it) => `- **${it.code}:** ${[it.docChange ? t("⚠ changed in the document") : "", it.verify?.how && it.verify.state !== "none" ? t("verification: {how}", { how: line(it.verify.how) }) : "", it.evidence ? t("evidence: `{evidence}`", { evidence: line(it.evidence) }) : "", it.note ? t("note: {note}", { note: line(it.note) }) : ""].filter(Boolean).join(" · ")}`).join("\n") + "\n";
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `${proj.name}-${t("scope")}-${new Date().toISOString().slice(0, 10)}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return {
    open, close, get isOpen() { return !root.hidden; },
    onEvent(ev) { if (proj && ev.team === proj.team) load(); },
    refresh() { if (proj && !root.hidden) render(); },
    async summary(team) { return ctx.api(`/api/reqs/${encodeURIComponent(team)}/summary`).catch(() => ({ total: 0, done: 0, mismatches: 0 })); },
    openCoverage(agent) { view = "cov"; cfilter = "open"; return open(agent); },
  };
}
