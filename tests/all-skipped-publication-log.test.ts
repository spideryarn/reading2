/**
 * **A publication that fails on the all-skipped door must not put the database's
 * words in a log line.**
 *
 * The sixth shape of docs/project/logging.md § *the seam is on the way out*:
 * `guardDbStore` translates a store error on its way **out**, so anything that
 * reads the error *before* the rethrow is outside the seam. `walkClaim` is one
 * of those readers. It catches every non-stale failure of the ending that comes
 * through `settleJob` — the claim where every step skipped — and writes a line
 * about it, and what it has in hand at that moment is very often a raw Drizzle
 * error whose message is `Failed query: … params: …`. For `finishIn` those bound
 * parameters are the job's whole `steps` array and its **title**, which is the
 * article's; a step's `detail` may be article prose. One line, `err.name` instead
 * of the error, is the whole fix.
 *
 * ## What this file used to be
 *
 * `tests/publish-session-cleanup-log.test.ts`, and it made the same claim about
 * the same rule one layer down: `publishingSession` had its own compensating
 * cleanup, and when *that* failed it logged the failure. GPT Sol's critical 1 of
 * 2026-08-30 named both statements. The decorator was deleted at the flip
 * (docs/plans/260831b-finish-the-database-move.md § Stage 3 — the flip) and its
 * cleanup went with it — `pgStoreSession` fails its draft **inside** the
 * transaction that rolls back, so there is no compensating call to fail. The
 * surviving statement is the coordinator's, and it is the one under test here.
 *
 * ## What is real here and what is not
 *
 * **Real:** `advanceJobWith` and the whole of `walkClaim`, the **Postgres** job
 * store with its claim and its fence, the session `claimSession` builds for a
 * real claim — which records the recovery ending in the `jobs` table — and the
 * logger, including its `err` serialiser, which is the thing that would do the
 * leaking.
 *
 * **Fake:** the one pipeline step (so that it skips), and the session's `done`
 * settlement (so that it fails with something sensitive in it). Nothing a real
 * database raises here carries article content, so a test built on a real
 * failure could never go red — which is why this file *makes* the failure rather
 * than finding one.
 *
 * ## It ran with no database at all until 2026-09-04
 *
 * The header used to say **"No database at all, deliberately: `SPIDERYARN_STORE`
 * is left unset… so this cannot skip itself into a green run"**, and the whole
 * fixture was `fsJobStore` and `fsStoreSession`. That sentence is exactly what
 * stage B falsifies: a claim that reaches the all-skipped door on the
 * *filesystem* session reaches a door production never opens, because production
 * settles that ending inside `pgStoreSession`'s transaction. The line under test
 * is the coordinator's either way — but the error it is guarding against is a
 * **Drizzle** error, and the only store that can hand `walkClaim` one is
 * Postgres.
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § B.
 *
 * So the flag is now pinned to `postgres` before any import, `expect(STORE)`
 * flips with it, and the fixture is the real `pgJobStore` and the real
 * `claimSession` over a seeded article. The self-check is not lost, it changed
 * sides: a flag that failed to take now fails the first case rather than
 * quietly running the test that does not deploy.
 *
 * ## The mutations, watched red
 *
 * **Mutation.** 2026-09-01, on the filesystem harness: `errorFields(err)` put in
 * place of `{ errorType: … }` in `walkClaim`'s catch — the shape this rule
 * exists to forbid. The run went red on `not.toContain(SENTINEL)`, with the
 * whole `Failed query: … params: …` message sitting in the captured line.
 *
 * **Blind to.** The store underneath. That run was on the filesystem harness,
 * where no Drizzle error exists at all, so it says nothing about whether the
 * coordinator's catch is reached on the path that ships — which is the whole
 * reason the file was converted. The 2026-09-04 mutation is the one that
 * reaches the store, and it is recorded above `afterAll` rather than here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Two environment variables, before any import.
 *
 * **The log level**, because `level()` in src/log.ts reads `LOG_LEVEL` once, at
 * that module's load, and vitest's `NODE_ENV=test` otherwise makes the logger
 * `silent` — which writes nothing, which satisfies every `not.toContain` below.
 *
 * **The store flag**, because `src/store/live.ts` reads it once and imports are
 * hoisted above every statement in a module. It used to be a `delete` here, on
 * the argument that unset is the state a fresh clone is in; the argument stands
 * and is no longer the one that matters, because unset is also the store that is
 * not deployed. A plain assignment below the imports would leave `claimSession`
 * handing back the filesystem session with nothing saying so.
 */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  if (previousLevel === undefined || ["silent", "fatal", "error"].includes(previousLevel)) {
    process.env.LOG_LEVEL = "warn";
  }
  return { previousLevel };
});

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { advanceJobWith, claimSession } from "../src/jobs.js";
import { errorFields, log } from "../src/log.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep } from "../src/pipeline.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { ArtifactReads } from "../src/store/artifacts.js";
import type { JobEndTransition, StoreSession } from "../src/store/session.js";
import type { Job, JobStep } from "../src/types.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

/* Both put back straight after the imports: vitest reuses a worker across files
   and does not reset `process.env` between them. */
if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
else process.env.LOG_LEVEL = HOISTED.previousLevel;

loadEnvLocal();

await pgReady({
  suite: "tests/all-skipped-publication-log.test.ts",
  tables: ["spideryarn.articles", "spideryarn.jobs"],
});

/** One slug, one article, for the whole file. */
const SLUG = "all-skipped-log-fixture";

/**
 * Two strings that must never reach a log line.
 *
 * They stand where a driver error's bound parameters would: a step's `detail`,
 * which may be article prose, and the job's title, which is the article's.
 */
const SENTINEL = "PROSE-IN-THE-PUBLICATION-ERROR";

/**
 * What Drizzle throws, in the shape that matters: a message built from the
 * failed statement and **its bound parameters**.
 */
function driverError(): Error {
  const err = new Error(
    `Failed query: update spideryarn.jobs set status = $1, steps = $2, title = $3 ` +
      `params: done,[{"name":"arc","detail":"${SENTINEL}"}],${SENTINEL}`,
  );
  err.name = "DrizzleQueryError";
  return err;
}

/**
 * A step that is always already done, so the walk skips it and reaches the
 * all-skipped door without running anything.
 *
 * No `stamp` and no `isDone`, so `stepIsDone` answers on `interrupted` and `has`
 * alone — which is what `READS` below decides.
 */
const SKIPPING_STEP = {
  name: "arc",
  label: STEPS.arc.label,
  outputs: () => [],
  produces: ["arc"],
  run: () => {
    throw new Error("the step must not run: this fixture is about the door where none does");
  },
} as unknown as PipelineStep;

/** Everything `stepIsDone` asks, answering "yes, that is already there". */
const READS = {
  interrupted: async () => false,
  has: async () => true,
  read: async () => null,
  readBaseline: async () => ({ state: "absent" as const }),
  stampFor: async () => null,
  hasEarlierBlocks: async () => false,
} as unknown as ArtifactReads;

/**
 * The article the claim below opens a draft of.
 *
 * **It has to exist**, and that is what the move to Postgres cost. `claimSession`
 * carries the published revision forward into this claim's own draft
 * (`openOrBeginJobDraft`), so there has to be something to carry; the filesystem
 * session had no draft and no publication, so a job could be walked against a
 * bare directory name.
 */
let article: ScratchArticle | undefined;

/**
 * Into the store, not through `enqueue`: `enqueue` starts the local pump, which
 * would be a second driver racing the `advanceJobWith` below and claiming the
 * job out from under it.
 */
async function queueJob(): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: DEV_OWNER_ID,
    slug: SLUG,
    steps: [{ name: "arc", label: STEPS.arc.label, status: "pending" } satisfies JobStep],
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await pgJobStore.enqueueOrGet(wanted, {
    workKey: `all-skipped-log-${wanted.id}`,
    reservesName: false,
  });
  return job;
}

/**
 * **Production's own session factory, with the freshness reads and the `done`
 * settlement replaced — and nothing else.**
 *
 * `claimSession` is exported for exactly this (src/jobs.ts § *Exported so a test
 * can drive the real one*). The `error` settlement the coordinator makes
 * afterwards is therefore the real Postgres one, so the recovery this file
 * asserts about is the production statement rather than a stub agreeing with
 * itself. Spreading it is safe — `pgStoreSession` returns an object of closures,
 * not methods that need a `this`.
 */
async function sessionThatCannotPublish(job: Job, attempt: string): Promise<StoreSession> {
  const real = await claimSession(job, attempt);
  return {
    ...real,
    reads: READS,
    settleJob: async (transition: JobEndTransition) => {
      if (transition.ending.status !== "done") return await real.settleJob(transition);
      throw driverError();
    },
  };
}

describe("a claim where every step skipped and the publication failed", () => {
  beforeAll(async () => {
    /* Owned by `DEV_OWNER_ID` explicitly, because that is who the claim runs as:
       the Postgres reader filters every article by owner, so a fixture seeded as
       somebody else is invisible and the claim would refuse. */
    article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  }, 120_000);

  /**
   * **Mutation.** Watched red on 2026-09-04: `error: ending.error ?? null`
   * in `finishIn` (src/store/pg-jobs.ts) replaced by `error: null` — the column
   * this recovery exists to write, on the statement that writes it. The first
   * case fails on `expect(advanced?.job.error).toContain("Nothing was published
   * …")` with `undefined`, which also settles a question the conversion raised:
   * `advanced.job` is the row `finishIn` returned, **not** the in-memory object
   * `endAsStorageFailure` mutated on its way there. So this file's assertions
   * about `job.error` really are a Postgres round trip, which they were not on
   * the filesystem store.
   *
   * **Blind to.** Not the log line, which is this file's actual
   * subject: every one of the `logged` assertions — the door's sentence, the
   * class, and the three absences — passed with the mutation in. And one column
   * of one statement: `status`, `steps`, `failureKind`, `title` and the fence in
   * the same `set` are untouched, as are `claimIn`, `releaseStepIn` and every
   * other writer in that file. A single predicate is not the family.
   */
  afterAll(async () => {
    /* Jobs first: a job row's `draft_revision_id` is a foreign key into the
       revision the article delete would be trying to cascade away. By slug
       rather than by id, so a case that died mid-walk leaves nothing behind. */
    await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
    await article?.remove();
    await closeDb();
  }, 60_000);

  it("logs the class of the failure and the message of none of it", async () => {
    const job = await queueJob();

    const logged = await logLinesWhile(async () => {
      const advanced = await runAsOwner(DEV_OWNER_ID, () =>
        advanceJobWith(job.id, {
          session: sessionThatCannotPublish,
          steps: { ...STEPS, arc: SKIPPING_STEP } as never,
        }),
      );

      /* The catch recorded the failure rather than letting it escape, which is
         the behaviour the line under test accompanies. Asserted here rather than
         in its own case because it is the same `catch`, and a version of it that
         threw would produce an empty capture below and pass every absence. */
      expect(advanced?.done).toBe(true);
      expect(advanced?.job.status).toBe("error");
      expect(advanced?.job.error).toContain("Nothing was published and your library is unchanged");
      expect(advanced?.job.error).not.toContain(SENTINEL);
    });

    /**
     * **First, that the line under test was written at all.**
     *
     * Every way this capture can be wrong — the level left at `silent`, a step
     * that ran instead of skipping, a branch skipped because an `instanceof`
     * matched — produces an *empty* capture, and an empty capture passes every
     * `not.toContain` ever written. See tests/helpers/log-capture.ts.
     */
    expect(logged).toContain("could not publish a claim where every step skipped");
    /* The class is kept, because a line that says only "something failed" is the
       other way to get this wrong. */
    expect(logged).toContain("DrizzleQueryError");
    /* And none of what the driver put in its message got out. */
    expect(logged).not.toContain(SENTINEL);
    expect(logged).not.toMatch(/Failed query|params:/);
  }, 30_000);

  /**
   * The control for the absences above: `errorFields` really does carry a
   * message into a line, so `not.toContain` is checking something a plausible
   * mistake would break — it is not passing because pino drops messages anyway.
   *
   * This is the mutation of `src/jobs.ts` written down as a test instead of
   * applied by hand, so it goes on being true after the next edit.
   */
  it("would have leaked, had the log line kept the error rather than its class", async () => {
    const logged = await logLinesWhile(async () => {
      log("jobs").error(errorFields(driverError()), "the control line");
    });
    expect(logged).toContain("the control line");
    expect(logged).toContain(SENTINEL);
  });
});
