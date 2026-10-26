/**
 * GitHub tools, through the REST API with the token saved on the Connections
 * page. Reading is free to do; anything that writes to GitHub (a comment, an
 * issue, a pull request) asks you first.
 */
import { z } from "zod";
import { str, tool, ToolInputError, type AgentTool, type ToolContext } from "../agent-tools";
import { NoConnection, secretFor } from "../connections";
import { markTainted, untrusted } from "../untrusted";
import { askFirst } from "./gate";

const API = "https://api.github.com";
const MAX_FILE_CHARS = 60_000;

type Gh = { token: string; defaultRepo?: string };

async function gh(ctx: ToolContext): Promise<Gh> {
  try {
    const { connection, secret } = await secretFor(ctx.agent.id, "github");
    return { token: secret, defaultRepo: typeof connection.meta.defaultRepo === "string" ? connection.meta.defaultRepo : undefined };
  } catch (e) {
    if (e instanceof NoConnection) throw new ToolInputError(e.message);
    throw e;
  }
}

export async function githubRequest<T = unknown>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "AgentsHUB",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new ToolInputError(`GitHub ${method} ${path} failed (${res.status}): ${json.message ?? "unknown error"}`);
  return json;
}

function repoOf(input: string | undefined, g: Gh): string {
  const repo = (input || g.defaultRepo || "").replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new ToolInputError("Say which repository, as owner/name");
  return repo;
}

const repoArg = str("Repository as owner/name (default: the connection's default repository)");
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export const GITHUB_TOOLS: AgentTool[] = [
  tool({
    name: "github_list_repos",
    description: "List the GitHub repositories you can reach with the user's connection, most recently updated first.",
    inputSchema: { type: "object", properties: {} },
    args: z.object({}),
    run: async (_, ctx) => {
      const g = await gh(ctx);
      const repos = await githubRequest<{ full_name: string; private: boolean; description: string | null; default_branch: string; updated_at: string }[]>(g.token, "GET", "/user/repos?sort=updated&per_page=50");
      return { defaultRepo: g.defaultRepo ?? null, repos: repos.map((r) => ({ repo: r.full_name, private: r.private, description: r.description, defaultBranch: r.default_branch, updatedAt: r.updated_at })) };
    },
  }),

  tool({
    name: "github_read_file",
    description: "Read a file from a GitHub repository (or list a folder when the path is a folder, or the repository root with an empty path).",
    inputSchema: { type: "object", properties: { repo: repoArg, path: str("File or folder path; empty for the root"), ref: str("Branch, tag or commit (default branch if empty)") } },
    args: z.object({ repo: z.string().optional(), path: z.string().max(500).default(""), ref: z.string().max(200).optional() }),
    run: async ({ repo, path, ref }, ctx) => {
      const g = await gh(ctx);
      const r = repoOf(repo, g);
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const res = await githubRequest<{ type: string; path: string; content?: string; encoding?: string; size: number } | { type: string; path: string; size: number }[]>(g.token, "GET", `/repos/${r}/contents/${enc(path.replace(/^\/+/, ""))}${q}`);
      markTainted(ctx.taint, `GitHub ${r}`);
      if (Array.isArray(res)) return untrusted(`GitHub ${r}`, { repo: r, folder: path || "/", entries: res.map((e) => ({ path: e.path, type: e.type, size: e.size })) });
      if (!("content" in res) || res.encoding !== "base64") return untrusted(`GitHub ${r}`, { repo: r, path: res.path, type: res.type, size: res.size, note: "Not a text file" });
      const text = Buffer.from(res.content!, "base64").toString("utf8");
      return untrusted(`GitHub ${r}`, { repo: r, path: res.path, size: res.size, truncated: text.length > MAX_FILE_CHARS, content: text.slice(0, MAX_FILE_CHARS) });
    },
  }),

  tool({
    name: "github_search_code",
    description: "Search code in a GitHub repository.",
    inputSchema: { type: "object", properties: { repo: repoArg, query: str("Words or code to find") }, required: ["query"] },
    args: z.object({ repo: z.string().optional(), query: z.string().min(1).max(200) }),
    run: async ({ repo, query }, ctx) => {
      const g = await gh(ctx);
      const r = repoOf(repo, g);
      const res = await githubRequest<{ total_count: number; items: { path: string; html_url: string }[] }>(g.token, "GET", `/search/code?q=${encodeURIComponent(`${query} repo:${r}`)}&per_page=20`);
      return { repo: r, total: res.total_count, files: res.items.map((i) => ({ path: i.path, url: i.html_url })) };
    },
  }),

  tool({
    name: "github_list_issues",
    description: "List issues (and pull requests) in a repository.",
    inputSchema: { type: "object", properties: { repo: repoArg, state: { type: "string", enum: ["open", "closed", "all"] }, labels: str("Comma-separated labels (optional)") } },
    args: z.object({ repo: z.string().optional(), state: z.enum(["open", "closed", "all"]).default("open"), labels: z.string().max(200).optional() }),
    run: async ({ repo, state, labels }, ctx) => {
      const g = await gh(ctx);
      const r = repoOf(repo, g);
      const issues = await githubRequest<{ number: number; title: string; state: string; user: { login: string } | null; labels: { name: string }[]; pull_request?: unknown; html_url: string; updated_at: string }[]>(
        g.token,
        "GET",
        `/repos/${r}/issues?state=${state}&per_page=30${labels ? `&labels=${encodeURIComponent(labels)}` : ""}`,
      );
      markTainted(ctx.taint, `GitHub ${r}`);
      return untrusted(`GitHub ${r}`, {
        repo: r,
        issues: issues.map((i) => ({ number: i.number, title: i.title, state: i.state, author: i.user?.login, labels: i.labels.map((l) => l.name), pullRequest: Boolean(i.pull_request), url: i.html_url, updatedAt: i.updated_at })),
      });
    },
  }),

  tool({
    name: "github_get_issue",
    description: "Read one issue or pull request with its comments.",
    inputSchema: { type: "object", properties: { repo: repoArg, number: { type: "number", description: "Issue or PR number" } }, required: ["number"] },
    args: z.object({ repo: z.string().optional(), number: z.number().int().positive() }),
    run: async ({ repo, number }, ctx) => {
      const g = await gh(ctx);
      const r = repoOf(repo, g);
      const [issue, comments] = await Promise.all([
        githubRequest<{ title: string; body: string | null; state: string; user: { login: string } | null; html_url: string }>(g.token, "GET", `/repos/${r}/issues/${number}`),
        githubRequest<{ user: { login: string } | null; body: string; created_at: string }[]>(g.token, "GET", `/repos/${r}/issues/${number}/comments?per_page=50`),
      ]);
      markTainted(ctx.taint, `GitHub ${r}`);
      return untrusted(`GitHub ${r}#${number}`, {
        title: issue.title,
        state: issue.state,
        author: issue.user?.login,
        url: issue.html_url,
        body: (issue.body ?? "").slice(0, 20_000),
        comments: comments.map((c) => ({ author: c.user?.login, at: c.created_at, body: c.body.slice(0, 5_000) })),
      });
    },
  }),

  tool({
    name: "github_comment",
    description: "Comment on an issue or pull request. Asks the user first.",
    inputSchema: { type: "object", properties: { repo: repoArg, number: { type: "number" }, body: str("The comment, in Markdown") }, required: ["number", "body"] },
    args: z.object({ repo: z.string().optional(), number: z.number().int().positive(), body: z.string().min(1).max(20_000) }),
    run: async ({ repo, number, body }, ctx) => {
      const g = await gh(ctx);
      const r = repoOf(repo, g);
      const asked = await askFirst(ctx, { action: `GitHub: comment on ${r}#${number}`, service: "GitHub", details: body, alwaysAsk: true });
      if (!asked.ok) return asked.refused;
      const c = await githubRequest<{ html_url: string }>(g.token, "POST", `/repos/${r}/issues/${number}/comments`, { body });
      return { done: true, url: c.html_url };
    },
  }),

  tool({
    name: "github_create_issue",
    description: "Open a new issue. Asks the user first.",
    inputSchema: { type: "object", properties: { repo: repoArg, title: str("Issue title"), body: str("Issue text, in Markdown"), labels: { type: "array", items: { type: "string" } } }, required: ["title"] },
    args: z.object({ repo: z.string().optional(), title: z.string().min(1).max(300), body: z.string().max(50_000).default(""), labels: z.array(z.string().max(50)).max(10).optional() }),
    run: async ({ repo, title, body, labels }, ctx) => {
      const g = await gh(ctx);
      const r = repoOf(repo, g);
      const asked = await askFirst(ctx, { action: `GitHub: open issue in ${r}: ${title}`, service: "GitHub", details: body, alwaysAsk: true });
      if (!asked.ok) return asked.refused;
      const issue = await githubRequest<{ number: number; html_url: string }>(g.token, "POST", `/repos/${r}/issues`, { title, body, labels });
      return { done: true, number: issue.number, url: issue.html_url };
    },
  }),

  tool({
    name: "github_create_pull_request",
    description:
      "Propose code changes: makes a new branch from the base branch, commits the files you give (full new content of each), and opens a pull request. The user approves before anything is pushed, and merges it themselves.",
    inputSchema: {
      type: "object",
      properties: {
        repo: repoArg,
        title: str("PR title"),
        body: str("What changed and why, in Markdown"),
        branch: str("New branch name, e.g. 'agent/fix-login'"),
        base: str("Branch to merge into (default branch if empty)"),
        files: { type: "array", items: { type: "object", properties: { path: str("File path"), content: str("The whole new file content") } }, description: "Files to add or replace" },
      },
      required: ["title", "branch", "files"],
    },
    args: z.object({
      repo: z.string().optional(),
      title: z.string().min(1).max(300),
      body: z.string().max(50_000).default(""),
      branch: z.string().regex(/^[\w./-]+$/, "Letters, numbers, . _ / - only").max(200),
      base: z.string().max(200).optional(),
      files: z.array(z.object({ path: z.string().min(1).max(500), content: z.string().max(500_000) })).min(1).max(50),
    }),
    run: async ({ repo, title, body, branch, base, files }, ctx) => {
      const g = await gh(ctx);
      const r = repoOf(repo, g);
      const asked = await askFirst(ctx, {
        action: `GitHub: open PR in ${r} from ${branch}: ${title}`,
        service: "GitHub",
        details: `${body}\n\nFiles:\n${files.map((f) => `- ${f.path} (${f.content.length} chars)`).join("\n")}`,
        alwaysAsk: true,
      });
      if (!asked.ok) return asked.refused;
      const info = await githubRequest<{ default_branch: string }>(g.token, "GET", `/repos/${r}`);
      const baseBranch = base || info.default_branch;
      const ref = await githubRequest<{ object: { sha: string } }>(g.token, "GET", `/repos/${r}/git/ref/heads/${enc(baseBranch)}`);
      await githubRequest(g.token, "POST", `/repos/${r}/git/refs`, { ref: `refs/heads/${branch}`, sha: ref.object.sha });
      for (const f of files) {
        const path = enc(f.path.replace(/^\/+/, ""));
        const existing = await githubRequest<{ sha?: string }>(g.token, "GET", `/repos/${r}/contents/${path}?ref=${encodeURIComponent(branch)}`).catch(() => null);
        await githubRequest(g.token, "PUT", `/repos/${r}/contents/${path}`, {
          message: `${title}: ${f.path}`,
          content: Buffer.from(f.content, "utf8").toString("base64"),
          branch,
          ...(existing?.sha ? { sha: existing.sha } : {}),
        });
      }
      const pr = await githubRequest<{ number: number; html_url: string }>(g.token, "POST", `/repos/${r}/pulls`, { title, body, head: branch, base: baseBranch });
      return { done: true, number: pr.number, url: pr.html_url };
    },
  }),
];
