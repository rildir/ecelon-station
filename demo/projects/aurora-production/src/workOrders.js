import { explode } from "./bom.js";

const orders = [];
export function plan(product, qty) {
  const wo = { id: orders.length + 1, product, qty, needs: explode(product, qty), status: "planned" };
  orders.push(wo);
  return wo;
}
export const release = (id) => { const w = orders.find((o) => o.id === id); if (!w || w.status !== "planned") return false; w.status = "released"; return true; };
