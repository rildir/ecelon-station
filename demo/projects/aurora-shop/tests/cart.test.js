import { test, expect } from "vitest";
import { total } from "../src/components/Cart.jsx";

test("total sums price × qty", () => {
  expect(total([{ price: 2, qty: 3 }, { price: 0.5, qty: 2 }])).toBe(7);
});
