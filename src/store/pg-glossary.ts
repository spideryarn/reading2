/**
 * **Start again.** Throwing the glossary away so the article can find a new one.
 *
 * One method, and it was the reader's rather than the pipeline's: the glossary
 * panel's *"throw the list away and find a new one"* button, arriving as
 * `DELETE /api/glossary/:slug`. It answered **501 on the deployed app** until
 * 2026-09-03, so every reader who was not a developer on a laptop pressed it and
 * was told no. docs/plans/260903e-glossary-delete-in-postgres.md.
 *
 * **The button went on 2026-09-05 and this did not** — `Foot` in
 * src/web/GlossaryPanel.tsx says why it went, and docs/project/glossary.md
 * § Finding more why the route and both its suites were kept. So this is an
 * **API-only capability** now: no client calls it, but the route is still there
 * and still owner-authenticated, so a `curl` reaches it and so would any future
 * caller. That is why `jobRunning` below says *try again* rather than naming a
 * button — a first draft left it pointing at *Start again*, on the reasoning
 * that nothing could reach it, and that reasoning was wrong. ⟨Sol⟩
 *
 * ## It mutates a published revision, which nothing else here does
 *
 * Every other write in this store opens a draft, fills it in and publishes it —
 * `openOrBeginJobDraft` → `writeArtefacts` → `publishRevisionIn`. This does not,
 * and the exception is deliberate rather than overlooked. Minting a revision to
 * *remove* one JSONB value would copy every `revision_blocks` row of the article
 * to buy nothing a reader could see, and `publishRevision` refuses a revision
 * with no tree and no blocks — so a delete-by-revision would have to carry the
 * whole article forward in order to null one column.
 *
 * ## What it must not touch, and why that looks like an omission
 *
 * **`revision_step_runs` is left exactly as it was**, still saying
 * `glossary: done`. That reads like a bug — a glossary deleted and a run row
 * claiming it is there — and it is not, because `hasArtefacts`
 * ([artifacts-pg.ts](artifacts-pg.ts)) requires *both* a done row **and** every
 * produced kind reading back, and an absent column reads back absent. So `has()`
 * is false, `stepIsDone` is false, and an ordinary run rebuilds the list.
 * Deleting the row as well would be a second write whose only power is to
 * disagree with the first.
 *
 * Measured rather than traced, 2026-09-03, and asserted permanently in
 * [`tests/store-glossary-delete-pg.test.ts`](../../tests/store-glossary-delete-pg.test.ts).
 *
 * ## The 409, which is the one thing a reader can now be told that they could not before
 *
 * Every draft copies the current revision's `glossary` forward, and this delete
 * changes the current revision **in place** — so `articles.current_revision_id`
 * does not move, a draft opened *before* the delete still satisfies
 * `publishRevisionIn`'s exact-base guard, and publishing it writes the copied,
 * non-null glossary back over the top. The reader's deletion is silently undone,
 * by any job at all, since every draft carries every column — and the reader's
 * own retry can be the job that does it, because `sameWork` (src/jobs.ts) hands
 * an existing job back rather than making a second one.
 *
 * So while holding the article lock this refuses if a live job holds a draft for
 * the article. GPT Sol's finding on the plan; the two options that lost were
 * minting a revision (which makes the concurrent job's publish fail, throwing
 * away real model spend to satisfy a button press) and accepting the race.
 *
 * ## Why this file imports no `pg.ts`
 *
 * The same leaf discipline as [pg-visibility.ts](pg-visibility.ts): `pg.ts`
 * imports `glossary.ts` and `arc.ts`, so importing
 * it here risks a cycle and `npm run cycles` is a gate. `ownedSlug`,
 * `requireSlug`, `READ_COMMITTED` and `leaseIsLive` all live in leaves of their
 * own, and the `notFound` below is this file's own three lines rather than
 * `pg.ts`'s.
 */

import { and, eq, isNotNull, or } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articleRevisions, articles, jobs } from "../db/schema.js";
import type { GlossaryStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { READ_COMMITTED } from "./isolation.js";
import { leaseIsLive } from "./job-fence.js";
import { ownedSlug } from "./owned-slug.js";
import { requireSlug } from "./require-slug.js";

/**
 * **404, not 403**, for a slug that is not yours — the same rule and the same
 * sentence as every other owner-filtered lookup. A 403 would confirm the
 * article exists.
 *
 * It falls out of the design rather than being a second decision: `ownedSlug`
 * simply does not match the row. Copied rather than imported from `pg.ts` for
 * the reason the header gives, exactly as `pg-visibility.ts` copies it.
 */
function notFound(slug: string): Error {
  return Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
}

/**
 * **The job the reader is being asked to wait for**, in the words they see.
 *
 * This message reaches the reader verbatim — `useGlossary.ts` § `reset` catches
 * the failed DELETE and shows `err.message` in the panel — so it is written for
 * somebody who pressed a button, not for somebody reading a stack trace. It says
 * what is happening and what to do about it, and nothing about drafts, revisions
 * or leases.
 */
function jobRunning(): Error {
  return Object.assign(
    new Error(
      "This article is being worked on right now, so the glossary cannot be thrown away " +
        "yet — otherwise the job in progress would put the old list back. Wait for it to " +
        "finish, then try again.",
    ),
    { status: 409 },
  );
}

/**
 * **The article row this delete is about to decide on, read and locked**, taking
 * its builder so a test can read the SQL rather than a constant beside it.
 *
 * The same reason `lockedArticleQuery` in [pg-visibility.ts](pg-visibility.ts)
 * takes one, and the same finding behind it: deleting `.for("update")` there
 * left the entire suite green, because a lock's absence is only visible while a
 * race is actually happening. `tests/store-glossary-delete-pg.test.ts` reads
 * this statement instead, and that assertion fires every time.
 *
 * **`for update` because the lock is the whole ordering argument.** It is the
 * same row `openOrBeginJobDraft` takes before minting a draft, so the two are
 * serialised against each other: either the delete gets it and a job opening its
 * draft afterwards copies the nulled column, or the draft gets it and the check
 * below sees the committed pointer and refuses. Without it both can be in flight
 * at once and the job's publish wins.
 *
 * **Through `ownedSlug`, like everything else.** The owner check and the lookup
 * are one clause, so there is no window between "whose is it" and "change it",
 * and no unfiltered read in this file for anybody to reuse without the question.
 */
export function lockedGlossaryArticleQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  slug: string,
) {
  return db
    .select({ id: articles.id, currentRevisionId: articles.currentRevisionId })
    .from(articles)
    .where(ownedSlug(slug))
    .for("update")
    .limit(1);
}

/**
 * **Is a job in a position to put this glossary back?**
 *
 * A job counts when it holds a **draft** of this article and is still able to
 * publish it: queued, or running inside a live lease. Both halves matter.
 *
 * - **An expired-but-unswept running job is excluded**, and cannot publish
 *   anyway — `leaseIsLive` ([job-fence.ts](job-fence.ts)) is the same boundary
 *   that fences every write it could make. Including it would refuse the reader
 *   for as long as nobody swept the row, which is not a wait they could end.
 * - **A claimed job that has not opened its draft yet is missed on purpose**,
 *   and that is safe: the article lock above decides the order either way, so it
 *   either copies the nulled column or arrives after the refusal.
 *
 * `attempt_id is not null` is belt and braces over `jobs_running_is_fenced`,
 * which already refuses a running row without one — a NULL there would fence
 * nothing while looking exactly like a token that does.
 */
function liveJobHoldingADraftQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  articleId: string,
) {
  return db
    .select({ jobId: jobs.id })
    .from(jobs)
    .innerJoin(articleRevisions, eq(articleRevisions.id, jobs.draftRevisionId))
    .where(
      and(
        eq(articleRevisions.articleId, articleId),
        eq(articleRevisions.status, "draft"),
        or(
          eq(jobs.status, "queued"),
          and(eq(jobs.status, "running"), isNotNull(jobs.attemptId), leaseIsLive),
        ),
      ),
    )
    .limit(1);
}

const rawPgGlossaryStore: Pick<GlossaryStore, "deleteGlossary"> = {
  async deleteGlossary(slug: string): Promise<{ deleted: boolean }> {
    /* Before any query, so a pasted title comes back as "that is not a name"
       rather than as "there is no such article". tests/store-slug-guard.test.ts. */
    requireSlug(slug);

    return getDb().transaction(async (tx) => {
      const [row] = await lockedGlossaryArticleQuery(tx, slug);
      if (!row) throw notFound(slug);

      const [held] = await liveJobHoldingADraftQuery(tx, row.id);
      if (held) throw jobRunning();

      /* No revision at all, so no glossary to throw away. Not a 404 — the
         article is there and it has no list, which is the state asked for. */
      if (!row.currentRevisionId) return { deleted: false };

      /* **`glossary is not null` is what makes `deleted` honest**, and it is
         the whole difference between "there was one and now there is not" and
         "there was never one". It matches the filesystem's ENOENT →
         `{ deleted: false }`.

         **`revision_step_runs` is deliberately not touched** — see the header.
         It goes on saying `done`, and `hasArtefacts` answers false anyway
         because the column reads back absent. */
      const result = await tx
        .update(articleRevisions)
        .set({ glossary: null })
        .where(
          and(eq(articleRevisions.id, row.currentRevisionId), isNotNull(articleRevisions.glossary)),
        );

      /* `rowCount === 1`, never `>= 1` and never ignored — the house idiom for a
         conditional UPDATE, and the same reading pg-revisions.ts gives it. The
         `where` names one primary key, so any other number is a bug rather than
         a busier day. */
      return { deleted: result.rowCount === 1 };
    }, READ_COMMITTED);
  },
};

/**
 * Guarded where it is built, not where it is selected — src/store/db-errors.ts.
 *
 * **This file arrived on `dev` on 2026-09-03, hours after the other fifteen
 * moved**, and was wrapped at its selection in index.ts instead — which is the
 * arrangement docs/project/database.md had just stopped describing. Nothing was
 * red, because the exact-list assertion in tests/store-guarded.test.ts catches a
 * store that *stops* being guarded and not one that never was. That file now
 * asks the question from the other end as well.
 */
export const pgGlossaryStore: Pick<GlossaryStore, "deleteGlossary"> = guardDbStore(
  "glossary",
  rawPgGlossaryStore,
);
