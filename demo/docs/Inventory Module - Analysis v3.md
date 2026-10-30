# Inventory Module — Analysis Document v3

This document defines the stock in/out processes and screens of the Aurora inventory module.

# 1. Scope

Warehouse transfers, stock counts, minimum stock warnings.

# 2. Screens

- Stock card list — filterable by stock code and name. Status: Completed (v3, p.4)
- Warehouse transfer slip — must go through an approval flow; a rejected slip is closed with a reason. Status: Partially done (approval step added, rejection flow pending)
- Stock count slip — month-end count per warehouse. Status: ✓ Done (v3, p.5)

| Field | Type | Required |
| --- | --- | --- |
| StockCode | nvarchar(30) | Yes |
| Unit | int | Yes |

# 3. Rules

3.1 A transfer must be rejected when the source warehouse has insufficient stock.

3.2 When the total stock of a card falls below its minimum, a warning must be shown on the dashboard.

3.3 Stock codes must be unique and are stored in upper case.
