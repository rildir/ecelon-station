import { createStation, CHARACTERS } from "./scene.js";
import { createLibrary, badge, KIND } from "./library.js";
import { sfx } from "./sounds.js";
import { createReqs } from "./reqs.js";
import { createTasks } from "./tasks.js";
import { createPractice } from "./practice.js";
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
      out.push(`<div class="code"><div class="code-head"><span>${escHtml(lang || t("code"))}</span><button type="button" class="copy" title="${t("Copy code")}" aria-label="${t("Copy code")}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="2"/><path d="M3.5 10.5h-.5A1.5 1.5 0 0 1 1.5 9V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5"/></svg><span>${t("Copy")}</span></button></div><pre><code>${escHtml(code.replace(/\n$/, ""))}</code></pre></div>`);
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
  ["claude-fable-5-2", "Fable 5.2", t("Hard reasoning and long agentic work")],
  ["claude-opus-5-5", "Opus 5.5", t("Strong for long coding tasks")],
  ["claude-sonnet-5-5", "Sonnet 5.5", t("Balance of speed and intelligence")],
  ["claude-haiku-5-5", "Haiku 5.5", t("Fastest, for simple tasks")],
];
const MODELS_MORE = [
  ["claude-fable-5-1", "Fable 5.1"], ["claude-fable-5", "Fable 5"], ["claude-opus-5", "Opus 5"], ["claude-sonnet-5", "Sonnet 5"],
  ["claude-opus-4-8", "Opus 4.8"], ["claude-opus-4-7", "Opus 4.7"], ["claude-opus-4-6", "Opus 4.6"],
  ["claude-sonnet-4-6", "Sonnet 4.6"], ["claude-haiku-4-5-20251001", "Haiku 4.5"],
];
const ALIAS = { sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5", fable: "claude-fable-5-2", haiku: "claude-haiku-5-5" };
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
const teamOrder = () => [...new Set(agents.filter((a) => !a.solo).map(teamKey))]; // projects only; free chats are listed apart (chatList)
const chatList = () => agents.filter((a) => a.solo).sort((a, b) => String(b.lastUsedAt || b.createdAt || "").localeCompare(String(a.lastUsedAt || a.createdAt || "")));
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

// The office needs WebGL. Where there is none (a remote desktop, a locked-down or virtual machine) the station
// must still work: it then runs in the professional view only, and every call to the scene is a no-op.
const NO_SCENE = new Proxy({ daylight: () => ({ k: 1, dusk: 0 }), roomsWithWork: () => [], pickAt: () => null, stats: () => ({}), stream: () => { throw new Error("no scene"); }, snapshot: () => { throw new Error("no scene"); } }, { get: (o, k) => (k in o ? o[k] : () => undefined), set: (o, k, v) => { o[k] = v; return true; } });
let noGL = false;
const makeStation = (opts) => { try { return createStation($("#scene"), opts); } catch (e) { noGL = true; console.warn("[ecelon] no WebGL, professional view only:", e?.message || e); return NO_SCENE; } };
const station = makeStation({
  onSelect: (id) => selectAgent(id),
  onProp: (tk, kind) => onProp(tk, kind),
  propTip: (tk, kind) => propTip(tk, kind),
  boardLabels: [t("To do"), t("In progress"), t("Done")],
  peekLabel: (id) => { const a = agents.find((x) => x.id === id); return a ? roleLabel(a) : ""; },
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
window.__station = station; window.__pick = (id) => selectAgent(id); // for debugging
// Two faces of the same station: the office (3D) and the professional view (a roster, nothing playful). The choice
// is per browser. In the professional view the 3D scene does not run at all.
const VIEW_KEY = "ecelon.view";
let proView = noGL || (new URLSearchParams(location.search).get("view") || lsGet(VIEW_KEY, "office")) === "pro";
{ const rawPause = station.pause.bind(station); let want = false; station.pause = (on) => { want = !!on; rawPause(want || proView); }; station.pauseSync = () => rawPause(want || proView); }

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
const tasksUI = createTasks({
  api, toast, confirmBox,
  project: (a) => ({ team: teamKey(a), name: leadOf(a).name, roles: teamOf(a).map((m) => ({ id: roleOf(m), label: roleLabel(m) })) }),
  roleIcon: (id) => ROLE_ICON[id] || "",
  onOpen: () => { station.pause(true); closePops(); },
  onClose: () => { station.pause(false); renderTasksBadge(); },
});
// Practice: a JavaScript scratch pad. "Ask for a hint" opens a new free chat with the code in the message box
// (not sent: the user reads it, changes it, sends it).
const practiceUI = createPractice({
  toast, confirmBox, prompt: (...a) => askText(...a),
  askHint: async (text) => { await newChat(); const p = $("#prompt"); if (p) { p.value = text; p.dispatchEvent(new Event("input", { bubbles: true })); p.focus(); } },
  onOpen: () => { station.pause(true); closePops(); },
  onClose: () => { station.pause(false); },
});
$("#btn-practice").onclick = () => practiceUI.open();
let tasksSeq = 0;
async function renderTasksBadge(a = current()) {
  if (!a) return; const seq = ++tasksSeq;
  const s = await tasksUI.summary(teamKey(a)); if (seq !== tasksSeq) return;
  const b = $("#tasks-badge"); b.textContent = s.open ? String(s.open) : ""; b.classList.toggle("warn", s.toUser > 0);
  $("#btn-tasks").title = s.open ? t("{n} open {n|task|tasks}", { n: s.open }) + (s.toUser ? " · " + t("{n} for you", { n: s.toUser }) : "") : t("Tasks: what the agents left for each other and for you");
}
$("#btn-tasks").onclick = () => current() && tasksUI.open(current());
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
  renderGitBadge(); renderList(); pushOffice();
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

// ================= the office shows the real state =================
// papers on the lead's desk = uncommitted changes, boxes by the door = unpushed commits, the plant = health
// (verified scope), the whiteboard = task board, the printer = today's report; members waiting for permission
// queue at the door and the approval queue on the stage grants it without opening the chat.
let overview = {};
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const DAY = 86400000;
async function refreshOverview() { overview = await api(`/api/overview?since=${dayStart()}&old=${Date.now() - 3 * DAY}`).catch(() => overview); pushOffice(); }
// neglect 0..1: tasks open and untouched for 3+ days, evidence that went stale, document/code mismatches, a huge pile of uncommitted changes
function wearOf(tk) {
  const ov = overview[tk] || {}, r = ov.reqs || {}, gs = gitSum[tk] || {};
  return Math.min(1, (ov.tasks?.old || 0) * 0.12 + (r.stale || 0) * 0.06 + (r.mismatches || 0) * 0.05 + (gs.changed > 150 ? 0.35 : gs.changed > 60 ? 0.15 : 0));
}
let ovT; const overviewSoon = () => { clearTimeout(ovT); ovT = setTimeout(refreshOverview, 800); };
setInterval(refreshOverview, 60000);
const leadOfTeam = (tk) => agents.find((x) => teamKey(x) === tk && roleOf(x) === "dev") || agents.find((x) => teamKey(x) === tk);
function healthOf(tk) {
  const r = overview[tk]?.reqs, team = agents.filter((x) => teamKey(x) === tk);
  const sick = !!(r && (r.failed || 0) > 0) || team.some((m) => m.status === "error" || m.attention?.kind === "error");
  return { ratio: r?.total ? r.done / r.total : null, sick };
}
// payroll: what the team cost this week (Monday onwards), per member
const payroll = new Map(); // team → /api/payroll result
const weekStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const money = (usd) => (usd >= 100 ? `$${Math.round(usd)}` : usd >= 10 ? `$${usd.toFixed(1)}` : `$${usd.toFixed(2)}`);
const ROLE_COLOR = { dev: "#f6a23a", tester: "#6cc6ff", analyst: "#b48cff", reviewer: "#7bd88f" };
async function refreshPayroll() {
  await Promise.all(teamOrder().map(async (tk) => { try { payroll.set(tk, await api(`/api/payroll/${encodeURIComponent(tk)}?since=${weekStart()}`)); } catch {} }));
  pushOffice();
}
setInterval(refreshPayroll, 120000);
function payrollBoard(tk) {
  const p = payroll.get(tk); if (!p) return null;
  const rows = p.members.filter((m) => m.costUsd > 0).sort((a, b) => b.costUsd - a.costUsd).map((m) => ({ name: meta.roles?.[m.role]?.label || m.name, usd: m.costUsd, money: money(m.costUsd), color: ROLE_COLOR[m.role] }));
  return { title: t("PAYROLL · THIS WEEK"), total: p.totalUsd ? money(p.totalUsd) : "", rows, empty: t("Nothing spent this week") };
}
function pushOffice() {
  if (proView) renderBoard();
  for (const tk of teamOrder()) {
    const gs = gitSum[tk], ov = overview[tk] || {};
    station.setOffice(tk, { changed: gs?.ok ? gs.changed : 0, ahead: gs?.ok ? gs.ahead : 0, health: healthOf(tk), tasks: ov.tasks || null, report: !!ov.tasks?.doneSince, wear: Math.round(wearOf(tk) * 20) / 20, payroll: payrollBoard(tk), stack: ov.stack || [] });
  }
  for (const a of agents) station.setAttention(a.id, a.attention?.kind === "permission" && !isBusy(a));
  { const n = agents.filter((a) => a.attention?.kind === "permission" && !isBusy(a)).length; if (n > (pushOffice.perm || 0)) sfx.play("permission"); pushOffice.perm = n; }
  renderInbox(); catSoon();
}
// the office cat goes where you are needed: permission > broken tests > an error > someone at work > a nap
const testFailed = new Set(); // rooms whose last test run failed
let catFocus, catT = 0; // undefined until the first decision (so a calm start still places the napping cat)
const catSoon = () => { clearTimeout(catT); catT = setTimeout(updateCat, 300); };
function updateCat() {
  const pick = () => {
    const perm = agents.find((a) => a.attention?.kind === "permission" && !isBusy(a));
    if (perm) return { teamId: teamKey(perm), memberId: perm.id, alert: true, why: "permission" };
    const tf = [...testFailed][0]; if (tf && agents.some((a) => teamKey(a) === tf)) return { teamId: tf, memberId: null, alert: true, why: "tests" };
    const err = agents.find((a) => a.status === "error" || a.attention?.kind === "error");
    if (err) return { teamId: teamKey(err), memberId: err.id, alert: true, why: "error" };
    const busy = agents.find(isBusy);
    if (busy) return { teamId: teamKey(busy), memberId: busy.id, alert: false, why: "work" };
    return null;
  };
  const f = pick(); const k = JSON.stringify(f);
  if (catFocus !== undefined && k === JSON.stringify(catFocus)) return;
  catFocus = f; station.setCat(f);
}
function propTip(tk, kind) {
  const lead = leadOfTeam(tk); if (!lead) return "";
  const ov = overview[tk] || {}, gs = gitSum[tk] || {}, tasks = ov.tasks || {}, r = ov.reqs;
  const text = {
    board: () => t("Task board: {todo} to do · {doing} in progress · {done} done", { todo: (tasks.todo || 0) + (tasks.blocked || 0), doing: tasks.doing || 0, done: tasks.done || 0 }),
    git: () => t("Git: {n} {n|change|changes} not committed · {m} {m|commit|commits} not pushed", { n: gs.changed || 0, m: gs.ahead || 0 }),
    plant: () => { const h = healthOf(tk); return (r?.total ? t("Health: {done}/{total} requirements verified", { done: r.done, total: r.total }) : t("Health: no scope yet")) + (h.sick ? " · " + t("needs care (a failed verification or an error)") : ""); },
    printer: () => t("Today's report: {n} {n|task|tasks} done today", { n: tasks.doneSince || 0 }),
    docs: () => t("Documents of this project"),
    coffee: () => t("Coffee break: stop everyone working in this room"),
    rack: () => t("Run: commands, output, terminal"),
    tv: () => t("TV: replay today in this room"),
    payroll: () => { const p = payroll.get(tk); return p ? t("Payroll: {total} this week, {n} {n|run|runs} · click for the cost per requirement", { total: money(p.totalUsd), n: p.members.reduce((s, m) => s + m.runs, 0) }) : t("Payroll"); },
    cat: () => {
      const f = catFocus, m = f?.memberId && agents.find((x) => x.id === f.memberId);
      return !f ? t("The office cat is napping: nothing needs you right now")
        : f.why === "permission" ? t("The cat found {who} waiting for your permission", { who: agentLabel(m) })
        : f.why === "tests" ? t("The cat is sitting by the server rack: the last test run failed")
        : f.why === "error" ? t("The cat found an error at {who}", { who: agentLabel(m) })
        : t("The cat is watching {who} work", { who: agentLabel(m) });
    },
    wear: () => { const r = ov.reqs || {}, bits = []; if (tasks.old) bits.push(t("{n} {n|task|tasks} untouched for 3+ days", { n: tasks.old })); if (r.stale) bits.push(t("{n} stale {n|verification|verifications}", { n: r.stale })); if (r.mismatches) bits.push(t("{n} {n|mismatch|mismatches}", { n: r.mismatches })); if (gs.changed > 60) bits.push(t("{n} uncommitted changes", { n: gs.changed })); return t("Needs tidying: {what}", { what: bits.join(", ") || "–" }); },
  }[kind] || (kind.startsWith("screen:") ? () => { const m = agents.find((x) => teamKey(x) === tk && roleOf(x) === kind.slice(7)); return m ? t("{role}'s screen: click to lean in", { role: roleLabel(m) }) : ""; } : null);
  return text ? `${lead.name} · ${text()}` : "";
}
async function onProp(tk, kind) {
  const lead = leadOfTeam(tk); if (!lead) return;
  if (kind === "coffee") return coffeeBreak(tk);
  if (kind === "cat") { // take me there
    const f = catFocus; if (!f) { toast(t("Purr. Everything is calm.")); return; }
    const id = f.memberId || leadOfTeam(f.teamId)?.id; if (!id) return;
    await selectAgent(id); station.focus(id);
    if (f.why === "tests") $("#btn-run")?.click();
    return;
  }
  if (kind === "printer") return dayReport(tk);
  if (kind === "tv") return playReplay(tk);
  if (kind === "payroll") return openPayroll(tk);
  if (kind === "docs") { lib.open({ agentId: lead.id }); return; }
  if (!current() || teamKey(current()) !== tk) await selectAgent(lead.id);
  const btn = { board: "#btn-tasks", git: "#btn-git", plant: "#btn-reqs", rack: "#btn-run", wear: "#btn-tasks" }[kind];
  if (btn && !$(btn).hidden) $(btn).click();
}
async function coffeeBreak(tk) {
  const team = agents.filter((x) => teamKey(x) === tk), busy = team.filter(isBusy), lead = leadOfTeam(tk);
  if (!busy.length) { toast(t("Nobody is working in {name}; enjoy the coffee", { name: lead.name })); return; }
  const ok = await confirmBox({ title: t("Coffee break in {name}?", { name: lead.name }), body: t("{n} {n|agent stops|agents stop} working: {who}. The conversations stay; send 'continue' to pick up again.", { n: busy.length, who: busy.map((m) => roleLabel(m)).join(", ") }), ok: t("Stop and take a break"), danger: true });
  if (!ok) return;
  await Promise.all(busy.map((m) => api(`/api/agents/${m.id}/stop`, { method: "POST" }).catch(() => {})));
  sfx.play("coffee"); toast(t("Break: {name} stopped", { name: lead.name }));
}
async function dayReport(tk) {
  const lead = leadOfTeam(tk), team = agents.filter((x) => teamKey(x) === tk), ov = overview[tk] || {}, gs = gitSum[tk] || {}, r = ov.reqs;
  const all = await api(`/api/tasks/${encodeURIComponent(tk)}`).then((d) => d.items || []).catch(() => []);
  const since = dayStart(), doneToday = all.filter((x) => x.status === "done" && x.updatedAt >= since), open = all.filter((x) => x.status !== "done");
  const L = [];
  L.push(`${lead.name} — ${new Date().toLocaleDateString(locale(), { day: "numeric", month: "long", weekday: "long" })}`, "");
  L.push(t("Done today ({n}):", { n: doneToday.length }));
  for (const x of doneToday.slice(0, 12)) L.push(`  ✓ ${x.id} ${x.title}`);
  if (!doneToday.length) L.push("  –");
  L.push("", t("Still open: {n} ({doing} in progress, {blocked} blocked, {user} waiting for you)", { n: open.length, doing: open.filter((x) => x.status === "doing").length, blocked: open.filter((x) => x.status === "blocked").length, user: open.filter((x) => x.role === "user").length }));
  if (r?.total) L.push(t("Scope: {done}/{total} verified{failed}", { done: r.done, total: r.total, failed: r.failed ? " · " + t("{n} failed", { n: r.failed }) : "" }));
  if (gs.ok) L.push(t("Git: {n} {n|change|changes} not committed · {m} {m|commit|commits} not pushed", { n: gs.changed || 0, m: gs.ahead || 0 }));
  const waiting = team.filter((m) => m.attention?.kind === "permission"), working = team.filter(isBusy);
  if (working.length) L.push(t("Working now: {who}", { who: working.map((m) => roleLabel(m)).join(", ") }));
  if (waiting.length) L.push(t("Waiting for permission: {who}", { who: waiting.map((m) => roleLabel(m)).join(", ") }));
  const text = L.join("\n");
  const d = $("#dlg-report"); $("#rp-title").textContent = t("Today's report"); $("#rp-body").textContent = text;
  $("#rp-copy").onclick = (e) => copyWithState(e.currentTarget, text);
  d.showModal();
}
$("#rp-close").onclick = () => $("#dlg-report").close();

// team hand-offs in the room: the lead carries the task to the member's desk, the member brings the result back
function officeEvent(ev) {
  if (ev.kind === "delegate" && ev.to) { station.handoff(ev.agentId, ev.to); sfx.play("handoff"); }
  else if (ev.kind === "result" && ev.from) { station.handoff(ev.from, ev.agentId); sfx.play("handoff"); }
}
// what a member "says" in the office: the first sentence of its reply, without markdown
function firstSentence(md) {
  const plain = String(md).replace(/```[\s\S]*?```/g, " ").replace(/[#*`>|_\[\]()]/g, " ").replace(/\s+/g, " ").trim();
  const m = /^(.{12,140}?[.!?])(\s|$)/.exec(plain);
  return (m ? m[1] : plain.slice(0, 120)).trim();
}
// office sounds: off by default, remembered
{
  const b = $("#btn-sfx");
  const paint = () => { const on = sfx.on; b.setAttribute("aria-pressed", String(on)); b.classList.toggle("on", on); b.title = on ? t("Office sounds (on)") : t("Office sounds (off)"); };
  sfx.init(); paint();
  b.onclick = () => { sfx.set(!sfx.on); paint(); if (sfx.on) sfx.play("done"); };
}
// test runs light the beacon on the room's server rack: amber while running, red on failure, green (and confetti) on success
const TEST_CMD = /(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(npx\s+)?(jest|vitest|mocha|playwright\s+test|cypress\s+run)\b|\bpytest\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bdotnet\s+test\b|\b(nx|ng)\s+(run-many\s+.*-t\s+)?test\b|\bgo\s+test\b|\bcargo\s+test\b|\bphpunit\b|\bphp\s+artisan\s+test\b|\bmvn\s+(\S+\s+)*test\b|\bgradlew?\s+(\S+\s+)*test\b|\brspec\b|\bnode\s+--test\b/i;
const testRuns = new Map(); // toolUseId → team
function testWatch(ev) {
  if (ev.type === "tool_use") {
    if (ev.name !== "Bash" || !TEST_CMD.test(String(ev.input?.command || ""))) return;
    const a = agents.find((x) => x.id === ev.agentId); if (!a) return;
    testRuns.set(ev.toolUseId, teamKey(a)); station.setTest(teamKey(a), "running");
  } else if (testRuns.has(ev.toolUseId)) {
    const tk = testRuns.get(ev.toolUseId); testRuns.delete(ev.toolUseId);
    if ([...testRuns.values()].includes(tk)) return; // another test run in the same room is still going
    station.setTest(tk, ev.isError ? "fail" : "pass"); sfx.play(ev.isError ? "testFail" : "testPass");
    if (ev.isError) testFailed.add(tk); else testFailed.delete(tk); catSoon();
  }
}

// the monitors on the desks show what each member is really doing: the code being written, the command and its output
const termOf = new Map(); // agentId → what its terminal screen shows
const fileName = (p) => String(p || "").split(/[\\/]/).pop();
function screenWatch(ev) {
  const id = ev.agentId; if (!id) return;
  if (ev.type === "tool_use") {
    const i = ev.input || {};
    if (ev.name === "Edit" || ev.name === "MultiEdit" || ev.name === "Write") {
      const src = ev.name === "Write" ? i.content : ev.name === "Edit" ? i.new_string : i.edits?.[0]?.new_string;
      station.setScreen(id, { kind: "code", title: fileName(i.file_path), lines: String(src || "").split("\n").filter((l) => l.trim()).slice(0, 8) });
    } else if (ev.name === "Read") station.setScreen(id, { kind: "code", title: fileName(i.file_path), lines: [] });
    else if (ev.name === "Bash") { const d = { kind: "term", title: i.description || "terminal", cmd: i.command, lines: [], use: ev.toolUseId }; termOf.set(id, d); station.setScreen(id, d); }
    else if (ev.name === "Grep" || ev.name === "Glob") station.setScreen(id, { kind: "term", title: ev.name.toLowerCase(), cmd: `${ev.name.toLowerCase()} ${i.pattern || ""}`, lines: [] });
  } else {
    const d = termOf.get(id); if (!d || d.use !== ev.toolUseId) return;
    const out = String(typeof ev.content === "string" ? ev.content : "").split("\n").map((l) => l.trimEnd()).filter(Boolean);
    station.setScreen(id, { ...d, lines: out.slice(-6), ok: !ev.isError }); termOf.delete(id);
  }
}

// the office follows the clock: day, sunset, night (lamps on, the screens of whoever is working glow)
function applyDaylight() {
  const q = new URLSearchParams(location.search).get("hour"); // ?hour=21 to preview the night
  const now = new Date(), h = q != null ? Number(q) : now.getHours() + now.getMinutes() / 60;
  const { k, dusk } = station.daylight(h);
  document.body.classList.toggle("tod-night", k < 0.3); document.body.classList.toggle("tod-dusk", dusk > 0.35 && k >= 0.3);
}
applyDaylight(); setInterval(applyDaylight, 60000);

// ================= broadcast =================
// One button and the station becomes a live feed for a second screen: the camera goes by itself to whatever
// happens (a hand-off, a test run, a permission request, a finished run), a lower third says what it is, and in
// calm moments it glides from one busy room to the next. Record saves a short clip of it.
let live = null;
const LIVE_HOLD = 6500, LIVE_DRIFT = 9000;
function liveCaption(ev) {
  // what the lower third says for an event; null = not worth a cut
  const a = agents.find((x) => x.id === ev.agentId); if (!a) return null;
  const who = roleLabel(a), room = leadOfTeam(teamKey(a))?.name || a.name;
  if (ev.type === "team" && ev.kind === "delegate") { const to = agents.find((x) => x.id === ev.to); return { room, line: t("{who} hands a task to {to}", { who, to: to ? roleLabel(to) : "" }), id: a.id, pri: 3 }; }
  if (ev.type === "team" && ev.kind === "result") { const from = agents.find((x) => x.id === ev.from); return { room, line: t("{who} brings the result back", { who: from ? roleLabel(from) : "" }), id: ev.from || a.id, pri: 3 }; }
  if (ev.type === "tool_use" && ev.name === "Bash" && TEST_CMD.test(String(ev.input?.command || ""))) return { room, line: t("{who} runs the tests", { who }), id: a.id, pri: 4 };
  if (ev.type === "tool_use" && (ev.name === "Edit" || ev.name === "Write" || ev.name === "MultiEdit")) return { room, line: t("{who} writes {file}", { who, file: fileName(ev.input?.file_path) }), id: a.id, pri: 1 };
  if (ev.type === "result") return { room, line: ev.isError ? t("{who} stopped with an error", { who }) : t("{who} is done", { who }), id: a.id, pri: ev.isError ? 5 : 3 };
  if (ev.type === "status" && ev.status === "thinking" && ev.text) return { room, line: t("{who} starts: {text}", { who, text: String(ev.text).slice(0, 60) }), id: a.id, pri: 2 };
  return null;
}
function liveEvent(ev) {
  if (!live) return;
  const c = liveCaption(ev); if (!c) return;
  const now = performance.now();
  if (c.pri < live.pri && now < live.until) return; // something more important is on screen
  liveCut(c, now);
}
function liveCut(c, now = performance.now()) {
  live.pri = c.pri; live.until = now + LIVE_HOLD; live.lastCut = now;
  station.glide(c.id, 9.5, 0.3, 0);
  liveThird(c.room, c.line);
}
function liveThird(room, line) {
  const box = $("#live"), third = box.querySelector(".lv-third");
  box.querySelector(".lv-room").textContent = room; box.querySelector(".lv-line").textContent = line;
  third.classList.remove("in"); void third.offsetWidth; third.classList.add("in");
}
function liveTick() {
  if (!live) return;
  const now = performance.now();
  $("#live .lv-clock").textContent = new Date().toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  if (now >= live.until && now - live.lastCut > LIVE_DRIFT) {
    // calm: glide to the next room where someone works (or just the next room), with a slow drift
    const rooms = station.roomsWithWork(); if (!rooms.length) return;
    const busy = rooms.filter((r) => r.working), pool = busy.length ? busy : rooms;
    live.i = (live.i + 1) % pool.length; const r = pool[live.i], lead = leadOfTeam(r.teamId);
    const team = agents.filter((x) => teamKey(x) === r.teamId), working = team.filter(isBusy);
    live.drift = -live.drift;
    station.glide(r.teamId, 12.5, 0.18, live.drift * 1.5);
    const line = working.length ? t("{who} at work", { who: working.map(roleLabel).join(", ") }) : t("Quiet for now");
    liveThird(lead?.name || r.teamId, line);
    live.lastCut = now; live.pri = 0;
  }
}
function startLive(auto = false) {
  if (live) return;
  live = { pri: 0, until: 0, lastCut: -1e9, i: -1, drift: 1, timer: setInterval(liveTick, 500), rec: null, auto };
  document.body.classList.add("live"); $("#live").hidden = false; closePanel(); station.fit();
  liveTick();
}
function stopLive() {
  if (!live) return; clearInterval(live.timer); if (live.rec) stopClip(); live = null;
  document.body.classList.remove("live"); $("#live").hidden = true; station.fit();
}
// a clip of the broadcast: the 3D canvas recorded for 20 s (or until pressed again), saved as .webm
function startClip() {
  if (!live || live.rec) return;
  let stream; try { stream = station.stream(30); } catch { toast(t("Recording is not available in this browser"), "bad"); return; }
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => window.MediaRecorder?.isTypeSupported(m));
  if (!mime) { toast(t("Recording is not available in this browser"), "bad"); return; }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 }), chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `ecelon-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.webm`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(t("Clip saved ({s} s)", { s: Math.round((performance.now() - live?.recAt || 0) / 1000) }));
  };
  rec.start(500); live.rec = rec; live.recAt = performance.now();
  $("#live").classList.add("recording"); live.recTimer = setTimeout(stopClip, 20000);
}
function stopClip() { if (!live?.rec) return; clearTimeout(live.recTimer); try { live.rec.stop(); } catch {} live.rec = null; $("#live").classList.remove("recording"); }
{
  $("#live-btn").onclick = () => (live ? stopLive() : startLive());
  const box = $("#live");
  box.querySelector(".lv-x").onclick = stopLive;
  box.querySelector(".lv-rec").onclick = () => (live?.rec ? stopClip() : startClip());
  box.querySelector(".lv-snap").onclick = () => { try { const a = document.createElement("a"); a.href = station.snapshot(); a.download = `ecelon-${Date.now()}.png`; a.click(); toast(t("Picture saved")); } catch { toast(t("Could not save the picture"), "bad"); } };
  document.addEventListener("keydown", (e) => { if (live && e.key === "Escape" && !document.querySelector("dialog[open]")) { e.preventDefault(); stopLive(); } });
  // screensaver: left alone for a few minutes, the station goes on air by itself and comes back at the first touch
  const IDLE_MS = (Number(new URLSearchParams(location.search).get("idle")) || 240) * 1000; let idleT = 0, idleAt = performance.now(); // ?idle=10 to try it
  const canAuto = () => !proView && !live && !selectedId && !replay && !standup && !document.querySelector("dialog[open]") && !document.body.classList.contains("focus") && document.visibilityState === "visible";
  const armIdle = () => { clearTimeout(idleT); idleT = setTimeout(() => { if (canAuto()) startLive(true); else armIdle(); }, IDLE_MS); };
  const touched = () => { const now = performance.now(); if (live?.auto && now - idleAt > 1200) stopLive(); idleAt = now; armIdle(); };
  for (const ev of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, touched, { passive: true, capture: true });
  armIdle();
}

// the payslip: per member this week, and the cost spread over the requirement items the runs touched
async function openPayroll(tk) {
  const lead = leadOfTeam(tk); let p; try { p = await api(`/api/payroll/${encodeURIComponent(tk)}?since=${weekStart()}`); payroll.set(tk, p); pushOffice(); } catch (e) { toast(e.message, "bad"); return; }
  const d = $("#dlg-payroll"); $("#py-title").textContent = `${lead?.name || tk} · ${t("Payroll")}`;
  $("#py-sub").textContent = t("Since Monday · {total} in total · {n} {n|run|runs}", { total: money(p.totalUsd), n: p.members.reduce((s, m) => s + m.runs, 0) });
  const mem = $("#py-members"); mem.innerHTML = "";
  for (const m of p.members.sort((a, b) => b.costUsd - a.costUsd)) {
    const row = document.createElement("div"); row.className = "py-row";
    row.innerHTML = `<i style="background:${ROLE_COLOR[m.role] || "#888"}"></i><b></b><span></span><em></em>`;
    row.querySelector("b").textContent = meta.roles?.[m.role]?.label || m.name;
    row.querySelector("span").textContent = m.runs ? t("{n} {n|run|runs} · {h} h · {k} turns", { n: m.runs, h: (m.durationMs / 3600000).toFixed(1), k: m.turns }) : t("no runs this week");
    row.querySelector("em").textContent = money(m.costUsd); mem.append(row);
  }
  const tb = $("#py-items tbody"); tb.innerHTML = "";
  for (const it of p.items.slice(0, 40)) {
    const tr = document.createElement("tr");
    const who = Object.entries(it.members).sort((a, b) => b[1] - a[1]).map(([r, v]) => `${meta.roles?.[r]?.label || r} ${money(v)}`).join(" · ");
    tr.innerHTML = `<td><code></code></td><td class="py-t"></td><td class="py-w"></td><td class="py-n"></td><td class="py-m"></td>`;
    tr.querySelector("code").textContent = it.code; tr.querySelector(".py-t").textContent = it.title || ""; tr.querySelector(".py-w").textContent = who;
    tr.querySelector(".py-n").textContent = it.runs; tr.querySelector(".py-m").textContent = money(it.costUsd);
    if (it.verified === "verified") tr.classList.add("ok"); else if (it.verified === "failed") tr.classList.add("bad");
    tb.append(tr);
  }
  $("#py-items").hidden = !p.items.length; $("#py-noitems").hidden = !!p.items.length;
  d.showModal();
}
$("#py-close").onclick = () => $("#dlg-payroll").close();

// ================= professional view =================
let boardRaf = 0;
function renderBoard() { if (proView && !boardRaf) boardRaf = requestAnimationFrame(() => { boardRaf = 0; renderBoardNow(); }); }
// a role's mark on the roster: its initial, or two letters when two roles of the team share one (Geliştirici / Gözden geçirici)
function monoOf(a, team) {
  const first = (x) => String(roleLabel(x) || "?").trim().charAt(0).toLocaleUpperCase(locale()), l = String(roleLabel(a) || "?").trim();
  return team.filter((x) => first(x) === first(a)).length > 1 ? first(a) + l.charAt(1).toLocaleLowerCase(locale()) : first(a);
}
const ROLE_ORDER = ["dev", "analyst", "tester", "reviewer"];
const setHtml = (el, html) => { if (el.__h !== html) { el.__h = html; el.innerHTML = html; } }; // touch the page only when something changed: no flicker, clicks never land on a node that is being replaced
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
let boardShape = "";
const hoursText = (ms) => { const h = ms / 3600000; return h >= 10 ? String(Math.round(h)) : h.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
// what the week looked like in work, not in money: on a subscription the dollar figure is only "what the API would
// have charged", and it reads like a bill
const weekText = (p) => { const runs = (p?.members || []).reduce((n, m) => n + m.runs, 0), ms = (p?.members || []).reduce((n, m) => n + m.durationMs, 0); return !runs ? "–" : ms < 360000 ? t("{n} {n|run|runs}", { n: runs }) : t("{n} {n|run|runs} · {h} h", { n: runs, h: hoursText(ms) }); };
// The roster has two layouts: the list (to work in) and the mosaic (to see the whole at a glance).
const BOARD_KEY = "ecelon.board";
let boardMode = lsGet(BOARD_KEY, "list") === "map" ? "map" : "list";
// The mosaic: every project is a block, and the block fills from the bottom with what has been proven. Solid is
// verified with evidence, hatched is what the document calls done without proof, empty is what is left. The bigger
// the scope, the bigger the block. Linked projects are laid next to each other.
let mosaicSig = "", mosaicSeen = false;
function renderMosaic(el, teams) {
  const box = el.querySelector(".bd-map"); if (!box) return;
  const selTk = current() ? teamKey(current()) : "", at = new Map(teams.map((x) => [x.tk, x]));
  // linked projects walk together, so they end up side by side
  const order = [], seen = new Set(), leadOfT = (x) => x.team.find((a) => roleOf(a) === "dev") || x.team[0];
  const walk = (x) => { const q = [x]; seen.add(x.tk); while (q.length) { const c = q.shift(); order.push(c); for (const k of leadOfT(c).links || []) { const d = at.get(k); if (d && !seen.has(k)) { seen.add(k); q.push(d); } } } };
  for (const x of teams) if (!seen.has(x.tk)) walk(x);
  const maxTotal = Math.max(1, ...order.map((x) => overview[x.tk]?.reqs?.total || 0));
  const tiles = order.map((x) => {
    const lead = leadOfT(x), r = overview[x.tk]?.reqs, total = r?.total || 0, done = r?.done || 0, claimed = Math.min(total - done, r?.mismatches || 0);
    const busy = x.team.filter(isBusy), wait = x.team.find((a) => (a.attention || a.status === "error") && !isBusy(a));
    const size = total && (total === maxTotal || total >= maxTotal * 0.5) ? "l" : total ? "m" : "s";
    const pips = x.team.map((a) => `<i class="${isBusy(a) ? "busy" : (a.attention || a.status === "error") ? "wait" : a.status === "done" ? "fin" : ""}" title="${escHtml(roleLabel(a))}"></i>`).join("");
    const state = wait ? (wait.attention?.kind === "permission" ? t("{role} is waiting for your permission", { role: roleLabel(wait) }) : t("{role} needs you", { role: roleLabel(wait) })) : busy.length ? t("{role} is working", { role: busy.map(roleLabel).join(", ") }) : "";
    const linked = (lead.links || []).map((k) => at.get(k)).filter(Boolean).map((d) => leadOfT(d).name);
    const week = weekText(payroll.get(x.tk));
    return { tk: x.tk, id: lead.id, name: lead.name, size, total, done, claimed, pct: total ? Math.round((done / total) * 100) : 0, pips, state, cls: (wait ? " wait" : busy.length ? " busy" : "") + (selTk === x.tk ? " sel" : "") + (total ? "" : " bare"),
      note: total ? t("{done} of {total} proven", { done, total }) + (r?.mismatches ? ". " + t("{n} said done, not proven", { n: r.mismatches }) : "") : t("No requirements yet"), week: week === "–" ? "" : week, linked: linked.length ? t("Linked with {names}", { names: linked.join(", ") }) : "" };
  });
  const sig = JSON.stringify(tiles); if (sig === mosaicSig && box.firstChild) return; mosaicSig = sig;
  const first = !mosaicSeen; mosaicSeen = true;
  box.innerHTML = `<div class="mz${first ? " rise" : ""}">${tiles.map((x, i) => `<button type="button" class="mz-t ${x.size}${x.cls}" data-id="${escHtml(x.id)}" style="--i:${i}">
      <span class="mz-fill" style="--done:${x.total ? (x.done / x.total) * 100 : 0}%;--claimed:${x.total ? (x.claimed / x.total) * 100 : 0}%">${x.claimed ? '<i class="mz-claimed"></i>' : ""}${x.done ? '<i class="mz-done"></i>' : ""}</span>
      <span class="mz-top"><b class="mz-name">${escHtml(x.name)}</b><span class="mz-pips">${x.pips}</span></span>
      ${x.state ? `<span class="mz-state">${escHtml(x.state)}</span>` : ""}
      <span class="mz-foot">${x.total ? `<strong class="mz-pct">${x.pct}<small>%</small></strong>` : ""}<span class="mz-note"><span>${escHtml(x.note)}${x.week && x.size === "l" ? `<br>${escHtml(t("This week: {week}", { week: x.week }))}` : ""}${x.linked && x.size !== "m" ? `<br>${escHtml(x.linked)}` : ""}</span></span></span>
    </button>`).join("")}</div>
    <p class="mz-key"><span><i class="k-done"></i>${escHtml(t("proven with evidence"))}</span><span><i class="k-claimed"></i>${escHtml(t("said done, not proven"))}</span><span><i class="k-open"></i>${escHtml(t("not done yet"))}</span></p>`;
  if (first) requestAnimationFrame(() => requestAnimationFrame(() => box.querySelector(".mz")?.classList.remove("rise")));
}
function renderBoardNow() {
  const el = $("#board"); if (!proView) return;
  const teams = teamOrder().map((tk) => ({ tk, team: teamOf(agents.find((x) => teamKey(x) === tk)) })).filter((x) => x.team.length);
  for (const x of teams) { x.team = [...x.team].sort((p, q) => ROLE_ORDER.indexOf(roleOf(p)) - ROLE_ORDER.indexOf(roleOf(q))); x.wait = x.team.some((a) => (a.attention || a.status === "error") && !isBusy(a)); x.live = x.wait || x.team.some((a) => isBusy(a) || a.status === "done"); }
  teams.sort((a, b) => (a.wait ? 0 : a.live ? 1 : 2) - (b.wait ? 0 : b.live ? 1 : 2)); // waiting for you, then at work, then the rest in your own order
  const shape = boardMode + "|" + teams.map((x) => x.tk + (x.live ? "+" : "-") + x.team.map((a) => a.id + roleOf(a)).join(",")).join("|") + "|" + (meta.claudeMissing || "");
  if (shape !== boardShape || !el.firstChild) {
    boardShape = shape;
    el.innerHTML = `<header class="bd-head"><div><p class="bd-eyebrow"></p><h1>${escHtml(t("Projects"))}</h1><p class="bd-sub"></p></div><div class="bd-side"><div class="bd-modes" role="group" aria-label="${escHtml(t("Layout"))}"><button type="button" data-mode="list" aria-pressed="${boardMode === "list"}">${escHtml(t("List"))}</button><button type="button" data-mode="map" aria-pressed="${boardMode === "map"}">${escHtml(t("Mosaic"))}</button></div><div class="bd-kpis"></div></div></header>
      ${meta.claudeMissing ? `<p class="bd-warn" role="alert">${escHtml(meta.claudeMissing)}</p>` : ""}
      <div class="bd-cols" aria-hidden="true"><span>${escHtml(t("Project"))}</span><span>${escHtml(t("Evidence"))}</span><span>${escHtml(t("Tasks"))}</span><span>${escHtml(t("This week"))}</span><span></span></div>
      <div class="bd-rows"></div><div class="bd-map"></div><section class="bd-chats chat-list"></section>`;
    el.classList.toggle("map", boardMode === "map"); mosaicSig = "";
    const rows = el.querySelector(".bd-rows");
    if (!teams.length) rows.innerHTML = `<div class="bd-empty"><p>${escHtml(t("No projects yet. Add a project folder to start."))}</p><button type="button" class="btn primary" data-bd="add">${escHtml(t("Add project"))}</button></div>`;
    for (const { tk, team, live } of teams) {
      const lead = team.find((x) => roleOf(x) === "dev") || team[0];
      const row = document.createElement("article"); row.className = "bd-row" + (live ? " live" : ""); row.dataset.tk = tk;
      row.innerHTML = `<button type="button" class="bd-name" data-id="${escHtml(lead.id)}" title="${escHtml(t("Open the conversation"))}"><b></b><span></span></button>
        <button type="button" class="bd-ev" data-bd="scope" title="${escHtml(t("Open Scope: requirements and their evidence"))}"></button>
        <button type="button" class="bd-tasks" data-bd="tasks" title="${escHtml(t("Open the task board"))}"><span><b data-k="todo"></b>${escHtml(t("to do"))}</span><span><b data-k="doing"></b>${escHtml(t("doing"))}</span><span><b data-k="done"></b>${escHtml(t("done"))}</span></button>
        <div class="bd-week"></div>
        <button type="button" class="bd-open" data-id="${escHtml(lead.id)}">${escHtml(t("Open"))}<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <div class="bd-team"></div>`;
      const tm = row.querySelector(".bd-team");
      for (const a of team) {
        const c = document.createElement("button"); c.type = "button"; c.dataset.id = a.id; c.className = "bd-m"; c.title = t("Talk to the {role}", { role: roleLabel(a) });
        c.innerHTML = `<i class="bd-mono"></i><span><b></b><em></em></span>`;
        c.querySelector(".bd-mono").textContent = monoOf(a, team); c.querySelector("b").textContent = roleLabel(a); tm.append(c);
      }
      rows.append(row);
    }
  }
  // the parts that change
  const busyN = agents.filter(isBusy).length, waitN = teams.filter((x) => x.wait).length;
  let done = 0, total = 0, open = 0, runs = 0, ms = 0;
  for (const { tk } of teams) { const ov = overview[tk] || {}; done += ov.reqs?.done || 0; total += ov.reqs?.total || 0; open += (ov.tasks?.todo || 0) + (ov.tasks?.doing || 0); for (const m of payroll.get(tk)?.members || []) { runs += m.runs; ms += m.durationMs; } }
  const kpi = (v, l) => `<div class="bd-kpi"><b>${escHtml(v)}</b><span>${escHtml(l)}</span></div>`;
  setText(el.querySelector(".bd-eyebrow"), new Date().toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }));
  setHtml(el.querySelector(".bd-sub"), `${escHtml(t("{n} {n|project|projects}", { n: teams.length }))} · ${escHtml(busyN ? t("{n} working", { n: busyN }) : t("nobody is working"))}${waitN ? ` · <strong>${escHtml(t("{n} waiting for you", { n: waitN }))}</strong>` : ""}`);
  setHtml(el.querySelector(".bd-kpis"), kpi(total ? `${done}/${total}` : "–", t("Verified with evidence")) + kpi(open, t("Open tasks")) + kpi(runs, t("Runs this week")) + kpi(hoursText(ms), t("Agent hours this week")));
  renderChats();
  if (boardMode === "map") { renderMosaic(el, teams); return; }
  const selTk = current() ? teamKey(current()) : "";
  for (const { tk, team } of teams) {
    const row = el.querySelector(`.bd-row[data-tk="${CSS.escape(tk)}"]`); if (!row) continue;
    const lead = team.find((x) => roleOf(x) === "dev") || team[0], ov = overview[tk] || {}, r = ov.reqs, tc = ov.tasks || {}, gs = gitSum[tk];
    row.classList.toggle("bd-att", team.some((a) => (a.attention || a.status === "error") && !isBusy(a))); row.classList.toggle("sel", selTk === tk);
    setText(row.querySelector(".bd-name b"), lead.name);
    setText(row.querySelector(".bd-name span"), [gs?.ok && gs.branch, gs?.ok && gs.changed ? t("{n} changed", { n: gs.changed }) : "", (ov.stack || []).slice(0, 3).join(" · ")].filter(Boolean).join("  ·  ") || lead.cwd || "");
    const none = r ? Math.max(0, r.total - r.done - (r.failed || 0) - (r.stale || 0)) : 0;
    setHtml(row.querySelector(".bd-ev"), r?.total ? `<i class="bd-bar"><u class="ok" style="flex:${r.done}"></u><u class="bad" style="flex:${r.failed || 0}"></u><u class="warn" style="flex:${r.stale || 0}"></u><u style="flex:${none}"></u></i><span><b>${r.done}/${r.total}</b> ${escHtml(t("proven"))}${r.mismatches ? ` · <em>${escHtml(t("{n} {n|mismatch|mismatches}", { n: r.mismatches }))}</em>` : ""}</span>` : `<span class="bd-dim">${escHtml(t("No requirements yet"))}</span>`);
    for (const k of ["todo", "doing", "done"]) setText(row.querySelector(`.bd-tasks [data-k="${k}"]`), String(tc[k] || 0));
    row.querySelector(".bd-tasks").classList.toggle("zero", !(tc.todo || tc.doing || tc.done));
    setText(row.querySelector(".bd-week"), weekText(payroll.get(tk)));
    for (const a of team) {
      const c = row.querySelector(`.bd-m[data-id="${CSS.escape(a.id)}"]`); if (!c) continue;
      const busy = isBusy(a), wait = (a.attention || a.status === "error") && !busy;
      const cls = "bd-m" + (busy ? " busy" : wait ? " wait k-" + (a.attention?.kind || "error") : a.status === "done" ? " fin" : "");
      if (c.className !== cls) c.className = cls;
      setText(c.querySelector("em"), busy ? (actText.get(a.id) || t("Working…")) : wait ? (a.attention?.kind === "permission" ? t("Waiting for permission") : a.attention?.kind === "error" || a.status === "error" ? t("Error") : a.attention?.text || t("Waiting for you")) : STATUS_TEXT[a.status] || t("Idle"));
    }
  }
}
$("#board").addEventListener("click", (e) => {
  if (e.target.closest("[data-bd='add']")) { $("#btn-add").click(); return; }
  const md = e.target.closest("[data-mode]"); if (md) { boardMode = md.dataset.mode; lsSet(BOARD_KEY, boardMode); renderBoardNow(); return; }
  const m = e.target.closest("[data-id]"); if (m) { selectAgent(m.dataset.id); return; }
  const act = e.target.closest("[data-bd]"); if (!act) return;
  const tk = act.closest(".bd-row")?.dataset.tk, lead = agents.find((a) => teamKey(a) === tk && roleOf(a) === "dev") || agents.find((a) => teamKey(a) === tk); if (!lead) return;
  if (act.dataset.bd === "scope") reqsUI.open(lead); else if (act.dataset.bd === "tasks") tasksUI.open(lead);
});
function applyView() {
  document.body.classList.toggle("pro", proView); $("#board").hidden = !proView; sfx.muted = proView; station.pauseSync();
  const b = $("#btn-view"); b.setAttribute("aria-pressed", String(proView)); b.title = proView ? t("Switch to the office view") : t("Switch to the professional view"); b.setAttribute("aria-label", b.title);
  if (proView) { if (live) stopLive(); renderBoardNow(); }
}
$("#btn-view").onclick = () => { proView = !proView; lsSet(VIEW_KEY, proView ? "pro" : "office"); applyView(); };
if (noGL) $("#btn-view").hidden = true; // nothing to switch to

// ================= the server is older than its files =================
// The server keeps running when the window is closed, so after an update the page can be newer than the process
// behind it (missing features, half-translated texts). Say so, and restart it from here.
function staleBar(kind) {
  let bar = $("#stale-bar"); if (!bar) { bar = document.createElement("div"); bar.id = "stale-bar"; bar.setAttribute("role", "alert"); document.body.append(bar); }
  if (kind === "old") { bar.innerHTML = `<b>${escHtml(t("The server is still running an older version."))}</b><span>${escHtml(t("Closing the window does not stop it. End node.exe in Task Manager (on macOS/Linux: stop the node process), then open Ecelon Station again."))}</span>`; return; }
  bar.innerHTML = `<b>${escHtml(t("The server files were updated."))}</b><span>${escHtml(t("The server has to restart to run the new version."))}</span><button type="button" class="btn sm primary">${escHtml(t("Restart the server"))}</button>`;
  bar.querySelector("button").onclick = async (e) => {
    const btn = e.currentTarget, was = meta.build; btn.disabled = true;
    try { await api("/api/restart", { method: "POST", body: {} }); }
    catch (err) { btn.disabled = false; toast(err.message, "bad"); return; }
    btn.textContent = t("Restarting…");
    for (let i = 0; i < 80; i++) { await pause(500); try { const m = await fetch("/api/meta").then((r) => r.json()); if (m.build && m.build !== was) { location.reload(); return; } } catch {} }
    btn.disabled = false; btn.textContent = t("Restart the server"); toast(t("The server did not come back. Open Ecelon Station again from its shortcut."), "bad");
  };
}

// ================= app window =================
// Opened by the launcher as an app window (?app=1): behave like a desktop app — the browser's developer shortcuts
// and its own right-click menu stay out of the way. This is tidiness, not protection: the server never trusts the
// page. Text fields keep their menu (copy, paste, spelling); ?dev=1 switches it off for the session.
{
  const q = new URLSearchParams(location.search); let on = false;
  try { if (q.get("dev") === "1") sessionStorage.removeItem("ecelon.app"); else if (q.get("app") === "1") sessionStorage.setItem("ecelon.app", "1"); on = sessionStorage.getItem("ecelon.app") === "1"; } catch { on = q.get("app") === "1" && q.get("dev") !== "1"; }
  if (on) {
    document.documentElement.classList.add("app-window");
    if (/Electron\//.test(navigator.userAgent)) document.documentElement.classList.add("no-speech"); // the desktop shell has no speech service: no dictation button that cannot work
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (e.key === "F12" || (mod && e.shiftKey && (k === "i" || k === "j" || k === "c")) || (mod && !e.shiftKey && k === "u")) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    window.addEventListener("contextmenu", (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, [contenteditable], .monaco-editor") || String(getSelection() || "").trim()) return;
      e.preventDefault(); // handlers of our own menus still run: this only keeps the browser's menu closed
    });
  }
}

// ================= free chats =================
// One assistant, no project and no team: for a question, a draft, a file to look at. Listed apart from the
// projects, newest first, named after the first message. "Turn into a project" gives it a folder and a team.
let ccImported = 0; // conversations an earlier version copied from Claude Code sessions into projects
async function refreshCcSessions() {
  try { ccImported = (await api("/api/cc-sessions/imported")).length; } catch { ccImported = 0; }
  renderChats();
}
// Chats are the ones started here, newest first; they live in the station and nowhere else.
function renderChats() {
  const sel = selectedId, rows = [];
  for (const a of chatList()) {
    const busy = isBusy(a), wait = a.attention && !busy, when = new Date(a.lastUsedAt || a.createdAt || 0).getTime();
    const sub = busy ? (actText.get(a.id) || t("Working…")) : wait ? t("Waiting for you") : (when ? notifTime(when) : "");
    rows.push({ at: busy || wait ? Infinity : when, html: `<div class="ch-row${a.id === sel ? " sel" : ""}${busy ? " busy" : wait ? " wait" : ""}"><button type="button" class="ch-open" data-chat="${escHtml(a.id)}"><b>${escHtml(a.name)}</b><span>${escHtml(sub)}</span></button>` +
      `<button type="button" class="ch-act" data-chat-ren="${escHtml(a.id)}" title="${escHtml(t("Rename"))}" aria-label="${escHtml(t("Rename {name}", { name: a.name }))}">${ICON.edit}</button>` +
      `<button type="button" class="ch-act del" data-chat-del="${escHtml(a.id)}" title="${escHtml(t("Delete chat"))}" aria-label="${escHtml(t("Delete {name}", { name: a.name }))}">${ICON.trash}</button></div>` });
  }
  rows.sort((p, q) => q.at - p.at);
  const html = `<header class="ch-head"><h2>${escHtml(t("Chats"))}</h2><button type="button" class="ch-new" data-chat-new>${escHtml(t("New chat"))}</button></header>` +
    `<p class="ch-note">${escHtml(t("One assistant, no project and no team. A chat started here stays here."))}</p>` +
    (rows.length ? `<div class="ch-rows">${rows.slice(0, 40).map((r) => r.html).join("")}</div>` : `<p class="ch-empty">${escHtml(t("No chats yet. Start one with New chat."))}</p>`) +
    (ccImported ? `<button type="button" class="ch-undo" data-cc-undo>${escHtml(t("Take back the {n} brought in", { n: ccImported }))}</button>` : "");
  for (const el of document.querySelectorAll("#chat-list, .bd-chats")) setHtml(el, html);
}
async function newChat() {
  try { const a = await api("/api/chats", { method: "POST", body: {} }); await refresh(); await selectAgent(a.id); $("#prompt")?.focus(); }
  catch (e) { toast(e.message, "bad"); }
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-chat-new]")) { newChat(); return; }
  const ren = e.target.closest("[data-chat-ren]"); if (ren) { renameChat(ren.dataset.chatRen); return; }
  const del = e.target.closest("[data-chat-del]"); if (del) { deleteChat(del.dataset.chatDel); return; }
  const row = e.target.closest("[data-chat]"); if (row) { selectAgent(row.dataset.chat); return; }
  if (e.target.closest("[data-cc-undo]")) undoImports();
});
async function renameChat(id) {
  const a = agents.find((x) => x.id === id); if (!a) return;
  const name = (await askText(t("Rename chat"), t("Chat name"), a.name, { ok: t("Save") }))?.trim(); if (!name || name === a.name) return;
  try { await api(`/api/agents/${a.id}`, { method: "PATCH", body: { name } }); await refresh(); } catch (err) { toast(err.message, "bad"); }
}
// A chat has no folder of the user's behind it, so deleting it is final: say so, then remove it with its transcript.
async function deleteChat(id) {
  const a = agents.find((x) => x.id === id); if (!a) return;
  if (!(await confirmBox({ title: t("Delete {name}?", { name: a.name }), body: t("The chat and everything written in it are deleted. This cannot be undone."), ok: t("Delete chat"), danger: true }))) return;
  try { await api(`/api/agents/${a.id}`, { method: "DELETE" }); } catch (err) { toast(err.message, "bad"); return; }
  if (selectedId === a.id) closePanel();
  await refresh(); toast(t("{name} deleted", { name: a.name }));
}
async function undoImports() {
  if (!(await confirmBox({ title: t("Take back what was brought in?"), body: t("{n} {n|conversation|conversations} made from Claude Code sessions will be removed from their projects here. The sessions themselves stay in Claude Code, untouched, and each project goes back to its previous conversation.", { n: ccImported }), ok: t("Take them back") }))) return;
  try { const r = await api("/api/cc-sessions/undo", { method: "POST", body: {} }); await refresh(); if (current()) loadChat(); await refreshCcSessions(); toast(r.skipped?.length ? t("{n} taken back; still running, left alone: {names}", { n: r.removed, names: r.skipped.join(", ") }) : t("{n} taken back.", { n: r.removed }), "good"); }
  catch (err) { toast(err.message, "bad"); }
}
$("#btn-toproject").onclick = async () => {
  const a = current(); if (!a?.solo) return;
  try {
    const r = await api("/api/pick-folder", { method: "POST", body: { start: "" } }); if (r.cancelled || !r.path) return;
    await api(`/api/chats/${a.id}/attach`, { method: "POST", body: { cwd: r.path } });
    await refresh(); document.body.classList.remove("solo-chat"); fillHeader(current());
    toast(t("{name} is now a project with a full team. What was said here stays; the team starts a new session, so tell it what to carry on with.", { name: r.name || a.name }), "good");
  } catch (e) { toast(e.message, "bad"); }
};

// ================= audit trail =================
const AUDIT_GROUPS = () => [["all", t("All"), null], ["perm", t("Permissions"), ["allow_once", "allow_always", "permission_mode", "denied"]], ["command", t("Commands"), ["command"]], ["file", t("Files"), ["file"]], ["verify", t("Verification"), ["verify", "revert"]], ["project", t("Projects"), ["project"]]];
const AUDIT_LABEL = () => ({ command: t("ran"), file: t("wrote"), allow_once: t("allowed once"), allow_always: t("always allows"), permission_mode: t("permission mode"), denied: t("was refused"), verify: t("verified"), revert: t("undid"), project: "" });
let auditState = { team: "", group: "all", all: false };
async function openAudit(tk) {
  auditState = { team: tk || "", group: "all", all: !tk };
  const d = $("#dlg-audit"); $("#au-all").checked = auditState.all; $("#au-chain").textContent = "";
  if (!d.open) d.showModal();
  await renderAudit(true);
}
async function renderAudit(check = false) {
  const groups = AUDIT_GROUPS(), g = groups.find((x) => x[0] === auditState.group) || groups[0], L = AUDIT_LABEL();
  const qs = new URLSearchParams(); if (!auditState.all && auditState.team) qs.set("team", auditState.team); if (g[2]) qs.set("kind", g[2].join(",")); if (check) qs.set("check", "1");
  $("#au-kinds").innerHTML = groups.map(([k, l]) => `<button type="button" class="b2-chip${k === auditState.group ? " on" : ""}" data-g="${k}">${escHtml(l)}</button>`).join("");
  $("#au-csv").href = "/api/audit.csv?" + qs.toString().replace(/&?check=1/, "");
  let r; try { r = await api("/api/audit?" + qs); } catch (e) { toast(e.message, "bad"); return; }
  if (r.chain) { const c = $("#au-chain"); c.className = "au-chain " + (r.chain.ok ? "ok" : "bad"); c.textContent = r.chain.ok ? t("Chain intact · {n} {n|entry|entries}", { n: r.chain.count }) : t("Chain broken at entry {n}", { n: r.chain.brokenAt }); c.title = t("Every entry carries the hash of the previous one. 'Broken' means a line was changed or removed after it was written."); }
  const tb = $("#au-rows"); tb.innerHTML = ""; $("#au-empty").hidden = r.entries.length > 0; tb.closest(".py-wrap").hidden = !r.entries.length;
  let day = "";
  for (const e of r.entries) {
    if (dayKey(e.t) !== day) { day = dayKey(e.t); const h = document.createElement("tr"); h.className = "au-day"; h.innerHTML = "<td colspan=\"3\"></td>"; h.firstChild.textContent = dayLabel(e.t); tb.append(h); }
    const tr = document.createElement("tr"); tr.className = "au-k-" + e.kind + (e.ok === false ? " bad" : "");
    tr.innerHTML = "<td class=\"au-t\"></td><td class=\"au-w\"><b></b><span></span></td><td class=\"au-x\"><em></em><code></code><small></small></td>";
    tr.querySelector(".au-t").textContent = new Date(e.t).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    tr.querySelector("b").textContent = e.role === "user" ? t("You") : e.who; tr.querySelector(".au-w span").textContent = e.role === "user" ? "" : (meta.roles?.[e.role]?.label || e.role);
    tr.querySelector("em").textContent = L[e.kind] ?? e.kind; tr.querySelector("code").textContent = e.what; tr.querySelector("small").textContent = e.extra || "";
    tr.title = e.h; tb.append(tr);
  }
}
$("#au-kinds").onclick = (e) => { const b = e.target.closest("[data-g]"); if (b) { auditState.group = b.dataset.g; renderAudit(); } };
$("#au-all").onchange = (e) => { auditState.all = e.target.checked; renderAudit(); };
$("#au-close").onclick = () => $("#dlg-audit").close();
$("#btn-audit").onclick = () => { $("#menu-pop").hidden = true; openAudit(current() ? teamKey(current()) : ""); };

// the TV replays the day of a room: every run, hand-off, file written and test result, compressed into ~40 seconds
let replay = null;
const TEST_RE = () => TEST_CMD;
async function playReplay(tk) {
  if (replay) stopReplay();
  const evs = await api(`/api/replay/${encodeURIComponent(tk)}?since=${dayStart()}`).catch(() => []);
  const name = leadOfTeam(tk)?.name || tk;
  if (!evs.length) { toast(t("Nothing happened in {name} today yet", { name })); return; }
  // compressed time: long silences shrink to a beat, bursts keep their rhythm
  let at = 0, prev = evs[0].t;
  const sched = evs.map((e) => { at += Math.min((e.t - prev) / 1000 / 25, 1.1) + 0.035; prev = e.t; return { at, e }; });
  const scale = at > 45 ? 45 / at : 1; for (const x of sched) x.at *= scale;
  const box = $("#replay"); box.hidden = false; box.querySelector(".rp-room").textContent = name;
  // marks on the track: red where something failed, green where a run finished fine
  const dur = sched[sched.length - 1].at + 1.5;
  box.querySelector(".rp-marks").innerHTML = sched.filter((x) => x.e.k === "end" || (x.e.k === "res" && x.e.err)).slice(0, 200)
    .map((x) => `<i class="${x.e.err ? "bad" : "ok"}" style="left:${(x.at / dur) * 100}%"></i>`).join("");
  replay = { tk, sched, i: 0, dur, t: 0, last: performance.now(), paused: false, speed: 1, terms: new Map(), tests: new Set(), raf: 0 };
  const team = agents.filter((a) => teamKey(a) === tk);
  for (const m of team) { station.setStatus(m.id, "idle"); station.setActivity(m.id, ""); }
  station.setTV(tk, true); station.tour(tk, 10);
  box.classList.remove("paused");
  const loop = (now) => {
    const r = replay; if (!r) return;
    if (!r.paused) r.t += ((now - r.last) / 1000) * r.speed; r.last = now;
    while (r.i < r.sched.length && r.sched[r.i].at <= r.t) applyReplay(r, r.sched[r.i++].e);
    box.querySelector(".rp-track > i").style.width = Math.min(100, (r.t / r.dur) * 100) + "%";
    const cur = r.sched[Math.max(0, r.i - 1)].e.t; box.querySelector(".rp-clock").textContent = new Date(cur).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
    if (r.t >= r.dur) { stopReplay(); return; }
    r.raf = requestAnimationFrame(loop);
  };
  replay.raf = requestAnimationFrame(loop);
}
function applyReplay(r, e) {
  const id = e.a;
  switch (e.k) {
    case "user": station.setStatus(id, "thinking"); station.setActivity(id, t("thinking…")); break;
    case "tool": {
      station.setStatus(id, "tool"); station.setActivity(id, toolPhrase(e.name, e.file || e.cmd || ""));
      if (e.name === "Edit" || e.name === "Write" || e.name === "MultiEdit") station.setScreen(id, { kind: "code", title: fileName(e.file), lines: String(e.code || "").split("\n").filter((l) => l.trim()).slice(0, 8) });
      else if (e.name === "Read") station.setScreen(id, { kind: "code", title: fileName(e.file), lines: [] });
      else if (e.name === "Bash") {
        const d = { kind: "term", title: e.desc || "terminal", cmd: e.cmd, lines: [] }; r.terms.set(e.id, { id, d }); station.setScreen(id, d);
        if (TEST_RE().test(String(e.cmd || ""))) { r.tests.add(e.id); station.setTest(r.tk, "running"); }
      }
      break;
    }
    case "res": {
      station.setStatus(id, "thinking");
      const tm = r.terms.get(e.id); if (tm) { station.setScreen(tm.id, { ...tm.d, lines: String(e.out || "").split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-6), ok: !e.err }); r.terms.delete(e.id); }
      if (r.tests.has(e.id)) { r.tests.delete(e.id); station.setTest(r.tk, e.err ? "fail" : "pass"); }
      break;
    }
    case "end": station.setStatus(id, e.err ? "error" : "done"); station.setActivity(id, ""); break;
    case "delegate": if (e.to) station.handoff(id, e.to); break;
    case "result": if (e.from) station.handoff(e.from, id); break;
  }
}
function stopReplay() {
  const r = replay; if (!r) return; replay = null; cancelAnimationFrame(r.raf);
  $("#replay").hidden = true; station.setTV(r.tk, false); station.setTest(r.tk, "idle");
  for (const m of agents.filter((a) => teamKey(a) === r.tk)) { station.setStatus(m.id, m.status || "idle"); station.setActivity(m.id, ""); }
}
{
  const box = $("#replay");
  box.querySelector(".rp-x").onclick = stopReplay;
  box.querySelector(".rp-play").onclick = () => { if (!replay) return; replay.paused = !replay.paused; box.classList.toggle("paused", replay.paused); };
  box.querySelector(".rp-speed").onclick = (e) => { if (!replay) return; replay.speed = replay.speed === 1 ? 2 : replay.speed === 2 ? 4 : 1; e.currentTarget.textContent = replay.speed + "×"; };
  document.addEventListener("keydown", (e) => { if (replay && e.key === "Escape" && !document.querySelector("dialog[open]")) { e.preventDefault(); stopReplay(); } });
}

// morning stand-up: the first time the station opens in a day, the camera tours the rooms; each team gathers at its
// meeting table and the card says what got done yesterday, what is open today and what blocks it
// ================= demo tour =================
// In demo mode the station offers to play the whole loop by itself once: the analyst turns the document into
// requirements, compares them with the code, a different agent (the tester) verifies with evidence, and the one
// item the document calls "done" without proof ends up as a mismatch. Nothing is faked for the tour: it sends the
// same three prompts the Scope buttons send and waits for the (scripted) agents to finish.
const TOUR_KEY = "ecelon.tourDone";
let tour = null;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitRun(id, max = 60000) {
  const t0 = Date.now(); let seen = false;
  while (tour && Date.now() - t0 < max) {
    const a = agents.find((x) => x.id === id);
    if (a && isBusy(a)) seen = true; else if (seen || Date.now() - t0 > 8000) return;
    await pause(250);
  }
}
function tourCard({ step = 0, title, text, actions = [] }) {
  const box = $("#tour"); if (box.parentNode !== document.body) document.body.append(box); // above every screen, the Scope screen included
  box.hidden = false;
  box.querySelector(".tr-dots").innerHTML = [1, 2, 3, 4].map((i) => `<i class="${i <= step ? "on" : ""}"></i>`).join("");
  box.querySelector("h3").textContent = title; box.querySelector("p").textContent = text;
  const act = box.querySelector(".tr-act"); act.innerHTML = "";
  for (const [label, fn, primary] of actions) { const b = document.createElement("button"); b.type = "button"; b.className = "btn sm " + (primary ? "primary" : "ghost"); b.textContent = label; b.onclick = fn; act.append(b); }
}
function endTour(done = true) { tour = null; $("#tour").hidden = true; if (done) lsSet(TOUR_KEY, 1); }
async function playTour() {
  const lead = agents.find((a) => roleOf(a) === "dev" && /api/i.test(a.name)) || agents.find((a) => roleOf(a) === "dev");
  if (!lead || tour) return;
  const team = teamOf(lead), analyst = team.find((a) => roleOf(a) === "analyst"), tester = team.find((a) => roleOf(a) === "tester");
  if (!analyst || !tester) return;
  tour = { lead }; lsSet(TOUR_KEY, 1);
  const skip = [t("Skip"), () => endTour()];
  const run = async (step, title, text, agent, prompt) => {
    if (!tour) return;
    tourCard({ step, title, text, actions: [skip] }); station.focus(lead.id);
    await sendPrompt({ text: prompt }, agent); await waitRun(agent.id); await pause(900);
  };
  await run(1, t("The analyst reads the document"), t("It turns the linked analysis document into numbered requirements, each with the document's own wording."), analyst, t("Extract the requirements from the linked documents and save them to the Scope list."));
  await run(2, t("…and checks every item against the code"), t("Each requirement gets a status and a pointer to the file and line where it lives, or a note saying it is missing."), analyst, t("Compare the requirements with the code and update their status."));
  await run(3, t("A different agent verifies"), t("The tester did not write the code. It runs the scenarios and must attach evidence: lines or tests that really exist in the project."), tester, t("Verify the requirements with evidence."));
  if (!tour) return;
  reqsUI.open(lead);
  tourCard({ step: 4, title: t("One item says “done” but nothing proves it"), text: t("That is a mismatch, not a green tick. The proof report puts the whole chain on one page you can hand to somebody else."),
    actions: [[t("Open the proof report"), () => { window.open(`/api/reqs/${encodeURIComponent(teamKey(lead))}/report`, "_blank", "noopener"); endTour(); }, true], [t("Close"), () => endTour()]] });
}
function offerTour() {
  if (!meta.demo || tour || lsGet(TOUR_KEY, 0)) return;
  tourCard({ step: 0, title: t("See the whole loop in a minute"), text: t("Document → requirements → code → verification with evidence, played by the sample team. You only watch."),
    actions: [[t("Play"), () => playTour(), true], [t("Not now"), () => endTour()]] });
}
const STANDUP_KEY = "standupDay";
const sameDay = () => new Date().toDateString();
let standup = null;
async function startStandup(auto = false) {
  if (standup || !agents.length) return;
  const since = dayStart() - DAY;
  const ov = await api(`/api/overview?since=${since}&old=${Date.now() - 3 * DAY}`).catch(() => overview);
  const rooms = teamOrder().map((tk) => {
    const o = ov[tk] || {}, tasks = o.tasks || {}, r = o.reqs, gs = gitSum[tk] || {}, team = agents.filter((x) => teamKey(x) === tk);
    const y = [], td = [], b = [];
    if (tasks.doneSince) y.push(t("{n} {n|task|tasks} done", { n: tasks.doneSince }));
    if (r?.total) y.push(t("Scope: {done}/{total} verified", { done: r.done, total: r.total }));
    if (gs.ahead) y.push(t("{n} {n|commit|commits} waiting to be pushed", { n: gs.ahead }));
    const open = (tasks.todo || 0) + (tasks.doing || 0) + (tasks.blocked || 0);
    if (open) td.push(t("{n} open {n|task|tasks}", { n: open }) + (tasks.doing ? ` · ${t("{n} in progress", { n: tasks.doing })}` : ""));
    if (tasks.toUser) td.push(t("{n} waiting for you", { n: tasks.toUser }));
    if (gs.changed) td.push(t("{n} {n|change|changes} not committed", { n: gs.changed }));
    for (const m of team) if (m.attention?.kind === "permission") b.push(t("{role} waits for permission", { role: roleLabel(m) }));
    if (tasks.blocked) b.push(t("{n} blocked {n|task|tasks}", { n: tasks.blocked }));
    if (r?.failed) b.push(t("{n} failed {n|verification|verifications}", { n: r.failed }));
    if (tasks.old) b.push(t("{n} {n|task|tasks} untouched for 3+ days", { n: tasks.old }));
    return { tk, name: leadOfTeam(tk)?.name || tk, y, td, b, weight: y.length + td.length + b.length };
  }).filter((x) => x.weight).slice(0, 8);
  if (!rooms.length) { if (!auto) toast(t("Nothing to report yet: no tasks, scope or changes in any room")); return; }
  try { localStorage.setItem(STANDUP_KEY, sameDay()); } catch {}
  const box = $("#standup"); let i = -1, timer = 0;
  const dots = box.querySelector(".su-dots"); dots.innerHTML = rooms.map(() => "<i></i>").join("");
  const fill = (sel, list) => { const ul = box.querySelector(sel + " ul"); ul.innerHTML = ""; for (const x of list.length ? list : ["–"]) { const li = document.createElement("li"); li.textContent = x; ul.append(li); } };
  const STEP = 5200;
  const show = () => {
    if (i >= 0) station.gather(rooms[i].tk, false);
    i++; if (i >= rooms.length) return end();
    const r = rooms[i];
    station.gather(r.tk, true); station.tour(r.tk, 11);
    box.querySelector(".su-room").textContent = r.name;
    fill(".su-y", r.y); fill(".su-t", r.td); fill(".su-b", r.b);
    box.querySelector(".su-b").classList.toggle("has", r.b.length > 0);
    dots.querySelectorAll("i").forEach((d, k) => d.classList.toggle("on", k <= i));
    const bar = box.querySelector(".su-bar i"); bar.style.transition = "none"; bar.style.width = "0"; void bar.offsetWidth; bar.style.transition = `width ${STEP}ms linear`; bar.style.width = "100%";
    timer = setTimeout(show, STEP);
  };
  const end = () => {
    clearTimeout(timer); if (i >= 0 && i < rooms.length) station.gather(rooms[i].tk, false);
    box.hidden = true; standup = null; station.fit(); document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(); } else if (e.key === "ArrowRight") { clearTimeout(timer); show(); } };
  document.addEventListener("keydown", onKey, true);
  box.querySelector(".su-skip").onclick = end;
  standup = { end }; box.hidden = false; show();
}
$("#standup-btn").onclick = () => (standup ? standup.end() : startStandup(false));
// once a day, after 06:00, a few seconds after opening (when the data is in)
setTimeout(() => { let last = ""; try { last = localStorage.getItem(STANDUP_KEY) || ""; } catch {} if (last !== sameDay() && new Date().getHours() >= 6 && !meta.demo && !proView && !selectedId && !document.body.classList.contains("focus")) startStandup(true); }, 6000);

// approval queue: everyone waiting for permission, across all projects, grant from here
function renderInbox() {
  const box = $("#inbox"); if (!box) return;
  const waiting = agents.filter((a) => a.attention?.kind === "permission" && !isBusy(a));
  box.hidden = !waiting.length; if (!waiting.length) { box.innerHTML = ""; return; }
  const key = waiting.map((a) => a.id + a.attention.at).join("|"); if (box.dataset.key === key) return; box.dataset.key = key;
  let collapsed = false; try { const v = localStorage.getItem("inboxCollapsed"); collapsed = v === "1" || (v == null && proView); } catch {}
  box.classList.toggle("collapsed", collapsed);
  box.innerHTML = `<button type="button" class="ib-head" aria-expanded="${!collapsed}"><span class="ib-dot"></span>${t("Waiting for your approval ({n})", { n: waiting.length })}<svg class="ib-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>`;
  box.querySelector(".ib-head").onclick = (e) => {
    const c = !box.classList.contains("collapsed"); box.classList.toggle("collapsed", c); e.currentTarget.setAttribute("aria-expanded", String(!c));
    try { localStorage.setItem("inboxCollapsed", c ? "1" : "0"); } catch {}
  };
  const SHOW = 2;
  for (const a of waiting.slice(0, SHOW)) {
    const lead = leadOfTeam(teamKey(a)), att = a.attention, specs = att.specs || [];
    const c = document.createElement("div"); c.className = "ib-card";
    c.innerHTML = `<div class="ib-who"><b></b><span></span></div><ul class="ib-items"></ul><div class="ib-act"></div>`;
    c.querySelector("b").textContent = lead?.name || a.name; c.querySelector(".ib-who span").textContent = teamOf(a).length > 1 ? roleLabel(a) : "";
    const ul = c.querySelector("ul");
    for (const it of (att.items || []).slice(0, 3)) { const li = document.createElement("li"); li.innerHTML = "<b></b> <code></code>"; li.querySelector("b").textContent = it.tool; li.querySelector("code").textContent = it.what; ul.append(li); }
    if (!att.items?.length) { const li = document.createElement("li"); li.textContent = att.text; ul.append(li); }
    const act = c.querySelector(".ib-act");
    const b = (label, cls, fn) => { const x = document.createElement("button"); x.type = "button"; x.className = "btn sm " + cls; x.textContent = label; x.onclick = async () => { act.querySelectorAll("button").forEach((y) => (y.disabled = true)); await fn(); }; act.append(x); };
    if (specs.length) {
      b(t("Allow once and continue"), "primary", async () => { await sendPrompt({ text: t("Permission granted, continue where you left off."), allowOnce: specs }, a); });
      b(t("Always allow"), "ghost", async () => { try { await api(`/api/agents/${a.id}`, { method: "PATCH", body: { allowedTools: [...new Set([...(a.allowedTools || []), ...specs])] } }); } catch (err) { toast(err.message, "bad"); return; } await sendPrompt({ text: t("Permission granted, continue where you left off.") }, a); });
    }
    b(t("Open"), "ghost", async () => { await selectAgent(a.id); station.focus(a.id); act.querySelectorAll("button").forEach((y) => (y.disabled = false)); });
    box.append(c);
  }
  if (waiting.length > SHOW) { const m = document.createElement("div"); m.className = "ib-more"; m.textContent = t("+{n} more", { n: waiting.length - SHOW }); box.append(m); }
}

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
  station.setAgents(agents.filter((a) => !a.solo)); // a free chat has no room
  pushOffice(); renderChats();
  for (const id of queue.keys()) flushQueue(id); // the server tells us (agents_changed) when a slot is free: send what is waiting
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
  if (proView) renderBoard();
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
  $("#btn-remove").textContent = a.solo ? t("Delete chat") : t("Remove project from the station");
  $("#a-portrait").style.backgroundImage = portraitUrl(a.char ?? indexOf(a.id));
  $("#model-name").textContent = modelName(a.model);
  $("#effort-name").textContent = effortName(a.effort); $("#effort-btn").title = `${t("Effort: {effort}.", { effort: effortName(a.effort) })} ${EFFORT_DESC[a.effort] || ""}`;
  const perm = PERMS.find(([k]) => k === permOf(a));
  $("#perm-name").textContent = perm[1];
  $("#perm-btn").classList.toggle("risky", perm[0] === "bypassPermissions");
  $("#perm-btn").title = perm[2];
  renderContext(a); renderLinked(a); renderTeamTabs(a); renderReqsBadge(a); renderTasksBadge(a); renderGitBadge(a); renderRunBadge(a);
  const team = teamOf(a);
  $("#prompt").placeholder = team.length > 1 && roleOf(a) === "dev" ? t("Write to the team; the lead hands work to the tester or analyst when needed") : team.length > 1 ? t("Talk directly to {role}", { role: roleLabel(a) }) : t("What do you want from this agent?  @ file · # document");
  setStatus(a.status || "idle", a.busy);
  { // linked (sibling) projects shown in the header
    let ch = $("#a-links"); const links = (leadOf(a).links || []).map((t) => agents.find((x) => teamKey(x) === t && roleOf(x) === "dev") || agents.find((x) => teamKey(x) === t)).filter(Boolean);
    if (!ch) { ch = document.createElement("button"); ch.type = "button"; ch.id = "a-links"; ch.className = "a-linked"; ch.onclick = () => $("#btn-links").click(); $(".a-row").append(ch); }
    ch.hidden = !links.length; ch.textContent = links.length ? `↔ ${links.map((x) => x.name).join(", ")}` : ""; ch.title = t("Linked projects: when an API or something shared changes, the leads notify each other. Click to edit.");
  }
  const att = teamOf(a).find((m) => m.attention);
  if (att && !isBusy(a)) { const p = $("#a-status"); p.className = "status st-error"; p.textContent = p.title = `${teamOf(a).length > 1 && att.id !== a.id ? roleLabel(att) + ": " : ""}${att.attention.text}`; }
}

// context ring: how much of the model's context window this conversation has used
function renderTeamTabs(a = current()) {
  const nav = $("#team-tabs"); if (!a) return;
  $("#btn-remove-role").hidden = true;
  const boss = leadOf(a);
  if (boss.id === a.id) {
    const others = teamOf(a).filter((m) => m.id !== a.id);
    if (!others.length) { nav.hidden = true; nav.innerHTML = ""; return; }
    nav.hidden = false;
    nav.innerHTML = `<div class="team-strip">${others.map((m) => `<button type="button" class="ts-chip st-${m.status || "idle"}${isBusy(m) ? " busy" : ""}" data-id="${escHtml(m.id)}" title="${escHtml(t("{role} chat", { role: roleLabel(m) }))}">${ROLE_ICON[roleOf(m)]}<b>${escHtml(roleLabel(m))}</b><span><i class="dot st-${m.status || "idle"}"></i>${escHtml(STATUS_TEXT[m.status] || t("Idle"))}</span></button>`).join("")}</div>`;
    nav.querySelectorAll(".ts-chip").forEach((b) => { b.onclick = () => selectAgent(b.dataset.id); });
    return;
  }
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
  el.title = t("Context: {used} / {window} tokens. Click to compact (summarize) the conversation and keep going in the same chat. Claude Code also compacts by itself when it fills up.", { used: c.tokens.toLocaleString(locale()), window: c.window.toLocaleString(locale()) });
}
async function compactNow() {
  const a = current(); if (!a) return;
  if (!(await confirmBox({ title: t("Compact the conversation?"), body: t("Claude Code summarizes the conversation so far and the agent continues from that summary, in the same chat. Details of old messages may be lost; the messages stay visible here."), ok: t("Compact") }))) return;
  try { await api(`/api/agents/${a.id}/compact`, { method: "POST", body: {} }); toast(t("Compacting the conversation…")); }
  catch (err) { toast(err.message, "bad"); }
}
$("#ctx").addEventListener("click", compactNow);
$("#ctx").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); compactNow(); } });

async function patch(body) {
  try { await api(`/api/agents/${selectedId}`, { method: "PATCH", body }); await refresh(); }
  catch (err) { toast(err.message, "bad"); }
}

function setStatus(st, busyFlag) {
  const p = $("#a-status"); p.className = "status st-" + st; p.textContent = STATUS_TEXT[st] || st; p.title = "";
  const busy = busyFlag ?? (st === "thinking" || st === "tool");
  $("#btn-stop").hidden = !busy; $("#btn-send").disabled = busy;
  $("#a-portrait").classList.toggle("busy", busy);
}

window.__sel = { t0: 0, net: 0, longs: [] };
try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (window.__sel.t0 && e.startTime + e.duration > window.__sel.t0 && e.startTime < window.__sel.t0 + 4000) window.__sel.longs.push(Math.round(e.duration)); }).observe({ entryTypes: ["longtask"] }); } catch {}
async function selectAgent(id) {
  window.__sel = { t0: performance.now(), net: 0, longs: [] };
  const prev = current();
  if (prev) saveDraft(teamKey(prev));
  selectedId = id; station.select(id);
  const a = current(); if (!a) return;
  if (!prev || teamKey(prev) !== teamKey(a)) restoreDraft(teamKey(a));
  if (unread.delete(teamKey(a))) { saveUnread(); renderList(); }
  lastPick.set(teamKey(a), id);
  $("#panel-empty").hidden = true; $("#panel-agent").hidden = false; document.body.classList.add("has-agent"); document.body.classList.toggle("solo-chat", !!a.solo); if (proView) renderBoard(); renderChats();
  fillHeader(a);
  await loadChat();
}
let loadedConv = null;
let loadSeq = 0;
let chatOf = null;
let loadingChat = null; // live events arriving during load wait here; appended in order once the history is drawn
const CHAT_TAIL = 500; // in a very long conversation only the last events are drawn at first (more via "show earlier")
const CHAT_LIVE_MAX = 500; // messages drawn live before the chat is cut back to its tail
const CHAT_BUDGET = 60000; // ...and by weight: long replies (tables, code) are what makes drawing slow, not the event count
function tailByWeight(log, pages) {
  let w = 0, i = log.length; const cap = CHAT_BUDGET * (1 + pages * 2), max = CHAT_TAIL * (1 + pages * 2);
  while (i > 0 && log.length - i < max) { const e = log[i - 1]; w += 200 + (typeof e.text === "string" ? e.text.length : 0); if (w > cap && log.length - i >= 20 + pages * 40) break; i--; }
  return log.slice(i);
}
let chatPages = 0, chatPagesOf = null;
async function loadChat(more = false) {
  const a = current(); if (!a) return;
  const seq = ++loadSeq;
  loadingChat = { agentId: a.id, evs: [] };
  if (chatOf !== a.id) { chatOf = a.id; $("#chat").innerHTML = `<div class="chat-empty chat-loading"><span class="pulse" aria-hidden="true"><i></i><i></i><i></i></span><span>${t("Loading the {name} conversation…", { name: escHtml(agentLabel(a)) })}</span></div>`; }
  // the conversation list is created on the server when needed; learn the active conversation from it
  const convs = await api(`/api/agents/${a.id}/convs`).catch(() => []);
  const active = convs.find((c) => c.active)?.id || a.activeConv || null;
  a.activeConv = active; loadedConv = active;
  let log; const tN = performance.now(); try { log = await api(`/api/agents/${a.id}/log${active ? "?conv=" + active : ""}`); window.__sel.net = Math.round(performance.now() - tN); } catch (err) { if (seq === loadSeq) { loadingChat = null; $("#chat").innerHTML = `<div class="chat-empty"><b>${t("Conversation could not be loaded")}</b><span>${escHtml(err.message)}</span></div>`; } return; }
  if (seq !== loadSeq || a.id !== selectedId) return; // a newer load started
  if (deltaRaf) { cancelAnimationFrame(deltaRaf); deltaRaf = 0; } deltaBuf = { text: "", think: "" };
  const chat = $("#chat"); chat.innerHTML = ""; liveBubble = liveThink = null; todoCard = null; renderQueue();
  if (chatPagesOf !== a.id || !more) { chatPages = more === true ? 1 : 0; chatPagesOf = a.id; } else chatPages++;
  const tail = tailByWeight(log, chatPages);
  if (tail.length < log.length) {
    const more = document.createElement("button"); more.type = "button"; more.className = "chat-older";
    more.textContent = t("Show the previous {n} {n|event|events}", { n: log.length - tail.length }); more.onclick = () => loadChat(true); chat.append(more);
  }
  const tR = performance.now();
  for (const ev of tail) renderEvent(ev, true);
  window.__load = { events: tail.length, render: Math.round(performance.now() - tR), at: Date.now() };
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
  if (window.__load) { const tL = performance.now(); void chat.offsetHeight; window.__load.layout = Math.round(performance.now() - tL); }
}
function closePanel() {
  if (current()) saveDraft(teamKey(current()));
  selectedId = null; station.select(null); closePops();
  $("#panel-agent").hidden = true; $("#panel-empty").hidden = false; document.body.classList.remove("has-agent", "solo-chat"); if (proView) renderBoard(); renderChats();
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
  if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]") || lib.isOpen || reqsUI.isOpen || tasksUI.isOpen || gitUI.isOpen || edUI.isOpen || runUI.isOpen || practiceUI.isOpen) return;
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
async function addFiles(files, { linkTo } = {}) {
  // non-images (PDF, Word, Excel…) are uploaded to the document library and attached as references
  const docsIn = files.filter((f) => !/^image\/(png|jpeg|gif|webp)$/.test(f.type));
  if (docsIn.length) {
    const up = await lib.upload(docsIn, { collection: "" });
    for (const d of up) addDoc(d.id);
    // dropped onto a room: the document also belongs to that project from now on (the agents know it in every conversation)
    if (linkTo) { for (const d of up) await api(`/api/library/${d.id}`, { method: "PATCH", body: { agents: [...new Set([...(d.agents || []), linkTo])] } }).catch(() => {}); if (up.length) { await lib.load().catch(() => {}); renderLinked(); } }
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
// drop files onto the office: onto a character → attached to a message for that member; onto a room → for its lead,
// and documents are linked to that project
{
  const cv = $("#scene"), tip = $("#tooltip");
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  const target = (e) => { const id = station.pickAt(e.clientX, e.clientY); return id ? agents.find((x) => x.id === id) : null; };
  cv.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return; e.preventDefault();
    const a = target(e), r = $("#stage").getBoundingClientRect();
    tip.hidden = false; tip.style.left = e.clientX - r.left + "px"; tip.style.top = e.clientY - r.top + "px";
    tip.textContent = a ? t("Drop for {who}", { who: agentLabel(a) }) : t("Drop onto a room");
  });
  cv.addEventListener("dragleave", () => { tip.hidden = true; });
  cv.addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return; e.preventDefault(); tip.hidden = true;
    const a = target(e), files = [...(e.dataTransfer?.files || [])]; if (!a || !files.length) return;
    if (selectedId !== a.id) await selectAgent(a.id);
    station.focus(a.id);
    await addFiles(files, { linkTo: leadOf(a).id });
  });
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
  check: `<svg viewBox="0 0 16 16"><path d="M3 8.5 6.5 12 13 4.5"/></svg>`,
  edit: `<svg viewBox="0 0 16 16"><path d="M11 2.5 13.5 5 6 12.5H3.5V10Z"/></svg>`,
  trash: `<svg viewBox="0 0 16 16"><path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.6 8a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8M6.8 7v4M9.2 7v4"/></svg>`,
  redo: `<svg viewBox="0 0 16 16"><path d="M13 3v4H9"/><path d="M13 7a5.5 5.5 0 1 0-1.4 4.7"/></svg>`,
};
function actions(d, list) {
  const bar = document.createElement("div"); bar.className = "msg-actions";
  for (const [icon, title, fn] of list) { const b = document.createElement("button"); b.type = "button"; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = ICON[icon]; b.onclick = (e) => { e.stopPropagation(); fn(); }; bar.append(b); }
  d.append(bar);
}
const copyText = (s) => navigator.clipboard.writeText(s).then(() => toast(t("Copied")), () => toast(t("Could not copy"), "bad"));
// copy button feedback: icon + label switch to "Copied" for 1.5 s; every button keeps its own timer, so several can show it at once
function legacyCopy(text) { // when the Clipboard API refuses (window not focused, old webview)
  const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {} ta.remove();
  return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
}
function copyWithState(btn, text) {
  navigator.clipboard.writeText(text).catch(() => legacyCopy(text)).then(() => {
    if (!btn._idle) btn._idle = btn.innerHTML;
    btn.classList.add("copied"); btn.innerHTML = btn.dataset.check; clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.classList.remove("copied"); btn.innerHTML = btn._idle; }, 1500);
  }, () => toast(t("Could not copy"), "bad"));
}
// bar under a finished assistant message (not shown while it streams: it is only added when the full message arrives)
function replyBar(d, text) {
  const bar = document.createElement("div"); bar.className = "reply-bar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", t("Message actions"));
  const b = document.createElement("button"); b.type = "button"; b.className = "rb-btn";
  b.title = t("Copy message as Markdown"); b.setAttribute("aria-label", t("Copy message as Markdown"));
  b.innerHTML = `${ICON.copy}<span>${t("Copy")}</span>`;
  b.dataset.check = `${ICON.check}<span>${t("Copied")}</span>`;
  b.onclick = (e) => { e.stopPropagation(); copyWithState(b, text); };
  bar.append(b); d.append(bar);
}

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
const OUT_MAX = 20000;
function fillDetail(d) {
  if (d._filled) return; d._filled = true;
  const det = d.querySelector(".tdetail"); det.innerHTML = toolDetail(d.dataset.name, d._input);
  const o = d._out; if (!o) return;
  const pre = document.createElement("pre"); pre.className = "out" + (o.isError ? " bad" : "");
  pre.textContent = o.content.length > OUT_MAX ? o.content.slice(0, OUT_MAX) + "\n… " + t("{n} more characters", { n: o.content.length - OUT_MAX }) : o.content; det.append(pre);
}
function toolRow(ev) {
  const d = addMsg("tool", `<div class="trow"><b></b><span></span><button type="button" class="topen" hidden title="${t("Show in folder")}">${ICON.folder}</button><em class="st">…</em></div><div class="tdetail" hidden></div>`);
  d.dataset.id = ev.toolUseId; d.dataset.name = ev.name;
  const TOOL_LABEL = { mcp__team__set_requirement_status: t("Scope"), mcp__team__save_requirements: t("Scope save"), mcp__team__list_requirements: t("Scope list"), mcp__team__notify_project: t("Sibling project") };
  d.querySelector("b").textContent = TOOL_LABEL[ev.name] || ev.name;
  const sp = d.querySelector("span"); sp.textContent = relToAgent(ev.summary); sp.title = ev.summary || "";
  const det = d.querySelector(".tdetail"); d._input = ev.input; // the detail (diffs, file contents, outputs) is built when the row is opened: a long history has thousands of them
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
  d.querySelector(".trow").onclick = () => { fillDetail(d); if (det.innerHTML.trim()) { det.hidden = !det.hidden; d.classList.toggle("open", !det.hidden); } };
  if (["Edit", "MultiEdit", "Write", "Bash"].includes(ev.name) && ev.input) d.classList.add("expandable");
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
      replyBar(d, ev.text);
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
      if (showOut && ev.content) { t._out = { content: String(ev.content), isError: !!ev.isError }; if (t._filled) { t._filled = false; } t.classList.add("expandable"); }
      if (ev.isError) { fillDetail(t); if (det.innerHTML.trim()) { det.hidden = false; t.classList.add("open"); } }
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
    if (agents.find((x) => x.id === agentId)?.solo) return; // a free chat lives in a scratch folder: no git talk there
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
  if (cp) {
    cp.dataset.check = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5"/></svg><span>${t("Copied")}</span>`;
    copyWithState(cp, cp.closest(".code").querySelector("code").textContent); return; // only the raw code: the language label is outside <code>
  }
  const a = e.target.closest("a[data-open]");
  if (a) { e.preventDefault(); openInFolder(a.dataset.open); }
});
// jump-to-bottom button
let jumpRaf = 0; // reads layout: once per frame at most, never once per event
function updateJump() { if (!jumpRaf) jumpRaf = requestAnimationFrame(() => { jumpRaf = 0; $("#jump").hidden = nearBottom(); updateSticky(); }); }
// like the Claude Code editor: the last prompt you wrote stays pinned at the top once it has scrolled out of view
function updateSticky() {
  const bar = $("#sticky-prompt"), chat = chatEl(), top = chat.getBoundingClientRect().top;
  const users = chat.querySelectorAll(".msg.user");
  let last = null; for (const u of users) { if (u.getBoundingClientRect().bottom < top + 4) last = u; else break; }
  if (!last) { bar.hidden = true; bar._el = null; return; }
  bar._el = last; bar.hidden = false;
  const txt = last.textContent.trim().replace(/\s+/g, " ");
  if (bar._txt !== txt) { bar._txt = txt; bar.querySelector("span").textContent = txt; }
}
$("#sticky-prompt").onclick = () => { const el = $("#sticky-prompt")._el; if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); };
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
const NOTIF_KEEP = 200;
const saveNotifs = () => lsSet("ecelon.notifs", notifs.slice(0, NOTIF_KEEP));
function renderBellBadge() {
  const n = notifs.filter((x) => !x.read).length; let b = $("#btn-notify .nb");
  if (!b) { b = document.createElement("span"); b.className = "nb"; $("#btn-notify").append(b); }
  b.textContent = n > 9 ? "9+" : n || ""; b.hidden = !n;
}
let bellPop = null, bellFilter = { kind: "all", room: "" };
function closeBell() {
  if (!bellPop) return; bellPop.remove(); bellPop = null;
  for (const x of notifs) x.read = true; saveNotifs(); renderBellBadge(); // what you saw is read once the panel closes
}
document.addEventListener("pointerdown", (e) => { if (bellPop && !bellPop.contains(e.target) && !e.target.closest("#btn-notify")) closeBell(); }, true);
document.addEventListener("keydown", (e) => { if (bellPop && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeBell(); } }, true);
const dayKey = (at) => { const d = new Date(at); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dayLabel(at) {
  const d = new Date(at), today = new Date(), y = new Date(Date.now() - DAY);
  if (dayKey(at) === dayKey(today)) return t("Today"); if (dayKey(at) === dayKey(y)) return t("Yesterday");
  return d.toLocaleDateString(locale(), { day: "numeric", month: "long", weekday: "short" });
}
const hhmm = (at) => new Date(at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
function notifTime(at) { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? t("now") : m < 60 ? t("{n} min", { n: m }) : hhmm(at); }
function notifMeta(x) {
  const bits = [];
  if (x.turns) bits.push(t("{n} {n|step|steps}", { n: x.turns }));
  if (x.durationMs) bits.push(x.durationMs >= 90000 ? t("{n} min", { n: Math.round(x.durationMs / 60000) }) : t("{n} s", { n: Math.round(x.durationMs / 1000) }));
  if (x.costUsd && !proView) bits.push(money(x.costUsd));
  return bits.join(" · ");
}
// rows for the list: the same member asking for the same permission again and again becomes one row with a count
function notifRows(list) {
  const rows = [];
  for (const x of list) {
    const p = rows[rows.length - 1];
    if (p && x.kind === "permission" && p.x.kind === "permission" && p.x.agentId === x.agentId && dayKey(p.x.at) === dayKey(x.at)) { p.n++; p.all.push(x); continue; }
    rows.push({ x, n: 1, all: [x] });
  }
  return rows;
}
function openBell() {
  if (bellPop) return closeBell();
  const m = document.createElement("div"); m.className = "bell2"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", t("Notifications"));
  document.body.append(m); bellPop = m;
  const r = $("#btn-notify").getBoundingClientRect();
  const place = () => { m.style.left = Math.max(8, Math.min(r.left - 40, innerWidth - m.offsetWidth - 8)) + "px"; m.style.top = r.bottom + 10 + "px"; m.style.maxHeight = Math.max(260, innerHeight - r.bottom - 22) + "px"; };
  const KIND = { done: ["✓", t("Finished")], error: ["✕", t("Errors")], permission: ["!", t("Permission")] };
  const roomOf = (x) => { if (x.room) return x.room; const a = agents.find((q) => q.id === x.agentId); return a ? leadOf(a).name : x.title.split(" · ")[0]; };
  const go = (id) => { const a = agents.find((q) => q.id === id); closeBell(); if (a) { selectAgent(a.id); station.focus(a.id); } else toast(t("This project is no longer in the station"), "bad"); };
  const render = () => {
    const on = notifyOn && "Notification" in window && Notification.permission === "granted";
    const today = notifs.filter((x) => dayKey(x.at) === dayKey(Date.now()));
    const cnt = (k, arr = today) => arr.filter((x) => x.kind === k).length;
    const waiting = agents.filter((a) => (a.attention?.kind === "permission" || a.attention?.kind === "error") && !isBusy(a));
    const shown = notifs.filter((x) => (bellFilter.kind === "all" || x.kind === bellFilter.kind) && (!bellFilter.room || roomOf(x) === bellFilter.room));
    const digest = today.length ? [cnt("done") && t("{n} finished", { n: cnt("done") }), cnt("error") && t("{n} {n|error|errors}", { n: cnt("error") }), cnt("permission") && t("{n} permission {n|request|requests}", { n: cnt("permission") })].filter(Boolean).join(" · ") : t("Nothing yet today");
    m.innerHTML = `
      <header class="b2-head">
        <div class="b2-top"><h3>${t("Notifications")}</h3>${notifs.some((x) => !x.read) ? `<button type="button" class="b2-link" data-b2="readall">${t("Mark all read")}</button>` : ""}</div>
        <p class="b2-digest"><b>${t("Today")}</b> ${escHtml(digest)}</p>
        <div class="b2-day" aria-hidden="true"><div class="b2-ticks"></div><i class="b2-now"></i><span style="left:25%">06</span><span style="left:50%">12</span><span style="left:75%">18</span></div>
      </header>
      <section class="b2-wait" ${waiting.length ? "" : "hidden"}><h4>${t("Waiting for you ({n})", { n: waiting.length })}</h4><div class="b2-wlist"></div></section>
      <div class="b2-chips">
        ${[["all", t("All"), notifs.length], ["done", KIND.done[1], cnt("done", notifs)], ["error", KIND.error[1], cnt("error", notifs)], ["permission", KIND.permission[1], cnt("permission", notifs)]].map(([k, l, n]) => `<button type="button" class="b2-chip${bellFilter.kind === k ? " on" : ""}" data-kind="${k}">${escHtml(l)}<em>${n}</em></button>`).join("")}
        ${bellFilter.room ? `<button type="button" class="b2-chip on room" data-b2="noroom">${escHtml(bellFilter.room)} ×</button>` : ""}
      </div>
      <div class="b2-list" tabindex="-1"></div>
      <footer class="b2-foot"><label class="b2-switch"><input type="checkbox" ${on ? "checked" : ""} data-b2="desk"><i></i><span>${t("Desktop notifications")}</span></label>${notifs.length ? `<button type="button" class="b2-link" data-b2="clear">${t("Clear")}</button>` : ""}</footer>`;
    // the day at a glance: one tick per notification of today on a 24 h strip
    const ticks = m.querySelector(".b2-ticks");
    for (const x of today) { const d = new Date(x.at), i = document.createElement("i"); i.className = "k-" + x.kind; i.style.left = ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100 + "%"; i.title = `${hhmm(x.at)} · ${x.title}`; i.dataset.at = x.at; ticks.append(i); }
    { const d = new Date(); m.querySelector(".b2-now").style.left = ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100 + "%"; }
    // waiting for you: grant or open right here
    const wl = m.querySelector(".b2-wlist");
    for (const a of waiting.slice(0, 4)) {
      const att = a.attention, lead = leadOf(a), c = document.createElement("div"); c.className = "b2-wcard k-" + att.kind;
      c.innerHTML = `<span class="portrait"></span><div class="b2-wmain"><b></b><code></code></div><div class="b2-wact"></div>`;
      c.querySelector(".portrait").style.backgroundImage = portraitUrl(a.char ?? 0);
      c.querySelector("b").textContent = c.querySelector("b").title = `${lead.name}${teamOf(a).length > 1 ? " · " + roleLabel(a) : ""}`;
      c.querySelector("code").textContent = att.kind === "permission" ? (att.items?.[0] ? `${att.items[0].tool}: ${att.items[0].what}` : att.text) : att.text;
      const act = c.querySelector(".b2-wact");
      if (att.kind === "permission" && att.specs?.length) { const b = document.createElement("button"); b.type = "button"; b.className = "btn sm primary"; b.textContent = t("Allow"); b.title = t("Allow once and continue"); b.onclick = async () => { b.disabled = true; await sendPrompt({ text: t("Permission granted, continue where you left off."), allowOnce: att.specs }, a); c.remove(); }; act.append(b); }
      const o = document.createElement("button"); o.type = "button"; o.className = "btn sm ghost"; o.textContent = t("Open"); o.onclick = () => go(a.id); act.append(o);
      wl.append(c);
    }
    // the list, grouped by day
    const list = m.querySelector(".b2-list"); let last = "";
    if (!shown.length) list.innerHTML = `<p class="b2-empty">${notifs.length ? t("Nothing matches this filter.") : t("No notifications yet. They appear here when a team finishes its work, asks for permission or hits an error.")}</p>`;
    for (const row of notifRows(shown)) {
      const x = row.x, dk = dayKey(x.at);
      if (dk !== last) { last = dk; const h = document.createElement("div"); h.className = "b2-dayh"; h.textContent = dayLabel(x.at); list.append(h); }
      const a = agents.find((q) => q.id === x.agentId), room = roomOf(x), role = x.title.includes(" · ") ? x.title.split(" · ").slice(1).join(" · ") : "";
      const el = document.createElement("div"); el.className = `b2-row k-${x.kind}${row.all.some((q) => !q.read) ? " unread" : ""}`; el.dataset.at = x.at; el.tabIndex = 0; el.setAttribute("role", "button");
      el.innerHTML = `<span class="portrait"><i class="b2-k">${KIND[x.kind]?.[0] || "•"}</i></span>
        <div class="b2-main"><div class="b2-who"><button type="button" class="b2-room" title="${escHtml(t("Only this project"))}"></button><span class="b2-role"></span>${row.n > 1 ? `<em class="b2-n">×${row.n}</em>` : ""}</div><p></p><small></small></div>
        <div class="b2-side"><time></time><span class="b2-acts"><button type="button" data-act="read" title="${escHtml(t("Read / unread"))}">●</button><button type="button" data-act="del" title="${escHtml(t("Remove"))}">×</button></span></div>`;
      if (a) el.querySelector(".portrait").style.backgroundImage = portraitUrl(a.char ?? 0);
      el.querySelector(".b2-room").textContent = room; el.querySelector(".b2-role").textContent = role;
      el.querySelector("p").textContent = x.body || ""; el.querySelector("small").textContent = notifMeta(x);
      const tm = el.querySelector("time"); tm.textContent = notifTime(x.at); tm.title = new Date(x.at).toLocaleString(locale());
      el.onclick = (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (e.target.closest(".b2-room")) { bellFilter.room = bellFilter.room === room ? "" : room; render(); return; }
        if (act === "read") { const v = !row.all.every((q) => q.read); for (const q of row.all) q.read = v; saveNotifs(); renderBellBadge(); render(); return; }
        if (act === "del") { for (const q of row.all) { const k = notifs.indexOf(q); if (k >= 0) notifs.splice(k, 1); } saveNotifs(); renderBellBadge(); render(); return; }
        for (const q of row.all) q.read = true; saveNotifs(); go(x.agentId);
      };
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } else if (e.key === "ArrowDown") { e.preventDefault(); let n = el.nextElementSibling; while (n && !n.classList.contains("b2-row")) n = n.nextElementSibling; n?.focus(); } else if (e.key === "ArrowUp") { e.preventDefault(); let n = el.previousElementSibling; while (n && !n.classList.contains("b2-row")) n = n.previousElementSibling; n?.focus(); } };
      list.append(el);
    }
    place();
  };
  m.addEventListener("click", async (e) => {
    const chip = e.target.closest("[data-kind]"); if (chip) { bellFilter.kind = chip.dataset.kind; render(); return; }
    const tick = e.target.closest(".b2-ticks i"); if (tick) { const el = m.querySelector(`.b2-row[data-at="${tick.dataset.at}"]`); if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } return; }
    const k = e.target.closest("[data-b2]")?.dataset.b2;
    if (k === "readall") { for (const x of notifs) x.read = true; saveNotifs(); renderBellBadge(); render(); }
    if (k === "noroom") { bellFilter.room = ""; render(); }
    if (k === "clear") { notifs.length = 0; saveNotifs(); renderBellBadge(); render(); }
    if (k === "desk") { e.preventDefault(); closeBell(); await toggleDesktop(); }
  });
  render();
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
  notifs.unshift({ agentId: ev.agentId, kind: ev.kind, title: ev.title, body: (ev.body || "").slice(0, 200), at: Date.now(), read: !!seen, room: ev.room, role: ev.role, durationMs: ev.durationMs, turns: ev.turns, costUsd: ev.costUsd });
  notifs.length = Math.min(notifs.length, NOTIF_KEEP); saveNotifs(); renderBellBadge();
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
    if (ev.type === "server_stale") { staleBar("stale"); return; }
    if (ev.type === "agents_changed") { refresh(); gitSoon(); return; }
    if (ev.type === "usage") { usage = ev.usage || {}; renderUsage(); return; }
    if (ev.type === "library") { lib.load().catch(() => {}); return; }
    if (ev.type === "notify") { bcEvent(ev); handleNotify(ev); return; }
    if (ev.type === "git") { gitUI.onEvent(ev); gitSoon(); return; }
    if (ev.type === "fs") { edUI.onFs(ev); return; }
    if (ev.type === "run-out") { runUI.onEvent(ev); return; }
    if (ev.type === "run") { runUI.onEvent(ev); if (ev.status) { if (ev.status === "running") runCounts[ev.team] = (runCounts[ev.team] || 0); refreshRunCounts(); } return; }
    if (ev.type === "tasks") { tasksUI.onEvent(ev); overviewSoon(); if (current() && teamKey(current()) === ev.team) renderTasksBadge(); return; }
    if (ev.type === "reqs") { reqsUI.onEvent(ev); overviewSoon(); if (current() && teamKey(current()) === ev.team) renderReqsBadge(); return; }
    if (ev.type === "library-tool") { lib.onTool(ev); return; }
    if (ev.type === "team") officeEvent(ev);
    liveEvent(ev);
    if (ev.type === "text" && ev.agentId && ev.text) { station.say(ev.agentId, firstSentence(ev.text)); }
    if (ev.type === "result" && ev.agentId) sfx.play(ev.isError ? "error" : "done");
    if (ev.type === "text_delta" && ev.agentId && current() && teamKey(current()) === teamKey(agents.find((x) => x.id === ev.agentId) || {})) sfx.play("key");
    if (ev.type === "tool_use" || ev.type === "tool_result") { testWatch(ev); screenWatch(ev); }
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
      const live = !replay || replay.tk !== teamKey(agents.find((x) => x.id === ev.agentId) || {});
      if (live) station.setStatus(ev.agentId, ev.status);
      if (live) station.setActivity(ev.agentId, ev.status === "thinking" ? t("thinking…") : ev.status === "tool" ? (lastTool.get(ev.agentId) || ev.tool || t("working")) : "");
      const a = agents.find((x) => x.id === ev.agentId);
      if (a) { a.status = ev.status; renderList(); if (current() && teamKey(a) === teamKey(current())) renderTeamTabs(); station.setAttention(a.id, a.attention?.kind === "permission" && !isBusy(a)); renderInbox(); catSoon(); }
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
      // a long live session keeps adding to the page; when a run ends and you are at the bottom anyway, redraw just the tail
      if (ev.type === "result" && chatEl().childElementCount > CHAT_LIVE_MAX && nearBottom()) loadChat();
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
      if (a.id === selectedId) renderQueue();
      // the server frees the slot a moment after the "done" event (it is still saving the changes): try again shortly, no event will come by itself
      setTimeout(() => flushQueue(a.id), 1500);
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
    el.querySelector(".h-title").textContent = el.querySelector(".h-title").title = convs[k].title || t("Untitled conversation");
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
$("#btn-remove").onclick = () => { closePops(); const a = current(); if (!a) return; if (a.solo) deleteChat(a.id); else removeProject(leadOf(a)); };
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

// ================= focus mode =================
// chat in full width with the project list on the left; the 3D scene is switched off (no GPU/CPU spent on it)
{
  const btns = [...document.querySelectorAll(".fx-btn")], rail = $("#rail");
  const set = (on) => {
    document.body.classList.toggle("focus", on); for (const b of btns) b.setAttribute("aria-pressed", String(on)); rail.hidden = !on;
    const ul = $("#agent-list");
    if (on) rail.insertBefore(ul, rail.querySelector(".rail-width")); else $("#panel-empty").querySelector(".cli-warn").after(ul); // the same list, so selection, drag and badges keep working
    station.hold(on);
    renderList();
  };
  window.__setFocus = set;
  // chat width in focus mode: slider from a readable column up to the full window (the far end = full width, the default)
  const sl = $("#fx-width"), out = $("#fx-width-out"), FULL = +sl.max;
  const applyW = (v) => { v = Math.max(+sl.min, Math.min(FULL, +v || FULL)); sl.value = v; sl.style.setProperty("--p", ((v - +sl.min) / (FULL - +sl.min)) * 100 + "%"); document.documentElement.style.setProperty("--fx-w", v >= FULL ? "100%" : v + "px"); out.textContent = v >= FULL ? t("Full") : v + " px"; return v; };
  let w0 = FULL; try { w0 = +localStorage.getItem("fxWidth") || FULL; } catch {}
  applyW(w0);
  sl.oninput = () => { const v = applyW(sl.value); try { localStorage.setItem("fxWidth", String(v)); } catch {} };
  sl.ondblclick = () => { applyW(FULL); try { localStorage.setItem("fxWidth", String(FULL)); } catch {} };
  // the project list can be dragged wider / narrower (double-click resets); very narrow = portraits only
  {
    const rz = $("#rail-resizer"), MINW = 64, MAXW = 460, DEF = 340;
    const setW = (w, save) => { w = Math.round(Math.max(MINW, Math.min(MAXW, w))); document.documentElement.style.setProperty("--rail-w", w + "px"); document.body.classList.toggle("rail-mini", w < 190); if (save) try { localStorage.setItem("railW", String(w)); } catch {} return w; };
    let w0 = DEF; try { w0 = +localStorage.getItem("railW") || DEF; } catch {}
    setW(w0);
    rz.addEventListener("pointerdown", (e) => {
      e.preventDefault(); rz.setPointerCapture(e.pointerId); document.body.classList.add("resizing");
      const left = rail.getBoundingClientRect().left;
      const x0 = e.clientX; let moved = false;
      const move = (ev) => { if (!moved && Math.abs(ev.clientX - x0) < 3) return; moved = true; setW(ev.clientX - left, false); };
      const up = (ev) => { rz.removeEventListener("pointermove", move); document.body.classList.remove("resizing"); if (moved) setW(ev.clientX - left, true); };
      rz.addEventListener("pointermove", move); rz.addEventListener("pointerup", up, { once: true });
    });
    rz.addEventListener("dblclick", () => setW(DEF, true));
    rz.addEventListener("keydown", (e) => { const cur = rail.getBoundingClientRect().width; if (e.key === "ArrowLeft") setW(cur - 24, true); else if (e.key === "ArrowRight") setW(cur + 24, true); });
  }
  const toggle = () => set(!document.body.classList.contains("focus"));
  for (const b of btns) b.onclick = toggle;
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "\\") { e.preventDefault(); toggle(); } });
}

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
      if (!lib.isOpen && !reqsUI.isOpen && !tasksUI.isOpen && !gitUI.isOpen && !edUI.isOpen) station.pause(false);
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
if (!meta.build) staleBar("old"); else if (meta.stale) staleBar("stale");
usage = await api("/api/usage").catch(() => ({})); renderUsage();
$("#mode-badge").textContent = meta.mock ? t("Demo mode") : "";
document.body.style.setProperty("--l-new", JSON.stringify(t("new")));
if (meta.claudeMissing) { const w = $("#cli-warn"); w.textContent = meta.claudeMissing; w.hidden = false; }
await refresh();
lib.load().catch(() => {});
refreshGitSummary(); refreshOverview(); refreshPayroll();
setTimeout(offerTour, 1500); refreshCcSessions(); setInterval(refreshCcSessions, 180000);
applyView();
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
    const closeOthers = () => { if (lib.isOpen) lib.close(); if (reqsUI.isOpen) reqsUI.close(); if (tasksUI.isOpen) tasksUI.close(); if (gitUI.isOpen) gitUI.close(); };
    if (e.key.toLowerCase() === "e" && current() && !edUI.isOpen && !document.querySelector("dialog[open]")) { e.preventDefault(); closeOthers(); if (runUI.isOpen) runUI.close(); openCode(); return; }
    if (e.key.toLowerCase() === "j" && current() && !runUI.isOpen && !document.querySelector("dialog[open]")) { e.preventDefault(); closeOthers(); if (edUI.isOpen) edUI.close(); openRun(); return; }
    if (/^[1-9]$/.test(e.key) && !document.querySelector("dialog[open]:not(#dlg-switch)")) {
      const p = projects()[+e.key - 1]; if (!p) return;
      e.preventDefault(); if (dlg.open) dlg.close();
      if (lib.isOpen) lib.close(); if (reqsUI.isOpen) reqsUI.close(); if (tasksUI.isOpen) tasksUI.close(); if (gitUI.isOpen) gitUI.close(); if (edUI.isOpen) edUI.close(); if (runUI.isOpen) runUI.close();
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


// small level badge shown for a moment while zooming (the page has no browser zoom badge any more)
{ let hudT = 0; window.__hud = (txt) => { const h = $("#zoom-hud"); h.textContent = txt; h.hidden = false; clearTimeout(hudT); hudT = setTimeout(() => { h.hidden = true; }, 1300); }; }
// Ctrl + wheel / Ctrl +/-/0: the browser would zoom the whole page (%150 badge, layout breaks). Instead the chat text zooms; the code editor keeps its own font zoom.
{
  let z = 1; try { z = Number(localStorage.getItem("chatZoom")) || 1; } catch {}
  const apply = (v) => { z = Math.min(2, Math.max(0.7, Math.round(v * 20) / 20)); chatEl().style.zoom = z === 1 ? "" : String(z); try { localStorage.setItem("chatZoom", String(z)); } catch {} updateJump(); window.__hud?.(t("Chat text {n}%", { n: Math.round(z * 100) })); };
  apply(z); $("#zoom-hud").hidden = true;
  const inEditor = (el) => !!el?.closest?.("#ed-monaco, #editor, #ed-diff-host");
  addEventListener("wheel", (e) => { if (!e.ctrlKey) return; e.preventDefault(); if (inEditor(e.target)) return; apply(z + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false, capture: true });
  addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key; if (!["+", "=", "-", "_", "0"].includes(k)) return;
    e.preventDefault(); if (inEditor(document.activeElement)) return;
    apply(k === "0" ? 1 : z + (k === "-" || k === "_" ? -0.05 : 0.05));
  }, true);
}

// Performance meter (Ctrl+Shift+P): frame rate, worst frame, 3D draw calls, long main-thread tasks, memory
{
  let on = false, raf = 0, frames = 0, worst = 0, last = 0, t0 = 0, longs = 0, longMax = 0;
  const el = document.createElement("div"); el.id = "perf-hud"; el.hidden = true; document.body.append(el);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { longs++; longMax = Math.max(longMax, e.duration); } }).observe({ entryTypes: ["longtask"] }); } catch {}
  const tick = (x) => {
    if (!on) return;
    frames++; if (last) worst = Math.max(worst, x - last); last = x;
    if (x - t0 >= 1000) {
      const st = station.stats?.() || {}, mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + " MB" : "–";
      el.textContent = `${Math.round(frames * 1000 / (x - t0))} fps · ${t("worst frame")} ${Math.round(worst)} ms\n3D: ${st.paused ? t("off") : (st.calls ?? "–") + " " + t("draws")} · ${st.rooms ?? 0} ${t("rooms")} · DPR ${st.dpr ?? "–"}\n${t("long tasks")}: ${longs} (max ${Math.round(longMax)} ms) · ${t("memory")} ${mem}\nDOM: ${document.getElementsByTagName("*").length}\n${t("last selection")}: ${t("log")} ${window.__sel.net} ms · ${t("draw")} ${window.__load?.render ?? "–"} ms · ${t("long tasks")} ${window.__sel.longs.join(", ") || "–"}`;
      frames = 0; worst = 0; t0 = x; longs = 0; longMax = 0;
    }
    raf = requestAnimationFrame(tick);
  };
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== "p") return;
    e.preventDefault(); on = !on; el.hidden = !on; cancelAnimationFrame(raf);
    if (on) { frames = worst = last = 0; t0 = performance.now(); raf = requestAnimationFrame(tick); }
  });
}
