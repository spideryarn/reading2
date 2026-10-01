/**
 * **The run's budget: one durable file, reserve before, settle after, halt on
 * a missing cost** — plan 261001s § Spend, Sol F7.
 *
 * Capture, the probe, answers and judging are separate invocations and all
 * spend from `budget.json` in the run directory, so a second command cannot
 * start from a total of zero. Before every call `reserve` adds a conservative
 * upper bound (input at the dearer of the uncached and write prices, plus
 * `max_tokens` at the output price, plus tool fees) and **refuses** if spent
 * plus everything reserved would pass the cap. After the call `settle`
 * replaces the reservation with what OpenRouter reported. **A call that
 * reports no cost, or a non-finite one, halts the run** — the file says so,
 * and every later reservation is refused until somebody looks.
 *
 * A reservation left by a process that died mid-call stays in the file and
 * keeps counting against the cap: wrong in the safe direction, and visible.
 *
 * One process at a time: `openBudget` takes `budget.lock` with `wx`, so two
 * invocations on one run cannot both read the same total.
 */
import fs from "node:fs";
import path from "node:path";
import { type CollectOptions, collectSpend, type SpendRecord, totalSpend } from "../../src/ai-spend.js";
import { type Price, priceOf, writePrice } from "./arms.js";

export class BudgetRefused extends Error {}
export class BudgetHalted extends Error {}

export interface BudgetFile {
  spentUsd: number;
  /** Live reservations, by call id. */
  reserved: Record<string, { label: string; usd: number; at: string }>;
  settled: { id: string; label: string; usd: number; at: string; note?: string }[];
  /** Set when a call reported no cost: the run stops here until somebody looks. */
  halted: string | null;
}

const empty = (): BudgetFile => ({ spentUsd: 0, reserved: {}, settled: [], halted: null });

export interface Budget {
  readonly cap: number;
  /** Throws `BudgetRefused` (no record kept) or `BudgetHalted`. */
  reserve(id: string, label: string, usd: number): void;
  /** Replace the reservation with the reported cost; a missing or non-finite one halts. */
  settle(id: string, costUsd: number | null, note?: string): void;
  /** The call never started: drop the reservation. */
  release(id: string): void;
  state(): BudgetFile;
  close(): void;
}

/**
 * The budget, on a file or (for a test) in memory. `file` null keeps it in
 * memory and takes no lock.
 */
export function openBudget(file: string | null, cap: number): Budget {
  if (!Number.isFinite(cap) || cap <= 0) throw new Error(`--cap must be a positive number of dollars, got ${cap}`);
  let lock: string | null = null;
  let mem = empty();
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    lock = `${file}.lock`;
    try {
      fs.writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`, { flag: "wx" });
    } catch {
      throw new Error(
        `${lock} exists: another invocation is spending on this run, or one died. ` +
          "If none is running, delete the lock and look at budget.json's reservations first.",
      );
    }
    if (fs.existsSync(file)) mem = JSON.parse(fs.readFileSync(file, "utf8")) as BudgetFile;
  }
  const save = () => {
    if (!file) return;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(mem, null, 2)}\n`);
    fs.renameSync(tmp, file);
  };
  const outstanding = () => Object.values(mem.reserved).reduce((n, r) => n + r.usd, 0);
  return {
    cap,
    reserve(id, label, usd) {
      if (mem.halted) throw new BudgetHalted(`the run is halted: ${mem.halted}`);
      if (!Number.isFinite(usd) || usd < 0) throw new Error(`reservation for ${label} is not a cost: ${usd}`);
      if (mem.reserved[id]) throw new Error(`call id ${id} is already reserved`);
      const would = mem.spentUsd + outstanding() + usd;
      if (would > cap) {
        throw new BudgetRefused(
          `refused before the call: ${label} could cost up to $${usd.toFixed(4)}, and $${mem.spentUsd.toFixed(4)} spent ` +
            `+ $${outstanding().toFixed(4)} reserved + that = $${would.toFixed(4)}, over the $${cap.toFixed(2)} cap`,
        );
      }
      mem.reserved[id] = { label, usd, at: new Date().toISOString() };
      save();
    },
    settle(id, costUsd, note) {
      const r = mem.reserved[id];
      if (!r) throw new Error(`settling ${id}, which was never reserved`);
      if (costUsd === null || !Number.isFinite(costUsd) || costUsd < 0) {
        /* The reservation stays: what it cost is unknown, so the bound is
           the best figure there is. */
        mem.halted = `${r.label} (${id}) reported no usable cost (${String(costUsd)}) at ${new Date().toISOString()}`;
        save();
        throw new BudgetHalted(`halted: ${mem.halted}`);
      }
      delete mem.reserved[id];
      mem.spentUsd += costUsd;
      mem.settled.push({ id, label: r.label, usd: costUsd, at: new Date().toISOString(), ...(note ? { note } : {}) });
      save();
    },
    release(id) {
      delete mem.reserved[id];
      save();
    },
    state: () => structuredClone(mem),
    close() {
      if (lock) fs.rmSync(lock, { force: true });
      lock = null;
    },
  };
}

/* ------------------------------------------------------- the upper bound -- */

/**
 * **The most a call could cost**: every input token at the dearer of the
 * uncached and cache-write prices, `maxTokens` at the output price, plus tool
 * fees. Tokens are estimated at three characters each, not the usual four, so
 * the bound stays above the real count for prose-heavy prompts.
 */
export function upperBoundUsd(model: string, inputChars: number, maxTokens: number, toolFeesUsd = 0): number {
  const p: Price = priceOf(model);
  const input = Math.ceil(inputChars / 3);
  return (input * writePrice(p) + maxTokens * p.output) / 1e6 + toolFeesUsd;
}

/** The characters a request sends, for the bound. */
export function requestChars(body: unknown): number {
  return JSON.stringify(body).length;
}


/* ------------------------------------------------------------- the call -- */

/** The ledger sink and attribution, injected so the budget logic stays testable without a database. */
export type Ledger = Pick<CollectOptions, "sink" | "attribution">;

/** What a paid step spent, call by call. */
export interface Spent {
  calls: SpendRecord[];
  usd: number;
}

/**
 * **What one call cost, in dollars, by the ledger's own rule** (`totalSpend`, src/ai-spend.ts):
 * the provider's figure, or for a BYOK call the upstream figure plus any fee — a BYOK call's
 * `usage.cost` is a legitimate 0 that is not free. `null` when nobody can say.
 */
export function recordUsd(r: SpendRecord): number | null {
  const { nanos, unpriced } = totalSpend([r]);
  return unpriced > 0 ? null : nanos / 1e9;
}
const usdOf = recordUsd;

/**
 * **One paid step, inside its own collector**: reserve, run, settle from what
 * the gateway recorded. Every call the step made is in the result (or on the
 * error, as `spent`), so a caller can read tokens, cache, generation id and
 * upstream off the very record the ledger got.
 *
 * Settling: the sum of the reported costs, and for a call with none —
 *
 * - **finished cleanly and reported no cost**: the run halts. Nothing went
 *   wrong that would explain the missing figure, so nothing after it can be
 *   trusted to be priced either.
 * - **cut off** — our own deadline or stall clock, or a stream that broke after
 *   the model had answered: settled at the step's whole upper bound, with a
 *   note. The figure is unknown but bounded, and the bound is already a
 *   worst case; halting would let one slow model stop the matrix.
 * - **refused before it answered** (`error`, no model named, no tokens):
 *   settled at zero with a note — OpenRouter does not bill a refusal.
 */
export async function paidStep<T>(
  budget: Budget,
  step: { id: string; label: string; boundUsd: number },
  ledger: Ledger,
  fn: () => Promise<T>,
): Promise<{ result: T; spent: Spent }> {
  budget.reserve(step.id, step.label, step.boundUsd);
  let calls: SpendRecord[] = [];
  let pending = 0;
  let threw: unknown;
  let result: T | undefined;
  try {
    const out = await collectSpend(fn, {
      ...(ledger.attribution ? { attribution: ledger.attribution } : {}),
      ...(ledger.sink ? { sink: ledger.sink } : {}),
      onDone: (report) => {
        calls = report.calls;
        pending = report.pending.length;
      },
    });
    result = out.result;
  } catch (err) {
    threw = err;
  }
  if (calls.length === 0 && pending === 0) {
    budget.release(step.id);
  } else {
    let usd = 0;
    let unknown: string | null = pending > 0 ? `${pending} call(s) never finished` : null;
    let bounded = false;
    const notes: string[] = [];
    for (const c of calls) {
      const cost = usdOf(c);
      if (cost !== null) {
        usd += cost;
        continue;
      }
      if (c.outcome === "ok") unknown = `${c.job} ${c.model} finished and reported no cost`;
      else if (c.outcome === "error" && c.answeredBy === null && !c.inputTokens && !c.outputTokens) {
        notes.push(`${c.model} refused before answering; settled at $0`);
      } else {
        bounded = true;
        notes.push(`${c.model} was cut off (${c.outcome}) with no cost reported; settled at the step's upper bound`);
      }
    }
    if (bounded) usd += step.boundUsd;
    budget.settle(step.id, unknown ? null : usd, unknown ?? (notes.join("; ") || undefined));
    if (threw !== undefined) {
      throw Object.assign(threw instanceof Error ? threw : new Error(String(threw)), { spent: { calls, usd } });
    }
    return { result: result as T, spent: { calls, usd } };
  }
  if (threw !== undefined) throw threw;
  return { result: result as T, spent: { calls, usd: 0 } };
}
