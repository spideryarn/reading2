/**
 * One step, run for real, all the way through the commit — the artefacts, the
 * step's completion and the job's advance asserted **together**, and the commit
 * itself pinned rather than inferred.
 *
 * ## Why this exists
 *
 * Since 2026-08-29 `runStep` does not call `write`, `assertProduced`,
 * `finishStep` and the job's own release itself; it hands the step's product and
 * the job transition to `session.commit`, which does all four
 * (docs/plans/delete-the-importer.md § D1a, src/store/session.ts). D1b turns
 * that one call into a transaction, so it is worth knowing how much of the suite
 * is watching it.
 *
 * The answer was: one assertion. Defeating the live session — passing it an
 * empty unconverted set, so that every real step's `{ detail }` product is
 * refused — turned exactly one test in `tests/jobs.test.ts` red. Everything else
 * either skips its step, fails it earlier, or never gets that far. GPT Sol then
 * found the sharper version of the same gap: the whole runner could revert to
 * its old direct path and every test would stay green, because no test looked at
 * what the commit *produced*.
 *
 * So this file does three things nothing else did:
 *
 * 1. runs a **real** stage — `blocks`, the one that costs nothing: no model
 *    call, no network. It reads the HTML an earlier step wrote, splits it into
 *    blocks, mints the ids and writes both artefacts. A stub proves the
 *    coordinator and nothing else (the review's finding 6);
 * 2. **pins the path**, by wrapping the session the runner actually builds. A
 *    runner that went round `commit` fails here rather than passing quietly;
 * 3. asserts the step's own `detail`, so a stage that went back to returning a
 *    bare string — which would arrive as `detail: undefined` — is caught.
 *
 * Its own file rather than a block in `tests/jobs.test.ts`, because the module
 * mock below is file-wide and that file is shared with several other people.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreSession } from "../src/store/session.js";

/**
 * What the runner did to its session, recorded from inside it.
 *
 * `vi.hoisted` because `vi.mock` is hoisted above the imports, so anything the
 * factory closes over has to exist before them.
 */
const seen = vi.hoisted(() => ({ commits: 0, step: "", detail: "", settles: 0 }));

/**
 * The real session, wrapped — not replaced.
 *
 * Every call still does exactly what it did; the wrapper only counts. A mock
 * that stood in for the session would test the mock, which is the failure this
 * whole file exists to close.
 */
vi.mock("../src/store/session.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/session.js")>();
  return {
    ...real,
    fsStoreSession: (...args: Parameters<typeof real.fsStoreSession>): StoreSession => {
      const session = real.fsStoreSession(...args);
      return {
        ...session,
        commit: async (ctx, step, attempt, product, transition) => {
          seen.commits += 1;
          seen.step = step.name;
          seen.detail = product.detail;
          return session.commit(ctx, step, attempt, product, transition);
        },
        settleJob: async (transition) => {
          seen.settles += 1;
          return session.settleJob(transition);
        },
      };
    },
  };
});

const { advanceJob, enqueue, getJob } = await import("../src/jobs.js");
const { contextPaths, STEPS, stepIsDone } = await import("../src/pipeline.js");
const { fsArtifacts } = await import("../src/store/artifacts-fs.js");
const { pauseForTests } = await import("../src/store/jobs-fs.js");
import type { StepContext } from "../src/pipeline.js";
import type { Job } from "../src/types.js";

const ROOT_DATA = path.resolve(import.meta.dirname, "..", "data");
const JOBS_DIR = path.join(ROOT_DATA, "_jobs");

/** Wait for the in-process pump to let the job go. */
async function settle(id: string): Promise<Job> {
  for (let i = 0; i < 60; i++) {
    const job = await getJob(id);
    if (job && job.status !== "queued" && job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job never finished");
}

describe("a step run for real, through the commit", () => {
  const SLUG = "test-commit-path-blocks";
  const at = contextPaths(SLUG);

  beforeEach(() => {
    seen.commits = 0;
    seen.settles = 0;
    seen.step = "";
    seen.detail = "";
  });

  afterAll(async () => {
    await rm(path.join(ROOT_DATA, SLUG), { recursive: true, force: true });
    await rm(at.htmlFile, { force: true });
    await rm(at.htmlFile.replace(/\.html$/, ".blocks.json"), { force: true });
    for (const file of await readdir(JOBS_DIR).catch(() => [])) {
      const full = path.join(JOBS_DIR, file);
      const record = JSON.parse(await readFile(full, "utf8")) as { slug?: string };
      if (record.slug === SLUG) await rm(full, { force: true });
    }
  });

  it("writes the artefacts, finishes the step and advances the job", async () => {
    /* Enqueued with no HTML to read, so stage 3 fails offline and the in-process
       queue lets the job go. Then the fixture arrives and `advanceJob` runs the
       step for real. */
    const queued = await enqueue({ slug: SLUG, steps: ["blocks"] });
    const settled = await settle(queued.id);
    expect(settled.status).toBe("error");

    await mkdir(path.dirname(at.htmlFile), { recursive: true });
    await writeFile(
      at.htmlFile,
      "<html><body><article>" +
        "<h1>A heading this article can be told apart by</h1>" +
        "<p>The first paragraph, which is real prose and long enough to count as one.</p>" +
        "<p>The second paragraph, also real prose, so there is more than one block.</p>" +
        "</article></body></html>",
      "utf8",
    );
    await pauseForTests(queued.id, 0);
    seen.commits = 0;

    const advanced = await advanceJob(queued.id);

    /* **The path, not the outcome.** A runner that wrote the artefacts and
       finished the step by its old direct route would satisfy every assertion
       below and fail here. */
    expect(seen.commits, "the step did not go through session.commit").toBe(1);
    expect(seen.step).toBe("blocks");

    // The job advanced, on this step.
    expect(advanced?.ran).toBe("blocks");
    expect(advanced?.done).toBe(true);

    // The step finished, and `finishStep` cleared the marker inside `commit`.
    expect(advanced?.job.steps[0]?.status).toBe("done");
    expect(await fsArtifacts.interrupted(SLUG, "blocks")).toBe(false);

    /* The stage's own line, carried through the product. A stage that went back
       to returning a bare string arrives here as `undefined` — which the
       coordinator would otherwise accept as an unconverted product with nothing
       in it. */
    expect(seen.detail).toMatch(/^\d+ blocks, \d+ new ids \(\d+ kept\)$/);
    expect(advanced?.job.steps[0]?.detail).toBe(seen.detail);

    /* And the artefacts are there. Every kind the step declares, read back
       through the store rather than stat'd, so a file that will not parse fails
       here rather than three stages later. */
    for (const kind of STEPS.blocks.produces) {
      expect(await fsArtifacts.read(SLUG, "blocks", kind), kind).not.toBeNull();
    }
    const written = await fsArtifacts.read(SLUG, "blocks", "blocks");
    expect(written?.blocks.length).toBeGreaterThan(1);
    const html = (await fsArtifacts.read(SLUG, "blocks", "stampedHtml")) ?? "";
    for (const block of written?.blocks ?? []) expect(html).toContain(`id="${block.id}"`);

    /* And the two halves agree. `stepIsDone` asks the marker, the artefacts and
       `htmlCarriesItsIds` — so a commit that wrote the blocks but not the HTML,
       or finished the step without either, is caught here as well as above. */
    const ctx: StepContext = {
      slug: SLUG,
      dir: at.dir,
      htmlFile: at.htmlFile,
      report: () => undefined,
      signal: new AbortController().signal,
      cacheArticle: false,
    };
    expect(await stepIsDone(STEPS.blocks, ctx, fsArtifacts)).toBe(true);
  });

  it("ends a claim where every step skipped, through the session and not around it", async () => {
    /* The path `commit` never reaches, and the third gap the review named: a job
       whose every step is already done never has a product to commit, so its
       ending has to go through the session's other door or it is the one job
       write that escapes the seam. */
    const queued = await enqueue({ slug: SLUG, steps: ["blocks"] });
    const settled = await settle(queued.id);
    // The in-process queue got there first and did the work; nothing is left.
    expect(settled.steps[0]?.status).toBe("skipped");
    await pauseForTests(queued.id, 0);
    seen.commits = 0;
    seen.settles = 0;

    const advanced = await advanceJob(queued.id);
    expect(advanced?.ran, "a step ran when every one should have skipped").toBeNull();
    expect(advanced?.done).toBe(true);
    expect(seen.commits, "an all-skipped claim has no product to commit").toBe(0);
    expect(seen.settles, "the ending went round the session").toBe(1);
  });
});
