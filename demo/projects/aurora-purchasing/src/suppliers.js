export const suppliers = [
  { code: "SUP-01", name: "Northline Metals", termDays: 45 },
  { code: "SUP-02", name: "Kestrel Packaging", termDays: 30 },
];
export const dueDate = (supplier, from) => new Date(new Date(from).getTime() + supplier.termDays * 86400000).toISOString().slice(0, 10);
