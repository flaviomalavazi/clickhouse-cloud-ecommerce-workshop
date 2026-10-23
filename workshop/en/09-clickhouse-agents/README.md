# Module 09: ClickHouse Agents

**Goal:** ask the data you built questions in plain language with **ClickHouse Agents**, and learn to check an agent's answer against SQL you trust.

**Time:** about 25 minutes (an estimate: it has not been timed).

**You'll learn:**
- what an agent is: **instructions**, a **model** and **tools**, and why instructions that describe your schema and your business rules decide how good the answers are;
- how to read the SQL an agent ran, and to check it;
- sharing an agent, and what its memory does, briefly.

## Before you start

- `make check-08` passes (module 08).
- The data is flowing. Questions about "the last hour" or "right now" need the generators and the shoppers running: `make status` shows the freshness of every table, and `make traffic-start` starts them (`make setup` leaves them running).
- ClickHouse Agents is a **Beta** feature of ClickHouse Cloud. Creating an agent needs the **Create agent** option; if you do not see **Create New Agent** below, an organization admin has to grant it.

> **TODO(owner): verify in the console.** The documentation does not say: whether the feature is available in trial organizations; the exact name and place of the permission (the quickstart says "Admin Settings", the sharing page does not use that name); which model options the dropdown shows (the launch post says Claude Sonnet and Haiku are the defaults).

## Steps

### 1. Open ClickHouse Agents

In the ClickHouse Cloud console, open your `clickshop` service and click **ClickHouse agents** (marked Beta) in the left sidebar, then **Launch ClickHouse agents**. That opens the **Agent Builder**. (The same product is also at <https://ai.clickhouse.cloud/>.)

### 2. Create the analyst

In the Agent Builder click **Create New Agent** at the top of the left panel and fill in the form:

| Field | Value |
|---|---|
| **Name** | `clickshop-analyst` |
| **Description** | what it is for, in a sentence a teammate understands (the field is visible to the people you share it with) |
| **Category** | `General` |
| **Instructions** | the system prompt: its role, the tables it should use, the business rules. [`agents/clickshop-analyst/instructions.md`](agents/clickshop-analyst/instructions.md) has the text (a draft the workshop's owner is reviewing): replace the two placeholders with your organization and service ids first |
| **Model** | pick one from the dropdown |

The instructions are the part that matters most. Everything the agent should know about ClickShop and cannot guess goes there: that the replicated Postgres tables are read with `FINAL` and `_peerdb_is_deleted = 0`, that prices are in USD, which events make the funnel. [`docs/data-dictionary.md`](../../../docs/data-dictionary.md) lists all of it, table by table: attach it to the agent as **File Context**, and the instructions refer to it.

### 3. Choose what it can do

The main panel has **Capabilities**, toggles for what the agent may use: **Run Code**, **Web Search**, **File Context**, **Artifacts**, **MCP Servers** and **Skills**. **Add Tools** at the bottom opens a catalogue of third-party integrations, and **Advanced settings** holds **subagents**. You can change all of it later.

For an analyst of your own data, keep what you need to read the data and chart it, and leave **Web Search** off: you want answers that come from your tables and not from the internet.

> **TODO(owner): verify in the console.** The documentation does not say how an agent reaches the data of your ClickHouse service. Check, and write down here: whether the agent queries the service through a built-in tool or whether a ClickHouse MCP server has to be attached (**MCP Servers**, **Add Tools**); which database user or role its queries run as; whether that access is read-only (the Managed Postgres announcement says its Postgres access is "read-only by default"; nothing says it for ClickHouse); and where in a conversation you can see the SQL the agent ran.

### 4. Ask the first questions

Save the agent, open a **new conversation**, and select `clickshop-analyst` in the agent picker. Ask it something that needs one table first, then something that needs two databases. [`agents/clickshop-analyst/questions.md`](agents/clickshop-analyst/questions.md) has candidate questions across the whole shop: revenue, the funnel, searches that found nothing, inventory, the freshness of the replica, card anomalies. (The documentation's own example is "What are my top 10 tables by row count this week?")

The agent plans, calls its tools, and answers with a table or a chart.

### 5. Check an answer

An agent that sounds sure can still be wrong, so do this every time:

1. Ask: *"Show me the SQL you ran."*
2. Read it. Does it read `retail_oltp` with `FINAL` and `_peerdb_is_deleted = 0`? Does it filter `is_active`? Does it sum `bill_value` across currencies (it must not)? Did it take the window you meant?
3. Run the same SQL in the SQL console, or with `make ch-query Q='...'`, and compare the numbers.
4. For the questions the examples already answer (`sql/clickhouse/examples/`), compare with those: for instance `make ch-query FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=2` is the funnel.

When an answer is wrong, the fix is usually in the **instructions**, not in the question.

### 6. Make it better

Take a question the agent got wrong or half right. Add one rule to the **Instructions** that would have prevented it (the data dictionary says which), save, and ask the same question in a new conversation. This loop, wrong answer, a rule, a better answer, is how a useful agent is built.

### 7. Share it, and what memory does

To share the agent, open its **Share** dialog: search for a person or a group, choose their access level (**Viewer** can use it, **Editor** can change it, **Owner** can also delete and share it), and click **Save Changes**. A switch shares it with the whole organization, which also makes it appear in the marketplace if your admin has turned that on.

**Memory** keeps small facts across conversations: a preferred date format, the database you usually query. It is private to each person (nobody else's agents see yours). Open it from the **Memories** icon in the left navigation; the **Use memory** checkbox at the top turns it off. For a workshop, switch it off so an answer does not depend on what you asked before.

> **TODO(owner): verify in the console.** The exact labels of the Share dialog (the organization-wide switch in particular), and whether the saved **Prompts** library (the documentation lists it but does not describe it) is worth a step here.

## Checkpoint

There is no automated check: the agent lives in the console. You are done when:

- `clickshop-analyst` exists and answered at least one question about each database (`retail_oltp`, `retail_analytics`, `retail_otel`);
- you checked at least one answer by running its SQL yourself;
- you changed the instructions once and saw the answer change.

## Troubleshooting

| Symptom | Fix |
|---|---|
| **ClickHouse agents** is not in the sidebar | It is a Beta feature. Check with your organization's admin; trial availability is not documented. (TODO(owner): confirm.) |
| There is no **Create New Agent** button | You need the **Create agent** option: an organization admin grants it. |
| The agent says it cannot reach your data | Its tools are not set up for the service. See the note in step 3. (TODO(owner): document the fix.) |
| The numbers differ from your own SQL | Read its SQL (step 5). The usual causes: no `FINAL` or no `_peerdb_is_deleted = 0` on a `retail_oltp` table, inactive products counted, `bill_value` summed across currencies, a different time window. |
| It finds nothing for "the last hour" | The load is stopped: `make status` shows how old each table is; `make traffic-start`. |
| It counts `negative` card amounts as anomalies and the number is huge | Chargebacks are negative by design. The instructions must say to look at `expense` rows only (see the data dictionary). |

## Going further

- Ask for a chart: the **Artifacts** capability renders one.
- **Monitor the agent with Langfuse Cloud** (the optional final step): [a page of its own](langfuse.md) takes you from creating a Langfuse account and its API keys to reading the trace of each question your analyst answers.
- Create a second agent for observability only (`retail_otel`: traces, logs, metrics), with its own instructions, and ask it about the card gateway exercise from module 08.
- **Subagents** (under **Advanced settings**) let one agent hand work to another, for example an analyst that asks an observability agent.
- Managed Postgres has its own agent integration (it can query the Postgres instance directly and combine it with ClickHouse in one question). TODO(owner): find out how to enable it, and whether it is worth adding to this module.

**Optional final step:** [monitor the agent with Langfuse](langfuse.md) (about 15 minutes, not in the total).

**Next:** [module 10, Cleanup](../10-cleanup/README.md).
