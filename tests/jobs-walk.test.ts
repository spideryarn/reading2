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
 * ## Why it drives `advanceJobWith` with a fake artefact store
 *
 * The job store is **real** — `fsJobStore`, with its real claim, its real fence
 * and its real release — because every claim about a claim is a claim about
 * that, and so is the real `fsStoreSession` over it. What is faked is the
 * artefact store underneath, so that a step can be made to fail, to plant an
 * artefact, or to look at the job row from inside itself without a fixture on
 * disk. A test that stubbed the *session* would be testing the stub: the whole
 * question here is which transition the coordinator asks for and what it does
 * with the answer.
 *
 * The fake holds opaque values under `(slug, step, kind)`, and nothing under
 * test reads their contents — `stepIsDone` asks `has`, `assertProduced` asks
 * whether `read` comes back non-null. Said here rather than left for somebody
 * to discover that the shapes are not real artefacts.
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
 * - **`runInJob` is in effect**: call `walkClaim` directly rather than through
 *   `runInJob` — which is the state production actually shipped in, and nothing
 *   caught it (docs/plans/260830k-v1-stages01-review-sol.md critical 1).
 */
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { mintId } from "../src/ids.js";
import { currentJobId } from "../src/job-scope.js";
import { advanceJobWith, LEASE_MS, STEP_BUDGET_MS, type AdvanceParts } from "../src/jobs.js";
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
import type { Job, JobStep, StepName } from "../src/types.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const JOBS_DIR = path.join(ROOT, "data", "_jobs");
const OWNER = DEV_OWNER_ID;

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

/** Every job this file made, so the shared `data/_jobs/` is left as it was. */
const MADE: string[] = [];

/* ------------------------------------------------------------ the artefacts -- */

interface FakeArtifacts {
  readonly store: ArtifactStore;
  /** Put an artefact there without a step having run — a step already current. */
  put(slug: string, step: StepName, kind: ArtifactKind, value: unknown): void;
}

function memoryArtifacts(): FakeArtifacts {
  const held = new Map<string, unknown>();
  const running = new Set<string>();
  const key = (slug: string, step: StepName, kind: ArtifactKind) => `${slug}|${step}|${kind}`;

  const store: ArtifactStore = {
    has: async (slug, step, kinds) =>
      kinds.length > 0 && kinds.every((kind) => held.has(key(slug, step, kind))),
    hasEarlierBlocks: async () => false,
    async read<K extends ArtifactKind>(slug: string, step: StepName, kind: K) {
      return (held.get(key(slug, step, kind)) ?? null) as ArtifactMap[K] | null;
    },
    async readBaseline<K extends ArtifactKind>(slug: string, step: StepName, kind: K) {
      const value = held.get(key(slug, step, kind)) as ArtifactMap[K] | undefined;
      return value === undefined
        ? ({ state: "absent" as const })
        : ({ state: "present" as const, value });
    },
    write: async (slug, step, parts) => {
      for (const [kind, value] of Object.entries(parts)) {
        held.set(key(slug, step, kind as ArtifactKind), value);
      }
    },
    stampFor: async () => null,
    /* The marker, and it is the real rule: set when a step starts, cleared only
       when it finishes, so a step that threw reads as interrupted and the next
       claim re-runs it. */
    beginStep: async (slug, step) => {
      running.add(`${slug}|${step}`);
      return mintAttempt();
    },
    finishStep: async (slug, step) => {
      running.delete(`${slug}|${step}`);
    },
    interrupted: async (slug, step) => running.has(`${slug}|${step}`),
  } as ArtifactStore;

  return {
    store,
    put: (slug, step, kind, value) => {
      held.set(key(slug, step, kind), value);
    },
  };
}

/* ---------------------------------------------------------------- the steps -- */

/** What the fake steps did, in the order it happened. */
interface Ran {
  readonly names: StepName[];
}

/**
 * A **converted** step: it writes nothing itself and returns everything it
 * declares, which is what all but `fetch` and `extract` now do
 * (`LEGACY_UNCONVERTED_STEPS`). The session's commit is what puts the artefacts
 * in the store, so `assertProduced` reads back what this returned.
 *
 * **It wrote them inside `run` and returned a bare detail until 2026-08-31**,
 * which was the honest fixture while every real step did that. It stopped being
 * honest the moment they were converted, and it stopped *compiling as a
 * fixture* the moment `checkProduct` was asked with no exemption for those
 * names — which is the guard working, not the fixture breaking.
 *
 * A step that returns nothing at all is a different case with its own tests.
 *
 * `body` is where a case puts what it wants to happen *while a step is running*:
 * throw, look at the job row, press Stop from somewhere else.
 */
function fakeStep(
  name: StepName,
  ran: Ran & { names: StepName[] },
  body: () => Promise<void> | void = () => {},
): PipelineStep {
  return {
    name,
    label: STEPS[name].label,
    outputs: () => [],
    produces: STEPS[name].produces,
    async run(): Promise<StepProduct> {
      ran.names.push(name);
      await body();
      /* Everything it declares, so `checkProduct` accepts it and
         `assertProduced` reads it back. The cases that want an artefact
         *already* present — a step that should skip — put it there with `put`
         before the walk starts, which is why this no longer takes the store. */
      const parts = Object.fromEntries(
        STEPS[name].produces.map((kind) => [kind, { made: name }]),
      ) as ArtifactParts;
      return { parts, detail: `${name} ran` };
    },
  } as PipelineStep;
}

/* ------------------------------------------------------------------ the job -- */

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
  const { job } = await fsJobStore.enqueueOrGet(wanted, { workKey: `walk-${wanted.id}`, reservesName: false });
  MADE.push(job.id);
  return job;
}

/** The real filesystem session over the fake artefacts, and the fake steps. */
function partsFor(
  artifacts: FakeArtifacts,
  steps: Partial<Record<StepName, PipelineStep>>,
): AdvanceParts {
  return {
    session: async () => fsStoreSession({ artifacts: artifacts.store, jobs: fsJobStore }),
    steps: { ...STEPS, ...steps } as AdvanceParts["steps"],
  };
}

/** A whole fixture: the store, the log, the job, and the parts to advance it. */
async function fixture(
  slug: string,
  names: StepName[],
  bodies: Partial<Record<StepName, () => Promise<void> | void>> = {},
) {
  const artifacts = memoryArtifacts();
  const ran: Ran & { names: StepName[] } = { names: [] };
  const steps = Object.fromEntries(
    names.map((name) => [name, fakeStep(name, ran, bodies[name])]),
  ) as Partial<Record<StepName, PipelineStep>>;
  const job = await queueJob(slug, names);
  return { artifacts, ran, job, parts: partsFor(artifacts, steps) };
}

/* --------------------------------------------------------------- the cases -- */

describe("one claim walks the whole job", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const file of await readdir(JOBS_DIR).catch(() => [])) {
      const full = path.join(JOBS_DIR, file);
      const record = JSON.parse(await readFile(full, "utf8").catch(() => "{}")) as { id?: string };
      if (record.id !== undefined && MADE.includes(record.id)) await rm(full, { force: true });
    }
  });

  it("runs every step in one call, on one claim and one attempt", async () => {
    const names: StepName[] = ["fetch", "extract", "blocks"];
    const { ran, job, parts } = await fixture("test-walk-whole-job", names);

    /* The real store, watched rather than replaced. `claim` is the statement a
       second request would have to win, so counting it is the claim about
       claims; the attempt tokens are the same fact said the other way. */
    const claimed = vi.spyOn(fsJobStore, "claim");
    const attempts = new Set<string>();
    const realNote = fsJobStore.noteProgress.bind(fsJobStore);
    vi.spyOn(fsJobStore, "noteProgress").mockImplementation(async (id, attempt, steps) => {
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
        const outcome = await fsJobStore.claim(job.id, OWNER, mintAttempt(), LEASE_MS, 4);
        probe.refused = outcome.kind;
        probe.status = (await fsJobStore.get(job.id, OWNER))?.status;
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
        const stored = await fsJobStore.get(job.id, OWNER);
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
    expect(advanced?.job.error).toBe("the extractor fell over");
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
        await fsJobStore.requestCancel(job.id, OWNER);
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

  it("puts the job id in scope for the steps it runs", async () => {
    /**
     * **`runInJob` existed and nothing called it.** The bundle carried an
     * `AsyncLocalStorage` and a `currentJobId()` with no way to fill it, so on a
     * deployed instance `dataRoot()` was asked for a directory with no job in
     * scope and threw before the first step started — every import on production
     * failing in 16ms. GPT Sol, docs/plans/260830k-v1-stages01-review-sol.md critical 1.
     *
     * Asserted from **inside** a step and after an `await`, because that is the
     * property: an `AsyncLocalStorage` that survives the awaits between the
     * claim and the stage's own writes.
     */
    const seen: { before: string | null; inside?: string | null } = { before: currentJobId() };
    const { job, parts } = await fixture("test-walk-scope", ["fetch"], {
      fetch: async () => {
        await Promise.resolve();
        seen.inside = currentJobId();
      },
    });

    await advanceAsOwner(job.id, parts);

    expect(seen.before, "nothing outside a claim is in a job scope").toBeNull();
    expect(seen.inside, "and the step ran inside this job's").toBe(job.id);
    expect(currentJobId(), "and the scope closed again afterwards").toBeNull();
  });
  /**
   * **Two jobs on one article: the second waits, and the first's work survives
   * it.**
   *
   * The per-article queue's acceptance case at the coordinator's level —
   * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md
   * § 1k.2. It has two halves and **the second is the one that matters**: a
   * `busy` that is really a lost publication passes the first half perfectly
   * well, so a test that stops at "the second one waited" is a test that would
   * be green over the very corruption serialising exists to prevent
   * (src/store/artifacts-fs.ts keys every artefact write on `(slug, step)` in
   * one shared directory, with no job scoping).
   *
   * **The two jobs share one artefact store**, which is what makes the second
   * half a real question. `fixture` builds a store per call, so this case wires
   * its own.
   *
   * **`createdAt` is set explicitly**, a second apart. The order is
   * `(createdAt, id)` and `id` is random, so two rows minted in one millisecond
   * would settle it by luck and this would be asserting `mintId`'s output.
   */
  it("makes a second job wait, and leaves the first job's artefacts alone", async () => {
    const slug = "test-walk-two-in-a-line";
    const artifacts = memoryArtifacts();
    const ranFirst: Ran & { names: StepName[] } = { names: [] };
    const ranSecond: Ran & { names: StepName[] } = { names: [] };

    const at = (ms: number) => new Date(Date.UTC(2026, 8, 2, 12, 0, 0) + ms).toISOString();
    const first = await queueJob(slug, ["fetch", "extract"], at(0));
    const second = await queueJob(slug, ["blocks"], at(1000));

    /* **Before anything runs**, and this is the rule rather than the mutex: the
       older job is not running either, so nothing but the line is keeping the
       younger one out. */
    const early = await fsJobStore.claim(second.id, OWNER, mintAttempt(), LEASE_MS, 4);
    expect(early.kind, "the second job claimed while an older one was ahead of it").toBe("busy");
    expect(early.kind === "busy" ? early.why : "").toMatch(/ahead of it/);

    const firstParts = partsFor(artifacts, {
      fetch: fakeStep("fetch", ranFirst),
      extract: fakeStep("extract", ranFirst),
    });
    const advancedFirst = await advanceAsOwner(first.id, firstParts);
    expect(advancedFirst?.job.status).toBe("done");
    expect(ranFirst.names).toEqual(["fetch", "extract"]);

    /* What the first job left behind, read before the second one starts. */
    const html = await artifacts.store.read(slug, "extract", "extractedHtml");
    const meta = await artifacts.store.read(slug, "extract", "meta");
    expect(html, "the first job wrote nothing to compare against").not.toBeNull();

    const secondParts = partsFor(artifacts, { blocks: fakeStep("blocks", ranSecond) });
    const advancedSecond = await advanceAsOwner(second.id, secondParts);

    /* The line drains: what was refused above runs now, unaided. */
    expect(advancedSecond?.busy, "the second job never got its turn").toBe(false);
    expect(advancedSecond?.job.status).toBe("done");
    expect(ranSecond.names).toEqual(["blocks"]);

    /* **The half that matters.** The second job published over the same article
       and the first job's artefacts are byte-for-byte what they were. */
    expect(await artifacts.store.read(slug, "extract", "extractedHtml")).toEqual(html);
    expect(await artifacts.store.read(slug, "extract", "meta")).toEqual(meta);
    /* And the second job's own output is there, so this is not green because
       nothing happened. */
    expect(await artifacts.store.read(slug, "blocks", "blocks")).not.toBeNull();
  });
});
