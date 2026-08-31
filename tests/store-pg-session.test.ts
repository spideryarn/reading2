/**
 * The transactional store session: artefacts, postcondition, step completion,
 * publication and job transition, in **one** transaction or none of them.
 *
 * `tests/store-session.test.ts` is the filesystem half of the seam, where there
 * is no transaction to hold and the file says so out loud. This is the Postgres
 * half — `src/store/pg-session.ts`, D1b of docs/plans/delete-the-importer.md —
 * and everything here is a claim that could not be made on the filesystem.
 *
 * ## The eight, and what each is for
 *
 * Sixteen cases. Three of them are checks on the other thirteen rather than on the
 * session: the first asks whether `SPIDERYARN_STORE=postgres` actually took and
 * whether the returned object is still guarded, the lock-order one exists
 * because deleting `lockArticleFor` leaves every other case green, and the last
 * one compiles rather than runs.
 *
 * 1. **The positive one, through the real coordinator.** A successful final step
 *    proves all five of: the artefacts landed, the run completed, the revision
 *    was published, the job finished, and `jobs.draft_revision_id` was cleared.
 *    D1a shipped a stage where every test was a refusal, and deleting the write
 *    left all eight green — a negative case cannot see a missing write.
 * 2. A **carried** artefact is what makes a missing part invisible: the draft
 *    already holds the previous revision's arc, so `assertProduced` would pass
 *    over a step that wrote nothing. An empty draft would prove nothing here.
 * 3. A claim that moved on between `beginStep` and `commit` is refused as
 *    `StaleAttemptError` — the name `src/jobs.ts` answers *busy* on — and
 *    nothing it was going to write survives.
 * 4. A failure **injected inside the transaction, after the artefacts and after
 *    the publication**, takes both back with it. A stub standing in for the job
 *    store would fail *beside* the transaction and prove nothing about it, so
 *    the failure is a `not null` the database itself refuses.
 * 5. A Stop that lands while the step runs turns a *release* into a
 *    *cancellation*, and the draft has to be disposed of rather than left for
 *    the sweeper. This is the case that justifies taking the article lock on
 *    commits that will never publish.
 * 6. The preflight reads `session.reads` and never the disk — proved with a
 *    perfectly good `arc.json` sitting in `data/` saying the step is done.
 * 7. A claim where **every step skips** never calls `commit` at all, so the
 *    publication cannot hang off `commit` — and it is written as **two
 *    requests**, because the first request's released work is the only thing
 *    that makes publishing rather than discarding the right answer.
 * 8. A step begun and never committed is re-run by the next claim, rather than
 *    skipped (the artefact is there) or refused (the row is held by an older
 *    attempt).
 *
 * Five more arrived on 2026-08-30 with GPT Sol's review of the built code
 * (docs/plans/delete-the-importer-d1b-sol.md):
 *
 * 9. Case 5 again, **through `advanceJobWith`** rather than through the session:
 *    a settlement nobody reads correctly is a settlement that does nothing, and
 *    it is the coordinator that has to answer `done: true`.
 * 10. A stage that threw leaves its step run `error`, not `running` — nothing
 *     else ever revisits the row `beginStep` committed.
 * 11 and 12. The two endings that reach a job **nobody is inside** —
 *     `failExpired` and Stop on a *queued* job — clear the draft pointer, and
 *     Stop on a *running* one does not.
 * 13. A commit that **rolled back** leaves the step open, and the failure
 *     settled one line later has to close it — the ordering case 10 cannot see.
 * 14. `settleJob` takes an ending and nothing else. Compile-time; there is no
 *     other kind of case a narrowing can have.
 *
 * ## Why it drives the real coordinator for half of them
 *
 * Seven of these are claims about **`advanceJob` driving this session**, not
 * about the session's methods: "the skip check goes through `session.reads`" is
 * a statement about `runStep`, and calling a session helper directly would
 * prove something else. Production is hardwired to `fsStoreSession` and stays
 * that way until D2, so `advanceJobWith` takes the session factory and the step
 * registry as arguments and production supplies today's defaults. GPT Sol,
 * 2026-08-29, docs/plans/delete-the-importer-d1b-design-sol.md finding 4.
 *
 * ## `SPIDERYARN_STORE=postgres`, set before any import runs
 *
 * `src/jobs.ts` picks its job store at module load from `src/store/live.ts`,
 * which reads the flag once. A session that settles the job in Postgres while
 * the coordinator claims it on the filesystem is two stores disagreeing about
 * one row, so the flag has to be set before the import — hence `vi.hoisted`,
 * which runs above the import statements, and hence the restore immediately
 * after them (vitest reuses a worker across files). The first case below asks
 * the module what it actually got, because a flag that silently failed to take
 * would leave every test here passing against the filesystem.
 *
 * ## Why it takes tests/store-jobs-parity.test.ts's advisory lock
 *
 * A global resource, scoped to no owner: `advanceJob` calls `failExpired`,
 * which sweeps **every** expired job and returns a count the parity suite
 * asserts exactly — and since 2026-08-30 a case here calls `failExpired` itself,
 * which is the same collision from the other side. A lock only excludes the
 * holders that agree to take it, so this file takes the same key rather than a
 * key of its own — the point is to exclude *that file*, which is the only other
 * thing in the repo that sweeps and counts.
 *
 * There was a second global resource until 2026-08-30: `jobs_only_one_running`,
 * a unique index on `(true)`, one `running` row at a time in the whole table.
 * It is gone, and the cap is a count now. What is left is per-article — this
 * file's fixed slugs — plus the cap being full. Contention from anything that
 * never takes the lock (a fixture loader, a real ingest on the same laptop) is
 * still handled by waiting, in `insertWhenSlotFree` and `claimWhenSlotFree`.
 *
 * ## The mutation that reddened each, watched on 2026-08-30
 *
 * A test nobody has seen fail is not evidence, and this repo has a long history
 * of checks that pass on the bug they were written for. Each of these was
 * applied to the source, run, and taken out again.
 *
 * - 1, artefacts: delete the `artifacts.write` in `commit` → only the arc-text
 *   assertion fires. Everything else still passed: `assertProduced` read the
 *   **carried** copy back and the step was marked done, published and finished.
 *   That is the D1a failure closed.
 * - 1, run completed: delete `artifacts.finishStep` → the run row stays
 *   `running`.
 * - 1, published: `announce = {}` instead of `publishRevisionIn` → the article
 *   is still on the old revision.
 * - 1, job finished: `releaseStepIn` instead of `finishIn` → the job is
 *   `queued`.
 * - 1, pointer cleared: `fenceJob(…, revisionId)` instead of `(…, null)` in
 *   `publishRevisionIn` → the publication no longer clears it.
 * - 2: delete the `missing.length > 0` throw in `checkProduct` → the commit
 *   **succeeds** and releases the step, over a draft still holding last run's
 *   arc.
 * - 3, the name: `asStaleClaim` rethrows instead of translating →
 *   `NotTheLiveAttempt`, which `src/jobs.ts` would turn into a 500.
 * - 3, the refusal: drop the attempt from `requireLiveJobOwnsDraft` *and* from
 *   `fence()` → the commit succeeds and releases a job it no longer owns.
 *   Dropping either one alone leaves this green: three fences cover it, and
 *   `finishStepRun` takes the same one again.
 * - 4, the publication: make `commit` not a transaction → the pointer stays
 *   moved. 4, the write: `pgArtifactsIn(ref, db)` → the arc survives.
 * - 5, the disposal: skip `discardAfterCancel` → the draft is still a draft and
 *   the pointer still set. 5, the report: make `settlementOf` infer from the
 *   request → it says `released` about a cancelled job.
 * - 6: `stepIsDone(…, pipelineStore)` instead of `session.reads` → the step
 *   skips, on the strength of a file.
 * - 7: skip the publication, or discard instead of publishing → the article is
 *   left on the revision the previous job published.
 * - 8, skipped: `stepInterrupted` returns false **and** `hasArtefacts` stops
 *   reading the run row → the interrupted step is skipped. Either alone leaves
 *   it green.
 * - 8, refused: `beginStepRun`'s `setWhere` stops allowing a row left
 *   `running` to be reopened → `StepRunNotHeld`, and the job errors.
 * - the lock: delete `lockArticleFor` from `commit` → the commit completes
 *   while another connection holds the article row. **Every other case here
 *   stays green under that mutation**, which is why the case exists.
 *
 * And the ones watched on 2026-08-30 for the five cases above, where the point
 * was not only that the case can fail but that the **older, weaker version of it
 * could not**:
 *
 * - 7, the two-request shape: make the session mint a fresh draft on every
 *   request instead of reopening the one the job owns — the way work released by
 *   an earlier request gets lost. The old single-request case, whose draft was a
 *   byte-for-byte copy either way, stayed **green** under it; this one goes red
 *   on `second.ran`. That is the whole reason it was rewritten: its two
 *   candidate outcomes were reader-identical, so no mutation could tell them
 *   apart.
 * - 9: `const ended = settlement.job.status === "done"` in `advanceJobWith`
 *   instead of `settlement.kind === "ended"` → this case goes red on
 *   `done: true`; case 5, which drives the session directly, stays green, and so
 *   does case 1.
 * - 10: delete the `finishStepRun(… "error")` from `settleIn` → the run row is
 *   still `running` after the job has ended.
 * - 11 and 12: delete `draftRevisionId` from `failExpired`'s and
 *   `requestCancel`'s `set` → the pointer survives the ending. Both fixtures
 *   start from a **real** pointer; over a job with no draft the same assertions
 *   pass with the fix deleted.
 * - 13: move `begunStep = undefined` from after the transaction to beside
 *   `artifacts.finishStep` inside it. A JavaScript assignment is not rolled
 *   back, so the session forgets a step whose row went back to `running`, and
 *   the failure settlement walks past it → red on `running` where `error` was
 *   wanted. Case 10 stays green: there the step was never finished at all.
 * - 14: widen `settleJob` back to `JobTransition` → `npm run typecheck` reports
 *   `Unused '@ts-expect-error' directive`.
 * - the lock case, rewritten: replace `lockArticleFor` in `commit` with a 1.5s
 *   sleep. The old *"sleep one second, then assert it has not settled"* stayed
 *   **green** on a commit that takes no lock at all; `pg_blocking_pids` says
 *   "nothing ever queued behind backend N".
 * - case 4, rewritten: give the commit a product `checkProduct` refuses, so it
 *   throws before the transaction opens. The old bare `rejects.toThrow()` stayed
 *   **green**, with every "rolled back" assertion trivially true about a
 *   transaction that never ran; naming the SQLSTATE catches it.
 * - the pointer clear in `discardAfterCancel`: point its `where` at a column
 *   that cannot match → the throw fires and the cancellation rolls back whole.
 *   A `logger.warn` here left the job cancelled and the draft immortal.
 *
 * One mutation could not be run: publishing in a transaction of its own does
 * not fail, it hangs — the outer transaction holds the article and job rows and
 * the inner one waits for them on another connection, and Postgres's deadlock
 * detector cannot see it because one side of the wait is an `await`.
 *
 * Skips loudly when there is no database — see tests/helpers/pg-ready.ts, and
 * note the top-level `await`: a flag checked in `beforeAll` reports *passed*.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { and, eq, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres` before a single import is evaluated.
 *
 * `vi.hoisted` and not a plain statement, for the reason tests/store-guarded.ts
 * spells out: imports are hoisted above every statement in a module, so an
 * ordinary assignment runs *after* the module it is configuring has made up its
 * mind. src/store/live.ts reads the flag once, at first import.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const before = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return before;
});

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, jobs as jobsTable, revisionBlocks, revisionStepRuns } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId, mintUniqueId } from "../src/ids.js";
import { STORAGE_FAILED } from "../src/messages.js";
import { advanceJobWith, type AdvanceParts, type StepRegistry } from "../src/jobs.js";
import { runAsOwner } from "../src/owner.js";
import { STEPS, contextPaths } from "../src/pipeline.js";
import type {
  ConvertedProduct,
  PipelineStep,
  StepContext,
  StepProduct,
} from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { createFsArtifactStore } from "../src/store/artifacts-fs.js";
import type { ArtifactOutcome, ArtifactReads } from "../src/store/artifacts.js";
import { isGuardedStore } from "../src/store/db-errors.js";
import { StaleAttemptError, mintAttempt } from "../src/store/jobs.js";
import { STORE } from "../src/store/live.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { openPgStoreSession } from "../src/store/pg-session.js";
import {
  beginRevision,
  openOrBeginJobDraft,
  publishRevision,
  recordStepRun,
} from "../src/store/pg-revisions.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/revisions.js";
import type { JobTransition, StoreSession } from "../src/store/session.js";
import type {
  Arc,
  Block,
  Glossary,
  Job,
  JobStep,
  OwnerId,
  StepName,
  Tree,
  TweetThread,
} from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { type HeldRunLock, takeRunLock } from "./helpers/run-lock.js";

/* Put back straight away: the modules above have captured the flag, and vitest
   reuses a worker process across files. Leaving it set hands the next file a
   store it did not ask for — which is how tests/store-jobs-parity.test.ts once
   found a stray Postgres job left behind by tests/jobs.test.ts. */
if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

loadEnvLocal();

/**
 * Longer than the 5s default, because four of these wait for the single
 * `running` slot rather than failing on it — see `claimWhenSlotFree`, whose
 * whole point is that a contended slot is a wait and not a fault. At the
 * default a busy laptop turns every one of them into a timeout, which is the
 * least informative way for a suite to report contention.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * This suite's own person, seeded here and taken away again.
 *
 * `jobs_owner_fk` needs a real `auth.users` row, and sharing one with another
 * suite matters for anything owner-wide — the argument is written out at length
 * in tests/store-jobs-parity.test.ts, and the shape (fixed stem, random tail,
 * swept by the stem) is copied from it deliberately so that an interrupted run
 * leaves rows the next run can recognise and remove.
 */
const OWNER_STEM = "000000b7-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

/** Every slug this file makes. Prefixed so the sweep cannot reach anybody else's. */
const SLUG_PREFIX = "test-pg-session-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

const LEASE_MS = 60_000;

/* ---------------------------------------------------- is there a database -- */

/**
 * See the header. The key used to be written out here and in
 * tests/store-jobs-parity.test.ts, one copy each; it is now
 * tests/helpers/run-lock.ts, taken by every suite that needs the running slot
 * rather than by the two files that happened to have met the problem.
 */
let runLock: HeldRunLock | undefined;

const { reachable } = await pgReady({
  suite: "tests/store-pg-session.test.ts",
  /* Schema-qualified, always. `to_regclass('jobs')` is null even on a fully
     migrated database, and this whole suite would then report itself skipped. */
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_step_runs",
    "spideryarn.revision_blocks",
  ],
});

if (reachable) {
  /* After `pgReady`, and only when reachable — a file that is about to skip
     must not sit holding the lock. See tests/helpers/run-lock.ts. */
  runLock = await takeRunLock("tests/store-pg-session.test.ts");
  const lockClient = runLock.client;

  /* The lock is held, so no sibling can be using any of this. Jobs first: they
     reference drafts, and a leftover `running` row from a killed run blocks
     this file's own slugs and counts against the concurrency cap until its
     lease lapses. */
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
    [OWNER, `store-pg-session-${OWNER}@example.invalid`],
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

/**
 * The smallest tree `checkTree` accepts — and it has to really pass, because
 * `publishRevision` runs the full structural check rather than a membership
 * test. A root over one leaf per block.
 */
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
        gist: "A fixture built by tests/store-pg-session.test.ts and nothing else.",
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

/**
 * An arc whose text says which run wrote it.
 *
 * The whole of tests 1, 2 and 4 turns on telling the arc a *previous* revision
 * published from the arc *this* commit wrote, so the marker is the assertion
 * rather than decoration: without it, a commit that wrote nothing and passed
 * the postcondition against the carried copy is indistinguishable from one that
 * worked.
 */
function arcSaying(slug: string, blocks: Block[], text: string): Arc {
  return {
    version: "arc/1",
    generator: "fixture",
    slug,
    entries: [{ range: [blocks[0]?.id ?? "", blocks[blocks.length - 1]?.id ?? ""], text }],
  };
}

/**
 * A thread whose text says which run wrote it — the second artefact, and it
 * exists only so that a job can have a step that is **already current**.
 *
 * The two-request case below needs a job of two steps where the second one
 * skips, and a real `tweets` stamp compares a block hash, a prompt version and a
 * model id. The fake `tweets` step has no stamp, so all this has to satisfy is
 * `SHAPE.tweets` — a `tweets` array — and the run row beside it.
 */
function threadSaying(slug: string, text: string): TweetThread {
  return {
    version: "tweets/1",
    generator: "fixture",
    slug,
    sourceHash: "unstamped",
    limit: 280,
    tweets: [{ text, chars: text.length }],
    generatedAt: "2026-08-29T00:00:00.000Z",
    elapsedMs: 0,
  } as TweetThread;
}

/** One step run, as the seam records it — see src/store/revisions.ts. */
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
  /** The revision the article is serving. Every draft below is copied from it. */
  readonly publishedRevisionId: string;
  readonly blocks: Block[];
}

/**
 * Publish an article the way the pipeline would, and no other way.
 *
 * `beginRevision` → blocks → the columns → the step runs → `publishRevision`,
 * with the publication gate run rather than routed around. `arcText` is
 * optional because two of the tests need a draft that carries an arc forward
 * and two need one that does not.
 *
 * `withThread` is the same choice for `tweets`, and only the two-request case
 * asks for it: a step that is *already current* on the published revision is
 * what makes a second request skip everything while a first request's work sits
 * unpublished in the draft.
 */
async function publishArticle(
  slug: string,
  arcText?: string,
  withThread = false,
): Promise<Fixture> {
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
      excerpt: "A fixture built by tests/store-pg-session.test.ts.",
      finalUrl: `https://example.com/${slug}`,
      fetchedAt: new Date("2026-08-29T00:00:00.000Z"),
      stampedHtml: blocks.map((b) => b.html).join("\n"),
      tree: treeFor(slug, blocks),
      ...(arcText === undefined ? {} : { arc: arcSaying(slug, blocks, arcText) }),
      ...(withThread ? { tweets: threadSaying(slug, "the thread that was already there") } : {}),
    })
    .where(eq(articleRevisions.id, begun.revisionId));

  for (const name of ["fetch", "extract", "blocks"] as StepName[]) {
    await stepRun(begun.revisionId, name);
  }
  /* The publication gate compares this against `hashBlocks` of the stored
     blocks and refuses when they differ, so it is the one run row that has to
     carry a real hash. */
  await stepRun(begun.revisionId, "toc", hashBlocks(blocks));
  if (arcText !== undefined) await stepRun(begun.revisionId, "arc");
  /* The column is not enough on its own: `hasArtefacts` reads the run row
     first and answers `false` without one, so a thread with no `done` run
     beside it is a step that would run again rather than skip. */
  if (withThread) await stepRun(begun.revisionId, "tweets");

  await publishRevision({ slug, revisionId: begun.revisionId });

  return { slug, articleId: begun.articleId, publishedRevisionId: begun.revisionId, blocks };
}

/* ----------------------------------------------------------- the fake step -- */

/** What the fake step saw, so a test can say whether it ran at all. */
interface StepLog {
  calls: number;
  /** What `session.reads` answered about the arc when the step was called. */
  sawArc: Arc | null;
}

/**
 * A **converted** `arc`: it writes nothing itself and returns the artefact.
 *
 * A real step name, because `StepRegistry` is keyed by `StepName` and the
 * coordinator looks the step up by the name on the job. `arc` was the first
 * stage converted for real (2026-08-31), which makes it the honest stand-in —
 * and it declares exactly one artefact, so a product missing that one artefact
 * is a product missing everything, which is what test 2 wants to say.
 *
 * No `stamp` and no `isDone`, so `stepIsDone` reduces to *is the artefact there
 * and is the step not interrupted* — the two questions tests 6 and 8 are about.
 *
 * ## The cast, and why it is not a fixture inventing an impossible state
 *
 * Most callers below hand back `{ detail: "" }` with no `parts`, because what
 * they are testing is that the coordinator **refuses** exactly that. Since
 * `arc` came off `LEGACY_UNCONVERTED_STEPS` the type system forbids it:
 * `PipelineStep<"arc">["run"]` returns `ConvertedProduct`, where `parts` is
 * required. That is the compile-time half of the same rule and it is working.
 *
 * The runtime half still has to be tested, and it is not redundant. The
 * transactional session asks `checkProduct` with an **empty** unconverted set,
 * so it refuses a product with no `parts` for *every* step — including the four
 * still on the legacy list, whose types permit `{ detail }` today. A type is
 * also only a claim about this repository's own callers. So the fixture reaches
 * past the compiler on purpose, in one place, with the reason written down —
 * rather than each call site casting, or the whole test being rewritten around
 * a still-legacy step and quietly ceasing to say anything about a converted one.
 */
function fakeArc(
  produce: (ctx: StepContext, store: ArtifactReads) => Promise<StepProduct>,
  log?: StepLog,
): PipelineStep<"arc"> {
  return {
    name: "arc",
    label: "Reading the shape of the argument",
    outputs: (ctx) => [path.join(ctx.dir, "arc.json")],
    produces: ["arc"],
    async run(ctx, store) {
      if (log) {
        log.calls += 1;
        log.sawArc = await store.read(ctx.slug, "arc", "arc");
      }
      return (await produce(ctx, store)) as ConvertedProduct;
    },
  };
}

/**
 * A **converted** `tweets`, and the only thing it is for is skipping.
 *
 * The two-request case needs a job whose *second* step is already current on the
 * second request, and the real `tweets` stamp compares a block hash, a prompt
 * version and a model id — none of which a fixture can honestly supply. This has
 * no stamp, so `stepIsDone` reduces to *is the thread there and is the step not
 * interrupted*, which is the question that case is about. It throws if it is
 * ever run, because in that case the test is no longer testing what it says.
 */
function fakeTweets(): PipelineStep<"tweets"> {
  return {
    name: "tweets",
    label: "Writing the thread",
    outputs: (ctx) => [path.join(ctx.dir, "tweets.json")],
    produces: ["tweets"],
    async run() {
      throw new Error("the fake tweets step must not run: the fixture published a current thread");
    },
  };
}

/** The registry the coordinator is driven with: the real steps, with fakes over them. */
function registryWith(step: PipelineStep<"arc">, tweets?: PipelineStep<"tweets">): StepRegistry {
  return { ...STEPS, arc: step, ...(tweets ? { tweets } : {}) };
}

/** The parts `advanceJobWith` takes — a Postgres session, and that registry. */
function partsWith(
  step: PipelineStep<"arc">,
  tweets?: PipelineStep<"tweets">,
  leaseMs?: number,
): AdvanceParts {
  return {
    session: (job, attempt) =>
      openPgStoreSession({ slug: job.slug, job: { id: job.id, attemptId: attempt } }),
    steps: registryWith(step, tweets),
    ...(leaseMs === undefined ? {} : { leaseMs }),
  };
}

/**
 * A claim short enough that one step fits and the next does not.
 *
 * `tweets` is budgeted at 90s, and the walk keeps its claim only while
 * `deadlineAt - now` covers the next step — so a 100s lease, less the 20s
 * margin, leaves 80s and the walk hands back **after** `arc` rather than before
 * it. There is no budget check in front of the *first* step, which is what
 * makes exactly one step run.
 *
 * This is how the two-request case survives claim-once at all. Before the walk,
 * a release between steps was the ordinary path and the test got it for free;
 * now a deliberate hand-back is the only way a job is left `queued` holding a
 * draft with work in it, and that is the state this case exists to publish.
 */
const ONE_STEP_LEASE_MS = 100_000;

/* ------------------------------------------------------------- the job row -- */

function stepsOf(names: StepName[], force = false): JobStep[] {
  return names.map((name) => ({
    name,
    label: STEPS[name].label,
    status: "pending" as const,
    ...(force ? { force: true } : {}),
  }));
}

/**
 * A `queued` job for this slug, waiting for the article's own slot.
 *
 * `jobs_active_slug` covers `queued` as well as `running`, so this can lose to
 * a leftover row for the same article; `insertWhenSlotFree` waits on the
 * constraint rather than on anybody's agreement.
 */
async function queueJob(slug: string, names: StepName[], force = false): Promise<string> {
  const db = getDb();
  return await insertWhenSlotFree(slug, async () => {
    const id = mintId();
    await db.insert(jobsTable).values({
      id,
      ownerId: OWNER,
      slug,
      steps: stepsOf(names, force),
      status: "queued",
      workKey: `pg-session-${id}`,
    });
    return id;
  });
}

/**
 * Claim it, waiting out anybody else who got there first.
 *
 * `claim` answers `busy` rather than throwing when it is refused — this article
 * already has a job in flight, or the counted concurrency cap is full — so this
 * is the `insertWhenSlotFree` of the claim path: the same contention, reported
 * differently. Before 2026-08-30 the refusal that mattered was
 * `jobs_only_one_running`, one running job anywhere; the wait outlived it
 * because `busy` did. A `busy` that never clears is named in the
 * failure rather than left as a bare assertion, because the two readings —
 * somebody else is working, versus a row is wedged — want different repairs.
 */
async function claimWhenSlotFree(id: string, attempt: string): Promise<Job> {
  for (let n = 1; n <= 40; n++) {
    /* A cap high enough to be beside the point: this case is not about it. */
    const outcome = await pgJobStore.claim(id, OWNER, attempt, LEASE_MS, 4);
    if (outcome.kind === "claimed") return outcome.job;
    if (outcome.kind !== "busy") {
      throw new Error(`claiming ${id} answered ${outcome.kind}, which this fixture cannot use`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `could not claim ${id} in 20s: something else is already running on this article, or ` +
      "the concurrency cap is full. If nothing is actually working, a `running` row is wedged " +
      "and waiting will not clear it.",
  );
}

/**
 * `advanceJobWith`, waiting out anybody else who got there first.
 *
 * The coordinator's own answer to a refused claim is `busy: true` with the job
 * still `queued` — the same contention `claimWhenSlotFree` waits on, arriving
 * through the endpoint rather than through the store. Watched happening on
 * 2026-08-30 while a peer's suite was running: three cases here failed
 * asserting `ran` was null, which says nothing about the session at all.
 *
 * **`busy` with the job no longer queued is not contention** and is returned
 * rather than retried, because that is a real answer about this job — Stop was
 * pressed, or the claim went somewhere else — and swallowing it would turn a
 * result the tests want to see into a twenty-second wait.
 */
async function advanceWhenSlotFree(id: string, parts: AdvanceParts) {
  for (let n = 1; n <= 40; n++) {
    const advanced = await advanceJobWith(id, parts);
    if (!advanced?.busy || advanced.job.status !== "queued") return advanced;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `advancing ${id} answered busy for 20s: something else is already running on this ` +
      "article, or the concurrency cap is full. If nothing is actually working, a `running` " +
      "row is wedged and waiting will not clear it.",
  );
}

/** A claimed job with a session over its draft — the shape production builds. */
interface Claimed {
  readonly jobId: string;
  readonly attempt: string;
  readonly revisionId: string;
  readonly session: StoreSession;
  readonly steps: JobStep[];
}

async function claimWithSession(slug: string, names: StepName[]): Promise<Claimed> {
  const jobId = await queueJob(slug, names);
  const attempt = mintAttempt();
  const job = await claimWhenSlotFree(jobId, attempt);
  const draft = await openOrBeginJobDraft({ slug, job: { id: jobId, attemptId: attempt } });
  const session = await openPgStoreSession({ slug, job: { id: jobId, attemptId: attempt } });
  return { jobId, attempt, revisionId: draft.revisionId, session, steps: job.steps };
}

/** The context `runStep` would have built, for the cases that call `commit` directly. */
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

async function jobRow(id: string) {
  const [row] = await db().select().from(jobsTable).where(eq(jobsTable.id, id)).limit(1);
  return row;
}

async function revisionRow(id: string) {
  const [row] = await db()
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, id))
    .limit(1);
  return row;
}

async function articleRow(slug: string) {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  return row;
}

async function runRow(revisionId: string, step: StepName) {
  const [row] = await db()
    .select()
    .from(revisionStepRuns)
    .where(and(eq(revisionStepRuns.revisionId, revisionId), eq(revisionStepRuns.stepName, step)))
    .limit(1);
  return row;
}

/**
 * The one draft this article's job gave up on.
 *
 * Needed because a failed ending **clears** `jobs.draft_revision_id` on its way
 * past, so by the time a test can look, the job no longer names the revision it
 * was working in. Every case here publishes under its own slug, so there is
 * never more than one.
 */
async function failedDraftOf(articleId: string) {
  const rows = await db()
    .select({ id: articleRevisions.id })
    .from(articleRevisions)
    .where(and(eq(articleRevisions.articleId, articleId), eq(articleRevisions.status, "failed")));
  if (rows.length !== 1) {
    throw new Error(`expected exactly one failed draft for article ${articleId}, found ${rows.length}`);
  }
  return rows[0]!.id;
}

/**
 * Wait until some other backend is really blocked by `pid` — or say so and fail.
 *
 * **A sleep cannot make this claim**, and the version of the lock case that
 * slept a second could not tell a commit waiting on a row lock from a commit
 * that was merely slower than the sleep. `pg_blocking_pids` names the blocker,
 * so the answer is about *this* transaction rather than about the laptop. Copied
 * from tests/store-job-draft.test.ts, which reached the same conclusion first.
 */
async function waitUntilBlockedBy(pid: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const found = await db().execute(
      sql`select count(*)::int as n from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`,
    );
    if (Number((found.rows[0] as { n: number | string }).n) > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`nothing ever queued behind backend ${pid} — the commit under test never blocked`);
}

/** The arc text on a revision, or null — the marker every write assertion reads. */
async function arcTextOf(revisionId: string): Promise<string | null> {
  const row = await revisionRow(revisionId);
  const arc = row?.arc as Arc | null;
  return arc?.entries[0]?.text ?? null;
}

/* ------------------------------------------------------------------ tests -- */

/**
 * One case, run as this suite's own person from its first statement.
 *
 * Not decoration. `lockOrCreateArticle` refuses a slug that belongs to somebody
 * else, and `currentOwnerId()` outside a request is the *environment's* owner —
 * so a `commit` called at the top of a test body is a stranger writing into
 * this file's article, and what comes back is `PublishRefused: the slug already
 * belongs to another reader`, which says nothing about the session. Watched
 * happening, 2026-08-30.
 */
const mine = (name: string, body: () => Promise<void>) =>
  it(name, () => runAsOwner(OWNER, body));

when("the transactional session", () => {
  /* Nothing to build once and share: each case publishes its own article under
     its own slug, because half of them end the job and clear the draft, and a
     shared fixture would make the order of the file part of the test. */

  /**
   * **Take the job away after every case**, including the ones that
   * deliberately leave a job mid-claim.
   *
   * These cases share fixture slugs, so a case that ends with its job still
   * `running` does not merely leak a row — it stops the *next* case claiming at
   * all, and the symptom is a twenty-second wait ending in a timeout somewhere
   * unrelated. It was worse when `jobs_only_one_running` was there: one leak
   * blocked every job suite in the repo, not just this file. Deleting rather than finishing, for the reason
   * tests/helpers/load-article.ts gives: marking a job done would write
   * synthetic history that reads as a real ingest, while a deleted row says the
   * true thing — this job never existed.
   *
   * Only this owner's, and only the two live states: a `done` row is history
   * the assertions above have already read.
   */
  afterEach(async () => {
    if (!reachable) return;
    await db()
      .delete(jobsTable)
      .where(
        and(eq(jobsTable.ownerId, OWNER), inArray(jobsTable.status, ["queued", "running"])),
      );
  });

  afterAll(async () => {
    if (!reachable) return;
    const database = getDb();
    await database.delete(jobsTable).where(eq(jobsTable.ownerId, OWNER));
    const mine = await database.select({ id: articles.id }).from(articles).where(eq(articles.ownerId, OWNER));
    for (const { id } of mine) {
      /* The pointer lets go first, or the revision cannot cascade away — the
         order tests/store-import-convergence.test.ts works out at length. */
      await database.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
      await database.delete(articles).where(eq(articles.id, id));
    }
    await closeDb();
    if (runLock) {
      /* On the lock's own connection, so the person is taken away while this
         file still owns the slot rather than in the gap after letting go. */
      await runLock.client.query("delete from auth.users where id = $1", [OWNER]);
      await runLock.release();
    }
    await rm(path.join(ROOT, "data", `${SLUG_PREFIX}preflight`), { recursive: true, force: true });
  });

  /**
   * **The flag took, and the object is wrapped.**
   *
   * Both halves are checks on the other checks rather than on the session. A
   * `SPIDERYARN_STORE` that failed to take leaves every case below driving the
   * *filesystem* job store — green, and about nothing. And `guardDbStore`
   * returns a new object, so a wrapper that had quietly stopped being applied
   * would only show up as a raw Drizzle error on somebody's homepage.
   */
  mine("runs against the Postgres job store, behind the error guard", async () => {
    expect(STORE, "the vi.hoisted flag did not reach src/store/live.ts").toBe("postgres");

    const fixture = await publishArticle(`${SLUG_PREFIX}guard`, "old");
    const claimed = await claimWithSession(fixture.slug, ["arc"]);
    expect(isGuardedStore(claimed.session)).toBe("session");
    expect(isGuardedStore(claimed.session.reads)).toBe("session.reads");

    /* The generics survived the wrapper. `read<K>` is a method rather than an
       arrow property precisely so the type parameter is not lost, and a
       rebinding wrapper that collapsed it would hand every caller `unknown` —
       which compiles, and then reads the wrong field off the artefact. This
       line is the compile-time half; the `?? null` is the runtime one. */
    const arc: Arc | null = await claimed.session.reads.read(fixture.slug, "arc", "arc");
    expect(arc?.entries[0]?.text).toBe("old");
    /* `readBaseline` too, which is the other generic method and the one nothing
       else here calls. `Glossary` on the left is the assertion: a wrapper that
       lost the parameter would make this `ArtifactOutcome<unknown>` and the
       line would not compile. */
    const baseline: ArtifactOutcome<Glossary> = await claimed.session.reads.readBaseline(
      fixture.slug,
      "glossary",
      "glossary",
    );
    expect(baseline.state).toBe("absent");
  });

  /* ------------------------------------------------------------------ 1 -- */

  /**
   * **The one that matters.** Five things, and the write is the one a suite of
   * refusals cannot see.
   *
   * The article is published *with* an arc, and the job's `arc` step is
   * `force`d — which is exactly what a refresh is. So the draft carries an arc
   * forward, `assertProduced` would pass over a commit that wrote nothing, and
   * the only thing that can tell the two apart is reading the text back.
   */
  mine("writes, completes, publishes, finishes and clears the pointer", async () => {
    const slug = `${SLUG_PREFIX}commit`;
    const fixture = await publishArticle(slug, "the carried arc");

    const seen: StepLog = { calls: 0, sawArc: null };
    const step = fakeArc(
      async (ctx) => ({
        detail: "one entry",
        parts: { arc: arcSaying(ctx.slug, fixture.blocks, "the committed arc") },
      }),
      seen,
    );

    const jobId = await queueJob(slug, ["arc"], true);
    const advanced = await advanceWhenSlotFree(jobId, partsWith(step));

    expect(advanced?.ran).toBe("arc");
    expect(advanced?.done).toBe(true);
    expect(advanced?.job.status).toBe("done");
    expect(seen.calls, "the step has to have actually run").toBe(1);
    /* The carried copy, seen from inside the run phase. It is what makes the
       assertion below a real one: the postcondition could read this back and
       call the step finished. */
    expect(seen.sawArc?.entries[0]?.text).toBe("the carried arc");

    /* 3. The revision was published — and it is a *new* one, not the fixture's. */
    const article = await articleRow(slug);
    const published = article?.currentRevisionId;
    expect(published).not.toBe(fixture.publishedRevisionId);
    expect(published).toBeTruthy();
    expect((await revisionRow(published as string))?.status).toBe("published");

    /* 1. The artefacts landed, and they are this run's rather than the copy. */
    expect(await arcTextOf(published as string)).toBe("the committed arc");

    /* 2. The run completed, under this claim's own attempt. */
    const run = await runRow(published as string, "arc");
    expect(run?.status).toBe("done");
    expect(run?.attemptId).toBeTruthy();

    /* 4 and 5. The job is over and it no longer holds a draft, so the sweeper
       is free to reclaim anything it left behind. */
    const job = await jobRow(jobId);
    expect(job?.status).toBe("done");
    expect(job?.draftRevisionId).toBeNull();
  });

  /* ------------------------------------------------------------------ 2 -- */

  /**
   * A product missing the one artefact it declares, over a draft that already
   * holds one.
   *
   * The refusal has to happen **before** anything is written, and the carried
   * copy is what makes that necessary rather than tidy: `assertProduced` asks
   * whether the arc is readable now, and it is — `beginDraftIn` copied it in
   * before the stage ran. So without `checkProduct` the step is marked done,
   * the job moves on, and the article keeps last week's arc under a green tick.
   */
  mine("refuses a missing part that the carried artefact would have hidden", async () => {
    const slug = `${SLUG_PREFIX}carried`;
    await publishArticle(slug, "the carried arc");
    const claimed = await claimWithSession(slug, ["arc", "tweets"]);
    const ctx = contextFor(slug);

    /* The state that makes this test mean something, asserted rather than
       assumed: the draft really can answer `read` with an arc. */
    const carried = await claimed.session.reads.read(slug, "arc", "arc");
    expect(carried?.entries[0]?.text).toBe("the carried arc");

    await claimed.session.beginStep(slug, "arc");
    const release: JobTransition = {
      kind: "release",
      jobId: claimed.jobId,
      attempt: claimed.attempt,
      steps: claimed.steps,
      fields: {},
    };

    await expect(
      claimed.session.commit(
        ctx,
        fakeArc(async () => ({ detail: "nothing at all" })),
        claimed.attempt,
        /* `{}` rather than absent, because an empty object is the sneakier of
           the two: it is truthy, it has none of the declared kinds, and it
           would call `write` with nothing in it. */
        { detail: "nothing at all", parts: {} },
        release,
      ),
      /* **The sentence, not merely a rejection.** `checkProduct` refuses before
         the transaction opens, so nothing has been near the database — and the
         session goes through `guardDbStore`, which until 2026-08-30 replaced
         this with *"this app asked its database for something it would not
         do"*. That is false, and it drops the half naming the artefact. See
         `ProductRefused` in src/store/artifacts.ts. */
    ).rejects.toThrow(/returned a product missing arc/);

    expect(await arcTextOf(claimed.revisionId), "the carried arc must be untouched").toBe(
      "the carried arc",
    );
    expect((await runRow(claimed.revisionId, "arc"))?.status, "the step is not done").toBe(
      "running",
    );
    const job = await jobRow(claimed.jobId);
    expect(job?.status, "the claim was not released").toBe("running");
    expect(job?.draftRevisionId).toBe(claimed.revisionId);
  });

  /* ------------------------------------------------------------------ 3 -- */

  /**
   * The claim moved on between `beginStep` and `commit`.
   *
   * Modelled as the attempt token changing while the job stays `running`, which
   * is what a rescue followed by a fresh claim leaves behind. The refusal has
   * to arrive as `StaleAttemptError` and not as this store's own
   * `NotTheLiveAttempt`: `src/jobs.ts` answers *busy, ask again* on an
   * `instanceof` of the first, and would turn the second into a 500 — under
   * Postgres only, and under contention only.
   */
  mine("refuses a commit whose claim moved on, and leaves the draft as it was", async () => {
    const slug = `${SLUG_PREFIX}stale`;
    await publishArticle(slug, "the carried arc");
    const claimed = await claimWithSession(slug, ["arc", "tweets"]);
    const ctx = contextFor(slug);

    await claimed.session.beginStep(slug, "arc");

    /* Somebody else now owns the job. The row stays `running`, so this is the
       fence and not the status check that refuses. */
    const stolen = mintAttempt();
    await db().update(jobsTable).set({ attemptId: stolen }).where(eq(jobsTable.id, claimed.jobId));

    await expect(
      claimed.session.commit(
        ctx,
        fakeArc(async () => ({ detail: "" })),
        claimed.attempt,
        { detail: "one entry", parts: { arc: arcSaying(slug, [], "the arc nobody wanted") } },
        {
          kind: "release",
          jobId: claimed.jobId,
          attempt: claimed.attempt,
          steps: claimed.steps,
          fields: {},
        },
      ),
    ).rejects.toBeInstanceOf(StaleAttemptError);

    expect(await arcTextOf(claimed.revisionId)).toBe("the carried arc");
    expect((await runRow(claimed.revisionId, "arc"))?.status).toBe("running");
    const job = await jobRow(claimed.jobId);
    expect(job?.status).toBe("running");
    expect(job?.attemptId).toBe(stolen);
    expect(job?.draftRevisionId).toBe(claimed.revisionId);
  });

  /* ------------------------------------------------------------------ 4 -- */

  /**
   * The artefacts, the publication and the job transition roll back together.
   *
   * **The failure is injected inside the transaction and after both of the
   * first two**, which is the whole point: a stub standing in for the job store
   * would fail *beside* the transaction and prove nothing about it. A job
   * ending with a status the `jobs_status` check constraint refuses is a real
   * in-transaction failure, and it lands in `finishIn` — after `write`, after
   * `finishStepRun`, and after `publishRevisionIn` has already moved
   * `articles.current_revision_id`.
   *
   * It is also finding 5 of the design review made testable from the outside:
   * `publishRevisionIn` returns its log fields rather than printing them,
   * because a `logger.info` in there would announce this publication and then
   * have it taken away one statement later.
   */
  mine("takes the artefacts and the publication back when the settlement fails", async () => {
    const slug = `${SLUG_PREFIX}rollback`;
    const fixture = await publishArticle(slug, "the carried arc");
    const claimed = await claimWithSession(slug, ["arc"]);
    const ctx = contextFor(slug);

    await claimed.session.beginStep(slug, "arc");

    await expect(
      claimed.session.commit(
        ctx,
        fakeArc(async () => ({ detail: "" })),
        claimed.attempt,
        { detail: "one entry", parts: { arc: arcSaying(slug, fixture.blocks, "the lost arc") } },
        {
          kind: "end",
          jobId: claimed.jobId,
          attempt: claimed.attempt,
          /* **A `done` ending, so the publication really runs** — and a
             `steps` the `not null` on that column refuses, so `finishIn` is
             what fails. Not reachable through the type, which is the point:
             this has to be a database-level failure arriving *after* the
             artefacts, the step completion and the publication have all
             succeeded, and there is no other way to land one exactly there.
             An ending status the `jobs_status` check refuses was the first
             attempt and was wrong: it also picks the *other* branch of
             `settleIn`, so the draft was failed rather than published and the
             test proved nothing about a publication. */
          ending: { status: "done", steps: null as unknown as JobStep[] },
        },
      ),
      /* **The exact failure, and `23502` is the load-bearing half.** A bare
         `rejects.toThrow()` accepts an error from anywhere at all — an early
         write refused, a validation mistake in the fixture, a typo in the
         transition — and every "rolled back" assertion below is then trivially
         true about a transaction that never reached the publication. Naming the
         SQLSTATE says the failure was the `not null` on `jobs.steps`, which is
         the one statement that lands *after* the write, the step completion and
         the publication have all succeeded.

         And it is the scrubbed sentence rather than Postgres's, which is the
         second claim: `finishIn` is a free function outside `guardDbStore`
         (src/store/pg-jobs.ts), so this is what proves its rejection still comes
         out through the session's guard with the query text and the bound
         parameters taken off it. GPT Sol, 2026-08-30,
         docs/plans/delete-the-importer-d1b-sol.md finding 3. */
    ).rejects.toMatchObject({
      name: "StoreFailure",
      message: STORAGE_FAILED.message,
      code: "23502",
    });

    /* The publication first, because it is the statement that succeeded last
       and therefore the one a half-transaction would leave standing. */
    expect(
      (await articleRow(slug))?.currentRevisionId,
      "the publication was taken back with the settlement that failed",
    ).toBe(fixture.publishedRevisionId);
    expect(await arcTextOf(claimed.revisionId), "and so was the write").toBe("the carried arc");
    expect((await revisionRow(claimed.revisionId))?.status, "the draft is still a draft").toBe(
      "draft",
    );
    expect((await runRow(claimed.revisionId, "arc"))?.status).toBe("running");
    const job = await jobRow(claimed.jobId);
    expect(job?.status).toBe("running");
    expect(job?.draftRevisionId).toBe(claimed.revisionId);
  });

  /* ------------------------------------------------------------------ 5 -- */

  /**
   * Stop arrived while the step ran, so the release ends the job instead.
   *
   * `releaseStepIn`'s own `case when cancelling` is the authority on which of
   * the two happened, and the caller must read the answer off the row rather
   * than off the request it made — otherwise `/advance` reports `done: false`
   * about a job that is over, and `noteEnded` never runs.
   *
   * And the draft has to be **disposed of**. Nothing else clears
   * `jobs.draft_revision_id` on a cancellation, and `sweepAbandonedDrafts`
   * treats any job's pointer as ownership, so a draft left here is one the
   * sweeper spares for ever. This is the case that justifies taking the article
   * lock at the top of a commit that was never going to publish: the disposal
   * needs it, and nothing before this point knew the disposal was coming.
   */
  mine("reports the cancellation a release resolved into, and disposes of the draft", async () => {
    const slug = `${SLUG_PREFIX}stop`;
    const fixture = await publishArticle(slug, "the carried arc");
    const claimed = await claimWithSession(slug, ["arc", "tweets"]);
    const ctx = contextFor(slug);

    await claimed.session.beginStep(slug, "arc");
    /* The reader presses Stop, through the store's own method rather than an
       UPDATE, so this is the state production actually reaches. */
    await pgJobStore.requestCancel(claimed.jobId, OWNER);
    expect((await jobRow(claimed.jobId))?.cancelling).toBe(true);

    const settlement = await claimed.session.commit(
      ctx,
      fakeArc(async () => ({ detail: "" })),
      claimed.attempt,
      { detail: "one entry", parts: { arc: arcSaying(slug, fixture.blocks, "the stopped arc") } },
      {
        kind: "release",
        jobId: claimed.jobId,
        attempt: claimed.attempt,
        steps: claimed.steps,
        fields: {},
      },
    );

    expect(settlement.kind, "a release that cancelled is an ending").toBe("ended");
    expect(settlement.kind === "ended" && settlement.ending.status).toBe("cancelled");
    expect(settlement.kind !== "kept" && settlement.job.status).toBe("cancelled");

    expect((await revisionRow(claimed.revisionId))?.status, "the draft was failed").toBe("failed");
    expect(
      (await jobRow(claimed.jobId))?.draftRevisionId,
      "the pointer was cleared, or the sweeper spares this draft for ever",
    ).toBeNull();
    expect(
      (await articleRow(slug))?.currentRevisionId,
      "a cancellation never moves the reader",
    ).toBe(fixture.publishedRevisionId);
  });

  /**
   * The same cancellation, **through the coordinator that has to act on it.**
   *
   * The case above drives `session.commit` directly and asks what the session
   * returned. That is half the claim: the settlement is a value, and a value
   * nobody reads correctly is a value that does nothing. `advanceJobWith` is
   * what has to answer `done: true` here — a `done: false` means the browser
   * keeps polling a job that is over, `noteEnded` never runs, and the reader
   * watches a card that will never move again.
   *
   * Stop is pressed **while the step is inside `run`**, through the store's own
   * method, and the step is gated so that it really is. It does not go through
   * `cancelJob`, deliberately: that aborts the local controller as well, and
   * then `runStep` unwinds through its own catch and never reaches the release.
   * The case this is about is the one where the flag arrives from *another
   * instance* — the step finishes normally and the release is where the cancel
   * lands. GPT Sol, 2026-08-30,
   * docs/plans/delete-the-importer-d1b-sol.md finding 5.
   */
  mine("answers done when a Stop lands while the coordinator is inside a step", async () => {
    const slug = `${SLUG_PREFIX}coordinator-stop`;
    const fixture = await publishArticle(slug, "the carried arc");

    let entered!: () => void;
    const inTheStep = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const seen: StepLog = { calls: 0, sawArc: null };
    const step = fakeArc(async (ctx) => {
      entered();
      await gate;
      return {
        detail: "one entry",
        parts: { arc: arcSaying(ctx.slug, fixture.blocks, "the stopped arc") },
      };
    }, seen);

    /* Two steps, so the transition the coordinator works out is a *release*.
       With one step it would be an `end` and this would be an ordinary finish. */
    const jobId = await queueJob(slug, ["arc", "tweets"], true);
    const advancing = advanceWhenSlotFree(jobId, partsWith(step, fakeTweets()));
    /* If the advance ever returns without entering the step — a wedged running
       slot, a claim that went elsewhere — this says so instead of hanging until
       the 60s timeout, which says nothing about anything. */
    const returnedFirst = advancing.then(() => {
      throw new Error("the advance returned without ever entering the step");
    });
    returnedFirst.catch(() => {});
    await Promise.race([inTheStep, returnedFirst]);

    const draftId = (await jobRow(jobId))?.draftRevisionId;
    expect(draftId, "the claim opened a draft before the step ran").toBeTruthy();

    await pgJobStore.requestCancel(jobId, OWNER);
    expect((await jobRow(jobId))?.cancelling, "the flag is set and the job is still running").toBe(
      true,
    );
    release();

    const advanced = await advancing;
    expect(advanced?.ran).toBe("arc");
    expect(advanced?.done, "a release that resolved to a cancellation is an ending").toBe(true);
    expect(advanced?.job.status).toBe("cancelled");
    expect(advanced?.busy).toBe(false);

    expect((await revisionRow(draftId as string))?.status, "the draft was disposed of").toBe(
      "failed",
    );
    const job = await jobRow(jobId);
    expect(job?.status).toBe("cancelled");
    expect(job?.draftRevisionId, "or the sweeper spares this draft for ever").toBeNull();
    expect(
      (await articleRow(slug))?.currentRevisionId,
      "a cancellation never moves the reader",
    ).toBe(fixture.publishedRevisionId);
  });

  /* ------------------------------------------------ the step run that failed -- */

  /**
   * A stage that threw leaves a step run saying `error`, **not `running`.**
   *
   * `beginStep` commits a row saying this step is in flight — on purpose, and in
   * its own transaction, so that an interrupted step leaves a mark. Nothing else
   * ever revisits that row: `settleJob` failed the draft and ended the job and
   * walked past it, so the draft kept a step claiming to be running for as long
   * as the row survived. `stepInterrupted` reads exactly that status, and it is
   * what `stepIsDone` refuses on.
   *
   * The order inside the transaction is the whole of the fix and is asserted by
   * this passing at all: `finishStepRun` takes `requireLiveJobOwnsDraft`, which
   * wants the job still `running` and still pointing at this draft — so marking
   * the step after `failRevisionIn` or after `finishIn` would be refused.
   * GPT Sol, 2026-08-30, docs/plans/delete-the-importer-d1b-sol.md finding 2.
   */
  mine("marks the step run error when the stage fails, rather than leaving it running", async () => {
    const slug = `${SLUG_PREFIX}step-error`;
    const fixture = await publishArticle(slug, "the carried arc");

    const seen: StepLog = { calls: 0, sawArc: null };
    const step = fakeArc(async () => {
      throw new Error("the stage could not do it");
    }, seen);

    const jobId = await queueJob(slug, ["arc"], true);
    const advanced = await advanceWhenSlotFree(jobId, partsWith(step));

    expect(seen.calls, "the step has to have actually started").toBe(1);
    expect(advanced?.done).toBe(true);
    expect(advanced?.job.status).toBe("error");

    const draftId = await failedDraftOf(fixture.articleId);
    expect(
      (await runRow(draftId, "arc"))?.status,
      "a step run left `running` is one the next claim over this draft refuses to believe ended",
    ).toBe("error");
    expect((await runRow(draftId, "arc"))?.finishedAt).toBeTruthy();

    /* The rest of the ending still happened, which is the half a
       `finishStepRun` in the wrong place would have taken down with it. */
    const job = await jobRow(jobId);
    expect(job?.status).toBe("error");
    expect(job?.draftRevisionId).toBeNull();
    expect(
      (await articleRow(slug))?.currentRevisionId,
      "a failure never moves the reader",
    ).toBe(fixture.publishedRevisionId);
  });

  /**
   * A commit that rolled back leaves the step **open**, and the failure that
   * follows has to close it.
   *
   * The case above proves the step run is marked when the *stage* threw, and it
   * cannot see this: there the step was never finished at all, so it makes no
   * difference where the session stops remembering it. This is the other
   * ordering, and it is the one that is easy to get wrong — `commit` reached
   * `finishStep`, wrote `done`, and then the transaction failed and took that
   * back. The row is `running` again, so the session must still know a step is
   * open when `settleJob` arrives one line later.
   *
   * **`begunStep` is therefore cleared after the transaction resolves, never
   * inside it.** A JavaScript assignment is not rolled back by Postgres: a clear
   * placed beside `artifacts.finishStep` would survive the rollback perfectly
   * while the row it was about did not, and the failure settlement would then
   * walk past a `running` row exactly as it did before finding 2 was fixed.
   *
   * The two halves are the shape `src/jobs.ts` really produces: `runStep`'s
   * catch records the commit's refusal on the step and the job, and `endJob`
   * settles it through this same session.
   */
  mine("closes a step whose commit rolled back, when the failure is settled", async () => {
    const slug = `${SLUG_PREFIX}rollback-then-fail`;
    const fixture = await publishArticle(slug, "the carried arc");
    const claimed = await claimWithSession(slug, ["arc"]);
    const ctx = contextFor(slug);

    await claimed.session.beginStep(slug, "arc");

    /* The same in-transaction failure case 4 uses: a `not null` the database
       refuses, landing in `finishIn` — after `write`, after `finishStepRun` has
       already written `done`, and after the publication. */
    await expect(
      claimed.session.commit(
        ctx,
        fakeArc(async () => ({ detail: "" })),
        claimed.attempt,
        { detail: "one entry", parts: { arc: arcSaying(slug, fixture.blocks, "the lost arc") } },
        {
          kind: "end",
          jobId: claimed.jobId,
          attempt: claimed.attempt,
          ending: { status: "done", steps: null as unknown as JobStep[] },
        },
      ),
    ).rejects.toMatchObject({ name: "StoreFailure", code: "23502" });

    /* The state that makes the rest of this test mean something: the row really
       did go back to `running`, so there really is a step left open. */
    expect(
      (await runRow(claimed.revisionId, "arc"))?.status,
      "the rollback took the step completion back with everything else",
    ).toBe("running");

    const settled = await claimed.session.settleJob({
      kind: "end",
      jobId: claimed.jobId,
      attempt: claimed.attempt,
      ending: { status: "error", steps: claimed.steps, error: "the commit was refused" },
    });

    expect(settled.kind).toBe("ended");
    expect(
      (await runRow(claimed.revisionId, "arc"))?.status,
      "the session has to still know a step is open: its commit rolled back",
    ).toBe("error");
    expect((await revisionRow(claimed.revisionId))?.status).toBe("failed");
    const job = await jobRow(claimed.jobId);
    expect(job?.status).toBe("error");
    expect(job?.draftRevisionId).toBeNull();
  });

  /* --------------------------------------------------------- the lock order -- */

  /**
   * The article row is locked at the **top** of a commit that will never
   * publish.
   *
   * Every other case here would pass with `lockArticleFor` deleted — watched,
   * 2026-08-30: all nine stayed green. A lock order is a claim about two
   * transactions, and eight single-threaded cases cannot see one. So this asks
   * the only question a test can ask on its own: **is the lock taken at all**,
   * on the commits that have no other use for it.
   *
   * It matters because it is not tidiness. A transaction that took the job lock
   * first and reached `publishRevisionIn` later would still be job→article, and
   * being inside one transaction does not stop it deadlocking with another
   * article→job one — `openOrBeginJobDraft`, `publishRevisionIn` and
   * `failRevisionIn` all take the article first, and the cancellation case above
   * needs the article *after* the job row has already been moved. GPT Sol,
   * 2026-08-29.
   *
   * Held from a second connection, so the wait is a real `for update` wait and
   * not something this process arranged.
   */
  mine("waits for the article row before it writes anything", async () => {
    const slug = `${SLUG_PREFIX}lock`;
    const fixture = await publishArticle(slug, "the carried arc");
    const claimed = await claimWithSession(slug, ["arc", "tweets"]);
    const ctx = contextFor(slug);
    await claimed.session.beginStep(slug, "arc");

    const blocker = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const held = await blocker.connect();
    let settled = false;
    try {
      await held.query("begin");
      /* The blocker's own backend, so the probe below can name it. Read before
         the row is taken, because after it this connection is busy holding. */
      const pid = Number(
        (await held.query<{ pid: number | string }>("select pg_backend_pid() as pid")).rows[0]?.pid,
      );
      await held.query("select id from spideryarn.articles where slug = $1 for update", [slug]);

      /* A **release**, so nothing in this commit publishes or fails a draft —
         which is exactly the case that has no other reason to want the lock. */
      const committing = claimed.session
        .commit(
          ctx,
          fakeArc(async () => ({ detail: "" })),
          claimed.attempt,
          {
            detail: "one entry",
            parts: { arc: arcSaying(slug, fixture.blocks, "the arc that waited") },
          },
          {
            kind: "release",
            jobId: claimed.jobId,
            attempt: claimed.attempt,
            steps: claimed.steps,
            fields: {},
          },
        )
        .then((r) => {
          settled = true;
          return r;
        });

      /* **Blocked *by this backend*, not merely still going.** A sleep here —
         which is what this was until 2026-08-30 — passes for a commit that
         takes no lock at all and is simply slower than the sleep, which is the
         whole class of check docs/reusable/silent-success.md is about. Watched:
         with `lockArticleFor` replaced by a 1.5s sleep, the old assertion stayed
         green and this one says "nothing ever queued behind backend N". */
      await waitUntilBlockedBy(pid);
      expect(settled, "the commit ran to completion without the article row").toBe(false);

      /* **Whether the lock is taken before or after the artefact write is not
         testable from here**, and saying so is better than an assertion that
         cannot fail: an uncommitted write is invisible to every other
         connection, so the draft reads unchanged either way. That half of the
         rule — the lock *first*, before the fence — is held by the file header
         and by reading, and its consequence is a deadlock rather than a wrong
         value. Do not add `expect(arcTextOf(...))` here; it passes on both. */

      await held.query("commit");
      const settlement = await committing;
      expect(settlement.kind).toBe("released");
      expect(await arcTextOf(claimed.revisionId)).toBe("the arc that waited");
    } finally {
      /* `rollback` is harmless after a commit and is what releases the row if
         an assertion above threw while the transaction was still open. */
      await held.query("rollback").catch(() => {});
      held.release();
      await blocker.end();
    }
  });

  /* ------------------------------------------------------------------ 6 -- */

  /**
   * The preflight reads the draft, with a perfectly good `arc.json` on disk.
   *
   * A Postgres step deciding whether to skip by looking at files is the exact
   * silent success this seam exists for, and it is not hypothetical: the
   * filesystem store is what `src/jobs.ts` still imports, and `stepIsDone` used
   * to be handed it. The disk is checked to be convincing first — a test where
   * the files were not actually there would pass with `session.reads` swapped
   * for anything at all.
   */
  mine("decides what to skip from the draft, not from the files on disk", async () => {
    const slug = `${SLUG_PREFIX}preflight`;
    /* No arc in Postgres: the draft will carry none forward. */
    const fixture = await publishArticle(slug);

    const dir = path.join(ROOT, "data", slug);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "arc.json"),
      `${JSON.stringify(arcSaying(slug, fixture.blocks, "the arc on disk"), null, 2)}\n`,
      "utf8",
    );
    /* The control. Without it, "the step ran" is consistent with the file never
       having been written, and the mutation that swaps the store back would not
       redden anything. */
    const onDisk = createFsArtifactStore();
    expect(await onDisk.has(slug, "arc", ["arc"]), "the disk really does say done").toBe(true);

    const seen: StepLog = { calls: 0, sawArc: null };
    const step = fakeArc(
      async (ctx) => ({
        detail: "one entry",
        parts: { arc: arcSaying(ctx.slug, fixture.blocks, "the arc in the draft") },
      }),
      seen,
    );

    const jobId = await queueJob(slug, ["arc"]);
    const advanced = await advanceWhenSlotFree(jobId, partsWith(step));

    expect(advanced?.ran, "the step must not have been skipped").toBe("arc");
    expect(seen.calls).toBe(1);
    /* And the run phase saw the draft too: no arc, where the disk has one. */
    expect(seen.sawArc).toBeNull();

    const published = (await articleRow(slug))?.currentRevisionId;
    expect(await arcTextOf(published as string)).toBe("the arc in the draft");
  });

  /* ------------------------------------------------------------------ 7 -- */

  /**
   * Every step skipped, so `commit` is never called — and the draft still has
   * to be published, because **an earlier request's work is in it.**
   *
   * `src/jobs.ts` reaches `endJob` straight out of the step loop here, so
   * publication cannot hang off `commit`. But that on its own is not what makes
   * publishing the *right* rule, and the first version of this case could not
   * tell: it ran one request over an article whose every step was already
   * current, so the draft was a byte-for-byte copy of what was published and
   * discarding it would have left the reader looking at identical text. A test
   * whose two outcomes are indistinguishable proves nothing about the choice
   * between them.
   *
   * So this is the real shape, in two requests over one job:
   *
   * 1. `arc` is not current, so it runs, writes into the draft, and **releases**
   *    the claim — `tweets` is still pending, so the job is not over. Nothing is
   *    published, and that new arc exists only in the draft.
   * 2. The next request finds `arc` done (it is in the draft now) and `tweets`
   *    current (the fixture published one), skips both, and reaches `endJob`
   *    with no `commit` anywhere in the request.
   *
   * The assertion is that the reader ends up looking at **request one's arc**.
   * Discarding instead would report the job done having thrown that work away —
   * a silent success, in the path built to prevent them. GPT Sol, 2026-08-30,
   * docs/plans/delete-the-importer-d1b-sol.md finding 5.
   */
  mine("publishes the work an earlier request released, when every step skips", async () => {
    const slug = `${SLUG_PREFIX}skipped`;
    /* No arc, so the first request has to run it; a thread, so the second step
       is already current and the second request skips everything. */
    const fixture = await publishArticle(slug, undefined, true);

    const seen: StepLog = { calls: 0, sawArc: null };
    const step = fakeArc(
      async (ctx) => ({
        detail: "one entry",
        parts: { arc: arcSaying(ctx.slug, fixture.blocks, "the released arc") },
      }),
      seen,
    );
    const parts = partsWith(step, fakeTweets(), ONE_STEP_LEASE_MS);

    const jobId = await queueJob(slug, ["arc", "tweets"]);

    /* Request one: it runs the arc and hands the claim back, because its lease
       will not cover `tweets`. */
    const first = await advanceWhenSlotFree(jobId, parts);
    expect(first?.ran).toBe("arc");
    expect(first?.done, "tweets is still pending, so the job is not over").toBe(false);
    expect(first?.job.status).toBe("queued");

    const draftId = (await jobRow(jobId))?.draftRevisionId;
    expect(draftId, "the released claim keeps its draft for the next request").toBeTruthy();
    expect(
      (await articleRow(slug))?.currentRevisionId,
      "and nothing has been published yet: the new arc is in the draft alone",
    ).toBe(fixture.publishedRevisionId);
    expect(await arcTextOf(draftId as string)).toBe("the released arc");

    /* Request two: everything is current, so nothing runs and nothing commits. */
    const second = await advanceWhenSlotFree(jobId, parts);
    expect(second?.ran, "nothing ran the second time").toBeNull();
    expect(second?.done).toBe(true);
    expect(seen.calls, "the arc step ran once in total, on the first request").toBe(1);

    const published = (await articleRow(slug))?.currentRevisionId;
    expect(published, "the draft the first request wrote into is what got published").toBe(draftId);
    expect((await revisionRow(published as string))?.status).toBe("published");
    expect(
      await arcTextOf(published as string),
      "the reader can see the work request one released, or it was thrown away",
    ).toBe("the released arc");

    const job = await jobRow(jobId);
    expect(job?.status).toBe("done");
    expect(job?.draftRevisionId).toBeNull();
  });

  /* ------------------------------------------------------------------ 8 -- */

  /**
   * A step begun and never committed is re-run, not skipped and not refused.
   *
   * The claim is let go through `releaseStep` without the step ever being
   * committed — which is what an advance that died between `beginStep` and
   * `commit` leaves behind, and the only transition in the store that produces
   * it. The draft keeps its artefact, so *has* still says yes; the `running`
   * step-run row is the only thing that says otherwise.
   *
   * Two ways this could go wrong and both are asserted: the next claim skips
   * the step because the artefact is there, or it refuses because the row is
   * held by an attempt that is no longer live. `beginStepRun` reopens a row
   * left `running`, deliberately — a *different* attempt reopening it is what a
   * re-run is.
   */
  mine("re-runs a step that was begun and never committed", async () => {
    const slug = `${SLUG_PREFIX}interrupted`;
    const fixture = await publishArticle(slug, "the carried arc");
    const claimed = await claimWithSession(slug, ["arc"]);

    await claimed.session.beginStep(slug, "arc");
    /* The claim goes back with nothing committed. `releaseStep` leaves
       `draft_revision_id` alone, so the next claim reopens this same draft. */
    await pgJobStore.releaseStep(claimed.jobId, claimed.attempt, claimed.steps, {});
    expect((await jobRow(claimed.jobId))?.status).toBe("queued");
    expect((await runRow(claimed.revisionId, "arc"))?.status).toBe("running");

    const seen: StepLog = { calls: 0, sawArc: null };
    const step = fakeArc(
      async (ctx) => ({
        detail: "one entry",
        parts: { arc: arcSaying(ctx.slug, fixture.blocks, "the re-run arc") },
      }),
      seen,
    );

    const advanced = await advanceWhenSlotFree(claimed.jobId, partsWith(step));

    expect(advanced?.ran, "the interrupted step must run again").toBe("arc");
    expect(advanced?.busy, "and it must not be refused").toBe(false);
    expect(seen.calls).toBe(1);
    /* It ran *and* committed: a `StepRunNotHeld` from the row held by the older
       attempt would have failed the job here instead. */
    expect(advanced?.job.status).toBe("done");
    expect(advanced?.job.error ?? null).toBeNull();

    const published = (await articleRow(slug))?.currentRevisionId;
    expect(published).toBe(claimed.revisionId);
    expect(await arcTextOf(claimed.revisionId)).toBe("the re-run arc");
    expect((await runRow(claimed.revisionId, "arc"))?.status).toBe("done");
  });

  /* -------------------------------------------- the endings nobody is inside -- */

  /**
   * A lapsed claim is swept, and **the draft pointer goes with it.**
   *
   * `failExpired` is the one ending that happens to a job with nobody inside it:
   * there is no session, no claimant and no later statement, so if this
   * statement does not clear the pointer nothing ever will —
   * `sweepAbandonedDrafts` spares a revision that *any* job row names, terminal
   * ones included, so the draft becomes immortal. The path is ordinary: a step
   * releases, the browser tab closes, the lease lapses.
   *
   * **It starts from a real pointer, and that is not decoration.** A job with no
   * draft satisfies "the pointer is null" before the sweep as well as after it,
   * so the same assertion over the same code would pass with the fix deleted.
   * GPT Sol, 2026-08-30, docs/plans/delete-the-importer-d1b-sol.md finding 1.
   */
  mine("clears the draft pointer when a lapsed claim is swept", async () => {
    const slug = `${SLUG_PREFIX}expired`;
    await publishArticle(slug, "the carried arc");
    const claimed = await claimWithSession(slug, ["arc", "tweets"]);

    /* The state this case is about, asserted rather than assumed. */
    expect((await jobRow(claimed.jobId))?.draftRevisionId).toBe(claimed.revisionId);

    await db()
      .update(jobsTable)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(jobsTable.id, claimed.jobId));

    /* **Named, not counted.** `failExpired` returns the ids it moved rather
       than how many (src/store/jobs.ts), and a count could only say that *some*
       job was swept — on a shared database, with peers' rows lapsing beside
       this one, `>= 1` was true whether or not this job was in it. */
    const swept = await pgJobStore.failExpired();
    expect(swept, "this job's lease had expired, so the sweep had to move it").toContain(
      claimed.jobId,
    );

    const job = await jobRow(claimed.jobId);
    expect(job?.status).toBe("error");
    expect(
      job?.draftRevisionId,
      "a terminal job holding a pointer is a draft the sweeper spares for ever",
    ).toBeNull();
    /* The draft itself is left alone: it is the evidence of what was
       half-finished, and reclaiming it is the sweeper's business and not this
       statement's. */
    expect((await revisionRow(claimed.revisionId))?.status).toBe("draft");
  });

  /**
   * Stop on a **queued** job ends it, and the pointer goes with that too.
   *
   * The other half of the same leak, and it reaches the same statement by a
   * different door: `requestCancel`'s `case` ends a queued job on the spot,
   * because there is no claimant to ask. A queued job really can hold a
   * pointer — `releaseStepIn` leaves it alone deliberately, so that the next
   * request continues into the same draft — so this fixture releases a real
   * claim rather than inventing the state.
   *
   * **And the running half must not be touched.** That is the second assertion
   * and it guards the `case`: a claimant is still inside a step and its next
   * fenced write names that draft, so clearing the pointer out from under it
   * would refuse the write for a reason nothing could explain. One rule, two
   * directions, and a conditional that only names one of them is how the wrong
   * half gets written.
   */
  mine("clears the draft pointer when a queued job is stopped, and not a running one", async () => {
    const queuedSlug = `${SLUG_PREFIX}stop-queued`;
    await publishArticle(queuedSlug, "the carried arc");
    const queued = await claimWithSession(queuedSlug, ["arc", "tweets"]);
    await pgJobStore.releaseStep(queued.jobId, queued.attempt, queued.steps, {});

    const released = await jobRow(queued.jobId);
    expect(released?.status).toBe("queued");
    expect(
      released?.draftRevisionId,
      "releaseStep keeps the pointer, which is what makes this state reachable",
    ).toBe(queued.revisionId);

    const stopped = await pgJobStore.requestCancel(queued.jobId, OWNER);
    expect(stopped?.status, "a queued job is over the moment Stop is pressed").toBe("cancelled");
    const after = await jobRow(queued.jobId);
    expect(after?.status).toBe("cancelled");
    expect(after?.draftRevisionId).toBeNull();

    /* The other direction, on its own job because `jobs_active_slug` allows one
       in flight per article. */
    const runningSlug = `${SLUG_PREFIX}stop-running`;
    await publishArticle(runningSlug, "the carried arc");
    const running = await claimWithSession(runningSlug, ["arc", "tweets"]);

    const asked = await pgJobStore.requestCancel(running.jobId, OWNER);
    expect(asked?.status, "a running job is asked to stop rather than stopped").toBe("running");
    const held = await jobRow(running.jobId);
    expect(held?.cancelling).toBe(true);
    expect(
      held?.draftRevisionId,
      "the claimant is still inside a step and its next write names this draft",
    ).toBe(running.revisionId);
  });

  /* ------------------------------------------------------- what may not compile -- */

  /**
   * **`settleJob` takes an ending and nothing else**, and this is the only kind
   * of case that claim can have.
   *
   * There is no runtime behaviour to assert: the narrowing exists so that a
   * `release` cannot reach `discardAfterCancel` through a door where the draft
   * pointer has *not* already been fenced by an artefact write. The assertion is
   * the `@ts-expect-error` — `npm run typecheck` fails on an unused one, so
   * widening `settleJob` back to `JobTransition` turns this red. A fresh object
   * literal would be refused by excess-property checking whatever the parameter
   * type were, so the transition is a named `JobTransition` const: the sneaky
   * form, and the only one that tests the narrowing rather than the literal.
   * GPT Sol, 2026-08-30, docs/plans/delete-the-importer-d1b-sol.md finding 4.
   */
  it("takes only endings through settleJob", () => {
    const release: JobTransition = {
      kind: "release",
      jobId: "spya-000000",
      attempt: "00000000-0000-4000-8000-000000000000",
      steps: [],
      fields: {},
    };
    const refused = (session: StoreSession) =>
      // @ts-expect-error a release may not be settled through this door.
      session.settleJob(release);
    expect(typeof refused).toBe("function");
  });
});
