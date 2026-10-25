/** E2B (e2b.dev) sandboxes: small Linux VMs with Node and Python, billed per second. */
import { CommandExitError, FileType, Sandbox } from "e2b";
import type { CommandResult, FileEntry, SandboxMachine, SandboxProvider } from "./provider";

export class E2BProvider implements SandboxProvider {
  readonly name = "e2b";

  available(): boolean {
    return Boolean(process.env.E2B_API_KEY);
  }

  async create(opts: { timeoutMs: number; metadata: Record<string, string> }): Promise<SandboxMachine> {
    const sandbox = await Sandbox.create(process.env.E2B_TEMPLATE || "base", {
      apiKey: process.env.E2B_API_KEY,
      // E2B kills the sandbox itself at this point, even if AgentsHUB goes down.
      timeoutMs: opts.timeoutMs,
      metadata: opts.metadata,
      // No server secrets go in: the sandbox starts with an empty environment.
      envs: {},
      allowInternetAccess: process.env.SANDBOX_INTERNET !== "0",
    });
    return new E2BMachine(sandbox);
  }

  async kill(externalId: string): Promise<void> {
    await Sandbox.kill(externalId, { apiKey: process.env.E2B_API_KEY });
  }
}

class E2BMachine implements SandboxMachine {
  constructor(private sandbox: Sandbox) {}

  get externalId(): string {
    return this.sandbox.sandboxId;
  }

  async run(cmd: string, opts: { cwd: string; timeoutMs: number }): Promise<CommandResult> {
    try {
      const r = await this.sandbox.commands.run(cmd, { cwd: opts.cwd, timeoutMs: opts.timeoutMs });
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
    } catch (e) {
      // A non-zero exit is a normal result for the agent, not a crash.
      if (e instanceof CommandExitError) return { exitCode: e.exitCode, stdout: e.stdout, stderr: e.stderr };
      throw e;
    }
  }

  async start(cmd: string, opts: { cwd: string }): Promise<{ pid: number }> {
    const handle = await this.sandbox.commands.run(cmd, { cwd: opts.cwd, background: true, timeoutMs: 0 });
    return { pid: handle.pid };
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const data = typeof content === "string" ? content : (content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer);
    await this.sandbox.files.write(path, data);
  }

  readFile(path: string): Promise<Uint8Array> {
    return this.sandbox.files.read(path, { format: "bytes" });
  }

  async list(path: string, depth: number): Promise<FileEntry[]> {
    const entries = await this.sandbox.files.list(path, { depth });
    return entries.map((e) => ({ name: e.name, path: e.path, type: e.type === FileType.DIR ? "dir" : "file", size: e.size }));
  }

  previewUrl(port: number): string {
    return `https://${this.sandbox.getHost(port)}`;
  }

  async close(): Promise<void> {
    await this.sandbox.kill();
  }
}
