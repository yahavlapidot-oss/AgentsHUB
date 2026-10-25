"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useLive } from "./live";

/** Re-renders a server page when the live data changes (not on every poll). */
export function RefreshOnTick() {
  const router = useRouter();
  const { version } = useLive();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    router.refresh();
  }, [version, router]);
  return null;
}
