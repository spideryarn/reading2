/**
 * **A job that queues the next job**, on the transaction that made it necessary.
 *
 * One function, and it has a file of its own for a structural reason rather than
 * a tidiness one. It used to live in src/store/pg-jobs.ts, which the publication
 * path imports; on 2026-09-07 pg-jobs.ts came to need `markNavLabelsFailedIn`
 * from src/store/pg-revisions.ts — the sweep has to be able to say that a
 * labels job died — and that would have been an import cycle
 * (`pg-revisions` → `pg-jobs` → `pg-revisions`) that `npm run cycles` gates on.
 *
 * **The edge was broken rather than a second one added.** pg-jobs.ts never
 * called `enqueueSuccessorIn`, so moving it here costs that file nothing and
 * leaves the dependency running one way: publication → successor, sweep →
 * revisions. Everything this file imports is a leaf.
 *
 * docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md.
 */

import { and, eq, inArray, not } from "drizzle-orm";

import type { getDb } from "../db/client.js";
import { jobs } from "../db/schema.js";
import { mintId } from "../ids.js";
import { stepLabel } from "../pipeline.js";
import type { OwnerId, StepName } from "../types.js";
import { ACTIVE, workKeyFor } from "./jobs.js";

type Db = ReturnType<typeof getDb>;
/** A transaction, spelled the way src/store/pg-revisions.ts already spells it. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * **What queueing the follow-up actually did**, as three named answers rather
 * than an id-or-null.
 *
 * It was `string | null` until the stage 2c review, and the null was carrying two
 * quite different facts: *somebody has already queued this, all is well* and
 * *somebody has already queued this and it can never finish the revision you have
 * just published*. The second is a state an operator needs to be able to see, and
 * a shared `null` is exactly how it stayed invisible. A union makes the caller
 * decide, and makes the compiler ask.
 */
export type SuccessorOutcome =
  /** A row was inserted. This publication bought the job that finishes it. */
  | { readonly kind: "queued"; readonly jobId: string }
  /**
   * The work was already queued and this publication collapsed onto it — the
   * ordinary de-duplication. That holder owns no draft, so it will pick up
   * whatever the article is serving when it finally claims.
   */
  | { readonly kind: "alreadyQueued"; readonly jobId: string }
  /**
   * The work was already queued, **and that job is working from an earlier
   * base**. It can never finish the revision just published, and nothing else is
   * queued to: the revision keeps its *"still arriving"* sentence. The caller
   * warns after its commit; see the branch that returns this.
   */
  | { readonly kind: "boundToOlderBase"; readonly jobId: string };

/**
 * Queue a follow-up job **on the caller's transaction**, so that whatever made
 * it necessary and the job that answers it become true together.
 *
 * ## Why this is not `enqueueOrGet`
 *
 * `tryEnqueue` (src/store/pg-jobs.ts) opens `const db = getDb()` and inserts on
 * the pool. A publication that enqueued through it would commit the pointer and
 * the job separately, and the gap between them is an article that says its
 * labels are still arriving with nothing anywhere queued to make them.
 *
 * The `Executor = Db | Tx` doctrine in that file is drawn around job
 * *transitions*, and `enqueueOrGet` is pointedly not on that list. The recorded
 * reason is that it takes a **second pooled connection** while
 * `DATABASE_POOL_MAX` is 5 — which is an argument against calling it while
 * holding the billing lock, and **not** an argument against inserting on an
 * executor you already hold. So this is a short insert rather than `tx` threaded
 * through `enqueue`'s three hundred lines. Written down because the next reader
 * will otherwise "fix" it.
 *
 * ## It spends no quota, and that is by omission rather than by a guard
 *
 * There is no `ingestEventId` here and there is no parameter for one. The only
 * durable fact that makes a job chargeable is `jobs.ingest_event_id`
 * (src/db/schema.ts § `ingest_events`), written by `tryEnqueue` from the ticket
 * `withIngestSlot` hands it at the route — and `settleReservation`
 * (src/store/pg-billing.ts) returns on its first line when there is none. So a
 * successor settles nothing on every ending, and the only two ways to charge one
 * by accident are to route it through a request body carrying a `url`, or to
 * copy a parent's `ingestEventId` onto it. Neither is reachable from this
 * signature. tests/publication-enqueues-the-labels-successor.test.ts names both.
 *
 * ## The shape, and why each field is what it is
 *
 * `reservesName: false` and `urlKey: null`, so the row sits outside
 * `jobs_reserved_slug` and `jobs_active_source` and simply queues behind
 * whatever is already on this article. No `profile`: the steps a successor runs
 * take none, and putting one on would give identical work distinct work keys.
 * No `url`: the job is about an article, not an address, and `enqueue`'s
 * `urlForSlug` normalisation is exactly the thing that makes `Job.url` useless
 * for telling free work from paid.
 *
 * Returns a `SuccessorOutcome` — see above for why that is three answers rather
 * than an id or a null. Nothing here drives it: `pump` is a no-op under `VERCEL`
 * and could not be called from inside a transaction anyway. The browser's
 * `jobEngine` drives every queued job the signed-in owner has, from any page —
 * docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md § Who actually
 * runs the successor.
 */
export async function enqueueSuccessorIn(
  tx: Tx,
  successor: { ownerId: OwnerId; slug: string; steps: StepName[] },
): Promise<SuccessorOutcome> {
  const { ownerId, slug, steps } = successor;
  /* **The canonical builder, not a second hashing of the same question.**
     `sameWork` (src/jobs.ts) is the prose specification it satisfies, and
     `tests/jobs.test.ts` holds the two together. No profile, no upload and no
     URL, so this is a constant per step list — which is precisely what makes the
     conflict below the dedupe we want. */
  const workKey = workKeyFor(steps, new Set());

  /**
   * **Two attempts, and the second one is not optimism.**
   *
   * `on conflict do nothing` and the classifying `SELECT` are two statements, and
   * the row that conflicted can leave the active set between them — a Stop
   * settles a *queued* holder terminally in one statement, a sweep ends a lapsed
   * one, and neither needs the article lock this publication is holding. The
   * `SELECT` then finds nothing, which under one attempt is indistinguishable
   * from a conflict that was never the dedupe: a 500 thrown over an ordinary
   * de-duplication whose index is now free. `tryEnqueue` (src/store/pg-jobs.ts)
   * documents exactly this race and answers it by asking again; this does the
   * same. GPT Sol, F3 of the stage 2c review.
   *
   * **A fresh id each time**, because the conflict may have been `jobs_pkey` —
   * re-minting is the only thing that makes a second attempt able to succeed
   * where the first could not.
   *
   * **Bounded at two, and a bound is all it is.** The second attempt closes the
   * race against *one* holder leaving; it is not a proof that a third conflict
   * would have been something else, because two different holders can each arrive
   * and leave across the two insert/read pairs and the throw below would then
   * follow two genuine dedupes. That is vanishingly unlikely and unbounded
   * retrying is worse — this transaction is holding an article lock — so the
   * bound stays and the claim is trimmed to fit it. GPT Sol, G4 of the second
   * stage 2c review.
   */
  for (let attempt = 1; attempt <= 2; attempt++) {
    const inserted = await tx
      .insert(jobs)
      .values({
        id: mintId(),
        ownerId,
        slug,
        steps: steps.map((name) => ({ name, label: stepLabel(name, false), status: "pending" })),
        status: "queued",
        workKey,
        reservesName: false,
        urlKey: null,
        ingestEventId: null,
      })
      /* Broad on purpose, and immediately narrowed by the read below. `on
         conflict do nothing` covers **every** unique index on the table, so the
         insert itself cannot tell the dedupe from anything else; the
         classification is what makes the difference. */
      .onConflictDoNothing()
      .returning({ id: jobs.id });
    const id = inserted[0]?.id;
    if (id) return { kind: "queued", jobId: id };

    const holder = await activeHolder(tx, { ownerId, slug, workKey });
    if (holder) {
      /**
       * **A holder that already owns a draft is working from an earlier base**,
       * and it can never finish this revision: its own publication will be
       * refused by the base-lineage guard, and `markNavLabelsFailedIn` will
       * refuse this newer revision too, because base ≠ current. So this revision
       * keeps its *"Paragraph labels are still arriving"* sentence with nothing
       * queued to make it stop being true.
       *
       * **Said out loud rather than refused**, and that is a decision rather than
       * a shrug. This threw a 409 and rolled the publication back for one day, on
       * the argument that ordinary pipeline publication could never reach it —
       * the article's FIFO order rule keeping every publisher younger than a
       * successor holding a draft. **That argument is false.**
       * `blockedByAnother` (src/store/pg-jobs.ts) orders on `(created_at, id)`
       * and sees only *committed* rows, so a job that took an earlier timestamp
       * and became visible later is invisible to the successor's claim: the
       * successor claims, opens a draft, requeues keeping it, and the
       * now-visible older job publishes straight into the refusal.
       * Cross-instance clock skew reaches the same ordering by a second road.
       * GPT Sol, F1 of the stage 2c review. A failed publication for a paying
       * reader is strictly worse than the gap it would be replacing, and the gap
       * has never been observed.
       *
       * So the caller gets the holder's id back and `logPublication`
       * (src/store/pg-revisions.ts) warns after the commit — the rule this
       * codebase keeps about logging inside a transaction. The state is
       * **audible rather than closed**, and the plan says so rather than
       * claiming a fix.
       */
      return holder.draftRevisionId
        ? { kind: "boundToOlderBase", jobId: holder.id }
        : { kind: "alreadyQueued", jobId: holder.id };
    }
    /* Nothing holds it. Either the holder left between the two statements — try
       once more — or this was never the dedupe, which the second pass proves by
       conflicting again with nothing to show for it. */
  }

  /**
   * **Twice refused with nothing holding it, so it is almost certainly not the
   * de-duplication** — and *almost* is the honest word, for the reason the bound
   * above gives.
   *
   * `on conflict do nothing` covers every unique index on the table and only one
   * of them is the queue's dedupe. Today the unintended one is `jobs_pkey`, which
   * is improbable over a 771-million-value id space — and twice over, with a
   * fresh id each time, is beyond improbable. What this really guards is the
   * future: a unique index somebody adds later would otherwise be absorbed in
   * silence, and publication would commit with no labels job and no complaint.
   * GPT Sol, F3 of the stage 2b review.
   *
   * **`status: 500` is what lets the sentence out**: `guardDbStore` replaces the
   * message of anything without one, so an unmarked error here would be as silent
   * as the swallow it replaces — src/store/db-errors.ts § *Adding a sixth: don't.
   * Give the class a `status` instead.* The message names nothing about the
   * article: no slug, no URL, no title.
   */
  throw Object.assign(
    new Error(
      "Queueing the follow-up job conflicted with a unique index twice, with a fresh id each " +
        "time, and nothing active held this owner, article and work key on either look — so " +
        "this is very unlikely to be the de-duplication. Most likely an id collision or an " +
        "index added since this was written. Either way the follow-up was not queued.",
    ),
    { status: 500 },
  );
}

/**
 * The active row holding `(owner_id, slug, work_key)`, if there is one.
 *
 * **The predicate `jobs_active_work` carries and no looser** — the active
 * statuses, excluding `cancelling` rows (src/db/schema.ts). A re-read that
 * disagreed with the index would answer a question the insert did not ask, which
 * is the mistake `tryEnqueue`'s own comment is written against: *the indexes stay
 * guarantees rather than a signalling channel*.
 */
async function activeHolder(
  tx: Tx,
  conflict: { ownerId: OwnerId; slug: string; workKey: string },
): Promise<{ id: string; draftRevisionId: string | null } | undefined> {
  const [holder] = await tx
    .select({ id: jobs.id, draftRevisionId: jobs.draftRevisionId })
    .from(jobs)
    .where(
      and(
        eq(jobs.ownerId, conflict.ownerId),
        eq(jobs.slug, conflict.slug),
        eq(jobs.workKey, conflict.workKey),
        inArray(jobs.status, ACTIVE),
        not(jobs.cancelling),
      ),
    )
    /* At most one row can satisfy a unique index, so this is a `limit` for the
       planner rather than a choice between candidates. */
    .limit(1);
  return holder;
}
