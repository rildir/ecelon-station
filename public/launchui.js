// "Start" button at the top right of a project: starts the project and what it needs (its backend…) with one click.
// The first click asks the server for a plan (a small model reads a secret-free digest of the projects once); the user
// sees and may edit every command before anything runs. Later clicks run the saved plan, no model involved.
// State comes from the server (GET …/launch and "launch" events): none · idle · starting · up · failed.
import { t } from "./i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function createLaunch({ api, toast, openRun, projects }) {
  const btn = document.getElementById("launch"), menu = document.getElementById("launch-menu");
  const cache = new Map(); // team → { state, steps, error, plan }
  let agent = null, team = null, busy = false;
  const T = () => agent.id;

  // ------------------------------------------------------------ the button
  function label(s) {
    const st = s?.state || "none", steps = s?.steps || [];
    if (busy) return [t("Looking…"), "starting"];
    if (st === "starting") { const n = steps.filter((x) => x.state === "up").length; return [t("Starting {a}/{b}", { a: Math.min(n + 1, steps.length || 1), b: steps.length || 1 }), "starting"]; }
    if (st === "up") return [t("Running"), "up"];
    if (st === "failed") return [t("Did not start"), "failed"];
    return [t("Start up"), "idle"];
  }
  function render() {
    if (!agent) return;
    const s = cache.get(team); const [txt, cls] = label(s);
    btn.className = "launch ln-" + cls;
    btn.querySelector(".ln-txt").textContent = txt;
    btn.title = cls === "idle" ? (s?.plan ? t("Start this project and what it needs, with the saved plan") : t("Find out how this project starts (a small model reads its settings once), then start it"))
      : cls === "up" ? t("Running. Click for details") : cls === "failed" ? (s?.error || t("Did not start")) : t("Starting…");
    if (!menu.hidden) fillMenu();
  }
  async function show(a) {
    const same = agent && team === (a.team || a.id);
    agent = a; team = a.team || a.id;
    btn.hidden = !!a.solo; // plain chats and task branches have no project of their own to start
    if (btn.hidden) { menu.hidden = true; return; }
    if (!same) menu.hidden = true;
    render();
    if (same && cache.has(team)) return; // fillHeader runs often; one fetch per project is enough, events keep it fresh
    try { const s = await api(`/api/agents/${T()}/launch`); cache.set(a.team || a.id, s); if ((a.team || a.id) === team) render(); } catch { /* server too old: the button stays plain */ }
  }
  function onEvent(ev) {
    const old = cache.get(ev.team) || {};
    cache.set(ev.team, { ...old, state: ev.state, steps: ev.steps || [], error: ev.error || null, ...(ev.state === "none" ? { plan: null } : {}) });
    if (ev.team === team) render();
    if (ev.team === team && ev.state === "up" && old.state === "starting") toast(t("{name} is running", { name: agent.name }), "ok");
    if (ev.team === team && ev.state === "failed" && old.state !== "failed") toast(ev.error || t("Did not start"), "bad");
  }

  // ------------------------------------------------------------ the menu (status, stop, output, plan)
  const DOT = { up: "●", starting: "◌", waiting: "○", failed: "✕" };
  function fillMenu() {
    const s = cache.get(team) || {}, st = s.state || "none", steps = s.steps?.length ? s.steps : (s.plan?.steps || []).map((x) => ({ ...x, state: "waiting" }));
    menu.innerHTML =
      (st === "failed" && s.error ? `<p class="ln-err">${esc(s.error)}</p>` : "") +
      (steps.length ? `<ol class="ln-steps">${steps.map((x) => `<li class="ls-${esc(x.state)}"><b>${DOT[x.state] || "○"}</b><span>` +
        (x.url ? `<button type="button" class="ln-open" data-url="${esc(x.url)}" title="${esc(t("Open {url}", { url: x.url }))}"><strong>${esc(x.label)}</strong><i>${esc(x.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))} ↗</i></button>` : `<strong>${esc(x.label)}</strong>`) +
        `<em>${esc(x.project)}${x.port ? " · :" + x.port : ""}${x.note ? " · " + esc(x.note) : ""}</em></span>` +
        (x.docs ? `<button type="button" class="ln-docs" data-url="${esc(x.docs)}" title="${esc(t("Open {url}", { url: x.docs }))}">${esc(/scalar/i.test(x.docs) ? "Scalar" : /redoc/i.test(x.docs) ? "ReDoc" : /swagger/i.test(x.docs) ? "Swagger" : t("API docs"))} ↗</button>` : "") +
        `</li>`).join("")}</ol>` : "") +
      `<div class="ln-acts">` +
      (st === "up" || st === "starting" ? `<button type="button" data-ln="down" class="danger">${esc(t("Stop"))}</button>` : "") +
      (st === "failed" ? `<button type="button" data-ln="up">${esc(t("Try again"))}</button>` : "") +
      (st === "idle" && s.plan ? `<button type="button" data-ln="up">${esc(t("Start up"))}</button>` : "") +
      (steps.some((x) => x.run) ? `<button type="button" data-ln="out">${esc(t("Show output"))}</button>` : "") +
      `<button type="button" data-ln="edit">${esc(s.plan ? t("Edit plan") : t("Make a plan"))}</button>` +
      (s.plan ? `<button type="button" data-ln="forget" class="ghosty">${esc(t("Delete plan"))}</button>` : "") +
      `</div>`;
  }
  function toggleMenu(open = menu.hidden) { menu.hidden = !open; if (open) fillMenu(); btn.setAttribute("aria-expanded", String(open)); }
  document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) toggleMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { toggleMenu(false); btn.focus(); } });

  async function up() {
    try { const r = await api(`/api/agents/${T()}/launch/up`, { method: "POST" }); cache.set(team, { ...cache.get(team), ...r }); render(); }
    catch (e) { toast(e.message, "bad"); }
  }
  btn.addEventListener("click", async (e) => {
    if (!agent) return;
    const s = cache.get(team) || {};
    if (e.target.closest(".ln-more")) return toggleMenu();
    if (busy) return;
    if (s.state === "starting" || s.state === "up" || s.state === "failed") return toggleMenu();
    if (!s.plan) return planDialog(null);
    toggleMenu(false); up();
  });
  menu.addEventListener("click", async (e) => {
    const link = e.target.closest("[data-url]");
    if (link) { toggleMenu(false); try { await api("/api/open-url", { method: "POST", body: { url: link.dataset.url } }); } catch (err) { toast(err.message, "bad"); } return; }
    const b = e.target.closest("[data-ln]"); if (!b) return;
    const what = b.dataset.ln; toggleMenu(false);
    if (what === "up") up();
    else if (what === "down") { try { await api(`/api/agents/${T()}/launch/down`, { method: "POST" }); } catch (err) { toast(err.message, "bad"); } }
    else if (what === "out") openRun(agent);
    else if (what === "edit") planDialog(cache.get(team)?.plan || null);
    else if (what === "forget") { try { await api(`/api/agents/${T()}/launch/plan`, { method: "DELETE" }); toast(t("The plan was deleted"), "ok"); } catch (err) { toast(err.message, "bad"); } }
  });

  // ------------------------------------------------------------ the plan dialog
  const dlg = document.createElement("dialog");
  dlg.id = "dlg-launch"; dlg.className = "ln-dlg";
  dlg.innerHTML = `<form method="dialog">
    <h3>${esc(t("How this project starts"))}</h3>
    <p class="dlg-sub" id="ln-sub"></p>
    <p class="ln-note" id="ln-note" hidden></p>
    <div class="ln-rows" id="ln-rows"></div>
    <button type="button" class="btn ghost ln-add" id="ln-add">+ ${esc(t("Add step"))}</button>
    <p class="dlg-note">${esc(t("These commands run on this computer, in the given order; each waits until the one before answers on its port. Check them before you save."))}</p>
    <p class="err" id="ln-err"></p>
    <div class="dlg-actions">
      <button type="submit" value="ok" class="btn primary" id="ln-ok">${esc(t("Save and start"))}</button>
      <button type="button" class="btn ghost" id="ln-again">${esc(t("Find again"))}</button>
      <button type="submit" value="" class="btn ghost" formnovalidate>${esc(t("Cancel"))}</button>
    </div>
  </form>`;
  document.body.appendChild(dlg);
  const $d = (s) => dlg.querySelector(s);
  let projList = [];

  function rowHtml(s = {}) {
    const opts = projList.map((p) => `<option value="${esc(p.team)}"${p.team === (s.team || team) ? " selected" : ""}>${esc(p.name)}</option>`).join("");
    return `<div class="ln-row">
      <select class="ln-proj" aria-label="${esc(t("Project"))}">${opts}</select>
      <input class="ln-cmd" spellcheck="false" placeholder="npm start" aria-label="${esc(t("Command"))}" value="${esc(s.cmd || "")}" required>
      <input class="ln-dir" spellcheck="false" placeholder="${esc(t("folder"))}" aria-label="${esc(t("Folder inside the project"))}" value="${esc(s.dir || "")}">
      <input class="ln-port" inputmode="numeric" placeholder="${esc(t("port"))}" aria-label="${esc(t("Port it answers on"))}" value="${s.port ?? ""}">
      <button type="button" class="icon-btn ln-del" title="${esc(t("Remove step"))}" aria-label="${esc(t("Remove step"))}">×</button>
      <input type="hidden" class="ln-label" value="${esc(s.label || "")}">
    </div>`;
  }
  function fill(steps, note) {
    $d("#ln-rows").innerHTML = (steps.length ? steps : [{}]).map(rowHtml).join("");
    $d("#ln-note").hidden = !note; $d("#ln-note").textContent = note || "";
  }
  function readRows() {
    return [...dlg.querySelectorAll(".ln-row")].map((r) => {
      const tm = r.querySelector(".ln-proj").value, p = projList.find((x) => x.team === tm), cmd = r.querySelector(".ln-cmd").value.trim();
      const old = r.querySelector(".ln-label").value, port = parseInt(r.querySelector(".ln-port").value, 10);
      return { team: tm, project: p?.name, cmd, dir: r.querySelector(".ln-dir").value.trim(), port: Number.isInteger(port) ? port : null, label: old && old !== cmd ? old : "" };
    }).filter((x) => x.cmd);
  }
  async function discover() {
    busy = true; render();
    $d("#ln-err").textContent = ""; $d("#ln-sub").textContent = t("A small model is reading the project settings (scripts, ports; never .env files)…");
    $d("#ln-rows").innerHTML = `<p class="ln-wait"><span class="ln-spin"></span>${esc(t("Looking…"))}</p>`; $d("#ln-note").hidden = true;
    $d("#ln-ok").disabled = $d("#ln-again").disabled = true;
    try {
      const { draft } = await api(`/api/agents/${T()}/launch/discover`, { method: "POST" });
      $d("#ln-sub").textContent = t("Suggested steps. Edit them if something is wrong.");
      fill(draft.steps, draft.note);
    } catch (e) {
      $d("#ln-sub").textContent = t("Write the steps yourself.");
      $d("#ln-err").textContent = e.message; fill([], "");
    } finally { busy = false; render(); $d("#ln-ok").disabled = $d("#ln-again").disabled = false; }
  }
  function planDialog(plan) {
    projList = projects();
    $d("#ln-err").textContent = "";
    dlg.returnValue = ""; dlg.showModal();
    if (plan?.steps?.length) { $d("#ln-sub").textContent = t("The saved plan. Changes apply from the next start."); fill(plan.steps, ""); }
    else discover();
  }
  $d("#ln-add").addEventListener("click", () => { $d("#ln-rows").insertAdjacentHTML("beforeend", rowHtml({})); $d("#ln-rows .ln-row:last-child .ln-cmd").focus(); });
  $d("#ln-again").addEventListener("click", discover);
  $d("#ln-rows").addEventListener("click", (e) => { const b = e.target.closest(".ln-del"); if (b) b.closest(".ln-row").remove(); });
  $d("form").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "ok") return;
    e.preventDefault();
    const steps = readRows(); if (!steps.length) { $d("#ln-err").textContent = t("Add at least one command."); return; }
    $d("#ln-ok").disabled = true;
    try {
      const { plan } = await api(`/api/agents/${T()}/launch/plan`, { method: "PUT", body: { steps } });
      cache.set(team, { ...cache.get(team), plan, state: cache.get(team)?.state === "none" ? "idle" : cache.get(team)?.state || "idle" });
      dlg.close("ok"); up();
    } catch (err) { $d("#ln-err").textContent = err.message; }
    finally { $d("#ln-ok").disabled = false; }
  });

  return { show, onEvent };
}
