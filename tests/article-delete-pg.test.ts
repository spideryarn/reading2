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
  status: "queued" | "running" | "done" | "error";
  draftRevisionId?: string;
  ingestEventId?: string;
  /** For a `running` row: how long ago its lease ran out, in ms. Live if absent. */
  leaseExpiredMsAgo?: number;
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
   * A terminal job is inert — the Stage A spike measured that both slug indexes
   * are partial on `('queued','running')`, so a `done` row blocks nothing and
   * the reader can re-add the same URL afterwards. It stays as history, with a
   * slug naming an article that is gone.
   */
  it("deletes anyway when the only job left is finished", async () => {
    await givenArticle();
    const jobId = await givenJob({ status: "done" });

    expect(await asOwner(() => pgShelfStore.destroy(SLUG))).toEqual({ destroyed: SLUG });

    expect(await articleRows()).toHaveLength(0);
    expect(await jobRows()).toEqual([{ id: jobId, status: "done" }]);
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
