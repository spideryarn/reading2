/**
 * **Start again, in Postgres** — the glossary panel's delete, against real rows.
 *
 * `DELETE /api/glossary/:slug` answered 501 on the deployed app until
 * 2026-09-03: the reader could press *"throw the list away and find a new one"*
 * and be told the store would not. `src/store/pg-glossary.ts` is the half that
 * makes it work, and this is the file that says what it must do.
 * docs/plans/260903e-glossary-delete-in-postgres.md.
 *
 * ## The three things here that are not the obvious happy path
 *
 * **A published revision is mutated in place, deliberately.** Every other write
 * in this store opens a draft and publishes it. Minting a whole revision to
 * *remove* one JSONB value would copy every `revision_blocks` row of the article
 * to buy nothing, and `publishRevision` would then refuse the result for having
 * no tree. So the delete is one `UPDATE`, and this is the one place that does
 * it.
 *
 * **`revision_step_runs` is left alone, and that is the trap asserted rather
 * than reasoned about.** Nulling the column does not move the step's
 * fingerprint, so the row goes on saying `glossary: done` — which looks like a
 * glossary nothing will ever regenerate. It is not, because `hasArtefacts`
 * needs *both* a done row and every produced kind reading back, and an absent
 * column reads back absent. The case below asserts both halves at once: if
 * somebody later "fixes" `hasArtefacts` to trust the run row, this is what goes
 * red, rather than a reader losing a glossary permanently.
 *
 * **A live job holding a draft is refused with a 409.** A draft copies the
 * current revision's `glossary` forward, and the delete does not move
 * `articles.current_revision_id` — so a draft opened *before* the delete still
 * passes `publishRevisionIn`'s exact-base guard and publishes its copied,
 * non-null glossary over the top. The reader's deletion would be silently
 * undone by a job they never thought about, possibly their own retry. Four
 * cases below pin exactly which jobs count: queued-with-a-draft does,
 * running-inside-a-live-lease-with-a-draft does — the case the guard exists
 * for, and the commonest one — expired-running-with-a-draft does not (it cannot
 * publish anyway), and claimed-without-a-draft does not (the article lock
 * decides the order either way).
 *
 * ## Why the fixture is built by hand rather than through the pipeline
 *
 * `tests/store-carry-forward.test.ts` is the model for the shape, but it needs a
 * *publishable* article — a tree, blocks, a hierarchy run — because publication
 * is its subject. Nothing here reads a block or a tree: the delete touches one
 * column and `hasArtefacts` reads that same column. So the rows go in directly,
 * the way `tests/store-raw-source-race.test.ts` builds its article, and the
 * fixture says only what the assertions need.
 *
 * Ids are minted per run rather than written out — `tests/fixture-ids.test.ts`
 * exists because two files sharing a fixture uuid presents as a flake in
 * somebody else's work, and a minted id cannot collide with another *process*
 * running this same file either. The slugs are `test-` prefixed so
 * `tests/store-parity.test.ts` skips them by name.
 *
 * Skips loudly when there is no database — tests/helpers/pg-ready.ts.
 */

import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs, revisionStepRuns } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { PROMPT_VERSION as GLOSSARY_PROMPT_VERSION } from "../src/glossary.js";
import { mintUniqueId } from "../src/ids.js";
import { CAPABLE_MODEL } from "../src/models.js";
import { DEV_OWNER_ID, type OwnerId, runAsOwner } from "../src/owner.js";
import { hasArtefacts } from "../src/store/artifacts-pg.js";
import type { JobDraftRef } from "../src/store/artifacts-pg.js";
import { lockedGlossaryArticleQuery, pgGlossaryStore } from "../src/store/pg-glossary.js";
import { recordStepRun } from "../src/store/pg-revisions.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/revisions.js";
import type { Glossary, JobStep } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { reachable } = await pgReady({
  suite: "tests/store-glossary-delete-pg.test.ts",
  tables: ["spideryarn.article_revisions", "spideryarn.jobs"],
});
const when = reachable ? describe : describe.skip;

/* ------------------------------------------------------------- the fixture -- */

/** One run's suffix, so two processes running this file cannot collide. */
const RUN = randomUUID().slice(0, 8);

/** The reader's own article. */
const MINE = `test-glossary-delete-${RUN}`;

/** Somebody else's, which the reader must not be able to reach at all. */
const THEIRS = `test-glossary-delete-theirs-${RUN}`;

/** A slug shaped like a slug that names nothing. */
const NOBODYS = `test-glossary-delete-absent-${RUN}`;

/**
 * A string `isSlug` refuses, and one a person could plausibly send — the space
 * is what a pasted title looks like after a URL decoder has had it. The same
 * fixture, and the same reasoning, as tests/store-slug-guard.test.ts.
 */
const MALFORMED = "not a slug";

/** The other owner, minted per run and seeded into `auth.users` for the FK. */
const OTHER_OWNER = randomUUID() as OwnerId;

const MINTED = new Set<string>();

/** A job has to carry some steps; nothing here runs one, so one is enough. */
const JOB_STEPS: JobStep[] = [{ name: "glossary", label: "Finding the terms", status: "pending" }];

/**
 * A glossary of one entry, which has to be a real one: `hasArtefacts` reads the
 * column back through the shared shape check, so a `{}` here would come back
 * `unusable` and the "it was there before" half of the trap case would be
 * asserting nothing.
 */
function aGlossary(slug: string): Glossary {
  return {
    version: GLOSSARY_PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug,
    sourceHash: "f".repeat(64),
    entries: [
      {
        id: mintUniqueId(MINTED),
        name: "Fixture",
        kind: "term",
        aliases: [],
        senseHere: "A thing built for a test.",
        blocks: [],
      },
    ],
    passes: 1,
    generatedAt: "2026-09-03T00:00:00.000Z",
    elapsedMs: 1,
  };
}

let myArticleId = "";
let myRevisionId = "";
let theirArticleId = "";
let theirRevisionId = "";

/** An article with one published revision holding a glossary. */
async function seedArticle(
  slug: string,
  ownerId: OwnerId,
): Promise<{ articleId: string; revisionId: string }> {
  const db = getDb();
  const [article] = await db.insert(articles).values({ ownerId, slug }).returning();
  if (!article) throw new Error(`could not create the article for ${slug}`);

  const [revision] = await db
    .insert(articleRevisions)
    .values({
      articleId: article.id,
      status: "published",
      title: "A fixture article",
      glossary: aGlossary(slug),
    })
    .returning();
  if (!revision) throw new Error(`could not create the revision for ${slug}`);

  await db
    .update(articles)
    .set({ currentRevisionId: revision.id })
    .where(eq(articles.id, article.id));

  return { articleId: article.id, revisionId: revision.id };
}

/** The glossary column, as the database currently holds it. */
async function glossaryColumn(revisionId: string): Promise<unknown> {
  const [row] = await getDb()
    .select({ glossary: articleRevisions.glossary })
    .from(articleRevisions)
    .where(eq(articleRevisions.id, revisionId))
    .limit(1);
  return row?.glossary ?? null;
}

/**
 * **The runner's own question**: would an ordinary job skip the glossary step?
 *
 * `hasArtefacts` is what `stepIsDone` (src/pipeline.ts) rests on, so this is the
 * nearest thing to "will the reader get a new list" that can be asked without
 * running a job. The `jobId` and `attemptId` are unused by it — `requireBound`
 * only checks the slug, and the run row is found by revision and step — so they
 * are a shape rather than a claim about a job.
 */
async function runnerSeesAGlossary(): Promise<boolean> {
  const ref: JobDraftRef = {
    slug: MINE,
    articleId: myArticleId,
    revisionId: myRevisionId,
    jobId: "spya-aaaaaa",
    attemptId: randomUUID(),
  };
  return hasArtefacts(ref, getDb(), MINE, "glossary", ["glossary"]);
}

/** Put the reader's glossary back, for a case that needs one to delete. */
async function giveItAGlossaryAgain(): Promise<void> {
  await getDb()
    .update(articleRevisions)
    .set({ glossary: aGlossary(MINE) })
    .where(eq(articleRevisions.id, myRevisionId));
}

/**
 * A draft revision for the reader's article, as `beginDraftIn` would leave one:
 * `status = 'draft'`, carrying the glossary it copied forward.
 */
async function aDraft(): Promise<string> {
  const [row] = await getDb()
    .insert(articleRevisions)
    .values({
      articleId: myArticleId,
      status: "draft",
      basedOnRevisionId: myRevisionId,
      glossary: aGlossary(MINE),
    })
    .returning({ id: articleRevisions.id });
  if (!row) throw new Error("could not create the draft");
  return row.id;
}

/** One `jobs` row, inserted directly — see the note on the job cases below. */
async function aJob(values: {
  status: "queued" | "running";
  draftRevisionId?: string | null;
  leaseExpiresAt?: Date | null;
}): Promise<string> {
  const id = mintUniqueId(MINTED);
  await getDb()
    .insert(jobs)
    .values({
      id,
      ownerId: DEV_OWNER_ID,
      slug: MINE,
      steps: JOB_STEPS,
      status: values.status,
      workKey: `wk-${id}`,
      ...(values.status === "running"
        ? {
            attemptId: randomUUID(),
            leaseExpiresAt: values.leaseExpiresAt ?? new Date(Date.now() + 600_000),
          }
        : {}),
      ...(values.draftRevisionId ? { draftRevisionId: values.draftRevisionId } : {}),
    });
  return id;
}

/** Take the job and its draft away again, so the next case starts clean. */
async function forget(jobId: string, draftRevisionId?: string): Promise<void> {
  const db = getDb();
  await db.delete(jobs).where(eq(jobs.id, jobId));
  if (draftRevisionId) {
    await db.delete(articleRevisions).where(eq(articleRevisions.id, draftRevisionId));
  }
}

/** The delete, as a request would reach it: inside the reader's owner scope. */
const deleteMine = (slug: string) =>
  runAsOwner(DEV_OWNER_ID, () => pgGlossaryStore.deleteGlossary(slug));

when("deleting the glossary in Postgres", () => {
  beforeAll(async () => {
    await seedAuthUser(getDb(), {
      id: OTHER_OWNER,
      email: `glossary-delete-other-${RUN}@spideryarn.local`,
      onConflictDoNothing: true,
    });

    const mine = await seedArticle(MINE, DEV_OWNER_ID);
    myArticleId = mine.articleId;
    myRevisionId = mine.revisionId;

    const theirs = await seedArticle(THEIRS, OTHER_OWNER);
    theirArticleId = theirs.articleId;
    theirRevisionId = theirs.revisionId;

    /* The run row that makes the trap case mean something: `glossary` really
       did run, and really did finish, on the revision about to be emptied. */
    await recordStepRun({
      revisionId: myRevisionId,
      stepName: "glossary",
      inputHash: NO_INPUT_HASH,
      implementationVersion: PIPELINE_RUN,
      promptVersion: GLOSSARY_PROMPT_VERSION,
      model: CAPABLE_MODEL,
      status: "done",
      startedAt: new Date(),
      finishedAt: new Date(),
    });
  }, 60_000);

  afterAll(async () => {
    const db = getDb();
    /* Jobs first: `draft_revision_id` is `on delete set null`, so a revision
       cascading away under a live job row would leave the row behind naming a
       slug whose article is gone. And the pointer lets go before the article,
       or the revision cannot cascade — the order
       tests/store-import-convergence.test.ts works out at length. */
    await db.delete(jobs).where(eq(jobs.slug, MINE));
    for (const articleId of [myArticleId, theirArticleId]) {
      if (!articleId) continue;
      await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, articleId));
      await db.delete(articles).where(eq(articles.id, articleId));
    }
    /* And the owner this run seeded. Nothing else can be pointing at it: the id
       was minted here and the only rows that named it have just gone. */
    await db.execute(sql`delete from auth.users where id = ${OTHER_OWNER}`);
    await closeDb();
  });

  /* ------------------------------------------------------ the ordinary path -- */

  it("throws the glossary away and says it did", async () => {
    expect(await glossaryColumn(myRevisionId), "the fixture really has one").not.toBeNull();
    /* And the runner really can see it. Without this the "false afterwards"
       assertion three cases down would pass against a fixture that was never
       true in the first place — a green tick for having checked nothing. */
    expect(await runnerSeesAGlossary(), "and the runner agrees before").toBe(true);

    await expect(deleteMine(MINE)).resolves.toEqual({ deleted: true });
    expect(await glossaryColumn(myRevisionId)).toBeNull();
  }, 30_000);

  /**
   * Pressed twice, which a reader on a slow connection will do.
   *
   * `deleted: false` rather than a 404 — there is an article and it has no
   * glossary, which is the state that was asked for. It matches what the
   * filesystem answers on ENOENT (src/api.ts), and it is what makes `deleted`
   * honest: the `glossary is not null` guard in the `WHERE` is the whole reason
   * this can be told apart from the case above.
   */
  it("says nothing was deleted the second time", async () => {
    await expect(deleteMine(MINE)).resolves.toEqual({ deleted: false });
  }, 30_000);

  /**
   * **The trap, asserted rather than reasoned about.**
   *
   * The run row is untouched and still says `done`. That looks like a glossary
   * nothing will regenerate, and it is not, because `hasArtefacts` needs the
   * artefact to read back as well. Both halves are asserted here on purpose: if
   * somebody later makes `hasArtefacts` trust the run row alone, the second
   * expectation is what goes red — before a reader loses a glossary for good.
   */
  it("leaves the step run saying done, and hasArtefacts says false anyway", async () => {
    const [run] = await getDb()
      .select()
      .from(revisionStepRuns)
      .where(
        and(
          eq(revisionStepRuns.revisionId, myRevisionId),
          eq(revisionStepRuns.stepName, "glossary"),
        ),
      )
      .limit(1);
    expect(run?.status, "the delete must not touch revision_step_runs").toBe("done");

    expect(await runnerSeesAGlossary()).toBe(false);
  }, 30_000);

  /* ----------------------------------------------- slugs that are not theirs -- */

  it("answers 404 for a slug that names nothing", async () => {
    await expect(deleteMine(NOBODYS)).rejects.toMatchObject({ status: 404 });
  }, 30_000);

  /**
   * **The one that matters.** `articles.slug` is globally unique, so
   * `eq(articles.slug, …)` on its own finds somebody else's article and empties
   * it, and the failure is silent: the query works and reports success.
   *
   * 404 rather than 403 — "there is no such article" is all a stranger should
   * learn about a slug they do not own.
   */
  it("answers 404 for another owner's slug, and leaves their glossary alone", async () => {
    await expect(deleteMine(THEIRS)).rejects.toMatchObject({ status: 404 });
    expect(await glossaryColumn(theirRevisionId), "untouched").not.toBeNull();
  }, 30_000);

  /**
   * A malformed slug is the reader's mistake, not a missing article, and the
   * difference is visible: 400 means "that is not a name", 404 means "nothing
   * is called that". The same guard, and the same family, as
   * tests/store-slug-guard.test.ts.
   */
  it("answers 400 for a malformed slug, not 404", async () => {
    await expect(deleteMine(MALFORMED)).rejects.toMatchObject({ status: 400 });
  }, 30_000);

  /**
   * **The lock, read off the statement rather than raced for.**
   *
   * Dropping `.for("update")` leaves every behavioural test in this file green
   * — the 409 check below would still pass, because it does not need the lock
   * to see a committed job row; what it would lose is the guarantee that a job
   * opening its draft *concurrently* is ordered against this delete rather than
   * interleaved with it. GPT Sol's finding on `pgVisibilityStore.set`, where
   * exactly this deletion left the whole suite green.
   */
  it("locks the article row it is about to decide on", () => {
    const q = lockedGlossaryArticleQuery(new QueryBuilder() as never, "a-slug").toSQL();
    expect(q.sql).toMatch(/for update/i);
    expect(q.sql, "and by owner, never by slug alone").toMatch(
      /"slug" = \$1 and "spideryarn"\."articles"\."owner_id" = \$2/,
    );
  });

  /* ------------------------------------------------ a live job holds a draft -- */

  /**
   * The three job cases insert `jobs` rows directly rather than driving a real
   * claim through `pgJobStore`.
   *
   * A real claim would need a queue slot, a lease, an attempt and a published
   * article to run against, and the thing under test is one `SELECT` predicate
   * over three columns. What matters is that the rows are *shaped* like the real
   * ones, and the schema enforces most of that: `jobs_running_is_fenced` refuses
   * a running row with no attempt or lease, and `jobs_draft_revision_unique`
   * refuses two jobs pointing at one draft.
   */

  it("refuses with a 409 while a queued job holds a draft", async () => {
    await giveItAGlossaryAgain();
    const draft = await aDraft();
    const job = await aJob({ status: "queued", draftRevisionId: draft });
    try {
      await expect(deleteMine(MINE)).rejects.toMatchObject({ status: 409 });
      expect(await glossaryColumn(myRevisionId), "and it is still there").not.toBeNull();
    } finally {
      await forget(job, draft);
    }
  }, 30_000);

  /**
   * **The case the guard exists for**, and the one the other three do not
   * cover: a job actually working on this article right now, holding a draft,
   * inside a live lease. It is the ordinary state of an article while any
   * pipeline job runs, so it is what a reader pressing *Start again* at the
   * wrong moment will hit.
   *
   * It was also the one this file could most easily be missing without anybody
   * noticing: while it was absent, deleting the whole `running` arm of
   * `liveJobHoldingADraftQuery` left every other case here green — the queued
   * case does not reach that arm, and the two "goes ahead" cases *want* the
   * predicate not to match. GPT Sol found the hole in the built code; the arm
   * was then deleted for real and this case watched red before it was kept.
   *
   * The glossary is asserted still present afterwards, not just the status: a
   * 409 thrown after the `UPDATE` had already committed would satisfy the
   * first expectation and lose the reader's list anyway.
   */
  it("refuses with a 409 while a running job with a live lease holds a draft", async () => {
    await giveItAGlossaryAgain();
    const draft = await aDraft();
    const job = await aJob({ status: "running", draftRevisionId: draft });
    try {
      await expect(deleteMine(MINE)).rejects.toMatchObject({ status: 409 });
      expect(await glossaryColumn(myRevisionId), "and it is still there").not.toBeNull();
    } finally {
      await forget(job, draft);
    }
  }, 30_000);

  /**
   * An expired lease cannot publish anything: the same lease boundary fences
   * every write the job could make, so its draft is already unable to reach the
   * article. Refusing the reader on account of it would be refusing them for
   * ever, since nothing sweeps the row on their behalf.
   */
  it("goes ahead when the running job's lease has expired", async () => {
    await giveItAGlossaryAgain();
    const draft = await aDraft();
    const job = await aJob({
      status: "running",
      draftRevisionId: draft,
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });
    try {
      await expect(deleteMine(MINE)).resolves.toEqual({ deleted: true });
    } finally {
      await forget(job, draft);
    }
  }, 30_000);

  /**
   * **Missed on purpose, and safe.** A claimed job that has not opened its draft
   * yet is not refused, because the article row lock decides the order either
   * way: if the delete gets it first the job opens its draft afterwards and
   * copies the *nulled* column; if the draft gets it first the delete sees the
   * committed pointer and refuses.
   */
  it("goes ahead when a claimed job has no draft yet", async () => {
    await giveItAGlossaryAgain();
    const job = await aJob({ status: "running" });
    try {
      await expect(deleteMine(MINE)).resolves.toEqual({ deleted: true });
    } finally {
      await forget(job);
    }
  }, 30_000);
});
