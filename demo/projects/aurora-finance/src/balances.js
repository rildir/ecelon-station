import { allEntries } from "./ledger.js";

export function balance(account) {
  let b = 0;
  for (const e of allEntries()) for (const l of e.lines) if (l.account === account) b += l.debit - l.credit;
  return Math.round(b * 100) / 100;
}
