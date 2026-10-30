// UI language. English is the source language: every user-facing string in the code is written in
// English and wrapped in t("…"); other languages map that English text to a translation in
// public/i18n/<lang>.json. A missing entry falls back to the English text, so the UI never breaks.
// The dictionary is loaded here with a top-level await, so modules that import t() can use it at
// module-evaluation time (constants, labels) — no flash of untranslated text.
let lang = "en", dict = {};
try {
  const r = await fetch("/api/i18n").then((x) => x.json());
  lang = r.lang || "en"; dict = r.dict || {};
} catch { /* server unreachable: English */ }
document.documentElement.lang = lang;

/** t("Delete {name}?", { name }) → translated text with {placeholders} filled in. */
export function t(s, p) {
  let r = Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s;
  if (p) r = r.replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (m, k, one, many) => (k in p ? (Number(p[k]) === 1 ? one : many) : m)) // {n|file|files}
    .replace(/\{(\w+)\}/g, (m, k) => (k in p ? String(p[k]) : m));
  return r;
}
export const LANGS = { en: "English", tr: "Türkçe" };
export const currentLang = () => lang;
/** BCP-47 tag for toLocale*() calls (dates, sorting, case folding). */
export const locale = () => (lang === "tr" ? "tr-TR" : "en-US");

/** Translate static markup: <el data-i18n>Text</el>, <el data-i18n-attr="title,placeholder">. */
export function applyDom(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    const key = el.dataset.i18n || el.textContent.trim();
    if (key) el.textContent = t(key);
  }
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    for (const a of el.dataset.i18nAttr.split(",").map((x) => x.trim()).filter(Boolean)) {
      const v = el.getAttribute(a); if (v) el.setAttribute(a, t(v));
    }
  }
}
applyDom(document);
document.documentElement.removeAttribute("data-i18n-pending");
