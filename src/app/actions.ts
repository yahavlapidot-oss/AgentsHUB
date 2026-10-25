"use server";

import { z } from "zod";
import { setMonthlyCap } from "@/lib/budgets";
import * as data from "@/lib/data";
import { diffLines, toHunks } from "@/lib/diff";
import { cleanDisabledTools } from "@/lib/tool-hub";
import { AGENT_KINDS, AGENT_ROLES, AUTONOMY_LEVELS, ARTIFACT_STATUSES, COLUMNS, COMMAND_TYPES, PRIORITIES, PROJECT_STATUSES, PROVIDERS } from "@/lib/schema";

// Server actions used by the dashboard. The user is the actor (agentId null).

const NewTask = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(300),
  description: z.string().max(10_000).default(""),
  column: z.enum(COLUMNS).optional(),
  priority: z.enum(PRIORITIES).default("medium"),
  ownerAgentId: z.string().nullable().default(null),
  acceptanceCriteria: z.string().max(5_000).default(""),
  budgetUsd: z.number().min(0).nullable().default(null),
  projectId: z.string().nullable().default(null),
});

export async function createTaskAction(input: z.input<typeof NewTask>) {
  const task = await data.createTask(NewTask.parse(input));
  return { id: task.id };
}

const Patch = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(10_000),
    column: z.enum(COLUMNS),
    priority: z.enum(PRIORITIES),
    ownerAgentId: z.string().nullable(),
    acceptanceCriteria: z.string().max(5_000),
    progressPct: z.number().min(0).max(100),
    budgetUsd: z.number().min(0).nullable(),
    projectId: z.string().nullable(),
  })
  .partial();

export async function updateTaskAction(taskId: string, patch: z.input<typeof Patch>) {
  await data.updateTask(taskId, Patch.parse(patch));
}

export async function sendMessageAction(input: { text: string; toAgentId?: string | null; taskId?: string | null }) {
  const text = input.text.trim();
  if (!text) return;
  await data.postMessage({ fromAgentId: null, toAgentId: input.toAgentId ?? null, taskId: input.taskId ?? null, text });
}

const LeadMessage = z.object({
  text: z.string().trim().min(1, "Write something").max(10_000),
  asTask: z.boolean().default(false),
  priority: z.enum(PRIORITIES).default("medium"),
});

/**
 * Writes to the project's work manager in the project chat. As a task, the first
 * line becomes the title and the rest the description, and the task goes to the
 * manager to plan and hand out.
 */
export async function sendToLeadAction(projectId: string, input: z.input<typeof LeadMessage>) {
  const { text, asTask, priority } = LeadMessage.parse(input);
  const [project, agents] = await Promise.all([data.getProject(projectId), data.getAgents()]);
  if (!project) throw new Error("This project no longer exists");
  const lead = data.projectLead(project, agents);
  if (!lead) throw new Error("Pick a work manager for this project first");
  let taskId: string | null = null;
  if (asTask) {
    const [first, ...rest] = text.split("\n");
    const task = await data.createTask({
      title: first.trim().slice(0, 300),
      description: rest.join("\n").trim(),
      priority,
      projectId,
      ownerAgentId: lead.id,
      column: "ready",
      createdBy: "user",
    });
    taskId = task.id;
  }
  await data.postMessage({ fromAgentId: null, toAgentId: lead.id, projectId, taskId, text });
  return { taskId };
}

export async function setProjectLeadAction(projectId: string, agentId: string | null) {
  await data.updateProject(projectId, { leadAgentId: agentId });
}

const NewAgent = z.object({
  name: z.string().trim().min(1, "Give the agent a name").max(80),
  provider: z.enum(PROVIDERS),
  model: z.string().trim().min(1, "Pick a model").max(120),
  machine: z.string().trim().max(120).nullable().default(null),
  skills: z.array(z.string().trim().min(1)).default([]),
  kind: z.enum(AGENT_KINDS).default("sdk"),
  instructions: z.string().max(20_000).default(""),
  role: z.enum(AGENT_ROLES).default("member"),
  sandboxEnabled: z.boolean().default(false),
}).refine((a) => a.kind !== "hosted" || a.provider !== "custom", {
  message: "AgentsHUB can run Claude, GPT or Gemini agents",
});

/** Returns the new agent's token. It is shown once and never stored in plain text. */
export async function createAgentAction(input: z.input<typeof NewAgent>) {
  const { agent, token } = await data.createAgent(NewAgent.parse(input));
  return { id: agent.id, token };
}

export async function rotateTokenAction(agentId: string) {
  return { token: await data.rotateAgentToken(agentId) };
}

export async function setAgentRoleAction(agentId: string, role: (typeof AGENT_ROLES)[number]) {
  await data.setAgentRole(agentId, z.enum(AGENT_ROLES).parse(role));
}

export async function setAgentAutonomyAction(agentId: string, autonomy: (typeof AUTONOMY_LEVELS)[number]) {
  await data.setAgentAutonomy(agentId, z.enum(AUTONOMY_LEVELS).parse(autonomy));
}

/** Stops every agent and closes every cloud computer. */
export async function emergencyStopAction() {
  const state = await data.emergencyStop();
  const { reapOrphanedSandboxes } = await import("@/lib/sandbox/session");
  const closed = await reapOrphanedSandboxes("Closed by the emergency stop");
  return { agents: state.agentIds.length, sandboxes: closed };
}

export async function resumeAllAction() {
  return { agents: await data.resumeAfterEmergencyStop() };
}

/** The hub-wide monthly spending cap; null removes it. */
export async function setMonthlyCapAction(usd: number | null) {
  await setMonthlyCap(z.number().positive().max(1_000_000).nullable().parse(usd));
}

export async function setAgentSandboxAction(agentId: string, enabled: boolean) {
  await data.setAgentSandbox(agentId, z.boolean().parse(enabled));
}

/** Turns one tool on or off for an agent. Core tools always stay on. */
export async function setAgentToolAction(agentId: string, tool: string, enabled: boolean) {
  const agent = await data.getAgent(agentId);
  if (!agent) return;
  const off = new Set(agent.disabledTools);
  if (enabled) off.delete(tool);
  else off.add(tool);
  await data.setAgentDisabledTools(agentId, cleanDisabledTools([...off]));
}

/** What changed from one saved version of a file to another, folded around the changes. */
export async function diffArtifactsAction(fromId: string, toId: string) {
  const [from, to] = await Promise.all([data.getArtifact(fromId), data.getArtifact(toId)]);
  if (!from || !to) return { error: "One of the versions no longer exists" };
  const text = (b: Buffer) => (b.subarray(0, 8192).includes(0) ? null : b.toString("utf8"));
  const [a, b] = [text(from.content), text(to.content)];
  if (a === null || b === null) return { error: "Only text files can be compared" };
  const lines = diffLines(a, b);
  if (!lines) return { error: "These versions are too large to compare here" };
  const added = lines.filter((l) => l.type === "add").length;
  const removed = lines.filter((l) => l.type === "del").length;
  return { hunks: toHunks(lines), added, removed, from: from.version, to: to.version };
}

export async function setArtifactStatusAction(artifactId: string, status: (typeof ARTIFACT_STATUSES)[number]) {
  await data.setArtifactStatus(artifactId, z.enum(ARTIFACT_STATUSES).parse(status));
}

const NoteInput = z.object({
  title: z.string().trim().min(1, "Give the note a title").max(200),
  text: z.string().trim().min(1, "Write something").max(20_000),
});

export async function saveNoteAction(input: z.input<typeof NoteInput>) {
  const note = NoteInput.parse(input);
  await data.writeNote({ ...note, authorAgentId: null });
}

export async function deleteNoteAction(noteId: string) {
  await data.deleteNote(noteId);
}

const ProjectInput = z.object({
  name: z.string().trim().min(1, "Give the project a name").max(200),
  goal: z.string().trim().max(5_000).default(""),
  context: z.string().trim().max(20_000).default(""),
  memberAgentIds: z.array(z.string()).max(100).default([]),
  leadAgentId: z.string().nullable().optional(),
  status: z.enum(PROJECT_STATUSES).default("active"),
  budgetUsd: z.number().positive().max(1_000_000).nullable().optional(),
});

export async function createProjectAction(input: z.input<typeof ProjectInput>) {
  const project = await data.createProject(ProjectInput.parse(input));
  return { id: project.id };
}

export async function updateProjectAction(projectId: string, input: z.input<typeof ProjectInput>) {
  await data.updateProject(projectId, ProjectInput.parse(input));
}

export async function deleteProjectAction(projectId: string) {
  await data.deleteProject(projectId);
}

const MemoryInput = z.object({
  title: z.string().trim().min(1, "Give it a title").max(200),
  text: z.string().trim().min(1, "Write something").max(5_000),
});

/** You can teach an agent directly: this goes into its own memory, as if it had saved it. */
export async function saveAgentMemoryAction(agentId: string, input: z.input<typeof MemoryInput>) {
  await data.rememberForAgent({ agentId, ...MemoryInput.parse(input) });
}

export async function deleteAgentMemoryAction(agentId: string, memoryId: string) {
  await data.forgetAgentMemory(agentId, { id: memoryId });
}

export async function deleteAgentAction(agentId: string) {
  await data.deleteAgent(agentId);
}

export async function sendCommandAction(agentId: string, type: (typeof COMMAND_TYPES)[number], text = "") {
  await data.sendCommand(agentId, z.enum(COMMAND_TYPES).parse(type), text.slice(0, 5_000));
}

export async function decideApprovalAction(approvalId: string, decision: "approved" | "denied") {
  await data.decideApproval(approvalId, z.enum(["approved", "denied"]).parse(decision));
}

/** Timeline and chat for one task, for the task drawer. */
export async function getTaskDetailAction(taskId: string) {
  const [events, messages, artifacts] = await Promise.all([
    data.getEvents({ taskId, limit: 200 }),
    data.getMessages({ taskId, limit: 200 }),
    data.getArtifacts({ taskId }),
  ]);
  return { events, messages, artifacts };
}
