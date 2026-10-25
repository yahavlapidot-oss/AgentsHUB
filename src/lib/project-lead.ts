import type { Agent, Project } from "./schema";

/** A project without members is open to every agent. */
export function isProjectMember(project: Pick<Project, "memberAgentIds"> | null, agentId: string): boolean {
  return !project || !project.memberAgentIds.length || project.memberAgentIds.includes(agentId);
}

/**
 * The project's work manager: the lead you picked for it, otherwise a team lead
 * who may work on the project. The project chat talks to it.
 */
export function projectLead<A extends Pick<Agent, "id" | "role">>(project: Pick<Project, "leadAgentId" | "memberAgentIds">, agents: A[]): A | null {
  const picked = project.leadAgentId ? agents.find((a) => a.id === project.leadAgentId) : undefined;
  return picked ?? agents.find((a) => a.role === "lead" && isProjectMember(project, a.id)) ?? null;
}
