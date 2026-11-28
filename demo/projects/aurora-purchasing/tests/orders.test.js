import test from "node:test";
import assert from "node:assert/strict";
import { createOrder, approve, listOrders } from "../src/orders.js";

test("a small order needs one approval", () => {
  const o = createOrder({ supplier: "SUP-01", lines: [{ qty: 10, price: 100 }] });
  approve(o.id, "ayse");
  assert.equal(listOrders().find((x) => x.id === o.id).status, "approved");
});

test("an order above the limit needs two different approvers", () => {
  const o = createOrder({ supplier: "SUP-02", lines: [{ qty: 100, price: 900 }] });
  approve(o.id, "ayse"); approve(o.id, "ayse");
  assert.equal(listOrders().find((x) => x.id === o.id).status, "draft");
  approve(o.id, "mehmet");
  assert.equal(listOrders().find((x) => x.id === o.id).status, "approved");
});
