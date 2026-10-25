"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NewTaskDialog } from "../board/new-task-dialog";

export function NewProjectTask({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>New task</button>
      {open && (
        <NewTaskDialog
          projectId={projectId}
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
