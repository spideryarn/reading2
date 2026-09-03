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
 */
import { vi } from "vitest";

/* `delete` rather than `"files"`: unset is the state a fresh clone is in, and
   `storeFromEnv` treats the two the same on purpose (src/store/live.ts). Hoisted
   so it lands before `src/store/live.js` reads the environment. */
const HOISTED = vi.hoisted(() => {
  const previousStore = process.env.SPIDERYARN_STORE;
  delete process.env.SPIDERYARN_STORE;
  return { previousStore };
});

import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mintId } from "../src/ids.js";
import { advanceJobWith } from "../src/jobs.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep, type StepContext } from "../src/pipeline.js";
import { fsArtifacts } from "../src/store/artifacts-fs.js";
import { fsJobStore } from "../src/store/jobs-fs.js";
import { STORE } from "../src/store/live.js";
import { fsStoreSession } from "../src/store/session.js";
import type { ArtifactReads } from "../src/store/artifacts.js";
import type { StoreSession } from "../src/store/session.js";
import type { Job, JobStep, StepName } from "../src/types.js";

if (HOISTED.previousStore !== undefined) process.env.SPIDERYARN_STORE = HOISTED.previousStore;

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
    outputs: () => [],
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

/** One slug for every job here, so the artefacts land in one directory to remove. */
const SLUG = "article-cache-call-site-fixture";

const MADE: string[] = [];

async function queueTwoModeJob(steps: StepName[]): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: DEV_OWNER_ID,
    slug: SLUG,
    steps: steps.map((name) => ({ name, label: STEPS[name].label, status: "pending" }) satisfies JobStep),
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await fsJobStore.enqueueOrGet(wanted, {
    workKey: `article-cache-call-site-${wanted.id}`,
    reservesName: false,
  });
  MADE.push(job.id);
  return job;
}

/** The real filesystem session, with only the freshness reads replaced. */
function session(): StoreSession {
  return { ...fsStoreSession({ artifacts: fsArtifacts, jobs: fsJobStore }), reads: READS };
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
        session: async () => session(),
        steps: { ...STEPS, ...registry } as never,
      });
      if (advanced?.done !== false) return;
    }
  });
}

describe("the cacheArticle flag, as the job walk actually sets it", () => {
  beforeAll(() => {
    /* The control on the control: a flag that failed to take would run this
       against Postgres, which is a different session and a different test. */
    expect(STORE).toBe("files");
  });

  afterAll(async () => {
    /* Both of the repository directories this writes into. `fsJobStore` and
       `fsArtifacts` use module-level constants rather than a scratch root, so
       the records and the artefacts have to be taken out by hand — as
       tests/all-skipped-publication-log.test.ts does for the first of them. */
    const jobsDir = path.resolve(import.meta.dirname, "..", "data", "_jobs");
    for (const file of await readdir(jobsDir).catch(() => [])) {
      const full = path.join(jobsDir, file);
      const record = JSON.parse(await readFile(full, "utf8").catch(() => "{}")) as { id?: string };
      if (record.id !== undefined && MADE.includes(record.id)) await rm(full, { force: true });
    }
    await rm(path.resolve(import.meta.dirname, "..", "data", SLUG), { recursive: true, force: true });
  });

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
