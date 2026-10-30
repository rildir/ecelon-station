#!/usr/bin/env node
// i18n consistency check:
//  1. every t("…") key in the code has an entry in public/i18n/<lang>.json (default: tr)
//  2. no string literal in the code still contains Turkish letters (source language is English)
//  3. dictionary entries that no code uses (stale) are listed
// Usage: node scripts/i18n-check.mjs [--lang tr] [--strict]   (--strict exits 1 on any problem)
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const lang = args.includes("--lang") ? args[args.indexOf("--lang") + 1] : "tr";
const strict = args.includes("--strict");
const files = [].concat(
  ...fs.readdirSync("public").filter((f) => /\.(js|html)$/.test(f)).map((f) => path.join("public", f)),
  ...fs.readdirSync("server").filter((f) => f.endsWith(".js")).map((f) => path.join("server", f)),
).filter((f) => !/i18n\.js$/.test(f));
const dict = JSON.parse(fs.readFileSync(path.join("public", "i18n", `${lang}.json`), "utf8"));
const keys = new Map(); // key -> [file]
const TR = /[çğıöşüÇĞİÖŞÜ]/;
const leftovers = [];

const unq = (s) => s.replace(/\\(["'\\])/g, "$1");
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  // t("…") / t('…') — keys must be plain string literals
  for (const m of src.matchAll(/\bt\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g)) {
    const k = unq(m[1] ?? m[2]); if (!keys.has(k)) keys.set(k, []); keys.get(k).push(f);
  }
  if (f.endsWith(".html")) {
    for (const m of src.matchAll(/data-i18n(?!-attr)(?:="([^"]*)")?[^>]*>([^<]*)</g)) { const k = (m[1] || m[2]).trim(); if (k) { if (!keys.has(k)) keys.set(k, []); keys.get(k).push(f); } }
    for (const m of src.matchAll(/<[^>]*data-i18n-attr="([^"]*)"[^>]*>/g)) {
      for (const a of m[1].split(",").map((x) => x.trim())) { const v = new RegExp(`\\s${a}="([^"]*)"`).exec(m[0]); if (v?.[1]) { if (!keys.has(v[1])) keys.set(v[1], []); keys.get(v[1]).push(f); } }
    }
  }
  // leftover Turkish text in literals (line-based, skips comments)
  src.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (!TR.test(code)) return;
    for (const m of code.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
      const lit = m[1] ?? m[2] ?? m[3]; if (TR.test(lit) && !/toLocale|"tr"|'tr'/.test(m[0])) leftovers.push(`${f}:${i + 1}: ${lit.slice(0, 80)}`);
    }
    if (f.endsWith(".html") && TR.test(code.replace(/<[^>]*>/g, "")) && !/data-i18n/.test(code)) leftovers.push(`${f}:${i + 1}: ${code.trim().slice(0, 80)}`);
  });
}
const missing = [...keys.keys()].filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
const stale = Object.keys(dict).filter((k) => !keys.has(k));
console.log(`${keys.size} keys in code · ${Object.keys(dict).length} entries in ${lang}.json`);
if (missing.length) { console.log(`\nMISSING in ${lang}.json (${missing.length}):`); for (const k of missing) console.log(`  ${JSON.stringify(k)}  ← ${[...new Set(keys.get(k))].join(", ")}`); }
if (leftovers.length) { console.log(`\nLEFTOVER Turkish text in code (${leftovers.length}):`); for (const l of leftovers.slice(0, 200)) console.log("  " + l); if (leftovers.length > 200) console.log(`  … +${leftovers.length - 200}`); }
if (stale.length) { console.log(`\nSTALE entries (not used by code) (${stale.length}):`); for (const k of stale.slice(0, 50)) console.log("  " + JSON.stringify(k)); }
if (strict && (missing.length || leftovers.length)) process.exit(1);
