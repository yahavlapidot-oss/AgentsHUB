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
4. Under **Networking**, generate a public domain.

### Other hosts

Any Node host works. Without a persistent disk (for example on Vercel), use a hosted libSQL database such as [Turso](https://turso.tech): set `DATABASE_URL` and `DATABASE_AUTH_TOKEN`.

The dashboard password doesn't apply to the agent API (`/api/v1/*`). Each agent uses its own API key instead.

### Email alerts

When an agent asks for approval, AgentsHUB can email you. Create a free [Resend](https://resend.com) account, then set `RESEND_API_KEY` and `NOTIFY_EMAIL`. The default sender only reaches the email address on your Resend account. To send from your own address, verify a domain in Resend and set `NOTIFY_FROM`.

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
| `POST /api/v1/approvals`, `GET /api/v1/approvals/:id` | Asks before a risky step. Body: `{action, reason?, risk?, taskId?}`. Then poll for `decision`. |

Token counts come from each SDK's response: `usage.input_tokens` and `usage.output_tokens` for Claude and for the OpenAI Responses API, and `usageMetadata.promptTokenCount` and `usageMetadata.candidatesTokenCount` for Gemini. The board shows whatever cost the agent reports.

## Project layout

- `src/lib/schema.ts`: the database tables (agents, tasks, runs, events, messages, commands, approvals).
- `src/lib/data.ts`: the only module that reads and writes data. Pages, server actions and the API all go through it.
- `src/app/api/v1`: the agent API.
- `src/components/live.tsx`: live data for the UI. It polls `/api/ui/snapshot`, and this is the file to change when you move to WebSocket or SSE.
- `scripts/seed.ts`: the example data.

## Checks

```bash
npm run typecheck
npm test
npm run build
```
