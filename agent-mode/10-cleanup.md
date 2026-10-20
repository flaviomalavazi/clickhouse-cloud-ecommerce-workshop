# Module 10: Cleanup (agent playbook)

**Objective:** everything the workshop created is removed, locally and in the cloud, in the right order, so nothing keeps running or costing money.

**Step ids:** `offer`, `stop-load`, `remove-cluster`, `delete-cloud`, `remove-credentials`, `check`.

**Time:** about 10 minutes.

**Everything here is destructive. Do each step only after the participant says yes to that step**, and say first exactly what it removes. They may want to keep the cluster and the services for later, or to look at one more thing: that is fine, and "not now" is a complete answer.

## Preconditions

They are done or stopping. Read `notes` in the progress file and put right what is left behind: if `card_gateway_broken` is set, run `make fix-card-gateway`; if `test_order_id` is set, delete that order (`make pg-query Q="DELETE FROM orders WHERE id = ID"`, with its id).

## Steps

### 1. `offer` [EXPLAIN] What cleanup does

"Cleanup removes three things, in this order: the local cluster, the cloud services (you do that in the console), and the credentials on this machine. The order matters because of what depends on what. Do you want to clean up now, or keep things running?" If they keep things running: mark the module `not_started` and tell them module 10 is there when they want it (and that the cloud services cost money while they exist).

### 2. `stop-load` [AGENT RUNS] Stop the load (ask first)

"This stops the live generators and the browser shoppers. Nothing is deleted."

```bash
make traffic-stop
```

### 3. `remove-cluster` [AGENT RUNS] Remove the local cluster (ask first)

"`make down` deletes the k3d cluster: the three node containers, the load balancer, their network and volume, and everything that ran inside. Nothing in the cloud is touched, and your Docker images stay (they make the next start two minutes instead of ten). The data in ClickHouse and Postgres stays too."

```bash
make down
```

About 10 seconds. If they also want the disk back, `docker image prune -a` removes every unused image, **including ones from their other projects**: tell them so, and let them run it themselves.

### 4. `delete-cloud` [PARTICIPANT DOES — console] Delete the cloud services, in this order

You never delete cloud resources yourself. They do it in the ClickHouse Cloud console:

1. **Delete the ClickPipe first.** It holds a replication slot and a connection to the Postgres instance; if the instance goes first, the pipe is left pointing at nothing. (If they prefer and say so, with an API key `make clickpipes-delete` does this one step: ask first, and say it deletes the pipe, not the data already in ClickHouse.)
2. **Delete the Managed Postgres instance.**
3. **Stop, then delete, the ClickHouse service.**

After the pipe is gone, with an API key you can confirm it:

```bash
make clickpipes-status
```

`no ClickPipe named ...` means it is gone. Wait for "done" after each of the three.

### 5. `remove-credentials` [AGENT RUNS] Remove the credentials from this machine (last, ask first)

"`.env` holds both passwords and the Cloud API key, and `assets/certs/` holds the Postgres certificate; both are ignored by git and are no longer needed. This deletes them, and after it I can no longer run anything against the services."

```bash
rm .env assets/certs/*.pem
```

Do this last, after every other step and every check, and only after a clear yes.

### 6. `check` [AGENT RUNS] The checkpoint

```bash
make check-10
```

It cannot see the cloud. Ask them to confirm in the console that the three services are gone.

## Talking points

- **Dependencies decide the order:** the ClickPipe depends on the Postgres instance (its slot and connection) and on the ClickHouse service (its destination), so it goes first; the services follow.
- **Local and cloud are separate.** `make down` removes only the local cluster; the cloud services keep running (and costing money) until deleted in the console.
- **Credentials are cleaned up too.** A `.env` left on a laptop outlives the services it points at; remove it.
- **Everything can be rebuilt:** `make setup` builds the lot again from module 00 on, in about ten minutes once the images exist.

## Checkpoint

`make check-10` finds no `k3d-clickshop` container, network or volume, and no local kubeconfig. It reminds them of the console order. It ends `All checks passed`.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| `make down` says the cluster does not exist | n/a | It is already gone: nothing to do. |
| `check-10` finds containers | `docker ps -a --filter name=k3d` | `make down` again; if Docker was restarted in between, that command shows what is left. |
| The console will not delete the Postgres instance | Ask what message it shows | Delete its ClickPipe first. |
| `make down` or another command fails with "no space left" | `docker system df` | `docker builder prune -f` is safe; anything more is their decision. |

## Fast track

Same. If they are short of time, offer only steps 2 and 3 and tell them to delete the cloud services later: the console order is in step 4, and the services keep costing money until then.

## Exit criteria

`make check-10` passes and the participant confirms the three cloud services are gone. Update the progress file (it lives in `.workshop/`, which removing `.env` does not touch): module `10` `done`.

**That is the workshop.** To run it again, start at module 00 (`make setup` after the services and `.env` are back builds everything).
