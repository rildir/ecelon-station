// Invoice numbers run in one series per year: AUR2026000000001.
let seq = 0;
export const nextNumber = (year) => `AUR${year}${String(++seq).padStart(9, "0")}`;

export function build(order, year = 2026) {
  const net = order.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const vat = Math.round(net * 0.18 * 100) / 100;
  return { number: nextNumber(year), customer: order.customer, net, vat, total: net + vat };
}
