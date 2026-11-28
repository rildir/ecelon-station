// Tiny in-memory stock model for the demo.
const cards = [
  { code: "ST-1001", name: "Hex bolt M8", unit: "pcs", min: 200, stock: { MAIN: 540, NORTH: 120 } },
  { code: "ST-1002", name: "Washer M8", unit: "pcs", min: 500, stock: { MAIN: 1800, NORTH: 0 } },
  { code: "ST-2040", name: "Steel plate 2mm", unit: "sheet", min: 20, stock: { MAIN: 18, NORTH: 7 } },
];

export const listCards = () => cards.map((c) => ({ ...c }));
export const getCard = (code) => cards.find((c) => c.code === String(code || "").toUpperCase());

export function moveStock(code, from, to, qty) {
  const c = getCard(code);
  if (!c || (c.stock[from] || 0) < qty) return false;
  c.stock[from] -= qty;
  c.stock[to] = (c.stock[to] || 0) + qty;
  return true;
}

export const belowMinimum = () => cards.filter((c) => Object.values(c.stock).reduce((a, b) => a + b, 0) < c.min);
