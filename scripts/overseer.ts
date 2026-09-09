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

import { Command, InvalidArgumentError } from "commander";

import { renderRootHelp } from "../tools/overseer/cli-help.js";
import {
  addMine,
  cliStateForWriting,
  cliStatePath,
  readCliState,
  removeMine,
  whyNotASessionName,
  writeCliState,
} from "../tools/overseer/cli-state.js";

import { attentionRunner, DEFAULT_MAX_CALLS, runAttentionCommand } from "../tools/overseer/attention-cli.js";
import {
  runOverseer,
  TICK_MS,
  USAGE_INTERVAL_MS,
  type DaemonOptions,
} from "../tools/overseer/daemon.js";
import { gjdRemoteDispatch, jobsEnabled, JOBS_ENABLED_VAR } from "../tools/overseer/dispatch.js";
import { describeRuleJobs, ruleJobs } from "../tools/overseer/rule-jobs.js";
import { RULES_ENABLED_VAR, ruleWork, rulesEnabled } from "../tools/overseer/rule-work.js";
import { describeRuleOutcome } from "../tools/overseer/rules.js";
import type { ProposingRuleWork } from "../tools/overseer/rule-protocol.js";
import { describeStandingJobs, standingJobs } from "../tools/overseer/standing-jobs.js";
import { escapeName } from "./gjd-remote-tmux.js";
import type { AttentionList, StoredUsage } from "../tools/fleet/wire.js";
import { type OverseerClaim, claimFromSnapshot, describeClaim } from "../tools/fleet/overseer-claim.js";
/* THE DASHBOARD'S GROUPING AND THE DASHBOARD'S CLOCKS, imported rather than
   restated. `tools/overseer/` already depends on `tools/fleet/` — that is the
   allowed direction of the seam — and two renderings of one measurement is how
   a page and a terminal come to disagree about how many things happened. */
import { groupUsageIncidents } from "../tools/fleet/usage-feed.js";
import { makeUsageRetention } from "../tools/fleet/usage-history-wiring.js";
import { zonedLine } from "../tools/fleet/zones.js";
import type { OverseerEvent } from "../tools/overseer/diff.js";
import { reconcileArming } from "../tools/overseer/arming.js";
import type { Arming, AuthorisedJob } from "../tools/overseer/jobs.js";
import { eligibilityOf, type JobEligibility } from "../tools/overseer/scheduler.js";
import { LAUNCH_SEPARATION_MS } from "../tools/overseer/schedules.js";
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
  "session-execution-changed": true,
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
    // THE PANE DID NOT MOVE, so this line has to say what did. The conversation
    // verdict is on it because `conflicting` is the loudest thing this log can
    // print: the pane is running a conversation nobody addressed.
    case "session-execution-changed":
      return (
        `${when}  ${event.previousToken === null ? "run seen " : "new run  "}  ${event.identity.tmuxId} — ${event.previousToken ?? "none recorded"} → ${event.token}` +
        (event.conversation.kind === "conflicting"
          ? `, now conversation ${event.conversation.observed} rather than the claimed ${event.conversation.claimed}`
          : `, conversation ${event.conversation.kind}`)
      );
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
/**
 * **WHO HOLDS THE OVERSEER CLAIM**, asked of the dashboard rather than of tmux.
 *
 * The dashboard is the one collector on this box
 * (docs/project/overseer-direction.md § Two tenses), so this reads its snapshot
 * instead of growing a second inventory — which is also why it can fail, and why
 * failing has to produce `cannot-tell` rather than *no Overseer*. A supervisor
 * that reports "nobody is in charge" because it could not reach a web server is
 * the exact substitution this whole area keeps writing comments about.
 *
 * Not in `statusLines`, which is synchronous and file-only by design: the claim
 * is passed in, so the printing stays testable without a server.
 */
export async function readOverseerClaim(
  baseUrl: string,
  opts: { nowMs?: number; maxAgeMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<OverseerClaim> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    // A DEADLINE, because a dashboard that accepts the connection and never
    // answers would otherwise hang `overseer status` for ever — and this command
    // is the thing somebody runs when they already suspect the dashboard is
    // unwell. A timeout lands in the catch below as `cannot-tell`, which is the
    // right answer.
    const response = await fetchImpl(`${baseUrl}/api/state`, { signal: AbortSignal.timeout(CLAIM_FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      return { kind: "cannot-tell", why: `the dashboard answered ${response.status} for /api/state` };
    }
    // EVERY judgement about the payload — schema, a failed collection, an
    // uncollected one, staleness, unreadable rows — is `claimFromSnapshot`'s,
    // so this function's whole job is the network and its failures.
    return claimFromSnapshot(await response.json(), {
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
 * How stale a snapshot may be before this reading stops trusting who it names.
 *
 * The dashboard collects on a chain roughly every 60 seconds and backs off 5×
 * after a failure, so a healthy box is never more than a couple of cadences
 * behind. Five minutes is several missed collections — long enough that a
 * momentarily-busy box does not produce an alarm, short enough that a session
 * killed since is unlikely to still be named.
 */
export const CLAIM_MAX_SNAPSHOT_AGE_MS = 5 * 60_000;

/** How long to wait for the dashboard to answer at all. It is on localhost. */
export const CLAIM_FETCH_TIMEOUT_MS = 5_000;

export function statusLines(root: string, nowMs: number = Date.now(), claim?: OverseerClaim): string[] {
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

  // CAN THIS ACCOUNT AFFORD MORE WORK, ON ITS OWN LINE AND ALWAYS PRESENT.
  //
  // A stopped fleet with no explanation and a rate-limited account look
  // identical on the register above: every session sits at a prompt doing
  // nothing. This is the line that tells them apart, and it is here rather than
  // under `overseer usage` because that command takes a fresh 30-45 second scan
  // and this one reads what the daemon already wrote.
  if (checkpoint === null) {
    lines.push(
      read.kind === "unusable"
        ? "usage       unknown — the last usage reading is in the checkpoint this build cannot parse"
        : "usage       unknown — no daemon has written a checkpoint to this store yet",
    );
  } else {
    lines.push(...usageStatusLines(checkpoint.usage, nowMs));
  }

  // WHO THE OVERSEER IS, ON ITS OWN LINE AND ALWAYS PRESENT. The box is meant
  // to have exactly one, the claim dies with the tmux server, and nothing else
  // on this page would notice — a daemon can be perfectly alive with no session
  // holding the role. `not asked` is a fourth state and is not `none`: it is
  // what a caller that did not look produces, and reading it as "nobody" would
  // be the same substitution the source line above refuses to make.
  lines.push(
    claim === undefined
      ? "overseer    not asked — this reading did not query the dashboard"
      // ESCAPED: a session name is agent-authored text and this line goes to a
      // terminal. `describeClaim` cannot escape on its own — it must stay a leaf
      // module the browser can compile — so the terminal caller supplies it.
      : `overseer    ${describeClaim(claim, escapeName)}`,
  );

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

/**
 * The stored usage reading, in two or three lines on the status page.
 *
 * **The reading's own clock, not the checkpoint's.** They are routinely hours
 * apart: a full scan is 30-45 seconds over ~2.9 GB and does not always finish,
 * and `chooseUsage` deliberately republishes an earlier pass's report when a
 * fresh one falls over. A status page dating this by `writtenAt` would show a
 * two-hour-old reading as thirty seconds old — the stale-reading-that-looks-
 * current failure the whole subsystem exists to refuse.
 *
 * **And an incident whose window has passed is history**, judged here against
 * `nowMs` rather than repeated out of the verdict, which was true when it was
 * taken. The plan's own words: *a post-reset old 429 is history*.
 */
function usageStatusLines(usage: StoredUsage, nowMs: number): string[] {
  if (usage.kind === "none") {
    // ORDINARY, NOT BROKEN: `--no-usage`, or a daemon that has not reached its
    // first 300-second usage tick. Said as such so nobody inspects a good file.
    return [`usage       none — ${usage.why}`];
  }
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
    // **"NOT RESET" IS NOT "IN FORCE", and the status page may not upgrade one
    // to the other.** The verdict on the line above is the only thing that says
    // this account is blocked, because only it has the cache attribution:
    // swapping subscriptions with `/login` leaves the previous account's
    // rejections in the transcripts, and an unexpired 429 from an account Greg
    // has left is indistinguishable here. Against the live store on 2026-09-08
    // an earlier draft printed IN FORCE seven_day under a verdict of UNKNOWN.
    const unreset = incidents.filter((i) => Date.parse(i.resetsAt) > nowMs);
    for (const incident of unreset) {
      const sessions = incident.conversations.length;
      lines.push(
        `            NOT RESET ${incident.window}: ${sessions} ${sessions === 1 ? "conversation" : "conversations"}, ` +
          `${incident.rejections} rejected, resets ${when(incident.resetsAt)}`,
      );
    }
    // The rest as a count. Nine incidents, eight of them days old, is what the
    // real store holds — and printed as nine lines the one that matters is the
    // second line of a wall. `overseer usage` lists them all.
    const history = incidents.length - unreset.length;
    if (history > 0) {
      lines.push(`            ${history} earlier window(s) already reset in the scanned range — see \`overseer usage\``);
    }
  } else if (report.rateLimits.kind === "unknown") {
    // NOT "no limits hit". The scan could not size its own absence.
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
      `cache     fetched ${whenEpoch(report.cache.fetchedAtMs)} (${Math.round(report.cache.ageMs / 60_000)} min before this reading), account ${report.cache.accountUuid ?? "?"}`,
    );
    for (const w of report.cache.windows) {
      if (w.kind === "value") out.push(`          ${w.window}: ${w.utilizationPercent}% used, resets ${when(w.resetsAt)}`);
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
    case "hits": {
      // **ONE WINDOW, ONE INCIDENT** — the same grouping the dashboard draws,
      // out of the same function, because two renderings of one measurement is
      // how the two ends come to disagree about how many things happened. The
      // old form printed one line per rejection and truncated at ten, which on
      // the 27 rejections measured on 2026-09-08 was seventeen invisible lines
      // all repeating one reset instant.
      const incidents = groupUsageIncidents(report.rateLimits.hits);
      for (const incident of incidents) {
        const sessions = incident.conversations.length;
        out.push(
          `429       ${incident.window}  resets ${when(incident.resetsAt)}  ` +
            `${sessions} ${sessions === 1 ? "conversation" : "conversations"}, ${incident.rejections} rejected` +
            `${incident.unidentifiedRejections > 0 ? ` (${incident.unidentifiedRejections} unattributed)` : ""}`,
        );
        if (incident.firstHitAt !== null) {
          out.push(`          first ${when(incident.firstHitAt)}${incident.lastHitAt === null ? "" : `, last ${when(incident.lastHitAt)}`}`);
        }
      }
      break;
    }
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
  out.push(`took      ${report.tookMs}ms, at ${when(report.collectedAt)}`);
  return out;
}

/**
 * **AN INSTANT, IN UTC, LONDON AND ATHENS** — every timestamp this command
 * prints, so it reads the same wherever Greg is.
 *
 * > include timezone because I'm bouncing between London/Athens
 * >
 * > — Greg, 2026-09-08
 *
 * `tools/fleet/zones.ts` is the formatter and the argument; this is the one
 * place the CLI reaches for it, so a line that cannot be read says so rather
 * than printing `Invalid Date`.
 */
function when(iso: string): string {
  return zonedLine(iso) ?? `${iso} (a time this tool cannot read)`;
}

/**
 * The same, from an epoch millisecond that came out of `~/.claude.json`.
 *
 * **`when(new Date(ms).toISOString())` IS NOT THIS, and the difference took
 * down `overseer status`.** The argument is evaluated first, so a `fetchedAtMs`
 * of `1e100` — finite, and the producer's parsers only check finiteness —
 * throws `RangeError: Invalid time value` before `when` can contain anything.
 * Reproduced by GPT Sol in round two, 2026-09-09: `overseer usage` exited 1
 * while `overseer usage --json` happily printed the malformed value.
 *
 * The range is ECMAScript's own ±8.64e15. Out of it, the number is printed as
 * the raw thing it is rather than as a time, which is the honest rendering of a
 * field nobody can turn into an instant.
 */
function whenEpoch(ms: number): string {
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return `${ms} (not an instant this tool can read)`;
  return when(new Date(ms).toISOString());
}

/** How the usage rows name this script, and what a person types. */
const INVOCATION = "npx tsx scripts/overseer.ts";

/**
 * The paragraphs the parser cannot generate.
 *
 * Everything here is a thing Commander does not know: what a command costs, who
 * decides whether it is armed, and which of two similar-looking switches is the
 * one that spends money. The usage rows between them come out of the registered
 * commands — `tools/overseer/cli-help.ts` says why the two halves are split.
 */
const HELP_PROSE_AFTER: readonly string[] = [
  `The store is $OVERSEER_STORE_DIR, or ~/.overseer. The dashboard is ${DEFAULT_FLEET_URL} unless --url says otherwise.`,
  [
    "`attention` reads every live pane and says what needs Greg. --dry makes no model calls and no",
    "paid pass. It does NOT write the store's memory unless you pass --write: the daemon holds the",
    "lock and this command does not honour it, so two writers is the default you do not want.",
  ].join("\n"),
  [
    `THE SCHEDULER IS OFF unless ${JOBS_ENABLED_VAR}=1. Armed, it dispatches the standing jobs in`,
    "docs/project/overseer.md as real Claude sessions on this box, so turning it on is Greg's",
    "decision and not a side effect of starting the daemon. `status` says which it is.",
  ].join("\n"),
  [
    `${RULES_ENABLED_VAR}=1 is the OTHER arming: the deterministic rules and nothing else. A daemon`,
    "started that way is handed no session dispatcher at all, so it cannot start a Claude session and",
    "cannot spend anything. It is the switch to use to watch a rule fire.",
  ].join("\n"),
];

/** The root help, rows and all. A function because the rows come from the program. */
export function help(): string {
  return renderRootHelp({
    program: buildProgram(),
    prefix: INVOCATION,
    title: "overseer — the fleet's history, and the daemon that records it",
    after: HELP_PROSE_AFTER,
  });
}

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

export function schedulerWiring(env: NodeJS.ProcessEnv, armedAt: Arming): {
  /** True for either arming. Kept because the status page and the start note both ask the yes/no question. */
  armed: boolean;
  arming: SchedulerArming;
  detail: string;
  problems: readonly string[];
  /**
   * **WHETHER EACH LOADED JOB COULD ACTUALLY RUN**, under the capabilities this
   * wiring would hand the daemon.
   *
   * GPT Sol's S8-7. The word this function used to hand its callers came from
   * `jobsEnabled(env)` and nothing else, so `ARMED` was a restatement of an
   * environment variable rather than a claim about the box. This is the fact the
   * activation command exits non-zero on, and the fact the daemon's checkpoint
   * headline is now made of.
   */
  eligibility: readonly JobEligibility[];
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
  // WHAT THIS PROCESS WOULD HOLD, matching the `jobs` fragment below exactly. A
  // second reading of the same decision would be the drift GPT Sol's S8-7 is
  // about, one level in, so both come from `arming`.
  const held = { session: arming === "all", rules: arming !== "off" };
  const eligibility = arming === "off" ? [] : eligibilityOf(arming === "all" ? definitions : rules.jobs, held);
  return {
    armed: arming !== "off",
    arming,
    eligibility,
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
        ? {
            definitions,
            spawn: gjdRemoteDispatch({ repoRoot: root }),
            rules: work(),
            arming: armedAt,
            launchSeparationMs: LAUNCH_SEPARATION_MS,
          }
        : arming === "rules-only"
          ? // NO `spawn` KEY AT ALL. Not `spawn: undefined`, not a spawner that
            // refuses: the capability is absent from the process.
            //
            // The spacing gate is still passed and is still inert here, because
            // it only ever gates session work and this process can start none.
            { definitions: rules.jobs, rules: work(), arming: armedAt, launchSeparationMs: LAUNCH_SEPARATION_MS }
          : undefined,
  };
}

/** Where the dashboard is, for a rule that needs to ask it something. One reading, so the daemon and its rules cannot disagree about the address. */
function fleetUrl(env: NodeJS.ProcessEnv): string {
  return env["OVERSEER_FLEET_URL"] ?? DEFAULT_FLEET_URL;
}

/**
 * A positive finite number, or a refusal Commander turns into a usage error.
 *
 * **The refusal is the whole point of the function.** `Number("nope")` is `NaN`,
 * `Number("")` is `0` and `Number(undefined)` is `NaN` — all of which used to
 * sail through `Number(flag(argv, …) ?? default)` and silently disable the bound
 * they were meant to set (GPT Sol's finding 10 on the earlier hand-rolled
 * parser). A flag that quietly does the opposite of what it says is worse than
 * no flag.
 *
 * `integer` is separate because some of these are COUNTS. `--max-transcripts
 * 0.5` passed the positive check and then `slice(0, 0.5)` selected zero
 * transcripts: a flag that reads as "scan at most half a file" and behaves as
 * "scan nothing". `--since-hours` stays fractional on purpose; half an hour is
 * a sensible window.
 */
export function positiveNumber(name: string, opts: { integer?: boolean } = {}): (raw: string) => number {
  return (raw: string): number => {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value <= 0) {
      throw new InvalidArgumentError(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
    }
    if (opts.integer === true && !Number.isInteger(value)) {
      throw new InvalidArgumentError(`${name} counts whole things, so it must be a whole number, got ${JSON.stringify(raw)}`);
    }
    return value;
  };
}

/**
 * **What the command line MEANT**, separated from doing it.
 *
 * A discriminated union rather than the `argv` array the bodies below used to
 * re-scan for themselves. Two things fall out of that, and the second is why it
 * is worth a type:
 *
 * - **A test can ask what a command line parses to** without a store, a
 *   dashboard or a daemon. There was no such test before, because there was
 *   nothing to ask.
 * - **A flag that is not read cannot be spelled.** `--max-transcipts` used to
 *   be a silent no-op; now it is an unknown option and Commander says so.
 *
 * Absent is absent: the optional fields here are genuinely missing rather than
 * `undefined`, because `exactOptionalPropertyTypes` tells those apart and the
 * daemon's options object depends on the difference.
 */
export type Parsed =
  | { command: "status" }
  | { command: "events"; limit: number }
  | { command: "notes"; limit: number }
  | {
      command: "attention";
      maxCalls: number;
      dry: boolean;
      json: boolean;
      write: boolean;
      out: string | null;
      panes: string | null;
      captureTo: string | null;
    }
  | { command: "usage"; json: boolean; sinceHours?: number; maxTranscripts?: number }
  | { command: "reconcile-jobs"; why: string }
  | { command: "run"; attention: boolean; usage: boolean; url?: string; tickMs?: number }
  | { command: "mine"; action: "list" }
  | { command: "mine"; action: "add" | "rm"; name: string };

/**
 * The grammar, and nothing else — no store is opened and no environment is read
 * while this is built, so `help()` can build one purely to print its rows.
 *
 * Every action does one thing: hand its parsed shape to `sink`. The work is in
 * `runParsed`. Commander is the parser here and not the program.
 */
export function buildProgram(sink: (parsed: Parsed) => void = () => {}): Command {
  const program = new Command();
  program
    .name("overseer")
    // Commander's own help would be a reference page; ours is a briefing with
    // generated rows in it. `help()` is the renderer, and this is what `-h` and
    // an unknown command both print.
    .helpOption(false)
    .addHelpCommand(false)
    .exitOverride();

  program.command("status").description("is the daemon alive, and what does it know").action(() => sink({ command: "status" }));

  program
    .command("events")
    .description("what the fleet did")
    .option("--limit <n>", "how many to print", positiveNumber("--limit", { integer: true }), 40)
    .action((opts: { limit: number }) => sink({ command: "events", limit: opts.limit }));

  program
    .command("notes")
    .description("what the Overseer's own day was like")
    .option("--limit <n>", "how many to print", positiveNumber("--limit", { integer: true }), 40)
    .action((opts: { limit: number }) => sink({ command: "notes", limit: opts.limit }));

  program
    .command("attention")
    .description("read every live pane and say what needs Greg")
    .option("--max-calls <n>", "bound on paid model calls", positiveNumber("--max-calls", { integer: true }), DEFAULT_MAX_CALLS)
    .option("--dry", "no model calls and no paid pass", false)
    .option("--json", "the list as JSON", false)
    .option("--write", "write the store's memory (the daemon holds its lock; you do not)", false)
    .option("--out <file>", "write the list here")
    .option("--panes <dir>", "read captured panes from here instead of tmux")
    .option("--capture-to <dir>", "capture live panes into here first")
    .action((opts: { maxCalls: number; dry: boolean; json: boolean; write: boolean; out?: string; panes?: string; captureTo?: string }) =>
      sink({
        command: "attention",
        maxCalls: opts.maxCalls,
        dry: opts.dry,
        json: opts.json,
        write: opts.write,
        out: opts.out ?? null,
        panes: opts.panes ?? null,
        captureTo: opts.captureTo ?? null,
      }),
    );

  program
    .command("usage")
    .description("how close the shared account is to a limit")
    .option("--since-hours <n>", "how far back to scan", positiveNumber("--since-hours"))
    .option("--max-transcripts <n>", "how many transcripts to read", positiveNumber("--max-transcripts", { integer: true }))
    .option("--json", "the report as JSON", false)
    .action((opts: { sinceHours?: number; maxTranscripts?: number; json: boolean }) =>
      sink({
        command: "usage",
        json: opts.json,
        ...(opts.sinceHours === undefined ? {} : { sinceHours: opts.sinceHours }),
        ...(opts.maxTranscripts === undefined ? {} : { maxTranscripts: opts.maxTranscripts }),
      }),
    );

  program
    .command("reconcile-jobs")
    .description("clear a held occurrence ledger, once, with a reason")
    // MANDATORY, not defaulted. This clears a hold that exists because nobody
    // can tell whether some job already ran, and the reason goes into the store
    // for whoever later asks why a job ran twice.
    .requiredOption("--why <what you checked>", "what you looked at before deciding")
    .action((opts: { why: string }) => sink({ command: "reconcile-jobs", why: opts.why }));

  // THE LIST THE OTHER SUBCOMMANDS READ. One noun, three verbs, and `mine` with
  // no verb lists — the brief asked for `ls-mine` as well, and two spellings for
  // one noun is the drift this CLI exists to remove.
  const mine = program.command("mine").description("the sessions this Overseer is looking after");
  mine.command("list", { isDefault: true }).description("print them").action(() => sink({ command: "mine", action: "list" }));
  mine
    .command("add")
    .argument("<name>", "a session name")
    .description("start looking after one")
    .action((name: string) => sink({ command: "mine", action: "add", name }));
  mine
    .command("rm")
    .argument("<name>", "a session name")
    .description("stop looking after one")
    .action((name: string) => sink({ command: "mine", action: "rm", name }));

  program
    .command("run")
    .description("the daemon")
    .option("--url <url>", "the dashboard to collect from")
    .option("--tick-ms <n>", "how often to collect", positiveNumber("--tick-ms", { integer: true }))
    // `--no-x` is Commander's negation form: the option is `attention`, default
    // true, and `--no-attention` turns it off. Same switch, same spelling, and
    // now the parser rather than an `argv.includes` knows about it.
    .option("--no-attention", "do not run the paid attention pass")
    .option("--no-usage", "do not scan for usage limits")
    .action((opts: { url?: string; tickMs?: number; attention: boolean; usage: boolean }) =>
      sink({
        command: "run",
        attention: opts.attention,
        usage: opts.usage,
        ...(opts.url === undefined ? {} : { url: opts.url }),
        ...(opts.tickMs === undefined ? {} : { tickMs: opts.tickMs }),
      }),
    );

  return program;
}

/**
 * A command line in, one of three answers out.
 *
 * `help` is a request, not a failure, and exits 0; `error` is a refusal and
 * exits 1 with the same prose help underneath it, because a person who typed a
 * flag wrong is exactly the person who needs the rows.
 */
export type ParseOutcome =
  | { kind: "run"; parsed: Parsed }
  | { kind: "help" }
  | { kind: "error"; why: string };

export function parseArgv(argv: readonly string[]): ParseOutcome {
  // NO ARGUMENT MEANS `status`. Kept from the hand-rolled parser: bare
  // `overseer` is the thing the Overseer types most, and Commander's default
  // for an empty line is its own help.
  const words = argv.length === 0 ? ["status"] : [...argv];
  const first = words[0];
  if (first === "--help" || first === "-h" || first === "help") return { kind: "help" };

  let parsed: Parsed | undefined;
  const program = buildProgram((p) => {
    parsed = p;
  });
  // Commander writes to stdout/stderr by default; here every word it produces
  // has to come back as a value, so the caller decides what is an error and
  // what is help.
  //
  // **AND ON EVERY SUBCOMMAND, not only the program.** A subcommand copies its
  // parent's settings *at the moment it is created*, so a `configureOutput`
  // applied afterwards reaches the root and nothing under it — which is how
  // `error: unknown option '--max-transcipts'` went on being printed to the
  // real stderr by a function whose whole job is to return the message instead.
  // Found by a test run's output, not by an assertion, which is why there is now
  // an assertion.
  let written = "";
  const capture = {
    writeOut: (s: string) => {
      written += s;
    },
    writeErr: (s: string) => {
      written += s;
    },
  };
  // RECURSIVE, because `mine add` is two levels down and inherits from `mine`,
  // not from the root.
  const applyCapture = (command: Command): void => {
    command.configureOutput(capture);
    for (const child of command.commands) applyCapture(child);
  };
  applyCapture(program);
  try {
    program.parse(words, { from: "user" });
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return { kind: "error", why: written.trim() === "" ? why : written.trim() };
  }
  if (parsed === undefined) {
    // Commander parsed something and no action fired — an empty subcommand
    // line. Said as a refusal rather than a silent exit 0.
    return { kind: "error", why: `no command in ${JSON.stringify(words.join(" "))}` };
  }
  return { kind: "run", parsed };
}

async function main(argv: readonly string[]): Promise<number> {
  const outcome = parseArgv(argv);
  if (outcome.kind === "help") {
    console.log(help());
    return 0;
  }
  if (outcome.kind === "error") {
    console.error(`✗ ${outcome.why}\n\n${help()}`);
    return 1;
  }
  return await runParsed(outcome.parsed);
}

/**
 * The `mine` list: print it, or change it by one name.
 *
 * **Every arm says what it did or what it refused**, including "it was already
 * there". A no-op that prints nothing is indistinguishable from a write that
 * failed, and this list is the input to `closeout` — a name silently missing
 * from it is a worktree nobody removes.
 */
export function runMine(root: string, parsed: Extract<Parsed, { command: "mine" }>): number {
  if (parsed.action === "list") {
    const read = readCliState(root);
    if (read.kind === "unusable") {
      console.error(`✗ ${read.why} — ${cliStatePath(root)}`);
      return 1;
    }
    const mine = read.kind === "absent" ? [] : read.state.mine;
    // NOT an empty print. "Nothing is mine" and "the file is not there yet" are
    // both legitimate and neither is a blank screen.
    if (mine.length === 0) console.log(`no sessions in ${cliStatePath(root)} — nothing is being looked after`);
    for (const name of mine) console.log(name);
    return 0;
  }

  const why = whyNotASessionName(parsed.name);
  if (why !== null) {
    console.error(`✗ ${why}`);
    return 1;
  }
  const forWriting = cliStateForWriting(root);
  if (!forWriting.ok) {
    console.error(`✗ ${forWriting.why}`);
    return 1;
  }
  const edit = parsed.action === "add" ? addMine(forWriting.state, parsed.name) : removeMine(forWriting.state, parsed.name);
  if (!edit.changed) {
    console.log(parsed.action === "add" ? `${parsed.name} was already on the list` : `${parsed.name} was not on the list`);
    return 0;
  }
  const written = writeCliState(root, edit.state);
  if (!written.ok) {
    console.error(`✗ ${written.why}`);
    return 1;
  }
  console.log(`${parsed.action === "add" ? "added" : "removed"} ${parsed.name} — ${edit.state.mine.length} session(s) now`);
  return 0;
}

async function runParsed(parsed: Parsed): Promise<number> {
  const root = requireAbsoluteRoot(storeRoot());

  switch (parsed.command) {
    case "status":
      console.log(statusLines(root, Date.now(), await readOverseerClaim(fleetUrl(process.env))).join("\n"));
      return 0;
    case "events": {
      const tail = readEventTail(root, parsed.limit);
      // "0 events" and "no store" are not the same sentence, and printing
      // nothing at all would be a third thing that looks like both.
      if (tail.total === 0) console.log(`no events in ${join(root, EVENTS_FILE)}`);
      for (const event of tail.events) console.log(describeEvent(event));
      if (tail.unreadable > 0) console.log(`(${tail.unreadable} unreadable lines)`);
      return 0;
    }
    case "notes": {
      const read = readNotes(root, parsed.limit);
      if (read.notes.length === 0) console.log("the Overseer has written nothing about itself yet");
      for (const note of read.notes) console.log(`${note.at}  ${describeNote(note)}`);
      return 0;
    }
    case "attention":
      return await runAttentionCommand({
        root,
        maxCalls: parsed.maxCalls,
        dry: parsed.dry,
        json: parsed.json,
        // READ-ONLY BY DEFAULT, and `--write` is the opt-in — GPT Sol's second
        // round. The daemon holds the store's lock and this command does not
        // honour it, so a hand run against a live daemon's root was a second
        // writer on `attention.json`: an atomic rename stops a torn file and does
        // nothing about a lost update or a duplicated call. Refusing by default
        // costs a person nothing (the daemon is the producer) and cannot be wrong.
        write: parsed.write,
        out: parsed.out,
        panes: parsed.panes,
        captureTo: parsed.captureTo,
      });
    case "usage": {
      // A command rather than a daemon block for the same reason the header
      // gives for the rest of this file: there is no scheduler here yet, and the
      // honest simplest version of "how close are we to a limit" is something a
      // person or another agent can run and read. It does not touch the store.
      //
      // The nonsense-number arms that used to live here are now `positiveNumber`
      // above, which refuses at parse time — so a bad `--max-transcripts` never
      // reaches this body at all, rather than reaching it as `NaN`.
      const report = await collectUsage({
        ...(parsed.sinceHours === undefined ? {} : { sinceMs: parsed.sinceHours * 3600_000 }),
        ...(parsed.maxTranscripts === undefined ? {} : { maxTranscripts: parsed.maxTranscripts }),
      });
      if (parsed.json) console.log(JSON.stringify(report, null, 2));
      else console.log(usageLines(report).join("\n"));
      return 0;
    }
    case "mine":
      return runMine(root, parsed);
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
      //
      // ABSENT `--why` is Commander's `requiredOption` now; what it cannot
      // refuse is `--why ''`, because an empty string is a value it was given.
      // That check stays here, with its own sentences, because a blank reason is
      // the shape somebody types to get past the flag.
      const why = parsed.why;
      if (why.trim() === "") {
        console.error(
          "✗ reconcile-jobs needs --why \"<what you checked>\", and a blank reason is not one.\n" +
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
      // The attention pass is wired in HERE rather than inside the daemon,
      // because it reads tmux and calls a paid model and daemon.ts does neither.
      // With no key it is absent, and the store then publishes a list that says
      // nothing has looked — which is not the same as an empty one.
      // The epoch is one continuous run of observation, and a restart mints a new
      // one — which is exactly when the persisted WAITS must be dropped, because a
      // first-seen instant cannot span a gap nobody watched. The verdicts survive
      // it; see `memoryForEpoch`.
      const attentionRun = parsed.attention ? attentionRunner(root, `daemon-${randomUUID()}`) : null;
      if (attentionRun === null) {
        console.log(
          parsed.attention
            ? "attention: off — OPENROUTER_API_KEY is not set, so nothing will look at what needs you"
            : "attention: off (--no-attention)",
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
      const usageOff = !parsed.usage;
      if (usageOff) console.log("usage: off (--no-usage)");

      /*
       * THE USAGE HISTORY, composed HERE because this file is the only one
       * allowed to join the two halves: the store and the mapping are
       * `tools/fleet/`'s, the pass that feeds them is `tools/overseer/`'s, and
       * an import either way would breach the seam that
       * `tests/fleet-attention.test.ts` enforces.
       *
       * Why it opens lazily, and why that is the lock argument rather than a
       * convenience, is in `tools/fleet/usage-history-wiring.ts`'s header.
       */
      const usageRetention = makeUsageRetention(root, {
        nextDueMs: USAGE_INTERVAL_MS,
        log: (line) => console.log(line),
      });

      // THE ARMING INSTANT, RECONCILED BEFORE THE DAEMON STARTS.
      //
      // Here rather than inside `daemon.ts` because it is a decision about this
      // process's environment, which is the CLI's knowledge and not the folder's
      // — and because the daemon takes it as a required option, so there is no
      // path on which it is silently defaulted. `reconcileArming` writes the
      // record on the first armed start and leaves it alone on every one after,
      // which is what stops a restarting service postponing its first run for
      // ever (GPT Sol's S8-6).
      const armedAt = reconcileArming({ storeDir: root, armed: jobsEnabled(process.env) || rulesEnabled(process.env), now: () => new Date() });
      const wiring = schedulerWiring(process.env, armedAt);
      // THE ARMING, not a yes/no. "off", "deterministic rules only" and "armed"
      // are three states and the middle one is the whole of SP-4; printing two
      // of them would put a reader back where they started.
      console.log(`scheduler: ${wiring.arming === "all" ? "ARMED" : wiring.arming === "rules-only" ? "RULES ONLY" : "OFF"} — ${wiring.detail}`);
      if (armedAt.kind === "armed") console.log(`scheduler: armed at ${armedAt.at}; a job that has never run is first eligible its own delay after that`);
      else if (wiring.armed) console.error(`✗ scheduler: ${armedAt.why} — every job that has never run is HELD until this is fixed`);
      for (const problem of wiring.problems) console.error(`✗ ${problem}`);
      for (const one of wiring.eligibility) {
        if (one.kind === "ineligible") console.error(`✗ scheduler: ${one.jobId} cannot run — ${one.why}`);
      }
      const outcome = await runOverseer({
        root,
        baseUrl: parsed.url ?? process.env["OVERSEER_FLEET_URL"] ?? DEFAULT_FLEET_URL,
        signal: controller.signal,
        // Absent rather than undefined: `exactOptionalPropertyTypes` tells those
        // apart, and absent is what "take the default" means.
        ...(parsed.tickMs === undefined ? {} : { tickMs: parsed.tickMs }),
        ...(attentionRun === null ? {} : { attention: { run: attentionRun } }),
        ...(usageOff ? {} : { usage: { run: () => collectUsage(), onPass: usageRetention.onPass } }),
        // ABSENT rather than present-and-empty when disarmed: an absent `jobs`
        // is what makes `daemon.ts` build no scheduler timer at all, and it is
        // also what it reads to decide the checkpoint says OFF.
        // Absent rather than present-and-undefined, which
        // `exactOptionalPropertyTypes` makes different things — and here they
        // genuinely are: absent is what stops `daemon.ts` building a timer.
        ...(wiring.jobs === undefined ? {} : { jobs: wiring.jobs }),
        schedulerDetail: wiring.detail,
      });
      /* The history fd, released when the daemon stops. `runOverseer` has
         already awaited any pass in flight by this point — it does that so a
         shutdown cannot leave two writers on the store — so there is no append
         racing this close. */
      usageRetention.close();
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
    default: {
      // EXHAUSTIVE, and the compiler says so. The old `default` arm printed
      // "unknown command", which is now Commander's job at parse time — by the
      // time we are here the command is one of the union's members, and a new
      // member that nobody wired up must not compile.
      const never: never = parsed;
      throw new Error(`unhandled command ${JSON.stringify(never)}`);
    }
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
