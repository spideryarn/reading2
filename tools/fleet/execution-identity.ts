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
 */
import { readFileSync } from "node:fs";

import { classifyPaneHarness } from "../overseer/harness.js";
import type { ProcessTableReading } from "../overseer/work.js";
import type { ConversationReading, ExecutionReading, ExecutionToken } from "./wire.js";

/* ------------------------------------------------------------------ *
 * The token, and what equality of one means.
 * ------------------------------------------------------------------ */

/**
 * The token as one comparable, storable string.
 *
 * A string rather than a structural compare because it has to survive a JSONL
 * round trip and be a map key in the Overseer's register, and because a
 * hand-written three-field `===` in each consumer is the shape this repo has
 * lost mornings to. The separator is `:`; a boot id is a uuid and the other two
 * are decimal, so nothing in a field can be confused for one.
 */
export function executionTokenText(token: ExecutionToken): string {
  return `${token.boot}:${token.pid}:${token.startTicks}`;
}

/**
 * **THE CONTINUITY QUESTION, and the only honest way to ask it.**
 *
 * A caller that owns something identity-dependent — a draft, a transcript
 * attribution, a measured duration — stores the token it was created under and
 * asks this every time it is about to use it. It does NOT ask "did a change
 * event fire", because an event log has sampling gaps and a token comparison
 * does not: a run replaced while nobody was reading is still a different token
 * the next time anybody looks.
 *
 * Three answers and no fourth. `unverifiable` is not a soft `same`: it is the
 * arm that must quarantine, because *we cannot see it* and *it is still there*
 * are the same picture from here.
 */
export type Continuity =
  | { kind: "same"; token: string }
  | { kind: "replaced"; previous: string; current: string; why: string }
  | { kind: "unverifiable"; previous: string | null; why: string };

export function continuityOf(previous: string | null, current: ExecutionReading): Continuity {
  if (current.kind !== "verified") {
    return {
      kind: "unverifiable",
      previous,
      why:
        current.kind === "claimed-only"
          ? `nothing under this pane could be identified, so whether it is still the same run cannot be established: ${current.why}`
          : `there is no execution reading for this pane (${current.cause}), so whether it is still the same run cannot be established: ${current.why}`,
    };
  }
  const token = executionTokenText(current.token);
  if (previous === null) {
    return {
      kind: "unverifiable",
      previous: null,
      why: `this is run ${token}, and there is no earlier run recorded to compare it against`,
    };
  }
  if (previous === token) return { kind: "same", token };
  return {
    kind: "replaced",
    previous,
    current: token,
    why: `the process in this pane is run ${token} now, not ${previous} — it was replaced, and the pane, its pid and its CLAUDE_SESSION_ID all stayed the same across that`,
  };
}

/**
 * **MAY SOMETHING KEYED TO A CONVERSATION BE WRITTEN RIGHT NOW?**
 *
 * The gate is deliberately strict: the execution must be verified AND the
 * conversation must be verified. Anything less is refused with the sentence a
 * reader is shown beside the disabled control, so the refusal explains itself
 * rather than greying out silently.
 *
 * **A CACHED `allowed` IS NOT AUTHORITY.** This takes a reading, and a reading
 * is what was true at the instant it was taken. The rule for a caller is that
 * the reading must be *fresh at the moment of the write* — which is what
 * `steer.ts`'s `verifyTarget` already does for keystrokes, re-deriving against
 * the live box rather than trusting what the page was rendered from. Storing an
 * `allowed: true` and acting on it later is the mistake this comment exists to
 * name; the token it returns is for recording what a write was done under, not
 * for re-authorising a later one.
 */
export type IdentityWriteGate = { allowed: true; token: string; conversationId: string } | { allowed: false; why: string };

export function identityWriteGate(reading: ExecutionReading): IdentityWriteGate {
  if (reading.kind === "unknown") {
    return {
      allowed: false,
      why: `we cannot see what is running in this pane (${reading.cause}), so anything addressed to a conversation could reach a different one: ${reading.why}`,
    };
  }
  if (reading.kind === "claimed-only") {
    return {
      allowed: false,
      why: `nothing under this pane could be identified, so its conversation id is a launch claim rather than an observation: ${reading.why}`,
    };
  }
  switch (reading.conversation.kind) {
    case "verified":
      return { allowed: true, token: executionTokenText(reading.token), conversationId: reading.conversation.id };
    case "not-claimed":
      return {
        allowed: false,
        why: `this pane holds ${reading.harness} and no conversation was ever claimed for it, so there is nothing here to address`,
      };
    case "conflicting":
      return {
        allowed: false,
        why:
          `this pane is running conversation ${reading.conversation.observed}, not ${reading.conversation.claimed} ` +
          `which every address on this row still names — a different Claude has been started here since launch`,
      };
    case "unverifiable":
      return {
        allowed: false,
        why: `nothing observable confirms that conversation ${reading.conversation.claimed} is the one in this pane: ${reading.conversation.why}`,
      };
    default: {
      const never: never = reading.conversation;
      throw new Error(`no write gate for conversation reading ${JSON.stringify(never)}`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * The classifier.
 * ------------------------------------------------------------------ */

/** The boot's own id, or why there isn't one — including "this is not Linux". */
export type BootIdentity =
  | { read: true; id: string }
  | { read: false; cause: "platform-unsupported" | "boot-identity-unreadable"; why: string };

/** One process's start tick, or why it could not be read. */
export type ProcessStartTicks = { read: true; ticks: number } | { read: false; why: string };

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
  const { panePid, claimedConversationId, table, boot, readStart } = input;

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
