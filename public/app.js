import { createStation, CHARACTERS } from "./scene.js";
import { createLibrary, badge, KIND } from "./library.js";
import { createReqs } from "./reqs.js";
import { createGit } from "./gitui.js";
import { createEditor } from "./editor.js";
import { createRuns } from "./runui.js";
import { t, LANGS, currentLang, locale } from "./i18n.js";

// ================= helpers =================
const $ = (s) => document.querySelector(s);
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { "content-type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; throw e; }
  return j;
};
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// Markdown: headings, lists, tables, quotes, code blocks (with copy button), links, bold/italic
function inline(t) {
  return escHtml(t)
    .replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => linkHtml(txt, url))
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => pre + linkHtml(url, url))
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>");
}
function linkHtml(txt, url) {
  const u = url.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  if (/["'<>]/.test(u)) return escHtml(u); // an "address" containing quotes is not a link; stays plain text
  if (/^https?:\/\//i.test(u)) { try { const h = new URL(u).href; return `<a href="${escHtml(h)}" target="_blank" rel="noopener noreferrer">${txt}</a>`; } catch { return escHtml(u); } }
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^file:/i.test(u) && !/^[a-z]:[\\/]/i.test(u)) return escHtml(u); // javascript:, data: etc. are not links
  let local = u.replace(/^file:\/\/\/?/i, "");
  try { local = decodeURI(local); } catch {}
  return `<a href="#" data-open="${escHtml(local)}" title="${t("Show in folder")}">${txt}</a>`;
}
function md(text) {
  const out = [];
  const parts = String(text).split(/```/);
  parts.forEach((seg, k) => {
    if (k % 2) {
      const nl = seg.indexOf("\n"), lang = nl > -1 ? seg.slice(0, nl).trim() : "", code = nl > -1 ? seg.slice(nl + 1) : seg;
      out.push(`<div class="code"><div class="code-head"><span>${escHtml(lang || t("code"))}</span><button type="button" class="copy">${t("Copy")}</button></div><pre><code>${escHtml(code.replace(/\n$/, ""))}</code></pre></div>`);
      return;
    }
    const lines = seg.split("\n"); let i = 0, para = [];
    const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { flush(); i++; continue; }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { flush(); out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`); i++; continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { flush(); out.push("<hr>"); i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flush();
        const row = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const head = row(l); i += 2; const body = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
        out.push(`<div class="tbl"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      if (/^\s*>\s?/.test(l)) { flush(); const q = []; while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, "")); out.push(`<blockquote>${q.map(inline).join("<br>")}</blockquote>`); continue; }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
        flush(); const ordered = /^\s*\d+[.)]/.test(l); const items = [];
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        out.push(`<${ordered ? "ol" : "ul"}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
        continue;
      }
      para.push(l); i++;
    }
    flush();
  });
  return out.join("");
}
const baseName = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || "";
function shortPath(p, keep = 3) {
  const sep = p.includes("\\") ? "\\" : "/";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > keep + 1 ? "…" + sep + parts.slice(-keep).join(sep) : p;
}

// ---- toast (instead of alert)
function toast(msg, kind = "", action) {
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = msg;
  if (action) { // e.g. "Undo"
    const b = document.createElement("button"); b.type = "button"; b.textContent = action.label;
    b.onclick = () => { t.remove(); action.fn(); }; t.append(b); t.classList.add("has-action");
  }
  $("#toasts").append(t); setTimeout(() => t.remove(), action ? 7000 : kind === "bad" ? 5000 : 2600);
}
// ---- confirm dialog (instead of confirm)
// alt: third option (e.g. "Close without saving"); returns "alt" when chosen
function confirmBox({ title, body, ok = t("OK"), danger = false, alt = "", altDanger = false, focusOk = false }) {
  const d = $("#dlg-confirm");
  $("#cf-title").textContent = title; $("#cf-body").textContent = body;
  const okBtn = $("#cf-ok"); okBtn.textContent = ok; okBtn.className = "btn " + (danger ? "danger" : "primary");
  const altBtn = $("#cf-alt"); altBtn.hidden = !alt; altBtn.textContent = alt; altBtn.className = "btn " + (altDanger ? "danger ghost" : "ghost");
  d.returnValue = ""; d.showModal(); (focusOk ? okBtn : $("#cf-cancel")).focus();
  return new Promise((res) => d.addEventListener("close", () => res(d.returnValue === "ok" ? true : d.returnValue === "alt" ? "alt" : false), { once: true }));
}

// ================= constants =================
const STATUS_TEXT = { idle: t("Idle"), thinking: t("Thinking"), tool: t("Using a tool"), done: t("Done"), error: t("Error") };
const EFFORTS = [["low", t("Low")], ["medium", t("Medium")], ["high", t("High")], ["xhigh", t("Very high")], ["max", t("Max")]];
const PERMS = [
  ["plan", t("Read only"), t("Changes no files; it reads, reviews and proposes a plan.")],
  ["acceptEdits", t("Edits"), t("Can edit files. Terminal commands it wants to run are refused.")],
  ["bypassPermissions", t("Full access"), t("Runs commands and deletes files without asking. Use only in projects you trust.")],
];
// Like the picker in Claude chat: featured + "More models"
const MODELS_MAIN = [
  ["claude-fable-5-1", "Fable 5.1", t("Hard reasoning and long agentic work")],
  ["claude-opus-5-5", "Opus 5.5", t("Strong for long coding tasks")],
  ["claude-sonnet-5-5", "Sonnet 5.5", t("Balance of speed and intelligence")],
  ["claude-haiku-5-5", "Haiku 5.5", t("Fastest, for simple tasks")],
];
const MODELS_MORE = [
  ["claude-fable-5", "Fable 5"], ["claude-opus-5", "Opus 5"], ["claude-sonnet-5", "Sonnet 5"],
  ["claude-opus-4-8", "Opus 4.8"], ["claude-opus-4-7", "Opus 4.7"], ["claude-opus-4-6", "Opus 4.6"],
  ["claude-sonnet-4-6", "Sonnet 4.6"], ["claude-haiku-4-5-20251001", "Haiku 4.5"],
];
const ALIAS = { sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5", fable: "claude-fable-5-1", haiku: "claude-haiku-5-5" };
const modelName = (id) => {
  const m = [...MODELS_MAIN, ...MODELS_MORE].find(([k]) => k === (ALIAS[id] || id));
  return m ? m[1] : id;
};
// ---- team / roles
const ROLE_ICON = {
  analyst: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13M6.5 8.5h4M6.5 11h4"/></svg>',
  dev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/></svg>',
  tester: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 1.5h4M7 1.5v4.2L3.2 12.6A1.3 1.3 0 0 0 4.3 14.5h7.4a1.3 1.3 0 0 0 1.1-1.9L9 5.7V1.5M5 10h6"/></svg>',
  reviewer: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
};
const roleOf = (a) => (meta.roles?.[a?.role] ? a.role : "dev");
const roleLabel = (a) => meta.roles?.[roleOf(a)]?.label || t("Developer");
const teamKey = (a) => a.team || a.id;
const teamOf = (a) => agents.filter((x) => teamKey(x) === teamKey(a)).sort((x, y) => (meta.roles?.[roleOf(x)]?.order ?? 9) - (meta.roles?.[roleOf(y)]?.order ?? 9));
const agentLabel = (a) => (teamOf(a).length > 1 ? `${a.name} · ${roleLabel(a)}` : a.name);
const teamOrder = () => [...new Set(agents.map(teamKey))];
const leadOf = (a) => { const t = teamOf(a); return t.find((x) => roleOf(x) === "dev") || t[0]; };
const projects = () => teamOrder().map((t) => leadOf(agents.find((x) => teamKey(x) === t)));
// Turkish case suffixes for names in sentences (dative "Testçi'ye", ablative "Analist'ten"); other languages return the word as is
// role names (Testçi, Analist…) are not proper nouns: no apostrophe
const isRoleWord = (w) => Object.values(meta.roles || {}).some((r) => r.label === w) || [t("Team"), t("Lead")].includes(w);
const dative = (w) => { if (currentLang() !== "tr") return w; const v = [...w.toLocaleLowerCase(locale())].reverse().find((c) => /[aeıioöuü]/.test(c)) || "e"; const back = /[aıou]/.test(v); const endsV = /[aeıioöuü]/.test(w.slice(-1).toLocaleLowerCase(locale())); return `${w}${isRoleWord(w) ? "" : "'"}${endsV ? "y" : ""}${back ? "a" : "e"}`; };
const ablative = (w) => { if (currentLang() !== "tr") return w; const v = [...w.toLocaleLowerCase(locale())].reverse().find((c) => /[aeıioöuü]/.test(c)) || "e"; const back = /[aıou]/.test(v); const hard = /[fstkçşhp]/.test(w.slice(-1).toLocaleLowerCase(locale())); return `${w}${isRoleWord(w) ? "" : "'"}${hard ? "t" : "d"}${back ? "an" : "en"}`; };
const portraitUrl = (i) => `url(/assets/chars/previews/${CHARACTERS[i % CHARACTERS.length]}.png)`;

// ================= state =================
let meta = { mock: false };
let agents = [];
// if the localStorage entry is not in the expected shape (corrupt/old version) return the default so startup does not crash
function lsGet(k, d) {
  try { const v = localStorage.getItem(k); if (!v) return d; const p = JSON.parse(v);
    if (Array.isArray(d) ? !Array.isArray(p) : d && typeof d === "object" ? (!p || typeof p !== "object" || Array.isArray(p)) : typeof p !== typeof d) { localStorage.removeItem(k); return d; }
    return p; } catch { return d; }
}
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
const unread = new Set(lsGet("ecelon.unread", []).filter((x) => typeof x === "string"));
function saveUnread() { lsSet("ecelon.unread", [...unread]); }
const drafts = lsGet("ecelon.drafts", {});
let selectedId = null;
let liveBubble = null, liveThink = null;
const lastTool = new Map(), runStart = new Map(), actText = new Map(), lastEventAt = new Map();
const current = () => agents.find((x) => x.id === selectedId);
const indexOf = (id) => agents.findIndex((x) => x.id === id);

const station = createStation($("#scene"), {
  onSelect: (id) => selectAgent(id),
  // swap two rooms
  onReorder: async (a, b) => { // a, b: team (room) keys
    const order = teamOrder(), i = order.indexOf(a), j = order.indexOf(b);
    if (i < 0 || j < 0) return;
    [order[i], order[j]] = [order[j], order[i]];
    const ids = order.flatMap((t) => agents.filter((x) => teamKey(x) === t).map((x) => x.id));
    const nm = (t) => agents.find((x) => teamKey(x) === t)?.name;
    try { await api("/api/agents/reorder", { method: "POST", body: { ids } }); await refresh(); toast(t("{a} and {b} swapped places", { a: nm(a), b: nm(b) })); }
    catch (err) { toast(err.message, "bad"); }
  },
  onHover: (id, x, y) => {
    const tip = $("#tooltip"); const a = agents.find((q) => q.id === id);
    if (!a) { tip.hidden = true; return; }
    const r = $("#stage").getBoundingClientRect();
    tip.hidden = false; tip.style.left = x - r.left + "px"; tip.style.top = y - r.top + "px";
    tip.textContent = `${agentLabel(a)}: ${STATUS_TEXT[a.status] || t("Idle")}`;
  },
});
window.__station = station; // for debugging

// ================= document library =================
const lib = createLibrary({
  api, toast, confirmBox, md,
  agents: () => projects(),
  label: (a) => a.name,
  portrait: (a) => portraitUrl(a.char ?? indexOf(a.id)),
  onOpen: () => { station.pause(true); closePops(); },
  onClose: () => station.pause(false),
  onChange: () => { renderLinked(); if (pendingDocs.length) renderAttachments(); },
  useInChat: async (agentId, doc) => {
    if (selectedId !== agentId) await selectAgent(agentId);
    addDoc(doc.id); $("#prompt").focus();
    toast(t("{name} attached to the message", { name: doc.name }));
  },
});
window.__lib = lib;
$("#btn-library").onclick = () => lib.open();

// ================= scope (requirements) =================
function askText(title, placeholder = "", value = "", opts = {}) {
  // opts: { ok: "Save", list: ["R-001 …"] } — Enter saves (the primary button is first in the form), empty input counts as cancel
  return new Promise((res) => {
    const d = $("#dlg-prompt"); $("#pr-title").textContent = title; const inp = $("#pr-input"); inp.value = value; inp.placeholder = placeholder;
    $("#pr-ok").textContent = opts.ok || t("OK");
    $("#pr-list").innerHTML = (opts.list || []).map((x) => `<option value="${escHtml(String(x))}"></option>`).join("");
    d.returnValue = ""; d.showModal(); inp.focus(); inp.select();
    d.addEventListener("close", () => res(d.returnValue === "ok" ? inp.value.trim() : ""), { once: true });
  });
}
const reqsUI = createReqs({
  api, toast, confirmBox, prompt: askText,
  project: (a) => { const t = teamOf(a); const lead = leadOf(a); return { team: teamKey(a), name: lead.name, lead, analyst: t.find((x) => roleOf(x) === "analyst"), tester: t.find((x) => roleOf(x) === "tester"), reviewer: t.find((x) => roleOf(x) === "reviewer") }; },
  send: (agent, text) => sendPrompt({ text }, agent),
  openLibrary: (id) => lib.open({ agentId: id }),
  linkedCount: (lead) => [...new Set(teamOf(lead).flatMap((m) => lib.linkedTo(m.id).map((d) => d.id)))].length,
  statusOf: (id) => agents.find((x) => x.id === id)?.status || "idle",
  onOpen: () => { station.pause(true); closePops(); },
  onClose: () => station.pause(false),
});
let badgeSeq = 0;
async function renderReqsBadge(a = current()) {
  if (!a) return; const seq = ++badgeSeq;
  const s = await reqsUI.summary(teamKey(a)); if (seq !== badgeSeq) return;
  const b = $("#reqs-badge");
  // ⚠ only "done in the document but not verified" + "changed in the document"; coverage is shown separately (percent)
  const open = s.coverage?.open || 0, warn = s.mismatches + (s.docChanged || 0);
  const pct = s.coverage?.total ? s.coverage.pct : null;
  b.textContent = [warn ? `⚠ ${warn}` : s.total ? `${s.done}/${s.total}` : "", pct != null && pct < 100 ? t("{n}%", { n: pct }) : ""].filter(Boolean).join(" · ");
  b.classList.toggle("warn", !!warn || !!open);
  $("#btn-reqs").title = [s.mismatches ? t("{n} {n|item|items}: the document says 'done' but {n|it is|they are} not verified", { n: s.mismatches }) : "", open ? t("{n} document {n|section is|sections are} not linked to any requirement", { n: open }) : "", s.docChanged ? t("{n} {n|item|items} changed in the new version of the document", { n: s.docChanged }) : ""].filter(Boolean).join("\n") || t("Scope: requirements from the analysis document and their verification status");
}
$("#btn-reqs").onclick = () => current() && reqsUI.open(current());

// ================= git panel =================
let gitSum = {};
async function refreshGitSummary() {
  gitSum = await api("/api/git/summary").catch(() => gitSum);
  renderGitBadge(); renderList();
}
function renderGitBadge(a = current()) {
  const b = $("#git-badge"); if (!a || !b) return;
  const s = gitSum[teamKey(a)];
  $("#btn-git").hidden = s && s.ok === false;
  b.textContent = !s?.ok ? "" : [s.changed ? s.changed : "", s.ahead ? `↑${s.ahead}` : ""].filter(Boolean).join(" ");
  b.classList.toggle("warn", !!s?.ahead);
  $("#btn-git").title = !s?.ok ? "Git" : `${s.branch || ""}: ${t("{n} {n|change|changes}", { n: s.changed })}${s.ahead ? ", " + t("{n} {n|commit|commits} not pushed", { n: s.ahead }) : ""}${s.behind ? ", " + t("{n} new commits on the remote", { n: s.behind }) : ""}`;
}
const gitUI = createGit({
  api, toast, confirmBox, prompt: (...a) => askText(...a),
  openCode: (a, f) => { gitUI.close(); openCode(a, f); },
  onOpen: () => { station.pause(true); closePops(); },
  onClose: () => { station.pause(false); refreshGitSummary(); },
  onChanged: () => refreshGitSummary(),
});
$("#btn-git").onclick = () => current() && gitUI.open(leadOf(current()));

// ================= code editor =================
const edUI = createEditor({
  api, toast, confirmBox, prompt: askText,
  onOpen: () => { station.pause(true); closePops(); },
  onClose: () => { station.pause(false); refreshGitSummary(); },
  isBusyTeam: (a) => teamOf(a).some((m) => isBusy(agents.find((x) => x.id === m.id))),
  openInFolder: (a, p) => api(`/api/agents/${a.id}/open`, { method: "POST", body: { path: p } }).then(() => toast(t("Shown in folder"))).catch((err) => toast(err.message, "bad")),
  insertRef: async (a, p) => {
    const lead = leadOf(a); if (selectedId !== lead.id && teamKey(current() || {}) !== teamKey(a)) await selectAgent(lead.id);
    const ta = $("#prompt"); ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, " ") : "") + "@" + p + " "; ta.dispatchEvent(new Event("input")); ta.focus();
  },
});
function openCode(a = current(), file, line) { if (!a) return; edUI.open(leadOf(a), file, line); }

// ================= run panel =================
let runCounts = {};
const runUI = createRuns({
  api, toast, confirmBox, prompt: askText,
  onOpen: (docked) => { if (!docked) station.pause(true); closePops(); },
  onClose: () => { station.pause(false); refreshRunCounts(); },
  onDock: (docked) => station.pause(!docked),
  openCode: (a, f, l) => { runUI.close(); openCode(a, f, l); },
  sendFix: (a, text) => { const lead = leadOf(a); selectAgent(lead.id).then(() => sendPrompt({ text }, lead)); },
  onCount: (team, n) => { runCounts[team] = n; renderRunBadge(); },
  refreshCount: () => refreshRunCounts(),
});
async function refreshRunCounts() { try { runCounts = await api("/api/runs/summary"); } catch {} renderRunBadge(); }
function renderRunBadge(a = current()) { const n = a ? runCounts[teamKey(a)] || 0 : 0; $("#run-badge").textContent = n ? `● ${n}` : ""; $("#btn-run").classList.toggle("live", !!n); }
function openRun(a = current(), opts) { if (a) runUI.open(leadOf(a), opts); }
$("#btn-run").onclick = () => openRun();
refreshRunCounts();
$("#btn-code").onclick = () => openCode();
let gitT; const gitSoon = () => { clearTimeout(gitT); gitT = setTimeout(refreshGitSummary, 1200); };
setInterval(refreshGitSummary, 45000);

// ================= sibling (linked) projects =================
$("#btn-links").onclick = () => {
  closePops(); const a = current(); if (!a) return;
  const mine = new Set(leadOf(a).links || []);
  const others = projects().filter((p) => teamKey(p) !== teamKey(a));
  const box = $("#lk-list"); box.innerHTML = "";
  if (!others.length) box.innerHTML = `<p class="dlg-note">${t("No other project to link.")}</p>`;
  others.forEach((p) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="checkbox" value="${teamKey(p)}"${mine.has(teamKey(p)) ? " checked" : ""}><span class="portrait"></span><span></span>`;
    l.querySelector(".portrait").style.backgroundImage = portraitUrl(p.char ?? 0); l.querySelector("span:last-child").textContent = p.name; box.append(l);
  });
  $("#lk-title").textContent = t("{name} · linked projects", { name: a.name });
  $("#dlg-links").showModal();
};
$("#lk-form").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault(); $("#dlg-links").close();
  const teams = [...document.querySelectorAll("#lk-list input:checked")].map((i) => i.value);
  try { await api(`/api/agents/${leadOf(current()).id}/links`, { method: "POST", body: { teams } }); toast(teams.length ? t("Linked to {n} {n|project|projects}", { n: teams.length }) : t("Links removed")); refresh(); }
  catch (err) { toast(err.message, "bad"); }
});
$("#linked-docs").onclick = () => lib.open({ agentId: leadOf(current()).id });
function docMention() { // open the document suggestions as if # had been typed
  const ta = $("#prompt"), s = ta.selectionStart, pre = ta.value.slice(0, s);
  const ins = (pre && !/\s$/.test(pre) ? " " : "") + "#";
  ta.setRangeText(ins, s, ta.selectionEnd, "end"); ta.focus(); updateMention();
}

$("#zoom-in").onclick = () => station.zoomIn();
$("#zoom-out").onclick = () => station.zoomOut();
$("#zoom-fit").onclick = () => station.fit();

// ================= data =================
let firstRefresh = true;
let refreshSeq = 0;
async function refresh() {
  const seq = ++refreshSeq;
  const list = await api("/api/agents");
  if (seq !== refreshSeq) return; // a newer refresh started; the old response must not overwrite it
  agents = list;
  if (firstRefresh) { firstRefresh = false; for (const id of queue.keys()) if (!agents.some((x) => x.id === id)) queue.delete(id); saveQueue(); setTimeout(() => { for (const id of queue.keys()) flushQueue(id); }, 1500); }
  station.setAgents(agents);
  station.select(selectedId);
  $("#empty-hint").hidden = agents.length > 0;
  renderList();
  if (selectedId) { const a = current(); if (!a) closePanel(); else { fillHeader(a); if ((a.activeConv || null) !== loadedConv) loadChat(); } }
}

const lastPick = new Map(); // team → last opened member
const STATUS_RANK = { tool: 4, thinking: 3, error: 2, done: 1, idle: 0 };
let listRaf = 0;
const scheduleList = () => { if (!listRaf) listRaf = requestAnimationFrame(() => { listRaf = 0; renderListNow(); }); };
function renderList() { scheduleList(); }
function renderListNow() {
  const ul = $("#agent-list"); ul.innerHTML = "";
  for (const tk of teamOrder()) {
    const team = teamOf(agents.find((x) => teamKey(x) === tk));
    const lead = team.find((x) => x.id === lastPick.get(tk)) || team.find((x) => roleOf(x) === "dev") || team[0];
    const top = [...team].sort((x, y) => (STATUS_RANK[y.status] || 0) - (STATUS_RANK[x.status] || 0))[0];
    const li = document.createElement("li");
    li.draggable = true; li.dataset.team = tk;
    if (unread.has(tk)) li.classList.add("unread");
    li.innerHTML = `<button type="button" class="li-main"><span class="portrait"></span><span><span class="li-name"></span><span class="li-meta"></span></span><span class="chip"><i class="dot"></i><span></span></span></button>`;
    li.querySelector(".portrait").style.backgroundImage = portraitUrl(lead.char ?? 0);
    li.querySelector(".li-name").textContent = lead.name;
    const boss0 = team.find((x) => roleOf(x) === "dev") || lead;
    li.querySelector(".portrait").style.backgroundImage = portraitUrl(boss0.char ?? 0);
    li.querySelector(".li-meta").textContent = `${modelName(boss0.model)}, ${t("{effort} effort", { effort: (EFFORTS.find(([k]) => k === boss0.effort) || [null, boss0.effort])[1].toLowerCase() })}`;
    li.querySelector(".chip .dot").className = "dot st-" + (top.status || "idle");
    if (team.length > 1) { // team: each role is a small icon whose colour shows its status (an indicator, not a tab)
      const tm = document.createElement("span"); tm.className = "li-team";
      tm.innerHTML = team.map((m) => `<i class="lt-r st-${m.status || "idle"}" title="${escHtml(roleLabel(m))}: ${escHtml(STATUS_TEXT[m.status] || t("Idle"))}">${ROLE_ICON[roleOf(m)]}</i>`).join("");
      li.querySelector(".li-meta").after(tm);
    }
    const gs = gitSum[tk];
    if (gs?.ok && (gs.ahead || gs.changed)) { const m = document.createElement("span"); m.className = "li-git" + (gs.ahead ? " ahead" : ""); m.textContent = gs.ahead ? `↑${gs.ahead}` : `±${gs.changed}`; m.title = gs.ahead ? t("{n} {n|commit|commits} not pushed (push)", { n: gs.ahead }) : t("{n} uncommitted changes", { n: gs.changed }); li.querySelector(".li-name").append(m); }
    // priority: running role > needs attention (permission/error) > unread "done" > idle
    const att = team.find((m) => m.attention);
    const runningM = team.find((m) => m.status === "thinking" || m.status === "tool");
    const chipTxt = runningM ? (team.length > 1 ? `${roleLabel(runningM)}: ${(STATUS_TEXT[runningM.status] || "").toLowerCase()}` : STATUS_TEXT[runningM.status])
      : att ? (att.attention.kind === "permission" ? t("⚠ Waiting for permission") : t("⚠ Error"))
      : top.status === "done" && unread.has(tk) ? t("Done") : t("Idle");
    li.querySelector(".chip span").textContent = chipTxt;
    li.querySelector(".chip").classList.toggle("warn", !runningM && !!att);
    if (att && !runningM) { li.querySelector(".chip").title = att.attention.text; li.querySelector(".chip .dot").className = "dot st-error"; }
    else if (!runningM && !(top.status === "done" && unread.has(tk))) li.querySelector(".chip .dot").className = "dot st-idle";
    const boss = team.find((x) => roleOf(x) === "dev") || lead;
    li.querySelector(".li-main").onclick = () => { selectAgent(boss.id); station.focus(boss.id); };
    li.querySelector(".li-main").title = unread.has(tk) ? t("Finished its work while you were away") : "";
    ul.append(li);
  }
}

// ================= panel =================
const EFFORT_DESC = {
  low: t("Fast answer, thinks briefly"), medium: t("Balanced for most tasks"), high: t("Thinks deeper on hard tasks"),
  xhigh: t("Very hard problems; uses up the limit fast"), max: t("Deepest thinking; uses up the limit fastest"),
};
const effortName = (k) => (EFFORTS.find(([x]) => x === k) || [null, k])[1];
const permOf = (a) => a.permission || "acceptEdits";

function fillHeader(a) {
  if (!$("#a-name").isContentEditable) { $("#a-name").textContent = a.name; $("#a-name").title = t("{name} (click to rename)", { name: a.name }); }
  $("#a-path").textContent = shortPath(a.cwd); $("#a-path").title = a.cwd;
  $("#a-portrait").style.backgroundImage = portraitUrl(a.char ?? indexOf(a.id));
  $("#model-name").textContent = modelName(a.model);
  $("#effort-name").textContent = effortName(a.effort); $("#effort-btn").title = `${t("Effort: {effort}.", { effort: effortName(a.effort) })} ${EFFORT_DESC[a.effort] || ""}`;
  const perm = PERMS.find(([k]) => k === permOf(a));
  $("#perm-name").textContent = perm[1];
  $("#perm-btn").classList.toggle("risky", perm[0] === "bypassPermissions");
  $("#perm-btn").title = perm[2];
  renderContext(a); renderLinked(a); renderTeamTabs(a); renderReqsBadge(a); renderGitBadge(a); renderRunBadge(a);
  const team = teamOf(a);
  $("#prompt").placeholder = team.length > 1 && roleOf(a) === "dev" ? t("Write to the team; the lead hands work to the tester or analyst when needed") : team.length > 1 ? t("Talk directly to {role}", { role: roleLabel(a) }) : t("What do you want from this agent?  @ file · # document");
  setStatus(a.status || "idle", a.busy);
  { // linked (sibling) projects shown in the header
    let ch = $("#a-links"); const links = (leadOf(a).links || []).map((t) => agents.find((x) => teamKey(x) === t && roleOf(x) === "dev") || agents.find((x) => teamKey(x) === t)).filter(Boolean);
    if (!ch) { ch = document.createElement("button"); ch.type = "button"; ch.id = "a-links"; ch.className = "a-linked"; ch.onclick = () => $("#btn-links").click(); $(".a-row").append(ch); }
    ch.hidden = !links.length; ch.textContent = links.length ? `↔ ${links.map((x) => x.name).join(", ")}` : ""; ch.title = t("Linked projects: when an API or something shared changes, the leads notify each other. Click to edit.");
  }
  const att = teamOf(a).find((m) => m.attention);
  if (att && !isBusy(a)) { const p = $("#a-status"); p.className = "status st-error"; p.textContent = `${teamOf(a).length > 1 && att.id !== a.id ? roleLabel(att) + ": " : ""}${att.attention.text}`; }
}

// context ring: how much of the model's context window this conversation has used
function renderTeamTabs(a = current()) {
  const nav = $("#team-tabs"); if (!a) return;
  $("#btn-remove-role").hidden = true;
  const boss = leadOf(a);
  if (boss.id === a.id) { nav.hidden = true; nav.innerHTML = ""; return; }
  nav.hidden = false;
  nav.innerHTML = `<div class="member-bar"><button type="button" class="mb-back"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>${t("Back to team chat")}</button><span class="mb-who">${ROLE_ICON[roleOf(a)]}<b></b><i class="dot st-${a.status || "idle"}"></i></span><small>${t("Writing here talks directly to this role")}</small></div>`;
  nav.querySelector("b").textContent = t("{role} chat", { role: roleLabel(a) });
  nav.querySelector(".mb-back").onclick = () => selectAgent(boss.id);
  $("#btn-remove-role").hidden = false; // a member's chat: the role can be removed from the project menu
  $("#btn-remove-role").textContent = t("Remove the {role} role from the team", { role: roleLabel(a) });
}
function renderLinked(a = current()) {
  const b = $("#linked-docs"); if (!a) return;
  const list = [...new Map(teamOf(a).flatMap((m) => lib.linkedTo(m.id)).map((d) => [d.id, d])).values()], n = list.length;
  b.hidden = !n; b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13"/></svg>${t("{n} linked {n|document|documents}", { n })}`;
  b.title = t("{n} {n|document|documents} linked to this project: {names}. The agent knows them in every conversation.", { n, names: list.map((d) => d.name).join(", ") });
}
function renderContext(a) {
  const c = a.context, el = $("#ctx");
  if (!c?.tokens || !c?.window) { el.hidden = true; return; }
  const pct = Math.min(1, c.tokens / c.window), L = 2 * Math.PI * 7.5;
  const arc = $("#ctx-arc"); arc.style.strokeDasharray = L; arc.style.strokeDashoffset = L * (1 - pct);
  el.hidden = false; el.className = "ctx" + (pct > 0.85 ? " full" : pct > 0.6 ? " warn" : "");
  $("#ctx-pct").textContent = t("{n}%", { n: Math.round(pct * 100) });
  el.title = t("Context: {used} / {window} tokens. When it fills up, 'New conversation' is a good idea.", { used: c.tokens.toLocaleString(locale()), window: c.window.toLocaleString(locale()) });
}

async function patch(body) {
  try { await api(`/api/agents/${selectedId}`, { method: "PATCH", body }); await refresh(); }
  catch (err) { toast(err.message, "bad"); }
}

function setStatus(st, busyFlag) {
  const p = $("#a-status"); p.className = "status st-" + st; p.textContent = STATUS_TEXT[st] || st;
  const busy = busyFlag ?? (st === "thinking" || st === "tool");
  $("#btn-stop").hidden = !busy; $("#btn-send").disabled = busy;
  $("#a-portrait").classList.toggle("busy", busy);
}

async function selectAgent(id) {
  const prev = current();
  if (prev) saveDraft(teamKey(prev));
  selectedId = id; station.select(id);
  const a = current(); if (!a) return;
  if (!prev || teamKey(prev) !== teamKey(a)) restoreDraft(teamKey(a));
  if (unread.delete(teamKey(a))) { saveUnread(); renderList(); }
  lastPick.set(teamKey(a), id);
  $("#panel-empty").hidden = true; $("#panel-agent").hidden = false;
  fillHeader(a);
  await loadChat();
}
let loadedConv = null;
let loadSeq = 0;
let chatOf = null;
let loadingChat = null; // live events arriving during load wait here; appended in order once the history is drawn
const CHAT_TAIL = 500; // in a very long conversation only the last events are drawn at first (all of them via "show earlier")
async function loadChat(all = false) {
  const a = current(); if (!a) return;
  const seq = ++loadSeq;
  loadingChat = { agentId: a.id, evs: [] };
  if (chatOf !== a.id) { chatOf = a.id; $("#chat").innerHTML = `<div class="chat-empty chat-loading"><span class="pulse" aria-hidden="true"><i></i><i></i><i></i></span><span>${t("Loading the {name} conversation…", { name: escHtml(agentLabel(a)) })}</span></div>`; }
  // the conversation list is created on the server when needed; learn the active conversation from it
  const convs = await api(`/api/agents/${a.id}/convs`).catch(() => []);
  const active = convs.find((c) => c.active)?.id || a.activeConv || null;
  a.activeConv = active; loadedConv = active;
  let log; try { log = await api(`/api/agents/${a.id}/log${active ? "?conv=" + active : ""}`); } catch (err) { if (seq === loadSeq) { loadingChat = null; $("#chat").innerHTML = `<div class="chat-empty"><b>${t("Conversation could not be loaded")}</b><span>${escHtml(err.message)}</span></div>`; } return; }
  if (seq !== loadSeq || a.id !== selectedId) return; // a newer load started
  if (deltaRaf) { cancelAnimationFrame(deltaRaf); deltaRaf = 0; } deltaBuf = { text: "", think: "" };
  const chat = $("#chat"); chat.innerHTML = ""; liveBubble = liveThink = null; todoCard = null; renderQueue();
  const tail = !all && log.length > CHAT_TAIL ? log.slice(-CHAT_TAIL) : log;
  if (tail.length < log.length) {
    const more = document.createElement("button"); more.type = "button"; more.className = "chat-older";
    more.textContent = t("Show the previous {n} {n|event|events}", { n: log.length - tail.length }); more.onclick = () => loadChat(true); chat.append(more);
  }
  for (const ev of tail) renderEvent(ev, true);
  const lastT = log.length ? log[log.length - 1].t || 0 : 0, lastJ = log.length ? JSON.stringify(log[log.length - 1]) : "";
  const late = loadingChat?.agentId === a.id ? loadingChat.evs : []; loadingChat = null;
  for (const ev of late) if (!ev.t || ev.t > lastT || (ev.t === lastT && JSON.stringify(ev) !== lastJ)) renderEvent(ev); // events that arrived during load (not in the history)
  if (!log.length) {
    const team = teamOf(a);
    chat.innerHTML = `<div class="chat-empty"><b>${t("New conversation")}</b><span>${t("What shall we do in {name}?", { name: escHtml(a.name) })}</span>` +
      (team.length > 1 && roleOf(a) === "dev" ? `<ul class="ce-tips"><li><b>${t("Team:")}</b> ${team.map((m) => escHtml(roleLabel(m))).join(", ")}. ${t("You write to the lead (developer); when testing, a document check or a review is needed, the lead hands the work to the right role.")}</li>
        <li>${t("<b>Quick commands</b> (below): tasks like 'Test' or 'Review' go directly to the relevant role.")}</li>
        <li>${t("Add a file with <b>@</b> and a library document with <b>#</b>; you can paste images.")}</li>
        <li>${t("If you have an analysis document, link it to this project from <b>Documents</b>, then <b>Scope</b> → 'Extract from document'.")}</li></ul>` : `<span>${t("Type @ to add a file, paste to add an image.")}</span>`) + `</div>`;
  }
  chat.scrollTop = chat.scrollHeight; updateJump(); updateActivity();
}
function closePanel() {
  if (current()) saveDraft(teamKey(current()));
  selectedId = null; station.select(null); closePops();
  $("#panel-agent").hidden = true; $("#panel-empty").hidden = false;
}

// ---- shared dropdown (model / effort / permission) — opens above the message box
function openPicker(btn, { main, more = [], current: cur, onPick, moreLabel = t("More models") }) {
  const pop = $("#model-pop");
  const check = `<svg class="mp-check" viewBox="0 0 16 16"><path d="M3 8.5 6.5 12 13 4.5"/></svg>`;
  const item = ([id, name, desc, cls]) => `<button type="button" class="mp-item ${cls || ""}" role="option" data-id="${id}" aria-selected="${id === cur}"><span class="mp-name">${escHtml(name)}</span>${desc ? `<span class="mp-desc">${escHtml(desc)}</span>` : ""}${id === cur ? check : ""}</button>`;
  const inMore = more.some(([k]) => k === cur);
  pop.className = "pop pick-pop";
  pop.innerHTML = main.map(item).join("") + (more.length ? `<div class="mp-sep"></div>
    <button type="button" class="mp-more" aria-expanded="${inMore}">${moreLabel}<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg></button>
    <div class="mp-more-list" ${inMore ? "" : "hidden"}>${more.map(item).join("")}</div>` : "");
  pop.querySelector(".mp-more")?.addEventListener("click", (e) => {
    const b = e.currentTarget, open = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", String(open)); pop.querySelector(".mp-more-list").hidden = !open;
  });
  pop.querySelectorAll(".mp-item").forEach((b) => b.onclick = () => { closePops(); if (b.dataset.id !== cur) onPick(b.dataset.id); });
  pop.hidden = false;
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
  // if there is no room above (e.g. "Set up a team" in the header) open downwards; the height must not exceed the screen
  pop.style.maxHeight = ""; const h = pop.offsetHeight;
  if (r.top - 16 < h && innerHeight - r.bottom > r.top) {
    pop.style.bottom = ""; pop.style.top = r.bottom + 8 + "px"; pop.style.maxHeight = innerHeight - r.bottom - 24 + "px";
  } else { pop.style.top = ""; pop.style.bottom = innerHeight - r.top + 8 + "px"; pop.style.maxHeight = r.top - 24 + "px"; }
  pop.style.overflowY = "auto";
  btn.setAttribute("aria-expanded", "true");
  pop.querySelector('[aria-selected="true"]')?.focus();
}
function closePops() {
  for (const id of ["#model-pop", "#menu-pop", "#usage-pop", "#history-pop"]) $(id).hidden = true;
  document.querySelectorAll('[aria-expanded="true"]').forEach((b) => { if (!b.classList.contains("mp-more")) b.setAttribute("aria-expanded", "false"); });
}
const toggle = (fn) => (e) => { e.stopPropagation(); const wasOpen = e.currentTarget.getAttribute("aria-expanded") === "true"; closePops(); if (!wasOpen) fn(e.currentTarget); };

$("#model-btn").onclick = toggle((btn) => {
  const a = current(); if (!a) return;
  openPicker(btn, { main: MODELS_MAIN, more: MODELS_MORE.map(([k, n]) => [k, n]), current: ALIAS[a.model] || a.model, onPick: (v) => patch({ model: v }) });
});
$("#effort-btn").onclick = toggle((btn) => {
  const a = current(); if (!a) return;
  openPicker(btn, { main: EFFORTS.map(([k, n]) => [k, n, EFFORT_DESC[k]]), current: a.effort, onPick: (v) => patch({ effort: v }) });
});
$("#perm-btn").onclick = toggle((btn) => {
  const a = current(); if (!a) return;
  openPicker(btn, { main: PERMS.map(([k, n, d]) => [k, n, d, k === "bypassPermissions" ? "risky" : ""]), current: permOf(a), onPick: async (v) => {
    if (v === "bypassPermissions") {
      const ok = await confirmBox({ title: t("Grant full access?"), body: t("This agent can run commands, delete files and write outside the project without asking. Enable it only in projects you trust."), ok: t("Grant full access"), danger: true });
      if (!ok) return;
    }
    patch({ permission: v });
  } });
});
$("#menu-btn").onclick = toggle((btn) => { $("#menu-pop").hidden = false; btn.setAttribute("aria-expanded", "true"); });
document.addEventListener("click", (e) => { if (!e.target.closest(".pop")) closePops(); });
document.addEventListener("keydown", (e) => {
  // in the message box Esc only leaves focus (does not close the panel; what you typed stays)
  if (e.key === "Escape" && e.target === $("#prompt") && $("#mention-pop").hidden) { $("#prompt").blur(); e.preventDefault(); return; }
  // e.defaultPrevented: an upper layer (Scope, Git, editor, documents) already used Esc → do not close the panel
  if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]") || lib.isOpen || reqsUI.isOpen || gitUI.isOpen || edUI.isOpen || runUI.isOpen) return;
  if ([...document.querySelectorAll(".pop")].some((p) => !p.hidden)) closePops(); else if (selectedId) closePanel();
});

// ---- dictation (the browser's speech recognition, in the UI language)
{
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $("#btn-mic"); let rec = null, base = "";
  if (!SR) btn.title = t("This browser does not support dictation (use Chrome or Edge)");
  btn.onclick = () => {
    if (!SR) { toast(t("Dictation needs Chrome or Edge"), "bad"); return; }
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = locale(); rec.interimResults = true; rec.continuous = true;
    base = $("#prompt").value ? $("#prompt").value.replace(/\s*$/, " ") : "";
    rec.onresult = (e) => {
      let finalTxt = "", interim = "";
      for (const r of e.results) (r.isFinal ? (finalTxt += r[0].transcript) : (interim += r[0].transcript));
      $("#prompt").value = base + finalTxt + interim;
      $("#prompt").dispatchEvent(new Event("input"));
    };
    rec.onerror = (e) => { if (e.error === "not-allowed") toast(t("Microphone permission was not granted"), "bad"); else if (e.error !== "aborted" && e.error !== "no-speech") toast(t("Speech recognition error: {error}", { error: e.error }), "bad"); };
    rec.onend = () => { rec = null; btn.setAttribute("aria-pressed", "false"); btn.title = t("Dictate"); $("#prompt").focus(); };
    rec.start(); btn.setAttribute("aria-pressed", "true"); btn.title = t("Listening; press again to finish");
  };
}

// ---- usage limits (as reported by Claude Code)
let usage = {};
const USAGE_NAMES = { five_hour: t("5-hour limit"), seven_day: t("Weekly limit"), seven_day_opus: t("Weekly Opus limit"), overage: t("Extra usage") };
const resetMs = (t) => (t ? (t < 1e12 ? t * 1000 : t) : null);
function fmtReset(at) {
  const ms = resetMs(at); if (!ms) return "";
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? t("today {time}", { time }) : d.toLocaleDateString(locale(), { weekday: "long" }) + " " + time;
}
const barCls = (u) => (u >= 0.9 ? "full" : u >= 0.7 ? "warn" : "");
function renderUsage() {
  const btn = $("#usage-btn");
  const rows = Object.entries(usage).filter(([, v]) => typeof v.utilization === "number");
  btn.hidden = !rows.length; if (!rows.length) return;
  const show = rows.filter(([k]) => k === "five_hour" || k === "seven_day");
  btn.innerHTML = (show.length ? show : rows).map(([k, v]) => `<span class="u-mini">${k === "five_hour" ? t("5 h") : k === "seven_day" ? t("Week") : escHtml(k)}<span class="u-bar ${barCls(v.utilization)}"><i style="width:${Math.round(v.utilization * 100)}%"></i></span>${t("{n}%", { n: Math.round(v.utilization * 100) })}</span>`).join("");
}
function openUsage(btn) {
  const pop = $("#usage-pop");
  const rows = Object.entries(usage).filter(([, v]) => typeof v.utilization === "number");
  pop.innerHTML = `<h4>${t("Usage")}</h4>` + rows.map(([k, v]) => `<div class="u-row"><div class="u-head"><span>${escHtml(USAGE_NAMES[k] || k)}</span><span>${t("{n}%", { n: Math.round(v.utilization * 100) })}</span></div>
    <span class="u-bar ${barCls(v.utilization)}"><i style="width:${Math.round(v.utilization * 100)}%"></i></span>
    <small>${v.resetsAt ? t("Resets: {when}", { when: fmtReset(v.resetsAt) }) : ""}${v.status === "rejected" ? " · " + t("limit reached") : ""}</small></div>`).join("") +
    `<p>${t("Claude Code reports this with every answer; last update {time}.", { time: new Date(Math.max(...rows.map(([, v]) => v.seenAt || 0))).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) })}</p>`;
  pop.hidden = false;
  const r = btn.getBoundingClientRect();
  pop.style.top = r.bottom + 8 + "px"; pop.style.bottom = ""; pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + "px";
  btn.setAttribute("aria-expanded", "true");
}
$("#usage-btn").onclick = toggle(openUsage);

// ================= images =================
const IMG_RE = /(?:[A-Za-z]:[\\/]|\/)[^\s`"'<>|*?]+?\.(?:png|jpe?g|gif|webp|bmp)\b/gi;
const isImagePath = (p) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(p || "").trim());
const findImagePaths = (t) => {
  const seen = new Map(); // different spellings of the same file (file:///C:/x, C:\x) count once
  for (const m of String(t || "").replace(/file:\/\/\/?/gi, "").matchAll(IMG_RE)) {
    const p = m[0].replace(/^\/(?=[A-Za-z]:)/, "");
    const key = p.replace(/\\/g, "/").toLowerCase();
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
};
const imgUrl = (p, id = selectedId) => `/api/agents/${id}/image?path=${encodeURIComponent(p)}`;
function gallery(paths, cls = "") {
  const g = document.createElement("div"); g.className = "gallery " + cls + (paths.length === 1 ? " solo" : "");
  for (const p of paths) {
    const b = document.createElement("button"); b.type = "button"; b.title = p;
    const img = new Image(); img.alt = baseName(p); img.loading = "lazy"; img.src = imgUrl(p);
    img.onerror = () => { b.className = "broken"; b.textContent = t("Image could not be opened: {name}", { name: baseName(p) }); };
    b.append(img); b.onclick = () => { if (!b.classList.contains("broken")) openLightbox(img.src, p); };
    g.append(b);
  }
  return g;
}
function openLightbox(src, cap) { $("#lb-img").src = src; $("#lb-cap").textContent = cap; $("#dlg-img").showModal(); }
$("#dlg-img").addEventListener("click", (e) => { if (e.target.id === "dlg-img") $("#dlg-img").close(); });

// ---- images to attach (paste / drag / clip)
let pending = []; // { name, dataUrl }
function renderAttachments() {
  pendingDocs = pendingDocs.filter((id) => lib.byId(id));
  const box = $("#attach-list"); box.innerHTML = ""; box.hidden = !pending.length && !pendingDocs.length;
  if (pendingDocs.length) box.append(docChips(pendingDocs.map((id) => lib.byId(id)), true));
  pending.forEach((a, i) => {
    const d = document.createElement("div"); d.className = "att";
    d.innerHTML = `<img alt=""><button type="button" aria-label="${t("Remove")}"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>`;
    d.querySelector("img").src = a.dataUrl; d.querySelector("img").alt = a.name;
    d.querySelector("button").onclick = () => { pending.splice(i, 1); renderAttachments(); };
    box.append(d);
  });
}
async function addFiles(files) {
  // non-images (PDF, Word, Excel…) are uploaded to the document library and attached as references
  const docsIn = files.filter((f) => !/^image\/(png|jpeg|gif|webp)$/.test(f.type));
  if (docsIn.length) {
    const up = await lib.upload(docsIn, { collection: "" });
    for (const d of up) addDoc(d.id);
    if (up.length) toast(up.length === 1 ? t("{name} added to the library and attached to the message", { name: up[0].name }) : t("{n} {n|document|documents} added to the library and attached to the message", { n: up.length }));
  }
  for (const f of files.filter((x) => !docsIn.includes(x))) {
    if (f.size > 20 * 1024 * 1024) { toast(t("{name} is larger than 20 MB", { name: f.name }), "bad"); continue; }
    if (pending.length >= 10) { toast(t("At most 10 images can be attached"), "bad"); break; }
    const dataUrl = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
    pending.push({ name: f.name || "yapistirilan.png", dataUrl });
  }
  renderAttachments(); $("#prompt").focus();
}
$("#btn-attach").onclick = toggle((btn) => openPicker(btn, {
  main: [["file", t("File from computer"), t("Images are added to the chat; documents like PDF, Word, Excel are also saved to the library")],
         ["doc", t("Document from library"), t("Shortcut: type # in the message")]],
  onPick: (k) => (k === "file" ? $("#file-input").click() : docMention()),
}));
$("#file-input").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };
$("#prompt").addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
  if (files.length) { e.preventDefault(); addFiles(files); }
});
{
  const zone = $("#panel-agent"); let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  zone.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; zone.classList.add("dropping"); });
  zone.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  zone.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; zone.classList.remove("dropping"); } });
  zone.addEventListener("drop", (e) => { e.preventDefault(); depth = 0; zone.classList.remove("dropping"); addFiles([...(e.dataTransfer?.files || [])]); });
}

// ---- documents from the library (referenced in the chat)
let pendingDocs = []; // document ids
function docChips(list, removable) {
  const wrap = document.createElement("div"); wrap.className = "doc-chips";
  list.forEach((d, i) => {
    const c = document.createElement(removable ? "div" : "button"); c.className = "doc-chip";
    if (!removable) { c.type = "button"; c.title = t("Open in library"); c.onclick = () => lib.byId(d.id) ? lib.open({ docId: d.id }) : toast(t("The document is no longer in the library"), "bad"); }
    c.innerHTML = `${badge({ kind: d.kind, ext: (d.name.split(".").pop() || "") })}<span class="dc-name"></span>`;
    c.querySelector(".dc-name").textContent = d.name;
    if (removable) {
      const x = document.createElement("button"); x.type = "button"; x.setAttribute("aria-label", t("Remove")); x.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
      x.onclick = () => { pendingDocs.splice(i, 1); renderAttachments(); }; c.append(x);
    }
    wrap.append(c);
  });
  return wrap;
}
function addDoc(id) {
  if (!pendingDocs.includes(id)) pendingDocs.push(id);
  renderAttachments();
}

// ================= chat =================
const chatEl = () => $("#chat");
const nearBottom = () => { const c = chatEl(); return c.scrollHeight - c.scrollTop - c.clientHeight < 120; };
let stick = true;
function addMsg(cls, html, text) {
  const d = document.createElement("div"); d.className = "msg " + cls;
  if (text !== undefined) d.textContent = text; else d.innerHTML = html;
  chatEl().append(d); return d;
}
function thinkBox(open) {
  const d = document.createElement("details"); d.className = "think"; d.open = open;
  d.innerHTML = `<summary>${open ? t("Thinking…") : t("Thought")}</summary><div class="tbody"></div>`;
  chatEl().append(d); return d;
}
function relToAgent(summary) {
  const a = current(); if (!a || !summary) return summary || "";
  const norm = (x) => x.replace(/\\/g, "/").toLowerCase();
  const root = norm(a.cwd).replace(/\/$/, "") + "/";
  const i = norm(summary).indexOf(root);
  return i === -1 ? summary : summary.slice(0, i) + summary.slice(i + root.length);
}
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
const ICON = {
  folder: `<svg viewBox="0 0 16 16"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5Z"/></svg>`,
  copy: `<svg viewBox="0 0 16 16"><rect x="5" y="5" width="8.5" height="8.5" rx="2"/><path d="M3.5 10.5h-.5A1.5 1.5 0 0 1 1.5 9V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5"/></svg>`,
  edit: `<svg viewBox="0 0 16 16"><path d="M11 2.5 13.5 5 6 12.5H3.5V10Z"/></svg>`,
  redo: `<svg viewBox="0 0 16 16"><path d="M13 3v4H9"/><path d="M13 7a5.5 5.5 0 1 0-1.4 4.7"/></svg>`,
};
function actions(d, list) {
  const bar = document.createElement("div"); bar.className = "msg-actions";
  for (const [icon, title, fn] of list) { const b = document.createElement("button"); b.type = "button"; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = ICON[icon]; b.onclick = (e) => { e.stopPropagation(); fn(); }; bar.append(b); }
  d.append(bar);
}
const copyText = (s) => navigator.clipboard.writeText(s).then(() => toast(t("Copied")), () => toast(t("Could not copy"), "bad"));

// ---- tool row + detail
function diffHtml(oldS = "", newS = "") {
  const o = String(oldS).split("\n"), n = String(newS).split("\n");
  return `<pre class="diff">${o.map((l) => `<span class="del">- ${escHtml(l)}</span>`).join("")}${n.map((l) => `<span class="add">+ ${escHtml(l)}</span>`).join("")}</pre>`;
}
function toolDetail(name, input) {
  if (!input) return "";
  if (name === "Edit") return diffHtml(input.old_string, input.new_string);
  if (name === "MultiEdit") return (input.edits || []).map((e) => diffHtml(e.old_string, e.new_string)).join("");
  if (name === "Write") return `<pre class="out">${escHtml(input.content || "")}</pre>`;
  if (name === "Bash") return `${input.description ? `<p class="tdesc">${escHtml(input.description)}</p>` : ""}<pre class="cmd">$ ${escHtml(input.command || "")}</pre>`;
  return "";
}
function toolRow(ev) {
  const d = addMsg("tool", `<div class="trow"><b></b><span></span><button type="button" class="topen" hidden title="${t("Show in folder")}">${ICON.folder}</button><em class="st">…</em></div><div class="tdetail" hidden></div>`);
  d.dataset.id = ev.toolUseId; d.dataset.name = ev.name;
  const TOOL_LABEL = { mcp__team__set_requirement_status: t("Scope"), mcp__team__save_requirements: t("Scope save"), mcp__team__list_requirements: t("Scope list"), mcp__team__notify_project: t("Sibling project") };
  d.querySelector("b").textContent = TOOL_LABEL[ev.name] || ev.name;
  const sp = d.querySelector("span"); sp.textContent = relToAgent(ev.summary); sp.title = ev.summary || "";
  const det = d.querySelector(".tdetail"); det.innerHTML = toolDetail(ev.name, ev.input);
  if (isImagePath(ev.summary)) d.dataset.img = ev.summary;
  if (FILE_TOOLS.has(ev.name) && ev.summary) {
    const o = d.querySelector(".topen"); o.hidden = false; o.onclick = (e) => { e.stopPropagation(); openInFolder(ev.summary); };
    const rel = relToAgent(ev.summary);
    if (rel !== ev.summary || !/^([a-z]:)?[\\/]/i.test(ev.summary)) {
      const c = document.createElement("button"); c.type = "button"; c.className = "topen"; c.title = t("Open in editor"); c.innerHTML = '<svg viewBox="0 0 16 16"><path d="M5.5 4 1.5 8l4 4M10.5 4l4 4-4 4"/></svg>';
      c.onclick = (e) => { e.stopPropagation(); openCode(current(), rel.replace(/\\/g, "/")); };
      o.before(c);
    }
  }
  d.querySelector(".trow").onclick = () => { if (det.innerHTML.trim()) { det.hidden = !det.hidden; d.classList.toggle("open", !det.hidden); } };
  if (det.innerHTML.trim()) d.classList.add("expandable");
  return d;
}

// ---- task list (TodoWrite): one card per turn, updated in place
let todoCard = null;
function renderTodos(todos) {
  if (!todoCard || !todoCard.isConnected) { todoCard = addMsg("todo", ""); }
  const done = todos.filter((t) => t.status === "completed").length;
  todoCard.innerHTML = `<div class="todo-head"><b>${t("Tasks")}</b><span>${done}/${todos.length}</span></div><ul>${todos.map((t) =>
    `<li class="${t.status}"><i></i><span>${escHtml(t.status === "in_progress" && t.activeForm ? t.activeForm : t.content)}</span></li>`).join("")}</ul>`;
  chatEl().append(todoCard); // move to the end on every update
}

// ---- plan approval (ExitPlanMode)
function planCard(plan) {
  const d = addMsg("plan", `<div class="card-head">${t("Plan ready")}</div><div class="plan-body"></div><div class="card-actions"><button type="button" class="btn primary sm" data-act="approve">${t("Approve the plan and apply it")}</button><button type="button" class="btn ghost sm" data-act="revise">${t("Request changes")}</button></div>`);
  d.querySelector(".plan-body").innerHTML = md(plan || "");
  d.querySelector('[data-act="approve"]').onclick = async () => {
    const a = current(); if (!a) return;
    if (permOf(a) === "plan") await patch({ permission: "acceptEdits" });
    sendPrompt({ text: t("I approve the plan, apply it.") });
    d.querySelector(".card-actions").innerHTML = `<span class="muted-ok">${t("Approved")}</span>`;
  };
  d.querySelector('[data-act="revise"]').onclick = () => { $("#prompt").value = t("Change this in the plan: "); $("#prompt").focus(); };
}

// ---- permission card (tools that could not run)
function denialCard(denials) {
  const specs = [...new Set(denials.flatMap((x) => x.specs || [x.spec]).filter(Boolean))];
  if (!specs.length) return;
  const d = addMsg("perm", `<div class="card-head">${t("Permission needed")}</div><p>${t("The agent wanted to do the following but had no permission:")}</p><ul></ul><div class="card-actions"><button type="button" class="btn primary sm" data-act="once">${t("Allow once and continue")}</button><button type="button" class="btn ghost sm" data-act="always">${t("Always allow")}</button></div>`);
  const ul = d.querySelector("ul");
  for (const x of denials) { const li = document.createElement("li"); li.innerHTML = `<b></b> <code></code>`; li.querySelector("b").textContent = x.tool; li.querySelector("code").textContent = x.input?.command || x.input?.file_path || x.spec; ul.append(li); }
  const done = (msg) => { d.querySelector(".card-actions").innerHTML = `<span class="muted-ok">${msg}</span>`; };
  d.querySelector('[data-act="once"]').onclick = () => { sendPrompt({ text: t("Permission granted, continue where you left off."), allowOnce: specs }); done(t("Allowed this time")); };
  d.querySelector('[data-act="always"]').onclick = async () => {
    const a = current(); if (!a) return;
    await patch({ allowedTools: [...(a.allowedTools || []), ...specs] });
    sendPrompt({ text: t("Permission granted, continue where you left off.") }); done(t("Always allowed"));
  };
}

// Stream chunks (text arriving word by word) are written to the DOM once per frame: no layout work per word
let deltaBuf = { text: "", think: "" }, deltaRaf = 0;
function flushDeltas() {
  deltaRaf = 0; const st = nearBottom();
  if (deltaBuf.think) { if (!liveThink) liveThink = thinkBox(true); liveThink.querySelector(".tbody").append(deltaBuf.think); deltaBuf.think = ""; }
  if (deltaBuf.text) { if (!liveBubble) liveBubble = addMsg("assistant", "", ""); liveBubble.append(deltaBuf.text); deltaBuf.text = ""; }
  if (st) chatEl().scrollTop = chatEl().scrollHeight;
}
function renderEvent(ev, replay = false) {
  if (!replay && (ev.type === "text_delta" || ev.type === "thinking_delta")) {
    deltaBuf[ev.type === "text_delta" ? "text" : "think"] += ev.text;
    if (!deltaRaf) deltaRaf = requestAnimationFrame(flushDeltas);
    return;
  }
  if (deltaRaf) { cancelAnimationFrame(deltaRaf); flushDeltas(); } // keep the order: flush the pending stream first
  if (!replay) stick = nearBottom();
  switch (ev.type) {
    case "user": {
      liveThink = liveBubble = null; todoCard = null;
      if (ev.auto === "team") { // the station brought the team results to the lead
        const n = document.createElement("div"); n.className = "msg team-note";
        n.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5"/></svg><span></span>`;
        n.querySelector("span").textContent = t("Team results arrived ({what}); the lead is evaluating them", { what: ev.text });
        chatEl().append(n); break;
      }
      const d = addMsg("user", "", ev.text);
      if ((ev.text || "").length > 700 || (ev.text || "").split("\n").length > 12) { // long message: fold it
        d.classList.add("long");
        const more = document.createElement("button"); more.type = "button"; more.className = "more"; more.textContent = t("Show all");
        more.onclick = () => { const open = d.classList.toggle("long"); more.textContent = open ? t("Show all") : t("Collapse"); };
        d.after(more);
      }
      if (ev.handoff) {
        const tag = document.createElement("div"); tag.className = "ho-tag";
        tag.innerHTML = `${ROLE_ICON[ev.handoff.role] || ""}<span></span>`;
        tag.querySelector("span").textContent = ev.handoff.task ? t("Task from the team lead") : t("Handoff from {role}; its last result attached", { role: ablative(meta.roles?.[ev.handoff.role]?.label || t("Team")) });
        d.prepend(tag);
      }
      if (ev.sibling) {
        const tag = document.createElement("div"); tag.className = "ho-tag";
        tag.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 10 10 6M5 7.5 3.5 9a2.5 2.5 0 0 0 3.5 3.5L8.5 11M11 8.5 12.5 7A2.5 2.5 0 0 0 9 3.5L7.5 5"/></svg><span></span>';
        tag.querySelector("span").textContent = t("Notification from {project}", { project: ablative(ev.sibling.project) }); d.prepend(tag);
      }
      if (ev.images?.length) d.append(gallery(ev.images));
      if (ev.docs?.length) d.append(docChips(ev.docs, false));
      actions(d, [["edit", t("Edit"), () => { $("#prompt").value = ev.text; $("#prompt").dispatchEvent(new Event("input")); pendingDocs = (ev.docs || []).map((x) => x.id); renderAttachments(); $("#prompt").focus(); }],
                  ["redo", t("Send again"), () => sendPrompt({ text: ev.text, images: ev.images || [], docs: (ev.docs || []).map((x) => x.id) })],
                  ["copy", t("Copy"), () => copyText(ev.text)]]);
      break;
    }
    case "thinking_delta":
      if (replay) break;
      if (!liveThink) liveThink = thinkBox(true);
      liveThink.querySelector(".tbody").textContent += ev.text; break;
    case "thinking": {
      const d = liveThink || thinkBox(false);
      d.querySelector(".tbody").textContent = ev.text; d.open = false; d.querySelector("summary").textContent = t("Thought");
      liveThink = null; break;
    }
    case "text_delta":
      if (replay) break;
      if (!liveBubble) liveBubble = addMsg("assistant", "", "");
      liveBubble.textContent += ev.text; break;
    case "text": {
      const d = liveBubble || addMsg("assistant", "");
      d.classList.add("rich"); d.innerHTML = md(ev.text); liveBubble = null;
      const imgs = findImagePaths(ev.text);
      if (imgs.length) d.append(gallery(imgs));
      actions(d, [["copy", t("Copy"), () => copyText(ev.text)]]);
      break;
    }
    case "team": if (ev.kind === "changes") changesCard(ev, ev.from); else teamCard(ev, replay); break;
    case "changes": changesCard(ev, ev.agentId); break;
    case "note": { const n = document.createElement("div"); n.className = "msg team-note"; n.textContent = ev.text; chatEl().append(n); break; }
    case "reverted": markReverted(ev.base); break;
    case "tool_use": {
      liveBubble = null;
      if (ev.name === "mcp__team__assign_task") break; // the team card already shows it
      if (ev.name === "TodoWrite" && ev.input?.todos) { renderTodos(ev.input.todos); break; }
      if (ev.name === "ExitPlanMode" && ev.input?.plan) { planCard(ev.input.plan); break; }
      toolRow(ev);
      break;
    }
    case "tool_result": {
      if (!document.querySelector(`.msg.tool[data-id="${CSS.escape(ev.toolUseId || "")}"]`)) break;
      const t = document.querySelector(`.msg.tool[data-id="${CSS.escape(ev.toolUseId || "")}"]`);
      if (!t) break;
      if (ev.isError) t.classList.add("err");
      const st = t.querySelector(".st"); st.textContent = ev.isError ? "✗" : "✓"; st.className = "st " + (ev.isError ? "bad" : "ok");
      const det = t.querySelector(".tdetail");
      const showOut = ev.content && !(t.dataset.name === "Edit" || t.dataset.name === "MultiEdit" || t.dataset.name === "Write") || ev.isError;
      if (showOut && ev.content) { const pre = document.createElement("pre"); pre.className = "out" + (ev.isError ? " bad" : ""); pre.textContent = ev.content; det.append(pre); t.classList.add("expandable"); }
      if (ev.isError && det.innerHTML.trim()) { det.hidden = false; t.classList.add("open"); }
      if (!ev.isError && t.dataset.img) { const row = document.createElement("div"); row.className = "gallery-row"; row.append(gallery([t.dataset.img])); t.after(row); }
      break;
    }
    case "result": {
      liveThink = liveBubble = null;
      if (ev.permissionDenials?.length) denialCard(ev.permissionDenials);
      const bits = [];
      if (ev.durationMs) bits.push(t("{n} s", { n: (ev.durationMs / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 }) }));
      if (ev.numTurns) bits.push(t("{n} {n|step|steps}", { n: ev.numTurns }));
      addMsg("result" + (ev.isError ? " bad" : ""), "", (ev.isError ? t("Error: {error}", { error: ev.text || ev.subtype }) : t("Completed")) + (bits.length ? ", " + bits.join(", ") : ""));
      todoCard = null;
      break;
    }
  }
  if (!replay && stick) chatEl().scrollTop = chatEl().scrollHeight;
  updateJump();
}

// ---- changes card: files changed in the task, diff, undo
const ST_NAME = { A: t("New"), M: t("Modified"), D: t("Deleted"), R: t("Renamed") };
function changesCard(ev, agentId) {
  if (ev.norepo) {
    const n = document.createElement("div"); n.className = "msg team-note";
    n.innerHTML = `<span>${t("This project is not a git repository; git is needed to see and undo changes.")}</span><button type="button" class="tc-open">${t("Initialize git")}</button>`;
    n.querySelector("button").onclick = async () => { try { await api(`/api/agents/${agentId}/git-init`, { method: "POST" }); toast(t("Git initialized; changes can be undone from the next task on")); n.remove(); } catch (err) { toast(err.message, "bad"); } };
    chatEl().append(n); return;
  }
  const a = agents.find((x) => x.id === agentId);
  const add = ev.files.reduce((s, f) => s + (f.add || 0), 0), del = ev.files.reduce((s, f) => s + (f.del || 0), 0);
  const d = document.createElement("div"); d.className = "msg chg-card"; d.dataset.base = ev.base;
  const who = a && teamOf(a).length > 1 && roleOf(a) !== "dev" ? `${roleLabel(a)} · ` : "";
  d.innerHTML = `<div class="chg-head"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.5L13 5v9.5H4zM6.5 9.5h3M8 8v3"/></svg>
    <b></b><span class="chg-stat"><i class="plus">+${add}</i> <i class="minus">−${del}</i></span>
    <button type="button" class="chg-undo" title="${t("Undo the changes from this task (does not touch changes you made before)")}">${t("Undo")}</button></div>
    <ul class="chg-files"></ul>${ev.more ? `<p class="chg-more">${t("+{n} more files", { n: ev.more })}</p>` : ""}`;
  d.querySelector("b").textContent = `${who}${t("{n} {n|file|files} changed", { n: ev.files.length + (ev.more || 0) })}`;
  const ul = d.querySelector(".chg-files");
  ev.files.forEach((f, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" class="chg-f"><span class="chg-s s-${f.status}" title="${ST_NAME[f.status] || f.status}">${f.status}</span><span class="chg-path"></span><span class="chg-n">${f.add == null ? t("binary") : `<i class="plus">+${f.add}</i> <i class="minus">−${f.del}</i>`}</span></button><div class="chg-diff" hidden></div>`;
    li.querySelector(".chg-path").textContent = f.status === "R" ? `${f.from} → ${f.path}` : f.path;
    if (i >= 6) li.hidden = true;
    li.querySelector(".chg-f").onclick = async () => {
      const box = li.querySelector(".chg-diff");
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false;
      if (!box.dataset.loaded) {
        box.textContent = t("Loading…");
        try {
          const r = await fetch(`/api/agents/${agentId}/diff?a=${ev.base}&b=${ev.head}&path=${encodeURIComponent(f.path)}`);
          const txt = await r.text();
          box.innerHTML = txt.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).slice(0, 800)
            .map((l) => `<span class="${l[0] === "+" ? "dl-add" : l[0] === "-" ? "dl-del" : l.startsWith("@@") ? "dl-hunk" : ""}">${escHtml(l) || " "}</span>`).join("") || t("No diff (binary file or only a permission change).");
          box.dataset.loaded = "1";
        } catch { box.textContent = t("Could not get the diff."); }
      }
    };
    ul.append(li);
  });
  if (ev.files.length > 6) { const b = document.createElement("button"); b.type = "button"; b.className = "chg-all"; b.textContent = t("Show all ({n})", { n: ev.files.length }); b.onclick = () => { ul.querySelectorAll("li[hidden]").forEach((x) => (x.hidden = false)); b.remove(); }; d.insertBefore(b, ul.nextSibling); }
  d.querySelector(".chg-undo").onclick = async () => {
    const n = ev.files.length + (ev.more || 0);
    if (!(await confirmBox({ title: t("Undo the changes in {n} {n|file|files}?", { n }), body: t("The files return to their state before this task. Changes you made before the task are not touched."), ok: t("Undo"), danger: true }))) return;
    const go = async (force) => api(`/api/agents/${agentId}/revert`, { method: "POST", body: { base: ev.base, head: ev.head, force } });
    try { await go(false); toast(t("Changes undone")); }
    catch (err) {
      if (err.status !== 409) { toast(err.message, "bad"); return; } // 409: some files changed again after the task
      if (await confirmBox({ title: t("Some files changed again afterwards"), body: err.message + ". " + t("If you undo anyway, those later changes are lost too."), ok: t("Undo anyway"), danger: true })) {
        try { await go(true); toast(t("Changes undone")); } catch (e2) { toast(e2.message, "bad"); }
      }
    }
  };
  chatEl().append(d);
}
function markReverted(base) {
  chatEl().querySelectorAll(`.chg-card[data-base="${CSS.escape(base || "")}"]`).forEach((d) => {
    d.classList.add("reverted"); const b = d.querySelector(".chg-undo"); b.textContent = t("Undone"); b.disabled = true;
  });
}

// ---- team cards: the lead assigned a task / a role finished
const liveCards = new Map(); // memberId -> task card (live progress)
function teamCard(ev, replay) {
  const m = agents.find((x) => x.id === (ev.to || ev.from));
  const label = meta.roles?.[ev.role]?.label || t("Team");
  if (ev.kind === "note") { const n = document.createElement("div"); n.className = "msg team-note"; n.textContent = ev.text; chatEl().append(n); return; }
  if (ev.kind === "sibling" || ev.kind === "sibling-result") {
    const d = document.createElement("div"); d.className = `msg team-card tc-${ev.kind === "sibling" ? "delegate" : "result"} tc-sib`;
    const icon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 10 10 6M5 7.5 3.5 9a2.5 2.5 0 0 0 3.5 3.5L8.5 11M11 8.5 12.5 7A2.5 2.5 0 0 0 9 3.5L7.5 5"/></svg>';
    if (ev.kind === "sibling") {
      d.innerHTML = `<div class="tc-head">${icon}<b></b></div><p class="tc-task"></p><button type="button" class="tc-open">${t("Open project")}</button>`;
      d.querySelector("b").textContent = t("Notification to {project}", { project: ev.project }); d.querySelector(".tc-task").textContent = ev.task;
    } else {
      d.innerHTML = `<details><summary>${icon}<b></b><span class="tc-st"><i class="dot ${ev.ok ? "st-done" : "st-error"}"></i><em>${ev.ok ? t("Replied") : t("Problem")}</em></span></summary><div class="tc-body"></div></details><button type="button" class="tc-open">${t("Open project")}</button>`;
      d.querySelector("b").textContent = t("{project} reply", { project: ev.project }); d.querySelector(".tc-body").innerHTML = md(ev.text || "");
    }
    d.querySelector(".tc-open").onclick = () => { const t = agents.find((x) => x.id === (ev.to || ev.from)); if (t) { selectAgent(t.id); station.focus(t.id); } };
    chatEl().append(d); return;
  }
  const d = document.createElement("div"); d.className = `msg team-card tc-${ev.kind}`;
  if (ev.kind === "delegate") {
    d.innerHTML = `<div class="tc-head">${ROLE_ICON[ev.role] || ""}<b></b><span class="tc-st"><i class="dot st-thinking"></i><em>${t("Queued")}</em></span></div><p class="tc-task"></p><button type="button" class="tc-open">${t("Open its chat")}</button>`;
    d.querySelector("b").textContent = t("Task for {role}", { role: dative(label) });
    d.querySelector(".tc-task").textContent = ev.task;
    if (m) { liveCards.set(m.id, d); if (!replay) updateTeamCard(m.id); else markCard(d, m.status === "thinking" || m.status === "tool" ? m.status : "done"); }
  } else {
    d.innerHTML = `<details><summary>${ROLE_ICON[ev.role] || ""}<b></b><span class="tc-st"><i class="dot ${ev.ok ? "st-done" : "st-error"}"></i><em>${ev.ok ? t("Done") : t("Finished with problems")}</em></span></summary><div class="tc-body rich"></div></details><button type="button" class="tc-open">${t("Open its chat")}</button>`;
    d.querySelector("b").textContent = t("{role} result", { role: label });
    d.querySelector(".tc-body").innerHTML = md(ev.text || "");
    // show a summary even when collapsed (first meaningful line)
    const ls = String(ev.text || "").split("\n").filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/^[>*\-\s|]+/, "").replace(/[*`_]/g, "").trim()).filter((l) => l.length > 3 && !/^-+$/.test(l));
    const peek = ls.find((l) => /geçti|kaldı|başarısız|başarılı|hata|sonuç|doğrula|bulgu|pass|fail|error|result|verif|finding/i.test(l)) || ls[0] || "";
    if (peek) { const p = document.createElement("p"); p.className = "tc-peek"; p.textContent = peek.length > 180 ? peek.slice(0, 179) + "…" : peek; d.querySelector("details").after(p); d.querySelector("details").addEventListener("toggle", (e) => { p.hidden = e.target.open; }); }
    const card = liveCards.get(ev.from); if (card) { markCard(card, ev.ok ? "done" : "error"); liveCards.delete(ev.from); }
  }
  d.querySelector(".tc-open").onclick = () => { if (m) { lastPick.set(teamKey(m), m.id); selectAgent(m.id); } };
  chatEl().append(d);
}
function markCard(card, st) {
  card.querySelector(".tc-st .dot").className = "dot st-" + st;
  card.querySelector(".tc-st em").textContent = st === "tool" || st === "thinking" ? t("Working") : st === "error" ? t("Finished with problems") : t("Done");
}
function updateTeamCard(id) {
  const card = liveCards.get(id); if (!card || !card.isConnected) return;
  const a = agents.find((x) => x.id === id); if (!a) return;
  const busy = a.status === "thinking" || a.status === "tool";
  card.querySelector(".tc-st .dot").className = "dot st-" + (busy ? a.status : a.status === "error" ? "error" : "thinking");
  card.querySelector(".tc-st em").textContent = busy ? (actText.get(id) || t("Working…")) : a.status === "done" ? t("Done") : t("Queued");
}

// ---- manual handoff: only used when a message is written with @Role
async function handoff(m, text, extra = {}) {
  const a = current();
  await sendPrompt({ text, handoffFrom: a.id, ...extra }, m);
  toast(t("Handed off to {role}", { role: dative(roleLabel(m)) }));
}

// clicks inside the chat: copy code, open a local link
chatEl().addEventListener("click", (e) => {
  const cp = e.target.closest(".code .copy");
  if (cp) { copyText(cp.closest(".code").querySelector("code").textContent); return; }
  const a = e.target.closest("a[data-open]");
  if (a) { e.preventDefault(); openInFolder(a.dataset.open); }
});
// jump-to-bottom button
function updateJump() { $("#jump").hidden = nearBottom(); }
chatEl().addEventListener("scroll", updateJump);
$("#jump").onclick = () => { chatEl().scrollTo({ top: chatEl().scrollHeight, behavior: "smooth" }); };

async function openInFolder(p) {
  if (!selectedId) return;
  try { await api(`/api/agents/${selectedId}/open`, { method: "POST", body: p ? { path: p } : {} }); toast(p ? t("{name} opened in its folder", { name: baseName(p) }) : t("Project folder opened")); }
  catch (err) { toast(err.message, "bad"); }
}
$("#btn-folder").onclick = () => { closePops(); openInFolder(); };

// ---- live strip
function updateActivity() {
  const strip = $("#activity"), a = current();
  const busy = !!a && (a.status === "thinking" || a.status === "tool");
  strip.hidden = !busy; if (!busy) return;
  const now = Date.now(), secs = Math.floor((now - (runStart.get(a.id) || now)) / 1000);
  const quiet = Math.floor((now - (lastEventAt.get(a.id) || now)) / 1000);
  let txt = actText.get(a.id) || t("Working…");
  if (quiet >= 10) txt += ", " + t("quiet for {n} s (still working)", { n: quiet });
  $("#act-text").textContent = txt;
  $("#act-time").textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
setInterval(updateActivity, 1000);

// ================= notifications =================
// ---- language (saved on the server so agents answer in the same language; the page reloads)
$("#btn-lang").textContent = currentLang().toUpperCase();
$("#btn-lang").onclick = (e) => {
  e.stopPropagation(); closePops();
  openPicker($("#btn-lang"), { main: Object.entries(LANGS).map(([id, name]) => [id, name]), current: currentLang(),
    onPick: async (id) => { try { await api("/api/prefs", { method: "PUT", body: { lang: id } }); } catch (err) { toast(err.message, "bad"); } } });
};
let notifyOn = false; try { notifyOn = localStorage.getItem("notify") === "1"; } catch {}
let unseen = 0;
function renderBell() {
  const b = $("#btn-notify"); const on = notifyOn && "Notification" in window && Notification.permission === "granted";
  b.setAttribute("aria-pressed", String(on)); b.classList.toggle("on", on);
  b.title = t("Notifications: recent events") + " · " + (on ? t("desktop notifications on") : t("desktop notifications off"));
  renderBellBadge();
}
// ---- notification centre: recent events when the bell is clicked; desktop notifications are toggled from this panel
const notifs = lsGet("ecelon.notifs", []);
const saveNotifs = () => lsSet("ecelon.notifs", notifs.slice(0, 40));
function renderBellBadge() {
  const n = notifs.filter((x) => !x.read).length; let b = $("#btn-notify .nb");
  if (!b) { b = document.createElement("span"); b.className = "nb"; $("#btn-notify").append(b); }
  b.textContent = n > 9 ? "9+" : n || ""; b.hidden = !n;
}
let bellPop = null;
function closeBell() { bellPop?.remove(); bellPop = null; }
document.addEventListener("pointerdown", (e) => { if (bellPop && !bellPop.contains(e.target) && !e.target.closest("#btn-notify")) closeBell(); }, true);
function openBell() {
  if (bellPop) return closeBell();
  const m = document.createElement("div"); m.className = "pop lib-menu bell-pop";
  const on = notifyOn && "Notification" in window && Notification.permission === "granted";
  const ICON = { done: "✓", permission: "⚠", error: "✕" };
  m.innerHTML = `<p class="lm-title">${t("Notifications")}</p>` + (notifs.length ? notifs.slice(0, 30).map((x, i) => `<button type="button" class="bn-item k-${x.kind}${x.read ? "" : " unread"}" data-i="${i}"><i>${ICON[x.kind] || "•"}</i><span><b>${escHtml(x.title)}</b><small>${escHtml(x.body || "")}</small></span><em>${new Date(x.at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}</em></button>`).join("")
    : `<p class="bn-empty">${t("No notifications yet. They appear here when a team finishes its work, asks for permission or hits an error.")}</p>`) +
    `<div class="bn-foot"><button type="button" data-bn="desk">${on ? t("Turn desktop notifications off") : t("Turn desktop notifications on")}</button>${notifs.length ? `<button type="button" data-bn="clear">${t("Clear")}</button>` : ""}</div>`;
  document.body.append(m); bellPop = m;
  const r = $("#btn-notify").getBoundingClientRect(); m.style.left = Math.max(8, r.right - m.offsetWidth) + "px"; m.style.top = r.bottom + 8 + "px";
  m.onclick = async (e) => {
    const it = e.target.closest(".bn-item");
    if (it) { const x = notifs[+it.dataset.i]; closeBell(); const a = agents.find((q) => q.id === x.agentId); if (a) { selectAgent(a.id); station.focus(a.id); } else toast(t("This project is no longer in the station"), "bad"); return; }
    const k = e.target.closest("[data-bn]")?.dataset.bn;
    if (k === "clear") { notifs.length = 0; saveNotifs(); renderBellBadge(); closeBell(); }
    if (k === "desk") { closeBell(); await toggleDesktop(); }
  };
  for (const x of notifs) x.read = true; saveNotifs(); renderBellBadge();
}
$("#btn-notify").onclick = () => openBell();
async function toggleDesktop() {
  if (!("Notification" in window)) { toast(t("This browser does not support notifications"), "bad"); return; }
  if (notifyOn && Notification.permission === "granted") { notifyOn = false; toast(t("Notifications turned off")); }
  else {
    const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (p === "granted") { notifyOn = true; toast(t("Notifications on")); }
    else if (p === "default") { notifyOn = false; toast(t("The permission prompt was closed; press the bell again to enable it")); }
    else { // blocked earlier: the browser will not ask again, it must be enabled in the settings
      notifyOn = false;
      const edge = /Edg\//.test(navigator.userAgent), url = `${edge ? "edge" : "chrome"}://settings/content/siteDetails?site=${encodeURIComponent(location.origin)}`;
      try { await navigator.clipboard.writeText(url); } catch {}
      await confirmBox({ title: t("Notifications are blocked"), ok: t("OK"),
        body: t("The browser no longer asks this site; you need to enable the permission by hand once. 1) Open 'Site settings' (or 'App info' → 'Site settings') from the ⋮ menu at the top right of the window. 2) Set the Notifications row to 'Allow'. 3) Press F5 in this window and click the bell again. Shortcut: the address of the settings page was copied to the clipboard; you can paste it into the address bar of a normal {browser} tab: {url}", { browser: edge ? "Edge" : "Chrome", url }) });
    }
  }
  try { localStorage.setItem("notify", notifyOn ? "1" : "0"); } catch {}
  renderBell();
};
const looking = () => document.hasFocus() && !document.hidden;
window.addEventListener("focus", () => { unseen = 0; document.title = "Ecelon Station"; });
function handleNotify(ev) {
  const a = agents.find((x) => x.id === ev.agentId); if (!a) return;
  const seen = looking() && current() && teamKey(current()) === teamKey(a); // if you are already looking, count it as read
  notifs.unshift({ agentId: ev.agentId, kind: ev.kind, title: ev.title, body: (ev.body || "").slice(0, 160), at: Date.now(), read: !!seen });
  notifs.length = Math.min(notifs.length, 40); saveNotifs(); renderBellBadge();
  const same = current() && teamKey(current()) === teamKey(a);
  const icon = ev.kind === "permission" ? t("Waiting for permission") : ev.kind === "error" ? t("Error") : t("Done");
  if (looking()) {
    if (same) return; // you are already looking
    toast(`${ev.title}: ${ev.kind === "done" ? t("work finished") : icon.toLowerCase()}`, ev.kind === "error" ? "bad" : "", { label: t("Open"), fn: () => { selectAgent(leadOf(a).id === a.id ? a.id : a.id); station.focus(a.id); } });
    return;
  }
  unseen++; document.title = `(${unseen}) Ecelon Station`;
  if (notifyOn && "Notification" in window && Notification.permission === "granted") {
    const n = new Notification(`${icon} · ${ev.title}`, { body: ev.body, icon: "/icon-256.png", tag: ev.agentId, renotify: true });
    n.onclick = () => { window.focus(); selectAgent(a.id); station.focus(a.id); n.close(); };
  }
}
renderBell();

// ================= WebSocket =================
// On disconnect the page is not reloaded: your typed message and open panels stay; on reconnect the state is refreshed from the server
let wsWasClosed = false, wsLostAt = 0, wsTimer = 0, wsBannerT = 0;
function wsBanner(on) {
  let b = $("#ws-banner");
  if (!on) { b?.remove(); return; }
  if (b) return;
  b = document.createElement("div"); b.id = "ws-banner"; b.setAttribute("role", "status");
  b.innerHTML = `<span class="pulse" aria-hidden="true"><i></i><i></i><i></i></span><span>${t("Server connection lost; reconnecting… (the server may be restarting)")}</span>`;
  document.body.append(b);
}
async function resync() {
  wsBanner(false);
  try {
    await refresh();
    if (selectedId && current()) await loadChat();
    usage = await api("/api/usage").catch(() => usage); renderUsage();
    lib.load().catch(() => {}); gitSoon(); refreshRunCounts(); reqsUI.refresh(); if (current()) renderReqsBadge();
    for (const id of queue.keys()) flushQueue(id);
    toast(t("Reconnected to the server"));
  } catch { location.reload(); } // if even the refresh fails, last resort: reload
}
function connectWS() {
  let ws;
  try { ws = new WebSocket(`ws://${location.host}/ws`); } catch { wsTimer = setTimeout(connectWS, 3000); return; }
  ws.onopen = () => { clearTimeout(wsBannerT); wsBannerT = 0; if (wsWasClosed) { wsWasClosed = false; resync(); } };
  ws.onmessage = (m) => {
    let ev; try { ev = JSON.parse(m.data); } catch { return; }
    if (ev.type === "reload") { location.reload(); return; }
    if (ev.type === "agents_changed") { refresh(); gitSoon(); return; }
    if (ev.type === "usage") { usage = ev.usage || {}; renderUsage(); return; }
    if (ev.type === "library") { lib.load().catch(() => {}); return; }
    if (ev.type === "notify") { bcEvent(ev); handleNotify(ev); return; }
    if (ev.type === "git") { gitUI.onEvent(ev); gitSoon(); return; }
    if (ev.type === "fs") { edUI.onFs(ev); return; }
    if (ev.type === "run-out") { runUI.onEvent(ev); return; }
    if (ev.type === "run") { runUI.onEvent(ev); if (ev.status) { if (ev.status === "running") runCounts[ev.team] = (runCounts[ev.team] || 0); refreshRunCounts(); } return; }
    if (ev.type === "reqs") { reqsUI.onEvent(ev); if (current() && teamKey(current()) === ev.team) renderReqsBadge(); return; }
    if (ev.type === "library-tool") { lib.onTool(ev); return; }
    if (ev.agentId) {
      lastEventAt.set(ev.agentId, Date.now());
      if (ev.type === "user") { runStart.set(ev.agentId, Date.now()); actText.set(ev.agentId, t("Starting…")); }
      else if (ev.type === "thinking_delta") actText.set(ev.agentId, t("Thinking…"));
      else if (ev.type === "text_delta") actText.set(ev.agentId, t("Writing a reply…"));
      else if (ev.type === "tool_result") actText.set(ev.agentId, t("Evaluating the result…"));
      else if (ev.type === "tool_use") {
        const doing = ev.name === "TodoWrite" ? (ev.input?.todos || []).find((t) => t.status === "in_progress") : null;
        lastTool.set(ev.agentId, doing ? (doing.activeForm || doing.content) : toolPhrase(ev.name, ev.summary));
      }
    }
    if (ev.type === "status") {
      bcEvent(ev);
      station.setStatus(ev.agentId, ev.status);
      station.setActivity(ev.agentId, ev.status === "thinking" ? t("thinking…") : ev.status === "tool" ? (lastTool.get(ev.agentId) || ev.tool || t("working")) : "");
      const a = agents.find((x) => x.id === ev.agentId);
      if (a) { a.status = ev.status; renderList(); if (current() && teamKey(a) === teamKey(current())) renderTeamTabs(); }
      if (ev.status === "tool") actText.set(ev.agentId, t("Tool running: {tool}", { tool: lastTool.get(ev.agentId) || ev.tool || "" }));
      else if (ev.status === "thinking" && ![t("Writing a reply…"), t("Thinking…"), t("Starting…")].includes(actText.get(ev.agentId))) actText.set(ev.agentId, t("Thinking…"));
      else if (ev.status === "done" || ev.status === "error") {
        runStart.delete(ev.agentId); actText.delete(ev.agentId); flushQueue(ev.agentId);
        if (a && (!current() || teamKey(current()) !== teamKey(a) || !looking())) { unread.add(teamKey(a)); saveUnread(); renderList(); }
      }
      if (ev.agentId === selectedId) setStatus(ev.status);
      updateActivity(); updateTeamCard(ev.agentId); reqsUI.refresh(); edUI.onStatus(ev);
      return;
    }
    if (ev.agentId && ev.agentId === selectedId && (!ev.convId || !loadedConv || ev.convId === loadedConv)) {
      if (loadingChat?.agentId === ev.agentId) { loadingChat.evs.push(ev); return; }
      if (ev.type === "user") $("#chat .chat-empty")?.remove();
      renderEvent(ev);
    }
  };
  ws.onclose = () => {
    if (!wsWasClosed) { wsWasClosed = true; wsLostAt = Date.now(); wsBannerT = setTimeout(() => wsBanner(true), 3000); } // on a short outage (server restarting with --watch) pass without showing the banner
    clearTimeout(wsTimer); wsTimer = setTimeout(connectWS, Math.min(4000, 1500 + (Date.now() - wsLostAt) / 4));
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

// readable tool phrase for the 3D bubble and the strip ("Bash npm test 2>&1 | tail" → "Command: npm test")
function toolPhrase(name, summary = "") {
  const f = baseName(summary);
  const cmd = String(summary || "").split(/\s*(?:\|\||&&|\||;|2>&1)\s*/)[0].trim();
  const M = { Read: t("Reading: {file}", { file: f }), Edit: t("Editing: {file}", { file: f }), MultiEdit: t("Editing: {file}", { file: f }), Write: t("Writing: {file}", { file: f }), NotebookEdit: t("Editing: {file}", { file: f }),
    Bash: t("Command: {cmd}", { cmd }), PowerShell: t("Command: {cmd}", { cmd }), Grep: t("Searching: {query}", { query: summary }), Glob: t("Looking at files"), WebFetch: t("Reading a web page"), WebSearch: t("Searching the web"),
    mcp__team__assign_task: t("Assigning a task"), mcp__team__notify_project: t("Writing to a sibling project"), mcp__team__verify_requirement: t("Verifying"), mcp__team__save_requirements: t("Saving the scope"),
    mcp__team__document_sections: t("Reading the document"), mcp__team__set_requirement_status: t("Updating the scope") };
  return (M[name] || (name.startsWith("mcp__team__") ? t("Scope") : `${name} ${f}`)).trim();
}

// ================= sending messages =================
// queued messages are kept in the browser: they survive a page reload (F5)
const queue = new Map(lsGet("ecelon.queue", []).filter((e) => Array.isArray(e) && typeof e[0] === "string" && Array.isArray(e[1])));
const saveQueue = () => lsSet("ecelon.queue", [...queue].filter(([, q]) => q.length));
const isBusy = (a) => a && (a.status === "thinking" || a.status === "tool");
async function sendPrompt({ text = "", images = [], allowOnce = [], docs = [], handoffFrom }, agent = current()) {
  const a = agent; if (!a) return;
  if (isBusy(a)) { // like VS Code: queue while busy
    const q = queue.get(a.id) || []; const item = { text, images, allowOnce, docs, handoffFrom };
    q.push(item); queue.set(a.id, q); saveQueue();
    if (a.id === selectedId) renderQueue();
    toast(t("Queued; it will be sent when the agent finishes")); return;
  }
  a.status = "thinking"; runStart.set(a.id, Date.now()); lastEventAt.set(a.id, Date.now()); actText.set(a.id, t("Starting…"));
  if (a.id === selectedId) { setStatus("thinking"); updateActivity(); }
  try { await api(`/api/agents/${a.id}/prompt`, { method: "POST", body: { text, images, allowOnce, docs, handoffFrom } }); return true; }
  catch (err) {
    a.status = "idle"; if (a.id === selectedId) { setStatus("idle"); updateActivity(); }
    if (err.status === 409 || /meşgul|çalışıyor|busy|running/i.test(err.message)) { // still busy on the server: queue the message, it goes when done
      const q = queue.get(a.id) || []; q.unshift({ text, images, allowOnce, docs, handoffFrom }); queue.set(a.id, q); saveQueue();
      if (a.id === selectedId) renderQueue(); a.status = "thinking"; if (a.id === selectedId) setStatus("thinking");
      toast(t("The agent is still working; the message was queued"));
    } else toast(err.message, "bad");
    return false;
  }
}
function renderQueue() {
  const box = $("#queue"); const q = queue.get(selectedId) || [];
  box.hidden = !q.length; box.innerHTML = "";
  q.forEach((it, i) => {
    const r = document.createElement("div"); r.className = "q-item";
    r.innerHTML = `<span class="q-badge">${t("Queued")}</span><span class="q-text"></span><button type="button" title="${t("Remove from queue")}" aria-label="${t("Remove from queue")}"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>`;
    r.querySelector(".q-text").textContent = it.text || (it.docs?.length ? t("{n} {n|document|documents}", { n: it.docs.length }) : t("{n} {n|image|images}", { n: it.images.length }));
    r.querySelector("button").onclick = () => { q.splice(i, 1); saveQueue(); renderQueue(); };
    box.append(r);
  });
}
let flushing = new Set();
function flushQueue(agentId) {
  const q = queue.get(agentId); if (!q?.length || flushing.has(agentId)) return;
  const a = agents.find((x) => x.id === agentId); if (!a || isBusy(a)) return;
  flushing.add(agentId);
  setTimeout(async () => {
    try {
      const next = q[0]; if (!next) return;
      // send first, keep it out of the queue only on success: the message must not be lost on 409 (busy) or a network error
      q.shift(); saveQueue(); if (agentId === selectedId) renderQueue();
      await sendPrompt(next, a);
    } finally { flushing.delete(agentId); }
  }, 400);
}

$("#prompt-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#prompt").value.trim(); const a = current();
  if ((!text && !pending.length && !pendingDocs.length) || !a) return;
  const toSend = pending, docs = pendingDocs; pending = []; pendingDocs = []; renderAttachments();
  // "@Tester try this" → the message goes to the tester, with that role's last result attached
  const low = text.toLocaleLowerCase(locale());
  const to = teamOf(a).find((m) => m.id !== a.id && (low.startsWith("@" + roleLabel(m).toLocaleLowerCase(locale()) + " ") || low === "@" + roleLabel(m).toLocaleLowerCase(locale())));
  $("#prompt").value = ""; $("#prompt").style.height = ""; closeMention();
  try {
    const images = [];
    for (const f of toSend) images.push((await api(`/api/agents/${a.id}/upload`, { method: "POST", body: { name: f.name, dataUrl: f.dataUrl } })).path);
    if (to) {
      $("#prompt").value = ""; $("#prompt").style.height = ""; closeMention();
      const rest = text.slice(roleLabel(to).length + 1).trim() || meta.roles?.[roleOf(to)]?.handoff || "";
      await handoff(to, rest, { images: images.length ? images : [], docs });
      return;
    }
    await sendPrompt({ text, images, docs }, a);
  } catch (err) {
    toast(err.message, "bad");
    if (!$("#prompt").value) { $("#prompt").value = text; pending = toSend; pendingDocs = docs; renderAttachments(); }
  }
});

// ---- @file suggestions
let mention = null; // { start, items, idx }
function closeMention() { mention = null; mentionSeq++; $("#mention-pop").hidden = true; }
let mentionSeq = 0;
async function updateMention() {
  const ta = $("#prompt"), a = current(); if (!a) return;
  const seq = ++mentionSeq;
  const upto = ta.value.slice(0, ta.selectionStart);
  const h = /(^|\s)#([^\s#]*)$/.exec(upto);
  if (h) { // # → documents in the library
    mention = { start: ta.selectionStart - h[2].length - 1, items: lib.find(h[2], 8), idx: 0, docs: true, q: h[2] }; drawMention(); return;
  }
  const m = /(^|\s)@([^\s@]*)$/.exec(upto);
  if (!m) { closeMention(); return; }
  const q = m[2], start = ta.selectionStart - q.length - 1;
  const roleItems = start === 0 ? teamOf(a).filter((x) => x.id !== a.id && roleLabel(x).toLocaleLowerCase(locale()).startsWith(q.toLocaleLowerCase(locale()))).map((x) => ({ member: x })) : [];
  const found = await api(`/api/agents/${a.id}/files?q=${encodeURIComponent(q)}`).catch(() => []);
  if (seq !== mentionSeq) return; // the user kept typing; an old search result must not overwrite the list
  const items = [...roleItems, ...found];
  if (!items.length) { closeMention(); return; }
  mention = { start, items, idx: 0 }; drawMention();
}
function drawMention() {
  const pop = $("#mention-pop");
  if (mention.docs) {
    pop.innerHTML = `<p class="mn-head">${t("Document library")}</p>` + (mention.items.length
      ? mention.items.map((d, i) => `<button type="button" class="mn-item mn-doc${i === mention.idx ? " on" : ""}" data-i="${i}">${badge(d)}<b>${escHtml(d.name)}</b><span>${escHtml([lib.collName(d.collection), d.tags.join(", ")].filter(Boolean).join(" · ") || KIND[d.kind].label)}</span></button>`).join("")
      : `<p class="mn-empty">${lib.docs().length ? t("No document matches '{q}'.", { q: escHtml(mention.q) }) : t("The library is empty. Open it to upload documents.")}</p>`)
      + `<button type="button" class="mn-foot" data-lib="1">${t("Open the document library")}</button>`;
  } else
  pop.innerHTML = mention.items.map((f, i) => f.member
    ? `<button type="button" class="mn-item mn-role${i === mention.idx ? " on" : ""}" data-i="${i}">${ROLE_ICON[roleOf(f.member)]}<b>${escHtml(roleLabel(f.member))}</b><span>${t("Hand off to a teammate · this role's last result is attached")}</span></button>`
    : `<button type="button" class="mn-item${i === mention.idx ? " on" : ""}" data-i="${i}"><b>${escHtml(baseName(f))}</b><span>${escHtml(f)}</span></button>`).join("");
  pop.querySelector("[data-lib]")?.addEventListener("mousedown", (e) => { e.preventDefault(); const ta = $("#prompt"); ta.value = ta.value.slice(0, mention.start) + ta.value.slice(ta.selectionStart); closeMention(); lib.open(); });
  pop.querySelectorAll(".mn-item").forEach((b) => b.onmousedown = (e) => { e.preventDefault(); pickMention(+b.dataset.i); });
  const r = $(".composer").getBoundingClientRect();
  pop.hidden = false; pop.style.left = r.left + "px"; pop.style.width = r.width + "px"; pop.style.bottom = innerHeight - r.top + 8 + "px";
  pop.querySelector(".on")?.scrollIntoView({ block: "nearest" });
}
function pickMention(i) {
  const ta = $("#prompt"), f = mention.items[i];
  if (mention.docs) {
    if (!f) { closeMention(); return; }
    ta.value = ta.value.slice(0, mention.start) + ta.value.slice(ta.selectionStart).replace(/^ /, "");
    ta.setSelectionRange(mention.start, mention.start); closeMention(); addDoc(f.id); ta.focus(); return;
  }
  const ins = f.member ? roleLabel(f.member) : f;
  ta.value = ta.value.slice(0, mention.start) + "@" + ins + " " + ta.value.slice(ta.selectionStart);
  const pos = mention.start + ins.length + 2; ta.setSelectionRange(pos, pos); closeMention(); ta.focus();
}

$("#prompt").addEventListener("keydown", (e) => {
  if (mention && !$("#mention-pop").hidden) {
    const n = Math.max(1, mention.items.length);
    if (e.key === "ArrowDown") { e.preventDefault(); mention.idx = (mention.idx + 1) % n; drawMention(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); mention.idx = (mention.idx - 1 + n) % n; drawMention(); return; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mention.idx); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMention(); return; }
  }
  if (e.key === "ArrowUp" && !e.target.value) { // recall the last message
    const last = [...document.querySelectorAll("#chat .msg.user")].pop();
    if (last) { e.preventDefault(); e.target.value = last.firstChild?.textContent || ""; e.target.dispatchEvent(new Event("input")); }
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#prompt-form").requestSubmit(); }
});
$("#prompt").addEventListener("input", (e) => { const t = e.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 200) + "px"; updateMention(); });
$("#prompt").addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== $("#prompt")) closeMention(); }, 150));

// ---- rename the agent (click the title)
{
  const h = $("#a-name");
  h.title = t("Click to rename"); h.tabIndex = 0;
  const start = () => { if (h.isContentEditable) return; h.dataset.old = h.textContent; h.contentEditable = "true"; h.focus(); document.getSelection().selectAllChildren(h); };
  const finish = async (save) => {
    if (!h.isContentEditable) return;
    h.contentEditable = "false";
    const v = h.textContent.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!save || !v || v === h.dataset.old) { h.textContent = h.dataset.old; return; }
    await patch({ name: v }); toast(t("Renamed to {name}", { name: v }));
  };
  h.addEventListener("click", start);
  h.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } });
  h.addEventListener("blur", () => finish(true));
}
$("#btn-stop").onclick = () => api(`/api/agents/${selectedId}/stop`, { method: "POST" }).then(() => toast(t("Stopped"))).catch((err) => toast(err.message, "bad"));
$("#btn-close").onclick = closePanel;

// ---- conversations (like VS Code: new + history)
async function newConversation() {
  closePops(); const a = current(); if (!a) return;
  const prev = a.activeConv;
  const hadChat = !!$("#chat .msg");
  try {
    await api(`/api/agents/${a.id}/convs`, { method: "POST" }); await refresh(); $("#prompt").focus();
    if (hadChat && prev) toast(t("New conversation opened · the previous one is in History"), "", { label: t("Go back"), fn: async () => { try { await api(`/api/agents/${a.id}/convs/${prev}/activate`, { method: "POST" }); await refresh(); } catch (err) { toast(err.message, "bad"); } } });
  } catch (err) { toast(err.message, "bad"); }
}
$("#btn-new").onclick = newConversation;
const ago = (ts) => {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t("just now"); if (s < 3600) return t("{n} min ago", { n: Math.floor(s / 60) }); if (s < 86400) return t("{n} h ago", { n: Math.floor(s / 3600) });
  if (s < 7 * 86400) return t("{n} {n|day|days} ago", { n: Math.floor(s / 86400) });
  return new Date(ts).toLocaleDateString(locale(), { day: "numeric", month: "short" });
};
async function openHistory(btn) {
  const a = current(); if (!a) return;
  const pop = $("#history-pop");
  const convs = await api(`/api/agents/${a.id}/convs`).catch(() => []);
  pop.innerHTML = `<div class="h-head"><b>${t("Past conversations")}</b><button type="button" class="btn primary sm" id="h-new">${t("New conversation")}</button></div>` +
    (convs.length ? convs.map((c) => `<div class="h-item${c.active ? " on" : ""}" data-id="${c.id}" role="menuitem" tabindex="0"><span class="h-title"></span><span class="h-time">${ago(c.updatedAt)}</span><button type="button" class="h-del" title="${t("Delete")}" aria-label="${t("Delete")}"><svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5"/></svg></button></div>`).join("") : `<p class="h-empty">${t("No conversations yet.")}</p>`);
  pop.querySelectorAll(".h-item").forEach((el, k) => {
    el.querySelector(".h-title").textContent = convs[k].title || t("Untitled conversation");
    const go = async () => {
      closePops(); if (convs[k].active) return;
      try { await api(`/api/agents/${a.id}/convs/${convs[k].id}/activate`, { method: "POST" }); await refresh(); }
      catch (err) { toast(err.message, "bad"); }
    };
    el.onclick = go; el.onkeydown = (e) => { if (e.key === "Enter") go(); };
    el.querySelector(".h-del").onclick = async (e) => {
      e.stopPropagation();
      const ok = await confirmBox({ title: t("Delete the conversation?"), body: t("'{title}' is removed from the screen and the records. Project files are not touched.", { title: convs[k].title || t("Untitled conversation") }), ok: t("Delete"), danger: true });
      if (!ok) return;
      try { await api(`/api/agents/${a.id}/convs/${convs[k].id}`, { method: "DELETE" }); await refresh(); if (convs[k].active) loadChat(); toast(t("Conversation deleted")); }
      catch (err) { toast(err.message, "bad"); }
    };
  });
  pop.querySelector("#h-new").onclick = newConversation;
  pop.hidden = false;
  const r = btn.getBoundingClientRect();
  pop.style.top = r.bottom + 8 + "px"; pop.style.bottom = ""; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
  btn.setAttribute("aria-expanded", "true");
}
$("#btn-history").onclick = toggle(openHistory);
async function removeProject(a) {
  const n = teamOf(a).length;
  const ok = await confirmBox({ title: t("Remove {name} from the station?", { name: a.name }), body: `${n > 1 ? t("The module and its team of {n} are removed.", { n }) : t("The module and its agent are removed.")} ${t("Your project folder is not deleted; you can add it again any time.")}`, ok: t("Remove project"), danger: true });
  if (!ok) return;
  try { await api(`/api/agents/${a.id}?whole=1`, { method: "DELETE" }); } catch (err) { toast(err.message, "bad"); return; }
  if (current() && teamKey(current()) === teamKey(a)) closePanel();
  await refresh(); toast(t("{name} removed", { name: a.name }));
}
$("#btn-remove").onclick = () => { closePops(); if (current()) removeProject(leadOf(current())); };
$("#btn-remove-role").onclick = async () => {
  closePops();
  const a = current(); const rest = teamOf(a).filter((m) => m.id !== a.id);
  const ok = await confirmBox({ title: t("Remove {role} from the team?", { role: roleLabel(a) }), body: t("This role's session and chat history are removed from the list; the project and the other roles are not affected. You can add it again later."), ok: t("Remove role"), danger: true });
  if (!ok) return;
  try { await api(`/api/agents/${a.id}`, { method: "DELETE" }); } catch (err) { toast(err.message, "bad"); return; }
  const next = rest.find((m) => roleOf(m) === "dev") || rest[0];
  await refresh(); if (next) selectAgent(next.id); toast(t("{role} removed from the team", { role: roleLabel(a) }));
};

// ================= add project =================
function resetPick() {
  $("#pick-folder").classList.remove("chosen", "busy");
  $("#pick-title").textContent = t("Choose a folder from your computer");
  $("#pick-sub").textContent = t("A folder dialog opens; you can pick from quick access");
}
const openAdd = () => {
  $("#add-err").textContent = ""; $("#add-cwd").value = ""; $("#add-name").value = ""; resetPick();
  $("#dlg-add").showModal();
};
$("#btn-add").onclick = openAdd;
document.querySelector('[data-action="add"]').onclick = openAdd;
$("#pick-folder").onclick = async () => {
  const btn = $("#pick-folder"); if (btn.classList.contains("busy")) return;
  btn.classList.add("busy"); $("#pick-sub").textContent = t("The window is open; choose the folder and press OK");
  $("#add-err").textContent = "";
  try {
    const last = agents.at(-1)?.cwd || "";
    const start = last ? last.slice(0, Math.max(last.lastIndexOf("\\"), last.lastIndexOf("/"))) : "";
    const r = await api("/api/pick-folder", { method: "POST", body: { start } });
    btn.classList.remove("busy");
    if (r.cancelled) { if (!$("#add-cwd").value) resetPick(); else $("#pick-sub").textContent = $("#add-cwd").value; return; }
    $("#add-cwd").value = r.path;
    if (!$("#add-name").value) $("#add-name").value = r.name;
    btn.classList.add("chosen"); $("#pick-title").textContent = r.name; $("#pick-sub").textContent = r.path;
    $("#add-ok").focus();
  } catch (err) { btn.classList.remove("busy"); resetPick(); $("#add-err").textContent = err.message; }
};
$("#add-cwd").addEventListener("input", (e) => {
  const v = e.target.value.trim(); $("#add-err").textContent = "";
  if (v) { $("#pick-folder").classList.add("chosen"); $("#pick-title").textContent = baseName(v); $("#pick-sub").textContent = v; } else resetPick();
});
$("#add-form").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const cwd = $("#add-cwd").value.trim();
  if (!cwd) { $("#add-err").textContent = t("Choose a folder first."); return; }
  try {
    const a = await api("/api/agents", { method: "POST", body: { cwd, name: $("#add-name").value.trim() || undefined } });
    $("#dlg-add").close();
    await refresh(); selectAgent(a.id); toast(t("{name} joined the station", { name: a.name }));
  } catch (err) { $("#add-err").textContent = err.message; }
});

// ================= panel width (drag) =================
{
  const app = $("#app"), handle = $("#resizer");
  const MIN = 360, max = () => Math.max(MIN, Math.min(1100, innerWidth - 420));
  const apply = (w) => { w = Math.round(Math.max(MIN, Math.min(max(), w))); app.style.setProperty("--panel-w", w + "px"); document.documentElement.style.setProperty("--panel-w", w + "px"); return w; };
  try { const saved = +localStorage.getItem("panelW"); if (saved) apply(saved); } catch {}
  const save = (w) => { try { localStorage.setItem("panelW", String(w)); } catch {} };
  // Smooth drag: the 3D canvas is not resized while dragging (the WebGL buffer was rebuilt and redrawn on every
  // pixel); the canvas freezes at its current size and the scene is clipped; on release it is resized once.
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    const cv = $("#scene"), r = cv.getBoundingClientRect();
    cv.style.width = r.width + "px"; cv.style.height = r.height + "px"; station.pause(true);
    document.body.classList.add("resizing");
    let x = e.clientX, raf = 0;
    const move = (ev) => { x = ev.clientX; if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(innerWidth - x); }); };
    const up = (ev) => {
      handle.removeEventListener("pointermove", move); cancelAnimationFrame(raf);
      save(apply(innerWidth - ev.clientX));
      document.body.classList.remove("resizing");
      cv.style.width = ""; cv.style.height = "";
      if (!lib.isOpen && !reqsUI.isOpen && !gitUI.isOpen && !edUI.isOpen) station.pause(false);
    };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up, { once: true });
  });
  handle.addEventListener("dblclick", () => save(apply(480)));
  handle.addEventListener("keydown", (e) => {
    const cur = $("#panel").getBoundingClientRect().width;
    if (e.key === "ArrowLeft") save(apply(cur + 24)); else if (e.key === "ArrowRight") save(apply(cur - 24));
  });
}

// ================= send to all =================
function bcCount() {
  const all = [...document.querySelectorAll("#bc-agents input")], on = all.filter((x) => x.checked).length;
  $("#bc-count").textContent = t("{on} / {all} {all|agent|agents} selected", { on, all: all.length });
  $("#bc-all").textContent = on === all.length ? t("Deselect all") : t("Select all");
}
$("#btn-broadcast").onclick = () => {
  if (!agents.length) { toast(t("Add a project first"), "bad"); return; }
  const box = $("#bc-agents"); box.innerHTML = "";
  projects().forEach((a, i) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="checkbox" checked value="${a.id}"><span class="portrait"></span><span></span>`;
    l.querySelector(".portrait").style.backgroundImage = portraitUrl(a.char ?? i);
    l.querySelector("span:last-child").textContent = a.name; box.append(l);
  });
  box.onchange = bcCount; bcCount();
  const opt = (v, t) => `<option value="${v}">${escHtml(t)}</option>`;
  $("#bc-model").innerHTML = opt("", t("Each agent's own model")) + `<optgroup label="${escHtml(t("Featured"))}">${MODELS_MAIN.map(([k, n]) => opt(k, n)).join("")}</optgroup><optgroup label="${escHtml(t("Other models"))}">${MODELS_MORE.map(([k, n]) => opt(k, n)).join("")}</optgroup>`;
  $("#bc-effort").innerHTML = opt("", t("Its own effort")) + EFFORTS.map(([k, n]) => opt(k, n)).join("");
  $("#bc-perm").innerHTML = opt("", t("Its own permission")) + PERMS.map(([k, n]) => opt(k, n)).join("");
  $("#bc-perm").classList.remove("risky");
  $("#dlg-bc").showModal(); $("#bc-text").focus();
};
$("#bc-all").onclick = () => {
  const all = [...document.querySelectorAll("#bc-agents input")], allOn = all.every((x) => x.checked);
  all.forEach((x) => (x.checked = !allOn)); bcCount();
};
$("#bc-perm").onchange = (e) => e.target.classList.toggle("risky", e.target.value === "bypassPermissions");
$("#bc-form").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const ids = [...document.querySelectorAll("#bc-agents input:checked")].map((i) => i.value);
  const text = $("#bc-text").value.trim();
  if (!ids.length) { toast(t("Select at least one agent"), "bad"); return; }
  if (!text) { toast(t("Write a message"), "bad"); $("#bc-text").focus(); return; }
  const override = {};
  if ($("#bc-model").value) override.model = $("#bc-model").value;
  if ($("#bc-effort").value) override.effort = $("#bc-effort").value;
  if ($("#bc-perm").value) override.permission = $("#bc-perm").value;
  const parallel = $("#bc-par").checked, newConv = $("#bc-new").checked;
  if (override.permission === "bypassPermissions") {
    $("#dlg-bc").close();
    const ok = await confirmBox({ title: t("Grant full access to {n} {n|agent|agents}?", { n: ids.length }), body: t("For this message the selected agents can run commands and delete files without asking."), ok: t("Send with full access"), danger: true });
    if (!ok) { $("#dlg-bc").showModal(); return; }
  }
  $("#dlg-bc").close(); $("#bc-text").value = "";
  try {
    await api("/api/broadcast", { method: "POST", body: { ids, text, override, newConv, parallel } });
    toast(parallel ? t("Sending to {n} {n|agent|agents} at the same time", { n: ids.length }) : t("Sending to {n} {n|agent|agents} one by one", { n: ids.length }));
    startBcTracker(ids, text);
  } catch (err) { toast(err.message, "bad"); }
});

// ================= startup =================
meta = await api("/api/meta");
usage = await api("/api/usage").catch(() => ({})); renderUsage();
$("#mode-badge").textContent = meta.mock ? t("Demo mode") : "";
if (meta.claudeMissing) { const w = $("#cli-warn"); w.textContent = meta.claudeMissing; w.hidden = false; }
await refresh();
lib.load().catch(() => {});
refreshGitSummary();
connectWS();
const q = new URLSearchParams(location.search).get("agent");
if (q) { const a = agents.find((x) => x.name === q || x.id === q); if (a) selectAgent(a.id); }


// =================================================================
// Practical shortcuts: drag-and-drop ordering, context menu, unread,
// draft per project, Ctrl+K / Ctrl+1…9, quick commands
// =================================================================
function saveDraft(team) {
  const v = $("#prompt").value;
  if (v.trim()) drafts[team] = v; else delete drafts[team];
  lsSet("ecelon.drafts", drafts);
}
function restoreDraft(team) {
  const t = $("#prompt"); t.value = drafts[team] || "";
  t.style.height = "auto"; if (t.value) t.style.height = Math.min(t.scrollHeight, 200) + "px";
}
{ let tm; $("#prompt").addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => current() && saveDraft(teamKey(current())), 400); }); }
$("#prompt-form").addEventListener("submit", () => { const a = current(); if (a) { delete drafts[teamKey(a)]; lsSet("ecelon.drafts", drafts); } }, true);

// ---- project order by drag and drop (the rooms follow the same order)
{
  const ul = $("#agent-list"); let drag = null;
  const clear = () => ul.querySelectorAll(".drop-before, .drop-after, .dragging").forEach((x) => x.classList.remove("drop-before", "drop-after", "dragging"));
  ul.addEventListener("dragstart", (e) => {
    const li = e.target.closest("li[data-team]"); if (!li) return;
    drag = li.dataset.team; li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", drag);
  });
  ul.addEventListener("dragover", (e) => {
    if (!drag) return;
    const li = e.target.closest("li[data-team]"); if (!li) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    ul.querySelectorAll(".drop-before, .drop-after").forEach((x) => x !== li && x.classList.remove("drop-before", "drop-after"));
    li.classList.toggle("drop-after", after); li.classList.toggle("drop-before", !after);
  });
  ul.addEventListener("dragend", () => { drag = null; clear(); });
  ul.addEventListener("drop", async (e) => {
    const li = e.target.closest("li[data-team]"); if (!drag || !li) return;
    e.preventDefault();
    const after = li.classList.contains("drop-after"), target = li.dataset.team, from = drag;
    drag = null; clear();
    if (target === from) return;
    const order = teamOrder().filter((t) => t !== from);
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, from);
    const ids = order.flatMap((t) => agents.filter((x) => teamKey(x) === t).map((x) => x.id));
    try { await api("/api/agents/reorder", { method: "POST", body: { ids } }); await refresh(); }
    catch (err) { toast(err.message, "bad"); }
  });
}

// ---- context menu (list and rooms)
let ctxMenu = null;
function closeCtx() { ctxMenu?.remove(); ctxMenu = null; }
function openCtx(team, x, y) {
  closeCtx();
  const lead = agents.find((a) => teamKey(a) === team && roleOf(a) === "dev") || agents.find((a) => teamKey(a) === team); if (!lead) return;
  const idx = teamOrder().indexOf(team);
  const go = async () => { if (selectedId !== lead.id) await selectAgent(lead.id); };
  const items = [
    [t("Open"), async () => { await go(); station.focus(lead.id); $("#prompt").focus(); }],
    [t("Scope"), async () => { await go(); reqsUI.open(lead); }],
    [t("Code"), async () => { await go(); openCode(lead); }],
    [t("Run"), async () => { await go(); openRun(lead); }],
    ...(gitSum[team]?.ok === false ? [] : [["Git", async () => { await go(); gitUI.open(lead); }]]),
    [t("Documents"), async () => { await go(); lib.open({ agentId: lead.id }); }],
    "-",
    [t("Open project folder"), async () => { await go(); openInFolder(); }],
    [t("New conversation"), async () => { await go(); newConversation(); }],
    [t("Rename"), async () => { await go(); $("#a-name").click(); }],
    "-",
    [t("Move to top"), () => moveTeam(team, 0), idx === 0],
    [t("Move to bottom"), () => moveTeam(team, teamOrder().length - 1), idx === teamOrder().length - 1],
    ...(unread.has(team) ? [[t("Mark as read"), () => { unread.delete(team); saveUnread(); renderList(); }]] : []),
    "-",
    [t("Remove project from the station…"), () => removeProject(lead), false, "danger"],
  ];
  const m = document.createElement("div"); m.className = "pop lib-menu ctx-menu"; m.setAttribute("role", "menu");
  const name = document.createElement("p"); name.className = "lm-title"; name.textContent = lead.name; m.append(name);
  for (const it of items) {
    if (it === "-") { const hr = document.createElement("hr"); m.append(hr); continue; }
    const [label, fn, disabled, cls] = it;
    const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.disabled = !!disabled; if (cls) b.className = cls;
    b.onclick = () => { closeCtx(); fn(); };
    m.append(b);
  }
  document.body.append(m); ctxMenu = m;
  m.style.left = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8)) + "px";
  m.style.top = Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) + "px";
  m.querySelector("button:not([disabled])")?.focus();
}
async function moveTeam(team, pos) {
  const order = teamOrder().filter((t) => t !== team); order.splice(pos, 0, team);
  const ids = order.flatMap((t) => agents.filter((x) => teamKey(x) === t).map((x) => x.id));
  try { await api("/api/agents/reorder", { method: "POST", body: { ids } }); await refresh(); } catch (err) { toast(err.message, "bad"); }
}
$("#agent-list").addEventListener("contextmenu", (e) => { const li = e.target.closest("li[data-team]"); if (!li) return; e.preventDefault(); openCtx(li.dataset.team, e.clientX, e.clientY); });
$("#scene").addEventListener("contextmenu", (e) => {
  const id = station.pickAt?.(e.clientX, e.clientY); e.preventDefault();
  const a = agents.find((x) => x.id === id); if (a) openCtx(teamKey(a), e.clientX, e.clientY);
});
document.addEventListener("pointerdown", (e) => { if (ctxMenu && !ctxMenu.contains(e.target)) closeCtx(); }, true);
document.addEventListener("keydown", (e) => { if (ctxMenu && e.key === "Escape") { e.stopPropagation(); closeCtx(); } }, true);
addEventListener("blur", closeCtx); addEventListener("resize", closeCtx);

// ---- Ctrl+K quick switch, Ctrl+1…9
{
  const dlg = $("#dlg-switch"), inp = $("#sw-q"), ul = $("#sw-list"); let idx = 0, rows = [];
  const cmds = () => {
    const a = current(); const L = [];
    for (const p of projects()) L.push({ kind: "proj", label: p.name, sub: shortPath(p.cwd), a: p, run: () => { selectAgent(p.id); station.focus(p.id); setTimeout(() => $("#prompt").focus(), 50); } });
    if (a) {
      const lead = leadOf(a);
      L.push({ kind: "cmd", label: t("Scope"), sub: lead.name, run: () => reqsUI.open(lead) });
      L.push({ kind: "cmd", label: t("Code editor"), sub: lead.name, run: () => openCode(lead) });
      L.push({ kind: "cmd", label: t("Open file (Ctrl+P)"), sub: lead.name, run: () => { openCode(lead); } });
      L.push({ kind: "cmd", label: "Git", sub: lead.name, run: () => gitUI.open(lead) });
      L.push({ kind: "cmd", label: t("Run / terminal (Ctrl+J)"), sub: lead.name, run: () => openRun(lead) });
      L.push({ kind: "cmd", label: t("Problems"), sub: lead.name, run: () => openRun(lead, { tab: "problems" }) });
      L.push({ kind: "cmd", label: t("New conversation"), sub: lead.name, run: () => newConversation() });
      L.push({ kind: "cmd", label: t("Open project folder"), sub: lead.name, run: () => openInFolder() });
    }
    L.push({ kind: "cmd", label: t("Documents"), sub: t("Document library"), run: () => lib.open() });
    return L;
  };
  const norm = (s) => String(s).toLocaleLowerCase(locale());
  function draw() {
    const q = norm(inp.value.trim());
    rows = cmds().filter((r) => !q || norm(r.label + " " + r.sub).includes(q));
    if (idx >= rows.length) idx = Math.max(0, rows.length - 1);
    ul.innerHTML = "";
    rows.forEach((r, i) => {
      const li = document.createElement("li"); li.setAttribute("role", "option"); li.setAttribute("aria-selected", i === idx);
      li.className = "sw-" + r.kind + (r.kind === "proj" && unread.has(teamKey(r.a)) ? " unread" : "");
      if (r.kind === "proj") { const pi = projects().indexOf(r.a); const k = document.createElement("kbd"); k.textContent = pi < 9 ? `Ctrl ${pi + 1}` : ""; li.append(k); }
      const b = document.createElement("b"); b.textContent = r.label; const s = document.createElement("span"); s.textContent = r.sub;
      li.prepend(b, s);
      li.onmousemove = () => { if (idx !== i) { idx = i; draw(); } };
      li.onclick = () => run(i);
      ul.append(li);
    });
    if (!rows.length) ul.innerHTML = `<li class="sw-none">${t("No results")}</li>`;
    ul.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }
  function run(i) { const r = rows[i]; if (!r) return; dlg.close(); r.run(); }
  function openSwitch() { if (dlg.open) return; inp.value = ""; idx = 0; draw(); dlg.showModal(); inp.focus(); }
  inp.addEventListener("input", () => { idx = 0; draw(); });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); idx = (idx + 1) % Math.max(1, rows.length); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = (idx - 1 + rows.length) % Math.max(1, rows.length); draw(); }
    else if (e.key === "Enter") { e.preventDefault(); run(idx); }
  });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key.toLowerCase() === "k") { if (lib.isOpen || e.defaultPrevented) return; e.preventDefault(); openSwitch(); return; }
    const closeOthers = () => { if (lib.isOpen) lib.close(); if (reqsUI.isOpen) reqsUI.close(); if (gitUI.isOpen) gitUI.close(); };
    if (e.key.toLowerCase() === "e" && current() && !edUI.isOpen && !document.querySelector("dialog[open]")) { e.preventDefault(); closeOthers(); if (runUI.isOpen) runUI.close(); openCode(); return; }
    if (e.key.toLowerCase() === "j" && current() && !runUI.isOpen && !document.querySelector("dialog[open]")) { e.preventDefault(); closeOthers(); if (edUI.isOpen) edUI.close(); openRun(); return; }
    if (/^[1-9]$/.test(e.key) && !document.querySelector("dialog[open]:not(#dlg-switch)")) {
      const p = projects()[+e.key - 1]; if (!p) return;
      e.preventDefault(); if (dlg.open) dlg.close();
      if (lib.isOpen) lib.close(); if (reqsUI.isOpen) reqsUI.close(); if (gitUI.isOpen) gitUI.close(); if (edUI.isOpen) edUI.close(); if (runUI.isOpen) runUI.close();
      selectAgent(p.id); station.focus(p.id); setTimeout(() => $("#prompt").focus(), 50);
    }
  });
}

// ---- quick commands (above the message box; you can add your own)
// role: if given, the task goes directly to that role through the station (without relying on the lead); the result returns to the lead
const QUICK_DEFAULT = [
  { label: t("Test"), role: "tester", text: t("Test the latest changes. Find what changed with git status / git diff / git log; run the relevant tests and the build. Report the result: pass/fail, the commands you ran, file:line for every error, expected and actual behavior.") },
  { label: t("Check against the document"), role: "analyst", text: t("Check the latest changes (git diff / git log) against the analysis document linked to the project: are there missing, wrong or half-done requirements? If there is a requirements list, update the work status of the relevant items with evidence.") },
  { label: t("Review"), role: "reviewer", text: t("Review the latest changes (git diff / git log); write the findings in order of severity (critical / major / minor) with file:line and a suggestion.") },
  { label: t("Continue"), text: t("Continue.") },
];
let quick = QUICK_DEFAULT;
async function loadQuick() {
  try { const p = await api("/api/prefs"); if (Array.isArray(p.quick)) quick = p.quick; } catch {}
  renderQuick();
}
async function saveQuick() { try { await api("/api/prefs", { method: "PUT", body: { quick } }); } catch (err) { toast(err.message, "bad"); } renderQuick(); }
function renderQuick() {
  const box = $("#quick"); box.innerHTML = "";
  quick.forEach((q, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "qk"; b.textContent = q.label;
    b.title = `${q.role || QUICK_DEFAULT.some((d) => d.label === q.label && d.role) ? t("Gives the task directly to the relevant role.") + " " : ""}${q.text}\n${t("Click: send · Shift+click: put in the box · Right-click: edit/delete")}`;
    const role = q.role || QUICK_DEFAULT.find((d) => d.label === q.label)?.role;
    b.onclick = async (e) => {
      const a = current(); if (!a) return;
      const member = role && teamOf(a).find((m) => roleOf(m) === role);
      if (member && !e.shiftKey && !$("#prompt").value.trim()) {
        try { await api(`/api/agents/${leadOf(a).id}/delegate`, { method: "POST", body: { role, task: q.text } }); toast(t("Task given to {role}; the result will come back to the lead", { role: dative(roleLabel(member)) })); }
        catch (err) { toast(err.message, "bad"); }
        return;
      }
      if (e.shiftKey || $("#prompt").value.trim()) { const t = $("#prompt"); t.value = (t.value.trim() ? t.value.replace(/\s*$/, " ") : "") + q.text; t.dispatchEvent(new Event("input")); t.focus(); return; }
      sendPrompt({ text: q.text }, a).catch((err) => toast(err.message, "bad"));
    };
    b.oncontextmenu = (e) => { e.preventDefault(); quickMenu(i, e.clientX, e.clientY); };
    box.append(b);
  });
  const add = document.createElement("button"); add.type = "button"; add.className = "qk add"; add.textContent = "+"; add.title = t("Add a quick command");
  add.onclick = () => editQuick(-1); box.append(add);
}
async function editQuick(i) {
  const cur = quick[i];
  const label = (await askText(i < 0 ? t("Quick command: button name") : t("Button name"), t("e.g. Build"), cur?.label || "", { ok: t("Next") }))?.trim(); if (!label) return;
  const text = (await askText(t("Message to send"), t("e.g. Build the project and fix any errors."), cur?.text || "", { ok: t("Save") }))?.trim(); if (!text) return;
  if (i < 0) quick = [...quick, { label: label.slice(0, 30), text }]; else quick = quick.map((q, j) => (j === i ? { ...q, label: label.slice(0, 30), text } : q));
  saveQuick();
}
function quickMenu(i, x, y) {
  closeCtx();
  const m = document.createElement("div"); m.className = "pop lib-menu ctx-menu";
  const acts = [[t("Edit"), () => editQuick(i)], [t("Move left"), () => { if (i > 0) { const q = [...quick]; [q[i - 1], q[i]] = [q[i], q[i - 1]]; quick = q; saveQuick(); } }], [t("Move right"), () => { if (i < quick.length - 1) { const q = [...quick]; [q[i + 1], q[i]] = [q[i], q[i + 1]]; quick = q; saveQuick(); } }],
    [t("Delete"), () => { quick = quick.filter((_, j) => j !== i); saveQuick(); }, "danger"], [t("Restore defaults"), () => { quick = QUICK_DEFAULT; saveQuick(); }]];
  for (const [l, fn, cls] of acts) { const b = document.createElement("button"); b.type = "button"; b.textContent = l; if (cls) b.className = cls; b.onclick = () => { closeCtx(); fn(); }; m.append(b); }
  document.body.append(m); ctxMenu = m;
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + "px"; m.style.top = Math.max(8, y - m.offsetHeight - 4) + "px";
}
loadQuick();


// ---- "Send to all" tracker: live summary at the bottom left of the stage (who finished, who errored)
let bc = null;
function startBcTracker(ids, text) {
  bc = { ids, text, st: new Map(ids.map((id) => [id, "queued"])), at: Date.now() };
  renderBc();
}
function bcEvent(ev) {
  if (!bc || !bc.st.has(ev.agentId)) return;
  const cur = bc.st.get(ev.agentId);
  if (ev.type === "status") {
    if (ev.status === "thinking" || ev.status === "tool") bc.st.set(ev.agentId, "running");
    else if ((ev.status === "done" || ev.status === "error") && cur !== "permission") bc.st.set(ev.agentId, ev.status === "error" ? "error" : "done");
  } else if (ev.type === "notify" && ev.kind !== "done") bc.st.set(ev.agentId, ev.kind);
  renderBc();
}
function renderBc() {
  let box = $("#bc-track");
  if (!bc) { box?.remove(); return; }
  if (!box) { box = document.createElement("div"); box.id = "bc-track"; $("#stage").append(box); }
  const L = { queued: t("Queued"), running: t("Working"), done: t("Done"), error: t("Error"), permission: t("Waiting for permission") };
  const D = { queued: "st-idle", running: "st-tool", done: "st-done", error: "st-error", permission: "st-thinking" };
  const vals = [...bc.st.values()]; const fin = vals.filter((v) => v !== "queued" && v !== "running").length;
  const bad = vals.filter((v) => v === "error" || v === "permission").length;
  box.innerHTML = `<div class="bt-head"><b>${t("Send to all")}</b><span>${fin === vals.length ? t("Completed · {n} done", { n: vals.filter((v) => v === "done").length }) + (bad ? ", " + t("{n} need attention", { n: bad }) : "") : t("{done}/{all} done", { done: fin, all: vals.length })}</span><button type="button" class="bt-x" title="${t("Close")}" aria-label="${t("Close")}">×</button></div>
    <p class="bt-text" title="${escHtml(bc.text)}">${escHtml(bc.text.slice(0, 90))}</p>
    ${bc.ids.map((id) => { const a = agents.find((x) => x.id === id); const st = bc.st.get(id); return a ? `<button type="button" class="bt-row" data-id="${id}"><i class="dot ${D[st]}"></i><span>${escHtml(agentLabel(a))}</span><em class="bt-${st}">${L[st]}</em></button>` : ""; }).join("")}`;
  box.querySelector(".bt-x").onclick = () => { bc = null; renderBc(); };
  box.querySelectorAll(".bt-row").forEach((b) => (b.onclick = () => { selectAgent(b.dataset.id); station.focus(b.dataset.id); }));
}
