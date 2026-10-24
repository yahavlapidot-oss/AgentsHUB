"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useLive } from "./live";

/** Re-renders a server page each time the live snapshot updates. */
export function RefreshOnTick() {
  const router = useRouter();
  const { generatedAt } = useLive();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    router.refresh();
  }, [generatedAt, router]);
  return null;
}
