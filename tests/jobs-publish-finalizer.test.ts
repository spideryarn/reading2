/**
 * A job that finishes puts an article on the reader's shelf.
 *
 * That sentence was false until 2026-08-30. `grep -c publishRevision src/jobs.ts`
 * answered **0**: the stages ran, wrote their files, the job went `done`, and
 * `articles.current_revision_id` never moved. Publication was a human running
 * `npm run db:import` (docs/plans/v1-imports-on-vercel.md § What is broken,
 * measured). `src/store/publish-session.ts` is the finalizer that closes it, and
 * this file is the acceptance test for it.
 *
 * ## What is real here and what is not
 *
 * **Real:** the Postgres job store with its claim, its fence and its single
 * running slot; the coordinator's whole walk; the filesystem artefact store, on
 * a scratch root; `claimSession` — production's own session factory, gate
 * included; `copyArtefacts`; `openOrBeginJobDraft`; `publishRevisionIn`;
 * `finishIn`; and the Postgres article reader at the far end.
 *
 * **Fake:** the bodies of the pipeline steps, and only those. The ten real ones
 * fetch web pages and call models. What the fakes do is what the real
 * unconverted stages do — write their own artefacts inside `run()` and return a
 * bare detail — so the session accepts them by exactly the same rule
 * (`LEGACY_UNCONVERTED_STEPS`, src/pipeline.ts).
 *
 * ## The mutation that reddened each, watched on 2026-08-30
 *
 * A check nobody has seen fail is not evidence (docs/reusable/silent-success.md).
 * Each of these was applied to `src/store/publish-session.ts`, run, and taken
 * out again; the readings are in the report.
 *
 * - **`publishes()` returns `false`** — the session becomes a pass-through and
 *   the job ends exactly as it did before this landing. Every case fails.
 * - **the `copied.length === 0` branch deleted** — *refuses a copy that moved
 *   nothing* fails with `promise resolved instead of rejecting`: the publication
 *   goes through on a draft carried forward from the published revision and
 *   republishes the old article, reporting success.
 * - **`finishIn` moved out of the publication's transaction** — *keeps
 *   publication and the job's finish in one transaction* fails on
 *   `currentRevisionOf`, which is now the new revision while the job is still
 *   `running`. Sol's critical 2, exactly.
 * - **`publishes()` drops its `status === "done"` clause** — *publishes nothing
 *   when the job fails* fails on `currentRevisionOf`: the failed job published.
 * - **the recovery settlement in `settleJob` deleted** — the three cases that
 *   reach a failing publication fail on `status`: the job is left `running`,
 *   holding its attempt and the single global running slot.
 * - **`err.message` put back on the job card** — *keeps publication and the
 *   job's finish in one transaction* fails on `status`, and the reason is worth
 *   knowing: a driver message carries the failed statement's bound parameters,
 *   NUL byte included, so writing it back poisons the recovery settlement too
 *   and the job is left `running`. The `SENTINEL` assertions below are the
 *   direct check on the same rule and would catch a leak that is not itself
 *   unwritable.
 *
 * - **the budget branch of `transitionAfter` finishes the job instead of handing
 *   the claim back** — *publishes nothing when the claim is handed back mid-job*
 *   fails on `done`, and an article that has run one of three steps is published.
 *
 * ## One clause no fixture can redden, and it is named rather than left looking guarded
 *
 * `publishes()` reads `transition.kind === "end" && transition.ending.status ===
 * "done"`. The second clause is isolated by the failed-job case. **The first
 * cannot be isolated at all**, and it was checked twice rather than assumed:
 * weakening it to `!== "keep"` leaves all cases green, and deleting it outright
 * leaves all cases green. The reason is that no other `JobTransition` kind
 * carries an `ending` at all, so `ending?.status === "done"` already excludes a
 * `keep` and a `release` on its own.
 *
 * It is not decoration: deleting it is a **compile** error
 * (`Property 'ending' does not exist on type 'JobTransition'`), because it is
 * what narrows the union so `transition.ending` can be read. So it is a type
 * guard doing a type guard's job, and this comment exists so that nobody later
 * writes a fixture for it, fails to make it fail, and concludes the test is
 * broken. GPT Sol's shape, and the team lead's warning about a four-clause guard
 * whose third clause nothing could redden.
 *
 * Four other conditions in src/store/publish-session.ts are **unprobed**, and the
 * report says so rather than counting them as covered: the draft-identity check
 * (`article.id !== ref.articleId`) needs an article deleted and re-created
 * between two transactions; `kept.kind !== "kept"` cannot happen while
 * `fsStoreSession` returns `kept` unconditionally for a `keep`; the two
 * `instanceof` disjuncts that skip cleanup after a lost claim are reachable in
 * principle but have no fixture here; and `if (published)` guards a type, not a
 * state.
 *
 * The filesystem half of the claim — that none of this runs with the default
 * store — is `tests/jobs-publish-finalizer-files.test.ts`, which cannot live in
 * this file because the store flag is read once, at module load.
 *
 * Skips loudly when there is no database; see tests/helpers/pg-ready.ts.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres` and a scratch `data/` root, before **any** import.
 *
 * `vi.hoisted` and not plain statements. `src/store/live.ts` reads the flag once,
 * the first time anything imports it, and imports are hoisted above every
 * statement in a module — so an ordinary assignment would run after the imports
 * below had already settled the answer to `files`, and this whole file would
 * quietly exercise the unwrapped filesystem session and pass for the wrong
 * reason. That has happened here before (tests/db-error-scrub.test.ts).
 *
 * The data root is hoisted for a weaker reason — `dataRoot()` is called at the
 * moment a path is needed, so a `beforeAll` would do — but keeping the two
 * together means there is one place that says what environment this file runs
 * in.
 */
const HOISTED = vi.hoisted(() => {
  const previousStore = process.env.SPIDERYARN_STORE;
  const previousRoot = process.env.SPIDERYARN_DATA_ROOT;
  process.env.SPIDERYARN_STORE = "postgres";
  /* A path string and nothing more: `vi.hoisted` runs before every import, so
     `node:fs` is not available in here. Nothing needs to exist yet — `dataRoot()`
     is read at the moment a path is wanted, and the filesystem store makes its
     directories on the way past. */
  const tmp = (process.env.TMPDIR ?? "/tmp").replace(/\/$/, "");
  const root = `${tmp}/spya-finalizer-${process.pid}-${Date.now()}`;
  process.env.SPIDERYARN_DATA_ROOT = root;
  return { previousStore, previousRoot, root };
});

import { getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { DEADLINE_MARGIN_MS, advanceJobWith, claimSession, type AdvanceParts } from "../src/jobs.js";
import type { LabelsFile } from "../src/labels.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep, type StepProduct } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { fsArtifacts } from "../src/store/artifacts-fs.js";
import { STORE } from "../src/store/live.js";
import { pgArticleReader } from "../src/store/pg.js";
import { mintAttempt } from "../src/store/jobs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { publishingSession } from "../src/store/publish-session.js";
import { fsStoreSession } from "../src/store/session.js";
import type { StoreSession } from "../src/store/session.js";
import type { JobEnding } from "../src/store/jobs.js";
import type { ArtifactKind, ArtifactStore } from "../src/store/artifacts.js";
import type { Block, Job, JobStep, StepName, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

/* Put the store flag back straight after the imports: vitest reuses a worker
   across files and does not reset `process.env` between them, so leaving it set
   hands the next file a store it did not ask for. Everything above has already
   captured it. The data root stays until `afterAll`, because it is read on every
   artefact call rather than once. */
if (HOISTED.previousStore === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = HOISTED.previousStore;

loadEnvLocal();

const { reachable } = await pgReady({
  suite: "tests/jobs-publish-finalizer.test.ts",
  tables: ["spideryarn.jobs", "spideryarn.article_revisions"],
});

const when = reachable ? describe : describe.skip;

/* ------------------------------------------------------------- the article -- */

/**
 * A slug per case. They are deleted in `afterAll`, and they are distinct so that
 * `jobs_active_slug` — one in-flight job per article — cannot make one case wait
 * on another's teardown.
 */
const SLUGS = {
  published: "finalizer-publishes",
  empty: "finalizer-empty-copy",
  atomic: "finalizer-atomic",
  failed: "finalizer-failed-job",
  skipped: "finalizer-all-skipped",
  handback: "finalizer-hands-back",
} as const;

/**
 * Two strings that must never appear in anything a person reads.
 *
 * They stand in for the two things a failed `finishIn` binds as parameters: a
 * step's `detail`, which may be article prose, and the job's title, which *is*
 * the article's.
 */
const SENTINEL = "PROSE-THAT-MUST-NOT-BE-LOGGED";
const SENTINEL_TITLE = "TITLE-THAT-MUST-NOT-BE-LOGGED";

function block(id: string, text: string): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    html: `<p id="${id}">${text}</p>`,
    gistable: true,
  };
}

/**
 * Two blocks is the smallest article a tree can be checked against.
 *
 * **The ids have to be real ones**, and `block_identities_id_format` is what
 * says so: six characters of `src/ids.ts`'s alphabet after `spya-`, the first a
 * letter, and neither `i`, `l`, `o` nor `1` is in it. A three-letter seed plus
 * `aa` plus a digit is six. Getting this wrong fails at the very last statement
 * of the copy, which is a long way from the fixture that caused it.
 */
function blocksFor(seed: string): Block[] {
  return [
    block(`spya-${seed}aa2`, "The opening paragraph of an article that exists only for this test."),
    block(`spya-${seed}aa3`, "The closing paragraph, which says nothing either."),
  ];
}

/** One root over one leaf per block — the smallest shape `checkTree` accepts. */
function treeFor(slug: string, blocks: Block[]): Tree {
  return {
    version: "toc/1",
    generator: "fixture",
    slug,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: blocks.map((_, i) => `n${i + 1}`),
        range: [blocks[0]!.id, blocks[blocks.length - 1]!.id],
        title: "A fixture article",
        gist: "A fixture built by tests/jobs-publish-finalizer.test.ts and nothing else.",
      },
      ...Object.fromEntries(
        blocks.map((b, i) => [
          `n${i + 1}`,
          {
            id: `n${i + 1}`,
            depth: 1,
            parent: "n0",
            children: [],
            range: [b.id, b.id],
            title: "A paragraph",
            navLabel: "One paragraph of a fixture article that exists only for this test",
          },
        ]),
      ),
    },
  } as Tree;
}

/**
 * `labels.json`, and its `sourceHash` is the load-bearing field.
 *
 * `STAMP_SOURCE` maps the `toc` step's stamp to the `labels` artefact, and
 * `reasonsNotToPublish` refuses a revision whose `toc` run row was stamped
 * against different blocks. So the hash here is what carries "this tree was
 * built from these blocks" all the way from a file on disk to the publication
 * gate — which is precisely the seam this test is about.
 */
function labelsFor(slug: string, blocks: Block[]): LabelsFile {
  return {
    version: "labels/1",
    generator: "fixture",
    slug,
    sourceHash: hashBlocks(blocks),
    structureHash: "fixture-structure",
    structureVersion: "toc/1",
    labels: Object.fromEntries(blocks.map((b) => [b.id, "A paragraph"])),
    batches: null,
  };
}

/* --------------------------------------------------------------- the steps -- */

/**
 * A step that writes its own artefacts inside `run` and returns a bare detail —
 * which is what all ten real steps still do, so the filesystem session accepts
 * it by the same rule it accepts them.
 *
 * It writes through `fsArtifacts`, the module singleton `claimSession` hands the
 * finalizer as `from`. Writing anywhere else would make the copy read a
 * different disk from the one the run phase wrote to, which is the whole thing
 * this test is checking cannot happen.
 */
function writingStep(
  name: StepName,
  parts: Partial<Record<ArtifactKind, unknown>>,
  slug: string,
  body: () => Promise<void> | void = () => {},
): PipelineStep {
  return {
    name,
    label: STEPS[name].label,
    outputs: () => [],
    produces: STEPS[name].produces,
    async run(): Promise<StepProduct> {
      await body();
      await fsArtifacts.write(slug, name, parts as never, {});
      return { detail: `${name} ran` };
    },
  } as PipelineStep;
}

/**
 * The three steps that make a publishable article, over one set of blocks.
 *
 * **`extract` is in here for a reason that cost an hour, and it is a fact about
 * the store rather than about the fixture.** On the filesystem `extractedHtml`
 * and `stampedHtml` are the *same file*, `output/<slug>.html`, because stage 3
 * overwrites stage 2's in place (src/store/artifacts-fs.ts). So a `blocks` step
 * writing its HTML makes `extract` look half-finished — one of its two products
 * present — and `copyArtefacts` refuses a step it can only move half of, loudly
 * and correctly. A job that runs `blocks` therefore has to have run `extract`,
 * which every real ingest does (`DEFAULT_INGEST_STEPS`).
 *
 * `fetch` is deliberately *not* here: nothing writes `raw.json`, so `readParts`
 * comes back empty and the step is skipped rather than half-copied. That is the
 * other half of the same rule, and it is why the omission is safe.
 */
function articleSteps(
  slug: string,
  seed: string,
  bodies: Partial<Record<StepName, () => Promise<void> | void>> = {},
): { steps: Partial<Record<StepName, PipelineStep>>; blocks: Block[]; tree: Tree } {
  const blocks = blocksFor(seed);
  const tree = treeFor(slug, blocks);
  const html = `<html><body>${blocks.map((b) => b.html).join("")}</body></html>`;
  return {
    blocks,
    tree,
    steps: {
      extract: writingStep(
        "extract",
        { extractedHtml: html, meta: { slug, title: "A fixture article" } },
        slug,
        bodies.extract,
      ),
      blocks: writingStep("blocks", { blocks: { blocks }, stampedHtml: html }, slug, bodies.blocks),
      toc: writingStep(
        "toc",
        { tree, labels: labelsFor(slug, blocks), blocks: { blocks } },
        slug,
        bodies.toc,
      ),
    },
  };
}

/** The steps a fixture job runs, in pipeline order. */
const INGEST: StepName[] = ["extract", "blocks", "toc"];

/* ----------------------------------------------------------------- the job -- */

const MADE: string[] = [];

/**
 * A `queued` job straight into the Postgres store — **not** `enqueue`, which
 * starts the local pump and would be a second driver racing the one thing under
 * test.
 */
async function queueJob(slug: string, names: StepName[], force = false): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: DEV_OWNER_ID,
    slug,
    steps: names.map(
      (name): JobStep => ({ name, label: STEPS[name].label, status: "pending", ...(force && { force: true }) }),
    ),
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await pgJobStore.enqueueOrGet(wanted, `finalizer-${wanted.id}`);
  MADE.push(job.id);
  return job;
}

/**
 * Advance until this job actually gets the single running slot.
 *
 * `jobs_only_one_running` is global — another suite, a second `npm test`, or a
 * dev server mid-ingest is another claimant — and `claim` reports that as
 * `busy` rather than throwing, so an unguarded call would assert against a job
 * that never ran. Same reasoning as tests/helpers/running-slot.ts, one layer up.
 */
async function advanceUntilNotBusy(id: string, parts: AdvanceParts) {
  for (let attempt = 1; attempt <= 40; attempt++) {
    const advanced = await advanceJobWith(id, parts);
    if (!advanced?.busy) return advanced;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `job ${id} never got the single running slot in 20s: either another job holds it, or a ` +
      "row is wedged `running` and waiting will not clear it.",
  );
}

/** What Postgres says the reader would be shown right now. */
async function currentRevisionOf(slug: string): Promise<string | null> {
  const rows = await getDb()
    .select({ current: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, slug));
  return rows[0]?.current ?? null;
}

async function jobRow(id: string) {
  const rows = await getDb().select().from(jobsTable).where(eq(jobsTable.id, id));
  return rows[0];
}

/* ---------------------------------------------------------------- the cases -- */

describe("the store this file is talking to", () => {
  it("is the Postgres one", () => {
    /* Without this a flag that failed to take looks exactly like the finalizer
       working: the filesystem session answers every call happily and the job
       ends `done`, which is what three of the four cases below assert. */
    expect(STORE).toBe("postgres");
  });
});

when("a job that finishes", () => {
  afterAll(async () => {
    const db = getDb();
    for (const slug of Object.values(SLUGS)) {
      const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, slug));
      const id = rows[0]?.id;
      if (!id) continue;
      // The pointer lets go first, or the revisions cannot cascade away.
      await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
      await db.delete(articles).where(eq(articles.id, id));
    }
    for (const id of MADE) await db.delete(jobsTable).where(eq(jobsTable.id, id));
    await rm(HOISTED.root, { recursive: true, force: true });
    if (HOISTED.previousRoot === undefined) delete process.env.SPIDERYARN_DATA_ROOT;
    else process.env.SPIDERYARN_DATA_ROOT = HOISTED.previousRoot;
  }, 60_000);

  it("publishes the article a reader can open, and ends done", async () => {
    const slug = SLUGS.published;
    const { steps, blocks } = articleSteps(slug, "pub");
    const job = await queueJob(slug, INGEST);

    const advanced = await runAsOwner(DEV_OWNER_ID, () =>
      advanceUntilNotBusy(job.id, { session: claimSession, steps: { ...STEPS, ...steps } as never }),
    );

    /* The message first, so a failure here reads as the reason rather than as
       "expected error to be done". */
    expect(advanced?.job.error).toBeUndefined();
    expect(advanced?.done).toBe(true);
    expect(advanced?.job.status).toBe("done");

    /* **The pointer moved**, which is the whole claim. Before this landing it
       stayed null for ever and the reader's shelf was empty after a job that
       reported every step green. */
    const current = await currentRevisionOf(slug);
    expect(current).not.toBeNull();

    /* And it is a revision that was **published**, not a draft the pointer was
       aimed at. Two different facts, and only one of them is the pointer. */
    const [revision] = await getDb()
      .select({ status: articleRevisions.status })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, current!));
    expect(revision?.status).toBe("published");

    /* Read it back the way a reader does — through the Postgres reader, not by
       re-querying the columns the write just set. `loadArticle` refuses a
       revision with no tree or no blocks, so this is also the publication gate
       asked from the other side. */
    const article = await runAsOwner(DEV_OWNER_ID, () => pgArticleReader.loadArticle(slug));
    expect(article.blocks.map((b) => b.id)).toEqual(blocks.map((b) => b.id));
    expect(article.tree.rootId).toBe("n0");

    /* **And it is on the shelf**, which is the sentence the whole stage is for.
       `loadArticle` above proves the revision is readable; this proves the
       library query finds it — a different set of conditions (`hasTree`, the
       owner scope, the shelf predicate), and the one a reader actually meets
       first. An article that publishes but never appears on the homepage would
       satisfy every other assertion in this file. */
    const shelf = await runAsOwner(DEV_OWNER_ID, () => pgArticleReader.listArticles());
    expect(shelf.map((entry) => entry.slug)).toContain(slug);

    /* The job row itself, not the object the coordinator returned: the finish is
       inside the publication's transaction, so a `done` in memory and a `done`
       in the database are separate claims. */
    expect((await jobRow(job.id))?.status).toBe("done");
    /* Nothing is left pointing at a draft for `sweepAbandonedDrafts` to spare
       for ever — `publishRevisionIn` clears it on its own fence as it goes. */
    expect((await jobRow(job.id))?.draftRevisionId).toBeNull();
  }, 60_000);

  it("refuses a copy that moved nothing rather than republishing the old article", async () => {
    const slug = SLUGS.empty;

    /* First, a real article, so there is something to republish. Without this
       the guard cannot be tested at all: on an article Postgres has never seen,
       an empty draft is refused by `publishRevisionIn` for having no blocks, and
       a test would pass with the guard deleted. Carry-forward is what makes the
       empty copy dangerous — the draft already holds the published revision's
       blocks, tree and step runs. */
    const { steps } = articleSteps(slug, "emp");
    const first = await queueJob(slug, INGEST);
    await runAsOwner(DEV_OWNER_ID, () =>
      advanceUntilNotBusy(first.id, {
        session: claimSession,
        steps: { ...STEPS, ...steps } as never,
      }),
    );
    const published = await currentRevisionOf(slug);
    expect(published).not.toBeNull();

    /* Now the state the guard is for: a claim whose source store has nothing for
       this slug. That is the all-skipped door — the walk never calls `commit` —
       and on a serverless host it is what a scratch directory on the wrong
       instance looks like. The session is the real one, over an empty source. */
    const second = await queueJob(slug, ["toc"]);
    const attempt = await claimOrWait(second.id);
    const inner = recordingInner();
    const session = publishingSession(inner.session, {
      job: { id: second.id, attemptId: attempt },
      slug,
      from: emptyStore(),
    });

    await expect(
      session.settleJob({
        kind: "end",
        jobId: second.id,
        attempt,
        ending: { status: "done", steps: [] },
      }),
    ).rejects.toThrow(/the copy moved nothing/);

    /* **The reader did not move**, which is the half a thrown error does not
       prove on its own: with the guard deleted the publication succeeds, the
       pointer swings to the empty draft, and the article a reader opens is the
       old one republished under a new revision id. */
    expect(await currentRevisionOf(slug)).toBe(published);

    /* And the job was ended rather than left holding the global running slot —
       with the refusal's own words on it, which are ours and name no prose. */
    expect(inner.settled.map((e) => e.status)).toEqual(["error"]);
    expect(inner.settled[0]?.error).toMatch(/the copy moved nothing/);
    expect((await jobRow(second.id))?.status).toBe("error");
  }, 120_000);

  it("keeps publication and the job's finish in one transaction", async () => {
    const slug = SLUGS.atomic;

    const { steps } = articleSteps(slug, "atm");
    const first = await queueJob(slug, INGEST);
    await runAsOwner(DEV_OWNER_ID, () =>
      advanceUntilNotBusy(first.id, {
        session: claimSession,
        steps: { ...STEPS, ...steps } as never,
      }),
    );
    const before = await currentRevisionOf(slug);
    expect(before).not.toBeNull();

    /**
     * **A failure after the publication and inside its transaction**, which is
     * the only position that proves anything: a throw before the publish would
     * roll back a transaction that had done nothing yet.
     *
     * The injection is a **NUL byte inside the ending's `steps`**. `finishIn`
     * writes that array to a `jsonb` column, and Postgres refuses `\u0000` in a
     * JSON string outright (22P05) — so the *last* statement of
     * `publishAndFinish` fails, for a real database reason, with
     * `publishRevisionIn` already done in the same transaction. That is a kill
     * between publication and settlement, made to happen on demand rather than
     * argued about: Sol's critical 2.
     *
     * **The ending's status stays `done`, and the first version of this got
     * that wrong.** It injected by giving the ending a status the `jobs_status`
     * check rejects — which made `publishes()` answer false, sent the whole call
     * to the inner session, and passed on the throw from *there*. The test was
     * green against a publication that had never been attempted. The `expect`
     * below therefore cannot be `rejects.toThrow()` alone; what makes this case
     * real is the two assertions after it.
     *
     * Deliberately *not* a wrapper round `db.transaction` that throws after the
     * body. That fires on every transaction, so under the mutation this case
     * exists to catch — publishing in a transaction of its own, as
     * `importArticle` did — it would roll that one back too and the test would
     * stay green against the bug.
     */
    const second = await queueJob(slug, ["toc"], true);
    const attempt = await claimOrWait(second.id);
    const inner = recordingInner();
    const session = publishingSession(inner.session, {
      job: { id: second.id, attemptId: attempt },
      slug,
      from: fsArtifacts,
    });

    await expect(
      session.settleJob({
        kind: "end",
        jobId: second.id,
        attempt,
        ending: {
          status: "done",
          steps: [{ name: "toc", label: "Building the table of contents", status: "done" }],
          /**
           * **The injection lives in `error`, and the position is deliberate.**
           *
           * A NUL byte survives `JSON.stringify`, reaches the server, and
           * Postgres refuses it (22P05) — so `finishIn`'s `UPDATE`, the last
           * statement of the publication's transaction, fails.
           *
           * It is in `error` rather than in `steps` because the recovery
           * settlement carries the *same* `steps` forward — as it should, they
           * are the progress the reader sees — and would then fail for the same
           * reason, leaving the job `running` and the test asserting the bug it
           * was written to catch. `error` is the one field the recovery
           * replaces, with a fixed sentence.
           *
           * It also carries a **sentinel**, and so does the title, because
           * `finishIn` binds both as parameters: a driver error's message is
           * `Failed query: update … params: <them>`. A step's `detail` and the
           * job's title can both be article-derived, which is why interpolating
           * that message anywhere a person reads was GPT Sol's critical 1.
           */
          error: `${SENTINEL}\u0000`,
          title: SENTINEL_TITLE,
        },
      }),
    ).rejects.toThrow();

    /* **Neither half happened**, and the pointer is the assertion. With
       `finishIn` outside the publication's transaction the pointer would be on
       the new revision here — an article published by a job that then failed,
       and Retry blocked by a guard that now sees an article. */
    expect(await currentRevisionOf(slug)).toBe(before);
    /* Ended rather than left `running`, and with the safe sentence rather than
       the driver's message — which for `finishIn` carries the bound parameters,
       and those are the job's steps and title. */
    expect(inner.settled.map((e) => e.status)).toEqual(["error"]);
    expect((await jobRow(second.id))?.status).toBe("error");

    /**
     * **And the card carries none of the failed statement.**
     *
     * Asserted as three absences rather than against the constant the code
     * uses, which would agree with any value of it. The driver's message for a
     * failed `finishIn` is `Failed query: update … params: <the whole steps
     * array and the title>` — so if any of that is being interpolated, the
     * sentinels are in `jobs.error`, on the reader's card, and in the line
     * `logDraftFailure` writes.
     *
     * **The log half of this is not covered by a test and that is stated rather
     * than implied.** `pino.destination({ sync: true })` writes to the file
     * descriptor, not through `process.stdout.write`, and the root logger is
     * `silent` under vitest — so a capture here would be a check that cannot
     * fire, which is worse than none. The rule is the same one line in both
     * places ("never `err.message`"), and this half of it does fire.
     */
    const card = (await jobRow(second.id))?.error ?? "";
    expect(card).not.toContain(SENTINEL);
    expect(card).not.toContain(SENTINEL_TITLE);
    expect(card).not.toMatch(/Failed query|params:/);
    expect(card.length).toBeGreaterThan(0);
    /* And the draft the rolled-back transaction was going to publish is failed
       and unpointed, rather than left immortal because a job still names it and
       `sweepAbandonedDrafts` spares anything a job points at. */
    expect((await jobRow(second.id))?.draftRevisionId).toBeNull();
  }, 120_000);

  it("publishes nothing when the claim is handed back mid-job", async () => {
    const slug = SLUGS.handback;

    /**
     * **The `kind === "end"` half of the publication gate, on its own.**
     *
     * The other half — `ending.status === "done"` — is isolated by the failed-job
     * case below. This one needs a transition that is *not* an ending at all,
     * and the only one the walk produces is a `release`: the claimant is close
     * enough to its own deadline that starting the next step would mean being
     * killed inside it, so it puts the job down and the next request picks it up
     * (`transitionAfter` in src/jobs.ts).
     *
     * `leaseMs` is what makes that branch reachable in a test rather than in
     * twelve minutes. 22s leaves a 2s deadline after `DEADLINE_MARGIN_MS`, and
     * `blocks` needs 5s of budget — so `extract` runs, the walk hands back, and
     * the self-abort timer never gets near firing.
     *
     * The claim it proves is the plan's own: **publish once everything has run**,
     * never a half-ingested article. Without the `kind` clause a release
     * publishes after one step.
     */
    const { steps } = articleSteps(slug, "hbk");
    const job = await queueJob(slug, ["extract", "blocks", "toc"]);

    const advanced = await runAsOwner(DEV_OWNER_ID, () =>
      advanceUntilNotBusy(job.id, {
        session: claimSession,
        steps: { ...STEPS, ...steps } as never,
        leaseMs: DEADLINE_MARGIN_MS + 2_000,
      }),
    );

    /* It handed the claim back rather than finishing: `queued`, no attempt, and
       the client is told the job is not done. */
    expect(advanced?.done).toBe(false);
    expect(advanced?.ran).toBe("extract");
    const row = await jobRow(job.id);
    expect(row?.status).toBe("queued");
    expect(row?.attemptId).toBeNull();

    /* **And nothing at all reached Postgres.** Not merely "the pointer did not
       move" — the draft is opened lazily, at the moment of publication, so a
       release must leave no article row and no revision either. Under the
       mutation this case exists for, a draft is minted, the publication gate
       refuses it for having no tree, and the job ends `error` instead of staying
       resumable. */
    const articleRows = await getDb()
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.slug, slug));
    expect(articleRows).toEqual([]);
  }, 120_000);

  it("ends the job rather than leaving it running when the all-skipped door cannot publish", async () => {
    const slug = SLUGS.skipped;

    /* A published article and, more importantly, a scratch directory with every
       step's artefacts in it. */
    const { steps } = articleSteps(slug, "skp");
    const first = await queueJob(slug, INGEST);
    await runAsOwner(DEV_OWNER_ID, () =>
      advanceUntilNotBusy(first.id, {
        session: claimSession,
        steps: { ...STEPS, ...steps } as never,
      }),
    );
    const before = await currentRevisionOf(slug);
    expect(before).not.toBeNull();

    /**
     * **The all-skipped door, driven through the coordinator**, which is the
     * only way to prove what a reader's job card ends up saying. GPT Sol asked
     * for exactly this case: the two above call `settleJob` directly, so they
     * establish refusal and rollback but not the coordinator's behaviour around
     * them (docs/plans/v1-publish-finalizer-review-sol.md, the High finding).
     *
     * Two things make it happen. The job asks only for `toc`, which is already
     * current on disk, so every step skips and the walk never calls `commit` —
     * `settleJob` is the only door the `done` ending comes through. And
     * `meta.json` is deleted first, which leaves `extract` with one of its two
     * products present, so `copyArtefacts` refuses to move half a step. Nothing
     * re-runs `extract`, because it is not in this job's step list.
     */
    await rm(path.join(HOISTED.root, "data", slug, "meta.json"));

    const second = await queueJob(slug, ["toc"]);
    const advanced = await runAsOwner(DEV_OWNER_ID, () =>
      advanceUntilNotBusy(second.id, { session: claimSession, steps: STEPS }),
    ).catch((err: unknown) => err);

    /* The failure reaches the caller — the request 500s, as any unexpected store
       failure does — and that is not the point. The point is the row. */
    expect(advanced).toBeInstanceOf(Error);

    const row = await jobRow(second.id);
    /* **Terminal, immediately.** Without the recovery settlement this row is
       still `running`, still holding its attempt and the single global running
       slot, and every Retry is told `busy` until the 760-second lease lapses —
       after which `failExpired` records a generic interruption rather than what
       actually happened. */
    expect(row?.status).toBe("error");
    expect(row?.attemptId).toBeNull();
    expect(row?.error ?? "").not.toMatch(/Failed query|params:/);
    /* Retry is offered, because re-running the whole job is genuinely the fix
       for a scratch directory that was not all there. */
    expect(row?.failureKind).toBe("retry");
    /* And the reader is where they were. */
    expect(await currentRevisionOf(slug)).toBe(before);
  }, 120_000);

  it("publishes nothing when the job fails, and leaves the reader where they were", async () => {
    const slug = SLUGS.failed;

    const { steps } = articleSteps(slug, "fad");
    const first = await queueJob(slug, INGEST);
    await runAsOwner(DEV_OWNER_ID, () =>
      advanceUntilNotBusy(first.id, {
        session: claimSession,
        steps: { ...STEPS, ...steps } as never,
      }),
    );
    const before = await currentRevisionOf(slug);
    expect(before).not.toBeNull();

    /* A second job over the same article whose `toc` throws — **forced**, or it
       would skip. The first job left valid artefacts under this slug in the
       scratch root, so `stepIsDone` answers yes to all three and the walk ends
       `done` having run nothing, which is a different case with a different
       test. `force` is what a reader pressing "rebuild the contents" sends.

       Those same files are why this is not "a job that did nothing": there is a
       complete, publishable article on disk that a finalizer without the
       `status === "done"` clause would happily publish under a failed job. */
    const failing = articleSteps(slug, "fad", {
      toc: () => {
        throw new Error("the fixture toc step refuses to run");
      },
    });
    const second = await queueJob(slug, ["toc"], true);
    const advanced = await runAsOwner(DEV_OWNER_ID, () =>
      advanceUntilNotBusy(second.id, {
        session: claimSession,
        steps: { ...STEPS, ...failing.steps } as never,
      }),
    );

    expect(advanced?.job.status).toBe("error");
    expect((await jobRow(second.id))?.status).toBe("error");
    /* The reader is on the revision they already had. Nothing was published and
       — because the draft is opened lazily, at the moment of publication — there
       was never a draft for this job to leave behind. */
    expect(await currentRevisionOf(slug)).toBe(before);
    expect((await jobRow(second.id))?.draftRevisionId).toBeNull();
  }, 120_000);
});

/* -------------------------------------------------------------- small parts -- */


/**
 * Take the single running slot for `id`, waiting for it the way
 * `advanceUntilNotBusy` does, and hand back the attempt token that now holds it.
 *
 * The two cases that drive `settleJob` directly still need a genuinely claimed
 * job: every statement the finalizer makes is fenced on
 * `id = $id and attempt_id = $attempt and status = 'running'`, so a session built
 * over an unclaimed row would be refused for the wrong reason and the assertion
 * would be about the fence rather than about the guard under test.
 */
async function claimOrWait(id: string): Promise<string> {
  for (let attempt = 1; attempt <= 40; attempt++) {
    const token = mintAttempt();
    const outcome = await runAsOwner(DEV_OWNER_ID, () =>
      pgJobStore.claim(id, DEV_OWNER_ID, token, 60_000),
    );
    if (outcome.kind === "claimed") return token;
    if (outcome.kind !== "busy") {
      throw new Error(`job ${id} could not be claimed: ${outcome.kind}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`job ${id} never got the single running slot in 20s`);
}

/**
 * An artefact store with nothing in it, for the copy that moves nothing.
 *
 * Only the three methods `copyArtefacts` reaches are real; the rest would be a
 * lie either way, and a `read` that always answers null is the whole fixture.
 */
function emptyStore(): ArtifactStore {
  return {
    read: async () => null,
    stampFor: async () => null,
    has: async () => false,
    hasEarlierBlocks: async () => false,
    readBaseline: async () => ({ state: "absent" as const }),
    write: async () => {
      throw new Error("the empty source store is read-only");
    },
    beginStep: async () => "never",
    finishStep: async () => {},
    interrupted: async () => false,
  } as unknown as ArtifactStore;
}

/**
 * The **real** inner session, with the endings it is handed recorded.
 *
 * An earlier version of this was a stub that threw on every call, to prove the
 * wrapper had not quietly delegated a `done` ending. That stopped being right
 * when the wrapper learned to end a job whose publication failed: the failing
 * path now goes through the inner session on purpose, and a stub that refused it
 * would have masked the very statement under test.
 *
 * So it is the production `fsStoreSession` over the production job store, and
 * what is recorded is *which* endings reached it. A `done` one reaching here
 * would mean the wrapper delegated a publication, which is the thing the stub
 * was there to catch.
 */
function recordingInner(): { session: StoreSession; settled: JobEnding[] } {
  const real = fsStoreSession({ artifacts: fsArtifacts, jobs: pgJobStore });
  const settled: JobEnding[] = [];
  return {
    settled,
    session: {
      ...real,
      settleJob: async (transition) => {
        settled.push(transition.ending);
        return await real.settleJob(transition);
      },
    },
  };
}
