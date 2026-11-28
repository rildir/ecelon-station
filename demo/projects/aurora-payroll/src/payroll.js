// Sample brackets for the demo only; real rates live in the rate tables, never in code.
const BRACKETS = [{ upTo: 20000, rate: 0.1 }, { upTo: 50000, rate: 0.2 }, { upTo: Infinity, rate: 0.3 }];

export function tax(gross) {
  let left = gross, from = 0, t = 0;
  for (const b of BRACKETS) { const part = Math.min(left, b.upTo - from); if (part <= 0) break; t += part * b.rate; left -= part; from = b.upTo; }
  return Math.round(t * 100) / 100;
}

export const net = (gross) => Math.round((gross - tax(gross)) * 100) / 100;
