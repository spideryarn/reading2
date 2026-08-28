/**
 * The ledger as a file — one JSON object per line, appended and never rewritten.
 *
 * ## Why this exists at all, given the no-fallback rule
 *
 * [`index.ts`](index.ts) forbids catching a Postgres error and retrying against
 * the filesystem, because two stores that disagree is the divergence a parity
 * test cannot see. **This is not that.** Nothing here is a fallback: the flag
 * chooses one adapter at boot and the other is never consulted.
 *
 * The alternative considered and rejected was *always Postgres, warn and carry
 * on when there is no `DATABASE_URL`* — which sounds harmless and makes the
 * **default** configuration the untracked one. Every local run, every CLI stage,
 * every eval would spend real money and write a warn line that becomes
 * background noise within a week. GPT Sol's call, 2026-08-28, and it changed the
 * plan's own recommendation.
 *
 * ## Append-only, and the two things that does not give you for free
 *
 * A finished call is a fact about the past. Nothing amends a row, so there is no
 * read-modify-write and no locking between *readers* and writers.
 *
 * **Writes are serialised anyway, in this process.** The first version argued
 * that a line under the pipe buffer is atomic, and GPT Sol pointed out that the
 * pipe-buffer guarantee is about pipes: Node's own documentation says the
 * promise-based filesystem API is not synchronised, and nothing here establishes
 * that one `appendFile` is one `write(2)` on every filesystem. So it is a
 * promise chain — the same shape `jobs-fs.ts` uses — which costs nothing at this
 * volume and removes the argument. Two *processes* writing at once is still
 * unguarded, and that is written down rather than assumed away: `files` mode is
 * one laptop, and production refuses it outright ([index.ts](index.ts)).
 *
 * **A line that parses is not a row.** Skipping unparseable lines and counting
 * them was the first draft, and `{}` sails through it: valid JSON, a `startedAt`
 * of `undefined`, and a `NaN` in the next total. So the shape is checked too,
 * and anything that fails counts as unreadable rather than joining the
 * arithmetic. A truncated tail is what a killed process leaves; poisoned
 * arithmetic is what it would otherwise leave behind.
 */

import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { AiCallRow } from "../ai-spend.js";
import type { CostStore, LedgerRead } from "./contracts.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * Underscore-prefixed like `data/_jobs/`, so it can never collide with a slug.
 *
 * **A different file under test, and that is not tidiness.** Several suites
 * drive real requests through `handleApi`, which opens a collector with this
 * store behind it — so a full `npm test` wrote four hundred fixture calls into
 * the developer's own ledger, and `npm run cost` then reported eleven hundredths
 * of a cent that nobody had spent. Caught by running the report after the suite.
 * A ledger a test can write to is a ledger nobody can trust.
 *
 * **Resolved per call, not once at load.** A constant looks tidier and is a trap
 * for the tests that need to redirect it: ESM hoists static imports, so a test
 * setting the variable in its own `beforeAll` had already loaded this module —
 * through a transitive import three files away — and was silently writing to the
 * shared file it was trying to avoid. Found by watching that file grow.
 */
function ledger(): string {
  return (
    process.env.SPIDERYARN_LEDGER ??
    path.join(
      ROOT,
      "data",
      process.env.NODE_ENV === "test" ? "_ai-calls.test.jsonl" : "_ai-calls.jsonl",
    )
  );
}

/**
 * The tail of the write chain. Each append waits for the one before it, so two
 * concurrent calls in this process cannot interleave inside one line.
 */
let writing: Promise<void> = Promise.resolve();

/**
 * **Is this actually a row?** — the fields every total depends on.
 *
 * Deliberately not a full schema check. What it has to stop is a line that
 * parses and then contributes `NaN` or `undefined` to arithmetic; a row with an
 * unexpected extra field is a row from a newer version of this code and is not a
 * problem. Money is allowed to be `null` — that is `unpriced`, which is a
 * meaning rather than a fault.
 */
/**
 * **Fill in the 0023 columns on a line written before they existed.**
 *
 * The first version simply rejected those lines, and the count of them was
 * right there in the report as `unreadable` — 373 of them, a whole month of real
 * spend deleted from every total by a shape check that was meant to protect it.
 * GPT Sol ran the reader against the existing ledger and counted them.
 *
 * The backfill is not a guess: it is the same one
 * [migration 0023](../../drizzle/0023_ai_calls_cost_provenance.sql) applies to
 * the Postgres rows, and it is deterministic for the same reason. Every line
 * written before those columns came from a gateway that only talks to
 * OpenRouter, and `provider` means "OpenRouter answered at all" — which is why
 * this tests for `null` rather than for a non-zero number, since a BYOK zero is
 * an answer and not an absence.
 *
 * Mutating rather than returning a copy, because the caller has just parsed this
 * object out of one line and nothing else holds it.
 */
function backfillPre0023(r: Record<string, unknown>): void {
  if (r.providerAccount === undefined) r.providerAccount = "openrouter";
  if (r.costSource === undefined) {
    r.costSource = r.creditsUsedNanos == null ? "none" : "provider";
  }
  if (r.computedCostNanos === undefined) r.computedCostNanos = null;
  if (r.priceVersion === undefined) r.priceVersion = null;
}

function looksLikeRow(v: unknown): v is AiCallRow {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  backfillPre0023(r);
  const money = (x: unknown) => x === null || (typeof x === "number" && Number.isFinite(x));
  return (
    typeof r.id === "string" &&
    typeof r.runId === "string" &&
    typeof r.ownerId === "string" &&
    typeof r.startedAt === "string" &&
    typeof r.job === "string" &&
    (r.providerAccount === "openrouter" || r.providerAccount === "anthropic") &&
    (r.costSource === "provider" ||
      r.costSource === "computed" ||
      r.costSource === "none") &&
    money(r.creditsUsedNanos) &&
    money(r.computedCostNanos) &&
    money(r.upstreamInferenceNanos) &&
    /* **The exclusivity the database enforces with a CHECK, enforced here by
       reading it.** This store has no database, and `totalRows` adds
       `computed` in one branch and `credits` in another — a line carrying both
       would be counted twice, and one carrying neither while claiming a source
       would be counted as money that arrived. There is nothing else standing
       between a hand-edited JSONL line and a wrong total. */
    agrees(r)
  );
}

/**
 * A row's `cost_source` against the two numbers it is a claim about, and
 * `price_version` against whether we did the arithmetic.
 *
 * The same three cases as `ai_calls_one_cost_source` in migration 0023, so the
 * two stores cannot disagree about what a valid row is.
 */
function agrees(r: Record<string, unknown>): boolean {
  const credits = r.creditsUsedNanos !== null && r.creditsUsedNanos !== undefined;
  const computed = r.computedCostNanos !== null && r.computedCostNanos !== undefined;
  const version = typeof r.priceVersion === "string";
  if (r.costSource === "provider") return credits && !computed && !version;
  if (r.costSource === "computed") return !credits && computed && version;
  return !credits && !computed && !version;
}

export const fsCostStore: CostStore = {
  describe: () => ledger(),

  record(row: AiCallRow): Promise<void> {
    /* Chained, not awaited in place: the next caller queues behind this one
       whether or not it fails. A rejection is re-thrown to *this* caller — which
       is what makes `writeFailures` count — and swallowed for the chain, so one
       bad write does not poison every later one. */
    const at = ledger();
    const mine = writing.then(async () => {
      await mkdir(path.dirname(at), { recursive: true });
      await appendFile(at, `${JSON.stringify(row)}\n`, "utf8");
    });
    writing = mine.catch(() => undefined);
    return mine;
  },

  async read(since?: string, until?: string): Promise<LedgerRead> {
    let text: string;
    try {
      text = await readFile(ledger(), "utf8");
    } catch (err) {
      /* No file yet is no spend yet, which is an answer rather than a failure —
         a fresh checkout has to be able to run the report. Any other error is
         real and is not swallowed. */
      if ((err as NodeJS.ErrnoException).code === "ENOENT")
        return { rows: [], unreadable: 0 };
      throw err;
    }
    const rows: AiCallRow[] = [];
    let unreadable = 0;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        unreadable += 1;
        continue;
      }
      if (!looksLikeRow(parsed)) {
        unreadable += 1;
        continue;
      }
      const row = parsed;
      if (since && row.startedAt < since) continue;
      /* Half-open, like every range in this ledger: `until` is the first instant
         *not* included, so two adjacent months cannot both claim a call. */
      if (until && row.startedAt >= until) continue;
      rows.push(row);
    }
    return { rows, unreadable };
  },

  async forJob(jobId: string): Promise<LedgerRead> {
    /* **`unreadable` is carried through, not dropped.** The first version
       returned the rows alone, so a damaged line belonging to this job produced
       a short job total that looked confident. Raised by a GPT Sol review. */
    const { rows, unreadable } = await this.read();
    return { rows: rows.filter((r) => r.jobId === jobId), unreadable };
  },

  async size(): Promise<number | null> {
    try {
      return (await stat(ledger())).size;
    } catch {
      return null;
    }
  },
};
