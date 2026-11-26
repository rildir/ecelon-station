// JS Study: talking to the tutor. One place draws the tutor's answer, shows that it is thinking (with the seconds
// and a way to give up), and lets the learner ask a follow-up question about that same answer. A conversation is a
// plain object the caller keeps ({ base, msgs }), so it is still there when the view is drawn again.
//   base: what the first answer is about, as the server's /api/study/tutor takes it ({ kind: "why", questionId, … })
//   msgs: [{ who: "tutor" | "me", text }] or, for a graded answer, { who: "tutor", grade }
import { t } from "./i18n.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const list = (title, items) => (items.length ? `<h5>${esc(title)}</h5><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");

function gradeHtml(g) {
  return `<p class="st-score"><b>${g.score}</b> / 100</p>` + list(t("What was right"), g.good) + list(t("What was missing"), g.missing) +
    (g.better ? `<h5>${esc(t("A stronger version of your answer"))}</h5><p>${esc(g.better)}</p>` : "");
}
const gradeText = (g) => `Score ${g.score}/100. Right: ${g.good.join("; ") || "-"}. Missing: ${g.missing.join("; ") || "-"}. Better: ${g.better}`;

export function createTutor({ api, toast, lang }) {
  /** One question to the tutor. Resolves to the answer, or to null when it failed or was given up. */
  async function ask(body, signal) {
    try { return await api("/api/study/tutor", { method: "POST", body: { ...body, lang: lang() }, signal }); }
    catch (e) { if (e.name !== "AbortError") toast(e.message, "bad"); return null; }
  }

  /** Draws a conversation into `host` and keeps it going. Starts it when it has no answer yet. */
  function mount(host, talk) {
    let waiting = null; // { ctrl, since, timer } while an answer is on its way
    const draw = () => {
      host.hidden = false;
      host.innerHTML = `<div class="st-tutor"><h4>${esc(t("Tutor"))}</h4>` +
        talk.msgs.map((m) => (m.who === "me" ? `<p class="st-mine">${esc(m.text)}</p>` : m.grade ? gradeHtml(m.grade) : `<p>${esc(m.text)}</p>`)).join("") +
        (waiting ? `<p class="st-wait" role="status"><i></i><span>${esc(t("The tutor is thinking…"))}</span> <span class="st-secs">0</span> ${esc(t("s"))} <button type="button" class="st-link" data-tutor="stop">${esc(t("Give up"))}</button></p>`
          : talk.msgs.length ? `<form class="st-ask"><input type="text" maxlength="600" autocomplete="off" placeholder="${esc(t("Ask a follow-up question"))}" aria-label="${esc(t("Ask a follow-up question"))}"><button type="submit" class="btn sm">${esc(t("Ask"))}</button></form>`
            : `<p><button type="button" class="btn sm" data-tutor="retry">${esc(t("Try again"))}</button></p>`) + `</div>`;
    };
    async function send(body, mine) {
      if (waiting) return;
      if (mine) talk.msgs.push({ who: "me", text: mine });
      const ctrl = new AbortController(), since = Date.now();
      waiting = { ctrl, timer: setInterval(() => { const el = host.querySelector(".st-secs"); if (el) el.textContent = String(Math.round((Date.now() - since) / 1000)); }, 1000) };
      draw();
      const r = await ask(body, ctrl.signal);
      clearInterval(waiting.timer); waiting = null;
      if (r?.grade) talk.msgs.push({ who: "tutor", grade: r.grade }); else if (r?.text) talk.msgs.push({ who: "tutor", text: r.text });
      else if (mine) talk.msgs.pop(); // the question got no answer: take it back so it can be asked again
      if (!host.isConnected) return;
      draw(); talk.onChange?.();
      host.querySelector(".st-ask input")?.focus({ preventScroll: true });
    }
    const first = () => send(talk.base);
    host.onclick = (e) => { const b = e.target.closest("[data-tutor]"); if (!b) return; if (b.dataset.tutor === "stop") waiting?.ctrl.abort(); else first(); };
    host.onsubmit = (e) => {
      e.preventDefault(); const q = e.target.querySelector("input").value.trim(); if (!q) return;
      const thread = talk.msgs.map((m) => ({ who: m.who, text: m.grade ? gradeText(m.grade) : m.text }));
      send({ kind: "follow", base: talk.base, thread, ask: q }, q);
    };
    if (talk.msgs.length) draw(); else first();
  }
  return { ask, mount };
}
