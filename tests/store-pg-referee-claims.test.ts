/**
 * **A claims run survives a round trip through the real Postgres store, and a
 * second owner cannot reach it.**
 *
 * Claims shipped on 2026-08-31 with a filesystem store only, so under
 * `SPIDERYARN_STORE=postgres` — the configuration that deploys — every operation
 * returned a 501. A cross-family review put it plainly
 * (docs/plans/260831an-referee-mode-submodes-review-sol.md, finding 4): *"in the
 * deployed application, 'Pull the paper's claims' cannot load, start or persist
 * a run."* src/store/pg-referee-claims.ts is the answer and this file is what
 * says it works, against a real database rather than a mock.
 *
 * ## What each half is for
 *
 * **The round trip** stores a run and reads it back through the store's own
 * methods, not through SQL: the claims arrive as JSONB and come back as
 * `Claim[]`, and the fields most easily lost on the way are the ones asserted —
 * a `start` of 0, a `discarded` of 0, an absent `withheld`, and the conditional
 * spreads that keep an absent `model` absent rather than `null`. A wire form
 * that gains a `"model": null` is the commonest near-miss in this store and no
 * happy-path assertion notices it.
 *
 * **The owner half** is the one worth the file on its own. A referee reads
 * somebody else's unpublished paper, and `articles.slug` is globally unique, so
 * a lookup without an owner filter finds a real article belonging to a real
 * stranger. Every method here resolves the slug through `ownedSlug`, and the
 * assertion is 404 rather than 403 — a 403 would confirm the article exists.
 * The **positive control** is not decoration: every 404 assertion below would
 * also pass against a predicate that matches nothing at all.
 *
 * ## The sweep's grace window
 *
 * `RefereeClaimsStore.sweep` takes one boolean where `SweepOptions` takes a set
 * and a window, and contracts.ts says why a window is needed: on Vercel a second
 * process seeing the first one's live row in nobody's set would error an answer
 * that is still arriving. So the Postgres store applies its own against
 * `created_at`, and the two cases below — a young `pending` run left alone, an
 * old one swept — are the only thing that distinguishes it from a store that
 * sweeps everything the moment a second tab loads the page.
 *
 * **Skips when there is no database**, loudly; `REQUIRE_POSTGRES=1` turns the
 * skip into a failure. docs/project/testing.md § When a skip is not acceptable.
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  refereeClaims,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId, type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import type { Claim, ClaimsRun } from "../src/referee-claims.js";
import { CLAIMS_SWEPT } from "../src/referee-claims-store.js";
import {
  CLAIMS_ORPHAN_GRACE_MS,
  pgRefereeClaimsStore as store,
} from "../src/store/pg-referee-claims.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const SLUG = "test-pg-referee-claims";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000c4";
const REVISION_ID = "00000000-0000-4000-8000-0000000000c5";
const BLOCK_ID = "spya-qwm234";

/**
 * **Somebody who owns nothing**, which is the strongest version of the property
 * under test — every assertion about them is that Alice's paper is invisible,
 * and none of them can pass by accident. `owner_id` really does reference
 * `auth.users`, so seeding a second real account would mean driving GoTrue and
 * failing this suite whenever auth is down rather than whenever isolation
 * breaks. tests/owner-isolation.test.ts made the same call for the same reason.
 */
const OUTSIDER = "00000000-0000-4000-8000-0000000000b1" as OwnerId;

const { reachable } = await pgReady({
  suite: "tests/store-pg-referee-claims.test.ts",
  tables: ["spideryarn.referee_claims"],
});

const when = reachable ? describe : describe.skip;

/**
 * **A census of `ClaimsRun`, so a new field cannot arrive unnoticed.**
 *
 * The Postgres store maps the run **field by field** onto columns, which is what
 * a table is — and a field it has not been told about is dropped silently while
 * `finish` reports success. That is not hypothetical: `claimsOmitted` was added
 * to `ClaimsRun` on 2026-09-01 while this store was being written, and the first
 * version of `toRun` and `finish` simply did not carry it. The filesystem store
 * has no such failure, because it spreads the patch over the row.
 *
 * So this object must name every key, and `Record<keyof ClaimsRun, true>` makes
 * the compiler insist. **If this line stops compiling**, a field was added:
 * carry it through `toRun` and `finish` in src/store/pg-referee-claims.ts, give
 * it a column, teach src/store/export.ts about it, and assert it survives the
 * round trip below. `npm test` does not typecheck, so `npm run typecheck` is
 * where this speaks.
 */
const EVERY_RUN_FIELD: Record<keyof ClaimsRun, true> = {
  status: true,
  createdAt: true,
  claims: true,
  model: true,
  error: true,
  claimsOmitted: true,
  sourceHash: true,
};

/** One claim with one passage, carrying the fields most easily lost in JSONB. */
function aClaim(): Claim {
  return {
    id: `${BLOCK_ID}:0`,
    claim: "The method improves accuracy by 40%.",
    blockId: BLOCK_ID,
    quote: "improves accuracy by 40%",
    /* Zero, not one. A `start` that survives as `undefined` and one that
       survives as 0 look identical in every assertion that only checks
       truthiness, and 0 is the ordinary case. */
    start: 0,
    passages: [
      {
        blockId: BLOCK_ID,
        quote: "improves accuracy by 40%",
        start: 0,
        reasoning: "reports the accuracy the abstract quotes",
      },
    ],
    discarded: 0,
  };
}

async function clean(): Promise<void> {
  const db = getDb();
  await db.delete(refereeClaims).where(eq(refereeClaims.articleId, ARTICLE_ID));
  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, ARTICLE_ID));
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, ARTICLE_ID));
  await db.delete(articleRevisions).where(eq(articleRevisions.id, REVISION_ID));
  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, ARTICLE_ID));
  await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
}

/** Push the stored run's clock back, so the sweep's window can be exercised. */
async function ageRunBy(ms: number): Promise<void> {
  await getDb()
    .update(refereeClaims)
    .set({ createdAt: new Date(Date.now() - ms) })
    .where(eq(refereeClaims.articleId, ARTICLE_ID));
}

when("the Postgres claims store", { timeout: 20_000 }, () => {
  beforeAll(async () => {
    await clean();
    const db = getDb();
    await db.insert(articles).values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG });
    await db.insert(articleRevisions).values({
      id: REVISION_ID,
      articleId: ARTICLE_ID,
      status: "published",
      title: "A paper with one claim in it",
    });
    await db
      .update(articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(articles.id, ARTICLE_ID));
    await db.insert(blockIdentities).values({ articleId: ARTICLE_ID, blockId: BLOCK_ID });
    await db.insert(revisionBlocks).values({
      articleId: ARTICLE_ID,
      revisionId: REVISION_ID,
      blockId: BLOCK_ID,
      ordinal: 0,
      tag: "p",
      kind: "text",
      text: "The method improves accuracy by 40% on the benchmark.",
      words: 9,
      html: "<p>The method improves accuracy by 40% on the benchmark.</p>",
      gistable: true,
    });
  });

  afterAll(async () => {
    await clean();
    await closeDb();
  });

  it("carries every field of a run, and says so where the compiler can hear", () => {
    /* The census above is the real assertion and it is a compile-time one. This
       runtime line exists so the constant is used rather than stripped, and so
       a reader running the suite sees the claim stated. */
    expect(Object.keys(EVERY_RUN_FIELD).sort()).toEqual(
      ["claims", "claimsOmitted", "createdAt", "error", "model", "sourceHash", "status"].sort(),
    );
  });

  it("has never been asked, before anybody asks", async () => {
    expect(await store.load(SLUG)).toBeNull();
  });

  it("stores a run and reads the same one back", async () => {
    const begun = await store.begin(SLUG);
    expect(begun.status).toBe("pending");
    expect(begun.claims).toEqual([]);
    /* The article has blocks, so the fingerprint is a real hash rather than the
       `undefined` an unreadable article gets — which `isStale` counts as stale. */
    expect(begun.sourceHash).toBe(await store.sourceHash(SLUG));
    expect(begun.sourceHash).toMatch(/^[0-9a-f]{8,}$/);

    const finished = await store.finish(SLUG, {
      status: "done",
      claims: [aClaim()],
      model: "test-model",
      /* **Every field of `ClaimsRun` has to survive, not just the ones the route
         happens to send today.** `claimsOmitted` arrived while this store was
         being written and a column-per-field store drops what it was not told
         about, silently, while `finish` reports success. Written here as a
         zero rather than a number, because zero is the value most easily lost:
         `?? null` and a falsy check both turn a truthful "none were cut off"
         into "we did not record it", which is the distinction the column is
         nullable for. */
      claimsOmitted: 0,
    });
    expect(finished?.status).toBe("done");

    const back = await store.load(SLUG);
    expect(back?.claims).toEqual([aClaim()]);
    expect(back?.model).toBe("test-model");
    expect(back?.claimsOmitted).toBe(0);
    /* `finish` takes `createdAt` and `sourceHash` from the row, never from the
       patch: a finish that re-dated a run, or moved it onto a different
       fingerprint, would make the panel's staleness answer a fiction. */
    expect(back?.createdAt).toBe(begun.createdAt);
    expect(back?.sourceHash).toBe(begun.sourceHash);
  });

  it("leaves an absent field absent rather than null", async () => {
    /* `exactOptionalPropertyTypes` is on and Postgres hands back `null` where
       the file simply had no key. A wire form carrying `"error": null` is a
       different shape from the filesystem store's, and no assertion about the
       happy path would ever see it. */
    const back = (await store.load(SLUG)) as ClaimsRun;
    expect("error" in back).toBe(false);
    expect(Object.keys(back).sort()).toEqual(
      ["claims", "claimsOmitted", "createdAt", "model", "sourceHash", "status"].sort(),
    );
  });

  it("replaces the run rather than adding one, and clears the last answer", async () => {
    const before = await store.load(SLUG);
    expect(before?.claims).toHaveLength(1);

    const again = await store.begin(SLUG);
    expect(again.status).toBe("pending");
    /* The corollary src/referee-claims-store.ts writes down: starting a run
       throws away the last answer before the new one exists, deliberately,
       because yesterday's claims under today's spinner is the one state a
       referee cannot interpret. */
    expect(again.claims).toEqual([]);
    expect(again.model).toBeUndefined();
    /* Cleared too, and absent rather than 0: a stale count under a run that has
       not happened yet would be a sentence about a list nobody has. */
    expect(again.claimsOmitted).toBeUndefined();

    const counted = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(refereeClaims)
      .where(eq(refereeClaims.articleId, ARTICLE_ID));
    expect(counted[0]?.count).toBe(1);
  });

  it("clears a failed run's error when the next one starts", async () => {
    await store.finish(SLUG, { status: "error", error: "the provider refused" });
    expect((await store.load(SLUG))?.error).toBe("the provider refused");
    const again = await store.begin(SLUG);
    /* Left behind, this would sit under a `pending` row and the panel would
       print a failure about a run that has not happened yet. */
    expect(again.error).toBeUndefined();
    expect((await store.load(SLUG))?.error).toBeUndefined();
  });

  it("leaves a run this process is running alone", async () => {
    await store.begin(SLUG);
    await ageRunBy(CLAIMS_ORPHAN_GRACE_MS * 2);
    const swept = await store.sweep(SLUG, true);
    expect(swept?.status).toBe("pending");
  });

  it("leaves another process's young run alone, which is what the window is for", async () => {
    await store.begin(SLUG);
    /* No ageing: `live` is false, so a store with only the boolean guard would
       error this run — and on Vercel the second process is the ordinary case,
       not an edge one. */
    const swept = await store.sweep(SLUG, false);
    expect(swept?.status).toBe("pending");
    expect(swept?.error).toBeUndefined();
  });

  it("sweeps an abandoned run once it is past the window", async () => {
    await store.begin(SLUG);
    await ageRunBy(CLAIMS_ORPHAN_GRACE_MS + 60_000);
    const swept = await store.sweep(SLUG, false);
    expect(swept?.status).toBe("error");
    expect(swept?.error).toBe(CLAIMS_SWEPT);
    // And it stays swept — a second sweep is not a second write.
    expect((await store.sweep(SLUG, false))?.status).toBe("error");
  });

  it("answers null rather than resurrecting a run that went away", async () => {
    await getDb().delete(refereeClaims).where(eq(refereeClaims.articleId, ARTICLE_ID));
    expect(await store.finish(SLUG, { status: "done", claims: [aClaim()] })).toBeNull();
    expect(await store.load(SLUG)).toBeNull();
  });

  /* ------------------------------------------------ the paper is not theirs -- */

  describe("asked for by somebody who does not own the paper", () => {
    beforeAll(async () => {
      await store.begin(SLUG);
      await store.finish(SLUG, { status: "done", claims: [aClaim()], model: "test-model" });
    });

    const asOutsider = <T>(fn: () => Promise<T>) =>
      runInRequest(async () => {
        setRequestOwner(OUTSIDER);
        return fn();
      });

    it("cannot read the run", async () => {
      await expect(asOutsider(() => store.load(SLUG))).rejects.toMatchObject({ status: 404 });
    });

    it("cannot fingerprint the paper", async () => {
      await expect(asOutsider(() => store.sourceHash(SLUG))).rejects.toMatchObject({ status: 404 });
    });

    it("cannot start a run over it", async () => {
      await expect(asOutsider(() => store.begin(SLUG))).rejects.toMatchObject({ status: 404 });
    });

    it("cannot write an answer onto it", async () => {
      await expect(
        asOutsider(() => store.finish(SLUG, { status: "done", claims: [] })),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("cannot sweep it", async () => {
      await expect(asOutsider(() => store.sweep(SLUG, false))).rejects.toMatchObject({
        status: 404,
      });
    });

    it("has changed nothing while being refused", async () => {
      /* The refusals above would all be satisfied by a store that threw before
         doing anything AND by one that threw after writing. This is the half
         that says the row is untouched. */
      const mine = await store.load(SLUG);
      expect(mine?.status).toBe("done");
      expect(mine?.claims).toEqual([aClaim()]);
      expect(mine?.model).toBe("test-model");
    });

    /**
     * **The positive control, and the five refusals above are worthless without
     * it.** A predicate that matches nothing at all — a typo in `ownedSlug`, a
     * fixture whose owner never got written — throws 404 for everybody, and
     * every assertion in this block would go green over a store that can serve
     * no one.
     */
    it("while the owner can still read their own", async () => {
      const mine = await store.load(SLUG);
      expect(mine?.claims).toEqual([aClaim()]);
    });
  });
});
