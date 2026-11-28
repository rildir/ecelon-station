import test from "node:test";
import assert from "node:assert/strict";
import { post } from "../src/ledger.js";
import { balance } from "../src/balances.js";

test("an unbalanced entry is rejected", () => {
  assert.throws(() => post({ date: "2026-10-01", memo: "x", lines: [{ account: "100", debit: 10, credit: 0 }] }));
});

test("balances follow the postings", () => {
  post({ date: "2026-10-02", memo: "sale", lines: [{ account: "120", debit: 118, credit: 0 }, { account: "600", debit: 0, credit: 100 }, { account: "391", debit: 0, credit: 18 }] });
  assert.equal(balance("120"), 118);
});
