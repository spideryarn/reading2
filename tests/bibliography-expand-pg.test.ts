/**
 * **The Bibliography expand migration, against the old code's statements and
 * the new code's** — plan
 * docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md § The
 * database, Stage 2, and drizzle/20261010030345_bibliography_expand.sql.
 *
 * `npm run deploy` applies the migration, then waits for Vercel: for those
 * minutes production runs the pre-rename code against the new schema, and
 * after them a tab or a straggling worker may still be the old code. So both
 * versions' statements must work and see each other's writes:
 *
 * - **the column pair**: `article_revisions.citations` (the old code's) and
 *   `.bibliography` (the new code's) are kept equal by a `BEFORE` trigger,
 *   whichever one a write names, on insert and on update;
 * - **the step runs**: a `citations` row and a `bibliography` row for one
 *   revision are kept equal by an `AFTER` trigger, on insert, update and
 *   delete, so a lease the old code takes is the new code's lease too;
 * - **the export** does not carry the legacy column.
 *
 * The old code's statements are written out here as raw SQL, the way the
 * pre-rename code issues them (src/store/pg-revisions.ts at 68d9ed837:
 * `beginStepRun`'s conditional upsert, `finishStepRun`'s fenced update), since
 * that code is not in the tree to call. The sharing rebase and the real
 * `beginStepRun` with both spellings present are in
 * tests/pg-session-sharing-rebase.test.ts, which has the job harness.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray, and, sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, revisionStepRuns } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { extraSteps } from "../src/reset-role.js";
import { articleBundle } from "../src/store/export-bundle.js";
import { beginRevision } from "../src/store/pg-revisions.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/bibliography-expand-pg.test.ts",
  columns: [{ table: "spideryarn.article_revisions", column: "bibliography" }],
});

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-bibliography-expand-${RUN}`;

let article: ScratchArticle | undefined;
let revisionId = "";

const list = (who: string) => ({
  version: "citations/6",
  generator: "fixture",
  slug: SLUG,
  sourceHash: who,
  citations: [],
  capped: false,
  generatedAt: "2026-10-09T00:00:00.000Z",
  elapsedMs: 1,
});

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  const [row] = await getDb()
    .select({ id: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row?.id) throw new Error(`no current revision for ${SLUG}`);
  revisionId = row.id;
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

/** Both columns of one revision, read by their database names. */
async function pair(id = revisionId): Promise<{ old: unknown; current: unknown }> {
  const result = await getDb().execute<{ old: unknown; current: unknown }>(
    sql`select citations as old, bibliography as current from spideryarn.article_revisions where id = ${id}::uuid`,
  );
  const row = result.rows[0];
  if (!row) throw new Error(`no revision ${id}`);
  return row;
}

/** Every run row of one revision under either spelling, by name. */
async function runs(id = revisionId): Promise<Map<string, Record<string, unknown>>> {
  const result = await getDb().execute<Record<string, unknown>>(sql`
    select step_name, input_hash, implementation_version, prompt_version, model, status,
           started_at, finished_at, attempt_id
      from spideryarn.revision_step_runs
     where revision_id = ${id}::uuid and step_name in ('citations', 'bibliography')`);
  return new Map(result.rows.map((r) => [String(r.step_name), r]));
}

/** The two rows, minus their names: what "consistent" means. */
async function expectMirrored(id = revisionId): Promise<Record<string, unknown> | undefined> {
  const both = await runs(id);
  const strip = (r: Record<string, unknown> | undefined) => {
    if (!r) return undefined;
    const { step_name: _name, ...rest } = r;
    return rest;
  };
  expect(strip(both.get("citations")), "the two spellings disagree").toEqual(strip(both.get("bibliography")));
  return strip(both.get("bibliography"));
}

/* ------------------------------------------------------- the column pair -- */

describe("the article_revisions column pair", () => {
  it("copied the old column into the new one", async () => {
    /* The clone was loaded through the new code, which writes `bibliography`;
       whatever it wrote, the old column says the same. */
    const { old, current } = await pair();
    expect(old).toEqual(current);
  });

  it("shows the new code what the old code wrote", async () => {
    const written = list("old-code");
    await getDb().execute(
      sql`update spideryarn.article_revisions set citations = ${JSON.stringify(written)}::jsonb where id = ${revisionId}::uuid`,
    );
    expect(await pair()).toEqual({ old: written, current: written });
    const [row] = await getDb()
      .select({ bibliography: articleRevisions.bibliography })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, revisionId));
    expect(row?.bibliography).toEqual(written);
  });

  it("shows the old code what the new code wrote, clearing included", async () => {
    const written = list("new-code");
    await getDb().update(articleRevisions).set({ bibliography: written as never }).where(eq(articleRevisions.id, revisionId));
    expect(await pair()).toEqual({ old: written, current: written });
    await getDb().update(articleRevisions).set({ bibliography: null }).where(eq(articleRevisions.id, revisionId));
    expect(await pair()).toEqual({ old: null, current: null });
  });

  it("lets the new column win when one statement changes both", async () => {
    await getDb().execute(sql`
      update spideryarn.article_revisions
         set citations = ${JSON.stringify(list("loses"))}::jsonb,
             bibliography = ${JSON.stringify(list("wins"))}::jsonb
       where id = ${revisionId}::uuid`);
    expect(await pair()).toEqual({ old: list("wins"), current: list("wins") });
  });

  it("fills whichever one an insert leaves out", async () => {
    const [{ articleId } = { articleId: "" }] = await getDb()
      .select({ articleId: articleRevisions.articleId })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, revisionId));
    for (const column of ["citations", "bibliography"] as const) {
      const id = randomUUID();
      const written = list(`inserted as ${column}`);
      await getDb().execute(sql`
        insert into spideryarn.article_revisions (id, article_id, status, ${sql.identifier(column)})
        values (${id}::uuid, ${articleId}::uuid, 'draft', ${JSON.stringify(written)}::jsonb)`);
      expect(await pair(id), column).toEqual({ old: written, current: written });
      await getDb().delete(articleRevisions).where(eq(articleRevisions.id, id));
    }
  });
});

/* ------------------------------------------------------- the step runs -- */

describe("revision_step_runs under both spellings", () => {
  const OLD_ATTEMPT = randomUUID();
  const NEW_ATTEMPT = randomUUID();

  /** `beginStepRun` as the pre-rename code issues it, for `citations`. */
  const oldLease = (attempt: string) => getDb().execute(sql`
    insert into spideryarn.revision_step_runs
      (revision_id, step_name, input_hash, prompt_version, model, implementation_version, status, started_at, finished_at, attempt_id)
    values (${revisionId}::uuid, 'citations', 'unstamped', null, null, 'pipeline/old', 'running', now(), null, ${attempt}::uuid)
    on conflict (revision_id, step_name) do update set
      input_hash = excluded.input_hash, prompt_version = excluded.prompt_version, model = excluded.model,
      implementation_version = excluded.implementation_version, status = excluded.status,
      started_at = excluded.started_at, finished_at = excluded.finished_at, attempt_id = excluded.attempt_id
    where spideryarn.revision_step_runs.status = 'running'
       or spideryarn.revision_step_runs.attempt_id is distinct from ${attempt}::uuid`);

  /** `finishStepRun` as the pre-rename code issues it: fenced on attempt and status. */
  const oldFinish = (attempt: string) => getDb().execute(sql`
    update spideryarn.revision_step_runs
       set status = 'done', finished_at = now(), input_hash = 'old-hash', prompt_version = 'citations/6', model = 'm'
     where revision_id = ${revisionId}::uuid and step_name = 'citations'
       and attempt_id = ${attempt}::uuid and status = 'running'`);

  it("sees the old code's lease as a Bibliography lease", async () => {
    await oldLease(OLD_ATTEMPT);
    const mirrored = await expectMirrored();
    expect(mirrored).toMatchObject({ status: "running", attempt_id: OLD_ATTEMPT });
  });

  it("lets the old code finish its own lease, row count and all, and the new code sees it done", async () => {
    const result = await oldFinish(OLD_ATTEMPT);
    /* `finishStepRun` refuses anything but exactly one row: the mirror must
       not change what the old statement reports. */
    expect(result.rowCount).toBe(1);
    const mirrored = await expectMirrored();
    expect(mirrored).toMatchObject({ status: "done", input_hash: "old-hash", prompt_version: "citations/6" });
  });

  it("shows the old code's select what the new code wrote", async () => {
    await getDb()
      .update(revisionStepRuns)
      .set({ status: "running", attemptId: NEW_ATTEMPT, inputHash: "unstamped", finishedAt: null })
      .where(and(eq(revisionStepRuns.revisionId, revisionId), eq(revisionStepRuns.stepName, "bibliography")));
    const old = await getDb().execute<{ status: string; attempt_id: string }>(sql`
      select status, attempt_id from spideryarn.revision_step_runs
       where revision_id = ${revisionId}::uuid and step_name = 'citations'`);
    expect(old.rows).toEqual([{ status: "running", attempt_id: NEW_ATTEMPT }]);
    /* And the old code's fence, holding the other attempt, finishes nothing. */
    expect((await oldFinish(OLD_ATTEMPT)).rowCount).toBe(0);
    await expectMirrored();
  });

  it("copies both spellings into a new draft, equal", async () => {
    const draftId = await runAsOwner(DEV_OWNER_ID, async () => (await beginRevision({ slug: SLUG })).revisionId);
    const both = await runs(draftId);
    expect([...both.keys()].sort()).toEqual(["bibliography", "citations"]);
    await expectMirrored(draftId);
    await getDb().delete(articleRevisions).where(eq(articleRevisions.id, draftId));
  });

  it("deletes both spellings when a reset drops the extras by their new names", async () => {
    /* `dropExtrasIn` (src/store/pg-revisions.ts), on this revision. */
    await getDb()
      .delete(revisionStepRuns)
      .where(and(eq(revisionStepRuns.revisionId, revisionId), inArray(revisionStepRuns.stepName, extraSteps())));
    expect((await runs()).size).toBe(0);
  });

  it("removes the Bibliography run when the old code deletes its own", async () => {
    await oldLease(OLD_ATTEMPT);
    expect((await runs()).size).toBe(2);
    await getDb().execute(sql`
      delete from spideryarn.revision_step_runs where revision_id = ${revisionId}::uuid and step_name = 'citations'`);
    expect((await runs()).size).toBe(0);
  });
});

/* ------------------------------------------------------------ the export -- */

describe("the reader's bundle", () => {
  it("carries the new column in content/revision.json and not the legacy one", async () => {
    await getDb().update(articleRevisions).set({ bibliography: list("exported") as never }).where(eq(articleRevisions.id, revisionId));
    const bundle = await runAsOwner(DEV_OWNER_ID, () => articleBundle(SLUG));
    const files = unzipSync(bundle.bytes);
    const file = files["content/revision.json"];
    if (!file) throw new Error("the bundle has no content/revision.json");
    const revision = JSON.parse(new TextDecoder().decode(file)) as Record<string, unknown>;
    expect(revision).not.toHaveProperty("legacyCitations");
    expect(revision).not.toHaveProperty("citations");
    /* Bibliography ships as its own file, so not in the row either. */
    expect(revision).not.toHaveProperty("bibliography");
    expect(files["augmentations/bibliography.json"]).toBeDefined();
    expect(files["augmentations/citations.json"]).toBeUndefined();
  });
});
