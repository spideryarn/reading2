/**
 * **Abandoned drafts go when their own article next starts a job** — and only
 * that article's, only abandoned ones, and never one somebody protected in the
 * meantime.
 *
 * Greg decided on 2026-09-06 that drafts are swept on demand rather than on a
 * clock: docs/project/cron-scheduler.md § What we do instead, for now. Until
 * this file, `sweepAbandonedDrafts` was a whole-library delete with no caller —
 * the dead-sweeper shape that doc names. Cluster O of
 * docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md is the
 * stage that scoped it to one article and wired it to `openOrBeginJobDraft`'s
 * minting branch, which every job passes through on its first step.
 *
 * The cases, in the plan's own list: old abandoned (swept), recent (kept),
 * current (kept), published (kept), job-referenced — live or terminal — (kept),
 * and another article with equally old candidates (untouched). Then the two
 * races between enumerating and deleting: a protection that **commits** in the
 * gap, and one still **in flight** when the delete takes its locks. Both must
 * delete zero protected rows and leave every pointer where it was, and the
 * reported count must be what the `DELETE` actually removed.
 *
 * Every id here is minted at run time — a literal uuid shared with another test
 * file reds `tests/fixture-ids.test.ts`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs, revisionStepRuns } from "../src/db/schema.js";
import { mintId } from "../src/ids.js";
import { currentOwnerId } from "../src/owner.js";
import { mintAttempt } from "../src/store/jobs.js";
import { READ_COMMITTED } from "../src/store/isolation.js";
import {
  ABANDONED_DRAFT_MS,
  DRAFT_SWEEP_BATCH,
  openOrBeginJobDraft,
  sweepAbandonedDrafts,
} from "../src/store/pg-revisions.js";
import type { JobStep } from "../src/types.js";
import {
  deleteDraftBacklog,
  proveUnprotected,
  surveyDraftBacklog,
} from "../scripts/draft-sweep-backlog.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";

const SLUG = "test-draft-sweep";
const OTHER_SLUG = "test-draft-sweep-other";

await pgReady({
  suite: "tests/draft-sweep-on-step-start.test.ts",
  tables: ["spideryarn.article_revisions", "spideryarn.jobs"],
});

/* Starts jobs on fixed fixture slugs, so it takes the shared run lock —
   tests/helpers/run-lock.ts has the reasoning. */
const runLock = await takeRunLock("tests/draft-sweep-on-step-start.test.ts");
afterAll(async () => {
  await runLock?.release();
});

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const STEPS: JobStep[] = [{ name: "fetch", label: "Fetching the page", status: "pending" }];
const HOUR = 60 * 60 * 1000;
/** Comfortably past the threshold, so a slow run cannot move a row across it. */
const OLD = ABANDONED_DRAFT_MS + 24 * HOUR;

const madeJobs: string[] = [];

async function cleanUp(slug: string): Promise<void> {
  const db = getDb();
  if (madeJobs.length > 0) await db.delete(jobs).where(inArray(jobs.id, madeJobs));
  await db.delete(jobs).where(eq(jobs.slug, slug));
  const [article] = await db.select().from(articles).where(eq(articles.slug, slug)).limit(1);
  if (article) {
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, article.id));
    await db.delete(articleRevisions).where(eq(articleRevisions.articleId, article.id));
    await db.delete(articles).where(eq(articles.id, article.id));
  }
}

async function article(slug: string): Promise<string> {
  const [row] = await getDb()
    .insert(articles)
    .values({ ownerId: currentOwnerId(), slug, shortId: mintId() })
    .returning({ id: articles.id });
  return row!.id;
}

/** A revision of `articleId`, `ageMs` old, with one step run so the cascade is visible. */
async function revision(
  articleId: string,
  status: "draft" | "failed" | "published",
  ageMs: number,
): Promise<string> {
  const id = randomUUID();
  await getDb()
    .insert(articleRevisions)
    .values({ id, articleId, status, createdAt: new Date(Date.now() - ageMs) });
  await getDb().insert(revisionStepRuns).values({
    revisionId: id,
    stepName: "fetch",
    inputHash: "h",
    implementationVersion: "v",
    status: "done",
  });
  return id;
}

async function makeCurrent(articleId: string, revisionId: string): Promise<void> {
  await getDb()
    .update(articles)
    .set({ currentRevisionId: revisionId })
    .where(eq(articles.id, articleId));
}

/** A job that ended still holding a pointer — which the sweep must treat as ownership. */
async function terminalJobHolding(slug: string, revisionId: string, db: Db | Tx = getDb()) {
  const id = mintId();
  await db.insert(jobs).values({
    id,
    ownerId: currentOwnerId(),
    slug,
    steps: STEPS,
    status: "error",
    workKey: `wk-${id}`,
    draftRevisionId: revisionId,
    finishedAt: new Date(),
  });
  madeJobs.push(id);
  return id;
}

async function claimedJob(slug: string): Promise<{ id: string; attemptId: string }> {
  await getDb()
    .update(jobs)
    .set({ status: "done", attemptId: null, leaseExpiresAt: null, finishedAt: new Date() })
    .where(and(inArray(jobs.id, madeJobs.length ? madeJobs : ["-"]), eq(jobs.status, "running")));
  return await insertWhenSlotFree(slug, async () => {
    const id = mintId();
    const attemptId = mintAttempt();
    await getDb().insert(jobs).values({
      id,
      ownerId: currentOwnerId(),
      slug,
      steps: STEPS,
      status: "running",
      attemptId,
      leaseExpiresAt: new Date(Date.now() + 600_000),
      workKey: `wk-${id}`,
    });
    madeJobs.push(id);
    return { id, attemptId };
  });
}

async function surviving(ids: readonly string[]): Promise<Set<string>> {
  const rows = await getDb()
    .select({ id: articleRevisions.id })
    .from(articleRevisions)
    .where(inArray(articleRevisions.id, [...ids]));
  return new Set(rows.map((r) => r.id));
}

async function stepRunsOf(ids: readonly string[]): Promise<number> {
  const rows = await getDb()
    .select({ id: revisionStepRuns.revisionId })
    .from(revisionStepRuns)
    .where(inArray(revisionStepRuns.revisionId, [...ids]));
  return rows.length;
}

async function pointerOf(jobId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ p: jobs.draftRevisionId })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  return row?.p ?? null;
}

describe("the on-demand draft sweep", () => {
  let a: string;
  let b: string;

  beforeAll(async () => {
    await cleanUp(SLUG);
    await cleanUp(OTHER_SLUG);
  });

  beforeEach(async () => {
    await cleanUp(SLUG);
    await cleanUp(OTHER_SLUG);
    a = await article(SLUG);
    b = await article(OTHER_SLUG);
  });

  afterAll(async () => {
    await cleanUp(SLUG);
    await cleanUp(OTHER_SLUG);
    await closeDb();
  });

  it("deletes this article's abandoned drafts on a job's first step, and nothing else", async () => {
    const current = await revision(a, "published", OLD);
    await makeCurrent(a, current);
    const oldPublished = await revision(a, "published", OLD);
    const abandonedDraft = await revision(a, "draft", OLD);
    const abandonedFailed = await revision(a, "failed", OLD);
    const recentFailed = await revision(a, "failed", HOUR);
    const heldByEndedJob = await revision(a, "failed", OLD);
    const endedJob = await terminalJobHolding(SLUG, heldByEndedJob);
    const otherArticles = await revision(b, "failed", OLD);

    const job = await claimedJob(SLUG);
    const opened = await openOrBeginJobDraft({ slug: SLUG, job });

    expect(opened.created).toBe(true);
    expect(opened.sweep).toMatchObject({ kind: "swept", candidates: 2, deleted: 2 });

    const left = await surviving([
      current, oldPublished, abandonedDraft, abandonedFailed, recentFailed, heldByEndedJob,
      otherArticles, opened.revisionId,
    ]);
    expect([...left].sort()).toEqual(
      [current, oldPublished, recentFailed, heldByEndedJob, otherArticles, opened.revisionId].sort(),
    );
    // The cascade went with them, and nothing else's did.
    expect(await stepRunsOf([abandonedDraft, abandonedFailed])).toBe(0);
    expect(await stepRunsOf([otherArticles, heldByEndedJob])).toBe(2);
    expect(await pointerOf(endedJob)).toBe(heldByEndedJob);
    expect(await pointerOf(job.id)).toBe(opened.revisionId);
  });

  it("is idempotent: the next job's first step finds nothing more", async () => {
    await revision(a, "failed", OLD);
    const first = await openOrBeginJobDraft({
      slug: SLUG,
      job: await claimedJob(SLUG),
    });
    expect(first.sweep).toMatchObject({ kind: "swept", deleted: 1 });

    const second = await openOrBeginJobDraft({
      slug: SLUG,
      job: await claimedJob(SLUG),
    });
    // The first job's draft is its own business now: minted seconds ago.
    expect(second.sweep).toMatchObject({ kind: "swept", candidates: 0, deleted: 0 });
  });

  it("does not sweep again when a job reopens its own draft on a later step", async () => {
    await revision(a, "failed", OLD);
    const job = await claimedJob(SLUG);
    await openOrBeginJobDraft({ slug: SLUG, job });
    const reopened = await openOrBeginJobDraft({ slug: SLUG, job });
    expect(reopened.created).toBe(false);
    expect(reopened.sweep).toBeNull();
  });

  it("deletes with no option given: there is no counting mode to fall back to", async () => {
    /* Until 2026-10-05 the default only counted, and deleting was a test's
       option. Greg approved the deletion on 2026-10-04 and the mode went with
       it, so this is the production call, spelt the way production spells it. */
    const doomed = await revision(a, "failed", OLD);
    const opened = await openOrBeginJobDraft({ slug: SLUG, job: await claimedJob(SLUG) });
    expect(opened.sweep).toMatchObject({ kind: "swept", candidates: 1, deleted: 1 });
    expect(opened.sweep).not.toHaveProperty("mode");
    expect((await surviving([doomed])).has(doomed)).toBe(false);
  });

  it("spares a draft a live job is holding, however old it is", async () => {
    /* The ended-job case is above; this is the one that would cost a reader a
       step in flight. A queued row rather than a second running one, because
       the running slot on this slug belongs to the job doing the sweeping. */
    const held = await revision(a, "draft", OLD);
    const unprotected = await revision(a, "draft", OLD);
    const liveJob = mintId();
    await getDb().insert(jobs).values({
      id: liveJob,
      ownerId: currentOwnerId(),
      slug: SLUG,
      steps: STEPS,
      status: "queued",
      workKey: `wk-${liveJob}`,
      draftRevisionId: held,
    });
    madeJobs.push(liveJob);
    const outcome = await getDb().transaction(
      (tx) => sweepAbandonedDrafts(tx, a, {}),
      READ_COMMITTED,
    );
    expect(outcome).toMatchObject({ candidates: 1, deleted: 1 });
    expect([...(await surviving([held, unprotected]))]).toEqual([held]);
    expect(await pointerOf(liveJob)).toBe(held);
  });

  it("takes at most one batch per invocation, oldest first, and says there is more", async () => {
    const ids: string[] = [];
    for (let i = 0; i < DRAFT_SWEEP_BATCH + 2; i++) {
      ids.push(await revision(a, "failed", OLD + (DRAFT_SWEEP_BATCH + 2 - i) * HOUR));
    }
    const opened = await openOrBeginJobDraft({
      slug: SLUG,
      job: await claimedJob(SLUG),
    });
    expect(opened.sweep).toMatchObject({
      kind: "swept",
      candidates: DRAFT_SWEEP_BATCH,
      more: true,
      deleted: DRAFT_SWEEP_BATCH,
    });
    // ids[0] is the oldest; the two youngest are the ones left for next time.
    expect([...(await surviving(ids))].sort()).toEqual(ids.slice(DRAFT_SWEEP_BATCH).sort());
  });

  it("never fails the step: a cleanup error is rolled back to its savepoint and reported", async () => {
    const doomed = await revision(a, "failed", OLD);
    const job = await claimedJob(SLUG);
    const opened = await openOrBeginJobDraft({
      slug: SLUG,
      job,
      sweep: {
        afterEnumerate: async () => {
          throw new Error("injected cleanup failure");
        },
      },
    });
    expect(opened.created).toBe(true);
    expect(opened.sweep).toMatchObject({ kind: "failed" });
    expect((await surviving([doomed, opened.revisionId])).size).toBe(2);
    expect(await pointerOf(job.id)).toBe(opened.revisionId);
  });

  it("recovers from a failed SQL statement too, which aborts the transaction until the savepoint", async () => {
    /* A thrown JavaScript error leaves Postgres happy; a failed statement puts
       the whole transaction into "current transaction is aborted" until
       something rolls it back. An infinite threshold makes the enumeration ask
       `make_interval` for an interval Postgres refuses to build — a real
       statement error, and the draft still has to be minted after it. */
    const doomed = await revision(a, "failed", OLD);
    const job = await claimedJob(SLUG);
    const opened = await openOrBeginJobDraft({
      slug: SLUG,
      job,
      sweep: { olderThanMs: Number.POSITIVE_INFINITY },
    });
    expect(opened.created).toBe(true);
    expect(opened.sweep).toMatchObject({ kind: "failed" });
    expect((await surviving([doomed, opened.revisionId])).size).toBe(2);
    expect(await pointerOf(job.id)).toBe(opened.revisionId);
  });

  it("rechecks at delete time: protection committed after enumeration deletes nothing protected", async () => {
    const current = await revision(a, "published", OLD);
    await makeCurrent(a, current);
    const toBeOwned = await revision(a, "failed", OLD);
    const toBePublished = await revision(a, "draft", OLD);
    const unprotected = await revision(a, "failed", OLD);
    let ownerJob = "";

    const outcome = await getDb().transaction(
      (tx) =>
        sweepAbandonedDrafts(tx, a, {
          /* The barrier. Another connection, committing before we go on — the
             sweep's transaction holds no lock on these rows yet. */
          afterEnumerate: async (ids) => {
            expect([...ids].sort()).toEqual([toBeOwned, toBePublished, unprotected].sort());
            ownerJob = await terminalJobHolding(SLUG, toBeOwned);
            await getDb().transaction(async (other) => {
              await other
                .update(articleRevisions)
                .set({ status: "published" })
                .where(eq(articleRevisions.id, toBePublished));
              await other
                .update(articles)
                .set({ currentRevisionId: toBePublished })
                .where(eq(articles.id, a));
            });
          },
        }),
      READ_COMMITTED,
    );

    expect(outcome).toMatchObject({ candidates: 3, deleted: 1 });
    expect([...(await surviving([toBeOwned, toBePublished, unprotected]))].sort()).toEqual(
      [toBeOwned, toBePublished].sort(),
    );
    expect(await pointerOf(ownerJob)).toBe(toBeOwned);
    const [row] = await getDb()
      .select({ c: articles.currentRevisionId })
      .from(articles)
      .where(eq(articles.id, a));
    expect(row?.c).toBe(toBePublished);
  });

  it("skips a candidate another transaction is pointing a job at right now, and keeps the pointer", async () => {
    const contested = await revision(a, "failed", OLD);
    const unprotected = await revision(a, "failed", OLD);

    /* A transaction that has written a job pointer at `contested` and not yet
       committed — which holds the foreign key's KEY SHARE lock on that row. */
    let release!: () => void;
    const holdUntil = new Promise<void>((r) => {
      release = r;
    });
    let holding!: () => void;
    const held = new Promise<void>((r) => {
      holding = r;
    });
    let holderJob = "";
    let holderPid = 0;
    const holder = getDb().transaction(async (tx) => {
      const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
      holderPid = Number((pid.rows[0] as { pid: number | string }).pid);
      holderJob = await terminalJobHolding(SLUG, contested, tx);
      holding();
      await holdUntil;
    });

    let settled = false;
    const sweeping = getDb()
      .transaction(
        (tx) =>
          sweepAbandonedDrafts(tx, a, {
            afterEnumerate: async () => {
              await held;
            },
          }),
        READ_COMMITTED,
      )
      .finally(() => {
        settled = true;
      });

    /* **Release the holder as soon as the sweep either finishes or blocks on
       it.** The sweep as built never blocks: `skip locked` steps round the row.
       A sweep that waited instead — a plain `for update`, or one `DELETE … where
       not exists (…)` — would sit behind the holder, and letting the holder
       commit then is what shows the harm: the waiting delete does not re-read
       the subquery for a row that was only locked, takes the row, and `on
       delete set null` empties the pointer that just committed. Measured
       against that mutation on 2026-09-11. */
    await held;
    for (let i = 0; i < 400 && !settled; i++) {
      const blocked = await getDb().execute(
        sql`select count(*)::int as n from pg_stat_activity where ${holderPid} = any(pg_blocking_pids(pid))`,
      );
      if (Number((blocked.rows[0] as { n: number | string }).n) > 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    release();
    await holder;
    const outcome = await sweeping;

    expect(outcome).toMatchObject({ candidates: 2, deleted: 1 });
    expect([...(await surviving([contested, unprotected]))]).toEqual([contested]);
    expect(await pointerOf(holderJob)).toBe(contested);
  });

  it("refuses to delete under an isolation level whose recheck would read a stale snapshot", async () => {
    await revision(a, "failed", OLD);
    await expect(
      getDb().transaction((tx) => sweepAbandonedDrafts(tx, a, {}), {
        isolationLevel: "repeatable read",
      }),
    ).rejects.toThrow(/read committed/i);
  });

  it("spares an article's current revision on the pointer alone, whatever its status says", async () => {
    /* Not a state any writer produces — publication marks the row `published`
       as it moves the pointer — which is exactly why the status test cannot be
       the only thing standing between the sweep and an article's text. Without
       this case, removing the current-revision condition left every other case
       green. GPT Sol, P3 of the stage review. */
    const currentButFailed = await revision(a, "failed", OLD);
    await makeCurrent(a, currentButFailed);
    const unprotected = await revision(a, "failed", OLD);
    const outcome = await getDb().transaction(
      (tx) => sweepAbandonedDrafts(tx, a, {}),
      READ_COMMITTED,
    );
    expect(outcome).toMatchObject({ candidates: 1, deleted: 1 });
    expect([...(await surviving([currentButFailed, unprotected]))]).toEqual([currentButFailed]);
  });

  describe("the one-off backlog script", () => {
    /* scripts/draft-sweep-backlog.ts: the whole library, once. The private lane
       gives this file its own database, so "the whole library" is these rows. */
    const mine = (survey: { articles: readonly { articleId: string; revisions: number }[] }) =>
      Object.fromEntries(
        survey.articles
          .filter((row) => row.articleId === a || row.articleId === b)
          .map((row) => [row.articleId, row.revisions]),
      );

    it("surveys without deleting, proves its list, and then deletes exactly that list", async () => {
      const current = await revision(a, "published", OLD);
      await makeCurrent(a, current);
      const oldPublished = await revision(a, "published", OLD);
      const recent = await revision(a, "failed", HOUR);
      const held = await revision(a, "failed", OLD);
      const endedJob = await terminalJobHolding(SLUG, held);
      const doomed: string[] = [];
      // More than a batch in one article, so the loop has to go round.
      for (let i = 0; i < DRAFT_SWEEP_BATCH + 3; i++) doomed.push(await revision(a, "failed", OLD));
      doomed.push(await revision(b, "draft", OLD));

      const before = await surveyDraftBacklog(getDb());
      expect(mine(before)).toEqual({ [a]: DRAFT_SWEEP_BATCH + 3, [b]: 1 });
      expect(before.proven).toBe(true);
      expect(before.proof.seen).toBe(before.revisions);
      expect(before.mayDelete).toBe(true);
      // A survey is a survey.
      expect((await surviving(doomed)).size).toBe(doomed.length);

      const done = await deleteDraftBacklog(getDb(), before);
      expect(done).toEqual([
        { articleId: a, deleted: DRAFT_SWEEP_BATCH + 3 },
        { articleId: b, deleted: 1 },
      ]);
      expect((await surviving(doomed)).size).toBe(0);
      expect([...(await surviving([current, oldPublished, recent, held]))].sort()).toEqual(
        [current, oldPublished, recent, held].sort(),
      );
      expect(await pointerOf(endedJob)).toBe(held);
      expect(mine(await surveyDraftBacklog(getDb()))).toEqual({});
    });

    it("deletes only surveyed revisions, even when another row becomes eligible afterwards", async () => {
      const surveyed = await revision(a, "failed", OLD);
      const later = await revision(a, "failed", HOUR);
      const before = await surveyDraftBacklog(getDb());
      await getDb().update(articleRevisions)
        .set({ createdAt: new Date(Date.now() - OLD) })
        .where(eq(articleRevisions.id, later));
      const done = await deleteDraftBacklog(getDb(), before);
      expect(done).toEqual([{ articleId: a, deleted: 1 }]);
      expect([...(await surviving([surveyed, later]))]).toEqual([later]);
    });

    it("reproves lineage under the delete locks rather than trusting the earlier survey", async () => {
      const base = await revision(a, "failed", OLD);
      const before = await surveyDraftBacklog(getDb());
      expect(before.proven).toBe(true);
      const copy = await revision(a, "draft", HOUR);
      await getDb().update(articleRevisions).set({ basedOnRevisionId: base })
        .where(eq(articleRevisions.id, copy));
      await expect(deleteDraftBacklog(getDb(), before)).rejects.toThrow(/batch.*protected/i);
      expect((await surviving([base, copy])).size).toBe(2);
      const [row] = await getDb().select({ base: articleRevisions.basedOnRevisionId })
        .from(articleRevisions).where(eq(articleRevisions.id, copy));
      expect(row?.base).toBe(base);
    });

    it("counts each base once and excludes children deleted in the same proven set", async () => {
      const base = await revision(a, "failed", OLD);
      const copies = [await revision(a, "failed", OLD), await revision(a, "failed", OLD)];
      await getDb().update(articleRevisions).set({ basedOnRevisionId: base })
        .where(inArray(articleRevisions.id, copies));
      const prove = (ids: string[]) => getDb().transaction(
        (tx) => proveUnprotected(tx, ids), READ_COMMITTED,
      );
      expect((await prove([base])).baseOfASurvivor).toBe(1);
      expect((await prove([base, ...copies])).baseOfASurvivor).toBe(0);
      expect((await prove([base, copies[0]!])).baseOfASurvivor).toBe(1);
    });

    it("refuses to delete a base whose surveyed child belongs to another article's batch", async () => {
      const base = await revision(a, "failed", OLD);
      const copy = await revision(b, "failed", OLD);
      await getDb().update(articleRevisions).set({ basedOnRevisionId: base })
        .where(eq(articleRevisions.id, copy));
      const before = await surveyDraftBacklog(getDb());
      expect(before.proven).toBe(true);
      expect(before.proof.baseOfASurvivor).toBe(0);
      // Force the dangerous order: the whole-set proof cannot authorise the
      // base's deletion while the child's separate transaction is still ahead.
      const ordered = { ...before, articles: [...before.articles].sort((x, y) =>
        Number(y.articleId === a) - Number(x.articleId === a)) };
      await expect(deleteDraftBacklog(getDb(), ordered)).rejects.toThrow(/batch.*protected/i);
      expect((await surviving([base, copy])).size).toBe(2);
      const [row] = await getDb().select({ base: articleRevisions.basedOnRevisionId })
        .from(articleRevisions).where(eq(articleRevisions.id, copy));
      expect(row?.base).toBe(base);
    });

    it("refuses its own list when a candidate is the base of a row that would survive", async () => {
      /* Not a state the app produces — a base is a published revision — which
         is why only the second query can notice it: the sweep's predicate does
         not ask. Deleting `base` would blank `copy`'s lineage through `set
         null`, and its publication would then be refused. */
      const base = await revision(a, "failed", OLD);
      const copy = await revision(a, "draft", HOUR);
      await getDb()
        .update(articleRevisions)
        .set({ basedOnRevisionId: base })
        .where(eq(articleRevisions.id, copy));
      const survey = await surveyDraftBacklog(getDb());
      expect(survey.proof.baseOfASurvivor).toBe(1);
      expect(survey.proven).toBe(false);
    });

    it("the second query says no to each protection, handed ids the predicate would never name", async () => {
      /* A zero from a check that could not have said anything else is not
         evidence. The survey only ever hands this the predicate's own ids, so
         every count is zero in production; here it is handed one wrong id of
         each kind and has to name each. GPT Sol, F1 of the plan review. */
      const published = await revision(a, "published", OLD);
      const currentButFailed = await revision(a, "failed", OLD);
      await makeCurrent(a, currentButFailed);
      const held = await revision(a, "failed", OLD);
      await terminalJobHolding(SLUG, held);
      const young = await revision(a, "failed", HOUR);
      const fine = await revision(a, "failed", OLD);
      const prove = (ids: string[]) =>
        getDb().transaction((tx) => proveUnprotected(tx, ids), READ_COMMITTED);

      const clean = { notDraftOrFailed: 0, current: 0, jobNamed: 0, young: 0, baseOfASurvivor: 0 };
      expect(await prove([fine])).toEqual({ ...clean, seen: 1 });
      expect(await prove([fine, published])).toEqual({ ...clean, seen: 2, notDraftOrFailed: 1 });
      expect(await prove([fine, currentButFailed])).toEqual({ ...clean, seen: 2, current: 1 });
      expect(await prove([fine, held])).toEqual({ ...clean, seen: 2, jobNamed: 1 });
      expect(await prove([fine, young])).toEqual({ ...clean, seen: 2, young: 1 });
      // And an id that is not there at all is a shortfall in `seen`, not a pass.
      expect(await prove([fine, randomUUID()])).toEqual({ ...clean, seen: 1 });
    });

    it("cannot write while it surveys", async () => {
      /* Inject a write into the survey's own transaction, preserving the
         options surveyDraftBacklog actually supplies. */
      const db = getDb();
      const instrumented = Object.create(db) as Db;
      instrumented.transaction = ((body, config) => db.transaction(async (tx) => {
        await tx.delete(articleRevisions).where(eq(articleRevisions.articleId, a));
        return await body(tx);
      }, config)) as Db["transaction"];
      await expect(
        surveyDraftBacklog(instrumented),
      ).rejects.toMatchObject({ cause: { code: "25006" } });
    });
  });

  it("never names an article it was not given", async () => {
    const mine = await revision(a, "failed", OLD);
    const theirs = await revision(b, "failed", OLD);
    const outcome = await getDb().transaction(
      (tx) => sweepAbandonedDrafts(tx, b, {}),
      READ_COMMITTED,
    );
    expect(outcome).toMatchObject({ candidates: 1, deleted: 1 });
    expect([...(await surviving([mine, theirs]))]).toEqual([mine]);
    // And a sweep with nothing to do reports that, rather than a count it read earlier.
    const again = await getDb().transaction(
      (tx) => sweepAbandonedDrafts(tx, b, {}),
      READ_COMMITTED,
    );
    expect(again).toMatchObject({ candidates: 0, deleted: 0 });
  });

  it("restricts a backlog sweep to its exact ids, with an empty list selecting nothing", async () => {
    const surveyed = await revision(a, "failed", OLD);
    const unproven = await revision(a, "failed", OLD);
    const run = (revisionIds: string[]) => getDb().transaction(
      (tx) => sweepAbandonedDrafts(tx, a, { revisionIds }), READ_COMMITTED,
    );
    expect(await run([])).toMatchObject({ candidates: 0, deleted: 0 });
    expect((await surviving([surveyed, unproven])).size).toBe(2);
    expect(await run([surveyed])).toMatchObject({ candidates: 1, deleted: 1 });
    expect([...(await surviving([surveyed, unproven]))]).toEqual([unproven]);
  });
});
