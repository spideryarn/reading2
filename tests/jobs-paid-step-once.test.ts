/**
 * **A later window of the same job does not begin a paid-search step again.**
 *
 * docs/plans/261009l-a-requeued-job-does-not-buy-the-debate-search-again.md, and
 * the postmortem docs/postmortems/261009g-a-resume-rule-sized-for-checkpointed-work-rebuys-a-purchase.md.
 * A `debate` step whose window ends while its web search is in flight — the
 * process killed and its lease lapsed, or the claimant's own deadline — is put
 * back in the queue by the requeue, and until this fix the next window ran it
 * from the start and bought the searches again.
 *
 * Real: `advanceJobWith`, the walk, `pgJobStore` (its claim, fence, sweep and
 * pause) and `claimSession`. Fake: the step itself, which counts its runs and
 * never succeeds — nothing here needs its product — and the freshness reads,
 * which answer "not done" so the second window reaches the step at all. The
 * shape is tests/jobs-walk.test.ts's, which says why at length.
 *
 * ## Watched red
 *
 * Before the fix, cases 1 and 2 ran the step twice (`expected [ 'debate',
 * 'debate' ] to deeply equal [ 'debate' ]`); 3 and 4 were green, and are the
 * controls that keep the fix from being "never re-run anything".
 */
import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { advanceJobWith, claimSession, REQUEUE_BUDGET, type AdvanceParts } from "../src/jobs.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep, type StepContext, type StepProduct } from "../src/pipeline.js";
import type { ArtifactReads } from "../src/store/artifacts.js";
import { mintAttempt, StaleAttemptError } from "../src/store/jobs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { StoreSession } from "../src/store/session.js";
import type { Job, JobStep, StepName } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const OWNER = DEV_OWNER_ID;

await pgReady({
  suite: "tests/jobs-paid-step-once.test.ts",
  tables: ["spideryarn.articles", "spideryarn.jobs"],
});

const MADE: string[] = [];
const SEEDED: ScratchArticle[] = [];

const advanceAsOwner = (id: string, parts: AdvanceParts) =>
  runAsOwner(OWNER, () => advanceJobWith(id, parts));

/** Never done, so every window reaches the step. */
const NOT_DONE = {
  interrupted: async () => false,
  has: async () => false,
  read: async () => null,
  readBaseline: async () => ({ state: "absent" as const }),
  stampFor: async () => null,
  hasEarlierBlocks: async () => false,
} as unknown as ArtifactReads;

/** How a window ends while the step's paid call is out. */
type WindowEnd = "lapse" | "pause";

/**
 * **The first run ends its window from inside the step, as a death would.**
 *
 * `lapse`: the lease is put in the past and the sweep requeues the job — what a
 * killed process leaves behind. `pause`: the claimant's own deadline hands the
 * job back, through the store's pause, on its live attempt. Either way the
 * step then throws, as a call cut off mid-flight does, and the claimant finds
 * its claim gone. Every later run throws too: nothing here wants a product.
 */
async function endTheWindow(jobId: string, how: WindowEnd): Promise<void> {
  if (how === "lapse") {
    await getDb()
      .update(jobsTable)
      .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(jobsTable.id, jobId));
    const swept = await pgJobStore.settleExpired(undefined, undefined, REQUEUE_BUDGET);
    expect(swept.find((s) => s.id === jobId)?.status, "the sweep requeues it").toBe("queued");
  } else {
    const [row] = await getDb()
      .select({ attemptId: jobsTable.attemptId })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId));
    const paused = await pgJobStore.pauseForDeadline(jobId, row!.attemptId!, REQUEUE_BUDGET);
    expect(paused.kind, "the pause requeues it").toBe("requeued");
  }
}

function countingStep(
  name: StepName,
  runs: StepName[],
  how: WindowEnd,
  oncePerJob: boolean,
): PipelineStep {
  return {
    ...STEPS[name],
    ...(oncePerJob ? { oncePerJob: true as const } : { oncePerJob: undefined }),
    async run(ctx: StepContext): Promise<StepProduct> {
      runs.push(name);
      if (runs.length === 1) await endTheWindow(ctx.jobId!, how);
      throw new Error("the paid call was cut off");
    },
  } as PipelineStep;
}

async function queueJob(
  slug: string,
  name: StepName,
  options: { force?: boolean; workKey?: string } = {},
): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: OWNER,
    slug,
    steps: [
      {
        name,
        label: STEPS[name].label,
        status: "pending",
        ...(options.force ? { force: true } : {}),
      } satisfies JobStep,
    ],
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await pgJobStore.enqueueOrGet(wanted, {
    workKey: options.workKey ?? `once-${wanted.id}`,
    reservesName: false,
  });
  MADE.push(job.id);
  return job;
}

async function fixture(how: WindowEnd, oncePerJob: boolean) {
  const slug = `test-paid-once-${randomUUID().slice(0, 8)}`;
  const workKey = `once-work-${randomUUID()}`;
  SEEDED.push(await scratchArticleInPg(slug, { ownerId: OWNER }));
  const runs: StepName[] = [];
  const parts: AdvanceParts = {
    power: async () => "standard",
    session: async (job: Job, attempt: string): Promise<StoreSession> => ({
      ...(await claimSession(job, attempt)),
      reads: NOT_DONE,
    }),
    steps: { ...STEPS, debate: countingStep("debate", runs, how, oncePerJob) } as AdvanceParts["steps"],
  };
  return { slug, workKey, runs, parts, job: await queueJob(slug, "debate", { workKey }) };
}

/** Advance until the job is over, the way the pump would. Bounded. */
async function walkToTheEnd(id: string, parts: AdvanceParts): Promise<Job> {
  for (let n = 0; n < 2 + REQUEUE_BUDGET * 2; n++) {
    await advanceAsOwner(id, parts);
    const [row] = await getDb().select({ status: jobsTable.status }).from(jobsTable).where(eq(jobsTable.id, id));
    if (row && row.status !== "queued" && row.status !== "running") break;
  }
  const job = await runAsOwner(OWNER, () => pgJobStore.get(id, OWNER));
  if (!job) throw new Error("the job has gone");
  return job;
}

describe("a paid-search step is begun once per job (261009l)", () => {
  afterAll(async () => {
    if (MADE.length) await getDb().delete(jobsTable).where(inArray(jobsTable.id, MADE));
    for (const article of SEEDED) await article.remove();
    await closeDb();
  }, 60_000);

  it("is marked so on the real `debate` step", () => {
    expect(STEPS.debate.oncePerJob).toBe(true);
  });

  it("fences the marker to the live attempt and serialises two beginnings", async () => {
    const { job } = await fixture("lapse", true);
    const attempt = mintAttempt();
    const claimed = await pgJobStore.claim(job.id, OWNER, attempt, 60_000, 100);
    expect(claimed.kind).toBe("claimed");

    await expect(
      pgJobStore.beginPaidStep(job.id, mintAttempt(), "debate"),
      "another attempt cannot mark this claim",
    ).rejects.toBeInstanceOf(StaleAttemptError);

    /* Hold the row while both transactions arrive. With `for update`, the
       second reads the first one's committed marker. Without it, both can read
       null and queue their writes behind this lock, then both answer `begun`. */
    let beginningsInFlight: Promise<("begun" | "begun-before")[]> | undefined;
    await getDb().transaction(async (tx) => {
      await tx
        .select({ id: jobsTable.id })
        .from(jobsTable)
        .where(eq(jobsTable.id, job.id))
        .for("update");
      beginningsInFlight = Promise.all([
        pgJobStore.beginPaidStep(job.id, attempt, "debate"),
        pgJobStore.beginPaidStep(job.id, attempt, "debate"),
      ]);
      /* The app pool has five connections: give both calls time to reach the
         held row before releasing the barrier. */
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    if (!beginningsInFlight) throw new Error("the concurrent beginnings were not started");
    const beginnings = await beginningsInFlight;
    expect(beginnings.sort()).toEqual(["begun", "begun-before"]);

    await getDb()
      .update(jobsTable)
      .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(jobsTable.id, job.id));
    await expect(
      pgJobStore.beginPaidStep(job.id, attempt, "debate"),
      "an expired attempt cannot classify the marker as its own refusal",
    ).rejects.toBeInstanceOf(StaleAttemptError);
    /* Do not leave this deliberately lapsed row for the next case's global
       `settleExpired` call to discover. The suite cleanup remains the fallback. */
    await getDb().delete(jobsTable).where(eq(jobsTable.id, job.id));
  });

  for (const how of ["lapse", "pause"] as const) {
    it(`does not run it again after a ${how}, and ends the job saying why`, async () => {
      const { runs, parts, job } = await fixture(how, true);

      /* The first window, on its own: begun, marked, and handed back. */
      await advanceAsOwner(job.id, parts);
      const [between] = await getDb()
        .select({
          status: jobsTable.status,
          requeues: jobsTable.requeues,
          begun: jobsTable.paidStepBegun,
          begunAt: jobsTable.paidStepBegunAt,
        })
        .from(jobsTable)
        .where(eq(jobsTable.id, job.id));
      expect(runs).toEqual(["debate"]);
      expect(between?.status, "back in the queue for another window").toBe("queued");
      expect(between?.requeues).toBe(1);
      expect(between?.begun, "and the job remembers the step was begun").toBe("debate");
      expect(between?.begunAt).toBeInstanceOf(Date);

      const ended = await walkToTheEnd(job.id, parts);

      expect(runs, "the search was bought once, not again by the next window").toEqual(["debate"]);
      expect(ended.status).toBe("error");
      expect(ended.error).toContain("[jb-paid-once]");
      expect(ended.requeues, "and it did take another window to find out").toBe(1);
    });
  }

  it("still re-runs a step that is not marked (today's rule for every other step)", async () => {
    const { runs, parts, job } = await fixture("lapse", false);
    await walkToTheEnd(job.id, parts);
    expect(runs.length).toBeGreaterThan(1);
  });

  it("runs a forced fresh job on the same article — a Retry is a new row, not a requeue", async () => {
    const first = await fixture("lapse", true);
    await walkToTheEnd(first.job.id, first.parts);
    const again = await queueJob(first.slug, "debate", { force: true });
    await walkToTheEnd(again.id, first.parts);
    expect(first.runs, "one run per job").toEqual(["debate", "debate"]);
  });

  it("keeps an equivalent active enqueue on the marked job instead of buying around it", async () => {
    const first = await fixture("lapse", true);
    await advanceAsOwner(first.job.id, first.parts);

    const coalesced = await queueJob(first.slug, "debate", { workKey: first.workKey });
    expect(coalesced.id, "the active-work key stays single-flight").toBe(first.job.id);

    const ended = await walkToTheEnd(coalesced.id, first.parts);
    expect(first.runs).toEqual(["debate"]);
    expect(ended.error).toContain("[jb-paid-once]");
  });
});
