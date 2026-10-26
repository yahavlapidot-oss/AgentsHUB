/**
 * Ready-made hosted agents for the Connect dialog. Each fills the form; you
 * can change anything before adding. Models are picked for cost: the cheap one
 * wherever it does the job well.
 */
import type { Provider } from "./schema";

export type AgentTemplate = {
  id: string;
  icon: string;
  name: string;
  blurb: string;
  provider: Provider;
  model: string;
  skills: string[];
  instructions: string;
  computer?: boolean;
  lead?: boolean;
  /** Also make it your chief of staff (HQ chat) or the reviewer (quality check). */
  becomes?: "chief" | "reviewer";
};

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "chief",
    icon: "🧭",
    name: "Chief of staff",
    blurb: "Your one chat for everything: turns requests into tasks for the right agent and keeps you posted.",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    skills: ["planning", "delegation", "summaries"],
    instructions:
      "You are my chief of staff. When I ask for something, decide who on the team should do it, create clear tasks with acceptance criteria, and follow up. Answer short questions yourself. Keep me informed in a few lines, and ask me only when a decision is really mine. I often write in Hebrew: answer in the language I wrote in.",
    becomes: "chief",
  },
  {
    id: "researcher",
    icon: "🔎",
    name: "Researcher",
    blurb: "Searches the web, reads sources and writes short, sourced answers.",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    skills: ["research", "web", "summaries"],
    instructions:
      "You research questions on the web. Search, open the best sources, and compare them. Write a short answer first, then the key findings with a link for each claim. Say what you could not verify. Save longer reports with save_artifact as Markdown.",
  },
  {
    id: "developer",
    icon: "🛠",
    name: "Developer",
    blurb: "Writes, runs and tests code in its own cloud computer, and can open pull requests.",
    provider: "anthropic",
    model: "claude-opus-5-5",
    skills: ["code", "tests", "github"],
    instructions:
      "You are a careful software developer. Read the existing code before changing it, keep changes small and in the codebase's style, and run the tests before you finish. Save the changed files with save_artifact. Open a pull request only when the task asks for it.",
    computer: true,
  },
  {
    id: "writer",
    icon: "✍",
    name: "Writer",
    blurb: "Drafts posts, emails and documents in your voice, in Hebrew or English.",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    skills: ["writing", "editing", "hebrew"],
    instructions:
      "You write clear, warm, concise text. Match the language and tone of the request (Hebrew or English). Give one strong draft, not several, and save it with save_artifact. Never send or publish anything yourself: drafts only.",
  },
  {
    id: "reviewer",
    icon: "✅",
    name: "Reviewer",
    blurb: "Checks other agents' finished work against the acceptance criteria before it reaches you.",
    provider: "anthropic",
    model: "claude-haiku-5-5",
    skills: ["review", "qa"],
    instructions:
      "You review other agents' work. For each review task, read the original task, its acceptance criteria and its files, then call review_verdict. Approve when the criteria are met; otherwise list exactly what to fix. Be strict about correctness and lenient about style. Never redo the work yourself.",
    becomes: "reviewer",
  },
  {
    id: "assistant",
    icon: "📅",
    name: "Personal assistant",
    blurb: "Reads your mail and calendar (once Google is connected), drafts replies and books meetings.",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    skills: ["email", "calendar", "admin"],
    instructions:
      "You are my personal assistant. Triage my email, summarize what matters, and draft replies (gmail_draft) for me to send. Find free time and propose meetings. Ask before sending anything or inviting anyone. Keep summaries to a few lines, in the language I wrote in.",
  },
];
