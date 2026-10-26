"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createConnection, deleteConnection, getConnection, updateConnection } from "@/lib/connections";
import { accessToken } from "@/lib/google";
import { listServerTools } from "@/lib/mcp-client";
import { CONNECTION_SERVICES } from "@/lib/schema";
import { githubRequest } from "@/lib/tools/github";
import { railwayQuery } from "@/lib/tools/railway";
import { open } from "@/lib/vault";

// Server actions for the Connections page. Secrets come in here and are sealed; they never go back out.

const Base = z.object({
  label: z.string().trim().min(1, "Give it a name").max(120),
  agentIds: z.array(z.string()).max(100).default([]),
});

const Input = z.discriminatedUnion("service", [
  Base.extend({ service: z.literal("github"), secret: z.string().trim().min(10, "Paste a GitHub token"), defaultRepo: z.string().trim().regex(/^$|^[\w.-]+\/[\w.-]+$/, "Use owner/repo").optional() }),
  Base.extend({ service: z.literal("railway"), secret: z.string().trim().min(10, "Paste a Railway token"), tokenType: z.enum(["account", "project"]).default("account") }),
  Base.extend({
    service: z.literal("mcp"),
    url: z.string().trim().url("Use the server's full address"),
    secret: z.string().trim().max(10_000).default(""),
    approval: z.enum(["writes", "always", "never"]).default("writes"),
  }),
]);
export type ConnectionInput = z.input<typeof Input>;

function metaFor(i: z.infer<typeof Input>): Record<string, unknown> {
  if (i.service === "github") return i.defaultRepo ? { defaultRepo: i.defaultRepo } : {};
  if (i.service === "railway") return { tokenType: i.tokenType };
  return { url: i.url, approval: i.approval };
}

export async function addConnectionAction(raw: ConnectionInput): Promise<{ id?: string; error?: string }> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  try {
    const c = await createConnection({ service: parsed.data.service, label: parsed.data.label, secret: parsed.data.secret, meta: metaFor(parsed.data), agentIds: parsed.data.agentIds });
    const test = await testConnection(c.id);
    revalidatePath("/connections");
    return { id: c.id, error: test.error ? `Saved, but the test failed: ${test.error}` : undefined };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const Patch = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  agentIds: z.array(z.string()).max(100).optional(),
  enabled: z.boolean().optional(),
  approval: z.enum(["writes", "always", "never"]).optional(),
  defaultRepo: z.string().trim().regex(/^$|^[\w.-]+\/[\w.-]+$/, "Use owner/repo").optional(),
});

export async function updateConnectionAction(id: string, raw: z.input<typeof Patch>): Promise<{ error?: string }> {
  const parsed = Patch.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const c = await getConnection(id);
  if (!c) return { error: "Connection not found" };
  const { approval, defaultRepo, ...rest } = parsed.data;
  const meta = { ...c.meta, ...(approval ? { approval } : {}), ...(defaultRepo !== undefined ? { defaultRepo: defaultRepo || undefined } : {}) };
  await updateConnection(id, { ...rest, meta });
  revalidatePath("/connections");
  return {};
}

export async function deleteConnectionAction(id: string): Promise<void> {
  await deleteConnection(id);
  revalidatePath("/connections");
}

/** Checks the saved secret still works, with one cheap read. The answer is saved as lastError. */
export async function testConnection(id: string): Promise<{ ok?: string; error?: string }> {
  const c = await getConnection(id);
  if (!c || !CONNECTION_SERVICES.includes(c.service)) return { error: "Connection not found" };
  let result: { ok?: string; error?: string };
  try {
    const secret = open(c.secret);
    if (c.service === "github") {
      const me = await githubRequest<{ login: string }>(secret, "GET", "/user");
      result = { ok: `Signed in as ${me.login}` };
    } else if (c.service === "railway") {
      const project = c.meta.tokenType === "project";
      const data = project
        ? await railwayQuery<{ projectToken: { projectId: string } }>({ token: secret, projectToken: true }, "query { projectToken { projectId } }")
        : await railwayQuery<{ me: { email: string } }>({ token: secret, projectToken: false }, "query { me { email } }");
      result = { ok: "projectToken" in data ? `Project ${data.projectToken.projectId}` : `Signed in as ${data.me.email}` };
    } else if (c.service === "google") {
      await accessToken(c.id, secret);
      result = { ok: `Signed in as ${c.meta.email ?? "your Google account"}` };
    } else {
      const tools = await listServerTools(c);
      result = { ok: `${tools.length} tools: ${tools.slice(0, 8).map((t) => t.name).join(", ")}${tools.length > 8 ? "…" : ""}` };
    }
  } catch (e) {
    result = { error: (e as Error).message.slice(0, 500) };
  }
  await updateConnection(id, { lastError: result.error ?? null });
  return result;
}

export async function testConnectionAction(id: string): Promise<{ ok?: string; error?: string }> {
  const r = await testConnection(id);
  revalidatePath("/connections");
  return r;
}
