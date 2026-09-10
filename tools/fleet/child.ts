import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

export type ProbeSpec = {
  /** Which probe this is — the unit that gets refused while one of its children is unaccounted for. */
  key: string;
  cmd: string;
  args: readonly string[];
  /** How long the CALLER waits before the child is signalled. */
  timeoutMs: number;
  /** How long between SIGTERM and SIGKILL. Small. */
  graceMs?: number;
  /** Cap on captured stdout+stderr. Overflow kills the child and is an outcome, not a truncation. */
  maxBytes?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type OwnedOutcome =
  | { kind: "ok"; stdout: string; stderr: string; tookMs: number }
  | { kind: "failed"; why: string; tookMs: number; exitCode: number | null; signal: NodeJS.Signals | null }
  /** The deadline expired: we signalled, and stopped waiting. `exitObserved` says whether it died. */
  | { kind: "timed-out"; why: string; tookMs: number; pid: number | null; exitObserved: boolean }
  /** Not started, because a child of this key is still unaccounted for. */
  | { kind: "refused"; why: string; pid: number; liveForMs: number }
  /** Overflowed `maxBytes`. Never a truncated `ok`. */
  | { kind: "overflowed"; why: string; tookMs: number; capturedBytes: number };

export type LiveChild = {
  key: string;
  pid: number;
  startedAtMs: number;
  signalled: readonly NodeJS.Signals[];
  /** True once `close`/`exit`, or the kernel's exited state, was seen. False after SIGKILL is STUCK. */
  exitObserved: boolean;
};

export type ProbeOwner = {
  run(spec: ProbeSpec): Promise<OwnedOutcome>;
  /** Children whose exit has NOT been observed. Empty is the healthy state. */
  live(): readonly LiveChild[];
};

type TrackedChild = {
  key: string;
  pid: number;
  startedAtMs: number;
  signalled: NodeJS.Signals[];
  exitObserved: boolean;
  child: ChildProcess;
};

type GroupProof =
  | { kind: "owned" }
  | { kind: "different"; pgrp: number }
  | { kind: "unreadable"; why: string };

const DEFAULT_GRACE_MS = 100;
const DEFAULT_MAX_BYTES = 1024 * 1024;

type ProcIdentity = { state: string; pgrp: number };

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function procIdentity(stat: string): ProcIdentity | null {
  // `comm` may contain spaces and `)`, so fields counted from the left are not
  // fields at all. After the last `)`: state, ppid, pgrp, … — pgrp is index 2.
  const commEnd = stat.lastIndexOf(")");
  if (commEnd < 0) return null;
  const fields = stat.slice(commEnd + 1).trim().split(/\s+/);
  const state = fields[0];
  const raw = fields[2];
  if (state === undefined || raw === undefined || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? { state, pgrp: parsed } : null;
}

function stderrSuffix(stderr: string): string {
  const explanation = stderr.trim();
  return explanation === "" ? "" : `: ${explanation}`;
}

function validBound(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

type OutcomeState = {
  spec: ProbeSpec;
  maxBytes: number;
  duration: number;
  stdout: string;
  stderr: string;
  capturedBytes: number;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  spawnFailure: string | null;
  timedOut: boolean;
  overflowed: boolean;
  signalNotes: readonly string[];
  pid: number | null;
  exitObserved: boolean;
};

function notesSuffix(notes: readonly string[]): string {
  return notes.length === 0 ? "" : `; ${notes.join("; ")}`;
}

function exitStatus(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal !== null) return `was terminated by ${signal}`;
  if (code !== null) return `exited with code ${code}`;
  return "closed without an exit code or signal";
}

function ownedOutcome(state: OutcomeState): OwnedOutcome {
  if (state.overflowed) {
    return {
      kind: "overflowed",
      why:
        `probe "${state.spec.key}" exceeded its ${state.maxBytes}-byte stdout+stderr capture cap` +
        notesSuffix(state.signalNotes),
      tookMs: state.duration,
      capturedBytes: state.capturedBytes,
    };
  }
  if (state.timedOut) {
    return {
      kind: "timed-out",
      why:
        `probe "${state.spec.key}" reached its ${state.spec.timeoutMs}ms deadline` +
        notesSuffix(state.signalNotes) +
        (state.exitObserved ? "; child exit was observed" : "; child exit has not been observed"),
      tookMs: state.duration,
      pid: state.pid,
      exitObserved: state.exitObserved,
    };
  }
  if (state.spawnFailure !== null) {
    return {
      kind: "failed",
      why: `could not start ${state.spec.cmd}: ${state.spawnFailure}`,
      tookMs: state.duration,
      exitCode: state.exitCode,
      signal: state.exitSignal,
    };
  }
  if (state.exitCode === 0 && state.exitSignal === null) {
    return { kind: "ok", stdout: state.stdout, stderr: state.stderr, tookMs: state.duration };
  }
  return {
    kind: "failed",
    why: `${state.spec.cmd} ${exitStatus(state.exitCode, state.exitSignal)}${stderrSuffix(state.stderr)}`,
    tookMs: state.duration,
    exitCode: state.exitCode,
    signal: state.exitSignal,
  };
}

/**
 * Own every child until its exit is observed, even after its caller has been
 * released. A late child only releases its key; its late output is never used
 * as a fresh reading. That is the same stale-answer rule as singleFlightCollect.
 */
export function probeOwner(deps: {
  spawn?: typeof import("node:child_process").spawn;
  now?: () => number;
  /** Reads `/proc/<pid>/stat`. Injected so the group-ownership proof can be tested. */
  readProcStat?: (pid: number) => string;
} = {}): ProbeOwner {
  const spawn = deps.spawn ?? nodeSpawn;
  const now = deps.now ?? Date.now;
  const readProcStat = deps.readProcStat ?? ((pid: number) => readFileSync(`/proc/${pid}/stat`, "utf8"));
  const children = new Map<string, TrackedChild>();

  function elapsedSince(startedAtMs: number): number {
    try {
      return Math.max(0, now() - startedAtMs);
    } catch {
      // The caller still gets a failure value if an injected clock fails after
      // the run started. There is no honest duration available in that case.
      return 0;
    }
  }

  function live(): readonly LiveChild[] {
    return [...children.values()]
      .filter((entry) => !entry.exitObserved)
      .map((entry) => ({
        key: entry.key,
        pid: entry.pid,
        startedAtMs: entry.startedAtMs,
        signalled: [...entry.signalled],
        exitObserved: false,
      }));
  }

  function proveGroup(pid: number): GroupProof {
    let stat: string;
    try {
      stat = readProcStat(pid);
    } catch (cause) {
      return { kind: "unreadable", why: `could not read /proc/${pid}/stat: ${errorText(cause)}` };
    }
    const identity = procIdentity(stat);
    if (identity === null) {
      return { kind: "unreadable", why: `/proc/${pid}/stat did not contain a readable process-group id` };
    }
    return identity.pgrp === pid ? { kind: "owned" } : { kind: "different", pgrp: identity.pgrp };
  }

  function sendToPid(entry: TrackedChild, signal: NodeJS.Signals, reason: string): string {
    try {
      if (entry.child.kill(signal)) {
        entry.signalled.push(signal);
        return `${reason}; sent ${signal} to pid ${entry.pid} only`;
      }
      return `${reason}; ${signal} could not be sent to pid ${entry.pid}`;
    } catch (cause) {
      return `${reason}; ${signal} could not be sent to pid ${entry.pid}: ${errorText(cause)}`;
    }
  }

  function signal(entry: TrackedChild, requested: NodeJS.Signals): string {
    const proof = proveGroup(entry.pid);
    if (proof.kind === "different") {
      return sendToPid(
        entry,
        requested,
        `/proc/${entry.pid}/stat reported process group ${proof.pgrp}, not child pid ${entry.pid}`,
      );
    }
    if (proof.kind === "unreadable") return sendToPid(entry, requested, proof.why);

    // A negative pid addresses a process group. It is used only after the
    // immediately preceding /proc read proved that this child leads that group.
    try {
      process.kill(-entry.pid, requested);
      entry.signalled.push(requested);
      return `sent ${requested} to proved child process group ${entry.pid}`;
    } catch (cause) {
      return sendToPid(
        entry,
        requested,
        `sending ${requested} to proved process group ${entry.pid} failed: ${errorText(cause)}`,
      );
    }
  }

  async function run(spec: ProbeSpec): Promise<OwnedOutcome> {
    let startedAtMs: number;
    try {
      startedAtMs = now();
    } catch (cause) {
      return {
        kind: "failed",
        why: `probe "${spec.key}" could not read its clock: ${errorText(cause)}`,
        tookMs: 0,
        exitCode: null,
        signal: null,
      };
    }

    const existing = children.get(spec.key);
    if (existing !== undefined && !existing.exitObserved) {
      const liveForMs = Math.max(0, startedAtMs - existing.startedAtMs);
      return {
        kind: "refused",
        why:
          `probe "${spec.key}" still has child pid ${existing.pid} unaccounted for after ${liveForMs}ms; ` +
          "no second child was started",
        pid: existing.pid,
        liveForMs,
      };
    }

    const graceMs = spec.graceMs ?? DEFAULT_GRACE_MS;
    const maxBytes = spec.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!validBound(spec.timeoutMs) || !validBound(graceMs) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      return {
        kind: "failed",
        why:
          `probe "${spec.key}" has invalid bounds: timeoutMs and graceMs must be finite and non-negative, ` +
          "and maxBytes must be a positive safe integer",
        tookMs: elapsedSince(startedAtMs),
        exitCode: null,
        signal: null,
      };
    }

    let child: ChildProcess;
    try {
      child = spawn(spec.cmd, spec.args, {
        stdio: ["ignore", "pipe", "pipe"],
        // On POSIX this creates the process group we later prove before using.
        detached: process.platform !== "win32",
        ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
        ...(spec.env === undefined ? {} : { env: spec.env }),
      });
    } catch (cause) {
      return {
        kind: "failed",
        why: `could not start ${spec.cmd}: ${errorText(cause)}`,
        tookMs: elapsedSince(startedAtMs),
        exitCode: null,
        signal: null,
      };
    }

    const pid = child.pid ?? null;
    const tracked: TrackedChild | null = pid === null ? null : {
      key: spec.key,
      pid,
      startedAtMs,
      signalled: [],
      exitObserved: false,
      child,
    };
    if (tracked !== null) children.set(spec.key, tracked);

    try {
      return await new Promise<OwnedOutcome>((settle) => {
        let stdout = "";
        let stderr = "";
        let capturedBytes = 0;
        let exitCode: number | null = null;
        let exitSignal: NodeJS.Signals | null = null;
        let spawnFailure: string | null = null;
        let timedOut = false;
        let overflowed = false;
        let settled = false;
        let decodersFlushed = false;
        const signalNotes: string[] = [];
        const stdoutDecoder = new StringDecoder("utf8");
        const stderrDecoder = new StringDecoder("utf8");
        let deadlineTimer: NodeJS.Timeout | undefined;
        let killTimer: NodeJS.Timeout | undefined;
        let forcedTimer: NodeJS.Timeout | undefined;
        let forcedImmediate: NodeJS.Immediate | undefined;

        const tookMs = (): number => elapsedSince(startedAtMs);

        const observeExit = (): void => {
          if (tracked === null || tracked.exitObserved) return;
          tracked.exitObserved = true;
          // An old child's later `close` must not delete a successor which was
          // started after this child's earlier `exit` released the key.
          if (children.get(tracked.key) === tracked) children.delete(tracked.key);
        };

        const observeKernelExit = (): void => {
          if (tracked === null || tracked.exitObserved) return;
          try {
            const identity = procIdentity(readProcStat(tracked.pid));
            // `Z` is dead and awaiting its parent's reap; `X` is the kernel's
            // rarer dead state. Neither can still run or multiply probe work.
            if (identity?.state === "Z" || identity?.state === "X") observeExit();
          } catch (cause) {
            // After a successful spawn, ENOENT is positive evidence that this
            // pid is gone. EACCES and every generic read failure say only that
            // we could not look, and must leave the child registered.
            if ((cause as NodeJS.ErrnoException).code === "ENOENT") observeExit();
          }
        };

        const flushDecoders = (): void => {
          if (decodersFlushed) return;
          decodersFlushed = true;
          if (!overflowed) {
            stdout += stdoutDecoder.end();
            stderr += stderrDecoder.end();
          }
        };

        const releasePipe = (stream: ChildProcess["stdout"]): void => {
          if (stream === null) return;
          try {
            stream.destroy();
          } catch {
            // It is already closed; there is no handle left to release.
          }
          try {
            (stream as typeof stream & { unref?: () => void }).unref?.();
          } catch {
            // Some fake and already-closed streams reject an extra unref.
          }
        };

        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(deadlineTimer);
          clearTimeout(killTimer);
          clearTimeout(forcedTimer);
          clearImmediate(forcedImmediate);
          flushDecoders();
          // A resolved promise does not release a pipe held open by a leaked
          // grandchild. F8 in subagent-cli.ts was a process that printed Done
          // and then stayed alive until that grandchild finally closed it.
          releasePipe(child.stdout);
          releasePipe(child.stderr);
          if (tracked !== null && !tracked.exitObserved) {
            try {
              child.unref();
            } catch {
              // The handle is already gone; there is nothing left to release.
            }
          }
          settle(ownedOutcome({
            spec,
            maxBytes,
            duration: tookMs(),
            stdout,
            stderr,
            capturedBytes,
            exitCode,
            exitSignal,
            spawnFailure,
            timedOut,
            overflowed,
            signalNotes,
            pid,
            exitObserved: tracked?.exitObserved ?? false,
          }));
        };

        const forceOnImmediate = (): void => {
          if (settled) return;
          forcedImmediate ??= setImmediate(() => {
            // Node 26 can deliver ChildProcess `exit` after this immediate even
            // when the process is already dead. Sample the kernel here so the
            // result does not depend on libuv scheduling: only Z/X or ENOENT is
            // positive evidence. A D/S/R child remains live and blocks retries.
            observeKernelExit();
            finish();
          });
        };

        const armForcedTimer = (): void => {
          if (settled) return;
          forcedTimer ??= setTimeout(finish, graceMs);
        };

        const capture = (chunk: unknown, destination: "stdout" | "stderr"): void => {
          if (overflowed || settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
          capturedBytes += bytes.length;
          if (capturedBytes > maxBytes) {
            overflowed = true;
            clearTimeout(deadlineTimer);
            clearTimeout(killTimer);
            if (tracked !== null) signalNotes.push(signal(tracked, "SIGKILL"));
            else signalNotes.push("the child had no pid, so SIGKILL could not be sent");
            // Clearing all timers here used to make overflow unbounded when a
            // leaked helper kept a pipe open. This is F9 in subagent-cli.ts.
            armForcedTimer();
            return;
          }
          if (destination === "stdout") stdout += stdoutDecoder.write(bytes);
          else stderr += stderrDecoder.write(bytes);
        };

        child.stdout?.on("data", (chunk: unknown) => capture(chunk, "stdout"));
        child.stderr?.on("data", (chunk: unknown) => capture(chunk, "stderr"));

        child.on("error", (cause) => {
          spawnFailure = errorText(cause);
          // A spawn error with a pid is not evidence that the process exited.
          // Keep it registered until exit/close makes that claim true.
          finish();
        });

        child.on("exit", (code, sentSignal) => {
          exitCode = code;
          exitSignal = sentSignal;
          observeExit();
          if (settled) return;
          clearTimeout(deadlineTimer);
          clearTimeout(killTimer);
          if (timedOut) forceOnImmediate();
          else armForcedTimer();
        });

        child.on("close", (code, sentSignal) => {
          exitCode = code;
          exitSignal = sentSignal;
          observeExit();
          finish();
        });

        deadlineTimer = setTimeout(() => {
          timedOut = true;
          if (tracked !== null) signalNotes.push(signal(tracked, "SIGTERM"));
          else signalNotes.push("the child had no pid, so SIGTERM could not be sent");
          if (tracked?.exitObserved) {
            forceOnImmediate();
            return;
          }
          killTimer = setTimeout(() => {
            if (tracked !== null) signalNotes.push(signal(tracked, "SIGKILL"));
            else signalNotes.push("the child had no pid, so SIGKILL could not be sent");
            observeKernelExit();
            // There is one grace, not two. F11 in subagent-cli.ts waited a
            // second grace here and returned at timeout + 2×grace. One
            // immediate lets an exit from this SIGKILL tick count, then frees
            // the caller whether the process obeyed or not.
            forceOnImmediate();
          }, graceMs);
        }, spec.timeoutMs);
      });
    } catch (cause) {
      return {
        kind: "failed",
        why: `probe "${spec.key}" failed inside its process owner: ${errorText(cause)}`,
        tookMs: elapsedSince(startedAtMs),
        exitCode: null,
        signal: null,
      };
    }
  }

  return { run, live };
}

/** A concurrency limiter. `limit(3)` returns a function that runs at most 3 jobs at once. */
export function limit(n: number): <T>(job: () => Promise<T>) => Promise<T> {
  if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError("the concurrency limit must be a positive integer");
  let active = 0;
  const waiting: Array<() => void> = [];

  const startWaiting = (): void => {
    while (active < n) {
      const start = waiting.shift();
      if (start === undefined) return;
      active += 1;
      start();
    }
  };

  return function runLimited<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        const complete = (): void => {
          active -= 1;
          startWaiting();
        };
        void Promise.resolve()
          .then(job)
          .then(
            (value) => {
              resolve(value);
              complete();
            },
            (cause: unknown) => {
              reject(cause);
              complete();
            },
          );
      });
      startWaiting();
    });
  };
}
