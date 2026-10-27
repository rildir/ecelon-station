import { createStation, CHARACTERS } from "./scene.js";

// ================= yardımcılar =================
const $ = (s) => document.querySelector(s);
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { "content-type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Markdown: başlık, liste, tablo, alıntı, kod bloğu (kopyalama düğmeli), bağlantı, kalın/italik
function inline(t) {
  return escHtml(t)
    .replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => linkHtml(txt, url))
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => pre + linkHtml(url, url))
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>");
}
function linkHtml(txt, url) {
  const u = url.replace(/&amp;/g, "&");
  if (/^https?:\/\//i.test(u)) return `<a href="${escHtml(u)}" target="_blank" rel="noopener">${txt}</a>`;
  const local = u.replace(/^file:\/\/\/?/i, "");
  return `<a href="#" data-open="${escHtml(decodeURI(local))}" title="Klasöründe göster">${txt}</a>`;
}
function md(text) {
  const out = [];
  const parts = String(text).split(/```/);
  parts.forEach((seg, k) => {
    if (k % 2) {
      const nl = seg.indexOf("\n"), lang = nl > -1 ? seg.slice(0, nl).trim() : "", code = nl > -1 ? seg.slice(nl + 1) : seg;
      out.push(`<div class="code"><div class="code-head"><span>${escHtml(lang || "kod")}</span><button type="button" class="copy">Kopyala</button></div><pre><code>${escHtml(code.replace(/\n$/, ""))}</code></pre></div>`);
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

// ---- bildirim (alert yerine)
function toast(msg, kind = "") {
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = msg;
  $("#toasts").append(t); setTimeout(() => t.remove(), kind === "bad" ? 5000 : 2600);
}
// ---- onay penceresi (confirm yerine)
function confirmBox({ title, body, ok = "Tamam", danger = false }) {
  const d = $("#dlg-confirm");
  $("#cf-title").textContent = title; $("#cf-body").textContent = body;
  const okBtn = $("#cf-ok"); okBtn.textContent = ok; okBtn.className = "btn " + (danger ? "danger" : "primary");
  d.returnValue = ""; d.showModal(); $("#cf-cancel").focus();
  return new Promise((res) => d.addEventListener("close", () => res(d.returnValue === "ok"), { once: true }));
}

// ================= sabitler =================
const STATUS_TEXT = { idle: "Boşta", thinking: "Düşünüyor", tool: "Araç kullanıyor", done: "Bitti", error: "Hata" };
const EFFORTS = [["low", "Düşük"], ["medium", "Orta"], ["high", "Yüksek"], ["xhigh", "Çok yüksek"], ["max", "En yüksek"]];
const PERMS = [
  ["plan", "Sadece okur", "Hiçbir dosyayı değiştirmez; okur, inceler ve plan önerir."],
  ["acceptEdits", "Düzenler", "Dosyaları düzenleyebilir. Terminal komutu çalıştırmak isterse reddedilir."],
  ["bypassPermissions", "Tam yetki", "Sormadan komut çalıştırır ve dosya siler. Yalnızca güvendiğin projelerde kullan."],
];
// Claude sohbetindeki seçici gibi: öne çıkanlar + "Daha fazla model"
const MODELS_MAIN = [
  ["claude-fable-5-1", "Fable 5.1", "Zor akıl yürütme ve uzun ajan işleri"],
  ["claude-opus-5-5", "Opus 5.5", "Uzun kodlama işleri için güçlü"],
  ["claude-sonnet-5-5", "Sonnet 5.5", "Hız ve zekânın dengesi"],
  ["claude-haiku-5-5", "Haiku 5.5", "En hızlısı, basit işler için"],
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
const portraitUrl = (i) => `url(/assets/chars/previews/${CHARACTERS[i % CHARACTERS.length]}.png)`;

// ================= durum =================
let meta = { mock: false };
let agents = [];
let selectedId = null;
let liveBubble = null, liveThink = null;
const lastTool = new Map(), runStart = new Map(), actText = new Map(), lastEventAt = new Map();
const current = () => agents.find((x) => x.id === selectedId);
const indexOf = (id) => agents.findIndex((x) => x.id === id);

const station = createStation($("#scene"), {
  onSelect: (id) => selectAgent(id),
  // iki odanın yerini değiştir
  onReorder: async (a, b) => {
    const ids = agents.map((x) => x.id), i = ids.indexOf(a), j = ids.indexOf(b);
    if (i < 0 || j < 0) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await api("/api/agents/reorder", { method: "POST", body: { ids } }); await refresh(); toast(`${agents.find((x) => x.id === a)?.name} ile ${agents.find((x) => x.id === b)?.name} yer değiştirdi`); }
    catch (err) { toast(err.message, "bad"); }
  },
  onHover: (id, x, y) => {
    const tip = $("#tooltip"); const a = agents.find((q) => q.id === id);
    if (!a) { tip.hidden = true; return; }
    const r = $("#stage").getBoundingClientRect();
    tip.hidden = false; tip.style.left = x - r.left + "px"; tip.style.top = y - r.top + "px";
    tip.textContent = `${a.name}: ${STATUS_TEXT[a.status] || "Boşta"}`;
  },
});
window.__station = station; // hata ayıklama için

$("#zoom-in").onclick = () => station.zoomIn();
$("#zoom-out").onclick = () => station.zoomOut();
$("#zoom-fit").onclick = () => station.fit();

// ================= veri =================
async function refresh() {
  agents = await api("/api/agents");
  station.setAgents(agents);
  station.select(selectedId);
  $("#empty-hint").hidden = agents.length > 0;
  renderList();
  if (selectedId) { const a = current(); if (!a) closePanel(); else { fillHeader(a); if ((a.activeConv || null) !== loadedConv) loadChat(); } }
}

function renderList() {
  const ul = $("#agent-list"); ul.innerHTML = "";
  agents.forEach((a, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<button type="button"><span class="portrait"></span><span><span class="li-name"></span><span class="li-meta"></span></span><span class="chip"><i class="dot"></i><span></span></span></button>`;
    li.querySelector(".portrait").style.backgroundImage = portraitUrl(a.char ?? i);
    li.querySelector(".li-name").textContent = a.name;
    li.querySelector(".li-meta").textContent = `${modelName(a.model)}, ${(EFFORTS.find(([k]) => k === a.effort) || [, a.effort])[1].toLowerCase()} efor`;
    li.querySelector(".chip .dot").className = "dot st-" + (a.status || "idle");
    li.querySelector(".chip span").textContent = STATUS_TEXT[a.status] || "Boşta";
    li.querySelector("button").onclick = () => { selectAgent(a.id); station.focus(a.id); };
    ul.append(li);
  });
}

// ================= panel =================
const EFFORT_DESC = {
  low: "Hızlı yanıt, kısa düşünür", medium: "Çoğu iş için dengeli", high: "Zor işlerde daha derin düşünür",
  xhigh: "Çok zor problemler; limiti hızlı harcar", max: "En derin düşünme; limiti en hızlı harcar",
};
const effortName = (k) => (EFFORTS.find(([x]) => x === k) || [, k])[1];
const permOf = (a) => a.permission || "acceptEdits";

function fillHeader(a) {
  if (!$("#a-name").isContentEditable) { $("#a-name").textContent = a.name; $("#a-name").title = a.name + " (adı değiştirmek için tıkla)"; }
  $("#a-path").textContent = shortPath(a.cwd); $("#a-path").title = a.cwd;
  $("#a-portrait").style.backgroundImage = portraitUrl(a.char ?? indexOf(a.id));
  $("#model-name").textContent = modelName(a.model);
  $("#effort-name").textContent = effortName(a.effort); $("#effort-btn").title = `Efor: ${effortName(a.effort)}. ${EFFORT_DESC[a.effort] || ""}`;
  const perm = PERMS.find(([k]) => k === permOf(a));
  $("#perm-name").textContent = perm[1];
  $("#perm-btn").classList.toggle("risky", perm[0] === "bypassPermissions");
  $("#perm-btn").title = perm[2];
  renderContext(a);
  setStatus(a.status || "idle", a.busy);
}

// bağlam halkası: bu konuşma modelin bağlam penceresinin ne kadarını doldurdu
function renderContext(a) {
  const c = a.context, el = $("#ctx");
  if (!c?.tokens || !c?.window) { el.hidden = true; return; }
  const pct = Math.min(1, c.tokens / c.window), L = 2 * Math.PI * 7.5;
  const arc = $("#ctx-arc"); arc.style.strokeDasharray = L; arc.style.strokeDashoffset = L * (1 - pct);
  el.hidden = false; el.className = "ctx" + (pct > 0.85 ? " full" : pct > 0.6 ? " warn" : "");
  $("#ctx-pct").textContent = `%${Math.round(pct * 100)}`;
  el.title = `Bağlam: ${c.tokens.toLocaleString("tr-TR")} / ${c.window.toLocaleString("tr-TR")} token. Dolunca "Yeni konuşma başlat" iyi olur.`;
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
  selectedId = id; station.select(id);
  const a = current(); if (!a) return;
  $("#panel-empty").hidden = true; $("#panel-agent").hidden = false;
  fillHeader(a);
  await loadChat();
}
let loadedConv = null;
let loadSeq = 0;
async function loadChat() {
  const a = current(); if (!a) return;
  const seq = ++loadSeq;
  // konuşma listesi sunucuda gerekirse oluşturulur; aktif konuşmayı buradan öğren
  const convs = await api(`/api/agents/${a.id}/convs`).catch(() => []);
  const active = convs.find((c) => c.active)?.id || a.activeConv || null;
  a.activeConv = active; loadedConv = active;
  const log = await api(`/api/agents/${a.id}/log${active ? "?conv=" + active : ""}`);
  if (seq !== loadSeq || a.id !== selectedId) return; // daha yeni bir yükleme başladı
  const chat = $("#chat"); chat.innerHTML = ""; liveBubble = liveThink = null; todoCard = null; renderQueue();
  for (const ev of log) renderEvent(ev, true);
  if (!log.length) chat.innerHTML = `<div class="chat-empty"><b>Yeni konuşma</b><span>${escHtml(a.name)} projesinde ne yapalım? Dosya eklemek için @ yaz, görsel için yapıştır.</span></div>`;
  chat.scrollTop = chat.scrollHeight; updateJump(); updateActivity();
}
function closePanel() {
  selectedId = null; station.select(null); closePops();
  $("#panel-agent").hidden = true; $("#panel-empty").hidden = false;
}

// ---- ortak açılır liste (model / efor / izin) — mesaj kutusunun üstünde açılır
function openPicker(btn, { main, more = [], current: cur, onPick, moreLabel = "Daha fazla model" }) {
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
  pop.style.top = ""; pop.style.bottom = innerHeight - r.top + 8 + "px";
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
      const ok = await confirmBox({ title: "Tam yetki verilsin mi?", body: "Bu ajan sormadan komut çalıştırabilir, dosya silebilir ve proje dışına yazabilir. Yalnızca güvendiğin projelerde aç.", ok: "Tam yetki ver", danger: true });
      if (!ok) return;
    }
    patch({ permission: v });
  } });
});
$("#menu-btn").onclick = toggle((btn) => { $("#menu-pop").hidden = false; btn.setAttribute("aria-expanded", "true"); });
document.addEventListener("click", (e) => { if (!e.target.closest(".pop")) closePops(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
  if ([...document.querySelectorAll(".pop")].some((p) => !p.hidden)) closePops(); else if (selectedId) closePanel();
});

// ---- sesle yazma (tarayıcının konuşma tanıması, Türkçe)
{
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $("#btn-mic"); let rec = null, base = "";
  if (!SR) btn.title = "Bu tarayıcı sesle yazmayı desteklemiyor (Chrome ya da Edge kullan)";
  btn.onclick = () => {
    if (!SR) { toast("Sesle yazma için Chrome ya da Edge gerekli", "bad"); return; }
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = "tr-TR"; rec.interimResults = true; rec.continuous = true;
    base = $("#prompt").value ? $("#prompt").value.replace(/\s*$/, " ") : "";
    rec.onresult = (e) => {
      let finalTxt = "", interim = "";
      for (const r of e.results) (r.isFinal ? (finalTxt += r[0].transcript) : (interim += r[0].transcript));
      $("#prompt").value = base + finalTxt + interim;
      $("#prompt").dispatchEvent(new Event("input"));
    };
    rec.onerror = (e) => { if (e.error === "not-allowed") toast("Mikrofon izni verilmedi", "bad"); else if (e.error !== "aborted" && e.error !== "no-speech") toast("Ses tanıma hatası: " + e.error, "bad"); };
    rec.onend = () => { rec = null; btn.setAttribute("aria-pressed", "false"); btn.title = "Sesle yaz"; $("#prompt").focus(); };
    rec.start(); btn.setAttribute("aria-pressed", "true"); btn.title = "Dinliyorum; bitirmek için tekrar bas";
  };
}

// ---- kullanım limitleri (Claude Code'un bildirdiği)
let usage = {};
const USAGE_NAMES = { five_hour: "5 saatlik limit", seven_day: "Haftalık limit", seven_day_opus: "Haftalık Opus limiti", overage: "Ek kullanım" };
const resetMs = (t) => (t ? (t < 1e12 ? t * 1000 : t) : null);
function fmtReset(t) {
  const ms = resetMs(t); if (!ms) return "";
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? `bugün ${time}` : d.toLocaleDateString("tr-TR", { weekday: "long" }) + " " + time;
}
const barCls = (u) => (u >= 0.9 ? "full" : u >= 0.7 ? "warn" : "");
function renderUsage() {
  const btn = $("#usage-btn");
  const rows = Object.entries(usage).filter(([, v]) => typeof v.utilization === "number");
  btn.hidden = !rows.length; if (!rows.length) return;
  const show = rows.filter(([k]) => k === "five_hour" || k === "seven_day");
  btn.innerHTML = (show.length ? show : rows).map(([k, v]) => `<span class="u-mini">${k === "five_hour" ? "5 sa" : k === "seven_day" ? "Hafta" : escHtml(k)}<span class="u-bar ${barCls(v.utilization)}"><i style="width:${Math.round(v.utilization * 100)}%"></i></span>%${Math.round(v.utilization * 100)}</span>`).join("");
}
function openUsage(btn) {
  const pop = $("#usage-pop");
  const rows = Object.entries(usage).filter(([, v]) => typeof v.utilization === "number");
  pop.innerHTML = `<h4>Kullanım</h4>` + rows.map(([k, v]) => `<div class="u-row"><div class="u-head"><span>${escHtml(USAGE_NAMES[k] || k)}</span><span>%${Math.round(v.utilization * 100)}</span></div>
    <span class="u-bar ${barCls(v.utilization)}"><i style="width:${Math.round(v.utilization * 100)}%"></i></span>
    <small>${v.resetsAt ? "Sıfırlanma: " + fmtReset(v.resetsAt) : ""}${v.status === "rejected" ? " · limit doldu" : ""}</small></div>`).join("") +
    `<p>Claude Code her yanıtta bildirir; son güncelleme ${new Date(Math.max(...rows.map(([, v]) => v.seenAt || 0))).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}.</p>`;
  pop.hidden = false;
  const r = btn.getBoundingClientRect();
  pop.style.top = r.bottom + 8 + "px"; pop.style.bottom = ""; pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + "px";
  btn.setAttribute("aria-expanded", "true");
}
$("#usage-btn").onclick = toggle(openUsage);

// ================= görseller =================
const IMG_RE = /(?:[A-Za-z]:[\\/]|\/)[^\s`"'<>|*?]+?\.(?:png|jpe?g|gif|webp|bmp)\b/gi;
const isImagePath = (p) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(p || "").trim());
const findImagePaths = (t) => {
  const seen = new Map(); // aynı dosyanın farklı yazımları (file:///C:/x, C:\x) tek sayılsın
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
    img.onerror = () => { b.className = "broken"; b.textContent = `Görsel açılamadı: ${baseName(p)}`; };
    b.append(img); b.onclick = () => { if (!b.classList.contains("broken")) openLightbox(img.src, p); };
    g.append(b);
  }
  return g;
}
function openLightbox(src, cap) { $("#lb-img").src = src; $("#lb-cap").textContent = cap; $("#dlg-img").showModal(); }
$("#dlg-img").addEventListener("click", (e) => { if (e.target.id === "dlg-img") $("#dlg-img").close(); });

// ---- eklenecek görseller (yapıştır / sürükle / ataç)
let pending = []; // { name, dataUrl }
function renderAttachments() {
  const box = $("#attach-list"); box.innerHTML = ""; box.hidden = !pending.length;
  pending.forEach((a, i) => {
    const d = document.createElement("div"); d.className = "att";
    d.innerHTML = `<img alt=""><button type="button" aria-label="Kaldır"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>`;
    d.querySelector("img").src = a.dataUrl; d.querySelector("img").alt = a.name;
    d.querySelector("button").onclick = () => { pending.splice(i, 1); renderAttachments(); };
    box.append(d);
  });
}
async function addFiles(files) {
  for (const f of files) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { toast(`${f.name || "Dosya"} görsel değil; png, jpg, gif ya da webp ekleyebilirsin`, "bad"); continue; }
    if (f.size > 20 * 1024 * 1024) { toast(`${f.name} 20 MB'tan büyük`, "bad"); continue; }
    if (pending.length >= 10) { toast("En fazla 10 görsel eklenebilir", "bad"); break; }
    const dataUrl = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
    pending.push({ name: f.name || "yapistirilan.png", dataUrl });
  }
  renderAttachments(); $("#prompt").focus();
}
$("#btn-attach").onclick = () => $("#file-input").click();
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

// ================= sohbet =================
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
  d.innerHTML = `<summary>${open ? "Düşünüyor…" : "Düşünce"}</summary><div class="tbody"></div>`;
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
const copyText = (t) => navigator.clipboard.writeText(t).then(() => toast("Kopyalandı"), () => toast("Kopyalanamadı", "bad"));

// ---- araç satırı + ayrıntı
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
  const d = addMsg("tool", `<div class="trow"><b></b><span></span><button type="button" class="topen" hidden title="Klasöründe göster">${ICON.folder}</button><em class="st">…</em></div><div class="tdetail" hidden></div>`);
  d.dataset.id = ev.toolUseId; d.dataset.name = ev.name;
  d.querySelector("b").textContent = ev.name;
  const sp = d.querySelector("span"); sp.textContent = relToAgent(ev.summary); sp.title = ev.summary || "";
  const det = d.querySelector(".tdetail"); det.innerHTML = toolDetail(ev.name, ev.input);
  if (isImagePath(ev.summary)) d.dataset.img = ev.summary;
  if (FILE_TOOLS.has(ev.name) && ev.summary) { const o = d.querySelector(".topen"); o.hidden = false; o.onclick = (e) => { e.stopPropagation(); openInFolder(ev.summary); }; }
  d.querySelector(".trow").onclick = () => { if (det.innerHTML.trim()) { det.hidden = !det.hidden; d.classList.toggle("open", !det.hidden); } };
  if (det.innerHTML.trim()) d.classList.add("expandable");
  return d;
}

// ---- görev listesi (TodoWrite): her turda tek kart, yerinde güncellenir
let todoCard = null;
function renderTodos(todos) {
  if (!todoCard || !todoCard.isConnected) { todoCard = addMsg("todo", ""); }
  const done = todos.filter((t) => t.status === "completed").length;
  todoCard.innerHTML = `<div class="todo-head"><b>Görevler</b><span>${done}/${todos.length}</span></div><ul>${todos.map((t) =>
    `<li class="${t.status}"><i></i><span>${escHtml(t.status === "in_progress" && t.activeForm ? t.activeForm : t.content)}</span></li>`).join("")}</ul>`;
  chatEl().append(todoCard); // her güncellemede sona taşı
}

// ---- plan onayı (ExitPlanMode)
function planCard(plan) {
  const d = addMsg("plan", `<div class="card-head">Plan hazır</div><div class="plan-body"></div><div class="card-actions"><button type="button" class="btn primary sm" data-act="approve">Planı onayla ve uygula</button><button type="button" class="btn ghost sm" data-act="revise">Değişiklik iste</button></div>`);
  d.querySelector(".plan-body").innerHTML = md(plan || "");
  d.querySelector('[data-act="approve"]').onclick = async () => {
    const a = current(); if (!a) return;
    if (permOf(a) === "plan") await patch({ permission: "acceptEdits" });
    sendPrompt({ text: "Planı onaylıyorum, uygula." });
    d.querySelector(".card-actions").innerHTML = `<span class="muted-ok">Onaylandı</span>`;
  };
  d.querySelector('[data-act="revise"]').onclick = () => { $("#prompt").value = "Planda şunu değiştir: "; $("#prompt").focus(); };
}

// ---- izin kartı (çalıştırılamayan araçlar)
function denialCard(denials) {
  const specs = [...new Set(denials.map((x) => x.spec).filter(Boolean))];
  if (!specs.length) return;
  const d = addMsg("perm", `<div class="card-head">İzin gerekiyor</div><p>Ajan şunları yapmak istedi ama izni yoktu:</p><ul></ul><div class="card-actions"><button type="button" class="btn primary sm" data-act="once">Bir kez izin ver, devam et</button><button type="button" class="btn ghost sm" data-act="always">Her zaman izin ver</button></div>`);
  const ul = d.querySelector("ul");
  for (const x of denials) { const li = document.createElement("li"); li.innerHTML = `<b></b> <code></code>`; li.querySelector("b").textContent = x.tool; li.querySelector("code").textContent = x.input?.command || x.input?.file_path || x.spec; ul.append(li); }
  const done = (msg) => { d.querySelector(".card-actions").innerHTML = `<span class="muted-ok">${msg}</span>`; };
  d.querySelector('[data-act="once"]').onclick = () => { sendPrompt({ text: "İzin verdim, kaldığın yerden devam et.", allowOnce: specs }); done("Bu sefer izin verildi"); };
  d.querySelector('[data-act="always"]').onclick = async () => {
    const a = current(); if (!a) return;
    await patch({ allowedTools: [...(a.allowedTools || []), ...specs] });
    sendPrompt({ text: "İzin verdim, kaldığın yerden devam et." }); done("Her zaman izinli");
  };
}

function renderEvent(ev, replay = false) {
  if (!replay) stick = nearBottom();
  switch (ev.type) {
    case "user": {
      liveThink = liveBubble = null; todoCard = null;
      const d = addMsg("user", "", ev.text);
      if (ev.images?.length) d.append(gallery(ev.images));
      actions(d, [["edit", "Düzenle", () => { $("#prompt").value = ev.text; $("#prompt").dispatchEvent(new Event("input")); $("#prompt").focus(); }],
                  ["redo", "Tekrar gönder", () => sendPrompt({ text: ev.text, images: ev.images || [] })],
                  ["copy", "Kopyala", () => copyText(ev.text)]]);
      break;
    }
    case "thinking_delta":
      if (replay) break;
      if (!liveThink) liveThink = thinkBox(true);
      liveThink.querySelector(".tbody").textContent += ev.text; break;
    case "thinking": {
      const d = liveThink || thinkBox(false);
      d.querySelector(".tbody").textContent = ev.text; d.open = false; d.querySelector("summary").textContent = "Düşünce";
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
      actions(d, [["copy", "Kopyala", () => copyText(ev.text)]]);
      break;
    }
    case "tool_use": {
      liveBubble = null;
      if (ev.name === "TodoWrite" && ev.input?.todos) { renderTodos(ev.input.todos); break; }
      if (ev.name === "ExitPlanMode" && ev.input?.plan) { planCard(ev.input.plan); break; }
      toolRow(ev);
      break;
    }
    case "tool_result": {
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
      if (ev.durationMs) bits.push(`${(ev.durationMs / 1000).toFixed(1)} sn`);
      if (ev.numTurns) bits.push(`${ev.numTurns} tur`);
      addMsg("result" + (ev.isError ? " bad" : ""), "", (ev.isError ? "Hata: " + (ev.text || ev.subtype) : "Tamamlandı") + (bits.length ? ", " + bits.join(", ") : ""));
      todoCard = null;
      break;
    }
  }
  if (!replay && stick) chatEl().scrollTop = chatEl().scrollHeight;
  updateJump();
}

// sohbet içi tıklamalar: kod kopyala, yerel bağlantı aç
chatEl().addEventListener("click", (e) => {
  const cp = e.target.closest(".code .copy");
  if (cp) { copyText(cp.closest(".code").querySelector("code").textContent); return; }
  const a = e.target.closest("a[data-open]");
  if (a) { e.preventDefault(); openInFolder(a.dataset.open); }
});
// en alta in düğmesi
function updateJump() { $("#jump").hidden = nearBottom(); }
chatEl().addEventListener("scroll", updateJump);
$("#jump").onclick = () => { chatEl().scrollTo({ top: chatEl().scrollHeight, behavior: "smooth" }); };

async function openInFolder(p) {
  if (!selectedId) return;
  try { await api(`/api/agents/${selectedId}/open`, { method: "POST", body: p ? { path: p } : {} }); toast(p ? `${baseName(p)} klasöründe açıldı` : "Proje klasörü açıldı"); }
  catch (err) { toast(err.message, "bad"); }
}
$("#btn-folder").onclick = () => { closePops(); openInFolder(); };

// ---- canlı şerit
function updateActivity() {
  const strip = $("#activity"), a = current();
  const busy = !!a && (a.status === "thinking" || a.status === "tool");
  strip.hidden = !busy; if (!busy) return;
  const now = Date.now(), secs = Math.floor((now - (runStart.get(a.id) || now)) / 1000);
  const quiet = Math.floor((now - (lastEventAt.get(a.id) || now)) / 1000);
  let txt = actText.get(a.id) || "Çalışıyor…";
  if (quiet >= 10) txt += `, ${quiet} sn'dir sessiz (hâlâ çalışıyor)`;
  $("#act-text").textContent = txt;
  $("#act-time").textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
setInterval(updateActivity, 1000);

// ================= WebSocket =================
let wsWasClosed = false;
function connectWS() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => { if (wsWasClosed) location.reload(); };
  ws.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === "reload") { location.reload(); return; }
    if (ev.type === "agents_changed") { refresh(); return; }
    if (ev.type === "usage") { usage = ev.usage || {}; renderUsage(); return; }
    if (ev.agentId) {
      lastEventAt.set(ev.agentId, Date.now());
      if (ev.type === "user") { runStart.set(ev.agentId, Date.now()); actText.set(ev.agentId, "Başlatılıyor…"); }
      else if (ev.type === "thinking_delta") actText.set(ev.agentId, "Düşünüyor…");
      else if (ev.type === "text_delta") actText.set(ev.agentId, "Yanıt yazıyor…");
      else if (ev.type === "tool_result") actText.set(ev.agentId, "Sonucu değerlendiriyor…");
      else if (ev.type === "tool_use") {
        const doing = ev.name === "TodoWrite" ? (ev.input?.todos || []).find((t) => t.status === "in_progress") : null;
        lastTool.set(ev.agentId, doing ? (doing.activeForm || doing.content) : `${ev.name} ${baseName(ev.summary)}`.trim());
      }
    }
    if (ev.type === "status") {
      station.setStatus(ev.agentId, ev.status);
      station.setActivity(ev.agentId, ev.status === "thinking" ? "düşünüyor…" : ev.status === "tool" ? (lastTool.get(ev.agentId) || ev.tool || "çalışıyor") : "");
      const a = agents.find((x) => x.id === ev.agentId);
      if (a) { a.status = ev.status; renderList(); }
      if (ev.status === "tool") actText.set(ev.agentId, "Araç çalışıyor: " + (lastTool.get(ev.agentId) || ev.tool || ""));
      else if (ev.status === "thinking" && !["Yanıt yazıyor…", "Düşünüyor…", "Başlatılıyor…"].includes(actText.get(ev.agentId))) actText.set(ev.agentId, "Düşünüyor…");
      else if (ev.status === "done" || ev.status === "error") { runStart.delete(ev.agentId); actText.delete(ev.agentId); flushQueue(ev.agentId); }
      if (ev.agentId === selectedId) setStatus(ev.status);
      updateActivity();
      return;
    }
    if (ev.agentId && ev.agentId === selectedId && (!ev.convId || !loadedConv || ev.convId === loadedConv)) {
      if (ev.type === "user") $("#chat .chat-empty")?.remove();
      renderEvent(ev);
    }
  };
  ws.onclose = () => { wsWasClosed = true; setTimeout(connectWS, 1500); };
}

// ================= mesaj gönderme =================
const queue = new Map(); // ajan -> [{ text, images, allowOnce, el }]
const isBusy = (a) => a && (a.status === "thinking" || a.status === "tool");
async function sendPrompt({ text = "", images = [], allowOnce = [] }, agent = current()) {
  const a = agent; if (!a) return;
  if (isBusy(a)) { // VS Code gibi: meşgulken sıraya al
    const q = queue.get(a.id) || []; const item = { text, images, allowOnce };
    q.push(item); queue.set(a.id, q);
    if (a.id === selectedId) renderQueue();
    toast("Sıraya alındı; ajan bitirince gönderilecek"); return;
  }
  a.status = "thinking"; runStart.set(a.id, Date.now()); lastEventAt.set(a.id, Date.now()); actText.set(a.id, "Başlatılıyor…");
  if (a.id === selectedId) { setStatus("thinking"); updateActivity(); }
  try { await api(`/api/agents/${a.id}/prompt`, { method: "POST", body: { text, images, allowOnce } }); }
  catch (err) { toast(err.message, "bad"); a.status = "idle"; if (a.id === selectedId) { setStatus("idle"); updateActivity(); } }
}
function renderQueue() {
  const box = $("#queue"); const q = queue.get(selectedId) || [];
  box.hidden = !q.length; box.innerHTML = "";
  q.forEach((it, i) => {
    const r = document.createElement("div"); r.className = "q-item";
    r.innerHTML = `<span class="q-badge">Sırada</span><span class="q-text"></span><button type="button" title="Sıradan çıkar" aria-label="Sıradan çıkar"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>`;
    r.querySelector(".q-text").textContent = it.text || `${it.images.length} görsel`;
    r.querySelector("button").onclick = () => { q.splice(i, 1); renderQueue(); };
    box.append(r);
  });
}
function flushQueue(agentId) {
  const q = queue.get(agentId); if (!q?.length) return;
  const a = agents.find((x) => x.id === agentId); if (!a || isBusy(a)) return;
  const next = q.shift(); if (agentId === selectedId) renderQueue();
  setTimeout(() => sendPrompt(next, a), 400);
}

$("#prompt-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#prompt").value.trim(); const a = current();
  if ((!text && !pending.length) || !a) return;
  const toSend = pending; pending = []; renderAttachments();
  $("#prompt").value = ""; $("#prompt").style.height = ""; closeMention();
  try {
    const images = [];
    for (const f of toSend) images.push((await api(`/api/agents/${a.id}/upload`, { method: "POST", body: { name: f.name, dataUrl: f.dataUrl } })).path);
    await sendPrompt({ text, images }, a);
  } catch (err) {
    toast(err.message, "bad");
    if (!$("#prompt").value) { $("#prompt").value = text; pending = toSend; renderAttachments(); }
  }
});

// ---- @dosya önerisi
let mention = null; // { start, items, idx }
function closeMention() { mention = null; $("#mention-pop").hidden = true; }
async function updateMention() {
  const ta = $("#prompt"), a = current(); if (!a) return;
  const upto = ta.value.slice(0, ta.selectionStart);
  const m = /(^|\s)@([^\s@]*)$/.exec(upto);
  if (!m) { closeMention(); return; }
  const q = m[2], start = ta.selectionStart - q.length - 1;
  const items = await api(`/api/agents/${a.id}/files?q=${encodeURIComponent(q)}`).catch(() => []);
  if (!items.length) { closeMention(); return; }
  mention = { start, items, idx: 0 }; drawMention();
}
function drawMention() {
  const pop = $("#mention-pop");
  pop.innerHTML = mention.items.map((f, i) => `<button type="button" class="mn-item${i === mention.idx ? " on" : ""}" data-i="${i}"><b>${escHtml(baseName(f))}</b><span>${escHtml(f)}</span></button>`).join("");
  pop.querySelectorAll(".mn-item").forEach((b) => b.onmousedown = (e) => { e.preventDefault(); pickMention(+b.dataset.i); });
  const r = $(".composer").getBoundingClientRect();
  pop.hidden = false; pop.style.left = r.left + "px"; pop.style.width = r.width + "px"; pop.style.bottom = innerHeight - r.top + 8 + "px";
  pop.querySelector(".on")?.scrollIntoView({ block: "nearest" });
}
function pickMention(i) {
  const ta = $("#prompt"), f = mention.items[i];
  ta.value = ta.value.slice(0, mention.start) + "@" + f + " " + ta.value.slice(ta.selectionStart);
  const pos = mention.start + f.length + 2; ta.setSelectionRange(pos, pos); closeMention(); ta.focus();
}

$("#prompt").addEventListener("keydown", (e) => {
  if (mention && !$("#mention-pop").hidden) {
    if (e.key === "ArrowDown") { e.preventDefault(); mention.idx = (mention.idx + 1) % mention.items.length; drawMention(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); mention.idx = (mention.idx - 1 + mention.items.length) % mention.items.length; drawMention(); return; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mention.idx); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMention(); return; }
  }
  if (e.key === "ArrowUp" && !e.target.value) { // son mesajı geri çağır
    const last = [...document.querySelectorAll("#chat .msg.user")].pop();
    if (last) { e.preventDefault(); e.target.value = last.firstChild?.textContent || ""; e.target.dispatchEvent(new Event("input")); }
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#prompt-form").requestSubmit(); }
});
$("#prompt").addEventListener("input", (e) => { const t = e.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 200) + "px"; updateMention(); });
$("#prompt").addEventListener("blur", () => setTimeout(closeMention, 150));

// ---- ajan adını değiştir (başlığa tıkla)
{
  const h = $("#a-name");
  h.title = "Adı değiştirmek için tıkla"; h.tabIndex = 0;
  const start = () => { if (h.isContentEditable) return; h.dataset.old = h.textContent; h.contentEditable = "true"; h.focus(); document.getSelection().selectAllChildren(h); };
  const finish = async (save) => {
    if (!h.isContentEditable) return;
    h.contentEditable = "false";
    const v = h.textContent.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!save || !v || v === h.dataset.old) { h.textContent = h.dataset.old; return; }
    await patch({ name: v }); toast("Ad değişti: " + v);
  };
  h.addEventListener("click", start);
  h.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } });
  h.addEventListener("blur", () => finish(true));
}
$("#btn-stop").onclick = () => api(`/api/agents/${selectedId}/stop`, { method: "POST" }).then(() => toast("Durduruldu")).catch((err) => toast(err.message, "bad"));
$("#btn-close").onclick = closePanel;

// ---- konuşmalar (VS Code gibi: yeni + geçmiş)
async function newConversation() {
  closePops(); const a = current(); if (!a) return;
  try { await api(`/api/agents/${a.id}/convs`, { method: "POST" }); await refresh(); $("#prompt").focus(); }
  catch (err) { toast(err.message, "bad"); }
}
$("#btn-new").onclick = newConversation;
const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "az önce"; if (s < 3600) return `${Math.floor(s / 60)} dk önce`; if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} gün önce`;
  return new Date(t).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
};
async function openHistory(btn) {
  const a = current(); if (!a) return;
  const pop = $("#history-pop");
  const convs = await api(`/api/agents/${a.id}/convs`).catch(() => []);
  pop.innerHTML = `<div class="h-head"><b>Geçmiş konuşmalar</b><button type="button" class="btn primary sm" id="h-new">Yeni konuşma</button></div>` +
    (convs.length ? convs.map((c) => `<div class="h-item${c.active ? " on" : ""}" data-id="${c.id}" role="menuitem" tabindex="0"><span class="h-title"></span><span class="h-time">${ago(c.updatedAt)}</span><button type="button" class="h-del" title="Sil" aria-label="Sil"><svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5"/></svg></button></div>`).join("") : `<p class="h-empty">Henüz konuşma yok.</p>`);
  pop.querySelectorAll(".h-item").forEach((el, k) => {
    el.querySelector(".h-title").textContent = convs[k].title || "Adsız konuşma";
    const go = async () => {
      closePops(); if (convs[k].active) return;
      try { await api(`/api/agents/${a.id}/convs/${convs[k].id}/activate`, { method: "POST" }); await refresh(); }
      catch (err) { toast(err.message, "bad"); }
    };
    el.onclick = go; el.onkeydown = (e) => { if (e.key === "Enter") go(); };
    el.querySelector(".h-del").onclick = async (e) => {
      e.stopPropagation();
      const ok = await confirmBox({ title: "Konuşma silinsin mi?", body: `"${convs[k].title || "Adsız konuşma"}" ekrandan ve kayıtlardan silinir. Proje dosyalarına dokunulmaz.`, ok: "Sil", danger: true });
      if (!ok) return;
      try { await api(`/api/agents/${a.id}/convs/${convs[k].id}`, { method: "DELETE" }); await refresh(); if (convs[k].active) loadChat(); toast("Konuşma silindi"); }
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
$("#btn-remove").onclick = async () => {
  closePops();
  const a = current();
  const ok = await confirmBox({ title: `${a.name} istasyondan çıkarılsın mı?`, body: "Modül ve ajan kaldırılır. Proje klasörün silinmez; istediğin zaman tekrar ekleyebilirsin.", ok: "Ajanı çıkar", danger: true });
  if (!ok) return;
  await api(`/api/agents/${selectedId}`, { method: "DELETE" });
  closePanel(); await refresh(); toast(`${a.name} çıkarıldı`);
};

// ================= proje ekle =================
function resetPick() {
  $("#pick-folder").classList.remove("chosen", "busy");
  $("#pick-title").textContent = "Bilgisayardan klasör seç";
  $("#pick-sub").textContent = "Gezgin penceresi açılır; hızlı erişimden seçebilirsin";
}
const openAdd = () => {
  $("#add-err").textContent = ""; $("#add-cwd").value = ""; $("#add-name").value = ""; resetPick();
  $("#dlg-add").showModal();
};
$("#btn-add").onclick = openAdd;
document.querySelector('[data-action="add"]').onclick = openAdd;
$("#pick-folder").onclick = async () => {
  const btn = $("#pick-folder"); if (btn.classList.contains("busy")) return;
  btn.classList.add("busy"); $("#pick-sub").textContent = "Pencere açıldı; klasörü seçip Tamam'a bas";
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
  const v = e.target.value.trim();
  if (v) { $("#pick-folder").classList.add("chosen"); $("#pick-title").textContent = baseName(v); $("#pick-sub").textContent = v; } else resetPick();
});
$("#add-form").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const cwd = $("#add-cwd").value.trim();
  if (!cwd) { $("#add-err").textContent = "Önce bir klasör seç."; return; }
  try {
    const a = await api("/api/agents", { method: "POST", body: { cwd, name: $("#add-name").value.trim() || undefined } });
    $("#dlg-add").close();
    await refresh(); selectAgent(a.id); toast(`${a.name} istasyona katıldı`);
  } catch (err) { $("#add-err").textContent = err.message; }
});

// ================= panel genişliği (sürükle) =================
{
  const app = $("#app"), handle = $("#resizer");
  const MIN = 360, max = () => Math.max(MIN, Math.min(1100, innerWidth - 420));
  const apply = (w) => { w = Math.round(Math.max(MIN, Math.min(max(), w))); app.style.setProperty("--panel-w", w + "px"); return w; };
  try { const saved = +localStorage.getItem("panelW"); if (saved) apply(saved); } catch {}
  const save = (w) => { try { localStorage.setItem("panelW", String(w)); } catch {} };
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId); document.body.classList.add("resizing");
    const move = (ev) => apply(innerWidth - ev.clientX);
    const up = (ev) => { handle.removeEventListener("pointermove", move); document.body.classList.remove("resizing"); save(apply(innerWidth - ev.clientX)); };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up, { once: true });
  });
  handle.addEventListener("dblclick", () => save(apply(480)));
  handle.addEventListener("keydown", (e) => {
    const cur = $("#panel").getBoundingClientRect().width;
    if (e.key === "ArrowLeft") save(apply(cur + 24)); else if (e.key === "ArrowRight") save(apply(cur - 24));
  });
}

// ================= herkese gönder =================
$("#btn-broadcast").onclick = () => {
  if (!agents.length) { toast("Önce bir proje ekle", "bad"); return; }
  const box = $("#bc-agents"); box.innerHTML = "";
  agents.forEach((a, i) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="checkbox" checked value="${a.id}"><span class="portrait"></span><span></span>`;
    l.querySelector(".portrait").style.backgroundImage = portraitUrl(a.char ?? i);
    l.querySelector("span:last-child").textContent = a.name; box.append(l);
  });
  $("#dlg-bc").showModal();
};
$("#bc-form").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const ids = [...document.querySelectorAll("#bc-agents input:checked")].map((i) => i.value);
  const text = $("#bc-text").value.trim();
  if (!ids.length || !text) { toast("Ajan seç ve bir mesaj yaz", "bad"); return; }
  $("#dlg-bc").close(); $("#bc-text").value = "";
  api("/api/broadcast", { method: "POST", body: { ids, text } }).then(() => toast(`${ids.length} ajana sırayla gönderiliyor`)).catch((err) => toast(err.message, "bad"));
});

// ================= açılış =================
meta = await api("/api/meta");
usage = await api("/api/usage").catch(() => ({})); renderUsage();
$("#mode-badge").textContent = meta.mock ? "Deneme modu" : "";
await refresh();
connectWS();
const q = new URLSearchParams(location.search).get("agent");
if (q) { const a = agents.find((x) => x.name === q || x.id === q); if (a) selectAgent(a.id); }
