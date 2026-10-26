/**
 * Railway tools, through Railway's public GraphQL API with the token saved on
 * the Connections page (an account or workspace token sees every project; a
 * project token sees one). Looking is free; redeploy, restart and rollback ask
 * you first.
 */
import { z } from "zod";
import { str, tool, ToolInputError, type AgentTool, type ToolContext } from "../agent-tools";
import { NoConnection, secretFor } from "../connections";
import { askFirst } from "./gate";

const API = "https://backboard.railway.com/graphql/v2";

type Rw = { token: string; projectToken: boolean };

async function rw(ctx: ToolContext): Promise<Rw> {
  try {
    const { connection, secret } = await secretFor(ctx.agent.id, "railway");
    return { token: secret, projectToken: connection.meta.tokenType === "project" };
  } catch (e) {
    if (e instanceof NoConnection) throw new ToolInputError(e.message);
    throw e;
  }
}

export async function railwayQuery<T>(auth: Rw, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth.projectToken ? { "project-access-token": auth.token } : { authorization: `Bearer ${auth.token}` }),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || json.errors?.length) throw new ToolInputError(`Railway API: ${json.errors?.map((e) => e.message).join("; ") ?? res.status}`);
  return json.data as T;
}

type Edges<T> = { edges: { node: T }[] };
const nodes = <T,>(e: Edges<T> | undefined) => e?.edges.map((x) => x.node) ?? [];

const PROJECTS = `query { projects { edges { node { id name services { edges { node { id name } } } environments { edges { node { id name } } } } } } }`;
const PROJECT = `query project($id: String!) { project(id: $id) { id name services { edges { node { id name } } } environments { edges { node { id name } } } } }`;
const DEPLOYMENTS = `query deployments($input: DeploymentListInput!, $first: Int) { deployments(input: $input, first: $first) { edges { node { id status createdAt staticUrl } } } }`;
const LOGS = `query deploymentLogs($deploymentId: String!, $limit: Int, $filter: String) { deploymentLogs(deploymentId: $deploymentId, limit: $limit, filter: $filter) { timestamp message severity } }`;
const BUILD_LOGS = `query buildLogs($deploymentId: String!, $limit: Int) { buildLogs(deploymentId: $deploymentId, limit: $limit) { timestamp message severity } }`;

type Proj = { id: string; name: string; services: Edges<{ id: string; name: string }>; environments: Edges<{ id: string; name: string }> };

const ids = {
  projectId: str("Project id from railway_projects"),
  serviceId: str("Service id from railway_projects"),
  environmentId: str("Environment id from railway_projects"),
};

export const RAILWAY_TOOLS: AgentTool[] = [
  tool({
    name: "railway_projects",
    description: "List the Railway projects you can reach, with their services and environments (ids for the other Railway tools).",
    inputSchema: { type: "object", properties: { projectId: str("Only this project (needed with a project token)") } },
    args: z.object({ projectId: z.string().optional() }),
    run: async ({ projectId }, ctx) => {
      const auth = await rw(ctx);
      const list = projectId ? [(await railwayQuery<{ project: Proj }>(auth, PROJECT, { id: projectId })).project] : nodes((await railwayQuery<{ projects: Edges<Proj> }>(auth, PROJECTS)).projects);
      return { projects: list.map((p) => ({ id: p.id, name: p.name, services: nodes(p.services), environments: nodes(p.environments) })) };
    },
  }),

  tool({
    name: "railway_deployments",
    description: "Recent deployments of a service in an environment, newest first, with their status.",
    inputSchema: { type: "object", properties: ids, required: ["projectId", "serviceId", "environmentId"] },
    args: z.object({ projectId: z.string(), serviceId: z.string(), environmentId: z.string() }),
    run: async (input, ctx) => {
      const d = await railwayQuery<{ deployments: Edges<{ id: string; status: string; createdAt: string; staticUrl: string | null }> }>(await rw(ctx), DEPLOYMENTS, { input, first: 10 });
      return { deployments: nodes(d.deployments) };
    },
  }),

  tool({
    name: "railway_logs",
    description: "Read a deployment's runtime logs (or build logs), newest last.",
    inputSchema: {
      type: "object",
      properties: { deploymentId: str("Deployment id from railway_deployments"), build: { type: "boolean", description: "Build logs instead of runtime logs" }, filter: str("Only lines with this text"), limit: { type: "number", description: "Lines (default 200, max 1000)" } },
      required: ["deploymentId"],
    },
    args: z.object({ deploymentId: z.string(), build: z.boolean().optional(), filter: z.string().max(200).optional(), limit: z.number().int().min(1).max(1000).default(200) }),
    run: async ({ deploymentId, build, filter, limit }, ctx) => {
      const auth = await rw(ctx);
      const lines = build
        ? (await railwayQuery<{ buildLogs: { timestamp: string; message: string; severity: string }[] }>(auth, BUILD_LOGS, { deploymentId, limit })).buildLogs
        : (await railwayQuery<{ deploymentLogs: { timestamp: string; message: string; severity: string }[] }>(auth, LOGS, { deploymentId, limit, filter })).deploymentLogs;
      return { lines: lines.map((l) => `${l.timestamp} ${l.severity ?? ""} ${l.message}`.slice(0, 2_000)) };
    },
  }),

  tool({
    name: "railway_redeploy",
    description: "Redeploy, restart (no rebuild) or roll back to a deployment. Asks the user first.",
    inputSchema: { type: "object", properties: { deploymentId: str("Deployment id"), how: { type: "string", enum: ["redeploy", "restart", "rollback"] }, reason: str("Why") }, required: ["deploymentId", "how"] },
    args: z.object({ deploymentId: z.string(), how: z.enum(["redeploy", "restart", "rollback"]), reason: z.string().max(2_000).optional() }),
    run: async ({ deploymentId, how, reason }, ctx) => {
      const auth = await rw(ctx);
      const asked = await askFirst(ctx, { action: `Railway: ${how} deployment ${deploymentId}`, service: "Railway", details: reason, alwaysAsk: true });
      if (!asked.ok) return asked.refused;
      const mutation = {
        redeploy: `mutation m($id: String!) { deploymentRedeploy(id: $id) { id status } }`,
        restart: `mutation m($id: String!) { deploymentRestart(id: $id) }`,
        rollback: `mutation m($id: String!) { deploymentRollback(id: $id) { id status } }`,
      }[how];
      return { done: true, result: await railwayQuery(auth, mutation, { id: deploymentId }) };
    },
  }),
];
