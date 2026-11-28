// Purchase orders: draft → approved → received. Orders above the approval limit need a second approver.
const orders = [];
export const APPROVAL_LIMIT = 50000;

export function createOrder({ supplier, lines }) {
  if (!supplier || !lines?.length) throw new Error("supplier and at least one line are required");
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const order = { id: orders.length + 1, supplier, lines, total, status: "draft", approvals: [] };
  orders.push(order);
  return order;
}

export function approve(id, user) {
  const o = orders.find((x) => x.id === id);
  if (!o || o.status !== "draft") return false;
  if (!o.approvals.includes(user)) o.approvals.push(user);
  const need = o.total > APPROVAL_LIMIT ? 2 : 1;
  if (o.approvals.length >= need) o.status = "approved";
  return true;
}

export const listOrders = () => orders.map((o) => ({ ...o }));
