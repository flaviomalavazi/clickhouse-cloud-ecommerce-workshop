# Module 09: ClickHouse Agents (agent playbook)

**Objective:** the participant builds an analyst with **ClickHouse Agents** in the Cloud console, asks it questions about the data they built, learns to check an answer against SQL, and improves the agent by improving its instructions.

**Step ids:** `check-ready`, `explain-agents`, `open-agents`, `create-agent`, `capabilities`, `first-questions`, `check-an-answer`, `improve-instructions`, `share-and-memory`, `fallback-sql`.

**Time:** about 25 minutes (an estimate, not timed); fast-track tour about 12.

**Beta, and not yet walked through in the console.** ClickHouse Agents is a Beta feature and its screens are in the console, where you cannot see them. The labels below come from ClickHouse's documentation. **If the participant's screen differs, trust the screen**: ask what they see and adapt, and do not insist on a label. Several things the documentation does not say are still being checked by the workshop's owner (how the agent reaches the service's data, which database role it uses, whether that is read-only, trial availability): never state them as facts, and do not invent screens, labels or prompts.

## Preconditions

```bash
make check-08
make status
```

`check-08` should pass (do not hold the participant back if it does not). Questions about "the last hour" need traffic: if `make status` shows the clickstream tables are old, `make generators-start` and `make sim-start USERS=4` (the fast track's `make setup` already left them running).

## Steps

### 1. `check-ready` [AGENT RUNS] Is there data to ask about?

Run the two commands above and tell the participant in a sentence: "everything we built is here to ask about: the orders and catalogue, the clickstream and card transactions, the telemetry."

### 2. `explain-agents` [EXPLAIN] What an agent is

An agent is **instructions** (who it is, what it knows, what rules it follows), a **model**, and **tools** (what it may do, such as running queries or code). It interprets the question, plans, calls its tools and answers. The quality of the answers depends on the instructions as much as on the model: an agent that does not know that the replicated Postgres tables need `FINAL` will write plausible SQL that is wrong. That is what the module is about.

### 3. `open-agents` [PARTICIPANT DOES — console] Open ClickHouse Agents

"In the console open your `clickshop` service and click **ClickHouse agents** (marked Beta) in the left sidebar, then **Launch ClickHouse agents**. That opens the Agent Builder." (The same product is at <https://ai.clickhouse.cloud/>.) If it is not in the sidebar, the feature is Beta and may not be enabled for their organization: ask them to check with an organization admin, and go to step 10 if it cannot be fixed now.

### 4. `create-agent` [PARTICIPANT DOES — console] Create the analyst

"Click **Create New Agent** at the top of the left panel and fill in: **Name** `clickshop-analyst`; **Description** a sentence a teammate would understand; **Category** `General`; **Instructions**; **Model** (pick one from the dropdown)." If there is no **Create New Agent**, they need the **Create agent** option, which an organization admin grants.

The instructions are the part that matters. Their text is in `workshop/09-clickhouse-agents/agents/clickshop-analyst/instructions.md`:

```bash
head -5 workshop/09-clickhouse-agents/agents/clickshop-analyst/instructions.md
```

- **If it is the final text** (the first lines have no `TODO(owner)`): show it in the terminal with `cat`, and tell them to copy it into the **Instructions** field themselves. It has two placeholders, `<ORG_ID>` and `<SERVICE_ID>`, which they fill in with their own organization and service ids from the console (they are not secrets, but you do not know them: ask them to put them in). The text expects `docs/data-dictionary.md` to be attached to the agent as file context, so tell them to attach it (**File Context**).
- **If the first lines contain `TODO(owner)`**, the workshop's instructions are still a draft the owner is reviewing. Say so plainly. Do not present a draft as the official text. You may still use it, or offer to write a first version **with** them from `docs/data-dictionary.md` (section 2, "Rules every query must follow", is the core): they decide the rules, you write them down, and they paste the result. That is a good exercise, not a stopgap.

### 5. `capabilities` [PARTICIPANT DOES — console] What it may do

"The main panel has **Capabilities**, toggles for what the agent may use: **Run Code**, **Web Search**, **File Context**, **Artifacts**, **MCP Servers**, **Skills**. **Add Tools** at the bottom opens a catalogue of integrations, and **Advanced settings** has subagents." Suggest leaving **Web Search** off (the answers should come from their tables) and keeping what is needed to read the data and to chart it. Ask them whether the agent can query their ClickHouse service as it stands: if it cannot, they look at **MCP Servers** and **Add Tools** for a ClickHouse option. This is one of the unknowns: write down what they find (in your reply, not in a file) and, after two attempts, move to step 10 instead of burning the hour.

### 6. `first-questions` [PARTICIPANT DOES — console] Ask the first questions

"Save the agent, open a **new conversation**, select `clickshop-analyst` in the agent picker, and ask." Start with a question on one table, then one that needs two databases. The candidate questions are in `workshop/09-clickhouse-agents/agents/clickshop-analyst/questions.md`, with the SQL to check each. While they ask, run the check yourself so you already know the right answer, for example:

```bash
make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=2
make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=3
make ch-query FILE=sql/clickhouse/examples/07_simulated_shoppers.sql N=4
```

(2 is the funnel, 3 the searches that found nothing, 4 the freshness of the replica.) The other candidates' SQL is in the questions file: read the statement there and run it with `make ch-query Q='...'`.

### 7. `check-an-answer` [AGENT RUNS] Check an answer

Do this on every answer, and make the participant do the thinking:

1. They ask the agent: "Show me the SQL you ran." and read it out (or paste it into the chat: it is SQL, not a secret).
2. Review it together against the data dictionary: does it read `retail_oltp` with `FINAL` and `_peerdb_is_deleted = 0`? Filter `is_active`? Sum `bill_value` across currencies (it must not)? Count chargebacks as negative anomalies? Treat `Duration` as milliseconds (it is nanoseconds)? Take the window they meant?
3. Run the same SQL with `make ch-query Q='...'` and compare the numbers with the agent's.

When it is wrong, the lesson is that the fix belongs in the **instructions**, not in a cleverer question.

### 8. `improve-instructions` [PARTICIPANT DOES — console] Make it better

"Take a question it got wrong or half right. Add one rule to the Instructions that would have prevented it, save, and ask the same question in a new conversation." The participant picks the rule; point them at `docs/data-dictionary.md` if they are not sure which one. Compare the two answers. This loop, wrong answer, a rule, a better answer, is the skill.

### 9. `share-and-memory` [EXPLAIN] Share it, and what memory does

Keep it to a minute. **Sharing:** the agent's **Share** dialog (search a person or group, choose **Viewer**, **Editor** or **Owner**, **Save Changes**; a switch shares it with the whole organization). **Memory:** a small private, per-user store of facts the agent recalls across conversations (the **Memories** icon, the **Use memory** checkbox): suggest switching it off for the workshop so an answer does not depend on earlier chats. The documentation says nothing about whose credentials a shared agent uses to read data: do not claim anything about it.

### 10. `fallback-sql` [AGENT RUNS] Only if the agent cannot be built or cannot reach the data

Say honestly that this part depends on a Beta feature that is not available to them right now. Then do the useful half anyway: ask them a business question and write the SQL together with `make ch-query`, using the data dictionary. A few that use everything at once: revenue by payment method (`retail_oltp.orders FINAL`, `_peerdb_is_deleted = 0`); the conversion of sessions to orders (the funnel, number 2 of `sql/clickhouse/examples/06_real_time_analytics.sql`, against the orders of module 07); the slowest `clickhouse.query` spans (`retail_otel.otel_traces`). Mark the module `skipped` with the reason in `notes`.

## Talking points

- **An agent is instructions, a model and tools.** The model is the same for everyone; what you know about your business, and write into the instructions, is what makes the agent yours.
- **Why plain language works well here:** the tables are named and typed clearly, joined by keys that mean something (the order id, the browser id), and live in one service, so an agent that can see the schema can write the SQL you would.
- **Never trust, always check:** the SQL it ran, the time window, the units and the currency, and the numbers against a query you trust. An answer without its SQL cannot be checked.
- **Instructions are where domain knowledge goes:** `FINAL` on replicated tables, USD versus the card's currency, chargebacks negative by design, what "revenue" means. Each rule in the data dictionary is a mistake an agent would otherwise make.
- **Beta:** behaviour and screens may change; the habit of checking does not.

## Checkpoint

There is no automated check for this module: the agent lives in the console. The module is done when: `clickshop-analyst` exists and answered a question about each database; the participant checked at least one answer by running its SQL; and they changed the instructions once and saw the answer change.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| **ClickHouse agents** is not in the sidebar | Ask what they see; ask whether they can reach <https://ai.clickhouse.cloud/> | A Beta feature that may not be enabled for their organization (trial availability is not documented): an organization admin may have to enable it. If not now, step 10. |
| There is no **Create New Agent** | Ask what the Agent Builder shows | They need the **Create agent** option: an organization admin grants it. |
| The agent says it cannot reach the data | `make doctor` confirms the service itself is fine | Its tools are not set up for the service: look at **Capabilities** and **Add Tools** (step 5). After two attempts, step 10. |
| Its numbers differ from `make ch-query` | Compare its SQL with yours | The usual causes: no `FINAL` or no `_peerdb_is_deleted = 0` on `retail_oltp`; inactive products counted; `bill_value` summed across currencies; negative card amounts counted on chargebacks; another time window. |
| It finds nothing for "the last hour" | `make status` shows how old each table is | The load is stopped: `make generators-start` and `make sim-start USERS=4`. |
| Question 9 (cancelled orders) finds none | `make ch-query Q="SELECT status, count() FROM retail_oltp.orders FINAL WHERE _peerdb_is_deleted = 0 AND created_at > now() - INTERVAL 1 DAY GROUP BY status"` | Nothing is cancelled until module 08's gateway exercise has run; that is not an error. |

## Fast track

`make setup` built and loaded everything, so there is nothing to prepare: steps 1 and 2, then the console steps 3, 4, 5 and 6 in about 8 minutes, step 7 (checking one answer) and step 8 (one improvement), which are the point of the module. Skip step 9 unless they ask.

## Exit criteria

The checkpoint above, or the module was skipped with the reason in `notes`. Update the progress file: module `09` `done` or `skipped`; `current` module `10`.
