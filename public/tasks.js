// Task board: what the agents left for each other and for the user, instead of "I cannot do that".
import { t } from "./i18n.js";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const COLS = [["todo", () => t("To do")], ["doing", () => t("In progress")], ["blocked", () => t("Blocked")], ["done", () => t("Done")]];
const PRIO = { high: () => t("High"), normal: () => t("Normal"), low: () => t("Low") };

export function createTasks(ctx) {
  // ctx: { api, toast, confirmBox, project(agent) → {team, name, roles:[{id,label}]}, roleIcon(id), openAgent(id), onOpen, onClose, onChange }
  const root = $("#tasks");
  let proj = null, data = { items: [] }, filter = "all", adding = false;
  const roleLabel = (id) => id === "user" ? t("You") : proj?.roles.find((r) => r.id === id)?.label || id;

  async function load() { if (!proj) return; try { data = await ctx.api(`/api/tasks/${proj.team}`); } catch { data = { items: [] }; } render(); }
  async function open(agent) { proj = ctx.project(agent); root.hidden = false; ctx.onOpen?.(); filter = "all"; adding = false; $("#tk-title").textContent = proj.name; fillRoles(); await load(); }
  function close() { root.hidden = true; ctx.onClose?.(); }
  const summary = async (team) => { try { return await ctx.api(`/api/tasks/${team}/summary`); } catch { return { total: 0, open: 0, doing: 0, toUser: 0 }; } };

  function card(it) {
    const mine = it.role === "user";
    const acts = [];
    if (it.wt) acts.push(["chat", t("Chat"), ""], ["review", t("Review"), ""], ["merge", t("Merge"), "primary"], ["discard", t("Discard branch"), "danger"]);
    else {
      if (!mine && (it.status === "todo" || it.status === "blocked")) acts.push(["start", t("Start"), "primary"], ["isolate", t("On its own branch"), ""]);
      if (it.status !== "done") acts.push(["done", t("Mark done"), ""]); else acts.push(["reopen", t("Reopen"), ""]);
      acts.push(["del", "×", "danger"]);
    }
    return `<article class="tk-card p-${it.priority}${mine ? " mine" : ""}" data-id="${esc(it.id)}">
      <header><b>${esc(it.id)}</b><span class="tk-role">${mine ? "" : ctx.roleIcon(it.role)}${esc(roleLabel(it.role))}</span>${it.priority !== "normal" ? `<em class="tk-prio">${PRIO[it.priority]()}</em>` : ""}</header>
      <h4>${esc(it.title)}</h4>
      ${it.detail ? `<details><summary>${t("Details")}</summary><p>${esc(it.detail)}</p></details>` : ""}
      ${it.req?.length ? `<small class="tk-req">${esc(it.req.join(", "))}</small>` : ""}
      ${it.wt ? `<div class="tk-branch"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 3-7 2-7 4"/></svg><code>${esc(it.wt.branch)}</code><span class="tk-delta" data-delta="${esc(it.id)}"></span></div>` : ""}
      ${it.note ? `<p class="tk-note">${esc(it.note)}</p>` : ""}
      <footer><small>${esc(it.by || "")}</small><span>${acts.map(([a, l, c]) => `<button type="button" class="btn sm ${c || "ghost"}" data-act="${a}"${a === "isolate" ? ` title="${esc(t("Runs the task in a separate copy of the project, on its own git branch, so that it can work alongside other tasks. You review and merge it when it is done."))}"` : ""}>${esc(l)}</button>`).join("")}</span></footer></article>`;
  }
  function render() {
    const items = data.items.filter((x) => filter === "all" || (filter === "user" ? x.role === "user" : x.role === filter));
    const open = data.items.filter((x) => x.status !== "done").length;
    $("#tk-sum").textContent = t("{n} open · {m} total", { n: open, m: data.items.length });
    const chips = [["all", t("All")], ["user", t("You")], ...proj.roles.map((r) => [r.id, r.label])];
    $("#tk-filter").innerHTML = chips.map(([id, l]) => `<button type="button" class="chip${filter === id ? " on" : ""}" data-f="${esc(id)}">${esc(l)}${id === "all" ? "" : ` <em>${data.items.filter((x) => x.role === id && x.status !== "done").length || ""}</em>`}</button>`).join("");
    $("#tk-add").hidden = !adding;
    $("#tk-board").innerHTML = data.items.length || adding ? COLS.map(([st, label]) => {
      const col = items.filter((x) => x.status === st).sort((a, b) => ["high", "normal", "low"].indexOf(a.priority) - ["high", "normal", "low"].indexOf(b.priority) || a.createdAt - b.createdAt);
      return `<section class="tk-col c-${st}"><h3>${label()} <em>${col.length}</em></h3><div class="tk-list">${col.map(card).join("") || `<p class="tk-empty">—</p>`}</div></section>`;
    }).join("") : `<div class="tk-none"><b>${t("The board is empty")}</b><p>${t("When an agent cannot do something, or needs you or another role, it leaves a task here instead of stopping.")}</p></div>`;
    fillDeltas();
  }
  // what each isolated task has changed so far: "+12 −3 · 2 files"
  let deltaSeq = 0;
  async function fillDeltas() {
    const seq = ++deltaSeq;
    for (const it of data.items.filter((x) => x.wt)) {
      let d; try { d = await ctx.api(`/api/tasks/${proj.team}/${it.id}/changes`); } catch { continue; }
      if (seq !== deltaSeq) return;
      const el = root.querySelector(`[data-delta="${CSS.escape(it.id)}"]`); if (!el) continue;
      el.innerHTML = d.missing ? esc(t("its copy is missing")) : d.files ? `<b class="plus">+${d.added}</b> <b class="minus">−${d.removed}</b> · ${esc(t("{n} {n|file|files}", { n: d.files }))}${d.running ? " · " + esc(t("working")) : ""}` : esc(d.running ? t("working") : t("no changes yet"));
    }
  }
  async function review(id) {
    const it = data.items.find((x) => x.id === id); if (!it?.wt) return;
    let d; try { d = await ctx.api(`/api/tasks/${proj.team}/${id}/changes?diff=1`); } catch (e) { return ctx.toast(e.message, "bad"); }
    const dlg = $("#dlg-wtdiff");
    $("#wtd-title").textContent = `${it.id} · ${it.title}`;
    $("#wtd-sum").textContent = d.files ? `${it.wt.branch} · +${d.added} −${d.removed} · ${t("{n} {n|file|files}", { n: d.files })}` : `${it.wt.branch} · ${t("no changes yet")}`;
    const lines = String(d.diff || "").split("\n").slice(0, 8000);
    $("#wtd-body").innerHTML = lines.length > 1 || lines[0] ? lines.map((l) => `<div class="${l.startsWith("diff --git") ? "dh" : l.startsWith("@@") ? "hk" : l.startsWith("+") && !l.startsWith("+++") ? "ad" : l.startsWith("-") && !l.startsWith("---") ? "rm" : ""}">${esc(l) || " "}</div>`).join("") : `<p class="tk-empty">${esc(t("no changes yet"))}</p>`;
    $("#wtd-merge").onclick = () => { dlg.close(); merge(id); };
    dlg.showModal();
  }
  async function merge(id) {
    const it = data.items.find((x) => x.id === id); if (!it?.wt) return;
    if (!(await ctx.confirmBox({ title: t("Merge {branch}?", { branch: it.wt.branch }), body: t("The task's changes are committed on its branch and merged into the branch your project is on. Its copy is removed afterwards."), ok: t("Merge") }))) return;
    try { const r = await ctx.api(`/api/tasks/${proj.team}/${id}/merge`, { method: "POST", body: {} }); ctx.toast(r.message, r.ok ? "" : "bad"); } catch (e) { ctx.toast(e.message, "bad"); }
    load();
  }
  async function discard(id) {
    const it = data.items.find((x) => x.id === id); if (!it?.wt) return;
    if (!(await ctx.confirmBox({ title: t("Discard {branch}?", { branch: it.wt.branch }), body: t("The task's copy, its branch and its chat are deleted; your project is not touched. The task goes back to To do."), ok: t("Discard"), danger: true }))) return;
    try { await ctx.api(`/api/tasks/${proj.team}/${id}/discard`, { method: "POST", body: {} }); ctx.toast(t("Its branch was discarded.")); } catch (e) { ctx.toast(e.message, "bad"); }
    load();
  }
  async function patch(id, body) { try { await ctx.api(`/api/tasks/${proj.team}/${id}`, { method: "PATCH", body }); } catch (e) { ctx.toast(e.message, "bad"); } }
  root.addEventListener("click", async (e) => {
    if (e.target.closest('[data-act="close"]')) return close();
    const f = e.target.closest("[data-f]"); if (f) { filter = f.dataset.f; return render(); }
    if (e.target.closest("#tk-new")) { adding = !adding; render(); if (adding) $("#tk-in-title").focus(); return; }
    if (e.target.closest("#tk-in-cancel")) { adding = false; return render(); }
    if (e.target.closest("#tk-in-save")) {
      const title = $("#tk-in-title").value.trim(); if (!title) return $("#tk-in-title").focus();
      try { await ctx.api(`/api/tasks/${proj.team}`, { method: "POST", body: { title, role: $("#tk-in-role").value, priority: $("#tk-in-prio").value, detail: $("#tk-in-detail").value } }); adding = false; $("#tk-in-title").value = $("#tk-in-detail").value = ""; } catch (err) { ctx.toast(err.message, "bad"); }
      return;
    }
    const b = e.target.closest("[data-act]"), c = e.target.closest(".tk-card"); if (!b || !c) return;
    const id = c.dataset.id;
    if (b.dataset.act === "isolate") { try { const r = await ctx.api(`/api/tasks/${proj.team}/${id}/start`, { method: "POST", body: { isolated: true } }); ctx.toast(t("Task {id} started on {branch}", { id, branch: r.branch })); } catch (err) { ctx.toast(err.message, "bad"); } load(); return; }
    if (b.dataset.act === "chat") { const it = data.items.find((x) => x.id === id); if (it?.wt?.agent) { close(); ctx.openAgent(it.wt.agent); } return; }
    if (b.dataset.act === "review") return review(id);
    if (b.dataset.act === "merge") return merge(id);
    if (b.dataset.act === "discard") return discard(id);
    if (b.dataset.act === "start") { try { await ctx.api(`/api/tasks/${proj.team}/${id}/start`, { method: "POST", body: {} }); ctx.toast(t("Task {id} started", { id })); } catch (err) { ctx.toast(err.message, "bad"); } }
    else if (b.dataset.act === "done") await patch(id, { status: "done" });
    else if (b.dataset.act === "reopen") await patch(id, { status: "todo" });
    else if (b.dataset.act === "del") { if (await ctx.confirmBox({ title: t("Delete this task?"), body: data.items.find((x) => x.id === id)?.title || "", ok: t("Delete") })) { try { await ctx.api(`/api/tasks/${proj.team}/${id}`, { method: "DELETE" }); } catch (err) { ctx.toast(err.message, "bad"); } } }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !root.hidden && !document.querySelector("dialog[open]") && !e.defaultPrevented) { e.preventDefault(); close(); } });
  $("#tk-startall").onclick = async () => {
    const list = data.items.filter((x) => x.status === "todo" && x.role !== "user");
    if (!list.length) return ctx.toast(t("No task is waiting for an agent"));
    // one task per role at a time (a role works on one job); the rest start from the board afterwards
    const seen = new Set(); let n = 0;
    for (const it of list) { if (seen.has(it.role)) continue; seen.add(it.role); try { await ctx.api(`/api/tasks/${proj.team}/${it.id}/start`, { method: "POST", body: {} }); n++; } catch (err) { ctx.toast(err.message, "bad"); } }
    if (n) ctx.toast(t("{n} {n|task|tasks} started", { n }));
  };
  function fillRoles() { $("#tk-in-role").innerHTML = [...proj.roles.map((r) => [r.id, r.label]), ["user", t("You")]].map(([i, l]) => `<option value="${esc(i)}">${esc(l)}</option>`).join(""); }
  return {
    open, close, summary, load, discardFor: async (team, id) => { try { await ctx.api(`/api/tasks/${team}/${id}/discard`, { method: "POST", body: {} }); return true; } catch (e) { ctx.toast(e.message, "bad"); return false; } },
    get isOpen() { return !root.hidden; },
    onEvent(ev) { if (!root.hidden && proj && ev.team === proj.team) load(); },
  };
}
