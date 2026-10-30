# Aurora API

Inventory and warehouse service for the Aurora shop. Express + a JSON file store (no database needed for the demo).

- `GET /inventory?code=&name=` — stock cards, filterable by code or name
- `POST /transfers` — warehouse transfer slip (goes through approval)
- `POST /counts` — month-end stock count slip (not implemented yet)

Run: `npm run dev` · Tests: `npm test`
