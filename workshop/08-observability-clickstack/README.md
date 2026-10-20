# Module 08: Observability with ClickStack

**Goal:** see the whole system in ClickStack, ClickHouse's observability product: traces and the service map, logs with full-text search, session replays and Kubernetes infrastructure. Then break something on purpose and find the cause.

**Time:** about 40 minutes.

**You'll learn:**
- how traces, logs and metrics from every part of the workshop land in the same ClickHouse database (`retail_otel`) as your business data;
- how to follow one checkout through 8 services, down to the SQL it ran;
- how to find the searches that returned nothing, from a trace attribute;
- that the logs are searched with the same `text` index as the product search in module 04;
- how a failure shows up, and how to follow it to its cause.

## Before you start

`make check-07` passes (module 07), and the simulator is running (`make sim-start`) or has run for a few minutes: the screens below need traffic. Everything the cluster observes is already flowing: you do not install anything for this module.

## Steps

### 1. Open ClickStack and create the data sources

In the ClickHouse Cloud console, open your `clickshop` service and launch **ClickStack**. ClickStack reads the tables the OpenTelemetry collector fills; the collector in this workshop writes them to the database **`retail_otel`**, not `default`, so you tell ClickStack where they are. In the ClickStack settings, create (or confirm) four **sources**, using the connection to your service and:

| Source type | Database | Table |
|---|---|---|
| Logs | `retail_otel` | `otel_logs` |
| Traces | `retail_otel` | `otel_traces` |
| Metrics | `retail_otel` | the `otel_metrics_*` tables (gauge, sum, histogram, exponential histogram, summary) |
| Sessions | `retail_otel` | `hyperdx_sessions` |

Each source form also asks for a name, a timestamp column and a few expressions for the service name, severity and so on; ClickStack suggests the right ones for the tables the collector creates.

What fills those tables: the storefront and the 14 services send traces, logs and metrics to the `otel-gateway`; the browsers send their traces and session recordings through the storefront's `/api/otlp`; and two collectors from the OpenTelemetry chart send Kubernetes logs, metrics and events. All of it ends in `retail_otel`, in the same service as your orders and clickstream.

### 2. The service map

In **Search**, with the **Logs** source, find any line from a demo service, for example `journey completed`, and click it. The row opens with tabs: **Overview**, **Column Values**, **Service Map**, **Surrounding Context** and **Infrastructure**. Open **Service Map**.

You see the path of a checkout: the frontend calls the `storefront-bff`; the bff calls `checkout-svc`; checkout calls `pricing-svc` and `inventory-svc`, then the payment service for the method chosen (`payment-card-svc`, `payment-pix-svc` or `payment-boleto-svc`), each of which calls its gateway, then `order-svc`, which calls `ledger-svc` and `email-gateway`. In all, 15 services.

### 3. One checkout, down to the SQL

Switch the source to **Traces** and look for the span **`checkout.place_order`**. It has the attributes `clickshop.order_id`, `clickshop.payment_method`, `clickshop.order_status` and `clickshop.item_count`: pick an order id from module 07 and you find its trace. Open it and read the waterfall:

- `POST /api/checkout/complete` in the frontend is the root;
- inside it, `pg.query:` spans are the **Postgres queries** of the order: `BEGIN`, `SELECT` (the products), `INSERT` (the customer, the order and its items), `UPDATE` (the stock, then the status) and `COMMIT`, each with its statement in the span's `db.statement`;
- then the HTTP calls into the services, each of which has its own spans.

The `clickhouse.query` spans are the frontend's ClickHouse queries (search and the dashboard), with the SQL and the rows read.

### 4. Find the searches that returned nothing

Every search the storefront runs is a span, **`search.products`**, with attributes: `search.query`, `search.locale`, `search.results`, `search.total`, `search.match_mode`, `search.read_rows`, `search.elapsed_ms`. A search that found nothing has `search.results` = `0`. Filter the traces on that, and the same list is a SQL query in the console:

```sql
SELECT SpanAttributes['search.query'] AS query, count() AS searches
FROM retail_otel.otel_traces
WHERE SpanName = 'search.products' AND SpanAttributes['search.results'] = '0'
GROUP BY query ORDER BY searches DESC;
```

Open one of the traces: the `search.products` span has the `clickhouse.query` span nested inside it, with the `hasAllTokens` query it ran.

### 5. Session replay

Open the **Sessions** (client sessions) view. Each row is a simulated shopper's browser session, recorded by the browser SDK: click one and play it. You watch the shopper's browsing, and you can jump from the session to its traces and logs.

### 6. Log search is the same index as module 04

Search the logs for `card gateway unavailable` (there are no matches until you do the exercise below). ClickHouse answers with the `text` index you used in module 04. In the console:

```sql
SHOW CREATE TABLE retail_otel.otel_logs;
```

Find `INDEX idx_lower_body lower(Body) TYPE text(tokenizer = 'splitByNonAlpha')`: the log search is a full-text search on `Body`, the same technology as `hasAllTokens` on `products_search`. As in module 04, words are split at non-letters, so `card_gateway_unavailable` is searched as `card gateway unavailable`:

```sql
SELECT ServiceName, count() FROM retail_otel.otel_logs
WHERE hasAllTokens(Body, 'card gateway unavailable') GROUP BY ServiceName;
```

### 7. Infrastructure: pods and nodes

Open any log line from a pod (a demo service, say) and its **Infrastructure** tab: the pod's CPU and memory over time, and a **pod timeline** of Kubernetes events, like a container being killed when a deployment rolls out. The numbers are the kubelet's, collected by the OpenTelemetry DaemonSet; the link to this log line is the pod's identity (`k8s.pod.uid`), which every service adds to its telemetry.

For the whole cluster, open **Dashboards** and **Kubernetes**: the **Pods**, **Nodes** and **Namespaces** tabs list 3 nodes and the pods of `clickshop` and `observability`, with CPU, memory and events.

### 8. Exercise: break the card gateway, find the cause, fix it

Make sure the simulator is running (`make sim-start`). In a terminal:

```bash
make break-card-gateway
```

The card gateway now answers `502 card_gateway_unavailable` after 1.5 seconds. Card payments fail; Pix and Boleto go on. Give it a minute, then find out what happened **using only ClickStack**:

1. In **Search** on **Logs**, search `card gateway unavailable`. Four services logged it: `demo-card-gateway`, `demo-payment-card-svc`, `demo-checkout-svc` and `demo-storefront-bff`. The one nearest the cause is the gateway: `journey failed role=card-gateway ... status=502 error=card_gateway_unavailable`.
2. Open one of the lines, and its **Service Map**: the failure ends at `card-gateway`.
3. Filter **Traces** on errors: the failing spans are on the card path, and each takes about a second longer than a normal one, because the gateway holds the request before it fails.
4. On the gateway pod's **Infrastructure** tab, the pod timeline shows the old container being stopped as the deployment rolled out, when you ran the command.
5. Look at the simulator: `make logs S=simulator`, where `failed` is rising.

Now fix it:

```bash
make fix-card-gateway
```

and watch the errors stop.

## Checkpoint

```bash
make check-08
```

Traces from all 15 services, frontend traces with `pg.query`, `clickhouse.query` and `search.products` spans, recorded session replays, Kubernetes metrics from 3 nodes, and logs from the demo services. (It also reports how many log lines mention `card_gateway_unavailable`: that is the exercise.)

## Troubleshooting

| Symptom | Fix |
|---|---|
| ClickStack shows no data | Check the sources point at `retail_otel` and the right tables, and that `make status` shows `retail_otel.otel_traces` growing. |
| The service map is empty or partial | There has to be traffic: `make sim-start`, wait a few minutes. |
| No session replays | They come from the simulator's browsers: `make sim-start`. |
| No Kubernetes dashboard data | `kubectl get pods -n observability` should list 4 collectors (`export PATH="$PWD/deploy/bin:$PATH"` first). |
| `make break-card-gateway` seems to do nothing | Card payments only fail when a shopper pays by card: about half of the orders. Wait a minute. |

## Going further

- Search the logs by `deployment` or by the pod labels: every pod carries `service.name` and `deployment` labels.
- Compare the Pipeline tile of the analytics dashboard (module 06) with what the gateway pod does in the Infrastructure tab.
- Run the module 08 SQL on `retail_otel.otel_traces` to build your own question: slowest `clickhouse.query` spans, the most expensive `pg.query`.

**Next:** [module 09, ClickHouse Agents](../09-clickhouse-agents/README.md).
