/**
 * The cloud computer behind the sandbox tools, behind one small interface so
 * the provider (E2B today) can be swapped for Daytona or another without
 * touching the runner or the tools.
 */

export type CommandResult = { exitCode: number; stdout: string; stderr: string };
export type FileEntry = { name: string; path: string; type: "file" | "dir"; size: number };

export interface SandboxMachine {
  /** The provider's id for this sandbox. */
  readonly externalId: string;
  run(cmd: string, opts: { cwd: string; timeoutMs: number }): Promise<CommandResult>;
  /** Starts a long-running command (a dev server) and returns without waiting. */
  start(cmd: string, opts: { cwd: string }): Promise<{ pid: number }>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  list(path: string, depth: number): Promise<FileEntry[]>;
  /** Public https address of a port inside the sandbox. */
  previewUrl(port: number): string;
  close(): Promise<void>;
}

export interface SandboxProvider {
  readonly name: string;
  /** False when the provider's API key isn't set. */
  available(): boolean;
  create(opts: { timeoutMs: number; metadata: Record<string, string> }): Promise<SandboxMachine>;
  /** Kills a sandbox by id, e.g. one a crashed server left running. */
  kill(externalId: string): Promise<void>;
}

const state = globalThis as unknown as { agentshubSandboxProvider?: SandboxProvider };

export function setSandboxProvider(provider: SandboxProvider | undefined): void {
  state.agentshubSandboxProvider = provider;
}

export async function getSandboxProvider(): Promise<SandboxProvider> {
  if (!state.agentshubSandboxProvider) {
    const { E2BProvider } = await import("./e2b");
    state.agentshubSandboxProvider = new E2BProvider();
  }
  return state.agentshubSandboxProvider;
}

/** Whether hosted agents with "cloud computer" on can get one right now. */
export async function sandboxesAvailable(): Promise<boolean> {
  if (process.env.SANDBOX_ENABLED === "0") return false;
  return (await getSandboxProvider()).available();
}
