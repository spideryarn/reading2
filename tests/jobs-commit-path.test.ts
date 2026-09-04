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
 * (docs/plans/260827aa-delete-the-importer.md § D1a, src/store/session.ts). D1b turns
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
 *
 * ## The store, since 2026-09-04
 *
 * Stage B of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 * It used to leave `SPIDERYARN_STORE` unset and wrap `fsStoreSession`, which
 * means the sentence at the top of this header — *"D1b turns that one call into
 * a transaction, so it is worth knowing how much of the suite is watching it"* —
 * was watching **the session that has no transaction in it**. `fsStoreSession`
 * says so about itself in as many words (src/store/session.ts): four writes in a
 * row, and a kill between any two of them leaves half of them done. So the file
 * whose entire subject is *the commit as one act* was pinned against the
 * implementation where it is not one. That is what the conversion bought, and it
 * is worth more here than in most of the twenty-six.
 *
 * The mock therefore moved with it: it now wraps **`openPgStoreSession`**
 * (src/store/pg-session.ts), which is the branch `claimSession` takes under
 * `postgres`, and it still wraps rather than replaces.
 *
 * ## What the fixture is now, and why both cases got simpler
 *
 * `scratchArticleInPg` seeds one throwaway article with a complete set of
 * artefacts, and the two cases fall straight out of it:
 *
 * - **the real stage** is a `blocks` job with `force: true`. `runStep` skips a
 *   step whose artefacts are current unless it is still forced
 *   (`stillForced`, src/jobs.ts), so forcing is what makes the stage actually
 *   run against an article that already has blocks — and it runs against the
 *   *draft*, reading `extracted_html` back out of it, which is the read half of
 *   the session on trial as well as the write half.
 * - **the all-skipped claim** is the same job unforced. That used to need an
 *   `enqueue`, a failed offline pump, a hand-written HTML file and a
 *   `pauseForTests`; it is now one row and one `advanceJob`.
 *
 * Rows go in through `pgJobStore.enqueueOrGet` rather than `enqueue`, so the
 * in-process pump is not a second driver racing the assertions —
 * `tests/jobs-walk.test.ts` § `queueJob` makes the same choice for the same
 * reason. That also removed `settle()` entirely.
 *
 * ## The byte assertions, one at a time
 *
 * Nothing was dropped silently, so here is each of them.
 *
 * - **`fsArtifacts.read(SLUG, "blocks", kind)` for every declared kind**, and
 *   the block/`stampedHtml` agreement under it. **Converted.** The Postgres
 *   equivalent is `readOnlyPgArtifacts` over the published revision:
 *   `blocks` is rows in `spideryarn.revision_blocks` and `stampedHtml` is
 *   `spideryarn.article_revisions.stamped_html`. The read is a store function
 *   (src/store/artifacts-pg.ts) rather than a `select`, which keeps the shared
 *   `SHAPE` check in the path.
 * - **`fsArtifacts.interrupted(SLUG, "blocks") === false`**. **Converted, and it
 *   is not vacuous** — `stepInterrupted` in Postgres asks whether
 *   `spideryarn.revision_step_runs.status` is still `'running'` for this
 *   revision and step, which is exactly what the marker file meant. It is
 *   `finishStep` inside `commit` that moves it off `running`.
 * - **`stepIsDone(STEPS.blocks, ctx, fsArtifacts)`**. **Converted**, to
 *   `readsPgArtifacts` over the same revision. Strictly stronger there than on
 *   the filesystem: `hasArtefacts` additionally requires a
 *   `revision_step_runs` row with `status = 'done'`, which a directory listing
 *   cannot ask.
 * - **the `data/_jobs/` sweep in `afterAll`**. **Converted** to a delete of
 *   `spideryarn.jobs` rows by slug.
 * - **`rm` of `data/<slug>/`, `output/<slug>.html` and
 *   `output/<slug>.blocks.json`**. **Incidental scaffolding, dropped.** They
 *   were the fixture's own rubble, and under Postgres nothing here writes a
 *   file at all. Nothing asserted on them.
 * - **the hand-written three-paragraph HTML fixture**. **Dropped**, and it is
 *   the one loss worth naming: the article under test is now the corpus's
 *   nineteen-block `writes` rather than three paragraphs written here, so the
 *   `detail` regexp is checked against a real article's block count instead of
 *   a `2`. That is a change of fixture, not of claim.
 *
 * Nothing moved to `tests/jobs-fs-adapter.test.ts`: none of the above is a claim
 * *about* the filesystem adapter, they are claims about the commit expressed in
 * the store the file happened to be running on.
 *
 * `contextPaths` stays, for `StepContext.dir` and `htmlFile`, which `stepIsDone`
 * takes and the Postgres reads ignore. That is the `step-context-paths`
 * mechanism the registry names, and it goes when those two fields do.
 *
 * ## The mutation, watched red on 2026-09-04 — and what it does *not* cover
 *
 * `publishRevisionIn` deleted from the `done` branch of `settleIn`
 * (src/store/pg-session.ts), replaced with `announce = {}`: an ending that
 * finishes the job row and neither publishes the draft nor clears the pointer
 * to it. That is **case 5** of the settlement state machine, it is the branch
 * the second test below drives, and the filesystem session could not have had
 * it — it opens no draft at all.
 *
 * ```
 * × ends a claim where every step skipped, through the session and not around it
 *   AssertionError: the all-skipped ending left its draft behind:
 *     expected 'db20832d-8f91-42a7-963f-d3a0d901b1fd' to be null
 * ```
 *
 * **The first test stayed green under it, and that is the finding.** Every
 * assertion in it — the artefacts read back, the block ids in the stamped HTML,
 * `stepIsDone` — is satisfied by the *carried* copy in the published revision,
 * which for this fixture is byte-for-byte what the stage would have written. So
 * a commit that published nothing looks exactly like one that did. That is the
 * trap `tests/pg-session-real-step.test.ts` plants a deliberately stale fixture
 * to escape; this file does not, and the draft pointer is what it has instead.
 * A reader adding a case here should not assume the read-backs are load-bearing.
 *
 * What one deleted call does **not** cover, and none of it is covered elsewhere
 * in this file:
 *
 * - **the other four settlement cases.** `keep` (between the steps of a walk),
 *   `release` (case 1), the cancel-during-a-step resolution (case 4) and the
 *   failure branch that marks an unfinished step `error` are each their own
 *   statement, and this file drives only cases 2 and 5.
 * - **the atomicity itself.** Both tests read the world *after* the transaction
 *   committed, so a `commit` whose four writes were four separate transactions
 *   would pass everything here. The one-act property is asserted by
 *   `tests/store-session-isolation.test.ts` and by the shape of the code, not
 *   by this.
 * - **`assertProduced`.** Deleting it from `commit` leaves this file green: no
 *   assertion here distinguishes a postcondition that ran from one that did not.
 * - **the fence.** `attempt_id` is never wrong in these two cases, because
 *   nothing else claims the job.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres` before **any** import.
 *
 * `src/store/live.ts` reads the environment once, the first time anything
 * imports it, and imports are hoisted above every statement in a module — so a
 * plain assignment here would leave `claimSession` handing back the filesystem
 * session, the mock below would never fire, and the file would report success
 * having tested the session that has no transaction in it.
 */
const HOISTED = vi.hoisted(() => {
  const previousStore = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return { previousStore };
});

/**
 * What the runner did to its session, recorded from inside it.
 *
 * `vi.hoisted` because `vi.mock` is hoisted above the imports, so anything the
 * factory closes over has to exist before them.
 *
 * `attempt` is new with the conversion: the reads at the end need a
 * `JobDraftRef`, and the attempt token is minted inside `advanceJob` where no
 * assertion can otherwise see it.
 */
const seen = vi.hoisted(() => ({ commits: 0, step: "", detail: "", settles: 0, attempt: "" }));

/**
 * The real session, wrapped — not replaced.
 *
 * Every call still does exactly what it did; the wrapper only counts. A mock
 * that stood in for the session would test the mock, which is the failure this
 * whole file exists to close.
 *
 * **`openPgStoreSession`, not `pgStoreSession`.** `claimSession` (src/jobs.ts)
 * imports the first of those by name, so that is the binding a mock has to
 * replace; wrapping the inner factory would leave `claimSession` calling the
 * real outer one and this counter on zero.
 */
vi.mock("../src/store/pg-session.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/pg-session.js")>();
  return {
    ...real,
    openPgStoreSession: async (opts: Parameters<typeof real.openPgStoreSession>[0]) => {
      const session = await real.openPgStoreSession(opts);
      seen.attempt = opts.job.attemptId;
      return {
        ...session,
        commit: async (
          ...args: Parameters<typeof session.commit>
        ): ReturnType<typeof session.commit> => {
          const [, step, , product] = args;
          seen.commits += 1;
          seen.step = step.name;
          seen.detail = product.detail;
          return await session.commit(...args);
        },
        settleJob: async (
          ...args: Parameters<typeof session.settleJob>
        ): ReturnType<typeof session.settleJob> => {
          seen.settles += 1;
          return await session.settleJob(...args);
        },
      };
    },
  };
});

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { advanceJob } from "../src/jobs.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { contextPaths, STEPS, stepIsDone, type StepContext } from "../src/pipeline.js";
import {
  readOnlyPgArtifacts,
  readsPgArtifacts,
  type JobDraftRef,
} from "../src/store/artifacts-pg.js";
import { STORE } from "../src/store/live.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { Job, JobStep, StepName } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

/* Put the flag back straight after the imports: vitest reuses a worker across
   files and does not reset `process.env` between them. */
if (HOISTED.previousStore === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = HOISTED.previousStore;

loadEnvLocal();

/** Its own slug, so nothing here collides with another suite's fixtures. */
const SLUG = "test-commit-path-blocks";

const { reachable } = await pgReady({
  suite: "tests/jobs-commit-path.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_blocks",
    "spideryarn.revision_step_runs",
  ],
});

const when = reachable ? describe : describe.skip;

describe("the store this commit is actually going through", () => {
  it("is the Postgres one", () => {
    /* Ungated on `reachable`, deliberately. A flag that failed to take would
       run every case below against `fsStoreSession` — a different session, with
       no transaction in it — and they would all pass, because the assertions
       are about what the commit produced rather than about how. A control that
       vanishes when the database is missing vanishes exactly when it matters. */
    expect(STORE).toBe("postgres");
  });
});

/** A `queued` row straight into the store — **not** `enqueue`, which pumps. */
async function queueJob(names: StepName[], force: boolean): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: DEV_OWNER_ID,
    slug: SLUG,
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
  const { job } = await pgJobStore.enqueueOrGet(wanted, {
    workKey: `commit-path-${wanted.id}`,
    reservesName: false,
  });
  return job;
}

/**
 * A store bound to whatever revision the article is published on **now**.
 *
 * The draft this job wrote into becomes the published revision when `commit`
 * publishes it, so reading the article's `current_revision_id` back afterwards
 * is how a caller outside the session reaches what the session wrote. `jobId`
 * and `attemptId` are along for the ride — no read fences on either — but they
 * are the job's real ones rather than invented, so that a future read which
 * does fence is not silently answered by a made-up token.
 */
async function refForPublishedRevision(jobId: string): Promise<JobDraftRef> {
  const [row] = await getDb()
    .select({ id: articles.id, revisionId: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row?.revisionId) throw new Error(`"${SLUG}" has no published revision to read back`);
  return {
    slug: SLUG,
    articleId: row.id,
    revisionId: row.revisionId,
    jobId,
    attemptId: seen.attempt,
  };
}

let article: ScratchArticle | undefined;

when("a step run for real, through the commit", () => {
  beforeAll(async () => {
    /* Owned by `DEV_OWNER_ID` explicitly, because that is who the advance runs
       as: the Postgres reader filters every article by owner, so a fixture
       seeded as somebody else is invisible and every claim would refuse. */
    article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  }, 120_000);

  afterEach(async () => {
    if (!reachable) return;
    seen.commits = 0;
    seen.settles = 0;
    seen.step = "";
    seen.detail = "";
    seen.attempt = "";
    /* Rows between cases, so the second case's job is not queued behind the
       first on `jobs_active_slug` — the per-article line is real here and was
       not on the filesystem. */
    await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
  });

  afterAll(async () => {
    if (!reachable) return;
    /* Jobs first: a job row's `draft_revision_id` is a foreign key into the
       revision the article delete would be trying to cascade away. */
    await getDb().delete(jobsTable).where(eq(jobsTable.slug, SLUG));
    await article?.remove();
    await closeDb();
  }, 60_000);

  it("writes the artefacts, finishes the step and advances the job", async () => {
    /* Forced, which is what makes a real stage run against an article that
       already has current blocks — `runStep` skips anything `stepIsDone`
       accepts unless `stillForced` says otherwise. */
    const queued = await queueJob(["blocks"], true);

    const advanced = await runAsOwner(DEV_OWNER_ID, () => advanceJob(queued.id));

    /* **The path, not the outcome.** A runner that wrote the artefacts and
       finished the step by its old direct route would satisfy every assertion
       below and fail here. */
    expect(seen.commits, "the step did not go through session.commit").toBe(1);
    expect(seen.step).toBe("blocks");

    // The job advanced, on this step.
    expect(advanced?.ran).toBe("blocks");
    expect(advanced?.done).toBe(true);
    expect(advanced?.job.steps[0]?.status).toBe("done");

    /* The stage's own line, carried through the product. A stage that went back
       to returning a bare string arrives here as `undefined` — which the
       coordinator would otherwise accept as an unconverted product with nothing
       in it. */
    expect(seen.detail).toMatch(/^\d+ blocks, \d+ new ids \(\d+ kept\)$/);
    expect(advanced?.job.steps[0]?.detail).toBe(seen.detail);

    const ref = await refForPublishedRevision(queued.id);
    const store = readOnlyPgArtifacts(ref, getDb());

    // The step finished, and `finishStep` cleared the run row's `running`
    // inside `commit` — `revision_step_runs.status`, which is what the
    // filesystem spent a marker file to say.
    expect(await store.interrupted(SLUG, "blocks")).toBe(false);

    /* And the artefacts are there. Every kind the step declares, read back
       through the store rather than selected out of a column, so a value the
       shared `SHAPE` check will not accept fails here rather than three stages
       later. */
    for (const kind of STEPS.blocks.produces) {
      expect(await store.read(SLUG, "blocks", kind), kind).not.toBeNull();
    }
    const written = await store.read(SLUG, "blocks", "blocks");
    expect(written?.blocks.length).toBeGreaterThan(1);
    const html = (await store.read(SLUG, "blocks", "stampedHtml")) ?? "";
    for (const block of written?.blocks ?? []) expect(html).toContain(`id="${block.id}"`);

    /* And the two halves agree. `stepIsDone` asks the run row, the artefacts and
       `blocksMatchTheirHtml` — so a commit that wrote the blocks but not the
       HTML, or finished the step without either, is caught here as well as
       above. */
    const ctx: StepContext = {
      ...contextPaths(SLUG),
      slug: SLUG,
      report: () => undefined,
      signal: new AbortController().signal,
      cacheArticle: false,
    };
    expect(await stepIsDone(STEPS.blocks, ctx, readsPgArtifacts(ref, getDb()))).toBe(true);
  }, 60_000);

  it("ends a claim where every step skipped, through the session and not around it", async () => {
    /* The path `commit` never reaches, and the third gap the review named: a job
       whose every step is already done never has a product to commit, so its
       ending has to go through the session's other door or it is the one job
       write that escapes the seam.

       Unforced, on an article whose blocks are already current — which is the
       whole of the setup now that there is a seeded article to be current
       about. */
    const queued = await queueJob(["blocks"], false);

    const advanced = await runAsOwner(DEV_OWNER_ID, () => advanceJob(queued.id));

    expect(advanced?.ran, "a step ran when every one should have skipped").toBeNull();
    expect(advanced?.done).toBe(true);
    expect(seen.commits, "an all-skipped claim has no product to commit").toBe(0);
    expect(seen.settles, "the ending went round the session").toBe(1);
    /* **And the draft was disposed of.** Under Postgres this claim opened a
       draft by carrying the published revision forward, so an ending that only
       touched the `jobs` row would leave that copy behind for the sweeper — the
       fifth settlement case in src/store/pg-session.ts, and one the filesystem
       session had no equivalent of. A cleared pointer is what says it was
       resolved rather than abandoned. */
    const [row] = await getDb()
      .select({ draft: jobsTable.draftRevisionId })
      .from(jobsTable)
      .where(eq(jobsTable.id, queued.id))
      .limit(1);
    expect(row?.draft, "the all-skipped ending left its draft behind").toBeNull();
  }, 60_000);
});
