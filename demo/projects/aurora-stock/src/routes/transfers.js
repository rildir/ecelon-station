import { Router } from "express";
import { getCard, moveStock } from "../models/stock.js";

const r = Router();
const slips = [];

// POST /transfers { code, qty, from, to }
// A slip is created in "pending" state; stock moves only after approval.
r.post("/", (req, res) => {
  const { code, qty, from, to } = req.body || {};
  const card = getCard(code);
  if (!card) return res.status(404).json({ error: "unknown stock code" });
  if (!(qty > 0)) return res.status(400).json({ error: "qty must be positive" });
  if (from === to) return res.status(400).json({ error: "source and target warehouse must differ" });
  const slip = { id: slips.length + 1, code, qty, from, to, status: "pending" };
  slips.push(slip);
  res.status(201).json(slip);
});

// POST /transfers/:id/approve
r.post("/:id/approve", (req, res) => {
  const slip = slips.find((s) => s.id === Number(req.params.id));
  if (!slip) return res.status(404).json({ error: "slip not found" });
  if (slip.status !== "pending") return res.status(409).json({ error: "slip already closed" });
  const ok = moveStock(slip.code, slip.from, slip.to, slip.qty);
  if (!ok) return res.status(422).json({ error: "insufficient stock in source warehouse" });
  slip.status = "approved";
  res.json(slip);
});

// TODO: POST /transfers/:id/reject — rejection flow (reason required)

export default r;
