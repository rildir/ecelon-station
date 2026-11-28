import { Router } from "express";
import { listCards } from "../models/stock.js";

const r = Router();

// GET /inventory?code=ST-1001&name=bolt
// Filters by exact stock code and/or case-insensitive partial name.
r.get("/", (req, res) => {
  const { code, name } = req.query;
  let cards = listCards();
  if (code) cards = cards.filter((c) => c.code === String(code).toUpperCase());
  if (name) cards = cards.filter((c) => c.name.toLowerCase().includes(String(name).toLowerCase()));
  res.json(cards);
});

export default r;
