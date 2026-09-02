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
 * **Real:** `advanceJobWith` and the whole of `walkClaim`, the filesystem job
 * store with its claim and its fence, the filesystem session that records the
 * recovery ending, and the logger — including its `err` serialiser, which is the
 * thing that would do the leaking.
 *
 * **Fake:** the one pipeline step (so that it skips), and the session's `done`
 * settlement (so that it fails with something sensitive in it). Nothing a real
 * database raises here carries article content, so a test built on a real
 * failure could never go red — which is why this file *makes* the failure rather
 * than finding one.
 *
 * **No database at all**, deliberately: `SPIDERYARN_STORE` is left unset, so the
 * job store is the filesystem one and this cannot skip itself into a green run
 * (docs/reusable/silent-success.md). The rule under test is the coordinator's
 * and is the same under either store.
 *
 * ## The mutation, watched red on 2026-09-01
 *
 * `errorFields(err)` in place of `{ errorType: … }` in `walkClaim`'s catch — the
 * shape this rule exists to forbid. The reading is in the report; it fails on
 * `not.toContain(SENTINEL)`, with the whole `Failed query: … params: …` message
 * in the line.
 */
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The log level, before any import. `level()` in src/log.ts reads `LOG_LEVEL`
 * once, at that module's load, and vitest's `NODE_ENV=test` otherwise makes the
 * logger `silent` — which writes nothing, which satisfies every `not.toContain`
 * below.
 *
 * The store flag is **deleted** rather than set to `"files"`, because unset is
 * the state every laptop and every fresh clone is actually in, and `storeFromEnv`
 * treats the two the same on purpose (src/store/live.ts).
 */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  const previousStore = process.env.SPIDERYARN_STORE;
  if (previousLevel === undefined || ["silent", "fatal", "error"].includes(previousLevel)) {
    process.env.LOG_LEVEL = "warn";
  }
  delete process.env.SPIDERYARN_STORE;
  return { previousLevel, previousStore };
});

import { mintId } from "../src/ids.js";
import { advanceJobWith } from "../src/jobs.js";
import { errorFields, log } from "../src/log.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep } from "../src/pipeline.js";
import { fsArtifacts } from "../src/store/artifacts-fs.js";
import { fsJobStore } from "../src/store/jobs-fs.js";
import { STORE } from "../src/store/live.js";
import { fsStoreSession } from "../src/store/session.js";
import type { ArtifactReads } from "../src/store/artifacts.js";
import type { JobEndTransition, StoreSession } from "../src/store/session.js";
import type { Job, JobStep } from "../src/types.js";
import { logLinesWhile } from "./helpers/log-capture.js";

if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
else process.env.LOG_LEVEL = HOISTED.previousLevel;
if (HOISTED.previousStore !== undefined) process.env.SPIDERYARN_STORE = HOISTED.previousStore;

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

const MADE: string[] = [];

async function queueJob(): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: DEV_OWNER_ID,
    slug: "all-skipped-log-fixture",
    steps: [{ name: "arc", label: STEPS.arc.label, status: "pending" } satisfies JobStep],
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await fsJobStore.enqueueOrGet(wanted, { workKey: `all-skipped-log-${wanted.id}`, reservesName: false });
  MADE.push(job.id);
  return job;
}

/**
 * The real filesystem session, with **only** the `done` settlement replaced.
 *
 * The `error` settlement the coordinator makes afterwards is the real one, so
 * the recovery this file asserts about is the production statement rather than a
 * stub agreeing with itself.
 */
function sessionThatCannotPublish(): StoreSession {
  const real = fsStoreSession({ artifacts: fsArtifacts, jobs: fsJobStore });
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
  beforeAll(() => {
    /* The control on the control: a flag that failed to take would run this
       against Postgres, which is a different session and a different test. */
    expect(STORE).toBe("files");
  });

  afterAll(async () => {
    /* `fsJobStore` writes to the repository's own `data/_jobs/` — its directory
       is a module-level constant, not the scratch root — so the records have to
       be taken out by hand, exactly as tests/jobs-walk.test.ts does. */
    const jobsDir = path.resolve(import.meta.dirname, "..", "data", "_jobs");
    for (const file of await readdir(jobsDir).catch(() => [])) {
      const full = path.join(jobsDir, file);
      const record = JSON.parse(await readFile(full, "utf8").catch(() => "{}")) as { id?: string };
      if (record.id !== undefined && MADE.includes(record.id)) await rm(full, { force: true });
    }
  });

  it("logs the class of the failure and the message of none of it", async () => {
    const job = await queueJob();

    const logged = await logLinesWhile(async () => {
      const advanced = await runAsOwner(DEV_OWNER_ID, () =>
        advanceJobWith(job.id, {
          session: async () => sessionThatCannotPublish(),
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
