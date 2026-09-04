/**
 * **Retry spends money, so the server decides who may press it — not the card.**
 *
 * Two of GPT Sol's findings on stage 3 of
 * docs/plans/260831b-finish-the-database-move.md meet here, because both are
 * about `retryJob` and both need the same fixture: a job that really ran, really
 * ended, and is really in the store.
 *
 * **Finding 3, and it is a money hole that opened the same day it was found.**
 * `retryJob` checked that the job existed and belonged to the caller, and
 * nothing else. That was harmless for as long as a retry of a *finished* job
 * forced nothing — every step found its artefacts current and skipped — and it
 * stopped being harmless on 2026-08-31, when `forceForRetry` began re-forcing
 * everything the original forced. From then on:
 *
 * 1. complete a forced PDF refresh **successfully**;
 * 2. POST its `/retry` endpoint;
 * 3. its all-done forced steps are re-forced by the new rule, and the
 *    transcription is paid for again;
 * 4. do it to each completed replacement job, for as long as you like.
 *
 * The card has never offered that button (`src/web/AddArticle.tsx` draws it only
 * for `error` or `cancelled` and only when `jobWorthRetrying`), which is exactly
 * why it went unnoticed: **the client agreed with the rule and the server had
 * never been asked.** So every case below goes through `retryJob` itself.
 *
 * **Finding 4: the item 3 tests proved a composition rather than a wiring.**
 * `tests/retry-after-a-failed-refresh.test.ts` calls `forceForRetry` and
 * `cascadeForce` by hand, so it stays green if `retryJob` stops passing the
 * force set, if `enqueue` drops it, or if the flags never reach the record. The
 * last case here reads the new job's flags **back out of the store**, which is
 * the only thing a later request will see.
 *
 * ## The store, since 2026-09-04 — and the sentence that used to be here
 *
 * This header used to carry a section headed *"Why this needs no network, no
 * model call and no database"*. Two thirds of that is still true and the last
 * third was the problem: the file ran on the **filesystem** queue, so every
 * refusal it pinned was `retryJob` reading a JSON file, and `enqueue` writing
 * one. Production's `retryJob` reads `spideryarn.jobs` through
 * `pgJobStore.get(id, owner)` — a `where id = $1 and owner_id = $2` — and the
 * record its last case is about is a `steps` JSONB column, not a file. Stage B
 * of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * is the move. It still needs no network and no model call.
 *
 * **What the conversion bought**, beyond running the code that ships: the
 * fixtures are now jobs that had to survive the queue's real unique indexes to
 * exist at all, and the *"the refusal must not have queued anything"*
 * assertions — the ones that are about money rather than about a status code —
 * are now counted out of the table a second request would read.
 *
 * **What it cost is an article per case**, and a fake step that can no longer
 * hand back `{ made: name }`:
 *
 * - `claimSession` opens this claim's draft by carrying the published revision
 *   forward, so a job walked against a bare slug has nothing to open and
 *   nothing to publish into. `scratchArticleInPg` seeds one per slug.
 * - `SHAPE` (src/store/artifacts.ts) is applied by **both** stores, and `raw`
 *   additionally needs a manifest whose `storedSha256` names a real
 *   `raw_sources` row — `writeRawSource` in src/store/artifacts-pg.ts refuses
 *   anything else. So a fake step returns **the artefacts the seeded article was
 *   made from**, read straight out of the committed corpus (`CORPUS_FILES`
 *   below). No step does any work, and every write is one the store accepts.
 * - The seeded articles get a **per-slug `.invalid` URL**, which the filesystem
 *   fixtures did not need to think about. Two of the cases queue a real retry,
 *   whose pump runs the real `fetch` step, and `requireUrl` now finds a URL
 *   because there is an article row to find it on — the corpus's own
 *   `paulgraham.com`. Left alone this file would fetch the web. A distinct
 *   address per slug also keeps `freeSlug`'s shelf lookup from adopting one of
 *   this file's own articles for another.
 *
 * ## The reads are faked, and only the reads
 *
 * `NOTHING_IS_FRESH` answers *no* to the six questions `stepIsDone` asks, so
 * every step in a case runs rather than skipping — which on a seeded article,
 * whose artefacts are all present, they otherwise would not. The spread is the
 * one `tests/article-cache-call-site.test.ts` uses. It does **not** defeat
 * `assertProduced`: `pgStoreSession.commit` builds its own
 * `readsPgArtifacts(ref, tx)` inside the transaction it just wrote in
 * (src/store/pg-session.ts), so the postcondition sees the step's own writes
 * and nothing this file supplied.
 *
 * ## Every byte assertion, one at a time
 *
 * - **`jobsOnDisk(slug)`**, the money assertion, counted. **Converted**, to
 *   `pgJobStore.list(owner)` filtered by slug — `spideryarn.jobs`, column
 *   `slug`. `list` is what `GET /api/jobs` answers from, so it is literally
 *   *"what a later request sees"*. The force flags the last case reads are the
 *   `steps` JSONB column of that row.
 * - **the `data/_jobs/` sweep and the `rm` of `data/<slug>/` in `afterAll`**.
 *   **Incidental scaffolding, converted** to a delete of `spideryarn.jobs` rows
 *   by slug and then `ScratchArticle.remove()` — jobs first, because
 *   `jobs.draft_revision_id` is a foreign key into the revision an article
 *   delete would be trying to cascade away.
 *
 * Nothing was dropped, and nothing moved to `tests/jobs-fs-adapter.test.ts`:
 * none of these was a claim *about* the filesystem adapter.
 *
 * ## The mutations, watched red on 2026-09-01 — against the filesystem version
 *
 * Each applied to `retryJob` in src/jobs.ts, run, and taken out again. They are
 * kept because the cases they redden are unchanged; what they are *not* is
 * evidence about Postgres, which is what the mutation below the fixture is for.
 *
 * - **the status check deleted** — two cases, and the second is why the message
 *   is asserted as well as the code:
 *
 *   ```
 *   × refuses a job that finished, however it was asked for
 *     AssertionError: promise resolved "{ id: 'spya-hmh4ku', …(5) }" instead of rejecting
 *   × refuses a job that has not finished
 *     AssertionError: expected Error: That article already has a job run… to match
 *       object { status: 409, …(1) }
 *   ```
 *
 * - **the `jobWorthRetrying` check deleted** — `× refuses a failure another
 *   attempt cannot change: AssertionError: promise resolved "{ id: 'spya-cjgy6n',
 *   …(5) }" instead of rejecting`.
 *
 * - **`force: forceForRetry(old.steps)` replaced with `force: []`**, which is
 *   `retryJob` no longer passing the force set on: `AssertionError: the retry
 *   must ask for every step the refresh asked for, \`tweets\` included: expected
 *   [] to deeply equal [ 'fetch', 'extract', 'blocks', …(2) ]`.
 *
 * - **`…forceForRetry(old.steps).slice(0, 1)`**, which is the thrifty version
 *   this whole rule replaced — hand `cascadeForce` the first forced step and let
 *   it reconstruct the rest. It reconstructs four of the five: `expected [
 *   'fetch', 'extract', 'blocks', …(1) ] to deeply equal [ 'fetch', 'extract',
 *   'blocks', …(2) ]`. The missing one is `tweets`, which is the argument
 *   `forceForRetry`'s own comment makes and which nothing exercised until now.
 *
 * ## The mutation for the conversion, watched red on 2026-09-04
 *
 * The four above are all in `src/jobs.ts` and would have reddened this file on
 * either store, so none of them is evidence that it now reaches Postgres. This
 * one is: **`failureKind: ending.failureKind ?? null` deleted from `finishIn`**
 * (src/store/pg-jobs.ts) — the write of the `failure_kind` column, which has no
 * filesystem counterpart at all, the JSON record simply carrying the field.
 *
 * ```
 * × refuses a failure another attempt cannot change
 *   AssertionError: the fixture has to carry the kind the guard reads:
 *     expected undefined to be 'ours'
 * ```
 *
 * **What it does not cover, which is most of the file.** One column's write is
 * not the family:
 *
 * - **`finishIn`'s other five columns** — `status`, `steps`, `error`,
 *   `attempt_id`, `lease_expires_at` — are each their own statement of fact and
 *   none of them was mutated. `steps` is the one the last case is really about.
 * - **The fence.** `finishIn` writes `where` `liveAttempt(id, attempt)`, four
 *   conditions this repo has now dropped three times; every job here is settled
 *   by its own live claimant, so a fence that admitted a stale one would go
 *   unnoticed.
 * - **`get`'s `where owner_id = $1`**, which is the predicate the *header* leans
 *   on when it says `retryJob` reads through `pgJobStore.get(id, owner)`.
 *   Deleting it would leave this file green: every case here is one owner asking
 *   about their own job. `tests/owner-jobs.test.ts` is what covers that, and it
 *   mutated exactly that line.
 * - **`claim`'s article line and `tryEnqueue`'s classifier.** The fixtures
 *   insert cleanly and claim unopposed, so neither branch is exercised.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres` before **any** import.
 *
 * `src/jobs.ts` picks its store **once, at module load** — `const store:
 * JobStore = STORE === "postgres" ? pgJobStore : fsJobStore` — and imports are
 * hoisted above every statement in a module, so a plain assignment here would
 * leave the whole file on the filesystem queue with nothing saying so.
 */
const HOISTED = vi.hoisted(() => {
  const previousStore = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return { previousStore };
});

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { stageFailure } from "../src/job-failure.js";
import { advanceJobWith, cancelJob, claimSession, getJob, retryJob } from "../src/jobs.js";
import type { AdvanceParts } from "../src/jobs.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep, type StepProduct } from "../src/pipeline.js";
import type { ArtifactKind, ArtifactParts, ArtifactReads } from "../src/store/artifacts.js";
import { STORE } from "../src/store/live.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { StoreSession } from "../src/store/session.js";
import type { Job, JobStep, StepName } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { FIXTURE_ROOT } from "./helpers/require-fixture.js";
import { scratchArticleInPg, SCRATCH_SOURCE, type ScratchArticle } from "./helpers/scratch-article.js";

/* Put the flag back straight after the imports: vitest reuses a worker across
   files and does not reset `process.env` between them. */
if (HOISTED.previousStore === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = HOISTED.previousStore;

loadEnvLocal();

const OWNER = DEV_OWNER_ID;

const { reachable } = await pgReady({
  suite: "tests/retry-is-only-for-a-failed-job.test.ts",
  tables: ["spideryarn.jobs", "spideryarn.articles"],
});

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    /* **Not gated on `reachable`.** A flag that failed to take would run every
       case below against the filesystem queue, which answers all of them
       happily — and the `where owner_id = $1` and the `steps` column that are
       the point of the conversion would never be consulted. A control that
       vanishes when the database is missing vanishes exactly when it matters. */
    expect(STORE).toBe("postgres");
  });
});

/**
 * **`it`, with this file's owner in scope for the whole body.**
 *
 * `getJob`, `retryJob` and `cancelJob` are all owner-scoped, and outside a
 * request they ask `currentOwnerId()` — which answers with
 * `SPIDERYARN_OWNER_ID` where `.env.local` sets one, and the fixtures here are
 * queued under `DEV_OWNER_ID`. On a machine that has run
 * `scripts/setup-local.ts` the two disagree and every case fails with *"the
 * fixture job is not in the store"*, which reads as a broken fixture rather
 * than as two owners. Under Postgres it is sharper still: the disagreement is a
 * `where owner_id = $1` that matches nothing. Same reason as `advanceAsOwner`
 * in tests/jobs-walk.test.ts.
 */
const itAsOwner = (name: string, body: () => Promise<void>) =>
  it(name, () => runAsOwner(OWNER, body), 60_000);

/** Its own slug stem, so nothing here meets another suite's fixtures. */
const SLUG_PREFIX = "test-retry-guard-";

/** One per case, named here so the sweep at the end can find their leftovers. */
const SLUGS = ["done", "queued", "permanent", "refresh", "cancelled"].map(
  (name) => `${SLUG_PREFIX}${name}`,
);

/**
 * **An address that cannot be reached, and a different one per slug.**
 *
 * Two things at once, both new with the database. The retried jobs in cases 4
 * and 5 are driven by the real pump, whose first step is `fetch`, and
 * `requireUrl` resolves the URL from the **article row** — which now exists, and
 * on the corpus's own metadata would be `paulgraham.com`. And `freeSlug` asks
 * the shelf which slug already holds a `urlKey`, so five articles sharing one
 * address would let one case's retry adopt another case's slug.
 */
const urlFor = (slug: string) => `https://spideryarn-test.invalid/${slug}`;

/* ------------------------------------------------------------ the artefacts -- */

/**
 * **The artefacts the seeded article was made from**, by step and kind.
 *
 * A fake step has to hand back something the Postgres store will accept, and
 * `{ made: name }` is not it — see the header. Reading them out of the committed
 * corpus is the cheapest source that satisfies `SHAPE` *and* the `raw_sources`
 * foreign key, because `scratchArticleInPg` loaded these very bytes a moment
 * ago: `raw.json`'s `storedSha256` names the row its own seed inserted.
 *
 * `slug` and the URL are overridden to match the clone, for the same reason
 * `cloneCorpusArticle` rewrites them: an article whose metadata names a
 * different slug loads under a name no route will ask for, and a `raw` manifest
 * carrying `paulgraham.com` would put that address back on the row the seed
 * deliberately made unreachable.
 */
const CORPUS_FILES: Partial<Record<ArtifactKind, string>> = {
  raw: `data/${SCRATCH_SOURCE}/raw.json`,
  meta: `data/${SCRATCH_SOURCE}/meta.json`,
  tree: `data/${SCRATCH_SOURCE}/tree.json`,
  labels: `data/${SCRATCH_SOURCE}/labels.json`,
  tweets: `data/${SCRATCH_SOURCE}/tweets.json`,
  blocks: `output/${SCRATCH_SOURCE}.blocks.json`,
  extractedHtml: `output/${SCRATCH_SOURCE}.html`,
  stampedHtml: `output/${SCRATCH_SOURCE}.html`,
};

/** One read per kind for the whole file, because the bytes never change. */
const corpusCache = new Map<ArtifactKind, unknown>();

async function corpusArtefact(kind: ArtifactKind): Promise<unknown> {
  const relative = CORPUS_FILES[kind];
  if (relative === undefined) {
    throw new Error(
      `no corpus artefact for "${kind}" — add it to CORPUS_FILES, or use a step that does not ` +
        `declare it. A fake step cannot invent one: the Postgres store shape-checks every write.`,
    );
  }
  if (!corpusCache.has(kind)) {
    const text = await readFile(path.join(FIXTURE_ROOT, relative), "utf8");
    corpusCache.set(kind, relative.endsWith(".json") ? (JSON.parse(text) as unknown) : text);
  }
  return corpusCache.get(kind);
}

/** The corpus artefact, with this clone's slug and address written into it. */
async function partFor(slug: string, kind: ArtifactKind): Promise<unknown> {
  const value = await corpusArtefact(kind);
  if (typeof value !== "object" || value === null) return value;
  const copy = { ...(value as Record<string, unknown>) };
  if (typeof copy.slug === "string") copy.slug = slug;
  if (typeof copy.url === "string") copy.url = urlFor(slug);
  if (typeof copy.requestedUrl === "string") copy.requestedUrl = urlFor(slug);
  return copy;
}

/**
 * Everything `stepIsDone` asks, answering **no**.
 *
 * `has: false` is the load-bearing one: a step whose artefacts are current is
 * skipped before it is ever run, and on a seeded article every step's artefacts
 * are current. A skipped step never throws the failure a case is built around,
 * and never commits the product the last case counts — so this is what makes
 * the fixtures reach the states they claim.
 */
const NOTHING_IS_FRESH = {
  interrupted: async () => false,
  has: async () => false,
  read: async () => null,
  readBaseline: async () => ({ state: "absent" as const }),
  stampFor: async () => null,
  hasEarlierBlocks: async () => false,
} as unknown as ArtifactReads;

/* ---------------------------------------------------------------- the steps -- */

/**
 * A step that returns everything it declares and writes nothing.
 *
 * `body` is where a case puts what it wants to happen while a step runs: throw
 * the failure the job is supposed to end on, or press Stop from outside.
 */
function fakeStep(
  slug: string,
  name: StepName,
  body: () => Promise<void> | void = () => {},
): PipelineStep {
  return {
    name,
    label: STEPS[name].label,
    outputs: () => [],
    produces: STEPS[name].produces,
    async run(): Promise<StepProduct> {
      await body();
      const parts = Object.fromEntries(
        await Promise.all(
          STEPS[name].produces.map(async (kind) => [kind, await partFor(slug, kind)]),
        ),
      ) as ArtifactParts;
      return { parts, detail: `${name} ran` };
    },
  } as PipelineStep;
}

/* ------------------------------------------------------------------ the job -- */

/**
 * A `queued` job straight into the real store — **not** `enqueue`.
 *
 * `enqueue` starts the local pump, which would drive this job with the *real*
 * steps while the walk below is driving it with fakes. The row is the state
 * these cases need; the race is not.
 *
 * `force` is what the shelf's refresh button produces once `cascadeForce` has
 * been over it — a flag on every step — and it is the input the last case is
 * about.
 */
async function queueJob(slug: string, names: StepName[], force: boolean): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: OWNER,
    slug,
    steps: names.map(
      (name): JobStep => ({
        name,
        label: STEPS[name].label,
        status: "pending",
        ...(force ? { force: true } : {}),
      }),
    ),
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await pgJobStore.enqueueOrGet(wanted, {
    workKey: `retry-guard-${wanted.id}`,
    reservesName: false,
  });
  return job;
}

/**
 * **Production's own session factory, with only the freshness reads replaced.**
 *
 * `claimSession` is exported for exactly this (src/jobs.ts § *Exported so a test
 * can drive the real one*): a test may supply fake **steps**, because the
 * thirteen real ones cost money, but the session under them has to be the one
 * production builds or this is a test of its own wiring. Spreading it is safe —
 * `pgStoreSession` returns an object of closures, not methods that need a
 * `this`.
 */
function session(job: Job, attempt: string): Promise<StoreSession> {
  return claimSession(job, attempt).then((real) => ({ ...real, reads: NOTHING_IS_FRESH }));
}

/** The real session over the fake steps. */
function partsFor(steps: Partial<Record<StepName, PipelineStep>>): AdvanceParts {
  return { session, steps: { ...STEPS, ...steps } as AdvanceParts["steps"] };
}

/**
 * Run a job to a standstill with fake steps, and hand back what the store says
 * about it — which is what `retryJob` will read a moment later.
 */
async function runToTheEnd(
  slug: string,
  names: StepName[],
  options: {
    force?: boolean;
    /* Given the job, because a case that presses Stop from inside a step needs
       its id, and the id is minted in here. */
    bodies?: (job: Job) => Partial<Record<StepName, () => Promise<void> | void>>;
  } = {},
): Promise<Job> {
  const job = await queueJob(slug, names, options.force ?? false);
  const bodies = options.bodies?.(job) ?? {};
  const steps = Object.fromEntries(
    names.map((name) => [name, fakeStep(slug, name, bodies[name])]),
  ) as Partial<Record<StepName, PipelineStep>>;
  /* Inside this file's owner: `advanceJobWith` asks `currentOwnerId()`, which
     outside a request is `SPIDERYARN_OWNER_ID` where `.env.local` sets one, and
     the fixture above is queued under `DEV_OWNER_ID`. Without the scope the
     claim answers `gone` on a machine that has run scripts/setup-local.ts. */
  const advanced = await runAsOwner(OWNER, () => advanceJobWith(job.id, partsFor(steps)));
  expect(advanced?.done, "the fixture job has to have finished for the case to mean anything").toBe(
    true,
  );
  const ended = await getJob(job.id);
  if (!ended) throw new Error(`the fixture job ${job.id} is not in the store`);
  return ended;
}

/* --------------------------------------------------------------- the reads -- */

/**
 * The jobs this slug has, **through the store** — the money assertion, counted.
 *
 * `pgJobStore.list(owner)` is what `GET /api/jobs` answers from (`listJobs`,
 * src/jobs.ts), so this is literally what a later request sees: rows of
 * `spideryarn.jobs`, filtered by the `slug` column. It replaces a `readdir` of
 * `data/_jobs/`.
 *
 * **One caveat worth writing down rather than discovering.** `list` is subject
 * to `KEEP_FINISHED` retention — `trimFinished(owner, 50)` runs after every
 * ending — so this could in principle undercount if fifty other finished jobs
 * landed under `DEV_OWNER_ID` between a fixture ending and the assertion. Every
 * count below is taken immediately after its own job, which is the newest, and
 * the newest survives its own sweep by construction
 * (docs/postmortems/260903e-…).
 */
async function jobsForSlug(slug: string): Promise<Job[]> {
  return (await pgJobStore.list(OWNER)).filter((j) => j.slug === slug);
}

/**
 * Wait for a job to stop moving, so cleanup does not race the pump.
 *
 * The retried jobs really are driven, by the pump `enqueue` starts, and their
 * first step is `fetch` against an address that does not resolve — see
 * `urlFor`. Deleting a row from under a write in flight is a lost update rather
 * than a missing file, which is quieter and worse.
 */
async function settle(id: string): Promise<Job | null> {
  for (let n = 0; n < 200; n++) {
    const job = await getJob(id);
    if (!job || (job.status !== "queued" && job.status !== "running")) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} never settled`);
}

/* --------------------------------------------------------------- the cases -- */

/** One seeded article per slug, so a claim has a draft to open and publish. */
const seeded = new Map<string, ScratchArticle>();

when("retrying a job", () => {
  beforeAll(async () => {
    for (const slug of SLUGS) {
      /* Owned by `DEV_OWNER_ID` explicitly, because that is who the walk runs
         as: the Postgres reader filters every article by owner, so a fixture
         seeded as somebody else is invisible and every claim would refuse. */
      seeded.set(
        slug,
        await scratchArticleInPg(slug, {
          ownerId: OWNER,
          /* The address the seed goes in with — see `urlFor`. `mutate` runs on
             the cloned directory before the load, so this is what reaches the
             `article_revisions` columns `requireUrl` later reads. */
          mutate: async (dir) => {
            for (const name of ["raw.json", "meta.json"]) {
              const at = path.join(dir, name);
              const value = JSON.parse(await readFile(at, "utf8")) as Record<string, unknown>;
              if (typeof value.url === "string") value.url = urlFor(slug);
              if (typeof value.requestedUrl === "string") value.requestedUrl = urlFor(slug);
              await writeFile(at, JSON.stringify(value));
            }
          },
        }),
      );
    }
  }, 180_000);

  afterAll(async () => {
    /* Jobs first: a job row's `draft_revision_id` is a foreign key into the
       revision the article delete would be trying to cascade away. By slug
       rather than by id, so a case that died mid-walk leaves nothing behind. */
    for (const slug of SLUGS) {
      await getDb().delete(jobsTable).where(eq(jobsTable.slug, slug));
      await seeded.get(slug)?.remove();
    }
    await closeDb();
  }, 120_000);

  /* ------------------------------------------------------------------ 1 -- */

  /**
   * **The hole itself: a job that succeeded is not a candidate.**
   *
   * The steps are forced, because that is the case the money is in — a
   * successful refresh, whose retry now re-forces the whole pipeline. A refusal
   * that only covered unforced jobs would leave the exploit exactly where it
   * was.
   */
  itAsOwner("refuses a job that finished, however it was asked for", async () => {
    const slug = `${SLUG_PREFIX}done`;
    const finished = await runToTheEnd(slug, ["fetch", "extract"], { force: true });
    expect(finished.status, "the fixture has to be a success for this to be the case").toBe("done");

    await expect(
      retryJob(finished.id),
      "a successful forced job was queued again, and its forced steps will be paid for twice",
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("hasn't failed") });

    /* **The assertion that is about money rather than about a status code.** A
       refusal that threw *after* queueing the work would pass the line above
       and cost exactly what the hole cost. */
    expect(await jobsForSlug(slug), "the refusal must not have queued anything").toHaveLength(1);
  });

  /* ------------------------------------------------------------------ 2 -- */

  /**
   * A job still queued or running is not a candidate either, and for a plainer
   * reason: it has not failed at anything yet. The card offers Stop here, not
   * Retry.
   */
  itAsOwner("refuses a job that has not finished", async () => {
    const slug = `${SLUG_PREFIX}queued`;
    const job = await queueJob(slug, ["fetch"], false);

    /* **The message as well as the code**, because a 409 is also what `enqueue`
       answers when the slug is busy — which is what this job is. Without the
       words, a retry that got as far as `enqueue` would look like a refusal. */
    await expect(retryJob(job.id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("hasn't failed"),
    });
    expect(await jobsForSlug(slug)).toHaveLength(1);

    /* Left terminal rather than queued, so it does not hold this slug for the
       rest of the run — under Postgres that is `jobs_active_slug`, a real
       partial unique index, and a queued row left behind would refuse the next
       job on this article rather than merely sitting in a map. */
    await cancelJob(job.id);
  });

  /* ------------------------------------------------------------------ 3 -- */

  /**
   * **A failure that cannot come out differently is refused too**, which is the
   * server agreeing with the button rather than being more permissive than it.
   *
   * `stageFailure("ours", { generic })` is what a stage throws when another attempt asks
   * the same question and gets the same answer — no source URL, a tree that does
   * not fit its blocks. `jobWorthRetrying` is what the card reads, and it is now
   * what this reads.
   */
  itAsOwner("refuses a failure another attempt cannot change", async () => {
    const slug = `${SLUG_PREFIX}permanent`;
    const failed = await runToTheEnd(slug, ["fetch"], {
      bodies: () => ({
        fetch: () => {
          throw stageFailure("ours", { generic: `No source URL for "${slug}".` });
        },
      }),
    });
    expect(failed.status).toBe("error");
    expect(failed.failureKind, "the fixture has to carry the kind the guard reads").toBe("ours");

    await expect(retryJob(failed.id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("same way"),
    });
    expect(await jobsForSlug(slug)).toHaveLength(1);
  });

  /* ------------------------------------------------------------------ 4 -- */

  /**
   * **The positive control, and the wiring finding 4 is about.**
   *
   * A guard that refused everything would pass all three cases above and break
   * the Retry button. So this is a refresh that really failed — forced, and
   * dead at `hierarchy` — and it asserts two different things:
   *
   * 1. the retry is **allowed**, and a new job is queued;
   * 2. the new job's own record carries a force flag on **every** step, read
   *    back out of the store rather than off the object `retryJob` returned.
   *    That is the wiring: `retryJob` → `forceForRetry` → `enqueue` →
   *    `cascadeForce` → `newStep` → the `spideryarn.jobs` row, `steps` column,
   *    that a later request reads.
   *
   * **`tweets` is in the list on purpose.** It is in `FORCE_ONLY_WHEN_NAMED`
   * (src/pipeline.ts), so `cascadeForce` will not sweep it in by position — only
   * by name. It is the whole reason `forceForRetry` hands back the entire forced
   * set rather than its first member, and until now nothing exercised it: a
   * retry that passed only `["fetch"]` would come out with `tweets` unforced,
   * and the thread the reader explicitly asked to redo would quietly not be
   * redone.
   */
  itAsOwner("queues the retry of a real failure with the whole forced set on the new record", async () => {
    const slug = `${SLUG_PREFIX}refresh`;
    const names: StepName[] = ["fetch", "extract", "blocks", "hierarchy", "tweets"];
    const failed = await runToTheEnd(slug, names, {
      force: true,
      bodies: () => ({
        hierarchy: () => {
          throw new Error("the model answered with a tree that does not fit");
        },
      }),
    });
    expect(failed.status).toBe("error");
    expect(
      failed.steps.map((s) => s.status),
      "three steps finished into a draft the failure threw away, and two never ran",
    ).toEqual(["done", "done", "done", "error", "pending"]);

    const retried = await retryJob(failed.id);
    if (!retried) throw new Error("the retry of a real failure was refused");
    expect(retried.id).not.toBe(failed.id);

    const [record] = (await jobsForSlug(slug)).filter((j) => j.id === retried.id);
    expect(record, "the new job is not in the jobs table").toBeTruthy();
    expect(
      (record as Job).steps.filter((s) => s.force === true).map((s) => s.name),
      "the retry must ask for every step the refresh asked for, `tweets` included",
    ).toEqual(names);

    await settle(retried.id);
  });

  /* ------------------------------------------------------------------ 5 -- */

  /**
   * **A job the reader stopped is retryable**, and this is the case that keeps
   * the refusal from being written as "only `error`".
   *
   * Stop is the commonest reason a job is not finished, and pressing Retry
   * afterwards is the ordinary thing to do next — nothing failed, so nothing
   * says another attempt would go the same way.
   */
  itAsOwner("allows a job the reader stopped", async () => {
    const slug = `${SLUG_PREFIX}cancelled`;
    const stopped = await runToTheEnd(slug, ["fetch", "extract"], {
      /* Stop pressed while the first step is running, which is where a real one
         is pressed: the walk notices it at the step boundary and ends the job
         `cancelled` without running the second. */
      bodies: (job) => ({
        fetch: async () => {
          await cancelJob(job.id);
        },
      }),
    });
    expect(stopped.status, "the fixture has to be a cancellation").toBe("cancelled");

    const retried = await retryJob(stopped.id);
    if (!retried) throw new Error("the retry of a cancelled job was refused");
    expect(retried.status).toBe("queued");

    await settle(retried.id);
  });
});
