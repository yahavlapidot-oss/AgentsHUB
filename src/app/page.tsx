import { Board } from "@/components/board/board";

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ project?: string; task?: string }> }) {
  const { project, task } = await searchParams;
  return <Board key={project ?? "all"} initialProject={project || "all"} initialTaskId={task ?? null} />;
}
