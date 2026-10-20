# Module 01: Cloud services

**Goal:** create the two services the workshop runs on, a ClickHouse Cloud service and a ClickHouse Managed Postgres instance, put their credentials in the one file the whole workshop reads, and load the Postgres data the rest of the workshop uses.

**Time:** about 20 minutes, most of it waiting for the services to start. `make doctor` takes 6 s, `make ch-bootstrap` 3 s and `make pg-setup` 13 s.

**You'll learn:**
- the difference between the analytical service (ClickHouse) and the transactional one (Postgres), and why they live in **the same region**;
- the direct Postgres endpoint and the connection pooler, and why the ClickPipe needs the direct one;
- what opening an instance to the internet costs you, and how to verify a server's certificate;
- the workshop's one rule for configuration: **everything is in `.env`**.

## Before you start

`make check-00` passes (module 00).

## The fast path: the one-hour workshop

If you have about an hour, do the steps below up to **7** (the services, the access, an API key and `.env`), and then run:

```bash
make setup
```

It does the rest of modules 01 to 08 for you, in the right order: the ClickHouse databases, the Postgres migrations, the **ClickPipe** (through the Cloud API), the Postgres data, product search, the real-time rollups, the local cluster and the application, the **ClickStack sources** (through the API), 30 days of history, the live generators and the simulated shoppers. It takes about ten minutes once the images are built (`make prefetch`, module 00) and prints what it is doing, so the hour goes on reading and exploring, not on setting up. Every step is safe to repeat: if one fails, fix it and run `make setup` again. What exists is recognised and left alone: a ClickPipe you made by hand, the ClickStack sources, and the 30 days of history, which are loaded once. Then go through the modules to see what was built and why, in any order; each one describes the same steps by hand.

Or take the slow way: skip the API key (step 6) and follow every module in turn.

## Steps

### 1. Create the ClickHouse service

In the [ClickHouse Cloud console](https://console.clickhouse.cloud), create a **New service**. Choose a cloud provider and a **region**, and write the region down: Postgres must be in the same one, so the replication does not cross regions. Name it `clickshop`. The workshop needs ClickHouse **26.2 or newer** (the full-text index is generally available from there); it was written against 26.6.

When it is running, open the service's **Connect** view. You need the **host** (it looks like `abc123.us-east-1.aws.clickhouse.cloud`), the user `default` and its password. The password is shown once when the service is created: keep it.

### 2. Create the Managed Postgres instance

In the same organisation, create a **Managed Postgres** instance in the **same region**. Postgres 18 is what the workshop was written against. A small size is plenty. Name it `clickshop-pg`.

### 3. Decide who can reach it

Both services are reachable from the internet and protected by a password and TLS. Allow access from your laptop's IP address. The ClickPipe you create in module 03 runs inside ClickHouse Cloud, and its addresses are allowed by default; if you restrict the instance by IP, you also have to allow the ClickPipes addresses for your region (they are listed in the ClickHouse documentation).

The risk to understand: "allow from anywhere" is the easy setting for a workshop, and it means anyone who learns the password can connect. Use a strong password, do not reuse one, and delete both services in [module 10](../10-cleanup/README.md).

### 4. Get the Postgres connection details

Open the instance and its **Connect** view in the left sidebar. It shows **Username** (`postgres`), **Password**, **Server** (the host name) and **Port** (`5432`).

Use the **direct** connection, which is the default. Do **not** switch on **via PgBouncer**: the pooler is for many short-lived application connections, and the ClickPipe's logical replication does not work through it.

### 5. Download the Postgres CA certificate

On the instance's **Settings** tab, download the CA certificate. Save it in this repo as `assets/certs/ca-certificate.pem` (the folder exists, and `*.pem` files are never committed). With it, every part of the workshop connects with `verify-full`: the certificate chain and the host name are both checked, so you know you are talking to your instance and not to someone in the middle.

### 6. Create a Cloud API key (only for the fast path)

`make setup`, `make clickpipes` and `make clickstack-setup` create the ClickPipe and the ClickStack sources by calling the ClickHouse Cloud API, which needs a key. In the console, open the organization's **API keys** page and create a key with the **Admin** role. You get a **key ID** and a **key secret**; the secret is shown once. Skip this step if you will follow the modules by hand: then you create both in the console yourself.

### 7. Fill in `.env`

```bash
cp .env.example .env
```

Open `.env` and fill in the **required block**:

| Key | Where it comes from |
|---|---|
| `CLICKHOUSE_HOST` | ClickHouse service, **Connect**: the host only, no `https://` and no `:8443` |
| `CLICKHOUSE_USER` | `default` |
| `CLICKHOUSE_PASSWORD` | the service password from step 1 |
| `PGHOST` | Postgres instance, **Connect**, **Server** |
| `PGPORT` | `5432` |
| `PGUSER` | `postgres` |
| `PGPASSWORD` | Postgres instance, **Connect**, **Password** |
| `PGDATABASE` | `clickshop` (the workshop creates it) |

And, recommended, uncomment and set the optional line that points at the certificate:

```dotenv
PGSSLROOTCERT=assets/certs/ca-certificate.pem
```

For the fast path, uncomment and fill in the API key too:

```dotenv
CLICKHOUSE_CLOUD_API_KEY_ID=...
CLICKHOUSE_CLOUD_API_KEY_SECRET=...
```

Rules for this file: one `KEY=value` per line, **no quotes**, and comments on their own lines. It is read exactly as written by Docker and Kubernetes. It is ignored by git, and it is the **only** thing you configure in the whole workshop.

> In production you would give each component its own least-privilege user. The workshop uses `default` and `postgres` to stay simple.

### 8. Check it

```bash
make doctor
```

It checks Docker, ports, and `.env` (every value is printed **masked**), then connects to both services. A good run ends with:

```text
  ✓ ClickHouse 26.x (needs 26.2+)
  ✓ Postgres 18.x (TLS, wal_level=logical)

All good. Next: make cluster images secrets app
```

### 9. Create the databases and clickstream tables

```bash
make ch-bootstrap
```

This creates three databases in ClickHouse: `retail_analytics` (clickstream, card transactions, rollups, search), `retail_oltp` (where the ClickPipe will write in module 03) and `retail_otel` (ClickStack's tables), plus the two clickstream tables. It is safe to run again.

### 10. Load Postgres

```bash
make pg-setup
```

This creates the `clickshop` database and its six tables in Postgres and loads the data the rest of the workshop uses: the catalogue (978 products, 691 of them active), their stock, 500 customers and 2,000 orders of history. It takes 13 seconds and is safe to run again (`products already seeded`).

It is two steps you can also run apart: `make pg-migrate` creates the tables and loads nothing, and `make pg-seed` loads the data. `make setup` runs them with the ClickPipe in between, so that the rows reach ClickHouse as changes. [Module 02](../02-postgres-oltp/README.md) tours what was loaded; it is optional.

## Checkpoint

```bash
make check-01
make check-02
```

Every line is a ✓: `.env` complete, ClickHouse answers and is recent enough, Postgres answers over TLS with `wal_level = logical`, the three databases and the two tables exist, and Postgres holds the catalogue, the customers and the orders.

## Troubleshooting

`make doctor` says what is wrong, in words. The common ones:

| Symptom | Fix |
|---|---|
| `CLICKHOUSE_HOST must be a bare host name` | Remove `https://`, any path and `:8443`. |
| `PGPORT is the pooler's port` | You copied the PgBouncer connection. Use the direct one on 5432. |
| `has quotes` / `has a comment after the value` | Remove the quotes; move the comment to its own line. |
| `has Windows line endings` | Save `.env` with LF line endings. |
| `Postgres: could not connect` | The instance may still be starting; check **IP access** allows your address; check the host and password. |
| `certificate verify failed` | `PGSSLROOTCERT` points at the wrong file, or `PGHOST` is not the instance's own host name. |
| `PGSSLROOTCERT=... was not found` | The path is relative to the repo root: `assets/certs/ca-certificate.pem`. |
| ClickHouse older than 26.2 | Create a new service, or upgrade it from the console. |
| `Cloud API: ... 401` or `403` | The key or secret is wrong, or the key does not have the Admin role. |
| `no service in the organisation has the host ...` | `CLICKHOUSE_HOST` is not a host of your organisation's services, or the key sees several organisations: set `CLICKHOUSE_CLOUD_ORGANIZATION_ID`. |

## Going further

- `wal_level = logical` is what lets a ClickPipe read Postgres' changes. `make check-01` verifies it; on the instance this workshop was tested on it was already set.
- Open `.env.example` and read the optional block: the rates of the generators and the simulator are there, for later modules.

**Next:** [module 02, Postgres OLTP](../02-postgres-oltp/README.md) (optional), or go straight to [module 03, the CDC ClickPipe](../03-cdc-clickpipe/README.md).
