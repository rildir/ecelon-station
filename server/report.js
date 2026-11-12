// Proof report: one self-contained HTML page that shows, for every requirement of a project, the whole chain —
// what the document says → where it is in the code (with the lines themselves) → how it was verified, by whom and
// when → what it cost. Nothing here is new data: it is the requirement list, the coverage and the conversation logs
// laid out for somebody who was not in the room (a manager, a customer, an auditor). No scripts, no external
// files; it prints and it can be mailed.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { t, locale, getLang } from "./i18n.js";
import * as reqs from "./requirements.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const when = (ms) => (ms ? new Date(ms).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }) : "");
const money = (usd) => (usd >= 100 ? `$${Math.round(usd)}` : usd >= 10 ? `$${usd.toFixed(1)}` : `$${usd.toFixed(2)}`);

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 4000, windowsHide: true }, (err, out) => resolve(err ? "" : String(out).trim()));
  });
}

// the evidence lines themselves, with a little context; only files inside the project, never more than a screenful
function snippet(cwd, ref) {
  try {
    const root = path.resolve(cwd), abs = path.resolve(root, ref.file), rel = path.relative(root, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    const st = fs.statSync(abs); if (!st.isFile() || st.size > 2e6) return null;
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    const from = ref.from || 1, to = Math.min(ref.to || from, from + 30);
    const a = Math.max(1, from - 3), b = Math.min(lines.length, to + 3);
    return lines.slice(a - 1, b).map((text, i) => ({ n: a + i, text: text.slice(0, 220), hit: a + i >= from && a + i <= to && !!ref.from }));
  } catch { return null; }
}

const STATE = () => ({
  verified: { cls: "ok", label: t("Verified") }, failed: { cls: "bad", label: t("Verification failed") },
  stale: { cls: "warn", label: t("Needs re-verification") }, none: { cls: "mute", label: t("Not verified") },
});

/**
 * @param {{ team: string, name: string, cwd: string, coverage: object|null, payroll: {items: any[], totalUsd: number}|null, version: string }} o
 * @returns {Promise<string>} the page
 */
export async function proofReport({ team, name, cwd, coverage, payroll, version }) {
  const { data } = cwd ? reqs.refreshStale(team, cwd) : { data: reqs.load(team) }; // evidence hashes are re-checked now
  const all = data.items, items = all.filter((x) => !reqs.isDropped(x)), dropped = all.filter(reqs.isDropped);
  const sum = reqs.summary(team), S = STATE();
  const [commit, branch, dirty] = cwd ? await Promise.all([git(cwd, ["rev-parse", "--short=10", "HEAD"]), git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]), git(cwd, ["status", "--porcelain"])]) : ["", "", ""];
  const costOf = new Map((payroll?.items || []).map((x) => [x.code, x]));
  const unverified = items.filter((x) => (x.verify?.state || "none") === "none").length;
  const pct = items.length ? Math.round((sum.done / items.length) * 100) : 0;

  const tile = (n, label, cls = "") => `<div class="tile ${cls}"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;
  const chip = (cls, label) => `<span class="chip ${cls}">${esc(label)}</span>`;

  const card = (it) => {
    const v = it.verify || { state: "none" }, st = S[v.state] || S.none, mm = reqs.isMismatch(it), cost = costOf.get(it.code);
    const refs = (v.refs?.length ? v.refs : []).map((r) => {
      const lines = cwd ? snippet(cwd, r) : null;
      return `<div class="ref"><div class="ref-h"><code>${esc(r.ref)}</code>${r.hash ? `<span title="${esc(t("Fingerprint of these lines at verification time; if the code changes, the item drops back to 'needs re-verification'"))}">${esc(t("fingerprint"))} ${esc(r.hash)}</span>` : ""}</div>${
        lines ? `<pre>${lines.map((l) => `<span class="ln${l.hit ? " hit" : ""}"><i>${l.n}</i>${esc(l.text) || " "}</span>`).join("")}</pre>` : `<p class="mute">${esc(t("The file could not be read when the report was made."))}</p>`}</div>`;
    }).join("");
    const crit = (it.criteria || []).map((c) => `<li class="c-${esc(c.state)}"><span>${c.state === "pass" ? "✓" : c.state === "fail" ? "✕" : "○"}</span>${esc(c.text)}${c.note ? ` <em>${esc(c.note)}</em>` : ""}</li>`).join("");
    return `<article class="req ${st.cls}${mm ? " mm" : ""}" id="${esc(it.code)}">
      <header><code class="code">${esc(it.code)}</code><h3>${esc(it.title)}</h3><div class="chips">${chip(st.cls, st.label)}${mm ? chip("bad", t("Mismatch")) : ""}${chip("mute", reqs.statusName(it.status))}</div></header>
      ${it.detail ? `<p class="detail">${esc(it.detail)}</p>` : ""}
      <div class="chain">
        <section><h4>1 · ${esc(t("The document says"))}</h4>
          ${it.claimText ? `<blockquote>${esc(it.claimText)}</blockquote>` : `<p class="mute">${esc(t("No status claim in the document."))}</p>`}
          <p class="meta">${[it.source, it.section, (it.segs || []).slice(0, 6).join(", ")].filter(Boolean).map(esc).join(" · ")}</p></section>
        <section><h4>2 · ${esc(t("In the code"))}</h4>
          ${refs || (it.evidence ? `<p><code>${esc(it.evidence)}</code></p>` : `<p class="mute">${esc(t("No pointer into the code yet."))}</p>`)}
          ${it.note ? `<p class="meta">${esc(it.note)}</p>` : ""}</section>
        <section><h4>3 · ${esc(t("Verification"))}</h4>
          ${v.state === "none" ? `<p class="mute">${esc(t("Nobody has verified this item yet."))}</p>` : `<p class="how">${esc(v.how || "")}</p>
            <p class="meta">${esc(v.by || "")}${v.at ? " · " + esc(when(v.at)) : ""}${v.tests?.length ? " · " + esc(t("tests: {list}", { list: v.tests.join(", ") })) : ""}</p>${
            v.staleRefs?.length ? `<p class="warn-t">${esc(t("Changed since verification: {list}", { list: v.staleRefs.join(", ") }))}</p>` : ""}`}
          ${crit ? `<ul class="crit">${crit}</ul>` : ""}</section>
      </div>
      ${cost ? `<footer>${esc(t("Cost of the work on this item: {cost} in {n} {n|run|runs}", { cost: money(cost.costUsd), n: cost.runs }))}</footer>` : ""}
    </article>`;
  };

  const order = { failed: 0, stale: 1, none: 2, verified: 3 };
  const sorted = [...items].sort((a, b) => (reqs.isMismatch(b) - reqs.isMismatch(a)) || ((order[a.verify?.state || "none"] ?? 2) - (order[b.verify?.state || "none"] ?? 2)) || a.code.localeCompare(b.code, undefined, { numeric: true }));
  const toc = sorted.map((it) => { const st = S[it.verify?.state || "none"] || S.none; return `<a href="#${esc(it.code)}" class="${st.cls}${reqs.isMismatch(it) ? " mm" : ""}"><code>${esc(it.code)}</code><span>${esc(it.title)}</span><em>${esc(reqs.isMismatch(it) ? t("Mismatch") : st.label)}</em></a>`; }).join("");

  return `<!doctype html>
<html lang="${esc(getLang())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t("Proof report"))} · ${esc(name)}</title>
<style>
:root{--ink:#161a2c;--mute:#666b85;--line:#dfe2ee;--bg:#f5f6fb;--card:#fff;--ok:#12824d;--okbg:#e4f6ec;--bad:#c0283f;--badbg:#fde8ec;--warn:#9a5b00;--warnbg:#fdf0d8;--acc:#0041ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 "Segoe UI",system-ui,-apple-system,sans-serif}
main{max-width:940px;margin:0 auto;padding:40px 24px 64px}
code,pre{font-family:ui-monospace,Consolas,"JetBrains Mono",monospace}
.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:3px solid var(--ink);padding-bottom:18px}
.top h1{margin:0;font-size:30px;line-height:1.15;letter-spacing:-.02em}.top p{margin:6px 0 0;color:var(--mute)}
.stamp{text-align:right;font-size:12.5px;color:var(--mute);white-space:nowrap}.stamp b{display:block;color:var(--ink);font-size:13px}
.verdict{margin:22px 0 6px;font-size:19px;font-weight:600}.verdict b{font-size:34px;letter-spacing:-.02em;margin-right:8px}
.bar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--line);margin:8px 0 18px}.bar i{display:block}.bar .ok{background:var(--ok)}.bar .bad{background:var(--bad)}.bar .warn{background:#e0a030}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.tile b{display:block;font-size:24px;line-height:1.1}.tile span{font-size:12.5px;color:var(--mute)}
.tile.bad b{color:var(--bad)}.tile.ok b{color:var(--ok)}.tile.warn b{color:var(--warn)}
h2{margin:36px 0 12px;font-size:13px;letter-spacing:.09em;text-transform:uppercase;color:var(--mute)}
.note{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--acc);border-radius:8px;padding:12px 16px;font-size:13.5px;color:#33384f}.note p{margin:0 0 6px}.note p:last-child{margin:0}
.toc{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.toc a{display:grid;grid-template-columns:64px 1fr auto;gap:12px;padding:8px 14px;border-top:1px solid var(--line);text-decoration:none;color:inherit;font-size:14px}.toc a:first-child{border-top:0}
.toc a:hover{background:var(--bg)}.toc em{font-style:normal;font-size:12.5px;font-weight:600}.toc .ok em{color:var(--ok)}.toc .bad em,.toc .mm em{color:var(--bad)}.toc .warn em{color:var(--warn)}.toc .mute em{color:var(--mute)}
.req{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--line);border-radius:10px;padding:18px 20px;margin:0 0 16px;break-inside:avoid}
.req.ok{border-left-color:var(--ok)}.req.bad,.req.mm{border-left-color:var(--bad)}.req.warn{border-left-color:#e0a030}
.req header{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:baseline}.req h3{margin:0;font-size:17px}
.code{font-weight:700;color:var(--acc)}.chips{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.chip{font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;background:var(--bg);color:var(--mute);white-space:nowrap}
.chip.ok{background:var(--okbg);color:var(--ok)}.chip.bad{background:var(--badbg);color:var(--bad)}.chip.warn{background:var(--warnbg);color:var(--warn)}
.detail{margin:8px 0 0;color:#33384f}
.chain{display:grid;gap:14px;margin-top:14px}
.chain section{border-top:1px dashed var(--line);padding-top:10px}
h4{margin:0 0 6px;font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--mute)}
blockquote{margin:0;padding:6px 14px;border-left:3px solid var(--line);font-style:italic}
.meta{margin:6px 0 0;font-size:12.5px;color:var(--mute)}.mute{color:var(--mute);margin:0}.how{margin:0}.warn-t{margin:6px 0 0;color:var(--warn);font-size:13px;font-weight:600}
.ref{margin-top:8px}.ref-h{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;color:var(--mute)}.ref-h code{color:var(--ink);font-weight:600}
pre{margin:6px 0 0;background:#12162a;color:#d9dcf0;border-radius:8px;padding:10px 0;font-size:12.5px;line-height:1.5;overflow-x:auto;white-space:pre}
.ln{display:block;padding:0 14px 0 0}.ln i{display:inline-block;width:46px;padding-right:12px;text-align:right;color:#6b7096;font-style:normal;user-select:none}.ln.hit{background:rgba(246,162,58,.2);box-shadow:inset 3px 0 0 #f6a23a}
.crit{list-style:none;margin:10px 0 0;padding:0;font-size:14px}.crit li{display:flex;gap:8px;padding:2px 0}.crit span{font-weight:700;width:14px}.c-pass span{color:var(--ok)}.c-fail span{color:var(--bad)}.c-none span{color:var(--mute)}.crit em{color:var(--mute)}
.req footer{margin-top:12px;font-size:12.5px;color:var(--mute)}
.end{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--mute);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
.dropped{font-size:14px;color:var(--mute)}.dropped li{margin:2px 0}
@media print{body{background:#fff}main{padding:0;max-width:none}.toc a:hover{background:none}pre{white-space:pre-wrap;word-break:break-all}.req,.tile,.toc,.note{box-shadow:none}}
</style></head><body><main>
<div class="top"><div><h1>${esc(t("Proof report"))}</h1><p>${esc(name)}</p></div>
  <div class="stamp"><b>${esc(when(Date.now()))}</b>${commit ? `${esc(branch)} @ <code>${esc(commit)}</code>${dirty ? " + " + esc(t("uncommitted changes")) : ""}` : esc(t("not a git repository"))}</div></div>

<p class="verdict"><b>${pct}%</b>${esc(t("{done} of {total} requirements verified with evidence", { done: sum.done, total: items.length }))}</p>
<div class="bar"><i class="ok" style="flex:${sum.done}"></i><i class="bad" style="flex:${sum.failed}"></i><i class="warn" style="flex:${sum.stale}"></i><i style="flex:${unverified}"></i></div>
<div class="tiles">
  ${tile(sum.done, t("Verified"), "ok")}${tile(sum.mismatches, t("Document says done, not proven"), sum.mismatches ? "bad" : "")}${tile(sum.failed, t("Verification failed"), sum.failed ? "bad" : "")}
  ${tile(sum.stale, t("Needs re-verification"), sum.stale ? "warn" : "")}${tile(unverified, t("Not verified"))}
  ${coverage ? tile(coverage.pct + "%", t("Document coverage")) : ""}${payroll?.totalUsd ? tile(money(payroll.totalUsd), t("Agent cost")) : ""}
</div>

<h2>${esc(t("How to read this"))}</h2>
<div class="note">
  <p>${esc(t("An item counts as verified only when a tester — a different agent from the one that wrote the code — ran the scenario and pointed at lines or tests that exist in the project. A statement alone is not accepted."))}</p>
  <p>${esc(t("The pointed lines were fingerprinted at verification time and re-checked when this report was made: if that code has changed since, the item is shown as 'needs re-verification', not as verified."))}</p>
</div>

<h2>${esc(t("Requirements"))}</h2>
${items.length ? `<nav class="toc">${toc}</nav>` : `<p class="mute">${esc(t("There are no requirements for this project yet."))}</p>`}

${items.length ? `<h2>${esc(t("Evidence, item by item"))}</h2>` : ""}
${sorted.map(card).join("\n")}

${dropped.length ? `<h2>${esc(t("Out of scope (approved)"))}</h2><ul class="dropped">${dropped.map((it) => `<li><code>${esc(it.code)}</code> ${esc(it.title)}${it.note ? ` — ${esc(it.note)}` : ""}</li>`).join("")}</ul>` : ""}

<div class="end"><span>${esc(t("Generated locally by Ecelon Station {version}. Nothing in this file was sent anywhere.", { version }))}</span><span>${esc(cwd ? path.basename(cwd) : "")}</span></div>
</main></body></html>`;
}
