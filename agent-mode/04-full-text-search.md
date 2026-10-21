# Module 04: Full-text search (agent playbook)

**Objective:** product search runs on ClickHouse's `text` index, built from the replicated Postgres catalogue, and the participant understands tokenizers, `hasAllTokens` / `hasAnyTokens`, refreshable materialized views, and the freshness budget.

**Step ids:** `build-search`, `read-the-sql`, `search-queries`, `explain-index`, `watch-refresh`, `freshness`, `check`.

**Time:** guided about 20 minutes; fast-track tour about 6.

## Preconditions

```bash
make check-03
```

It must pass: search is built **from** `retail_oltp`, so those tables must exist and be full.

## Steps

### 1. `build-search` [AGENT RUNS] Build the search table

```bash
make ch-search
```

Two seconds. It applies `sql/clickhouse/10_products_search.sql`. Say: it creates a plain table, `products_search` (one row per product), three searchable strings per product (`search_en`, `search_pt`, `search_es`, falling back to English where a translation is missing), a `text` index on each, and a **refreshable materialized view** that rebuilds the table from the replicated Postgres tables.

Force the first build instead of waiting up to five minutes:

```bash
make ch-query Q="SYSTEM REFRESH VIEW retail_analytics.products_search_refresh"
```

### 2. `read-the-sql` [AGENT RUNS] Read the index and the view

```bash
grep -n "INDEX idx_search_en" -A3 sql/clickhouse/10_products_search.sql
grep -n "REFRESH EVERY" sql/clickhouse/10_products_search.sql
```

Explain the index definition: the **tokenizer** (`splitByNonAlpha`) splits text into words at anything that is not a letter; the **preprocessor** runs on the text *and on every search term*: it lower-cases and strips accents (decompose the letter, drop the combining mark), so `TÊNIS`, `tênis` and `tenis` are the same word. Explain the view: every five minutes it reruns its query over `retail_oltp.products FINAL` and atomically replaces the contents of `products_search`. Postgres stays the only source of truth, and stock levels reach search without any code of ours copying them.

### 3. `search-queries` [AGENT RUNS] Search

```bash
make ch-query FILE=sql/clickhouse/examples/04_full_text_search.sql N=1
make ch-query FILE=sql/clickhouse/examples/04_full_text_search.sql N=2
make ch-query FILE=sql/clickhouse/examples/04_full_text_search.sql N=3
make ch-query FILE=sql/clickhouse/examples/04_full_text_search.sql N=4
```

Number 1: all of the words must appear (`running shoes` finds 5 products). Number 2: any of the words, the fallback when "all" finds nothing; the storefront's search box does exactly this, `hasAllTokens` first, `hasAnyTokens` when nothing matches. Number 3: `USB-C` and `usb c` are the same search (38 products). Number 4: the same Portuguese word with and without the accent, `tênis` and `tenis`, gives the same count (59): ask them to guess before you show it. Let them suggest a word to search, and run it.

### 4. `explain-index` [AGENT RUNS] Is the index used?

```bash
make ch-query FILE=sql/clickhouse/examples/04_full_text_search.sql N=5
```

Look for the `Skip` section: `Name: idx_search_en`, with the tokens `running` and `shoes`, and the granules it kept out of the total.

### 5. `watch-refresh` [AGENT RUNS] Watch the refresh

```bash
make ch-query FILE=sql/clickhouse/examples/04_full_text_search.sql N=6
```

`last_success_time` moves forward every five minutes (a refresh takes a fraction of a second), and `next_refresh_time` says when the next one is.

### 6. `freshness` [EXPLAIN] The arithmetic of freshness

A change in Postgres reaches search after **the ClickPipe's sync interval (60 seconds) plus up to five minutes** for the next refresh. `SYSTEM REFRESH VIEW` skips the second wait. In module 05 they place an order and watch the stock change travel exactly this path. One warning: `FINAL` on `products_search` is an error, it is a plain `MergeTree`; the `FINAL` is on the replicated tables the view reads.

### 7. `check` [AGENT RUNS] The checkpoint

```bash
make check-04
```

## Talking points

- **The `text` index** (generally available from ClickHouse 26.2): an inverted index over tokens. A tokenizer decides what a word is; a preprocessor normalises the text and the query the same way, so queries need no `lower()` and no accent handling.
- **`hasAllTokens` / `hasAnyTokens`** take a phrase and split it with the index's own tokenizer, which is why they can use the index. `hasToken` takes a single word and errors on anything else.
- **A refreshable materialized view** is a materialized view that reruns on a schedule and replaces its target atomically: a good fit for a derived table that is cheap to rebuild and wants a join (here, products with stock and translations).
- **The freshness budget** of a derived table is the sum of the stages: sync interval plus refresh interval. Knowing the sum lets you decide whether it is acceptable and which knob to turn.

## Checkpoint

`make check-04` shows `products_search` with 978 products (691 active) and text indexes, an `EXPLAIN` that shows `idx_search_en`, a `running shoes` search that finds products, and the view refreshed within the last six minutes. It ends `All checks passed`.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| `products_search` is empty | `make ch-query Q="SELECT count() FROM retail_analytics.products_search"` | The view has not run: `make ch-query Q="SYSTEM REFRESH VIEW retail_analytics.products_search_refresh"`. If it stays empty, `retail_oltp.products` is empty: back to module 03. |
| `make ch-search` fails with an unknown table | `make ch-query Q="SHOW TABLES FROM retail_oltp"` | The ClickPipe has not created `retail_oltp.products` yet: wait for the first load (`make clickpipes-wait`). |
| An error about an unknown index type | `make doctor` shows the ClickHouse version | The service is older than 26.2: new service or upgrade (module 01). |
| `Storage SharedMergeTree doesn't support FINAL` | Look at the query you ran | `FINAL` on `products_search`: take it off. |
| `Needle must not contain whitespace or separator characters` | Look at the query you ran | `hasToken` was used with a phrase: use `hasAllTokens` or `hasAnyTokens`. |
| `check-04` says the view is stale | `make ch-query FILE=sql/clickhouse/examples/04_full_text_search.sql N=6` shows `exception` | Refresh it by hand; if there is an exception, read it to them. |

## Fast track

`make setup` built everything. Skip step 1; go through steps 3, 4 and 6 (about 6 minutes) and let them try their own search words, in English, Portuguese or Spanish.

## Exit criteria

`make check-04` passes. Update the progress file: module `04` `done`; `current` module `05`.
