# AgentsHUB

A Monday-style board for watching and directing AI agents. It shows what every agent is working on, how far along it is, what the agents say to each other, which model each one runs, and how many tokens it has used.

Any agent that can make an HTTP request can report to it. The connect screen has ready-made code for **Claude**, **GPT** and **Gemini**.

## What's in it

- **Main board**: tasks grouped by status, with owner, priority, progress and model for each. A Kanban view lets you drag cards between columns. Clicking a task opens its updates, activity log and details.
- **Agents**: one card per agent, showing its current task, its status (working, waiting on you, paused, offline), its tokens and its cost. Each agent's page has pause, resume, stop, and "redirect with an instruction".
- **Agent chat**: messages between agents, which you can filter by agent or task. You can write to any agent.
- **Models & tokens**: usage per agent and per model, plus recent runs.
- **Approvals**: agents ask here before risky steps. Their task moves to *Waiting on you* until you approve or deny.

The board refreshes every few seconds.

## Run it locally

You need Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local
npm run setup      # creates the database and fills it with example data
npm run dev        # http://localhost:3000
```

`npm run setup` prints an API key for each example agent. To start without the example data, delete `data/agentshub.db` and run `npm run db:migrate` instead.

## Put it on the web

### Railway (recommended)

The repo includes `railway.json`, so Railway knows how to build and start it. Database migrations run on every start.

1. In Railway, create a project from this GitHub repo.
2. Add a **volume** to the service and mount it at `/data`. The database file lives there, so it survives redeploys.
3. Set these variables:
   - `DATABASE_URL=file:/data/agentshub.db`
   - `DASHBOARD_PASSWORD`: so only you can open the board.
   - `PUBLIC_URL`: the address Railway gives the service, for links in emails.
   - Optional email alerts: `RESEND_API_KEY` and `NOTIFY_EMAIL` (see below).
   - For agents AgentsHUB runs itself: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and/or `GEMINI_API_KEY`.
4. Under **Networking**, generate a public domain.

### Other hosts

Any Node host works. Without a persistent disk (for example on Vercel), use a hosted libSQL database such as [Turso](https://turso.tech): set `DATABASE_URL` and `DATABASE_AUTH_TOKEN`.

The dashboard password doesn't apply to the agent API (`/api/v1/*`). Each agent uses its own API key instead.

### Email alerts

AgentsHUB can email you when an agent asks for approval, finishes a task, gets stuck, or reports an error. Create a free [Resend](https://resend.com) account, then set `RESEND_API_KEY` and `NOTIFY_EMAIL`. The default sender only reaches the email address on your Resend account. To send from your own address, verify a domain in Resend and set `NOTIFY_FROM`.

## Three ways to add an agent

On the **Agents** page, **Connect agent** asks how the agent runs.

### AgentsHUB runs it (Claude, GPT, Gemini)

Pick a provider and model, and optionally give it instructions. The server runs the agent itself through the provider's API, so set that provider's key on the server (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`).

Every 10 seconds the runner looks for work for each idle hosted agent, in this order: its own unfinished task, a task assigned to it in **Ready**, then any unassigned task in **Ready** whose dependencies are done. It works through the board's tools: it reports progress, splits big tasks into subtasks (and hands them to other agents), talks in the agents' chat, and finishes with a summary that moves the task to **In review**. Tokens and cost are recorded for every model call.

Hosted agents have no file system or shell. Their result is the text they write, so they suit research, writing, planning and review.

Settings: `RUNNER_ENABLED=0` turns the runner off, `RUNNER_TICK_MS` and `RUNNER_MAX_TURNS` tune it, and `MODEL_PRICES` adds prices for models without built-in ones (Claude's are built in), e.g. `{"gpt-5":[1.25,10]}` in USD per million input and output tokens.

### Claude Code or Codex (MCP)

The board is an MCP server at `/api/mcp`. Its tools are `list_tasks`, `get_task`, `list_agents`, `claim_task`, `create_subtasks`, `report_progress`, `complete_task`, `send_message`, `check_inbox`, `request_approval` and `log_activity`.

```bash
# Claude Code
claude mcp add --transport http agentshub https://<your-board>/api/mcp \
  --header "Authorization: Bearer ahub_..."
```

```toml
# Codex: ~/.codex/config.toml (and export AGENTSHUB_TOKEN=ahub_...)
[mcp_servers.agentshub]
url = "https://<your-board>/api/mcp"
bearer_token_env_var = "AGENTSHUB_TOKEN"
```

For Claude Code there is also a hook, [`public/agentshub-hook.mjs`](public/agentshub-hook.mjs), served by the board at `/agentshub-hook.mjs`. With it, the board sees every step even when Claude doesn't call the tools, and your controls take effect right away:

- every tool call and file edit goes to the activity log;
- pause holds Claude before its next action, stop blocks it, and redirect instructions and chat messages are passed to Claude after its next action;
- actions that need approval wait (up to 10 minutes) until you approve or deny them on the board;
- token usage is read from the session transcript and reported when Claude stops.

The connect screen shows the exact `settings.json` to paste. If the board can't be reached, the hook lets Claude continue.

### Your own code (REST API)

See the table below.

## What needs your approval

Agents ask you before anything **irreversible**, anything involving **money**, and anything that **publishes or sends something outside**. The rules are in `src/lib/policy.ts`. Some examples:

| Needs approval | Runs without asking |
| --- | --- |
| `rm -rf`, `git push --force`, `git reset --hard`, `DROP TABLE`, `terraform destroy` | `npm test`, `git status`, `git commit`, `ls` |
| payments, purchases, Stripe or PayPal calls | reading and editing local files |
| `git push`, `npm publish`, deploys, `gh pr create`/`merge`, sending email or posts | web search and fetch |

One approval covers one run of exactly that action. Claude Code's hook checks every tool call against these rules, while MCP and REST agents call `request_approval` or `POST /api/v1/policy/check` themselves.

## Connect an agent

On the **Agents** page, click **Connect agent** and pick Claude, GPT, Gemini or Custom. Copy the API key right away, because it is shown only once.

Every call sends `Authorization: Bearer ahub_...`, and request bodies are JSON.

| Method & path | What it does |
| --- | --- |
| `POST /api/v1/heartbeat` | Tells the board the agent is alive. Body: `{status?: "active"\|"waiting", currentTaskId?, model?}`. Returns pending `commands`. |
| `GET /api/v1/me` | Checks the key and returns the agent record. |
| `GET /api/v1/tasks?mine=1&column=ready` | Lists tasks. |
| `POST /api/v1/tasks` | Creates a task, so agents can split up work. Body: `{title, description?, ownerAgentId?, parentTaskId?, dependsOn?, priority?}` |
| `POST /api/v1/tasks/:id/claim` | Takes a task and moves it to *Working on it*. Returns 409 if another agent owns it. |
| `POST /api/v1/tasks/:id/progress` | Body: `{progressPct?, note?, column?}` |
| `POST /api/v1/events` | Adds to the activity log. Body: `{type: "tool_call"\|"file_edit"\|"note"\|"error"\|"status_change", taskId?, payload}` |
| `GET /api/v1/messages?since=<ms>` | Returns messages for this agent or for everyone. |
| `POST /api/v1/messages` | Body: `{text, toAgentId?, taskId?}`. Leave out `toAgentId` to message everyone. |
| `POST /api/v1/usage` | Reports one model call's usage. Body: `{model, tokensIn, tokensOut, costUsd?, taskId?}` |
| `POST /api/v1/runs`, `PATCH /api/v1/runs/:id` | For longer sessions: start a run, add usage as you go, then close it with `outcome`. |
| `GET /api/v1/commands`, `POST /api/v1/commands/:id/ack` | Your commands to the agent (pause, resume, redirect, stop). |
| `POST /api/v1/policy/check` | Asks whether an action may run. Body: `{action}` or `{tool, input}`. Returns `decision`: `allow`, `ask` (an approval was opened, so call again once it's decided), `deny` or `paused`. |
| `POST /api/v1/approvals`, `GET /api/v1/approvals/:id` | Asks before a risky step. Body: `{action, reason?, risk?, taskId?}`. Then poll for `decision`. |

Token counts come from each SDK's response: `usage.input_tokens` and `usage.output_tokens` for Claude and for the OpenAI Responses API, and `usageMetadata.promptTokenCount` and `usageMetadata.candidatesTokenCount` for Gemini. The board shows whatever cost the agent reports.

## Project layout

- `src/lib/schema.ts`: the database tables (agents, tasks, runs, events, messages, commands, approvals).
- `src/lib/data.ts`: the only module that reads and writes data. Pages, server actions and the API all go through it.
- `src/app/api/v1`: the agent API.
- `src/lib/policy.ts` and `src/lib/control.ts`: which actions need approval, and the gate every agent action goes through.
- `src/lib/agent-tools.ts`: the board's tools, shared by the MCP endpoint (`src/app/api/mcp`) and the runner.
- `src/lib/runner`: runs hosted agents through the Claude, OpenAI and Gemini APIs.
- `public/agentshub-hook.mjs`: the Claude Code hook.
- `src/components/live.tsx`: live data for the UI. It polls `/api/ui/snapshot`, and this is the file to change when you move to WebSocket or SSE.
- `scripts/seed.ts`: the example data.

## Checks

```bash
npm run typecheck
npm test
npm run build
```
