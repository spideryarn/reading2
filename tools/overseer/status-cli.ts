/**
 * The file-backed Overseer status rendering.
 *
 * This is deliberately a leaf below the Commander entry point and daemon
 * wiring. `tick` and `status` compose the same renderer without importing each
 * other, so one measured checkpoint cannot acquire two terminal meanings.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { escapeName } from "../../scripts/gjd-remote-tmux.js";
import { USER_HZ, readProcessStart, readUptime, type ReadTextFile } from "../fleet/execution-identity.js";
import type { AttentionList, StoredUsage } from "../fleet/wire.js";
import { claimFromSnapshot, describeClaim, type OverseerClaim } from "../fleet/overseer-claim.js";
import { groupUsageIncidents } from "../fleet/usage-feed.js";
import { zonedLine } from "../fleet/zones.js";
import type { OverseerEvent } from "./diff.js";
import { splitJsonl } from "./jsonl.js";
import { describeAge, describeSince } from "./format-age.js";
import { describeRuleOutcome } from "./rules.js";
import { describeNote, openConditions, readNotes, type DaemonNote, type ReadNotes } from "./notes.js";
import {
  CHECKPOINT_FILE,
  EVENTS_FILE,
  STORE_SCHEMA,
  isProcessAlive,
  readCheckpoint,
  parseEventLines,
  type Checkpoint,
  type CheckpointRead,
  type RegisterEntry,
  type StatusSince,
} from "./store.js";

/** Three 30-second daemon ticks. Kept here so this leaf does not import the daemon. */
export const STALL_AFTER_MS = 90_000;

export function requireAbsoluteRoot(root: string): string {
  if (!isAbsolute(root)) {
    throw new Error(
      `the Overseer store must be an absolute path; got ${JSON.stringify(root)}. ` +
        "A relative OVERSEER_STORE_DIR means one store per working directory, and two daemons that cannot see each other.",
    );
  }
  return root;
}

export type DaemonStanding = {
  state: "never-run" | "running" | "stalled" | "stopped" | "killed" | "cannot-tell";
  detail: string;
};

export type StandingInput = {
  /** `absent` and `unusable` must survive to the sentence a person reads. */
  read: CheckpointRead;
  /**
   * The daemon's notes, in log order. The log spans restarts and the checkpoint
   * names ONE instance, so a note is evidence only about its own instance: a
   * stop closes only its matching start, and the log's last line is not a
   * statement about the checkpoint (GPT Sol's F3 on plan 260910f).
   */
  notes: readonly DaemonNote[];
  nowMs: number;
  /** Who holds a pid now, and when that process started. `readPidIdentity` is the real one. */
  identify: PidReader;
};

/**
 * A clock in the checkpoint this far ahead of the reader's is an anomaly, not
 * skew: nothing about the daemon's liveness can be read off an age that is
 * negative (Sol's F43 on plan 260910f stage 2).
 */
export const CLOCK_SKEW_MS = 5_000;

/**
 * **A PID IS NOT A PROCESS.** A killed daemon's pid can be reused within
 * seconds on a busy box, and "some process holds pid N" then reads a dead
 * daemon's fresh checkpoint as RUNNING (Sol's F45). So the process holding the
 * pid must have STARTED like this daemon did: no later than its recorded
 * `startedAt`, and no more than this long before it — tsx compiling and the
 * imports sit between exec and the daemon's first clock read.
 */
export const PROCESS_START_WINDOW_MS = 120_000;

/**
 * Slack on the late side. The process's start is derived as *now − uptime +
 * start ticks*, and the wall clock and the boot clock drift apart by NTP
 * adjustments since boot, so an honest reading can land a second or so after
 * the instant the daemon recorded.
 */
const PROCESS_START_SLACK_MS = 2_000;

/** What holds a pid now: nothing, a process with a known start, or a live process whose start could not be read. */
export type PidReading = { kind: "gone" } | { kind: "started"; atMs: number } | { kind: "alive-unverified"; why: string };

export type PidReader = (pid: number) => PidReading;

/**
 * The real reader, off `/proc`: the start tick is `execution-identity.ts`'s
 * parse of field 22 (which survives a `(comm)` holding spaces and parens), put
 * on the wall clock through `/proc/uptime`. Always against the REAL clock,
 * never a caller's injected one: the process started on this one. Not Linux,
 * or `/proc` unreadable, is `alive-unverified` with the reason — never a guess.
 */
export function readPidIdentity(pid: number, read?: ReadTextFile): PidReading {
  if (!isProcessAlive(pid)) return { kind: "gone" };
  const nowMs = Date.now();
  const start = readProcessStart(pid, read);
  // It may have exited between the two reads; that is gone, not unverified.
  if (!start.read) return isProcessAlive(pid) ? { kind: "alive-unverified", why: start.why } : { kind: "gone" };
  const uptime = readUptime(read);
  if (!uptime.read) return { kind: "alive-unverified", why: uptime.why };
  return { kind: "started", atMs: Math.round(nowMs - uptime.seconds * 1000 + (start.ticks / USER_HZ) * 1000) };
}

/** The pid's holder, judged against the instant the daemon says it started. */
type Holder = { kind: "gone" } | { kind: "this" } | { kind: "stranger"; startedAt: string } | { kind: "unverified"; why: string };

function holderOf(pid: number, daemonStartedAt: string, identify: PidReader): Holder {
  const reading = identify(pid);
  switch (reading.kind) {
    case "gone":
      return reading;
    case "alive-unverified":
      return { kind: "unverified", why: reading.why };
    case "started": {
      const daemonMs = Date.parse(daemonStartedAt);
      if (!Number.isFinite(daemonMs)) return { kind: "unverified", why: `the daemon's start ${JSON.stringify(daemonStartedAt)} is not an instant` };
      const same = reading.atMs <= daemonMs + PROCESS_START_SLACK_MS && reading.atMs >= daemonMs - PROCESS_START_WINDOW_MS;
      return same ? { kind: "this" } : { kind: "stranger", startedAt: new Date(reading.atMs).toISOString() };
    }
    default: {
      const never: never = reading;
      throw new Error(`no holder for ${JSON.stringify(never)}`);
    }
  }
}

const reusedPid = (pid: number, holder: Extract<Holder, { kind: "stranger" }>, daemonStartedAt: string): string =>
  `pid ${pid} is alive but is not this daemon (that process started at ${holder.startedAt}; this daemon started at ${daemonStartedAt}) — the daemon is gone and its pid was reused`;

/** The first checkpoint clock later than now plus the skew, as the sentence, or null. */
function futureClock(checkpoint: Checkpoint, nowMs: number): string | null {
  const clocks: readonly (readonly [string, string | null])[] = [
    ["writtenAt", checkpoint.writtenAt],
    ["heartbeat.lastTickAt", checkpoint.heartbeat.lastTickAt],
    ["lastGoodSnapshotAt", checkpoint.lastGoodSnapshotAt],
    ["heartbeat.startedAt", checkpoint.heartbeat.startedAt],
  ];
  for (const [field, iso] of clocks) {
    if (iso === null || !(Date.parse(iso) > nowMs + CLOCK_SKEW_MS)) continue;
    return (
      `the checkpoint's ${field} is ${iso} and this reader's clock is ${new Date(nowMs).toISOString()}, ` +
      `${describeSince(nowMs - Date.parse(iso), "old")}: one of the two clocks is wrong, so nothing here can tell from the checkpoint whether the daemon is running`
    );
  }
  return null;
}

type StartedNote = Extract<DaemonNote, { kind: "daemon-started" }>;
type StoppedNote = Extract<DaemonNote, { kind: "daemon-stopped" }>;

/** One instance as the notes record it: its last start, the stop that closes THAT start, and where its last note of any kind sits. */
type Lifecycle = { start: StartedNote | null; stop: StoppedNote | null; lastIndex: number };

function lifecycleOf(notes: readonly DaemonNote[], instanceId: string): Lifecycle | null {
  let life: Lifecycle | null = null;
  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    if (note === undefined || note.instanceId !== instanceId) continue;
    life ??= { start: null, stop: null, lastIndex: index };
    life.lastIndex = index;
    // A stop before a later start of the same id does not close that later start.
    if (note.kind === "daemon-started") life = { ...life, start: note, stop: null };
    else if (note.kind === "daemon-stopped") life.stop = note;
  }
  return life;
}

/**
 * The newest `daemon-started` in the log when it began AFTER the checkpoint's
 * instance — an instance that has written no checkpoint, whose state must never
 * be read off an older instance's one. With no checkpoint at all, simply the
 * newest start. Null when the checkpoint's own instance is the newest, or when
 * there is no start note.
 */
export function newerStartThanCheckpoint(checkpoint: Checkpoint | null, notes: readonly DaemonNote[]): StartedNote | null {
  let newestIndex = -1;
  for (let index = notes.length - 1; index >= 0 && newestIndex < 0; index -= 1) if (notes[index]?.kind === "daemon-started") newestIndex = index;
  const newest = notes[newestIndex];
  if (newest?.kind !== "daemon-started") return null;
  if (checkpoint === null) return newest;
  const owner = checkpoint.heartbeat.instanceId;
  if (newest.instanceId === owner) return null;
  const life = lifecycleOf(notes, owner);
  // The checkpoint's instance wrote a note after that start, so the start is not newer than it.
  if (life !== null) return life.lastIndex < newestIndex ? newest : null;
  // The checkpoint's instance left no note at all, so order by clock. A tie goes
  // to the checkpoint's instance: its lock is taken before any start note is written.
  return Date.parse(newest.at) > Date.parse(checkpoint.heartbeat.startedAt) ? newest : null;
}

/** The newest instance wrote no checkpoint: say what IT did, and whose the checkpoint on disk is, without mixing the two. */
function standingWithoutCheckpoint(start: StartedNote, checkpoint: Checkpoint | null, input: StandingInput): DaemonStanding {
  const { notes, nowMs } = input;
  let disk = "there is no checkpoint on disk";
  if (checkpoint !== null) {
    const owner = checkpoint.heartbeat.instanceId;
    const ownerStop = lifecycleOf(notes, owner)?.stop ?? null;
    disk =
      `the checkpoint on disk is instance ${owner}'s from ${checkpoint.writtenAt} (${describeSince(nowMs - Date.parse(checkpoint.writtenAt), "old")}), ` +
      `and ${owner} ${ownerStop === null ? "wrote no stopping note" : `stopped on purpose at ${ownerStop.at}`}`;
  }
  const who = `the newest instance ${start.instanceId} started at ${start.at} (pid ${start.pid})`;
  const stop = lifecycleOf(notes, start.instanceId)?.stop ?? null;
  if (stop !== null) {
    return { state: "stopped", detail: `${who} and stopped on purpose at ${stop.at} (${stop.why}) without writing a checkpoint; ${disk}` };
  }
  // Its start note's instant stands for its start, as the checkpoint's `startedAt` does below.
  const holder = holderOf(start.pid, start.at, input.identify);
  if (holder.kind === "gone") {
    return { state: "killed", detail: `${who} and is gone without writing a checkpoint or a stopping note, so it was killed; ${disk}` };
  }
  if (holder.kind === "stranger") {
    return { state: "killed", detail: `${who}; ${reusedPid(start.pid, holder, start.at)}, without writing a checkpoint or a stopping note; ${disk}` };
  }
  if (holder.kind === "unverified") {
    return { state: "cannot-tell", detail: `${who}; pid ${start.pid} is present, and could not be verified as this daemon (${holder.why}); ${disk}` };
  }
  const upMs = nowMs - Date.parse(start.at);
  if (upMs > STALL_AFTER_MS) {
    return { state: "stalled", detail: `${who}, is alive, and has run ${describeAge(upMs)} without writing a checkpoint (a tick is 30s); ${disk}` };
  }
  return { state: "running", detail: `${who}, ${describeAge(upMs)} ago, and has not written its first checkpoint yet; ${disk}` };
}

export function daemonStanding(input: StandingInput): DaemonStanding {
  const { read, notes, nowMs } = input;
  if (read.kind === "unusable") {
    return {
      state: "cannot-tell",
      detail:
        `there IS a ${CHECKPOINT_FILE} and this build cannot parse it (${read.why}: ${read.detail}); ` +
        `this build reads schema ${STORE_SCHEMA}. The Overseer may well be running — nothing here can ` +
        "tell, and the daemon's own notes are below. Wait for the next checkpoint rather than starting a second one.",
    };
  }
  const checkpoint = read.kind === "checkpoint" ? read.checkpoint : null;
  const newer = newerStartThanCheckpoint(checkpoint, notes);
  if (newer !== null) return standingWithoutCheckpoint(newer, checkpoint, input);
  if (checkpoint === null) {
    return {
      state: "never-run",
      detail:
        notes.length === 0
          ? "no checkpoint and no notes: the Overseer has never run against this store"
          : "notes but no checkpoint and no start note among them: nothing here says an Overseer started against this store",
    };
  }
  // A CLOCK FROM THE FUTURE FIRST, before any age is read as fresh or stale (Sol's F43).
  const anomaly = futureClock(checkpoint, nowMs);
  if (anomaly !== null) return { state: "cannot-tell", detail: anomaly };
  const ageMs = nowMs - Date.parse(checkpoint.writtenAt);
  const old = describeSince(ageMs, "old");
  const pid = checkpoint.heartbeat.pid;
  // Only a stop of THIS checkpoint's instance, closing its own start, says it went on purpose.
  const stop = lifecycleOf(notes, checkpoint.heartbeat.instanceId)?.stop ?? null;
  if (stop !== null) {
    return { state: "stopped", detail: `stopped on purpose at ${stop.at} (${stop.why}); the last checkpoint is ${old}` };
  }
  const startedAt = checkpoint.heartbeat.startedAt;
  const holder = holderOf(pid, startedAt, input.identify);
  switch (holder.kind) {
    case "gone":
      return { state: "killed", detail: `pid ${pid} is gone and it never wrote a stopping note, so it was killed; the last checkpoint is ${old}` };
    case "stranger":
      return { state: "killed", detail: `${reusedPid(pid, holder, startedAt)}; it never wrote a stopping note, and the last checkpoint is ${old}` };
    case "unverified":
      // Not RUNNING: a pid that exists proves only that SOME process holds it.
      return {
        state: "cannot-tell",
        detail: `pid ${pid} present and the checkpoint is ${ageMs > STALL_AFTER_MS ? old : "fresh"}; could not verify it is this daemon (${holder.why})`,
      };
    case "this":
      break;
    default: {
      const never: never = holder;
      throw new Error(`no standing for ${JSON.stringify(never)}`);
    }
  }
  if (ageMs > STALL_AFTER_MS) {
    return { state: "stalled", detail: `pid ${pid} is alive and has not written for ${describeAge(ageMs)} (a tick is 30s)` };
  }
  return {
    state: "running",
    detail: `pid ${pid}, instance ${checkpoint.heartbeat.instanceId}, ${checkpoint.heartbeat.ticks} ticks, last written ${describeSince(ageMs, "ago")}`,
  };
}

export type EventTail = {
  events: OverseerEvent[];
  unreadable: number;
  tornTail: string | null;
  total: number;
  cause: string | null;
};

export function readEventTail(root: string, limit: number): EventTail {
  const path = join(root, EVENTS_FILE);
  if (!existsSync(path)) return { events: [], unreadable: 0, tornTail: null, total: 0, cause: null };
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (cause) {
    return {
      events: [],
      unreadable: 0,
      tornTail: null,
      total: 0,
      cause: `could not read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  const split = splitJsonl(bytes);
  const parsed = parseEventLines(split.completeLines);
  return {
    events: parsed.events.slice(-limit),
    unreadable: parsed.unreadable.length,
    tornTail: split.tornTail,
    total: parsed.events.length,
    cause: null,
  };
}

export function describeEvent(event: OverseerEvent): string {
  const at = event.at.slice(11, 19);
  switch (event.kind) {
    case "session-seen":
      return `${at}  seen       ${event.row.name} (${event.identity.tmuxId}) — ${event.row.status.kind}`;
    case "session-status":
      return `${at}  status     ${event.identity.tmuxId} — ${event.from} → ${event.to}`;
    case "tmux-session-gone":
      return `${at}  gone       ${event.name} (${event.identity.tmuxId}) — ${event.why}`;
    case "session-replaced":
      return `${at}  replaced   ${event.row.name} (${event.identity.tmuxId}) — a different conversation is in the pane`;
    case "session-wait-restarted":
      return `${at}  wait again ${event.identity.tmuxId} — now until ${event.deadline}`;
    case "session-row-changed":
      return `${at}  changed    ${event.row.name} (${event.identity.tmuxId}) — ${event.fields.join(", ")}`;
    case "session-pane-replaced":
      return `${at}  new pane   ${event.identity.tmuxId} — pid ${event.previousPanePid ?? "none"} → ${event.panePid}`;
    case "session-execution-changed":
      return (
        `${at}  ${event.previousToken === null ? "run seen " : "new run  "}  ${event.identity.tmuxId} — ${event.previousToken ?? "none recorded"} → ${event.token}` +
        (event.conversation.kind === "conflicting"
          ? `, now conversation ${event.conversation.observed} rather than the claimed ${event.conversation.claimed}`
          : `, conversation ${event.conversation.kind}`)
      );
    case "job-occurrence-reserved":
      return `${at}  reserved   ${event.occurrenceId} — lease until ${event.leaseUntil}`;
    case "job-occurrence-started":
      return `${at}  started    ${event.occurrenceId} — pid ${event.pid}`;
    case "job-occurrence-finished":
      return `${at}  finished   ${event.occurrenceId} — ${event.outcome.kind === "exited" ? `exit ${event.outcome.code}` : `failed: ${event.outcome.why}`}`;
    case "job-occurrence-refused":
      return `${at}  refused    ${event.occurrenceId} — ${event.why}`;
    case "job-occurrence-unknown":
      return `${at}  unknown    ${event.occurrenceId} — ${event.why}`;
    case "rule-intended":
      return `${at}  intends    ${event.occurrenceId} ${event.ruleId} — ${event.what}`;
    case "rule-settled":
      return `${at}  rule       ${event.occurrenceId} ${event.ruleId} — ${describeRuleOutcome(event.outcome)}`;
    case "recovery-candidate":
      return `${at}  candidate  ${event.entry.name} (${event.entry.tmuxId}) — ${event.id}, generation ${event.disappearance.generation}${event.disappearance.bootChanged ? ", boot changed" : ""}${event.disappearance.watched ? "" : ", unwatched"}`;
    case "recovery-disposition":
      return `${at}  disposed   ${event.id} — ${event.disposition}`;
    default: {
      const never: never = event;
      throw new Error(String(never));
    }
  }
}

export const CLAIM_MAX_SNAPSHOT_AGE_MS = 5 * 60_000;
export const CLAIM_FETCH_TIMEOUT_MS = 5_000;

export async function readOverseerClaim(
  baseUrl: string,
  opts: { nowMs?: number; maxAgeMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<OverseerClaim> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${baseUrl}/api/state`, { signal: AbortSignal.timeout(CLAIM_FETCH_TIMEOUT_MS) });
    if (!response.ok) return { kind: "cannot-tell", why: `the dashboard answered ${response.status} for /api/state` };
    return claimFromSnapshot(await response.json() as unknown, {
      nowMs: opts.nowMs ?? Date.now(),
      maxAgeMs: opts.maxAgeMs ?? CLAIM_MAX_SNAPSHOT_AGE_MS,
    });
  } catch (cause) {
    return {
      kind: "cannot-tell",
      why: `the dashboard could not be reached at ${baseUrl} (${cause instanceof Error ? cause.message : String(cause)})`,
    };
  }
}

/**
 * The daemon's standing from the two reads a lock-free reader has — and the
 * rule that notes which are not complete (unreadable, or a final line caught
 * mid-append) make it `cannot-tell` rather than a guess about whether it
 * stopped cleanly. `statusLines` and `overseer diagnose` both come through here,
 * so the two pages cannot disagree about what the same store means.
 */
export function standingFromReads(read: CheckpointRead, notes: ReadNotes, nowMs: number, identify: PidReader): DaemonStanding {
  return standingAndNotesProblem(read, notes, nowMs, identify).standing;
}

function standingAndNotesProblem(
  read: CheckpointRead,
  notes: ReadNotes,
  nowMs: number,
  identify: PidReader,
): { standing: DaemonStanding; notesProblem: { label: "UNREADABLE" | "INCOMPLETE"; detail: string } | null } {
  let notesProblem: { label: "UNREADABLE" | "INCOMPLETE"; detail: string } | null = null;
  if (notes.kind === "unreadable") {
    notesProblem = { label: "UNREADABLE", detail: notes.cause };
  } else {
    if (notes.unreadable > 0) {
      notesProblem = { label: "UNREADABLE", detail: `${notes.unreadable} complete line(s) could not be parsed` };
    } else if (notes.tornTail !== null) {
      notesProblem = { label: "INCOMPLETE", detail: "the final note was observed before its newline" };
    }
  }
  const standing: DaemonStanding =
    notesProblem !== null
      ? {
          state: "cannot-tell",
          detail: `the daemon's notes are not complete (${notesProblem.detail}), so this reader will not infer whether it stopped cleanly`,
        }
      : daemonStanding({ read, notes: notes.kind === "read" ? notes.notes : [], nowMs, identify });
  return { standing, notesProblem };
}

export function statusLines(root: string, nowMs: number = Date.now(), claim?: OverseerClaim): string[] {
  requireAbsoluteRoot(root);
  const read = readCheckpoint(root);
  const checkpoint = read.kind === "checkpoint" ? read.checkpoint : null;
  const notes = readNotes(root);
  const { standing, notesProblem } = standingAndNotesProblem(read, notes, nowMs, (pid) => readPidIdentity(pid));
  const lines: string[] = [`Overseer store: ${root}`, ""];
  lines.push(`daemon      ${standing.state.toUpperCase().replaceAll("-", " ")} — ${standing.detail}`);

  if (read.kind === "unusable") lines.push("source      unknown — the collection clock is in the checkpoint this build cannot parse");
  else if (checkpoint === null) lines.push("source      nothing has been collected yet");
  else if (checkpoint.lastGoodSnapshotAt === null) lines.push("source      the Overseer has never been given a collection by the dashboard");
  else lines.push(`source      last collection ${checkpoint.lastGoodSnapshotAt} (${describeSince(nowMs - Date.parse(checkpoint.lastGoodSnapshotAt), "old")})`);

  if (checkpoint === null) {
    lines.push(
      read.kind === "unusable"
        ? "scheduler   unknown — what the daemon said about it is in the checkpoint this build cannot parse"
        : "scheduler   unknown — no daemon has written a checkpoint to this store yet",
    );
  } else {
    lines.push(`scheduler   ${checkpoint.scheduler.kind.toUpperCase()} — ${checkpoint.scheduler.why}`);
    if (checkpoint.occurrenceHistory?.kind === "lost") {
      lines.push(`            HOLDING EVERY JOB — ${checkpoint.occurrenceHistory.why}`);
      lines.push("            Clear it with: npx tsx scripts/overseer.ts reconcile-jobs --why '<what you checked>', then restart the daemon");
    }
  }

  if (checkpoint === null) {
    lines.push(
      read.kind === "unusable"
        ? "usage       unknown — the last usage reading is in the checkpoint this build cannot parse"
        : "usage       unknown — no daemon has written a checkpoint to this store yet",
    );
  } else lines.push(...usageStatusLines(checkpoint.usage, nowMs));

  lines.push(
    claim === undefined
      ? "overseer    not asked — this reading did not query the dashboard"
      : `overseer    ${describeClaim(claim, escapeName)}`,
  );

  if (notesProblem !== null) {
    lines.push(`notes       ${notesProblem.label} — ${notesProblem.detail}`);
    lines.push(
      `conditions  unknown — the daemon notes that carry condition edges are ${notesProblem.label === "INCOMPLETE" ? "incomplete" : "unreadable"}`,
    );
  } else if (notes.kind === "read") {
    const open = openConditions(notes.notes);
    if (open.length === 0) lines.push("conditions  all clear");
    for (const condition of open) {
      lines.push(`conditions  DEGRADED ${condition.condition} since ${condition.since} (${describeAge(nowMs - Date.parse(condition.since))}) — ${condition.why}`);
    }
  }

  if (checkpoint !== null) {
    lines.push("", registerSummary(checkpoint.register), ...attentionLines(checkpoint.register, nowMs));
    lines.push("", ...inboxLines(checkpoint.attention, nowMs));
  } else if (read.kind === "unusable") {
    lines.push("", "sessions    unknown — the register is in that checkpoint too, but the event log below is still readable");
  }

  const tail = readEventTail(root, 5);
  if (tail.cause !== null) {
    lines.push("", `events      UNREADABLE — ${tail.cause}`);
  } else {
    const size = existsSync(join(root, EVENTS_FILE)) ? statSync(join(root, EVENTS_FILE)).size : 0;
    lines.push(
      "",
      `events      ${tail.total} in the log (${Math.round(size / 1024)} KB)` +
        `${tail.unreadable > 0 ? `, ${tail.unreadable} unreadable lines` : ""}` +
        `${tail.tornTail === null ? "" : ", torn final line"}`,
    );
    for (const event of tail.events) lines.push(`            ${describeEvent(event)}`);
    if (tail.tornTail !== null) lines.push(`            torn tail: ${JSON.stringify(tail.tornTail)}`);
  }
  const recent = notes.kind === "read" ? notes.notes.slice(-4) : [];
  if (recent.length > 0) {
    lines.push("", "overseer   ");
    for (const note of recent) lines.push(`            ${note.at.slice(11, 19)}  ${describeNote(note)}`);
  }
  return lines;
}

function usageStatusLines(usage: StoredUsage, nowMs: number): string[] {
  if (usage.kind === "none") return [`usage       none — ${usage.why}`];
  const report = usage.report;
  const account =
    report.account.kind === "value"
      ? `${report.account.email ?? "?"} (${report.account.rateLimitTier ?? "tier ?"})`
      : report.account.kind === "logged-out"
        ? "NOT LOGGED IN"
        : `account unknown — ${report.account.why}`;
  const lines = [
    `usage       ${report.verdict.level.toUpperCase()} — ${account}, read ${describeAge(nowMs - Date.parse(report.collectedAt))} ago at ${when(report.collectedAt)}`,
  ];
  if (report.rateLimits.kind === "hits") {
    const incidents = groupUsageIncidents(report.rateLimits.hits);
    const unreset = incidents.filter((incident) => Date.parse(incident.resetsAt) > nowMs);
    for (const incident of unreset) {
      const sessions = incident.conversations.length;
      lines.push(`            NOT RESET ${incident.window}: ${sessions} ${sessions === 1 ? "conversation" : "conversations"}, ${incident.rejections} rejected, resets ${when(incident.resetsAt)}`);
    }
    const history = incidents.length - unreset.length;
    if (history > 0) lines.push(`            ${history} earlier window(s) already reset in the scanned range — see \`overseer usage\``);
  } else if (report.rateLimits.kind === "unknown") {
    lines.push(`            rejections unknown — ${report.rateLimits.why}`);
  }
  return lines;
}

function registerSummary(register: readonly RegisterEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of register) counts.set(entry.lastStatusKey, (counts.get(entry.lastStatusKey) ?? 0) + 1);
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => `${count} ${key}`);
  return `sessions    ${register.length} in the register${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`;
}

function attentionLines(register: readonly RegisterEntry[], nowMs: number): string[] {
  const waiting = register
    .filter((entry) => entry.lastStatusKey !== "idle")
    .sort((a, b) => Date.parse(a.statusSince.at) - Date.parse(b.statusSince.at))
    .slice(0, 6);
  const lines = waiting.map(
    (entry) => `            ${entry.lastStatusKey.padEnd(10)} ${describeStatusAge(entry.statusSince, nowMs).padStart(6)}  ${entry.name} (${entry.tmuxId})`,
  );
  if (waiting.some((entry) => entry.statusSince.kind === "lower-bound")) {
    lines.push("            ≥ is a floor: the daemon found it already in that state and cannot see when it began");
  }
  return lines;
}

export function inboxLines(list: AttentionList, nowMs: number): string[] {
  if (list.kind === "unknown") return [`inbox       COULD NOT TELL — ${list.why}`];
  const age = describeAge(nowMs - Date.parse(list.scannedAt));
  // `limited`: the model was refused (plan 260910f D6). Its items print as a
  // list's do, under a line saying so — and an empty one NEVER prints "nothing
  // needs you", which is the sentence the arm exists to withhold.
  const stopped =
    list.kind === "limited"
      ? [`            NOT EVERY SESSION IS BEING JUDGED — ${list.stopped.why}, until ${when(list.stopped.until)}`]
      : [];
  if (list.items.length === 0) {
    if (list.kind === "limited") {
      return [
        `inbox       nothing found among the sessions judged, out of ${list.sessionsScanned} looked at ${age} ago`,
        ...stopped,
      ];
    }
    return [`inbox       nothing needs you, out of ${list.sessionsScanned} sessions looked at ${age} ago`];
  }
  const lines =
    list.sessionsUnreadable === 0 && list.kind === "list"
      ? [`inbox       ${list.items.length} waiting, out of ${list.sessionsScanned} sessions looked at ${age} ago`]
      : [
          `inbox       AT LEAST ${list.items.length} waiting, out of ${list.sessionsScanned} sessions looked at ${age} ago`,
          ...(stopped.length > 0
            ? stopped
            : [`            ${list.sessionsUnreadable} session(s) could not be judged at all, so there may be more`]),
        ];
  for (const item of list.items) {
    const waited = describeAge(nowMs - Date.parse(item.waitingSince));
    const also = item.duplicates.length === 0 ? "" : ` (+${item.duplicates.length} asking the same)`;
    lines.push(`            ${item.kind.padEnd(12)} ${waited.padStart(6)}  ${item.sessionName}${also}`);
    lines.push(`            ${" ".repeat(12)} ${" ".repeat(6)}  ${item.evidence.kind}: ${oneLine(item)}`);
  }
  return lines;
}

function oneLine(item: { evidence: { kind: "dialog"; question: string } | { kind: "prose"; why: string } }): string {
  return (item.evidence.kind === "dialog" ? item.evidence.question : item.evidence.why).replace(/\s+/g, " ").slice(0, 110);
}

function describeStatusAge(since: StatusSince, nowMs: number): string {
  const age = describeAge(nowMs - Date.parse(since.at));
  switch (since.kind) {
    case "observed":
      return age;
    case "lower-bound":
      return `≥${age}`;
    default: {
      const never: never = since;
      throw new Error(`no rendering for ${JSON.stringify(never)}`);
    }
  }
}

// Compatibility for callers that imported this from the renderer before the
// schedule preview needed the formatter in the daemon's import graph.
export { describeAge } from "./format-age.js";

export function when(iso: string): string {
  return zonedLine(iso) ?? `${iso} (a time this tool cannot read)`;
}
