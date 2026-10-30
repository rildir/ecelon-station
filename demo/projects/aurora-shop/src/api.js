const BASE = import.meta.env.VITE_API_URL || "http://localhost:3100";

export async function getStock(code) {
  const r = await fetch(`${BASE}/inventory?code=${encodeURIComponent(code)}`);
  if (!r.ok) throw new Error(`inventory request failed: ${r.status}`);
  const [card] = await r.json();
  return card ? Object.values(card.stock).reduce((a, b) => a + b, 0) : 0;
}
