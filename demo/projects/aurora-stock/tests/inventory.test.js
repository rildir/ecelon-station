import test from "node:test";
import assert from "node:assert/strict";
import { listCards, getCard, moveStock } from "../src/models/stock.js";

test("stock cards can be looked up by code", () => {
  assert.equal(getCard("st-1001").name, "Hex bolt M8");
});

test("a transfer never takes more than the source has", () => {
  assert.equal(moveStock("ST-2040", "NORTH", "MAIN", 50), false);
  assert.equal(moveStock("ST-2040", "NORTH", "MAIN", 5), true);
});

test("listCards returns copies", () => {
  listCards()[0].name = "changed";
  assert.equal(getCard("ST-1001").name, "Hex bolt M8");
});
