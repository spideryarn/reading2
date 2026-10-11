/**
 * **The Promises expand migration, against the old code's statements and the
 * new code's** — plan
 * docs/plans/261011g-referee-claims-become-promises-and-starter-criteria-wait-for-the-referee-own.md
 * § The database, and drizzle/20261011025758_referee_promises.sql.
 *
 * For the minutes `npm run deploy` waits on Vercel, production runs the code
 * from before the rename against the renamed table. That code knows
 * `referee_claims` with columns `claims` and `claims_omitted`, so a view of
 * that name stands over `referee_promises`. This file runs the old store's
 * statements — src/store/pg-referee-claims.ts and the export's read at
 * 7eeff2aef, written out here as the SQL drizzle issued for them, because that
 * code is not in the tree — through the view: the upsert `begin` (a first run
 * and a re-run), the fenced `finish`, the sweep, the load, the export's select,
 * and a delete. Then the new store on the table, read back through the view.
 * tests/reception-expand-pg.test.ts is the pattern.
 */
import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, refereePromises } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { pgRefereePromisesStore } from "../src/store/pg-referee-promises.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/referee-promises-expand-pg.test.ts",
  columns: [{ table: "spideryarn.referee_promises", column: "promises" }],
  tables: ["spideryarn.referee_promises", "spideryarn.referee_claims"],
});

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-referee-promises-expand-${RUN}`;

let article: ScratchArticle | undefined;
let articleId = "";

/** One stored item, in the shape the model's word keeps (`claim` inside). */
const ITEM = {
  id: "spya-cmr456:0",
  blockId: "spya-cmr456",
  quote: "fell by about half",
  start: 0,
  claim: "The method halves annotation time",
  passages: [],
  discarded: 0,
};

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  const [row] = await getDb()
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row) throw new Error(`no article for ${SLUG}`);
  articleId = row.id;
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

/**
 * `begin` as the pre-rename store issues it: drizzle's insert, every column
 * named and `default` for the ones it left out, upserting on `article_id` with
 * every field written.
 */
const oldBegin = (attempt: string) => getDb().execute(sql`
  insert into "spideryarn"."referee_claims"
    ("article_id", "owner_id", "status", "claims", "model", "claims_omitted", "error", "created_at",
     "source_hash", "attempt_id", "finished_at")
  values (${articleId}::uuid, ${DEV_OWNER_ID}::uuid, 'pending', '[]'::jsonb, default, default, default, now(),
          'a-hash', ${attempt}, default)
  on conflict ("article_id") do update
    set "owner_id" = ${DEV_OWNER_ID}::uuid, "status" = 'pending', "claims" = '[]'::jsonb, "model" = null,
        "claims_omitted" = null, "error" = null, "created_at" = now(), "source_hash" = 'a-hash',
        "attempt_id" = ${attempt}, "finished_at" = null
  returning *`);

/** `finish` as the pre-rename store issues it: fenced three ways. */
const oldFinish = (attempt: string) => getDb().execute(sql`
  update "spideryarn"."referee_claims"
     set "status" = 'done', "claims" = ${JSON.stringify([ITEM])}::jsonb, "model" = 'm', "claims_omitted" = 2,
         "attempt_id" = null, "finished_at" = clock_timestamp()
   where "article_id" = ${articleId}::uuid and "status" = 'pending' and "attempt_id" = ${attempt}
  returning *`);

/** The load, and the export's read (`readArticleRows`): a plain select. */
const oldLoad = () =>
  getDb().execute<{ status: string; claims: unknown; claims_omitted: number | null; model: string | null }>(sql`
    select * from "spideryarn"."referee_claims" where "article_id" = ${articleId}::uuid limit 1`);

describe("the old store, through the referee_claims view", () => {
  it("takes a first run's upsert as an insert, with the table's defaults", async () => {
    const attempt = randomUUID();
    const begun = await oldBegin(attempt);
    expect(begun.rows).toHaveLength(1);
    expect(begun.rows[0]).toMatchObject({ status: "pending", claims: [], claims_omitted: null });
    const [row] = await getDb().select().from(refereePromises).where(eq(refereePromises.articleId, articleId));
    expect(row?.attemptId).toBe(attempt);
    expect(row?.promises).toEqual([]);
  });

  it("finishes the run and reads it back under the old column names", async () => {
    const [pending] = await getDb()
      .select({ attemptId: refereePromises.attemptId })
      .from(refereePromises)
      .where(eq(refereePromises.articleId, articleId));
    const finished = await oldFinish(pending?.attemptId ?? "");
    expect(finished.rows).toHaveLength(1);
    const read = await oldLoad();
    expect(read.rows[0]).toMatchObject({ status: "done", claims: [ITEM], claims_omitted: 2, model: "m" });
    const [row] = await getDb().select().from(refereePromises).where(eq(refereePromises.articleId, articleId));
    expect(row?.promises).toEqual([ITEM]);
    expect(row?.promisesOmitted).toBe(2);
  });

  it("takes a re-run's upsert as the update that empties the row", async () => {
    const attempt = randomUUID();
    const again = await oldBegin(attempt);
    expect(again.rows[0]).toMatchObject({ status: "pending", claims: [], model: null, claims_omitted: null });
  });

  it("sweeps an abandoned run through the view", async () => {
    const swept = await getDb().execute(sql`
      update "spideryarn"."referee_claims"
         set "status" = 'error', "error" = 'swept', "attempt_id" = null, "finished_at" = clock_timestamp()
       where "article_id" = ${articleId}::uuid and "status" = 'pending' and "created_at" < now() + interval '1 minute'
      returning "article_id"`);
    expect(swept.rows).toHaveLength(1);
    expect((await oldLoad()).rows[0]).toMatchObject({ status: "error", claims: [] });
  });

  it("refuses claims on an unfinished row through the view, as on the table", async () => {
    const err: unknown = await getDb()
      .execute(sql`
        update "spideryarn"."referee_claims" set "claims" = ${JSON.stringify([ITEM])}::jsonb
         where "article_id" = ${articleId}::uuid`)
      .then(
        () => null,
        (e: unknown) => e,
      );
    const cause = (err as { cause?: { constraint?: string } } | null)?.cause ?? (err as { constraint?: string } | null);
    expect(cause?.constraint).toBe("referee_promises_empty_unless_done");
  });

  it("deletes through the view", async () => {
    await getDb().execute(sql`delete from "spideryarn"."referee_claims" where "article_id" = ${articleId}::uuid`);
    expect(await getDb().select().from(refereePromises).where(eq(refereePromises.articleId, articleId))).toEqual([]);
  });
});

describe("the new store, on the table", () => {
  it("begins and finishes a run that the old code then reads through the view", async () => {
    const { attempt } = await runAsOwner(DEV_OWNER_ID, () => pgRefereePromisesStore.begin(SLUG, "b-hash"));
    const done = await runAsOwner(DEV_OWNER_ID, () =>
      pgRefereePromisesStore.finish(SLUG, { status: "done", promises: [ITEM], model: "n", promisesOmitted: 0 }, attempt),
    );
    expect(done?.promises).toEqual([ITEM]);
    expect((await oldLoad()).rows[0]).toMatchObject({ status: "done", claims: [ITEM], claims_omitted: 0, model: "n" });
  });
});
