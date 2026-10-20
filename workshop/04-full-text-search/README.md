# Module 04: Full-text search

**Goal:** build the storefront's product search on ClickHouse, from the Postgres catalogue the ClickPipe replicates.

**Time:** about 20 minutes. `make ch-search` takes 2 s.

**You'll learn:**
- the `text` index (generally available in ClickHouse 26.2 and newer): tokenizers and preprocessors;
- `hasAllTokens` and `hasAnyTokens`, and why you do not need `lower()` or accent handling in queries;
- a **refreshable materialized view** that rebuilds a table on a schedule;
- how to check that an index is used, and what the freshness budget of the search is.

## Before you start

`make check-03` passes (module 03): search is built **from** `retail_oltp`, so those tables must exist and be full.

## Steps

### 1. Build the search table

```bash
make ch-search
```

This applies `sql/clickhouse/10_products_search.sql`. Open the file and read it; the parts that matter:

- **`products_search`** is a plain `MergeTree` table: one row per product, with the name, brand, description, price and stock.
- **Three searchable strings**, `search_en`, `search_pt` and `search_es`, one per language. Each is the product name, brand and description in that language, falling back to English where a translation is missing.
- **A `text` index on each**, for example:

  ```sql
  INDEX idx_search_en search_en TYPE text(
      tokenizer    = splitByNonAlpha,
      preprocessor = lower(replaceRegexpAll(normalizeUTF8NFD(search_en), '\\p{M}', '')))
  ```

  The tokenizer splits text into words at anything that is not a letter. The **preprocessor** runs on the text *and on every search term*: it lower-cases, and it strips accents (decompose the letter, then drop the combining mark). So `TÊNIS`, `tênis` and `tenis` are all the same word.
- **`products_search_refresh`** is a refreshable materialized view:

  ```sql
  CREATE MATERIALIZED VIEW ... REFRESH EVERY 5 MINUTE TO retail_analytics.products_search AS SELECT ... FROM retail_oltp.products FINAL ...
  ```

  Every five minutes it reruns the query over the replicated Postgres tables and replaces the contents of `products_search` atomically. Postgres stays the only source of truth for the catalogue, and stock levels show up in search without any code of ours doing the copy.

Force the first build instead of waiting up to five minutes:

```sql
SYSTEM REFRESH VIEW retail_analytics.products_search_refresh;
```

### 2. Search

Run the queries in `sql/clickhouse/examples/04_full_text_search.sql` in the SQL console or `make ch-client`. The ones to try first:

```sql
-- all of the words must appear
SELECT product_id, name, brand, price, stock_quantity
FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAllTokens(search_en, 'running shoes')
ORDER BY stock_quantity > 0 DESC, price
LIMIT 10;

-- any of the words: the fallback when "all" finds nothing
SELECT count() FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAnyTokens(search_en, 'running keyboard');

-- the same word with and without the accent, in Portuguese
SELECT count() FROM retail_analytics.products_search WHERE is_active = 1 AND hasAllTokens(search_pt, 'tênis');
SELECT count() FROM retail_analytics.products_search WHERE is_active = 1 AND hasAllTokens(search_pt, 'tenis');
```

`running shoes` finds 5 products, and the two Portuguese counts are the same (59 in our run). The storefront's search box runs the same kind of query: `hasAllTokens` first, `hasAnyTokens` when nothing matches.

### 3. Check that the index is used

```sql
EXPLAIN indexes = 1
SELECT product_id FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAllTokens(search_en, 'running shoes');
```

Look for the `Skip` section: `Name: idx_search_en`, with the tokens `running` and `shoes`, and the granules it kept out of the total.

### 4. Watch the refresh

```sql
SELECT view, status, last_success_time, last_success_duration_ms, next_refresh_time, exception
FROM system.view_refreshes WHERE database = 'retail_analytics';
```

`last_success_time` moves forward by five minutes each time (a refresh takes a fraction of a second, about 230 ms in our run), and `next_refresh_time` says when the next one is.

### 5. Do the arithmetic of freshness

A change in Postgres reaches search after **the ClickPipe's sync interval (60 seconds), plus up to five minutes** for the next refresh. To skip the second wait, run `SYSTEM REFRESH VIEW` as above. In the next module you will place an order and watch the stock change travel this exact path.

> `FINAL` on `products_search` is an error: it is a plain `MergeTree`, not a `ReplacingMergeTree`. The `FINAL` the view's query uses is on the *replicated* tables it reads.

## Checkpoint

```bash
make check-04
```

`products_search` has 978 products (691 active) and text indexes, an `EXPLAIN` shows `idx_search_en`, `running shoes` finds products, and the view refreshed within the last six minutes.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `products_search` is empty | The view has not run yet: `SYSTEM REFRESH VIEW retail_analytics.products_search_refresh;`. If it stays empty, `retail_oltp.products` is empty: go back to module 03. |
| `make ch-search` fails with an unknown table | The ClickPipe has not created `retail_oltp.products` yet. Wait for the first load. |
| A text-index error mentions an unknown index type | The service is older than 26.2. |
| `Storage SharedMergeTree doesn't support FINAL` | You used `FINAL` on `products_search`; take it off. |
| `Needle must not contain whitespace or separator characters` | You used `hasToken`, which takes a single word. Use `hasAllTokens` or `hasAnyTokens`: they split the term with the index's own tokenizer, so `USB-C` and `usb c` are the same search (38 products). |

## Going further

- Add a column to the view's query and a matching one to the table, and see it appear after the next refresh.
- Try `hasAllTokens(search_es, 'zapatillas')`, and compare `hasAllTokens` with `hasAnyTokens` on a three-word phrase.

**Next:** [module 05, Run the app](../05-run-the-app/README.md).
