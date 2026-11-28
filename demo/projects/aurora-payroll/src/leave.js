const balances = { "E-100": 14, "E-101": 3 };
export const remaining = (emp) => balances[emp] ?? 0;
export function request(emp, days) { if (remaining(emp) < days) return false; balances[emp] -= days; return true; }
