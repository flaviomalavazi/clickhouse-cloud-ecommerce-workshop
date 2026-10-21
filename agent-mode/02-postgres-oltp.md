# Module 02: Postgres OLTP (agent playbook, optional)

**Objective:** the participant sees the transactional side: what a shop's schema looks like in Postgres, how a checkout takes stock without overselling, and the two schema rules that replication depends on.

**Step ids:** `offer`, `show-loaded`, `tour-schema`, `stock-guard`, `schema-rules`, `check`.

**Time:** about 10 minutes (about 2 as a fast-track tour). **Optional:** nothing later depends on it.

## Preconditions

```bash
make check-01
make check-02
```

Both must pass (module 01 loaded the data).

## Steps

### 1. `offer` [EXPLAIN] Offer it, then respect the answer

"This is an optional ten-minute tour of the Postgres side: how the orders and stock are stored and why that job belongs to Postgres. Nothing later needs it. Want it, or shall we go on?" If they skip it: mark the module `skipped` in the progress file and go to module 03.

### 2. `show-loaded` [AGENT RUNS] What was loaded

```bash
make pg-query Q="SELECT 'categories' AS tbl, count(*) FROM categories UNION ALL SELECT 'products', count(*) FROM products UNION ALL SELECT 'active products', count(*) FROM products WHERE is_active UNION ALL SELECT 'stock', count(*) FROM stock UNION ALL SELECT 'customers', count(*) FROM customers UNION ALL SELECT 'orders', count(*) FROM orders UNION ALL SELECT 'order_items', count(*) FROM order_items"
```

Expect 5 categories, 978 products (691 active), 978 stock rows, at least 500 customers, 2,000 orders (more if the shoppers have run) and about 6,000 order items. Say: the catalogue has 978 products; 691 are **active** (not deactivated, with a photo); the other 287 stay as inactive rows (a soft delete) and the storefront never shows them. Thirty active products start with only 3 to 15 units so that they sell out while the shoppers run (module 07).

### 3. `tour-schema` [AGENT RUNS] The schema

```bash
make pg-query Q="SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1"
make pg-query Q="SELECT c.name AS category, count(*) AS active_products FROM products p JOIN categories c ON c.id = p.category_id WHERE p.is_active GROUP BY c.name ORDER BY active_products DESC"
make pg-query Q="SELECT p.id, p.name, s.quantity FROM stock s JOIN products p ON p.id = s.product_id WHERE p.is_active ORDER BY s.quantity, p.id LIMIT 5"
make pg-query Q="SELECT status, payment_method, count(*) FROM orders GROUP BY 1, 2 ORDER BY 1, 2"
```

Six tables: `categories`, `products`, `stock`, `customers`, `orders`, `order_items`. Walk the joins out loud: products belong to a category; stock is one row per product; an order has items.

### 4. `stock-guard` [AGENT RUNS] How the checkout never oversells

Say what the checkout does, in one statement:

```sql
UPDATE stock SET quantity = quantity - 2, updated_at = now() WHERE product_id = 3 AND quantity >= 2;
```

"If two shoppers buy the last unit at the same moment, Postgres locks the row: the first update succeeds, the second finds `quantity >= 2` false and changes nothing, so the checkout can say the item sold out. A `CHECK (quantity >= 0)` on the table is a second guard." Show both guards **without changing anything**, by asking for more units than exist:

```bash
make pg-query Q="UPDATE stock SET quantity = quantity - 100000 WHERE product_id = 3 AND quantity >= 100000 RETURNING product_id, quantity"
make pg-query Q="UPDATE stock SET quantity = quantity - 100000 WHERE product_id = 3"
```

The first changes **zero rows** (the `WHERE` guard); the second **fails on purpose** (the command exits with an error: that error is the demonstration, not a problem) with `violates check constraint "stock_quantity_check"` (the table's guard) and changes nothing. Both are safe; say so before running them.

### 5. `schema-rules` [AGENT RUNS] Two details that replication needs

```bash
grep -n "PRIMARY KEY\|subtotal" sql/postgres/001_schema.sql
```

Point at: every table has a single-column `SERIAL PRIMARY KEY` (the ClickPipe replicates changes by primary key; a table without one would not replicate updates and deletes), and `order_items` has **no** `subtotal` column (logical replication does not publish generated columns by default, so they would never reach ClickHouse; queries compute `quantity * unit_price` instead).

### 6. `check` [AGENT RUNS] The checkpoint

```bash
make check-02
```

## Talking points

- **OLTP:** normalised tables, constraints, one small transaction at a time. The checkout writes the order, its items and the stock decrement in a single transaction.
- **Why this lives in Postgres:** many small concurrent writes that must be correct (no overselling, no lost order). That is a transactional database's job. It is not what you run a dashboard on, which reads millions of rows to answer one question; that is ClickHouse's job, and module 03 brings the two together.
- **Replication needs a primary key**, and does not carry generated columns: the schema was written with both in mind.

## Checkpoint

`make check-02` shows 5 categories, 978 products (691 active), a stock row for every product, at least 500 customers and at least 2,000 orders, and ends `All checks passed`.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| `make pg-query` cannot connect | `make doctor` | Usually the IP access setting or the password: back to module 01's failure table. |
| The counts are zero | `make check-02` | The data was never loaded: `make pg-seed`. |
| `products already seeded` from `make pg-seed` | Nothing is wrong | The seed ran before. |
| They want to start the data over | Ask what they want to undo | `make pg-reset` is **not** safe once the ClickPipe exists (it ignores TRUNCATE, so ClickHouse would keep the rows): use `make nuke-data`, which they run themselves after you explain what it does. |

## Fast track

`make setup` already loaded the data. Offer the tour in two minutes (steps 3 and 4) or skip it.

## Exit criteria

`make check-02` passes, or the module was skipped. Update the progress file: module `02` `done` or `skipped`; `current` module `03`.
