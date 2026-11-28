import { useEffect, useState } from "react";
import { getStock } from "../api.js";

export function total(items) {
  return items.reduce((sum, it) => sum + it.price * it.qty, 0);
}

export default function Cart({ items, onChange }) {
  const [warnings, setWarnings] = useState({});

  useEffect(() => {
    let alive = true;
    Promise.all(items.map(async (it) => [it.code, await getStock(it.code)])).then((pairs) => {
      if (!alive) return;
      const w = {};
      for (const [code, stock] of pairs) { const it = items.find((x) => x.code === code); if (it && it.qty > stock) w[code] = stock; }
      setWarnings(w);
    }).catch(() => {});
    return () => { alive = false; };
  }, [items]);

  if (!items.length) return <p>Your cart is empty.</p>;
  return (
    <section>
      <h2>Cart</h2>
      {items.map((it, i) => (
        <div key={it.code}>
          {it.name} × <input type="number" min="1" value={it.qty} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
          {warnings[it.code] != null && <em> only {warnings[it.code]} in stock</em>}
        </div>
      ))}
      <strong>Total: {total(items).toFixed(2)} €</strong>
    </section>
  );
}
