# Review: waiting for the single running job slot in tests

You are reviewing a **code change**, already built, not a plan. Be adversarial. Some of the
reasoning below may be wrong; say so.

## The repo rule this change lives under

`spideryarn.jobs` has a partial unique index:

```sql
CREATE UNIQUE INDEX jobs_only_one_running ON spideryarn.jobs USING btree ((true))
  WHERE (status = 'running');
```

It is on the constant `(true)`, so **at most one row in the whole table may be `running`** — global
concurrency 1, deliberate. A second index `jobs_active_slug` is narrower and covers `queued` too.

Vitest runs test *files* concurrently. Seven test files insert a `running` row.

## The failure

A full-suite run (266 files) failed 3 cases in `tests/store-job-draft.test.ts`:

```
Caused by: error: duplicate key value violates unique constraint "jobs_only_one_running"
 ❯ claimedJob tests/store-job-draft.test.ts:88:3
```

The file passes alone (6/6), passes beside its neighbours (48/48), and fails only under full-suite
load. Its logic was never wrong: it lost a race for the global slot and the loser gets a
duplicate-key error naming *it*.

`tests/helpers/load-article.ts` had already met this and grown a retry loop (reviewed by you,
2026-08-28). `tests/store-jobs-parity.test.ts` takes a session advisory lock, and its own docstring
says that lock "covers copies of this file and nothing else".

## The change

1. New `tests/helpers/running-slot.ts` exporting `insertWhenSlotFree(what, insert, opts?)` — the
   retry lifted out of `load-article.ts` verbatim in behaviour.
2. `load-article.ts`'s `withRunningJob` now calls it (duplicate removed).
3. `store-job-draft.test.ts`'s `claimedJob` now calls it — the actual fix.
4. New `tests/running-slot.test.ts`, 5 cases.

## Evidence

- Before: full suite 7 failures = store-job-draft 3 (`jobs_only_one_running`) + parity 4.
- After: `grep -c jobs_only_one_running` over two full-suite logs = **0**, store-job-draft absent
  from failures.
- Control: disabling the retry (`if (!contended || true) throw err`) turns 4 of the 5 new tests red;
  the 5th is the rethrow-immediately case and correctly stays green. Restored, verified no marker left.
- Affected suites (8 files, everything importing `load-article`): 222/222 pass.
- `npm run typecheck`: clean on all three projects. `biome check`: clean.
- Parity alone 42/42 ×3; parity + store-job-draft 48/48 ×3.

## What I want you to attack

1. **Does moving the retry out of `load-article.ts` change its behaviour?** The original minted
   `{id, attemptId}` fresh *inside* the retry loop; mine mints inside the callback. The original
   `continue`d after a contended insert; mine returns from the callback's throw. Is the job id, the
   `finally` delete, or the fence on the token affected in any case?
2. **`made.push(id)` moved** in `store-job-draft.test.ts` from before the insert to after it, so a
   contended attempt no longer records an id teardown would chase. Is there a path where an insert
   partially succeeds and the id is now *not* recorded, leaking a running row that wedges the slot
   for every later suite?
3. **Is retry the right mechanism at all**, versus one shared advisory lock across all seven files?
   My reasoning: a lock only excludes holders that agree to take it, and a real ingest or a dev
   server never will, whereas waiting on the constraint needs no agreement. Argue the other side.
4. **Does making losers wait-and-then-acquire make contention worse for others?** Before, a loser
   errored out and never held the slot; now it waits up to 20s and then holds it. Parity's
   full-suite failures rose from 4 to 10 across the same period — though the tree also gained 23
   tests from other agents and I could not separate the two. Is there a starvation or
   convoy argument here I am missing? Is 40×500ms the wrong shape?
5. **The `{attempts, gapMs}` seam** exists only so the timeout branch is testable in ms rather than
   20s. Is a test-only parameter on a production-shaped helper acceptable here, or does it invite a
   caller to tune it and quietly defeat the wait?
6. Anything in the new tests that would **pass against broken code** — particularly the fake error
   shape (SQLSTATE `23505` + `constraint`, wrapped one level in a `cause`) versus what pg and
   Drizzle actually produce.

## Out of scope

`tests/store-jobs-parity.test.ts` has another agent's uncommitted work in it and must not be
touched. Its remaining full-suite failures are known and are what its own docstring predicts.
## Diff of tracked files
```diff
diff --git a/tests/helpers/load-article.ts b/tests/helpers/load-article.ts
index 7eb3b30..eede735 100644
--- a/tests/helpers/load-article.ts
+++ b/tests/helpers/load-article.ts
@@ -69,7 +69,7 @@ import { type OwnerId, currentOwnerId, runAsOwner } from "../../src/owner.js";
 import { createFsArtifactStore } from "../../src/store/artifacts-fs.js";
 import { pgArtifactsIn } from "../../src/store/artifacts-pg.js";
 import { storeRawSource } from "../../src/store/blobs.js";
-import { violatesConstraint } from "../../src/store/db-errors.js";
+import { insertWhenSlotFree } from "./running-slot.js";
 import { mintAttempt } from "../../src/store/jobs.js";
 import {
   PublishRefused,
@@ -195,14 +195,11 @@ async function storeRawBytesFor(slug: string): Promise<void> {
 /**
  * Take the single running slot, run `body`, and give the slot back.
  *
- * **The retry is not defensive padding, and it covers two different refusals.**
- * `jobs_only_one_running` is a partial unique index over the *whole table*, so a
- * dev server mid-ingest or another suite's fixture will refuse this insert.
- * `jobs_active_slug` is narrower and covers `queued` as well as `running`: it
- * fires when this *article* already has a job in flight. Waiting can clear
- * either one — but neither can be cleared by waiting if the row is **wedged**,
- * which is what the timeout message has to say, because "try again later" is
- * useless advice when the answer is "delete the stuck row".
+ * **The wait for the slot is not defensive padding**, and it now lives in
+ * `insertWhenSlotFree` — see `./running-slot.ts` for which two refusals it
+ * covers and why waiting cannot clear a wedged row. It moved there on
+ * 2026-08-28 because a suite that had never met this grew the same failure:
+ * one of it, not one per file that gets bitten.
  *
  * **The job is deleted rather than marked done**, and the delete is fenced on
  * the token. Marking it `done` in a `finally` would claim success for a body
@@ -217,43 +214,24 @@ async function withRunningJob<T>(
   body: (job: { id: string; attemptId: string }) => Promise<T>,
 ): Promise<T> {
   const db = getDb();
-  for (let attempt = 1; ; attempt++) {
-    const job = { id: mintId(), attemptId: mintAttempt() };
-    try {
-      await db.insert(jobs).values({
-        id: job.id,
-        ownerId,
-        slug,
-        steps: FIXTURE_STEPS,
-        status: "running",
-        attemptId: job.attemptId,
-        leaseExpiresAt: new Date(Date.now() + 600_000),
-        workKey: `fixture-${job.id}`,
-      });
-    } catch (err) {
-      /* `violatesConstraint` walks the whole error chain. Reading
-         `err.cause.constraint` at one level misses Drizzle's wrapper, and a miss
-         here rethrows a contended slot as though it were a bug. */
-      const contended =
-        violatesConstraint(err, "jobs_only_one_running") ||
-        violatesConstraint(err, "jobs_active_slug");
-      if (!contended) throw err;
-      if (attempt >= 40) {
-        throw new Error(
-          `could not start a job for "${slug}" in 20s: either another job holds the single ` +
-            "running slot, or this article already has one queued or running. If nothing is " +
-            "actually working, a row is wedged and waiting will not clear it — look for a " +
-            "`queued` or `running` row in `jobs` and remove it.",
-        );
-      }
-      await new Promise((resolve) => setTimeout(resolve, 500));
-      continue;
-    }
-    try {
-      return await body(job);
-    } finally {
-      await db.delete(jobs).where(eq(jobs.id, job.id));
-    }
+  const job = await insertWhenSlotFree(slug, async () => {
+    const started = { id: mintId(), attemptId: mintAttempt() };
+    await db.insert(jobs).values({
+      id: started.id,
+      ownerId,
+      slug,
+      steps: FIXTURE_STEPS,
+      status: "running",
+      attemptId: started.attemptId,
+      leaseExpiresAt: new Date(Date.now() + 600_000),
+      workKey: `fixture-${started.id}`,
+    });
+    return started;
+  });
+  try {
+    return await body(job);
+  } finally {
+    await db.delete(jobs).where(eq(jobs.id, job.id));
   }
 }
 
diff --git a/tests/store-job-draft.test.ts b/tests/store-job-draft.test.ts
index 89fc3ee..53d9aee 100644
--- a/tests/store-job-draft.test.ts
+++ b/tests/store-job-draft.test.ts
@@ -28,6 +28,7 @@ import { closeDb, getDb } from "../src/db/client.js";
 import { articleRevisions, articles, jobs } from "../src/db/schema.js";
 import { mintId } from "../src/ids.js";
 import { mintAttempt } from "../src/store/jobs.js";
+import { insertWhenSlotFree } from "./helpers/running-slot.js";
 import { DEV_OWNER_ID } from "../src/owner.js";
 import { NotTheLiveAttempt, openOrBeginJobDraft } from "../src/store/pg-revisions.js";
 import type { JobStep } from "../src/types.js";
@@ -82,22 +83,31 @@ async function claimedJob(slug: string): Promise<{ id: string; attemptId: string
       .set({ status: "done", attemptId: null, leaseExpiresAt: null, finishedAt: new Date() })
       .where(and(inArray(jobs.id, made), eq(jobs.status, "running")));
   }
-  const id = mintId();
-  made.push(id);
-  const attemptId = mintAttempt();
-  await getDb()
-    .insert(jobs)
-    .values({
-      id,
-      ownerId: DEV_OWNER_ID,
-      slug,
-      steps: STEPS,
-      status: "running",
-      attemptId,
-      leaseExpiresAt: new Date(Date.now() + 600_000),
-      workKey: `wk-${id}`,
-    });
-  return { id, attemptId };
+  /* The running slot is global (`jobs_only_one_running` is unique on `(true)`),
+     so a concurrent suite or a dev server mid-ingest owns it as legitimately as
+     we do. Without this wait, losing that race surfaced here as a duplicate-key
+     error against whichever case inserted second — a failure naming this file
+     for something that was never its fault. */
+  return await insertWhenSlotFree(slug, async () => {
+    const id = mintId();
+    const attemptId = mintAttempt();
+    await getDb()
+      .insert(jobs)
+      .values({
+        id,
+        ownerId: DEV_OWNER_ID,
+        slug,
+        steps: STEPS,
+        status: "running",
+        attemptId,
+        leaseExpiresAt: new Date(Date.now() + 600_000),
+        workKey: `wk-${id}`,
+      });
+    // Only once the row exists: `made` drives teardown, and an id that never
+    // inserted would have teardown chasing a row that is not there.
+    made.push(id);
+    return { id, attemptId };
+  });
 }
 
 async function cleanUp(slug: string): Promise<void> {
```

## New file: tests/helpers/running-slot.ts
```ts
/**
 * Wait for the database's single `running` slot instead of failing on it.
 *
 * ## Why this exists
 *
 * `jobs_only_one_running` is a unique index on the constant `(true)`, so at
 * most one row in the whole table may be `running` — global concurrency 1, on
 * purpose. `jobs_active_slug` is narrower and covers `queued` too: it fires
 * when that *article* already has a job in flight.
 *
 * Vitest runs test files concurrently, and a second `npm test` beside yours (or
 * a dev server mid-ingest) is another claimant again. So any suite that inserts
 * a `running` row is racing every other one, and the loser does not get a
 * useful failure — it gets `duplicate key value violates unique constraint`
 * from whichever insert happened to be second, pointing at the test that lost
 * rather than at the contention.
 *
 * That is not hypothetical. On 2026-08-28 a full-suite run failed three cases
 * in `tests/store-job-draft.test.ts` this way while its own logic was fine:
 * the file passed alone, passed beside its neighbours, and failed only under
 * the load of all 266 files. `tests/helpers/load-article.ts` had already met
 * this and grown the retry below; this is that code, lifted out so there is one
 * of it rather than one per suite that gets bitten.
 *
 * ## Why retry rather than a lock
 *
 * `tests/store-jobs-parity.test.ts` takes a session advisory lock, and its own
 * docstring is clear that this "covers copies of this file and nothing else" —
 * a lock only excludes the holders that agree to take it, and a real ingest on
 * the same laptop never will. Waiting on the constraint itself needs no
 * agreement from anybody.
 *
 * ## Why the timeout message says what it says
 *
 * Waiting clears a *contended* slot but never a **wedged** one, and "try again
 * later" is useless advice when the answer is "delete the stuck row". So the
 * message has to name both readings.
 */
import { violatesConstraint } from "../../src/store/db-errors.js";

/** 40 × 500ms. Long enough for another suite's fixture, short enough to report. */
const ATTEMPTS = 40;
const GAP_MS = 500;

/**
 * Run `insert` and, if it lost the running slot, wait and run it again.
 *
 * `insert` is called afresh on every attempt rather than being retried as a
 * value, because a job wants a new id per attempt — and because an insert that
 * threw on the constraint wrote nothing, so there is nothing to undo.
 *
 * `what` names the thing being started, and appears in the timeout.
 */
export async function insertWhenSlotFree<T>(
  what: string,
  insert: () => Promise<T>,
  /* Only the tests for this file pass these. They exist so the timeout case is
     testable at all: at the real numbers it takes 20 seconds to reach, and a
     branch nobody can afford to run is a branch nobody has seen work. */
  { attempts = ATTEMPTS, gapMs = GAP_MS }: { attempts?: number; gapMs?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await insert();
    } catch (err) {
      /* `violatesConstraint` walks the whole error chain. Reading
         `err.cause.constraint` at one level misses Drizzle's wrapper, and a miss
         here rethrows a contended slot as though it were a bug. */
      const contended =
        violatesConstraint(err, "jobs_only_one_running") ||
        violatesConstraint(err, "jobs_active_slug");
      if (!contended) throw err;
      if (attempt >= attempts) {
        throw new Error(
          `could not start a job for "${what}" in ${(attempts * gapMs) / 1000}s: either ` +
            "another job holds the single running slot, or this article already has one " +
            "queued or running. If nothing is actually working, a row is wedged and waiting " +
            "will not clear it — look for a `queued` or `running` row in `jobs` and remove it.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }
}
```

## New file: tests/running-slot.test.ts
```ts
/**
 * The wait that stops a contended running slot being reported as a broken test.
 *
 * These cases drive `insertWhenSlotFree` with a fake insert rather than a
 * database, because what is being tested is the *decision* — retry, rethrow, or
 * give up with something a person can act on — and a real second claimant would
 * make that decision hard to arrange and slow to observe.
 *
 * The fake error is shaped like the real one on purpose: SQLSTATE `23505` and a
 * `constraint` name, wrapped in an outer error the way Drizzle wraps pg's. A
 * flat fake would pass against a `violatesConstraint` that only read the top
 * level, which is the bug its own comment warns about.
 */
import { describe, expect, it, vi } from "vitest";

import { insertWhenSlotFree } from "./helpers/running-slot.js";

/** pg's error, under Drizzle's wrapper — two levels, like the real thing. */
function contended(constraint: string): Error {
  const fromPg = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
  });
  return Object.assign(new Error("Failed query: insert into \"spideryarn\".\"jobs\""), {
    cause: fromPg,
  });
}

const FAST = { attempts: 3, gapMs: 1 };

describe("waiting for the single running slot", () => {
  it("tries again when the slot is taken, and returns what the insert returned", async () => {
    const insert = vi
      .fn()
      .mockRejectedValueOnce(contended("jobs_only_one_running"))
      .mockRejectedValueOnce(contended("jobs_only_one_running"))
      .mockResolvedValue({ id: "spya-ok" });

    expect(await insertWhenSlotFree("writes", insert, FAST)).toEqual({ id: "spya-ok" });
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it("waits for the narrower per-article refusal too", async () => {
    const insert = vi
      .fn()
      .mockRejectedValueOnce(contended("jobs_active_slug"))
      .mockResolvedValue({ id: "spya-ok" });

    await expect(insertWhenSlotFree("writes", insert, FAST)).resolves.toEqual({ id: "spya-ok" });
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("calls the insert afresh each time rather than retrying one value", async () => {
    /* A job wants a new id per attempt. If this ever retried a promise instead
       of the function, every attempt would carry the first attempt's id. */
    const ids: string[] = [];
    let n = 0;
    const insert = async () => {
      const id = `spya-${++n}`;
      ids.push(id);
      if (n < 3) throw contended("jobs_only_one_running");
      return id;
    };

    expect(await insertWhenSlotFree("writes", insert, FAST)).toBe("spya-3");
    expect(ids).toEqual(["spya-1", "spya-2", "spya-3"]);
  });

  it("rethrows at once when the failure is not contention", async () => {
    /* The dangerous direction: a real bug swallowed into a 20-second wait and
       then reported as a wedged row. */
    const notContention = Object.assign(new Error("null value in column violates not-null"), {
      code: "23502",
      constraint: "jobs_slug_not_null",
    });
    const insert = vi.fn().mockRejectedValue(notContention);

    await expect(insertWhenSlotFree("writes", insert, FAST)).rejects.toThrow("not-null");
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("gives up saying a row may be wedged, because waiting cannot clear that", async () => {
    const insert = vi.fn().mockRejectedValue(contended("jobs_only_one_running"));

    await expect(insertWhenSlotFree("writes", insert, FAST)).rejects.toThrow(
      /could not start a job for "writes".*wedged/s,
    );
    expect(insert).toHaveBeenCalledTimes(3);
  });
});
```
