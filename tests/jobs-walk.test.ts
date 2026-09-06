/**
 * One claim walks the whole job — the coordinator change that makes an import
 * work on a host where the next request lands somewhere else.
 *
 * `tests/jobs.test.ts` owns the queue's arithmetic and the advance endpoint's
 * older properties; this file is about the claims the **walk** adds, and every
 * one of them is a statement about the loop in `advanceJobWith` rather than
 * about a store. Written for docs/plans/260830d-v1-imports-on-vercel.md § Stage 3, whose
 * one-sentence version is GPT Sol's: *"claim once, keep the same attempt while
 * walking the real steps, release only on intentional handoff or terminal
 * settlement"* (docs/plans/260830a-v1-imports-review-sol.md critical 3).
 *
 * ## Why it drives `advanceJobWith` with a real session and fake freshness
 *
 * The job store is **real** — `pgJobStore`, with its real claim, its real fence
 * and its real release — because every claim about a claim is a claim about
 * that, and so is the real `claimSession` over it. A test that stubbed the
 * *session* would be testing the stub: the whole question here is which
 * transition the coordinator asks for and what it does with the answer.
 *
 * What is faked is **`session.reads`**, and only that: the six questions
 * `stepIsDone` asks before a step runs. `freshness()` answers *no* until a step
 * has run and *yes* afterwards, so every step in a case runs rather than
 * skipping — which on a seeded article, whose artefacts are all present and
 * current, they otherwise would not — while a second claim on the same job
 * still skips what the first finished. The spread is the one
 * `tests/article-cache-call-site.test.ts` uses:
 * `{ ...(await claimSession(job, attempt)), reads: fresh.reads }`, which is safe
 * because `pgStoreSession` returns closures rather than methods that need a
 * `this`.
 *
 * **It does not fake what `assertProduced` reads**, and that is worth knowing
 * before someone tries: `pgStoreSession.commit` builds its own
 * `readsPgArtifacts(ref, tx)` inside the transaction it just wrote in
 * (src/store/pg-session.ts), precisely so the postcondition sees the step's own
 * uncommitted writes and nothing else's. So the products below are written for
 * real, into a real draft, by production's own code — though **nothing here
 * proves that**, and the mutation section below says why not.
 *
 * ## The store, since 2026-09-04
 *
 * It used to run on `fsJobStore` and `fsStoreSession` over an artefact store in
 * a `Map` — a whole walk with no database in it, which meant that *"claim once,
 * release only on handoff"* was being asserted about a process-local map and an
 * in-memory mutex rather than about the SQL that ships. Under Postgres a claim
 * is `update … where status = 'queued' and (lease_expires_at is null or …)`, the
 * fence is `attempt_id`, and the line an older job holds is `jobs_active_slug` —
 * three real predicates where the filesystem had none. Stage B of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * is the move.
 *
 * **What it cost is an article per case.** `claimSession` opens this claim's
 * draft by carrying the published revision forward, so a job walked against a
 * bare slug has nothing to open and nothing to publish into; `scratchArticleInPg`
 * seeds one per slug. And the fake steps can no longer hand back
 * `{ made: name }`: `SHAPE` (src/store/artifacts.ts) is applied by **both**
 * stores, and `raw` in particular needs a manifest whose `storedSha256` names a
 * real `raw_sources` row. So a fake step returns **the seeded article's own
 * artefacts**, read once through `readsPgArtifacts` — which satisfies the shape
 * check and the foreign key without any step doing any work.
 *
 * ## The mutation for the conversion, watched red on 2026-09-04
 *
 * The seven below are about the *coordinator* and were watched against the
 * filesystem queue, so none of them is evidence that this file now reaches
 * Postgres. This one is.
 *
 * **Mutation.** `claimIn` in [`src/store/pg-jobs.ts`](../src/store/pg-jobs.ts),
 * with `eq(jobs.status, "queued")` deleted from the `UPDATE`'s `where`, and the
 * run printed `2 failed | 9 passed` — the two named in the block below.
 *
 * **That single predicate is what the whole conversion was justified by** —
 * *"claim once, release only on handoff"* used to be a claim about a
 * process-local `Map`, and under Postgres it is one line of SQL.
 *
 * ```
 * × does not let go of the claim between steps
 * × makes a dev-server reload a pause: the new copy waits and the old one finishes
 * 2 failed | 9 passed
 * ```
 *
 * **Blind to.** One predicate is not the family. `claimIn`'s
 * `where` has three other conjuncts — `id`, `owner_id` and `cancelling = false`
 * — and none of them was mutated; `owner_id` in particular would stay green
 * here, because every case is one owner claiming their own job (`owner-jobs`
 * mutates exactly that line, on `list`). Nor does it reach the two refusals
 * *above* the `UPDATE`: `blockedByAnother`, which is what the two-in-a-line case
 * is really about, and the `maxRunning` cap, which nothing here exercises at
 * all. Nor the fence — `releaseStepIn` and `finishIn` compare `attempt_id`, and
 * every commit in this file is made by the live claimant, so a fence that
 * stopped comparing would go unnoticed.
 *
 * **Blind to.** And one thing this file cannot see at all, worth naming because
 * `tests/article-cache-call-site.test.ts` measured it: because every fake step
 * hands back the seeded article's *own* artefacts, a `commit` that wrote
 * nothing at all is satisfied by the draft's carried-forward copy, and
 * `assertProduced` with it. So *the products are written for real* is the
 * mechanism this file runs on and **is not a claim it tests**.
 *
 * ## The mutation that reddened each, watched on 2026-08-30
 *
 * A test nobody has seen fail is not evidence, and this repo's history is mostly
 * checks that agreed with the bug. Each of these was applied to `src/jobs.ts`,
 * run, and taken out again; the exact readings are in the report.
 *
 * - **one call, one claim**: `transitionAfter` returns the `release` it used to
 *   instead of `keep`.
 * - **the claim is not released between steps**: the same mutation — and the
 *   probe inside step two then never runs at all, which is why the case asserts
 *   that the probe *happened* as well as what it saw. Without that line the
 *   mutation leaves it green.
 * - **a failing step ends the walk**: `continue` instead of the `endJob` return
 *   on a failed outcome.
 * - **a Stop between two steps**: delete the `if (noted.cancelling)` branch.
 * - **the card moves between steps**: delete the `await note()` after a kept
 *   commit.
 * - **budget exhaustion hands back**: delete the `STEP_BUDGET_MS` comparison in
 *   `transitionAfter`, so every non-final step keeps.
 * - ~~**`runInJob` is in effect**~~ — the sixth of the seven. Its case and its
 *   mechanism both went on 2026-09-05; see where the case stood, below.
 *
 * **Mutation.** Seven, then, one per case listed above, all seven watched red on
 * 2026-08-30 against the coordinator in `src/jobs.ts` — **six of them still
 * have a case to be red in**; the seventh's mechanism is gone.
 *
 * **Blind to.** Every one of those seven was watched on the filesystem queue and
 * against `src/jobs.ts` alone, so not one of them reaches a line of SQL: a
 * `claimIn` that had lost its `where` entirely would have left all seven green.
 * That is what the conversion mutation at the top of this header is for, and it
 * is why the seven are not evidence that this file now runs on the store that
 * ships.
 */
import { vi } from "vitest";

import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import {
  advanceJobWith,
  claimSession,
  LEASE_MS,
  STEP_BUDGET_MS,
  type AdvanceParts,
} from "../src/jobs.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep, type StepContext, type StepProduct } from "../src/pipeline.js";
import type { ArtifactParts, ArtifactReads } from "../src/store/artifacts.js";
import { readsPgArtifacts } from "../src/store/artifacts-pg.js";
import { mintAttempt } from "../src/store/jobs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { StoreSession } from "../src/store/session.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import type { Job, JobStep, StepName } from "../src/types.js";

/* A `restoreStore` closure stood here until 2026-09-05, put back in `afterAll`
   rather than after the imports because two cases below reload `src/store/live.ts`
   with `vi.resetModules()` and a fresh load re-read the flag. There is one store,
   so a reload picks the same one and there is nothing to restore. */

loadEnvLocal();

const OWNER = DEV_OWNER_ID;

await pgReady({
  suite: "tests/jobs-walk.test.ts",
  tables: ["spideryarn.articles", "spideryarn.jobs"],
});

/**
 * **The advance, inside this file's owner.**
 *
 * `advanceJobWith` asks `currentOwnerId()`, which outside a request answers
 * with `SPIDERYARN_OWNER_ID` — set in `.env.local` by `scripts/setup-local.ts`
 * on any machine that has run it, and unset on one that has not. The fixtures
 * above are queued under `DEV_OWNER_ID`, so without this scope the two disagree
 * on exactly the machines that have a seeded admin user: `store.claim` answers
 * `gone`, every case here reports that no step ran, and nothing in the failure
 * mentions an owner. `tests/claim-session-files.test.ts` already advances this
 * way for the same reason.
 */
const advanceAsOwner = (id: string, parts: AdvanceParts) =>
  runAsOwner(OWNER, () => advanceJobWith(id, parts));

/** Every job this file made, so the `jobs` table is left as it was. */
const MADE: string[] = [];

/** Every article this file seeded, so the corpus clones are cleaned up. */
const SEEDED: ScratchArticle[] = [];

/* ------------------------------------------------------------ the artefacts -- */

/**
 * **The freshness questions, answered from what the fake steps have run.**
 *
 * This is `session.reads`, and the only thing about the real session that is
 * replaced. It has to say *no* at the start, or every step would be skipped
 * before it was handed a `StepContext`: the seeded article's artefacts are all
 * present and current, and a skipped step pushes nothing onto `ran.names` —
 * which would leave every `toEqual` below comparing two empty lists.
 *
 * **And it has to remember**, which is the half a constant `has: () => false`
 * gets wrong. The `Map`-backed fake this replaces answered `has` out of what the
 * steps had written, so a *second* claim on the same job skipped the steps the
 * first had finished. Made constant, the budget case runs `fetch` a second time
 * on the resumed claim, hands back for the same reason again, and fails on a
 * `done: false` that has nothing to do with the handback. So the set below is
 * the whole of what the old store was for.
 *
 * It is deliberately **not** what `assertProduced` reads: `pgStoreSession.commit`
 * builds `readsPgArtifacts(ref, tx)` inside its own transaction, so the
 * postcondition sees what the step really wrote.
 */
interface Freshness {
  readonly reads: ArtifactReads;
  /** This step has run, so a later claim on the same job skips it. */
  note(slug: string, step: StepName): void;
}

function freshness(): Freshness {
  const done = new Set<string>();
  return {
    note: (slug, step) => {
      done.add(`${slug}|${step}`);
    },
    reads: {
      interrupted: async () => false,
      has: async (slug: string, step: StepName, kinds: readonly unknown[]) =>
        kinds.length > 0 && done.has(`${slug}|${step}`),
      /* Null, as the old fake's values were opaque: nothing under test reads an
         artefact's contents through this. `blocks` has an `isDone` of its own
         that does, and answers "not done" — which is why a forced-looking
         re-run of `blocks` is not a case this file has. */
      read: async () => null,
      readBaseline: async () => ({ state: "absent" as const }),
      stampFor: async () => null,
      hasEarlierBlocks: async () => false,
    } as unknown as ArtifactReads,
  };
}

/**
 * The six reads, over the article's **published** revision.
 *
 * `readsPgArtifacts` is production's own reader (src/store/artifacts-pg.ts) and
 * is bound to a `JobDraftRef`, because in the pipeline every read belongs to
 * some claim's draft. Nothing here is in a claim, so the ref is resolved to
 * `articles.current_revision_id` — the revision a later request would be served
 * — and re-resolved on every call, since publishing moves the pointer.
 *
 * Resolving it is two columns of direct SQL, and that is fixture plumbing
 * rather than the read-back: the read itself goes through the store function,
 * so the shared `SHAPE` check and the run-row rule are both still in the path.
 */
async function publishedReads(slug: string): Promise<ArtifactReads> {
  const [row] = await getDb()
    .select({ id: articles.id, revisionId: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, slug))
    .limit(1);
  if (!row?.revisionId) throw new Error(`"${slug}" has no published revision to read`);
  return readsPgArtifacts(
    {
      slug,
      articleId: row.id,
      revisionId: row.revisionId,
      /* Never used by a read — `readArtefact`, `hasArtefacts` and
         `stepInterrupted` all key on `revisionId` — and named so rather than
         given a plausible-looking uuid, which would invite somebody to write
         through this ref one day. */
      jobId: "not-in-a-job",
      attemptId: "not-in-a-job",
    },
    getDb(),
  );
}

/* ---------------------------------------------------------------- the steps -- */

/** What the fake steps did, in the order it happened. */
interface Ran {
  readonly names: StepName[];
}

/**
 * **What a fake step hands back: the article's own artefacts.**
 *
 * It used to be `{ made: name }` under every kind it declares, which the
 * filesystem store wrote as JSON without looking. Postgres looks: `SHAPE`
 * (src/store/artifacts.ts) is applied by both adapters, `raw` needs a manifest
 * whose `storedSha256` names a real `raw_sources` row, and `blocks` is a table
 * with a foreign key onto `block_identities`. Inventing values that satisfy all
 * of that would be a second, worse copy of the corpus.
 *
 * So the parts are read out of the article `scratchArticleInPg` seeded, once,
 * before the walk starts — which is free, satisfies every check by
 * construction, and keeps the fake step doing what it is for: nothing.
 *
 * Read under `runAsOwner` for the same reason the walk is: this process's
 * ambient owner is `SPIDERYARN_OWNER_ID` on any box that has run
 * `scripts/setup-local.ts`, and the fixture is `DEV_OWNER_ID`'s.
 */
async function artefactsOf(slug: string, names: readonly StepName[]) {
  const made: Partial<Record<StepName, StepProduct>> = {};
  await runAsOwner(OWNER, async () => {
    const reads = await publishedReads(slug);
    for (const name of names) {
      const parts: Record<string, unknown> = {};
      for (const kind of STEPS[name].produces) {
        const value = await reads.read(slug, name, kind);
        if (value === null) {
          throw new Error(
            `the seeded article "${slug}" has no ${kind} for ${name}, so a fake ${name} has ` +
              `nothing valid to return — check SCRATCH_SOURCE still carries every step this ` +
              `case names (tests/helpers/scratch-article.ts).`,
          );
        }
        parts[kind] = value;
      }
      /* **The stamp as well as the parts**, and `hierarchy` is where leaving it
         out bites. `publishRevisionIn` refuses a revision whose tree was built
         from different blocks, comparing `hashBlocks(blocks)` against the
         `hierarchy` run's `input_hash` — so a product with no stamp publishes
         as *"hierarchy ran against unstamped"* and ends the job `error`, one
         step after the thing the case is about. The corpus article's own stamp
         is the right one by construction, since these are its own artefacts. */
      const stamp = await reads.stampFor(slug, name);
      made[name] = {
        parts: parts as ArtifactParts,
        detail: `${name} ran`,
        ...(stamp === null ? {} : { stamp }),
      };
    }
  });
  return made;
}

/**
 * A **converted** step: it writes nothing itself and returns everything it
 * declares, which is what all thirteen now do (`LEGACY_UNCONVERTED_STEPS` is
 * empty). The session's commit is what puts the artefacts in the draft, so
 * `assertProduced` reads back what this returned.
 *
 * A step that returns nothing at all is a different case with its own tests.
 *
 * `body` is where a case puts what it wants to happen *while a step is running*:
 * throw, look at the job row, press Stop from somewhere else.
 *
 * **It is handed the step's own `ctx`**, which is what a real step gets, so a
 * case can watch `ctx.signal` — the only way to ask whether a Stop actually
 * reached the running step rather than only the row.
 */
function fakeStep(
  name: StepName,
  ran: Ran & { names: StepName[] },
  product: StepProduct,
  fresh: Freshness,
  body: (ctx: StepContext) => Promise<void> | void = () => {},
): PipelineStep {
  return {
    name,
    label: STEPS[name].label,
    produces: STEPS[name].produces,
    async run(ctx: StepContext): Promise<StepProduct> {
      ran.names.push(name);
      await body(ctx);
      /* Noted here rather than in the session, because this is where the old
         `Map` store recorded it: `commit` wrote the parts and `has` answered
         out of them. A step whose `body` throws never reaches this line, which
         is right — a failed step is not done. */
      fresh.note(ctx.slug, name);
      return product;
    },
  } as PipelineStep;
}

/* ------------------------------------------------------------------ the job -- */

/**
 * One throwaway article per slug, because `claimSession` needs a draft to open.
 *
 * `openOrBeginJobDraft` carries the published revision forward, so a walk
 * against a slug no article holds has nothing to carry and nothing to publish
 * into — it fails at the claim rather than at the thing the case is about.
 * `DEV_OWNER_ID` explicitly, because that is who the walk runs as.
 */
async function seedArticle(slug: string): Promise<void> {
  SEEDED.push(await scratchArticleInPg(slug, { ownerId: OWNER }));
}

/**
 * A `queued` job straight into the store — **not** `enqueue`.
 *
 * `enqueue` starts the local pump, which is a second driver racing the one thing
 * these cases are about. Inserting the row reaches the same state without the
 * race.
 */
async function queueJob(slug: string, names: StepName[], createdAt?: string): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: OWNER,
    slug,
    steps: names.map((name): JobStep => ({ name, label: STEPS[name].label, status: "pending" })),
    status: "queued",
    /* **`createdAt` is an argument for the one case that puts two jobs on one
       article.** The article's line orders on `(createdAt, id)` and `id` is
       random, so two rows written in the same millisecond queue in whichever
       order their ids happened to sort — which is a test asserting what
       `mintId` did rather than what the rule does. Every other caller wants
       now. GPT Sol, 2026-09-02, on the plan's § 1k.3. */
    createdAt: createdAt ?? new Date().toISOString(),
  };
  const { job } = await pgJobStore.enqueueOrGet(wanted, { workKey: `walk-${wanted.id}`, reservesName: false });
  MADE.push(job.id);
  return job;
}

/**
 * **Production's own session factory, with only the freshness reads replaced.**
 *
 * `claimSession` is exported for exactly this (src/jobs.ts § *Exported so a test
 * can drive the real one*): a test may supply fake **steps**, because the
 * thirteen real ones cost money, but the session under them has to be the one
 * production builds or this is a test of its own wiring. Spreading it is safe —
 * `pgStoreSession` returns an object of closures, not methods that need a `this`.
 */
function partsFor(
  fresh: Freshness,
  steps: Partial<Record<StepName, PipelineStep>>,
): AdvanceParts {
  return {
    session: async (job: Job, attempt: string): Promise<StoreSession> => ({
      ...(await claimSession(job, attempt)),
      reads: fresh.reads,
    }),
    steps: { ...STEPS, ...steps } as AdvanceParts["steps"],
  };
}

/**
 * **A dev-server restart, and the thing a module reset silently takes with it.**
 *
 * `vi.resetModules()` is how the two cases below reach "the server restarted
 * under a running job". It also gives [`src/env.ts`](../src/env.ts) a fresh
 * module load — and that module **snapshots the environment as it loads** and
 * then lets `.env.local` beat anything that has not moved since the snapshot
 * (`tests/setup/private-db.ts` § *The ordering is the whole thing* explains the
 * rule and why `DATABASE_URL=… npx vitest` cannot redirect a run).
 *
 * After a reset the snapshot is taken **again**, this time over an environment
 * that already holds the private lane's `DATABASE_URL`. So nothing looks
 * changed, `.env.local` wins, and the reloaded copy's first `getDb()` opens a
 * pool against the **shared development database** instead. Every row this file
 * wrote is invisible to it: the reloaded claim answers `gone` rather than
 * `busy`, and the failure says nothing about the reload it is supposedly about.
 * Worse, a case that only *wrote* would have written into somebody's real
 * database and passed.
 *
 * So the reset is wrapped: let the fresh `env.ts` apply the file, then put this
 * run's database back, **before** anything opens a connection from it.
 * `src/db/client.ts` calls `loadEnvLocal()` inside `getDb()`, and by then the
 * flag in the reloaded copy is already `done`, so this is the last moment it can
 * be repaired.
 *
 * This is a hazard for any suite in the private lane that resets modules, not
 * just this one — noted in the stage B report on 2026-09-04.
 */
async function restartAsIfTheServerDid(): Promise<void> {
  const privateDatabase = process.env.DATABASE_URL;
  vi.resetModules();
  (await import("../src/env.js")).loadEnvLocal();
  process.env.DATABASE_URL = privateDatabase;
  /* And the fresh copy's pool is a **second** pool: `closeDb` in `afterAll`
     closes this module's, and the reloaded one would otherwise still be
     connected at teardown, where the private lane counts leftover connections
     and says so. Collected rather than closed here, because the case is still
     using it. */
  RELOADED.push((await import("../src/db/client.js")).closeDb);
}

/** Every reloaded copy's `closeDb`, so the lane's teardown finds no strays. */
const RELOADED: (() => Promise<void>)[] = [];

/** A whole fixture: the article, the log, the job, and the parts to advance it. */
async function fixture(
  slug: string,
  names: StepName[],
  bodies: Partial<Record<StepName, (ctx: StepContext) => Promise<void> | void>> = {},
) {
  await seedArticle(slug);
  const made = await artefactsOf(slug, names);
  const fresh = freshness();
  const ran: Ran & { names: StepName[] } = { names: [] };
  const steps = Object.fromEntries(
    names.map((name) => [
      name,
      fakeStep(name, ran, made[name] as StepProduct, fresh, bodies[name]),
    ]),
  ) as Partial<Record<StepName, PipelineStep>>;
  const job = await queueJob(slug, names);
  return { ran, job, parts: partsFor(fresh, steps) };
}

/* --------------------------------------------------------------- the cases -- */

describe("one claim walks the whole job", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * **Jobs first, articles second, and the order is a foreign key.**
   *
   * A job row's `draft_revision_id` points at the revision an article delete
   * would be trying to cascade away — the same order
   * `tests/enqueue-owns-the-article.test.ts` and
   * `tests/article-cache-call-site.test.ts` keep.
   *
   * This replaces the sweep of `data/_jobs/` that used to be here. That was a
   * *byte* assertion only in the sense of tidying: `data/_jobs/` is a real
   * directory a reader may have jobs in, so the old code matched on `MADE`
   * rather than emptying it. The private database makes that caution
   * unnecessary — but the delete is still by id rather than by slug, because
   * the two-in-a-line case deliberately puts two jobs on one article and a
   * delete-by-slug would hide a case that left one behind.
   */
  afterAll(async () => {
    if (MADE.length) await getDb().delete(jobsTable).where(inArray(jobsTable.id, MADE));
    for (const article of SEEDED) await article.remove();
    for (const close of RELOADED) await close().catch(() => undefined);
    await closeDb();
  }, 60_000);

  it("runs every step in one call, on one claim and one attempt", async () => {
    const names: StepName[] = ["fetch", "extract", "blocks"];
    const { ran, job, parts } = await fixture("test-walk-whole-job", names);

    /* The real store, watched rather than replaced. `claim` is the statement a
       second request would have to win, so counting it is the claim about
       claims; the attempt tokens are the same fact said the other way. */
    const claimed = vi.spyOn(pgJobStore, "claim");
    const attempts = new Set<string>();
    const realNote = pgJobStore.noteProgress.bind(pgJobStore);
    vi.spyOn(pgJobStore, "noteProgress").mockImplementation(async (id, attempt, steps) => {
      attempts.add(attempt);
      return await realNote(id, attempt, steps);
    });

    const advanced = await advanceAsOwner(job.id, parts);

    expect(ran.names, "all three steps, in order, inside one call").toEqual(names);
    expect(advanced?.done).toBe(true);
    expect(advanced?.busy).toBe(false);
    expect(advanced?.ran, "the last step the call ran").toBe("blocks");
    expect(advanced?.job.status).toBe("done");
    expect(claimed, "one claim, not one per step").toHaveBeenCalledTimes(1);
    expect(attempts.size, "and one attempt token for the whole walk").toBe(1);
  });

  it("does not let go of the claim between steps", async () => {
    /**
     * **The property the whole stage exists for, seen from outside.** A release
     * between steps is not merely wasteful: the next claim can land on another
     * instance whose `/tmp` is empty, so it re-runs what this one just did, and
     * two tabs alternating never finish. So a second claimant must be refused
     * *while the walk is between steps*, which is what this asks from inside the
     * second step's own `run`.
     */
    const probe: { attempted: boolean; refused?: string; status?: string | undefined } = {
      attempted: false,
    };
    const names: StepName[] = ["fetch", "extract"];
    const { ran, job, parts } = await fixture("test-walk-holds-claim", names, {
      extract: async () => {
        probe.attempted = true;
        /* A cap high enough to be beside the point: this case is not about it. */
        const outcome = await pgJobStore.claim(job.id, OWNER, mintAttempt(), LEASE_MS, 4);
        probe.refused = outcome.kind;
        probe.status = (await pgJobStore.get(job.id, OWNER))?.status;
      },
    });

    const advanced = await advanceAsOwner(job.id, parts);

    /* **Asserted first, and it is the load-bearing line.** Under the mutation
       this case is for — a release between steps — `extract` never runs at all
       in this call, so every assertion below it would be vacuously true. */
    expect(probe.attempted, "the second step has to have run for this to mean anything").toBe(true);
    expect(probe.refused, "a second claimant mid-walk is turned away").toBe("busy");
    expect(probe.status, "and the job is still running, not queued between steps").toBe("running");
    expect(ran.names).toEqual(names);
    expect(advanced?.done).toBe(true);
  });

  it("shows the card each step finishing, without letting go of the claim", async () => {
    /**
     * A kept commit writes **nothing** to the `jobs` row, so `noteProgress` is
     * the only thing that tells the reader a step is over. Without it the card
     * would sit on step one for the whole ingest and then jump to done — which
     * on a twelve-minute import is indistinguishable from a hung job.
     */
    const seen: { first?: string | undefined } = {};
    const names: StepName[] = ["fetch", "extract"];
    const { job, parts } = await fixture("test-walk-progress", names, {
      extract: async () => {
        const stored = await pgJobStore.get(job.id, OWNER);
        seen.first = stored?.steps[0]?.status;
      },
    });

    await advanceAsOwner(job.id, parts);

    expect(seen.first, "the stored row says step one is done while step two runs").toBe("done");
  });

  it("ends the job at a step that fails, and does not run the ones after it", async () => {
    const names: StepName[] = ["fetch", "extract", "blocks"];
    const { ran, job, parts } = await fixture("test-walk-failure", names, {
      extract: () => {
        throw new Error("the extractor fell over");
      },
    });

    const advanced = await advanceAsOwner(job.id, parts);

    expect(ran.names, "the step after the failure must not run").toEqual(["fetch", "extract"]);
    expect(advanced?.done).toBe(true);
    expect(advanced?.ran).toBe("extract");
    expect(advanced?.job.status).toBe("error");
    /* **Not the words the step threw.** Since 2026-09-03 a step's own message
       is the diagnostic and never reaches a reader unless the throw site wrote
       them one — see tests/step-failure-seam.test.ts, which is where that rule
       is guarded, and docs/project/copy.md § The seam between the two
       audiences. What is left here is the generic sentence for a failure that
       declared nothing, and it names the step. */
    expect(advanced?.job.error).not.toContain("the extractor fell over");
    expect(advanced?.job.error).toContain("Extracting the article");
    expect(advanced?.job.steps[2]?.status, "and it is still pending, not skipped").toBe("pending");
  });

  it("stops the walk when a Stop lands between two steps", async () => {
    /**
     * **Stop from somewhere else**, which on Vercel is the ordinary case: the
     * cancel POST lands on an instance whose `aborts` map has no controller for
     * this job, so the only message is `cancelling` on the row. The store's own
     * `requestCancel` is what that instance calls, and it is called here from
     * inside step one for exactly that reason — going through `src/jobs.ts`'s
     * `requestCancel` would also abort the local controller and test the other
     * half, which `tests/jobs.test.ts` already covers.
     */
    const names: StepName[] = ["fetch", "extract"];
    const { ran, job, parts } = await fixture("test-walk-cancel", names, {
      fetch: async () => {
        await pgJobStore.requestCancel(job.id, OWNER);
      },
    });

    const advanced = await advanceAsOwner(job.id, parts);

    expect(ran.names, "the step after the Stop must not run").toEqual(["fetch"]);
    expect(advanced?.done).toBe(true);
    expect(advanced?.job.status).toBe("cancelled");
    expect(
      advanced?.job.cancelling,
      "and the flag is cleared, or the card's Stop stays disabled for ever",
    ).toBeUndefined();
  });

  it("lets a Stop from a reloaded copy of this module reach the running step", async () => {
    /**
     * **The other half of Stop, and it went missing on every dev-server
     * restart.**
     *
     * The case above is Stop arriving with only the row to write on, which is
     * the between-steps path. This one is Stop arriving at a step that is
     * *inside* an eight-minute model call, where the row is no help until the
     * call ends and the only thing that can interrupt it is the
     * `AbortController` in `src/jobs.ts`'s `aborts`.
     *
     * Saving any server file restarts the Vite dev server in place and gives
     * `src/jobs.ts` a **second copy** with an empty `aborts`, while the step the
     * first copy started keeps running. A Stop pressed after that landed on the
     * new copy and reached nothing at all — the reader's button did nothing and
     * the call kept spending. `vi.resetModules()` plus a fresh import is that
     * restart. See docs/postmortems/260902c-the-truncation-retry-cost-storm.md.
     *
     * **Bounded rather than awaited**, so the failure is a red assertion in two
     * seconds instead of a test that hangs until the runner gives up: a hang
     * says "something is wrong somewhere", and this says which.
     */
    const names: StepName[] = ["fetch"];
    let reached = false;
    const { ran, job, parts } = await fixture("test-walk-cancel-reloaded", names, {
      fetch: async (ctx) => {
        await restartAsIfTheServerDid();
        const reloaded = await import("../src/jobs.js");
        /* **The reloaded copy's own `runAsOwner`, and this is not pedantry.**
           `src/owner.js` comes back from the reset with a fresh
           `AsyncLocalStorage`, so this file's `runAsOwner` opens a scope the
           reloaded `currentOwnerId()` cannot see: `cancelJob` would read the
           environment's owner, `store.get` would answer `gone`, and the case
           would go red for a reason that has nothing to do with Stop. One
           `resetModules` and then both imports, so the two share a registry. */
        const reloadedOwner = await import("../src/owner.js");
        await reloadedOwner.runAsOwner(OWNER, () => reloaded.cancelJob(job.id));
        reached = await Promise.race([
          new Promise<boolean>((resolve) => {
            if (ctx.signal.aborted) return resolve(true);
            ctx.signal.addEventListener("abort", () => resolve(true), { once: true });
          }),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
        ]);
      },
    });

    const advanced = await advanceAsOwner(job.id, parts);

    expect(ran.names).toEqual(["fetch"]);
    expect(reached, "the Stop must reach the step this copy is running, not only the row").toBe(
      true,
    );
    expect(advanced?.job.status).toBe("cancelled");
  });

  it("makes a dev-server reload a pause: the new copy waits and the old one finishes", async () => {
    /**
     * **The claim the whole fix rests on, and nothing pinned it.**
     *
     * Once the store's state has the lifetime of the process, a reload is not a
     * duplicate — the new copy is told `busy`, the old claimant still holds the
     * claim, its writes still pass the fence, and the ingest finishes. That is
     * also the argument for *not* aborting the in-flight step on restart, which
     * looks like the money-saver and would throw away a call about to be
     * useful. An argument in a comment is not a test. GPT Sol asked for this
     * one by name.
     *
     * The reload happens **inside step one**, which is where the eight minutes
     * of model call are, and the second step is here so that the walk visibly
     * carries on past the moment it was interrupted.
     */
    const names: StepName[] = ["fetch", "extract"];
    let refused: string | undefined;
    let reloaded: typeof import("../src/store/pg-jobs.js") | undefined;
    const { ran, job, parts } = await fixture("test-walk-reload-pause", names, {
      fetch: async () => {
        await restartAsIfTheServerDid();
        reloaded = await import("../src/store/pg-jobs.js");
        const race = await reloaded.pgJobStore.claim(job.id, OWNER, mintAttempt(), LEASE_MS, 8);
        refused = race.kind;
      },
    });

    const advanced = await advanceAsOwner(job.id, parts);

    expect(refused, "the reloaded copy must be told busy, not handed the job").toBe("busy");
    expect(ran.names, "and the claimant it interrupted carries on past it").toEqual([
      "fetch",
      "extract",
    ]);
    expect(advanced?.job.status).toBe("done");
    expect(
      (await reloaded?.pgJobStore.get(job.id, OWNER))?.status,
      "and the new copy sees the finished job, so the work was not wasted",
    ).toBe("done");
  });

  it("hands the claim back rather than starting a step it cannot finish", async () => {
    /**
     * **The deliberate handoff, and the only one left.** The self-abort bounds
     * the whole claim rather than each step, so a walk that has spent most of
     * its deadline must not start a `hierarchy`: it would be killed four fifths of the
     * way through the one step nobody can afford to repeat, and the job would
     * end `error` with a live lease. Handed back, the job is `queued`, intact,
     * and the next request continues.
     *
     * **Only `Date` is faked.** The claimant's deadline is a real `setTimeout`
     * and must stay one — faking timers as well would either fire it or freeze
     * it, and the case would then be about the timer rather than about the
     * budget check that runs before it.
     */
    vi.useFakeTimers({ toFake: ["Date"] });
    const names: StepName[] = ["fetch", "hierarchy"];
    const { ran, job, parts } = await fixture("test-walk-budget", names, {
      fetch: () => {
        /* Long enough that `hierarchy`'s budget no longer fits inside what is left of
           the claim, and short enough that the claim itself has not lapsed. */
        vi.setSystemTime(new Date(Date.now() + LEASE_MS - STEP_BUDGET_MS.hierarchy));
      },
    });

    const advanced = await advanceAsOwner(job.id, parts);

    expect(ran.names, "the step that would not have fitted did not start").toEqual(["fetch"]);
    expect(advanced?.done, "there is still work to do, so the client comes back").toBe(false);
    expect(advanced?.busy, "and it was not refused — we put the job down").toBe(false);
    expect(advanced?.ran).toBe("fetch");
    expect(advanced?.job.status, "queued and resumable, not failed").toBe("queued");
    expect(advanced?.job.steps[0]?.status, "and the finished step stays finished").toBe("done");

    /* Resumable, which is the whole difference between a handback and a kill:
       time moves on, the claim is free, and the next request finishes the job. */
    vi.useRealTimers();
    const second = await advanceAsOwner(job.id, parts);
    expect(second?.done).toBe(true);
    expect(second?.job.status).toBe("done");
    expect(ran.names, "and it picked up at the step that had not run").toEqual(["fetch", "hierarchy"]);
  });

  /*
   * **`puts the job id in scope for the steps it runs` stood here until
   * 2026-09-05, and the scope it asserted no longer exists.**
   *
   * `runInJob` (src/job-scope.ts) wrapped the whole claimed body so that
   * `dataRoot()` could pick `/tmp/spideryarn/<owner>/<job>/` on a deployed
   * instance — a job-scoped scratch directory, so that a failed job's warm
   * `/tmp` could not be served as the next job's article. It had exactly one
   * reader, and that reader was the filesystem store. Both went in stage G of
   * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
   * and `src/job-scope.ts` with them.
   *
   * The accident is worth keeping even though the mechanism is not, because it
   * is this repo's dominant shape: `runInJob` existed for a day with **nothing
   * calling it**, so every deployed import failed at step one in 16ms, and this
   * case was what stopped that happening twice. GPT Sol,
   * docs/plans/260830k-v1-stages01-review-sol.md critical 1.
   */
  /**
   * **Two jobs on one article: the second waits, and the first's work survives
   * it.**
   *
   * The per-article queue's acceptance case at the coordinator's level —
   * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md
   * § 1k.2. It has two halves and **the second is the one that matters**: a
   * `busy` that is really a lost publication passes the first half perfectly
   * well, so a test that stops at "the second one waited" is a test that would
   * be green over the very corruption serialising exists to prevent — the
   * filesystem adapter keyed every artefact write on `(slug, step)` in one
   * shared directory with no job scoping, and Postgres does the equivalent
   * thing on a shared *article*: `lockArticleFor` plus a draft revision per
   * claim, published last-writer-wins.
   *
   * **The two jobs share one article**, which is what makes the second half a
   * real question — and under Postgres it is a stronger question than it was,
   * because the second job's draft is a *copy* of what the first published, so
   * "the first job's artefacts survive" is now a claim about
   * `beginDraftIn`'s carry-forward rather than about two writers not colliding
   * in a directory.
   *
   * **`createdAt` is set explicitly**, a second apart. The order is
   * `(createdAt, id)` and `id` is random, so two rows minted in one millisecond
   * would settle it by luck and this would be asserting `mintId`'s output.
   */
  it("makes a second job wait, and leaves the first job's artefacts alone", async () => {
    const slug = "test-walk-two-in-a-line";
    await seedArticle(slug);
    const made = await artefactsOf(slug, ["fetch", "extract", "blocks"]);
    const ranFirst: Ran & { names: StepName[] } = { names: [] };
    const ranSecond: Ran & { names: StepName[] } = { names: [] };

    const at = (ms: number) => new Date(Date.UTC(2026, 8, 2, 12, 0, 0) + ms).toISOString();
    const first = await queueJob(slug, ["fetch", "extract"], at(0));
    const second = await queueJob(slug, ["blocks"], at(1000));

    /* **Before anything runs**, and this is the rule rather than the mutex: the
       older job is not running either, so nothing but the line is keeping the
       younger one out. */
    const early = await pgJobStore.claim(second.id, OWNER, mintAttempt(), LEASE_MS, 4);
    expect(early.kind, "the second job claimed while an older one was ahead of it").toBe("busy");
    expect(early.kind === "busy" ? early.why : "").toMatch(/ahead of it/);

    const fresh = freshness();
    const firstParts = partsFor(fresh, {
      fetch: fakeStep("fetch", ranFirst, made.fetch as StepProduct, fresh),
      extract: fakeStep("extract", ranFirst, made.extract as StepProduct, fresh),
    });
    const advancedFirst = await advanceAsOwner(first.id, firstParts);
    expect(advancedFirst?.job.status).toBe("done");
    expect(ranFirst.names).toEqual(["fetch", "extract"]);

    /* What the first job left behind, read out of the **published** revision
       before the second one starts. The published revision, not the session's reads:
       the point is what a later request would see, which is the publication
       rather than any draft. */
    const published = () =>
      runAsOwner(OWNER, async () => {
        const reads = await publishedReads(slug);
        return {
          html: await reads.read(slug, "extract", "extractedHtml"),
          meta: await reads.read(slug, "extract", "meta"),
          blocks: await reads.read(slug, "blocks", "blocks"),
        };
      });
    const before = await published();
    expect(before.html, "the first job wrote nothing to compare against").not.toBeNull();

    const secondParts = partsFor(fresh, {
      blocks: fakeStep("blocks", ranSecond, made.blocks as StepProduct, fresh),
    });
    const advancedSecond = await advanceAsOwner(second.id, secondParts);

    /* The line drains: what was refused above runs now, unaided. */
    expect(advancedSecond?.busy, "the second job never got its turn").toBe(false);
    expect(advancedSecond?.job.status).toBe("done");
    expect(ranSecond.names).toEqual(["blocks"]);

    /* **The half that matters.** The second job published over the same article
       and the first job's artefacts came through its draft unchanged. */
    const after = await published();
    expect(after.html).toEqual(before.html);
    expect(after.meta).toEqual(before.meta);
    /* And the second job's own output is there, so this is not green because
       nothing happened. */
    expect(after.blocks).not.toBeNull();
  });
});
