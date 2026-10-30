// Server-side strings (agent prompts, tool results, API errors). Same scheme as public/i18n.js:
// English source text wrapped in t("…"), translations in public/i18n/<lang>.json (one file per
// language, shared with the browser). The language comes from data/prefs.json ("lang").
import fs from "node:fs";
import path from "node:path";
import { dataPath, PUBLIC } from "./paths.js";

export const LANGS = ["en", "tr"];
let lang = "en", dict = {};

export function setLang(l) {
  lang = LANGS.includes(l) ? l : "en";
  dict = {};
  if (lang !== "en") {
    try { dict = JSON.parse(fs.readFileSync(path.join(PUBLIC, "i18n", `${lang}.json`), "utf8")); }
    catch (e) { console.error(`[ecelon] i18n: ${lang}.json could not be read:`, e.message); }
  }
}
export const getLang = () => lang;
export const getDict = () => dict;
/** BCP-47 tag for toLocale*() calls. */
export const locale = () => (lang === "tr" ? "tr-TR" : "en-US");
/** Name of the language for prompts ("Turkish"), so agents answer the user in their language. */
export const langName = () => ({ en: "English", tr: "Turkish" })[lang] || "English";

// Pick the language as early as possible (this module is evaluated before anything that imports it),
// so role labels and prompt constants built at import time are already in the right language.
try { setLang(JSON.parse(fs.readFileSync(dataPath("prefs.json"), "utf8")).lang || process.env.ECELON_LANG || "en"); }
catch { setLang(process.env.ECELON_LANG || "en"); }

export function t(s, p) {
  let r = Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s;
  if (p) r = r.replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (m, k, one, many) => (k in p ? (Number(p[k]) === 1 ? one : many) : m)) // {n|file|files}
    .replace(/\{(\w+)\}/g, (m, k) => (k in p ? String(p[k]) : m));
  return r;
}
