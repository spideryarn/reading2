/**
 * The one thing in this pair that touches the machine: read the process table.
 *
 * Split out of `work.ts` so the split is structural rather than a promise. The
 * classifier is pure over a snapshot and is tested against captures; this file
 * is a thin adapter over `ps` and is tested against the box it is running on.
 * If it grows a decision, the decision is in the wrong file.
 *
 * ## Why `ps` and not /proc
 *
 * `/proc/<pid>/stat` and `cmdline` would work and would need no subprocess, but
 * they need ~1000 file reads on this box and each one races the process
 * exiting, so half the work would be deciding what a mid-walk ENOENT means. One
 * `ps` is a single atomic-enough read that costs ~40 ms and yields one text
 * blob that either arrived or did not. The direction doc is emphatic that a
 * tick here is a participant in the box's load - "a tick that costs 12 seconds
 * of grepping every 60 is 20% of a core, forever" - so cheap matters.
 *
 * ## What a reading is and is not
 *
 * It is what the kernel said at `atMs`, not what is true now. `ps` walks
 * `/proc` while processes come and go, so a table can contain a child whose
 * parent has already exited, and can miss a process that started during the
 * walk. Nothing here tries to correct for that; `work.ts` says what the
 * consequences are.
 */
import { spawnSync } from "node:child_process";

import { parseProcessTable, type ProcessTableReading } from "./work.js";

/**
 * The columns, with `=` on each so ps prints no header.
 *
 * `args` must be LAST: it is the only variable-width column, and any field
 * after it would be swallowed by a command line containing spaces. `etimes`
 * rather than `lstart` for the reasons in `parseProcessTable`.
 *
 * Exported so a test can assert the parser and the request still describe the
 * same four columns - the pair that would otherwise drift silently, since a ps
 * with different columns still exits 0 and still prints lines.
 */
export const PS_ARGV: readonly string[] = ["-eo", "pid=,ppid=,etimes=,args="];

/**
 * Long enough that a swapping box still answers, short enough that a tick does
 * not wedge. Measured at ~40 ms on an ordinary read of ~1000 processes here;
 * the box has been seen at load 391, hence three orders of magnitude of slack.
 */
const TIMEOUT_MS = 10_000;

/**
 * A process table, or a sentence saying why there is not one.
 *
 * Never throws and never returns an empty table as if it were an answer: an
 * empty `ps` is impossible on a live machine, so it is reported as a failure
 * rather than as a box with nothing running on it.
 */
export function probeProcessTable(opts: { bin?: string; selfPid?: number } = {}): ProcessTableReading {
  const bin = opts.bin ?? "ps";
  // The pid this reading must contain if it is a reading of this machine. A
  // parameter rather than a hard-coded `process.pid` only so the control itself
  // can be tested — pass a pid that cannot exist and the probe must refuse.
  const selfPid = opts.selfPid ?? process.pid;
  const startedMs = Date.now();
  const run = spawnSync(bin, [...PS_ARGV], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    // No shell: the argv is fixed, and a shell would put a second process
    // between us and ps for no gain.
    shell: false,
    // A ps that somehow printed megabytes should fail rather than be truncated
    // into a table with an unparseable last line.
    maxBuffer: 32 * 1024 * 1024,
  });

  // TIMED AFTER ps RETURNS, not before it. `etimes` is relative to when ps read
  // /proc, so a reading stamped before the spawn makes every derived start time
  // early by the whole probe duration - ~40 ms here, but up to the 10-second
  // timeout on a box that is swapping, which is exactly when the numbers matter.
  // Neither end is the true instant; the interval between them is, and stamping
  // the later end at least means no row can be older than the reading claims.
  const atMs = Date.now();
  const tookMs = atMs - startedMs;

  if (run.error !== undefined) return { read: false, why: `${bin} could not be run: ${run.error.message}` };
  if (run.signal !== null) {
    return { read: false, why: `${bin} was killed by ${run.signal} after ${tookMs} ms (timeout is ${TIMEOUT_MS} ms)` };
  }
  if (run.status !== 0) {
    const stderr = (run.stderr ?? "").trim().slice(0, 200);
    return { read: false, why: `${bin} exited ${String(run.status)}${stderr === "" ? "" : `: ${stderr}`}` };
  }

  const parsed = parseProcessTable(run.stdout ?? "", atMs);
  if (!parsed.ok) return { read: false, why: `${bin} output was not a process table: ${parsed.reason}` };
  // A LIVE MACHINE ALWAYS HAS PROCESSES. Zero rows means ps printed nothing
  // while exiting 0 - which is the silent-success shape this area keeps
  // meeting, and it must not become "no session is doing anything".
  if (parsed.rows.length === 0) return { read: false, why: `${bin} exited 0 but listed no processes` };

  // THE POSITIVE CONTROL, ON EVERY CALL, FOR THE PRICE OF ONE PASS.
  //
  // This module's whole output can honestly be "nothing is running under any
  // pane", and that answer is indistinguishable from an instrument that has
  // stopped detecting. Every other check here asks whether the output *looks*
  // like a process table; this one asks whether it is a process table OF THIS
  // MACHINE, by demanding the one row we can prove must be in it. A `ps` that
  // listed a thousand plausible processes, none of them ours — a pid namespace
  // we do not share, a stale capture piped in, a `bin` that is not ps at all —
  // would otherwise produce `no-child-work` for all 33 sessions and look calm.
  //
  // No spawn, no second command, nothing to keep in sync: the assertion is a
  // property of the reading we already have. See the POSITIVE CONTROL block in
  // tests/overseer-work.test.ts for the other half of this argument.
  if (!parsed.rows.some((row) => row.pid === selfPid)) {
    return {
      read: false,
      why: `${bin} listed ${parsed.rows.length} processes but did not include this process (pid ${selfPid}), so it is not a reading of this machine`,
    };
  }

  return { read: true, rows: parsed.rows, atMs };
}
