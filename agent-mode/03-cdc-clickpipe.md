# Module 03: CDC ClickPipe (agent playbook)

**Objective:** Postgres is replicated into ClickHouse by a Postgres CDC ClickPipe, and the participant understands how ClickHouse stores a table that keeps changing: `ReplacingMergeTree`, versions, delete markers, and when to use `FINAL`.

**Step ids:** `create-clickpipe`, `wait-running`, `inspect-tables`, `change-and-watch`, `dedup-queries`, `check`.

**Time:** guided about 25 minutes (10 to create the pipe and wait for the first load, 15 for the exercise); fast-track tour about 10.

## Preconditions

```bash
make check-02
```

It must pass. Ask whether a ClickPipe already exists (the fast track's `make setup` creates one):

```bash
make clickpipes-status
```

`ClickPipe <name> (<id>): Running` means it exists: skip steps 1 and 2. `no ClickPipe named ...` means create it. (It needs the API key; without one, the participant creates the pipe in the console and you check it through the tables.)

## Steps

### 1. `create-clickpipe` [PARTICIPANT DOES — console] Create the ClickPipe

If they have an API key and want to save time, you can run `make clickpipes` instead (about 30 seconds); say that the console flow is the one that shows what each setting means, and let them choose. On the guided track the default is the console.

Walk them through, one screen at a time. In the ClickHouse Cloud console, open the **Postgres instance** and click **Sync to ClickHouse** in its sidebar, then **Replicate data in ClickHouse**.

**Configure the replication service:** Integration name `clickshop-cdc`; ClickHouse service `clickshop`; Postgres database `clickshop`; Replication method **Initial load + CDC** (copy what is there, then keep it current). **Next.**

**Replication settings:** Sync interval `60` seconds (the default). Leave the rest at the defaults. **Next.**

**Select tables:** Destination database `retail_oltp`; **Prefix default destination table names with schema name: off** (so the tables are `orders`, not `public_orders`); **Preserve NULL values from source: off** (a NULL becomes the type's default; this cannot be changed later); **Remove deleted rows during merges: off** (keep the delete markers, you will look at them). Expand the `public` schema, select all **six** tables (`categories`, `products`, `stock`, `customers`, `orders`, `order_items`), then click **Replicate data to ClickHouse**.

Wait for "done".

### 2. `wait-running` [AGENT RUNS] Wait for the first load

```bash
make clickpipes-wait
```

It returns when `retail_oltp` holds what Postgres holds (the first load is about 10,000 rows and takes a minute or two). While it runs, give the CDC talking point. If the console pipe has a different name than `clickshop-cdc` that is fine: the commands recognise it by its source and destination.

### 3. `inspect-tables` [AGENT RUNS] What the pipe created

```bash
make ch-query Q="SHOW TABLES FROM retail_oltp"
make ch-query Q="SHOW CREATE TABLE retail_oltp.orders"
```

Point at: six tables plus one named `_peerdb_raw_mirror_…`, the pipe's own staging area (leave it alone); in `orders`, `ENGINE = SharedReplacingMergeTree(..., _peerdb_version)` and `ORDER BY (id)`; and three extra columns, `_peerdb_version` (grows with every change to a row; the highest is current), `_peerdb_is_deleted` (`1` when deleted in Postgres) and `_peerdb_synced_at` (when the pipe wrote it). `SharedReplacingMergeTree` is `ReplacingMergeTree` as ClickHouse Cloud runs it.

### 4. `change-and-watch` [AGENT RUNS] Change something in Postgres and watch it arrive

This is the heart of the module. Tell them what you are about to do: make one test order by hand, change it, delete it, and watch each change arrive in ClickHouse. (The app's own orders do not show this: it inserts as `pending` and confirms two seconds later, so ClickHouse only ever sees the final row.)

a. Insert, and **write the id in the progress file** (`notes.test_order_id`) so that it is removed even if you stop early:

```bash
make pg-query Q="INSERT INTO orders (customer_id, status, payment_method, total_amount) VALUES (1, 'pending', 'pix', 10.00) RETURNING id"
```

b. Wait for the next sync (up to 60 seconds; poll every 15 seconds, and use the time for the talking points), then, with that id in place of `ORDER_ID`:

```bash
make ch-query Q="SELECT id, status, _peerdb_version, _peerdb_is_deleted FROM retail_oltp.orders WHERE id = ORDER_ID ORDER BY _peerdb_version"
```

One row, `pending`.

c. Confirm it in Postgres and wait for the next sync:

```bash
make pg-query Q="UPDATE orders SET status = 'confirmed', updated_at = now() WHERE id = ORDER_ID"
```

The same ClickHouse query now returns **two rows** (`pending` and `confirmed`, different versions). Say: ClickHouse never updates a row in place; the pipe inserts the new version and a background merge removes the old one later. Until then a plain `SELECT` sees both. Show the two ways to read only the current version:

```bash
make ch-query Q="SELECT id, status FROM retail_oltp.orders FINAL WHERE id = ORDER_ID AND _peerdb_is_deleted = 0"
make ch-query Q="SELECT id, argMax(status, _peerdb_version) AS status FROM retail_oltp.orders WHERE id = ORDER_ID GROUP BY id"
```

d. Delete it in Postgres, wait for the next sync, and run the `ORDER BY _peerdb_version` query again:

```bash
make pg-query Q="DELETE FROM orders WHERE id = ORDER_ID"
```

A **third row** appears with `_peerdb_is_deleted = 1` and an empty status (a delete carries only the key), and the `FINAL` query with the filter returns nothing. A delete is one more version. Remove `test_order_id` from the progress notes.

### 5. `dedup-queries` [AGENT RUNS] Count the wrong way and the right way

```bash
make ch-query FILE=sql/clickhouse/examples/03_cdc_dedup.sql N=1
make ch-query FILE=sql/clickhouse/examples/03_cdc_dedup.sql N=2
make ch-query FILE=sql/clickhouse/examples/03_cdc_dedup.sql N=3
make ch-query FILE=sql/clickhouse/examples/03_cdc_dedup.sql N=4
make ch-query FILE=sql/clickhouse/examples/03_cdc_dedup.sql N=5
```

The one to remember is number 4: **without `FINAL`, an order that changed status is counted once for each version**, so every report over a replicated table needs `FINAL` and `_peerdb_is_deleted = 0` (or the `argMax` form of number 5). Ask them to predict the difference between the two counts before you show them.

### 6. `check` [AGENT RUNS] The checkpoint

```bash
make check-03
```

## Talking points

- **Change data capture:** ClickHouse reads Postgres' write-ahead log and applies the changes. No triggers, no application code, and the transactional database does no extra work for analytics.
- **`ReplacingMergeTree` and versions:** every Postgres change becomes a new row with a higher `_peerdb_version`; the highest wins, and merges clean up the older ones in the background. A delete is a row with `_peerdb_is_deleted = 1`.
- **`FINAL` or `argMax`:** `FINAL` collapses to the latest version while reading and is the simple choice; `argMax(col, _peerdb_version)` gets the same answer and is the alternative when you aggregate. Forgetting both double-counts.
- **Freshness is the sync interval** (60 seconds here), plus a few seconds. Everything built on these tables, search included, inherits it.
- **Postgres stays the source of truth.** ClickHouse holds a copy for analytics; nothing writes to `retail_oltp` except the pipe.

## Checkpoint

`make check-03` shows the six tables in `retail_oltp`, each with the `_peerdb_` columns, and the row counts equal to Postgres, read with `FINAL`. The test order you made and deleted is gone from both sides. It ends `All checks passed`.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| The pipe shows an error in the console | `make clickpipes-status` for the state; ask them to open the pipe and read the message | The usual causes: the instance's IP access blocks the ClickPipes addresses (module 01), or the pooler address was used. |
| A table is missing in `retail_oltp` | `make ch-query Q="SHOW TABLES FROM retail_oltp"` | The first load is still running (`make clickpipes-status`), or the table was not selected in the pipe. |
| `check-03` says it is not in step | `make status` shows the newest sync | The pipe is behind: wait one sync interval and run it again. |
| Nothing arrives after two minutes | `make clickpipes-status`; the pipe's page in the console | A stopped or failed pipe is theirs to look at in the console. |
| `make clickpipes` says `401` or `403` | `make doctor` | The key is wrong or not an Admin key (module 01). |
| `make clickpipes` fails on the certificate | `ls assets/certs/` | `PGSSLROOTCERT` must point at the Postgres CA file: the pipe verifies the server with it. |
| `Preserve NULL values` was on | `make ch-query Q="SHOW CREATE TABLE retail_oltp.orders"` shows `Nullable` | It cannot be changed: they delete the pipe in the console and create it again (module 10 order: pipe first). |
| They want to start the data over | Ask what they want to undo | `make nuke-data` (they run it; it empties the mirror, reseeds Postgres and waits for the pipe). Never `make pg-reset` alone: the pipe ignores TRUNCATE. |

## Fast track

`make setup` created the pipe (unless they made one by hand: either way `make clickpipes-status` says Running). Skip steps 1 and 2. Tour with steps 3 to 5; step 4 is the best five minutes of the module. Say that the pipe was created before Postgres was seeded, so every row arrived as a change.

## Exit criteria

`make check-03` passes and no test order is left. Update the progress file: module `03` `done`; `current` module `04`.
