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
 * last case here reads the new job's flags **out of `data/_jobs/`**, which is
 * the only thing a later request will see.
 *
 * ## Why this needs no network, no model call and no database
 *
 * The old job is driven by `advanceJobWith` over **fake steps and a fake
 * artefact store**, the arrangement `tests/jobs-walk.test.ts` set up and for the
 * same reason: the job store is real, the session is real, and what is faked is
 * the thing underneath that would otherwise cost money. Sol was right that the
 * claim in the other file — that an end-to-end retry test needs paid calls — was
 * overclaimed.
 *
 * The one real thing that runs is the **new** job's pump, which `enqueue`
 * starts: its first step is `fetch`, the slug has no source URL, and
 * `requireUrl` (src/pipeline.ts) throws before anything reaches the network.
 * That is the same offline failure `tests/owner-jobs.test.ts` is built on.
 *
 * ## The mutations, watched red on 2026-09-01
 *
 * Each applied to `retryJob` in src/jobs.ts, run, and taken out again.
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
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { mintId } from "../src/ids.js";
import { stageFailure } from "../src/job-failure.js";
import { advanceJobWith, cancelJob, forgetJob, getJob, retryJob } from "../src/jobs.js";
import type { AdvanceParts } from "../src/jobs.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep, type StepProduct } from "../src/pipeline.js";
import type {
  ArtifactKind,
  ArtifactMap,
  ArtifactParts,
  ArtifactStore,
} from "../src/store/artifacts.js";
import { fsJobStore } from "../src/store/jobs-fs.js";
import { mintAttempt } from "../src/store/jobs.js";
import { fsStoreSession } from "../src/store/session.js";
import { jobFilesOnDisk } from "./helpers/job-files.js";
import type { Job, JobStep, StepName } from "../src/types.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const OWNER = DEV_OWNER_ID;

/**
 * **`it`, with this file's owner in scope for the whole body.**
 *
 * `getJob`, `retryJob` and `cancelJob` are all owner-scoped, and outside a
 * request they ask `currentOwnerId()` — which answers with
 * `SPIDERYARN_OWNER_ID` where `.env.local` sets one, and the fixtures here are
 * queued under `DEV_OWNER_ID`. On a machine that has run
 * `scripts/setup-local.ts` the two disagree and every case fails with *"the
 * fixture job is not in the store"*, which reads as a broken fixture rather
 * than as two owners. Scoping the body rather than each call keeps the tests
 * readable and covers the ones added next. Same reason as `advanceAsOwner` in
 * tests/jobs-walk.test.ts.
 */
const itAsOwner = (name: string, body: () => Promise<void>) =>
  it(name, () => runAsOwner(OWNER, body));

/** Its own slug stem, so nothing here meets another suite's fixtures. */
const SLUG_PREFIX = "test-retry-guard-";

/** One per case, named here so the sweep at the end can find their leftovers. */
const SLUGS = ["done", "queued", "permanent", "refresh", "cancelled"].map(
  (name) => `${SLUG_PREFIX}${name}`,
);

/** Every job this file made, so the shared `data/_jobs/` is left as it was. */
const MADE: string[] = [];

/* ------------------------------------------------------------ the artefacts -- */

/**
 * An artefact store in a `Map`, so a fake step can finish without a fixture.
 *
 * Copied from tests/jobs-walk.test.ts, which explains the shape: nothing under
 * test reads the values, because `stepIsDone` asks `has` and `assertProduced`
 * asks whether `read` comes back non-null.
 */
function memoryArtifacts(): ArtifactStore {
  const held = new Map<string, unknown>();
  const running = new Set<string>();
  const key = (slug: string, step: StepName, kind: ArtifactKind) => `${slug}|${step}|${kind}`;

  return {
    has: async (slug, step, kinds) =>
      kinds.length > 0 && kinds.every((kind) => held.has(key(slug, step, kind))),
    hasEarlierBlocks: async () => false,
    async read<K extends ArtifactKind>(slug: string, step: StepName, kind: K) {
      return (held.get(key(slug, step, kind)) ?? null) as ArtifactMap[K] | null;
    },
    async readBaseline<K extends ArtifactKind>(slug: string, step: StepName, kind: K) {
      const value = held.get(key(slug, step, kind)) as ArtifactMap[K] | undefined;
      return value === undefined
        ? { state: "absent" as const }
        : { state: "present" as const, value };
    },
    write: async (slug, step, parts) => {
      for (const [kind, value] of Object.entries(parts)) {
        held.set(key(slug, step, kind as ArtifactKind), value);
      }
    },
    stampFor: async () => null,
    beginStep: async (slug, step) => {
      running.add(`${slug}|${step}`);
      return mintAttempt();
    },
    finishStep: async (slug, step) => {
      running.delete(`${slug}|${step}`);
    },
    interrupted: async (slug, step) => running.has(`${slug}|${step}`),
  } as ArtifactStore;
}

/* ---------------------------------------------------------------- the steps -- */

/**
 * A step that returns everything it declares and writes nothing.
 *
 * `body` is where a case puts what it wants to happen while a step runs: throw
 * the failure the job is supposed to end on, or press Stop from outside.
 */
function fakeStep(name: StepName, body: () => Promise<void> | void = () => {}): PipelineStep {
  return {
    name,
    label: STEPS[name].label,
    outputs: () => [],
    produces: STEPS[name].produces,
    async run(): Promise<StepProduct> {
      await body();
      const parts = Object.fromEntries(
        STEPS[name].produces.map((kind) => [kind, { made: name }]),
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
  const { job } = await fsJobStore.enqueueOrGet(wanted, { workKey: `retry-guard-${wanted.id}`, reservesName: false });
  MADE.push(job.id);
  return job;
}

/** The real filesystem session over the fake artefacts, and the fake steps. */
function partsFor(
  artifacts: ArtifactStore,
  steps: Partial<Record<StepName, PipelineStep>>,
): AdvanceParts {
  return {
    session: async () => fsStoreSession({ artifacts, jobs: fsJobStore }),
    steps: { ...STEPS, ...steps } as AdvanceParts["steps"],
  };
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
    names.map((name) => [name, fakeStep(name, bodies[name])]),
  ) as Partial<Record<StepName, PipelineStep>>;
  /* Inside this file's owner: `advanceJobWith` asks `currentOwnerId()`, which
     outside a request is `SPIDERYARN_OWNER_ID` where `.env.local` sets one, and
     the fixture above is queued under `DEV_OWNER_ID`. Without the scope the
     claim answers `gone` on a machine that has run scripts/setup-local.ts. */
  const advanced = await runAsOwner(OWNER, () =>
    advanceJobWith(job.id, partsFor(memoryArtifacts(), steps)),
  );
  expect(advanced?.done, "the fixture job has to have finished for the case to mean anything").toBe(
    true,
  );
  const ended = await getJob(job.id);
  if (!ended) throw new Error(`the fixture job ${job.id} is not in the store`);
  return ended;
}

/* --------------------------------------------------------------- the reads -- */

/** The job records on disk for one slug — the money assertion, counted. */
async function jobsOnDisk(slug: string): Promise<Job[]> {
  const out: Job[] = [];
  for (const { record } of await jobFilesOnDisk()) {
    if (record.slug === slug) out.push(record as Job);
  }
  return out;
}

/**
 * Wait for a job to stop moving, so cleanup does not race the pump.
 *
 * The retried jobs really are driven, by the pump `enqueue` starts, and their
 * first step fails offline in milliseconds. Deleting a record from under a
 * write in flight puts it straight back.
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

describe("retrying a job", () => {
  afterAll(async () => {
    for (const id of MADE) await forgetJob(id).catch(() => undefined);
    for (const { path: full, record } of await jobFilesOnDisk()) {
      if (record.slug?.startsWith(SLUG_PREFIX)) await rm(full, { force: true });
    }
    for (const slug of SLUGS) {
      await rm(path.join(ROOT, "data", slug), { recursive: true, force: true });
    }
  });

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
    expect(await jobsOnDisk(slug), "the refusal must not have queued anything").toHaveLength(1);
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
    expect(await jobsOnDisk(slug)).toHaveLength(1);

    /* Left terminal rather than queued, so it does not hold this slug for the
       rest of the worker's life. */
    await cancelJob(job.id);
  });

  /* ------------------------------------------------------------------ 3 -- */

  /**
   * **A failure that cannot come out differently is refused too**, which is the
   * server agreeing with the button rather than being more permissive than it.
   *
   * `stageFailure("ours", …)` is what a stage throws when another attempt asks
   * the same question and gets the same answer — no source URL, a tree that does
   * not fit its blocks. `jobWorthRetrying` is what the card reads, and it is now
   * what this reads.
   */
  itAsOwner("refuses a failure another attempt cannot change", async () => {
    const slug = `${SLUG_PREFIX}permanent`;
    const failed = await runToTheEnd(slug, ["fetch"], {
      bodies: () => ({
        fetch: () => {
          throw stageFailure("ours", `No source URL for "${slug}".`);
        },
      }),
    });
    expect(failed.status).toBe("error");
    expect(failed.failureKind, "the fixture has to carry the kind the guard reads").toBe("ours");

    await expect(retryJob(failed.id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("same way"),
    });
    expect(await jobsOnDisk(slug)).toHaveLength(1);
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
   *    back out of `data/_jobs/` rather than off the object `retryJob`
   *    returned. That is the wiring: `retryJob` → `forceForRetry` → `enqueue` →
   *    `cascadeForce` → `newStep` → the file a later request reads.
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
    MADE.push(retried.id);
    expect(retried.id).not.toBe(failed.id);

    const [record] = (await jobsOnDisk(slug)).filter((j) => j.id === retried.id);
    expect(record, "the new job is not in `data/_jobs/`").toBeTruthy();
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
    MADE.push(retried.id);
    expect(retried.status).toBe("queued");

    await settle(retried.id);
  });
});
