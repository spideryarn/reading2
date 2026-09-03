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
import { processSingleton } from "../process-state.js";
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
 *
 * **Kept on the process, not in this module**, because it is a lock and
 * src/process-state.ts says what a second copy of one is worth: not a slower
 * lock, no lock at all. A dev-server restart makes that second copy — every
 * server module is a vite.config.ts dependency, so saving any of them
 * re-evaluates this file with a fresh `Promise.resolve()` while the request
 * that was already recording a call is still chained to the old one, and the
 * two appends then race. `tests/store-fs-write-chains.test.ts` holds one copy's
 * write and checks the other's has not started.
 *
 * **The exposure is small and worth saying plainly.** Production runs
 * `SPIDERYARN_STORE=postgres`, where `selected()` in ai-calls.ts never reaches
 * this adapter, so what is at risk is a developer's own
 * `data/_ai-calls.jsonl`. It is fixed anyway because the machinery already
 * exists and this is the third named instance of a class the repo has now fixed
 * twice — docs/postmortems/260902c-the-truncation-retry-cost-storm.md converted
 * `QueueState` and `aborts`, and
 * docs/plans/260902g-cost-tracking-that-can-set-a-price.md wrote this one down
 * as left out of scope. A diagnosed instance left in place is how the fourth
 * one gets written.
 *
 * A one-field object rather than the bare promise, because the value is
 * reassigned on every write and `processSingleton` hands back a reference: what
 * both copies have to share is the *slot*, not the promise that is in it today.
 * Bump the version if that field is renamed or joined by another; never the
 * name, which would be a second lock universe with the first writer still
 * inside the old one.
 */
const chain = processSingleton<{ writing: Promise<void> }>(
  "ai-calls-fs",
  "2026-09-03-writing",
  () => ({ writing: Promise.resolve() }),
);

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

/**
 * **Translate a line written before the BYOK rename, and drop the double
 * count while doing it.**
 *
 * Until 2026-09-02 the field was called `upstreamInferenceNanos` and was
 * written on **every** chat-wire call, because that is what OpenRouter reports:
 * on an ordinary call `cost_details.upstream_inference_cost` equals `cost`, so
 * the line carried the same money twice. `data/_ai-calls.jsonl` is append-only
 * and is never rewritten, so every one of those lines is still there — renaming
 * the property without this would make the whole historical ledger
 * `unreadable`, which is the accident `backfillPre0023` above exists because of.
 *
 * **Only for the BYOK pocket, and that is three conditions rather than one.** On
 * a BYOK row the old value is the real money and carries straight over. On any
 * other row it was the duplicate, and carrying it over would preserve the very
 * defect the rename was for — so it becomes `null`, exactly as
 * [migration 20260902141103](../../drizzle/20260902141103_byok_upstream_nanos.sql) does to the
 * Postgres rows. `=== true` rather than truthy because `isByok` is
 * `boolean | null` and "we were not told" is not "yes".
 *
 * ## The predicate is copied whole, because a two-thirds copy loses rows
 *
 * This tested only `isByok === true` until 2026-09-03, and the migration
 * additionally requires `cost_source = 'provider'` and
 * `provider_account = 'openrouter'`. The gap is a shape the historical parser
 * really could produce, because the gateway captured those fields
 * independently: a BYOK call for which no `cost` figure ever arrived backfills
 * to `cost_source: 'none'` and *still* carries an upstream value. Keeping that
 * value made the row fail `agrees()` below — an upstream figure on a
 * non-`provider` row — so the reader counted a line of real history as
 * **unreadable**, where the migration would have nulled the value and kept the
 * row. GPT Sol found it. Two stores must not disagree about what a valid row is,
 * and the store that disagrees quietly is the one that loses the data.
 *
 * Ordering matters and is not incidental: `backfillPre0023` has to have run
 * first, because on a pre-0023 line `cost_source` and `provider_account` do not
 * exist yet and this has to read what that backfill decided — which is the same
 * thing the migration's own `UPDATE` reads, for the same reason.
 *
 * The old key is deleted rather than left alongside, so a round-tripped row
 * equals the row that was written and nothing downstream can read the stale
 * name by accident.
 */
function translateByokUpstream(r: Record<string, unknown>): void {
  if (!("upstreamInferenceNanos" in r)) return;
  const old = r.upstreamInferenceNanos;
  delete r.upstreamInferenceNanos;
  if (r.byokUpstreamNanos !== undefined) return;
  const isByokPocket =
    r.isByok === true && r.costSource === "provider" && r.providerAccount === "openrouter";
  r.byokUpstreamNanos = isByokPocket ? old : null;
}

/**
 * **Fill in the realtime block on a line written before it existed.**
 *
 * Same move as `backfillPre0023`, same reason, and the reason is worth stating
 * once more because it is the one that keeps catching people: this ledger is
 * append-only and never rewritten, so every line ever written is still in the
 * file. A property that arrives on `AiCallRow` and is merely *absent* from an
 * old line is `undefined` at runtime where the type says `| null` — which
 * nothing notices until something writes `?? 0` or serialises the row back out
 * and the two shapes stop matching.
 *
 * `null` rather than a guess, and that is the honest value: a call made before
 * live conversation existed had no session, no modality split and no
 * transcription seconds. There is nothing to reconstruct.
 */
function backfillRealtime(r: Record<string, unknown>): void {
  for (const key of [
    "realtimeSessionId",
    "providerEventId",
    "eventKind",
    "providerStatus",
    "inputTextTokens",
    "inputAudioTokens",
    "inputImageTokens",
    "cachedTextTokens",
    "cachedAudioTokens",
    "outputTextTokens",
    "outputAudioTokens",
    "transcriptionSeconds",
  ]) {
    if (r[key] === undefined) r[key] = null;
  }
  /* **`durationMs` became nullable in the same change** (src/ai-spend.ts says
     why), so an old line that has one keeps it and a hypothetical line without
     one reads as unknown rather than as a `0` that would drag a latency average
     down. */
  if (r.durationMs === undefined) r.durationMs = null;
}

function looksLikeRow(v: unknown): v is AiCallRow {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  backfillPre0023(r);
  backfillRealtime(r);
  /* Before the shape check, not after it: an untranslated line fails
     `money(r.byokUpstreamNanos)` on an `undefined`, and would be counted as
     damage rather than as history. */
  translateByokUpstream(r);
  const money = (x: unknown) => x === null || (typeof x === "number" && Number.isFinite(x));
  return (
    typeof r.id === "string" &&
    typeof r.runId === "string" &&
    typeof r.ownerId === "string" &&
    typeof r.startedAt === "string" &&
    typeof r.job === "string" &&
    /* **All three accounts, and this list is a trap that has already sprung
       once.** It read `openrouter || anthropic` until 2026-09-02, so the day
       live conversation started writing `openai` rows every one of them would
       have been counted `unreadable` and dropped from the total — the shape of
       failure this whole reader is organised against, arriving through its own
       shape check. It mirrors `ai_calls_provider_account_known` in Postgres,
       which had the same two-member list and needed the same widening
       (drizzle/20260902150952_realtime_sessions_and_usage.sql). Two hand-written
       copies of one union; `ProviderAccount` in src/ai-spend.ts is the third. */
    (r.providerAccount === "openrouter" ||
      r.providerAccount === "anthropic" ||
      r.providerAccount === "openai") &&
    (r.costSource === "provider" ||
      r.costSource === "computed" ||
      r.costSource === "none") &&
    money(r.creditsUsedNanos) &&
    money(r.computedCostNanos) &&
    money(r.byokUpstreamNanos) &&
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
  /* **And the BYOK pocket's own rule**, which is `ai_calls_byok_upstream_only`
     in the BYOK migration — the same three conditions, so a JSONL line and a
     Postgres row cannot disagree about what a valid row is. A line carrying an
     upstream figure on a non-BYOK row is the pre-rename double count, and
     `translateByokUpstream` above has already removed it from anything this
     reader wrote; what is left for this to catch is a hand-edited line. */
  if (r.byokUpstreamNanos !== null && r.byokUpstreamNanos !== undefined) {
    if (r.costSource !== "provider") return false;
    if (r.isByok !== true) return false;
    if (r.providerAccount !== "openrouter") return false;
  }
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
    const mine = chain.writing.then(async () => {
      await mkdir(path.dirname(at), { recursive: true });
      await appendFile(at, `${JSON.stringify(row)}\n`, "utf8");
    });
    chain.writing = mine.catch(() => undefined);
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
    /* **Keyed by row id, because a lost acknowledgement appends the line
       twice.** `AiCallRow.id` is minted before the request goes out, and for a
       realtime turn it is *derived from the event* precisely so that a retry
       collides — which is what `on conflict do nothing` absorbs on the Postgres
       store. This one is a file with no unique index, so both lines are on disk
       and both used to come back, and `totalRows()` counted the money twice.
       Double-counting is the direction that looks exactly like the thing being
       measured, so it is the one worth being deliberate about. GPT Sol, 2026-09-03.

       Collapsed on the way OUT rather than on the way in: the file stays
       append-only and is never rewritten, so the evidence that two writes
       happened survives on disk while what the ledger *says* matches what
       Postgres would say about the same events.

       **The last line wins**, which matters only for the case a genuine retry
       does not produce: two lines sharing an id and differing in content. This
       file is a log, and the later entry is the more recent statement about the
       same call. A `Map` also keeps first-seen insertion order, so a row does
       not move down the file because it was written twice. */
    const byId = new Map<string, AiCallRow>();
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
      byId.set(row.id, row);
    }
    return { rows: [...byId.values()], unreadable };
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
