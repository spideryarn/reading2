/**
 * **A late step must read the article from the store, not from `ctx.dir`.**
 *
 * The production failure of 2026-08-30, reproduced. Three single-step jobs —
 * one `tweets` and two `arc`, against articles that were already published —
 * died two seconds after they were queued with
 *
 *     ENOENT: no such file or directory, open
 *     '/tmp/spideryarn/<owner>/spya-bpcjus/data/nagel-bat/blocks.json'
 *
 * Why there is nothing at that path, and why nothing put it there. On a
 * deployed instance the filesystem store's root was `/tmp/spideryarn/<owner>/<job>/`
 * (`src/store/data-root.ts`, deleted 2026-09-05) — scoped to **one job**,
 * deliberately, so that a
 * failed job's half-built artefacts cannot be served as the next job's. A job
 * created as `{ slug, steps: ["tweets"] }` has exactly one step in it, so
 * `fetch`, `extract`, `blocks` and `hierarchy` never run and never write. The
 * article's blocks are in Postgres, where the ingest that made them published
 * them. The scratch directory is empty and always will be.
 *
 * The stage then reads `path.join(opts.dir, "blocks.json")` off that empty
 * directory. It works on a laptop for one reason only: `dataRoot()` there is the
 * repository root, so `data/<slug>/blocks.json` is a file the last ingest left
 * lying about.
 *
 * ## What the split looks like
 *
 * The step interface already hands `run` an `ArtifactReads` — `blocks` is the
 * one stage that uses it — and `stamp` uses it too. So today one half of every
 * late step asks the store whether its artefact is current and the other half
 * reads a path. This file is that split written down: the store is given the
 * article, the context is not, and the step is asked to run. **`ctx.dir` is
 * gone entirely since 2026-09-05**, so the split this file was written to show
 * is now closed by the type rather than by the fixture; what is left, and what
 * these cases still are, is that a late step reads its inputs through the store.
 *
 * The model is stubbed, so the real `generateTweets`/`generateArc` run end to
 * end; nothing here reaches the network.
 *
 * ## The store here is a fake, and it always was one
 *
 * Until 2026-09-05 it was a `createFsArtifactStore` over a copy of `example/`.
 * That was never the subject: what this file needs is *a store that can see the
 * article while `ctx.dir` cannot*, and the filesystem one was the cheapest such
 * store to build. It is `memoryArtefactsFrom` now
 * ([helpers/memory-artefacts.ts](helpers/memory-artefacts.ts)), which reads the
 * same copy of `example/` off the disk once and then answers from memory — so
 * stage G of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * could delete `src/store/artifacts-fs.ts` without this file noticing — which
 * it did, the same day, along with `StepContext.dir`. `coldContext()` cannot be
 * given a directory at all now, which was the instruction this paragraph used
 * to have to write down.
 *
 * **Mutation.** Two arms, run 2026-09-05. (1) `tryReadArticle` in
 * src/article-input.ts made to take its blocks from a `null` instead of from
 * `store.read` — the stage no longer reading the store: **2 of 4 red**, the
 * `tweets` and `arc` cases both on *promise rejected "No blocks or tree for
 * nagel-bat" instead of resolving*. The first case stays green because it asks
 * the store directly, which is the division of labour this file wants. (2)
 * `memoryArtefactsFrom` made to count what it found and plant none of it —
 * **3 of 4 red**, adding *actual value must be number or bigint, received
 * "undefined"* on the store's own case and *the fixture has no tree* on `arc`.
 * The negative control is green under both arms, which is what says it is
 * independent of the store being loaded rather than riding on it.
 *
 * **Blind to.** Whether production hands a late step a store rooted anywhere
 * useful — that is `claimSession` and lives in
 * `tests/claim-session-postgres.test.ts`. Also blind to any behaviour that is
 * genuinely the *filesystem* adapter's: the fake does not alias
 * `extractedHtml`/`stampedHtml` onto one file, and nothing here reads either.
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { partsOf } from "../src/arc.js";
import { STEPS } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import type { ArtifactReads } from "../src/store/artifacts.js";
import { memoryArtefacts, memoryArtefactsFrom } from "./helpers/memory-artefacts.js";

/* ------------------------------------------------------- the stubbed model -- */

/** What the next call answers. One entry per call the test expects. */
const answers: string[] = [];

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => {
      const text = answers.shift();
      if (text === undefined) throw new Error("the stub ran out of scripted answers");
      const message = {
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text, citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return {
        onText: () => undefined,
        aborted: () => false,
        finalMessage: () => Promise.resolve(message),
      };
    },
  };
});

/* --------------------------------------------------------------- the fixture -- */

const REPO = path.resolve(import.meta.dirname, "..");
const SLUG = "nagel-bat";

/** Where the article is: a copy of `example/`, standing in for Postgres. */
let published = "";
/*
 * **`scratch` stood here until 2026-09-05** — an empty `mkdtemp` directory
 * standing in for the job-scoped `/tmp` a cold instance hands a late step, so
 * that `ctx.dir` could point at somewhere the article demonstrably was not.
 * `StepContext.dir` went with the filesystem store in stage G of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * so the asymmetry this file rests on is now structural: there is no directory
 * to hand a step at all, and the store is the only thing it is given.
 */

/**
 * The store the run phase gets — rooted at the published copy, **not** at the
 * job's directory. That is the whole point: the store can see the article and
 * the directory cannot, which is exactly the deployed shape.
 */
let store: ArtifactReads;

beforeAll(async () => {
  published = await mkdtemp(path.join(tmpdir(), "spya-published-"));
  await cp(path.join(REPO, "example"), path.join(published, "data", SLUG), { recursive: true });
  /* **Read off the disk once, then held in memory** — the copy of `example/` is
     still what the article *is*, and `memoryArtefactsFrom` refuses an empty
     load, so a fixture that stopped being copied fails here rather than three
     stages later saying "run the hierarchy step first". */
  store = await memoryArtefactsFrom(published, SLUG);
});

afterAll(async () => {
  await rm(published, { recursive: true, force: true });
});

/**
 * The context a cold instance hands a late step.
 *
 * **It carried a directory until 2026-09-05**, deliberately an empty one — see
 * where `scratch` stood, above. It carries the slug and nothing about storage
 * now, which is the same claim made by the type instead of by a fixture.
 */
function coldContext(): StepContext {
  return {
    slug: SLUG,
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/**
 * **No mutation of its own** — this is the file's only block, so the two arms in
 * the header are its evidence: 2 of its 4 cases red when the stage stops reading
 * the store, 3 of 4 when the store stops holding the article.
 */
describe("a single-step job on an instance that never ingested the article", () => {
  it("the store holds the blocks the step needs", async () => {
    /* If this ever fails the rest of the file proves nothing — it would be
       testing an absent article rather than an unreachable one. */
    const file = await store.read(SLUG, "hierarchy", "blocks");
    expect(file?.blocks.length).toBeGreaterThan(0);
  });

  /**
   * **These two were pinned to the defect until 2026-08-31, and now they are
   * pinned to the fix.**
   *
   * They read `.rejects.toThrow(/ENOENT.*blocks\.json/)` for one day — the bug
   * itself, asserted, so that a known-red gate did not train several agents
   * sharing this tree to read past `npm test`. Stage 2a of
   * docs/plans/260831b-finish-the-database-move.md changed what the stage reads: every
   * article-reading stage now takes an `Article` read from the store
   * (src/article-input.ts) rather than opening `blocks.json` off `ctx.dir`.
   *
   * **What these prove, and — more important — what they do not.** The store
   * here is rooted at a published copy while `ctx.dir` is an empty temporary
   * directory. So a stage that still read the directory cannot pass by luck,
   * and a stage that reads the store cannot fail by luck. That asymmetry is the
   * entire fixture, and `coldContext()` must never be given a directory with an
   * article in it.
   *
   * **Production hands the step a store like this one, since 2026-09-01.** This
   * paragraph said the opposite for a day after the work landed, and it is kept
   * rather than deleted because the thing it warned about was real: while
   * src/jobs.ts built `fsStoreSession({ artifacts: fsArtifacts })`, a deployment
   * rooted that store at the same job-scoped `/tmp` as the directory, so these
   * cases were *the stage being ready for a store that can see the article, not
   * evidence that one exists*. `claimSession` returns `openPgStoreSession` now
   * — commit `c42c940`, docs/plans/260830aq-late-steps-read-the-store.md — and
   * tests/claim-session-postgres.test.ts is the end-to-end case that says so.
   *
   * The two stages here are the two that failed in production. The other five
   * — `glossary`, `ideas`, `quotes`, `sketch` and `assets` — took the identical
   * change; tests/pipeline-artifact-store.test.ts is what holds all of them to
   * the artefacts they declare.
   */
  it("tweets reads the article from the store, not from its empty directory", async () => {
    answers.push(JSON.stringify({ tweets: ["A post about the article.", "And a second one."] }));
    await expect(STEPS.tweets.run(coldContext(), store, nullCheckpointStore())).resolves.toMatchObject({
      detail: expect.stringContaining("posts"),
      parts: { tweets: expect.objectContaining({ tweets: expect.any(Array) }) },
    });
  });

  it("arc reads the article from the store, not from its empty directory", async () => {
    /* **One sentence per part, counted from the tree the store holds**, because
       `buildArc` refuses a length mismatch rather than zipping as far as it can
       — every sentence after a missing one would land against the wrong part
       and still read plausibly. Hard-coding a count here would make this test
       fail the day the fixture's tree changed, for a reason that has nothing to
       do with what it is about. */
    const tree = await store.read(SLUG, "hierarchy", "tree");
    if (!tree) throw new Error("the fixture has no tree");
    const sentences = partsOf(tree).map((_, i) => `Part ${i + 1} says something.`);
    answers.push(JSON.stringify({ arc: sentences }));
    await expect(STEPS.arc.run(coldContext(), store, nullCheckpointStore())).resolves.toMatchObject({
      parts: { arc: expect.objectContaining({ entries: expect.any(Array) }) },
    });
  });

  /**
   * **The negative control, and without it the two above prove much less.**
   *
   * Both of them pass whenever the stage can reach the article *somehow*. This
   * one asserts the other half: with the store empty as well, the stage fails —
   * so the two above are reading the store rather than finding the article by
   * some route this fixture did not intend. It also pins the failure to a
   * refusal with a sentence in it rather than the `ENOENT` that used to arrive
   * from three layers down.
   */
  it("and refuses in its own words when the store has no article either", async () => {
    const empty: ArtifactReads = memoryArtefacts();
    await expect(STEPS.arc.run(coldContext(), empty, nullCheckpointStore())).rejects.toThrow(/run the hierarchy step first/);
  });
});
