/**
 * **The Reception and Claims expand migration, against the old code's
 * statements and the new code's** — plan
 * docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md § The
 * database, Stage 3, and drizzle/20261010063350_reception_expand.sql.
 *
 * tests/bibliography-expand-pg.test.ts is the pattern and says why; this file
 * holds Stage 3's three additions to it:
 *
 * - **two more column pairs**: `article_revisions.debate` ↔ `.reception` and
 *   `.debate_claims` ↔ `.sources_claims`, kept equal by the same trigger;
 * - **two more step pairs**: `debate` ↔ `reception` and `debate-claims` ↔
 *   `sources-claims` in `revision_step_runs`, mirrored by the same trigger;
 * - **the claim-check table renamed, with a view of the old name**: the old
 *   store's statements (src/store/pg-debate-claim-checks.ts at 745d62743,
 *   written out here as raw SQL because that code is not in the tree) work
 *   through `debate_claim_checks`, its one-pending violation still named
 *   `debate_claim_checks_one_pending`; and the new store works on the table.
 */
import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, revisionStepRuns, sourcesClaimChecks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { extraSteps } from "../src/reset-role.js";
import { articleBundle } from "../src/store/export-bundle.js";
import { CheckInFlight, pgSourcesClaimChecksStore } from "../src/store/pg-sources-claim-checks.js";
import { beginRevision } from "../src/store/pg-revisions.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/reception-expand-pg.test.ts",
  columns: [
    { table: "spideryarn.article_revisions", column: "reception" },
    { table: "spideryarn.article_revisions", column: "sources_claims" },
  ],
  tables: ["spideryarn.sources_claim_checks"],
});

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-reception-expand-${RUN}`;

let article: ScratchArticle | undefined;
let articleId = "";
let revisionId = "";

/** The two column pairs, by their database names: [old, new]. */
const PAIRS = [
  ["debate", "reception"],
  ["debate_claims", "sources_claims"],
] as const;

/** The two step pairs: [old, new]. */
const STEPS = [
  ["debate", "reception"],
  ["debate-claims", "sources-claims"],
] as const;

const doc = (who: string) => ({ version: "debate/7", generator: "fixture", slug: SLUG, sourceHash: who });

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  const [row] = await getDb()
    .select({ id: articles.currentRevisionId, articleId: articles.id })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row?.id) throw new Error(`no current revision for ${SLUG}`);
  revisionId = row.id;
  articleId = row.articleId;
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

/** One pair of one revision, by its database names. */
async function pair(old: string, current: string, id = revisionId): Promise<{ old: unknown; current: unknown }> {
  const result = await getDb().execute<{ old: unknown; current: unknown }>(
    sql`select ${sql.identifier(old)} as old, ${sql.identifier(current)} as current
          from spideryarn.article_revisions where id = ${id}::uuid`,
  );
  const row = result.rows[0];
  if (!row) throw new Error(`no revision ${id}`);
  return row;
}

/* ------------------------------------------------------ the column pairs -- */

describe.each(PAIRS)("the article_revisions pair %s / %s", (old, current) => {
  it("shows the new code what the old code wrote", async () => {
    const written = doc(`old-code ${old}`);
    await getDb().execute(
      sql`update spideryarn.article_revisions set ${sql.identifier(old)} = ${JSON.stringify(written)}::jsonb where id = ${revisionId}::uuid`,
    );
    expect(await pair(old, current)).toEqual({ old: written, current: written });
  });

  it("shows the old code what the new code wrote, clearing included", async () => {
    const written = doc(`new-code ${current}`);
    const column = current === "reception" ? { reception: written as never } : { sourcesClaims: written as never };
    await getDb().update(articleRevisions).set(column).where(eq(articleRevisions.id, revisionId));
    expect(await pair(old, current)).toEqual({ old: written, current: written });
    const cleared = current === "reception" ? { reception: null } : { sourcesClaims: null };
    await getDb().update(articleRevisions).set(cleared).where(eq(articleRevisions.id, revisionId));
    expect(await pair(old, current)).toEqual({ old: null, current: null });
  });

  it("lets the new column win when one statement changes both", async () => {
    await getDb().execute(sql`
      update spideryarn.article_revisions
         set ${sql.identifier(old)} = ${JSON.stringify(doc("loses"))}::jsonb,
             ${sql.identifier(current)} = ${JSON.stringify(doc("wins"))}::jsonb
       where id = ${revisionId}::uuid`);
    expect(await pair(old, current)).toEqual({ old: doc("wins"), current: doc("wins") });
  });

  it("fills whichever one an insert leaves out", async () => {
    for (const column of [old, current]) {
      const id = randomUUID();
      const written = doc(`inserted as ${column}`);
      await getDb().execute(sql`
        insert into spideryarn.article_revisions (id, article_id, status, ${sql.identifier(column)})
        values (${id}::uuid, ${articleId}::uuid, 'draft', ${JSON.stringify(written)}::jsonb)`);
      expect(await pair(old, current, id), column).toEqual({ old: written, current: written });
      await getDb().delete(articleRevisions).where(eq(articleRevisions.id, id));
    }
  });

  it("still keeps Stage 2's pair when only this one is written", async () => {
    await getDb().execute(
      sql`update spideryarn.article_revisions set ${sql.identifier(old)} = ${JSON.stringify(doc("again"))}::jsonb where id = ${revisionId}::uuid`,
    );
    const stage2 = await pair("citations", "bibliography");
    expect(stage2.old).toEqual(stage2.current);
  });
});

/* ------------------------------------------------------- the step runs -- */

describe.each(STEPS)("revision_step_runs under %s and %s", (oldName, newName) => {
  const OLD_ATTEMPT = randomUUID();
  const NEW_ATTEMPT = randomUUID();

  async function runs(id = revisionId): Promise<Map<string, Record<string, unknown>>> {
    const result = await getDb().execute<Record<string, unknown>>(sql`
      select step_name, input_hash, implementation_version, prompt_version, model, status,
             started_at, finished_at, attempt_id
        from spideryarn.revision_step_runs
       where revision_id = ${id}::uuid and step_name in (${oldName}, ${newName})`);
    return new Map(result.rows.map((r) => [String(r.step_name), r]));
  }

  async function expectMirrored(id = revisionId): Promise<Record<string, unknown> | undefined> {
    const both = await runs(id);
    const strip = (r: Record<string, unknown> | undefined) => {
      if (!r) return undefined;
      const { step_name: _name, ...rest } = r;
      return rest;
    };
    expect(strip(both.get(oldName)), "the two spellings disagree").toEqual(strip(both.get(newName)));
    return strip(both.get(newName));
  }

  /** `beginStepRun` as the pre-rename code issues it, for the old name. */
  const oldLease = (attempt: string) => getDb().execute(sql`
    insert into spideryarn.revision_step_runs
      (revision_id, step_name, input_hash, prompt_version, model, implementation_version, status, started_at, finished_at, attempt_id)
    values (${revisionId}::uuid, ${oldName}, 'unstamped', null, null, 'pipeline/old', 'running', now(), null, ${attempt}::uuid)
    on conflict (revision_id, step_name) do update set
      input_hash = excluded.input_hash, prompt_version = excluded.prompt_version, model = excluded.model,
      implementation_version = excluded.implementation_version, status = excluded.status,
      started_at = excluded.started_at, finished_at = excluded.finished_at, attempt_id = excluded.attempt_id
    where spideryarn.revision_step_runs.status = 'running'
       or spideryarn.revision_step_runs.attempt_id is distinct from ${attempt}::uuid`);

  /** `finishStepRun` as the pre-rename code issues it: fenced on attempt and status. */
  const oldFinish = (attempt: string) => getDb().execute(sql`
    update spideryarn.revision_step_runs
       set status = 'done', finished_at = now(), input_hash = 'old-hash', prompt_version = 'debate/7', model = 'm'
     where revision_id = ${revisionId}::uuid and step_name = ${oldName}
       and attempt_id = ${attempt}::uuid and status = 'running'`);

  it("sees the old code's lease under the new name", async () => {
    await oldLease(OLD_ATTEMPT);
    expect(await expectMirrored()).toMatchObject({ status: "running", attempt_id: OLD_ATTEMPT });
  });

  it("lets the old code finish its own lease, row count and all", async () => {
    expect((await oldFinish(OLD_ATTEMPT)).rowCount).toBe(1);
    expect(await expectMirrored()).toMatchObject({ status: "done", input_hash: "old-hash" });
  });

  it("shows the old code's select what the new code wrote", async () => {
    await getDb()
      .update(revisionStepRuns)
      .set({ status: "running", attemptId: NEW_ATTEMPT, inputHash: "unstamped", finishedAt: null })
      .where(and(eq(revisionStepRuns.revisionId, revisionId), eq(revisionStepRuns.stepName, newName)));
    const old = await getDb().execute<{ status: string; attempt_id: string }>(sql`
      select status, attempt_id from spideryarn.revision_step_runs
       where revision_id = ${revisionId}::uuid and step_name = ${oldName}`);
    expect(old.rows).toEqual([{ status: "running", attempt_id: NEW_ATTEMPT }]);
    expect((await oldFinish(OLD_ATTEMPT)).rowCount).toBe(0);
    await expectMirrored();
  });

  it("copies both spellings into a new draft, equal", async () => {
    const draftId = await runAsOwner(DEV_OWNER_ID, async () => (await beginRevision({ slug: SLUG })).revisionId);
    expect([...(await runs(draftId)).keys()].sort()).toEqual([oldName, newName].sort());
    await expectMirrored(draftId);
    await getDb().delete(articleRevisions).where(eq(articleRevisions.id, draftId));
  });

  it("deletes both spellings when a reset drops the extras by their new names", async () => {
    await getDb()
      .delete(revisionStepRuns)
      .where(and(eq(revisionStepRuns.revisionId, revisionId), inArray(revisionStepRuns.stepName, extraSteps())));
    expect((await runs()).size).toBe(0);
  });

  it("removes the new run when the old code deletes its own", async () => {
    await oldLease(OLD_ATTEMPT);
    expect((await runs()).size).toBe(2);
    await getDb().execute(sql`
      delete from spideryarn.revision_step_runs where revision_id = ${revisionId}::uuid and step_name = ${oldName}`);
    expect((await runs()).size).toBe(0);
  });
});

/* ------------------------------------------- the claim checks, renamed -- */

describe("the claim-check table under its new name, and the old name as a view", () => {
  const TARGETS = JSON.stringify([{ kind: "own", claimId: "spya-cvd345", text: "a claim the reader typed" }]);

  /**
   * `begin` as the pre-rename store issues it (drizzle's insert: every column
   * named, `default` for the ones it leaves to the table), against the old
   * name.
   */
  const oldBegin = (id: string, attempt: string) => getDb().execute(sql`
    insert into spideryarn.debate_claim_checks
      (article_id, id, owner_id, status, attempt_id, list_source_hash, prompt_version, dig_further,
       targets, results, counts, web_searches, model, error, created_at, finished_at)
    values (${articleId}::uuid, ${id}, ${DEV_OWNER_ID}::uuid, 'pending', ${attempt}, 'a-list-hash', 'debate-check/1',
            false, ${TARGETS}::jsonb, '[]'::jsonb, default, default, default, default, default, default)
    returning *`);

  /** `finish` as the pre-rename store issues it: fenced three ways. */
  const oldFinish = (id: string, attempt: string) => getDb().execute(sql`
    update spideryarn.debate_claim_checks
       set status = 'done', results = '[]'::jsonb, web_searches = 1, model = 'm', attempt_id = null,
           finished_at = clock_timestamp()
     where article_id = ${articleId}::uuid and id = ${id} and status = 'pending' and attempt_id = ${attempt}
    returning *`);

  it("takes the old store's insert through the view, with the table's defaults", async () => {
    const attempt = randomUUID();
    const inserted = await oldBegin("spya-cvd222", attempt);
    expect(inserted.rows).toHaveLength(1);
    expect(inserted.rows[0]).toMatchObject({ status: "pending", dig_further: false, results: [] });
    expect(inserted.rows[0]?.created_at).not.toBeNull();
    const [row] = await getDb()
      .select()
      .from(sourcesClaimChecks)
      .where(and(eq(sourcesClaimChecks.articleId, articleId), eq(sourcesClaimChecks.id, "spya-cvd222")));
    expect(row?.attemptId).toBe(attempt);
  });

  it("reports the old store's one-pending violation under the index name it looks for", async () => {
    const err: unknown = await oldBegin("spya-cvd223", randomUUID()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    const cause = (err as { cause?: { code?: string; constraint?: string } }).cause ?? (err as { code?: string; constraint?: string });
    expect(cause.code).toBe("23505");
    expect(cause.constraint).toBe("debate_claim_checks_one_pending");
  });

  it("lets the old store finish and read its check through the view", async () => {
    const [pending] = await getDb()
      .select({ attemptId: sourcesClaimChecks.attemptId })
      .from(sourcesClaimChecks)
      .where(and(eq(sourcesClaimChecks.articleId, articleId), eq(sourcesClaimChecks.id, "spya-cvd222")));
    const finished = await oldFinish("spya-cvd222", pending?.attemptId ?? "");
    expect(finished.rows).toHaveLength(1);
    const read = await getDb().execute<{ id: string; status: string }>(sql`
      select id, status from spideryarn.debate_claim_checks where article_id = ${articleId}::uuid order by created_at, id`);
    expect(read.rows).toEqual([{ id: "spya-cvd222", status: "done" }]);
  });

  it("works for the new store on the table, and refuses a second pending check as a 409", async () => {
    const begun = await runAsOwner(DEV_OWNER_ID, () =>
      pgSourcesClaimChecksStore.begin(SLUG, {
        listSourceHash: "a-list-hash",
        digFurther: false,
        targets: [{ kind: "own", claimId: "spya-cvd346", text: "another claim" }],
      }),
    );
    expect(begun.check.status).toBe("pending");
    await expect(
      runAsOwner(DEV_OWNER_ID, () =>
        pgSourcesClaimChecksStore.begin(SLUG, {
          listSourceHash: "a-list-hash",
          digFurther: false,
          targets: [{ kind: "own", claimId: "spya-cvd347", text: "a third" }],
        }),
      ),
    ).rejects.toBeInstanceOf(CheckInFlight);
    /* And the old code, reading through the view, sees the new store's row. */
    const read = await getDb().execute<{ id: string }>(sql`
      select id from spideryarn.debate_claim_checks where article_id = ${articleId}::uuid and status = 'pending'`);
    expect(read.rows).toEqual([{ id: begun.check.id }]);
    const listed = await runAsOwner(DEV_OWNER_ID, () => pgSourcesClaimChecksStore.list(SLUG));
    expect(listed.map((c) => c.id)).toContain("spya-cvd222");
  });
});

/* ------------------------------------------------------------ the export -- */

describe("the reader's bundle", () => {
  it("carries Reception as `reception` in content/revision.json, and neither legacy column", async () => {
    await getDb()
      .update(articleRevisions)
      .set({ reception: doc("exported") as never, sourcesClaims: { ...doc("listed"), claims: [] } as never })
      .where(eq(articleRevisions.id, revisionId));
    const bundle = await runAsOwner(DEV_OWNER_ID, () => articleBundle(SLUG));
    const files = unzipSync(bundle.bytes);
    const file = files["content/revision.json"];
    if (!file) throw new Error("the bundle has no content/revision.json");
    const revision = JSON.parse(new TextDecoder().decode(file)) as Record<string, unknown>;
    expect(revision).toHaveProperty("reception");
    for (const gone of ["debate", "debateClaims", "legacyDebate", "legacyDebateClaims", "sourcesClaims"]) {
      expect(revision, gone).not.toHaveProperty(gone);
    }
    expect(files["augmentations/sources-claims.json"]).toBeDefined();
    expect(files["augmentations/debate-claims.json"]).toBeUndefined();
    expect(files["augmentations/sources-claim-checks.json"]).toBeDefined();
    expect(files["augmentations/debate-claim-checks.json"]).toBeUndefined();
  });
});
