import test from "node:test";
import assert from "node:assert/strict";
import { explode } from "../src/bom.js";

test("sub-assemblies are exploded to raw materials", () => {
  assert.deepEqual(explode("FG-100", 10), { "ST-1001": 80, "ST-2040": 20 });
});
