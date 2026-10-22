# Module 05: Run the app

**Goal:** run the ClickShop storefront and its services on a local Kubernetes cluster, place an order, and follow it into ClickHouse.

**Time:** about 25 minutes. Starting everything takes about 2 minutes: `make cluster` 33 s, `make images` 51 s, `make secrets` 3 s and `make app` 24 s.

**You'll learn:**
- what runs where: the application on your machine, the data and search in the cloud;
- how a Postgres write becomes visible in ClickHouse and in search, and how long that takes;
- how to look around a Kubernetes cluster.

## Before you start

`make check-04` passes (module 04).

## Steps

### 1. Start the cluster and the application

```bash
make up
```

`make up` runs four commands, one after the other (typed out: `make cluster images secrets app`). What each one does:

| Command | What it does |
|---|---|
| `make cluster` | Creates a k3d cluster named `clickshop`: one server and two agents (three Docker containers acting as Kubernetes nodes), with port **3000** on your machine mapped to the cluster's ingress. |
| `make images` | Loads the images you built in module 00 into the three nodes (and the two third-party ones the chart runs). Only what changed is loaded again. |
| `make secrets` | Puts your `.env` into the cluster as a Secret, and your Postgres certificate as another. |
| `make app` | Installs the application chart into the namespace `clickshop`, and the two OpenTelemetry collectors into `observability`, then waits until the pods are ready. |

It ends with `ClickShop is running: http://localhost:3000`.

```bash
make check-05
```

### 2. Use the storefront

Open <http://localhost:3000>. The page follows your browser's language (English, Portuguese or Spanish) and the search works in all three.

1. Type `running shoes` in the search box. These results come from the `products_search` table you built in module 04, through ClickHouse's full-text index.
2. Open a product. Note its stock and its name; you are about to buy one.
3. Click **Add to Cart**, then open the cart and click **Proceed to checkout**.
4. Enter a name and an email (nothing is charged), choose **Pix**, and click **Continue to payment**. On the next screen click **I have completed the payment**.

You land on the confirmation page with your **order number**.

### 3. Follow the order into ClickHouse

The storefront wrote the order to **Postgres**: an `orders` row, its `order_items`, and one less unit in `stock`, in one transaction. Now find it in ClickHouse. It arrives after the ClickPipe's next sync, so give it up to a minute. Look it up by the order number on your confirmation page (replace `ORDER_NUMBER`; if you ran `make setup`, the simulated shoppers are placing orders too, so yours is one of many). In the SQL console, or with `make ch-query Q="..."`:

```sql
SELECT id, status, payment_method, total_amount, created_at
FROM retail_oltp.orders FINAL
WHERE id = ORDER_NUMBER AND _peerdb_is_deleted = 0;
```

Your order is there, with the status `confirmed`. (It was inserted as `pending` and confirmed about two seconds later; the pipe delivered both changes together, so ClickHouse only has the final one. Module 03 showed you the versions with an order made by hand.) The example file's query 2 shows what was in the newest orders (`make ch-query FILE=sql/clickhouse/examples/05_run_the_app.sql N=2`).

### 4. Follow the stock into search

Compare the stock the replica has with the stock search shows, for the products of your order (the example file's query 3 does it for any product):

```sql
SELECT s.product_id, s.quantity AS stock_in_replica, ps.stock_quantity AS stock_in_search,
       s.quantity != ps.stock_quantity AS stale
FROM retail_oltp.stock AS s FINAL
INNER JOIN retail_analytics.products_search AS ps ON ps.product_id = s.product_id
WHERE s._peerdb_is_deleted = 0
  AND s.product_id IN (SELECT product_id FROM retail_oltp.order_items FINAL WHERE order_id = ORDER_NUMBER AND _peerdb_is_deleted = 0);
```

For a while your products show `stale = 1`: the replica has the new stock and search does not, until the refreshable view runs, at most five minutes later. Skip the wait:

```sql
SYSTEM REFRESH VIEW retail_analytics.products_search_refresh;
SYSTEM WAIT VIEW retail_analytics.products_search_refresh;
```

Run the query again: `stale` is 0, and reloading the product page in the storefront shows the new stock. The whole path, **Postgres, ClickPipe, `retail_oltp`, refreshable view, `products_search`, storefront**, takes the sync interval (a minute at most) plus up to five minutes, or only the sync interval if you refresh the view yourself.

### 5. Look around the cluster

You did not install `kubectl`; the repo carries a wrapper. Put it on your path for this terminal:

```bash
export PATH="$PWD/deploy/bin:$PATH"
kubectl get nodes
kubectl get pods -n clickshop -o wide
kubectl get svc,ingress -n clickshop
kubectl get pods -n observability
helm list -A
```

You will see the three nodes, 18 pods in `clickshop` (21 while the generators and the shoppers run), and in `observability` one OpenTelemetry collector per node plus one for the whole cluster. What the pods are:

| Pod | What it is |
|---|---|
| `frontend` | The Next.js storefront. It reads and writes Postgres, and reads ClickHouse for search and the analytics dashboard. |
| `storefront-bff`, `catalog-svc`, `checkout-svc`, `pricing-svc`, `inventory-svc`, `payment-card-svc`, `payment-pix-svc`, `payment-boleto-svc`, `card-gateway`, `pix-psp-gateway`, `boleto-gateway`, `order-svc`, `ledger-svc`, `email-gateway` | A small microservice graph the checkout calls, so that traces in module 08 have something to show. They hold no data. |
| `snowplow-micro`, `snowplow-bridge` | The storefront's behaviour events go to Snowplow Micro; the bridge reads them and inserts them into ClickHouse. |
| `otel-gateway` | The ClickStack collector: everything observable lands here, then in ClickHouse (`retail_otel`). |

```bash
make status          # the pods, then row counts and freshness of every table, in both databases
make logs S=frontend # follow a service's logs (Ctrl+C to stop)
```

## Checkpoint

```bash
make check-05
```

Every pod is ready, the storefront answers on port 3000, the catalogue loads from Postgres, search finds `jeans` through ClickHouse, and Snowplow Micro answers.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `make cluster` says port 3000 is in use | Stop what uses it, then `make down` and `make up` again. |
| Pods stay `ImagePullBackOff` | The images were not loaded: run `make images`. |
| `make app` times out | `make status` shows which pods are not ready, and `make logs S=<pod name>` why. A frontend that cannot reach Postgres or ClickHouse is the usual cause: `make doctor`. |
| The storefront shows an error page | `make logs S=frontend`. |
| Search finds nothing | `products_search` is empty: module 04, `SYSTEM REFRESH VIEW`. |
| Your order is not in ClickHouse after two minutes | The ClickPipe is behind or stopped: look at its page in the console. |
| You changed `.env` | `make apply-env` updates the Secret and restarts the pods that read it. |
| Pods are evicted, or Docker is slow | Docker's disk is nearly full: `docker system df`, and keep 10 GB free. |

## Going further

- `make logs S=otel-gateway` shows the collector exporting to ClickHouse.
- Everything the chart deploys is in `deploy/helm/clickshop/`; `values.yaml` lists the services, their latency and their memory.
- `make stop` stops the cluster and keeps it, to pause until another day: `make up` brings it back as it was (the load too, if it was running).
- `make down` removes the cluster when you want your machine back. Nothing in the cloud is touched, and `make up` brings it back in two minutes (`make start` brings back the generators and the shoppers too).

**Next:** [module 06, Real-time analytics](../06-real-time-analytics/README.md).
