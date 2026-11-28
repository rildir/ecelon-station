import test from "node:test";
import assert from "node:assert/strict";
import { tax, net } from "../src/payroll.js";

test("tax is applied per bracket", () => {
  assert.equal(tax(20000), 2000);
  assert.equal(tax(30000), 4000);
});
test("net is gross minus tax", () => assert.equal(net(20000), 18000));
