/**
 * The Overseer daemon: the source, the clock and the store, wired together.
 *
 * Everything hard was decided in the four modules underneath this one and none
 * of it is repeated here. This file's whole job is the fold:
 *
 *     payload → parseObservation → admissible → diff → append → checkpoint
 *
 * and then the part that is genuinely its own — **saying so when that fold
 * stops happening.** A daemon whose source has gone writes exactly what a
 * daemon watching a quiet box writes: nothing. Telling those two apart is most
 * of why the Overseer exists, so the conditions in notes.ts are not decoration
 * around the fold, they are the other half of it.
 *
 * ## The freshness watchdog, and why the number is large
 *
 * **An alarm that is usually wrong is worse than no alarm**, because it is the
 * same picture as a quiet page over a dead box — GPT Astra's A17, which is
 * about the dashboard's own client calling data stale at 30s while collection
 * waits 60s after a ~12s run. Measured here over six consecutive collections on
 * 2026-09-08: the interval is **65.0s**, and **one interval in six was 130s** —
 * a collection simply missed, no error, no gap in the data. So a missed
 * collection is ORDINARY and any threshold under about 150s fires on a healthy
 * fleet. See `STALE_FLOOR_MS`.
 *
 * ## Invariants
 *
 * **AFTER THE FIRST ACCEPTED SNAPSHOT, THE REGISTER IS THE SNAPSHOT** —
 * whatever this daemon started from: a checkpoint, a rebuilt log, or nothing.
 * The ordinary path gets it from `diff()`; the path with no baseline gets it
 * from `goneWhileAway`, which exists for exactly this and mints nothing but
 * closures. Without it, a session that ended while the daemon was down stays in
 * the register for ever — in no baseline, so absent from every future
 * comparison, and indistinguishable from a live one.
 *
 * **A baseline is only usable beside the register it matches.** Three durable
 * writes in one order — events, then the baseline file, then the checkpoint —
 * so the log is always at or ahead of the baseline file and the baseline file
 * always at or ahead of the checkpoint. Every crash between two of them costs a
 * repeat and never a loss; the ordering, and what is true after each step, is
 * spelled out at the write itself in `take()`. A cold store has no register, so
 * its baseline file is ignored rather than trusted.
 *
 * **Two marks, not one.** `accepted` is the newest snapshot the gate blessed
 * and is what the next payload is ordered against — by run and collection when
 * both are stamped, by clock otherwise; `baseline` is the newest world the
 * differ agreed to stand on. A `held` result moves the first and not the second.
 *
 * ## What it does not do
 *
 * No health history and no local collection: there is one collector on this box
 * and it is the dashboard's. No steering, no killing, no scheduling. It reads,
 * it folds, it writes.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AttentionList, OverseerWork, StoredUsage, UsageReport } from "../fleet/wire.js";
import { chooseUsage } from "./usage-carry.js";
import { admissible, type AdmissibleSnapshot } from "./admissible.js";
import {
  baselineOf,
  diff,
  sessionKey,
  type Baseline,
  type OverseerEvent,
  type SessionIdentity,
  type SessionKey,
} from "./diff.js";
import type { Arming, AuthorisedJob, SpawnJob } from "./jobs.js";
import { conditionTracker, describeNote, NOTES_FILE, openNoteLog, type DaemonNote, type NoteLog } from "./notes.js";
import type { ReportDrainOutcome } from "./reports.js";
import type { ProposingRuleWork } from "./rule-protocol.js";
import { resolveEvidence, type DocumentEvidence, type ReadDocument } from "./schedule-plan.js";
import { schedulePreview, writeSchedulePreview } from "./schedule-preview.js";
import { describeReport, schedulerStandingOf, schedulerTick, type HeldCapabilities, type LostRecord, type RuleRun } from "./scheduler.js";
import {
  parseAttempt,
  parseObservation,
  type JsonValue,
  type ObservedAttemptClock,
  type ObservedRow,
  type SourceOrdering,
} from "./observation.js";
import { fleetSource, type SourceMessage, type SourceOptions, type Transport } from "./source.js";
import { probeProcessTable } from "./work-probe.js";
import { scanPaneWork } from "./work-reading.js";
import type { ProcessTableReading } from "./work.js";
import {
  describeOpening,
  openStore,
  storeRoot,
  type CheckpointUpdate,
  type LockHolder,
  type OverseerStore,
  type SessionRegister,
  type StoredScheduler,
  type StoreRefusal,
} from "./store.js";

/**
 * The last accepted snapshot, kept so a restart does not re-announce the fleet.
 *
 * **This is a cache of somebody else's bytes, not a second source of truth.**
 * The store's checkpoint restores the REGISTER — what is running — but `diff()`
 * needs the previous SNAPSHOT, and a register cannot be turned back into one: it
 * keeps `lastStatusKey` rather than the status, and it has never held `title` or
 * `question`. Rebuilding a snapshot from it would mean inventing the missing
 * fields, which is the same class of mistake as inventing a `collectedAt`.
 *
 * So the payload is stored exactly as the producer sent it and re-blessed
 * through `admissible()` on the way back in — no cast, the same gate as a live
 * payload. If the file is missing or unreadable the daemon starts with no
 * baseline and the next snapshot re-announces every session: noisier, never
 * wrong, and the register still ends up right. That is the store's disposability
 * rule, which has to include half a store as well as none of one.
 */
export const BASELINE_FILE = "last-snapshot.json";

/**
 * **Five minutes, and the floor is the number that matters.**
 *
 * At the measured 65.0s cadence, five minutes tolerates three consecutive
 * missed collections. One in six is missed on an ordinary afternoon, so a
 * threshold of two intervals would fire several times an hour on a fleet with
 * nothing wrong with it, and Greg would learn — correctly — that the alarm
 * means nothing.
 *
 * The cost is stated rather than hidden: **a dead dashboard is reported up to
 * five minutes late.** That is the right side to be wrong on. Being late is
 * recoverable in one ssh command; being ignored is not.
 */
export const STALE_FLOOR_MS = 300_000;

/**
 * The deadline is this many of the producer's own collection intervals.
 *
 * `refreshMs` is a HINT, not the contract — the dashboard advertises 60s and
 * really collects every 65s, because it chains from the *end* of each run. So
 * the multiple has to cover the drift as well as the misses.
 */
export const STALE_MULTIPLE = 5;

/**
 * The largest cadence the hint is allowed to claim: ten minutes.
 *
 * `parseObservation` checks `refreshMs` is a positive integer and nothing more,
 * which is right for a parser — but a producer advertising an hour would buy a
 * five-hour deadline, and a watchdog that never fires reports the same thing as
 * one with nothing to report. Above the ceiling the hint is ignored rather than
 * believed. (The other end needs no clamp: `STALE_FLOOR_MS` already swallows
 * any cadence below a minute.)
 */
export const CADENCE_CEILING_MS = 600_000;

/** The measured cadence, used before any snapshot has told us the producer's own. */
export const MEASURED_CADENCE_MS = 65_000;

export function staleAfterMs(refreshMs: number): number {
  return Math.max(STALE_FLOOR_MS, STALE_MULTIPLE * Math.min(refreshMs, CADENCE_CEILING_MS));
}

export type FreshnessInput = {
  /** The PRODUCER's `collectedAt` from the last accepted snapshot, not when a response arrived. */
  lastGoodAtMs: number | null;
  /** When this daemon started, which is what the deadline runs from before the first collection. */
  startedAtMs: number;
  nowMs: number;
  refreshMs: number;
};

export type Freshness =
  | { fresh: true; ageMs: number; deadlineMs: number }
  | { fresh: false; ageMs: number; deadlineMs: number; why: string };

/**
 * Is the Overseer still being told new things?
 *
 * **The age is measured from the producer's clock, not from the last HTTP
 * response**, and that is the whole point of the watchdog: an SSE connection
 * can stay perfectly healthy, delivering the same cached snapshot every few
 * seconds, while the collector behind it has wedged. Nothing else in this
 * system can see that. Both clocks are the same box's, so the subtraction is
 * exact rather than an estimate.
 */
export function freshness(input: FreshnessInput): Freshness {
  const deadlineMs = staleAfterMs(input.refreshMs);
  const since = input.lastGoodAtMs ?? input.startedAtMs;
  const ageMs = input.nowMs - since;
  if (ageMs <= deadlineMs) return { fresh: true, ageMs, deadlineMs };
  const seconds = Math.round(ageMs / 1000);
  return {
    fresh: false,
    ageMs,
    deadlineMs,
    why:
      input.lastGoodAtMs === null
        ? `the dashboard has never given this Overseer a collection, ${seconds}s after it started (the deadline is ${Math.round(deadlineMs / 1000)}s)`
        : `no new collection for ${seconds}s (the deadline is ${Math.round(deadlineMs / 1000)}s)`,
  };
}

export type CollectorVerdict =
  | { kind: "cannot-tell"; why: string }
  | { kind: "collecting"; sinceAttemptMs: number }
  | { kind: "stopped"; sinceAttemptMs: number; why: string };

/**
 * The newest READING of the attempt clock, which is not the newest TIMESTAMP.
 *
 * MAKING A TYPE HONEST DOES NOTHING IF THE CONSUMER FLATTENS IT BACK. The whole
 * point of `ObservedAttemptClock`'s third arm is that "this payload cannot say"
 * is a different answer from "it has not attempted" — and the daemon used to
 * keep only `lastAttemptAtMs: number | null`, moved on a positive reading and
 * untouched by any other. So a producer that STOPPED reporting the field — a
 * dashboard rolled back to a build from before it existed, or one that started
 * emitting a malformed value — left the last good timestamp standing as current
 * evidence, and five minutes later the watchdog measured its age and called a
 * healthy collector stopped. A reading that could not be taken was being
 * answered with an older reading that could: this codebase's recurring shape,
 * one layer above where `parseAttempt` had just fixed it.
 *
 * So the daemon holds the reading, and this is the fold that keeps the newest
 * one. `null` means no payload has said anything yet.
 *
 * THE ONLY THING THAT SURVIVES A NEWER READING IS AN OLDER POSITIVE ONE WITH A
 * LATER INSTANT, which is the out-of-order guard the `Math.max` used to be: a
 * reconnect can replay a payload the daemon has already seen, and the collector
 * has not gone backwards in time because the transport did.
 */
export function latestAttempt(held: ObservedAttemptClock | null, next: ObservedAttemptClock): ObservedAttemptClock {
  if (held === null) return next;
  if (!held.reported || !held.attempted) return next;
  if (next.reported && next.attempted && next.atMs < held.atMs) return held;
  return next;
}

/**
 * Is the dashboard's collector still trying?
 *
 * **A third condition, not a split of the other two**, and the case it names was
 * invisible until 2026-09-08. Measured that day: `/api/state` served a
 * `collectedAt` thirty minutes stale with `error: null`, because `collect()`'s
 * child took SIGTERM while in uninterruptible IO on a swapping box and
 * `execFile` waited for a process that was never coming back. The refresh loop
 * chains from the END of each run, so it never reached its next iteration.
 * Nothing threw. **The thing that would have reported the failure was the thing
 * that had stopped** — which is this area's recurring shape.
 *
 * So the two clocks separate three states that one clock could not:
 *
 *  - attempts advancing, collections stale → the source is FAILING, and will
 *    either recover or say why. `snapshots` and `freshness` cover it.
 *  - both stale → the collector has STOPPED. Nothing will recover it and
 *    nothing else will report it. This condition, and only this one.
 *  - no attempt reported → say nothing at all.
 *
 * **Silence about the collector when nothing is arriving is deliberate.** If the
 * transport is down we are looking at a frozen copy of the last payload, and
 * calling its collector wedged on that evidence would be three names for one
 * outage — `sse-stream`, `poll` and `freshness` already say it.
 *
 * The deadline is the same `staleAfterMs` the freshness watchdog uses, because
 * attempts and collections run on the same cadence: one measured number, not
 * two guessed ones.
 */
export function collectorVerdict(input: {
  /**
   * The LATEST reading, not the latest positive one — see `latestAttempt`. A
   * `number | null` here is what let a stale timestamp answer a question the
   * current payload had already declined to answer.
   */
  attempt: ObservedAttemptClock | null;
  /** When the last payload of any kind arrived, by OUR clock. */
  lastPayloadAtMs: number | null;
  nowMs: number;
  refreshMs: number;
}): CollectorVerdict {
  const deadlineMs = staleAfterMs(input.refreshMs);
  if (input.lastPayloadAtMs === null || input.nowMs - input.lastPayloadAtMs > deadlineMs) {
    return { kind: "cannot-tell", why: "nothing has arrived from the dashboard recently, so its collector cannot be asked about" };
  }
  const attempt = input.attempt;
  if (attempt === null) {
    return { kind: "cannot-tell", why: "no payload has carried an attemptedAt, so this producer cannot say" };
  }
  if (!attempt.reported) {
    // GOING BLIND IS NOT THE SAME AS GOING QUIET, and the temptation runs both
    // ways. Reporting `stopped` here would be the original bug mirrored — an
    // alarm about a collector we simply cannot see. Reporting `collecting`
    // would be worse: a restoration that clears a real alarm the moment the
    // producer's clock became unreadable. `cannot-tell` is neither, so an open
    // condition stays open and a closed one stays closed until a reading
    // arrives that can actually answer.
    return { kind: "cannot-tell", why: `the latest payload cannot say whether its collector is trying: ${attempt.why}` };
  }
  if (!attempt.attempted) {
    // The producer answered, and its answer is that it has never STARTED a
    // collection. That is not a wedged collector — the freshness watchdog is
    // what reports a dashboard that has never given us one, and a second alarm
    // here would be two names for the same outage.
    return { kind: "cannot-tell", why: "the dashboard reports that it has never started a collection" };
  }
  const sinceAttemptMs = input.nowMs - attempt.atMs;
  if (sinceAttemptMs <= deadlineMs) return { kind: "collecting", sinceAttemptMs };
  return {
    kind: "stopped",
    sinceAttemptMs,
    why:
      `the dashboard is answering and has not started a collection for ${Math.round(sinceAttemptMs / 1000)}s ` +
      `(the deadline is ${Math.round(deadlineMs / 1000)}s), so its collector has stopped rather than failed`,
  };
}

/**
 * What happened on one usage pass, told to `DaemonOptions.usage.onPass`.
 *
 * `take-fresh` and `keep-stored` are `chooseUsage`'s own two arms, and **both
 * carry the report the pass produced** — on `keep-stored` that is the report
 * that was DISCARDED, which is the only copy of that pass's cache observation
 * anywhere. `collector-failed` is a pass that threw, and has no report at all.
 *
 * `at` is when the pass started, so a consumer can tell the observation's own
 * instant (`report.collectedAt`) from when the daemon noticed it.
 */
export type UsagePassOutcome =
  | { kind: "take-fresh"; report: UsageReport; why: string; at: string }
  | { kind: "keep-stored"; report: UsageReport; why: string; at: string }
  | { kind: "collector-failed"; why: string; at: string };

export type DaemonOptions = {
  /** Defaults to `~/.overseer`, or `OVERSEER_STORE_DIR`. Tests always pass one. */
  root?: string;
  /** The dashboard's origin. */
  baseUrl: string;
  signal: AbortSignal;
  now?: () => Date;
  /** Where the daemon's own commentary goes. `console.log` by default — this is a CLI, not a request path. */
  log?: (line: string) => void;
  /** How often to checkpoint and re-ask the watchdog. */
  tickMs?: number;
  pollIntervalMs?: number;
  streamRetryAfterMs?: number;
  /** Injected by tests so the fold can be driven without sockets. */
  source?: (options: SourceOptions) => AsyncIterable<SourceMessage>;
  /**
   * WHAT NEEDS GREG, and the reason it is injected rather than built here.
   *
   * The pass reads tmux panes and calls a model, and this file does neither: it
   * consumes the dashboard's stream, folds events, and writes. Building the pass
   * inline would put `execFileSync` and a paid HTTP call inside the loop whose
   * whole job is to keep running when other things are broken. So
   * `scripts/overseer.ts` supplies it, and a daemon given none simply publishes
   * `attentionNotYetRun` — which says so, rather than an empty list, which would
   * claim nothing needs him.
   */
  attention?: { intervalMs?: number; run: () => Promise<AttentionList> };
  /**
   * Read the process table. Injected so the fold can be driven without a box;
   * defaults to the real `probeProcessTable`.
   *
   * Unlike the attention and usage passes, this is cheap (~40 ms measured) and
   * synchronous, so it runs inline on the inventory path rather than owning a
   * timer and a second freshness policy.
   */
  probe?: () => ProcessTableReading;
  /**
   * HOW CLOSE THIS ACCOUNT IS TO A LIMIT, injected for the same reason
   * `attention` is: the pass reads ~2.9 GB of transcripts and shells out to
   * `claude auth status`, and this file does neither.
   *
   * The difference from `attention` is that the runner returns a fresh
   * `UsageReport` and does NOT decide whether it should be published — that is
   * `chooseUsage`, applied here, because it needs the store's held report as well
   * as the fresh one. A daemon given no runner publishes `usageNotYetRun`.
   */
  usage?: {
    intervalMs?: number;
    run: () => Promise<UsageReport>;
    /**
     * **Told once per PASS, whatever happened — for a history nobody else can
     * write.**
     *
     * `~/.overseer/current.json` keeps only the latest reading, and the cache it
     * comes from is a point-in-time hint that gets overwritten, so usage history
     * cannot be reconstructed after the fact. Something has to record each pass
     * as it happens, and only this file knows when one happened.
     *
     * **`keep-stored` carries the DISCARDED report, and that is the point.**
     * `chooseUsage` declining to publish an incomplete scan says nothing about
     * that pass's *cache* reading, which is independent of the transcript scan.
     * The fresh report is the only place that observation exists — the
     * checkpoint carries the held one, and the dashboard never sees this. A
     * consumer that treated `keep-stored` as "no reading was taken" would drop
     * real, attributed observations off a chart every time one transcript was
     * unreadable.
     *
     * **This file imports nothing to serve it**, deliberately: the callback is
     * composed in `scripts/overseer.ts`, which already straddles the
     * `tools/overseer` ↔ `tools/fleet` seam. Putting the projection or the store
     * in here would drag the dashboard's modules into the process you reach for
     * when everything else is broken.
     *
     * Errors thrown by the callback are **contained and logged** — see
     * `safeOnPass` below. A retention failure is not a usage failure.
     */
    onPass?: (outcome: UsagePassOutcome) => void;
  };
  /**
   * THE SCHEDULED JOBS, and the schedule as data.
   *
   * Injected like the two passes above and for the same reason: dispatching a
   * job means creating a process, and this file's whole job is to keep folding
   * when other things are broken. What it supplies is the clock and the store;
   * `scheduler.ts` supplies the ordering; the caller supplies what a job
   * actually does.
   *
   * **This path does NOT use the `attentionRunning` idiom two fields up.** That
   * guard is an in-memory promise, and a job whose work never settles would
   * leave it non-null for ever — every later tick correctly declining to
   * overlap, the heartbeat green, and the job silently never running again (GPT
   * Sol's S6). Scheduled jobs are guarded by a durable lease instead, and an
   * overdue one is reported rather than skipped. The attention and usage guards
   * are deliberately left exactly as they were: they belong to another stage.
   */
  jobs?: {
    intervalMs?: number;
    definitions: readonly AuthorisedJob[];
    /**
     * **ABSENT IS THE DETERMINISTIC-ONLY ARMING.** A daemon given no spawner
     * holds no capability to start a Claude session, so a session job meets a
     * refusal rather than a dispatch — GPT Sol's SP-4, and `scheduler.ts`
     * § `TickInput.spawn` says why that is a capability rather than a filter.
     */
    spawn?: SpawnJob;
    /**
     * **LOOKING, and only looking, for a deterministic rule.** Absent means a
     * rule job is refused, the same way and for the same reason a session job
     * is refused with no spawner.
     *
     * There is deliberately no option here for an ACTOR. `scheduler.ts` takes
     * one (`TickInput.acting`) and this file does not pass one, so no daemon
     * this codebase can build holds the capability to act on a proposal — GPT
     * Sol's SC-2. Stage 3d adds the option, together with the durable rule-run
     * index that acting needs.
     */
    rules?: ProposingRuleWork;
    /**
     * **WHEN THIS SCHEDULER WAS ARMED**, from `arming.ts`. The anchor a
     * never-run job's first eligibility is measured from (GPT Sol's S8-6).
     *
     * Required rather than defaulted, for the reason `TickInput.arming` gives:
     * a default here would be this file quietly deciding the one thing the field
     * exists to stop anybody deciding by accident.
     */
    arming: Arming;
    /** The minimum gap between two session launches. `schedules.ts` § `LAUNCH_SEPARATION_MS`, and GPT Sol's S8-5. */
    launchSeparationMs: number;
    /**
     * **HOW A SESSION JOB'S DOCUMENTS ARE READ — every tick, and every
     * checkpoint.** `scheduler.ts` § `TickInput.readDocument` says why the tick
     * reads; the checkpoint reads for Sol's P1-1 on plan 260910e, so the `ARMED`
     * headline is made of the same evidence that refuses a job and cannot go on
     * claiming a job the tick has stopped dispatching.
     *
     * Required for the reason `arming` is: a default would be this file deciding
     * that a digest taken days ago is good enough.
     */
    readDocument: ReadDocument;
    /**
     * How long a shutdown waits for rule runs still in flight, before giving up
     * on them **loudly**. Defaults to `RULE_SETTLE_GRACE_MS`.
     *
     * A bound rather than an unconditional await: a hung observer must not turn
     * into a daemon that cannot be restarted, which is a worse failure than the
     * lost settlement this wait exists to prevent.
     */
    settleGraceMs?: number;
  };
  /**
   * WHAT TO SAY ABOUT THE SCHEDULER on the status page — the job ids, and any
   * whose definition no longer matches its pin.
   *
   * **Whether it is ARMED is decided by whether `jobs` above was supplied, not
   * by this string**, so the two cannot disagree; this only carries the detail,
   * which is the caller's knowledge (it read the environment and built the
   * definitions, and this file did neither).
   *
   * It exists because a scheduler that is OFF must not look like a scheduler
   * with nothing to do. Both produce an empty occurrence list and a green
   * heartbeat, and until GPT Sol's C1 nothing anywhere could tell them apart.
   */
  schedulerDetail?: string;
  /**
   * **THE LIST THE SCHEDULER WOULD RUN, FOR THE SCHEDULE PREVIEW — and nothing
   * this daemon can dispatch from.** Plan 260910e § D6.
   *
   * Separate from `jobs` because `jobs` is absent whenever the scheduler is off,
   * and off is exactly when a person most needs to see what arming would do.
   * It carries the definitions, how to read their documents, and facts about
   * this process — never a spawner or a rule runner, so no code path from here
   * can start anything. On every checkpoint tick the daemon plans these with
   * the shared planner against its in-memory ledger and writes
   * `schedule.json` (`schedule-preview.ts`).
   *
   * **Absent means this daemon was given no job list**, and the file it writes
   * says exactly that — not no file, which is what a daemon predating this
   * build leaves, and a reader tells the two apart.
   */
  preview?: {
    /** The full list — standing jobs and rules — whatever the arming. */
    definitions: readonly AuthorisedJob[];
    /** Read every session job's documents afresh each checkpoint, as the tick does. */
    readDocument: ReadDocument;
    /** What this process holds, matching `jobs`: a disarmed daemon holds neither. */
    capabilities: HeldCapabilities;
    /** `schedule-preview.ts` § `listRevision` of `definitions`, so a reader can compare its checkout's. */
    listRevision: string;
    /** The arming `jobs` would carry — `unknown` on a disarmed daemon, which the preview renders as "after it is armed". */
    arming: Arming;
    /** The launch spacing an armed scheduler would apply, so the preview's spacing verdicts are the real ones. */
    launchSeparationMs: number;
  };
  /**
   * WORK REPORTS, drained into `reports.jsonl` on their own timer. Plan 260910e.
   *
   * Injected, like the passes above, because the drain shells out to git and
   * this file does not. It is handed `store.register` — the live one — so its
   * execution comparison is against what this daemon verified, which is the
   * whole reason the daemon rather than the CLI is the writer. It is synchronous
   * and relies on this process holding `overseer.lock` for its exclusion, so
   * there is nothing to await on the way out.
   */
  reports?: { intervalMs?: number; drain: (register: SessionRegister) => ReportDrainOutcome };
};

/**
 * How often the attention pass runs: two minutes, against a 30s tick.
 *
 * Not every tick, and the reason is Astra's A30 — *thirty-six sessions must not
 * trigger thirty-six model reviews a minute*. What actually holds that is the
 * fingerprint cache, which makes an unchanged tail free; this interval is the
 * second bound. Measured on this box on 2026-09-08: over 4.5 minutes on a
 * 30-session fleet, **zero** ended-turn tails changed, because a tail is static
 * by definition until its session moves and a session that moved reads as
 * mid-turn and costs nothing. A cold pass over 32 sessions was 11 calls and
 * $0.0039; the passes after it were 0 calls.
 */
export const ATTENTION_INTERVAL_MS = 120_000;

/**
 * How often the usage scan runs: five minutes, against a 30s tick.
 *
 * MUCH rarer than the attention pass, and for a different reason. Attention is
 * bounded by a fingerprint cache that makes an unchanged tail free; a usage scan
 * has no such escape — it reads every transcript every time, measured at **30-45s
 * over 1,772 files, 2.9 GB and ~875,000 lines** on 2026-09-08, with a 1.5x spread
 * between two runs an hour apart purely from ambient load.
 *
 * Five minutes makes that about a tenth of one core, continuously. It is a floor
 * rather than a target: the thing a shorter interval would buy is noticing a rate
 * limit sooner, and a rate limit that has just been hit does not clear for hours.
 */
export const USAGE_INTERVAL_MS = 300_000;

/**
 * How often the scheduler looks: every tick's worth, 30 seconds.
 *
 * **It is deliberately the cheapest of the three timers**, and it can be,
 * because a tick that finds nothing due reads a map the store already holds,
 * compares two numbers — and, since 2026-09-10, digests each session job's
 * documents, which is three small files (plan 260910e § D3: a digest taken at
 * start and reused for days authorised whatever the document said by the time
 * it was followed). The interval is therefore the granularity of the schedule
 * rather than a cost, and the shortest job anyone has asked for is five minutes.
 *
 * It is a SEPARATE timer from the heartbeat rather than a line inside it,
 * because a spawn is a syscall and `lastTickAt` is how a reader tells a dead
 * Overseer from a quiet one. Astra's A17, the same argument the usage scan makes.
 */
export const JOBS_INTERVAL_MS = 30_000;

/** How often the report inbox is drained: 30 s, which is the "within about 30 s" `overseer report` promises. */
export const REPORTS_INTERVAL_MS = 30_000;

/**
 * **Fifteen seconds.** How long a shutdown waits for rule runs still in flight.
 *
 * Sized off the thing being waited for: a rule is one HTTP call to the dashboard
 * with a ten-second timeout of its own (`rule-work.ts` § OBSERVE_TIMEOUT_MS) and
 * some arithmetic, so anything past that is not going to answer. It is
 * deliberately far short of the two-minute rule lease — the lease is how long a
 * run may be UNSETTLED before another may start, and this is how long a stop may
 * be DELAYED, which are different questions with different costs.
 *
 * There is a bound at all because `Restart=always` means the box gets its
 * Overseer back only when the old one lets go. A hung observer must cost a
 * written-down abandoned run, never a daemon that will not die.
 */
export const RULE_SETTLE_GRACE_MS = 15_000;

export type DaemonOutcome =
  | { kind: "refused"; refusal: StoreRefusal }
  | { kind: "stopped"; why: string }
  /** Another daemon took the lock while this one held it. Stop, loudly — do not keep writing. */
  | { kind: "lock-lost"; holder: LockHolder | null };

/** 30s: cheap (one small atomic write) and often enough that a reader can tell a dead daemon from a quiet one. */
export const TICK_MS = 30_000;

export async function runOverseer(options: DaemonOptions): Promise<DaemonOutcome> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((line: string) => console.log(line));
  const root = options.root ?? storeRoot();
  const tickMs = options.tickMs ?? TICK_MS;
  const probe = options.probe ?? probeProcessTable;

  const opened = openStore({ root, now });
  if (!opened.ok) return { kind: "refused", refusal: opened.refusal };
  const store = opened.store;

  let notes: NoteLog;
  try {
    notes = openNoteLog(root);
  } catch (cause) {
    store.close();
    return {
      kind: "refused",
      refusal: {
        reason: "unusable-log",
        path: join(root, NOTES_FILE),
        detail: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }
  const conditions = conditionTracker(store.instanceId);
  const write = (note: DaemonNote | null): void => {
    if (note === null) return;
    notes.append(note);
    log(`${note.at} ${describeNote(note)}`);
  };

  // TWO MARKS, NOT ONE, and the pair is the whole of the crash-recovery
  // design. `accepted` is the last snapshot `admissible()` blessed, and it is
  // what the next payload is ordered against — its run and collection when
  // both are stamped, its clock when either is not. `baseline` is the last
  // world `diff()` agreed to stand on. They come apart on a `held` result: the
  // snapshot was perfectly admissible, so the accepted mark must move on, and
  // it could not be placed in a world, so the baseline must not.
  //
  // A BASELINE IS ONLY USABLE BESIDE THE REGISTER IT MATCHES, and a cold store
  // has no register at all. The store starts cold when the log is gone, or when
  // it refuses to replay one — and diffing against a stored baseline then
  // records only the DELTAS, so the register would end up holding whichever two
  // sessions happened to change and none of the others, indefinitely. That is
  // the mirror image of the bug `goneWhileAway` fixes, and it arrives through
  // the same door: half a store. Cold means start over, and say so.
  const restored = store.opening.start.kind === "cold" ? coldRestore(root) : restoreBaseline(root);

  // WHY THE STORED BASELINE GOES BACK THROUGH `baselineOf()` AND ITS EVENTS ARE
  // NOT REPLAYED.
  //
  // `Baseline` is mintable only inside diff.ts, on purpose: omitting `baseline`
  // from a `held` result is what stops a caller advancing past a snapshot the
  // differ refused. `baselineOf` is the one door back in, and it asks what the
  // snapshot IS rather than where it came from — so a snapshot `diff()` would
  // hold is refused here too, with the sentence saying why.
  //
  // **The events that snapshot would have produced are deliberately not
  // re-derived**, and the reason is not that they are noise: the checkpoint is
  // written AFTER the baseline file and the events before both, so the register
  // restored at open already contains the fold of this very snapshot.
  // Re-recording it would reset every `statusSince` — destroying the durations
  // attention triage ranks by — in order to say what the register already says.
  //
  // When it refuses, the daemon keeps NO baseline and waits for a collection it
  // can place, rather than closing anything out on the strength of one it
  // cannot. The refusal's `reason` goes into the start note, because "started
  // without a baseline because the stored one could not be placed in a world"
  // and "started without one because there was no file" are different facts.
  const seeded = restored.accepted === null ? null : baselineOf(restored.accepted);
  let accepted: AdmissibleSnapshot | null = restored.accepted;
  // THE DASHBOARD RUNS SEEN REPLACED, which is what lets `admissible()` refuse
  // a late payload from a previous run rather than accept it as an unseen one.
  // A run is retired when an accepted stamped snapshot's run differs from the
  // previous accepted one's — here, in `take()`, beside the line that moves
  // `accepted`.
  //
  // BOUNDED, because a daemon runs for weeks and the dashboard restarts several
  // times a day: the last 16 runs, oldest let go first. A payload from a run
  // older than that would be accepted as a new run — the cost of the bound, and
  // a payload sixteen restarts late is not one the sequential source delivers.
  //
  // NOT PERSISTED, and it starts empty after a daemon restart. That is safe not
  // because the old dashboard is gone — restarting the Overseer does not stop
  // it — but because the source is sequential (stream and poll never overlap,
  // source.ts) and the restored `accepted` carries its run: the first payload
  // from a new run B retires the stored run A, and anything from A after that
  // is refused. docs/plans/260910d § The daemon, and Sol's finding 4.
  const RETIRED_RUNS_KEPT = 16;
  const retired = new Set<string>();
  // What the last payload that parsed said about its stamp, so the console
  // says when the dashboard stops (or starts) stamping — once per transition,
  // not once per payload.
  let lastOrdering: SourceOrdering["kind"] | null = null;
  let baseline: Baseline | null = seeded !== null && seeded.ok ? seeded.baseline : null;
  let lastGoodSnapshotAt: string | null = restored.accepted?.snapshot.clock.at ?? null;
  let refreshMs = restored.accepted?.snapshot.refreshMs ?? MEASURED_CADENCE_MS;
  const baselineNote =
    seeded !== null && !seeded.ok ? `${restored.why}, but it cannot be a baseline: ${seeded.reason}` : restored.why;
  const startedAtMs = now().getTime();

  write({
    kind: "daemon-started",
    at: now().toISOString(),
    instanceId: store.instanceId,
    pid: process.pid,
    source: options.baseUrl,
    opening: describeOpening(store.opening),
    baseline: baselineNote,
  });

  // READ AND WRITTEN THROUGH FUNCTIONS, which is not ceremony: it is only ever
  // assigned inside a closure, and TypeScript's flow analysis cannot see that —
  // it would narrow every later read to `null` and then to `never`. Going
  // through `halted()` makes the declared type the one the compiler uses.
  let stopped: DaemonOutcome | null = null;
  const halted = (): DaemonOutcome | null => stopped;

  /**
   * A write that failed because somebody else holds the lock is not something
   * to retry: it means two daemons, and the loser stops rather than interleaves
   * its events with the winner's.
   */
  const guard = (result: { ok: true } | { ok: false; reason: "lock-lost"; holder: LockHolder | null }): boolean => {
    if (result.ok) return true;
    stopped = { kind: "lock-lost", holder: result.holder };
    return false;
  };

  // What the producer has told us about its own collector, from every payload
  // — accepted, duplicate or rejected alike. A wedged collector serves the same
  // cached body for ever, so DUPLICATES are where this is learned.
  let attemptReading: ObservedAttemptClock | null = null;
  let lastPayloadAtMs: number | null = null;

  const checkFreshness = (): void => {
    const at = now();
    const nowMs = at.getTime();
    const verdict = freshness({ lastGoodAtMs: lastGoodSnapshotAt === null ? null : Date.parse(lastGoodSnapshotAt), startedAtMs, nowMs, refreshMs });
    if (verdict.fresh) {
      write(conditions.restore("freshness", at.toISOString(), `a collection arrived ${Math.round(verdict.ageMs / 1000)}s ago`));
    } else {
      write(conditions.degrade("freshness", at.toISOString(), verdict.why));
    }

    const collector = collectorVerdict({ attempt: attemptReading, lastPayloadAtMs, nowMs, refreshMs });
    switch (collector.kind) {
      case "stopped":
        write(conditions.degrade("collector", at.toISOString(), collector.why));
        break;
      case "collecting":
        write(conditions.restore("collector", at.toISOString(), `the dashboard started a collection ${Math.round(collector.sinceAttemptMs / 1000)}s ago`));
        break;
      case "cannot-tell":
        // NEITHER DEGRADE NOR RESTORE. "I could not tell" is not evidence that
        // things are fine, and turning it into a restoration would clear a real
        // alarm the moment the transport went down.
        break;
      default: {
        const never: never = collector;
        throw new Error(String(never));
      }
    }
  };

  // The heartbeat, and the only thing that runs when the source has gone
  // silent: `writtenAt` moving while `lastGoodSnapshotAt` stands still is
  // exactly how a reader tells "the Overseer is deaf" from "the Overseer is
  // dead". Unref'd so it can never be the reason a process will not exit.
  // The attention list the next checkpoint will carry, or null when no pass has
  // finished yet — in which case the store publishes `attentionNotYetRun`, which
  // says nothing has looked rather than that nothing needs him.
  let attention: AttentionList | null = null;
  // One instant's process-tree measurement for the next checkpoint, or null
  // before any inventory has reached the path that will actually write one.
  let work: OverseerWork | null = null;
  // The usage report the next checkpoint will carry, or null when no pass has
  // decided to replace what the store holds — which is BOTH "no pass has run"
  // and "a pass ran and `chooseUsage` kept the stored one". Absent means the same
  // thing in each case: leave the store's own report alone.
  let usage: StoredUsage | null = null;
  // RECOMPUTED ON EVERY CHECKPOINT, from the documents as they are now. `armed`
  // is read off the option rather than off a flag beside it, so "armed" and
  // "there are jobs" cannot come apart.
  //
  // **AND `armed` IS A CLAIM ABOUT THE LOADED DEFINITIONS, not about a switch**
  // (GPT Sol's S8-7). It used to be `jobs === undefined ? "off" : "armed"`,
  // which made the headline on the status page a restatement of an environment
  // variable: a daemon whose jobs were all unauthorised, or all absent because a
  // document could not be read, still said `ARMED`. Now the switch being on with
  // nothing runnable is `blocked`, which is its own word because it is its own
  // situation — not off, and not working.
  //
  // **It was built ONCE, at start, until 2026-09-10** — Sol's P1-1 on plan
  // 260910e. Once the tick began re-reading documents, a document edited after
  // start would have the tick refusing its job while every checkpoint went on
  // saying ARMED. So it is made of the same fresh reading the tick uses, and
  // `at` is when this checkpoint decided it.
  const schedulerStandingNow = (evidence?: DocumentEvidence): StoredScheduler =>
    schedulerStandingOf({
      jobs:
        options.jobs === undefined
          ? undefined
          : {
              definitions: options.jobs.definitions,
              held: { session: options.jobs.spawn !== undefined, rules: options.jobs.rules !== undefined },
              evidence: evidence ?? resolveEvidence(options.jobs.definitions, options.jobs.readDocument),
            },
      detail: options.schedulerDetail,
      at: now().toISOString(),
    });
  // THE HEADLINE CAN BE HANDED IN, so the checkpoint and the schedule preview
  // written on the same tick carry the same one rather than two readings a
  // moment apart. Defaulted, because the checkpoint written from `take()` has
  // no preview beside it to agree with.
  const checkpointUpdate = (scheduler: StoredScheduler = schedulerStandingNow()): CheckpointUpdate => ({
    lastGoodSnapshotAt,
    tick: true,
    scheduler,
    // THE DEADLINE, NOT THE CADENCE, and written on every tick because
    // `refreshMs` moves when a producer says so. `overseer-watchdog.ts` reads
    // this instead of computing its own: sharing `staleAfterMs` stopped the
    // formula drifting and did nothing about the INPUT drifting, which is GPT
    // Sol's C6 — the daemon was using 300,000ms and the watchdog 325,000ms
    // under the documented normal values.
    snapshotStaleAfterMs: staleAfterMs(refreshMs),
    // Spread rather than assigned: `exactOptionalPropertyTypes` makes "absent"
    // and "present and undefined" different things, and here absent means *keep
    // the list the store already holds*.
    ...(attention === null ? {} : { attention }),
    ...(work === null ? {} : { work }),
    ...(usage === null ? {} : { usage }),
  });

  /*
   * THE SCHEDULE PREVIEW, written after every checkpoint the ticker lands —
   * plan 260910e § D6.
   *
   * Computed from what THIS process holds: its loaded definitions, the
   * documents as they are now, its in-memory ledger (`store.occurrences`, which
   * is ahead of the checkpoint's copy), its arming and its capabilities — the
   * reason the daemon writes it rather than a reader computing it (Sol's P1-4).
   * It plans; it never launches. The preview's `launch` answers without
   * starting anything, and no spawner is in reach of this code.
   *
   * **A failure here never stops the daemon, and is said once.** A preview that
   * cannot be written is a missing convenience, not a fault in the thing the
   * daemon is for; logging it every 30 seconds would be the alarm fatigue this
   * area refuses everywhere else. So: one line when it starts failing, one when
   * it recovers, and the reason carried between them.
   */
  const previewOptions = options.preview;
  let previewFailing: string | null = null;
  const recordPreviewResult = (written: { ok: true } | { ok: false; why: string }): void => {
    if (!written.ok) {
      if (previewFailing === null) log(`schedule preview: NOT WRITTEN — ${written.why}. The daemon carries on; this is said once, and again when it recovers`);
      previewFailing = written.why;
      return;
    }
    if (previewFailing !== null) {
      log(`schedule preview: written again (it had been failing: ${previewFailing})`);
      previewFailing = null;
    }
  };
  const writePreview = (headline: StoredScheduler, evidence: DocumentEvidence | null): void => {
    let written: { ok: true } | { ok: false; why: string };
    try {
      // WHEN ARMED, THESE ARE THE LIVE TICKER'S FACTS. The copies on `preview`
      // exist for the disarmed case; allowing them to overrule `jobs` would let
      // one process publish a different arming, capability set or spacing from
      // the scheduler it actually runs.
      const capabilities: HeldCapabilities =
        options.jobs === undefined
          ? (previewOptions?.capabilities ?? { session: false, rules: false })
          : { session: options.jobs.spawn !== undefined, rules: options.jobs.rules !== undefined };
      const list: Parameters<typeof schedulePreview>[0]["list"] =
        previewOptions === undefined
          ? { kind: "not-given", why: "the process that started this daemon handed it no job list to preview" }
          : evidence === null
            ? (() => {
                throw new Error("no document evidence was resolved for this checkpoint's preview");
              })()
            : {
                kind: "given",
                definitions: previewOptions.definitions,
                listRevision: previewOptions.listRevision,
                evidence,
              };
      written = writeSchedulePreview(
        root,
        schedulePreview({
          instanceId: store.instanceId,
          now: now(),
          list,
          occurrences: store.occurrences,
          history: store.occurrenceHistory,
          arming: options.jobs?.arming ?? previewOptions?.arming ?? { kind: "unknown", why: "this daemon was given no job list, so no arming instant either" },
          launchSeparationMs: options.jobs?.launchSeparationMs ?? previewOptions?.launchSeparationMs ?? 0,
          capabilities,
          headline,
        }),
      );
    } catch (cause) {
      written = { ok: false, why: `the preview could not be computed (${cause instanceof Error ? cause.message : String(cause)})` };
    }
    recordPreviewResult(written);
  };

  const ticker = setInterval(() => {
    if (halted() !== null) return;
    checkFreshness();
    // ONE DOCUMENT READING, THEN ONE HEADLINE FOR BOTH FILES written this tick.
    // Re-reading between them lets a file edit in that tiny window produce an
    // ARMED headline over an unauthorised row (or the reverse).
    let evidence: DocumentEvidence | null;
    try {
      // OVER BOTH LISTS. The headline is judged over `jobs.definitions` and the
      // preview over its own; a session job in the first and not the second
      // would have had no reading, and `authorisationUnder` fails closed on
      // that — a BLOCKED headline over a tick that dispatches. The shipped
      // wiring makes one a subset of the other; this does not rely on it.
      // `resolveEvidence` reads each distinct loaded definition once; duplicate
      // ids with different documents need separate evidence for their rows.
      evidence =
        previewOptions === undefined
          ? null
          : resolveEvidence(
              [...(options.jobs?.definitions ?? []), ...previewOptions.definitions],
              options.jobs?.readDocument ?? previewOptions.readDocument,
            );
    } catch (cause) {
      const why = `the preview's document evidence could not be resolved (${cause instanceof Error ? cause.message : String(cause)})`;
      // A throwing reader still must not stop the heartbeat. When jobs are live,
      // make the headline fail closed from an explicit unreadable reading; when
      // they are off, the headline needs no document evidence at all.
      const unavailable =
        options.jobs === undefined
          ? undefined
          : resolveEvidence(options.jobs.definitions, (path) => ({ kind: "unreadable", path, why }));
      const headline = schedulerStandingNow(unavailable);
      if (!guard(store.checkpoint(checkpointUpdate(headline)))) return;
      recordPreviewResult({ ok: false, why });
      return;
    }
    const headline = schedulerStandingNow(evidence ?? undefined);
    if (!guard(store.checkpoint(checkpointUpdate(headline)))) return;
    writePreview(headline, evidence);
  }, tickMs);
  ticker.unref?.();

  const attentionOptions = options.attention;
  // ONE PASS AT A TIME. The pass makes model calls and can outlive its own
  // interval on a bad afternoon at the gateway; overlapping passes would double
  // the bill and race each other's memory file for no benefit at all.
  //
  // AND THE PASS IS AWAITED ON THE WAY OUT — GPT Sol's finding 5. Clearing the
  // interval stops the NEXT pass and does nothing about the one in flight, so a
  // shutdown released the store's lock while a runner was still alive and about
  // to write `attention.json`. A newly started daemon, or a manual CLI run,
  // could then be writing the same file at the same moment. The write is atomic
  // now, which stops a torn file; awaiting it stops the second writer existing.
  let attentionRunning: Promise<void> | null = null;
  const attentionTicker =
    attentionOptions === undefined
      ? null
      : setInterval(() => {
          if (halted() !== null || attentionRunning !== null) return;
          attentionRunning = attentionOptions
            .run()
            .then((list) => {
              attention = list;
            })
            .catch((cause: unknown) => {
              // A THROWN PASS BECOMES `unknown`, NOT SILENCE. Leaving the last
              // list in place would go on publishing a fleet that was true
              // twenty minutes ago while the probe was broken, with its own
              // `scannedAt` the only clue and nobody reading it.
              attention = {
                kind: "unknown",
                why: `the attention pass failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                scannedAt: now().toISOString(),
              };
              log(`attention pass failed: ${String(cause)}`);
            })
            .finally(() => {
              attentionRunning = null;
            });
        }, attentionOptions.intervalMs ?? ATTENTION_INTERVAL_MS);
  attentionTicker?.unref?.();

  /*
   * The usage scan, on its own timer and never on the tick.
   *
   * A scan is 30-45 seconds; running it inside the tick would make every
   * `lastTickAt` look 30-45 seconds late, and `lastTickAt` is how a reader tells
   * a dead Overseer from a quiet one. That is Astra's A17 exactly - healthy
   * operation spending most of its time alarming, which teaches Greg to ignore
   * the alarm.
   *
   * ONE PASS AT A TIME, and awaited on the way out, for the same two reasons the
   * attention pass is: overlapping scans would double a real cost for no benefit,
   * and a shutdown that released the lock with a scan in flight could leave two
   * writers on the store.
   */
  const usageOptions = options.usage;

  /**
   * **The callback cannot be allowed to throw into the collector's chain.**
   *
   * `onPass` is called inside `.then()` and inside `.catch()`. An unguarded
   * throw in the `.then()` is caught by the chain's own `.catch()`, which would
   * rewrite the live checkpoint to `{kind:"none"}` though the collection
   * SUCCEEDED — Greg then investigates his account instead of his disk — and
   * would very likely throw again handling that, ending as an unhandled
   * rejection that terminates the daemon. In the `.catch()` there is nowhere for
   * it to go at all.
   *
   * So the boundary is here rather than in each consumer: a history that cannot
   * be written is a thing to log, never a thing that changes what the usage pass
   * reports or stops the next one running. GPT Sol's G5.
   */
  function safeOnPass(outcome: UsagePassOutcome): void {
    if (usageOptions?.onPass === undefined) return;
    try {
      const returned: unknown = usageOptions.onPass(outcome);
      /* **AN ASYNC CALLBACK ESCAPES A `try`/`catch`.** TypeScript accepts an
         `async` function where `(outcome) => void` is expected, and by the time
         it rejects this block has already returned — so the rejection surfaces
         as an unhandled one and can terminate the daemon, which is the exact
         failure this wrapper exists to prevent. The production callback is
         synchronous today; this is here so that stays a fact about the callback
         rather than a condition of the containment. GPT Sol H14. */
      if (typeof (returned as { then?: unknown } | null)?.then === "function") {
        void (returned as Promise<unknown>).catch((cause: unknown) => {
          log(`usage pass hook rejected (the reading itself is unaffected): ${String(cause)}`);
        });
      }
    } catch (cause: unknown) {
      log(`usage pass hook failed (the reading itself is unaffected): ${String(cause)}`);
    }
  }

  let usageRunning: Promise<void> | null = null;
  const usageTicker =
    usageOptions === undefined
      ? null
      : setInterval(() => {
          if (halted() !== null || usageRunning !== null) return;
          const passAt = now().toISOString();
          usageRunning = usageOptions
            .run()
            .then((report) => {
              // THE DECISION IS `chooseUsage`'S AND IT NEEDS BOTH SIDES, so the
              // held report is read from the store rather than remembered here:
              // the store is the only thing that knows what survived the last
              // restart, and a second copy would part company with it.
              const choice = chooseUsage(store.usage, report, now().getTime());
              if (choice.kind === "take-fresh") usage = { kind: "report", report };
              // `keep-stored` leaves `usage` as it was, so the next checkpoint
              // carries no update and the store keeps what it holds. The reason
              // is logged either way: "kept the 11:00 reading, this scan did not
              // finish" is the sentence a person can act on.
              log(`usage pass: ${choice.kind} - ${choice.why}`);
              safeOnPass({ kind: choice.kind, report, why: choice.why, at: passAt });
            })
            .catch((cause: unknown) => {
              // A THROWN PASS BECOMES `none` WITH A REASON, not silence and not
              // a held report passed off as current. Same rule as the attention
              // pass: going on publishing a reading taken before the thing broke
              // is the failure this whole stage refuses.
              usage = {
                kind: "none",
                why: `the usage pass failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                at: now().toISOString(),
              };
              log(`usage pass failed: ${String(cause)}`);
              safeOnPass({
                kind: "collector-failed",
                why: cause instanceof Error ? cause.message : String(cause),
                at: passAt,
              });
            })
            .finally(() => {
              usageRunning = null;
            });
        }, usageOptions.intervalMs ?? USAGE_INTERVAL_MS);
  usageTicker?.unref?.();

  /*
   * The scheduler, on its own timer.
   *
   * NO IN-MEMORY OVERLAP GUARD AROUND IT, and that absence is the design rather
   * than an omission. `schedulerTick` is synchronous: it appends, spawns,
   * appends, and returns without awaiting the work. Overlap is prevented by the
   * LEASE the tick reads out of the store, which a restart survives and which
   * releases on its own deadline. That pair of properties is exactly what
   * `attentionRunning` lacks, and adding a guard here "for symmetry" would put
   * the bug back.
   *
   * `ruleRuns` below is NOT that guard and must not become it: nothing consults
   * it before dispatching, it empties itself as runs settle, and its only reader
   * is the shutdown path. A promise held to decide whether to start something is
   * the trap; a promise held to know what to wait for is not.
   *
   * Every report is written down, including the boring ones, at two volumes: a
   * line in the log for all of them, and a durable `daemon.jsonl` note for the
   * two that mean a run cannot be accounted for. A stuck job that produced only
   * a console line would be a stuck job nobody could prove afterwards.
   */
  const jobOptions = options.jobs;
  /**
   * A fact about a run that the store would not accept, written down where a
   * console line would not survive.
   *
   * GPT Sol's C5: the reservation append is fail-closed, and every later one had
   * its result dropped — so a failed `finished` left the durable history saying
   * `started` for ever while the report claimed the run had ended. It cannot
   * throw (that would lose the child's outcome as well), so the only honest
   * thing left is to say so loudly in both places.
   */
  const recordLost = (lost: LostRecord): void => {
    write({
      kind: "job-record-lost",
      at: now().toISOString(),
      instanceId: store.instanceId,
      jobId: lost.jobId,
      occurrenceId: lost.occurrenceId,
      fact: lost.fact,
      why: lost.why,
    });
  };
  /**
   * THE RULE RUNS THIS PROCESS IS IN THE MIDDLE OF.
   *
   * A rule is not a child: it runs inside the daemon, so a shutdown that only
   * cleared the timer released the store's lock with `observe` still in flight,
   * and both `rule-settled` and `job-occurrence-finished` were then appended to a
   * closed store and lost — leaving a `started` occurrence with no ending, which
   * the next boot correctly reads as a run nobody can account for. GPT Sol's
   * SC-1, the live half. Nothing acts yet, so nothing is dangerous; what it
   * manufactures is exactly the noise the occurrence ledger exists to make
   * meaningful.
   *
   * A `Set` rather than a counter, because giving up has to name the runs it
   * gave up on. Each entry removes itself when it settles, so this is empty on
   * an ordinary shutdown.
   */
  const ruleRuns = new Set<RuleRun>();
  const trackRuleRun = (run: RuleRun): void => {
    ruleRuns.add(run);
    // `settled` does not reject — every failure inside it is already a record or
    // an `onLostRecord` — but the handler is defensive rather than trusting,
    // because a promise removed from this set on success only would leave a
    // shutdown waiting on a run that is over.
    void run.settled.then(
      () => ruleRuns.delete(run),
      () => ruleRuns.delete(run),
    );
  };
  const jobsTicker =
    jobOptions === undefined
      ? null
      : setInterval(() => {
          if (halted() !== null) return;
          for (const report of schedulerTick({
            definitions: jobOptions.definitions,
            store,
            spawn: jobOptions.spawn,
            rules: jobOptions.rules,
            arming: jobOptions.arming,
            launchSeparationMs: jobOptions.launchSeparationMs,
            // THE DOCUMENTS, READ NOW — not the digests the definitions were
            // built with at start (plan 260910e, defect 1).
            readDocument: jobOptions.readDocument,
            now,
            // The completion append lands after the tick has returned, so its
            // failure cannot reach the reports above. This is where it goes.
            onLostRecord: recordLost,
            onRuleRun: trackRuleRun,
          })) {
            log(describeReport(report));
            if (report.kind === "stuck" || report.kind === "unaccounted") {
              write({
                kind: "job-unaccounted",
                at: now().toISOString(),
                instanceId: store.instanceId,
                jobId: report.jobId,
                occurrenceId: report.occurrenceId,
                reason: report.kind === "stuck" ? "lease-expired" : "reservation-abandoned",
                why: report.why,
              });
            }
            // The synchronous half of the same failure — a refusal or an
            // unknown that could not be appended. Same note, so a reader has one
            // place to look rather than two.
            if (report.kind === "unrecorded") {
              recordLost({ jobId: report.jobId, occurrenceId: report.occurrenceId, fact: report.fact, why: report.why });
            }
          }
        }, jobOptions.intervalMs ?? JOBS_INTERVAL_MS);
  jobsTicker?.unref?.();

  /*
   * The report drain, on its own timer. A throw is the `reports` condition — it
   * opens a note and closes on the next pass that completes — and never stops
   * the daemon: a broken inbox is a reason to say so, not to stop watching the
   * fleet. A pass that refused or left something pending says so once.
   */
  const reportOptions = options.reports;
  const reportsTicker =
    reportOptions === undefined
      ? null
      : setInterval(() => {
          if (halted() !== null) return;
          const at = now().toISOString();
          try {
            const outcome = reportOptions.drain(store.register);
            write(conditions.restore("reports", at, "a report drain pass completed"));
            if (outcome.refused > 0 || outcome.pending > 0) {
              log(`reports: ${outcome.recorded} recorded, ${outcome.refused} refused, ${outcome.pending} pending — ${outcome.notes.join("; ")}`);
            }
          } catch (cause) {
            write(conditions.degrade("reports", at, `the report drain threw: ${cause instanceof Error ? cause.message : String(cause)}`));
          }
        }, reportOptions.intervalMs ?? REPORTS_INTERVAL_MS);
  reportsTicker?.unref?.();

  /**
   * Wait for everything this PROCESS is in the middle of — the two passes, and
   * the rule runs.
   *
   * A function rather than an inline check because the assignments happen inside
   * interval callbacks, which the compiler cannot see from a `catch`; and
   * `catch(() => {})` because a pass that threw has already published its own
   * `unknown` and must not replace the error we are on our way out with.
   *
   * It was called `settlePasses` and covered only the two passes, which is how
   * SC-1's live half got in: a rule run is in-process too, and a name that said
   * "passes" made it easy to believe there was nothing else to wait for.
   */
  async function settleInFlight(): Promise<void> {
    // BOTH passes, and the usage one matters more rather than less: it holds a
    // file handle open across ~2.9 GB of reads, so it is the likelier of the two
    // to still be running when a signal arrives.
    for (const inFlight of [attentionRunning, usageRunning]) {
      if (inFlight !== null) await inFlight.catch(() => {});
    }
    await settleRuleRuns();
  }

  /**
   * Wait for the rule runs in flight — BOUNDED, and the bound is loud.
   *
   * Unbounded would trade a lost settlement for a daemon that cannot be
   * restarted, which is the worse of the two: `Restart=always` means the box
   * gets its Overseer back only when this returns. So the wait has a deadline,
   * and **the deadline is an outcome rather than a give-up**: every run still
   * unsettled gets the same durable `job-record-lost` note a failed completion
   * append gets, because from the ledger's point of view it is the same fact —
   * the run's ending was not written down, and something has to say why.
   */
  async function settleRuleRuns(): Promise<void> {
    if (ruleRuns.size === 0) return;
    const graceMs = jobOptions?.settleGraceMs ?? RULE_SETTLE_GRACE_MS;
    const waiting = [...ruleRuns];
    const raced = await Promise.race([
      Promise.allSettled(waiting.map((run) => run.settled)).then(() => "settled" as const),
      new Promise<"gave-up">((resolve) => {
        const timer = setTimeout(() => resolve("gave-up"), graceMs);
        timer.unref?.();
      }),
    ]);
    if (raced === "settled") return;
    // WHATEVER IS STILL IN THE SET, read now rather than from `waiting`: some of
    // them will have settled while we waited, and naming those would be a lie in
    // the direction that costs the most — a note about a run that is fine.
    for (const run of ruleRuns) {
      const why =
        `this rule run was still running when the daemon stopped and did not settle within ${graceMs}ms, ` +
        "so its ending was not written down and the next instance will read the occurrence as unaccounted for";
      log(`job ${run.jobId}: ABANDONED — ${run.occurrenceId} ${why}`);
      recordLost({ jobId: run.jobId, occurrenceId: run.occurrenceId, fact: "finished", why });
    }
  }

  const makeSource = options.source ?? fleetSource;

  try {
    // Spread rather than assigned, because `exactOptionalPropertyTypes` makes
    // "absent" and "present and undefined" different things — and here they
    // should be: an absent option means the module's own default.
    for await (const message of makeSource({
      baseUrl: options.baseUrl,
      signal: options.signal,
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      ...(options.streamRetryAfterMs === undefined ? {} : { streamRetryAfterMs: options.streamRetryAfterMs }),
    })) {
      if (halted() !== null) break;
      const at = now().toISOString();

      switch (message.kind) {
        case "stream-opened":
          write(conditions.restore("sse-stream", at, message.why));
          break;
        case "stream-closed":
          write(conditions.degrade("sse-stream", at, message.why));
          break;
        case "poll-failed":
          write(conditions.degrade("poll", at, message.why));
          break;
        case "unreadable":
          // Bytes arrived and were not a payload. Same condition as a payload
          // the gate refuses: the Overseer is receiving and not learning.
          write(conditions.degrade("snapshots", at, `the ${message.via} delivered something that was not JSON: ${message.why}`));
          break;
        case "payload":
          write(conditions.restore("poll", at, transportRestored(message.via)));
          // Its `false` means the lock is gone and `halted()` is set, which the
          // guard after this switch acts on — a `break` here would only leave
          // the switch, which is the kind of thing that reads as a loop exit
          // and is not one.
          take(message.json, message.via, at);
          break;
        default: {
          const never: never = message;
          throw new Error(`no handler for source message ${JSON.stringify(never)}`);
        }
      }
      if (halted() !== null) break;
    }
  } catch (cause) {
    // A THROW IS A DEATH THE DAEMON CAN STILL WRITE DOWN. Without this it dies
    // with no `daemon-stopped` note and a lock file with a live-looking pid in
    // it, which a reader cannot tell from a `kill -9` — and the two want
    // different things done about them. Best effort by construction: if the
    // store is what broke, the note will fail too, and `stopHere` swallows that
    // rather than replacing the real error with a second one.
    // THE PASS IS AWAITED HERE TOO — GPT Sol's second round. The normal exit
    // awaits it before `stopHere`, and this path did not, so a throw released the
    // store's lock with a paid call still in flight and a runner about to write
    // `attention.json`. The exceptional path is exactly when a second daemon is
    // most likely to be started, so it is the wrong one to leave open.
    await settleInFlight();
    stopHere(`the daemon threw: ${cause instanceof Error ? cause.message : String(cause)}`);
    throw cause;
  } finally {
    clearInterval(ticker);
    if (attentionTicker !== null) clearInterval(attentionTicker);
    if (usageTicker !== null) clearInterval(usageTicker);
    // CLEARING THE TIMER STOPS THE NEXT DISPATCH AND NOTHING ELSE, and what that
    // leaves behind is two different things wearing one word. A dispatched
    // SESSION is a separate process with a durable reservation behind it, so a
    // shutdown mid-run leaves a record rather than a second writer; it may not
    // get its `finished`, which is the lease's case and the next daemon reports
    // it. A dispatched RULE runs in here, and this comment used to cover it too
    // — GPT Sol's SC-1. Those are awaited, bounded, in `settleRuleRuns`.
    if (jobsTicker !== null) clearInterval(jobsTicker);
    if (reportsTicker !== null) clearInterval(reportsTicker);
  }

  /**
   * One payload, all the way through. Returns false when the daemon must stop.
   *
   * Declared after the loop that uses it only because it closes over the
   * mutable baseline; hoisting is what makes that legal, and keeping it inside
   * `runOverseer` is what keeps the state out of module scope where a second
   * daemon in one process would share it.
   */
  function take(json: unknown, via: Transport, at: string): boolean {
    lastPayloadAtMs = now().getTime();
    const parsed = parseObservation(json);
    // BEFORE THE GATE, and from every payload including the ones it refuses: a
    // failing collector keeps attempting while its snapshots are rejected, and
    // that pair is precisely what tells a failing source from a stopped one. So
    // the reading has to survive a payload with no snapshot in it — hence the
    // fallback, which is the SAME function `parseObservation` fills the field
    // with rather than a looser second reading of it. Without it, a dashboard
    // whose rows this version refuses would be reported as a stopped collector,
    // which is a fault it does not have.
    const attempt = parsed.ok ? parsed.value.attempt : parseAttempt(json);
    // EVERY READING, NOT ONLY THE ONES THAT CARRY A TIMESTAMP. A payload that
    // cannot answer RETIRES the last one that could, because the alternative is
    // measuring the age of a reading the producer has stopped taking — see
    // `latestAttempt`.
    attemptReading = latestAttempt(attemptReading, attempt);

    // THE ORDERING CONDITION, from every payload that PARSED — accepted,
    // duplicate or refused alike, because the stamp is a fact about the
    // producer rather than about this collection. A payload that did not parse
    // (an unread schema above all) says nothing either way: it neither raises
    // the condition nor restores it.
    //
    // `unstamped` RESTORES rather than staying silent. An old producer is a
    // supported fallback, so a rollback after one malformed stamp must close
    // the alarm — conditions stay open until something restores them (Sol's
    // finding 5). And it RAISES nothing: an old producer is ordered exactly as
    // well as it was before stamps existed, and an alarm about something no
    // worse than yesterday means nothing, which is the watchdog's own argument
    // for its large threshold. The console says so instead, once per change.
    if (parsed.ok) {
      const ordering = parsed.value.ordering;
      switch (ordering.kind) {
        case "unreadable":
          write(
            conditions.degrade(
              "ordering",
              at,
              `the dashboard's producer stamp cannot be believed, so its payloads are ordered by their clock alone: ${ordering.why}`,
            ),
          );
          break;
        case "unstamped":
          write(conditions.restore("ordering", at, "the latest payload carries no stamp at all, which is ordered by its clock as before stamps existed"));
          break;
        case "stamped":
          write(conditions.restore("ordering", at, `the latest payload's stamp is readable (dashboard run ${ordering.instance})`));
          break;
        default: {
          const never: never = ordering;
          throw new Error(String(never));
        }
      }
      if ((ordering.kind === "unstamped") !== (lastOrdering === "unstamped")) {
        log(
          ordering.kind === "unstamped"
            ? `${at} the dashboard sends no producer stamp (via ${via}), so its payloads are ordered by their clock, as before stamps existed`
            : `${at} the dashboard's payloads carry a producer stamp again (via ${via})`,
        );
      }
      lastOrdering = ordering.kind;
    }

    const verdict = admissible(accepted, parsed, retired);
    switch (verdict.verdict) {
      case "reject":
        write(conditions.degrade("snapshots", at, verdict.reason));
        return true;
      case "duplicate":
        // THE ORDINARY CASE, and deliberately not a restoration of anything: a
        // repeat proves the transport is alive and says nothing about whether
        // the collector behind it is. That is the watchdog's question.
        return true;
      case "accept":
        break;
      default: {
        const never: never = verdict;
        throw new Error(String(never));
      }
    }

    const observed = verdict.snapshot.snapshot;
    write(conditions.restore("snapshots", at, `a collection from ${observed.clock.at} was accepted`));
    refreshMs = observed.refreshMs;
    // THE ACCEPTED MARK MOVES ON EVEN IF THE WORLD DOES NOT. A snapshot that is
    // held below is still the newest collection this Overseer has seen, and
    // forgetting that would let the next one look like a duplicate.
    //
    // AND A NEW RUN RETIRES THE ONE IT REPLACED, here and only here: when an
    // accepted stamped snapshot's run differs from the previous accepted one's.
    // Not on a refused payload — a placeholder from a new run is refused, and
    // the old run is not replaced until the new one has actually collected.
    const replaced = accepted?.snapshot.ordering;
    if (replaced?.kind === "stamped" && observed.ordering.kind === "stamped" && replaced.instance !== observed.ordering.instance) {
      retired.add(replaced.instance);
      // Insertion order is age order, so the first entries are the oldest.
      for (const oldest of retired) {
        if (retired.size <= RETIRED_RUNS_KEPT) break;
        retired.delete(oldest);
      }
    }
    accepted = verdict.snapshot;

    // THE REGISTER IS THE THIRD INPUT, and it has to be read HERE rather than
    // left to the differ: `diff()` knows nothing about the store, and what it
    // needs is not the previous snapshot's reading but the last run this
    // Overseer actually verified — which survives a collection that could not
    // look, and survives this daemon being restarted. GPT Sol's P1-1.
    const known = new Map<SessionKey, string>();
    for (const [key, entry] of store.register) {
      if (entry.verifiedExecution !== null) known.set(key, entry.verifiedExecution.token);
    }
    const outcome = diff(baseline, verdict.snapshot, known);
    if (outcome.kind === "held") {
      // NOT A SILENCE. The baseline stays where it is, so the comparison
      // happens the moment a readable generation arrives; without this note the
      // only trace would be a history that quietly skipped a few minutes.
      write(conditions.degrade("baseline", at, outcome.reason));
      return true;
    }
    write(conditions.restore("baseline", at, `the collection at ${observed.clock.at} could be compared again`));

    // BELOW THE `held` RETURN, deliberately. `admissible()` can accept a
    // populated inventory whose tmux generation `diff()` cannot place; probing
    // on the accept arm would spend a process-table read and throw its answer
    // away because that path writes no checkpoint.
    let reading: ProcessTableReading;
    try {
      reading = probe();
    } catch (cause) {
      reading = {
        read: false,
        why: `the process table probe threw: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
    try {
      work = scanPaneWork({
        rows: observed.rows,
        reading,
        sourceCollectedAt: observed.clock.at,
        sourceCollectedAtMs: observed.clock.atMs,
        attemptedAt: at,
      });
    } catch (cause) {
      // CONVERSION IS PART OF THE INSTRUMENT. Containing only `probe()` leaves
      // a malformed or future reading able to throw from timestamp conversion
      // and stop the fold before its first durable write. That is still
      // "cannot tell", never a reason for the Overseer itself to stop.
      work = {
        kind: "probe-failed",
        why: `the work scan threw: ${cause instanceof Error ? cause.message : String(cause)}`,
        attemptedAt: at,
        sourceCollectedAt: observed.clock.at,
      };
    }

    // WITH NO BASELINE, THE DIFF CANNOT CLOSE ANYTHING OUT. `diff(null, next)`
    // is every row as `session-seen` and nothing else, so a session that ended
    // while the daemon was down would sit in the restored register FOR EVER: it
    // is in no baseline, so no later comparison can ever notice it is absent,
    // and the entry looks exactly like a live one. That is the plausible-and-
    // false register this whole stage exists to avoid. So the first accepted
    // snapshot after a start with no baseline reconciles the register against
    // it, and the invariant is worth stating plainly: AFTER THE FIRST ACCEPTED
    // SNAPSHOT, THE REGISTER IS THE SNAPSHOT — whatever the daemon started from.
    const events =
      baseline === null ? [...goneWhileAway(store.register, verdict.snapshot, at), ...outcome.events] : outcome.events;

    if (events.length > 0) {
      const appended = store.append(events);
      if (!guard(appended)) return false;
      log(`${at} ${events.length} events from the collection at ${observed.clock.at} (via ${via})`);
    }

    baseline = outcome.baseline;
    lastGoodSnapshotAt = observed.clock.at;
    // ══ THE WRITE ORDER, AND WHAT IS TRUE IF THE PROCESS DIES BETWEEN EACH PAIR
    //
    // Three durable writes, in this order and no other:
    //
    //   1. `store.append(events)`   — the events, fsync'd, O_APPEND
    //   2. `saveBaseline(json)`     — the payload those events were derived FROM
    //   3. `store.checkpoint(...)`  — the register, and the cursor into (1)
    //
    // The invariant the order buys: **the event log is always at or ahead of
    // the baseline file, and the baseline file is always at or ahead of the
    // checkpoint.** Never the other way round. Everything below follows from
    // that, and every case ends in a REPEAT rather than a LOSS.
    //
    //   died after 1, before 2 — the log has this collection's events; the
    //     baseline file names the PREVIOUS one. On restart the register is
    //     rebuilt from the checkpoint plus the log tail, so it already contains
    //     these events; the older baseline then re-diffs this collection and
    //     produces the same events a second time. Cost: a duplicate transition
    //     in the history. Not a lost session, and not a wrong register — the
    //     fold is idempotent for `session-seen` and `tmux-session-gone`, which
    //     set and delete by key.
    //   died after 2, before 3 — the checkpoint is one collection behind the
    //     log. `openStore` replays the log tail past the checkpoint's cursor
    //     onto the restored register, so the register catches up; the baseline
    //     matches it exactly. Nothing repeats and nothing is lost.
    //   died during 3 — `writeAtomically` renames, so a reader sees the old
    //     checkpoint or the new one, never half. That is the previous case.
    //   died during 1 — the log's last line may be torn. `truncateToLastLine`
    //     (jsonl.ts) cuts back to the last complete newline before the next append, so the
    //     partial event is dropped and the baseline file, being older, causes it
    //     to be re-derived.
    //
    // **The order that would be wrong is 2 before 1**: the baseline would then
    // name a collection whose events were never written, and the register —
    // which is only ever the fold of the log — would be permanently missing
    // them, with no later comparison able to notice, because the baseline says
    // that world is already accounted for.
    saveBaseline(root, json);
    if (!guard(store.checkpoint(checkpointUpdate()))) return false;
    checkFreshness();
    return true;
  }

  // AWAIT THE PASS IN FLIGHT BEFORE RELEASING ANYTHING — GPT Sol's finding 5.
  // `clearInterval` in the `finally` stops the NEXT pass and says nothing about
  // the one already running, which is a paid HTTP call that can take thirty
  // seconds. Without this, `stopHere` released the store's lock while a runner
  // was still alive and about to write `attention.json`, so a daemon started
  // straight afterwards — the `Restart=always` case, which is the normal one —
  // could be writing that file at the same moment. The write is atomic now,
  // which stops it tearing; this stops the second writer existing at all.
  await settleInFlight();

  const final = halted();
  const why =
    final !== null && final.kind === "lock-lost"
      ? "another Overseer took the lock"
      : options.signal.aborted
        ? "the daemon was asked to stop"
        : "the source ended";
  stopHere(why);
  return final ?? { kind: "stopped", why };

  /**
   * The last thing this instance does, whichever way it goes.
   *
   * Both `close`s are idempotent, so the crash path and the ordinary path can
   * both call this. The note is attempted first and its failure is swallowed:
   * releasing the lock matters more than recording why, because a lock nobody
   * holds is what stops the next start.
   */
  function stopHere(reason: string): void {
    try {
      write({ kind: "daemon-stopped", at: now().toISOString(), instanceId: store.instanceId, why: reason });
    } catch {
      /* The store or the note log is what broke; the caller is about to say so. */
    }
    notes.close();
    store.close();
  }
}

/**
 * The sessions the restored register holds and this snapshot does not.
 *
 * **THE ONE PLACE THE DAEMON MINTS AN EVENT OUTSIDE `diff()`, and it mints
 * CLOSURES ONLY — never a `session-status`, never a `session-replaced`.** That
 * restriction is the point rather than an omission, and the next person will
 * want to relax it: comparing a register entry's `lastStatusKey` against a
 * row's status looks like the same job. It is not. A status transition needs
 * two collections to be a fact about the box, and a register entry is a FOLD,
 * with no clock of its own and no `title` or `question` in it — so a transition
 * derived from it would be a plausible sentence about a change nobody observed,
 * which is the exact failure this stage exists to prevent. Absence is different:
 * it is a fact about THIS snapshot alone, and a snapshot that lists the fleet
 * is evidence that a handle it does not list is gone.
 *
 * **It takes an `AdmissibleSnapshot` rather than rows, so the type refuses the
 * dangerous call.** This function closes sessions out by absence, so a payload
 * the gate rejected — the startup placeholder with `rows: []`, or a failed
 * refresh carrying an old body — would close out the entire fleet in one write.
 * Three things stop that, and only the first is a promise:
 *
 *  1. the sole call site sits on `admissible()`'s `accept` arm, after `reject`
 *     and `duplicate` have both returned;
 *  2. the argument type is mintable ONLY by `admissible()`, so no other value
 *     can be passed here without a cast; and
 *  3. the call is downstream of `diff()` returning `diffed`, so a snapshot that
 *     could not be placed in a world — sessions listed, no tmux generation —
 *     has already taken the `held` early return and never reaches this.
 *
 * (2) is what makes it safe rather than careful: the empty-fleet placeholder
 * cannot be blessed, because `admissible()` rejects a null `collectedAt` before
 * anything else.
 *
 * `at` is when the snapshot arrived rather than when they really went, because
 * that is the only thing anybody can know: the daemon was not watching. The
 * `why` is `absent-from-snapshot`, the same cause `diff()` gives the ordinary
 * case, because it is the same evidence.
 */
function goneWhileAway(register: SessionRegister, snapshot: AdmissibleSnapshot, at: string): OverseerEvent[] {
  if (register.size === 0) return [];
  const rows: readonly ObservedRow[] = snapshot.snapshot.rows;
  const present = new Set(
    rows.map((row) => sessionKey({ tmuxId: row.id, claimedConversationId: row.claimedConversationId })),
  );
  const gone: OverseerEvent[] = [];
  for (const entry of register.values()) {
    const identity: SessionIdentity = { tmuxId: entry.tmuxId, claimedConversationId: entry.claimedConversationId };
    const key = sessionKey(identity);
    if (present.has(key)) continue;
    gone.push({
      kind: "tmux-session-gone",
      at,
      // The generation the entry belonged to, not this snapshot's: the session
      // is being closed out of the world it was recorded in.
      tmuxServerPid: entry.tmuxServerPid,
      key,
      identity,
      name: entry.name,
      why: "absent-from-snapshot",
    });
  }
  return gone;
}

function transportRestored(via: Transport): string {
  return via === "poll" ? "a poll succeeded" : "the stream is delivering, so the fallback is not in use";
}

/**
 * Store the payload that is now the baseline, atomically.
 *
 * Written whole to a sibling and renamed, so a reader — or the next start —
 * sees one version or the other and never half of one. (`store.ts` does the
 * same for `current.json` with a private `writeAtomically`; it is not exported,
 * so this is the same four lines rather than a reuse. Reported as a finding.)
 */
function saveBaseline(root: string, payload: unknown): void {
  const path = join(root, BASELINE_FILE);
  const temporary = `${path}.tmp`;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(temporary, `${JSON.stringify({ schema: 1, payload })}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

/**
 * The baseline from a previous life, or a sentence saying why there is none.
 *
 * **Through `admissible()`, not through a cast.** The stored bytes go back
 * through the same parser and the same gate a live payload does — so a stored
 * snapshot that has stopped parsing, or that carries a producer error, is
 * refused here exactly as it would be on the wire. `previous` is null because
 * there is nothing to be monotonic against yet; every other rule still runs.
 */
/**
 * The answer when the store came up cold: there is a file and we are not using
 * it, which is a different sentence from there being no file.
 */
function coldRestore(root: string): { accepted: AdmissibleSnapshot | null; why: string } {
  return {
    accepted: null,
    why: existsSync(join(root, BASELINE_FILE))
      ? `${BASELINE_FILE} is present but not used: the store came up cold, so there is no register for it to agree with`
      : "none stored, so the next collection announces every session",
  };
}

function restoreBaseline(root: string): { accepted: AdmissibleSnapshot | null; why: string } {
  const path = join(root, BASELINE_FILE);
  if (!existsSync(path)) return { accepted: null, why: "none stored, so the next collection announces every session" };
  let stored: unknown;
  try {
    stored = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (cause) {
    return { accepted: null, why: `none usable: ${BASELINE_FILE} did not parse (${String(cause)})` };
  }
  if (typeof stored !== "object" || stored === null || !("payload" in stored)) {
    return { accepted: null, why: `none usable: ${BASELINE_FILE} has no payload in it` };
  }
  // NO RETIRED RUNS: nothing has been replaced before the daemon has started,
  // and there is no predecessor to be ordered against. `retired` is rebuilt
  // from the payloads that arrive after this — see its declaration.
  const verdict = admissible(null, parseObservation((stored as { payload: JsonValue }).payload), new Set());
  if (verdict.verdict !== "accept") {
    return { accepted: null, why: `none usable: the stored collection is not admissible (${verdict.reason})` };
  }
  return { accepted: verdict.snapshot, why: `restored from the collection at ${verdict.snapshot.snapshot.clock.at}` };
}

/** Only for a store the caller has proved is not in use — `scripts/overseer.ts` never calls this. */
export function forgetBaseline(root: string): void {
  const path = join(root, BASELINE_FILE);
  if (existsSync(path)) unlinkSync(path);
}

export type { OverseerStore };
