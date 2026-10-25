import { ProjectChat } from "@/components/chat/project-chat";

export default async function ProjectChatPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectChat projectId={projectId} />;
}
