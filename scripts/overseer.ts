#!/usr/bin/env -S npx tsx
/**
 * **The Overseer: run it, and look at what it has seen.**
 *
 *     npx tsx scripts/overseer.ts run                 # the daemon
 *     npx tsx scripts/overseer.ts status              # is it alive, and what does it know
 *     npx tsx scripts/overseer.ts events --limit 40   # what the fleet did
 *     npx tsx scripts/overseer.ts notes  --limit 20   # what the Overseer's own day was like
 *
 * Direction: docs/project/overseer-direction.md. Stage S4 of
 * docs/plans/260908b-overseer-store-and-clock.md.
 *
 * **`status` is not a nicety on top of the daemon; it is the half that makes
 * the daemon worth having.** Greg's NOW goal is *"staying up-to-date on
 * progress automatically"*, and a daemon recording events with nothing to read
 * them fails that while every stage passes. The dashboard owns the page and
 * this stage does not build one, so the honest simplest version is a command.
 *
 * **Every read here is lock-free**, deliberately: `readCheckpoint` was built
 * that way so a reader cannot disturb the writer, and the event log and the
 * note log are read the same way — open, read, close. Running this against a
 * live daemon costs it nothing and can block nothing.
 *
 * `console.log` rather than src/log.ts: this is a CLI, and that is the rule —
 * docs/project/logging.md.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { attentionRunner, DEFAULT_MAX_CALLS, runAttentionCommand } from "../tools/overseer/attention-cli.js";
import { runOverseer, TICK_MS, type DaemonOptions } from "../tools/overseer/daemon.js";
import { gjdRemoteDispatch, jobsEnabled, JOBS_ENABLED_VAR } from "../tools/overseer/dispatch.js";
import { describeRuleJobs, ruleJobs } from "../tools/overseer/rule-jobs.js";
import { RULES_ENABLED_VAR, ruleWork, rulesEnabled } from "../tools/overseer/rule-work.js";
import { describeRuleOutcome } from "../tools/overseer/rules.js";
import type { ProposingRuleWork } from "../tools/overseer/scheduler.js";
import { describeStandingJobs, standingJobs } from "../tools/overseer/standing-jobs.js";
import type { AttentionList } from "../tools/fleet/wire.js";
import type { OverseerEvent } from "../tools/overseer/diff.js";
import type { AuthorisedJob } from "../tools/overseer/jobs.js";
import { describeNote, openConditions, readNotes, type DaemonNote } from "../tools/overseer/notes.js";
import {
  CHECKPOINT_FILE,
  EVENTS_FILE,
  RECONCILE_FILE,
  STORE_SCHEMA,
  describeRefusal,
  isProcessAlive,
  readCheckpoint,
  storeRoot,
  type CheckpointRead,
  type RegisterEntry,
  type StatusSince,
} from "../tools/overseer/store.js";
import { collectUsage, type UsageReport } from "../tools/overseer/usage.js";

/** Where the daemon looks for the dashboard unless told otherwise. */
export const DEFAULT_FLEET_URL = "http://127.0.0.1:8787";

/**
 * The checkout this script is part of.
 *
 * **From this file's own location, not from `process.cwd()`.** The systemd unit
 * sets `WorkingDirectory`, and a person running this by hand from anywhere else
 * would otherwise fingerprint whatever documents happened to be under their cwd
 * — which is a different job with the same name.
 */
export function repoRoot(): string {
  return join(fileURLToPath(new URL(".", import.meta.url)), "..");
}

/**
 * How long a live process may go without writing before it is *stalled* rather
 * than *running*: three ticks.
 *
 * One missed tick is a busy box; three is a process that is up and not doing
 * its job — which is the failure this whole tool exists to make visible, since
 * a stalled daemon renders a perfectly plausible register that stopped being
 * true some time ago.
 */
export const STALL_AFTER_MS = 3 * TICK_MS;

/**
 * The store root, refusing a relative one.
 *
 * **A relative `OVERSEER_STORE_DIR` resolves differently per working
 * directory**, so a systemd start and a manual start from a worktree would take
 * two different locks and write two separate, individually plausible histories
 * — GPT Sol's S3-07. Refusing is the only reading of a relative path that
 * cannot be silently wrong; resolving it against `process.cwd()` is what
 * produces the two stores.
 */
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
  /**
   * The reader's own outcome, WHOLE.
   *
   * **This used to be `Checkpoint | null`, and flattening it was a bug of
   * exactly the kind this file exists to catch.** `absent` and `unusable` are
   * different facts — *nothing was ever written here* versus *something was
   * written and this build cannot read it* — and collapsing them into `null`
   * made a running Overseer report as NEVER RUN for as long as its checkpoint
   * was in a schema this build refuses. Seen live on 2026-09-08: the daemon had
   * been up eighty minutes and had written `current.json` thirty seconds
   * earlier. The information survived the parse and died in the presentation.
   */
  read: CheckpointRead;
  /** The last line of the daemon's own log. Its own last word beats anything inferred. */
  lastNote: DaemonNote | null;
  nowMs: number;
  alive: (pid: number) => boolean;
};

/**
 * Is an Overseer running against this store?
 *
 * **Five arms, and four of them are "no" for different reasons**, which is the
 * point: *stopped on purpose*, *killed*, *up but not writing* and *never run*
 * call for four different things from a person, and a boolean would collapse
 * them into the one word that suggests none of them.
 *
 * The daemon's own `daemon-stopped` note is the strongest evidence available
 * and is read first. A pid is a weak signal — pids are reused, and a fresh
 * process wearing a dead daemon's number is exactly the kind of coincidence
 * this codebase keeps meeting — so it is only ever used to CONFIRM a
 * checkpoint that is already recent.
 *
 * **`cannot-tell` is the sixth, and it is a REFUSAL TO GUESS.** Every other arm
 * is a claim about a daemon; that one says the evidence is behind a file this
 * build cannot parse. Guessing "dead" sends somebody to start a second daemon
 * beside a live one; guessing "running" is the failure the whole project is
 * designed against. So it says neither, and says which schema each side speaks.
 */
export function daemonStanding(input: StandingInput): DaemonStanding {
  const { read, lastNote, nowMs } = input;
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
  if (checkpoint === null) {
    return {
      state: "never-run",
      detail:
        lastNote === null
          ? "no checkpoint and no notes: the Overseer has never run against this store"
          : "notes but no checkpoint: the Overseer started and never got as far as a first collection",
    };
  }
  const ageMs = nowMs - Date.parse(checkpoint.writtenAt);
  const age = describeAge(ageMs);
  const pid = checkpoint.heartbeat.pid;

  if (lastNote?.kind === "daemon-stopped") {
    return { state: "stopped", detail: `stopped on purpose at ${lastNote.at} (${lastNote.why}); the last checkpoint is ${age} old` };
  }
  if (!input.alive(pid)) {
    return { state: "killed", detail: `pid ${pid} is gone and it never wrote a stopping note, so it was killed; the last checkpoint is ${age} old` };
  }
  if (ageMs > STALL_AFTER_MS) {
    return { state: "stalled", detail: `pid ${pid} is alive and has not written for ${age} (a tick is ${Math.round(TICK_MS / 1000)}s)` };
  }
  return {
    state: "running",
    detail: `pid ${pid}, instance ${checkpoint.heartbeat.instanceId}, ${checkpoint.heartbeat.ticks} ticks, last written ${age} ago`,
  };
}

export type EventTail = { events: OverseerEvent[]; unreadable: number; total: number };

/** Every event kind, as a total map, so a new arm in diff.ts fails to compile here rather than reading as junk. */
const EVENT_KINDS: Record<OverseerEvent["kind"], true> = {
  "session-seen": true,
  "session-status": true,
  "tmux-session-gone": true,
  "session-replaced": true,
  "session-wait-restarted": true,
  "session-row-changed": true,
  "session-pane-replaced": true,
  "job-occurrence-reserved": true,
  "job-occurrence-started": true,
  "job-occurrence-finished": true,
  "job-occurrence-refused": true,
  "job-occurrence-unknown": true,
  "rule-intended": true,
  "rule-settled": true,
};

/**
 * The last `limit` events, read without taking the store's lock.
 *
 * A duplicate of `store.ts`'s own reader, which is not exported and is reachable
 * only through `openStore` — and `openStore` takes the exclusive lock, so a
 * reader using it would either refuse to run while the daemon is up or, worse,
 * take the lock from it. Reported as a finding; the fix is a lock-free
 * `readEventsAt(root, fromByte)` in that module.
 *
 * The whole file is read, which is fine for a person typing a command and would
 * not be for anything on a tick — see Sol's S3-06.
 */
export function readEventTail(root: string, limit: number): EventTail {
  const path = join(root, EVENTS_FILE);
  if (!existsSync(path)) return { events: [], unreadable: 0, total: 0 };
  const events: OverseerEvent[] = [];
  let unreadable = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      unreadable += 1;
      continue;
    }
    if (isEvent(parsed)) events.push(parsed);
    else unreadable += 1;
  }
  return { events: events.slice(-limit), unreadable, total: events.length };
}

function isEvent(u: unknown): u is OverseerEvent {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return false;
  const record = u as Record<string, unknown>;
  return typeof record["kind"] === "string" && Object.hasOwn(EVENT_KINDS, record["kind"]) && typeof record["at"] === "string";
}

/** One event as a line a person reads, naming the session rather than only its handle. */
export function describeEvent(event: OverseerEvent): string {
  const when = event.at.slice(11, 19);
  switch (event.kind) {
    case "session-seen":
      return `${when}  seen       ${event.row.name} (${event.identity.tmuxId}) — ${event.row.status.kind}`;
    case "session-status":
      return `${when}  status     ${event.identity.tmuxId} — ${event.from} → ${event.to}`;
    case "tmux-session-gone":
      return `${when}  gone       ${event.name} (${event.identity.tmuxId}) — ${event.why}`;
    case "session-replaced":
      return `${when}  replaced   ${event.row.name} (${event.identity.tmuxId}) — a different conversation is in the pane`;
    case "session-wait-restarted":
      return `${when}  wait again ${event.identity.tmuxId} — now until ${event.deadline}`;
    case "session-row-changed":
      // The fields, because "renamed" and "moved to another worktree" are the
      // same event and a person scanning the log needs to know which one it was.
      return `${when}  changed    ${event.row.name} (${event.identity.tmuxId}) — ${event.fields.join(", ")}`;
    case "session-pane-replaced":
      return `${when}  new pane   ${event.identity.tmuxId} — pid ${event.previousPanePid ?? "none"} → ${event.panePid}`;
    // THE SCHEDULER'S ARMS. A run is addressed by its occurrence id, which
    // carries the job, the instant and the definition hash, so one line of this
    // log is enough to find every other line about the same run.
    case "job-occurrence-reserved":
      return `${when}  reserved   ${event.occurrenceId} — lease until ${event.leaseUntil}`;
    case "job-occurrence-started":
      return `${when}  started    ${event.occurrenceId} — pid ${event.pid}`;
    case "job-occurrence-finished":
      return `${when}  finished   ${event.occurrenceId} — ${
        event.outcome.kind === "exited" ? `exit ${event.outcome.code}` : `failed: ${event.outcome.why}`
      }`;
    case "job-occurrence-refused":
      return `${when}  refused    ${event.occurrenceId} — ${event.why}`;
    // "unknown" AND NOT "failed", in the log a person reads as well as in the
    // type: we do not know that it did not run.
    case "job-occurrence-unknown":
      return `${when}  unknown    ${event.occurrenceId} — ${event.why}`;
    // THE RULES' TWO ARMS, and the pair is the ordering: what it was about to
    // do, then what became of it. A log with an `intended` and no `settled` is
    // a rule that was interrupted between the two, which is exactly the shape
    // appending the intent first exists to make visible.
    case "rule-intended":
      return `${when}  intends    ${event.occurrenceId} ${event.ruleId} — ${event.what}`;
    case "rule-settled":
      return `${when}  rule       ${event.occurrenceId} ${event.ruleId} — ${describeRuleOutcome(event.outcome)}`;
    default: {
      const never: never = event;
      throw new Error(String(never));
    }
  }
}

/**
 * The status page, as lines.
 *
 * Ordered by what a person wants first: is it alive, is it hearing anything, is
 * anything wrong, and only then the fleet — because the register is the part
 * that looks fine when everything above it is broken.
 */
export function statusLines(root: string, nowMs: number = Date.now()): string[] {
  requireAbsoluteRoot(root);
  const read = readCheckpoint(root);
  const checkpoint = read.kind === "checkpoint" ? read.checkpoint : null;
  const notes = readNotes(root);
  const lastNote = notes.notes.at(-1) ?? null;
  const standing = daemonStanding({ read, lastNote, nowMs, alive: isProcessAlive });
  const lines: string[] = [`Overseer store: ${root}`, ""];

  lines.push(`daemon      ${standing.state.toUpperCase().replaceAll("-", " ")} — ${standing.detail}`);

  if (read.kind === "unusable") {
    // NOT "nothing has been collected yet", which is the same lie as NEVER RUN
    // wearing a different noun: the collection clock is inside the file we could
    // not read, so the honest answer is that we do not know.
    lines.push("source      unknown — the collection clock is in the checkpoint this build cannot parse");
  } else if (checkpoint === null) {
    lines.push("source      nothing has been collected yet");
  } else if (checkpoint.lastGoodSnapshotAt === null) {
    // ALIVE BUT DEAF, and it is a different sentence from a quiet fleet.
    lines.push("source      the Overseer has never been given a collection by the dashboard");
  } else {
    lines.push(
      `source      last collection ${checkpoint.lastGoodSnapshotAt} (${describeAge(nowMs - Date.parse(checkpoint.lastGoodSnapshotAt))} old)`,
    );
  }

  // THE SCHEDULER, ON ITS OWN LINE AND ALWAYS PRESENT.
  //
  // Never inferred from an empty occurrence list, and never read out of this
  // shell's environment: a person running `overseer status` is not necessarily
  // in systemd's environment, so the only honest source is what the running
  // daemon wrote down. Three arms, because "nobody said" is a third fact —
  // GPT Sol's C1 is exactly the conflation of *off* with *nothing to do*.
  if (checkpoint === null) {
    lines.push(
      read.kind === "unusable"
        ? "scheduler   unknown — what the daemon said about it is in the checkpoint this build cannot parse"
        : "scheduler   unknown — no daemon has written a checkpoint to this store yet",
    );
  } else {
    const scheduler = checkpoint.scheduler;
    lines.push(`scheduler   ${scheduler.kind.toUpperCase()} — ${scheduler.why}`);
    // AN ARMED SCHEDULER THAT IS HOLDING EVERYTHING LOOKS EXACTLY LIKE A QUIET
    // ONE, which is why this is its own line rather than a nuance of the one
    // above. A held ledger means nothing has been dispatched since that start
    // and nothing will be until somebody clears it.
    if (checkpoint.occurrenceHistory?.kind === "lost") {
      lines.push(`            HOLDING EVERY JOB — ${checkpoint.occurrenceHistory.why}`);
      lines.push("            Clear it with: npx tsx scripts/overseer.ts reconcile-jobs --why '<what you checked>', then restart the daemon");
    }
  }

  const open = openConditions(notes.notes);
  if (open.length === 0) lines.push("conditions  all clear");
  for (const condition of open) {
    lines.push(`conditions  DEGRADED ${condition.condition} since ${condition.since} (${describeAge(nowMs - Date.parse(condition.since))}) — ${condition.why}`);
  }

  if (checkpoint !== null) {
    lines.push("", registerSummary(checkpoint.register), ...attentionLines(checkpoint.register, nowMs));
    // THE INBOX, NOT THE STATUSES. The block above ranks sessions by the state
    // their pane is in; this one says what has been ASKED. They are different
    // questions, and the whole of § `idle` is the bug is that the first cannot
    // answer the second: every session genuinely waiting on Greg on 2026-09-08
    // showed as `idle`, because `needs-you` means a dialog is drawn and their
    // decisions were sentences ending in full stops.
    lines.push("", ...inboxLines(checkpoint.attention, nowMs));
  } else if (read.kind === "unusable") {
    // Said out loud rather than left as an absence: a missing block reads as an
    // empty fleet to anybody who has not counted the blocks before.
    lines.push("", "sessions    unknown — the register is in that checkpoint too, but the event log below is still readable");
  }

  const tail = readEventTail(root, 5);
  const size = existsSync(join(root, EVENTS_FILE)) ? statSync(join(root, EVENTS_FILE)).size : 0;
  lines.push("", `events      ${tail.total} in the log (${Math.round(size / 1024)} KB)${tail.unreadable > 0 ? `, ${tail.unreadable} unreadable lines` : ""}`);
  for (const event of tail.events) lines.push(`            ${describeEvent(event)}`);

  const recent = notes.notes.slice(-4);
  if (recent.length > 0) {
    lines.push("", "overseer   ");
    for (const note of recent) lines.push(`            ${note.at.slice(11, 19)}  ${describeNote(note)}`);
  }
  return lines;
}

function registerSummary(register: readonly RegisterEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of register) counts.set(entry.lastStatusKey, (counts.get(entry.lastStatusKey) ?? 0) + 1);
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => `${count} ${key}`);
  return `sessions    ${register.length} in the register${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`;
}

/**
 * Who has been waiting longest, which is the whole reason the store exists.
 *
 * `statusSince` is the duration attention triage ranks by — the thing the
 * dashboard cannot know, because it has no yesterday. `idle` is left out
 * deliberately: an idle session that has been idle for six hours wants nothing.
 *
 * **`≥` is load-bearing.** Many of these durations are floors — the daemon found
 * the session already in that state — and this column printing four identical
 * `13m` rows against sessions that had been working for hours is the reason
 * `statusSince` has two arms at all. The legend below the rows is there so the
 * mark means something to somebody who has never read any of this.
 *
 * **The sort ignores the arm, on purpose.** A floor is still the best estimate
 * available, and it can only rank a session too LOW — a three-hour block seen
 * thirteen minutes ago sorts as thirteen minutes, which under-reports rather
 * than inventing urgency. Ranking floors above readings would be guessing about
 * the part we cannot see.
 */
function attentionLines(register: readonly RegisterEntry[], nowMs: number): string[] {
  const waiting = register
    .filter((entry) => entry.lastStatusKey !== "idle")
    .sort((a, b) => Date.parse(a.statusSince.at) - Date.parse(b.statusSince.at))
    .slice(0, 6);
  const lines = waiting.map(
    (entry) =>
      `            ${entry.lastStatusKey.padEnd(10)} ${describeStatusAge(entry.statusSince, nowMs).padStart(6)}  ${entry.name} (${entry.tmuxId})`,
  );
  if (waiting.some((entry) => entry.statusSince.kind === "lower-bound")) {
    lines.push("            ≥ is a floor: the daemon found it already in that state and cannot see when it began");
  }
  return lines;
}

/**
 * The attention inbox, as the checkpoint carries it.
 *
 * **Three outcomes, three sentences, and never a blank.** A list; a calm fleet,
 * which is an empty list WITH the count that proves something looked; and *could
 * not tell*, which is what a broken probe or a pass that never ran produces.
 * Printing nothing for the second and third is how an empty inbox comes to mean
 * both "all clear" and "the thing that was supposed to look is dead" —
 * docs/reusable/silent-success.md, and § The failure to design against, which
 * names *the Overseer silently dead while the page says "nothing needs you"* as
 * one of the two failures worth designing against.
 */
export function inboxLines(list: AttentionList, nowMs: number): string[] {
  if (list.kind === "unknown") return [`inbox       COULD NOT TELL — ${list.why}`];
  const age = describeAge(nowMs - Date.parse(list.scannedAt));
  // ONLY WHEN NON-ZERO. A caveat printed on every healthy pass is one Greg learns
  // to read past, which is A17 — an alarm that is usually wrong is worse than no
  // alarm — and would be worse than not having the number at all.
  //
  // AT LEAST N, rather than N and a retraction. An empty list cannot reach here
  // with anything unjudged — `buildAttentionList` returns `unknown` for that —
  // so the only incomplete case left is a list that found something, and the
  // honest form of it is a floor rather than a figure with a caveat under it.
  // The same rule the money uses one file over: a quantity that is a lower bound
  // must not be able to render as a reading.
  if (list.items.length === 0) {
    return [`inbox       nothing needs you, out of ${list.sessionsScanned} sessions looked at ${age} ago`];
  }
  const lines =
    list.sessionsUnreadable === 0
      ? [`inbox       ${list.items.length} waiting, out of ${list.sessionsScanned} sessions looked at ${age} ago`]
      : [
          `inbox       AT LEAST ${list.items.length} waiting, out of ${list.sessionsScanned} sessions looked at ${age} ago`,
          `            ${list.sessionsUnreadable} session(s) could not be judged at all, so there may be more`,
        ];
  for (const item of list.items) {
    const waited = describeAge(nowMs - Date.parse(item.waitingSince));
    const also = item.duplicates.length === 0 ? "" : ` (+${item.duplicates.length} asking the same)`;
    lines.push(`            ${item.kind.padEnd(12)} ${waited.padStart(6)}  ${item.sessionName}${also}`);
    // The evidence kind is printed because it is the difference between a
    // question the harness DREW and one we INFERRED from a turn's tail, and a
    // person reading this needs to know which they are looking at.
    lines.push(`            ${" ".repeat(12)} ${" ".repeat(6)}  ${item.evidence.kind}: ${oneLine(item)}`);
  }
  return lines;
}

function oneLine(item: { evidence: { kind: "dialog"; question: string } | { kind: "prose"; why: string } }): string {
  return (item.evidence.kind === "dialog" ? item.evidence.question : item.evidence.why).replace(/\s+/g, " ").slice(0, 110);
}

/**
 * How long it has been in this state, marked when that is a floor.
 *
 * A `switch` with a `never`, rather than a ternary, so a third arm on
 * `StatusSince` has to be given a rendering here instead of quietly borrowing
 * the one that reads best.
 */
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

function describeAge(ms: number): string {
  if (ms < 0) return "in the future";
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

/**
 * Render a usage report for a person.
 *
 * THE POSITIVE CONTROL IS PRINTED EVERY TIME, including — especially — when
 * the answer is "no limits hit". A bare "no limits hit" is the same sentence a
 * probe that opened nothing would print, and the whole point of
 * `ScanCoverage` is that the two must not read alike
 * (docs/reusable/silent-success.md). Likewise an expired cached window prints
 * its `why`, never a percentage: there is no percentage on that arm to print.
 */
function usageLines(report: UsageReport): string[] {
  const out: string[] = [];
  const a = report.account;
  out.push(
    a.kind === "value"
      ? `account   ${a.email ?? "?"}  ${a.subscriptionType ?? "?"}  tier ${a.rateLimitTier ?? "?"}  uuid ${a.accountUuid ?? "?"}`
      : a.kind === "logged-out"
        ? `account   NOT LOGGED IN (projects dir ${a.projectsDirectory ?? "?"})`
        : `account   could not tell: ${a.why}`,
  );
  out.push(`verdict   ${report.verdict.level.toUpperCase()}`);
  for (const reason of report.verdict.reasons) out.push(`          ${reason}`);

  if (report.cache.kind === "unknown") {
    out.push(`cache     could not tell: ${report.cache.why}`);
  } else {
    // THE INSTANT, IN UTC, NEXT TO THE AGE. "73 min ago" is only true at the
    // moment it is printed, and these lines get pasted into messages and plan
    // docs hours later — the wave's own rule, after four hand-typed timestamps
    // went wrong in one day. `fetchedAtMs` is a field all the way from
    // `~/.claude.json`, so the absolute form costs nothing and cannot drift.
    out.push(
      `cache     fetched ${new Date(report.cache.fetchedAtMs).toISOString()} (${Math.round(report.cache.ageMs / 60_000)} min before this reading), account ${report.cache.accountUuid ?? "?"}`,
    );
    for (const w of report.cache.windows) {
      if (w.kind === "value") out.push(`          ${w.window}: ${w.utilizationPercent}% used, resets ${w.resetsAt}`);
      else if (w.kind === "expired") out.push(`          ${w.window}: EXPIRED — ${w.why}`);
      else out.push(`          ${w.window}: unknown — ${w.why}`);
    }
  }

  const c = report.rateLimits.coverage;
  out.push(
    `scanned   ${c.transcriptsOpened}/${c.transcriptsSelected} of ${c.transcriptsFound} transcripts, ${c.linesScanned} lines, ${c.candidateLines} candidates, ${c.tookMs}ms` +
      `${c.transcriptsUnreadable > 0 ? `, ${c.transcriptsUnreadable} unreadable` : ""}` +
      `${c.malformedCandidates > 0 ? `, ${c.malformedCandidates} MALFORMED` : ""}` +
      `${c.truncatedByLimit ? ", TRUNCATED by --max-transcripts" : ""}`,
  );
  switch (report.rateLimits.kind) {
    case "hits":
      for (const h of report.rateLimits.hits.slice(0, 10)) {
        out.push(
          `429       ${h.hitAt ?? "?"}  ${h.window}  resets ${new Date(h.resetsAtMs).toISOString()}  conversation ${h.claudeSessionId ?? "?"}`,
        );
      }
      if (report.rateLimits.hits.length > 10) out.push(`          (${report.rateLimits.hits.length - 10} more)`);
      break;
    case "none":
      out.push("429       none in the scanned window — believable only against the `scanned` line above");
      break;
    case "unknown":
      out.push(`429       could not tell: ${report.rateLimits.why}`);
      break;
    default: {
      const never: never = report.rateLimits;
      throw new Error(String(never));
    }
  }
  out.push(`took      ${report.tookMs}ms, at ${report.collectedAt}`);
  return out;
}

const HELP = [
  "overseer — the fleet's history, and the daemon that records it",
  "",
  "  npx tsx scripts/overseer.ts run [--url URL] [--tick-ms N] [--no-attention] [--no-usage]",
  "  npx tsx scripts/overseer.ts status",
  "  npx tsx scripts/overseer.ts reconcile-jobs --why '<what you checked>'",
  "  npx tsx scripts/overseer.ts events [--limit N]",
  "  npx tsx scripts/overseer.ts notes [--limit N]",
  "  npx tsx scripts/overseer.ts usage [--since-hours N] [--max-transcripts N] [--json]",
  "  npx tsx scripts/overseer.ts attention [--max-calls N] [--dry] [--json]",
  "                                        [--capture-to DIR | --panes DIR] [--out FILE] [--write]",
  "",
  `The store is $OVERSEER_STORE_DIR, or ~/.overseer. The dashboard is ${DEFAULT_FLEET_URL} unless --url says otherwise.`,
  "",
  "`attention` reads every live pane and says what needs Greg. --dry makes no model calls and no",
  "paid pass. It does NOT write the store's memory unless you pass --write: the daemon holds the",
  "lock and this command does not honour it, so two writers is the default you do not want.",
  "",
  `THE SCHEDULER IS OFF unless ${JOBS_ENABLED_VAR}=1. Armed, it dispatches the standing jobs in`,
  "docs/project/overseer.md as real Claude sessions on this box, so turning it on is Greg's",
  "decision and not a side effect of starting the daemon. `status` says which it is.",
  "",
  `${RULES_ENABLED_VAR}=1 is the OTHER arming: the deterministic rules and nothing else. A daemon`,
  "started that way is handed no session dispatcher at all, so it cannot start a Claude session and",
  "cannot spend anything. It is the switch to use to watch a rule fire.",
].join("\n");

/**
 * **What the daemon will be given as a scheduler, and whether it is armed.**
 *
 * A function rather than four lines inside `case "run"` for one reason: GPT
 * Sol's C1 was that the shipped CLI passed no `jobs` at all, and a decision made
 * inline inside a command that starts a daemon is a decision no test can ask
 * about. This one can be, and `tests/overseer-standing-jobs.test.ts` does.
 *
 * **OFF UNLESS SOMEBODY SAID SO OUT LOUD.** Arming it starts real Claude
 * sessions on a shared box, which is Greg's decision and must not be a side
 * effect of merging a branch — the same spirit as `FLEET_ACT_ENABLED`, and the
 * same shape: exactly `"1"`.
 *
 * The definitions are built either way, so a disarmed daemon can still say WHAT
 * it would have run and whether any of it has drifted from its pin. "Off" and
 * "on with nothing to do" are different states and this returns different
 * sentences for them.
 */
/**
 * **Which of the three armings this daemon is under.**
 *
 * `rules-only` is GPT Sol's SP-4. There was one global switch; arming it
 * supplied both standing jobs, and both were immediately due — so *"watch each
 * rule fire for real"* could not be done without starting paid model sessions
 * under a gate 4 the plan admits is unbuilt.
 *
 * **The separation is a capability, not a filter.** Under `rules-only` the
 * daemon is handed no `SpawnJob` at all, so nothing in that process can create
 * a Claude session however due a job is; and `ruleJobs()` returns
 * `AuthorisedRuleJob[]`, a type a session job cannot inhabit. A filter that a
 * future job could fall through is what this deliberately is not.
 */
export type SchedulerArming = "off" | "rules-only" | "all";

export function schedulerWiring(env: NodeJS.ProcessEnv): {
  /** True for either arming. Kept because the status page and the start note both ask the yes/no question. */
  armed: boolean;
  arming: SchedulerArming;
  detail: string;
  problems: readonly string[];
  /** What the definitions WOULD be under a full arming — so a disarmed daemon can still say what it is not running. */
  definitions: readonly AuthorisedJob[];
  /**
   * **What `runOverseer` is actually given**, ready to spread — and `undefined`
   * when disarmed, because an absent `jobs` is what makes the daemon build no
   * scheduler timer at all. Returning the fragment rather than a boolean is what
   * lets a test ask the question C1 was about: *does the shipped CLI hand the
   * daemon anything to run?*
   */
  jobs: DaemonOptions["jobs"] | undefined;
} {
  const root = repoRoot();
  const standing = standingJobs(root);
  const rules = ruleJobs(root);
  const arming: SchedulerArming = jobsEnabled(env) ? "all" : rulesEnabled(env) ? "rules-only" : "off";
  const sessionDetail = describeStandingJobs({ armed: arming === "all", enableVar: JOBS_ENABLED_VAR, jobs: standing });
  const ruleDetail = describeRuleJobs({ armed: arming !== "off", enableVar: RULES_ENABLED_VAR, jobs: rules });
  const problems = [...standing.problems, ...rules.problems];
  const definitions = [...standing.jobs, ...rules.jobs];
  const work = (): ProposingRuleWork => ruleWork({ baseUrl: fleetUrl(env), selfPid: process.pid });
  return {
    armed: arming !== "off",
    arming,
    detail:
      arming === "rules-only"
        ? // THE ONE SENTENCE THAT MATTERS MOST HERE. A reader must not have to
          // infer from an absent job list that no session can start; it is a
          // property of what this process was handed, so it is said out loud.
          `deterministic rules only (${RULES_ENABLED_VAR}=1): ${ruleDetail}. ` +
          `NO SESSION DISPATCHER WAS BUILT, so no job in this daemon can start a Claude session — ${sessionDetail}`
        : `${sessionDetail}; rules: ${ruleDetail}`,
    problems,
    definitions,
    jobs:
      arming === "all"
        ? { definitions, spawn: gjdRemoteDispatch({ repoRoot: root }), rules: work() }
        : arming === "rules-only"
          ? // NO `spawn` KEY AT ALL. Not `spawn: undefined`, not a spawner that
            // refuses: the capability is absent from the process.
            { definitions: rules.jobs, rules: work() }
          : undefined,
  };
}

/** Where the dashboard is, for a rule that needs to ask it something. One reading, so the daemon and its rules cannot disagree about the address. */
function fleetUrl(env: NodeJS.ProcessEnv): string {
  return env["OVERSEER_FLEET_URL"] ?? DEFAULT_FLEET_URL;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

/**
 * A numeric flag that must be a positive finite number, or an explicit refusal.
 *
 * Three arms rather than `number | undefined`, because "not given" and "given
 * as nonsense" have to lead to different behaviour: the first takes the
 * default, the second must stop. `Number("nope")` is `NaN`, `Number("")` is 0
 * and `Number(undefined)` is `NaN` — all of which used to sail through and
 * silently disable the bound they were meant to set.
 */
function positiveNumberFlag(
  argv: readonly string[],
  name: string,
  opts: { integer?: boolean } = {},
): { kind: "absent" } | { kind: "value"; value: number } | { kind: "invalid"; why: string } {
  const at = argv.indexOf(name);
  if (at === -1) return { kind: "absent" };
  const raw = argv[at + 1];
  if (raw === undefined || raw.startsWith("--")) return { kind: "invalid", why: `${name} needs a number after it` };
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { kind: "invalid", why: `${name} must be a positive number, got ${JSON.stringify(raw)}` };
  }
  if (opts.integer === true && !Number.isInteger(value)) {
    return { kind: "invalid", why: `${name} counts whole transcripts, so it must be a whole number, got ${JSON.stringify(raw)}` };
  }
  return { kind: "value", value };
}

async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0] ?? "status";
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return 0;
  }
  const root = requireAbsoluteRoot(storeRoot());

  switch (command) {
    case "status":
      console.log(statusLines(root).join("\n"));
      return 0;
    case "events": {
      const tail = readEventTail(root, Number(flag(argv, "--limit") ?? 40));
      // "0 events" and "no store" are not the same sentence, and printing
      // nothing at all would be a third thing that looks like both.
      if (tail.total === 0) console.log(`no events in ${join(root, EVENTS_FILE)}`);
      for (const event of tail.events) console.log(describeEvent(event));
      if (tail.unreadable > 0) console.log(`(${tail.unreadable} unreadable lines)`);
      return 0;
    }
    case "notes": {
      const read = readNotes(root, Number(flag(argv, "--limit") ?? 40));
      if (read.notes.length === 0) console.log("the Overseer has written nothing about itself yet");
      for (const note of read.notes) console.log(`${note.at}  ${describeNote(note)}`);
      return 0;
    }
    case "attention":
      return await runAttentionCommand({
        root,
        maxCalls: Number(flag(argv, "--max-calls") ?? DEFAULT_MAX_CALLS),
        dry: argv.includes("--dry"),
        json: argv.includes("--json"),
        // READ-ONLY BY DEFAULT, and `--write` is the opt-in — GPT Sol's second
        // round. The daemon holds the store's lock and this command does not
        // honour it, so a hand run against a live daemon's root was a second
        // writer on `attention.json`: an atomic rename stops a torn file and does
        // nothing about a lost update or a duplicated call. Refusing by default
        // costs a person nothing (the daemon is the producer) and cannot be wrong.
        write: argv.includes("--write"),
        out: flag(argv, "--out") ?? null,
        panes: flag(argv, "--panes") ?? null,
        captureTo: flag(argv, "--capture-to") ?? null,
      });
    case "usage": {
      // A command rather than a daemon block for the same reason the header
      // gives for the rest of this file: there is no scheduler here yet, and the
      // honest simplest version of "how close are we to a limit" is something a
      // person or another agent can run and read. It does not touch the store.
      // `Number(flag)` used to go straight into the options, so
      // `--max-transcripts nope` produced NaN, every comparison against it was
      // false, and the bound silently vanished — GPT Sol's finding 10. A flag
      // that quietly does the opposite of what it says is worse than no flag.
      const sinceHours = positiveNumberFlag(argv, "--since-hours");
      // INTEGER, because this one is a COUNT. `--max-transcripts 0.5` passed the
      // positive-number check and then `slice(0, 0.5)` selected zero
      // transcripts — a flag that reads as "scan at most half a file" and
      // behaves as "scan nothing". GPT Sol's round-2 finding 7. `--since-hours`
      // stays fractional on purpose; half an hour is a sensible window.
      const maxTranscripts = positiveNumberFlag(argv, "--max-transcripts", { integer: true });
      if (sinceHours.kind === "invalid") {
        console.error(`✗ ${sinceHours.why}\n\n${HELP}`);
        return 1;
      }
      if (maxTranscripts.kind === "invalid") {
        console.error(`✗ ${maxTranscripts.why}\n\n${HELP}`);
        return 1;
      }
      const report = await collectUsage({
        ...(sinceHours.kind === "absent" ? {} : { sinceMs: sinceHours.value * 3600_000 }),
        ...(maxTranscripts.kind === "absent" ? {} : { maxTranscripts: maxTranscripts.value }),
      });
      if (argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
      else console.log(usageLines(report).join("\n"));
      return 0;
    }
    case "reconcile-jobs": {
      // THE ONE WAY OUT OF A HELD SCHEDULER, and it is deliberately a person's
      // act rather than a setting. A start that could not reconstruct the
      // occurrence ledger holds every scheduled job — a cold start is not
      // permission — and carries that verdict forward across restarts, so
      // without this there would be no way back except deleting the store.
      //
      // It writes a file the NEXT start consumes and deletes. Not an env var:
      // one left set turns "somebody decided this once" into "the protection is
      // off for ever".
      const why = flag(argv, "--why");
      if (why === undefined || why.trim() === "") {
        console.error(
          "✗ reconcile-jobs needs --why \"<what you checked>\".\n" +
            "  This clears a hold that exists because nobody can tell whether some job already ran.\n" +
            "  Look at the log and at `gjd-remote ls` first, and put what you found in the reason —\n" +
            "  it is written into the store and read by whoever asks why a job ran twice.",
        );
        return 1;
      }
      const path = join(root, RECONCILE_FILE);
      writeFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), why }, null, 2)}\n`, { mode: 0o600 });
      console.log(
        `wrote ${path}\n` +
          "The NEXT Overseer start consumes it and clears the hold — a daemon already running keeps\n" +
          "holding its jobs until it is restarted (`systemctl restart overseer`).",
      );
      return 0;
    }
    case "run": {
      const controller = new AbortController();
      // SIGTERM is what systemd sends and SIGINT is what a person sends; both
      // must stop it the same way, so the stopping note is written and the lock
      // is released rather than left for the next start to puzzle over.
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.on(signal, () => {
          console.log(`${signal} — stopping`);
          controller.abort();
        });
      }
      const tickMs = flag(argv, "--tick-ms");
      // The attention pass is wired in HERE rather than inside the daemon,
      // because it reads tmux and calls a paid model and daemon.ts does neither.
      // With no key it is absent, and the store then publishes a list that says
      // nothing has looked — which is not the same as an empty one.
      // The epoch is one continuous run of observation, and a restart mints a new
      // one — which is exactly when the persisted WAITS must be dropped, because a
      // first-seen instant cannot span a gap nobody watched. The verdicts survive
      // it; see `memoryForEpoch`.
      const attentionRun = argv.includes("--no-attention")
        ? null
        : attentionRunner(root, `daemon-${randomUUID()}`);
      if (attentionRun === null) {
        console.log(
          argv.includes("--no-attention")
            ? "attention: off (--no-attention)"
            : "attention: off — OPENROUTER_API_KEY is not set, so nothing will look at what needs you",
        );
      }
      // The usage scan is wired in here for the same reason, and it needs NO
      // key: its evidence is `~/.claude.json` and the transcripts on disk, so
      // unlike attention it is available on a box with no OpenRouter credentials
      // at all. `--no-usage` turns it off, and the reason to want that is cost of
      // a different kind: a scan reads ~2.9 GB, so a box already thrashing is one
      // where a person may reasonably want it quiet.
      //
      // `collectUsage` takes the module's own defaults deliberately. The CLI's
      // `--since-hours` and `--max-transcripts` narrow a scan for a person in a
      // hurry, and a narrowed scan is exactly what `absenceGap` refuses to call
      // conclusive — so a daemon that quietly took them would publish `unknown`
      // for ever and look broken.
      const usageOff = argv.includes("--no-usage");
      if (usageOff) console.log("usage: off (--no-usage)");

      const wiring = schedulerWiring(process.env);
      // THE ARMING, not a yes/no. "off", "deterministic rules only" and "armed"
      // are three states and the middle one is the whole of SP-4; printing two
      // of them would put a reader back where they started.
      console.log(`scheduler: ${wiring.arming === "all" ? "ARMED" : wiring.arming === "rules-only" ? "RULES ONLY" : "OFF"} — ${wiring.detail}`);
      for (const problem of wiring.problems) console.error(`✗ ${problem}`);
      const outcome = await runOverseer({
        root,
        baseUrl: flag(argv, "--url") ?? process.env["OVERSEER_FLEET_URL"] ?? DEFAULT_FLEET_URL,
        signal: controller.signal,
        // Absent rather than undefined: `exactOptionalPropertyTypes` tells those
        // apart, and absent is what "take the default" means.
        ...(tickMs === undefined ? {} : { tickMs: Number(tickMs) }),
        ...(attentionRun === null ? {} : { attention: { run: attentionRun } }),
        ...(usageOff ? {} : { usage: { run: () => collectUsage() } }),
        // ABSENT rather than present-and-empty when disarmed: an absent `jobs`
        // is what makes `daemon.ts` build no scheduler timer at all, and it is
        // also what it reads to decide the checkpoint says OFF.
        // Absent rather than present-and-undefined, which
        // `exactOptionalPropertyTypes` makes different things — and here they
        // genuinely are: absent is what stops `daemon.ts` building a timer.
        ...(wiring.jobs === undefined ? {} : { jobs: wiring.jobs }),
        schedulerDetail: wiring.detail,
      });
      switch (outcome.kind) {
        case "refused":
          console.error(`✗ ${describeRefusal(outcome.refusal)}`);
          return 1;
        case "lock-lost":
          console.error(`✗ another Overseer took the lock${outcome.holder === null ? "" : ` (pid ${outcome.holder.pid})`} — stopping rather than writing beside it`);
          return 1;
        case "stopped":
          console.log(`stopped: ${outcome.why}`);
          return 0;
        default: {
          const never: never = outcome;
          throw new Error(String(never));
        }
      }
    }
    default:
      console.error(`unknown command ${JSON.stringify(command)}\n\n${HELP}`);
      return 1;
  }
}

/** Imported by a test, or run. `gjd-remote.ts` calls main at import time and is untestable for it. */
function isMain(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && invoked === fileURLToPath(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause: unknown) => {
      console.error(`✗ ${cause instanceof Error ? cause.message : String(cause)}`);
      process.exitCode = 1;
    });
}
