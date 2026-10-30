// Git panel: like Source Control in VS Code — changes, diff, stage/unstage/discard, commit, push/pull, history.
import { t, locale } from "./i18n.js";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ago = (ts) => {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t("just now"); if (s < 3600) return t("{n} min", { n: Math.floor(s / 60) }); if (s < 86400) return t("{n} h", { n: Math.floor(s / 3600) });
  if (s < 30 * 86400) return t("{n} {n|day|days}", { n: Math.floor(s / 86400) });
  return new Date(ts).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "2-digit" });
};
const ST = { M: ["M", t("Modified")], A: ["A", t("Added")], D: ["D", t("Deleted")], R: ["R", t("Renamed")], U: ["!", t("Conflict")], "U?": ["U", t("Untracked (new)")] };

export function createGit(ctx) {
  // ctx: { api, toast, confirmBox, onOpen, onClose, onChanged }
  const root = $("#git");
  let agent = null, st = null, sel = null, busyOp = "", pendingDiverge = false, menuEl = null;

  async function open(a) { agent = a; root.hidden = false; ctx.onOpen?.(); sel = null; $("#gt-diff").innerHTML = emptyDiff(); await load(); setTimeout(() => $("#gt-msg").focus({ preventScroll: true }), 30); }
  function close() { root.hidden = true; agent = null; ctx.onClose?.(); }
  async function load() {
    if (!agent) return;
    try { st = await ctx.api(`/api/agents/${agent.id}/git`); }
    catch (err) {
      st = null; $("#gt-title").textContent = agent.name; $("#gt-branch").innerHTML = "";
      const norepo = /git deposu değil|not a git repo/i.test(err.message);
      $("#gt-left").innerHTML = norepo
        ? `<div class="lib-empty"><b>${t("This project is not a git repository")}</b><p>${t("Commit, push and change history need git. Initializing creates a git repository in the folder (it does not add a remote and sends nothing).")}</p><button type="button" class="btn primary sm" data-g="init">${t("Initialize git")}</button></div>`
        : `<div class="lib-empty"><b>${t("Could not open git")}</b><p>${esc(err.message)}</p></div>`;
      root.querySelectorAll('[data-g="fetch"], [data-g="pull"], [data-g="push"]').forEach((b) => (b.disabled = true));
      root.classList.add("norepo");
      return;
    }
    root.querySelectorAll('[data-g="fetch"], [data-g="pull"], [data-g="push"]').forEach((b) => (b.disabled = false));
    root.classList.remove("norepo");
    render();
  }
  const emptyDiff = () => `<div class="lv-none"><b>${t("Select a file")}</b><p>${t("You will see the change here line by line.")}</p></div>`;

  function render() {
    $("#gt-title").textContent = agent.name;
    const ahead = st.ahead || 0, behind = st.behind || 0;
    $("#gt-branch").innerHTML = (st.branch ? `<button type="button" class="gt-bbtn" data-g="branch" title="${t("Switch branch, new branch, merge")}">` : "") + (st.branch ? `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.6" style="fill:none;stroke:currentColor;stroke-width:1.6"/><circle cx="4.5" cy="12.5" r="1.6" style="fill:none;stroke:currentColor;stroke-width:1.6"/><circle cx="11.5" cy="5" r="1.6" style="fill:none;stroke:currentColor;stroke-width:1.6"/><path d="M4.5 5.1v5.8M11.5 6.6c0 3-7 2-7 4.3"/></svg>${esc(st.branch)}${st.upstream ? ` <em>${ahead ? `↑${ahead}` : ""} ${behind ? `↓${behind}` : ""}</em>` : ` <em class="noup">${t("no remote branch")}</em>`}<svg class="gt-caret" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg></button>` : `<button type="button" class="gt-bbtn" data-g="branch">${t("No branch (detached)")} <svg class="gt-caret" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg></button>`);
    const pushB = $('[data-g="push"]'); pushB.textContent = ahead ? t("Push ({n})", { n: ahead }) : t("Push"); pushB.className = `btn sm ${ahead || !st.upstream ? "primary" : "ghost"}`;
    $('[data-g="pull"]').textContent = behind ? t("Pull ({n})", { n: behind }) : t("Pull");
    const total = st.staged.length + st.changes.length + st.conflicts.length;
    $("#gt-commit").textContent = st.staged.length ? t("Commit ({n})", { n: st.staged.length }) : total ? t("Commit all ({n})", { n: total }) : t("Commit");
    $("#gt-commit").disabled = !total || !!st.merging;
    if (st.merging) $("#gt-commit").textContent = t("Merge in progress");
    $("#gt-busy").hidden = !st.busy;
    const row = (f, kind) => {
      const [letter, name] = ST[f.st] || [f.st, f.st];
      const key = `${kind}:${f.path}`;
      return `<div class="gt-file${sel === key ? " on" : ""}" data-k="${esc(key)}" data-path="${esc(f.path)}" data-kind="${kind}"${f.untracked ? ' data-untracked="1"' : ""} title="${esc(name)}: ${esc(f.from ? `${f.from} → ${f.path}` : f.path)}">
        <span class="chg-s s-${letter === "U" ? "A" : letter === "!" ? "D" : letter}">${letter}</span>
        <span class="gt-name">${esc(f.path.split("/").pop())}</span><span class="gt-dir">${esc(f.path.split("/").slice(0, -1).join("/"))}</span>
        <span class="gt-acts">${kind === "staged" ? `<button type="button" data-a="unstage" title="${t("Unstage")}">−</button>`
          : kind === "conflict" ? `<button type="button" data-a="stage" title="${t("Stage as resolved")}">+</button>`
          : `<button type="button" data-a="discard" title="${t("Discard change")}">↶</button><button type="button" data-a="stage" title="${t("Stage")}">+</button>`}</span></div>`;
    };
    const sec = (title, list, kind, acts) => list.length ? `<section class="gt-sec"><h4><span>${title}</span><b>${list.length}</b><span class="gt-sec-acts">${acts}</span></h4>${list.map((f) => row(f, kind)).join("")}</section>` : "";
    const mg = st.merging;
    const banner = mg ? `<div class="gt-merge"><b>${mg.kind === "rebase" ? t("Rebase in progress") : mg.kind === "cherry-pick" ? t("Cherry-pick in progress") : t("Merge in progress")}</b><span>${esc(mg.message || "")}</span>
      <p>${st.conflicts.length ? t("{n} {n|file|files} have conflicts. Click a file and choose which side to keep in each hunk.", { n: st.conflicts.length }) : t("No conflicts left; you can complete it.")}</p>
      <div><button type="button" class="btn ghost sm" data-g="abort">${t("Abort")}</button><button type="button" class="btn primary sm" data-g="continue" ${st.conflicts.length ? "disabled" : ""}>${t("Complete merge")}</button></div></div>` : "";
    $("#gt-left").innerHTML = banner + (total || mg ? "" : `<p class="gt-clean">${t("✓ Working tree clean; nothing to commit.")}</p>`) +
      sec(t("Conflicts"), st.conflicts, "conflict", "") +
      sec(t("Staged changes"), st.staged, "staged", `<button type="button" data-all="unstage" title="${t("Unstage all")}">−</button>`) +
      sec(t("Changes"), st.changes, "change", `<button type="button" data-all="discard" title="${t("Discard all")}">↶</button><button type="button" data-all="stage" title="${t("Stage all")}">+</button>`) +
      `<section class="gt-sec gt-log"><h4><span>${t("History")}</span></h4>${(st.log || []).map((c) => `<div class="gt-commit${sel === "c:" + c.sha ? " on" : ""}" data-sha="${c.sha}" title="${esc(c.author)} · ${esc(new Date(c.at).toLocaleString(locale()))}">
        <span class="gt-sha">${esc(c.short)}</span><span class="gt-subj">${esc(c.subject)}</span>${c.unpushed ? `<span class="gt-up" title="${t("Not pushed yet")}">↑</span>` : ""}<span class="gt-when">${ago(c.at)}</span></div>`).join("") || `<p class="gt-clean">${t("No commits yet.")}</p>`}</section>`;
  }

  async function showDiff(el) {
    const kind = el.dataset.kind, p = el.dataset.path; sel = el.dataset.k; render();
    const box = $("#gt-diff"); box.innerHTML = `<div class="lv-loading"><span class="pulse"><i></i><i></i><i></i></span></div>`;
    try {
      const r = await ctx.api(`/api/agents/${agent.id}/git/diff?path=${encodeURIComponent(p)}&staged=${kind === "staged" ? 1 : 0}&untracked=${el.dataset.untracked ? 1 : 0}`);
      box.innerHTML = diffView(p, r.diff);
    } catch (err) { box.innerHTML = `<div class="lv-none"><p>${esc(err.message)}</p></div>`; }
  }
  async function showCommit(sha) {
    sel = "c:" + sha; render();
    const box = $("#gt-diff"); box.innerHTML = `<div class="lv-loading"><span class="pulse"><i></i><i></i><i></i></span></div>`;
    try {
      const r = await ctx.api(`/api/agents/${agent.id}/git/show?sha=${sha}`);
      box.innerHTML = `<div class="gt-cmeta"><b>${esc(r.message.split("\n")[0])}</b>${r.message.includes("\n") ? `<pre>${esc(r.message.split("\n").slice(1).join("\n").trim())}</pre>` : ""}<p>${t("{n} {n|file|files}", { n: r.files.length })}</p></div>
        <div class="gt-cfiles">${r.files.map((f) => `<button type="button" class="chg-f" data-cf="${esc(f.path)}"><span class="chg-s s-${f.st}">${f.st}</span><span class="chg-path">${esc(f.from ? `${f.from} → ${f.path}` : f.path)}</span></button><div class="chg-diff" hidden></div>`).join("")}</div>`;
      box.querySelectorAll("[data-cf]").forEach((b) => (b.onclick = async () => {
        const d = b.nextElementSibling; if (!d.hidden) { d.hidden = true; return; }
        d.hidden = false; d.textContent = t("Loading…");
        const x = await ctx.api(`/api/agents/${agent.id}/git/show?sha=${sha}&path=${encodeURIComponent(b.dataset.cf)}`).catch((e) => ({ diff: e.message }));
        d.innerHTML = lines(x.diff);
      }));
    } catch (err) { box.innerHTML = `<div class="lv-none"><p>${esc(err.message)}</p></div>`; }
  }
  const lines = (txt) => String(txt || "").split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(l)).slice(0, 3000)
    .map((l) => `<span class="${l[0] === "+" ? "dl-add" : l[0] === "-" ? "dl-del" : l.startsWith("@@") ? "dl-hunk" : ""}">${esc(l) || " "}</span>`).join("") || `<span>${t("No diff (binary file or only a permission change).")}</span>`;
  const diffView = (p, txt) => `<div class="gt-dhead">${esc(p)}</div><div class="chg-diff gt-dbody">${lines(txt)}</div>`;

  // ---------- branch menu
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  document.addEventListener("pointerdown", (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  async function branchMenu(anchor) {
    closeMenu();
    let b; try { b = await ctx.api(`/api/agents/${agent.id}/git/branches`); } catch (err) { return ctx.toast(err.message, "bad"); }
    const m = document.createElement("div"); m.className = "pop lib-menu gt-bmenu";
    const row = (x, remote) => `<div class="gt-brow${x.name === b.current ? " cur" : ""}" data-b="${esc(x.name)}" data-remote="${remote ? 1 : ""}"><span class="gt-bname">${x.name === b.current ? "✓ " : ""}${esc(x.name)}</span><small>${esc(x.subject || "").slice(0, 60)} · ${ago(x.at)}${x.track ? ` · ${esc(x.track.replace(/ahead (\d+)/, "↑$1").replace(/behind (\d+)/, "↓$1").replace("gone", t("deleted on remote")).replace(/[\[\]]/g, ""))}` : ""}</small>
      ${x.name === b.current ? "" : `<span class="gt-bacts"><button type="button" data-ba="merge" title="${t("Merge this branch into {branch}", { branch: esc(b.current || "") })}">${t("Merge")}</button>${remote ? "" : `<button type="button" data-ba="delete" class="danger" title="${t("Delete branch")}">${t("Delete")}</button>`}</span>`}</div>`;
    m.innerHTML = `<p class="lm-title">${t("Branches · current: {branch}", { branch: esc(b.current || "(detached)") })}</p><button type="button" data-ba="new" class="gt-bnew">${t("+ Create new branch…")}</button>
      <input type="search" class="gt-bq" placeholder="${t("Search branches…")}" autocomplete="off">
      <div class="gt-blist">${b.local.map((x) => row(x, false)).join("")}${b.remote.length ? `<p class="lm-title">${t("Remote branches")}</p>${b.remote.map((x) => row(x, true)).join("")}` : ""}</div>`;
    document.body.append(m); menuEl = m;
    const r = anchor.getBoundingClientRect(); m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + "px"; m.style.top = r.bottom + 6 + "px";
    const q = m.querySelector(".gt-bq"); q.focus();
    q.oninput = () => { const v = q.value.toLowerCase(); m.querySelectorAll(".gt-brow").forEach((el) => (el.hidden = !el.dataset.b.toLowerCase().includes(v))); };
    m.onclick = async (e) => {
      const ba = e.target.closest("[data-ba]")?.dataset.ba; const rowEl = e.target.closest(".gt-brow"); const name = rowEl?.dataset.b;
      if (ba === "new") {
        closeMenu();
        const n = (await ctx.prompt(t("New branch name"), t("e.g. feature/stock-transfer"), "", { ok: t("Create and switch") }))?.trim(); if (!n) return;
        return op("checkout", { name: n, create: true }, t("Branch {name} created", { name: n }));
      }
      if (!name) return;
      closeMenu();
      if (ba === "merge") {
        if (!(await ctx.confirmBox({ title: t("Merge {from} → {to}?", { from: name, to: b.current }), body: t("The commits on {from} are merged into the current branch ({to}). If there are conflicts you resolve them file by file or abort.", { from: name, to: b.current }), ok: t("Merge") }))) return;
        return op("merge", { name }, (x) => x.message);
      }
      if (ba === "delete") {
        if (!(await ctx.confirmBox({ title: t("Delete branch {name}?", { name }), body: t("Only the branch on this computer is deleted. If it has unmerged commits, git refuses to delete it."), ok: t("Delete"), danger: true }))) return;
        return op("branch-delete", { name }, t("Branch deleted"));
      }
      if (name === b.current) return;
      if (st && st.staged.length + st.changes.length && !(await ctx.confirmBox({ title: t("Switch to branch {name}?", { name }), body: t("You have uncommitted changes. Git tries to carry them over to the new branch; if they conflict it refuses to switch. If unsure, commit first."), ok: t("Switch anyway") }))) return;
      return op("checkout", { name }, t("Switched to branch {name}", { name }));
    };
  }

  // ---------- conflict resolution
  async function showConflict(p) {
    sel = "conflict:" + p; render();
    const box = $("#gt-diff"); box.innerHTML = `<div class="lv-loading"><span class="pulse"><i></i><i></i><i></i></span></div>`;
    let f; try { f = await ctx.api(`/api/agents/${agent.id}/git/conflict?path=${encodeURIComponent(p)}`); } catch (err) { box.innerHTML = `<div class="lv-none"><p>${esc(err.message)}</p></div>`; return; }
    const choices = new Array(f.count).fill(null); let k = 0;
    const pre = (ls) => `<pre>${ls.length ? ls.map(esc).join("\n") : `<span class="cf-empty">${t("(empty)")}</span>`}</pre>`;
    box.innerHTML = `<div class="cf-head"><b>${esc(p)}</b><span>${t("{n} {n|conflict|conflicts}", { n: f.count })}</span><span class="cb-spacer"></span>
        <button type="button" class="btn ghost sm" data-cw="ours" title="${t("Keep the current branch's version for the whole file")}">${t("All current")}</button><button type="button" class="btn ghost sm" data-cw="theirs" title="${t("Keep the incoming version for the whole file")}">${t("All incoming")}</button>
        <button type="button" class="btn ghost sm" data-cw="edit">${t("Open in editor")}</button><button type="button" class="btn primary sm" data-cw="save" disabled>${t("Save and mark resolved")}</button></div>
      <div class="cf-body">${f.parts.map((part) => part.type === "text"
        ? `<pre class="cf-ctx">${esc((part.lines.length > 8 ? [...part.lines.slice(0, 3), "⋯", ...part.lines.slice(-3)] : part.lines).join("\n"))}</pre>`
        : `<div class="cf-block" data-k="${k++}"><div class="cf-sides"><div class="cf-side ours"><h5>${t("Current")} <small>${esc(part.oursLabel || "HEAD")}</small></h5>${pre(part.ours)}</div><div class="cf-side theirs"><h5>${t("Incoming")} <small>${esc(part.theirsLabel)}</small></h5>${pre(part.theirs)}</div></div>
          <div class="cf-acts"><button type="button" data-c="ours">${t("Take current")}</button><button type="button" data-c="theirs">${t("Take incoming")}</button><button type="button" data-c="both">${t("Take both")}</button><button type="button" data-c="both-rev">${t("Both (incoming first)")}</button></div></div>`).join("")}</div>`;
    const saveB = box.querySelector('[data-cw="save"]');
    box.onclick = async (e) => {
      const c = e.target.closest("[data-c]");
      if (c) {
        const blk = c.closest(".cf-block"); choices[+blk.dataset.k] = c.dataset.c;
        blk.querySelectorAll("[data-c]").forEach((x) => x.classList.toggle("on", x === c)); blk.classList.add("done");
        blk.querySelector(".ours").classList.toggle("keep", ["ours", "both", "both-rev"].includes(c.dataset.c)); blk.querySelector(".theirs").classList.toggle("keep", ["theirs", "both", "both-rev"].includes(c.dataset.c));
        saveB.disabled = choices.some((x) => !x); saveB.textContent = saveB.disabled ? t("Save ({done}/{total})", { done: choices.filter(Boolean).length, total: choices.length }) : t("Save and mark resolved");
        return;
      }
      const w = e.target.closest("[data-cw]")?.dataset.cw; if (!w) return;
      if (w === "edit") return ctx.openCode?.(agent, p);
      const r = await op("resolve", w === "save" ? { path: p, choices } : { path: p, side: w }, t("{file} resolved", { file: p.split("/").pop() }));
      if (r) { sel = null; box.innerHTML = st?.conflicts?.length ? `<div class="lv-none"><b>${t("Resolved")}</b><p>${t("Select the next conflicted file on the left.")}</p></div>` : `<div class="lv-none"><b>${t("All conflicts resolved")}</b><p>${t("Finish with 'Complete merge' on the left.")}</p></div>`; }
    };
    saveB.textContent = t("Save ({done}/{total})", { done: 0, total: choices.length });
  }

  async function op(name, body = {}, okMsg) {
    if (busyOp) return; busyOp = name;
    root.classList.add("working"); $("#gt-op").textContent = { push: t("Pushing…"), pull: t("Pulling…"), fetch: t("Checking the remote…"), commit: t("Committing…"), suggest: t("Preparing a message…") }[name] || "";
    try { const r = await ctx.api(`/api/agents/${agent.id}/git/${name}`, { method: "POST", body }); if (r?.conflicts) ctx.toast(r.message, "bad"); else if (okMsg) ctx.toast(typeof okMsg === "function" ? okMsg(r) : okMsg); return r; }
    catch (err) {
      if (name === "pull" && /not possible to fast-forward|diverg|Not possible/i.test(err.message)) { pendingDiverge = true; return null; }
      ctx.toast(err.message, "bad"); return null;
    }
    finally { busyOp = ""; root.classList.remove("working"); $("#gt-op").textContent = ""; await load(); ctx.onChanged?.(); }
  }

  root.addEventListener("click", async (e) => {
    const g = e.target.closest("[data-g]")?.dataset.g;
    if (g === "close") return close();
    if (g === "init") { try { await ctx.api(`/api/agents/${agent.id}/git-init`, { method: "POST" }); ctx.toast(t("Git initialized")); await load(); ctx.onChanged?.(); } catch (err) { ctx.toast(err.message, "bad"); } return; }
    if (!st && g) return;
    if (g === "fetch") return op("fetch", {}, t("Remote is up to date"));
    if (g === "pull") {
      pendingDiverge = false; await op("pull", {}, t("Pulled"));
      if (pendingDiverge && await ctx.confirmBox({ title: t("Branches have diverged"), body: t("The remote and you have different commits; fast-forward is not possible. Pull by merging the remote changes with yours? If there are conflicts you can resolve them file by file."), ok: t("Pull with merge") }))
        await op("pull-merge", {}, t("Pulled and merged"));
      return;
    }
    if (g === "branch") return branchMenu(e.target.closest("[data-g]"));
    if (g === "abort") { if (await ctx.confirmBox({ title: t("Abort the merge?"), body: t("The files return to their state before the merge."), ok: t("Abort"), danger: true }) && await op("merge-abort", {}, t("Merge aborted"))) { sel = null; $("#gt-diff").innerHTML = emptyDiff(); } return; }
    if (g === "continue") { const r = await op("merge-continue", {}, t("Merge completed")); if (r) { sel = null; $("#gt-diff").innerHTML = emptyDiff(); } return; }
    if (g === "push") {
      if (st && !st.ahead && st.upstream) return ctx.toast(t("No commits to push"));
      return op("push", {}, (r) => r.message || t("Pushed"));
    }
    const a = e.target.closest("[data-a]");
    if (a) {
      e.stopPropagation();
      const f = a.closest(".gt-file"); const p = f.dataset.path;
      if (a.dataset.a === "stage") return op("stage", { paths: [p] });
      if (a.dataset.a === "unstage") return op("unstage", { paths: [p] });
      if (a.dataset.a === "discard") {
        const fresh = !!f.dataset.untracked;
        if (!(await ctx.confirmBox({ title: t("Discard the changes to {file}?", { file: p.split("/").pop() }), body: fresh ? t("This new file is deleted. This cannot be undone.") : t("The file returns to its state in the last commit. This cannot be undone."), ok: fresh ? t("Delete") : t("Discard change"), danger: true }))) return;
        return op("discard", fresh ? { untracked: [p] } : { paths: [p] }, t("Change discarded"));
      }
    }
    const all = e.target.closest("[data-all]")?.dataset.all;
    if (all === "stage") return op("stage", { all: true });
    if (all === "unstage") return op("unstage", { paths: st.staged.map((f) => f.path) });
    if (all === "discard") {
      if (!(await ctx.confirmBox({ title: t("Discard {n} {n|change|changes}?", { n: st.changes.length }), body: t("All unstaged changes return to the last commit, new files are deleted. This cannot be undone."), ok: t("Discard all"), danger: true }))) return;
      return op("discard", { paths: st.changes.filter((f) => !f.untracked).map((f) => f.path), untracked: st.changes.filter((f) => f.untracked).map((f) => f.path) }, t("Changes discarded"));
    }
    const file = e.target.closest(".gt-file"); if (file) return file.dataset.kind === "conflict" ? showConflict(file.dataset.path) : showDiff(file);
    const c = e.target.closest(".gt-commit"); if (c) return showCommit(c.dataset.sha);
  });
  $("#gt-suggest").onclick = async () => {
    const r = await op("suggest", {}); if (r?.message) { $("#gt-msg").value = r.message; $("#gt-msg").focus(); }
  };
  const doCommit = async () => {
    if (!st) return ctx.toast(t("This project is not a git repository"), "bad");
    const msg = $("#gt-msg").value.trim();
    if (!msg) { ctx.toast(t("Write a commit message or press 'Suggest message'"), "bad"); $("#gt-msg").focus(); return; }
    const all = !st.staged.length;
    if (st.busy && !(await ctx.confirmBox({ title: t("An agent in the team is working"), body: t("If you commit while the agent is changing files, a half-done change may end up in the commit. Continue anyway?"), ok: t("Commit anyway") }))) return;
    const r = await op("commit", { message: msg, all }, (x) => t("Committed: {summary}", { summary: x.summary || "" }));
    if (r) { $("#gt-msg").value = ""; sel = null; $("#gt-diff").innerHTML = emptyDiff(); render(); }
  };
  $("#gt-commit").onclick = doCommit;
  $("#gt-msg").addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doCommit(); } });
  document.addEventListener("keydown", (e) => {
    if (root.hidden || e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
    e.preventDefault(); close();
  });

  return {
    open, close, get isOpen() { return !root.hidden; },
    onEvent(ev) { if (agent && ev.team === (agent.team || agent.id) && !busyOp) load(); },
    refresh() { if (agent && !root.hidden && !busyOp) load(); },
  };
}
