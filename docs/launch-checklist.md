# Launch checklist

Go through this before you rely on AgentsHUB for real work. Each item says whether it's done on the current Railway setup (checked 2026-10-25) or needs you.

## Access

- [x] `DASHBOARD_PASSWORD` is set on Railway. Use a long, unique password (20+ characters); the dashboard has no other login.
- [ ] Every agent has its own key. Delete the agents you only used for testing, and rotate any key that was ever pasted somewhere public.
- [ ] Only you (and people you trust with all agents) know the password: anyone with it can approve actions and stop agents.

## Money

- [ ] Set a **monthly cap** on *Usage & costs*. Without one, only task and project budgets stop agents.
- [ ] Give projects a budget where it matters.
- [ ] Set spending limits at the providers too (Anthropic, OpenAI and E2B consoles), as a second line of defence.
- [ ] Check your Railway plan's usage limit, so a busy month doesn't surprise you.

## Alerts

- [x] `RESEND_API_KEY` and `NOTIFY_EMAIL` are set.
- [ ] Send yourself a test: ask an agent for an approval and check the email arrives. Resend's test sender (`onboarding@resend.dev`) only sends to the address of your Resend account. To send elsewhere, verify a domain in Resend and set `NOTIFY_FROM`.
- [ ] Optional: point a free uptime monitor (e.g. UptimeRobot) at `https://<your-domain>/api/health`, so you hear about it if the whole server is down. Nothing inside the server can email you then.

## Data

- [x] The database is on a Railway volume (`/data`), backed up before every migration (`/data/backups`).
- [x] Files go to the `agentshub-files` bucket; the System status page checks it.
- [ ] Optional: turn on Railway volume backups (in the volume's settings) for daily copies, not only before migrations.
- [ ] Know how to roll back: see *Backups and rolling back* in the README.

## Before each release

- [ ] CI is green: typecheck, unit tests, build, browser tests.
- [ ] After the deploy, open **System status**: everything that should work says *Working*.
- [ ] Open **Live workspace** while an agent runs one small task end to end.

## If something goes wrong

1. **Stop all agents** (bottom of the sidebar). It pauses every agent and closes the cloud computers.
2. Look at **System status** and the **Audit log**.
3. Roll back the deploy in Railway if a release caused it; restore a backup only if data is damaged.
4. Turn off the emergency stop from the banner when it's fixed.
