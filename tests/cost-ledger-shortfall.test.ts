/**
 * **A ledger total that may be short has to say so** — `totalLedger` in
 * [src/store/ai-calls.ts](../src/store/ai-calls.ts), and the `lateCalls` field
 * every `LedgerRead` carries.
 *
 * The failure being pinned, exactly. A model call is added to the collector's
 * `active` map before the request goes out and only becomes a row when it
 * finishes (`beginSpend`/`recordSpend` in [src/ai-spend.ts](../src/ai-spend.ts)),
 * and `collectSpend` closes its box *before* draining the writes. So a call
 * still in flight when its collector reports gets no row at all, by design. A
 * `forJob` read afterwards therefore returns a set of rows that is silently
 * short, `unreadable: 0` and all — and on 2026-09-04 a run printed `$2.7331` as
 * the bill when the real figure was higher. It was a floor wearing a total's
 * clothes, and that is the whole subject of this file.
 *
 * `unreadable` cannot carry this. It means "a row exists and would not parse",
 * which is a *different* fact from "a row that should exist was never written",
 * and a reader has to be able to tell them apart — one is damage to the record,
 * the other is money that never reached it. Hence two fields, and a total that
 * cannot be read without both.
 *
 * ## Two halves, and the second one is against the store that ships
 *
 * The first block is arithmetic over `LedgerRead` values built by hand, and
 * needs nothing. The second drives the real mechanism — a collector, a call that
 * settles inside it and one that does not — into `costStore`, which since
 * 2026-09-05 is Postgres and only Postgres
 * ([src/store/ai-calls.ts](../src/store/ai-calls.ts) has no flag left to read).
 * It was written against `fsCostStore` for a day, which was a test of an adapter
 * nothing selects: `docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md`
 * § G is where that file goes, and a suite pinning behaviour to it would have
 * gone with it while the behaviour stayed unguarded.
 *
 * **A table cannot report a row that was never inserted**, which is the sharper
 * form of the same failure here than it was on a JSONL file: nothing in the
 * database is even damaged, so the only thing that can say the read is short is
 * the counter the collector bumped in this process.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import {
  type SpendRecord,
  beginSpend,
  collectSpend,
  lateCalls,
  providerCost,
  recordSpend,
  resetUnscopedCalls,
} from "../src/ai-spend.js";
import type { AiCallRow } from "../src/ai-spend.js";
import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { costStore, totalLedger } from "../src/store/ai-calls.js";
import type { LedgerRead } from "../src/store/contracts.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/** A row with the five fields the arithmetic reads; the rest is irrelevant here. */
const row = (over: Partial<AiCallRow> = {}): AiCallRow =>
  ({
    job: "hierarchy",
    isByok: false,
    costSource: "provider",
    creditsUsedNanos: 1_000,
    byokUpstreamNanos: null,
    computedCostNanos: null,
    ...over,
  }) as AiCallRow;

const read = (over: Partial<LedgerRead> = {}): LedgerRead => ({
  rows: [row()],
  unreadable: 0,
  lateCalls: 0,
  ...over,
});

describe("totalLedger", () => {
  it("hands back the money plainly when nothing is known to be missing", () => {
    const total = totalLedger(read());
    /* The narrowing is the point: `money` does not exist on the other arm, so a
       caller that prints a figure has already had to establish that the ledger
       was whole. */
    expect(total.complete).toBe(true);
    if (!total.complete) throw new Error("expected a complete total");
    expect(total.money.credits).toBe(1_000);
  });

  it("refuses to call a total a total when a row was never written", () => {
    const total = totalLedger(read({ lateCalls: 1 }));
    expect(total.complete).toBe(false);
    if (total.complete) throw new Error("expected an incomplete total");
    /* Named `atLeast`, not `money`: it is a lower bound, and the name is what
       stops it being quoted as a bill. */
    expect(total.atLeast.credits).toBe(1_000);
    expect(total.shortfall.lateCalls).toBe(1);
    expect(total.shortfall.unreadable).toBe(0);
  });

  it("keeps a damaged row and a missing one apart", () => {
    /* Two different facts. `unreadable` is a line on disk that will not parse —
       the money happened and the evidence is corrupt. `lateCalls` is a call that
       finished after its collector had reported — the money happened and there
       is no evidence at all. Merging them into one "incomplete" count would
       lose which of the two a reader has to go and look for. */
    const damaged = totalLedger(read({ unreadable: 2 }));
    if (damaged.complete) throw new Error("expected an incomplete total");
    expect(damaged.shortfall).toEqual({ unreadable: 2, lateCalls: 0 });

    const both = totalLedger(read({ unreadable: 2, lateCalls: 3 }));
    if (both.complete) throw new Error("expected an incomplete total");
    expect(both.shortfall).toEqual({ unreadable: 2, lateCalls: 3 });
  });

  it("says a total is short even when this job has no rows at all", () => {
    /* The worst case, and the one an early `rows.length === 0` return gets
       wrong: every call the job made was late, so the ledger has nothing for it
       and "spent nothing" and "we cannot see what it spent" look identical. */
    const total = totalLedger(read({ rows: [], lateCalls: 1 }));
    expect(total.complete).toBe(false);
  });
});

/** A plausible finished call, so `recordSpend` has something to be handed. */
function spend(over: Partial<SpendRecord> = {}): SpendRecord {
  return {
    job: "hierarchy",
    answeredBy: "anthropic/claude-sonnet-5",
    upstreamCostNanos: null,
    model: "anthropic/claude-sonnet-5",
    cost: providerCost(21_523_500),
    generationId: "gen-1787844432-JKwGQebcNXfkCfTX5mUq",
    upstream: "Anthropic",
    isByok: false,
    providerAccount: "openrouter",
    credentialFingerprint: "abcdef012345",
    wire: "messages",
    inputTokens: 13,
    outputTokens: 4,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    reasoningTokens: 0,
    webSearches: null,
    serviceTier: "standard",
    inferenceGeo: null,
    ms: 1200,
    outcome: "ok",
    ...over,
  } as SpendRecord;
}

/* ------------------------------- the ledger that actually meters money -- */

/**
 * **Both the table and the columns `costStore.record` will touch**, not only
 * the ones asserted on. `pgCostStore.record` writes every field of `AiCallRow`,
 * so a database carrying one of the two 2026-09-02 migrations and not the other
 * fails inside the store with a bare `42703 column does not exist`, which says
 * nothing about what to run. tests/helpers/pg-ready.ts § why it is parameterised.
 *
 * `auth.users` because the row's `owner_id` is a foreign key into it: without
 * the seeded local owner the sink writes no row at all, and this file's central
 * assertion — a row that IS there beside one that never will be — would go red
 * for a reason that is not its subject.
 */
await pgReady({
  suite: "tests/cost-ledger-shortfall.test.ts",
  tables: ["spideryarn.ai_calls", "auth.users"],
  columns: [
    { table: "spideryarn.ai_calls", column: "credits_used_nanos" },
    { table: "spideryarn.ai_calls", column: "byok_upstream_nanos" },
    { table: "spideryarn.ai_calls", column: "realtime_session_id" },
  ],
});

/**
 * One collector, one call that settles inside it and one that does not.
 *
 * Driven rather than stubbed, and driven all the way into the store: the sink
 * is `costStore`, so the settled call becomes a real row in the run's private
 * database and the late one becomes nothing at all. That asymmetry is the whole
 * point — a total built from what came back is a **floor**, and there is no
 * query that could have known.
 *
 * The `.then` is what makes the async context right. A continuation chained
 * inside the collector carries its scope, closed or not, which is what makes
 * this a *late* call rather than an unscoped one. Copied from
 * tests/ai-spend.test.ts, where the same shape pins `lateCalls()` itself.
 */
async function oneSettledAndOneLate(jobId: string): Promise<void> {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let dangling: Promise<void> | null = null;
  await collectSpend(
    async () => {
      /* Settles inside the box, so `collectSpend` awaits its write before it
         returns and the row is in Postgres by the time we read. */
      recordSpend(spend(), beginSpend("hierarchy", "m"));
      /* Does not. Same job, same collector, and no row anywhere. */
      const late = beginSpend("hierarchy", "m");
      dangling = gate.then(() => recordSpend(spend(), late));
    },
    {
      sink: (row) => costStore.record(row),
      /* `currentOwnerId()` rather than a uuid of this file's own: the private
         database seeds the local accounts and nothing else, so a hand-written
         owner fails the `auth.users` foreign key. */
      attribution: {
        scopeKind: "job_step",
        ownerId: currentOwnerId(),
        jobId,
        stepName: "hierarchy",
      },
    },
  );
  release();
  await dangling;
}

describe("the Postgres ledger's account of what it cannot see", () => {
  /* Minted per run rather than written out, so this file cannot collide with
     itself in two processes — tests/fixture-ids.test.ts § the same file, in two
     processes, which no static guard can see. */
  const JOB = `job-late-${randomUUID()}`;
  const WHOLE = `job-late-${randomUUID()}`;

  /* Nothing is deleted: the private lane mints a database for the run and drops
     it whole afterwards (tests/setup/private-db-global.ts), so a suite that
     failed halfway leaves nothing behind because there is nowhere to leave it.
     Cleaning up by hand here would hide a teardown that had stopped working. */
  afterAll(async () => {
    await closeDb();
  });

  beforeEach(() => resetUnscopedCalls());

  it("reports a call that finished after its collector as a row it will never have", async () => {
    await oneSettledAndOneLate(JOB);
    expect(lateCalls()).toBe(1);

    const found = await costStore.forJob(JOB);
    /* **The settled call is here and the late one is not**, and that is the
       control as much as the claim: a read that came back empty would satisfy
       "the total is short" while proving only that nothing had been written. */
    expect(found.rows.map((r) => r.stepName)).toEqual(["hierarchy"]);
    /* Nothing in a table can be unreadable — a row either parsed on the way in
       or was never written — so this is the field that CANNOT carry the fact,
       asserted so that the two stay told apart. */
    expect(found.unreadable).toBe(0);
    expect(found.lateCalls).toBe(1);

    const total = totalLedger(found);
    expect(total.complete).toBe(false);
    if (total.complete) throw new Error("expected an incomplete total");
    /* **`$2.7331` was this number.** It is real money and it is a lower bound,
       and the only thing that stopped it being printed as a bill is that it
       arrives under a name that is not `money`. */
    expect(total.atLeast.credits).toBe(21_523_500);
    expect(total.shortfall).toEqual({ unreadable: 0, lateCalls: 1 });
  });

  it("reports a whole ledger read the same way", async () => {
    /* `read()` as well as `forJob()`, because the CLI report prints off the
       first one and a caveat that only reaches one of the two is a caveat
       somebody will one day not see. */

    /* **The control, and it is not decoration.** With the counter reset and
       nothing late yet, a whole-ledger read is a total — including over
       whatever rows earlier files in this lane's database left behind. Without
       this line the verdict below would hold for a suite in which `lateCalls`
       had never worked at all. */
    expect(totalLedger(await costStore.read()).complete).toBe(true);

    await oneSettledAndOneLate(WHOLE);

    const whole = await costStore.read();
    expect(whole.unreadable).toBe(0);
    expect(whole.lateCalls).toBe(1);
    expect(whole.rows.some((r) => r.jobId === WHOLE)).toBe(true);
    expect(totalLedger(whole).complete).toBe(false);
  });
});
