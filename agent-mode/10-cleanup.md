# Module 10: Cleanup (agent playbook)

**Objective:** everything the workshop created is removed, locally and in the cloud, in the right order, so nothing keeps running or costing money.

**Step ids:** `offer`, `stop-load`, `remove-cluster`, `delete-cloud`, `check`, `remove-credentials`.

**Time:** about 10 minutes (about 5 on the fast track, where you can offer only `stop-load` and `remove-cluster`).

**Everything here is destructive. Do each step only after the participant says yes to that step**, and say first exactly what it removes. They may want to keep the cluster and the services for later, or to look at one more thing: that is fine, and "not now" is a complete answer. **You never delete anything in the Cloud**: the participant does that, in the console or in their own terminal.

## Preconditions

They are done or stopping. Read `notes` in the progress file and put right what is left behind: if `card_gateway_broken` is set, run `make fix-card-gateway`; if `test_order_id` is set, delete that order (`make pg-query Q="DELETE FROM orders WHERE id = ID"`, with its id).

## Steps

### 1. `offer` [EXPLAIN] What cleanup does

"Cleanup removes four things, in this order: the local cluster, the cloud services (you do that, in the console), the Admin API key, and the credentials on this machine. The order matters because of what depends on what. Do you want to clean up now, or keep things running?" If they keep things running: mark the module `not_started` and tell them module 10 is there when they want it, and that the cloud services cost money while they exist and that the live generators keep writing into their ClickHouse service until `make traffic-stop`.

### 2. `stop-load` [AGENT RUNS] Stop the load (ask first)

"This stops the live generators and the browser shoppers. Nothing is deleted."

```bash
make traffic-stop
```

It says "nothing to stop" if the application is not running: that is fine.

### 3. `remove-cluster` [AGENT RUNS] Remove the local cluster (ask first)

"`make down` deletes the k3d cluster: the three node containers, the load balancer, their network and volume, and everything that ran inside. Nothing in the cloud is touched, and your Docker images stay (they make the next start two minutes instead of ten). The data in ClickHouse and Postgres stays too."

```bash
make down
```

About 10 seconds. If they also want the disk back, `docker image prune -a` removes every unused image, **including ones from their other projects**: tell them so, and let them run it themselves.

### 4. `delete-cloud` [PARTICIPANT DOES — console] Delete the cloud services, in this order

You never delete cloud resources yourself. They do it in the ClickHouse Cloud console, one at a time, and you wait for "done" after each:

1. **Delete the ClickPipe first.** It holds a replication slot (a bookmark Postgres keeps for the pipe) and a connection to the Postgres instance; if the instance goes first, the pipe is left pointing at nothing. They may prefer to run `make clickpipes-delete` in their own terminal instead of using the console: that is theirs to run, not yours (it deletes the pipe, not the data already in ClickHouse).
   **Now, before anything else is deleted**, confirm it, if they have an API key:

   ```bash
   make clickpipes-status
   ```

   `no ClickPipe named ...` (it exits with an error status: that is the good answer) means it is gone. This needs the ClickHouse service to still exist, which is why it comes now.
2. **Delete the Managed Postgres instance.**
3. **Stop, then delete, the ClickHouse service.** ClickStack's sources and connection go with it.
4. **Delete the API key** they created in module 01 (the organization's **API keys** page). It has the Admin role and would outlive `.env`. If they built an agent in module 09, they can delete it from the Agent Builder too. **If `notes.langfuse` is `done`** (module 09's optional final step), they also delete the Langfuse project, or at least its API keys, in Langfuse Cloud, and remove the Langfuse settings from ClickHouse Agents: the project holds their conversations and a secret key. You never touch either.

### 5. `check` [AGENT RUNS] The checkpoint

```bash
make check-10
```

It cannot see the cloud. Ask them to confirm in the console that the three services and the API key are gone.

### 6. `remove-credentials` [AGENT RUNS] Remove the credentials from this machine (last, ask first)

This is the very last thing you do, after every step and every check, because after it you can no longer run anything against the services. "`.env` holds both passwords and the Cloud API key, and `assets/certs/` holds the Postgres certificate; both are ignored by git and are no longer needed. This deletes them." Only after a clear yes:

```bash
rm .env assets/certs/*.pem
```

(Removing `.env` is the one time you touch it: see the rules in `AGENTS.md`.) Update the progress file, which lives in `.workshop/` and is not affected: module `10` `done`.

## Talking points

- **Dependencies decide the order:** the ClickPipe depends on the Postgres instance (its slot and connection) and on the ClickHouse service (its destination), so it goes first; the services follow.
- **Local and cloud are separate.** `make down` removes only the local cluster; the cloud services keep running (and costing money) until deleted in the console.
- **Credentials are cleaned up too.** A `.env` left on a laptop outlives the services it points at, and an Admin API key outlives both: remove them.
- **Everything can be rebuilt:** `make setup` builds the lot again from module 01 on, in about ten minutes once the images exist.

## Checkpoint

`make check-10` finds no `k3d-clickshop` container, network or volume, and no local kubeconfig. It reminds them of the console order. It ends `All checks passed`.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| `make down` says the cluster does not exist | n/a | It is already gone: nothing to do. |
| `make traffic-stop` says "nothing to stop" | n/a | The application is not running: nothing to do. |
| `check-10` finds containers | `docker ps -a --filter name=k3d` | `make down` again; if Docker was restarted in between, that command shows what is left. |
| The console will not delete the Postgres instance | Ask what message it shows | Delete its ClickPipe first. |
| `make clickpipes-status` fails with an authentication or "no service" error | `make doctor` | The service or the key is already gone: the pipe went with the service. Nothing more to confirm. |
| `make down` or another command fails with "no space left" | `docker system df` | `docker builder prune -f` is safe; anything more is their decision. |

## Fast track

Same. If they are short of time, offer only steps 2 and 3 and tell them to delete the cloud services and the API key later: the console order is in step 4, and the services keep costing money until then.

## Exit criteria

`make check-10` passes and the participant confirms the three cloud services and the API key are gone, and the credentials are removed. Update the progress file: module `10` `done`.

**That is the workshop.** To run it again, start at module 01 (module 00 again only if the Docker images were removed): `make setup` after the services and `.env` are back builds everything.
