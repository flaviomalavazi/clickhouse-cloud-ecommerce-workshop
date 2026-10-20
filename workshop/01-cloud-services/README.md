# Module 01: Cloud services

**Goal:** create the two services the workshop runs on, a ClickHouse Cloud service and a ClickHouse Managed Postgres instance, and put their credentials in the one file the whole workshop reads.

**Time:** about 20 minutes, most of it waiting for the services to start. `make doctor` takes 6 s and `make ch-bootstrap` 3 s.

**You'll learn:**
- the difference between the analytical service (ClickHouse) and the transactional one (Postgres), and why they live in **the same region**;
- the direct Postgres endpoint and the connection pooler, and why the ClickPipe needs the direct one;
- what opening an instance to the internet costs you, and how to verify a server's certificate;
- the workshop's one rule for configuration: **everything is in `.env`**.

## Before you start

`make check-00` passes (module 00).

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

### 6. Fill in `.env`

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

Rules for this file: one `KEY=value` per line, **no quotes**, and comments on their own lines. It is read exactly as written by Docker and Kubernetes. It is ignored by git, and it is the **only** thing you configure in the whole workshop.

> In production you would give each component its own least-privilege user. The workshop uses `default` and `postgres` to stay simple.

### 7. Check it

```bash
make doctor
```

It checks Docker, ports, and `.env` (every value is printed **masked**), then connects to both services. A good run ends with:

```text
  ✓ ClickHouse 26.x (needs 26.2+)
  ✓ Postgres 18.x (TLS, wal_level=logical)

All good. Next: make cluster images secrets app
```

### 8. Create the databases and clickstream tables

```bash
make ch-bootstrap
```

This creates three databases in ClickHouse: `retail_analytics` (clickstream, card transactions, rollups, search), `retail_oltp` (where the ClickPipe will write in module 03) and `retail_otel` (ClickStack's tables), plus the two clickstream tables. It is safe to run again.

## Checkpoint

```bash
make check-01
```

Every line is a ✓: `.env` complete, ClickHouse answers and is recent enough, Postgres answers over TLS with `wal_level = logical`, the three databases and the two tables exist.

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

## Going further

- `wal_level = logical` is what lets a ClickPipe read Postgres' changes. `make check-01` verifies it; on the instance this workshop was tested on it was already set.
- Open `.env.example` and read the optional block: the rates of the generators and the simulator are there, for later modules.

**Next:** [module 02, Postgres OLTP](../02-postgres-oltp/README.md).
