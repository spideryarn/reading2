/**
 * **The rollback carries the referee's work, including the minus signs.**
 *
 * `npm run db:export` is the only way back out of Postgres. Referee mode added
 * a table and two columns on 2026-08-31 and the exporter knew about none of
 * them, so a rollback would have written `comments.json` with every referee
 * placement stripped and no `referee-criteria.json` at all — reporting success,
 * and listing the files it did write as though that were all of them.
 *
 * `tests/store-export-covers-tables.test.ts` is the guard that stops the *next*
 * table arriving unnoticed. This is the behavioural half: it actually runs the
 * export over rows that carry a placement and reads the files back.
 *
 * ## Why it builds its own article rather than using the corpus
 *
 * tests/store-roundtrip.test.ts compares an export against the `data/` fixtures,
 * and no fixture in `data/` has a criterion or a placement on it. A round-trip
 * test over a corpus missing the field passes on every article and proves
 * nothing about the field — docs/reusable/silent-success.md § "A round-trip test
 * over a corpus missing the field". So the rows are made here, deliberately,
 * with the values that would be lost.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  comments as commentsTable,
  refereeCriteria,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import type { SavedCriterion } from "../src/saved-criteria.js";
import { exportArticle } from "../src/store/export.js";
import type { Comment } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const SLUG = "store-export-referee-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000fe";
const REVISION_ID = "00000000-0000-4000-8000-0000000000ff";
const BLOCK_ID = "spya-rfb234";
const CRITERION_ID = "spya-rfc234";
const COMMENT_ID = "spya-rfd234";
const NOTE_ID = "spya-rfe234";

const { reachable } = await pgReady({
  suite: "tests/store-export-referee.test.ts",
  tables: ["spideryarn.referee_criteria"],
});

const when = reachable ? describe : describe.skip;

when("db:export and the referee's own work", () => {
  let out: string;

  beforeAll(async () => {
    const db = getDb();
    const owner = currentOwnerId();
    await db
      .insert(articles)
      .values({ id: ARTICLE_ID, ownerId: owner, slug: SLUG })
      .onConflictDoNothing();
    await db
      .insert(articleRevisions)
      .values({ id: REVISION_ID, articleId: ARTICLE_ID, status: "published" })
      .onConflictDoNothing();
    await db
      .update(articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(articles.id, ARTICLE_ID));
    await db
      .insert(blockIdentities)
      .values({ articleId: ARTICLE_ID, blockId: BLOCK_ID })
      .onConflictDoNothing();

    await db.delete(commentsTable).where(eq(commentsTable.articleId, ARTICLE_ID));
    await db.delete(refereeCriteria).where(eq(refereeCriteria.articleId, ARTICLE_ID));
    await db.insert(refereeCriteria).values({
      articleId: ARTICLE_ID,
      id: CRITERION_ID,
      ownerId: owner,
      kind: "diverging",
      criterion: "Are the controls adequate?",
      poleAgainst: "the controls are inadequate",
      poleFavour: "the controls are adequate",
      scale: "rg",
      status: "done",
      /* The MODEL's valence, which is a different number in a different place
         from the referee's below. Negative here too, because the export has two
         chances to lose a sign and only one of them is on `comments`. */
      results: [
        {
          kind: "diverging",
          blockId: BLOCK_ID,
          quote: "a stretch of prose",
          start: 0,
          confidence: 70,
          reasoning: "no allocation concealment is described",
          valence: -60,
        },
      ],
      colour: 3,
      sourceHash: "sha256:whatever",
    });

    await db.insert(commentsTable).values([
      {
        articleId: ARTICLE_ID,
        id: COMMENT_ID,
        ownerId: owner,
        blockId: BLOCK_ID,
        quote: "a stretch of prose",
        start: 0,
        body: "the randomisation is not described anywhere",
        status: "none",
        criterionId: CRITERION_ID,
        /* The REFEREE's own placement, and the value the whole exercise is
           about. −80 becoming 0 in a rollback would read as "they felt neither
           way", permanently, with the original already gone. */
        valence: -80,
      },
      {
        articleId: ARTICLE_ID,
        id: NOTE_ID,
        ownerId: owner,
        blockId: BLOCK_ID,
        quote: "a stretch of prose",
        start: 0,
        body: "an ordinary reading note",
        status: "none",
      },
    ]);

    out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-referee-"));
    await exportArticle(SLUG, { dataRoot: out, outputRoot: path.join(out, "output") });
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(commentsTable).where(eq(commentsTable.articleId, ARTICLE_ID));
    // After the comments: `comments_criterion_fk` is `no action`, so a criterion
    // still pointed at refuses to go.
    await db.delete(refereeCriteria).where(eq(refereeCriteria.articleId, ARTICLE_ID));
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, ARTICLE_ID));
    await db.delete(articleRevisions).where(eq(articleRevisions.id, REVISION_ID));
    await db.delete(blockIdentities).where(eq(blockIdentities.articleId, ARTICLE_ID));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
    if (out) await rm(out, { recursive: true, force: true });
  });

  const read = async <T>(file: string): Promise<T> =>
    JSON.parse(await readFile(path.join(out, SLUG, file), "utf8")) as T;

  it("writes the referee's placement into comments.json, sign intact", async () => {
    const { comments } = await read<{ comments: Comment[] }>("comments.json");
    const placed = comments.find((c) => c.id === COMMENT_ID);
    expect(placed?.criterionId).toBe(CRITERION_ID);
    expect(placed?.valence).toBe(-80);
  });

  it("leaves an ordinary note with neither key, rather than two nulls", async () => {
    /* `compact` drops the nulls, which is what both stores write and what
       tests/store-roundtrip.test.ts compares. A `"valence": null` here would be
       a file the filesystem store never writes. */
    const { comments } = await read<{ comments: Comment[] }>("comments.json");
    const note = comments.find((c) => c.id === NOTE_ID) as Record<string, unknown> | undefined;
    expect(note).toBeDefined();
    expect("criterionId" in (note ?? {})).toBe(false);
    expect("valence" in (note ?? {})).toBe(false);
  });

  it("writes referee-criteria.json at all, which it did not until 2026-09-01", async () => {
    const { criteria } = await read<{ criteria: SavedCriterion[] }>("referee-criteria.json");
    expect(criteria).toHaveLength(1);
    const row = criteria[0];
    expect(row?.id).toBe(CRITERION_ID);
    expect(row?.criterion).toBe("Are the controls adequate?");
    expect(row?.status).toBe("done");
    expect(row?.colour).toBe(3);
    expect(row?.sourceHash).toBe("sha256:whatever");
  });

  it("puts the kind, the poles and the scale back as one config", async () => {
    /* Four columns and one discriminated union, and `configFromRow` is the only
       thing that knows how they correspond. An export that wrote the four
       columns loose would produce a file `src/referee-criteria-store.ts` cannot
       read back, which is a rollback that looks complete and is not. */
    const { criteria } = await read<{ criteria: SavedCriterion[] }>("referee-criteria.json");
    expect(criteria[0]?.config).toEqual({
      kind: "diverging",
      poles: { against: "the controls are inadequate", favour: "the controls are adequate" },
      scale: "rg",
    });
  });

  it("keeps the model's own negative valence in the results", async () => {
    const { criteria } = await read<{ criteria: SavedCriterion[] }>("referee-criteria.json");
    const result = criteria[0]?.results[0];
    expect(result?.kind).toBe("diverging");
    expect(result && "valence" in result ? result.valence : undefined).toBe(-60);
  });
});
