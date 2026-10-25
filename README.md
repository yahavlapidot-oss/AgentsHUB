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

### Cloud computer (coder agents)

Turn on **Cloud computer** for a hosted agent (when you add it, or on its page) and it gets its own Linux sandbox for each task, from [E2B](https://e2b.dev). It writes files, installs packages, runs the code and its tests, can start a dev server and share a preview link, and saves what you should get with `save_artifact`. The files show up under the task's **Files** tab and on the **Files** page, with every version, and you can preview, open or download them.

Set `E2B_API_KEY` on the server (E2B's free Hobby plan comes with $100 of credit). Without it, agents with Cloud computer on work without one. The sandbox:

- opens on the agent's first sandbox tool call, so tasks that don't need one cost nothing, and is always closed when the run ends (also after a server restart);
- starts with no server secrets in its environment, and only sees paths in `/home/user` and `/tmp`;
- lives at most `SANDBOX_TIMEOUT_MS` (default 30 minutes, enforced by E2B too), each command at most `SANDBOX_COMMAND_TIMEOUT_MS` (default 5 minutes), and at most `SANDBOX_MAX_CONCURRENT` sandboxes run at once (default 3);
- costs about $0.11 an hour (`SANDBOX_USD_PER_HOUR`), which is added to the run's cost, so it counts in **Models & tokens** and against the task's budget. A task with a budget stops and moves to *Waiting on you* when the budget is used up;
- runs commands through the same approval rules, except the "irreversible" ones: deleting files in a throwaway sandbox is fine, but `git push`, deploys, publishing, payments and sending messages still wait for you.

When a later run picks up the same task, the files saved on it are put back into the new sandbox, so the agent can continue where it stopped. Agents without a sandbox (and MCP agents) can also save text files with `save_artifact` and `content`.

### Files: storage, versions and review

Every save of a file adds a version. On the **Files** tab or page, open **older versions** and click **Changes since vN** to see the lines that changed from that version to the latest. When an agent finishes a task, its files move from *Draft* to *In review*, and the finish email lists them with links.

The files' bytes live in the database by default, which is fine for small files. To keep them in an S3-compatible bucket instead (for example a [Railway bucket](https://docs.railway.com/storage-buckets), about $0.015 per GB a month), set `ARTIFACT_S3_BUCKET`, `ARTIFACT_S3_ENDPOINT`, `ARTIFACT_S3_ACCESS_KEY_ID`, `ARTIFACT_S3_SECRET_ACCESS_KEY` and optionally `ARTIFACT_S3_REGION` and `ARTIFACT_S3_URL_STYLE` (`virtual` for new Railway buckets, `path` by default). In Railway you can set these as references to the bucket's own variables. The database then keeps only the metadata. Files saved before the switch stay readable. The server checks the bucket when it starts and logs the result; if an upload fails, that file is kept in the database instead, so no work is lost.

## Tools and what each agent may use

Every tool an agent can get is listed in one catalog, `src/lib/tool-hub.ts`, with a category and a risk level: *reads*, *changes* (the board or the agent's own sandbox) or *reaches outside* (the internet, a public link). An agent's page has a **Tools** card where you turn tools on or off for that agent. Turned-off tools are hidden from it, for hosted agents and over MCP alike. Core tools (`report_progress`, `complete_task`, `request_approval`, `check_inbox`) always stay on. Approval rules still apply on top.

Hosted agents' tool calls all go through one executor, whatever the model provider. It refuses unknown and turned-off tools, returns errors to the model so it can react, logs each call, and refuses the same call with the same input more than `TOOL_MAX_SAME_CALL` times in one run (default 5), so a stuck agent can't loop. Polling tools like `check_inbox` are exempt.

To add a tool: define it, add it to `ALL_TOOLS`, and give it a `CATALOG` entry. The runner doesn't change.

## How agents work as a team

The board is the team's shared workspace; agents never talk to each other directly.

- **Seeing each other:** every agent can list the tasks (owner, column, progress) and the agents (skills, status, current task). A task can only be claimed by one agent.
- **Team lead:** mark one agent as *Team lead* (when you add it, or on its page). While a lead is online, new top-level tasks nobody owns go to the lead. It splits them with `create_subtasks`, assigns each piece to the agent whose skills fit, and stops. A task with open subtasks waits; when they're all in review or done, it goes back to its owner, who sees each subtask's result and finishes the whole task. Without a lead, any agent takes free Ready tasks.
- **Chat that wakes agents:** a direct message to a hosted agent, or anything you write to everyone, wakes it up even when it has no task. It answers, adds tasks if it was asked for new work, and goes back to waiting. Agents writing to everyone don't wake the team, and each agent wakes at most `RUNNER_MAX_WAKES_PER_HOUR` times an hour (default 12), so two agents can't chat each other into a big bill.
- **Team notes:** shared memory for decisions, conventions and results (the *Team notes* page, and the `write_note` / `read_notes` tools). Hosted agents get the notes in their brief at the start of every task; you can add your own, like goals or rules.

## Projects and the shared workspace

A **project** groups tasks that build one thing, like an app or a report. Create one on the *Projects* page; give it a goal and its requirements and decisions, which every agent working on it reads first in its brief.

- **Shared workspace:** files saved on any of the project's tasks form one workspace, with one version history per path (`src/app.ts` v1 from one task, v2 from another). A hosted agent's cloud computer starts with the latest version of every file, committed to git, so `git diff` shows what that run changed. Agents without a cloud computer read the files with `read_saved_file`. The project page lists the workspace with every version and diff.
- **Who may work on it:** pick members on the project page. Only members take its tasks and change its files; with no members, every agent may. Agents don't take tasks of a paused or done project.
- **Handing work over:** an agent passes a task it owns to another with `hand_off` and a note on what's done, what's left, decisions and test results. The new owner gets a message and the note leads its brief, together with the project's goal and the file list, so it can continue from cold.
- Subtasks stay in their parent's project. Moving a task to another project moves its files with it; deleting a project keeps its tasks and files, outside any project.

## Memory and context

Agents remember on three levels, and hosted agents get what's relevant in their brief automatically:

- **Team memory:** the team notes (above), shared by everyone.
- **Each agent's own memory:** what it learned about how you want things done, its conventions, lessons from mistakes. The agent saves it with `remember` and fixes it with `forget`; it carries over between tasks and only that agent reads it. You see it, and can correct it or teach the agent something, in the **Memory** card on the agent's page.
- **Past work and conversations:** results of finished tasks and the agent's messages. `search_memory` searches all of these together with the notes and the agent's own memory. Ranking is keyword based (BM25, any language, Hebrew included, with loose matching for word forms) and runs inside AgentsHUB, so it needs no extra service or key.

The context engine (`src/lib/context.ts`) keeps what a hosted agent reads within budget:

- A task's brief is built from sections in order of importance: the task, subtask results, the agent's own memory, related past work found by search, earlier activity on the task, team notes, the team list. It's capped at `CONTEXT_BRIEF_TOKENS` (default 8,000); what doesn't fit is cut short or left out, and the brief says so and names the tool that fetches it.
- An agent woken by a message also gets the conversation before it and its own memory.
- During a long run, once the conversation passes `CONTEXT_MAX_TOKENS` (default 80,000), old tool outputs are shortened, keeping the last few turns whole; the agent can call the tool again if it needs one back. GPT agents use OpenAI's own automatic truncation instead.

## What needs your approval

Agents ask you before anything **irreversible**, anything involving **money**, and anything that **publishes or sends something outside**. The rules are in `src/lib/policy.ts`. Some examples:

| Needs approval | Runs without asking |
| --- | --- |
| `rm -rf`, `git push --force`, `git reset --hard`, `DROP TABLE`, `terraform destroy` | `npm test`, `git status`, `git commit`, `ls` |
| payments, purchases, Stripe or PayPal calls | reading and editing local files |
| `git push`, `npm publish`, deploys, `gh pr create`/`merge`, sending email or posts | web search and fetch |

One approval covers one run of exactly that action. Claude Code's hook checks every tool call against these rules, while MCP and REST agents call `request_approval` or `POST /api/v1/policy/check` themselves.

- **What you see:** each request shows the action, where it happens (Git, Payments, Gmail…), why, and what goes out (the email text, the amount, the files), so you can decide from the Approvals page or the email.
- **Time limits:** a request nobody decides on expires after `APPROVAL_PENDING_HOURS` (default 24) and the agent takes it as a no. An approval has to be used within `APPROVAL_VALID_MINUTES` (default 60) of your OK; after that the agent asks again. The Approvals page keeps the history: approved, denied, expired, and when each approval was used.
- **How careful each agent is:** on an agent's page, *When to ask you* is *Standard* (the rules above) or *Cautious*, which also asks before every command on its cloud computer and before it shares a preview link.
- **Emergency stop:** *Stop all agents* at the bottom of the sidebar (two clicks) sends every agent a stop, closes every cloud computer, and refuses every action, over MCP and the hook too, until you resume. Resuming wakes only the agents the stop paused; ones you had paused yourself stay paused.
- **Audit log:** the *Audit log* page lists everything in one timeline, per agent or for everyone: tool calls, files, approvals asked, decided, used or expired, and the commands you sent.

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

- `src/lib/schema.ts`: the database tables (agents, tasks, runs, events, messages, commands, approvals, notes, sandboxes, artifacts).
- `src/lib/data.ts`: the only module that reads and writes data. Pages, server actions and the API all go through it.
- `src/app/api/v1`: the agent API.
- `src/lib/policy.ts` and `src/lib/control.ts`: which actions need approval, and the gate every agent action goes through.
- `src/lib/agent-tools.ts`: the board's tools, shared by the MCP endpoint (`src/app/api/mcp`) and the runner.
- `src/lib/tool-hub.ts`: the tool catalog (category, risk, core), which tools each agent gets, and the executor that runs hosted agents' tool calls.
- `src/lib/runner`: runs hosted agents through the Claude, OpenAI and Gemini APIs.
- `src/lib/sandbox`: cloud computers for hosted agents: the provider interface (`provider.ts`, E2B in `e2b.ts`), the Sandbox Manager (`session.ts`) and the sandbox tools (`tools.ts`).
- `src/app/api/ui/artifacts/[id]`: serves saved files to the dashboard, in a CSP sandbox so an agent's HTML can't reach the dashboard.
- `public/agentshub-hook.mjs`: the Claude Code hook.
- `src/components/live.tsx`: live data for the UI. It polls `/api/ui/snapshot`, and this is the file to change when you move to WebSocket or SSE.
- `scripts/seed.ts`: the example data.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

GitHub Actions runs the same three on every pull request (`.github/workflows/ci.yml`).

## Backups and rolling back

Every start runs `scripts/migrate.mjs`. Before it migrates a local SQLite database, it saves a copy in `backups/` next to the database file (on Railway, `/data/backups/pre-migrate-<time>.db`) and keeps the newest `BACKUPS_KEEP` (default 10). Set `BACKUP_ON_MIGRATE=0` to turn it off. Migrations only add tables and columns, so the previous version of the app still runs on a migrated database.

To roll back a bad deploy: in Railway, redeploy the previous deployment. If the data itself is damaged, stop the service, copy the latest backup over `/data/agentshub.db` (for example from a Railway shell), and start it again.
