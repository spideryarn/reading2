/**
 * The seam between a stage and the store: a stage returns a product, and a
 * short commit afterwards writes it, checks it, and finishes the step.
 *
 * docs/plans/260827aa-delete-the-importer.md § D1 splits in two — this is D1a, the shape
 * on the filesystem, where there is no transaction to hold.
 *
 * ## The bug these were written against
 *
 * `assertProduced` asks whether each declared artefact is readable *now*, and
 * its own comment already admitted it "cannot tell that this run wrote them"
 * (src/pipeline.ts). In Postgres `beginDraftIn` copies the previous revision's
 * artefacts into the draft before any stage runs, so a converted step that
 * returns `{ parts: {} }` — or a product missing one of two — writes nothing,
 * passes the postcondition against the **carried copy**, and is marked done.
 * For `blocks` that commits new stamped HTML beside old block rows, which is
 * the identity loss the whole migration exists to prevent, arriving through the
 * coordinator meant to prevent it. Found by GPT Sol reviewing the D1 design,
 * 2026-08-29 (docs/plans/260827aa-delete-the-importer-d1-design-sol.md, finding 2).
 *
 * So `commit` takes the **product**, not a closure, and validates before any
 * write. The test that matters is `refuses over an artefact carried from a
 * previous run`: against an empty directory a refusal proves nothing, because
 * there is no old artefact for the missing part to be mistaken for.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertProduced, STEP_ORDER, UNCONVERTED_STEPS } from "../src/pipeline.js";
import type { PipelineStep, StepContext, StepProduct } from "../src/pipeline.js";
import { fsStoreSession } from "../src/store/session.js";
import type { JobSettles, JobTransition, StoreSession } from "../src/store/session.js";
import { createFsArtifactStore, pathFor } from "../src/store/artifacts-fs.js";
import type { ArtifactLocations } from "../src/store/artifacts-fs.js";
import type { ArtifactStore } from "../src/store/artifacts.js";
import type { LabelsFile } from "../src/labels.js";
import type { Job, StepName, Tree } from "../src/types.js";

const SLUG = "test-store-session";

/** A tree that satisfies the store's shape check, with a title worth telling apart. */
function treeSaying(title: string): Tree {
  return {
    version: "toc/2",
    generator: "test",
    slug: SLUG,
    rootId: "n0000",
    nodes: {
      n0000: {
        id: "n0000",
        depth: 0,
        parent: null,
        children: [],
        range: ["spya-aaaaaa", "spya-aaaaaa"],
        title,
      },
    },
  };
}

/** The same, for stage 4's second artefact. */
function labelsSaying(label: string): LabelsFile {
  return {
    version: "labels/1",
    generator: "test",
    slug: SLUG,
    sourceHash: "0".repeat(16),
    structureHash: "0".repeat(16),
    structureVersion: "toc/2",
    labels: { n0000: label },
    batches: null,
  };
}

/**
 * A step that declares two artefacts, standing in for `hierarchy`.
 *
 * The name is a real one because `UNCONVERTED_STEPS` is keyed by `StepName` and
 * the filesystem session consults it; the `produces` list is narrowed to two so
 * that "returned one of the two" is a single missing kind rather than a crowd.
 */
function stepProducing(name: StepName, produces: PipelineStep["produces"]): PipelineStep {
  return {
    name,
    label: "Testing the seam",
    outputs: () => [],
    produces,
    /* **It throws rather than returning something, and that is the honest
       shape.** These cases hand `checkProduct` and `commit` a product directly —
       the subject is the rule that decides what a `run` may return, so nothing
       here runs one. It used to answer `{ detail: "never called" }`, which
       stopped compiling when `LEGACY_UNCONVERTED_STEPS` emptied on 2026-08-31
       and every step's `run` came to require a `ConvertedProduct`. Inventing a
       `parts` to satisfy the signature would put a fiction in the one fixture
       whose whole subject is what counts as a real product, and a cast would
       hide it. A throw satisfies the type, says what it means, and turns a
       future caller into an immediate error instead of a plausible answer. */
    run: async () => {
      throw new Error("stepProducing().run is never called — see the note beside it");
    },
  };
}

/** What the session did to the store, so a refusal can be checked as a non-event. */
interface Watched {
  store: ArtifactStore;
  writes: number;
  finishes: number;
}

function watch(store: ArtifactStore): Watched {
  const seen: Watched = {
    writes: 0,
    finishes: 0,
    store: {
      ...store,
      write: (...args) => {
        seen.writes += 1;
        return store.write(...args);
      },
      finishStep: (...args) => {
        seen.finishes += 1;
        return store.finishStep(...args);
      },
    },
  };
  return seen;
}

/**
 * The job half of the session, as the two methods it is allowed to call.
 *
 * A stub rather than a real `JobStore` because `JobSettles` is deliberately two
 * methods wide — the session may end a claim and may not claim, cancel or sweep
 * — so a two-method fake is the honest shape of what it can reach, and it
 * records that `commit` really did move the job on.
 */
interface FakeJobs extends JobSettles {
  releases: number;
  finishes: number;
  /** Stop was pressed while the step ran, so the *release* is where it lands. */
  cancelling: boolean;
}

/**
 * **The row each method returns is the row the real adapters return**, and this
 * used to be one frozen `status: "running"` object for both.
 *
 * That fake could not go red for anything: a release that had not released and
 * a finish that had not finished came back looking the same, and the session's
 * answer was read off the transition it had been handed rather than off the row.
 * `settlementOf` reads the row now, so a stub that lies about the row is a stub
 * that proves nothing — see docs/reusable/silent-success.md, and the note on
 * `JobSettlement`.
 *
 * So: `releaseStep` answers `queued`, or `cancelled` when `cancelling` is set,
 * exactly as `jobs-fs.ts` and `pg-jobs.ts` both do; `finish` answers with the
 * ending it was given.
 */
function fakeJobs(): FakeJobs {
  const base = {
    id: "spya-testjb",
    slug: SLUG,
    ownerId: "owner",
    steps: [],
    createdAt: "",
  } as unknown as Job;
  const jobs: FakeJobs = {
    releases: 0,
    finishes: 0,
    cancelling: false,
    releaseStep: async (_id, _attempt, steps) => {
      jobs.releases += 1;
      return {
        ...base,
        steps,
        status: jobs.cancelling ? ("cancelled" as const) : ("queued" as const),
      };
    },
    finish: async (_id, _attempt, ending) => {
      jobs.finishes += 1;
      return { ...base, steps: ending.steps, status: ending.status };
    },
  };
  return jobs;
}

/** The transition the ordinary "step done, job goes on" case carries. */
const RELEASE: JobTransition = {
  kind: "release",
  jobId: "spya-testjb",
  attempt: "spya-attempt",
  steps: [],
  fields: {},
};

let dir: string;
let at: ArtifactLocations;
let ctx: StepContext;
let watched: Watched;
let jobs: FakeJobs;

function sessionFor(unconverted?: ReadonlySet<StepName>): StoreSession {
  return fsStoreSession({
    artifacts: watched.store,
    jobs,
    ...(unconverted !== undefined && { unconverted }),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "store-session-"));
  at = { dir, htmlFile: path.join(dir, `${SLUG}.html`) };
  ctx = {
    slug: SLUG,
    dir: at.dir,
    htmlFile: at.htmlFile,
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
  watched = watch(createFsArtifactStore(() => at));
  jobs = fakeJobs();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Whatever is in the file, or `null` if there is none. */
async function textAt(step: StepName, kind: Parameters<typeof pathFor>[2]): Promise<string | null> {
  try {
    return await readFile(pathFor(at, step, kind), "utf-8");
  } catch {
    return null;
  }
}

describe("commit validates the product before it writes anything", () => {
  it("refuses a step that returned one of the two artefacts it declares", async () => {
    const session = sessionFor();
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    const attempt = await session.beginStep(SLUG, step.name);

    const product: StepProduct = { detail: "one of two", parts: { tree: treeSaying("New") } };
    await expect(session.commit(ctx, step, attempt, product, RELEASE)).rejects.toThrow(/labels/);

    expect(watched.writes, "wrote despite an incomplete product").toBe(0);
    expect(watched.finishes, "finished a step it refused").toBe(0);
    expect(await textAt("hierarchy", "tree")).toBeNull();
    expect(await textAt("hierarchy", "labels")).toBeNull();
  });

  /**
   * **The one that matters.** An empty directory cannot tell a refusal from a
   * write that happened to fail, and it has no old artefact for the missing
   * part to be mistaken for — which is the whole failure mode. So both
   * artefacts are seeded from an earlier run first, and the assertion is that
   * the old bytes are still there afterwards, unchanged, both of them.
   */
  it("refuses over an artefact carried from a previous run, and leaves it alone", async () => {
    await writeFile(pathFor(at, "hierarchy", "tree"), JSON.stringify(treeSaying("Old")), "utf-8");
    await writeFile(pathFor(at, "hierarchy", "labels"), JSON.stringify(labelsSaying("Old")), "utf-8");
    const before = {
      tree: await textAt("hierarchy", "tree"),
      labels: await textAt("hierarchy", "labels"),
    };

    const session = sessionFor();
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    const attempt = await session.beginStep(SLUG, step.name);

    const product: StepProduct = { detail: "one of two", parts: { tree: treeSaying("New") } };
    await expect(session.commit(ctx, step, attempt, product, RELEASE)).rejects.toThrow(/labels/);

    expect(watched.writes, "wrote despite an incomplete product").toBe(0);
    expect(watched.finishes, "finished a step it refused").toBe(0);
    /* Both halves. The old `labels` surviving is what stops the postcondition
       being satisfied by a carried copy; the old `tree` surviving is what says
       validation ran *before* the write rather than after it. */
    expect(await textAt("hierarchy", "labels"), "the carried artefact was touched").toBe(before.labels);
    expect(await textAt("hierarchy", "tree"), "the new tree was written anyway").toBe(before.tree);
  });

  /** `{ parts: {} }` is the same hole with a truthy object in it. */
  it("refuses an empty parts object, which is not the same as no parts", async () => {
    await writeFile(pathFor(at, "hierarchy", "tree"), JSON.stringify(treeSaying("Old")), "utf-8");
    await writeFile(pathFor(at, "hierarchy", "labels"), JSON.stringify(labelsSaying("Old")), "utf-8");

    const session = sessionFor();
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    const attempt = await session.beginStep(SLUG, step.name);

    await expect(
      session.commit(ctx, step, attempt, { detail: "nothing at all", parts: {} }, RELEASE),
    ).rejects.toThrow(/tree/);
    expect(watched.writes).toBe(0);
    expect(watched.finishes).toBe(0);
  });
});

/**
 * **The positive case, and it was missing until GPT Sol asked for it.**
 *
 * Every other test in this file is a *refusal*, and a suite of refusals says
 * nothing about the line the whole stage exists to add: deleting the
 * `store.write` call from `commit` left all eight of them green, and the
 * job-level test green too, because every stage still writes its own files.
 * The runner could have reverted to its old direct path and nothing would have
 * noticed. docs/reusable/silent-success.md, arriving in the tests rather than
 * in the code.
 *
 * So this commits a **complete** product over artefacts a previous run left,
 * and asks what is actually on disk afterwards.
 */
describe("a converted step, committed", () => {
  it("writes the new artefacts over the carried ones, and finishes the step", async () => {
    await writeFile(pathFor(at, "hierarchy", "tree"), JSON.stringify(treeSaying("Old")), "utf-8");
    await writeFile(pathFor(at, "hierarchy", "labels"), JSON.stringify(labelsSaying("Old")), "utf-8");

    const session = sessionFor();
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    const attempt = await session.beginStep(SLUG, step.name);

    await session.commit(
      ctx,
      step,
      attempt,
      { detail: "1 section", parts: { tree: treeSaying("New"), labels: labelsSaying("New") } },
      RELEASE,
    );

    // One call, with everything in it — not one per artefact. The interface
    // asks for that so an adapter which *can* be atomic across the set is given
    // the chance to be (src/store/artifacts.ts § `write`).
    expect(watched.writes, "the product was not written").toBe(1);
    expect(watched.finishes).toBe(1);

    /* **The new bytes, not the old ones.** A commit that skipped the write
       leaves the carried artefacts in place, and every other assertion in this
       file still passes over them — which is exactly how the missing write
       stayed invisible. */
    const tree = await watched.store.read(SLUG, "hierarchy", "tree");
    expect(tree?.nodes.n0000?.title).toBe("New");
    const labels = await watched.store.read(SLUG, "hierarchy", "labels");
    expect(labels?.labels.n0000).toBe("New");

    expect(await watched.store.interrupted(SLUG, "hierarchy")).toBe(false);
  });
});

describe("a step that writes its own artefacts inside run", () => {
  it("is accepted with no parts while it is marked unconverted", async () => {
    /* What an unconverted stage does today: it wrote these itself, during
       `run`, and returns a one-line detail and nothing else. */
    await writeFile(pathFor(at, "hierarchy", "tree"), JSON.stringify(treeSaying("Mine")), "utf-8");
    await writeFile(pathFor(at, "hierarchy", "labels"), JSON.stringify(labelsSaying("Mine")), "utf-8");

    const session = sessionFor(new Set<StepName>(["hierarchy"]));
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    const attempt = await session.beginStep(SLUG, step.name);

    await session.commit(ctx, step, attempt, { detail: "1 section" }, RELEASE);
    expect(watched.writes, "wrote for a step that writes its own").toBe(0);
    expect(watched.finishes).toBe(1);
    expect(await watched.store.interrupted(SLUG, "hierarchy")).toBe(false);
  });

  it("is refused with no parts once it is no longer marked unconverted", async () => {
    await writeFile(pathFor(at, "hierarchy", "tree"), JSON.stringify(treeSaying("Mine")), "utf-8");
    await writeFile(pathFor(at, "hierarchy", "labels"), JSON.stringify(labelsSaying("Mine")), "utf-8");

    const session = sessionFor(new Set<StepName>());
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    const attempt = await session.beginStep(SLUG, step.name);

    await expect(
      session.commit(ctx, step, attempt, { detail: "1 section" }, RELEASE),
    ).rejects.toThrow(/hierarchy/);
    expect(watched.finishes, "finished a step it refused").toBe(0);
    /* And the marker is still there, so the next run re-runs the step rather
       than trusting whatever the stage left behind. */
    expect(await watched.store.interrupted(SLUG, "hierarchy")).toBe(true);
  });

  /**
   * **Fail-closed, and it was the other way round for a few hours.**
   *
   * This used to assert that the exemption listed *every* step, so a peer adding
   * one was made to put it on the exemption to get the suite green — the unsafe
   * answer handed out by doing nothing. GPT Sol's finding 3. What is worth
   * holding is only that nothing on the list is a name the pipeline has never
   * heard of, because such a name would be an exemption granted to nothing and
   * would sit there for ever looking like it meant something.
   *
   * A step *off* the list is refused at runtime by the test above, and does not
   * compile at all — `PipelineStep<N>`'s `run` returns `ConvertedProduct` for
   * every name outside `LegacyUnconvertedStep`.
   */
  it("lists only real steps, and does not require every step to be on it", () => {
    for (const name of UNCONVERTED_STEPS) expect(STEP_ORDER, name).toContain(name);
    expect(UNCONVERTED_STEPS.size).toBeLessThanOrEqual(STEP_ORDER.length);
  });
});

describe("assertProduced still catches a step that claims to have written and did not", () => {
  it("refuses an unconverted step whose artefacts are not there", async () => {
    const session = sessionFor(new Set<StepName>(["hierarchy"]));
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    const attempt = await session.beginStep(SLUG, step.name);

    /* Permitted past the product check — it is marked unconverted — and then
       stopped by the postcondition, which is the guard that was already here. */
    await expect(
      session.commit(ctx, step, attempt, { detail: "1 section" }, RELEASE),
    ).rejects.toThrow(/finished without writing/);
    expect(watched.finishes, "finished a step with no artefacts").toBe(0);
  });

  it("is unchanged as a function: half of what a step declares is still missing", async () => {
    await writeFile(pathFor(at, "hierarchy", "tree"), JSON.stringify(treeSaying("Half")), "utf-8");
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    await expect(assertProduced(step, ctx, watched.store)).rejects.toThrow(
      /hierarchy finished without writing labels/,
    );
  });
});

/**
 * The three boundaries GPT Sol's finding 4 named, each of which lets something
 * through that reads as a completed step.
 */
describe("the edges of what a product may be", () => {
  it("refuses a part inherited from a prototype, which write() would not write", async () => {
    /* **`Object.hasOwn`, not a lookup.** `write` iterates `Object.entries`, which
       skips the prototype — so an inherited `labels` satisfies `parts.labels !==
       undefined`, is written nowhere, and then passes the postcondition against
       the `labels.json` the previous run left. The same hole as a missing part,
       through a door the obvious check does not watch. */
    await writeFile(pathFor(at, "hierarchy", "tree"), JSON.stringify(treeSaying("Old")), "utf-8");
    await writeFile(pathFor(at, "hierarchy", "labels"), JSON.stringify(labelsSaying("Old")), "utf-8");

    const parts = Object.create({ labels: labelsSaying("Inherited") }) as Record<string, unknown>;
    parts.tree = treeSaying("New");

    const session = sessionFor();
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    const attempt = await session.beginStep(SLUG, step.name);

    await expect(
      session.commit(ctx, step, attempt, { detail: "one own, one inherited", parts }, RELEASE),
    ).rejects.toThrow(/labels/);
    expect(watched.writes).toBe(0);
    expect(watched.finishes).toBe(0);
    // And the carried artefact that would have stood in for it is untouched.
    expect(await watched.store.read(SLUG, "hierarchy", "labels")).toMatchObject({
      labels: { n0000: "Old" },
    });
  });

  it("refuses an artefact the step does not declare, before writing the ones it does", async () => {
    /* The filesystem adapter writes what it recognises and then throws on the
       unknown `(step, kind)` pair, so a product with one extra key leaves the
       step neither written nor untouched. Refused up front instead. */
    const session = sessionFor();
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    const attempt = await session.beginStep(SLUG, step.name);

    await expect(
      session.commit(
        ctx,
        step,
        attempt,
        {
          detail: "one too many",
          parts: {
            tree: treeSaying("New"),
            labels: labelsSaying("New"),
            arc: { version: "arc/2", generator: "test", slug: SLUG, entries: [] },
          },
        },
        RELEASE,
      ),
    ).rejects.toThrow(/arc/);
    expect(watched.writes, "wrote before noticing the extra artefact").toBe(0);
    expect(await textAt("hierarchy", "tree"), "the declared artefacts were written anyway").toBeNull();
  });

  it("refuses a step that declares nothing, which could never be done", async () => {
    /* `has([], …)` deliberately answers false, so a step producing nothing can
       never satisfy the skip check — it would be committed, marked done, and
       re-run on every job for ever with nothing to show for it. */
    const session = sessionFor();
    const step = stepProducing("hierarchy", []);
    const attempt = await session.beginStep(SLUG, step.name);

    await expect(
      session.commit(ctx, step, attempt, { detail: "nothing at all", parts: {} }, RELEASE),
    ).rejects.toThrow(/declares no artefacts/);
    expect(watched.finishes).toBe(0);
  });
});

/**
 * The run phase gets six methods and no way back to the seventh.
 *
 * GPT Sol's fifth note, from the trace rather than the findings: `reads: store`
 * hands out the real object, so the narrowing is a type and a cast undoes it.
 * D1b needs a real facade anyway — there the read view and the write view are
 * over different executors.
 */
describe("what the run phase can reach", () => {
  it("is six read methods, and not the store behind them", () => {
    const session = sessionFor();
    expect(Object.keys(session.reads).sort()).toEqual([
      "has",
      "hasEarlierBlocks",
      "interrupted",
      "read",
      "readBaseline",
      "stampFor",
    ]);
    // The cast is the point: this is what a stage that wanted to write would do.
    expect((session.reads as unknown as ArtifactStore).write).toBeUndefined();
    expect((session.reads as unknown as ArtifactStore).finishStep).toBeUndefined();
  });

  it("still answers, and answers about the real store", async () => {
    /* A facade that returns undefined for everything would pass the test above.
       This is the other half: the six really delegate. */
    await writeFile(pathFor(at, "hierarchy", "tree"), JSON.stringify(treeSaying("Real")), "utf-8");
    const session = sessionFor();
    const tree = await session.reads.read(SLUG, "hierarchy", "tree");
    expect(tree?.nodes.n0000?.title).toBe("Real");
    expect(await session.reads.has(SLUG, "hierarchy", ["tree"])).toBe(true);
    expect(await session.reads.has(SLUG, "hierarchy", ["tree", "labels"])).toBe(false);
  });
});

/**
 * The job transition is part of the commit, not something that follows it.
 *
 * On the filesystem it is still the next write rather than the same one — there
 * is no transaction to share — but it is inside the same call, which is the
 * whole of what D1a can buy and exactly where D1b puts the boundary.
 */
describe("the job moves on inside the commit", () => {
  it("releases the claim once the step is committed, and not before", async () => {
    const session = sessionFor(new Set<StepName>(["hierarchy"]));
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    const attempt = await session.beginStep(SLUG, step.name);
    await writeFile(pathFor(at, "hierarchy", "tree"), JSON.stringify(treeSaying("Mine")), "utf-8");
    await writeFile(pathFor(at, "hierarchy", "labels"), JSON.stringify(labelsSaying("Mine")), "utf-8");

    const settled = await session.commit(ctx, step, attempt, { detail: "1 section" }, RELEASE);
    expect(jobs.releases).toBe(1);
    expect(jobs.finishes).toBe(0);
    expect(settled.kind).toBe("released");
    expect(settled.kind !== "kept" && settled.job.status).toBe("queued");
  });

  it("reports the ending when a Stop turns the release into a cancellation", async () => {
    /* **The one place a caller cannot read its own request.** Both stores settle
       a Stop inside `releaseStep` — the flag was set while the step ran, and
       releasing to `queued` with `cancelling` still on is a state nothing moves
       on. So the transition says "release" and the row comes back `cancelled`,
       and a session that answered from the transition would tell the reader the
       job was still working. */
    jobs.cancelling = true;
    const session = sessionFor(new Set<StepName>(["hierarchy"]));
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    const attempt = await session.beginStep(SLUG, step.name);
    await writeFile(pathFor(at, "hierarchy", "tree"), JSON.stringify(treeSaying("Mine")), "utf-8");
    await writeFile(pathFor(at, "hierarchy", "labels"), JSON.stringify(labelsSaying("Mine")), "utf-8");

    const settled = await session.commit(ctx, step, attempt, { detail: "1 section" }, RELEASE);
    expect(settled.kind).toBe("ended");
    if (settled.kind !== "ended") throw new Error("unreachable");
    expect(settled.ending.status).toBe("cancelled");
    expect(settled.job.status).toBe("cancelled");
  });

  it("leaves the job alone when the product is refused", async () => {
    const session = sessionFor();
    const step = stepProducing("hierarchy", ["tree", "labels"]);
    const attempt = await session.beginStep(SLUG, step.name);

    await expect(
      session.commit(ctx, step, attempt, { detail: "half", parts: { tree: treeSaying("New") } }, RELEASE),
    ).rejects.toThrow(/labels/);
    expect(jobs.releases, "let the claim go for a step it refused").toBe(0);
    expect(jobs.finishes).toBe(0);
  });

  it("ends the job on its own, for the endings that have no product", async () => {
    /* Every step skipped: `commit` is never called, and this is the door that
       ending goes through instead. */
    const session = sessionFor();
    await session.settleJob({
      kind: "end",
      jobId: "spya-testjb",
      attempt: "spya-attempt",
      ending: { status: "done", steps: [] },
    });
    expect(jobs.finishes).toBe(1);
    expect(jobs.releases).toBe(0);
  });
});
