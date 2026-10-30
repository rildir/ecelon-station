import { useState } from "react";
import Cart from "./components/Cart.jsx";

const CATALOGUE = [
  { code: "ST-1001", name: "Hex bolt M8", price: 0.12 },
  { code: "ST-1002", name: "Washer M8", price: 0.04 },
  { code: "ST-2040", name: "Steel plate 2mm", price: 18.5 },
];

export default function App() {
  const [cart, setCart] = useState([]);
  const add = (item) => setCart((c) => [...c, { ...item, qty: 1 }]);
  return (
    <main>
      <h1>Aurora Shop</h1>
      <ul>
        {CATALOGUE.map((p) => (
          <li key={p.code}>
            {p.name} — {p.price.toFixed(2)} € <button onClick={() => add(p)}>Add</button>
          </li>
        ))}
      </ul>
      <Cart items={cart} onChange={setCart} />
    </main>
  );
}
