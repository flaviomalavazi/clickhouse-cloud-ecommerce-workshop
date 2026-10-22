# Module 01: Cloud services (agent playbook)

**Objective:** the participant has a ClickHouse Cloud service and a Managed Postgres instance, both reachable from their laptop, their credentials are in `.env`, and the data the rest of the workshop uses is in place.

**Step ids:** `create-clickhouse-service`, `create-postgres-instance`, `network-access`, `postgres-connection`, `download-ca`, `api-key`, `fill-env`, `doctor`, then on the guided track `bootstrap-clickhouse` and `load-postgres`, or on the fast track `make-setup`, and finally `check`.

**Time:** guided about 20 minutes (most of it waiting for the services to start); fast track about 20 minutes including `make setup`.

## Preconditions

```bash
make check-00
```

It must pass. If it does not, go back to `00-prerequisites.md`.

The progress file's `track` says which track they are on (the fast track is the default).

Also see whether this machine is already set up, without opening anything: `test -f .env && echo ".env present"`. If it is, it may be theirs, with their passwords in it: **never copy over it**. Run `make doctor`, and if it passes go straight to step 8 (they may still need the console steps for anything `make doctor` reports missing).

## Steps

The first six steps are the participant's, in the console at <https://console.clickhouse.cloud>. Give them one at a time, and wait for "done" after each. **They keep every password and secret to themselves**: never ask them to paste one.

### 1. `create-clickhouse-service` [PARTICIPANT DOES — console] Create the ClickHouse service

Tell them: "Create a **New service**. Pick a cloud provider and a **region**, and write the region down: Postgres must be in the same one, so replication does not cross regions. Name it `clickshop`." It needs ClickHouse 26.2 or newer (the new full-text index); a new service is. When it is running, they open the service's **Connect** view: they need the **host** (like `abc123.us-east-1.aws.clickhouse.cloud`), the user `default` and its password. The password is shown once, when the service is created: they must keep it.

### 2. `create-postgres-instance` [PARTICIPANT DOES — console] Create the Managed Postgres instance

"In the same organisation, create a **Managed Postgres** instance in the **same region**. Postgres 18, a small size is plenty. Name it `clickshop-pg`."

### 3. `network-access` [PARTICIPANT DOES — console] Who can reach it

"Allow access from your laptop's IP address (the instance's **IP access** setting)." Explain the trade-off (talking points). If they restrict by IP, the ClickPipe's addresses for the region must be allowed too; the defaults already allow them.

### 4. `postgres-connection` [PARTICIPANT DOES — console] The connection details

"Open the Postgres instance and its **Connect** view in the left sidebar: **Username** (`postgres`), **Password**, **Server**, **Port** (`5432`). Use the **direct** connection (the default). Do **not** switch on **via PgBouncer**: logical replication does not work through the pooler." They only look at it now; the values go into `.env` in step 7.

### 5. `download-ca` [PARTICIPANT DOES — console] The certificate

"On the instance's **Settings** tab, download the CA certificate and save it in this repository as `assets/certs/ca-certificate.pem`." (The folder is in the repository; `mkdir -p` below makes sure.) Check without printing it:

```bash
mkdir -p assets/certs
ls assets/certs/
head -1 assets/certs/ca-certificate.pem
```

The first line must be `-----BEGIN CERTIFICATE-----`. With it, everything connects with `verify-full`: the chain and the host name are both checked.

### 6. `api-key` [PARTICIPANT DOES — console] A Cloud API key (fast track; optional on the guided track)

`make setup`, `make clickpipes` and `make clickstack-setup` create the ClickPipe and the ClickStack sources by calling the ClickHouse Cloud API. "In the console open the organization's **API keys** page and create a key with the **Admin** role. You get a **key ID** and a **key secret**; the secret is shown once." On the guided track, skip this if they will click through module 03 and 08 themselves.

### 7. `fill-env` [AGENT RUNS] then [PARTICIPANT DOES — console] Fill in `.env`

Create the file for them (`-n` never replaces a `.env` that exists):

```bash
cp -n .env.example .env
```

Then tell them to open `.env` in their editor and fill in the **required block** (you never open it): `CLICKHOUSE_HOST` (the host only, no `https://`, no `:8443`), `CLICKHOUSE_USER` (`default`), `CLICKHOUSE_PASSWORD`, `PGHOST` (the **Server**), `PGPORT` (`5432`), `PGUSER` (`postgres`), `PGPASSWORD`, `PGDATABASE` (`clickshop`; the workshop creates it). Also uncomment `PGSSLROOTCERT=assets/certs/ca-certificate.pem`, and, for the fast track, `CLICKHOUSE_CLOUD_API_KEY_ID` and `CLICKHOUSE_CLOUD_API_KEY_SECRET`. Rules: one `KEY=value` per line, **no quotes**, comments on their own lines, LF line endings. Wait for "done".

### 8. `doctor` [AGENT RUNS] Check it

```bash
make doctor
```

It checks Docker, the ports and `.env` (every value shown masked), then connects to both services, and, if an API key is set, checks it against the Cloud API. Read the result to the participant in one line. A good run ends `All good`. Use the failure playbook for anything else.

**Guided track: steps 9 and 10. Fast track: step 11.**

### 9. `bootstrap-clickhouse` [AGENT RUNS] The ClickHouse databases (guided)

```bash
make ch-bootstrap
```

It creates three databases (`retail_analytics`: clickstream, card transactions, rollups and search; `retail_oltp`: where the ClickPipe will write; `retail_otel`: ClickStack's tables) and the two clickstream tables. Safe to repeat.

### 10. `load-postgres` [AGENT RUNS] The Postgres data (guided)

```bash
make pg-setup
```

It creates the `clickshop` database and its six tables and loads the catalogue (978 products, 691 active), their stock, 500 customers and 2,000 orders of history. About 13 seconds, safe to repeat. (It is two steps you can run apart: `make pg-migrate` for the tables, `make pg-seed` for the data.)

### 11. `make-setup` [AGENT RUNS] Everything at once (fast track)

Say: "From here one command builds what modules 01 to 08 build by hand, in the order that works: the databases, the Postgres tables, the ClickPipe (through the API), the data, search, the rollups, the cluster and the application, the ClickStack sources, 30 days of history, the live generators and the browser shoppers. It takes about ten minutes. Every step is safe to repeat, so if one fails we fix it and run it again."

```bash
make setup
```

If module 00 noted under 8 GB, check that `make doctor` shows `SIM_USERS=2` first (the lighter load from module 00 is in `.env`). Run it in the background with the log in `.workshop/logs/setup.log` and read the step lines as they appear (`[n/13] ...`). While it runs, use the talking points: this is the time to explain the architecture. When it ends it prints a timing per step and the storefront URL. If the ClickStack step says it could not finish, that is expected on a service where ClickStack has never been opened: module 08 handles it.

Record `"setup_done": true` in the progress file's `notes`. Before you run it, ask them to open **ClickStack** once from their ClickHouse service in the console (a minute: that creates ClickStack's connection to the service). If they have not, `make setup` still builds everything else and ends by saying the ClickStack step is `NOT DONE`: that is the reason, and module 08 fixes it.

### 12. `check` [AGENT RUNS] The checkpoint

```bash
make check-01
make check-02
```

## Talking points

- **Two services, two jobs.** ClickHouse is analytical: huge scans, aggregations, search. Postgres is transactional: small, concurrent, correct writes (an order and its stock change). They are in the **same region** so the replication between them does not cross regions.
- **The direct endpoint, not the pooler.** PgBouncer is for many short-lived application connections; the ClickPipe reads Postgres' write-ahead log (logical replication), which needs a direct connection. `wal_level = logical` is what allows it.
- **Opening an instance to the internet** is the easy setting for a workshop and it means anyone who learns the password can connect. Use a strong password, do not reuse one, and delete both services at the end (module 10). In production each component gets a least-privilege user.
- **Verify the server's certificate.** With the CA file every connection checks the chain and the host name (`verify-full`), so you know you are talking to your instance and not to someone in the middle.
- **One configuration file.** Everything is in `.env`; nothing else is edited. It is ignored by git, read by Docker and Kubernetes exactly as written, and `make doctor` is how it is checked, with values masked.

## Checkpoint

`make check-01` and `make check-02` print only `✓` lines: `.env` complete; ClickHouse answers and is 26.2 or newer; Postgres answers over TLS with `wal_level = logical`; the three databases and the two tables exist; Postgres holds 5 categories, 978 products (691 active), a stock row for each, at least 500 customers and 2,000 orders. Each ends with `All checks passed`.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| `CLICKHOUSE_HOST must be a bare host name` | `make doctor` says which key | They remove `https://`, any path and `:8443`. |
| `PGPORT is the pooler's port` | `make doctor` | They copied the PgBouncer connection; use the direct one on 5432. |
| `has quotes` / `has a comment after the value` | `make doctor` | They remove the quotes; comments go on their own line. |
| `has Windows line endings` | `make doctor` | They save `.env` with LF endings. |
| `Postgres: could not connect` | `make doctor`; ask whether the instance shows as running | It may still be starting. Otherwise **IP access** must allow their address; check host and password with them (without pasting). |
| `certificate verify failed` | `ls assets/certs/` | `PGSSLROOTCERT` points at the wrong file, or `PGHOST` is not the instance's own host name. |
| `PGSSLROOTCERT=... was not found` | `ls assets/certs/` | The path is relative to the repo root: `assets/certs/ca-certificate.pem`. |
| ClickHouse older than 26.2 | `make doctor` shows the version | Create a new service, or upgrade it in the console. |
| `Cloud API: ... 401` or `403` | `make doctor` | The key or secret is wrong, or the key does not have the Admin role. They create it again. |
| `no service in the organisation has the host ...` | `make doctor` | `CLICKHOUSE_HOST` is not a service of the key's organisation; if the key sees several organisations they add `CLICKHOUSE_CLOUD_ORGANIZATION_ID`. |
| `make setup` stops at a step | The `✗` line and the output above it | Fix what it says and run `make setup` again: finished steps are skipped (and the history is loaded once). |

## Fast track

This module **is** the fast track's setup: steps 1 to 8, then `make-setup`, then `check`. Modules 02 to 08 then become tours.

## Exit criteria

`make check-01` and `make check-02` pass. Update the progress file: module `01` `done`; on the fast track also `notes.setup_done`; `current` module `02` (offer it as optional) or `03`.
