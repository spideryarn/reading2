/**
 * Where a referee's criteria are kept — `withCriterion`, and who may read one.
 *
 * Two things are under test and they are deliberately different in kind:
 *
 * 1. **`withCriterion` as a pure decision.** It holds the three-condition retry
 *    rule this repo carries a postmortem for
 *    (docs/postmortems/260826f-search-retry-remints-instead-of-resetting.md) plus one
 *    addition of its own — a reset adopts the new config. `pgRefereeCriteria
 *    Store` calls it, so pinning it here pins it for the store. No database and
 *    no files: it is a function over an array.
 * 2. **Ownership**, against a database with two owners in it. Skipped loudly
 *    when there is no database, for the reason tests/db-schema.test.ts
 *    explains: a skipped test protects nothing, so the run must say "skipped"
 *    rather than "passed".
 *
 * **A third block went on 2026-09-05**, with the filesystem store
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G):
 * seven cases driving `beginCriterion`/`finishCriterion`/`loadCriteria` against
 * `data/<slug>/referee-criteria.json`, including the round trip that proved a
 * −80 came back as −80 out of the bytes on disk. Its Postgres counterpart is
 * `a negative valence survives the round trip` in
 * tests/store-parity-referee.test.ts, which asserts −80 **and** an unclamped
 * confidence against the row.
 */

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import type { RefereeCriterionConfig, RefereeResult } from "../src/referee-criteria.js";
import { withCriterion } from "../src/referee-criteria-store.js";
import { pgRefereeCriteriaStore } from "../src/store/pg-referee-criteria.js";
import { MAX_CRITERIA, type SavedCriterion } from "../src/saved-criteria.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const SINGLE: RefereeCriterionConfig = { kind: "single" };
const DIVERGING: RefereeCriterionConfig = {
  kind: "diverging",
  poles: { against: "a control is missing", favour: "the controls settle it" },
  scale: "rg",
};

/** A stored diverging result whose valence is the number this file is about. */
const NEGATIVE: RefereeResult = {
  kind: "diverging",
  blockId: "spya-k3m9qt",
  quote: "no negative control",
  start: 3,
  confidence: 90,
  reasoning: "the control is missing",
  valence: -80,
};

const row = (over: Partial<SavedCriterion> = {}): SavedCriterion => ({
  id: "spya-aaaaaa",
  criterion: "Are the controls adequate?",
  config: SINGLE,
  createdAt: "2026-09-01T00:00:00.000Z",
  status: "done",
  results: [],
  ...over,
});

/* -------------------------------------------------------- the pure rule -- */

describe("withCriterion — which row a request produces", () => {
  it("mints a row when the id is free", () => {
    const { row: made, kind } = withCriterion([], "Controls?", SINGLE, "spya-bbbbbb", "t");
    expect(kind).toBe("minted");
    expect(made.id).toBe("spya-bbbbbb");
    expect(made.status).toBe("pending");
    expect(made.results).toEqual([]);
  });

  it("mints a fresh id rather than colliding with a row that has not failed", () => {
    const existing = [row({ status: "done" })];
    const { row: made, kind } = withCriterion(existing, "Are the controls adequate?", SINGLE, "spya-aaaaaa", "t");
    expect(kind).toBe("minted");
    expect(made.id).not.toBe("spya-aaaaaa");
  });

  it("resets a failed row of the same id and the same criterion", () => {
    const existing = [row({ status: "error", error: "boom", model: "m", colour: 3 })];
    const { row: made, kind } = withCriterion(existing, "Are the controls adequate?", SINGLE, "spya-aaaaaa", "t");
    expect(kind).toBe("reset");
    expect(made.id).toBe("spya-aaaaaa");
    // Rebuilt field by field: the failed attempt cannot survive underneath.
    expect(made.error).toBeUndefined();
    expect(made.model).toBeUndefined();
    // The colour is a property of the question, not of the attempt — and the
    // two stores disagreeing about that is a bug src/searches.ts already had.
    expect(made.colour).toBe(3);
    expect(made.createdAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("refuses to reset under a different criterion, however the id matches", () => {
    const existing = [row({ status: "error" })];
    const { kind } = withCriterion(existing, "Something else entirely", SINGLE, "spya-aaaaaa", "t");
    expect(kind).toBe("minted");
  });

  /* The one deliberate difference from `withRun`. A diverging criterion whose
     run failed because its poles were nonsense is exactly the row a referee
     edits and runs again; answering the fixed question with the broken
     configuration would be the worst available outcome. */
  it("adopts the new config on a reset, because that is what a referee fixes", () => {
    const broken: RefereeCriterionConfig = {
      kind: "diverging",
      poles: { against: "x", favour: "y" },
      scale: "br",
    };
    const existing = [row({ status: "error", config: broken })];
    const { row: made } = withCriterion(existing, "Are the controls adequate?", DIVERGING, "spya-aaaaaa", "t");
    expect(made.config).toEqual(DIVERGING);
  });

  it("keeps at most MAX_CRITERIA, oldest first", () => {
    let rows: SavedCriterion[] = [];
    for (let i = 0; i < MAX_CRITERIA + 3; i++) {
      rows = withCriterion(rows, `c${i}`, SINGLE, undefined, `t${i}`).criteria;
    }
    expect(rows).toHaveLength(MAX_CRITERIA);
    expect(rows[0]?.criterion).toBe("c3");
  });

  /* `withColour` used to live beside `withCriterion` and had two cases here.
     It went with the filesystem criteria store on 2026-09-05
     (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
     the stage-G section) — `pg-referee-criteria.ts` never imported it, doing the
     recolour as one `UPDATE` and importing `requireColour` from src/searches.ts
     directly. Both its claims moved into the Postgres block below: the
     absent-key-not-null clearing is now asserted inside § *walks one criterion
     through begin, finish, fail, retry, finish, delete*, and the refusal is
     § *refuses a bad colour with a 400*. */
});

/* ------------------------------------------------------ ownership, in pg -- */

/* `pgReady` warns loudly for us when there is no database — a skipped test
   protects nothing, so the run has to say "skipped" rather than "passed". */
await pgReady({
  suite: "tests/referee-criteria-store.test.ts",
  tables: ["spideryarn.referee_criteria"],
});
/**
 * **Whose criteria they are, against a database with two owners in it.**
 *
 * Ownership is not something the filesystem store has any notion of — it reads
 * `data/<slug>/`, and a slug is a slug. It lives in `ownedSlug` (src/store/pg.ts),
 * which the Postgres store puts in front of every read, and until this landed
 * nothing tested it: the route case in tests/comment-referee-mark.test.ts is
 * about another *article*, on the filesystem, with one owner in the world. GPT
 * Sol's finding 6 named that gap — "the implementation is owner-scoped, but
 * that particular test is not evidence for it".
 *
 * The order of the two assertions is the point. First that the criterion really
 * is in the table, because a test that only checks the refusal passes just as
 * well when nothing was ever written — which is the shape
 * docs/reusable/silent-success.md is about, and it is easy to write here by
 * accident. Then that the store will not hand it over.
 */
describe("a criterion under somebody else's article", () => {
  const OTHER_SLUG = "test-referee-criteria-other-owner";
  const OTHER_OWNER = "3f0a17c6-9d54-4b8e-9a2f-5c1b7e0d4a63";
  const OTHER_ARTICLE = "dddddddd-0000-4000-8000-00000000d001";
  const OTHER_CRITERION = "spya-nx7wqz";

  beforeEach(async () => {
    const db = getDb();
    await db.delete(articles).where(eq(articles.slug, OTHER_SLUG));
    /* `auth.users` first — `articles.owner_id` and `referee_criteria.owner_id`
       both reference it (`referee_criteria_owner_fk`), so a made-up uuid is a
       foreign-key error rather than a second owner. */
    await seedAuthUser(db, {
      id: OTHER_OWNER,
      email: "referee-criteria-other-owner@example.invalid",
      onConflictDoNothing: true,
    });
    await db.insert(articles).values({ id: OTHER_ARTICLE, ownerId: OTHER_OWNER, slug: OTHER_SLUG });
    await db.execute(sql`
      insert into spideryarn.referee_criteria (article_id, id, owner_id, kind, criterion, status)
      values (${OTHER_ARTICLE}, ${OTHER_CRITERION}, ${OTHER_OWNER}, 'single', 'their question', 'done')
    `);
  });

  afterAll(async () => {
    // No `closeDb()` here: the parity block below owns the pool's lifetime.
    await getDb().delete(articles).where(eq(articles.slug, OTHER_SLUG));
    await getDb().execute(sql`delete from auth.users where id = ${OTHER_OWNER}`);
  });

  it("is in the table, so the refusal below is about ownership and not an empty fixture", async () => {
    const rows = await getDb().execute(sql`
      select id from spideryarn.referee_criteria where article_id = ${OTHER_ARTICLE}
    `);
    expect(rows.rows.map((r) => r.id)).toEqual([OTHER_CRITERION]);
    // And the owner really is somebody else, or every assertion here is empty.
    expect(OTHER_OWNER).not.toBe(currentOwnerId());
  });

  it("is not theirs to read, so it is not theirs to place a passage on either", async () => {
    /* A 404 rather than an empty list, and that is `ownedSlug` doing it: the
       slug does not resolve to an article this owner has, so there is nothing
       to read criteria from. `tidyMark` in src/routes.ts refuses the placement
       on the back of exactly this — it takes the criteria this owner can see
       and refuses an id that is not among them. */
    await expect(pgRefereeCriteriaStore.load(OTHER_SLUG)).rejects.toMatchObject({ status: 404 });
  });
});

/**
 * **Was `the two stores answer identically` until 2026-09-05**, when the
 * filesystem arm went with its store
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G).
 * The fixture and the script are unchanged; the comparison against a second
 * store is what went, and the two assertions that were always against a
 * literal — a retry resets rather than mints, and a −80 comes back as −80 —
 * are what it was really holding.
 */
describe("one criterion's life in the Postgres store", () => {
  const PSLUG = "test-referee-criteria-parity";
  const ARTICLE_ID = "00000000-0000-4000-8000-0000000rc001".replace("r", "a").replace("c", "b");
  const REVISION_ID = "00000000-0000-4000-8000-0000000ab002";

  /**
   * **A real article with real blocks**, which is the whole point of the fixture.
   *
   * The first version gave Postgres an article with no revision, and
   * `sourceHash` was the first field to notice: there was nothing to hash. The
   * store is entitled to a published revision with blocks under it, and a
   * fixture that does not supply one tests the fixture.
   */
  const BLOCKS = [
    {
      id: "spya-parqty",
      tag: "p",
      kind: "text",
      text: "We ran no negative control.",
      words: 5,
      html: "<p>We ran no negative control.</p>",
      gistable: true,
    },
  ] as const;

  beforeEach(async () => {
    const db = getDb();
    await db.delete(articles).where(eq(articles.slug, PSLUG));
    await db.insert(articles).values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: PSLUG });
    // No `ownerId` on a revision — ownership lives on `articles`, and a revision
    // is reached through its article.
    await db.insert(articleRevisions).values({
      id: REVISION_ID,
      articleId: ARTICLE_ID,
      status: "published",
    });
    /* The ids exist as identities first: `revision_blocks` has a foreign key
       onto `block_identities`, which is the spine enforcing itself.
       docs/project/block-ids.md. */
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
    await getDb().delete(articles).where(eq(articles.slug, PSLUG));
    await closeDb();
  });

  /** The wire form — what `src/routes.ts` would send — with the id normalised. */
  const wire = (rows: SavedCriterion[]) =>
    JSON.parse(JSON.stringify(rows)).map((r: SavedCriterion) => ({ ...r, id: "#0" }));

  it("walks one criterion through begin, finish, fail, retry, finish, delete", async () => {
    const store = pgRefereeCriteriaStore;
    const now = () => "2026-09-01T00:00:00.000Z";

    const first = await store.begin(PSLUG, "Are the controls adequate?", DIVERGING, undefined, now);
    expect(first.row.status).toBe("pending");

    await store.finish(PSLUG, first.row.id, { status: "error", error: "boom" }, first.attempt);
    expect((await store.load(PSLUG))[0]).toMatchObject({ status: "error", error: "boom" });

    /* **The retry**, and the assertion the whole walk is here for: the same id,
       the same criterion, a row that failed. The store must reset rather than
       mint, and must clear the error. `withCriterion` decides it — the block at
       the top of this file pins the decision, and this pins the store obeying
       it. docs/postmortems/260826f-search-retry-remints-instead-of-resetting.md. */
    const again = await store.begin(
      PSLUG,
      "Are the controls adequate?",
      DIVERGING,
      first.row.id,
      now,
    );
    expect(again.row.id).toBe(first.row.id);
    expect(again.row.status).toBe("pending");
    expect("error" in again.row).toBe(false);
    // One row, not two: a mint would leave the failed one beside it.
    expect(await store.load(PSLUG)).toHaveLength(1);

    await store.finish(
      PSLUG,
      again.row.id,
      { status: "done", results: [NEGATIVE], model: "m" },
      again.attempt,
    );
    await store.recolour(PSLUG, again.row.id, 5);
    const done = (await store.load(PSLUG))[0];
    expect(done?.status).toBe("done");
    expect(done?.colour).toBe(5);
    expect(wire([done as SavedCriterion])[0]).toMatchObject({ id: "#0", model: "m" });

    /* Clearing removes the key rather than storing a `null`, which is not a
       nicety: `exactOptionalPropertyTypes` is on and `SavedCriterion.colour` is
       optional, so a `null` on the wire is a different value from an absent one
       and a client checking `"colour" in row` would read "uncoloured" as
       "coloured". The column *is* null; `pg-referee-criteria.ts` spells the
       difference as a conditional spread on the way out. Ported from
       `withColour`'s own case, 2026-09-05. */
    await store.recolour(PSLUG, again.row.id, null);
    const cleared = (await store.load(PSLUG))[0];
    expect(cleared && "colour" in cleared).toBe(false);

    expect(await store.remove(PSLUG, again.row.id)).toEqual([]);
  });

  it("hands back a valence of −80 rather than 0", async () => {
    const store = pgRefereeCriteriaStore;
    const begun = await store.begin(PSLUG, "Controls?", DIVERGING);
    await store.finish(PSLUG, begun.row.id, { status: "done", results: [NEGATIVE] }, begun.attempt);
    const back = await store.load(PSLUG);
    const stored = back.find((c) => c.id === begun.row.id)?.results[0];
    expect(stored?.kind).toBe("diverging");
    if (stored?.kind === "diverging") expect(stored.valence).toBe(-80);
    await store.remove(PSLUG, begun.row.id);
  });

  it("refuses a bad colour with a 400, not a store failure", async () => {
    await expect(
      pgRefereeCriteriaStore.recolour(PSLUG, "spya-aaaaaa", 1.5),
    ).rejects.toMatchObject({ status: 400 });
  });
});
