# Code review: stage 3 items 3 and 4 of the database move

Adversarial review of built, not-yet-committed code. Verdict SHIP / NO-SHIP / SHIP-WITH-CHANGES
plus specific findings. Plan: `docs/plans/260831b-finish-the-database-move.md` § *Stage 3 — the flip*.

**The bias to attack.** Six of your previous reviews of this plan were NO-SHIP and most findings were
checks that agreed with the bug. Tonight already produced two more of that shape: `db:migrate`
printing `✓ migrations applied` while applying nothing for days, and a probe that wanted zero rows
back and therefore passed when the constraint was missing entirely. **So the question I most want
answered is which of these new guards can actually go red, and under what.**

## Item 3 — a failed forced refresh loses its work and reports success

The fault: published revision R1 exists; a forced job writes new `fetch`, `extract`, `blocks` into a
draft and then fails at `hierarchy`; the failed draft is discarded; the retry re-forces only from the
first *unfinished* step, so its new draft copies R1, the earlier steps skip as current, and the last
step runs over the old article. **The retry reports success and the refresh is silently gone.**

Greg's decision 8 (already made, not open): re-force from the earliest *originally* forced step.

Built: `forceForRetry` returns **every** step the original request forced, rather than only the
earliest. The reason for the whole set rather than the first name: `cascadeForce` refuses to sweep in
a `FORCE_ONLY_WHEN_NAMED` step nobody named, so returning only the first would silently drop a
`tweets` the reader had explicitly asked to redo. **Attack that reasoning** — is the cascade actually
idempotent over the full set, and does `enqueue` recompute the original flags exactly?

## Item 4 — exact-base verification

A draft may only replace the revision it was copied from. `openPgStoreSession` records the base when
the claim opens it; publication compares that with `publishRevisionIn`'s `previousRevisionId` — i.e.
`articles.current_revision_id` read under the article lock one statement before it moves — and throws
`PublishRefused` (409) on a mismatch, rolling back publication, step completion and job ending.

**Three corrections the implementer made to the plan, which I have accepted and want you to check:**

1. The plan points item 4 at `publishAndFinish`. That is the wrong place: `publishingSession` opens
   its draft *lazily, at the moment of publication*, so its base is milliseconds old and the window is
   essentially unhittable. `pgStoreSession` opens the draft when the claim starts and publishes
   minutes later. **So, like item 3, the flip is what makes item 4 real** — the plan presents item 3
   that way and item 4 as an existing hole. The guard went into both paths.
2. The plan says "reads bound to revision R1". That does not describe `pgStoreSession`, whose reads
   bind to the draft (`readsPgArtifacts(ref)`). The invariant built instead is *"the revision this
   draft was copied from is still the one being replaced"*.
3. **Exact-base cannot be exact for a reopened draft.** `openOrBeginJobDraft` answers `basedOn: null`
   on reopen deliberately and there is no `based_on_revision_id` column, so for a reopened draft the
   base is the article's current revision read at reopen — proving only the narrower "nothing
   published while this claim held it". `DraftBase` records which answer is which.
   **Is that narrower guarantee actually sound, or does it admit the very race it is named for?**

## What was watched red

Item 3, against the old code, 4 of 5 cases: `expected [ 'toc' ] to deeply equal [ 'fetch',
'extract', 'blocks', …(2) ]` and three similar. The case that stayed green throughout is the money
guard: an unforced failure still forces nothing.

Item 4, by deleting the `refuseIfBaseMoved` call: `promise resolved "{ kind: 'ended', … }" instead of
rejecting`; and with the rejection assertion let through so consequences are reached, `the job's draft
was published over R2`, `R2's work is gone`, and `expected 'published' to be 'draft'`. The positive
control passed with and without the guard, so the guard refuses the race rather than publication.

## Specific questions

1. **`PublishRefused` is a 409 so `guardDbStore` passes it through.** Is a 409 right, and does the
   rollback actually cover publication, step completion and job ending together — or can a refusal
   leave a step marked done?
2. **What happens to the job after a refusal?** It has done real work that is now unpublishable.
   Does it retry forever, and does item 3's change interact badly with that?
3. **Item 3 makes a failed refresh re-run from the top, so a PDF transcription is paid twice.** That
   cost is accepted (decision 8). Is there a path where it is paid *repeatedly* rather than twice?
4. **A hazard already observed tonight**, which any test here must survive: `REVISION_CARRY_POLICY`
   is a denylist, so blocks and stamped HTML carry into a draft from the previous revision, and
   `assertProduced` reads the carried copy back. With `commit` writing nothing at all, a job still
   reported `done: true` and published. **Do these two new tests actually escape that, or do they
   pass over it?**
5. Anything overclaimed in the comments or docs.

## The diff

```diff
diff --git a/docs/project/database.md b/docs/project/database.md
index 6d2e146..cb16497 100644
--- a/docs/project/database.md
+++ b/docs/project/database.md
@@ -207,6 +207,16 @@ publishes it, in one transaction with the job's own finish
 Before that the ingest produced files on disk and an empty draft revision that `publishRevision`
 refused, and the reader's shelf stayed empty.
 
+**A draft may only replace the revision it was copied from.** `beginDraftIn` copies whatever is
+published when the draft opens, and the job then runs for minutes; if something else publishes in
+between, moving the pointer to that draft buries work nobody meant to lose, and every check involved
+reports success. So the publication compares the base it recorded when the draft opened with the
+revision it is about to replace, and refuses — `refuseIfBaseMoved` in
+[`src/store/pg-session.ts`](../../src/store/pg-session.ts), whose `DraftBase` says how exact each
+answer is and why a reopened draft's is weaker. It is exact for the draft a claim minted, which is
+the case that matters once the pipeline commits through Postgres
+([260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md) § Stage 3).
+
 That is a carry-across, not the end state: an ingest still needs a writable disk for the length of
 the job, so the host question is unchanged and only the *publication* has moved. The plan for the
 other half — stages that return their products instead of writing files — is
diff --git a/docs/project/ingest-queue.md b/docs/project/ingest-queue.md
index 616770e..928c859 100644
--- a/docs/project/ingest-queue.md
+++ b/docs/project/ingest-queue.md
@@ -807,10 +807,10 @@ marked, which really is worth another go. It is not because a wasted click is ch
 retry costs minutes of pipeline and another billed model call, which is a good deal worse than the
 same mistake on a chat message.
 
-**What makes a failure permanent is Retry's own shape.** `forceForRetry` forces from the first step
-that did not finish, so **a retry never re-runs a step that succeeded**. A stage that failed while
-reading an artefact an earlier step wrote will read that identical artefact again. That is what
-separates the two lists:
+**What makes a failure permanent is Retry's own shape.** For an ordinary job `forceForRetry` forces
+nothing, so **a retry never re-runs a step that succeeded**. A stage that failed while reading an
+artefact an earlier step wrote will read that identical artefact again. That is what separates the
+two lists:
 
 | Cannot come out differently | Might |
 |---|---|
@@ -825,6 +825,15 @@ Model-output validation failures are in the right-hand column on purpose. The ne
 draw, and the whole reason those checks are loud is that the model does occasionally get it right on
 the second attempt.
 
+**A *refresh* is the exception, and since 2026-08-31 it re-runs from the top.** A forced job's steps
+finish into a **draft**, and a failure throws that draft away — so "this step already succeeded" is a
+statement about a revision the retry cannot see, and honouring it published the old article under a
+row of green ticks. `forceForRetry` now re-forces everything the original request forced (Greg's
+decision 8; [260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md)
+§ *The fourth fault*). The cost is deliberate: a refresh that dies late re-fetches, re-extracts and
+pays for a PDF transcription a second time. So the left-hand column above is about an ordinary
+retry — a refresh really does go back to the publisher.
+
 **Truncation is the one entry that is not certain, and it is worth being exact about why.**
 `TooLongForOnePass` is arithmetic: the same block count gives the same estimate for ever. Running
 past `max_tokens` mid-answer is not — adaptive output varies between calls, and what we have is two
diff --git a/src/jobs.ts b/src/jobs.ts
index 98d3e3d..40abeaa 100644
--- a/src/jobs.ts
+++ b/src/jobs.ts
@@ -138,7 +138,7 @@ const aborts = new Map<string, AbortController>();
  * numbers, so the next person to raise one cannot forget the other.
  *
  * **Why 420s.** Measured per-article step totals from `data/_ai-calls.jsonl`:
- * `toc` 324.0s over three calls, `summarise` 240.3s over ten. Both exceed the
+ * `hierarchy` 324.0s over three calls, `summarise` 240.3s over ten. Both exceed the
  * 220s deadline these constants used to give, so a long step could not complete
  * through the job path **on any machine** — it only ever succeeded via the CLI,
  * which takes no lease. The deadline is bounded above too: the route loop must
@@ -174,7 +174,7 @@ const aborts = new Map<string, AbortController>();
  *
  * 420s was right for the one-step-per-request shape this replaces, where every
  * step got a fresh deadline. Under a claim that walks the whole job it is a
- * per-step constraint in a per-claim world: `toc` alone at 320.4s would have
+ * per-step constraint in a per-claim world: `hierarchy` alone at 320.4s would have
  * eaten four fifths of it, and the ordinary article would have aborted four
  * fifths of the way through the one step nobody can afford to repeat.
  */
@@ -261,7 +261,7 @@ export const STEP_BUDGET_MS: Record<StepName, number> = {
   /* MEASURED 2026-08-30, the worst in data/_ai-calls.jsonl: one call, so its
      sum and its wall clock agree and no grouping argument applies. This is the
      number the whole budget turns on, and `LEASE_MS` is sized around it. */
-  toc: 320_400,
+  hierarchy: 320_400,
   /* Its own wall-clock cap rather than a measurement — `ASSETS_BUDGET_MS` in
      src/collect-assets.ts, which the step enforces on itself. Measured cost on
      the corpus's worst article (10 images) is 7.1s; the cap is there for a
@@ -324,7 +324,7 @@ function markCancelled(job: Job, message?: string): void {
  * they arrived in.
  *
  * Sorting matters more than it looks. The steps are a chain — each consumes the
- * artefact the one before it wrote — so `["arc", "toc"]` run as asked would
+ * artefact the one before it wrote — so `["arc", "hierarchy"]` run as asked would
  * build the arc from the previous tree and then replace that tree. Both steps
  * would report success and the arc would describe an article nobody is reading.
  */
@@ -413,7 +413,7 @@ function newStep(name: StepName, force: boolean, upload: boolean): JobStep {
  * **This is the one thing advance has to remember rather than derive**, and it
  * is worth naming why, because the rule everywhere else is the opposite (see
  * `advanceJob`). "Has this step's output been rebuilt since the reader asked
- * for it to be" is not a question the artefacts can answer — a forced `toc`
+ * for it to be" is not a question the artefacts can answer — a forced `hierarchy`
  * writes a `tree.json` that looks exactly like the one it replaced. The job
  * record is the only account of it there is.
  */
@@ -1420,7 +1420,7 @@ async function walkClaim(
        * be billed for them.
        *
        * The cost is that Stop is only honoured at a step boundary — a reader
-       * stopping mid-`toc` waits for `toc`. Said out loud in
+       * stopping mid-`hierarchy` waits for `hierarchy`. Said out loud in
        * docs/plans/260830d-v1-imports-on-vercel.md § Risks rather than discovered.
        */
       const noted = await note();
@@ -2062,13 +2062,12 @@ export async function cancelJob(id: string): Promise<Job | null> {
  * keeping, and overwriting it would erase the only evidence at exactly the
  * moment somebody is trying to work out what happened.
  *
- * **Force is recomputed, not copied.** A refresh forces all five steps, so
- * copying the flags across would make Retry re-fetch, re-extract and re-split
- * an article whose first three stages had already succeeded — and pay for the
- * model call again — which is the opposite of what Retry says it does. What
- * carries over is the *reason* those steps were forced, which only still
- * applies to the ones that have not run yet: force from the first step that did
- * not finish, and let `cascadeForce` take it from there.
+ * **Force is recomputed, not copied**, and since 2026-08-31 the recomputation
+ * gives a forced job its whole force back. An ordinary failure forces nothing —
+ * the steps that succeeded are still good. A *refresh* forces again everything
+ * it forced the first time, because in Postgres those steps' work went into a
+ * draft that the failure threw away: see `forceForRetry` below, which is where
+ * the reasoning and its cost are written down.
  */
 export async function retryJob(id: string): Promise<Job | null> {
   /* Somebody else's is `null`, as a missing one is — and this one spends money,
@@ -2089,19 +2088,39 @@ export async function retryJob(id: string): Promise<Job | null> {
 }
 
 /**
- * What a retry should force, given how far the original got.
- *
- * Nothing, for an ordinary failure — the steps that succeeded are still good,
- * and skipping them is the whole point of Retry. Something only when the
- * original was forced, and then only from the first step that did not finish:
- * a refresh that died during `toc` has already re-fetched and re-extracted, and
- * making Retry do all of that again is the opposite of picking up where it
- * stopped. `cascadeForce` takes it from there.
+ * What a retry should force, given what the original forced.
+ *
+ * **Nothing, for an ordinary failure.** No step carried a force flag, so the
+ * steps that succeeded are still good and skipping them is the whole point of
+ * Retry. That half has never changed and is where the money is.
+ *
+ * **Everything the original forced, for a refresh** — from the earliest of them,
+ * whatever happened afterwards. This said *"only from the first step that did
+ * not finish"* until 2026-08-31, and that was the fourth fault of
+ * docs/plans/260831b-finish-the-database-move.md: once the pipeline commits
+ * through Postgres, the three steps that "finished" wrote into a **draft**, the
+ * failure discarded that draft, and the retry's new draft is copied from the
+ * revision the reader is still on. So the finished steps find last week's
+ * artefacts current, skip, and `hierarchy` runs over the old article — a refresh
+ * silently gone, under a row of green ticks (docs/reusable/silent-success.md).
+ * `tests/retry-after-a-failed-refresh.test.ts` has the sequence in full.
+ *
+ * **Greg's decision 8: a failed refresh starts over.** The alternative — keeping
+ * the failed draft so a retry can adopt its completed work — is written up in
+ * that plan's § *Appendix: someday maybe*. The cost of this answer is stated
+ * rather than hidden: a refresh that dies at `hierarchy` pays for a PDF transcription
+ * a second time, and the per-chunk checkpoints that would prevent it are written
+ * to a job-scoped `/tmp` no later job can see (landing D2).
+ *
+ * The whole forced set rather than only its first member, because `cascadeForce`
+ * cannot always reconstruct the rest: it refuses to sweep in a step in
+ * `FORCE_ONLY_WHEN_NAMED` (src/pipeline.ts) that nobody named, so a `tweets` the
+ * reader explicitly asked to redo would be dropped. Handing back exactly what
+ * was forced makes the retry ask for exactly what the original asked for; the
+ * cascade is idempotent over that set, so `enqueue` recomputes the same flags.
  */
 export function forceForRetry(steps: JobStep[]): StepName[] {
-  if (!steps.some((s) => s.force)) return [];
-  const unfinished = steps.find((s) => s.status !== "done" && s.status !== "skipped");
-  return unfinished ? [unfinished.name] : [];
+  return steps.filter((s) => s.force).map((s) => s.name);
 }
 
 /**
diff --git a/src/store/pg-session.ts b/src/store/pg-session.ts
index 617b9be..82115b5 100644
--- a/src/store/pg-session.ts
+++ b/src/store/pg-session.ts
@@ -85,7 +85,7 @@
 import { and, eq } from "drizzle-orm";
 
 import { getDb } from "../db/client.js";
-import { jobs as jobsTable } from "../db/schema.js";
+import { articles, jobs as jobsTable } from "../db/schema.js";
 import { assertProduced } from "../pipeline.js";
 import type { StepName } from "../types.js";
 import {
@@ -99,6 +99,7 @@ import type { JobEnding } from "./jobs.js";
 import { finishIn, releaseStepIn } from "./pg-jobs.js";
 import {
   NotTheLiveAttempt,
+  PublishRefused,
   failRevisionIn,
   finishStepRun,
   lockOrCreateArticle,
@@ -106,6 +107,7 @@ import {
   logPublication,
   publishRevisionIn,
   openOrBeginJobDraft,
+  type OpenDraftResult,
   type PublishRevisionResult,
 } from "./pg-revisions.js";
 import {
@@ -138,9 +140,114 @@ interface Announcement {
   readonly failed?: { readonly revisionId: string; readonly reason: string; readonly changed: number | null };
 }
 
+/**
+ * **The revision this draft was copied from** — the base a publication may
+ * replace, and nothing else.
+ *
+ * `beginDraftIn` copies whichever revision is current at the moment the draft is
+ * minted, and then the job runs for minutes. If something publishes this article
+ * in the meantime, the draft's blocks, columns and step runs describe the *old*
+ * article, and publishing it moves `articles.current_revision_id` back over work
+ * nobody asked to lose — silently, because `publishRevisionIn` checks the
+ * revision's article, its status and its tree, and never asks what it was based
+ * on. That is stage 3 item 4 of docs/plans/260831b-finish-the-database-move.md,
+ * carried forward through five reviews since GPT Sol's first one.
+ *
+ * ## `how` is here because the three answers are not equally strong
+ *
+ * - **`minted`** — this claim created the draft, so `beginDraftIn` handed back
+ *   the id it actually copied. Exact.
+ * - **`reopened`** — this claim found a draft an *earlier request of the same
+ *   job* had minted, and `openOrBeginJobDraft` deliberately answers `null` for
+ *   its lineage ("unknown from here, and `null` would be a lie"). So this is the
+ *   article's current revision read at reopen, which is the true base unless
+ *   something published between the mint and the reopen. What it then proves is
+ *   narrower and still worth having: **nothing published this article while this
+ *   claim held it.**
+ * - **`unknown`** — nobody could answer, and the check is skipped. It carries a
+ *   `why` because a guard that turns itself off has to say when, and the one
+ *   caller is named there.
+ *
+ * What would make the last two exact is a `based_on_revision_id` column on the
+ * revision — named in `REVISION_CARRY_POLICY`'s comment (src/store/pg.ts) as a
+ * column that would be harmful to *carry*, and which does not exist. Adding it
+ * is a migration, so it is not this piece of work; `articleHasPublishedBlocks`
+ * in src/store/artifacts-pg.ts reaches the same conclusion from the other end.
+ * In practice the gap is small: `jobs_active_slug` allows one active job per
+ * article, so between a mint and a reopen of the same job the only things that
+ * can publish are `db:import` and a hand-run `publishRevision`.
+ */
+export type DraftBase =
+  | {
+      readonly how: "minted" | "reopened";
+      /** The revision the draft was copied from — `null` for an article's first. */
+      readonly revisionId: string | null;
+    }
+  | { readonly how: "unknown"; readonly why: string };
+
+/**
+ * What `openOrBeginJobDraft` just answered, read as a base.
+ *
+ * A second statement rather than a wider return from that function, because the
+ * reopen branch has nothing to say about lineage and inventing something there
+ * would put the guess where callers cannot see it. Here it is one line above the
+ * session that uses it.
+ */
+export async function draftBaseOf(draft: OpenDraftResult, db: Db): Promise<DraftBase> {
+  if (draft.created) return { how: "minted", revisionId: draft.basedOn };
+  const [row] = await db
+    .select({ current: articles.currentRevisionId })
+    .from(articles)
+    .where(eq(articles.id, draft.articleId))
+    .limit(1);
+  return { how: "reopened", revisionId: row?.current ?? null };
+}
+
+/**
+ * Refuse a publication that would bury a revision this draft never saw.
+ *
+ * Called **inside** the publishing transaction, with the pointer
+ * `publishRevisionIn` just moved off (`previousRevisionId`, read under the
+ * article lock). The throw rolls the publication, the step completion and the
+ * job's finish back with it, so nothing is left half-done and the job records a
+ * failure a person can act on.
+ *
+ * `PublishRefused` rather than a plain `Error`, for the reason
+ * src/store/publish-session.ts gives about the other refusal on this path:
+ * `guardDbStore` scrubs anything without a numeric `status`, and this is a 409 —
+ * a draft not fit to publish, not a server fault. No article text in the
+ * message, only revision ids (docs/project/logging.md).
+ */
+export function refuseIfBaseMoved(args: {
+  readonly slug: string;
+  readonly revisionId: string;
+  readonly base: DraftBase;
+  readonly publishedOver: string | null;
+}): void {
+  /* The one way past this guard, and it is a value a caller had to construct on
+     purpose rather than a default. See `DraftBase`. */
+  if (args.base.how === "unknown") return;
+  if (args.base.revisionId === args.publishedOver) return;
+  throw new PublishRefused(args.slug, [
+    `this draft (${args.revisionId}) was copied from revision ${args.base.revisionId ?? "none"} ` +
+      `(${args.base.how}), but the article is now serving ${args.publishedOver ?? "none"} — ` +
+      "something else published while this job ran, and publishing now would discard it. " +
+      "Nothing was published; run the job again against what is there.",
+  ]);
+}
+
 export interface PgStoreSessionOptions {
   /** The draft this claim owns — `openOrBeginJobDraft`'s answer, plus the claim. */
   readonly ref: JobDraftRef;
+  /**
+   * The revision the draft was copied from, so the publication can check that it
+   * is still the one being replaced. See `DraftBase`.
+   *
+   * **Required, and there is no "do not check" value.** An optional base would
+   * be a guard that is off by default in exactly the callers that forgot it, and
+   * this one has been forgotten for five reviews already.
+   */
+  readonly base: DraftBase;
   /** Overridable so a test can drive two sessions down one connection. */
   readonly db?: Db;
 }
@@ -166,6 +273,10 @@ export async function openPgStoreSession(opts: {
       jobId: opts.job.id,
       attemptId: opts.job.attemptId,
     },
+    /* Read now rather than at publication, which is the whole point: the
+       question is what this draft was made from, and by the time it publishes
+       the article may be serving something else. */
+    base: await draftBaseOf(draft, getDb()),
   });
 }
 
@@ -187,7 +298,7 @@ export async function openPgStoreSession(opts: {
  * rather than collapsed to `unknown`.
  */
 export function pgStoreSession(options: PgStoreSessionOptions): StoreSession {
-  const { ref } = options;
+  const { ref, base } = options;
   const db = options.db ?? getDb();
   const job = { id: ref.jobId, attemptId: ref.attemptId };
 
@@ -290,7 +401,7 @@ export function pgStoreSession(options: PgStoreSessionOptions): StoreSession {
      * It is only read on the failing branch, and there is no case where it
      * arrives with a `done` ending: the all-skipped claim that ends `done`
      * through `settleJob` never begins a step at all. Worth knowing if that ever
-     * changes — the publication gate checks the `toc` run row and no other, so a
+     * changes — the publication gate checks the `hierarchy` run row and no other, so a
      * revision published with some *other* step still `running` would not be
      * refused by it.
      */
@@ -353,7 +464,19 @@ export function pgStoreSession(options: PgStoreSessionOptions): StoreSession {
          a silent success, in the path built to prevent them.
          `publishRevisionIn` fences on the live attempt and clears the draft
          pointer as it goes. */
-      announce = { published: await publishRevisionIn(tx, { slug, revisionId: ref.revisionId, job }) };
+      const published = await publishRevisionIn(tx, { slug, revisionId: ref.revisionId, job });
+      /* **After the publication, and inside its transaction.**
+         `previousRevisionId` is `articles.current_revision_id` read under the
+         article lock a statement before it moved, which is the only reading of
+         it that cannot be stale. A mismatch throws and takes the whole
+         transaction — publication, step, job ending — back with it. */
+      refuseIfBaseMoved({
+        slug,
+        revisionId: ref.revisionId,
+        base,
+        publishedOver: published.previousRevisionId,
+      });
+      announce = { published };
     } else {
       /* **The step that was begun and never finished is marked `error` first.**
          A stage that threw, or that the reader stopped, leaves the row
diff --git a/src/store/publish-session.ts b/src/store/publish-session.ts
index 105acf0..69de888 100644
--- a/src/store/publish-session.ts
+++ b/src/store/publish-session.ts
@@ -98,6 +98,7 @@ import {
   openOrBeginJobDraft,
   publishRevisionIn,
 } from "./pg-revisions.js";
+import { type DraftBase, refuseIfBaseMoved } from "./pg-session.js";
 import type { JobEndTransition, JobTransition, StoreSession } from "./session.js";
 
 /**
@@ -162,6 +163,26 @@ export function publishingSession(
    */
   const publishAndFinish = async (ending: JobEnding): Promise<Job> => {
     const draft = await openOrBeginJobDraft({ slug, job });
+    /* **What this draft was copied from**, read before the transaction that
+       replaces it. See `DraftBase` in pg-session.ts.
+
+       **Worth far less here than it is there, and saying so is the point.** This
+       decorator opens its draft lazily, at the moment of publication, so the
+       base is a few milliseconds old and almost nothing can have moved in
+       between. `pgStoreSession` opens its draft when the claim starts and
+       publishes minutes later, which is the window the guard is really for —
+       stage 3 item 4 of docs/plans/260831b-finish-the-database-move.md, and it
+       becomes reachable at the flip rather than before it.
+
+       So the reopen branch is not resolved here at all. `pgStoreSession` reads
+       the article's current revision for it, which is worth a query there
+       because the draft may be minutes old; here it would be a query to compare
+       a value with itself, and the case it stands for — a draft this job opened
+       on an earlier claim and could not publish — is exactly the one where the
+       answer is not knowable without the column that does not exist. */
+    const base: DraftBase = draft.created
+      ? { how: "minted", revisionId: draft.basedOn }
+      : { how: "unknown", why: "a draft reopened by publishingSession records no lineage" };
     const ref: JobDraftRef = {
       slug,
       articleId: draft.articleId,
@@ -217,6 +238,20 @@ export function publishingSession(
         /* Fences on the live attempt and clears `jobs.draft_revision_id` as it
            goes, so no pointer is left for the sweeper to treat as ownership. */
         published = await publishRevisionIn(tx, { slug, revisionId: ref.revisionId, job });
+        /* **The base has to still be the base.** The article identity check
+           above catches a slug re-created under us; this catches the commoner
+           thing, which is a *revision* published under us — by `db:import`, by
+           a hand-run `publishRevision`, or by another job — between this draft
+           being copied and this statement. Without it the copy quietly wins and
+           the other publication is gone. Stage 3 item 4 of
+           docs/plans/260831b-finish-the-database-move.md. The throw rolls the
+           publication and `finishIn` back together. */
+        refuseIfBaseMoved({
+          slug,
+          revisionId: ref.revisionId,
+          base,
+          publishedOver: published.previousRevisionId,
+        });
 
         /* **Last, and inside the same transaction as the publication.** This is
            Sol's critical 2: `importArticle` committed its own transaction before
diff --git a/tests/jobs.test.ts b/tests/jobs.test.ts
index 0314881..8ebc3ec 100644
--- a/tests/jobs.test.ts
+++ b/tests/jobs.test.ts
@@ -84,7 +84,7 @@ describe("the pipeline", () => {
   });
 
   it("recognises only real step names", () => {
-    expect(isStepName("toc")).toBe(true);
+    expect(isStepName("hierarchy")).toBe(true);
     expect(isStepName("summarise")).toBe(false);
     expect(isStepName("")).toBe(false);
     expect(isStepName(null)).toBe(false);
@@ -122,25 +122,25 @@ describe("the pipeline", () => {
   it("sorts `tweets` after the steps it reads", () => {
     // Order is about running, not about forcing — `tweets` is exempt from the
     // force-cascade (below) but it still has to run after the stages whose
-    // artefacts it reads, which are `blocks` and `toc`. A name missing from
+    // artefacts it reads, which are `blocks` and `hierarchy`. A name missing from
     // STEP_ORDER sorts to the FRONT, because `indexOf` gives it -1, so
-    // `{ steps: ["toc", "tweets"] }` would have written the thread from the
+    // `{ steps: ["hierarchy", "tweets"] }` would have written the thread from the
     // previous tree and then replaced that tree.
-    expect(orderSteps(["tweets", "toc", "blocks"])).toEqual(["blocks", "toc", "tweets"]);
+    expect(orderSteps(["tweets", "hierarchy", "blocks"])).toEqual(["blocks", "hierarchy", "tweets"]);
   });
 });
 
 describe("orderSteps", () => {
   it("sorts into pipeline order whatever order they arrived in", () => {
     // The steps are a chain: each consumes what the one before it wrote. Run
-    // ["arc", "toc"] as asked and the arc is built from the previous tree,
+    // ["arc", "hierarchy"] as asked and the arc is built from the previous tree,
     // which is then replaced — two successes and an arc describing an article
     // nobody is reading.
-    expect(orderSteps(["arc", "toc", "fetch"])).toEqual(["fetch", "toc", "arc"]);
+    expect(orderSteps(["arc", "hierarchy", "fetch"])).toEqual(["fetch", "hierarchy", "arc"]);
   });
 
   it("de-duplicates", () => {
-    expect(orderSteps(["toc", "toc", "toc"])).toEqual(["toc"]);
+    expect(orderSteps(["hierarchy", "hierarchy", "hierarchy"])).toEqual(["hierarchy"]);
   });
 
   it("leaves an already-ordered list alone", () => {
@@ -158,7 +158,7 @@ describe("cascadeForce", () => {
       "fetch",
       "extract",
       "blocks",
-      "toc",
+      "hierarchy",
       /* `assets` IS swept in, unlike the four steps after `arc`, and the reason
          is the one the cascade encodes: a refresh from source is a request to
          get this article again, and the article's figures are part of it.
@@ -176,7 +176,7 @@ describe("cascadeForce", () => {
        it has always been the other way in, and that is unchanged. */
     expect([...cascadeForce([...STEP_ORDER], new Set(["arc", "blocks"]))]).toEqual([
       "blocks",
-      "toc",
+      "hierarchy",
       "assets",
       "arc",
     ]);
@@ -187,17 +187,17 @@ describe("cascadeForce", () => {
   });
 
   it("cascades within the job's own steps, not the whole pipeline", () => {
-    /* A job of {toc, arc} that forces toc must not invent a fetch step nobody
+    /* A job of {hierarchy, arc} that forces hierarchy must not invent a fetch step nobody
        asked for. It no longer forces `arc` either: since 2026-08-29 `arc` can
        tell for itself whether it is current, so it is in FORCE_ONLY_WHEN_NAMED
        and an unforced run re-does it exactly when its inputs have moved. */
-    expect([...cascadeForce(["toc", "arc"], new Set(["toc"]))]).toEqual(["toc"]);
+    expect([...cascadeForce(["hierarchy", "arc"], new Set(["hierarchy"]))]).toEqual(["hierarchy"]);
     // Named, it is forced like anything else.
-    expect([...cascadeForce(["toc", "arc"], new Set(["toc", "arc"]))]).toEqual(["toc", "arc"]);
+    expect([...cascadeForce(["hierarchy", "arc"], new Set(["hierarchy", "arc"]))]).toEqual(["hierarchy", "arc"]);
   });
 
   it("ignores a forced step the job isn't running", () => {
-    expect([...cascadeForce(["toc", "arc"], new Set(["fetch"]))]).toEqual([]);
+    expect([...cascadeForce(["hierarchy", "arc"], new Set(["fetch"]))]).toEqual([]);
   });
 
   it("does not sweep `tweets` in by position", () => {
@@ -210,7 +210,7 @@ describe("cascadeForce", () => {
     expect([...cascadeForce([...STEP_ORDER], new Set(["arc"]))]).toEqual(["arc"]);
     /* `arc` is absent here for the same reason `tweets` is, as of 2026-08-29 —
        both can now judge their own freshness. */
-    expect([...cascadeForce(["toc", "arc", "tweets"], new Set(["toc"]))]).toEqual(["toc"]);
+    expect([...cascadeForce(["hierarchy", "arc", "tweets"], new Set(["hierarchy"]))]).toEqual(["hierarchy"]);
   });
 
   it("does not sweep `glossary` in by position either, and this one appends", () => {
@@ -222,7 +222,7 @@ describe("cascadeForce", () => {
        make the reader's glossary longer. */
     expect(FORCE_ONLY_WHEN_NAMED.has("glossary")).toBe(true);
     expect([...cascadeForce([...STEP_ORDER], new Set(["fetch"]))]).not.toContain("glossary");
-    expect([...cascadeForce(["toc", "glossary"], new Set(["toc"]))]).toEqual(["toc"]);
+    expect([...cascadeForce(["hierarchy", "glossary"], new Set(["hierarchy"]))]).toEqual(["hierarchy"]);
   });
 
   it("still forces `glossary` when it is named — that is the Find more button", () => {
@@ -236,8 +236,8 @@ describe("cascadeForce", () => {
     /* `arc` is not here, and its absence is the same rule doing its job: it left
        the positional cascade on 2026-08-29 and was not named. `assets` stays,
        because it never left. */
-    expect([...cascadeForce([...STEP_ORDER], new Set(["toc", "tweets"]))]).toEqual([
-      "toc",
+    expect([...cascadeForce([...STEP_ORDER], new Set(["hierarchy", "tweets"]))]).toEqual([
+      "hierarchy",
       "assets",
       "tweets",
     ]);
@@ -253,7 +253,7 @@ describe("cascadeForce", () => {
 
        Worth knowing that position was never quite the signal it looked like:
        `cascadeForce` only names steps already in the job, so a forced
-       `{ steps: ["toc"] }` never reached `arc` even then, and the stale arc that
+       `{ steps: ["hierarchy"] }` never reached `arc` even then, and the stale arc that
        resulted lost entries in silence. The stamp is what actually closed that.
        docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 2.1. */
     expect(FORCE_ONLY_WHEN_NAMED.has("arc")).toBe(true);
@@ -263,8 +263,8 @@ describe("cascadeForce", () => {
        one thing the stamp cannot answer. A rotated imgix signature changes
        nothing about the blocks. */
     expect(FORCE_ONLY_WHEN_NAMED.has("assets")).toBe(false);
-    expect([...cascadeForce([...STEP_ORDER], new Set(["toc"]))]).toEqual([
-      "toc",
+    expect([...cascadeForce([...STEP_ORDER], new Set(["hierarchy"]))]).toEqual([
+      "hierarchy",
       "assets",
     ]);
   });
@@ -283,29 +283,45 @@ describe("forceForRetry", () => {
     ).toEqual([]);
   });
 
-  it("does not make a retry re-do the stages a refresh already redid", () => {
-    // A refresh forces all five. Copying those flags across meant Retry
-    // re-fetched, re-extracted and re-split an article whose first three
-    // stages had just succeeded — and paid for the model call again.
+  /* **These three asserted the opposite until 2026-08-31**, and the reason they
+     gave was the money: a refresh forces all five steps, so re-forcing them on
+     Retry re-fetches, re-extracts and re-splits an article whose first three
+     stages had just succeeded, and pays for the model call again.
+
+     That reasoning was right about the filesystem and wrong about Postgres,
+     which is the fourth fault of docs/plans/260831b-finish-the-database-move.md.
+     The steps that "succeeded" wrote into a draft; the failure discarded it; the
+     retry's draft is copied from the revision the reader is still on. So the
+     thrift was buying nothing and losing the refresh in silence. Greg's decision
+     8: a failed refresh starts over. The narrative fixture is
+     tests/retry-after-a-failed-refresh.test.ts; these three are the shapes. */
+  it("re-forces what the refresh forced, back to the earliest of them", () => {
     expect(
       forceForRetry([
         forced("fetch", "done"),
         forced("extract", "done"),
         forced("blocks", "done"),
-        forced("toc", "error"),
+        forced("hierarchy", "error"),
         forced("arc", "pending"),
       ]),
-    ).toEqual(["toc"]);
+    ).toEqual(["fetch", "extract", "blocks", "hierarchy", "arc"]);
   });
 
   it("forces from the front when a forced job failed at its first step", () => {
     expect(forceForRetry([forced("fetch", "error"), forced("extract", "pending")])).toEqual([
       "fetch",
+      "extract",
     ]);
   });
 
-  it("forces nothing when every step finished", () => {
-    expect(forceForRetry([forced("fetch", "done"), forced("extract", "skipped")])).toEqual([]);
+  it("re-forces even when every step finished, because the publication did not", () => {
+    // All steps `done` and a job at Retry means something after the steps
+    // failed — the publication, which is what turns the draft into the article.
+    // Nothing was published, so nothing those steps did survived.
+    expect(forceForRetry([forced("fetch", "done"), forced("extract", "skipped")])).toEqual([
+      "fetch",
+      "extract",
+    ]);
   });
 });
 
@@ -327,26 +343,26 @@ describe("what a step counts as done", () => {
   };
 
   it("lists every file a step writes, not just the first", () => {
-    // `extract` writes the HTML and meta.json; `toc` writes tree.json,
+    // `extract` writes the HTML and meta.json; `hierarchy` writes tree.json,
     // labels.json and its copy of blocks.json. Checking only one would let a
     // crash between the writes leave a step reporting itself finished with half
     // its output — and the stage after it would then consume the missing half.
     //
-    // `toc` went from two files to three when the nav labels became a second
+    // `hierarchy` went from two files to three when the nav labels became a second
     // model pass (docs/plans/260826h-toc-scaling.md). A tree with no labels.json beside
     // it is a half-run step, not a finished one, which is also why src/hierarchy.ts
     // writes tree.json last of the three.
     expect(STEPS.extract.outputs(ctx)).toHaveLength(2);
-    expect(STEPS.toc.outputs(ctx)).toHaveLength(3);
+    expect(STEPS.hierarchy.outputs(ctx)).toHaveLength(3);
     expect(STEPS.extract.outputs(ctx).some((f) => f.endsWith("meta.json"))).toBe(true);
-    expect(STEPS.toc.outputs(ctx).some((f) => f.endsWith("blocks.json"))).toBe(true);
-    expect(STEPS.toc.outputs(ctx).some((f) => f.endsWith("labels.json"))).toBe(true);
+    expect(STEPS.hierarchy.outputs(ctx).some((f) => f.endsWith("blocks.json"))).toBe(true);
+    expect(STEPS.hierarchy.outputs(ctx).some((f) => f.endsWith("labels.json"))).toBe(true);
   });
 
   it("checks its own artefact, not the copy a later stage makes", () => {
     // Stage 3 writes beside the HTML; stage 4 copies into data/. Checking the
     // data copy here would mean a finished `blocks` step reporting itself
-    // unfinished until `toc` had also run.
+    // unfinished until `hierarchy` had also run.
     expect(STEPS.blocks.outputs(ctx)).toContain(ctx.htmlFile.replace(/\.html$/, ".blocks.json"));
     expect(STEPS.blocks.outputs(ctx).some((f) => f.startsWith(ctx.dir))).toBe(false);
   });
@@ -378,7 +394,7 @@ describe("sweepStopped", () => {
       step("fetch", "done"),
       step("extract", "done"),
       step("blocks", "running"),
-      step("toc", "pending"),
+      step("hierarchy", "pending"),
     ]);
     expect(sweepStopped(j)).toBe(true);
     expect(j.status).toBe("queued");
@@ -394,7 +410,7 @@ describe("sweepStopped", () => {
       step("fetch", "done"),
       step("extract", "done"),
       step("blocks", "running"),
-      step("toc", "pending"),
+      step("hierarchy", "pending"),
     ]);
     sweepStopped(j);
     expect(j.steps.map((s) => s.status)).toEqual(["done", "done", "pending", "pending"]);
@@ -564,7 +580,7 @@ describe("parseJobRequest", () => {
     // the runner, where the message is about a property of undefined rather
     // than about the request that caused it.
     expect(() => parseJobRequest({ slug: "a", steps: ["summarise"] })).toThrow(/steps must be/);
-    expect(() => parseJobRequest({ slug: "a", steps: "toc" })).toThrow(/steps must be/);
+    expect(() => parseJobRequest({ slug: "a", steps: "hierarchy" })).toThrow(/steps must be/);
     expect(() => parseJobRequest({ slug: "a", force: ["nope"] })).toThrow(/force must be/);
   });
 
```

### tests/retry-after-a-failed-refresh.test.ts (new, in full)
```ts
/**
 * **A failed forced refresh loses the work it completed, and reports success.**
 *
 * The fourth fault of docs/plans/260831b-finish-the-database-move.md § *Stage 3
 * — the flip*, found by GPT Sol on 2026-08-31, and the whole of what this file
 * is about. It is four steps of fixture and nothing in the finished code says it
 * was ever wrong, which is why it is a file of its own with the sequence written
 * out rather than four more cases at the bottom of tests/jobs.test.ts.
 *
 * The sequence, once the pipeline commits through Postgres:
 *
 * 1. Published revision R1 exists.
 * 2. A forced job writes new `fetch`, `extract` and `blocks` into a **draft**,
 *    then fails at `hierarchy`.
 * 3. The failed draft is discarded (`failRevisionIn`, src/store/pg-session.ts).
 *    Everything those three steps produced goes with it. The reader is still on
 *    R1, which is the draft's whole purpose.
 * 4. Retry forces from the first step that did not *finish* — `hierarchy`.
 * 5. The retry's own draft is copied from **R1** again, so `fetch`, `extract`
 *    and `blocks` all find R1's artefacts current and skip, and `hierarchy` runs over
 *    the old article. **The job reports success and the refresh is gone**, with
 *    a row of green ticks over it. docs/reusable/silent-success.md.
 *
 * Note that step 5 is not a filesystem fault that the flip inherits — it is one
 * the flip *creates*. On a laptop the three steps really did write their files
 * and a retry finds them, so nothing is lost. In Postgres the draft is the only
 * place they ever were.
 *
 * ## What was decided, and what was not
 *
 * **Greg's decision 8, 2026-08-31: a failed refresh starts over.** `forceForRetry`
 * re-forces every step the *original request* forced, rather than only the ones
 * that did not finish, and `cascadeForce` takes it from there. The alternative —
 * retaining the failed draft so the retry can adopt its completed work — was
 * costed and moved to that plan's § *Appendix: someday maybe*.
 *
 * **The cost is real and is not mitigated here.** A refresh that fails at `hierarchy`
 * re-fetches, re-extracts and, for a PDF, pays for the transcription a second
 * time. The obvious saving is the per-chunk checkpoints src/pdf-read.ts already
 * writes, and they do not help on a deployment: they land under `dataDir`, which
 * is a job-scoped `/tmp` the next job cannot see. That is landing D2, and it is a
 * reason to want D2 sooner rather than an argument against decision 8.
 *
 * ## Why these are unit tests and where the gap is
 *
 * `forceForRetry` and `cascadeForce` are the two pure functions the whole fault
 * turns on, and `enqueue` composes them in exactly the way case 2 below does
 * (src/jobs.ts § `enqueue`). What is **not** proved here is the consequence: a
 * real forced job, failed at `hierarchy` against a real Postgres draft, retried, and
 * the article read back. That wants a network fetch and a paid `hierarchy` call, so it
 * is left undone and said out loud rather than approximated.
 */
import { describe, expect, it } from "vitest";

import { cascadeForce, forceForRetry } from "../src/jobs.js";
import { STEPS } from "../src/pipeline.js";
import type { JobStep, StepName } from "../src/types.js";

/** A step of a job that was **not** forced — an ordinary ingest's. */
const plain = (name: StepName, status: JobStep["status"]): JobStep => ({
  name,
  label: STEPS[name].label,
  status,
});

/** A step of a job that *was* forced. `enqueue` sets this from `cascadeForce`. */
const forced = (name: StepName, status: JobStep["status"]): JobStep => ({
  ...plain(name, status),
  force: true,
});

/**
 * The job the fault is about: the shelf's refresh button, dead at `hierarchy`.
 *
 * `{ slug, force: ["fetch"] }` is literally what src/web/ShelfEntry.tsx sends,
 * and `cascadeForce` turns it into a force flag on every step of the job — which
 * is why all five carry one here.
 */
const REFRESH_THAT_DIED_AT_TOC: JobStep[] = [
  forced("fetch", "done"),
  forced("extract", "done"),
  forced("blocks", "done"),
  forced("hierarchy", "error"),
  forced("assets", "pending"),
];

describe("a retry after a failed forced refresh", () => {
  /* --------------------------------------------------------------- 1 -- */

  /**
   * **The fault itself, at the one function that decides it.**
   *
   * Forcing `hierarchy` alone is the answer that reads as thrift and behaves as data
   * loss: the three steps above it finished into a draft that no longer exists,
   * so "they are already done" is a statement about a revision the retry cannot
   * see. The retry has to acquire the article again.
   */
  it("re-forces the steps whose work went with the discarded draft", () => {
    expect(forceForRetry(REFRESH_THAT_DIED_AT_TOC)).toEqual([
      "fetch",
      "extract",
      "blocks",
      "hierarchy",
      "assets",
    ]);
    /* The half that matters most, said on its own so a partial fix cannot pass:
       the retry must go back to the *front* of what was forced. */
    expect(forceForRetry(REFRESH_THAT_DIED_AT_TOC)[0]).toBe("fetch");
  });

  /* --------------------------------------------------------------- 2 -- */

  /**
   * **The same thing composed the way `enqueue` composes it**, because
   * `forceForRetry`'s answer is not what the new job runs — `cascadeForce` is.
   *
   * This is the assertion that would have caught a `forceForRetry` returning
   * something `cascadeForce` then dropped on the floor: a name that is not in
   * the job's own step list is quietly discarded, and the retry would come out
   * forcing nothing at all while every test of the first function passed.
   */
  it("makes the new job re-run every step the refresh had asked for", () => {
    const names = REFRESH_THAT_DIED_AT_TOC.map((s) => s.name);
    const forcedAgain = cascadeForce(names, new Set(forceForRetry(REFRESH_THAT_DIED_AT_TOC)));
    expect([...forcedAgain]).toEqual(["fetch", "extract", "blocks", "hierarchy", "assets"]);
  });

  /* --------------------------------------------------------------- 3 -- */

  /**
   * **The guard on the other side, and it is about money.**
   *
   * An ordinary failure — nothing forced — still forces nothing. The steps that
   * succeeded wrote into a draft this job still owns, or published, and skipping
   * them is the whole of what Retry means. A fix for the fault above that also
   * re-ran these would buy a model call on every retry in the app.
   */
  it("still forces nothing when the original was not a refresh", () => {
    expect(
      forceForRetry([
        plain("fetch", "done"),
        plain("extract", "done"),
        plain("blocks", "done"),
        plain("hierarchy", "error"),
      ]),
    ).toEqual([]);
  });

  /* --------------------------------------------------------------- 4 -- */

  /**
   * A refresh that died at its very first step is unchanged by any of this: the
   * earliest forced step and the earliest unfinished step are the same one.
   */
  it("forces from the front when the refresh died at `fetch`", () => {
    expect(forceForRetry([forced("fetch", "error"), forced("extract", "pending")])).toEqual([
      "fetch",
      "extract",
    ]);
  });

  /* --------------------------------------------------------------- 5 -- */

  /**
   * **Every step finished and the job still failed**, which is the case the old
   * rule got exactly backwards.
   *
   * A job whose steps are all `done` reaches Retry only if something *after* the
   * steps failed — the publication itself, which is where the draft is turned
   * into the article (`publishRevisionIn`, src/store/pg-revisions.ts). Nothing
   * was published, so the draft was failed and every one of those completed
   * steps is gone. The old rule looked for an unfinished step, found none, and
   * forced nothing: the retry then skipped all five and republished R1.
   */
  it("re-forces a refresh whose steps all finished and whose publication did not", () => {
    expect(
      forceForRetry([forced("fetch", "done"), forced("extract", "skipped")]),
    ).toEqual(["fetch", "extract"]);
  });
});
```

### tests/pg-session-exact-base.test.ts (new, in full)
```ts
/**
 * **A draft may only replace the revision it was copied from.**
 *
 * Stage 3 item 4 of docs/plans/260831b-finish-the-database-move.md — GPT Sol's
 * first review of that plan found it, and it was carried forward through five
 * more reviews without being built:
 *
 * > `beginDraftIn` copies whichever revision is current when the lazy draft is
 * > opened. `publishAndFinish` checks article identity but not that the draft
 * > was based on the revision bound for reads. Reads from R1 can therefore be
 * > overlaid onto a draft copied from R2.
 *
 * The shape of it, in the order it happens:
 *
 * 1. The job claims the article and its draft is copied from **R1**.
 * 2. The job runs for minutes — a model call, a fetch, a transcription.
 * 3. Something publishes **R2** in the meantime.
 * 4. The job finishes and publishes its draft. `publishRevisionIn` checks the
 *    revision's article, its status, its blocks and its tree, and **nothing
 *    anywhere asks what the draft was based on** — so the pointer moves back
 *    over R2 and R2's work is gone. Both the job and the publication report
 *    success (docs/reusable/silent-success.md).
 *
 * What can publish in step 3 is worth being exact about, because it decides how
 * likely this is rather than whether it is possible: `jobs_active_slug` allows
 * one active job per article, so it is not usually another job — it is
 * `npm run db:import`, a hand-run `publishRevision`, or the fixture loader. The
 * invariant is absent either way, which is what this file is about.
 *
 * ## What the guard is, and what it is not
 *
 * `refuseIfBaseMoved` (src/store/pg-session.ts) compares the base recorded when
 * the draft was opened against `articles.current_revision_id` read under the
 * article lock a statement before the publication moves it. A mismatch throws
 * `PublishRefused`, and the throw takes the publication, the step completion and
 * the job's ending back with it.
 *
 * It is exact for a draft this claim **minted**. For one it **reopened** — a job
 * handed back between steps — the base is the article's current revision read at
 * reopen, because `openOrBeginJobDraft` deliberately does not guess at lineage
 * and there is no `based_on_revision_id` column to read. See `DraftBase` for the
 * full statement of the difference; closing it is a migration and not this
 * piece of work. **This file tests the minted case**, which is the one a fresh
 * claim always takes.
 *
 * ## The two mutations, watched red on 2026-08-31
 *
 * Both by deleting the `refuseIfBaseMoved` call from `settleIn` in
 * src/store/pg-session.ts — the state before this work:
 *
 * ```
 * AssertionError: promise resolved "{ kind: 'ended', job: { …(8) }, …(1) }" instead of rejecting
 * ```
 *
 * That is the guard's absence. What it *costs* is behind it, and only visible
 * once the rejection assertion is let through — the three soft assertions after
 * it, watched red the same way:
 *
 * ```
 * AssertionError: the job's draft was published over R2:
 *   expected '26c2cb38-…' to be 'a5b7de78-…'
 * AssertionError: R2's work is gone:
 *   expected 'the arc the job wrote' to be 'the arc R2 published'
 * AssertionError: expected 'published' to be 'draft'
 * ```
 *
 * And the positive control below passed under the mutation as well as after the
 * fix, which is what says the guard refuses the race rather than refusing
 * publication.
 *
 * ## Contention
 *
 * Same shared database as every other suite, so: this file's own owner and its
 * own slug prefix, both swept on the way in and out, and
 * tests/helpers/run-lock.ts because it claims a job. Copied from
 * tests/pg-session-real-step.test.ts, which set the pattern.
 */
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/* `SPIDERYARN_STORE=postgres` before a single import is evaluated — src/store/live.ts
   reads the flag once, at first import, and imports are hoisted above ordinary
   statements. The reasoning in full is in tests/store-pg-session.test.ts. */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const before = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return before;
});

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  jobs as jobsTable,
  revisionBlocks,
  revisionStepRuns,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId, mintUniqueId } from "../src/ids.js";
import { runAsOwner } from "../src/owner.js";
import { STEPS, contextPaths } from "../src/pipeline.js";
import type { ConvertedProduct, PipelineStep, StepContext } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { mintAttempt } from "../src/store/jobs.js";
import { STORE } from "../src/store/live.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { openPgStoreSession } from "../src/store/pg-session.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/revisions.js";
import type { StoreSession } from "../src/store/session.js";
import type { Arc, Block, Job, JobStep, OwnerId, StepName, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { type HeldRunLock, takeRunLock } from "./helpers/run-lock.js";

/* Put the flag back straight away — vitest reuses a worker across files, and the
   modules above have already captured it. */
if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

loadEnvLocal();

/* Long, because claiming waits on a contended slot rather than failing on it. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = path.resolve(import.meta.dirname, "..");

/** This file's own person, and its own rubble pattern. See store-pg-session. */
const OWNER_STEM = "000000c5-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

const SLUG_PREFIX = "test-pg-exact-base-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

const LEASE_MS = 60_000;

/** The three arcs, each naming who wrote it. The whole test is which survives. */
const ARC_R1 = "the arc R1 published";
const ARC_R2 = "the arc R2 published";
const ARC_JOB = "the arc the job wrote";

/* ---------------------------------------------------- is there a database -- */

let runLock: HeldRunLock | undefined;

const { reachable } = await pgReady({
  suite: "tests/pg-session-exact-base.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
  ],
});

if (reachable) {
  runLock = await takeRunLock("tests/pg-session-exact-base.test.ts");
  const lockClient = runLock.client;
  await lockClient.query("delete from spideryarn.jobs where owner_id::text like $1", [RUBBLE]);
  await lockClient.query("delete from spideryarn.jobs where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query(
    "update spideryarn.articles set current_revision_id = null where slug like $1",
    [SLUG_RUBBLE],
  );
  await lockClient.query("delete from spideryarn.articles where slug like $1", [SLUG_RUBBLE]);
  await lockClient.query("delete from auth.users where id::text like $1", [RUBBLE]);
  await lockClient.query(
    `insert into auth.users
       (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             $2, 'x', now(), now())`,
    [OWNER, `pg-session-exact-base-${OWNER}@example.invalid`],
  );
}

const when = reachable ? describe : describe.skip;

/* ------------------------------------------------------------- the fixture -- */

const MINTED = new Set<string>();

function block(id: string, text: string): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    html: `<p id="${id}">${text}</p>`,
    gistable: true,
  };
}

/** The smallest tree `checkTree` accepts — the publication gate runs the real one. */
function treeFor(slug: string, blocks: Block[]): Tree {
  const leaves = blocks.map((b, i) => [`n${i + 1}`, b] as const);
  return {
    version: "toc/1",
    generator: "fixture",
    slug,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: leaves.map(([id]) => id),
        range: [blocks[0]?.id ?? "", blocks[blocks.length - 1]?.id ?? ""],
        title: "A fixture article",
        gist: "A fixture built by tests/pg-session-exact-base.test.ts and nothing else.",
      },
      ...Object.fromEntries(
        leaves.map(([id, b]) => [
          id,
          {
            id,
            depth: 1,
            parent: "n0",
            children: [],
            range: [b.id, b.id],
            title: "A paragraph",
            navLabel: "One paragraph of a fixture article that exists only for this test",
          },
        ]),
      ),
    },
  } as Tree;
}

function arcSaying(slug: string, blocks: Block[], text: string): Arc {
  return {
    version: "arc/1",
    generator: "fixture",
    slug,
    entries: [{ range: [blocks[0]?.id ?? "", blocks[blocks.length - 1]?.id ?? ""], text }],
  };
}

const stepRun = (revisionId: string, name: StepName, inputHash = NO_INPUT_HASH) =>
  recordStepRun({
    revisionId,
    stepName: name,
    inputHash,
    implementationVersion: PIPELINE_RUN,
    promptVersion: null,
    model: null,
    status: "done",
    startedAt: new Date(),
    finishedAt: new Date(),
  });

interface Fixture {
  readonly slug: string;
  readonly articleId: string;
  readonly publishedRevisionId: string;
  readonly blocks: Block[];
}

/** R1: a published article with an arc that says which revision wrote it. */
async function publishR1(slug: string): Promise<Fixture> {
  const blocks = [
    block(mintUniqueId(MINTED), "The opening paragraph of a fixture that exists for one test."),
    block(mintUniqueId(MINTED), "The closing paragraph, which says nothing in particular."),
  ];
  const db = getDb();
  const begun = await beginRevision({ slug });

  await db
    .insert(blockIdentities)
    .values(blocks.map((b) => ({ articleId: begun.articleId, blockId: b.id })))
    .onConflictDoNothing();
  await db.insert(revisionBlocks).values(
    blocks.map((b, i) => ({
      articleId: begun.articleId,
      revisionId: begun.revisionId,
      blockId: b.id,
      ordinal: i,
      tag: b.tag,
      kind: b.kind,
      level: null,
      text: b.text,
      words: b.words,
      html: b.html,
      gistable: b.gistable,
      note: null,
    })),
  );

  await db
    .update(articleRevisions)
    .set({
      title: "A fixture article",
      excerpt: "A fixture built by tests/pg-session-exact-base.test.ts.",
      finalUrl: `https://example.com/${slug}`,
      fetchedAt: new Date("2026-08-31T00:00:00.000Z"),
      stampedHtml: blocks.map((b) => b.html).join("\n"),
      tree: treeFor(slug, blocks),
      arc: arcSaying(slug, blocks, ARC_R1),
    })
    .where(eq(articleRevisions.id, begun.revisionId));

  for (const name of ["fetch", "extract", "blocks"] as StepName[]) {
    await stepRun(begun.revisionId, name);
  }
  /* The one run row that has to carry a real hash: the publication gate compares
     it with `hashBlocks` of the stored blocks and refuses when they differ. */
  await stepRun(begun.revisionId, "hierarchy", hashBlocks(blocks));
  await stepRun(begun.revisionId, "arc");

  await publishRevision({ slug, revisionId: begun.revisionId });

  return { slug, articleId: begun.articleId, publishedRevisionId: begun.revisionId, blocks };
}

/**
 * R2: somebody else's publication, landing while the job holds its draft.
 *
 * Through the real `beginRevision` and `publishRevision`, so the blocks, the
 * tree and the step runs are carried forward exactly as any other publication
 * carries them, and only the arc says who wrote it. That matters: R2 has to be a
 * revision the guard could plausibly refuse to bury, not a hand-made row.
 */
async function publishR2(fixture: Fixture): Promise<string> {
  const begun = await beginRevision({ slug: fixture.slug });
  await getDb()
    .update(articleRevisions)
    .set({ arc: arcSaying(fixture.slug, fixture.blocks, ARC_R2) })
    .where(eq(articleRevisions.id, begun.revisionId));
  await publishRevision({ slug: fixture.slug, revisionId: begun.revisionId });
  return begun.revisionId;
}

/* ------------------------------------------------------------- the fake step -- */

/**
 * A **converted** `arc` that writes nothing and returns the artefact.
 *
 * The same stand-in tests/store-pg-session.test.ts uses, and for the same
 * reason: a real stage here would be a paid model call to prove something about
 * the publication rather than about the stage.
 */
function fakeArc(): PipelineStep<"arc"> {
  return {
    name: "arc",
    label: "Reading the shape of the argument",
    outputs: (ctx) => [path.join(ctx.dir, "arc.json")],
    produces: ["arc"],
    async run() {
      return { detail: "one entry" } as ConvertedProduct;
    },
  };
}

/* ------------------------------------------------------------- the job row -- */

function stepsOf(names: StepName[]): JobStep[] {
  return names.map((name) => ({ name, label: STEPS[name].label, status: "pending" as const }));
}

async function queueJob(slug: string, names: StepName[]): Promise<string> {
  const db = getDb();
  return await insertWhenSlotFree(slug, async () => {
    const id = mintId();
    await db.insert(jobsTable).values({
      id,
      ownerId: OWNER,
      slug,
      steps: stepsOf(names),
      status: "queued",
      workKey: `pg-exact-base-${id}`,
    });
    return id;
  });
}

/** Claim it, waiting out anybody else who got there first. See store-pg-session. */
async function claimWhenSlotFree(id: string, attempt: string): Promise<Job> {
  for (let n = 1; n <= 40; n++) {
    const outcome = await pgJobStore.claim(id, OWNER, attempt, LEASE_MS, 4);
    if (outcome.kind === "claimed") return outcome.job;
    if (outcome.kind !== "busy") {
      throw new Error(`claiming ${id} answered ${outcome.kind}, which this fixture cannot use`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`could not claim ${id} in 20s: something else is running on this article`);
}

interface Claimed {
  readonly jobId: string;
  readonly attempt: string;
  readonly session: StoreSession;
  readonly steps: JobStep[];
}

/**
 * A claim with a session over its draft — and the draft is **minted here**,
 * inside `openPgStoreSession`, which is what makes the base exact.
 */
async function claimWithSession(slug: string, names: StepName[]): Promise<Claimed> {
  const jobId = await queueJob(slug, names);
  const attempt = mintAttempt();
  const job = await claimWhenSlotFree(jobId, attempt);
  const session = await openPgStoreSession({ slug, job: { id: jobId, attemptId: attempt } });
  return { jobId, attempt, session, steps: job.steps };
}

/** The context `runStep` would have built. */
function contextFor(slug: string): StepContext {
  const { dir, htmlFile } = contextPaths(slug);
  return {
    slug,
    dir,
    htmlFile,
    report: () => {},
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/* --------------------------------------------------------------- the reads -- */

const db = () => getDb();

async function currentRevisionOf(slug: string): Promise<string | null> {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  return row?.currentRevisionId ?? null;
}

async function arcTextOf(revisionId: string): Promise<string | null> {
  const [row] = await db()
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, revisionId))
    .limit(1);
  return (row?.arc as Arc | null)?.entries[0]?.text ?? null;
}

async function runRow(revisionId: string, step: StepName) {
  const [row] = await db()
    .select()
    .from(revisionStepRuns)
    .where(and(eq(revisionStepRuns.revisionId, revisionId), eq(revisionStepRuns.stepName, step)))
    .limit(1);
  return row;
}

async function draftOf(jobId: string): Promise<string | null> {
  const [row] = await db().select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  return row?.draftRevisionId ?? null;
}

const mine = (name: string, body: () => Promise<void>) => it(name, () => runAsOwner(OWNER, body));

/* ------------------------------------------------------------------ tests -- */

when("publishing a draft whose base has moved", () => {
  afterEach(async () => {
    if (!reachable) return;
    await db()
      .delete(jobsTable)
      .where(and(eq(jobsTable.ownerId, OWNER), inArray(jobsTable.status, ["queued", "running"])));
  });

  afterAll(async () => {
    if (!reachable) return;
    const database = getDb();
    await database.delete(jobsTable).where(eq(jobsTable.ownerId, OWNER));
    const ours = await database
      .select({ id: articles.id, slug: articles.slug })
      .from(articles)
      .where(eq(articles.ownerId, OWNER));
    for (const { id, slug } of ours) {
      await database.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
      await database.delete(articles).where(eq(articles.id, id));
      await rm(path.join(ROOT, "data", slug), { recursive: true, force: true });
    }
    await closeDb();
    if (runLock) {
      await runLock.client.query("delete from auth.users where id = $1", [OWNER]);
      await runLock.release();
    }
  });

  /* ------------------------------------------------------------------ 1 -- */

  /**
   * **The one this file exists for.** A publication lands between the draft
   * being copied and the job finishing, and the job must not bury it.
   */
  mine("refuses, and leaves the other publication serving the article", async () => {
    expect(STORE, "the vi.hoisted flag did not reach src/store/live.ts").toBe("postgres");

    const slug = `${SLUG_PREFIX}moved`;
    const fixture = await publishR1(slug);
    const claimed = await claimWithSession(slug, ["arc"]);
    const draft = await draftOf(claimed.jobId);

    /* The state the case rests on, asserted rather than assumed: the draft was
       minted from R1, and R1 is what the article serves. */
    expect(draft, "the claim did not open a draft").toBeTruthy();
    expect(await currentRevisionOf(slug)).toBe(fixture.publishedRevisionId);

    /* Step 3: somebody else publishes while the job holds its claim. */
    const r2 = await publishR2(fixture);
    expect(await currentRevisionOf(slug)).toBe(r2);

    await claimed.session.beginStep(slug, "arc");
    await expect(
      claimed.session.commit(
        contextFor(slug),
        fakeArc(),
        claimed.attempt,
        { detail: "one entry", parts: { arc: arcSaying(slug, fixture.blocks, ARC_JOB) } },
        {
          kind: "end",
          jobId: claimed.jobId,
          attempt: claimed.attempt,
          ending: { status: "done", steps: claimed.steps },
        },
      ),
      "the commit published a draft copied from a revision that is no longer current",
    ).rejects.toMatchObject({ name: "PublishRefused", status: 409 });

    /* **What the refusal is for.** R2 is still the article, and its arc is still
       R2's — these are the assertions that say what the missing guard costs.

       `soft`, so that one mutation shows both rather than only whichever comes
       first: "the pointer moved" and "the work is gone" are different facts and
       a fix could plausibly get one of them right. */
    expect
      .soft(await currentRevisionOf(slug), "the job's draft was published over R2")
      .toBe(r2);
    expect
      .soft(await arcTextOf(await currentRevisionOf(slug) as string), "R2's work is gone")
      .toBe(ARC_R2);

    /* And the whole transaction went back: the draft is still a draft, the job
       still holds it, and the step it began is `running` again for the failure
       settlement that follows. */
    const draftId = draft as string;
    const [row] = await db()
      .select()
      .from(articleRevisions)
      .where(eq(articleRevisions.id, draftId))
      .limit(1);
    expect(row?.status).toBe("draft");
    expect(await draftOf(claimed.jobId)).toBe(draftId);
    expect((await runRow(draftId, "arc"))?.status).toBe("running");
  });

  /* ------------------------------------------------------------------ 2 -- */

  /**
   * **The positive control, and it is not decoration.**
   *
   * A guard that refused every publication would pass case 1 and break every
   * ingest in the app. This is the same job with nothing published underneath
   * it: the draft's base is still current, so it publishes, and the arc the job
   * wrote is the arc the reader gets.
   */
  mine("publishes as usual when nothing moved underneath it", async () => {
    const slug = `${SLUG_PREFIX}unmoved`;
    const fixture = await publishR1(slug);
    const claimed = await claimWithSession(slug, ["arc"]);

    await claimed.session.beginStep(slug, "arc");
    const settled = await claimed.session.commit(
      contextFor(slug),
      fakeArc(),
      claimed.attempt,
      { detail: "one entry", parts: { arc: arcSaying(slug, fixture.blocks, ARC_JOB) } },
      {
        kind: "end",
        jobId: claimed.jobId,
        attempt: claimed.attempt,
        ending: { status: "done", steps: claimed.steps },
      },
    );

    expect(settled.kind).toBe("ended");
    const published = await currentRevisionOf(slug);
    expect(published).not.toBe(fixture.publishedRevisionId);
    expect(await arcTextOf(published as string)).toBe(ARC_JOB);
    expect(await draftOf(claimed.jobId)).toBeNull();
  });
});
```
