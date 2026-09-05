/**
 * The Postgres searches store, held to `src/searches.ts`'s semantics — and to
 * the one thing the filesystem cannot do.
 *
 * The assertions worth having are the ones with a way to go red. A retry that
 * leaves the failed attempt's error sitting under a fresh answer; a trim that
 * deletes the run it has just inserted; a sweep that emits `not in ()` and
 * 500s on the first read of a quiet article; and the fence — a model call that
 * another process already declared dead writing its stale answer over the retry
 * the reader is watching.
 *
 * ## Why it builds its own article
 *
 * An `articles` row with **no `current_revision_id`**, so `listArticles` cannot
 * see it and tests/store-parity.test.ts cannot be made flaky by it. Same trick
 * as tests/store-comments.test.ts, same reason.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, searchRuns } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { isSpideryarnId } from "../src/ids.js";
import { kindOfMessage, providerHttpFailure, worthRetrying } from "../src/messages.js";
import { MAX_RUNS } from "../src/searches.js";
import { pgSearchStore } from "../src/store/pg-searches.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const SLUG = "store-searches-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000d0";
const NONE: ReadonlySet<string> = new Set();

/**
 * Every literal id this file hands to the store, checked against the real
 * alphabet.
 *
 * The alphabet drops `i`, `l`, `o` and `1` so an id read aloud is unambiguous —
 * which means `spya-aaa001` **is not an id**, and a store handed one mints a
 * different one instead of complaining. That is correct behaviour (a client's
 * guess is a suggestion, not an instruction) and it quietly turned two tests
 * here into tests of something else: the tie-break test compared two minted
 * ids and passed for no reason. Asserted rather than remembered.
 */
const FIXTURE_IDS = [
  "spya-runaa2",
  "spya-runbb2",
  "spya-runcc2",
  "spya-aaa002",
  "spya-zzz002",
] as const;

await pgReady({
  suite: "tests/store-searches-pg.test.ts",
  tables: ["spideryarn.search_runs"],
});

/** A clock the test drives, so `createdAt` is a fact rather than a race. */
function clockFrom(startMs: number, stepMs = 1000): () => string {
  let n = 0;
  return () => new Date(startMs + stepMs * n++).toISOString();
}

describe("the Postgres searches store", () => {
  it("uses fixture ids the store will actually accept", () => {
    for (const id of FIXTURE_IDS) {
      expect(isSpideryarnId(id), `${id} is not a valid id, so the store would mint another`).toBe(
        true,
      );
    }
  });

  beforeAll(async () => {
    await getDb()
      .insert(articles)
      // No `currentRevisionId`, so the library cannot see it. See the header.
      .values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG })
      .onConflictDoNothing();
  });

  afterEach(async () => {
    await getDb().delete(searchRuns).where(eq(searchRuns.articleId, ARTICLE_ID));
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(searchRuns).where(eq(searchRuns.articleId, ARTICLE_ID));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
  });

  it("records a pending run before the model is called", async () => {
    const { run, attempt } = await pgSearchStore.begin(SLUG, "about time");
    expect(run.status).toBe("pending");
    expect(run.hits).toEqual([]);
    // Absent, not null: the wire form of `{model: null}` is not `{}`.
    expect("model" in run).toBe(false);
    expect("error" in run).toBe(false);
    // The attempt is the whole point of this store. Files return undefined.
    expect(attempt).toBeTruthy();
  });

  it("resets a failed run rather than minting a second one — all three conditions", async () => {
    const { run, attempt } = await pgSearchStore.begin(SLUG, "about time", "spya-runaa2");
    await pgSearchStore.finish(SLUG, run.id, { status: "error", error: "the model fell over" }, attempt);

    const again = await pgSearchStore.begin(SLUG, "about time", run.id);
    expect((await pgSearchStore.load(SLUG)).length).toBe(1);
    expect(again.run.id).toBe(run.id);
    expect(again.run.status).toBe("pending");
    /* **The failed attempt's error must not survive.** `withRun` rebuilds the
       run field by field precisely so it cannot, and the obvious UPDATE — set
       status and nothing else — leaves the old error sitting under whatever
       answer arrives next. */
    expect("error" in again.run).toBe(false);
    expect("model" in again.run).toBe(false);
    expect(again.run.hits).toEqual([]);
    // Still the same question, so the same clock. Opposite of a chat retry.
    expect(again.run.createdAt).toBe(run.createdAt);
  });

  it("does not reset a run that is done, or one asking a different question", async () => {
    const { run, attempt } = await pgSearchStore.begin(SLUG, "about time", "spya-runbb2");
    await pgSearchStore.finish(SLUG, run.id, { status: "done", hits: [] }, attempt);

    // A double-clicked POST, or a stale tab retrying after another tab won.
    const second = await pgSearchStore.begin(SLUG, "about time", run.id);
    expect(second.run.id).not.toBe(run.id);

    // Same id, different question: still a collision, still a new id.
    const third = await pgSearchStore.begin(SLUG, "about something else", run.id);
    expect(third.run.id).not.toBe(run.id);
    expect((await pgSearchStore.load(SLUG)).find((r) => r.id === run.id)?.status).toBe("done");
  });

  it("keeps exactly the newest MAX_RUNS when the clock runs forwards", async () => {
    /* The ordinary case, and the first version of these tests did not cover it:
       it only checked that each insertion survived its own transaction, which
       an implementation that deletes the *previous* row every time also
       satisfies. This pins the surviving set. */
    const start = Date.parse("2026-08-01T00:00:00.000Z");
    const ids: string[] = [];
    for (let i = 0; i < MAX_RUNS + 3; i++) {
      const at = () => new Date(start + i * 60_000).toISOString();
      const { run } = await pgSearchStore.begin(SLUG, `criterion ${i}`, undefined, at);
      ids.push(run.id);
    }
    const kept = (await pgSearchStore.load(SLUG)).map((r) => r.id);
    expect(kept).toEqual(ids.slice(-MAX_RUNS));
  });

  it("never trims the run it just inserted, even when the clock runs backwards", async () => {
    /* The clock runs BACKWARDS, which is the case that matters. The file keeps
       the last thirty array elements; this keeps the thirty newest by
       timestamp, and a newly inserted run with an older timestamp would trim
       itself — the model call then finishes into a row that is gone, and the
       reader gets a 404 for a search they are watching. */
    const ids: string[] = [];
    for (let i = 0; i < MAX_RUNS + 3; i++) {
      const at = clockFrom(Date.parse("2026-08-01T00:00:00.000Z") + (MAX_RUNS + 3 - i) * 60_000);
      const { run } = await pgSearchStore.begin(SLUG, `criterion ${i}`, undefined, at);
      ids.push(run.id);
      // The run just written is always still there, whatever its timestamp.
      const after = await pgSearchStore.load(SLUG);
      expect(after.map((r) => r.id), `run ${i} trimmed itself`).toContain(run.id);
      expect(after.length).toBeLessThanOrEqual(MAX_RUNS);
    }
    expect((await pgSearchStore.load(SLUG)).length).toBe(MAX_RUNS);
  });

  it("sweeps nothing, loudly, when the article has no runs at all", async () => {
    /* Raw SQL `not in ()` is a syntax error rather than "matches everything",
       and this was expected to be the likeliest 500 in the whole store. It is
       not: Drizzle folds `notInArray(col, [])` to the literal `true`, measured
       by printing the SQL. The assertion stays anyway — the behaviour is worth
       pinning whatever the reason it works, and the first read of a quiet
       article is the commonest call this store gets. */
    await expect(pgSearchStore.sweepPending(SLUG, { keep: NONE, graceMs: 1000 })).resolves.toEqual(
      [],
    );
    const { run } = await pgSearchStore.begin(SLUG, "about time");
    await expect(
      pgSearchStore.sweepPending(SLUG, { keep: NONE, graceMs: 60_000 }),
    ).resolves.toHaveLength(1);
    expect((await pgSearchStore.load(SLUG))[0]?.id).toBe(run.id);
  });

  it("spares a young attempt from another process, and buries an old one", async () => {
    const { run } = await pgSearchStore.begin(SLUG, "about time");

    // Young: some other process may still be on it. This is the case the
    // filesystem store gets wrong, and the reason `graceMs` exists.
    await pgSearchStore.sweepPending(SLUG, { keep: NONE, graceMs: 60_000 });
    expect((await pgSearchStore.load(SLUG))[0]?.status).toBe("pending");

    /* Old enough that the lease has expired. That is NOT the same as "nobody
       can still be on it" — an earlier version of this comment said so and was
       wrong. There is no heartbeat: a model call that outlives `graceMs` is
       still running somewhere, and the sweep will bury it. What the fence
       guarantees is narrower and is the thing that matters — the buried
       attempt cannot then overwrite the retry. Choosing a `graceMs` longer
       than any hard model timeout is the other half, and it belongs to
       whatever wires this up. */
    await getDb()
      .update(searchRuns)
      .set({ attemptStartedAt: new Date(Date.now() - 600_000) })
      .where(and(eq(searchRuns.articleId, ARTICLE_ID), eq(searchRuns.id, run.id)));
    const swept = await pgSearchStore.sweepPending(SLUG, { keep: NONE, graceMs: 60_000 });
    expect(swept[0]?.status).toBe("error");
  });

  it("spares this process's own work however old it is", async () => {
    const { run } = await pgSearchStore.begin(SLUG, "about time");
    await getDb()
      .update(searchRuns)
      .set({ attemptStartedAt: new Date(Date.now() - 600_000) })
      .where(and(eq(searchRuns.articleId, ARTICLE_ID), eq(searchRuns.id, run.id)));
    // A search this server has genuinely been streaming for ten minutes must
    // not be killed by this same server.
    const after = await pgSearchStore.sweepPending(SLUG, {
      keep: new Set([run.id]),
      graceMs: 60_000,
    });
    expect(after[0]?.status).toBe("pending");
  });

  it("refuses a finish from an attempt that is no longer the live one", async () => {
    /* The race this store exists for, in four lines:
         1. process A begins a run
         2. process B's sweep declares it dead
         3. the reader retries — a NEW attempt on the same run
         4. A's model call finally returns
       Step 4 must not land. Fenced on identity alone it would, and the reader
       would watch their retry be replaced by the answer that already failed. */
    const first = await pgSearchStore.begin(SLUG, "about time");
    await getDb()
      .update(searchRuns)
      .set({ attemptStartedAt: new Date(Date.now() - 600_000) })
      .where(eq(searchRuns.articleId, ARTICLE_ID));
    await pgSearchStore.sweepPending(SLUG, { keep: NONE, graceMs: 60_000 });

    const retried = await pgSearchStore.begin(SLUG, "about time", first.run.id);
    expect(retried.attempt).not.toBe(first.attempt);

    const late = await pgSearchStore.finish(
      SLUG,
      first.run.id,
      { status: "done", hits: [], model: "stale-model" },
      first.attempt,
    );
    // Zero rows, reported as `undefined`, which the route already answers 404 for.
    expect(late).toBeUndefined();
    const now = (await pgSearchStore.load(SLUG))[0];
    expect(now?.status).toBe("pending");
    expect("model" in (now ?? {})).toBe(false);

    // And the live attempt still lands.
    const good = await pgSearchStore.finish(
      SLUG,
      first.run.id,
      { status: "done", hits: [], model: "live-model" },
      retried.attempt,
    );
    expect(good?.model).toBe("live-model");
  });

  it("refuses a finish with no attempt at all", async () => {
    /* The token is optional in the interface, because the filesystem store has
       none. Accepting `undefined` HERE would put the whole cross-process race
       back for any caller that forgot to carry it — silently, which is the
       failure mode this migration keeps meeting. */
    const { run } = await pgSearchStore.begin(SLUG, "about time");
    await expect(
      pgSearchStore.finish(SLUG, run.id, { status: "done", hits: [] }),
    ).rejects.toThrow(/needs the attempt/);
    expect((await pgSearchStore.load(SLUG))[0]?.status).toBe("pending");
  });

  it("refuses a finish that does not end the run", async () => {
    /* The attempt is released whatever the patch says, so a patch leaving the
       run `pending` would strip the fence off a row still waiting for an
       answer — and anybody's late write could then land on it. */
    const { run, attempt } = await pgSearchStore.begin(SLUG, "about time");
    await expect(
      pgSearchStore.finish(SLUG, run.id, { hits: [] }, attempt),
    ).rejects.toThrow(/must end a run/);
    await expect(
      pgSearchStore.finish(SLUG, run.id, { status: "pending" }, attempt),
    ).rejects.toThrow(/must end a run/);
  });

  /* ---- ported from tests/searches.test.ts, 2026-09-05 ----------------------
     § *a failure survives being written down and read back*. It went through
     `beginRun`/`finishRun` on the filesystem side; those went with the
     filesystem store
     (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
     the stage-G section) and the claim had no home on this side at all.

     The gap it closes: every other test of `kindOfMessage` hands it a message
     straight from the factory, so all of them would keep passing if something
     between the throw and the screen decorated the string — `Search failed:
     ${msg} — tap to retry` is the plausible one, and it would move the bracket
     off the end and silently turn every permanent failure back into a Retry
     button. Nothing about that has a symptom. So this one goes through the real
     path: store the failure the way the route does, read it back out of
     Postgres, and ask the question the panel asks. */

  it("still knows a topped-out account cannot be retried, after a round trip", async () => {
    const permanent = providerHttpFailure(402);
    expect(worthRetrying(permanent.message)).toBe(false); // before the round trip

    const { run, attempt } = await pgSearchStore.begin(SLUG, "does this survive a write");
    await pgSearchStore.finish(
      SLUG,
      run.id,
      { status: "error", error: permanent.message },
      attempt,
    );

    const stored = (await pgSearchStore.load(SLUG)).find((r) => r.id === run.id);
    expect(stored?.status).toBe("error");
    expect(worthRetrying(stored?.error)).toBe(false);
    expect(kindOfMessage(stored?.error ?? "")).toBe("ours");
  });

  it("still offers another go for a transient one, after a round trip", async () => {
    const { run, attempt } = await pgSearchStore.begin(SLUG, "and the other direction");
    await pgSearchStore.finish(
      SLUG,
      run.id,
      { status: "error", error: providerHttpFailure(429).message },
      attempt,
    );
    const stored = (await pgSearchStore.load(SLUG)).find((r) => r.id === run.id);
    expect(worthRetrying(stored?.error)).toBe(true);
  });

  it("never lets a patch rename a run or change its question", async () => {
    const { run, attempt } = await pgSearchStore.begin(SLUG, "about time");
    await pgSearchStore.finish(
      SLUG,
      run.id,
      { id: "spya-other0", criterion: "something else", status: "done" } as never,
      attempt,
    );
    const stored = (await pgSearchStore.load(SLUG))[0];
    expect(stored?.id).toBe(run.id);
    expect(stored?.criterion).toBe("about time");
  });

  it("returns runs oldest first, with the id breaking a tie", async () => {
    /* One clock for both, so the timestamps collide on purpose. Without the
       `id` tie-break these two swap places between requests, and the exporter
       and this store then disagree about array order — which shows up as the
       round-trip test failing for a reason that is not a bug. */
    /* **Inserted in reverse id order on purpose.** The first version wrote
       `aaa` then `bbb` — already sorted — so removing the tie-break entirely
       still passed, in insertion order. Now insertion order and id order
       disagree, and only the tie-break gives the right answer. */
    const fixed = () => "2026-08-01T00:00:00.000Z";
    await pgSearchStore.begin(SLUG, "second", "spya-zzz002", fixed);
    await pgSearchStore.begin(SLUG, "first", "spya-aaa002", fixed);
    const order = (await pgSearchStore.load(SLUG)).map((r) => r.id);
    expect(order).toEqual(["spya-aaa002", "spya-zzz002"]);
  });

  /**
   * The article a saved run was answered against, through the Postgres half.
   *
   * `search_runs.source_hash` is what lets the panel say a search is out of
   * date. A column the store forgets to write, or forgets to read back, fails
   * in the quietest possible way: `isStale` counts a missing hash as stale, so
   * the banner appears on every saved search for ever and nothing anywhere
   * reports an error. See docs/project/search.md § A saved search says which
   * article it answered.
   *
   * This fixture article deliberately has **no revision** (see the header), so
   * the store has no blocks to fingerprint. That makes it the right place to
   * pin the `undefined` end of the contract; the two stores agreeing on a real
   * article's hash is tests/store-parity.test.ts, which has real articles in
   * both.
   */
  describe("the colour the reader picked", () => {
    it("stores it, and clears it back to absent rather than to null", async () => {
      const { run } = await pgSearchStore.begin(SLUG, "about time");
      const set = await pgSearchStore.recolour(SLUG, run.id, 5);
      expect(set.find((r) => r.id === run.id)?.colour).toBe(5);

      /* Absent, not `colour: null`. The column is nullable and the wire form of
         a null is not `{}` — the same rule `model` and `error` follow two
         methods up, and the one a `toRun` written with a spread gets wrong. */
      const cleared = await pgSearchStore.recolour(SLUG, run.id, null);
      const row = cleared.find((r) => r.id === run.id);
      expect(row && "colour" in row).toBe(false);
    });

    it("keeps slot 0, which every truthiness check in this feature would drop", async () => {
      const { run } = await pgSearchStore.begin(SLUG, "the first hue");
      const set = await pgSearchStore.recolour(SLUG, run.id, 0);
      expect(set.find((r) => r.id === run.id)?.colour).toBe(0);
    });

    it("colours a run that is still running, and does not disturb the attempt", async () => {
      /* The one write in this file with no fence on it, deliberately: a colour
         is not part of the answer, so recolouring a `pending` row must not
         make the model call that is in flight unfinishable. */
      const { run, attempt } = await pgSearchStore.begin(SLUG, "about time");
      await pgSearchStore.recolour(SLUG, run.id, 2);
      const done = await pgSearchStore.finish(
        SLUG,
        run.id,
        { status: "done", hits: [] },
        attempt,
      );
      expect(done?.status).toBe("done");
      expect(done?.colour).toBe(2);
    });

    it("shrugs at a run that is not there", async () => {
      const { run } = await pgSearchStore.begin(SLUG, "about time");
      // A second tab can have deleted it. The list that comes back says so.
      await expect(pgSearchStore.recolour(SLUG, "spya-zzzzzz", 4)).resolves.toHaveLength(1);
      expect((await pgSearchStore.load(SLUG))[0]?.id).toBe(run.id);
    });

    it("survives a retry, on this side as well as on the filesystem's", async () => {
      /* The two stores have to agree, and they did not: the filesystem's retry
         rebuilds the run field by field and was dropping the colour, while this
         one simply does not name the column and kept it. Pinned on both sides
         so a future tidy-up of either cannot quietly restore the divergence. */
      const { run, attempt } = await pgSearchStore.begin(SLUG, "about time", "spya-runab2");
      await pgSearchStore.recolour(SLUG, run.id, 4);
      await pgSearchStore.finish(SLUG, run.id, { status: "error", error: "fell over" }, attempt);

      const again = await pgSearchStore.begin(SLUG, "about time", run.id);
      expect(again.run.id).toBe(run.id);
      expect(again.run.status).toBe("pending");
      expect(again.run.colour).toBe(4);
    });

    it("refuses a bad colour as a 400, rather than as a database failure", async () => {
      /* The check constraint is the second line and stays. But a store that
         relied on it alone would answer a bad value with a `StoreFailure` —
         "this app asked its database for something it would not do" — where the
         filesystem store answers with a 400, and two stores disagreeing about
         what a bad request *is* is exactly what a parity test on the happy path
         never sees. */
      const { run } = await pgSearchStore.begin(SLUG, "about time");
      for (const bad of [64, -1, 2.5]) {
        await expect(pgSearchStore.recolour(SLUG, run.id, bad)).rejects.toThrow(
          /storable colour/,
        );
      }
    });

    it("lets the database refuse a slot no palette will ever have", async () => {
      /* The route checks this first (`isStorableColour`), so the constraint is
         the second line rather than the first — and it is worth having anyway,
         because the import path writes this column too and does not go through
         a route. The bound is loose on purpose: see drizzle/0016_search_colour.sql. */
      const { run } = await pgSearchStore.begin(SLUG, "about time");
      /* Straight at the table, going round `recolour`'s own guard on purpose.
         The store refuses these first (the test above), so the only way to see
         whether the constraint is really there is to write past it — and it has
         to be there, because the importer writes this column too. */
      for (const bad of [64, -1]) {
        await expect(
          getDb()
            .update(searchRuns)
            .set({ colour: bad })
            .where(and(eq(searchRuns.articleId, ARTICLE_ID), eq(searchRuns.id, run.id))),
        ).rejects.toThrow();
      }
    });
  });

  describe("the article a run was answered against", () => {
    it("has no fingerprint to offer for an article with no blocks", async () => {
      // Not an empty string and not a throw: "we cannot tell" is a value, and
      // `isStale` reads it as stale.
      expect(await pgSearchStore.sourceHash(SLUG)).toBeUndefined();
    });

    it("leaves the key off a run it could not fingerprint", async () => {
      // Absent, not null. Postgres answers `null` where the file simply had no
      // key, and `exactOptionalPropertyTypes` makes those different types — the
      // same trap `model` and `error` are checked for above.
      const { run } = await pgSearchStore.begin(SLUG, "no blocks to hash");
      expect("sourceHash" in run).toBe(false);
    });

    it("reads a stored fingerprint back off the row", async () => {
      /* Written straight into the table rather than through `begin`, because
         this fixture has no blocks for `begin` to hash — what is under test is
         `toRun`, which is the half that would silently drop the column while
         every write test stayed green. */
      const hash = "0123456789abcdef";
      await getDb().insert(searchRuns).values({
        articleId: ARTICLE_ID,
        id: "spya-runcc2",
        ownerId: currentOwnerId(),
        criterion: "imported from a file",
        status: "done",
        hits: [],
        sourceHash: hash,
      });
      const [stored] = await pgSearchStore.load(SLUG);
      expect(stored?.sourceHash).toBe(hash);
    });
  });

  it("404s for an article that is not there, and 400s for a non-slug", async () => {
    await expect(pgSearchStore.load("no-such-article-at-all")).rejects.toMatchObject({
      status: 404,
    });
    await expect(pgSearchStore.load("../etc/passwd")).rejects.toMatchObject({ status: 400 });
  });
});
