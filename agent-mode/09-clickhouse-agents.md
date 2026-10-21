# Module 09: ClickHouse Agents (agent playbook, placeholder)

**Objective:** (when written) the participant explores the data they built with **ClickHouse Agents** in the Cloud console, asking questions in plain language over the replicated orders and catalogue (`retail_oltp`), the clickstream and card transactions (`retail_analytics`) and the ClickStack tables (`retail_otel`).

**Step ids:** `tell-them`, `explore-with-sql`.

**Time:** a few minutes for now.

**This module is not written yet.** It comes with the agent prompts, which are written together with the workshop's owner. **Do not invent ClickHouse Agents steps, console labels or prompts**: you would be guessing at a product screen you cannot see.

## Preconditions

```bash
make check-08
```

It should pass, but do not hold the participant back if it does not.

## Steps

### 1. `tell-them` [EXPLAIN] Say what this module will be

"The last module has you ask your data questions in plain language with ClickHouse Agents in the Cloud console, over everything we built: the orders and catalogue, the clickstream and card transactions, and the observability data. It is not part of the workshop yet. Everything it needs is already in place, so let's use the time to ask your own questions in SQL."

### 2. `explore-with-sql` [AGENT RUNS] Ask the data something, in SQL

Invite them to ask a business question, and write the SQL together, with `make ch-query`. A few that use everything at once, to offer if they have none:

- Revenue by payment method over the last day, from the real orders: `retail_oltp.orders FINAL`, `_peerdb_is_deleted = 0`.
- The conversion of sessions to orders over the last hour: the funnel in `sql/clickhouse/examples/06_real_time_analytics.sql` (number 2), against the orders of module 07.
- The slowest `clickhouse.query` spans of the frontend: `retail_otel.otel_traces`, `SpanName = 'clickhouse.query'`, by `Duration`.
- The products whose stock is under five units and that were searched for in the last day: `retail_analytics.products_search` with `retail_oltp.stock FINAL`.

Remind yourself of the rules: `FINAL` and `_peerdb_is_deleted = 0` on `retail_oltp`, no `FINAL` on `products_search`, `hasAllTokens` for text, and never write to or truncate `retail_analytics` or `retail_otel`.

## Talking points

- **Why plain language works well here:** the tables are named and typed clearly, joined by keys that have meaning (the order id, the browser id), and live in one service. An agent that can see the schema can write the same SQL you just wrote.
- **What to check in an agent's answer:** the SQL it ran (does it use `FINAL` on the replicated tables?), the time window, and the numbers against a query you trust.

## Checkpoint

None: this module has no check of its own. It is done when you have told them what it will be.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| They ask you to set up ClickHouse Agents | n/a | Say it is not part of the workshop yet and you do not know the console's screens well enough to guide it; offer SQL instead. |
| A query errors on `retail_oltp` | Read the error | Usually a missing `FINAL`, or a `FINAL` on `products_search`. |

## Fast track

Same as above, in five minutes at most, or skip it and go to the cleanup when they are out of time.

## Exit criteria

Update the progress file: module `09` `skipped` (it is a placeholder); `current` module `10`.
