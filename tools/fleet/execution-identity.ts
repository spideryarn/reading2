/**
 * **IS THIS THE SAME RUN I WAS LOOKING AT, OR A DIFFERENT ONE WEARING ITS
 * ADDRESSES?**
 *
 * Every identity this fleet carried before today survives the change it most
 * needs to see. A tmux pane is furniture: the pane's shell starts once and
 * stays, and the `claude` inside it can exit and be replaced any number of
 * times underneath it. Across that replacement `tmuxServerPid`, `paneId` and
 * `panePid` are all unchanged — nothing above the claude moved — and so is
 * `claudeSessionId`, because `CLAUDE_SESSION_ID` is pinned into the tmux
 * environment by `tmux new-session -e` BEFORE Claude runs and is never
 * rewritten. `tools/overseer/diff.ts` documents the consequence rather than
 * fixing it: *"an unchanged claim means nothing"*, and `session-pane-replaced`
 * is explicitly the event that cannot see this case.
 *
 * So this file answers the question none of those fields can, and the answer is
 * a `ExecutionToken`: boot identity, pid, and the process's exact start tick.
 *
 * ## Why the answer is not "compare the pid"
 *
 * Pids are reused. On this box they run to seven digits and wrap, and the whole
 * point of a durable token is the case where the number is the same and the
 * process is not. `startTicks` — `/proc/<pid>/stat` field 22, the start time in
 * clock ticks since boot — closes it exactly, because two processes cannot hold
 * one pid at one tick. `boot` closes the other end: after a reboot, pids and
 * ticks both restart from small numbers, so a token from yesterday could
 * otherwise collide with one from this morning.
 *
 * **`ProcessStart` in work.ts is NOT this and must not be substituted for it.**
 * That value is derived from `ps etimes`, counts whole seconds, and its own
 * comment forbids comparing it for equality. It is a duration for a person.
 * This is an identity for a machine.
 *
 * ## The probe is the one that already exists
 *
 * `probeProcessTable` and `classifyPaneHarness` were written for this box, are
 * tested against captures taken off it, and had no production caller until this
 * file. Nothing here re-walks a process tree or re-recognises a `claude`
 * command line: the harness walk answers *what is holding this pane*, and this
 * module asks *and which run is it* on top of the answer. One `ps` for the
 * whole fleet (~40 ms, measured in work-probe.ts), then one small `/proc` read
 * per pane that has a harness.
 *
 * ## Process verification and conversation verification are two answers
 *
 * A verified execution says a named, live, durably-identified harness process
 * is under this pane. It says nothing about which transcript that process is
 * writing. A bare `claude` with no `--session-id` is verified as a process and
 * unverifiable as a conversation, and collapsing the two would either withhold
 * a fact we have or invent one we do not. `ExecutionReading` in wire.ts carries
 * them as separate fields for that reason.
 *
 * ## Pure classifier, thin adapter — as in work.ts / work-probe.ts
 *
 * {@link readExecutionIdentity} runs against injected readings, so every case
 * below is testable against a capture and against a synthesised table. The two
 * functions that touch the machine ({@link readBootIdentity},
 * {@link readProcessStart}) are separated from it and take an injectable
 * reader, and {@link parseProcStat} — the one piece of real parsing — is pure.
 *
 * ## What is NOT here, and why
 *
 * `executionTokenText`, `continuityOf` and `identityWriteGate` live in
 * `execution-token.ts`. This file imports `node:fs` and two Overseer modules,
 * so the browser can never import it — and those three are precisely what a
 * browser component needs before it reuses a draft or enables a write. Policy
 * that its main consumer cannot import gets copied rather than imported, so it
 * is a leaf next door. This file is what the machine says; that one is what it
 * means. GPT Sol's P2-3.
 */
import { readFileSync } from "node:fs";

import { classifyPaneHarness, type Harness } from "../overseer/harness.js";
import type { ProcessTableReading } from "../overseer/work.js";
import type { ConversationReading, ExecutionReading } from "./wire.js";

/* ------------------------------------------------------------------ *
 * The classifier.
 * ------------------------------------------------------------------ */

/** The boot's own id, or why there isn't one — including "this is not Linux". */
export type BootIdentity =
  | { read: true; id: string }
  | { read: false; cause: "platform-unsupported" | "boot-identity-unreadable"; why: string };

/** One process's start tick, or why it could not be read. */
export type ProcessStartTicks = { read: true; ticks: number } | { read: false; why: string };

/** Seconds since boot, or why they could not be read. One reading per collection. */
export type UptimeReading = { read: true; seconds: number } | { read: false; why: string };

/**
 * **THE procfs CLOCK, WHICH IS NOT THE KERNEL'S.**
 *
 * `/proc/<pid>/stat`'s times are in USER_HZ, which the procfs ABI fixes at 100
 * regardless of the kernel's own `CONFIG_HZ`. That is why this is a constant
 * rather than a `getconf CLK_TCK` at startup: the number is a property of the
 * interface we are reading, not of the machine we are reading it on.
 */
export const USER_HZ = 100;

/**
 * **HOW FAR THE TWO CLOCKS MAY DISAGREE BEFORE WE STOP BELIEVING THE PAIR.**
 *
 * Four sources of honest slack, and none of them is close to the thing being
 * caught: `ps etimes` is whole seconds (±1), the `/proc` read happens after the
 * `ps` (up to the probe's own duration), `USER_HZ` rounding (±0.01 s), and the
 * two reads are simply taken at different instants.
 *
 * **FIFTEEN, NOT FIVE, and the old number was too tight in the safe
 * direction.** `probeProcessTable`'s own timeout allows a `ps` to take ten
 * seconds on a swapping box, and the whole of that lands between the table's
 * elapsed times and the uptime read — so five seconds turned a slow but
 * perfectly valid collection into `unknown` for every row. GPT Sol, 2026-09-09.
 * Widening it costs nothing now that {@link stillTheSameHarness} carries the
 * proof: this check is here to exclude a `/proc` read of a process the table
 * never described, and that mismatch is off by the whole of a process's life
 * rather than by seconds.
 */
const START_AGREEMENT_TOLERANCE_S = 15;

/** Everything {@link readExecutionIdentity} needs, all of it injectable. */
export type ExecutionInput = {
  /** The pane's own pid, from the same row this reading will be attached to. */
  panePid: number | null;
  /** The tmux environment's `CLAUDE_SESSION_ID`. A claim; see `ConversationReading`. */
  claimedConversationId: string | null;
  /** One reading of the process table, shared across the whole fleet. */
  table: ProcessTableReading;
  /** One boot identity, shared across the whole fleet. */
  boot: BootIdentity;
  /**
   * **A SECOND PROCESS TABLE, READ AFTER THE `/proc` READS.**
   *
   * This is what makes a `verified` reading a claim about ONE process rather
   * than about two. The harness kind and its conversation come from `table`;
   * the start token comes from a `/proc` read taken afterwards. If the pid is
   * reused in between, those describe different processes and the result is
   * coherent nonsense.
   *
   * The first attempt at closing this compared `ps`'s elapsed time against
   * `/proc`'s start ticks and called them two independent measurements. **They
   * are not**: procps derives `etimes` from its own uptime read and the same
   * field 22, so it is a lossy earlier reading of the one value, and a
   * replacement landing within the tolerance passed. GPT Sol, twice, 2026-09-09.
   *
   * Bracketing is the proof that argument wanted: classify from a table taken
   * BEFORE the `/proc` read and again from one taken AFTER it, and require the
   * same pid, kind and conversation in both. A pid that was reused inside the
   * window cannot present the same harness at both ends unless it was never
   * reused at all. One extra `ps` per collection, ~40 ms against 8–12 s.
   */
  after: ProcessTableReading;
  /**
   * Seconds since boot, read once per collection — the clock that lets the
   * process table's elapsed times and `/proc`'s start ticks be compared. A
   * SECONDARY check now that bracketing carries the proof: it still catches a
   * `/proc` read of a process the table never described. See {@link startAgrees}.
   */
  uptime: UptimeReading;
  /** Start ticks for one pid. Called at most once per row. */
  readStart: (pid: number) => ProcessStartTicks;
};

/**
 * The reading for one pane.
 *
 * ORDER MATTERS AND IT IS THE ORDER OF WHAT WOULD BE WRONG. The boot identity is
 * checked first because without it no token can be minted at all, so walking a
 * tree would only produce evidence we could not name. Then the two ways there is
 * no tree, then the walk, then the `/proc` read.
 *
 * **`claimed-only` IS ONLY FOR "WE LOOKED AND FOUND NOTHING NAMEABLE".** Every
 * way of failing to look is `unknown` with a cause. That distinction is the
 * whole difference between *the launch claim is all there is* and *we did not
 * ask*, and one of them is allowed to be reassuring in a way the other is not.
 */
export function readExecutionIdentity(input: ExecutionInput): ExecutionReading {
  const { panePid, claimedConversationId, table, after, boot, uptime, readStart } = input;

  if (!boot.read) return { kind: "unknown", cause: boot.cause, why: boot.why };
  if (panePid === null) {
    return { kind: "unknown", cause: "no-pane-pid", why: "this row carried no pane pid, so there is no tree to walk" };
  }
  if (!table.read) return { kind: "unknown", cause: "process-table-unreadable", why: table.why };

  const harness = classifyPaneHarness(panePid, table);
  if (harness.kind === "unknown") {
    switch (harness.cause) {
      // THE WAYS WE DID NOT GET TO LOOK. Two of them are already handled above
      // and are re-mapped rather than assumed unreachable, because a caller can
      // hand this a table that came from a store replay rather than the probe.
      case "no-pane-pid":
        return { kind: "unknown", cause: "no-pane-pid", why: harness.why };
      case "process-table-unreadable":
        return { kind: "unknown", cause: "process-table-unreadable", why: harness.why };
      case "pane-not-in-table":
      case "malformed-process-table":
        return { kind: "unknown", cause: "pane-tree-unreadable", why: harness.why };
      // AND THE TWO WHERE THE WALK RAN AND CAME BACK WITHOUT A NAME. There is
      // something in the pane; we cannot say what; so the launch metadata is
      // all anybody has, which is exactly `claimed-only`.
      case "unrecognised-pane-process":
      case "ambiguous-harness":
        return {
          kind: "claimed-only",
          conversation: conversationOf(claimedConversationId, null, `the pane's own process could not be named: ${harness.why}`),
          why: harness.why,
        };
      default: {
        const never: never = harness.cause;
        throw new Error(`no execution reading for harness cause ${JSON.stringify(never)}`);
      }
    }
  }

  const start = readStart(harness.pid);
  if (!start.read) {
    // WE SAW IT AND CANNOT NAME IT DURABLY, which is not the same as not seeing
    // it — the process almost certainly exited between the `ps` and this read.
    // `verified` without a token is not an option: the token IS the verification.
    return {
      kind: "unknown",
      cause: "process-start-unreadable",
      why: `pid ${harness.pid} is the harness under this pane and its start time could not be read, so no durable identity can be minted for it: ${start.why}`,
    };
  }

  // THE TWO READINGS MUST BE OF THE SAME PROCESS, AND UNTIL HERE NOTHING SAID
  // SO. `harness` and its conversation come from the process table; `start`
  // comes from a `/proc` read taken afterwards. A pid reused in between yields
  // the old harness stapled to the new process's token — `verified`, coherent,
  // and about no process that ever existed. GPT Sol's P1-2.
  const agreement = startAgrees(harness.pid, table, uptime, start.ticks);
  if (agreement !== null) return agreement;

  // AND THE BRACKET, which is the part that actually proves it. The `/proc`
  // read happened between these two classifications, so a pid reused inside
  // that window shows a different harness at the far end.
  const settled = stillTheSameHarness(panePid, harness, after);
  if (settled !== null) return settled;

  const observed = harness.kind === "claude-code" ? harness.claudeSessionId : null;
  const whyUnobserved =
    harness.kind === "claude-code"
      ? "the claude under this pane was started without --session-id, so its own command line names no conversation"
      : `this pane holds ${harness.kind}, whose command line carries no conversation id — a Claude may not have started in it yet, or may have finished`;

  return {
    kind: "verified",
    token: { boot: boot.id, pid: harness.pid, startTicks: start.ticks },
    harness: harness.kind,
    conversation: conversationOf(claimedConversationId, observed, whyUnobserved),
  };
}

/**
 * **THE SAME HARNESS AT BOTH ENDS OF THE `/proc` READ** — null when it is, and
 * the refusal to return when it is not.
 *
 * This is the one that proves a `verified` reading is about a single process.
 * The `/proc` read happens between the two classifications, so a pid handed to
 * another process inside that window presents a different harness — a different
 * pid, kind, or conversation — when the tree is walked again afterwards.
 *
 * **IT COMPARES THE WHOLE ANSWER, not just the pid.** A replacement that
 * happened to be a `claude` too would keep the pid and change the conversation;
 * one that was not would change the kind. Comparing only pids would pass both.
 *
 * A second table that could not be read is a refusal, not a pass — an unmade
 * check is not a passed check, the same rule as everywhere else here.
 */
function stillTheSameHarness(panePid: number, before: Harness, after: ProcessTableReading): ExecutionReading | null {
  if (!after.read) {
    return {
      kind: "unknown",
      cause: "process-changed-under-read",
      why: `the process table could not be read again after ${before.kind === "unknown" ? "the walk" : `pid ${before.pid}`}'s start time, so nothing shows the pid still belongs to the process it was classified from: ${after.why}`,
    };
  }
  const now = classifyPaneHarness(panePid, after);
  if (now.kind !== before.kind) {
    return {
      kind: "unknown",
      cause: "process-changed-under-read",
      why: `this pane held ${before.kind} when its start time was read and holds ${now.kind} immediately afterwards, so the two readings are not of one process`,
    };
  }
  if (now.kind !== "unknown" && before.kind !== "unknown" && now.pid !== before.pid) {
    return {
      kind: "unknown",
      cause: "process-changed-under-read",
      why: `the harness under this pane was pid ${before.pid} when its start time was read and is pid ${now.pid} immediately afterwards`,
    };
  }
  if (
    now.kind === "claude-code" &&
    before.kind === "claude-code" &&
    now.claudeSessionId !== before.claudeSessionId
  ) {
    return {
      kind: "unknown",
      cause: "process-changed-under-read",
      why:
        `pid ${before.pid} was running conversation ${before.claudeSessionId ?? "none"} when its start time was read and ` +
        `${now.claudeSessionId ?? "none"} immediately afterwards, so the pid was reused between the two`,
    };
  }
  return null;
}

/**
 * **DO THE PROCESS TABLE AND `/proc` ROUGHLY AGREE ABOUT WHEN THIS STARTED?** —
 * null when they do, and the refusal to return when they do not.
 *
 * **A SECONDARY CHECK, AND THE COMMENT HERE USED TO OVERSELL IT.** It said `ps`
 * elapsed time and `/proc` start ticks were two independent measurements of one
 * instant. They are not independent: procps computes `etimes` from its own
 * uptime read and the same field 22, so this compares a value against a lossy
 * earlier copy of itself. GPT Sol, 2026-09-09, and the bracket above is what
 * actually carries the proof.
 *
 * It is kept because it still catches something the bracket does not: a `/proc`
 * read that answered for a process the table never described at all — a pid
 * threaded through wrongly, a stubbed reader in a test, a table and a `/proc`
 * from two different boxes. That is a real class and it is nearly free to
 * exclude.
 *
 * **AN UNMADE CHECK IS NOT A PASSED CHECK.** No uptime, or a table row whose
 * elapsed time could not be converted, refuses rather than waving the pair
 * through.
 */
function startAgrees(
  pid: number,
  table: Extract<ProcessTableReading, { read: true }>,
  uptime: UptimeReading,
  ticks: number,
): ExecutionReading | null {
  if (!uptime.read) {
    return {
      kind: "unknown",
      cause: "uptime-unreadable",
      why: `pid ${pid}'s start time cannot be checked against the process table without a boot clock, so whether the two readings are of one process is unknown: ${uptime.why}`,
    };
  }
  const row = table.rows.find((candidate) => candidate.pid === pid);
  // Cannot happen — the harness came out of this table — but the row is looked
  // up rather than threaded through, and an absent one must refuse rather than
  // skip the check.
  if (row === undefined || !row.started.known) {
    return {
      kind: "unknown",
      cause: "process-changed-under-read",
      why: `pid ${pid} has no usable elapsed time in the process table it was classified from, so its start tick cannot be checked against it`,
    };
  }
  // Both sides as "seconds since boot at which this process started".
  const fromProc = ticks / USER_HZ;
  const fromTable = uptime.seconds - (table.atMs - row.started.atMs) / 1000;
  const apart = Math.abs(fromProc - fromTable);
  if (apart <= START_AGREEMENT_TOLERANCE_S) return null;
  return {
    kind: "unknown",
    cause: "process-changed-under-read",
    why:
      `pid ${pid} was ${Math.round((table.atMs - row.started.atMs) / 1000)} s old in the process table and /proc says it started ` +
      `${Math.round(uptime.seconds - fromProc)} s ago — ${Math.round(apart)} s apart, so the two readings are of different processes and the pid was reused between them`,
  };
}

/**
 * The claim and the observation, reconciled.
 *
 * **THE ASYMMETRY IS DELIBERATE AND IS THE OPPOSITE OF `session-replaced`'s.**
 * There, an unchanged claim was evidence of nothing; here, a claim that MATCHES
 * a live process's own argument is real corroboration, because the argument is
 * on the process rather than on the pane around it.
 */
function conversationOf(claimed: string | null, observed: string | null, whyUnobserved: string): ConversationReading {
  if (claimed === null) return { kind: "not-claimed" };
  if (observed === null) return { kind: "unverifiable", claimed, why: whyUnobserved };
  if (observed === claimed) return { kind: "verified", id: claimed };
  return { kind: "conflicting", claimed, observed };
}

/* ------------------------------------------------------------------ *
 * The two readers that touch the machine, and the one parse.
 * ------------------------------------------------------------------ */

/** How this module reads a file. Injectable so every failure path is testable. */
export type ReadTextFile = (path: string) => string;

const readText: ReadTextFile = (path) => readFileSync(path, "utf8");

export const BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id";

/**
 * The boot's id, or an honest refusal.
 *
 * **A NON-LINUX BOX IS `platform-unsupported`, NEVER A FALLBACK TO THE PID.**
 * The direction on this is explicit in the stage: unavailable platform evidence
 * is unsupported, not permission to use a pid on its own. Greg's Mac reaches
 * this line, and it should get grey rows there rather than confident ones.
 */
export function readBootIdentity(
  read: ReadTextFile = readText,
  platform: string = process.platform,
): BootIdentity {
  if (platform !== "linux") {
    return {
      read: false,
      cause: "platform-unsupported",
      why: `execution identity is derived from ${BOOT_ID_PATH} and /proc/<pid>/stat, and this is ${platform} rather than linux`,
    };
  }
  let raw: string;
  try {
    raw = read(BOOT_ID_PATH);
  } catch (cause) {
    return {
      read: false,
      cause: "boot-identity-unreadable",
      why: `${BOOT_ID_PATH} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  const id = raw.trim();
  // A BOOT ID THAT IS EMPTY IS NOT A BOOT ID. An empty string would make every
  // token on the box begin with `:`, and two boots would silently agree — the
  // exact collision the field is there to prevent.
  if (id === "") {
    return { read: false, cause: "boot-identity-unreadable", why: `${BOOT_ID_PATH} is empty` };
  }
  return { read: true, id };
}

export const UPTIME_PATH = "/proc/uptime";

/**
 * Seconds since boot, for the cross-check in {@link startAgrees}.
 *
 * One read per collection, not per row: it is a property of the box. The file
 * is two floats and only the first is wanted.
 */
export function readUptime(read: ReadTextFile = readText): UptimeReading {
  let raw: string;
  try {
    raw = read(UPTIME_PATH);
  } catch (cause) {
    return { read: false, why: `${UPTIME_PATH} could not be read: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const first = raw.trim().split(/\s+/)[0];
  const seconds = first === undefined ? Number.NaN : Number(first);
  // NEGATIVE OR NON-FINITE IS A REFUSAL, not a zero. A zero would put every
  // process's derived start before the boot and fail every cross-check on the
  // box, which reads as thirty replaced processes rather than as one bad read.
  if (!Number.isFinite(seconds) || seconds < 0) {
    return { read: false, why: `${UPTIME_PATH} does not start with a number of seconds: ${JSON.stringify(raw.slice(0, 60))}` };
  }
  return { read: true, seconds };
}

/**
 * Field 22 of `/proc/<pid>/stat` — a process's start time in clock ticks.
 *
 * **THE PARSE STARTS AT THE LAST `)`, AND THAT IS THE WHOLE TRICK.** Field 2 is
 * the executable's name in parentheses, it is not escaped, and it may contain
 * both spaces and parentheses — a process really can be called `(foo) bar)`.
 * Splitting the line on whitespace from the left puts every later field at an
 * offset that depends on the name, which is a parser that works on this box
 * until somebody runs something with a bracket in its name. After the last `)`
 * the fields are fixed-position: field 3 is first, so field N sits at index
 * N - 3, and field 22 is index 19.
 */
export function parseProcStat(text: string): { ok: true; ppid: number; startTicks: number } | { ok: false; why: string } {
  const close = text.lastIndexOf(")");
  if (close === -1) return { ok: false, why: "the stat line has no `)`, so it is not a /proc stat line" };
  const fields = text.slice(close + 1).trim().split(/\s+/);
  // Field 3 (state) is at index 0, so field 22 is at index 19 and the line must
  // be at least that long. Checked rather than assumed: a truncated read is a
  // real outcome of racing a process's exit.
  const ppidText = fields[1];
  const startText = fields[19];
  if (ppidText === undefined || startText === undefined) {
    return { ok: false, why: `the stat line has ${fields.length} fields after the command name, which is fewer than the 20 needed to reach the start time` };
  }
  const ppid = Number(ppidText);
  const startTicks = Number(startText);
  if (!Number.isSafeInteger(ppid) || ppid < 0) return { ok: false, why: `parent pid ${JSON.stringify(ppidText)} is not a pid` };
  if (!Number.isSafeInteger(startTicks) || startTicks < 0) {
    return { ok: false, why: `start time ${JSON.stringify(startText)} is not a tick count` };
  }
  return { ok: true, ppid, startTicks };
}

/**
 * One process's start tick, straight off `/proc`.
 *
 * ENOENT IS THE ORDINARY CASE, not an error worth shouting about: the process
 * table was read a moment ago and the process is free to exit in between. The
 * caller turns this into `process-start-unreadable`, which is an `unknown` arm
 * rather than a verified reading with a guess in it.
 */
export function readProcessStart(pid: number, read: ReadTextFile = readText): ProcessStartTicks {
  let raw: string;
  try {
    raw = read(`/proc/${pid}/stat`);
  } catch (cause) {
    return { read: false, why: `/proc/${pid}/stat could not be read: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const parsed = parseProcStat(raw);
  if (!parsed.ok) return { read: false, why: `/proc/${pid}/stat could not be parsed: ${parsed.why}` };
  return { read: true, ticks: parsed.startTicks };
}
