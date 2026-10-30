// Document library: ERP analysis documents etc. — upload, preview, edit, version, hand to agents as references.
import { t, locale } from "./i18n.js";
const $ = (s, r = document) => r.querySelector(s);
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const KIND = {
  pdf: { label: "PDF", cls: "k-pdf" },
  docx: { label: "Word", cls: "k-doc" },
  xlsx: { label: "Excel", cls: "k-xls" },
  markdown: { label: "Markdown", cls: "k-md" },
  table: { label: "CSV", cls: "k-csv" },
  text: { label: t("Text"), cls: "k-txt" },
  image: { label: t("Image"), cls: "k-img" },
  pptx: { label: "PowerPoint", cls: "k-ppt" },
  other: { label: t("Other"), cls: "k-oth" },
};
export const badge = (d, cls = "") => `<span class="kbadge ${KIND[d.kind]?.cls || "k-oth"} ${cls}">${escHtml((d.ext || "?").slice(0, 4).toUpperCase())}</span>`;
export const fmtSize = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const ago = (ts) => {
  if (!ts) return "";
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t("just now"); if (s < 3600) return t("{n} min ago", { n: Math.floor(s / 60) }); if (s < 86400) return t("{n} h ago", { n: Math.floor(s / 3600) });
  if (s < 7 * 86400) return t("{n} {n|day|days} ago", { n: Math.floor(s / 86400) });
  return new Date(ts).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
};
const fullDate = (ts) => (ts ? new Date(ts).toLocaleString(locale(), { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const stripExt = (n) => n.replace(/\.[^.]+$/, "");
const tr = (s) => String(s).toLocaleLowerCase(locale());
const I = {
  back: '<svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg>',
  search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" style="fill:none;stroke:currentColor;stroke-width:2"/><path d="m10.5 10.5 3 3"/></svg>',
  up: '<svg viewBox="0 0 16 16"><path d="M8 11V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"/></svg>',
  plus: '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>',
  dots: '<svg viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
  chat: '<svg viewBox="0 0 16 16"><path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11h0A1.5 1.5 0 0 1 2.5 9.5Z"/></svg>',
  edit: '<svg viewBox="0 0 16 16"><path d="M10.5 2.5l3 3L6 13H3v-3z"/></svg>',
  ext: '<svg viewBox="0 0 16 16"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg>',
  info: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" style="fill:none;stroke:currentColor;stroke-width:1.8"/><path d="M8 7.5v3.5"/><circle cx="8" cy="5" r="1"/></svg>',
  x: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  folder: '<svg viewBox="0 0 16 16"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5Z"/></svg>',
  stack: '<svg viewBox="0 0 16 16"><path d="M8 2 2 5l6 3 6-3zM2 8l6 3 6-3M2 11l6 3 6-3"/></svg>',
  inbox: '<svg viewBox="0 0 16 16"><path d="M2.5 9.5 4 3h8l1.5 6.5v3h-11zM2.5 9.5H6l.8 1.5h2.4l.8-1.5h3.5"/></svg>',
  doc: '<svg viewBox="0 0 16 16"><path d="M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13M6.5 8.5h4M6.5 11h4"/></svg>',
};

// HTML converted from Word: only text/formatting tags remain; scripts, event attributes and javascript: links are dropped
function sanitizeDocHtml(html) {
  if (!html) return "";
  const ALLOW = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "A", "IMG", "BLOCKQUOTE", "PRE", "CODE", "SUP", "SUB", "SPAN", "DIV"]);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (el) => {
    for (const n of [...el.childNodes]) {
      if (n.nodeType !== 1) { if (n.nodeType !== 3) n.remove(); continue; }
      if (!ALLOW.has(n.tagName)) { walk(n); n.replaceWith(...n.childNodes); continue; } // sanitize the children first: once moved up they would not be visited again
      for (const a of [...n.attributes]) {
        const ok = (a.name === "href" && n.tagName === "A" && /^(https?:|mailto:|#)/i.test(a.value.trim())) || (a.name === "src" && n.tagName === "IMG" && /^data:image\//i.test(a.value.trim())) || a.name === "colspan" || a.name === "rowspan";
        if (!ok) n.removeAttribute(a.name);
      }
      walk(n);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
export function createLibrary(ctx) {
  // ctx: { api, toast, confirmBox, md, agents(), portrait(agent), onOpen(), onClose(), useInChat(agentId, doc) }
  const root = $("#library");
  let docs = [], colls = [];
  let filter = { type: "all" }, kindFilter = "all", query = "", hits = new Map(), sort = "updated";
  let selId = null, editing = null, loaded = false;
  let infoOpen = true; try { infoOpen = localStorage.getItem("lib.info") !== "0"; } catch {}
  const byId = (id) => docs.find((d) => d.id === id);
  const collName = (id) => colls.find((c) => c.id === id)?.name || "";

  // ---------- data
  async function load() {
    const j = await ctx.api("/api/library");
    docs = j.docs; colls = j.collections; loaded = true;
    if (filter.type === "coll" && !colls.some((c) => c.id === filter.id)) filter = { type: "all" };
    if (selId && !byId(selId)) selId = null;
    if (!root.hidden) { renderSide(); renderList(); if (!editing) renderView(); }
    ctx.onChange?.();
  }

  // ---------- open / close
  function open({ docId, agentId } = {}) {
    if (agentId) filter = { type: "agent", id: agentId };
    if (docId) { selId = docId; if (filter.type !== "all" && filter.type !== "agent") filter = { type: "all" }; }
    root.hidden = false; ctx.onOpen?.();
    load().then(() => { if (docId) $(`.li-doc[data-id="${docId}"]`, root)?.scrollIntoView({ block: "nearest" }); });
    setTimeout(() => (docId ? $("#lib-items .li-doc.on", root) : $("#lib-q"))?.focus({ preventScroll: true }), 30);
  }
  async function close() {
    if (editing?.dirty && !(await ctx.confirmBox({ title: t("Unsaved changes"), body: t("If you leave without saving the document you are editing, the changes will be lost."), ok: t("Leave without saving"), danger: true }))) return;
    editing = null; closeMenu(); root.hidden = true; ctx.onClose?.();
  }

  // ---------- left menu
  function renderSide() {
    const count = (f) => docs.filter(f).length;
    const item = (key, icon, label, n, extra = "") => `<button type="button" class="ls-item${key ? "" : ""}" ${extra}>${icon}<span class="ls-label">${escHtml(label)}</span><span class="ls-n">${n}</span></button>`;
    const on = (type, id) => (filter.type === type && (id === undefined || filter.id === id) ? ' aria-current="true"' : "");
    let h = `<div class="ls-group">
      ${item(1, I.stack, t("All documents"), docs.length, `data-f="all"${on("all")}`)}
      ${item(1, I.inbox, t("No collection"), count((d) => !d.collection), `data-f="none"${on("none")}`)}
    </div>
    <div class="ls-head"><span>${t("Collections")}</span><button type="button" class="ls-add" id="lib-newcoll" title="${t("New collection")}" aria-label="${t("New collection")}">${I.plus}</button></div>
    <div class="ls-group" id="lib-colls">`;
    h += colls.length ? colls.map((c) => item(1, I.folder, c.name, count((d) => d.collection === c.id), `data-f="coll" data-id="${c.id}"${on("coll", c.id)} title="${t("Double-click: rename")}"`)).join("")
      : `<p class="ls-empty">${t("Group by module or customer: <i>Stock</i>, <i>Accounting</i>, <i>Meetings</i>…")}</p>`;
    h += `</div><div class="ls-head"><span>${t("Linked to projects")}</span></div><div class="ls-group">`;
    const ags = ctx.agents();
    h += ags.map((a) => `<button type="button" class="ls-item ls-agent" data-f="agent" data-id="${a.id}"${on("agent", a.id)}><i class="ls-port" style="background-image:${ctx.portrait(a)}"></i><span class="ls-label">${escHtml(ctx.label(a))}</span><span class="ls-n">${count((d) => d.agents.includes(a.id)) || ""}</span></button>`).join("");
    h += `</div><div class="ls-tool" id="lib-tool"></div>`;
    $(".lib-side", root).innerHTML = h;
    renderTool();
    const total = docs.reduce((s, d) => s + (d.size || 0), 0);
    $("#lib-sum").textContent = docs.length ? t("{n} {n|document|documents} · {size}", { n: docs.length, size: fmtSize(total) }) : t("No documents yet");
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest(".lib-side [data-f]"); if (!b) return;
    filter = { type: b.dataset.f, id: b.dataset.id }; renderSide(); renderList();
  });
  root.addEventListener("dblclick", (e) => {
    const b = e.target.closest('.lib-side [data-f="coll"]'); if (b) renameColl(b);
  });
  root.addEventListener("contextmenu", (e) => {
    const b = e.target.closest('.lib-side [data-f="coll"]'); if (!b) return;
    e.preventDefault();
    menu(b, [[t("Rename"), () => renameColl(b)], [t("Delete collection"), async () => {
      const c = colls.find((x) => x.id === b.dataset.id);
      if (!(await ctx.confirmBox({ title: t("Delete '{name}'?", { name: c.name }), body: t("The collection is removed; its documents are not deleted, they move to No collection."), ok: t("Delete collection"), danger: true }))) return;
      await ctx.api(`/api/library/collections/${c.id}`, { method: "DELETE" }); if (filter.id === c.id) filter = { type: "all" }; load();
    }, "danger"]]);
  });
  function inlineInput(el, value, onDone) {
    const inp = document.createElement("input"); inp.className = "ls-input"; inp.value = value; inp.maxLength = 40;
    el.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const fin = async (save) => { if (done) return; done = true; const v = inp.value.trim(); if (save && v && v !== value) { try { await onDone(v); } catch (err) { ctx.toast(err.message, "bad"); } } load(); renderSide(); };
    inp.onkeydown = (e) => { if (e.key === "Enter") fin(true); if (e.key === "Escape") { e.stopPropagation(); fin(false); } };
    inp.onblur = () => fin(true);
  }
  function renameColl(b) {
    const c = colls.find((x) => x.id === b.dataset.id); if (!c) return;
    inlineInput(b, c.name, (v) => ctx.api(`/api/library/collections/${c.id}`, { method: "PATCH", body: { name: v } }));
  }
  root.addEventListener("click", (e) => {
    if (!e.target.closest("#lib-newcoll")) return;
    const ph = document.createElement("button"); $("#lib-colls").prepend(ph); $(".ls-empty", root)?.remove();
    inlineInput(ph, "", async (v) => { const c = await ctx.api("/api/library/collections", { method: "POST", body: { name: v } }); filter = { type: "coll", id: c.id }; });
  });

  // ---------- list
  function visible() {
    let list = docs.filter((d) =>
      filter.type === "all" ? true : filter.type === "none" ? !d.collection : filter.type === "coll" ? d.collection === filter.id : filter.type === "agent" ? d.agents.includes(filter.id) : true);
    if (kindFilter !== "all") list = list.filter((d) => (kindFilter === "text" ? ["text", "markdown", "table"].includes(d.kind) : d.kind === kindFilter));
    if (query) {
      const q = tr(query);
      list = list.filter((d) => tr(d.name).includes(q) || d.tags.some((tag) => tr(tag).includes(q)) || tr(d.note).includes(q) || tr(collName(d.collection)).includes(q) || hits.has(d.id));
    }
    const cmp = { updated: (a, b) => b.updatedAt - a.updatedAt, created: (a, b) => b.createdAt - a.createdAt, name: (a, b) => a.name.localeCompare(b.name, locale()), size: (a, b) => b.size - a.size, kind: (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, locale()) }[sort];
    return list.sort(cmp);
  }
  const hl = (text) => {
    const s = escHtml(text); if (!query) return s;
    const q = escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return s.replace(new RegExp(q, "gi"), (m) => `<mark>${m}</mark>`);
  };
  function renderList() {
    const list = visible();
    const kinds = ["all", ...new Set(docs.map((d) => (["markdown", "table"].includes(d.kind) ? "text" : d.kind)))];
    if (!kinds.includes(kindFilter)) kindFilter = "all";
    $("#lib-kinds").innerHTML = kinds.length > 2 ? kinds.map((k) => `<button type="button" data-k="${k}" aria-pressed="${k === kindFilter}">${k === "all" ? t("All") : k === "text" ? t("Text") : KIND[k].label}</button>`).join("") : "";
    const title = filter.type === "all" ? t("All documents") : filter.type === "none" ? t("No collection") : filter.type === "coll" ? collName(filter.id) : filter.type === "agent" ? t("{name} · linked documents", { name: ctx.agents().find((a) => a.id === filter.id)?.name || t("Project") }) : "";
    $("#lib-ltitle").textContent = title;
    $("#lib-count").textContent = query ? t("{n} {n|result|results}", { n: list.length }) : t("{n} {n|document|documents}", { n: list.length });
    const box = $("#lib-items");
    if (!list.length) {
      const empty = !docs.length;
      box.innerHTML = `<div class="lib-empty">${empty ? `<div class="le-art">${I.doc}</div><b>${t("Library is empty")}</b><p>${t("Drag ERP analysis documents, Excel data dictionaries and meeting notes here, or {choose}.", { choose: `<button type="button" class="linkish" data-act="upload">${t("choose a file")}</button>` })}</p><small>${t("PDF · Word · Excel · Markdown · CSV · image")}</small>`
        : query ? `<b>${t("'{q}' not found", { q: escHtml(query) })}</b><p>${t("Searched in names, tags, notes and Word/Excel/text contents.")}</p>`
        : filter.type === "agent" ? `<b>${t("No documents linked to this project")}</b><p>${t("Open a document and link it from the <i>Link to projects</i> section on the right; the agent will know it in every conversation.")}</p>`
        : `<b>${t("No documents here")}</b><p>${t("You can drag documents here.")}</p>`}</div>`;
      return;
    }
    box.innerHTML = list.map((d) => {
      const h = hits.get(d.id);
      const ag = ctx.agents().filter((a) => d.agents.includes(a.id));
      return `<button type="button" class="li-doc${d.id === selId ? " on" : ""}" data-id="${d.id}" role="option" aria-selected="${d.id === selId}">
        ${badge(d)}
        <span class="ld-main">
          <span class="ld-name">${hl(stripExt(d.name))}</span>
          <span class="ld-meta">${d.collection ? `<span class="ld-coll">${escHtml(collName(d.collection))}</span>` : ""}<span>${fmtSize(d.size)}</span><span>${ago(d.updatedAt)}</span>${d.missing ? `<span class="ld-warn">${t("file missing")}</span>` : ""}</span>
          ${d.tags.length ? `<span class="ld-tags">${d.tags.slice(0, 4).map((tag) => `<i>${hl(tag)}</i>`).join("")}</span>` : ""}
          ${h ? `<span class="ld-snip">${hl(h.snippet)}${h.count > 1 ? ` <em>${t("{n} {n|match|matches}", { n: h.count })}</em>` : ""}</span>` : ""}
        </span>
        ${ag.length ? `<span class="ld-agents" title="${t("Linked with {names}", { names: escHtml(ag.map((a) => ctx.label(a)).join(", ")) })}">${ag.slice(0, 3).map((a) => `<i style="background-image:${ctx.portrait(a)}"></i>`).join("")}${ag.length > 3 ? `<em>+${ag.length - 3}</em>` : ""}</span>` : ""}
      </button>`;
    }).join("");
  }
  $("#lib-kinds").addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (b) { kindFilter = b.dataset.k; renderList(); } });
  $("#lib-sort").onchange = (e) => { sort = e.target.value; renderList(); };
  $("#lib-items").addEventListener("click", (e) => {
    if (e.target.closest('[data-act="upload"]')) return $("#lib-file").click();
    const b = e.target.closest(".li-doc"); if (b) select(b.dataset.id);
  });
  $("#lib-items").addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Delete"].includes(e.key)) return;
    const list = visible(); const i = list.findIndex((d) => d.id === selId);
    if (e.key === "Delete") { if (selId) { e.preventDefault(); removeDoc(byId(selId)); } return; }
    e.preventDefault();
    const n = list[Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (n) { select(n.id); $(`.li-doc[data-id="${n.id}"]`, root)?.focus(); }
  });

  // search: name/tags instantly, content from the server after 250 ms
  let searchT, searchSeq = 0;
  $("#lib-q").addEventListener("input", (e) => {
    query = e.target.value.trim(); renderList();
    clearTimeout(searchT);
    if (query.length < 2) { hits = new Map(); return; }
    const seq = ++searchSeq;
    searchT = setTimeout(async () => {
      const r = await ctx.api(`/api/library/search?q=${encodeURIComponent(query)}`).catch(() => []);
      if (seq !== searchSeq) return;
      hits = new Map(r.map((h) => [h.id, h])); renderList();
    }, 250);
  });
  $("#lib-q").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); const f = visible()[0]; if (f) { select(f.id); $(`.li-doc[data-id="${f.id}"]`, root)?.focus(); } }
    if (e.key === "Escape" && e.target.value) { e.stopPropagation(); e.target.value = ""; e.target.dispatchEvent(new Event("input")); }
  });

  // ---------- selected document
  async function select(id) {
    if (id === selId) return;
    if (editing?.dirty && !(await ctx.confirmBox({ title: t("Unsaved changes"), body: t("If you switch to another document, the changes will be lost."), ok: t("Switch without saving"), danger: true }))) return;
    editing = null; selId = id;
    root.querySelectorAll(".li-doc").forEach((b) => { const on = b.dataset.id === id; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    renderView();
  }
  let viewSeq = 0;
  function renderView() {
    const v = $("#lib-view"); const d = byId(selId);
    v.classList.toggle("info-open", infoOpen);
    if (!d) {
      v.innerHTML = `<div class="lv-none">${docs.length ? `<div class="le-art">${I.doc}</div><b>${t("Select a document")}</b><p>${t("Preview, edit and use in chat here.")}</p>` : ""}</div>`;
      return;
    }
    const k = d.kind;
    v.innerHTML = `
      <header class="lv-head">
        ${badge(d, "big")}
        <div class="lv-id">
          <h3 class="lv-name" tabindex="0" title="${t("Click to rename the document")}">${escHtml(stripExt(d.name))}</h3>
          <p class="lv-sub">${KIND[k].label} · ${fmtSize(d.size)} · ${d.updatedAt === d.createdAt ? t("added {when}", { when: ago(d.updatedAt) }) : t("updated {when}", { when: ago(d.updatedAt) })}${d.versions ? ` · ${t("{n} older versions", { n: d.versions })}` : ""}</p>
        </div>
        <div class="lv-actions">
          <button type="button" class="btn primary sm" data-act="chat">${I.chat}${t("Use in chat")}</button>
          ${d.editable ? `<button type="button" class="btn ghost sm" data-act="edit">${I.edit}${t("Edit")}</button>` : ""}
          <button type="button" class="btn ghost sm" data-act="app" title="${t("Open in the default application on this computer (Word, Excel…)")}">${I.ext}<span>${t("Open in app")}</span></button>
          <button type="button" class="hbtn icon-only" data-act="more" title="${t("Other")}" aria-label="${t("More actions")}">${I.dots}</button>
          <button type="button" class="hbtn icon-only${infoOpen ? " on" : ""}" data-act="info" title="${t("Info")}" aria-label="${t("Info")}" aria-pressed="${infoOpen}">${I.info}</button>
        </div>
      </header>
      <div class="lv-body"><div class="lv-preview" id="lv-preview"><div class="lv-loading"><span class="pulse"><i></i><i></i><i></i></span></div></div><aside class="lv-info" id="lv-info"></aside></div>`;
    renderInfo(d);
    renderPreview(d);
    const h = $(".lv-name", v);
    h.onclick = () => renameDoc(d, h);
    h.onkeydown = (e) => { if (e.key === "Enter" && !h.isContentEditable) { e.preventDefault(); renameDoc(d, h); } };
  }
  $("#lib-view").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b || !b.closest(".lv-head, .lv-none, .lv-other, .ed-bar")) return;
    const d = byId(selId);
    switch (b.dataset.act) {
      case "chat": return chatMenu(b, d);
      case "edit": return startEdit(d);
      case "app": return openApp(d, "app");
      case "info": infoOpen = !infoOpen; try { localStorage.setItem("lib.info", infoOpen ? "1" : "0"); } catch {} $("#lib-view").classList.toggle("info-open", infoOpen); b.classList.toggle("on", infoOpen); b.setAttribute("aria-pressed", infoOpen); return;
      case "more": return menu(b, [
        [t("Reveal in folder"), () => openApp(d, "folder")],
        [t("Download"), () => { location.href = `/api/library/${d.id}/raw?download=1`; }],
        [t("Upload new version…"), () => pickReplace(d)],
        [t("Copy file path"), () => navigator.clipboard.writeText(d.path).then(() => ctx.toast(t("Path copied")))],
        [t("Delete document"), () => removeDoc(d), "danger"],
      ]);
      case "save": return saveEdit();
      case "cancel": return cancelEdit();
    }
  });
  async function openApp(d, mode) {
    try { await ctx.api(`/api/library/${d.id}/open`, { method: "POST", body: { mode } }); ctx.toast(mode === "folder" ? t("Folder opened") : t("Opened in app · when you save, this updates by itself")); }
    catch (err) { ctx.toast(err.message, "bad"); }
  }
  function renameDoc(d, h) {
    if (h.isContentEditable) return;
    h.contentEditable = "true"; h.focus(); document.getSelection().selectAllChildren(h);
    const fin = async (save) => {
      if (!h.isContentEditable) return; h.contentEditable = "false";
      const v = h.textContent.trim().replace(/\s+/g, " ");
      if (!save || !v || v === stripExt(d.name)) { h.textContent = stripExt(d.name); return; }
      try { await ctx.api(`/api/library/${d.id}`, { method: "PATCH", body: { name: v } }); ctx.toast(t("Document renamed")); load(); }
      catch (err) { ctx.toast(err.message, "bad"); h.textContent = stripExt(d.name); }
    };
    h.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); fin(true); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fin(false); } };
    h.onblur = () => fin(true);
  }
  async function removeDoc(d) {
    if (!d) return;
    const linked = d.agents.length ? " " + t("Linked to {n} {n|project|projects}; the link is removed too.", { n: d.agents.length }) : "";
    if (!(await ctx.confirmBox({ title: t("Delete '{name}'?", { name: stripExt(d.name) }), body: `${t("The document is removed from the library.")}${linked} ${t("It can be restored within 7 days.")}`, ok: t("Delete"), danger: true }))) return;
    try {
      await ctx.api(`/api/library/${d.id}`, { method: "DELETE" });
      const list = visible(); const i = list.findIndex((x) => x.id === d.id);
      selId = (list[i + 1] || list[i - 1])?.id || null; editing = null;
      ctx.toast(t("Document deleted"), "", { label: t("Undo"), fn: async () => { await ctx.api(`/api/library/${d.id}/undelete`, { method: "POST" }); selId = d.id; load(); } });
      load();
    } catch (err) { ctx.toast(err.message, "bad"); }
  }

  // ---------- preview
  async function renderPreview(d) {
    const seq = ++viewSeq; const box = $("#lv-preview");
    const raw = `/api/library/${d.id}/raw?t=${d.mtime || 0}`;
    if (d.missing) { box.innerHTML = other(d, t("The file was not found on disk. It may have been moved or deleted; you can fix it by uploading a new version.")); return; }
    if (d.kind === "pdf") { box.innerHTML = `<iframe class="pv-pdf" title="${escHtml(d.name)}" src="${raw}#view=FitH&toolbar=1"></iframe>`; return; }
    if (d.kind === "image") { box.innerHTML = `<div class="pv-img"><img alt="${escHtml(d.name)}" src="${raw}"></div>`; return; }
    const p = await ctx.api(`/api/library/${d.id}/preview`).catch((e) => ({ error: e.message }));
    if (seq !== viewSeq || !$("#lv-preview")) return;
    if (p.error) { box.innerHTML = other(d, p.error); return; }
    if (p.markdown != null) { box.innerHTML = `<div class="paper rich">${ctx.md(p.markdown) || `<p><i>${t("No text found.")}</i></p>`}</div>`; return; }
    if (d.kind === "other" || d.kind === "pptx") {
      box.innerHTML = other(d, p.needsTool ? t("MarkItDown is needed to show the text of .{ext} {ext|file|files} (you can install it from the 'Document reading' section at the bottom left). For now you can open it in the app.", { ext: d.ext }) : t(".{ext} {ext|file|files} cannot be previewed here. You can open it in the app or still use it in chat — the agent will try to read the file.", { ext: d.ext }));
      return;
    }
    if (p.tooBig) { box.innerHTML = other(d, t("The file is too big to preview (over 5 MB). You can open it in the app.")); return; }
    if (d.kind === "markdown") box.innerHTML = `<div class="paper rich">${ctx.md(p.text)}</div>`;
    else if (d.kind === "docx") box.innerHTML = `<div class="paper rich docx">${sanitizeDocHtml(p.html) || `<p><i>${t("The document looks empty.")}</i></p>`}</div>`;
    else if (d.kind === "xlsx") sheetView(box, p.sheets || []);
    else if (d.kind === "table") sheetView(box, [{ name: d.name, rows: parseCsv(p.text, d.ext) }], true);
    else codeView(box, p.text);
    box.querySelectorAll(".paper a[href]").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  }
  const other = (d, msg) => `<div class="lv-other">${badge(d, "huge")}<p>${escHtml(msg)}</p><div><button type="button" class="btn ghost sm" data-act="app">${I.ext}${t("Open in app")}</button><button type="button" class="btn ghost sm" data-act="more">${I.dots}${t("Other")}</button></div></div>`;
  function codeView(box, text) {
    const lines = text.split("\n"); const cut = lines.length > 4000;
    const shown = cut ? lines.slice(0, 4000) : lines;
    box.innerHTML = `<div class="pv-code"><pre><code>${shown.map((l) => `<span>${escHtml(l) || " "}</span>`).join("\n")}</code></pre>${cut ? `<p class="pv-cut">${t("Showing the first 4000 lines (of {n}).", { n: lines.length })}</p>` : ""}</div>`;
  }
  const colName = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function sheetView(box, sheets, single = false) {
    let cur = 0;
    const draw = () => {
      const sh = sheets[cur] || { rows: [] };
      const w = Math.max(1, ...sh.rows.map((r) => r.length));
      const head = `<tr><th class="rn"></th>${Array.from({ length: w }, (_, i) => `<th>${colName(i)}</th>`).join("")}</tr>`;
      const body = sh.rows.map((r, i) => `<tr${i === 0 ? ' class="r1"' : ""}><th class="rn">${i + 1}</th>${Array.from({ length: w }, (_, j) => { const v = r[j] ?? ""; return `<td${/^-?[\d.,]+$/.test(v) ? ' class="num"' : ""}>${escHtml(v)}</td>`; }).join("")}</tr>`).join("");
      box.innerHTML = `<div class="pv-sheet">
        <div class="sh-scroll">${sh.rows.length ? `<table><thead>${head}</thead><tbody>${body}</tbody></table>` : `<p class="pv-cut">${t("This sheet is empty.")}</p>`}</div>
        ${sh.truncated ? `<p class="pv-cut">${t("Showing the first 1500 rows.")}</p>` : ""}
        ${!single && sheets.length ? `<div class="sh-tabs">${sheets.map((s, i) => `<button type="button" data-i="${i}" aria-pressed="${i === cur}">${escHtml(s.name)}</button>`).join("")}</div>` : ""}
      </div>`;
      box.querySelectorAll(".sh-tabs button").forEach((b) => (b.onclick = () => { cur = +b.dataset.i; draw(); }));
    };
    draw();
  }
  function parseCsv(text, ext) {
    const first = text.split("\n", 1)[0];
    const delim = ext === "tsv" ? "\t" : [";", "\t", ","].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length && rows.length < 1500; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"') q = true; else if (ch === delim) { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // ---------- editor (md / text / csv)
  async function startEdit(d) {
    const p = await ctx.api(`/api/library/${d.id}/preview`).catch((e) => ({ error: e.message }));
    if (p.error || p.text == null) return ctx.toast(p.error || t("Cannot be edited"), "bad");
    editing = { id: d.id, base: d.mtime, orig: p.text, dirty: false };
    const live = d.kind === "markdown";
    const body = $(".lv-body"); body.classList.add("editing");
    body.innerHTML = `<div class="editor${live ? " split" : ""}">
      <div class="ed-bar"><span class="ed-state" id="ed-state">${t("Editing")}</span><span class="cb-spacer"></span>
        <button type="button" class="btn ghost sm" data-act="cancel">${t("Cancel")}</button>
        <button type="button" class="btn primary sm" data-act="save" title="Ctrl+S">${t("Save")}</button></div>
      <div class="ed-panes"><textarea id="ed-text" spellcheck="false"></textarea>${live ? '<div class="ed-live"><div class="paper rich" id="ed-live"></div></div>' : ""}</div>
    </div>`;
    $(".lv-head [data-act=edit]")?.setAttribute("disabled", "");
    const ta = $("#ed-text"); ta.value = p.text; ta.focus(); ta.setSelectionRange(0, 0);
    let liveT;
    const upd = () => { $("#ed-live").innerHTML = ctx.md(ta.value); };
    if (live) upd();
    ta.addEventListener("input", () => {
      const dirty = ta.value !== editing.orig;
      if (dirty !== editing.dirty) { editing.dirty = dirty; $("#ed-state").textContent = dirty ? t("Not saved") : t("Editing"); $("#ed-state").classList.toggle("dirty", dirty); }
      if (live) { clearTimeout(liveT); liveT = setTimeout(upd, 120); }
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Tab") { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText("  ", s, ta.selectionEnd, "end"); ta.dispatchEvent(new Event("input")); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveEdit(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
    });
  }
  async function saveEdit() {
    if (!editing) return;
    const text = $("#ed-text").value;
    try {
      await ctx.api(`/api/library/${editing.id}/content`, { method: "PUT", body: { text, base: editing.base } });
      editing = null; ctx.toast(t("Saved · the previous version is in the version history")); await load(); renderView();
    } catch (err) { ctx.toast(err.message, "bad"); }
  }
  async function cancelEdit() {
    if (editing?.dirty && !(await ctx.confirmBox({ title: t("Discard changes?"), body: t("Changes you have not saved will be lost."), ok: t("Discard"), danger: true }))) return;
    editing = null; renderView();
  }

  // ---------- info panel
  async function renderInfo(d) {
    const box = $("#lv-info");
    const ags = ctx.agents();
    box.innerHTML = `
      <section><h4>${t("Collection")}</h4>
        <select id="li-coll"><option value="">${t("— No collection —")}</option>${colls.map((c) => `<option value="${c.id}"${c.id === d.collection ? " selected" : ""}>${escHtml(c.name)}</option>`).join("")}<option value="__new">${t("+ New collection…")}</option></select></section>
      <section><h4>${t("Tags")}</h4>
        <div class="tagbox" id="li-tags">${d.tags.map((tag, i) => `<span class="tag">${escHtml(tag)}<button type="button" data-i="${i}" aria-label="${t("Remove tag")}">${I.x}</button></span>`).join("")}<input id="li-tag" placeholder="${d.tags.length ? t("Add…") : t("e.g. v3, stock, approved")}" maxlength="32"></div></section>
      <section><h4>${t("Note")}</h4><textarea id="li-note" rows="3" placeholder="${t("Who sent it, which version, what to watch for…")}">${escHtml(d.note)}</textarea></section>
      <section><h4>${t("Link to projects")}</h4>
        <p class="li-help">${t("The agent of a linked project knows this document in every conversation and reads it itself when needed.")}</p>
        <div class="li-agents">${ags.map((a) => `<label class="li-ag"><input type="checkbox" value="${a.id}"${d.agents.includes(a.id) ? " checked" : ""}><i style="background-image:${ctx.portrait(a)}"></i><span>${escHtml(ctx.label(a))}</span></label>`).join("") || `<p class="li-help">${t("No projects yet.")}</p>`}</div></section>
      <section class="li-vers"><h4>${t("Version history")} <small>${d.versions ? d.versions : ""}</small></h4><div id="li-vers">${d.versions ? `<p class="li-help">${t("Loading…")}</p>` : `<p class="li-help">${t("When you edit or upload a new version, the previous one is kept here.")}</p>`}</div>
        <button type="button" class="btn ghost sm wide" id="li-replace">${I.up}${t("Upload new version")}</button></section>
      <section class="li-file"><h4>${t("File")}</h4>
        <dl><dt>${t("Added")}</dt><dd>${fullDate(d.createdAt)}</dd><dt>${t("Updated")}</dt><dd>${fullDate(d.updatedAt)}</dd><dt>${t("Size")}</dt><dd>${fmtSize(d.size)}</dd></dl>
        <button type="button" class="li-path" title="${t("Copy path")}">${escHtml(d.path)}</button>
        ${d.textPath ? `<p class="li-help">${t("A readable text version is extracted automatically for agents.")}</p>` : ""}</section>`;
    const patch = (body) => ctx.api(`/api/library/${d.id}`, { method: "PATCH", body }).then(load).catch((err) => ctx.toast(err.message, "bad"));
    $("#li-coll").onchange = async (e) => {
      if (e.target.value === "__new") {
        e.target.value = d.collection || "";
        const name = prompt0(t("New collection name")); const n = await name; if (!n) return;
        try { const c = await ctx.api("/api/library/collections", { method: "POST", body: { name: n } }); patch({ collection: c.id }); } catch (err) { ctx.toast(err.message, "bad"); }
        return;
      }
      patch({ collection: e.target.value || null });
    };
    const tagIn = $("#li-tag");
    tagIn.onkeydown = (e) => {
      if ((e.key === "Enter" || e.key === ",") && tagIn.value.trim()) { e.preventDefault(); patch({ tags: [...d.tags, tagIn.value.trim()] }); }
      if (e.key === "Backspace" && !tagIn.value && d.tags.length) patch({ tags: d.tags.slice(0, -1) });
    };
    $("#li-tags").onclick = (e) => { const b = e.target.closest("button[data-i]"); if (b) patch({ tags: d.tags.filter((_, i) => i !== +b.dataset.i) }); else tagIn.focus(); };
    const note = $("#li-note"); note.onchange = () => patch({ note: note.value });
    box.querySelectorAll(".li-ag input").forEach((c) => (c.onchange = () => {
      const ids = [...box.querySelectorAll(".li-ag input:checked")].map((x) => x.value);
      patch({ agents: ids }).then(() => ctx.toast(c.checked ? t("Linked to project") : t("Link removed")));
    }));
    $("#li-replace").onclick = () => pickReplace(d);
    $(".li-path", box).onclick = () => navigator.clipboard.writeText(d.path).then(() => ctx.toast(t("Path copied")));
    if (d.versions) {
      const vs = await ctx.api(`/api/library/${d.id}/versions`).catch(() => []);
      const vb = $("#li-vers"); if (!vb || selId !== d.id) return;
      vb.innerHTML = vs.map((v) => `<div class="ver"><span><b>${ago(v.at)}</b><small>${escHtml(v.reason)} · ${fmtSize(v.size)}</small></span>
        <a class="hbtn" href="/api/library/${d.id}/raw?v=${encodeURIComponent(v.id)}&download=1" title="${t("Download this version")}">${t("Download")}</a>
        <button type="button" class="hbtn" data-vd="${escHtml(v.id)}" title="${t("Compare the current version with this one line by line")}">${t("View diff")}</button>
        <button type="button" class="hbtn" data-v="${escHtml(v.id)}" title="${t("Revert the document to this version")}">${t("Restore")}</button></div>`).join("");
      vb.querySelectorAll("[data-vd]").forEach((b) => (b.onclick = () => showVersionDiff(d, vs.find((v) => v.id === b.dataset.vd))));
      vb.querySelectorAll("[data-v]").forEach((b) => (b.onclick = async () => {
        if (!(await ctx.confirmBox({ title: t("Revert to this version?"), body: t("The current version of the document is also saved to the version history; you can undo if you want."), ok: t("Restore") }))) return;
        try { await ctx.api(`/api/library/${d.id}/versions/${encodeURIComponent(b.dataset.v)}/restore`, { method: "POST" }); ctx.toast(t("Version restored")); await load(); renderView(); } catch (err) { ctx.toast(err.message, "bad"); }
      }));
    }
  }
  // ---- version diff (line-based; long unchanged stretches are folded)
  function lineDiff(a, b) {
    const n = a.length, m = b.length;
    if (n * m > 6e6) { // too big: rough comparison
      const sb = new Set(b), sa = new Set(a);
      return [...a.filter((x) => !sb.has(x)).map((x) => ["-", x]), ...b.filter((x) => !sa.has(x)).map((x) => ["+", x])];
    }
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (a[i] === b[j]) { out.push([" ", a[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(["-", a[i++]]); else out.push(["+", b[j++]]); }
    while (i < n) out.push(["-", a[i++]]); while (j < m) out.push(["+", b[j++]]);
    return out;
  }
  async function showVersionDiff(d, v) {
    const ov = document.createElement("div"); ov.className = "vd-overlay";
    ov.innerHTML = `<div class="vd-box" role="dialog" aria-label="${t("Version diff")}"><header><b>${escHtml(d.name)}</b><span>${t("{version} ({when}) → current version", { version: escHtml(v?.reason || ""), when: ago(v?.at) })}</span><span class="vd-sum"></span><button type="button" class="hbtn" data-x>${t("Close")}</button></header><div class="vd-body"><p class="li-help">${t("Comparing…")}</p></div></div>`;
    document.body.append(ov);
    const close = () => { ov.remove(); document.removeEventListener("keydown", esc, true); };
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); } };
    document.addEventListener("keydown", esc, true);
    ov.onclick = (e) => { if (e.target === ov || e.target.closest("[data-x]")) close(); };
    let r; try { r = await ctx.api(`/api/library/${d.id}/versions/${encodeURIComponent(v.id)}/text`); } catch (err) { $(".vd-body", ov).innerHTML = `<p class="li-help">${escHtml(err.message)}</p>`; return; }
    const ops = lineDiff(r.old.split(/\r?\n/), r.cur.split(/\r?\n/));
    const add = ops.filter((o) => o[0] === "+").length, del = ops.filter((o) => o[0] === "-").length;
    $(".vd-sum", ov).innerHTML = add || del ? t("{added} {removed} {removed|line|lines}", { added: `<em class="vd-a">+${add}</em>`, removed: `<em class="vd-d">−${del}</em>` }) : t("No difference in text");
    const keep = new Set(); ops.forEach((o, i) => { if (o[0] !== " ") for (let k = i - 2; k <= i + 2; k++) keep.add(k); });
    let html = "", skipped = 0;
    ops.forEach((o, i) => {
      if (o[0] === " " && !keep.has(i)) { skipped++; return; }
      if (skipped) { html += `<div class="vd-skip">${t("⋯ {n} unchanged lines", { n: skipped })}</div>`; skipped = 0; }
      html += `<div class="vd-l vd-${o[0] === "+" ? "add" : o[0] === "-" ? "del" : "ctx"}"><i>${o[0] === " " ? "" : o[0] === "+" ? "+" : "−"}</i><span>${escHtml(o[1]) || "&nbsp;"}</span></div>`;
    });
    if (skipped) html += `<div class="vd-skip">${t("⋯ {n} unchanged lines", { n: skipped })}</div>`;
    $(".vd-body", ov).innerHTML = html || `<p class="li-help">${t("The text of these two versions is the same (only formatting may have changed).")}</p>`;
  }
  // small name prompt box (instead of the browser prompt)
  function prompt0(title) {
    return new Promise((res) => {
      const d = $("#dlg-prompt"); $("#pr-title").textContent = title; const inp = $("#pr-input"); inp.value = "";
      d.returnValue = ""; d.showModal(); inp.focus();
      d.addEventListener("close", () => res(d.returnValue === "ok" ? inp.value.trim() : ""), { once: true });
    });
  }

  // ---------- use in chat
  function chatMenu(btn, d) {
    const ags = ctx.agents();
    if (!ags.length) return ctx.toast(t("Add a project first"), "bad");
    menu(btn, ags.map((a) => [`<i class="mi-port" style="background-image:${ctx.portrait(a)}"></i>${escHtml(ctx.label(a))}${d.agents.includes(a.id) ? `<small>${t("linked")}</small>` : ""}`, () => { close().then(() => ctx.useInChat(a.id, d)); }, "", true]), t("Which agent's chat should it be added to?"));
  }

  // ---------- upload
  const upTray = () => $("#lib-uploads");
  function uploadOne(file, url) {
    return new Promise((resolve, reject) => {
      const row = document.createElement("div"); row.className = "up-row";
      row.innerHTML = `<span class="up-name">${escHtml(file.name)}</span><span class="up-bar"><i></i></span>`;
      upTray().append(row);
      const xhr = new XMLHttpRequest(); xhr.open("POST", url);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) row.querySelector("i").style.width = (e.loaded / e.total) * 100 + "%"; };
      xhr.onload = () => {
        row.remove(); let j = {}; try { j = JSON.parse(xhr.responseText); } catch {}
        xhr.status < 300 ? resolve(j) : reject(new Error(j.error || t("{name} could not be uploaded", { name: file.name })));
      };
      xhr.onerror = () => { row.remove(); reject(new Error(t("{name} could not be uploaded", { name: file.name }))); };
      xhr.send(file);
    });
  }
  async function upload(files, { collection } = {}) {
    const out = [];
    const coll = collection !== undefined ? collection : filter.type === "coll" ? filter.id : "";
    for (const f of files) {
      if (!f.size && !f.type) continue; // folder
      if (f.size > 250 * 1048576) { ctx.toast(t("{name} is larger than 250 MB", { name: f.name }), "bad"); continue; }
      // a document with the same name exists: new version or separate document? (a new version stays linked to projects and Scope sees the diff)
      const same = docs.find((d) => d.name.toLocaleLowerCase(locale()) === f.name.toLocaleLowerCase(locale()));
      if (same) {
        const r = await ctx.confirmBox({ title: t("{name} is already in the library", { name: f.name }), body: t("If you upload it as a new version, the old one goes into the version history, the document stays in the projects it is linked to, and the Scope screen marks the changed sections."), ok: t("Upload as new version"), alt: t("Add as separate document"), focusOk: true });
        if (!r) continue;
        if (r === true) {
          try { await uploadOne(f, `/api/library/${same.id}/replace?name=${encodeURIComponent(f.name)}`); ctx.toast(t("{name}: new version uploaded · the old one is in the version history", { name: f.name })); out.push(same); }
          catch (err) { ctx.toast(err.message, "bad"); }
          continue;
        }
      }
      try { out.push(await uploadOne(f, `/api/library/upload?name=${encodeURIComponent(f.name)}&collection=${encodeURIComponent(coll || "")}`)); }
      catch (err) { ctx.toast(err.message, "bad"); }
    }
    if (out.length) {
      if (filter.type === "agent") for (const d of out) await ctx.api(`/api/library/${d.id}`, { method: "PATCH", body: { agents: [...new Set([...(d.agents || []), filter.id])] } }).catch(() => {});
      if (!root.hidden) { selId = out[out.length - 1].id; editing = null; }
      await load();
      if (!root.hidden) ctx.toast(out.length === 1 ? t("Document uploaded") : t("{n} {n|document|documents} uploaded", { n: out.length }));
    }
    return out;
  }
  let replaceFor = null;
  function pickReplace(d) { replaceFor = d; const i = $("#lib-file"); i.accept = "." + d.ext; i.multiple = false; i.click(); }
  $("#lib-upload").onclick = () => { replaceFor = null; const i = $("#lib-file"); i.accept = ""; i.multiple = true; i.click(); };
  $("#lib-file").onchange = async (e) => {
    const files = [...e.target.files]; e.target.value = "";
    if (replaceFor && files[0]) {
      const d = replaceFor; replaceFor = null;
      try { await uploadOne(files[0], `/api/library/${d.id}/replace?name=${encodeURIComponent(files[0].name)}`); ctx.toast(t("New version uploaded · the old one is in the version history")); await load(); renderView(); }
      catch (err) { ctx.toast(err.message, "bad"); }
      return;
    }
    upload(files);
  };
  {
    let depth = 0; const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    root.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; root.classList.add("dropping"); });
    root.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    root.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; root.classList.remove("dropping"); } });
    root.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return; e.preventDefault(); depth = 0; root.classList.remove("dropping");
      const tgt = e.target.closest('.lib-side [data-f="coll"]');
      upload([...e.dataTransfer.files], tgt ? { collection: tgt.dataset.id } : {});
    });
  }

  // ---------- small menu
  let menuEl = null;
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  function menu(anchor, items, title) {
    closeMenu();
    const m = document.createElement("div"); m.className = "pop lib-menu"; m.setAttribute("role", "menu");
    m.innerHTML = (title ? `<p class="lm-title">${escHtml(title)}</p>` : "") + items.map(([label, , cls, html], i) => `<button type="button" role="menuitem" class="${cls || ""}" data-i="${i}">${html ? label : escHtml(label)}</button>`).join("");
    document.body.append(m); menuEl = m;
    const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw)) + "px";
    m.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + "px";
    m.onclick = (e) => { const b = e.target.closest("button[data-i]"); if (!b) return; closeMenu(); items[+b.dataset.i][1](); };
    m.querySelector("button")?.focus();
  }
  document.addEventListener("pointerdown", (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);

  // ---------- keyboard
  $("#lib-close").onclick = close;
  document.addEventListener("keydown", (e) => {
    if (root.hidden || e.defaultPrevented) return;
    if (e.key === "Escape") {
      if (menuEl) { e.preventDefault(); closeMenu(); return; }
      if (document.querySelector("dialog[open]") || e.target.isContentEditable || e.target.closest?.(".ls-input")) return;
      e.preventDefault(); close();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#lib-q").focus(); $("#lib-q").select(); }
  });

  // ---------- document reading tool (MarkItDown): status and install
  let tool = null, toolLine = "";
  async function loadTool(refresh = false) { tool = await ctx.api(`/api/library/tools${refresh ? "?refresh=1" : ""}`).catch(() => null); renderTool(); }
  function renderTool() {
    const box = $("#lib-tool"); if (!box) return;
    if (!tool) { box.innerHTML = ""; return; }
    const head = `<div class="lt-head"><b>${t("Document reading")}</b>${tool.markitdown ? '<i class="dot st-done"></i>' : '<i class="dot st-idle"></i>'}</div>`;
    if (tool.installing) box.innerHTML = head + `<p>${t("Installing MarkItDown…")}</p><code>${escHtml(toolLine || "")}</code>`;
    else if (tool.markitdown) box.innerHTML = head + `<p>${t("Text is extracted from PDF, PowerPoint, .xls and EPUB; their contents are searchable too.")} <small>MarkItDown ${escHtml(tool.markitdown)} · Python ${escHtml(tool.python)}</small></p>`;
    else if (tool.pythonOk) box.innerHTML = head + `<p>${t("Search inside PDF and PowerPoint and a text version for agents: install Microsoft MarkItDown.")}</p><button type="button" class="btn primary sm wide" data-tool="install">${t("Install MarkItDown")}</button>`;
    else box.innerHTML = head + `<p>${tool.python ? t("Python {v} is old; Python 3.10+ is needed for PDF/PowerPoint text. When installing from python.org, tick the <i>Add python.exe to PATH</i> box.", { v: escHtml(tool.python) }) : t("Python not found; Python 3.10+ is needed for PDF/PowerPoint text. When installing from python.org, tick the <i>Add python.exe to PATH</i> box.")}</p><button type="button" class="btn ghost sm wide" data-tool="retry">${t("Check again")}</button>`;
  }
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-tool]"); if (!b) return;
    if (b.dataset.tool === "retry") { b.disabled = true; await loadTool(true); ctx.toast(tool?.pythonOk ? t("Python found") : t("Python still not found"), tool?.pythonOk ? "" : "bad"); return; }
    try { tool = { ...tool, installing: true }; renderTool(); await ctx.api("/api/library/tools/install", { method: "POST" }); }
    catch (err) { ctx.toast(err.message, "bad"); loadTool(true); }
  });
  function onTool(ev) {
    if (ev.line) { toolLine = ev.line; if (tool?.installing) renderTool(); return; }
    if (ev.installing === false) { tool = ev.status; renderTool(); ctx.toast(ev.ok ? t("MarkItDown installed; preparing the documents' texts") : t("MarkItDown could not be installed; try again for details"), ev.ok ? "" : "bad"); }
    else if (ev.installing) { tool = { ...(tool || {}), installing: true }; renderTool(); }
  }
  loadTool();

  // ---------- helpers for the chat side
  return {
    open, close, load, upload, onTool,
    get isOpen() { return !root.hidden; },
    docs: () => docs, byId, loaded: () => loaded,
    linkedTo: (agentId) => docs.filter((d) => d.agents.includes(agentId)),
    find(q, limit = 8) {
      const s = tr(q);
      return docs.filter((d) => !s || tr(d.name).includes(s) || d.tags.some((tag) => tr(tag).includes(s)) || tr(collName(d.collection)).includes(s))
        .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    },
    collName,
  };
}
