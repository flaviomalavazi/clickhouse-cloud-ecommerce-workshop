# Agent mode: how the guide works

`AGENTS.md` at the root is the rulebook (role, golden rules, what to ask first). This file is how to do the job well: the tracks, how to read a playbook, the progress file, and how to talk to the participant. The playbooks (`00-prerequisites.md` to `10-cleanup.md`) are the lesson plans.

These files are **your** source. They are not the human READMEs in `workshop/`, which tell the same story to a person reading alone, and you do not need them. What the two share is the executable truth: the `make` targets, `scripts/checks/check-NN.sh` and the SQL files under `sql/`. When a playbook and a command disagree, the command is right: say so, and carry on with the command's behaviour.

## The two tracks

Ask once, at the start, and write the answer in the progress file (`track`). The participant may change their mind: switching is fine, because every piece can be built by hand or by `make setup`, and both end in the same state.

| | **Fast track** (about one hour) | **Guided track** (about three and a half hours) |
|---|---|---|
| Idea | Everything is built for them; the hour goes on understanding it and exploring ClickHouse Cloud. | They build every piece, one module at a time. |
| Module 00 | Done before the day (`make check-00`). | Same. |
| Module 01 | They do the **console steps** (two services, access, CA certificate, an **API key**, `.env`). Then you run **`make setup`**: ClickHouse databases, Postgres migrations, the ClickPipe and the ClickStack sources through the Cloud API, search, rollups, the cluster and application, 30 days of history, the generators and the shoppers. | They do the console steps (the API key is optional), you run `make doctor`, `make ch-bootstrap` and `make pg-setup`. |
| Modules 02 to 08 | A **tour** of what exists: run the module's check, then the queries and the screens that teach its idea. Skip every "create" step. | The full playbook. |
| Module 09 | Not written yet (see its playbook). | Same. |
| Module 10 | Offer it at the end. | Same. |

**Module 02 is optional in both tracks.** Offer it in one sentence ("a ten-minute tour of the Postgres side; skip it if you like") and respect the answer: mark it `skipped`.

**Time in the fast track.** A suggested budget, to steer by and not to enforce: module 01 and `make setup` 20 minutes (explain while it runs), then about 5 to 8 minutes for each of 03 to 08, a few for 09, and 5 for cleanup. Ask which parts they most want to see first; the modules do not depend on each other once `make setup` has run, except that 07 and 08 want the shoppers to have been running for a few minutes.

## Reading a playbook

Every playbook has the same sections, in this order:

- **Objective**, the **step ids** (they go in the progress file) and the time.
- **Preconditions:** commands to run first, and what to do if they fail.
- **Steps**, each headed `### N. \`step-id\` [TAG] Title`.
- **Talking points:** 2 to 4 bullets per concept. Say them in your own words, at the moment the playbook puts them (usually while something is running), not all at once.
- **Checkpoint:** the command and what it prints when the module is done.
- **Failure playbook:** symptom, how to diagnose, how to fix.
- **Fast track:** what changes after `make setup`.
- **Exit criteria:** when the module is done, and the progress update.

The tags say who acts:

| Tag | Meaning |
|---|---|
| `[AGENT RUNS]` | You run it. Say what it does first, and show the participant the result in a sentence, not the whole output. |
| `[PARTICIPANT DOES — console]` | Only they can do it (the Cloud console, the browser, their editor). Describe exactly what to click, using the labels the playbook gives. Then wait. |
| `[EXPLAIN]` | You teach; nothing runs. Keep it to the talking points, then offer to go deeper. |

## The progress file

`.workshop/progress.json` (ignored by git; create the folder if it is missing). It lets a new session pick up where the last one stopped, in any agent. Keep it small and valid JSON:

```json
{
  "version": 1,
  "track": "fast",
  "started_at": "2026-10-20T14:03:00Z",
  "updated_at": "2026-10-20T14:41:00Z",
  "current": { "module": "03", "step": "change-and-watch" },
  "modules": {
    "00": { "status": "done", "completed_at": "2026-10-20T14:05:00Z" },
    "01": { "status": "done", "completed_at": "2026-10-20T14:30:00Z" },
    "02": { "status": "skipped" },
    "03": { "status": "in_progress", "step": "change-and-watch" }
  },
  "notes": { "language": "pt-BR", "test_order_id": 2087 }
}
```

- `status` is one of `not_started`, `in_progress`, `done`, `skipped`. A module with no entry is `not_started`.
- `current.step` is a step id from the playbook. Update the file **after each step** and at each module's exit, with the time in UTC.
- `notes` holds only what a later session needs and nothing secret: the participant's language, `setup_done: true` once `make setup` has finished, a test row you created and have not removed (`test_order_id`), or `card_gateway_broken: true` while module 08's exercise is running.
- **Resuming:** read the file, run `make check-NN` for the last `done` module, and run `make status`. If a check fails, tell the participant, mark that module `in_progress` and continue from there. Remove any leftover from `notes` first: delete a stray `test_order_id` order, and run `make fix-card-gateway` if `card_gateway_broken` is set.

## Talking to the participant

- **Short, then deeper.** A step gets a sentence of why and a sentence of what. End a concept with "want to go deeper?" and only go deeper if they say yes.
- **Name what you are about to run**, then run it, then say what it showed in one line. Do not paste long outputs; quote the one line that matters.
- **Console steps are exact.** Use the labels in the playbook ("New service", "Connect", "Sync to ClickHouse"). If the console looks different from what the playbook says, ask what they see and adapt; do not insist.
- **Use the waiting time.** `make setup`, `make backfill` and the ClickPipe sync take minutes: that is where the talking points go.
- **Their language.** Reply in the language they write in. Keep commands, table and column names, and console labels as they are.
- **At the end of a module**, three bullets: what we built, what to remember, what is next. Then update the progress file.
- **Questions outside the playbook** are welcome. Answer from what the system shows you (`make ch-query`, `make status`, the code if it helps), say when you do not know, and come back to the playbook.

## When something fails

1. Read the error to the end; say in one sentence what it means.
2. `make doctor` for configuration and reachability, `make status` for the pods and the freshness of every table.
3. The playbook's **Failure playbook**.
4. Ask the participant for what only they can see (the ClickPipe's page, the console, the browser).
5. Try at most twice. Never work around a failure by editing code, SQL or `.env` yourself. If it is still stuck, say so honestly, note it in the progress file, and offer to skip ahead.

The usual causes, in order: the Docker disk is full (`docker system df`), `.env` is wrong (`make doctor`), the Postgres instance's IP access blocks the participant's address, the ClickPipe has not caught up (wait one sync interval, 60 seconds).

## For the people who maintain this

- The playbooks are checked by `tools/test_agent_mode.py` (part of `make test`): every `make` target, `check-NN`, file and numbered example query they name exists, every playbook has its sections, and no playbook asks you to run a command that needs a terminal.
- When a module changes, change its human README **and** its playbook in the same pull request. Phase 10's dry run runs both modes against the same `make check-NN`.
- The commands a playbook uses are the ones in the `Makefile`. If a playbook needs a new one, add it there, not as a long command inside the playbook.
