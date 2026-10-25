import { Board } from "@/components/board/board";

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return <Board key={project ?? "all"} initialProject={project || "all"} />;
}
