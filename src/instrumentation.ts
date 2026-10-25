/**
 * Next.js calls this once when the server starts. It starts the runner for
 * hosted agents, unless RUNNER_ENABLED=0 (e.g. when you run several web
 * instances and only one should drive agents).
 */
export async function register(): Promise<void> {
  // Written as one condition so the Edge build drops the Node-only import.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUNNER_ENABLED !== "0") {
    const { startRunner } = await import("./lib/runner/runner");
    startRunner();
  }
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Errors nothing else caught are logged, shown on the Status page and emailed.
    const { recordProblem } = await import("./lib/monitor");
    process.on("unhandledRejection", (e) => void recordProblem("server", e));
    process.on("uncaughtExceptionMonitor", (e) => void recordProblem("server", e));
    const { checkBlobStore } = await import("./lib/storage");
    void checkBlobStore()
      .then((r) => r === "ok" && console.log("[storage] file bucket works"))
      .catch((e) => void recordProblem("storage", new Error(`file bucket check failed; new files fall back to the database: ${(e as Error).message}`)));
  }
}
