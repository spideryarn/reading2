/**
 * **The flag as the walk actually sets it, not as a predicate answers.**
 *
 * `tests/article-cache-group.test.ts` constrains `cacheArticleForStep` thoroughly
 * and could not have caught the bug it was written for. GPT Sol proved that the
 * blunt way, on the built code: reverting *only* `runStep` to the old later-only
 * call left all 154 focused tests green. The predicate was never the broken part.
 * What broke was the argument built at the call site — `job.steps.slice(i + 1)`,
 * an inline expression in a function that needs a job, a store session and a
 * claim before it will run, which is exactly why nothing tested it.
 *
 * So this file asks the only question that would have gone red on `24335207`:
 * **run a two-mode job through the real walk, and see what `StepContext.cacheArticle`
 * each step is actually handed.** Both must be `true`. `arc` and `tweets` share
 * an effort and a renderer, so the entry one writes is the entry the other reads.
 *
 * docs/postmortems/260903c-the-conditional-article-cache-breakpoint-marks-the-writer-but-never-the-reader.md
 *
 * ## The store, since 2026-09-04
 *
 * It used to `delete process.env.SPIDERYARN_STORE` and drive `fsJobStore`,
 * `fsArtifacts` and `fsStoreSession` — a whole walk with no database in it.
 * Stage B of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * moves it, and the move costs one seeded article and buys the thing this file
 * is *for*: the walk it now runs is production's. `claimSession` picks the
 * Postgres session, every step's product is committed into this claim's own
 * draft, and the job publishes at the end — so `cacheArticle` is read off a
 * `StepContext` built by the same code path that builds the one a reader pays
 * for. The filesystem session it used to run under is the branch of
 * `claimSession` that is being deleted.
 *
 * ## The mutations, watched rather than reasoned — 2026-09-04
 *
 * Stage B asks each converted file for evidence it can still go red, and for
 * what that red does not reach. Two were run here, and the second is the more
 * useful of them because it did not go red at all.
 *
 * **Mutation.** 1 — the call site this file exists for, and it went red.
 * `src/jobs.ts`, the `cacheArticle:` argument, put back to later-steps-only:
 * `cacheArticleForStep(job.steps.map((s) => s.name), job.steps.indexOf(step))`
 * made `cacheArticleForStep(job.steps.map((s) => s.name).slice(job.steps
 * .indexOf(step)), 0)`. The run printed `1 failed of 4` — *marks BOTH steps of
 * a same-group pair*, on `expected [ true, false ] to deeply equal [ true,
 * true ]`, which is `24335207`'s bug to the value. The other two walks are
 * unmoved, correctly: neither has a same-group pair in it to lose.
 *
 * **Mutation.** 2 — the Postgres half of the claim above, and it STAYED GREEN.
 * `src/store/pg-session.ts` § `commit`, `if (product.parts) {` made
 * `if (false && product.parts) {` — every step's product silently not written
 * into the draft. The run printed `4 passed of 4`, stayed green, and
 * `assertProduced` in the same
 * transaction, whose whole job is to refuse a step that finished without
 * writing, did not fire.
 *
 * The reason is the fixture. `scratchArticleInPg` clones `data/writes`, which
 * ships `arc.json`, `tweets.json` and `glossary.json` among its artefacts, and
 * `openOrBeginJobDraft` carries the published revision forward into this
 * claim's draft — so `assertProduced` reads back the *fixture's* `arc` and is
 * satisfied by it. Every step here re-produces an artefact the article already
 * had. So the sentence above — *every step's product is committed into this
 * claim's own draft* — is the mechanism this file runs on and **is not
 * something this file can see**: it would pass over a session that persisted
 * nothing.
 *
 * **Blind to.** Mutation 1 reaches the call site's arguments and not
 * `cacheArticleForStep` or `sharesArticleCache` beneath it — tests/article-cache
 * -group.test.ts owns those, and Sol's original demonstration was that it stays
 * green under exactly this mutation.
 *
 * **Blind to.** What the walk *persists*, which neither mutation says anything
 * about: no assertion here reads a row back, `READS` fakes away every freshness
 * question, and mutation 2 is the proof that the two facts are connected. Nor
 * publication — the job publishes at the end of each walk and nothing below
 * looks at the revision it left.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { advanceJobWith, claimSession } from "../src/jobs.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep, type StepContext } from "../src/pipeline.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { ArtifactReads } from "../src/store/artifacts.js";
import type { StoreSession } from "../src/store/session.js";
import type { Job, JobStep, StepName } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/article-cache-call-site.test.ts",
  tables: ["spideryarn.articles", "spideryarn.jobs"],
});

/** What each step was told, in the order the walk told them. */
const seen: { step: StepName; cacheArticle: boolean | undefined }[] = [];

/**
 * The smallest artefact each step can hand back that the store will accept.
 *
 * The shape check is one field deep (`SHAPE` in src/store/artifacts.ts), so an
 * empty array satisfies it. **A step cannot simply produce nothing:**
 * `produces: []` is refused with *"arc declares no artefacts, so nothing can say
 * whether it ran"*, which is the postcondition doing its job.
 */
const PART: Partial<Record<StepName, unknown>> = {
  arc: { entries: [] },
  tweets: { tweets: [] },
  glossary: { entries: [] },
};

/** A step that records the context it was handed and writes the least it may. */
function recordingStep(name: StepName): PipelineStep {
  return {
    name,
    label: STEPS[name].label,
    produces: [name],
    run: async (ctx: StepContext) => {
      seen.push({ step: name, cacheArticle: ctx.cacheArticle });
      return { detail: `${name} recorded`, parts: { [name]: PART[name] } };
    },
  } as unknown as PipelineStep;
}

/**
 * Everything `stepIsDone` asks, answering **no**.
 *
 * `has: false` is the load-bearing one: a step whose artefact is already there
 * is skipped before it is ever handed a `StepContext`, and a skipped step
 * records nothing — which would leave `seen` short and every assertion below
 * passing vacuously. The length check in the test is what makes that a failure.
 */
const READS = {
  interrupted: async () => false,
  has: async () => false,
  read: async () => null,
  readBaseline: async () => ({ state: "absent" as const }),
  stampFor: async () => null,
  hasEarlierBlocks: async () => false,
} as unknown as ArtifactReads;

/** One slug for every job here, so one article carries the whole file. */
const SLUG = "article-cache-call-site-fixture";

/**
 * The article the jobs below run on.
 *
 * **It has to exist**, and that is the one thing the move cost. `claimSession`
 * opens this claim's draft by carrying the published revision forward
 * (`openOrBeginJobDraft`), so a late step against a slug no article holds has
 * nothing to carry and nothing to publish into. On the filesystem session there
 * was no draft and no publication, so a job could be walked against a bare
 * directory name.
 */
let article: ScratchArticle | undefined;

async function queueTwoModeJob(steps: StepName[]): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: DEV_OWNER_ID,
    slug: SLUG,
    steps: steps.map((name) => ({ name, label: STEPS[name].label, status: "pending" }) satisfies JobStep),
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await pgJobStore.enqueueOrGet(wanted, {
    workKey: `article-cache-call-site-${wanted.id}`,
    reservesName: false,
  });
  return job;
}

/**
 * **Production's own session factory, with only the freshness reads replaced.**
 *
 * `claimSession` is exported for exactly this (src/jobs.ts § *Exported so a
 * test can drive the real one*): a test may supply fake **steps**, because the
 * thirteen real ones cost money, but the session under them has to be the one
 * production builds or this is a test of its own wiring. Spreading it is safe —
 * `pgStoreSession` returns an object of closures, not methods that need a
 * `this`.
 */
function session(job: Job, attempt: string): Promise<StoreSession> {
  return claimSession(job, attempt).then((real) => ({ ...real, reads: READS }));
}

/**
 * Drive the whole job, one `advanceJobWith` call per step.
 *
 * **`advanceJobWith` advances one step and returns**, which is the coordinator's
 * design (a request-sized unit of work) and was very nearly the way this file
 * passed while testing one step out of two. The first draft called it once,
 * `seen` had a single entry, and the `[true, true]` assertion never ran — the
 * step-name check above it is what turned that into a failure instead of a pass.
 */
async function walk(steps: StepName[]): Promise<void> {
  seen.length = 0;
  const job = await queueTwoModeJob(steps);
  const registry = Object.fromEntries(steps.map((s) => [s, recordingStep(s)]));
  await runAsOwner(DEV_OWNER_ID, async () => {
    /* Bounded, so a coordinator that stops making progress fails the test rather
       than hanging it. One spare turn past the number of steps. */
    for (let turn = 0; turn <= steps.length; turn++) {
      const advanced = await advanceJobWith(job.id, {
        session,
        steps: { ...STEPS, ...registry } as never,
      });
      if (advanced?.done !== false) return;
    }
  });
}

describe("the cacheArticle flag, as the job walk actually sets it", () => {
  beforeAll(async () => {
    /* Owned by `DEV_OWNER_ID` explicitly, because that is who the walk runs as:
       the Postgres reader filters every article by owner, so a fixture seeded as
       somebody else is invisible and every claim would refuse. */
    article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  }, 120_000);

  afterAll(async () => {
    /* Jobs first: a job row's `draft_revision_id` is a foreign key into the
       revision the article delete would be trying to cascade away. By slug
       rather than by id, so a case that died mid-walk leaves nothing behind. */
    await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
    await article?.remove();
    await closeDb();
  }, 60_000);

  it("marks BOTH steps of a same-group pair — the reader as well as the writer", async () => {
    await walk(["arc", "tweets"]);

    /* First that both steps ran at all. Every way this file can go wrong
       silently — a step skipped on freshness, a walk that stopped after one, a
       registry key that did not take — produces a SHORT list, and a short list
       satisfies every `every()` ever written. docs/reusable/silent-success.md. */
    expect(seen.map((s) => s.step)).toEqual(["arc", "tweets"]);

    /* And then the thing itself. Before 2026-09-03 this was `[true, false]`:
       `arc` paid the 1.25x write premium and `tweets`, last in its group, sent
       no breakpoint and read nothing. */
    expect(seen.map((s) => s.cacheArticle)).toEqual([true, true]);
  }, 30_000);

  it("marks neither step when the two are in different cache groups", async () => {
    /* `glossary` runs at `medium` where `arc` runs at `high`, and effort is part
       of the cache key — so these two send different prefixes and a marker on
       either would pay for a read that cannot happen. The mistake
       `sharesArticleCache` reads two tables to avoid, asked at the call site. */
    await walk(["arc", "glossary"]);
    expect(seen.map((s) => s.step)).toEqual(["arc", "glossary"]);
    expect(seen.map((s) => s.cacheArticle)).toEqual([false, false]);
  }, 30_000);

  it("marks nothing at all when the job holds one article stage", async () => {
    /* The case the conditional breakpoint exists for, and the only one the old
       predicate was ever right about. */
    await walk(["arc"]);
    expect(seen.map((s) => s.step)).toEqual(["arc"]);
    expect(seen.map((s) => s.cacheArticle)).toEqual([false]);
  }, 30_000);
});
