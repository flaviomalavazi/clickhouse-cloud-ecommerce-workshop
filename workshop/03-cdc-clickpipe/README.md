# Module 03: CDC ClickPipe

**Goal:** replicate the six Postgres tables into ClickHouse with a **Postgres CDC ClickPipe**, then learn how ClickHouse stores a table that keeps changing.

**Time:** about 25 minutes: 10 to set up the pipe and wait for the first load, 15 for the exercise.

**You'll learn:**
- change data capture: ClickHouse reads Postgres' write-ahead log and applies the changes, with no triggers and no application code;
- why the replicated tables are `ReplacingMergeTree`, and what `_peerdb_version` and `_peerdb_is_deleted` are;
- when you need `FINAL`, and the alternative;
- what the sync interval means for how fresh the copy is.

## Before you start

`make check-02` passes (module 02).

## Steps

> **The fast way.** `make clickpipes` creates the pipe described below through the ClickHouse Cloud API, and `make setup` does it for you with everything else. `make notebook` opens a notebook, `01_create_clickpipes.ipynb`, that makes the same calls one at a time and shows the request, which is the clearest way to see what each console setting becomes. All three need the API key from [module 01](../01-cloud-services/README.md). The steps below are what to click if you would rather do it by hand, and they give the same pipe (we compared the tables it creates with the ones the console creates: same names, engines, sorting keys and columns). The commands recognise a pipe you made by hand, whatever its name, when it copies the same Postgres database into the same ClickHouse database, so running `make clickpipes` or `make setup` after the console steps does not create a second one.

### 1. Create the ClickPipe

In the ClickHouse Cloud console, open your **Postgres instance** and click **Sync to ClickHouse** in its sidebar, then **Replicate data in ClickHouse**.

**Configure the replication service**

| Setting | Value |
|---|---|
| Integration name | `clickshop-cdc` |
| ClickHouse service | your `clickshop` service |
| Postgres database | `clickshop` |
| Replication method | **Initial load + CDC** (copy what is there, then keep it current) |

Click **Next**.

**Configure replication settings**

| Setting | Value |
|---|---|
| Sync interval (seconds) | `60` (the default) |

Leave the other settings at their defaults and click **Next**.

**Select tables to replicate**

| Setting | Value |
|---|---|
| Destination database | `retail_oltp` (module 01 created it) |
| Prefix default destination table names with schema name | **off**, so the tables are called `orders`, not `public_orders` |
| Preserve NULL values from source | **off**: a Postgres NULL becomes the type's default (an empty string, or 0). This cannot be changed later |
| Remove deleted rows during merges | **off**: keep the delete markers, so you can see them below |

Expand the `public` schema and select all **six** tables: `categories`, `products`, `stock`, `customers`, `orders` and `order_items`. Then click **Replicate data to ClickHouse**.

The pipe appears in the integrations list. Click its name to watch its status. The first load is about 10,000 rows and takes a minute or two. (A pipe created before the data was loaded, which is what `make setup` does, has nothing to copy at first: the rows arrive as changes instead, one sync interval later.)

### 2. See what the pipe created

Run SQL in the console's SQL console, or in a terminal with `make ch-client`.

```sql
SHOW TABLES FROM retail_oltp;
SHOW CREATE TABLE retail_oltp.orders;
```

Besides your six tables there is one named `_peerdb_raw_mirror_…`: that is the pipe's own staging area. Leave it alone. In `orders` you will see:

```text
ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', _peerdb_version)
PRIMARY KEY (id) ORDER BY (id)
```

and three extra columns:

| Column | Meaning |
|---|---|
| `_peerdb_version` | A number that grows with every change to a row; the highest one is the current row |
| `_peerdb_is_deleted` | `1` when the row was deleted in Postgres |
| `_peerdb_synced_at` | When the pipe wrote the row |

(`SharedReplacingMergeTree` is `ReplacingMergeTree` as ClickHouse Cloud runs it.)

### 3. Change something in Postgres and watch it arrive

Open `make psql` and make an order by hand:

```sql
INSERT INTO orders (customer_id, status, payment_method, total_amount)
VALUES (1, 'pending', 'pix', 10.00) RETURNING id;
```

Note the `id`. In ClickHouse, with that id in place of `ORDER_ID`:

```sql
SELECT id, status, _peerdb_version, _peerdb_is_deleted
FROM retail_oltp.orders WHERE id = ORDER_ID ORDER BY _peerdb_version;
```

The row shows up after the next sync: with the 60 second interval, within about a minute (when we tested with a 30 second interval, a change took 30 to 32 seconds). Now confirm the order in Postgres:

```sql
UPDATE orders SET status = 'confirmed', updated_at = now() WHERE id = ORDER_ID;
```

and run the same ClickHouse query again after the next sync. You get **two rows**: `pending` and `confirmed`, with different versions. ClickHouse never updates a row in place; the pipe inserts the new version and a background merge removes the old one later. Until then, a plain `SELECT` sees both.

Two ways to read only the current version:

```sql
-- FINAL collapses each row to its latest version while reading, and the filter hides deleted rows
SELECT id, status FROM retail_oltp.orders FINAL
WHERE id = ORDER_ID AND _peerdb_is_deleted = 0;

-- the same without FINAL: keep the values of the highest version
SELECT id, argMax(status, _peerdb_version) AS status
FROM retail_oltp.orders WHERE id = ORDER_ID GROUP BY id;
```

Finally, delete it in Postgres (`DELETE FROM orders WHERE id = ORDER_ID;`) and look again. A **third row** appears with `_peerdb_is_deleted = 1` and an empty `status` (a delete carries only the key), and the `FINAL` query with the filter returns nothing. A delete is one more version.

### 4. Count orders the wrong way and the right way

`sql/clickhouse/examples/03_cdc_dedup.sql` has the queries for this. Run them in order. The one to remember is the status count: **without `FINAL`, an order that changed status is counted once for each version**, so every report that reads a replicated table needs `FINAL` and the `_peerdb_is_deleted = 0` filter (or the `argMax` form).

> **Why the storefront will not show you this.** When the app places an order it inserts it as `pending` and confirms it about two seconds later. The pipe takes both changes in one batch and ClickHouse only ever has the `confirmed` row. That is why you made an order by hand.

## Checkpoint

```bash
make check-03
```

All six tables are in `retail_oltp`, each has the `_peerdb_` columns, and the row counts match Postgres, read with `FINAL`. (The order you made and deleted is gone from both sides.)

## Troubleshooting

| Symptom | Fix |
|---|---|
| The pipe shows an error | Click its name and read it. The usual causes: the instance's IP access blocks the ClickPipes addresses (module 01), or you used the pooler address. |
| A table is missing from `retail_oltp` | The first load is still running (check the pipe's status), or you did not select it: the pipe's page lists the tables it replicates. |
| `check-03` says it is not in step | The pipe is behind. Wait one sync interval (up to a minute) and run it again. |
| `make clickpipes` says `401` or `403` | The API key is wrong or is not an Admin key (module 01). |
| `make clickpipes` fails on the certificate | `PGSSLROOTCERT` in `.env` must point at the Postgres CA file: the pipe verifies your server with it. |
| `Preserve NULL values` was on | The tables have `Nullable` columns. Everything still works, but the rest of the workshop assumed it off. Create the pipe again. |
| You want to restart the data | `make nuke-data` truncates Postgres, empties the mirror, reseeds and waits for the pipe. `make pg-reset` alone leaves ClickHouse out of step, because the pipe ignores TRUNCATE. |

## Going further

- The freshness of everything built on these tables is the sync interval plus a few seconds. Change the interval on the pipe's page (try 10 seconds) and measure it again.
- `SELECT count() FROM system.parts WHERE database = 'retail_oltp' AND table = 'orders' AND active` shows how many parts hold the table; merges collapse the old versions as they run.

**Next:** [module 04, Full-text search](../04-full-text-search/README.md).
