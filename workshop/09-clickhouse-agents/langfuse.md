# Optional final step: monitor your agent with Langfuse

> **Draft, like the rest of module 09.** The Langfuse half of this page (the account, the project, the keys) follows Langfuse's own documentation. The ClickHouse Agents half (where the keys go) is **not documented anywhere the workshop could read**, so it is marked **TODO(owner)** and has to be checked in the console before the workshop. The banner and the notes go when it is.

**Goal:** see what your `clickshop-analyst` does behind the answer (each question, the model's calls, the SQL it ran, how long it took and what it cost) in **Langfuse Cloud**, and learn what to look at when an agent misbehaves.

**Time:** about 15 minutes. It is **optional** and it is not in the workshop's total time.

**You'll learn:**
- what **tracing** an LLM application means: a *trace* per question, a *session* per conversation;
- how to create a Langfuse account, a project and an API key pair;
- how to read a trace next to the SQL you checked in module 09.

## Before you start

- You finished [module 09](README.md) up to step 6: `clickshop-analyst` exists and has answered questions.
- You are an **organization admin** in ClickHouse Cloud. ClickHouse's changelog (17 August 2026) says that organization administrators can open the matching Langfuse session straight from a ClickHouse Agents chat, in **Public Beta**, **for newly created chats only**. Conversations you had before connecting Langfuse will not appear.
- You have an email address for a new account and a few minutes. Langfuse Cloud's free **Hobby** plan is enough and asks for no credit card (at the time of writing: 50,000 units a month and 30 days of history; the pricing page has the current numbers).
- **Use the workshop's data only.** A trace keeps the whole conversation: your questions, the instructions, the SQL and the rows the agent saw. ClickShop's data is synthetic, so that is fine here. Do not connect a Langfuse project to an agent that reads real customer data unless your organization has agreed to it.

## Steps

### 1. Create a Langfuse Cloud account

Open <https://cloud.langfuse.com> (the **EU** region) or <https://us.cloud.langfuse.com> (the **US** region), click **Sign up** and create the account with your email (or a sign-in option the page offers). Confirm the email if it asks.

Pick **one region and stay in it**: an account, its projects and its keys belong to the region where you signed up, and a key from one region does not work against the other. Langfuse also runs a Japan region (`jp.cloud.langfuse.com`) and a HIPAA region (`hipaa.cloud.langfuse.com`); the workshop does not need them.

### 2. Create an organization and a project

The first time you sign in, Langfuse asks you to create an **organization** (a name such as `clickshop-workshop`) and then a **project** (`clickshop-analyst`). Skip the invitation step. A project is where one application's traces live, and the API keys belong to it.

### 3. Create the API keys

In the project, open **Settings** and then **API Keys**, and click **Create new API key** (you can give it a note, such as `clickhouse-agents`). Langfuse shows a pair:

| What | Looks like | Notes |
|---|---|---|
| **Public key** | `pk-lf-...` | Safe to read out loud; it identifies the project. |
| **Secret key** | `sk-lf-...` | **Shown once.** Copy it now: if you lose it, create another pair. |
| **Host** | `https://cloud.langfuse.com` (EU) or `https://us.cloud.langfuse.com` (US) | The one of the region you signed up in. |

Treat the secret key like a password. It does not go in `.env` (nothing in the workshop uses it), in a file in this repository, or in a chat with a coding agent: you will paste it only into the ClickHouse console, in the next step.

### 4. Give the keys to ClickHouse Agents

> **TODO(owner): verify in the console.** Nothing in ClickHouse's or Langfuse's documentation says where an organization administrator enters a Langfuse public key, secret key and host for ClickHouse Agents, or whether ClickHouse Agents asks for them at all (the changelog says only that admins can *open* the Langfuse session from a chat). Walk through it once, and write here: where the setting is (an organization-level page, or the agent's own settings); the labels of the three fields; whether it applies to every agent or to one; and how long it takes to apply.

Whatever the screen is called, it asks for the same three things from step 3: the **public key**, the **secret key** and the **host** (the base URL of your Langfuse region). Enter them there, save, and **create a new chat**: only new conversations are traced.

For comparison, Langfuse documents the same three values for LibreChat, the open-source chat application in ClickHouse's Agentic Data Stack (as the settings `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL`, after which every message is traced): <https://langfuse.com/integrations/other/agentic-data-stack>.

### 5. Ask something worth tracing

In a **new conversation** with `clickshop-analyst`, ask three things:

1. A question from [`questions.md`](agents/clickshop-analyst/questions.md) that needs one table (the revenue by payment method).
2. One that needs two databases (the first page and traffic source of the orders).
3. One it should get wrong without a rule: *"How many card transactions look corrupted?"* if you have not yet told it that chargebacks are negative by design (module 09, step 6).

### 6. Read the traces

In Langfuse, open your project and then **Tracing**: **Traces** lists one row per question, and **Sessions** groups the traces of one conversation. (If the labels differ, trust the screen: the idea is *one conversation, one session; one question, one trace*.)

Open the trace of the third question and look at, in this order:

- **The input and the output**: the question, and what the agent answered.
- **The tool calls**: the SQL it ran against your service. This is the same SQL you asked it to show in module 09, step 5, but you no longer have to ask.
- **Latency**: how long the whole question took, and which step took most of it.
- **Tokens and cost**: how many tokens went in and out, and what that cost. The instructions and the data dictionary are part of every question, so they dominate it.

Now take the SQL from the tool call, run it with `make ch-query Q='...'`, and compare the numbers with the agent's answer, as you did in module 09.

### 7. Close the loop

Change the instructions (module 09, step 6) and ask the same question again in a new conversation. In Langfuse compare the two traces: did the SQL change, and did the cost and the time change with it? Longer instructions cost tokens on every question, so each rule has to earn its place.

If you want more: Langfuse can **score** a trace by hand (a thumbs up or down with a comment) or with an automated evaluator, which is how teams notice that an agent got worse after an edit. That is beyond this workshop.

## Checkpoint

There is no automated check: both halves are in a browser. You are done when:

- your Langfuse project shows at least one **session** from a conversation with `clickshop-analyst`;
- you found, in a trace, the SQL the agent ran, and compared it with the same SQL run by hand;
- you can say what a trace and a session are, and what you would look at first when an agent gives a wrong answer.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Nothing appears in Langfuse | Only **newly created** chats are traced: start a new conversation after saving the keys. Then check that the host is the base URL of the region where you signed up, and that you did not paste the keys into the wrong fields. |
| The key pair does not work | A key belongs to one project **and one region**. Create a new pair in the project (step 3), with the host of its region. |
| You lost the secret key | It is shown only once. Create another pair and delete the old one. |
| You cannot find where to enter the keys | You may not be an organization admin, or the feature is not on for your organization (it is in Public Beta). Ask an admin. (TODO(owner): document the screen.) |
| The traces show the question but not the SQL | The agent answered without calling a tool. Ask something that needs the data, and look at the trace of that question. |
| Langfuse asks for a card | You picked a paid plan. The **Hobby** plan is free. |

## Clean up

When you are done, in Langfuse open the project's **Settings** and **delete the API keys** (or delete the project, and the organization if you made it only for this). Then remove the Langfuse settings from ClickHouse Agents (TODO(owner): where) or delete the agent, as [module 10](../10-cleanup/README.md) says. The traces in Langfuse stay until you delete the project or the plan's retention ends: they hold your conversations.

**Back to:** [module 09](README.md). **Next:** [module 10, Cleanup](../10-cleanup/README.md).
