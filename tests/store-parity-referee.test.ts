/**
 * **What the Postgres store answers about Referee mode.**
 *
 * **Was a parity suite until 2026-09-05**, when the filesystem store was
 * deleted and one of its two arms went with it
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G).
 * The fixture, the scripts and the steps are unchanged; what went is every
 * `expect(fromPg).toEqual(fromFiles)`. What is left is everything that was ever
 * a claim about Postgres on its own — which is most of the value, because this
 * file was written after a one-sided store shipped and the assertions that
 * would have caught it are literals rather than comparisons. Two of them have
 * no second home anywhere: the `clampConfidence` trap (a valence of −80 beside
 * a confidence of 55, below) and the only guard on `CLAIMS_ORPHAN_GRACE_MS`
 * outside `tests/store-pg-referee-claims.test.ts`.
 *
 * The reason it was written, which is why the file still opens with it:
 *
 * `tests/store-parity.test.ts` says of itself that it is *"the test the whole
 * migration rests on"*, and it contains the string `referee` zero times. Criteria
 * has had two implementations since 2026-08-31 and nothing had ever compared
 * them; Claims shipped on the same day with **one**, so under
 * `SPIDERYARN_STORE=postgres` — the configuration production has run since
 * 2026-08-27 — every claims operation returned a 501 and the sub-mode did not
 * exist for anybody but a developer on a laptop. Every test passed throughout,
 * because `SPIDERYARN_STORE` unset meant `files`, and so every test, every local
 * run and the browser pass all exercised the configuration that is not deployed.
 * docs/postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md,
 * and stage 2 of docs/plans/260901f-referee-mode-on-the-database-and-the-parity-that-would-have-caught-it.md.
 *
 * A **new file** rather than an edit to `store-parity.test.ts`, which carries
 * another session's in-flight work and takes the corpus lock. Nothing here takes
 * that lock: the fixture is two paragraphs written into the store directly.
 *
 * ## It asserts the API-shaped result, not SQL rows
 *
 * The discipline is `store-parity.test.ts`'s and the reason is its: a row-level
 * assertion passes happily while the thing the client receives has changed
 * shape, and the client is the only thing that matters. So the reads below go
 * through `wire()` — `JSON.parse(JSON.stringify(…))`, exactly what
 * `src/routes.ts` sends — and never through a `select`. The one place this file
 * does touch SQL is the fixture, and a fixture is not an assertion.
 *
 * ## The script walks, and asserts at the steps that can break
 *
 * These are **writes**, so a single end-state check would miss anything that
 * goes wrong and is then overwritten — a retry that keeps the failed attempt's
 * results is invisible by the time the next answer lands. The walk was compared
 * step by step against a second store; with one store it asserts at each step
 * whose comment names what that step can break, which is what the comparison
 * was really holding down.
 *
 * ## Two behaviours this store has that the other one did not
 *
 * Both were "what the two stores genuinely disagree about" until the other one
 * went, and both still have a test of their own here:
 *
 * 1. **A slug that is not an article at all** throws a tagged 404 from
 *    `ownedSlug`, because a slug is globally unique and the row it would
 *    otherwise find belongs to a stranger.
 * 2. **A young abandoned claims run** is left alone for
 *    `CLAIMS_ORPHAN_GRACE_MS`, because on Vercel the process that is streaming
 *    the answer is a different process from the one being asked.
 *    `RefereeClaimsStore.sweep` in src/store/contracts.ts holds that decision,
 *    and `staleStart` below is how a run old enough to sweep is produced
 *    without reaching behind the store's back.
 *
 * ## Skips loudly when there is no database
 *
 * A check that skips when the database is away, in a suite written *because*
 * nobody exercised the database, is the joke writing itself. `pgReady` says so
 * on stderr, and `REQUIRE_POSTGRES=1` turns the skip into a failure —
 * docs/project/testing.md § When a skip is not acceptable.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import type { ClaimsRun } from "../src/referee-claims.js";
import { CLAIMS_SWEPT } from "../src/store/pg-referee-claims.js";
import type { DivergingResult, SingleResult } from "../src/referee-criteria.js";
import type { Comment } from "../src/types.js";
import { CRITERION_SWEPT } from "../src/referee-criteria-store.js";
import type { SavedCriterion } from "../src/saved-criteria.js";
import type { CommentStore, RefereeClaimsStore, RefereeCriteriaStore } from "../src/store/contracts.js";
import {
  CLAIMS_ORPHAN_GRACE_MS,
  pgRefereeClaimsStore,
} from "../src/store/pg-referee-claims.js";
import { pgCommentStore } from "../src/store/pg-comments.js";
import { pgRefereeCriteriaStore } from "../src/store/pg-referee-criteria.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const SLUG = "test-referee-parity";
const ARTICLE_ID = "00000000-0000-4000-8000-00000000af10";
const REVISION_ID = "00000000-0000-4000-8000-00000000af11";

/** A slug no article has, in either store — see difference 1 in the header. */
const ABSENT = "test-referee-parity-no-such-article";

await pgReady({
  suite: "tests/store-parity-referee.test.ts",
  tables: ["spideryarn.referee_criteria", "spideryarn.referee_claims"],
  max: 2,
});

/**
 * Replace every minted id with `#n`, numbered by first appearance —
 * `store-reader-state-parity.test.ts`, and lifted rather than reasoned about
 * again.
 *
 * It matters much less here than it does there, because a criterion's id is
 * minted by the **client** and every `begin` below names one. It is kept for the
 * one call that does not, and because the mapping is by first appearance an
 * ordering bug shows up as a renumbering — which is a real failure, not a masked
 * one.
 */
function normalise(value: unknown, seen = new Map<string, string>()): unknown {
  if (typeof value === "string") {
    if (!/^spya-[a-z0-9]{6}$/.test(value)) return value;
    const known = seen.get(value);
    if (known) return known;
    const placeholder = `#${seen.size}`;
    seen.set(value, placeholder);
    return placeholder;
  }
  if (Array.isArray(value)) return value.map((v) => normalise(v, seen));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normalise(v, seen)]),
    );
  }
  return value;
}

/**
 * The wire form, with ids normalised and the attempt token dropped.
 *
 * `attempt` is the one field `RefereeCriteriaStore` is *supposed* to disagree
 * about: Postgres mints one per model call and the filesystem has none,
 * deliberately and permanently (contracts.ts § `finish`). It is also not wire
 * form at all — the route holds it and it never reaches a client.
 *
 * Removed **by name**, not by letting `JSON.stringify` drop the `undefined`
 * side: that would compare "absent" against "a uuid" and pass only by accident
 * of one of them being nullish.
 */
function wire(value: unknown): unknown {
  return normalise(
    JSON.parse(JSON.stringify(value, (key, v) => (key === "attempt" ? undefined : v))),
  );
}

/** A clock both stores are driven by, so a timestamp is a fact and not a race. */
function clockFrom(startMs: number): () => string {
  let n = 0;
  return () => new Date(startMs + 1000 * n++).toISOString();
}

/** The fixed clock, for everything whose age nothing reads. */
const clock = () => clockFrom(Date.parse("2026-09-01T00:00:00.000Z"));

/**
 * **A moment far enough in the past that a claims run started at it is already
 * abandoned** — see difference 2 in the header.
 *
 * This is how the Postgres sweep's grace window gets exercised without either
 * store being reached behind its own back. The first version of this file moved
 * `referee_claims.created_at` with an `UPDATE` after the fact, and that was
 * wrong twice over: it is SQL inside a parity comparison, and `created_at` **is**
 * the wire form's `createdAt`, so the doctored run and the filesystem's run
 * differed in the one field the doctoring touched. The suite said so on its first
 * run — *"claims parity diverged at: sweep an abandoned run"*, `2026-09-01T00:00:01Z`
 * against a real timestamp — which is the failure mode working.
 *
 * Both stores are handed the same number, so the run each of them stamps is the
 * same run. The filesystem store has no clock to read and sweeps whatever it is
 * shown; Postgres reads this one and agrees. The **young** run, where they
 * genuinely differ, has its own test below and does not use this.
 */
function staleStart(): number {
  return Date.now() - CLAIMS_ORPHAN_GRACE_MS - 60_000;
}

/**
 * The two paragraphs the fixture is made of.
 *
 * Ids from the real alphabet — `abcdefghjkmnpqrstuvwxyz023456789`, no `i`, `l`,
 * `o` or `1`. An invalid one is not rejected; the store quietly mints its own,
 * and the test is then about something else.
 */
const BLOCKS = [
  {
    id: "spya-refpar",
    tag: "p",
    kind: "text",
    text: "We show that the method halves annotation time.",
    words: 8,
    html: "<p>We show that the method halves annotation time.</p>",
    gistable: true,
  },
  {
    id: "spya-refpaq",
    tag: "p",
    kind: "text",
    text: "The controls were not pre-registered.",
    words: 5,
    html: "<p>The controls were not pre-registered.</p>",
    gistable: true,
  },
] as const;

const [FIRST_BLOCK, SECOND_BLOCK] = BLOCKS;

describe("the Postgres store, on Referee mode", { timeout: 30_000 }, () => {
  /**
   * **A real article with real blocks**, which is the whole point of the
   * fixture: `sourceHash` is the field the whole staleness banner rests on, and
   * a store handed an article with no published revision has nothing to hash.
   * The alternative was excluding `sourceHash`, which removes the problem by
   * removing the check.
   */
  beforeEach(async () => {
    const db = getDb();
    await db.delete(articles).where(eq(articles.slug, SLUG));
    await db.insert(articles).values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG });
    /* No `ownerId` on the revision, and it is not an omission: `article_revisions`
       has no owner column — ownership lives on `articles` and a revision is
       reached through its article. */
    await db.insert(articleRevisions).values({
      id: REVISION_ID,
      articleId: ARTICLE_ID,
      status: "published",
      title: "A paper with two paragraphs in it",
    });
    /* The ids exist as identities first — `revision_blocks` has a foreign key
       onto `block_identities`. docs/project/block-ids.md. */
    await db
      .insert(blockIdentities)
      .values(BLOCKS.map((b) => ({ articleId: ARTICLE_ID, blockId: b.id })));
    await db.insert(revisionBlocks).values(
      BLOCKS.map((b, ordinal) => ({
        articleId: ARTICLE_ID,
        revisionId: REVISION_ID,
        blockId: b.id,
        ordinal,
        tag: b.tag,
        kind: b.kind,
        text: b.text,
        words: b.words,
        html: b.html,
        gistable: b.gistable,
      })),
    );
    await db
      .update(articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(articles.id, ARTICLE_ID));
  });

  afterAll(async () => {
    await getDb().delete(articles).where(eq(articles.slug, SLUG));
    await closeDb();
  });

  /* ------------------------------------------------------------ the fixture -- */

  it("has two paragraphs in it, and the two stores fingerprint them the same way", async () => {
    /* **The alarm on everything below.** Every assertion in this file about an
       empty list would also pass if the store answered "I have never heard of
       this article" — `[]` equals `[]` and `null` equals `null`. This is the
       test that says the fixture is really there.

       A real hash, not just a matching one: `sourceHash` answers `undefined`
       for an article it cannot read, and two `undefined`s are equal. */
    const fromCriteria = await pgRefereeCriteriaStore.sourceHash(SLUG);
    expect(fromCriteria).toMatch(/^[0-9a-f]{8,}$/);
    /* And the claims store computes it the same way — since 2026-09-02 by
       literally the same function, `sourceHashFor` in src/store/pg.ts. It was
       a third private copy of the query when this line was written, which is
       exactly how a fingerprint drifts; the assertion is still worth keeping,
       because "they share a function today" is not what this is checking. */
    expect(await pgRefereeClaimsStore.sourceHash(SLUG)).toBe(fromCriteria);
  });

  /* ------------------------------------------------------------- criteria -- */

  /**
   * One criterion's whole life, driven through whichever store it is handed.
   *
   * Every step is chosen for something it can break: the second `begin` proves a
   * later criterion does not disturb the first, the failure and retry prove the
   * failed attempt's `error` and `results` are cleared rather than left
   * underneath the new answer, the recolour proves a colour is a property of the
   * question rather than of the attempt, and the sweep proves an abandoned row
   * becomes something a referee can act on.
   */
  async function criteriaScript(store: RefereeCriteriaStore): Promise<unknown[]> {
    const now = clock();
    const snapshots: unknown[] = [];
    const take = async (label: string, returned?: unknown) => {
      snapshots.push({ label, returned, criteria: await store.load(SLUG) });
    };

    await take("nothing asked yet");

    const first = await store.begin(
      SLUG,
      "Are the controls adequate?",
      { kind: "single" },
      "spya-crta22",
      now,
    );
    await take("begin a single criterion", first.row);

    const single: SingleResult = {
      kind: "single",
      blockId: SECOND_BLOCK.id,
      quote: "The controls were not pre-registered",
      start: 0,
      confidence: 70,
      reasoning: "names the controls directly",
    };
    await take(
      "finish it",
      await store.finish(SLUG, first.row.id, { status: "done", results: [single], model: "m1" }, first.attempt),
    );

    const second = await store.begin(
      SLUG,
      "How strong is the evidence?",
      {
        kind: "diverging",
        poles: { against: "the evidence is thin", favour: "the evidence is strong" },
        scale: "rg",
      },
      "spya-crtb22",
      now,
    );
    await take("begin a diverging criterion", second.row);

    await take(
      "fail it",
      await store.finish(SLUG, second.row.id, { status: "error", error: "fell over" }, second.attempt),
    );

    /* The retry branch: the same id, the same criterion text, and a row that
       actually failed — the three-condition rule `withCriterion` holds and both
       stores call. The **config changes**, because a reset adopts the new one:
       a diverging criterion whose poles were nonsense is exactly the row a
       referee fixes and runs again. */
    const retried = await store.begin(
      SLUG,
      "How strong is the evidence?",
      {
        kind: "diverging",
        poles: { against: "the evidence is thin", favour: "the evidence is overwhelming" },
        scale: "br",
      },
      second.row.id,
      now,
    );
    await take("retry it, with new poles", retried.row);

    /* **A negative valence, and this is the step that matters most.** −100 is
       the `against` pole and 0 is a real answer meaning neither, so a store that
       clamped, dropped the sign, or routed the number through a confidence field
       would show the referee the opposite of what the model said with nothing
       red anywhere. `DivergingResult.valence` in src/referee-criteria.ts is
       written around that failure; this is the assertion that the two stores
       cannot disagree about it. */
    const diverging: DivergingResult = {
      kind: "diverging",
      blockId: SECOND_BLOCK.id,
      quote: "The controls were not pre-registered",
      start: 0,
      confidence: 90,
      reasoning: "the absence of pre-registration cuts against the claim",
      valence: -80,
    };
    await take(
      "finish the retry with a negative valence",
      await store.finish(
        SLUG,
        retried.row.id,
        { status: "done", results: [diverging], model: "m2" },
        retried.attempt,
      ),
    );

    // A colour, then back to auto. Slot 0 is a colour, so `null` is the only way
    // to say "put this back on the hash" — and it must leave the key absent.
    await take("recolour it", await store.recolour(SLUG, first.row.id, 3));
    await take("put it back on auto", await store.recolour(SLUG, first.row.id, null));

    // An id nothing has: a second tab can delete a criterion between this tab
    // reading the list and pressing a swatch, so it is a no-op, not a throw.
    await take("recolour a criterion nobody has", await store.recolour(SLUG, "spya-crtz99", 2));

    const third = await store.begin(SLUG, "Is the sample big enough?", { kind: "single" }, "spya-crtc22", now);
    await take("begin a third and abandon it", third.row);

    /* A **negative** grace window, and that is deliberate rather than sloppy:
       it puts the cutoff a second in the future, so every `pending` row is
       stale whatever the database's clock thinks of this process's. A suite
       whose subject is two stores agreeing must not be able to go red because
       two clocks did not. The filesystem store ignores `graceMs` entirely
       (contracts.ts § `SweepOptions`), so this changes nothing on that side. */
    await take(
      "sweep it, keeping the first",
      await store.sweepPending(SLUG, { keep: new Set([first.row.id]), graceMs: -1000 }),
    );

    await take("delete the first", await store.remove(SLUG, first.row.id));
    // Deleting something already gone is a no-op that still answers the list.
    await take("delete it again", await store.remove(SLUG, first.row.id));

    return snapshots;
  }

  it("walks a criterion through begin, finish, fail, retry, recolour, sweep and delete", async () => {
    /* **Was a step-by-step comparison against the filesystem store.** With one
       store the walk is the same and the assertions are the script's own
       comments made explicit — each one at the step whose comment names what it
       can break. A walk that only checks it does not throw is not a test.
       `steps` is indexed by the order `take` pushed them. */
    const steps = (await criteriaScript(pgRefereeCriteriaStore)) as {
      label: string;
      returned: unknown;
      criteria: SavedCriterion[];
    }[];
    const at = (i: number) => steps[i]?.criteria ?? [];
    const byId = (i: number, id: string) => at(i).find((c) => c.id === id);

    expect(at(0), "something was already there before the script began").toEqual([]);

    // The second `begin` must not disturb the first.
    expect(byId(3, "spya-crta22")?.status, "the second begin disturbed the first").toBe("done");

    /* The retry: the same row reset, not a second one minted, with the failed
       attempt's `error` cleared rather than left underneath — and the **new**
       poles adopted, because a reset adopts the new config. */
    const retried = byId(5, "spya-crtb22");
    expect(at(5), "the retry minted a row instead of resetting one").toHaveLength(2);
    expect(retried?.status).toBe("pending");
    expect("error" in (retried ?? {}), "the retry left the failed attempt's error").toBe(false);
    expect(retried?.config).toMatchObject({
      poles: { favour: "the evidence is overwhelming" },
      scale: "br",
    });

    /* **The negative valence**, and the step that matters most: −100 is the
       `against` pole and 0 is a real answer meaning neither, so a store that
       clamped or routed the number through a confidence field would show the
       referee the opposite of what the model said. */
    const answered = byId(6, "spya-crtb22")?.results[0];
    expect(answered?.kind).toBe("diverging");
    if (answered?.kind === "diverging") {
      expect(answered.valence, "the retry's answer lost the sign").toBe(-80);
      expect(answered.confidence, "the valence travelled through confidence").toBe(90);
    }

    // A colour is a property of the question, not of the attempt; and `null`
    // must leave the key ABSENT, because slot 0 is a real colour.
    expect(byId(7, "spya-crta22")?.colour).toBe(3);
    expect("colour" in (byId(8, "spya-crta22") ?? {}), "auto left a colour behind").toBe(false);
    // An id nothing has: a no-op, not a throw, and it changes nothing.
    expect(at(9), "recolouring an unknown id changed the list").toHaveLength(2);

    /* The sweep turns the abandoned row into something a referee can act on,
       and leaves the one it was told to keep alone. */
    expect(byId(11, "spya-crtc22")?.status, "the abandoned row was not swept").toBe("error");
    expect(byId(11, "spya-crta22")?.status, "the swept run took a kept row with it").toBe("done");

    // Delete, then delete again: the second is a no-op that still answers.
    expect(at(12).map((c) => c.id)).not.toContain("spya-crta22");
    expect(at(13)).toEqual(at(12));
  });

  it("keeps a negative valence signed, byte for byte", async () => {
    /* The walk above already reaches this inside a whole-row snapshot. This test
       exists because that failure would read as "the retry's answer lost the
       sign" among ten other assertions; here the number is the whole test.

       **Confidence 55 beside valence −80 is the trap, and this is the only
       place in the tree that holds it.** `clampConfidence` turns −80 into 0
       silently, so a valence routed through anything confidence-shaped arrives
       as "counts neither way" — the opposite of what the model said, with
       nothing red. Both numbers are asserted, because either one alone passes
       against the bug. */
    const script = async (store: RefereeCriteriaStore) => {
      const now = clock();
      const begun = await store.begin(
        SLUG,
        "Does this cut for or against?",
        { kind: "diverging", poles: { against: "against", favour: "for" }, scale: "rg" },
        "spya-crtd22",
        now,
      );
      const result: DivergingResult = {
        kind: "diverging",
        blockId: FIRST_BLOCK.id,
        quote: "halves annotation time",
        start: 0,
        confidence: 55,
        reasoning: "an unsupported quantitative claim",
        valence: -80,
      };
      await store.finish(SLUG, begun.row.id, { status: "done", results: [result] }, begun.attempt);
      const [row] = await store.load(SLUG);
      return row;
    };

    const row = await script(pgRefereeCriteriaStore);

    const results = row?.results ?? [];
    expect(results, "the store kept no result at all").toHaveLength(1);
    const first = results[0] as DivergingResult;
    expect(first.kind, "the diverging kind went").toBe("diverging");
    expect(first.valence, "the valence is not signed").toBe(-80);
    expect(first.confidence, "the valence moved into confidence").toBe(55);
    // And it survives the wire, which is what the panel actually receives.
    expect(wire(row)).toMatchObject({ results: [{ valence: -80, confidence: 55 }] });
  });

  /* ---------------------------------------------- the referee's own placement -- */

  /**
   * A placement's whole life: made with the comment, changed, changed again
   * across zero, cleared, and made a second time.
   *
   * **The comment store is exercised in this file rather than in
   * `store-comments.test.ts`** because a placement is Referee mode, and this is
   * the file that watches Referee mode. `patchMark` landed on 2026-09-01 with
   * an implementation on each side of a store seam, and the way this repo has
   * twice shipped a one-sided store is by nobody writing the check.
   *
   * `createdAt` and `updatedAt` used to be dropped by name from a comparison
   * against a second store, because `CommentStore` has no clock seam. There is
   * nothing to compare against now, and what they must do was always checked
   * positively — in the test below, unchanged.
   */
  /** The id the placement's criterion is minted under, named so it is stable. */
  const PLACED_ON = "spya-crtm22";
  const PLACED_COMMENT = "spya-cmtm22";
  const PLACED_QUOTE = "not pre-registered";

  async function placementScript(
    criteria: RefereeCriteriaStore,
    comments: CommentStore,
  ): Promise<unknown[]> {
    const now = clock();
    const snapshots: unknown[] = [];
    const take = async (label: string, returned?: unknown) => {
      snapshots.push({ label, returned, comments: await comments.load(SLUG) });
    };

    /* The criterion first: `comments_criterion_fk` points at `referee_criteria`,
       so on the Postgres side a placement naming a criterion that is not there
       is refused by the database — which is the constraint working, not a
       fixture to route around. The filesystem store has no such constraint, and
       the two agreeing here is part of what is being checked. */
    await criteria.begin(
      SLUG,
      "Are the controls adequate?",
      {
        kind: "diverging",
        poles: { against: "the controls are inadequate", favour: "the controls are adequate" },
        scale: "rg",
      },
      PLACED_ON,
      now,
    );

    await take("nothing is placed yet");

    await take(
      "place the passage at −80",
      await comments.create(SLUG, {
        id: PLACED_COMMENT,
        blockId: SECOND_BLOCK.id,
        quote: PLACED_QUOTE,
        start: SECOND_BLOCK.text.indexOf(PLACED_QUOTE),
        body: "no pre-registration is mentioned anywhere",
        criterionId: PLACED_ON,
        valence: -80,
      }),
    );

    await take(
      "change it to +50",
      await comments.patchMark(SLUG, PLACED_COMMENT, { criterionId: PLACED_ON, valence: 50 }),
    );

    /* Across zero and back to the far end. A store that dropped the sign and one
       that stored the absolute value are different bugs, and only a positive
       step beside a negative one tells them apart. */
    await take(
      "change it to −70",
      await comments.patchMark(SLUG, PLACED_COMMENT, { criterionId: PLACED_ON, valence: -70 }),
    );

    /* Clearing is a legal state and not a delete: the referee's words and their
       passage stay, and both fields go — absent, not `null` and not `0`. */
    await take(
      "clear it back to a reading note",
      await comments.patchMark(SLUG, PLACED_COMMENT, { criterionId: null, valence: null }),
    );

    await take(
      "place it again, with no number",
      await comments.patchMark(SLUG, PLACED_COMMENT, { criterionId: PLACED_ON, valence: null }),
    );

    return snapshots;
  }

  it("walks a placement through create, two edits, a clear and a re-place", async () => {
    /* **Against the literal**, which is what this test was really holding: two
       stores that both clamped a negative to `0` would have agreed perfectly,
       so the step-by-step comparison against the filesystem store said nothing
       about the sign and these assertions said everything. The comparison went
       on 2026-09-05; the assertions are unchanged. The step numbers are the
       script's. */
    const steps = await placementScript(pgRefereeCriteriaStore, pgCommentStore);
    const at = (i: number) => (steps[i] as { comments: Comment[] }).comments[0];

    expect(at(1)?.valence, "the placement was not stored").toBe(-80);
    expect(at(2)?.valence, "the placement did not change").toBe(50);
    expect(at(3)?.valence, "the edited placement lost its sign").toBe(-70);
    expect("valence" in (at(4) ?? {}), "a number was left behind after a clear").toBe(false);
    expect("criterionId" in (at(4) ?? {}), "a criterion was left behind").toBe(false);
    // Clearing a placement is not deleting a comment.
    expect(at(4)?.body, "the reader's words went").toBe(
      "no pre-registration is mentioned anywhere",
    );
    expect(at(4)?.quote, "the passage went").toBe(PLACED_QUOTE);
    expect(at(5)?.criterionId, "the passage was not re-placed").toBe(PLACED_ON);
    expect("valence" in (at(5) ?? {}), "a number nobody chose was invented").toBe(false);

    /* The two fields `wireComment` dropped, checked here as they always were:
       `createdAt` is `create`'s alone and a patch may not move it, and
       `updatedAt` has to be stamped or "when did this change" is unanswerable. */
    expect(at(3)?.createdAt, "createdAt moved on a patch").toBe(at(1)?.createdAt);
    expect(at(3)?.updatedAt, "updatedAt was not stamped").toBeTruthy();
    expect(at(1)?.updatedAt, "updatedAt was stamped on a create").toBeUndefined();
  });

  /* --------------------------------------------------------------- claims -- */

  /**
   * One claims run's whole life, driven through whichever store it is handed.
   *
   * `startedAt` is the clock, and it is in the past on purpose — see
   * `staleStart`. Both stores are driven from the same number, so the sweep step
   * below is a run both of them consider abandoned rather than a run one of them
   * was told to consider abandoned.
   */
  async function claimsScript(store: RefereeClaimsStore, startedAt: number): Promise<unknown[]> {
    const now = clockFrom(startedAt);
    const snapshots: unknown[] = [];
    const take = async (label: string, returned?: unknown) => {
      snapshots.push({ label, returned, run: await store.load(SLUG) });
    };

    await take("nobody has asked this paper anything");

    await take("begin a run", await store.begin(SLUG, now));

    /* `claimsOmitted: 0` and `start: 0` are both written as zeros on purpose:
       a `?? null` or a falsy check turns a truthful "none were cut off" into
       "we did not record it", and the two render as different sentences. */
    await take(
      "finish it",
      await store.finish(SLUG, {
        status: "done",
        model: "m1",
        claimsOmitted: 0,
        claims: [
          {
            id: `${FIRST_BLOCK.id}:0`,
            claim: "The method halves annotation time.",
            blockId: FIRST_BLOCK.id,
            quote: "halves annotation time",
            start: 0,
            passages: [
              {
                blockId: FIRST_BLOCK.id,
                quote: "halves annotation time",
                start: 0,
                reasoning: "the abstract's own number",
              },
            ],
            discarded: 0,
          },
        ],
      }),
    );

    // A sweep over a finished run repairs nothing and answers what is there.
    await take("sweep a finished run", await store.sweep(SLUG, false));

    /* Starting a run **replaces** the last answer before the new one exists —
       deliberately, because a panel showing yesterday's claims under today's
       spinner is the one state a referee cannot interpret. So `claims`, `model`
       and `claimsOmitted` all have to go, and a store that merged instead of
       overwriting shows both. */
    await take("begin a second run", await store.begin(SLUG, now));

    // This process is running it: left alone, whatever its age.
    await take("sweep while this process is running it", await store.sweep(SLUG, true));

    /* Nobody is running it and it started before the grace window — so both
       stores turn it into something a referee can act on. */
    await take("sweep an abandoned run", await store.sweep(SLUG, false));

    // A second sweep must not re-sweep what is already an error.
    await take("sweep it again", await store.sweep(SLUG, false));

    await take(
      "fail a run outright",
      await store.finish(SLUG, { status: "error", error: "the provider fell over" }),
    );

    return snapshots;
  }

  it("walks a claims run through begin, finish, replace, sweep and fail", async () => {
    /* **Was a step-by-step comparison against the filesystem store.** Every one
       of these steps has its own case in tests/store-pg-referee-claims.test.ts,
       asserted against literals — `replaces the run rather than adding one`,
       `clears a failed run's error when the next one starts`, `leaves a run
       this process is running alone`, `sweeps an abandoned run once it is past
       the window`, `leaves an absent field absent rather than null`. What is
       kept here is the walk itself in one order, with the two zeros the script's
       own comment names: `claimsOmitted: 0` and `start: 0` must survive as
       zeros, because a `?? null` or a falsy check turns a truthful "none were
       cut off" into "we did not record it", and the two render as different
       sentences. */
    const steps = (await claimsScript(pgRefereeClaimsStore, staleStart())) as {
      label: string;
      run: ClaimsRun | null;
    }[];

    expect(steps[0]?.run, "a run was already there").toBeNull();
    expect(steps[2]?.run?.status, "the finished run is not done").toBe("done");
    expect(steps[2]?.run?.claimsOmitted, "a truthful zero became an absence").toBe(0);
    expect(steps[2]?.run?.claims?.[0]?.start, "a truthful zero became an absence").toBe(0);
    // Starting a run replaces the last answer before the new one exists.
    expect(steps[4]?.run?.status, "the second begin did not replace the answer").toBe("pending");
    expect(steps[4]?.run?.claims ?? [], "yesterday's claims survived today's spinner").toEqual(
      [],
    );
    // Running here: left alone whatever its age. Abandoned: swept.
    expect(steps[5]?.run?.status, "a run this process is running was swept").toBe("pending");
    expect(steps[6]?.run?.status, "an abandoned run was not swept").toBe("error");
    // A second sweep must not re-sweep what is already an error.
    expect(steps[7]?.run, "the second sweep changed a swept run").toEqual(steps[6]?.run);
    expect(steps[8]?.run?.error, "an outright failure lost its reason").toBe(
      "the provider fell over",
    );
  });

  it("writes the shared sentence over a swept run", async () => {
    /* The one string a referee actually reads out of a sweep. It moved into
       src/store/pg-referee-claims.ts on 2026-09-05 when the filesystem claims
       store that used to hold it was deleted; the import here is what says the
       sweep still writes the shared constant rather than a copy. */
    await pgRefereeClaimsStore.begin(SLUG, clockFrom(staleStart()));
    expect((await pgRefereeClaimsStore.sweep(SLUG, false))?.error).toBe(CLAIMS_SWEPT);
  });

  it("writes the shared sentence over a swept criterion", async () => {
    await pgRefereeCriteriaStore.begin(SLUG, "Abandoned", { kind: "single" }, "spya-crte22");
    const swept = await pgRefereeCriteriaStore.sweepPending(SLUG, {
      keep: new Set<string>(),
      graceMs: -1000,
    });
    expect(swept[0]?.error).toBe(CRITERION_SWEPT);
  });

  /* ------------------------------------------ the two behaviours of its own -- */

  it("leaves a young abandoned claims run alone, which is what the window is for", async () => {
    /* **The only guard on `CLAIMS_ORPHAN_GRACE_MS` outside
       tests/store-pg-referee-claims.test.ts.** It was `differs about a young
       abandoned claims run, on purpose` while there were two stores — the
       filesystem one swept the moment anybody looked — and without it the past
       clock the claims script runs on is indistinguishable from an exclusion:
       the day the grace window is dropped, the walk above still passes. */
    await pgRefereeClaimsStore.begin(SLUG);
    const spared = await pgRefereeClaimsStore.sweep(SLUG, false);
    expect(
      spared?.status,
      `Postgres leaves a run younger than ${CLAIMS_ORPHAN_GRACE_MS}ms alone, because the ` +
        "process streaming the answer is a different process from the one being asked",
    ).toBe("pending");
  });

  it("404s a slug that is not an article, rather than answering about it", async () => {
    /* It reaches the reader: `GET /api/referee/claims/:slug` goes straight to
       the store. The slug is globally unique, so a lookup without `ownedSlug`
       finds a real article belonging to a stranger — and 404 rather than 403,
       because a 403 confirms it exists. The filesystem store answered `[]` and
       `null` here, which is the shape this refusal replaced. */
    await expect(pgRefereeCriteriaStore.load(ABSENT)).rejects.toThrow(/not found|no article/i);
    await expect(pgRefereeClaimsStore.load(ABSENT)).rejects.toThrow(/not found|no article/i);
  });

  it("says an article with no run has no run", async () => {
    /* The ordinary state, and not a missing resource: the panel has a sentence
       for it and needs the answer to be `null` rather than a throw. Read
       against `SLUG`, which IS an article — so this and the case above are the
       two halves of one distinction rather than the same emptiness twice. */
    const run: ClaimsRun | null = await pgRefereeClaimsStore.load(SLUG);
    expect(run).toBeNull();
    expect(await pgRefereeCriteriaStore.load(SLUG)).toEqual([]);
  });
});
