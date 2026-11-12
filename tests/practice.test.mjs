// The loop guard of the practice pad: text in, text out (the module's browser parts are not touched here).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// practice.js imports browser modules; take guardLoops out of the source and evaluate it alone
const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "practice.js"), "utf8");
const start = src.indexOf("export function guardLoops"), end = src.indexOf("\nfunction webDoc");
const guardLoops = new Function(src.slice(start, end).replace("export function", "return function"))();

test("braced loops get a guard, on the same line", () => {
  assert.equal(guardLoops("while (true) { x++; }"), "while (true) {__lg(); x++; }");
  assert.equal(guardLoops("for (let i = 0; i < f(a, (b)); i++) {\n}"), "for (let i = 0; i < f(a, (b)); i++) {__lg();\n}");
  assert.equal(guardLoops("do { x(); } while (y);"), "do {__lg(); x(); } while (y);");
  assert.equal(guardLoops("for await (const x of y) { }"), "for await (const x of y) {__lg(); }");
  assert.equal(guardLoops("for (const k in o) // why\n{\n  go(k);\n}").split("\n").length, 4); // line count is kept
});

test("what only looks like a loop is left alone", () => {
  for (const code of ['const s = "while (true) { }";', "// for (;;) { }\nlet a = 1;", "/* while (x) { } */", "const t = `for (a) { }`;", "obj.for(1); const format = 2; forEach(x); x.while (y) { }", "while (x) i++;"]) assert.equal(guardLoops(code), code);
});

test("guarded code still parses; code that never parsed is not made worse", () => {
  const code = "function f(list) { for (const x of list) { if (x) { while (x.next) { x = x.next; } } } return 1; }";
  assert.doesNotThrow(() => new Function(guardLoops(code)));
  assert.equal((guardLoops(code).match(/__lg\(\);/g) || []).length, 2);
  assert.match(guardLoops("while (true) { let = ; }"), /__lg/); // broken before, broken after: the user's own error is reported
});
