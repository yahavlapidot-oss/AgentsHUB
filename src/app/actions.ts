"use server";

import { z } from "zod";
import * as data from "@/lib/data";
import { AGENT_KINDS, AGENT_ROLES, ARTIFACT_STATUSES, COLUMNS, COMMAND_TYPES, PRIORITIES, PROVIDERS } from "@/lib/schema";

// Server actions used by the dashboard. The user is the actor (agentId null).

const NewTask = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(300),
  description: z.string().max(10_000).default(""),
  column: z.enum(COLUMNS).optional(),
  priority: z.enum(PRIORITIES).default("medium"),
  ownerAgentId: z.string().nullable().default(null),
  acceptanceCriteria: z.string().max(5_000).default(""),
  budgetUsd: z.number().min(0).nullable().default(null),
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

export async function setAgentSandboxAction(agentId: string, enabled: boolean) {
  await data.setAgentSandbox(agentId, z.boolean().parse(enabled));
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
