/**
 * THE DAY BUDGET — the only way to a paid attention call. Plan 260910f, D4 and D5.
 *
 * ## Why a day ceiling, when the pass already has `maxCalls`
 *
 * `maxCalls` bounds one pass. Nothing bounded a day, and nothing bounded the
 * other process: `overseer attention` makes the same paid calls as the daemon
 * and can run beside it, so two callers each honouring their own per-pass limit
 * could spend without anyone adding the two up. GPT Sol's F1 on the plan named
 * both holes and a third — a call made and not yet recorded when the process
 * died could be made again. Gate 4 of docs/project/overseer.md is the rule this
 * serves: *the cheap deterministic tick must keep working when the budget is
 * exhausted*, which needs a budget that can be exhausted.
 *
 * ## Reserve before, settle after, and the lock is not held in between
 *
 * `reserve` takes the budget lock (`lock.ts`'s `O_CREAT|O_EXCL` claim), refuses
 * if ONE MORE CALL AT ITS WORST CASE could cross any ceiling, and otherwise
 * writes that worst case into the ledger, atomically and fsynced, before it lets
 * go. `settle` takes the lock again and replaces the reservation with what the
 * gateway said it cost. So:
 *
 *  - **A crash between the two leaves the worst case spent**, for good. The
 *    reservation IS the record; a lost handle is all a crash is, from here.
 *  - **The lock is not held across the request**, which is where this departs
 *    from Sol's wording, deliberately: a thirty-second call would block the
 *    other process for no gain, because the persisted reservation already makes
 *    the other process see this one's spend. Two callers can each have a call
 *    in flight; they cannot both have the last one.
 *  - **The worst case is enforced, not estimated.** `MAX_COMPLETION_TOKENS` is
 *    sent as `max_tokens`, the input is clipped to the bound
 *    `WORST_CASE_PROMPT_TOKENS` is computed from (attention-classify.ts), and
 *    `WORST_CASE_CALL_USD` is a constant above anything that token worst case
 *    could cost at the measured rate.
 *
 * ## Refuse loudly, never reset
 *
 * The ledger is one small JSON file beside the checkpoint. `model-budget.created`
 * is written on the first successful write — the pattern `reports.created` uses
 * in reports.ts — and once it exists, a ledger that is gone, torn or the wrong
 * shape is a LOST DAY, not a new one: the next reservation writes a closed ledger
 * saying why and refuses until the next UTC midnight. Starting from an empty
 * ledger would re-grant a day that may already be spent, which is the reset
 * this module exists to make impossible. A ledger dated AFTER today means the
 * clock went backwards, and it is refused rather than trusted or "corrected".
 * Before the marker exists, absent means fresh — there is nothing to have lost.
 *
 * ## The cooldown is the gateway's answer, not our guess (D5)
 *
 * A 402 or 429 from the gateway is a `strike`: fifteen minutes, doubling per
 * consecutive strike to a two-hour cap, cleared by the next call that comes back
 * judged. No probe of OpenRouter's key endpoint in v1 — the refusal is the
 * reading.
 *
 * ## What a refusal becomes
 *
 * `budgetedClassifier` returns `{ notCalled }` instead of a verdict, the pass
 * stops asking for the rest of that pass, every tail it did not reach is counted
 * as unjudged with the reason, and the list it publishes is `limited` (wire.ts,
 * D6). A refusal this module cannot DATE — its own lock could not be taken — is
 * `unavailable`, which leaves the tails unjudged without claiming a stop.
 *
 * `--no-write` on the CLI controls attention memory only; it never skips this.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AttentionJudgementStopped } from "../fleet/wire.js";
import {
  MAX_COMPLETION_TOKENS,
  NO_SPEND,
  WORST_CASE_PROMPT_TOKENS,
  classifyTail,
  type ClassifierAnswer,
  isCacheable,
  type ClassifierOptions,
  type ClassifierSpend,
} from "./attention-classify.js";
import { writeAtomically } from "./jsonl.js";
import { describeLockRefusal, releaseLock, stillOurs, takeLock, type HeldLock } from "./lock.js";

export const MODEL_BUDGET_FILE = "model-budget.json";
/** Proof that a day has been counted here, so a missing ledger reads as LOST rather than new. */
export const MODEL_BUDGET_INIT_FILE = "model-budget.created";
export const MODEL_BUDGET_LOCK_FILE = "model-budget.lock";
export const MODEL_BUDGET_SCHEMA = 1;

/**
 * The day's ceilings, per UTC day, for every paid attention call together.
 *
 * **PROPOSED STARTING BOUNDS, NOT MEASURED LIMITS.** The measured running cost
 * is roughly $0.50–$1.00 a day at a two-minute cadence (the attention row in
 * src/spend-declarations.ts: a cold pass over 25 sessions is 10 calls and
 * $0.0036). $1.50 sits above that so a normal day never meets it, and low
 * enough that a runaway — a loop, a fleet that never stops changing, a prompt
 * that grew — stops within a day at the price of a coffee. 1,500 calls is about
 * that money at the measured ~$0.0004 a call; 3,000,000 tokens about the same
 * again at ~1,500 tokens a call. These are the numbers put to the Overseer
 * before proposals are enabled on the live daemon (plan 260910f D4).
 *
 * **GLOBAL, because there is one component today.** The plan's per-component
 * ceilings would slot in here as a second table keyed by caller, checked in
 * `ceilingCrossedBy` beside this one, with each reservation naming its component.
 */
export const DAY_CEILING = { calls: 1_500, tokens: 3_000_000, costUsd: 1.5 } as const;

/**
 * The most one call is assumed to cost when it is reserved, and what an
 * unpriced call is settled at.
 *
 * The token worst case (`WORST_CASE_CALL_TOKENS`, ~20k) is about fourteen times
 * a measured call (~1,500 tokens, ~$0.0004), so at the measured rate it would
 * cost ~$0.005; this is double that, for a price that may move. Over-reserving
 * costs only headroom while a call is in flight — the reservation is replaced by
 * the real figure on settle.
 */
export const WORST_CASE_CALL_USD = 0.01;
/** Prompt plus completion, both bounds rather than estimates (attention-classify.ts). */
export const WORST_CASE_CALL_TOKENS = WORST_CASE_PROMPT_TOKENS + MAX_COMPLETION_TOKENS;

export const COOLDOWN_FIRST_MS = 15 * 60_000;
export const COOLDOWN_CAP_MS = 2 * 60 * 60_000;

/** How long `reserve` waits for a LIVE holder of the budget lock, which holds it for milliseconds. */
const DEFAULT_LOCK_WAIT_MS = 2_000;
const LOCK_RETRY_MS = 5;
/** Floating-point sums of small dollar amounts must not refuse the call that lands exactly on the ceiling. */
const COST_EPSILON = 1e-9;

export type BudgetSpend = {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /** Settled at the worst case because the gateway would not say. Counted, so the figure reads as a ceiling-safe floor. */
  unpricedCalls: number;
};

export type BudgetReservation = { id: string; day: string; at: string };
export type BudgetCooldown = { until: string; strikes: number; why: string };

/**
 * One UTC day's record. `spent` is settled calls only; `reservations` are calls
 * in flight (or lost in a crash), each counted at the worst case.
 */
export type BudgetLedger = {
  schema: 1;
  day: string;
  spent: BudgetSpend;
  reservations: readonly BudgetReservation[];
  /** Kept after it expires, so the next strike knows it is consecutive; cleared by a judged call. */
  cooldown: BudgetCooldown | null;
  /** Set when the record could not be trusted (lost, torn): the day is refused, and this says why. */
  closed: { why: string; at: string } | null;
};

/**
 * What a caller holds between reserve and settle. Losing it is a crash, and costs the worst case.
 * Only the `modelBudget` instance that minted it can settle it — see `minted` there.
 */
export type Reservation = { id: string; day: string };

/**
 * Why no call was made. `stopped` is the day's ceiling or the gateway's
 * cooldown — datable, and published as `limited`. `unavailable` is this module
 * failing to consult its own ledger (a held or unreadable lock, a disk that
 * refused the write): the call is not made, and nothing is claimed about when.
 */
export type BudgetRefusal = { kind: "stopped"; stopped: AttentionJudgementStopped } | { kind: "unavailable"; why: string };

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; refusal: BudgetRefusal };

/** What the pass gets back for one tail: an answer, or the reason it was not asked. */
export type ClassifyOutcome = ClassifierAnswer | { notCalled: BudgetRefusal };

/** The ledger as a person should read it — today's, with in-flight calls at their worst case. */
export type BudgetReading = {
  today: string;
  ledger: BudgetLedger;
  /** Settled spend plus every reservation at the worst case. What the ceilings are checked against. */
  committed: BudgetSpend;
  inFlight: number;
  /** What the next `reserve` would say, or null if it would grant. */
  refusal: AttentionJudgementStopped | null;
};

export type ModelBudget = {
  reserve(): ReserveResult;
  /** `judged` means the call came back with a verdict, which clears a cooldown's strikes. */
  settle(reservation: Reservation, spend: ClassifierSpend, judged: boolean): boolean;
  /** The gateway refused on quota: start (or double) the cooldown. */
  strike(why: string): boolean;
  /** Lock-free, write-free: what `reserve` would decide, and the numbers behind it. */
  read(): BudgetReading;
};

export type ModelBudgetOptions = {
  /** The store root — the same directory as the checkpoint and the attention memory. */
  root: string;
  now?: () => Date;
  /** How long to wait for a live holder of the budget lock. Tests pass 0. */
  lockWaitMs?: number;
  /**
   * A TEST SEAM: called while `reserve` holds the budget lock, after it has
   * decided to grant and before it writes. The only way to put a second caller
   * inside that window deterministically, which is the window the lock exists
   * for.
   */
  whileHolding?: () => void;
};

const ZERO: BudgetSpend = { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, unpricedCalls: 0 };

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function nextUtcMidnight(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString();
}

function freshLedger(day: string, cooldown: BudgetCooldown | null): BudgetLedger {
  return { schema: MODEL_BUDGET_SCHEMA, day, spent: ZERO, reservations: [], cooldown, closed: null };
}

function addSpent(a: BudgetSpend, b: BudgetSpend): BudgetSpend {
  return {
    calls: a.calls + b.calls,
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    costUsd: a.costUsd + b.costUsd,
    unpricedCalls: a.unpricedCalls + b.unpricedCalls,
  };
}

/** Settled spend plus every reservation at its worst case. */
function committedOf(ledger: BudgetLedger): BudgetSpend {
  const n = ledger.reservations.length;
  return addSpent(ledger.spent, {
    calls: n,
    promptTokens: n * WORST_CASE_PROMPT_TOKENS,
    completionTokens: n * MAX_COMPLETION_TOKENS,
    costUsd: n * WORST_CASE_CALL_USD,
    unpricedCalls: 0,
  });
}

/** Which ceiling ONE more worst-case call could cross, in words, or null. */
function ceilingCrossedBy(committed: BudgetSpend): string | null {
  if (committed.calls + 1 > DAY_CEILING.calls) {
    return `${committed.calls} of the day's ${DAY_CEILING.calls} calls are already committed`;
  }
  const tokens = committed.promptTokens + committed.completionTokens;
  if (tokens + WORST_CASE_CALL_TOKENS > DAY_CEILING.tokens) {
    return `one more call could use ${WORST_CASE_CALL_TOKENS} tokens, and ${tokens} of the day's ${DAY_CEILING.tokens} are committed`;
  }
  if (committed.costUsd + WORST_CASE_CALL_USD > DAY_CEILING.costUsd + COST_EPSILON) {
    return (
      `one more call could cost $${WORST_CASE_CALL_USD.toFixed(2)}, and $${committed.costUsd.toFixed(4)} ` +
      `of the day's $${DAY_CEILING.costUsd.toFixed(2)} is committed`
    );
  }
  return null;
}

/**
 * What a gateway answer is settled at.
 *
 * An unpriced call is settled at the worst-case COST — zero would be the
 * flattering reading of *we were not told* — and, if the gateway gave no token
 * counts either (a call that died in flight), at the worst-case tokens too.
 */
function settledSpend(spend: ClassifierSpend): BudgetSpend {
  const unpriced = spend.unpricedCalls > 0;
  const noTokens = spend.promptTokens + spend.completionTokens === 0;
  return {
    calls: Math.max(1, spend.calls),
    promptTokens: unpriced && noTokens ? WORST_CASE_PROMPT_TOKENS : spend.promptTokens,
    completionTokens: unpriced && noTokens ? MAX_COMPLETION_TOKENS : spend.completionTokens,
    costUsd: (spend.costUsd ?? 0) + spend.unpricedCalls * WORST_CASE_CALL_USD,
    unpricedCalls: spend.unpricedCalls,
  };
}

/* ------------------------------------------------------------------ *
 * The file.
 * ------------------------------------------------------------------ */

type LedgerRead = { kind: "absent" } | { kind: "unreadable"; why: string } | { kind: "ledger"; ledger: BudgetLedger };

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}
function isCount(u: unknown): u is number {
  return typeof u === "number" && Number.isInteger(u) && u >= 0;
}
function isInstant(u: unknown): u is string {
  return typeof u === "string" && !Number.isNaN(Date.parse(u));
}
function isDay(u: unknown): u is string {
  return (
    typeof u === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(u) &&
    !Number.isNaN(Date.parse(`${u}T00:00:00.000Z`)) &&
    new Date(`${u}T00:00:00.000Z`).toISOString().slice(0, 10) === u
  );
}

/**
 * Every field, or a sentence saying which one is wrong. **Strict because the
 * refusal is cheap and the misread is not**: a ledger read wrongly is a ceiling
 * that re-grants money, and one refused costs the rest of a UTC day of judging —
 * loudly, on the page, as `limited`.
 */
export function parseLedger(u: unknown): BudgetLedger | string {
  if (!isRecord(u)) return "the ledger is not a JSON object";
  if (u["schema"] !== MODEL_BUDGET_SCHEMA) return `schema ${JSON.stringify(u["schema"])} is not ${MODEL_BUDGET_SCHEMA}`;
  const day = u["day"];
  if (!isDay(day)) return "`day` is not a UTC date";
  const s = u["spent"];
  if (!isRecord(s)) return "`spent` is not an object";
  const { calls, promptTokens, completionTokens, costUsd, unpricedCalls } = s;
  if (!isCount(calls) || !isCount(promptTokens) || !isCount(completionTokens) || !isCount(unpricedCalls)) {
    return "`spent` has a count that is not a count";
  }
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0) return "`spent.costUsd` is not an amount";
  const rawReservations = u["reservations"];
  if (!Array.isArray(rawReservations)) return "`reservations` is not an array";
  const reservations: BudgetReservation[] = [];
  for (const r of rawReservations) {
    if (!isRecord(r) || typeof r["id"] !== "string" || r["id"] === "" || !isInstant(r["at"])) {
      return "a reservation is not one this build can read";
    }
    // A reservation lives in its own day's ledger and nowhere else.
    if (r["day"] !== day) return `a reservation for ${JSON.stringify(r["day"])} is filed in the ledger for ${day}`;
    reservations.push({ id: r["id"], day, at: r["at"] });
  }
  const c = u["cooldown"];
  let cooldown: BudgetCooldown | null = null;
  if (c !== null) {
    if (!isRecord(c) || !isInstant(c["until"]) || typeof c["why"] !== "string" || !isCount(c["strikes"]) || c["strikes"] < 1) {
      return "`cooldown` is not one this build can read";
    }
    cooldown = { until: c["until"], strikes: c["strikes"], why: c["why"] };
  }
  const k = u["closed"];
  let closed: BudgetLedger["closed"] = null;
  if (k !== null) {
    if (!isRecord(k) || typeof k["why"] !== "string" || k["why"] === "" || !isInstant(k["at"])) {
      return "`closed` is not one this build can read";
    }
    closed = { why: k["why"], at: k["at"] };
  }
  return {
    schema: MODEL_BUDGET_SCHEMA,
    day,
    spent: { calls, promptTokens, completionTokens, costUsd, unpricedCalls },
    reservations,
    cooldown,
    closed,
  };
}

function readLedger(root: string): LedgerRead {
  let text: string;
  try {
    text = readFileSync(join(root, MODEL_BUDGET_FILE), "utf8");
  } catch (cause) {
    // Only ENOENT is absence. EACCES, EIO and friends mean we could not look,
    // and "could not look" must not be read as "nothing there".
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", why: String(cause) };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { kind: "unreadable", why: `not JSON: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const parsed = parseLedger(json);
  return typeof parsed === "string" ? { kind: "unreadable", why: parsed } : { kind: "ledger", ledger: parsed };
}

/* ------------------------------------------------------------------ *
 * The decision, which is pure, so `read` and `reserve` cannot disagree.
 * ------------------------------------------------------------------ */

type Decision =
  | { kind: "grant"; ledger: BudgetLedger }
  | {
      kind: "refuse";
      stopped: AttentionJudgementStopped;
      ledger: BudgetLedger;
      /** A closed ledger to write, when the refusal is for a record that could not be trusted. */
      close: BudgetLedger | null;
    };

function decide(read: LedgerRead, initialised: boolean, now: Date): Decision {
  const today = utcDay(now);
  const tomorrow = nextUtcMidnight(today);
  const closeWith = (why: string): Decision => {
    const closed: BudgetLedger = { ...freshLedger(today, null), closed: { why, at: now.toISOString() } };
    return { kind: "refuse", stopped: { kind: "exhausted", why, until: tomorrow }, ledger: closed, close: closed };
  };

  if (read.kind === "absent") {
    if (!initialised) return grantIfItFits(freshLedger(today, null), tomorrow);
    return closeWith(
      `${MODEL_BUDGET_FILE} is gone, and ${MODEL_BUDGET_INIT_FILE} says a day was being counted here — ` +
        "refusing until the next UTC day rather than starting this one again from nothing",
    );
  }
  if (read.kind === "unreadable") {
    return closeWith(
      `${MODEL_BUDGET_FILE} could not be read (${read.why}) — refusing until the next UTC day rather than ` +
        "starting this one again from nothing",
    );
  }

  let ledger = read.ledger;
  if (ledger.day > today) {
    return {
      kind: "refuse",
      stopped: {
        kind: "exhausted",
        why:
          `${MODEL_BUDGET_FILE} is dated ${ledger.day}, after today (${today}): the clock went backwards, ` +
          "and a day this cannot place is not one it can count",
        until: nextUtcMidnight(ledger.day),
      },
      ledger,
      close: null,
    };
  }
  // A NEW UTC DAY. Yesterday's unsettled reservations stay counted in
  // yesterday, which is over; the cooldown carries, because it is about the
  // gateway rather than the day.
  if (ledger.day < today) ledger = freshLedger(today, ledger.cooldown);
  if (ledger.closed !== null) {
    return { kind: "refuse", stopped: { kind: "exhausted", why: ledger.closed.why, until: tomorrow }, ledger, close: null };
  }
  if (ledger.cooldown !== null && Date.parse(ledger.cooldown.until) > now.getTime()) {
    return {
      kind: "refuse",
      stopped: { kind: "cooling-down", why: ledger.cooldown.why, until: ledger.cooldown.until },
      ledger,
      close: null,
    };
  }
  return grantIfItFits(ledger, tomorrow);
}

function grantIfItFits(ledger: BudgetLedger, tomorrow: string): Decision {
  const crossed = ceilingCrossedBy(committedOf(ledger));
  if (crossed === null) return { kind: "grant", ledger };
  return {
    kind: "refuse",
    stopped: { kind: "exhausted", why: `the day's model ceiling would be crossed: ${crossed}`, until: tomorrow },
    ledger,
    close: null,
  };
}

/* ------------------------------------------------------------------ *
 * The lock, held for milliseconds.
 * ------------------------------------------------------------------ */

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `body` holding the budget lock, or say why it could not be taken.
 *
 * A LIVE holder is waited for, briefly — it holds the lock for a read and a
 * rename. A lock left by a dead process is cleared by `takeLock` itself. An
 * unreadable lock is refused, as lock.ts refuses it everywhere: a refusal is
 * one `rm` away from fixed, and a stolen lock is two writers.
 */
function withLock<T>(
  root: string,
  now: () => Date,
  waitMs: number,
  body: (held: HeldLock, lockPath: string) => T,
): { ok: true; value: T } | { ok: false; why: string } {
  const lockPath = join(root, MODEL_BUDGET_LOCK_FILE);
  const deadline = Date.now() + waitMs;
  for (;;) {
    const taken = takeLock(lockPath, now);
    if (taken.ok) {
      try {
        return { ok: true, value: body(taken.lock, lockPath) };
      } finally {
        releaseLock(taken.lock, lockPath);
      }
    }
    const transient = taken.refusal.reason === "already-running" || taken.refusal.reason === "lost-the-race";
    if (!transient || Date.now() >= deadline) {
      return { ok: false, why: `the model budget could not be consulted: ${describeLockRefusal(taken.refusal, lockPath)}` };
    }
    sleepSync(LOCK_RETRY_MS);
  }
}

/**
 * Write the ledger — **only if we still hold the lock**, re-checked immediately
 * before the rename. lock.ts names the residual race (two starts clearing the
 * same dead holder); this is the check it asks every caller to make.
 */
function persist(root: string, held: HeldLock, lockPath: string, ledger: BudgetLedger, now: Date): boolean {
  if (!stillOurs(held, lockPath)) return false;
  writeAtomically(join(root, MODEL_BUDGET_FILE), root, `${JSON.stringify(ledger, null, 2)}\n`);
  const marker = join(root, MODEL_BUDGET_INIT_FILE);
  if (!existsSync(marker)) {
    writeAtomically(
      marker,
      root,
      `model spend was first counted here at ${now.toISOString()}\n` +
        `With this marker present and ${MODEL_BUDGET_FILE} absent or unreadable, the day's record has been LOST,\n` +
        "and paid attention calls are refused until the next UTC day. Delete both files to reset deliberately.\n",
    );
  }
  return true;
}

export function modelBudget(options: ModelBudgetOptions): ModelBudget {
  const { root } = options;
  const clock = options.now ?? (() => new Date());
  const waitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
  const initialised = (): boolean => existsSync(join(root, MODEL_BUDGET_INIT_FILE));
  // THE RESERVATIONS THIS INSTANCE MINTED, AND NO OTHERS — GPT Sol's F11. The
  // ledger's `{id, day}` is readable by anyone on the directory, and settling
  // frees a reservation's worst case while its call may still be in flight and
  // spending it; so a second process settling it would re-grant money the first
  // can still use. Held in memory on purpose: a crashed owner's reservation
  // stays charged at the worst case, which is the crash rule above.
  const minted = new Set<string>();

  return {
    reserve(): ReserveResult {
      const now = clock();
      try {
        const done = withLock(root, clock, waitMs, (held, lockPath): ReserveResult => {
          const decision = decide(readLedger(root), initialised(), now);
          if (decision.kind === "refuse") {
            // Best effort: the refusal stands whether or not the closed ledger
            // could be written, and the next reserve re-decides the same way.
            if (decision.close !== null) persist(root, held, lockPath, decision.close, now);
            return { ok: false, refusal: { kind: "stopped", stopped: decision.stopped } };
          }
          options.whileHolding?.();
          const reservation: BudgetReservation = { id: randomUUID(), day: decision.ledger.day, at: now.toISOString() };
          const next: BudgetLedger = { ...decision.ledger, reservations: [...decision.ledger.reservations, reservation] };
          if (!persist(root, held, lockPath, next, now)) {
            return {
              ok: false,
              refusal: { kind: "unavailable", why: "the model budget's lock was taken from under this reservation, so no call is made" },
            };
          }
          minted.add(reservation.id);
          return { ok: true, reservation: { id: reservation.id, day: reservation.day } };
        });
        return done.ok ? done.value : { ok: false, refusal: { kind: "unavailable", why: done.why } };
      } catch (cause) {
        // A disk that refused the write is a budget we could not consult — the
        // call is not made, rather than made unrecorded.
        return { ok: false, refusal: { kind: "unavailable", why: `the model budget could not be written: ${String(cause)}` } };
      }
    },

    settle(reservation, spend, judged): boolean {
      // Not ours: refused, and the worst case stays counted — the safe direction.
      if (!minted.has(reservation.id)) return false;
      const now = clock();
      try {
        const done = withLock(root, clock, waitMs, (held, lockPath) => {
          const read = readLedger(root);
          // Lost or torn: `reserve` owns that case and refuses the day. There is
          // no record left to settle into, and inventing one would re-grant it.
          if (read.kind !== "ledger") return false;
          const ledger = read.ledger;
          // ITS OWN DAY. If the ledger has moved on to a new UTC day, the day
          // this call was reserved in is over and its worst case stayed counted
          // there; landing its real cost on today would charge today for it.
          if (ledger.day !== reservation.day) return false;
          const index = ledger.reservations.findIndex((r) => r.id === reservation.id);
          if (index === -1) return false;
          return persist(
            root,
            held,
            lockPath,
            {
              ...ledger,
              reservations: ledger.reservations.filter((_, i) => i !== index),
              spent: addSpent(ledger.spent, settledSpend(spend)),
              cooldown: judged ? null : ledger.cooldown,
            },
            now,
          );
        });
        const settled = done.ok && done.value;
        // Forgotten only once the settle is on disk, so a settle that could not
        // take the lock can be retried by its owner.
        if (settled) minted.delete(reservation.id);
        return settled;
      } catch {
        // Unsettled means the worst case stays counted — the safe direction.
        return false;
      }
    },

    strike(why): boolean {
      const now = clock();
      const today = utcDay(now);
      try {
        const done = withLock(root, clock, waitMs, (held, lockPath) => {
          const read = readLedger(root);
          let ledger: BudgetLedger;
          if (read.kind === "absent") {
            if (initialised()) return false;
            ledger = freshLedger(today, null);
          } else if (read.kind === "unreadable") {
            return false;
          } else {
            ledger = read.ledger;
            if (ledger.day > today) return false;
            if (ledger.day < today) ledger = freshLedger(today, ledger.cooldown);
          }
          const strikes = (ledger.cooldown?.strikes ?? 0) + 1;
          const ms = Math.min(COOLDOWN_FIRST_MS * 2 ** (strikes - 1), COOLDOWN_CAP_MS);
          return persist(root, held, lockPath, { ...ledger, cooldown: { until: new Date(now.getTime() + ms).toISOString(), strikes, why } }, now);
        });
        return done.ok && done.value;
      } catch {
        return false;
      }
    },

    read(): BudgetReading {
      const now = clock();
      const decision = decide(readLedger(root), initialised(), now);
      return {
        today: utcDay(now),
        ledger: decision.ledger,
        committed: committedOf(decision.ledger),
        inFlight: decision.ledger.reservations.length,
        refusal: decision.kind === "refuse" ? decision.stopped : null,
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * The call, through the budget.
 * ------------------------------------------------------------------ */

/**
 * Wrap a transport so every call is reserved first and settled after.
 *
 * The transport is injected so the pass and the tests can drive this with no
 * gateway; `paidClassifier` below is the one production composition, and the
 * only place `classifyTail` is named outside its own file.
 */
export function budgetedClassifier(
  budget: ModelBudget,
  call: (tail: string) => Promise<ClassifierAnswer>,
): (tail: string) => Promise<ClassifyOutcome> {
  return async (tail) => {
    const reserved = budget.reserve();
    if (!reserved.ok) return { notCalled: reserved.refusal };
    let answer: ClassifierAnswer;
    try {
      answer = await call(tail);
    } catch (cause) {
      // `classifyTail` never throws. A transport that does may still have been
      // billed, so it settles as an unpriced call — the worst case — not as zero.
      budget.settle(reserved.reservation, { ...NO_SPEND, calls: 1, unpricedCalls: 1 }, false);
      throw cause;
    }
    // A settle or strike that fails leaves the reservation at its worst case,
    // or no cooldown where one was due — the first is the safe direction, and
    // the second is caught by the next 429.
    if (answer.verdict.kind === "quota-refused") {
      budget.settle(reserved.reservation, answer.spend, false);
      budget.strike(`the gateway refused a call with HTTP ${answer.verdict.status}, so the model is backed off`);
    } else {
      budget.settle(reserved.reservation, answer.spend, isCacheable(answer.verdict));
    }
    return answer;
  };
}

/** The production classifier: the real transport, through the day budget. Daemon and CLI both use this. */
export function paidClassifier(budget: ModelBudget, options: ClassifierOptions): (tail: string) => Promise<ClassifyOutcome> {
  return budgetedClassifier(budget, (tail) => classifyTail(tail, options));
}

/**
 * The one line a person reads: today's calls and money against the ceiling,
 * and why the next call would be refused if it would.
 *
 * In-flight and unpriced calls are counted at the worst case, and the line says
 * so, because a figure that includes worst cases is a ceiling-safe floor rather
 * than a bill — the same rule `describeCost` follows for money.
 */
export function describeBudget(reading: BudgetReading): string {
  const c = reading.committed;
  const head = `today: ${c.calls} call${c.calls === 1 ? "" : "s"}, $${c.costUsd.toFixed(4)} of $${DAY_CEILING.costUsd.toFixed(2)} ceiling`;
  const notes: string[] = [];
  if (reading.inFlight > 0) notes.push(`${reading.inFlight} in flight, counted at the worst case`);
  if (c.unpricedCalls > 0) notes.push(`${c.unpricedCalls} unpriced, counted at the worst case`);
  const line = notes.length > 0 ? `${head} (${notes.join("; ")})` : head;
  if (reading.refusal === null) return line;
  return reading.refusal.kind === "cooling-down"
    ? `${line} — cooling down until ${reading.refusal.until}: ${reading.refusal.why}`
    : `${line} — day ceiling reached, refusing until ${reading.refusal.until}: ${reading.refusal.why}`;
}
