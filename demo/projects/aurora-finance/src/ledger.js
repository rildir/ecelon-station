// Double-entry ledger: every journal entry must balance to zero.
const entries = [];

export function post({ date, memo, lines }) {
  const sum = lines.reduce((s, l) => s + l.debit - l.credit, 0);
  if (Math.abs(sum) > 0.005) throw new Error("entry does not balance");
  const e = { id: entries.length + 1, date, memo, lines };
  entries.push(e);
  return e;
}

export const allEntries = () => entries.map((e) => ({ ...e }));
