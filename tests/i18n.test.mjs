import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { tempData } from "./_setup.mjs";

tempData();
const i18n = await import("../server/i18n.js");

test("t() fills placeholders and chooses plural forms", () => {
  i18n.setLang("en");
  assert.equal(i18n.t("Delete {name}?", { name: "x" }), "Delete x?");
  assert.equal(i18n.t("{n} {n|file|files} changed", { n: 1 }), "1 file changed");
  assert.equal(i18n.t("{n} {n|file|files} changed", { n: 3 }), "3 files changed");
  assert.equal(i18n.t("Missing {x}"), "Missing {x}"); // unknown placeholder left as is
});

test("Turkish dictionary translates and falls back to English", () => {
  i18n.setLang("tr");
  assert.equal(i18n.t("User"), "Kullanıcı");
  assert.equal(i18n.t("A sentence nobody translated"), "A sentence nobody translated");
  assert.equal(i18n.locale(), "tr-TR");
  i18n.setLang("en");
});

test("every t() key in the code has a Turkish entry and no Turkish text is left in the code", () => {
  const out = execFileSync(process.execPath, ["scripts/i18n-check.mjs", "--strict"], { encoding: "utf8" });
  assert.match(out, /keys in code/);
});

test("the Turkish dictionary keeps the placeholders of each key", () => {
  const d = JSON.parse(fs.readFileSync("public/i18n/tr.json", "utf8"));
  const ph = (s) => [...new Set([...s.matchAll(/\{(\w+)[|}]/g)].map((m) => m[1]))].sort().join(",");
  const bad = Object.entries(d).filter(([k, v]) => ph(k) !== ph(v) && !/^Answer the user in/.test(k) && !/in \{language\}/.test(k));
  assert.deepEqual(bad.map(([k]) => k), []);
});
