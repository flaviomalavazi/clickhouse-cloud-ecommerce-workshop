# Module 02: Postgres OLTP

**Goal:** load the ClickShop catalogue, customers, stock and order history into Postgres, and understand why the transactional data lives there.

**Time:** about 15 minutes. `make pg-setup` takes 13 s on an empty database.

**You'll learn:**
- what an OLTP schema looks like for a shop: normalised tables, constraints, one-row-at-a-time transactions;
- how the checkout decrements stock without ever overselling;
- the schema rules that matter for replication (every table has a single-column primary key), which module 03 builds on.

## Before you start

`make check-01` passes (module 01).

## Steps

### 1. Load the data

```bash
make pg-setup
```

It creates the `clickshop` database if it does not exist, applies `sql/postgres/*.sql`, and seeds it from the catalogue in `assets/catalog_details/catalog.json`. The seed is deterministic, so everyone gets the same data, and it is idempotent: running it again says `products already seeded` and changes nothing.

You should see:

```text
  categories        5
  products        978   active 691, on placeholder image 287
  stock           978   low (<=15 units) 30
  customers       500
  orders        2,000
  order_items   5,989
```

The catalogue has 978 products, and 691 are **active**: the ones its owners did not deactivate or flag for deletion and that have a photo. The other 287 stay in the table as inactive rows (a soft delete), and the storefront never shows them. 30 active products start with only 3 to 15 units, so they sell out while the simulator runs in module 07. The 2,000 orders are history over the last two years.

### 2. Tour the schema

```bash
make psql
```

This opens `psql` on the workshop database, over TLS. Try:

```sql
\dt
\d orders
```

You see six tables: `categories`, `products`, `stock`, `customers`, `orders` and `order_items`. Look at how they connect:

```sql
-- the catalogue by category, active products only
SELECT c.name AS category, count(*) AS active_products
FROM products p JOIN categories c ON c.id = p.category_id
WHERE p.is_active
GROUP BY c.name ORDER BY active_products DESC;

-- the products closest to selling out
SELECT p.id, p.name, s.quantity
FROM stock s JOIN products p ON p.id = s.product_id
WHERE p.is_active ORDER BY s.quantity, p.id LIMIT 5;

-- orders by status and payment method
SELECT status, payment_method, count(*) FROM orders GROUP BY 1, 2 ORDER BY 1, 2;
```

### 3. See why this is a job for Postgres

Look at how the checkout takes a unit of stock. It is one statement:

```sql
UPDATE stock SET quantity = quantity - 2, updated_at = now()
WHERE product_id = 3 AND quantity >= 2;
```

If two shoppers buy the last unit at the same moment, Postgres locks the row, the first update succeeds, and the second finds `quantity >= 2` false and changes nothing, so the checkout can tell that shopper the item sold out. The `CHECK (quantity >= 0)` on the table is a second guard. Try it without keeping the change:

```sql
BEGIN;
UPDATE stock SET quantity = quantity - 2 WHERE product_id = 3 AND quantity >= 2 RETURNING product_id, quantity;
ROLLBACK;
```

That is what a transactional database is for: small, concurrent writes that must be correct. It is not what you want to run a dashboard on, which reads millions of rows to answer one question. That is ClickHouse's job, and the next module brings the two together.

Quit `psql` with `\q`.

### 4. Read the schema file once

Open `sql/postgres/001_schema.sql`. Two details matter later:

- **Every table has a single-column `SERIAL PRIMARY KEY`.** The ClickPipe replicates changes by primary key; a table without one would not replicate its updates and deletes.
- **`order_items` has no `subtotal` column.** Logical replication does not publish generated columns by default, so it would never reach ClickHouse. Compute `quantity * unit_price` in queries instead.

## Checkpoint

```bash
make check-02
```

You see 5 categories, 978 products (691 active), a stock row for every product, at least 500 customers and 2,000 orders.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `products already seeded` | Nothing is wrong: the seed ran before. |
| `make psql` says it cannot connect | `make doctor` says why; usually the IP access setting or the password. |
| `the input device is not a TTY` | `make psql` is interactive; run it in a terminal, not through a pipe. |
| You want to start the data over | `make pg-reset` truncates every table and reseeds. **Not once the ClickPipe from module 03 exists**: it ignores TRUNCATE, so ClickHouse would keep the rows. Use `make nuke-data` then. |

## Going further

- `products.attributes` is a `JSONB` column with a GIN index. Try `SELECT name, attributes FROM products WHERE attributes ? 'color' LIMIT 5;`.
- `orders.domain_userid` is the shopper's browser id. In module 07 it is what joins an order to the clickstream.

**Next:** [module 03, CDC ClickPipe](../03-cdc-clickpipe/README.md).
