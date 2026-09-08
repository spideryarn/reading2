/**
 * **Destroying an article while something else is holding it** — the refusal,
 * and the race the refusal cannot see on its own.
 *
 * `tests/store-shelf-pg.test.ts` § *destroying an article* has the happy path
 * and the cascade; `tests/owner-isolation.test.ts` has "not yours, 404, and the
 * row is still there". This file is the third question, which is the one that
 * made Stage C harder than it looks: **what else is in flight, and what does
 * refusing it cost.**
 *
 * ## Why a job is refused rather than deleted (GPT Sol's F3)
 *
 * The first draft of the plan deleted the slug's non-terminal jobs on the way
 * past, because the Stage A spike measured that a leftover `queued` job blocks
 * the reader from ever re-adding that URL —
 * `23505 duplicate key value violates unique constraint "jobs_reserved_slug"`.
 *
 * That fix leaks a quota slot for ever. Deleting a job deliberately does not
 * touch the reservation it was spending (src/db/schema.ts § `ingest_event_id`,
 * *"the default is `NO ACTION`, nothing cascades"*), and an unsettled
 * reservation deliberately never expires (§ `ingest_events`), so the slot is
 * counted against the reader until somebody notices by hand. Refusing solves
 * the collision as well: the reader stops the import, which settles the
 * reservation properly, and then deletes.
 *
 * `charged, queued, and no draft yet` is the case that made this a P0 rather
 * than a nicety — it is the ordinary first state of every URL ingest
 * (`draft_revision_id` is null until the first step opens a draft), and it is
 * exactly the shape `pgGlossaryStore.deleteGlossary`'s predicate is documented
 * to *miss on purpose*. Copying that predicate is what produced the bug.
 *
 * ## Why the predicate must not consult the lease either
 *
 * The glossary query also excludes a `running` job whose lease has expired,
 * and it is right to: it is asking *"can this job still publish?"*, and a
 * fenced-out job cannot. This asks a different question — *"is anything using
 * this article?"* — and a job whose lease lapsed is requeued by `settleExpired`
 * and carries on (src/db/schema.ts § `requeues`). Refusing it is a wait the
 * reader can end by pressing Stop; deleting under it is not.
 *
 * ## And the race (GPT Sol's F4)
 *
 * The refusal is a `select` inside the deleting transaction, so it can only see
 * jobs that have committed. An enqueue that had already passed its
 * `articleExists` preflight and had not yet inserted is invisible to it — and
 * the worker that later picks that job up calls `lockOrCreateArticle`, which is
 * documented to **create** the article row if it is missing. The delete reports
 * success and the article comes back. The last three cases are the barrier:
 * both orders are legal, and one combination is not.
 *
 * A real database, one owner's rows, no network.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, ingestEvents, jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { enqueue } from "../src/jobs.js";
import { runAsOwner } from "../src/owner.js";
import type { OwnerId } from "../src/owner.js";
import { FREE } from "../src/billing/tiers.js";
import { usageFor } from "../src/store/pg-billing.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { pgShelfStore } from "../src/store/pg-shelf.js";
import type { Job } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* Before `pgReady`, or the file fails for the wrong reason. */
loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/article-delete-pg.test.ts",
  tables: ["spideryarn.articles", "spideryarn.jobs", "spideryarn.ingest_events"],
  keepPool: true,
  max: 4,
});

/** Fixed and distinctive, so a killed run's rows are cleared rather than added to. */
const OWNER = "de1e1e00-0000-4000-8000-0000000000a1" as OwnerId;

const SLUG = "test-article-delete";

const asOwner = <T,>(fn: () => Promise<T>): Promise<T> => runAsOwner(OWNER, fn);

async function givenArticle(): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(articles)
    .values({ ownerId: OWNER, slug: SLUG })
    .returning({ id: articles.id });
  return row!.id;
}

/** A draft revision for `articleId`, the thing a running job holds. */
async function givenDraft(articleId: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(articleRevisions)
    .values({ articleId, status: "draft" })
    .returning({ id: articleRevisions.id });
  return row!.id;
}

/** An unsettled reservation — a slot spent and not yet given back. */
async function givenReservation(): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(ingestEvents)
    .values({ ownerId: OWNER, slug: SLUG })
    .returning({ id: ingestEvents.id });
  return row!.id;
}

interface JobFixture {
  status: "queued" | "running" | "done" | "error" | "cancelled";
  draftRevisionId?: string;
  ingestEventId?: string;
  /** For a `running` row: how long ago its lease ran out, in ms. Live if absent. */
  leaseExpiredMsAgo?: number;
  /**
   * The address the attempt was for. **This is what makes a terminal row
   * dangerous rather than inert**: `retryJob` copies it into the new request,
   * and `slugForRetry` then mints this very slug again — see § *a finished job
   * is a way back in* below.
   */
  url?: string;
}

async function givenJob(fixture: JobFixture): Promise<string> {
  const db = getDb();
  const id = mintId();
  const running = fixture.status === "running";
  await db.insert(jobs).values({
    id,
    ownerId: OWNER,
    slug: SLUG,
    steps: [],
    status: fixture.status,
    workKey: `work-${id}`,
    /* `jobs_running_is_fenced` refuses a `running` row without both of these,
       so a fixture that omitted them would fail at the INSERT rather than at
       the assertion. */
    ...(running && {
      attemptId: "00000000-0000-4000-8000-00000000ab01",
      leaseExpiresAt: new Date(
        Date.now() +
          (fixture.leaseExpiredMsAgo === undefined ? 60_000 : -fixture.leaseExpiredMsAgo),
      ),
    }),
    ...(fixture.draftRevisionId !== undefined && { draftRevisionId: fixture.draftRevisionId }),
    ...(fixture.ingestEventId !== undefined && { ingestEventId: fixture.ingestEventId }),
    ...(fixture.url !== undefined && { url: fixture.url }),
  });
  return id;
}

const articleRows = async () =>
  getDb().select({ id: articles.id }).from(articles).where(eq(articles.slug, SLUG));

const jobRows = async () =>
  getDb()
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.ownerId, OWNER), eq(jobs.slug, SLUG)));

async function clear(): Promise<void> {
  if (!pool) return;
  await pool.query("delete from spideryarn.jobs where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.ingest_events where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.articles where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.billing_accounts where owner_id = $1", [OWNER]);
}

beforeEach(async () => {
  if (pool) {
    await seedAuthUser(pool, {
      id: OWNER,
      email: `article-delete-${OWNER}@spideryarn.local`,
      onConflictDoNothing: true,
    });
  }
  await clear();
});

afterEach(clear);

afterAll(async () => {
  await closeDb();
  if (!pool) return;
  await pool.query("delete from auth.users where id = $1", [OWNER]).catch(() => {});
  await pool.end();
});

/* ------------------------------------------------- refusing a live job -- */

describe("an article with a job still on it", () => {
  it("refuses while a queued job is holding a draft, and deletes nothing", async () => {
    const articleId = await givenArticle();
    const jobId = await givenJob({ status: "queued", draftRevisionId: await givenDraft(articleId) });

    await expect(asOwner(() => pgShelfStore.destroy(SLUG))).rejects.toMatchObject({ status: 409 });

    expect(await articleRows()).toHaveLength(1);
    expect(await jobRows()).toEqual([{ id: jobId, status: "queued" }]);
  });

  /**
   * **The case that broke the first draft.** Charged, queued, and no draft yet
   * — the state every URL ingest is in for its first few seconds, and the one
   * `deleteGlossary`'s predicate is documented to miss.
   *
   * The four assertions are four different bugs. The article surviving is the
   * refusal working at all. The job surviving is F3's fix — the first draft
   * deleted it here. The reservation surviving *unsettled* is what the leak
   * looked like from the ledger's side. And the usage is the number the reader
   * would have paid for it: a released or vanished reservation would move it,
   * and moving it in either direction is a bill nobody asked for.
   */
  it("refuses a charged queued job that has not opened its draft, and moves nothing", async () => {
    await givenArticle();
    const reservationId = await givenReservation();
    const jobId = await givenJob({ status: "queued", ingestEventId: reservationId });

    const before = await usageFor(OWNER, FREE);
    expect(before.inFlight).toBe(1);

    await expect(asOwner(() => pgShelfStore.destroy(SLUG))).rejects.toMatchObject({ status: 409 });

    expect(await articleRows()).toHaveLength(1);
    expect(await jobRows()).toEqual([{ id: jobId, status: "queued" }]);

    const [reservation] = await getDb()
      .select({
        succeededAt: ingestEvents.succeededAt,
        releasedAt: ingestEvents.releasedAt,
      })
      .from(ingestEvents)
      .where(eq(ingestEvents.id, reservationId));
    expect(reservation).toEqual({ succeededAt: null, releasedAt: null });

    expect(await usageFor(OWNER, FREE)).toEqual(before);
  });

  /**
   * A `running` row whose lease lapsed. `deleteGlossary` excludes it through
   * `leaseIsLive`, correctly, because it is asking whether the job can still
   * publish. This asks whether anything is using the article, and a lapsed job
   * is requeued rather than abandoned — so it counts.
   */
  it("refuses a running job whose lease has expired", async () => {
    await givenArticle();
    await givenJob({ status: "running", leaseExpiredMsAgo: 10 * 60_000 });

    await expect(asOwner(() => pgShelfStore.destroy(SLUG))).rejects.toMatchObject({ status: 409 });
    expect(await articleRows()).toHaveLength(1);
  });

  /**
   * **The positive control for the refusal**, without which a predicate that
   * matched every job would look exactly like one that matched the right ones.
   *
   * A terminal job does not block the delete — the Stage A spike measured that
   * both slug indexes are partial on `('queued','running')`, so a `done` row
   * blocks nothing. What happens to it afterwards is the next describe block.
   */
  it("deletes anyway when the only job left is finished", async () => {
    await givenArticle();
    await givenJob({ status: "done" });

    expect(await asOwner(() => pgShelfStore.destroy(SLUG))).toEqual({ destroyed: SLUG });

    expect(await articleRows()).toHaveLength(0);
  });
});

/* --------------------------------------- a finished job is a way back in -- */

/**
 * **What the terminal rows do after the article has gone** — GPT Sol's F20.
 *
 * Stage C left them, on the grounds that a `done` or `error` row is inert
 * against every one of the queue's partial unique indexes. Index-inert is not
 * the same as operationally inert, and the gap is `retryJob`
 * ([src/jobs.ts](../src/jobs.ts)): it copies the failed attempt's own `url` (or
 * `upload`) into the new request, and `slugForRetry` deliberately keeps the
 * failed attempt's own slug. So a reader who deletes an article and then presses
 * Retry on a month-old failure gets a queued job for the destroyed slug, and the
 * worker's `lockOrCreateArticle` **remakes the article they destroyed**.
 *
 * It is not a race: the terminal row survives deliberately, so the reader can do
 * this at their leisure, minutes or weeks later.
 *
 * The fix is that `destroy` takes them with it, in the transaction that takes
 * the article. That is safe against the reservation leak F3 found, because a job
 * only ever *reaches* a terminal status through a transaction that settles its
 * reservation in the same statement batch — `settlingIfTerminal` and
 * `requestCancel` in [pg-jobs.ts](../src/store/pg-jobs.ts), `settleIn` in
 * [pg-session.ts](../src/store/pg-session.ts), and `settleExpired`'s sweep. The
 * unsettled reservation F3 is about belongs to an **active** job, and those are
 * still refused rather than deleted. `forget` and `trimFinished` have deleted
 * terminal rows on exactly this reasoning since before any of this.
 */
describe("the finished jobs an article leaves behind", () => {
  it("goes with the article, so a retry has nothing left to retry", async () => {
    await givenArticle();
    const failed = await givenJob({ status: "error", url: "https://example.test/gone" });
    await givenJob({ status: "cancelled", url: "https://example.test/gone" });
    await givenJob({ status: "done" });

    expect(await asOwner(() => pgShelfStore.destroy(SLUG))).toEqual({ destroyed: SLUG });

    expect(await articleRows()).toHaveLength(0);
    expect(await jobRows()).toHaveLength(0);

    /* The reader's own route, said in the store's words. `retryJob` starts with
       `store.get(id, owner)` and answers `null` — which src/routes.ts turns into
       the 404 a stranger's job id already gets — so there is no request that can
       reach `enqueue` carrying this attempt's slug. */
    expect(await pgJobStore.get(failed, OWNER)).toBeUndefined();
  });

  /**
   * **The bill does not move**, which is the half F3 would have this test prove.
   *
   * A finished ingest's reservation is `succeeded`, and it is counted for the
   * period whether or not the job that spent it is still on file — the row lives
   * in `ingest_events`, `jobs.ingest_event_id` points *at* it, and that key is
   * `NO ACTION` in both directions. Deleting the job is not a refund and must
   * not read as one.
   */
  it("leaves the settled reservation, and the usage, exactly where they were", async () => {
    await givenArticle();
    const reservationId = await givenReservation();
    await getDb()
      .update(ingestEvents)
      .set({ succeededAt: new Date() })
      .where(eq(ingestEvents.id, reservationId));
    await givenJob({ status: "done", ingestEventId: reservationId });

    const before = await usageFor(OWNER, FREE);
    expect(before.chargedFullPrice, "a succeeded reservation is a slot spent").toBe(1);

    expect(await asOwner(() => pgShelfStore.destroy(SLUG))).toEqual({ destroyed: SLUG });

    expect(await jobRows()).toHaveLength(0);
    const [reservation] = await getDb()
      .select({ succeededAt: ingestEvents.succeededAt, releasedAt: ingestEvents.releasedAt })
      .from(ingestEvents)
      .where(eq(ingestEvents.id, reservationId));
    expect(reservation?.releasedAt, "not a refund").toBeNull();
    expect(reservation?.succeededAt).not.toBeNull();
    expect(await usageFor(OWNER, FREE)).toEqual(before);
  });
});

/* ------------------------------------- the enqueue race, both ways round -- */

/** A job as `enqueue` builds one, minus everything the ticket carries. */
function wanted(): Job {
  return {
    id: mintId(),
    ownerId: OWNER,
    slug: SLUG,
    steps: [],
    status: "queued",
    createdAt: new Date().toISOString(),
  };
}

/**
 * The ticket half of "run something on the article I already have" — the shape
 * `enqueue` builds when a request carried neither a URL nor an upload, and the
 * only shape that may insist the article is there.
 */
const adopting = { reservesName: false, requiresArticle: true };

describe("enqueueing against an article that is being deleted", () => {
  /**
   * **Delete wins.** The article is gone before the insert, so enqueue must
   * refuse rather than insert a job whose worker would call
   * `lockOrCreateArticle` and bring the article back.
   *
   * It must refuse **from inside its own transaction**, not by trusting the
   * `articleExists` preflight in src/jobs.ts — which is why this drives the
   * store directly, with no preflight anywhere near it.
   */
  it("refuses with a 404 once the article has gone, and inserts nothing", async () => {
    await givenArticle();
    expect(await asOwner(() => pgShelfStore.destroy(SLUG))).toEqual({ destroyed: SLUG });

    await expect(
      asOwner(() => pgJobStore.enqueueOrGet(wanted(), { ...adopting, workKey: `w-${mintId()}` })),
    ).rejects.toMatchObject({ status: 404 });

    expect(await jobRows()).toHaveLength(0);
  });

  /** **Enqueue wins.** The job is committed, so the delete sees it and refuses. */
  it("lets the delete refuse when the job got there first", async () => {
    await givenArticle();
    const outcome = await asOwner(() =>
      pgJobStore.enqueueOrGet(wanted(), { ...adopting, workKey: `w-${mintId()}` }),
    );
    expect(outcome.kind).toBe("created");

    await expect(asOwner(() => pgShelfStore.destroy(SLUG))).rejects.toMatchObject({ status: 409 });
    expect(await articleRows()).toHaveLength(1);
  });

  /**
   * **The barrier**, and the only case here where the two really contend.
   *
   * A third connection holds the article row so that both operations are
   * definitely blocked on it before either can proceed; releasing it lets the
   * database decide the order. Both orders are legal and the test asserts
   * neither — what it forbids is the combination that says the delete lied:
   * **the delete succeeded and a job for that article exists afterwards.**
   *
   * Repeated, because one pass samples one order.
   *
   * **What it does not do, said out loud.** Take the article lock back out of
   * `tryEnqueue` and this stays green: without it the enqueue never waits, so
   * it inserts while the delete is still blocked, and the delete then sees a
   * committed job and refuses — which is a legal outcome. The pre-fix failure
   * needs the delete to finish *between* an enqueue's preflight and its insert,
   * and nothing here can hold an enqueue open across that gap.
   *
   * So the test that discriminates is the sequential one above — *refuses with
   * a 404 once the article has gone* — and it was watched red. What this one
   * buys is the other half, and it is not nothing: that the new lock produces
   * no deadlock, that both orders still resolve, and that the outcomes stay
   * paired. A delete that reported success next to a surviving job would be
   * caught here whatever the cause. docs/reusable/silent-success.md is why the
   * limit is written down rather than left to be inferred from a green tick.
   */
  it("never lets a successful delete leave a job behind", async () => {
    if (!pool) return;

    for (let pass = 0; pass < 6; pass++) {
      await clear();
      await seedAuthUser(pool, {
        id: OWNER,
        email: `article-delete-${OWNER}@spideryarn.local`,
        onConflictDoNothing: true,
      });
      const articleId = await givenArticle();

      const holder = await pool.connect();
      let deleted: "ok" | "refused";
      try {
        await holder.query("begin");
        await holder.query("select 1 from spideryarn.articles where id = $1 for update", [
          articleId,
        ]);

        /* The outcome is the promise's value rather than a variable a callback
           assigns, so the compiler can see both branches — and so that a
           `destroy` which threw something other than a 409 fails the test rather
           than being read as a refusal. */
        const destroying = asOwner(() => pgShelfStore.destroy(SLUG)).then(
          () => "ok" as const,
          (err: { status?: number }) => {
            /* Only the two answers this can legitimately give. Anything else is
               a bug wearing a rejection, and swallowing it here would make the
               invariant below vacuously true. */
            expect(err.status).toBe(409);
            return "refused" as const;
          },
        );
        const enqueueing = asOwner(() =>
          pgJobStore.enqueueOrGet(wanted(), { ...adopting, workKey: `w-${mintId()}` }),
        ).catch((err: { status?: number }) => {
          expect(err.status).toBe(404);
          return undefined;
        });

        /* Both are now waiting on the row `holder` has. Give them long enough to
           reach it — without this the "race" can be two operations that never
           overlapped, which is the version of this test that proves nothing. */
        await new Promise((resolve) => setTimeout(resolve, 250));
        await holder.query("commit");

        [deleted] = await Promise.all([destroying, enqueueing]);
      } finally {
        await holder.query("rollback").catch(() => {});
        holder.release();
      }

      const jobsLeft = await jobRows();
      const articlesLeft = await articleRows();
      if (deleted === "ok") {
        expect(articlesLeft).toHaveLength(0);
        /* The forbidden combination. A job here is a job whose worker calls
           `lockOrCreateArticle` and resurrects what the reader destroyed. */
        expect(jobsLeft).toHaveLength(0);
      } else {
        expect(articlesLeft).toHaveLength(1);
        expect(jobsLeft).toHaveLength(1);
      }
    }
  }, 30_000);
});

/* ----------------------------- adopting a slug the shelf no longer has -- */

/**
 * **A fresh paste that adopts a slug from the shelf** — GPT Sol's F21, and the
 * classification bug F4's fix left behind.
 *
 * `enqueue` decided whether the article had to already exist by looking at the
 * *request*: `!request.url && !request.upload`. But a URL is not one shape, it
 * is three, and slug allocation is the only line in the codebase that knows
 * which:
 *
 * - **minted** — nothing holds this address, so this job is about to *make* the
 *   article and there is nothing yet to insist on;
 * - **adopted from the shelf** — a published article of this reader's already
 *   holds this address, and the job is going to run on it;
 * - **adopted from the queue** — another request of this reader's, seconds old,
 *   is minting for this address and has not opened its draft yet, so there is
 *   still no article row and there must not be one insisted on.
 *
 * Only the middle one may insist, and the request shape cannot tell the three
 * apart. So the fact travels on `SlugAllocation`, which is where it is known.
 *
 * ## Why this is deterministic rather than a race dressed up as one
 *
 * The holder connection takes the article row, so the enqueue reaches
 * `lockArticleFor` and stops there — its shelf lookup has already happened and
 * already returned the slug. The holder then deletes the row **from its own
 * transaction** and commits. So the delete lands exactly in the window F21
 * describes, every time, rather than whenever the scheduler feels like it.
 *
 * A timing slip fails this test rather than passing it: if the enqueue had not
 * reached the lock, its shelf lookup would find nothing, mint a fresh random
 * slug, and insert — and the assertion below is a refusal.
 */
describe("a fresh paste for a URL the shelf is losing", () => {
  const URL = "https://example.test/an-article-being-deleted";

  /** An article with a published revision carrying `URL` — what `slugForUrlKey` reads. */
  async function givenPublishedArticle(): Promise<string> {
    const db = getDb();
    const articleId = await givenArticle();
    const [revision] = await db
      .insert(articleRevisions)
      .values({ articleId, status: "published", finalUrl: URL })
      .returning({ id: articleRevisions.id });
    await db
      .update(articles)
      .set({ currentRevisionId: revision!.id })
      .where(eq(articles.id, articleId));
    return articleId;
  }

  it("refuses rather than queueing a job that would rebuild what was deleted", async () => {
    if (!pool) return;
    const articleId = await givenPublishedArticle();

    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select 1 from spideryarn.articles where id = $1 for update", [articleId]);

      const enqueueing = asOwner(() =>
        enqueue({ slug: "an-article-being-deleted", url: URL, steps: ["fetch"], pump: false }),
      );
      /* Long enough for the shelf lookup to have happened and the lock to be
         waited on. Without this the two never overlap and the test proves
         nothing — see the header. */
      await new Promise((resolve) => setTimeout(resolve, 250));

      /* The delete, from inside the transaction holding the row, so it commits
         in exactly the window between the adoption and the insert. */
      await holder.query("delete from spideryarn.articles where id = $1", [articleId]);
      await holder.query("commit");

      await expect(enqueueing).rejects.toMatchObject({ status: 404 });
    } finally {
      await holder.query("rollback").catch(() => {});
      holder.release();
    }

    /* The forbidden outcome, stated as itself: a queued job for a slug whose
       article has gone is a job whose worker calls `lockOrCreateArticle`. */
    expect(await jobRows()).toHaveLength(0);
    expect(await articleRows()).toHaveLength(0);
  }, 20_000);

  /**
   * **The other direction, and the reason Sol's own fix for F20 was not taken.**
   *
   * Sol proposed `requiresArticle: request.retryOf !== undefined || …` — every
   * retry insists on its article. That is wrong, and this is the case that shows
   * it: an `articles` row is created when the worker opens its draft
   * (`openOrBeginJobDraft` → `lockOrCreateArticle`), **not at enqueue**. So a job
   * stopped or swept while still `queued` never made one, `jobWorthRetrying`
   * offers Retry on it, and under that rule the retry would 404 over an article
   * that was never supposed to exist yet.
   *
   * Paste a URL, press Stop before it starts, press Retry: that is the whole
   * sequence, and it must keep working.
   */
  it("still lets a retry mint for an attempt that never got as far as an article", async () => {
    const failed = await givenJob({ status: "cancelled", url: URL });

    const job = await asOwner(() =>
      enqueue({ slug: SLUG, retryOf: failed, url: URL, steps: ["fetch"], pump: false }),
    );

    expect(job.slug, "a retry keeps the attempt's own name").toBe(SLUG);
    expect(await articleRows(), "and no article had to exist for it").toHaveLength(0);
  });
});

/* ----------------------------- the two races the terminal-job delete left -- */

/**
 * **What is left of the resurrection once the unhurried route is closed** — GPT
 * Sol's F40 and F41, the second round of review on the same plan.
 *
 * Taking the terminal jobs with the article closed the *sequential* way back in:
 * Retry on a month-old failure. It did nothing about the two requests that have
 * **already read** the thing the delete is about to take, and are between that
 * read and their insert. Both of those requests insert with
 * `requiresArticle: false`, correctly — a retry of an attempt that never opened
 * a draft, and a second paste adopting a name from a job still minting, are both
 * requests to *have* an article — so the article lock finds nothing, refuses
 * nothing, and the worker's `lockOrCreateArticle` builds what the reader
 * destroyed.
 *
 * ## How each of these is a race with a stopwatch rather than a hope
 *
 * A third connection holds the `articles` row. That is where `tryEnqueue` stops
 * — after its allocation, which has already read whatever it is about to be
 * wrong about, and before its insert — so the window is entered every time
 * rather than when the scheduler feels like it. `expect(settled).toBe(false)` is
 * the proof it was entered: without it, a test whose enqueue had already
 * finished would go green on a fix it never exercised.
 *
 * The holder then commits **the delete's own two statements from inside its own
 * transaction** — the article's terminal jobs, then the article — so the state
 * the enqueue resumes into is exactly the state `destroy` commits. It is spelled
 * as SQL rather than by calling `destroy`, because `destroy` wants the same row
 * lock the barrier is holding, and a barrier you have to release to let the
 * delete through is not a barrier. That `destroy` really does commit those two
 * statements is what the cases at the top of this file assert.
 *
 * A timing slip fails the two refusals rather than passing them: an enqueue that
 * ran before the holder's delete inserts successfully, and each of those cases
 * asserts a rejection.
 *
 * **The last two cases are the controls**, and they are here rather than
 * elsewhere because a guard is only worth having if it can be shown to let the
 * ordinary thing through: a holder that is really still there, and a holder that
 * finished the way it was meant to. Each was watched red against a plausible
 * mis-statement of the guard — see the plan.
 */
describe("what a delete can take out from under a request already in flight", () => {
  const URL = "https://example.test/a-first-ingest-that-failed";

  /**
   * **F40 — the in-flight Retry.**
   *
   * `retryJob` reads the failed attempt on the pool and then calls `enqueue`;
   * nothing locked that row or required it still to be there. So: read the
   * attempt, delete the article — which takes the attempt with it — and the
   * retry inserts anyway, because an upload retry always mints and a URL retry
   * mints as soon as the shelf no longer holds the address. Which is the case
   * here: the article has no published revision, so `slugForRetry` finds nothing
   * on the shelf and mints the attempt's own name.
   *
   * Driven through `enqueue` with `retryOf` rather than through `retryJob`,
   * which is the same call with `pump: false` — the read `retryJob` does first
   * is the very fact this test is arranging to be stale.
   *
   * **Its positive control is the last case in the block above**, *still lets a
   * retry mint for an attempt that never got as far as an article*: the attempt
   * is there, no article ever existed, and the insert must succeed. Without it a
   * guard that refused every retry would look exactly like this one.
   */
  it("refuses a retry whose attempt the delete took, and queues nothing", async () => {
    if (!pool) return;
    const articleId = await givenArticle();
    const failed = await givenJob({ status: "error", url: URL });

    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select 1 from spideryarn.articles where id = $1 for update", [articleId]);

      const retrying = asOwner(() =>
        enqueue({ slug: SLUG, retryOf: failed, url: URL, steps: ["fetch"], pump: false }),
      );
      /* Both handlers, so this derived promise cannot become an unhandled
         rejection of its own; `retrying` itself is still awaited below. */
      let settled = false;
      void retrying.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(settled, "the retry must still be waiting on the article row").toBe(false);

      await holder.query("delete from spideryarn.jobs where id = $1", [failed]);
      await holder.query("delete from spideryarn.articles where id = $1", [articleId]);
      await holder.query("commit");

      await expect(retrying).rejects.toMatchObject({ status: 404 });
    } finally {
      await holder.query("rollback").catch(() => {});
      holder.release();
    }

    /* The forbidden outcome: a queued job on a destroyed slug is a job whose
       worker calls `lockOrCreateArticle`. */
    expect(await jobRows()).toHaveLength(0);
    expect(await articleRows()).toHaveLength(0);
  }, 20_000);

  /**
   * **F41 — the paste that adopted a name from the queue.**
   *
   * Two pastes of one address seconds apart. The second finds the first still
   * minting and adopts its slug, and that adoption deliberately does not insist
   * on an article, because there may not be one yet. But *"a queue holder was
   * seen"* is a fact about the lookup and nothing later: the holder can publish,
   * finish, and have its article destroyed before the second paste inserts — and
   * then the insert lands on a slug with nothing under it.
   *
   * The holder job is `queued` with the address on it, which is what
   * `inFlightSlugForUrlKey` scans for, and its article has no published revision
   * — so the shelf lookup misses and the adoption really does come from the
   * queue rather than from the shelf. Then, inside the window, it publishes and
   * finishes and the delete takes both.
   *
   * **The positive control is *lets the delete refuse when the job got there
   * first*** above: an adoption whose article is still there inserts, and this
   * guard is only ever asked when the article is absent.
   */
  it("refuses a paste whose queue holder finished and was deleted, and queues nothing", async () => {
    if (!pool) return;
    const articleId = await givenArticle();
    const holderJob = await givenJob({ status: "queued", url: URL });

    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select 1 from spideryarn.articles where id = $1 for update", [articleId]);

      const pasting = asOwner(() =>
        enqueue({ slug: "a-second-paste", url: URL, steps: ["fetch"], pump: false }),
      );
      let settled = false;
      void pasting.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(settled, "the paste must still be waiting on the article row").toBe(false);

      /* The holder publishes and finishes — the transition that makes it no
         longer a holder — and the owner then destroys the article, which takes
         the now-terminal job with it. */
      await holder.query(
        "update spideryarn.jobs set status = 'done', finished_at = now() where id = $1",
        [holderJob],
      );
      await holder.query("delete from spideryarn.jobs where id = $1", [holderJob]);
      await holder.query("delete from spideryarn.articles where id = $1", [articleId]);
      await holder.query("commit");

      await expect(pasting).rejects.toMatchObject({ status: 409 });
    } finally {
      await holder.query("rollback").catch(() => {});
      holder.release();
    }

    expect(await jobRows()).toHaveLength(0);
    expect(await articleRows()).toHaveLength(0);
  }, 20_000);

  /**
   * **The positive control for the case above, and it is the ordinary one.**
   *
   * Two pastes of one address, no article anywhere, and the first is still
   * minting: the second adopts its name and queues behind it. That is what
   * `freeSlug`'s queue branch is *for*, and it is the exact shape the guard is
   * asked about — article absent, holder named — so a guard that refused
   * whenever it was consulted would be indistinguishable from a working one
   * without this.
   */
  it("still lets a second paste queue behind a holder that is really still there", async () => {
    const holderJob = await givenJob({ status: "queued", url: URL });

    const job = await asOwner(() =>
      enqueue({ slug: "a-second-paste", url: URL, steps: ["fetch"], pump: false }),
    );

    expect(job.slug, "it adopts the holder's name rather than minting a second").toBe(SLUG);
    expect(await articleRows(), "and no article had to exist for either of them").toHaveLength(0);
    expect((await jobRows()).map((row) => row.id).sort()).toEqual([holderJob, job.id].sort());
  });

  /**
   * **The second positive control, and the reason the guard is asked only when
   * the article is absent.**
   *
   * Same window as the refusal above and the same holder finishing inside it —
   * but this time it finishes the way it was supposed to, publishing the article
   * on its way out. So the paste that was waiting is now joining an article that
   * is *there*, which is an ordinary shelf adoption in all but provenance, and
   * refusing it would take a legitimate second paste away for no reason.
   *
   * The guard reads nothing but whether the article row is there; the published
   * revision is here because that is what actually puts one there, not because
   * anything looks at it.
   */
  it("still lets the paste in when the holder finished by publishing rather than dying", async () => {
    if (!pool) return;
    const articleId = await givenArticle();
    const holderJob = await givenJob({ status: "queued", url: URL });

    const holder = await pool.connect();
    let job: Job;
    try {
      await holder.query("begin");
      await holder.query("select 1 from spideryarn.articles where id = $1 for update", [articleId]);

      const pasting = asOwner(() =>
        enqueue({ slug: "a-second-paste", url: URL, steps: ["fetch"], pump: false }),
      );
      let settled = false;
      void pasting.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(settled, "the paste must still be waiting on the article row").toBe(false);

      const { rows } = await holder.query<{ id: string }>(
        "insert into spideryarn.article_revisions (article_id, status, final_url) " +
          "values ($1, 'published', $2) returning id",
        [articleId, URL],
      );
      await holder.query("update spideryarn.articles set current_revision_id = $1 where id = $2", [
        rows[0]?.id,
        articleId,
      ]);
      await holder.query(
        "update spideryarn.jobs set status = 'done', finished_at = now() where id = $1",
        [holderJob],
      );
      await holder.query("commit");

      job = await pasting;
    } finally {
      await holder.query("rollback").catch(() => {});
      holder.release();
    }

    expect(job.slug, "it still lands on the article the holder made").toBe(SLUG);
    expect(await articleRows()).toHaveLength(1);
    expect((await jobRows()).map((row) => row.id).sort()).toEqual([holderJob, job.id].sort());
  }, 20_000);
});

/* ------------------------- a finished job that never gave its slot back -- */

/**
 * **The state the code cannot reach and the database permits** — GPT Sol's F42.
 *
 * `deleteTerminalJobs` is safe because every transition into a terminal status
 * settles the job's reservation in the same transaction. That is an argument
 * about this codebase, and the schema does not carry it: `jobs_status` allows
 * `error`, `ingest_events_settled_once` allows both settlement timestamps to
 * stay null, and one `update spideryarn.jobs set status = 'error'` by hand puts
 * the two together. Delete the job then, and the slot is counted against the
 * reader for ever with nothing left to say which job spent it.
 *
 * The fixture writes that state directly rather than running the `UPDATE`,
 * because the row it produces is the same row and the point is what `destroy`
 * does when it finds one.
 *
 * **Refusing rather than settling** is the whole of the fix: choosing to charge
 * or to refund on the strength of a status that is corrupt by hypothesis is a
 * bill nobody asked for in either direction.
 *
 * Its positive control is *leaves the settled reservation, and the usage,
 * exactly where they were* above — the same shape with the slot settled, and it
 * deletes.
 */
describe("a finished job still holding an unsettled slot", () => {
  it("refuses the delete and moves nothing", async () => {
    await givenArticle();
    const reservationId = await givenReservation();
    const jobId = await givenJob({ status: "error", ingestEventId: reservationId });

    const before = await usageFor(OWNER, FREE);
    expect(before.inFlight, "a reservation nobody settled is still in flight").toBe(1);

    await expect(asOwner(() => pgShelfStore.destroy(SLUG))).rejects.toMatchObject({ status: 500 });

    expect(await articleRows()).toHaveLength(1);
    expect(await jobRows()).toEqual([{ id: jobId, status: "error" }]);

    const [reservation] = await getDb()
      .select({ succeededAt: ingestEvents.succeededAt, releasedAt: ingestEvents.releasedAt })
      .from(ingestEvents)
      .where(eq(ingestEvents.id, reservationId));
    expect(reservation, "not settled behind the reader's back either").toEqual({
      succeededAt: null,
      releasedAt: null,
    });
    expect(await usageFor(OWNER, FREE)).toEqual(before);
  });
});
