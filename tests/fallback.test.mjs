// The "use another model when this one is busy" switch: off by default, never the same model as the one in use.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ecelon-fb-"));
process.env.ECELON_DATA = dir;
const { fallbackFor, buildArgs, FALLBACK_MODEL } = await import("../server/runner.js");

test("off unless the user switched it on", () => {
  assert.equal(fallbackFor("claude-opus-5-5"), null);
  fs.writeFileSync(path.join(dir, "prefs.json"), JSON.stringify({ fallback: true }));
  assert.equal(fallbackFor("claude-opus-5-5"), FALLBACK_MODEL);
  assert.equal(fallbackFor(FALLBACK_MODEL), null); // the same model is no fallback
});

test("the flag is passed to Claude Code only when it applies", () => {
  const agent = { id: "t1", model: "claude-opus-5-5", effort: "low", cwd: dir };
  const a = buildArgs(agent); assert.equal(a[a.indexOf("--fallback-model") + 1], FALLBACK_MODEL);
  assert.ok(!buildArgs({ ...agent, model: FALLBACK_MODEL }).includes("--fallback-model"));
  fs.writeFileSync(path.join(dir, "prefs.json"), JSON.stringify({ fallback: false }));
  assert.ok(!buildArgs(agent).includes("--fallback-model"));
});
