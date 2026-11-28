// Bill of materials: product code → components with quantity per unit.
const boms = {
  "FG-100": [{ code: "ST-1001", qty: 8 }, { code: "SF-200", qty: 1 }],
  "SF-200": [{ code: "ST-2040", qty: 2 }],
};

// Flat list of raw materials needed for `qty` units, exploding sub-assemblies.
export function explode(code, qty = 1, out = {}) {
  const lines = boms[code];
  if (!lines) { out[code] = (out[code] || 0) + qty; return out; }
  for (const l of lines) explode(l.code, l.qty * qty, out);
  return out;
}
