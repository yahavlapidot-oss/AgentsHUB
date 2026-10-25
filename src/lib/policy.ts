/**
 * Approval policy: which agent actions need the user's OK before they run.
 *
 * The user's rule: anything irreversible, anything that involves money, and
 * anything that publishes or sends something outside. Everything else runs
 * without asking. The rules are plain regexes over a short description of the
 * action (a shell command, a tool name plus its input, or a sentence), so they
 * work the same for Claude Code hooks, MCP clients and hosted agents.
 */

export const POLICY_CATEGORIES = ["irreversible", "money", "external"] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

type Rule = { category: PolicyCategory; label: string; service: string; pattern: RegExp };

const RULES: Rule[] = [
  // Irreversible: deleting data, rewriting history, destroying infrastructure.
  { category: "irreversible", label: "deletes files", service: "Files", pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i },
  { category: "irreversible", label: "deletes files", service: "Files", pattern: /\b(rmdir|shred|unlink)\b/i },
  { category: "irreversible", label: "rewrites git history", service: "Git", pattern: /\bgit\s+push\b[^\n]*(--force\b|-f\b|--force-with-lease)/i },
  { category: "irreversible", label: "discards git changes", service: "Git", pattern: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|branch\s+-D|checkout\s+--\s|restore\s+--source)/i },
  { category: "irreversible", label: "drops database data", service: "Database", pattern: /\b(drop\s+(table|database|schema)|truncate\s+table|delete\s+from)\b/i },
  { category: "irreversible", label: "destroys infrastructure", service: "Infrastructure", pattern: /\b(terraform\s+destroy|kubectl\s+delete|railway\s+down|vercel\s+remove|docker\s+(system\s+)?prune)\b/i },
  { category: "irreversible", label: "irreversible action", service: "Accounts and data", pattern: /\b(delete|destroy|wipe|purge|erase)\s+(the\s+)?(account|repo|repository|database|bucket|project|production|prod)\b/i },

  // Money: payments, purchases, paid plans.
  { category: "money", label: "spends money", service: "Payments", pattern: /\b(payment|pay\s+for|purchase|buy|checkout|charge|invoice|refund|subscribe\s+to|upgrade\s+(the\s+)?plan|billing|wire\s+transfer|transfer\s+funds)\b/i },
  { category: "money", label: "payment API", service: "Payments", pattern: /\b(stripe|paypal|paddle|lemonsqueezy|braintree|adyen)\b/i },

  // External: publishing, deploying, sending messages to people.
  { category: "external", label: "pushes code", service: "Git", pattern: /\bgit\s+push\b/i },
  { category: "external", label: "publishes a package", service: "Package registry", pattern: /\b(npm|pnpm|yarn)\s+publish\b|\b(twine\s+upload|cargo\s+publish|gem\s+push)\b/i },
  { category: "external", label: "deploys", service: "Deploy", pattern: /\b(deploy|vercel\s+--prod|railway\s+up|fly\s+deploy|netlify\s+deploy|gh\s+release\s+create)\b/i },
  { category: "external", label: "opens or merges a PR", service: "GitHub", pattern: /\bgh\s+pr\s+(create|merge)\b|\b(create|merge)_pull_request\b/i },
  { category: "external", label: "sends a message outside", service: "Email and messaging", pattern: /\b(send\s+(an?\s+)?(email|e-mail|sms|text|dm|message\s+to)|sendmail|smtp|resend\.com|twilio|tweet|post\s+(to|on)\s+(twitter|x|linkedin|slack|discord|facebook|instagram)|slack_send|send_email)\b/i },
  { category: "external", label: "publishes content", service: "Publishing", pattern: /\b(publish|go\s+live|make\s+(it\s+)?public)\b/i },
];

export type PolicyResult = {
  requiresApproval: boolean;
  categories: PolicyCategory[];
  reasons: string[];
  /** Where the action happens, e.g. "Git", "Payments". */
  services: string[];
};

/** Classifies an action description. `text` is what the agent is about to do. */
export function evaluatePolicy(text: string, opts: { ignore?: PolicyCategory[] } = {}): PolicyResult {
  const hits = RULES.filter((r) => !opts.ignore?.includes(r.category) && r.pattern.test(text));
  const categories = [...new Set(hits.map((h) => h.category))];
  const reasons = [...new Set(hits.map((h) => h.label))];
  const services = [...new Set(hits.map((h) => h.service))];
  return { requiresApproval: hits.length > 0, categories, reasons, services };
}

/** Turns a tool call (e.g. a Claude Code `Bash` call) into the text the rules read. */
export function describeToolCall(tool: string, input: unknown): string {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    // Shell tools: the command is the whole story.
    if (typeof obj.command === "string") return `${tool}: ${obj.command}`;
    const parts = Object.entries(obj)
      .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      .map(([k, v]) => `${k}=${String(v).slice(0, 300)}`);
    return `${tool}: ${parts.join(" ")}`;
  }
  return `${tool}: ${String(input ?? "")}`;
}

/** Tools that only read or edit local files never need approval, whatever their input says. */
const LOCAL_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "TodoWrite", "Edit", "MultiEdit", "Write", "NotebookEdit", "WebSearch", "WebFetch"]);

export function evaluateToolCall(tool: string, input: unknown): PolicyResult & { action: string } {
  const action = describeToolCall(tool, input);
  if (LOCAL_ONLY_TOOLS.has(tool)) return { action, requiresApproval: false, categories: [], reasons: [], services: [] };
  return { action, ...evaluatePolicy(action) };
}

export function riskFor(categories: PolicyCategory[]): "low" | "medium" | "high" {
  if (categories.includes("irreversible") || categories.includes("money")) return "high";
  return categories.length ? "medium" : "low";
}
