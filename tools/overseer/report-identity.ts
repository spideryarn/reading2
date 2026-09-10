/**
 * **WHICH CLAUDE RUN AM I?** — the submitter's half of the execution comparison.
 * Plan 260910e, Stage 1, and GPT Sol's WR-P4.
 *
 * A report carries the token of the Claude process it was submitted from, and the
 * daemon compares that with the register's verified token for the named session:
 * equal is the same run, different is a reused name or a register still holding
 * an older run. A clock cannot answer this — the register's `since` is a floor,
 * not a start — so the submitter names its run the way the register does:
 * `boot:pid:startTicks` of the process whose argv[0] basename is `claude`, which
 * is the same process `classifyPaneHarness` names for a pane.
 *
 * The walk goes UP from this process's parent through `/proc/<pid>/stat`, at most
 * `MAX_ANCESTRY_STEPS` steps. **No token is a reason, never a guess**: a report
 * with no token is recorded as `unverifiable`, which is what it is.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseProcStat, readBootIdentity, type ReadTextFile } from "../fleet/execution-identity.js";
import { executionTokenText } from "../fleet/execution-token.js";

export const MAX_ANCESTRY_STEPS = 20;

export type OwnExecution = { kind: "observed"; pid: number; token: string } | { kind: "unobserved"; why: string };

type StableProcess =
  | { ok: true; argv0: string; ppid: number; startTicks: number }
  | { ok: false; why: string };

/** The command line and stat fields belonged to one pid incarnation, or no claim. */
function readStableProcess(pid: number, read: ReadTextFile): StableProcess {
  const stat = (when: "before" | "after"): ReturnType<typeof parseProcStat> | { ok: false; why: string } => {
    let raw: string;
    try {
      raw = read(`/proc/${pid}/stat`);
    } catch (cause) {
      return { ok: false, why: `/proc/${pid}/stat could not be read ${when} its command line: ${cause instanceof Error ? cause.message : String(cause)}` };
    }
    const parsed = parseProcStat(raw);
    return parsed.ok ? parsed : { ok: false, why: `/proc/${pid}/stat could not be parsed: ${parsed.why}` };
  };

  const before = stat("before");
  if (!before.ok) return before;
  let argv0: string;
  try {
    argv0 = read(`/proc/${pid}/cmdline`).split("\0")[0] ?? "";
  } catch (cause) {
    return { ok: false, why: `/proc/${pid}/cmdline could not be read: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const after = stat("after");
  if (!after.ok) return after;
  if (before.ppid !== after.ppid || before.startTicks !== after.startTicks) {
    return { ok: false, why: `pid ${pid} changed while it was read, so its command line and start time do not identify one process` };
  }
  return { ok: true, argv0, ppid: after.ppid, startTicks: after.startTicks };
}

export function observeOwnExecution(
  deps: { ppid?: number; read?: ReadTextFile; platform?: string } = {},
): OwnExecution {
  const read = deps.read ?? ((file: string) => readFileSync(file, "utf8"));
  const boot = readBootIdentity(read, deps.platform ?? process.platform);
  if (!boot.read) return { kind: "unobserved", why: boot.why };

  let pid = deps.ppid ?? process.ppid;
  for (let step = 0; step < MAX_ANCESTRY_STEPS; step += 1) {
    if (pid <= 1) return { kind: "unobserved", why: `reached pid ${pid} after ${step} steps without finding a claude process` };
    const reading = readStableProcess(pid, read);
    if (!reading.ok) return { kind: "unobserved", why: reading.why };
    if (path.basename(reading.argv0) === "claude") {
      return { kind: "observed", pid, token: executionTokenText({ boot: boot.id, pid, startTicks: reading.startTicks }) };
    }
    pid = reading.ppid;
  }
  return { kind: "unobserved", why: `no claude process within ${MAX_ANCESTRY_STEPS} ancestors of this one` };
}
