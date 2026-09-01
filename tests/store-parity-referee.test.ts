/**
 * **The two stores must answer identically about Referee mode.**
 *
 * `tests/store-parity.test.ts` says of itself that it is *"the test the whole
 * migration rests on"*, and it contains the string `referee` zero times. Criteria
 * has had two implementations since 2026-08-31 and nothing had ever compared
 * them; Claims shipped on the same day with **one**, so under
 * `SPIDERYARN_STORE=postgres` — the configuration production has run since
 * 2026-08-27 — every claims operation returned a 501 and the sub-mode did not
 * exist for anybody but a developer on a laptop. Every test passed throughout,
 * because `SPIDERYARN_STORE` unset means `files`
 * ([`src/store/live.ts`](../src/store/live.ts)) and so every test, every local
 * run and the browser pass all exercised the configuration that is not deployed.
 * docs/postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md,
 * and stage 2 of docs/plans/260901f-referee-mode-on-the-database-and-the-parity-that-would-have-caught-it.md.
 *
 * A **new file** rather than an edit to `store-parity.test.ts`, which carries
 * another session's in-flight work and takes the corpus lock. Nothing here takes
 * that lock: the fixture is two paragraphs written into both stores directly.
 *
 * ## It compares the API-shaped result, not SQL rows
 *
 * The discipline is `store-parity.test.ts`'s and the reason is its: a row-level
 * comparison passes happily while the thing the client receives has changed
 * shape, and the client is the only thing that matters. So every comparison
 * below goes through `wire()` — `JSON.parse(JSON.stringify(…))`, exactly what
 * `src/routes.ts` sends — and never through a `select`. The one place this file
 * does touch SQL is the fixture, and a fixture is not an assertion.
 *
 * What serialising buys and does not buy is written out at length in
 * `store-parity.test.ts` § *What serialising does and does not buy*, and none of
 * it changes here. The short version: `toEqual` separates `{error: null}` from
 * `{}` on its own, which is the near-miss these two stores are most prone to —
 * Postgres hands back `null` where the file simply had no key, and both adapters
 * spread conditionally to avoid it.
 *
 * ## The comparison is step by step, not end to end
 *
 * `store-reader-state-parity.test.ts` § the header has the argument and it is
 * the same one: these are **writes**, so a single end-state comparison would
 * miss anything that goes wrong and is then overwritten. A retry that keeps the
 * failed attempt's results is invisible by the time the next answer lands.
 *
 * ## What the two stores genuinely disagree about
 *
 * Two things, both real, both asserted **positively** in their own tests rather
 * than normalised away — the rule `store-parity.test.ts` keeps:
 *
 * 1. **A slug that is not an article at all.** The filesystem answers `[]` and
 *    `null`; Postgres throws a tagged 404 from `ownedSlug`, because a slug is
 *    globally unique and the row it would otherwise find belongs to a stranger.
 * 2. **A young abandoned claims run.** The filesystem store sweeps it the
 *    instant anybody looks; Postgres leaves it alone for `CLAIMS_ORPHAN_GRACE_MS`,
 *    because on Vercel the process that is streaming the answer is a different
 *    process from the one being asked. `RefereeClaimsStore.sweep` in
 *    src/store/contracts.ts holds that decision.
 *
 * Difference 2 is why the claims script is driven from a clock in the past
 * (`staleStart`) rather than from the fixed one the criteria script uses. That
 * is **not** an exclusion: both stores are handed the same timestamp, both
 * consider the run abandoned, and every field of the swept run is then compared
 * as usual. The *young* case is asserted in its own test, so the past clock
 * cannot quietly hide a divergence nobody looked at.
 *
 * ## Skips loudly when there is no database
 *
 * A check that skips when the database is away, in a suite written *because*
 * nobody exercised the database, is the joke writing itself. `pgReady` says so
 * on stderr, and `REQUIRE_POSTGRES=1` turns the skip into a failure —
 * docs/project/testing.md § When a skip is not acceptable.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import type { ClaimsRun } from "../src/referee-claims.js";
import { CLAIMS_SWEPT } from "../src/referee-claims-store.js";
import type { DivergingResult, SingleResult } from "../src/referee-criteria.js";
import type { Comment } from "../src/types.js";
import { CRITERION_SWEPT } from "../src/referee-criteria-store.js";
import type { CommentStore, RefereeClaimsStore, RefereeCriteriaStore } from "../src/store/contracts.js";
import { fsCommentStore, fsRefereeClaimsStore, fsRefereeCriteriaStore } from "../src/store/fs.js";
import {
  CLAIMS_ORPHAN_GRACE_MS,
  pgRefereeClaimsStore,
} from "../src/store/pg-referee-claims.js";
import { pgCommentStore } from "../src/store/pg-comments.js";
import { pgRefereeCriteriaStore } from "../src/store/pg-referee-criteria.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "test-referee-parity";
const ARTICLE_ID = "00000000-0000-4000-8000-00000000af10";
const REVISION_ID = "00000000-0000-4000-8000-00000000af11";

/** A slug no article has, in either store — see difference 1 in the header. */
const ABSENT = "test-referee-parity-no-such-article";

const { reachable } = await pgReady({
  suite: "tests/store-parity-referee.test.ts",
  tables: ["spideryarn.referee_criteria", "spideryarn.referee_claims"],
  max: 2,
});

const when = reachable ? describe : describe.skip;

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
 * Compare two runs of the same script, step by step.
 *
 * Step by step rather than as one array, so the failure names the step that
 * diverged instead of printing two long snapshots and leaving the reader to
 * diff them.
 */
function compare(fromFiles: unknown[], fromPg: unknown[], what: string): void {
  expect(fromPg, `${what}: the two stores produced different numbers of steps`).toHaveLength(
    fromFiles.length,
  );
  for (const [i, step] of fromFiles.entries()) {
    const label = (step as { label: string }).label;
    expect(wire(fromPg[i]), `${what} parity diverged at: ${label}`).toEqual(wire(step));
  }
}

/**
 * The two paragraphs both stores are made to agree about.
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

when("the filesystem and Postgres stores agree about Referee mode", { timeout: 30_000 }, () => {
  /**
   * **A real article on BOTH sides**, which is the whole point of the fixture.
   *
   * `store-reader-state-parity.test.ts` records what happens without it: an
   * article that exists in Postgres and not on disk is two different situations
   * being compared, and `sourceHash` is the first field to notice — the
   * filesystem's `currentSourceHash` falls through to `example/` for a slug with
   * no directory, and Postgres has no fixture fallback. Neither store was wrong.
   * The fixture was.
   *
   * The alternative was excluding `sourceHash` from the comparison, which
   * removes the divergence by removing the check. It is the field the whole
   * staleness banner rests on, so it is made testable instead.
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

    const dir = path.join(ROOT, "data", SLUG);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "blocks.json"), JSON.stringify({ blocks: BLOCKS }), "utf8");
    /* `tree.json` too: `hashDir` in src/searches.ts requires it before it will
       hash a directory, for the same reason `articleDir` does — a half-finished
       ingest must not be fingerprinted while the reader is shown the fixture. */
    await writeFile(
      path.join(dir, "tree.json"),
      JSON.stringify({ rootId: FIRST_BLOCK.id, nodes: {} }),
      "utf8",
    );
  });

  afterAll(async () => {
    await getDb().delete(articles).where(eq(articles.slug, SLUG));
    await closeDb();
    await rm(path.join(ROOT, "data", SLUG), { recursive: true, force: true });
  });

  /**
   * Throw away what the filesystem script wrote, and leave the article alone.
   *
   * Only the two state files, not the directory: `blocks.json` and `tree.json`
   * are the fixture, and deleting them would leave the Postgres half comparing
   * against an article the filesystem no longer has.
   */
  async function forgetFiles(): Promise<void> {
    const dir = path.join(ROOT, "data", SLUG);
    await rm(path.join(dir, "referee-criteria.json"), { force: true });
    await rm(path.join(dir, "referee-claims.json"), { force: true });
    // The comments too, since a placement is a comment — see the placement
    // script below. Without this the Postgres half would compare against an
    // article the filesystem still has a comment on.
    await rm(path.join(dir, "comments.json"), { force: true });
  }

  /* ------------------------------------------------------------ the fixture -- */

  it("puts the same two paragraphs in both stores", async () => {
    /* **The alarm on everything below.** Every parity assertion in this file
       would also pass if both stores answered "I have never heard of this
       article" — `[]` equals `[]` and `null` equals `null`. This is the one
       test that says the fixture is really there, on both sides, and that the
       two stores compute the *same* fingerprint of it.

       Equal to each other AND a real hash: `currentSourceHash` answers
       `undefined` for an article it cannot read, and two `undefined`s are equal. */
    const fromFiles = await fsRefereeCriteriaStore.sourceHash(SLUG);
    const fromPg = await pgRefereeCriteriaStore.sourceHash(SLUG);
    expect(fromFiles).toMatch(/^[0-9a-f]{8,}$/);
    expect(fromPg).toBe(fromFiles);
    // And the claims store computes it the same way — it is a third copy of the
    // query (see its docstring), which is exactly how a fingerprint drifts.
    expect(await fsRefereeClaimsStore.sourceHash(SLUG)).toBe(fromFiles);
    expect(await pgRefereeClaimsStore.sourceHash(SLUG)).toBe(fromFiles);
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
    const fromFiles = await criteriaScript(fsRefereeCriteriaStore);
    await forgetFiles();
    const fromPg = await criteriaScript(pgRefereeCriteriaStore);
    compare(fromFiles, fromPg, "criteria");
  });

  it("keeps a negative valence signed, in both stores, byte for byte", async () => {
    /* The script above already compares this inside a whole-row snapshot. This
       test exists because that failure would read as "criteria parity diverged
       at: finish the retry with a negative valence" and leave the reader to find
       the sign in two long objects. Here the number is the assertion, and each
       store is checked against the literal rather than only against the other —
       two stores that both clamped to 0 would agree perfectly. */
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

    const fromFiles = await script(fsRefereeCriteriaStore);
    await forgetFiles();
    const fromPg = await script(pgRefereeCriteriaStore);

    for (const [name, row] of [
      ["files", fromFiles],
      ["postgres", fromPg],
    ] as const) {
      const results = row?.results ?? [];
      expect(results, `${name} stored no result at all`).toHaveLength(1);
      const first = results[0] as DivergingResult;
      expect(first.kind, `${name} lost the diverging kind`).toBe("diverging");
      expect(first.valence, `${name} did not keep the valence signed`).toBe(-80);
      // The confidence is the field a valence must never travel through:
      // `clampConfidence` turns −80 into 0, silently.
      expect(first.confidence, `${name} moved the valence into confidence`).toBe(55);
    }
    expect(wire(fromPg)).toEqual(wire(fromFiles));
  });

  /* ---------------------------------------------- the referee's own placement -- */

  /**
   * A placement's whole life, driven through whichever pair of stores it is
   * handed: made with the comment, changed, changed again across zero, cleared,
   * and made a second time.
   *
   * **The comment stores are in this file rather than in
   * `store-comments.test.ts`**, which is a Postgres-only suite by its own
   * header, because a placement is Referee mode and this is the file that
   * compares Referee mode across the two stores. `patchMark` landed on
   * 2026-09-01 with an implementation on each side, and the way this repo has
   * twice shipped a one-sided store is by nobody writing the comparison.
   *
   * ## Timestamps are dropped by name, and asserted separately
   *
   * `CommentStore` has **no clock seam** — `create` and `patchMark` take a slug,
   * an id and a value, and each store reads its own clock — where
   * `RefereeCriteriaStore.begin` takes a `now`. So `createdAt` and `updatedAt`
   * cannot agree between two runs and are removed by name, exactly as `attempt`
   * is above and for the same reason: letting `JSON.stringify` drop one side
   * would compare "absent" against a real timestamp and pass by accident. What
   * they must do is checked positively below, against each store, rather than
   * normalised into agreement.
   */
  function wireComment(value: unknown): unknown {
    return normalise(
      JSON.parse(
        JSON.stringify(value, (key, v) =>
          key === "createdAt" || key === "updatedAt" ? undefined : v,
        ),
      ),
    );
  }

  /** The id both stores mint the placement's criterion under, so the two agree. */
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
    const fromFiles = await placementScript(fsRefereeCriteriaStore, fsCommentStore);
    await forgetFiles();
    const fromPg = await placementScript(pgRefereeCriteriaStore, pgCommentStore);

    expect(fromPg, "placement: the two stores produced different numbers of steps").toHaveLength(
      fromFiles.length,
    );
    for (const [i, step] of fromFiles.entries()) {
      const label = (step as { label: string }).label;
      expect(wireComment(fromPg[i]), `placement parity diverged at: ${label}`).toEqual(
        wireComment(step),
      );
    }

    /* Each store against the literal as well as against the other — two stores
       that both clamped a negative to `0` would agree perfectly, and the
       comparison above would say nothing. The step numbers are the script's. */
    for (const [name, steps] of [
      ["files", fromFiles],
      ["postgres", fromPg],
    ] as const) {
      const at = (i: number) => (steps[i] as { comments: Comment[] }).comments[0];
      expect(at(1)?.valence, `${name} did not store the placement`).toBe(-80);
      expect(at(2)?.valence, `${name} did not change the placement`).toBe(50);
      expect(at(3)?.valence, `${name} did not keep the edited placement signed`).toBe(-70);
      expect("valence" in (at(4) ?? {}), `${name} left a number behind after a clear`).toBe(false);
      expect("criterionId" in (at(4) ?? {}), `${name} left a criterion behind`).toBe(false);
      // Clearing a placement is not deleting a comment.
      expect(at(4)?.body, `${name} lost the reader's words`).toBe(
        "no pre-registration is mentioned anywhere",
      );
      expect(at(4)?.quote, `${name} lost the passage`).toBe(PLACED_QUOTE);
      expect(at(5)?.criterionId, `${name} did not re-place the passage`).toBe(PLACED_ON);
      expect("valence" in (at(5) ?? {}), `${name} invented a number nobody chose`).toBe(false);

      /* The two fields `wireComment` drops, checked here instead: `createdAt` is
         `create`'s alone and a patch may not move it, and `updatedAt` has to be
         stamped or "when did this change" is unanswerable in both stores. */
      expect(at(3)?.createdAt, `${name} moved createdAt on a patch`).toBe(at(1)?.createdAt);
      expect(at(3)?.updatedAt, `${name} did not stamp updatedAt`).toBeTruthy();
      expect(at(1)?.updatedAt, `${name} stamped updatedAt on a create`).toBeUndefined();
    }
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
    // One number, both scripts — see `staleStart`.
    const startedAt = staleStart();
    const fromFiles = await claimsScript(fsRefereeClaimsStore, startedAt);
    await forgetFiles();
    const fromPg = await claimsScript(pgRefereeClaimsStore, startedAt);
    compare(fromFiles, fromPg, "claims");
  });

  it("writes the same sentence over a swept run", async () => {
    /* The one string a referee actually reads out of a sweep. Both stores import
       it from src/referee-claims-store.ts rather than spelling it out, and this
       is what says they still do. */
    const now = clockFrom(staleStart());
    await fsRefereeClaimsStore.begin(SLUG, now);
    const fromFiles = await fsRefereeClaimsStore.sweep(SLUG, false);
    await forgetFiles();

    await pgRefereeClaimsStore.begin(SLUG, now);
    const fromPg = await pgRefereeClaimsStore.sweep(SLUG, false);

    expect(fromFiles?.error).toBe(CLAIMS_SWEPT);
    expect(fromPg?.error).toBe(CLAIMS_SWEPT);
  });

  it("writes the same sentence over a swept criterion", async () => {
    const begin = (store: RefereeCriteriaStore) =>
      store.begin(SLUG, "Abandoned", { kind: "single" }, "spya-crte22");
    const sweep = (store: RefereeCriteriaStore) =>
      store.sweepPending(SLUG, { keep: new Set<string>(), graceMs: -1000 });

    await begin(fsRefereeCriteriaStore);
    const fromFiles = await sweep(fsRefereeCriteriaStore);
    await forgetFiles();

    await begin(pgRefereeCriteriaStore);
    const fromPg = await sweep(pgRefereeCriteriaStore);

    expect(fromFiles[0]?.error).toBe(CRITERION_SWEPT);
    expect(fromPg[0]?.error).toBe(CRITERION_SWEPT);
  });

  /* ------------------------------------ what they are meant to disagree about -- */

  it("differs about a young abandoned claims run, on purpose", async () => {
    /* Difference 2, asserted positively rather than normalised away — the rule
       `store-parity.test.ts` keeps about the three differences it lives with.
       Without this test the past clock the claims script runs on would be
       indistinguishable from an exclusion, and the day the grace window is
       dropped from the Postgres store nothing would notice. */
    await fsRefereeClaimsStore.begin(SLUG);
    const swept = await fsRefereeClaimsStore.sweep(SLUG, false);
    expect(swept?.status, "the filesystem store sweeps the moment anybody looks").toBe("error");
    await forgetFiles();

    await pgRefereeClaimsStore.begin(SLUG);
    const spared = await pgRefereeClaimsStore.sweep(SLUG, false);
    expect(
      spared?.status,
      `Postgres leaves a run younger than ${CLAIMS_ORPHAN_GRACE_MS}ms alone, because the ` +
        "process streaming the answer is a different process from the one being asked",
    ).toBe("pending");
  });

  it("differs about a slug that is not an article, on purpose", async () => {
    /* Difference 1. It reaches the reader: `GET /api/referee/claims/:slug` goes
       straight to the store, so an unknown slug is a 200 with `run: null` on
       files and a 404 under Postgres. Postgres is the one that is right — the
       slug is globally unique, so a lookup without `ownedSlug` finds a real
       article belonging to a stranger, and 404 rather than 403 because a 403
       confirms it exists. */
    expect(await fsRefereeCriteriaStore.load(ABSENT)).toEqual([]);
    expect(await fsRefereeClaimsStore.load(ABSENT)).toBeNull();

    await expect(pgRefereeCriteriaStore.load(ABSENT)).rejects.toThrow(/not found|no article/i);
    await expect(pgRefereeClaimsStore.load(ABSENT)).rejects.toThrow(/not found|no article/i);
  });

  it("agrees that an article with no run has no run", async () => {
    /* The ordinary state, and not a missing resource: the panel has a sentence
       for it and needs the answer to be `null` rather than a throw. */
    const fromFiles: ClaimsRun | null = await fsRefereeClaimsStore.load(SLUG);
    const fromPg: ClaimsRun | null = await pgRefereeClaimsStore.load(SLUG);
    expect(fromFiles).toBeNull();
    expect(fromPg).toBeNull();
    expect(await fsRefereeCriteriaStore.load(SLUG)).toEqual([]);
    expect(await pgRefereeCriteriaStore.load(SLUG)).toEqual([]);
  });
});
