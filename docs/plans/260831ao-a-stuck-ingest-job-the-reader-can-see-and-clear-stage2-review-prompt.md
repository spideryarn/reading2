# Review the built code for Stage 2

You reviewed the plan for this work on 2026-09-01 and your findings shaped it. **Stage 2 is now
built.** This is a review of code, not of a plan — weight it accordingly, and check the things a
plan-stage review could not: what the statements actually do, what the tests actually pin, and what
a concurrent second actor can make happen.

## What Stage 2 was for

Production is Vercel: no cron, no worker, the reader's browser drives jobs. `LEASE_MS = 760_000`,
the claimant self-aborts at 740s, the platform kill is 800s — so an expired lease means the process
is **definitely gone**, which is the one reading it is safe to act on.

Three defects:

1. `failExpired` settled every expired row as `error`/INTERRUPTED, including a row carrying
   `cancelling = true`. A reader who pressed Stop was told the job was *interrupted*.
2. `requestCancel` on a `running` row always wrote `cancelling = true` and waited for a claimant,
   even when the lease had already lapsed and there was provably nobody to wait for.
3. The name `failExpired` stops being true once (1) is fixed.

## What was built

- `JobStore.failExpired(now?) → string[]` became **`settleExpired(now?) → ExpirySettlement[]`**
  where `ExpirySettlement = { id, status: "error" | "cancelled" }`.
- `settleExpired` settles a `cancelling` row as `cancelled`, nulls `error` and `failureKind` on that
  branch, settles the steps, stamps `finishedAt = now()`, and compares `lease_expires_at < now()`
  unless a test injects a date.
- `requestCancel` computes one condition
  `over = coalesce(status = 'queued' or lease_expires_at < now(), false)` and reuses it across every
  `case`. `over` settles exactly as the sweep does — status, steps, `attemptId`, `leaseExpiresAt`,
  **`draftRevisionId`**, `error`, `failureKind`, `finishedAt`. `not over` writes `cancelling` and
  touches nothing else.
- New `settledSteps()`: a correlated `jsonb_agg` subquery that rewrites any `status: "running"` step
  to `pending` and drops its `startedAt`, so a terminal job never draws a spinner.
- The fs adapter grew `settleAbandoned(job, as?)` holding the whole field set once, called by both
  `settleExpired` and `requestCancel`; it treats `queued`, **no entry in `attempts`**, or an expired
  entry as over.
- Database time: `claim` writes `now() + make_interval(secs => leaseMs/1000.0)`, `finishIn` stamps
  `now()`, the sweep compares against `now()`.

Five new tests, four of them in the parity suite so both adapters run them: a `cancelling` row
settling as cancelled; Stop on an expired-lease row going terminal in one statement; the running
step settled; the lease and ending dated from the database with `Date` faked an hour fast; and the
draft pointer nulled when Stop lands on a lapsed claim.

## The specific questions

1. **Is `over` correct as written?** `coalesce(status = 'queued' or lease_expires_at < now(), false)`
   — the `coalesce` is there so a running row with a null lease falls to the *asking* branch rather
   than producing a NULL in a `not null` column. Is that the right default, and is the whole
   condition right for every row state `ACTIVE` admits?

2. **The step settles to `pending`, not `error`, and the implementer asked for a second opinion.**
   The argument for `pending`: `sweepStopped` in the fs adapter already writes exactly that; a
   cancelled job has no sentence for the step to carry; and `StepRow` renders `step.error` in full
   under the label, so copying `INTERRUPTED.message` onto the step would print the same paragraph
   twice. The argument against: `runStep`'s in-process interruption sets `step.status = "error"`, so
   the same event now has two spellings depending on which path noticed it. Which is right?

3. **The fs adapter treats "no entry in `attempts`" as a lapsed claim.** Unreachable in one process;
   the implementer chose the safe direction deliberately. Is it the safe direction?

4. **Concurrency.** Walk the races: Stop arriving while `settleExpired` runs; Stop arriving as a
   claimant releases; two Stops; a claimant whose lease lapses mid-step and then tries to write.
   The fences are `id = $id and attempt_id = $attempt and status = 'running'`. Does anything now
   reach a state nothing can move it out of — the failure mode this whole area has produced twice
   before?

5. **Database time.** Three sites moved. Is that all of them? Is there anywhere left comparing an
   application clock against a database-written timestamp, which is the bug shape this was fixing?

6. **Do the tests pin what they claim?** The implementer was honest that it wrote the
   implementation first and then watched each test go red by weakening the implementation one change
   at a time. Check the tests would actually fail for the right reason, and name any that would
   pass against a broken implementation.

7. **What did Stage 2 break or make harder for Stage 3?** Stage 3 adds an owner parameter to
   `settleExpired` and a call from `listJobs()`. Is the shape right for that?

8. **Anything else.** Name whatever a code review can see that a plan review could not.

The diff is attached below. The plan is
`docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md`; the files are
`src/store/pg-jobs.ts`, `src/store/jobs-fs.ts`, `src/store/jobs.ts`, `src/jobs.ts`,
`tests/store-jobs-parity.test.ts`, `tests/store-pg-session.test.ts`.

Several agents share this working tree, so some hunks in `src/jobs.ts` belong to other people's
in-flight work; ignore those.

---

diff --git a/src/store/jobs-fs.ts b/src/store/jobs-fs.ts
index bb933ef..a31a14c 100644
--- a/src/store/jobs-fs.ts
+++ b/src/store/jobs-fs.ts
@@ -39,6 +39,7 @@ import { environmentOwnerId } from "../owner.js";
 import type { Job, JobStep, OwnerId } from "../types.js";
 import {
   type ClaimOutcome,
+  type ExpirySettlement,
   type JobEnding,
   type JobStore,
   StaleAttemptError,
@@ -159,6 +160,45 @@ export function sweepStopped(job: Job): boolean {
   return changed;
 }
 
+/**
+ * **End a job nobody is inside any more**, the way both expiry paths need it.
+ *
+ * One function because `settleExpired` and the lapsed-claim branch of
+ * `requestCancel` must write the *same* fields — the bug that costs most here
+ * is one of them forgetting a field the other clears, which is what
+ * `draftRevisionId` was in the Postgres adapter. The two Postgres statements
+ * share a `case` for the same reason.
+ *
+ * `as` forces the cancelled ending for the reader who is pressing Stop right
+ * now, since `cancelling` is not on the record yet and never will be.
+ *
+ * **A running step goes back to `pending`**, exactly as `sweepStopped` writes
+ * it: a terminal job holding a running step draws a spinner on a card that has
+ * finished. Not `error` — the step was abandoned rather than failed, and the
+ * job's own sentence is the account of that.
+ */
+function settleAbandoned(job: Job, as?: "cancelled"): void {
+  const cancelled = as === "cancelled" || job.cancelling === true;
+  for (const step of job.steps) {
+    if (step.status !== "running") continue;
+    step.status = "pending";
+    delete step.startedAt;
+  }
+  job.status = cancelled ? "cancelled" : "error";
+  if (cancelled) {
+    /* Cleared rather than left, so the record always describes *this* ending.
+       A job that failed a step, was retried and is then stopped would otherwise
+       carry the old sentence under a status saying the reader stopped it. */
+    delete job.error;
+    delete job.failureKind;
+  } else {
+    job.error = INTERRUPTED.message;
+    job.failureKind = INTERRUPTED.kind;
+  }
+  job.finishedAt = new Date().toISOString();
+  delete job.cancelling;
+}
+
 let loaded: Promise<void> | null = null;
 
 async function loadFromDisk(): Promise<void> {
@@ -374,23 +414,28 @@ export const fsJobStore: JobStore = {
     return structuredClone(job);
   },
 
-  async failExpired(now: Date = new Date()): Promise<string[]> {
+  /**
+   * The Postgres `settleExpired`, on one process's `attempts` map.
+   *
+   * **It does not always fail**, which is why it is no longer called
+   * `failExpired`: a job carrying `cancelling` is a reader who pressed Stop and
+   * whose claimant then went away without ever reading the flag, so it settles
+   * as `cancelled`. `sweepStopped` above already answers that way on restart;
+   * this is the same answer for the same state, reached a different way.
+   */
+  async settleExpired(now: Date = new Date()): Promise<ExpirySettlement[]> {
     await ready();
-    const failed: string[] = [];
+    const settled: ExpirySettlement[] = [];
     for (const [id, held] of attempts) {
       if (held.expires > now.getTime()) continue;
       const job = index.get(id);
       attempts.delete(id);
       if (!job || TERMINAL.has(job.status)) continue;
-      job.status = "error";
-      job.error = INTERRUPTED.message;
-      job.failureKind = INTERRUPTED.kind;
-      job.finishedAt = new Date().toISOString();
-      delete job.cancelling;
+      settleAbandoned(job);
       await persist(job);
-      failed.push(id);
+      settled.push({ id, status: job.status as ExpirySettlement["status"] });
     }
-    return failed;
+    return settled;
   },
 
   async activeForSlug(slug: string, owner: OwnerId): Promise<Job | undefined> {
@@ -406,14 +451,24 @@ export const fsJobStore: JobStore = {
     const job = ownedBy(id, owner);
     if (!job || TERMINAL.has(job.status)) return undefined;
     /* Queued means over, right now: nobody is inside it to notice a flag, so
-       the transition happens here or never. Running means ask the claimant —
-       cancelling it out from under one would leave it writing artefacts for a
-       job the reader has been told is finished. One decision rather than two
-       calls; see the Postgres adapter for the gap the two-call version had. */
-    if (job.status === "queued") {
-      job.status = "cancelled";
-      job.finishedAt = new Date().toISOString();
-      delete job.cancelling;
+       the transition happens here or never. Running with a live claim means ask
+       the claimant — cancelling it out from under one would leave it writing
+       artefacts for a job the reader has been told is finished. One decision
+       rather than two calls; see the Postgres adapter for the gap the two-call
+       version had.
+
+       **Running with a lapsed claim means over too**, and it is the same branch
+       as queued. The claimant aborts itself inside its own lease, so a lapsed
+       claim says the process is gone rather than slow, and there is provably
+       nobody left to read a flag. Two dev tabs is the local way to reach it.
+       A `running` job with no entry in `attempts` at all is the same state:
+       nothing here holds it. That cannot happen in one process — `claim` writes
+       the entry and `sweepStopped` requeues anything running at load — which
+       is the analogue of `jobs_running_is_fenced` refusing a running row with
+       no lease. */
+    const held = attempts.get(id);
+    if (job.status === "queued" || held === undefined || held.expires <= Date.now()) {
+      settleAbandoned(job, "cancelled");
       attempts.delete(id);
     } else {
       job.cancelling = true;
@@ -464,7 +519,7 @@ export const fsJobStore: JobStore = {
  * The job this attempt still holds, or a refusal.
  *
  * The same three conditions the Postgres fence uses, and for the same reason:
- * without `status === "running"` a job already failed by `failExpired` would
+ * without `status === "running"` a job already failed by `settleExpired` would
  * accept its own former claimant's write. Throwing rather than returning,
  * because zero-changes-reads-as-success is the failure this exists to prevent.
  */
diff --git a/src/store/jobs.ts b/src/store/jobs.ts
index a58d3c5..c14a1e8 100644
--- a/src/store/jobs.ts
+++ b/src/store/jobs.ts
@@ -28,8 +28,10 @@
  *
  * ## What an expired lease means, and what it deliberately does not
  *
- * It means *nobody is coming back*, and the job is failed so a reader can press
- * Retry. It does **not** mean another claimant may take the job over. That
+ * It means *nobody is coming back*, and the job is settled so a reader can
+ * press Retry — as `error` ordinarily, or as `cancelled` if they had already
+ * pressed Stop (`settleExpired`). It does **not** mean another claimant may
+ * take the job over. That
  * would be safe only if every durable write were fenced, and the artefacts are
  * still files: a stage writes its output and *then* calls `finishStep`, so a
  * stale claimant's files land before its token is refused, and `beginStep`'s own
@@ -69,6 +71,19 @@ export interface StepOutcome {
   title?: string;
 }
 
+/**
+ * One job the expiry sweep settled, and which way it went.
+ *
+ * A pair rather than an id, because `settleExpired` stopped always failing —
+ * a row carrying `cancelling` ends `cancelled` — so a caller that logged
+ * "failed" over the ids alone would be saying something untrue about half of
+ * them. GPT Sol, 2026-09-01.
+ */
+export interface ExpirySettlement {
+  id: string;
+  status: Extract<JobStatus, "error" | "cancelled">;
+}
+
 /** How a job ended, and everything the card needs to say so. */
 export interface JobEnding {
   status: Extract<JobStatus, "done" | "error" | "cancelled">;
@@ -199,20 +214,35 @@ export interface JobStore {
   finish(id: string, attempt: string, ending: JobEnding): Promise<Job>;
 
   /**
-   * Fail every job whose lease has run out, and say **which**.
+   * Settle every job whose lease has run out, and say **which, and how**.
    *
-   * **Not a takeover.** The job is marked `error` with a sentence saying it was
-   * interrupted, and Retry is the reader's to press — which costs a click and
+   * **Not a takeover.** Retry is the reader's to press — which costs a click and
    * removes the whole class of two-claimants-one-article. See the header.
    *
-   * **The ids, not a count.** A sweep is the only account there is of a claimant
-   * that stopped answering — the process that was inside the job is gone and
-   * logged nothing on its way out — and `failed 1 job(s)` cannot be joined to
-   * anything. Both stores already have the ids in hand: the `UPDATE` returns
-   * them, and the filesystem adapter is looping over them. GPT Sol, 2026-08-30,
-   * docs/plans/260830a-v1-imports-review-sol.md § Remaining operational points.
+   * **It does not always fail, which is why it is no longer called
+   * `failExpired`.** A row carrying `cancelling` is a reader who pressed Stop
+   * and whose claimant then walked away; ending that as `error` /
+   * `INTERRUPTED` tells them their own action was an interruption. It settles
+   * as `cancelled` instead, which makes three mechanisms agree rather than
+   * adding a fourth: `releaseStepIn` already settles a live claimant's release
+   * on a `cancelling` job as cancelled, and the filesystem adapter's
+   * `sweepStopped` does the same on restart.
+   *
+   * **The outcomes, not a count.** A sweep is the only account there is of a
+   * claimant that stopped answering — the process that was inside the job is
+   * gone and logged nothing on its way out — and `failed 1 job(s)` cannot be
+   * joined to anything, nor is it true of every row it counted. Both stores
+   * already have both fields in hand: the `UPDATE` returns them, and the
+   * filesystem adapter is looping over them. GPT Sol, 2026-08-30,
+   * docs/plans/260830a-v1-imports-review-sol.md § Remaining operational points,
+   * and 2026-09-01 on the rename.
+   *
+   * **`now` is for tests only.** With nothing passed, both adapters compare the
+   * lease against their own store's clock — SQL `now()` on Postgres — because a
+   * lease written by one instance and read by another is only a deadline if
+   * both are reading the same clock.
    */
-  failExpired(now?: Date): Promise<string[]>;
+  settleExpired(now?: Date): Promise<ExpirySettlement[]>;
 
   /**
    * The job queued or running for this slug, if there is one.
@@ -234,9 +264,25 @@ export interface JobStore {
    * Stop, and **decide in one statement which kind of stop this is**.
    *
    * A queued job is over immediately: nobody is inside it to notice a flag, so
-   * the transition happens here or never. A running job is asked — cancelling
-   * it out from under a claimant would leave that claimant writing artefacts
-   * for a job the reader has been told is finished.
+   * the transition happens here or never. A running job whose **lease has
+   * lapsed** is over immediately too, and for the same reason — the claimant
+   * set its own deadline inside the lease and aborted itself, so an expired
+   * lease says *the process is gone* rather than *the process is slow*, and
+   * there is provably nobody left to read a flag. A running job whose lease is
+   * still live is asked — cancelling it out from under a claimant would leave
+   * that claimant writing artefacts for a job the reader has been told is
+   * finished.
+   *
+   * **There is no "force stop" short of that**, deliberately. A live claim may
+   * genuinely be working, and clearing it is how two writers get one article.
+   *
+   * **The lapsed branch copies `settleExpired`'s field set, not the running
+   * one's.** In particular it nulls `draftRevisionId`: the running branch
+   * leaves the pointer alone because the claimant disposes of it, and a job
+   * that goes terminal still holding one is a draft `sweepAbandonedDrafts`
+   * spares for ever, since it reads any job's pointer as ownership. That is the
+   * exact leak GPT Sol's 2026-08-30 finding closed in the sweep. Fable, on the
+   * plan, 2026-09-01.
    *
    * It was two methods until 2026-08-27, `cancelIdle` then this, and the gap
    * between them was a permanent stuck state: a claimant releasing in that gap
diff --git a/src/store/pg-jobs.ts b/src/store/pg-jobs.ts
index 6aee81d..e0aa36b 100644
--- a/src/store/pg-jobs.ts
+++ b/src/store/pg-jobs.ts
@@ -15,7 +15,7 @@
  *
  * The third is not decoration. The schema lets a terminal row keep its token,
  * so `id` + `attempt_id` alone means a job already marked `error` by
- * `failExpired` would accept its own former claimant's write and report one row
+ * `settleExpired` would accept its own former claimant's write and report one row
  * affected — success, reported, with the wrong output. Zero rows throws
  * `StaleAttemptError` rather than returning quietly, because
  * zero-rows-reads-as-success is the failure this whole mechanism exists to
@@ -47,6 +47,7 @@ import type { FailureKind } from "../messages.js";
 import type { Job, JobStatus, JobStep, OwnerId } from "../types.js";
 import {
   type ClaimOutcome,
+  type ExpirySettlement,
   type JobEnding,
   type JobStore,
   StaleAttemptError,
@@ -184,7 +185,13 @@ async function claimIn(
         .set({
           status: "running",
           attemptId: attempt,
-          leaseExpiresAt: new Date(Date.now() + leaseMs),
+          /* **The database's clock, not this instance's.** The lease is what
+             says whether a claimant is still allowed to write, and it is
+             written by one instance and read by another — so an app-clock
+             deadline is only a deadline while every instance agrees what time
+             it is. `settleExpired` compares against `now()` from the same
+             clock, which makes the whole lease one clock's arithmetic. */
+          leaseExpiresAt: sql`now() + make_interval(secs => ${leaseMs} / 1000.0)`,
           // A resumed job started once already, and the card's "how long has
           // this been going" should not restart every time a tab picks it up.
           startedAt: sql`coalesce(${jobs.startedAt}, now())`,
@@ -232,6 +239,43 @@ async function getIn(tx: Tx, id: string, owner: OwnerId): Promise<Job | undefine
   return row ? toJob(row) : undefined;
 }
 
+/**
+ * **The steps of a job that is going terminal with one of them still running.**
+ *
+ * A `running` step on a job that is over draws a spinner on a card that has
+ * finished, which is the one thing a progress list must never do. Both expiry
+ * paths could leave one: nobody is inside the job to write the step out, so if
+ * the statement that ends the job does not settle it, nothing ever will.
+ *
+ * **Back to `pending`, with `startedAt` dropped** — which is exactly what
+ * `sweepStopped` (src/store/jobs-fs.ts) already does to a step whose process
+ * went away, so this is a third mechanism agreeing rather than a new rule. Not
+ * `error`: the step did not fail, it was abandoned, and the job's own sentence
+ * is the account of that. Giving the step a copy of it would print the same
+ * paragraph twice on the card, since `StepRow` renders `step.error` in full
+ * under the label.
+ *
+ * One correlated subquery rather than a read-then-write, so this file keeps its
+ * rule that every transition is a single conditional statement. `jobs.steps` on
+ * the right-hand side of a `SET` is the row as it was before the update.
+ */
+function settledSteps() {
+  return sql`(
+    select coalesce(
+      jsonb_agg(
+        case
+          when step.value->>'status' = 'running'
+            then (step.value - 'startedAt') || '{"status":"pending"}'::jsonb
+          else step.value
+        end
+        order by step.ordinality
+      ),
+      '[]'::jsonb
+    )
+    from jsonb_array_elements(${jobs.steps}) with ordinality as step(value, ordinality)
+  )`;
+}
+
 /**
  * The store itself, **not exported** — see `pgJobStore` at the foot of this file.
  *
@@ -424,44 +468,71 @@ const rawPgJobStore: JobStore = {
     return finishIn(getDb(), id, attempt, ending);
   },
 
-  async failExpired(now: Date = new Date()): Promise<string[]> {
+  /**
+   * **One statement, and it decides which kind of ending this is** — the same
+   * shape `requestCancel` has, and for the same reason.
+   *
+   * A row carrying `cancelling` is a reader who pressed Stop and whose claimant
+   * then walked away without ever reading the flag. Failing it as
+   * `INTERRUPTED` would tell that reader their own Stop was an interruption, so
+   * it settles as `cancelled`, and the sentence and the kind that go with a
+   * failure are **cleared** rather than left: a job that failed a step and was
+   * then stopped would otherwise carry the old sentence under a `cancelled`
+   * status. GPT Sol, 2026-09-01.
+   */
+  async settleExpired(now?: Date): Promise<ExpirySettlement[]> {
     const db = getDb();
-    const failed = await db
+    const settled = await db
       .update(jobs)
       .set({
-        status: "error",
+        status: sql`case when ${jobs.cancelling} then 'cancelled' else 'error' end`,
+        steps: settledSteps(),
         attemptId: null,
         leaseExpiresAt: null,
         cancelling: false,
-        finishedAt: new Date(),
+        finishedAt: sql`now()`,
         /* **The draft goes with the claim, and a terminal job may not keep a
            pointer.** `sweepAbandonedDrafts` spares a revision that *any* job
-           row names, terminal ones included — so a job failed here while
+           row names, terminal ones included — so a job settled here while
            holding a pointer is a draft nothing will ever publish and nothing
            will ever reclaim. The path is ordinary rather than exotic: a step
            releases, the next advance never comes, the lease lapses, and this
            statement is what ends the job. GPT Sol, 2026-08-30,
            docs/plans/260827aa-delete-the-importer-d1b-sol.md finding 1. */
         draftRevisionId: null,
-        error: INTERRUPTED.message,
+        /* Nulled on the cancelled branch rather than left alone, so the field
+           always describes *this* ending — the same rule `finishIn` follows.
+           A stale sentence under a `cancelled` status is a job telling the
+           reader something that did not happen. */
+        error: sql`case when ${jobs.cancelling} then null else ${INTERRUPTED.message}::text end`,
         /* `retry`, said out loud rather than left to the absent-means-yes rule.
            Both offer the button; only one of them says why, and a kind that is
            merely missing is indistinguishable from a failure nobody classified.
            An interrupted job really is worth another go — `stepIsDone` derives
            what is finished from the artefacts, so a retry resumes. */
-        failureKind: INTERRUPTED.kind,
+        failureKind: sql`case when ${jobs.cancelling} then null else ${INTERRUPTED.kind}::text end`,
       })
       .where(
         and(
           eq(jobs.status, "running"),
           isNotNull(jobs.leaseExpiresAt),
-          lt(jobs.leaseExpiresAt, now),
+          /* **Database time, unless a test says otherwise.** The lease is
+             written by `claim` as `now() + leaseMs` on this same clock, so the
+             deadline is one clock's arithmetic end to end. It used to be
+             `Date.now()` at both ends, which is fine on a laptop and is a
+             different clock from the one holding the row the moment there are
+             two instances. */
+          now === undefined ? sql`${jobs.leaseExpiresAt} < now()` : lt(jobs.leaseExpiresAt, now),
         ),
       )
-      .returning({ id: jobs.id });
-    /* The ids the statement already returns. It has selected them since the day
-       it was written — only the count was being kept. */
-    return failed.map((row) => row.id);
+      .returning({ id: jobs.id, status: jobs.status });
+    /* What the statement already returns, and both fields of it. `RETURNING`
+       hands back the row *after* the update, so the status here is the ending
+       the `case` chose rather than the one it started from. */
+    return settled.map((row) => ({
+      id: row.id,
+      status: row.status as ExpirySettlement["status"],
+    }));
   },
 
   async noteProgress(id: string, attempt: string, steps: JobStep[]): Promise<Job> {
@@ -498,36 +569,63 @@ const rawPgJobStore: JobStore = {
      * `stopping` for ever while the reader's Stop button is already disabled.
      *
      * A `case` inside one `UPDATE` cannot have a gap. Queued means over, right
-     * now; running means ask the claimant, because cancelling it out from under
-     * one would leave that claimant writing artefacts for a job the reader has
-     * been told is finished.
+     * now; running with a live lease means ask the claimant, because cancelling
+     * it out from under one would leave that claimant writing artefacts for a
+     * job the reader has been told is finished.
+     *
+     * **Running with a lease that has lapsed means over, right now, too**, and
+     * that third branch is what makes Stop mean what it says. The claimant sets
+     * its own deadline *inside* the lease and aborts itself (src/jobs.ts §
+     * `LEASE_MS`), so a lapsed lease says the process is gone rather than slow:
+     * there is provably nobody to read a flag. Without this branch, Stop on a
+     * dead claimant showed a disabled "Stopping…" for up to 12.67 minutes and
+     * then reported the job **interrupted**, which is not what the reader did.
+     *
+     * There is deliberately no force-stop short of the lease. A live claim may
+     * genuinely be working, and clearing it is how two writers get one article.
      *
      * Not fenced: the reader pressing Stop is not a claimant, and a Stop that
      * needed the running attempt's token could only be pressed by the process
      * it is meant to interrupt.
      */
+    /* **The two branches that end the job, as one condition.** They settle
+       identically, and writing the condition once is what stops the seven
+       `case`s below drifting apart — which is the shape of the bug the lapsed
+       branch was added to fix. */
+    const over = sql`coalesce(${jobs.status} = 'queued' or ${jobs.leaseExpiresAt} < now(), false)`;
     const [row] = await db
       .update(jobs)
       .set({
-        status: sql`case when ${jobs.status} = 'queued' then 'cancelled' else ${jobs.status} end`,
-        cancelling: sql`${jobs.status} <> 'queued'`,
-        attemptId: sql`case when ${jobs.status} = 'queued' then null else ${jobs.attemptId} end`,
-        leaseExpiresAt: sql`case when ${jobs.status} = 'queued' then null else ${jobs.leaseExpiresAt} end`,
-        /* **Only on the branch that ends the job**, and that asymmetry is the
-           whole of it. A queued job is terminal one statement later, and a
-           terminal job holding a pointer is a draft `sweepAbandonedDrafts`
-           spares for ever — it treats any job's pointer as ownership. A
-           *running* job's pointer belongs to the claimant that is still inside
-           a step: taking it away here would leave that claimant's next fenced
-           write refused for a reason nothing could explain, and the claimant is
-           the one that disposes of the draft when its release resolves to a
-           cancellation (src/store/pg-session.ts, case 4). The pointer really
+        status: sql`case when ${over} then 'cancelled' else ${jobs.status} end`,
+        /* Every step is settled on the branches that end the job, so a stopped
+           job never keeps a spinner. On the *asking* branch the steps are the
+           claimant's to write and this leaves them alone. */
+        steps: sql`case when ${over} then ${settledSteps()} else ${jobs.steps} end`,
+        cancelling: sql`not ${over}`,
+        attemptId: sql`case when ${over} then null else ${jobs.attemptId} end`,
+        leaseExpiresAt: sql`case when ${over} then null else ${jobs.leaseExpiresAt} end`,
+        /* **Only on the branches that end the job**, and that asymmetry is the
+           whole of it. A queued job — or one whose claimant is provably gone —
+           is terminal one statement later, and a terminal job holding a pointer
+           is a draft `sweepAbandonedDrafts` spares for ever, since it treats any
+           job's pointer as ownership. A *live* claimant's pointer belongs to the
+           claimant that is still inside a step: taking it away here would leave
+           its next fenced write refused for a reason nothing could explain, and
+           it is the one that disposes of the draft when its release resolves to
+           a cancellation (src/store/pg-session.ts, case 4). The pointer really
            can be set on a queued job: `releaseStepIn` leaves it alone
            deliberately, so the next request continues into the same draft.
            GPT Sol, 2026-08-30, docs/plans/260827aa-delete-the-importer-d1b-sol.md
-           finding 1. */
-        draftRevisionId: sql`case when ${jobs.status} = 'queued' then null else ${jobs.draftRevisionId} end`,
-        finishedAt: sql`case when ${jobs.status} = 'queued' then now() else ${jobs.finishedAt} end`,
+           finding 1; Fable, 2026-09-01, on the lapsed branch needing the same
+           field set rather than the running one's. */
+        draftRevisionId: sql`case when ${over} then null else ${jobs.draftRevisionId} end`,
+        /* Cleared, so a `cancelled` job never carries the sentence of a failure
+           it recovered from. A job that failed a step, was retried and is then
+           stopped would otherwise say why it failed under a status saying the
+           reader stopped it. GPT Sol, 2026-09-01. */
+        error: sql`case when ${over} then null else ${jobs.error} end`,
+        failureKind: sql`case when ${over} then null else ${jobs.failureKind} end`,
+        finishedAt: sql`case when ${over} then now() else ${jobs.finishedAt} end`,
       })
       .where(and(eq(jobs.id, id), eq(jobs.ownerId, owner), inArray(jobs.status, ACTIVE)))
       .returning();
@@ -675,7 +773,10 @@ export async function finishIn(
       attemptId: null,
       leaseExpiresAt: null,
       cancelling: false,
-      finishedAt: new Date(),
+      /* Database time, as `releaseStepIn` and `requestCancel` already use — one
+         clock stamps every one of a job's timestamps, so two endings written by
+         two instances can still be ordered against each other. */
+      finishedAt: sql`now()`,
       error: ending.error ?? null,
       /* Deleted rather than left alone when there is no kind, so the field
          always describes *this* failure. A stale kind hides a button rather
@@ -693,7 +794,7 @@ export async function finishIn(
  * **The fence, in one place so that no transition can be written without it.**
  *
  * All three conditions, and `status = 'running'` is the one to watch: without
- * it a job already failed by `failExpired` accepts its own former claimant's
+ * it a job already failed by `settleExpired` accepts its own former claimant's
  * write and reports success. See the file header.
  */
 function fence(id: string, attempt: string) {
diff --git a/src/jobs.ts b/src/jobs.ts
index 78332e8..5ae172a 100644
--- a/src/jobs.ts
+++ b/src/jobs.ts
@@ -2103,10 +2103,13 @@ export async function cancelJob(id: string): Promise<Job | null> {
   if (job.status === "done" || job.status === "error" || job.status === "cancelled") return job;
 
   /* **One call, because the store decides which kind of stop this is.** A
-     queued job ends outright; a running one is asked, and reads the flag at its
-     next step boundary. It was two calls — cancel-if-idle, then ask — until GPT
-     Sol pointed out that a claimant releasing between them leaves the job
-     `queued` with `cancelling` set, which nothing ever moves on.
+     queued job ends outright — and since 2026-09-01 so does a running one whose
+     lease has lapsed, because the claimant aborts itself inside its own lease
+     and there is provably nobody left to read a flag. A running job with a live
+     claim is asked, and reads the flag at its next step boundary. It was two
+     calls — cancel-if-idle, then ask — until GPT Sol pointed out that a claimant
+     releasing between them leaves the job `queued` with `cancelling` set, which
+     nothing ever moves on.
 
      The local abort comes after, and only helps in the common case that the
      claimant is this very process — which is what makes Stop feel instant
diff --git a/tests/store-jobs-parity.test.ts b/tests/store-jobs-parity.test.ts
index a807033..e47f509 100644
--- a/tests/store-jobs-parity.test.ts
+++ b/tests/store-jobs-parity.test.ts
@@ -97,9 +97,9 @@ const STRANGER = "00000000-0000-4000-8000-0000000000b5" as OwnerId;
  * A private owner is not enough on its own, because the two rules that matter
  * most here are not scoped to an owner at all: `jobs_only_one_running` is a
  * unique index on `(true)` over every running row in the table, and
- * `settleExpired` sweeps the whole table and returns the ids this file asserts
- * exactly. So a second copy holding a claim makes this one's `claimed` come
- * back `busy`, and its expiries are added to this one's total. Measured with
+ * `settleExpired` sweeps the whole table and returns the settlements this file
+ * asserts exactly. So a second copy holding a claim makes this one's `claimed`
+ * come back `busy`, and its expiries are added to this one's total. Measured with
  * the lock taken out and the owner already unique per run: two copies at once,
  * 6 and 9 of the 21 Postgres cases failed. The filesystem side passed both
  * times — its running slot is a variable in one process.
diff --git a/tests/store-jobs-parity.test.ts b/tests/store-jobs-parity.test.ts
index 6726b28..a807033 100644
--- a/tests/store-jobs-parity.test.ts
+++ b/tests/store-jobs-parity.test.ts
@@ -20,17 +20,17 @@
  * through the same cases is how "the same rules, differently enforced" stays a
  * claim somebody checked.
  */
-import { afterAll, afterEach, describe, expect, it } from "vitest";
+import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
 import { randomUUID } from "node:crypto";
 import { Pool } from "pg";
-import { eq, inArray } from "drizzle-orm";
+import { eq, inArray, sql } from "drizzle-orm";
 
 import { closeDb, getDb } from "../src/db/client.js";
 import { jobs } from "../src/db/schema.js";
 import { loadEnvLocal } from "../src/env.js";
 import { ID_PREFIX, mintId } from "../src/ids.js";
 import { mintAttempt } from "../src/store/jobs.js";
-import type { JobStore } from "../src/store/jobs.js";
+import type { ExpirySettlement, JobStore } from "../src/store/jobs.js";
 import { StaleAttemptError } from "../src/store/jobs.js";
 import {
   expireLeaseForTests,
@@ -97,7 +97,7 @@ const STRANGER = "00000000-0000-4000-8000-0000000000b5" as OwnerId;
  * A private owner is not enough on its own, because the two rules that matter
  * most here are not scoped to an owner at all: `jobs_only_one_running` is a
  * unique index on `(true)` over every running row in the table, and
- * `failExpired` sweeps the whole table and returns the ids this file asserts
+ * `settleExpired` sweeps the whole table and returns the ids this file asserts
  * exactly. So a second copy holding a claim makes this one's `claimed` come
  * back `busy`, and its expiries are added to this one's total. Measured with
  * the lock taken out and the owner already unique per run: two copies at once,
@@ -163,7 +163,7 @@ if (process.env.DATABASE_URL) {
          and both of the rules this file leans on are global. A leftover
          `running` row makes every claim here answer `busy` through
          `jobs_only_one_running`, and a leftover expired one is counted by
-         `failExpired`, which two cases below assert exactly.
+         `settleExpired`, which two cases below assert exactly.
 
          Safe to take the lot because the lock is already held, so no sibling
          copy can be using any of them; and scoped by the stem, so it can only
@@ -209,6 +209,18 @@ const CAP = 4;
 /** Prefixed so this file's rows can be found and removed without touching anybody else's. */
 const MINE = "test-store-jobs-";
 
+/**
+ * The ids out of a settlement, for the cases that only care which jobs moved.
+ *
+ * `settleExpired` returns `{ id, status }` pairs rather than ids, because since
+ * 2026-09-01 it does not always fail: a row carrying `cancelling` ends
+ * `cancelled`. The cases that are *about* which ending it chose assert the
+ * whole pair.
+ */
+function settledIds(settled: ExpirySettlement[]): string[] {
+  return settled.map((one) => one.id);
+}
+
 /**
  * **Each store, plus the two states its own API cannot reach.**
  *
@@ -252,11 +264,17 @@ const ADAPTERS: Adapter[] = [
     available: reachable,
     /* Written straight to the column rather than by claiming with a tiny lease,
        because a lease short enough to expire during a test is short enough to
-       expire between two of the assertions that follow. */
+       expire between two of the assertions that follow.
+
+       **`now()`, not `Date.now()`.** The store creates and compares leases on
+       the database's clock since 2026-09-01, so a helper reaching for the
+       application's would be testing the two against each other — green on a
+       laptop where they are the same clock, and quietly wrong exactly where
+       Vercel and Supabase are not. */
     async expire(id) {
       await getDb()
         .update(jobs)
-        .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
+        .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
         .where(eq(jobs.id, id));
     },
     async reattach(id, attempt) {
@@ -675,7 +693,7 @@ for (const adapter of ADAPTERS) {
       expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");
 
       await adapter.expire(job.id);
-      expect(await store.failExpired()).toContain(job.id);
+      expect(settledIds(await store.settleExpired())).toContain(job.id);
       await adapter.reattach(job.id, attempt);
 
       // id matches, attempt matches. Only `status = 'running'` refuses this.
@@ -706,9 +724,9 @@ for (const adapter of ADAPTERS) {
     /**
      * **The fence's third condition, tested on the state that needs it.**
      *
-     * The first version of this failed a job with `failExpired` and asserted the
+     * The first version of this failed a job with `settleExpired` and asserted the
      * old token was refused — and it **passed with `status = 'running'` removed
-     * from the fence**, because `failExpired` clears the token too, so the second
+     * from the fence**, because `settleExpired` clears the token too, so the second
      * condition was doing all the work. A test that cannot fail proves nothing,
      * and this one nearly shipped with a comment saying it had been watched red.
      *
@@ -725,7 +743,7 @@ for (const adapter of ADAPTERS) {
 
       // Its lease runs out and the sweep fails it. The claimant does not know.
       await adapter.expire(job.id);
-      expect(await store.failExpired()).toContain(job.id);
+      expect(settledIds(await store.settleExpired())).toContain(job.id);
       expect((await store.get(job.id, OWNER))?.status).toBe("error");
 
       await adapter.reattach(job.id, attempt);
@@ -764,7 +782,7 @@ for (const adapter of ADAPTERS) {
          it failed, and this case is precisely about one job being swept while a
          live one is left alone — so naming the id is the assertion, and the
          count never was. */
-      expect(await store.failExpired()).toEqual([dead.id]);
+      expect(await store.settleExpired()).toEqual([{ id: dead.id, status: "error" }]);
       const failed = await store.get(dead.id, OWNER);
       expect(failed?.status).toBe("error");
       /* `retry`, said rather than left to the absent-means-yes rule — both offer
@@ -777,10 +795,110 @@ for (const adapter of ADAPTERS) {
       const alive = aJob();
       await store.enqueueOrGet(alive, "k2");
       await store.claim(alive.id, OWNER, mintAttempt(), LEASE, CAP);
-      expect(await store.failExpired()).toEqual([]);
+      expect(await store.settleExpired()).toEqual([]);
       expect((await store.get(alive.id, OWNER))?.status).toBe("running");
     });
 
+    /**
+     * **Stop, and then the claimant walks away.**
+     *
+     * The sweep used to settle *every* lapsed claim as `error` / `INTERRUPTED`,
+     * including a row already carrying `cancelling` — so a reader who pressed
+     * Stop was told, twelve minutes later, that their import had been
+     * interrupted. It was the odd one out: `releaseStepIn` settles a live
+     * claimant's release on a `cancelling` job as cancelled, and `sweepStopped`
+     * does the same on restart. This makes three mechanisms agree.
+     */
+    it("settles a stopped job as cancelled, rather than telling the reader they were interrupted", async () => {
+      const job = aJob();
+      await store.enqueueOrGet(job, "k1");
+      const attempt = mintAttempt();
+      expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");
+
+      /* Stop while the claim is still live: the flag goes on and the claimant
+         is asked, which is the right answer at that moment. */
+      expect((await store.requestCancel(job.id, OWNER))?.cancelling).toBe(true);
+      // And then it never comes back.
+      await adapter.expire(job.id);
+
+      expect(await store.settleExpired()).toContainEqual({ id: job.id, status: "cancelled" });
+      const settled = await store.get(job.id, OWNER);
+      expect(settled?.status).toBe("cancelled");
+      expect(settled?.cancelling).toBeFalsy();
+      /* **No sentence and no kind.** Nothing failed — the reader stopped it —
+         and a job that failed a step, was retried and is then stopped would
+         otherwise carry the old sentence under a `cancelled` status. */
+      expect(settled?.error).toBeUndefined();
+      expect(settled?.failureKind).toBeUndefined();
+    });
+
+    /**
+     * **Stop on a claimant that is provably gone is over, right now.**
+     *
+     * The claimant sets its own deadline *inside* the lease and aborts itself
+     * (src/jobs.ts § `LEASE_MS`), so a lapsed lease says the process is gone
+     * rather than slow. Writing `cancelling` and waiting there is waiting for
+     * somebody who cannot arrive: the card showed a disabled "Stopping…" for up
+     * to 12.67 minutes and then reported the wrong reason.
+     *
+     * There is deliberately no force-stop *before* the lease lapses — a live
+     * claim may genuinely be working, and clearing it is how two writers get one
+     * article.
+     */
+    it("stops a job whose claimant is provably gone in one statement, rather than waiting out a lease nobody holds", async () => {
+      const job = aJob();
+      await store.enqueueOrGet(job, "k1");
+      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP)).kind).toBe("claimed");
+      await adapter.expire(job.id);
+
+      const stopped = await store.requestCancel(job.id, OWNER);
+      expect(stopped?.status).toBe("cancelled");
+      expect(stopped?.cancelling).toBeFalsy();
+      expect(stopped?.finishedAt).toBeTruthy();
+
+      /* Really over: nothing is left for the sweep to find, and no later claim
+         gets in — which is what separates this from writing the flag. */
+      expect(settledIds(await store.settleExpired())).not.toContain(job.id);
+      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP)).kind).toBe("finished");
+    });
+
+    /**
+     * **A job that is over must not still be showing a spinner.**
+     *
+     * Both expiry paths end a job nobody is inside, so if the statement that
+     * ends it does not settle the step that was running, nothing ever will:
+     * `StepRow` draws `LoaderCircle` for a `running` step regardless of what the
+     * job says. Back to `pending`, which is what `sweepStopped` already writes
+     * for a step whose process went away.
+     */
+    it("settles the step that was running, so a finished job never draws a spinner", async () => {
+      /** Claim it and leave one step visibly running, as any long step does. */
+      async function midStep(job: Job, key: string): Promise<void> {
+        await store.enqueueOrGet(job, key);
+        const attempt = mintAttempt();
+        expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");
+        await store.noteProgress(job.id, attempt, [
+          { ...job.steps[0]!, status: "running", startedAt: new Date().toISOString() },
+        ]);
+        await adapter.expire(job.id);
+      }
+
+      const swept = aJob();
+      await midStep(swept, "k1");
+      await store.settleExpired();
+      const afterSweep = await store.get(swept.id, OWNER);
+      expect(afterSweep?.status).toBe("error");
+      expect(afterSweep?.steps.map((step) => step.status)).toEqual(["pending"]);
+      expect(afterSweep?.steps[0]?.startedAt).toBeUndefined();
+
+      const stopped = aJob();
+      await midStep(stopped, "k2");
+      const cancelled = await store.requestCancel(stopped.id, OWNER);
+      expect(cancelled?.status).toBe("cancelled");
+      expect(cancelled?.steps.map((step) => step.status)).toEqual(["pending"]);
+      expect(cancelled?.steps[0]?.startedAt).toBeUndefined();
+    });
+
     it("cancels a queued job outright, and only asks a running one — in one call", async () => {
       const queued = aJob();
       await store.enqueueOrGet(queued, "k1");
@@ -835,7 +953,7 @@ for (const adapter of ADAPTERS) {
     /**
      * **The lease had a deadline and nothing enforced it.**
      *
-     * `failExpired` was written with the store and had no production caller at
+     * `settleExpired` was written with the store and had no production caller at
      * all — GPT Sol's first finding on the built queue, and the worst of them,
      * because it is a regression rather than a gap. The old in-memory queue
      * self-healed on restart: a dead process left an empty `Map`, so the next
@@ -861,7 +979,7 @@ for (const adapter of ADAPTERS) {
       expect((await store.claim(waiting.id, OWNER, mintAttempt(), LEASE, 1)).kind).toBe("busy");
 
       await adapter.expire(dead.id);
-      expect(await store.failExpired()).toContain(dead.id);
+      expect(settledIds(await store.settleExpired())).toContain(dead.id);
 
       const after = await store.get(dead.id, OWNER);
       expect(after?.status).toBe("error");
@@ -967,6 +1085,84 @@ for (const adapter of ADAPTERS) {
   });
 }
 
+/**
+ * **The lease is the database's arithmetic, end to end** — Postgres only,
+ * because on the filesystem adapter the store's clock and the application's are
+ * the same clock and there is nothing to disagree.
+ *
+ * The lease says whether a claimant may still write, and it is written by one
+ * instance and read by another. Until 2026-09-01 both ends used `Date.now()`,
+ * which is fine on a laptop and is two clocks the moment Vercel is talking to
+ * Supabase: an instance running fast writes a deadline the sweep will not act
+ * on for as long as the skew, and one running slow has its live claim swept out
+ * from under it.
+ *
+ * **The skew is what makes this a test rather than a tautology.** Every
+ * assertion below is true of the old code on a machine whose clocks agree, so
+ * the case moves the *application's* clock an hour forward and leaves the
+ * database's alone. Only `Date` is faked — timers stay real, or the pool's own
+ * work would never resolve.
+ */
+describe.skipIf(!reachable)("Postgres, on the database's clock", () => {
+  const made: string[] = [];
+  afterEach(async () => {
+    const ids = made.splice(0);
+    if (ids.length > 0) await getDb().delete(jobs).where(inArray(jobs.id, ids));
+  });
+
+  /** Run `body` with this process believing it is `skewMs` later than it is. */
+  async function skewed<T>(skewMs: number, body: () => Promise<T>): Promise<T> {
+    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + skewMs });
+    try {
+      return await body();
+    } finally {
+      vi.useRealTimers();
+    }
+  }
+
+  it("dates the lease and the ending from the database, not from whatever this instance thinks the time is", async () => {
+    const id = mintId();
+    made.push(id);
+    const job: Job = {
+      id,
+      ownerId: OWNER,
+      slug: `${MINE}${id}`,
+      steps: [{ name: "fetch", label: "Fetching the page", status: "pending" }],
+      status: "queued",
+      createdAt: new Date().toISOString(),
+    };
+    await pgJobStore.enqueueOrGet(job, "clock");
+
+    const attempt = mintAttempt();
+    const HOUR = 60 * 60_000;
+    await skewed(HOUR, async () => {
+      expect((await pgJobStore.claim(id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");
+    });
+
+    const [claimed] = await getDb()
+      .select({ lease: jobs.leaseExpiresAt })
+      .from(jobs)
+      .where(eq(jobs.id, id));
+    /* An hour-fast instance writing `Date.now() + LEASE` puts the deadline an
+       hour and a minute out, and the sweep would leave a dead claimant holding
+       the article for that whole hour. */
+    expect(claimed?.lease).toBeTruthy();
+    expect(claimed!.lease!.getTime() - Date.now()).toBeLessThan(LEASE + 30_000);
+
+    await skewed(HOUR, async () => {
+      await pgJobStore.finish(id, attempt, { status: "done", steps: job.steps });
+    });
+    const [ended] = await getDb()
+      .select({ finishedAt: jobs.finishedAt })
+      .from(jobs)
+      .where(eq(jobs.id, id));
+    /* The same for the ending. A job stamped an hour in the future sorts above
+       everything the reader did afterwards, and retention orders by time. */
+    expect(ended?.finishedAt).toBeTruthy();
+    expect(ended!.finishedAt!.getTime() - Date.now()).toBeLessThan(30_000);
+  });
+});
+
 /**
  * Take the seeded person away again, and their jobs first.
  *
diff --git a/tests/store-pg-session.test.ts b/tests/store-pg-session.test.ts
index b4fccae..e015b91 100644
--- a/tests/store-pg-session.test.ts
+++ b/tests/store-pg-session.test.ts
@@ -53,7 +53,7 @@
  * 10. A stage that threw leaves its step run `error`, not `running` — nothing
  *     else ever revisits the row `beginStep` committed.
  * 11 and 12. The two endings that reach a job **nobody is inside** —
- *     `failExpired` and Stop on a *queued* job — clear the draft pointer, and
+ *     `settleExpired` and Stop on a *queued* job — clear the draft pointer, and
  *     Stop on a *running* one does not.
  * 13. A commit that **rolled back** leaves the step open, and the failure
  *     settled one line later has to close it — the ordering case 10 cannot see.
@@ -83,9 +83,9 @@
  *
  * ## Why it takes tests/store-jobs-parity.test.ts's advisory lock
  *
- * A global resource, scoped to no owner: `advanceJob` calls `failExpired`,
+ * A global resource, scoped to no owner: `advanceJob` calls `settleExpired`,
  * which sweeps **every** expired job and returns a count the parity suite
- * asserts exactly — and since 2026-08-30 a case here calls `failExpired` itself,
+ * asserts exactly — and since 2026-08-30 a case here calls `settleExpired` itself,
  * which is the same collision from the other side. A lock only excludes the
  * holders that agree to take it, so this file takes the same key rather than a
  * key of its own — the point is to exclude *that file*, which is the only other
@@ -160,7 +160,7 @@
  *   does case 1.
  * - 10: delete the `finishStepRun(… "error")` from `settleIn` → the run row is
  *   still `running` after the job has ended.
- * - 11 and 12: delete `draftRevisionId` from `failExpired`'s and
+ * - 11 and 12: delete `draftRevisionId` from `settleExpired`'s and
  *   `requestCancel`'s `set` → the pointer survives the ending. Both fixtures
  *   start from a **real** pointer; over a job with no draft the same assertions
  *   pass with the fix deleted.
@@ -1767,7 +1767,7 @@ when("the transactional session", () => {
   /**
    * A lapsed claim is swept, and **the draft pointer goes with it.**
    *
-   * `failExpired` is the one ending that happens to a job with nobody inside it:
+   * `settleExpired` is the one ending that happens to a job with nobody inside it:
    * there is no session, no claimant and no later statement, so if this
    * statement does not clear the pointer nothing ever will —
    * `sweepAbandonedDrafts` spares a revision that *any* job row names, terminal
@@ -1792,14 +1792,15 @@ when("the transactional session", () => {
       .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
       .where(eq(jobsTable.id, claimed.jobId));
 
-    /* **Named, not counted.** `failExpired` returns the ids it moved rather
+    /* **Named, not counted.** `settleExpired` returns the ids it moved rather
        than how many (src/store/jobs.ts), and a count could only say that *some*
        job was swept — on a shared database, with peers' rows lapsing beside
        this one, `>= 1` was true whether or not this job was in it. */
-    const swept = await pgJobStore.failExpired();
-    expect(swept, "this job's lease had expired, so the sweep had to move it").toContain(
-      claimed.jobId,
-    );
+    const swept = await pgJobStore.settleExpired();
+    expect(
+      swept.map((s) => s.id),
+      "this job's lease had expired, so the sweep had to move it",
+    ).toContain(claimed.jobId);
 
     const job = await jobRow(claimed.jobId);
     expect(job?.status).toBe("error");
@@ -1813,6 +1814,46 @@ when("the transactional session", () => {
     expect((await revisionRow(claimed.revisionId))?.status).toBe("draft");
   });
 
+  /**
+   * **Stop, landing on a claim that has already lapsed — and the pointer goes
+   * with that one too.**
+   *
+   * `requestCancel` ends such a job on the spot rather than writing `cancelling`
+   * and waiting for a claimant that is provably gone. Which puts it in the same
+   * position as the sweep above: the job goes terminal with nobody inside it, so
+   * this statement is the last thing that will ever touch the row, and a pointer
+   * left behind is a draft `sweepAbandonedDrafts` spares for ever.
+   *
+   * It is the hazard the plan named before the branch was written, because the
+   * obvious way to write it is to copy `requestCancel`'s *running* branch — and
+   * that branch deliberately keeps the pointer, since a live claimant is the one
+   * that disposes of it. Fable, 2026-09-01. It starts from a real pointer for
+   * the reason the case above gives: a job with no draft satisfies the assertion
+   * before the fix as well as after it.
+   */
+  mine("clears the draft pointer when Stop lands on a claim that has lapsed", async () => {
+    const slug = `${SLUG_PREFIX}stopped-lapsed`;
+    await publishArticle(slug, "the carried arc");
+    const claimed = await claimWithSession(slug, ["arc", "tweets"]);
+    expect((await jobRow(claimed.jobId))?.draftRevisionId).toBe(claimed.revisionId);
+
+    await db()
+      .update(jobsTable)
+      .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
+      .where(eq(jobsTable.id, claimed.jobId));
+
+    const stopped = await pgJobStore.requestCancel(claimed.jobId, OWNER);
+    expect(stopped?.status, "the claimant is gone, so Stop is over right now").toBe("cancelled");
+
+    const job = await jobRow(claimed.jobId);
+    expect(job?.status).toBe("cancelled");
+    expect(
+      job?.draftRevisionId,
+      "a terminal job holding a pointer is a draft the sweeper spares for ever",
+    ).toBeNull();
+    expect((await revisionRow(claimed.revisionId))?.status).toBe("draft");
+  });
+
   /**
    * Stop on a **queued** job ends it, and the pointer goes with that too.
    *
