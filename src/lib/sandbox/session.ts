/**
 * The Sandbox Manager. A hosted run gets one SandboxSession; the cloud computer
 * itself opens on the first sandbox tool call (so runs that never need one cost
 * nothing) and is always closed when the run ends. Limits:
 *
 * - SANDBOX_MAX_CONCURRENT sandboxes open at once over all agents (default 3).
 * - SANDBOX_TIMEOUT_MS lifetime, enforced by the provider too (default 30 min).
 * - SANDBOX_COMMAND_TIMEOUT_MS per command (default 5 min).
 * - The sandbox gets no server secrets; outputs are trimmed before the model sees them.
 *
 * Time in the sandbox is priced at SANDBOX_USD_PER_HOUR and added to the run's cost,
 * so it counts toward the task budget and the usage page.
 */
import {
  addUsage,
  createSandboxRecord,
  getArtifact,
  getArtifacts,
  getOpenSandboxes,
  updateSandboxRecord,
} from "../data";
import type { Sandbox } from "../schema";
import { getSandboxProvider, type CommandResult, type FileEntry, type SandboxMachine } from "./provider";

export const WORKDIR = "/home/user/work";
const MAX_CONCURRENT = Number(process.env.SANDBOX_MAX_CONCURRENT ?? 3);
const LIFETIME_MS = Number(process.env.SANDBOX_TIMEOUT_MS ?? 30 * 60_000);
const COMMAND_TIMEOUT_MS = Number(process.env.SANDBOX_COMMAND_TIMEOUT_MS ?? 5 * 60_000);
/** E2B's default 2 vCPU / 512 MiB machine is about $0.11 an hour. */
const USD_PER_HOUR = Number(process.env.SANDBOX_USD_PER_HOUR ?? 0.11);
const OUTPUT_LIMIT = 12_000;

export class SandboxLimitError extends Error {}

export class SandboxSession {
  private machine: SandboxMachine | null = null;
  private opening: Promise<SandboxMachine> | null = null;
  private record: Sandbox | null = null;
  private openedAt = 0;
  private closed = false;

  constructor(private ctx: { agentId: string; taskId: string | null; runId: string }) {}

  get id(): string | null {
    return this.record?.id ?? null;
  }

  get isOpen(): boolean {
    return Boolean(this.machine) && !this.closed;
  }

  /** The machine, opening it on first use. */
  async get(): Promise<SandboxMachine> {
    if (this.closed) throw new SandboxLimitError("The cloud computer for this run is already closed");
    if (this.machine) return this.machine;
    this.opening ??= this.open().finally(() => (this.opening = null));
    return this.opening;
  }

  private async open(): Promise<SandboxMachine> {
    const provider = await getSandboxProvider();
    if (!provider.available()) throw new SandboxLimitError("Cloud computers aren't set up on the server (E2B_API_KEY is missing)");
    const open = await getOpenSandboxes();
    if (open.length >= MAX_CONCURRENT) {
      throw new SandboxLimitError(`${open.length} cloud computers are already running (limit ${MAX_CONCURRENT}). Try again in a few minutes.`);
    }
    this.record = await createSandboxRecord({ ...this.ctx, provider: provider.name });
    try {
      const machine = await provider.create({
        timeoutMs: LIFETIME_MS,
        metadata: { agentshubSandboxId: this.record.id, agentId: this.ctx.agentId, taskId: this.ctx.taskId ?? "" },
      });
      this.machine = machine;
      this.openedAt = Date.now();
      await updateSandboxRecord(this.record.id, { externalId: machine.externalId, status: "running" });
      await machine.run(`mkdir -p ${WORKDIR}`, { cwd: "/", timeoutMs: 30_000 });
      await this.restoreFiles(machine);
      return machine;
    } catch (e) {
      await updateSandboxRecord(this.record.id, { status: "failed", error: String((e as Error).message ?? e).slice(0, 1_000), endedAt: Date.now() });
      throw e;
    }
  }

  /** Files saved on this task in earlier runs come back, so work can continue where it stopped. */
  private async restoreFiles(machine: SandboxMachine): Promise<void> {
    if (!this.ctx.taskId) return;
    for (const info of await getArtifacts({ taskId: this.ctx.taskId, latestOnly: true })) {
      const full = await getArtifact(info.id);
      if (full) await machine.writeFile(`${WORKDIR}/${full.path}`, new Uint8Array(full.content));
    }
  }

  async run(cmd: string, opts: { cwd?: string; timeoutMs?: number } = {}): Promise<CommandResult> {
    const machine = await this.get();
    const res = await machine.run(cmd, {
      cwd: resolvePath(opts.cwd ?? "."),
      timeoutMs: Math.min(opts.timeoutMs ?? COMMAND_TIMEOUT_MS, COMMAND_TIMEOUT_MS),
    });
    await updateSandboxRecord(this.record!.id, { addCommands: 1 });
    return { exitCode: res.exitCode, stdout: tail(res.stdout), stderr: tail(res.stderr) };
  }

  async start(cmd: string, opts: { cwd?: string } = {}): Promise<{ pid: number }> {
    const machine = await this.get();
    const res = await machine.start(cmd, { cwd: resolvePath(opts.cwd ?? ".") });
    await updateSandboxRecord(this.record!.id, { addCommands: 1 });
    return res;
  }

  async writeFile(path: string, content: string): Promise<string> {
    const full = resolvePath(path);
    await (await this.get()).writeFile(full, content);
    return full;
  }

  async readFile(path: string): Promise<Uint8Array> {
    return (await this.get()).readFile(resolvePath(path));
  }

  async list(path: string, depth: number): Promise<FileEntry[]> {
    return (await this.get()).list(resolvePath(path), Math.max(1, Math.min(depth, 5)));
  }

  async previewUrl(port: number): Promise<string> {
    return (await this.get()).previewUrl(port);
  }

  /** Closes the machine and books its time on the run. Safe to call more than once. */
  async close(outcome: "closed" | "failed" = "closed"): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const opening = this.opening;
    if (opening) await opening.catch(() => null);
    if (!this.machine || !this.record) return;
    let error: string | null = null;
    try {
      await this.machine.close();
    } catch (e) {
      // The provider's own timeout still ends it; note why it didn't close cleanly.
      error = String((e as Error).message ?? e).slice(0, 1_000);
    }
    const cost = sandboxCost(Date.now() - this.openedAt);
    await updateSandboxRecord(this.record.id, { status: outcome, costUsd: cost, endedAt: Date.now(), error });
    await addUsage(this.ctx.agentId, this.ctx.runId, { tokensIn: 0, tokensOut: 0, costUsd: cost });
  }

  /** What the sandbox has cost so far, for budget checks while it runs. */
  runningCost(): number {
    return this.isOpen ? sandboxCost(Date.now() - this.openedAt) : 0;
  }
}

export function sandboxCost(ms: number): number {
  return (Math.max(0, ms) / 3_600_000) * USD_PER_HOUR;
}

/** Paths are relative to the work folder; absolute paths must stay inside /home/user or /tmp. */
export function resolvePath(path: string): string {
  const raw = path.trim() || ".";
  const full = raw.startsWith("/") ? raw : `${WORKDIR}/${raw}`;
  const parts: string[] = [];
  for (const p of full.split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  const clean = `/${parts.join("/")}`;
  if (!(clean === "/home/user" || clean.startsWith("/home/user/") || clean === "/tmp" || clean.startsWith("/tmp/"))) {
    throw new SandboxLimitError(`Use paths inside ${WORKDIR} (got ${path})`);
  }
  return clean;
}

function tail(s: string): string {
  return s.length > OUTPUT_LIMIT ? `…(${s.length - OUTPUT_LIMIT} earlier characters cut)\n${s.slice(-OUTPUT_LIMIT)}` : s;
}

/**
 * On server start: sandboxes the database still shows as open belong to runs
 * that died with the last process. Kill them and mark them closed.
 */
export async function reapOrphanedSandboxes(): Promise<number> {
  const open = await getOpenSandboxes();
  if (!open.length) return 0;
  const provider = await getSandboxProvider();
  for (const s of open) {
    let error: string | null = "Closed after a server restart";
    if (s.externalId && provider.available()) {
      try {
        await provider.kill(s.externalId);
      } catch (e) {
        error = `Closed after a server restart; kill failed: ${String((e as Error).message ?? e).slice(0, 500)}`;
      }
    }
    await updateSandboxRecord(s.id, { status: "closed", endedAt: Date.now(), error, costUsd: sandboxCost(Math.min(Date.now() - s.startedAt, LIFETIME_MS)) });
  }
  return open.length;
}
