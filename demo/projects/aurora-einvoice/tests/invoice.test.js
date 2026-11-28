import test from "node:test";
import assert from "node:assert/strict";
import { build } from "../src/invoice.js";

test("an invoice adds VAT to the net total", () => {
  const inv = build({ customer: "C-1", lines: [{ qty: 2, price: 50 }] });
  assert.equal(inv.vat, 18);
  assert.equal(inv.total, 118);
});
test("numbers never repeat", () => {
  const a = build({ customer: "C-1", lines: [{ qty: 1, price: 1 }] }), b = build({ customer: "C-1", lines: [{ qty: 1, price: 1 }] });
  assert.notEqual(a.number, b.number);
});
