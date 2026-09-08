/**
 * WHY IS THIS SESSION NOT DOING ANYTHING?
 *
 * The answer type is `Pause` in `wire.ts`, and its doc comment holds the
 * reasoning — read that first; nothing here restates it. This file is the three
 * sources that answer it, and the precedence that turns three readings into one
 * value.
 *
 * ## THE SPLIT IS THE WHOLE TESTABILITY STORY
 *
 * Same shape as `health.ts`: every `parse*`/`scan*`/`choose*` function below is
 * pure — records or strings in, a typed reading out — and `readPause` at the
 * bottom is the only thing that touches the disk. That matters more here than
 * anywhere else in this directory, because
 * docs/postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md
 * counted sixteen features that were built, tested, reviewed and shipped doing
 * nothing, and every one of them was a JOIN nobody could test. `choosePause` is
 * this module's join and it is a pure function taking already-read readings, so
 * it is tested directly rather than inferred from its parts.
 *
 * ## THE THREE SOURCES, AND WHAT EACH CAN AND CANNOT PROVE
 *
 * 1. **The transcript tail** (`scanCronRecords`, `nextCronFire`). The only
 *    source that can supply an intended reactivation time. A `CronCreate` is
 *    session-only — its own tool result says *"not written to disk, dies when
 *    Claude exits"* — so there is no store to read and the transcript is all
 *    there is.
 * 2. **The session store** (`parseSessionStoreFiles`, `readShellState`).
 *    `~/.claude/sessions/<pid>.json` carries `status: "shell"` and
 *    `statusUpdatedAt`, and `claude agents --json` discards both — it
 *    normalises `shell` to `busy`, which is why the board says *Working* for a
 *    session parked in a shell call. **This is an undocumented private file**
 *    and a Claude Code upgrade can change it under us, so every departure from
 *    the expected shape is `session-store-unreadable` rather than "no shell".
 * 3. **Rate limits**, which this module does NOT collect. The scan costs
 *    seconds on a loaded box and the refresh loop is 73 seconds. Another
 *    session owns it and publishes a reading; not being handed one is
 *    `rate-limits-not-collected`, which is a *cannot-tell*, not a *none*.
 *
 * ## THE JOIN THAT IS NOT A JOIN: WHY WE INDEX THE STORE BY CONVERSATION UUID
 *
 * `~/.claude/sessions/<pid>.json` is keyed by the **`claude` process's** pid,
 * and `FleetRow.panePid` is the **pane's** pid, which is its parent. Measured
 * on this box, 2026-09-08: store file `124250.json`, and `ps -o ppid= -p
 * 124250` says `124240`. Joining on `panePid` would therefore have found a file
 * for no session at all — and "no file" is indistinguishable from "not in a
 * shell call" unless you are looking for it, which is exactly how this class of
 * bug survives. So the store is read whole (0.9ms for 14 files, measured) and
 * indexed by the `sessionId` field it carries, which is the same conversation
 * uuid `transcript.ts` already keys on.
 *
 * ## CRON EXPRESSIONS ARE LOCAL WALL-CLOCK TIME, PROVED NOT ASSUMED
 *
 * Session `968beaba` created `CronCreate {cron: "36 12 08 09 *"}` and the
 * wake-up prompt lands in its transcript at `2026-09-08T11:36:00.565Z` — 12:36
 * in Europe/London, exact to the second. So `nextCronFire` does its arithmetic
 * with the local `Date` constructor, and a caller in another zone gets that
 * zone's answer, which is the same thing the scheduler would do.
 */
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { Pause, PauseUnknownCause } from "./wire.js";
import { type TranscriptRecord, readRawTail } from "./transcript.js";

// ---------------------------------------------------------------------------
// Named constants, because every one of them is a judgement someone will want
// to argue with and none of them should be a bare number in a branch.
// ---------------------------------------------------------------------------

/**
 * How far back to read — and this number is load-bearing, not a round one.
 *
 * ~1ms/session across 14 live sessions, and the measurement is the point:
 * `server.ts:18` warns off transcripts because whole files run 1.5–19MB (25MB
 * on this box by 14:00), and **a tail is a different act**.
 *
 * **WHY 32KB AND NOT 8KB.** Measured on session `968beaba`'s own bytes at the
 * moment it was parked: the wake-up sat 13,128 bytes from EOF and the BACKSTOP
 * it armed thirteen minutes later sat 8,056. Every agent on this box arms that
 * pair, so an 8KB budget reads the backstop, misses the real wake-up above it,
 * and says the session comes back thirteen minutes late — confidently, with no
 * sign anything went wrong. `tests/fleet-pause.test.ts` pins both readings
 * against that capture.
 *
 * **WHY NOT MORE.** A parked session writes almost nothing after arming: three
 * records and 5,077 bytes in the real case, so 32KB is six times the depth it
 * needs. Reading further does not find more *pending* crons, only fired ones —
 * a session that has done work since is not parked, and its old cron is
 * evidence of nothing. Measured at 14:05 with the fleet all working: the newest
 * cron sat a median of over 1MB from EOF across the 8 sessions that had one,
 * and 0 of 18 were within 32KB. Those all correctly read
 * `tail-window-exhausted` rather than `none`; chasing them with a bigger budget
 * would buy wrong answers, not right ones.
 */
export const DEFAULT_TAIL_BYTES = 32 * 1024;

/**
 * Grace before a missed time is called overdue.
 *
 * Fable's second guard, 2026-09-08: crons fire late on a box that has reached
 * load average 391, and `overdue` renders in the loud colour that means *only a
 * person can move this*. A colour that cries wolf for ninety seconds is worth
 * less than a colour that waits five minutes.
 */
export const OVERDUE_GRACE_MS = 5 * 60_000;

/**
 * The cause used when a wake-up was FOUND and its time could not be read.
 *
 * **`PauseUnknownCause` has no name for this state and it is reachable.** The
 * six causes it declares are all about failing to *reach* a source; this one is
 * about reaching it, finding a positive answer, and not being able to read the
 * time out of it — a recurring cron, a step expression, a range, a list. It is
 * not `none` (something IS pending) and it is not any of the six.
 *
 * (Cron step syntax is spelled out rather than shown here because a literal
 * star-slash closes this comment block. It cost 60 parse errors on first
 * compile, so it is worth the sentence.)
 *
 * It was `transcript-unreadable` for the first hour of this module's life —
 * the least wrong of the six, in the transcript's family, with the `why`
 * sentence carrying what actually happened. Naming the gap and mapping it
 * through ONE constant, rather than editing somebody else's type unilaterally,
 * is why the repair below is a single line. `schedule-not-parseable` was added
 * to `Pause` on 2026-09-08 in answer to exactly that.
 */
const SCHEDULE_UNREADABLE_CAUSE: PauseUnknownCause = "schedule-not-parseable";

// ---------------------------------------------------------------------------
// Source 3's injected reading — see the module header.
// ---------------------------------------------------------------------------

/**
 * A rate-limit reading, handed in by whoever collected it.
 *
 * TODO(w2-usage-limits): the `w2-usage-limits` session owns rate-limit
 * collection and will publish `ConversationRateLimit` in `wire.ts`. That type
 * was **not present in wire.ts when this was written** (checked 2026-09-08), so
 * this is a narrow local stand-in with the same two facts `Pause`'s
 * `rate-limited` arm needs. Replace it with the import when it lands; the only
 * code that touches it is `choosePause`.
 *
 * **Both arms are positive claims.** `not-limited` means *somebody looked and
 * this session is not rate-limited*, and it is the only thing that lets a
 * session reach `none`. Not passing the argument at all is the third state, and
 * it is `rate-limits-not-collected`.
 */
export type RateLimitReading =
  | {
      kind: "limited";
      /** The window's own name, verbatim. Deliberately not a closed union — see `Pause`. */
      window: string;
      /** ISO. `Pause.overdue` may be set only because this was actually read. */
      resetsAt: string;
    }
  | { kind: "not-limited" };

// ---------------------------------------------------------------------------
// Source 1: the transcript tail. Pure parsers.
// ---------------------------------------------------------------------------

/** One `CronCreate` seen in the window, with everything needed to judge it. */
export type CronEntry = {
  /** The `tool_use.id` (`toolu_…`). What dedupe is keyed on. */
  toolUseId: string;
  /**
   * The cron JOB id (`a2792b5d`), from the tool RESULT — and the reason the
   * results have to be parsed at all.
   *
   * **`CronDelete`'s `input.id` is this, not the `tool_use.id`.** Measured:
   * `CronCreate` → result `{"id":"a2792b5d","humanSchedule":"36 12 08 09 *"}`,
   * and the later `CronDelete` → `input {"id":"a2792b5d"}`. Matching deletes
   * against `tool_use.id` would therefore have cancelled nothing, ever, while
   * looking exactly like a working implementation.
   *
   * Null when the result record was not in the window — see `cancelled`.
   */
  cronJobId: string | null;
  /** The expression, preferring the result's `humanSchedule` over the call's input. */
  expression: string | null;
  /** `true` only when something said so. A one-shot is `false`. */
  recurring: boolean;
  /** The creating record's ISO timestamp — what the expression resolves against. */
  createdAt: string | null;
  /**
   * A later `CronDelete` names this job.
   *
   * **A create whose `cronJobId` is null is treated as NOT cancelled**, and the
   * ordering makes that safe rather than optimistic: the window ends at EOF, a
   * result record follows its call by milliseconds, and a delete can only come
   * after both. So a create in the window whose result is not in the window is
   * one that was still in flight when we read — and a call still in flight
   * cannot yet have been cancelled.
   */
  cancelled: boolean;
};

export type CronScan = {
  /** Every `CronCreate` in the window, cancelled ones included, oldest first. */
  entries: CronEntry[];
  /**
   * The newest timestamp on any record in the window — the session's last sign
   * of life, and the half of `overdue` that says *nothing has run since*.
   * Null when no record carried a timestamp.
   */
  lastRecordAt: string | null;
};

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Find every cron created in the window and say which are still pending.
 *
 * Pure: records in, a reading out. The records are the raw JSONL — turns cannot
 * answer this, because `recordsToTurns` drops every tool_result and reduces a
 * tool_use to a name and a label (see `TranscriptRecord`).
 *
 * `isSidechain` records are skipped for the same reason `recordsToTurns` skips
 * them: a subagent's cron is the subagent's, and modern Claude Code writes them
 * to a separate file anyway.
 */
export function scanCronRecords(records: readonly TranscriptRecord[]): CronScan {
  const scan: ScanState = {
    /** `tool_use.id` → the entry, so a repeated record cannot produce two crons. */
    byToolUseId: new Map(),
    /** Deletes, by cron job id, with the record index so "later" can be checked. */
    deletes: new Map(),
    /** Where each create sat, so a delete before it does not count. */
    createdAtIndex: new Map(),
  };
  let lastRecordAt: string | null = null;

  records.forEach((rec, index) => {
    if (rec["isSidechain"] === true) return;

    const ts = str(rec["timestamp"]);
    if (ts !== null && (lastRecordAt === null || ts > lastRecordAt)) lastRecordAt = ts;

    const message = obj(rec["message"]);
    const content = message === null ? null : message["content"];
    if (!Array.isArray(content)) return;

    // The tool RESULT record carries `toolUseResult`, a SIBLING of `message`,
    // and that is where the cron job id lives. Passed down rather than looked up
    // again, because it belongs to the record and not to the block.
    const result = obj(rec["toolUseResult"]);
    for (const block of content) {
      const b = obj(block);
      if (b === null) continue;
      const type = str(b["type"]);
      if (type === "tool_use") noteCronCall(scan, b, ts, index);
      else if (type === "tool_result" && result !== null) noteCronResult(scan, b, result);
    }
  });

  for (const entry of scan.byToolUseId.values()) {
    if (entry.cronJobId === null) continue;
    const deletedAt = scan.deletes.get(entry.cronJobId);
    const createdIdx = scan.createdAtIndex.get(entry.toolUseId);
    if (deletedAt !== undefined && createdIdx !== undefined && deletedAt > createdIdx) entry.cancelled = true;
  }

  return { entries: [...scan.byToolUseId.values()], lastRecordAt };
}

/** The three indexes `scanCronRecords` builds in one pass. */
type ScanState = {
  byToolUseId: Map<string, CronEntry>;
  deletes: Map<string, number>;
  createdAtIndex: Map<string, number>;
};

/** A `tool_use` block: a wake-up armed, or one cancelled. */
function noteCronCall(scan: ScanState, block: Record<string, unknown>, ts: string | null, index: number): void {
  const id = str(block["id"]);
  if (id === null) return;
  const name = str(block["name"]);
  const input = obj(block["input"]);

  if (name === "CronCreate") {
    if (scan.byToolUseId.has(id)) return; // dedupe on tool_use.id
    scan.byToolUseId.set(id, {
      toolUseId: id,
      cronJobId: null,
      expression: input === null ? null : str(input["cron"]),
      recurring: input !== null && input["recurring"] === true,
      createdAt: ts,
      cancelled: false,
    });
    scan.createdAtIndex.set(id, index);
    return;
  }

  if (name === "CronDelete") {
    const target = input === null ? null : str(input["id"]);
    // Keep the FIRST delete's index: an earlier cancellation is the one that has
    // to be later than the create for the create to be dead.
    if (target !== null && !scan.deletes.has(target)) scan.deletes.set(target, index);
  }
}

/**
 * A `tool_result` record: where a create learns its cron JOB id.
 *
 * This is the only place the id a `CronDelete` will name ever appears, which is
 * why tool results are parsed at all — see `CronEntry.cronJobId`.
 */
function noteCronResult(scan: ScanState, block: Record<string, unknown>, result: Record<string, unknown>): void {
  const forId = str(block["tool_use_id"]);
  if (forId === null) return;
  const entry = scan.byToolUseId.get(forId);
  if (entry === undefined) return;
  const jobId = str(result["id"]);
  if (jobId !== null) entry.cronJobId = jobId;
  // The result's own rendering of the schedule, which is what the scheduler
  // actually stored. Preferred over the call's input for that reason.
  const human = str(result["humanSchedule"]);
  if (human !== null) entry.expression = human;
  if (result["recurring"] === true) entry.recurring = true;
}

export type CronFire =
  | { kind: "at"; at: string }
  /** Found a schedule, cannot name a time. See `SCHEDULE_UNREADABLE_CAUSE`. */
  | { kind: "unreadable"; why: string };

/**
 * When a cron expression next fires at or after `from`.
 *
 * **The expression carries no year, so assuming one is a bug** — it is resolved
 * forward from the record's own timestamp instead, which is the only anchor
 * that cannot be wrong.
 *
 * **What is refused, and why refusing is the feature.** Anything but a single
 * literal minute and hour yields `unreadable`: a step expression, a range, a list,
 * a named or numeric day-of-week, or a `recurring` job. Fable's first guard is
 * that `overdue` renders in the loud colour, so a time we half-guessed is worse
 * than no time — *the one row we cannot vouch for is the one row that must not
 * shout*. A `*` in day-of-month or month IS accepted, because "the next 14:30
 * from here" is arithmetic rather than a guess.
 */
export function nextCronFire(expression: string | null, recurring: boolean, from: string | null): CronFire {
  if (expression === null || expression.trim() === "") {
    return { kind: "unreadable", why: "the wake-up carried no schedule expression" };
  }
  if (recurring) {
    return {
      kind: "unreadable",
      why: `the wake-up repeats (\`${expression}\`), so there is no single time it comes back at`,
    };
  }
  if (from === null) {
    return { kind: "unreadable", why: `the record carrying \`${expression}\` had no timestamp to resolve it against` };
  }
  const anchor = new Date(from);
  if (Number.isNaN(anchor.getTime())) {
    return { kind: "unreadable", why: `the record's timestamp (\`${from}\`) did not parse` };
  }

  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return { kind: "unreadable", why: `\`${expression}\` is not a five-field cron expression` };
  }
  const [minuteF, hourF, domF, monthF, dowF] = fields as [string, string, string, string, string];

  const minute = literal(minuteF, 0, 59);
  const hour = literal(hourF, 0, 23);
  if (minute === null || hour === null) {
    return { kind: "unreadable", why: `\`${expression}\` does not name one literal time of day` };
  }
  if (dowF !== "*") {
    return { kind: "unreadable", why: `\`${expression}\` restricts the day of week, which is not resolved to one time` };
  }
  const dom = domF === "*" ? null : literal(domF, 1, 31);
  const month = monthF === "*" ? null : literal(monthF, 1, 12);
  if ((domF !== "*" && dom === null) || (monthF !== "*" && month === null)) {
    return { kind: "unreadable", why: `\`${expression}\` has a day or month that is not a single literal value` };
  }

  // Walk forward a day at a time from the anchor's own local date. Two years is
  // the bound: a one-shot `29 2` in a non-leap year would otherwise spin, and
  // "no time" is the right answer for one that never comes.
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), hour, minute, 0, 0);
  for (let day = 0; day <= 366 * 2; day++) {
    const candidate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day, hour, minute, 0, 0);
    if (candidate.getTime() < anchor.getTime()) continue;
    if (dom !== null && candidate.getDate() !== dom) continue;
    if (month !== null && candidate.getMonth() + 1 !== month) continue;
    return { kind: "at", at: candidate.toISOString() };
  }
  return { kind: "unreadable", why: `\`${expression}\` names no date within two years of when it was set` };
}

/** A cron field that is exactly one number in range, or null for anything else. */
function literal(field: string, min: number, max: number): number | null {
  if (!/^\d{1,2}$/.test(field)) return null;
  const n = Number(field);
  return n >= min && n <= max ? n : null;
}

// ---------------------------------------------------------------------------
// Source 2: the session store. Pure parsers.
// ---------------------------------------------------------------------------

/** One `~/.claude/sessions/<pid>.json`, reduced to the fields the CLI throws away. */
export type StoreEntry = {
  file: string;
  pid: number | null;
  sessionId: string;
  /**
   * `busy` | `idle` | `shell` | anything else, verbatim.
   *
   * **Not a closed union, on purpose.** This is an undocumented private file;
   * a value we have never seen must render as "not shell" rather than fail a
   * narrowing, and a value that is not a string at all must be
   * `session-store-unreadable`.
   */
  status: string;
  /** Epoch ms. The dwell-time field `claude agents --json` discards. */
  statusUpdatedAt: number | null;
  /** Epoch ms heartbeat, used only to break a duplicate-sessionId tie. */
  updatedAt: number | null;
};

export type StoreIndex = {
  bySessionId: Map<string, StoreEntry>;
  /** Files that were not JSON, or were JSON without the fields we need. */
  unparseable: number;
  /** Files parsed successfully. A positive control: 0 of 18 is a broken probe. */
  parsed: number;
};

/**
 * Index the session store by conversation uuid.
 *
 * Pure: takes the files' contents, never reads them. See the module header for
 * why the join is on `sessionId` and not on a pid.
 *
 * Duplicate `sessionId`s were not observed (18 files, 18 distinct ids, measured
 * 2026-09-08) but are not refused: a resumed conversation could plausibly leave
 * an old record behind, so the newest `updatedAt` wins and a record with no
 * `updatedAt` never displaces one that has it.
 */
export function parseSessionStoreFiles(files: readonly { name: string; text: string }[]): StoreIndex {
  const bySessionId = new Map<string, StoreEntry>();
  let unparseable = 0;
  let parsed = 0;

  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(file.text);
    } catch {
      unparseable += 1;
      continue;
    }
    const o = obj(raw);
    const sessionId = o === null ? null : str(o["sessionId"]);
    const status = o === null ? null : str(o["status"]);
    if (o === null || sessionId === null || status === null) {
      unparseable += 1;
      continue;
    }
    parsed += 1;
    const entry: StoreEntry = {
      file: file.name,
      pid: num(o["pid"]),
      sessionId,
      status,
      statusUpdatedAt: num(o["statusUpdatedAt"]),
      updatedAt: num(o["updatedAt"]),
    };
    const existing = bySessionId.get(sessionId);
    if (existing === undefined || (entry.updatedAt ?? -1) > (existing.updatedAt ?? -1)) {
      bySessionId.set(sessionId, entry);
    }
  }

  return { bySessionId, unparseable, parsed };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type ShellState =
  | { kind: "in-a-shell-call"; sinceMs: number }
  /** The store was read, and this session is not parked in a shell call. */
  | { kind: "not-in-a-shell-call" }
  | { kind: "unreadable"; why: string };

/**
 * Whether this session is parked in a shell call, and for how long.
 *
 * **A missing entry is `unreadable`, not `not-in-a-shell-call`.** The brief for
 * this module is explicit and it is the module's own rule applied to its most
 * fragile source: the file is undocumented and private, so *we could not find
 * the record* and *the record says no* are different sentences and only one of
 * them may contribute to `none`.
 */
export function readShellState(index: StoreIndex, sessionId: string | null, nowMs: number): ShellState {
  if (sessionId === null || sessionId === "") {
    return { kind: "unreadable", why: "this session has no conversation id, so its record in the session store cannot be found" };
  }
  const entry = index.bySessionId.get(sessionId);
  if (entry === undefined) {
    return {
      kind: "unreadable",
      why: `no record for this conversation in ~/.claude/sessions (${index.parsed} read, ${index.unparseable} unreadable) — that file is undocumented and private, so a missing record is "could not look", not "not in a shell call"`,
    };
  }
  if (entry.status !== "shell") return { kind: "not-in-a-shell-call" };
  if (entry.statusUpdatedAt === null) {
    return {
      kind: "unreadable",
      why: `the session store says this session is in a shell call but carries no usable statusUpdatedAt, so we cannot say for how long`,
    };
  }
  // Clamped rather than refused: a clock skew of a few ms between the writer
  // and us is ordinary, and "0ms" is the honest floor. A NEGATIVE dwell would
  // be the shape that renders as a nonsense duration.
  return { kind: "in-a-shell-call", sinceMs: Math.max(0, nowMs - entry.statusUpdatedAt) };
}

// ---------------------------------------------------------------------------
// The join. Pure, and the part with the historical failure rate.
// ---------------------------------------------------------------------------

/** What one source could not tell us. */
export type Failure = { cause: PauseUnknownCause; why: string };

/** Everything the three sources produced, already read. */
export type PauseInputs = {
  transcript:
    | { kind: "read"; scan: CronScan; reachedStartOfFile: boolean }
    | { kind: "failed"; cause: PauseUnknownCause; why: string };
  shell: ShellState;
  /** Undefined means nobody collected it — `rate-limits-not-collected`. */
  rateLimit: RateLimitReading | undefined;
  nowMs: number;
};

/**
 * Three readings to one `Pause`.
 *
 *     rate-limited (positively known) > scheduled-wakeup > in-a-shell-call
 *       > cannot-tell > none
 *
 * **`none` requires that every source was consulted successfully.** If one
 * failed, the answer is `cannot-tell` carrying that source's cause even when
 * the other two came back clean. Saying *"not waiting for anything"* while one
 * of three windows was shut is the ambiguous negative this module's own type
 * doc says has already been got wrong three times.
 *
 * When more than one source failed, the FIRST failure in source order
 * (transcript, then store, then rate limits) supplies the `cause`, because it
 * is the most specific thing we know; `why` names all of them, because a
 * renderer showing one sentence should not imply the others were fine.
 */
export function choosePause(inputs: PauseInputs): Pause {
  // Each source is read into a POSITIVE finding and a FAILURE, independently
  // and in one place each, before any of them is ranked. Ranking while reading
  // was the first draft, and it made the failure ORDER depend on the order the
  // branches happened to run in — which is exactly how a `cause` ends up naming
  // the wrong source and nothing notices.
  const lastRecordAt = inputs.transcript.kind === "read" ? inputs.transcript.scan.lastRecordAt : null;

  const fromTranscript = readCronSource(inputs.transcript, inputs.nowMs, lastRecordAt);
  const fromStore = readStoreSource(inputs.shell);
  const fromRateLimits = readRateLimitSource(inputs.rateLimit, inputs.nowMs, lastRecordAt);

  // ---- precedence ---------------------------------------------------------
  if (fromRateLimits.limited !== null) return fromRateLimits.limited;
  if (fromTranscript.wakeup !== null) return fromTranscript.wakeup;
  if (fromStore.shell !== null) return fromStore.shell;

  // Source order, and it is a fixed array rather than an accumulation order:
  // the transcript's failure is the most specific thing we know, the store's
  // next, and "nobody collected rate limits" last because it is the ordinary
  // state of the world rather than a defect in this session.
  const failures = [fromTranscript.failure, fromStore.failure, fromRateLimits.failure].filter(
    (f): f is Failure => f !== null,
  );
  const first = failures[0];
  if (first !== undefined) {
    const why = failures.length === 1 ? first.why : failures.map((f) => f.why).join("; and ");
    return { kind: "cannot-tell", why, cause: first.cause };
  }
  return { kind: "none" };
}

/** Source 1's two possible contributions. Exactly one of them is non-null. */
function readCronSource(
  transcript: PauseInputs["transcript"],
  nowMs: number,
  lastRecordAt: string | null,
): { wakeup: Pause | null; failure: Failure | null } {
  if (transcript.kind === "failed") {
    return { wakeup: null, failure: { cause: transcript.cause, why: transcript.why } };
  }

  const pending = transcript.scan.entries.filter((e) => !e.cancelled);
  const times: string[] = [];
  const unreadable: string[] = [];
  for (const entry of pending) {
    const fire = nextCronFire(entry.expression, entry.recurring, entry.createdAt);
    if (fire.kind === "at") times.push(fire.at);
    else unreadable.push(fire.why);
  }

  // Earliest wins: it is the one the session actually comes back at. ISO-8601
  // UTC strings sort chronologically, which is why `toISOString` is what
  // `nextCronFire` returns.
  times.sort();
  const at = times[0];
  if (at !== undefined) {
    const fireMs = new Date(at).getTime();
    // *Fired* and *overdue* are told apart by whether any record exists after
    // the time. The window ends at EOF, so the absence of one is real — but
    // only if we saw a timestamp at all, hence `!== null` rather than a
    // permissive `=== null ||`. The row we cannot vouch for must not shout.
    const nothingSince = lastRecordAt !== null && new Date(lastRecordAt).getTime() <= fireMs;
    return {
      wakeup: {
        kind: "scheduled-wakeup",
        at,
        overdue: fireMs + OVERDUE_GRACE_MS < nowMs && nothingSince,
        source: "cron",
      },
      failure: null,
    };
  }

  if (unreadable.length > 0) {
    const first = unreadable[0] as string;
    return { wakeup: null, failure: { cause: SCHEDULE_UNREADABLE_CAUSE, why: `a wake-up is scheduled but ${first}` } };
  }
  if (!transcript.reachedStartOfFile) {
    // NOT the same fact as having read the whole file and found none.
    return {
      wakeup: null,
      failure: {
        cause: "tail-window-exhausted",
        why: "no wake-up was found in the tail of the transcript, but the read stopped before the start of the file, so an older one may be above it",
      },
    };
  }
  // Read the whole file, found no pending wake-up. A real, positive negative.
  return { wakeup: null, failure: null };
}

/** Source 2's two possible contributions. */
function readStoreSource(shell: ShellState): { shell: Pause | null; failure: Failure | null } {
  if (shell.kind === "unreadable") {
    return { shell: null, failure: { cause: "session-store-unreadable", why: shell.why } };
  }
  if (shell.kind === "in-a-shell-call") {
    return { shell: { kind: "in-a-shell-call", sinceMs: shell.sinceMs }, failure: null };
  }
  return { shell: null, failure: null };
}

/** Source 3's two possible contributions. Not supplied is a failure, not a `none`. */
function readRateLimitSource(
  reading: RateLimitReading | undefined,
  nowMs: number,
  lastRecordAt: string | null,
): { limited: Pause | null; failure: Failure | null } {
  if (reading === undefined) {
    return {
      limited: null,
      failure: {
        cause: "rate-limits-not-collected",
        why: "nobody has published a rate-limit reading for this session, and scanning for one costs seconds — so we cannot say whether it is waiting on a usage limit",
      },
    };
  }
  if (reading.kind === "not-limited") return { limited: null, failure: null };

  const resets = new Date(reading.resetsAt);
  const resetsOk = !Number.isNaN(resets.getTime());
  // `overdue` may be set only when the time was READ, is past, and nothing has
  // run since. A transcript we could not read past `resetsAt` is "could not
  // tell whether it resumed" and stays quiet — Fable's first guard. A
  // rate-limited session never resumes by itself, so this is deterministic
  // rather than a heuristic.
  const nothingSince = lastRecordAt !== null && new Date(lastRecordAt).getTime() <= resets.getTime();
  return {
    limited: {
      kind: "rate-limited",
      window: reading.window,
      resetsAt: reading.resetsAt,
      overdue: resetsOk && resets.getTime() + OVERDUE_GRACE_MS < nowMs && nothingSince,
    },
    failure: null,
  };
}

/** `RawTail`'s failure arms, as this module's causes. Pure. */
export function causeOfTailFailure(
  tail: { kind: "not-found"; reason: string; why: string } | { kind: "unreadable"; why: string },
): Failure {
  if (tail.kind === "unreadable") return { cause: "transcript-unreadable", why: tail.why };
  if (tail.reason === "no-claude-session-id" || tail.reason === "malformed-claude-session-id") {
    return { cause: "no-conversation-id", why: tail.why };
  }
  return { cause: "no-transcript", why: tail.why };
}

// ---------------------------------------------------------------------------
// The collector. Everything above this line is pure; this is the only place
// that touches the disk.
// ---------------------------------------------------------------------------

export type ReadPauseOptions = {
  /** `row.claudeSessionId` — the conversation uuid, and the key for both sources. */
  claudeSessionId: string | null;
  /** `row.meta.dir`, a hint that saves the transcript scan. Null is fine. */
  dir: string | null;
  /**
   * A published rate-limit reading, or omitted. **Omitting it is not "no limit"**
   * — see `RateLimitReading`.
   */
  rateLimit?: RateLimitReading;
  /** Injectable so tests need no fake home. */
  projectsDir?: string;
  /** Injectable for the same reason. Defaults to `~/.claude/sessions`. */
  sessionsDir?: string;
  /** Injectable so `overdue` is testable without waiting. Defaults to `Date.now()`. */
  nowMs?: number;
  /** Defaults to `DEFAULT_TAIL_BYTES`. */
  tailBytes?: number;
  /**
   * A store index read once for the whole fleet, rather than per session.
   *
   * The store is 18 small files and re-reading it for each of ~20 rows is 20×
   * the syscalls for one answer. A caller refreshing a whole board should call
   * `readSessionStore()` once and pass the result in.
   */
  storeIndex?: StoreIndex;
};

export type StoreRead = { kind: "read"; index: StoreIndex } | { kind: "unreadable"; why: string };

/**
 * Read and index `~/.claude/sessions`. The I/O half of source 2.
 *
 * Whole-directory rather than one file, because the join is on `sessionId` and
 * not on a pid (see the module header) — and because the whole store is 0.9ms
 * for 14 files, so a board refreshing 20 rows should call this once and pass
 * the index in via `ReadPauseOptions.storeIndex`.
 */
export async function readSessionStore(sessionsDir?: string): Promise<StoreRead> {
  const dir = sessionsDir ?? path.join(homedir(), ".claude", "sessions");
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch (err) {
    return { kind: "unreadable", why: `could not list ${dir}: ${err instanceof Error ? err.message : String(err)}` };
  }
  const files: { name: string; text: string }[] = [];
  for (const name of names) {
    try {
      files.push({ name, text: await readFile(path.join(dir, name), "utf8") });
    } catch {
      // A session exiting while we read is ordinary. An empty string counts as
      // one unparseable file rather than failing the whole index — one dying
      // agent must not blind the board to the other nineteen.
      files.push({ name, text: "" });
    }
  }
  return { kind: "read", index: parseSessionStoreFiles(files) };
}

/**
 * Why this session is not doing anything.
 *
 * The only function here that touches the disk: a bounded transcript tail and
 * one pass over the session store, both measured at ~1ms. Everything it decides
 * is decided by `choosePause`, which is pure and tested directly.
 */
export async function readPause(opts: ReadPauseOptions): Promise<Pause> {
  const nowMs = opts.nowMs ?? Date.now();

  const tail = await readRawTail({
    claudeSessionId: opts.claudeSessionId,
    dir: opts.dir,
    maxBytes: opts.tailBytes ?? DEFAULT_TAIL_BYTES,
    ...(opts.projectsDir === undefined ? {} : { projectsDir: opts.projectsDir }),
  });

  const transcript: PauseInputs["transcript"] =
    tail.kind === "found"
      ? { kind: "read", scan: scanCronRecords(tail.records), reachedStartOfFile: tail.reachedStartOfFile }
      : { kind: "failed", ...causeOfTailFailure(tail) };

  const store: StoreRead =
    opts.storeIndex === undefined
      ? await readSessionStore(opts.sessionsDir)
      : { kind: "read", index: opts.storeIndex };
  const shell: ShellState =
    store.kind === "unreadable"
      ? { kind: "unreadable", why: store.why }
      : readShellState(store.index, opts.claudeSessionId, nowMs);

  return choosePause({
    transcript,
    shell,
    rateLimit: opts.rateLimit,
    nowMs,
  });
}
