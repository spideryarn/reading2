/**
 * **A claimant that loses its draft mid-step must end the job, not walk away.**
 *
 * The reproduction for docs/postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md.
 * It was **pinned to the defect** until 2026-09-02 — case 1 asserted the wedge
 * itself — and now asserts the fix. The failure that marked the changeover is in
 * case 1's own header.
 *
 * ## What the reader saw
 *
 * An `ideas` job's model call succeeded (50.5s, three ideas, real money) and the
 * server logged `lost the claim mid-step — read`. The row stayed `running` for
 * 12m40s, the next job on that article could not start, and Stop was accepted
 * with a 200 and did nothing until `settleExpired` swept the lease.
 *
 * ## The event this reproduces, and why it is a plain `update`
 *
 * `jobs.draft_revision_id` is `references(articleRevisions.id, { onDelete: "set
 * null" })` (src/db/schema.ts). So **anything that deletes the draft revision
 * takes the pointer out of the job row silently** — a fixture loader, a peer's
 * `forgetRevisions`, a future "start this article again" — and the claimant
 * inside the step finds out at its next fenced write. Nulling the column is that
 * event, exactly, with none of the concurrency needed to arrange it.
 *
 * The fence that refuses is `requireLiveJobOwnsDraft`
 * (src/store/pg-revisions.ts), and it used to carry `liveAttempt(job, attempt)
 * AND draft_revision_id = revisionId` under one error name, so *somebody else
 * owns this job* and *my job no longer points at my draft* arrived at src/jobs.ts
 * as the same exception. It now raises `JobDraftGone` for the second, which
 * crosses src/store/pg-session.ts as `DraftGoneError` and reaches
 * `endAsStorageFailure` rather than `lostTheClaim`.
 *
 * ## Case 2 is the one that did **not** reproduce
 *
 * The same browser pass reported a `timeline` job discarding a `quotes` artefact
 * that had just been published. Two jobs in sequence on one article is what that
 * takes, so case 2 runs exactly that and asserts the artefact survives. It does.
 * The publication guard in `publishRevisionIn` and the carry policy in
 * `REVISION_CARRY_POLICY` both hold, and the incident needed a *second writer*
 * on the same database — which the postmortem sets out.
 *
 * ## Contention
 *
 * Same shared database as every other suite: its own slugs, swept on the way in
 * and out, and tests/helpers/run-lock.ts because it claims jobs. Skips loudly
 * when there is no database; see tests/helpers/pg-ready.ts.
 */
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { advanceJobWith, claimSession } from "../src/jobs.js";
import type { AdvanceParts } from "../src/jobs.js";
import type { LabelsFile } from "../src/labels.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { STEPS, type PipelineStep, type StepProduct } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import type { ArtifactKind } from "../src/store/artifacts.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { Block, Job, JobStep, Quotes, StepName, Timeline, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";


loadEnvLocal();

await pgReady({
  suite: "tests/a-claim-that-lost-its-draft.test.ts",
  tables: ["spideryarn.jobs", "spideryarn.article_revisions"],
});

const runLock = await takeRunLock("tests/a-claim-that-lost-its-draft.test.ts");

const SLUGS = {
  wedge: "lost-draft-wedge",
  sequence: "lost-draft-two-jobs",
} as const;

/*
 * **A scratch data root stood here until 2026-09-05, and its comment was
 * false.** It read *"no step here writes to a disk, and this proves it"*,
 * pointed `SPIDERYARN_DATA_ROOT` at a `mkdtemp` directory, and then **nothing
 * ever read that directory back** — no `readdir`, no assertion, in any case.
 * It proved nothing; `tests/claim-session-postgres.test.ts`, which it cited, was
 * the file that actually asserted on its roots. Recorded rather than quietly
 * dropped, because a comment claiming an assertion that is not there is this
 * job's dominant failure and it was sitting inside a file about a lost draft.
 * `SPIDERYARN_DATA_ROOT` went with the filesystem store in stage G of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 */

const db = () => getDb();

/* ---------------------------------------------------------------- fixtures -- */

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

/** Real block ids: six of `src/ids.ts`'s alphabet, first a letter, no `i l o 1`. */
function blocksFor(seed: string): Block[] {
  return [
    block(`spya-${seed}aa2`, "The opening paragraph of a fixture."),
    block(`spya-${seed}aa3`, "The closing paragraph of a fixture."),
  ];
}

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
        gist: "A fixture built by tests/a-claim-that-lost-its-draft.test.ts and nothing else.",
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

/** A step that returns its artefacts and lets the session write them. */
function returningStep(
  name: StepName,
  parts: Partial<Record<ArtifactKind, unknown>>,
  options: { readonly inputHash?: string; readonly body?: () => Promise<void> | void } = {},
): PipelineStep {
  return {
    name,
    label: STEPS[name].label,
    produces: STEPS[name].produces,
    async run(): Promise<StepProduct> {
      await options.body?.();
      return {
        parts: parts as never,
        ...(options.inputHash !== undefined && { stamp: { inputHash: options.inputHash } }),
        detail: `${name} ran`,
      };
    },
  } as PipelineStep;
}

/** The three steps that make a publishable article. */
function articleSteps(slug: string, seed: string) {
  const blocks = blocksFor(seed);
  const html = `<html><body>${blocks.map((b) => b.html).join("")}</body></html>`;
  return {
    blocks,
    steps: {
      extract: returningStep("extract", {
        extractedHtml: html,
        meta: { slug, title: "A fixture article" },
      }),
      blocks: returningStep("blocks", { blocks: { blocks }, stampedHtml: html }),
      hierarchy: returningStep(
        "hierarchy",
        { tree: treeFor(slug, blocks), labels: labelsFor(slug, blocks), blocks: { blocks } },
        { inputHash: hashBlocks(blocks) },
      ),
    } as Partial<Record<StepName, PipelineStep>>,
  };
}

const INGEST: StepName[] = ["extract", "blocks", "hierarchy"];

async function queueJob(slug: string, names: StepName[]): Promise<Job> {
  const wanted: Job = {
    id: mintId(),
    ownerId: DEV_OWNER_ID,
    slug,
    steps: names.map((name): JobStep => ({ name, label: STEPS[name].label, status: "pending" })),
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const { job } = await pgJobStore.enqueueOrGet(wanted, {
    workKey: `lost-draft-${wanted.id}`,
    reservesName: false,
  });
  return job;
}

/**
 * Advance until this job actually runs — `claim` answers `busy` behind a peer.
 *
 * **Only a `queued` job is waited for**, which matters here more than in the
 * suites this is copied from: the defect under test *is* a `busy` on a job the
 * claimant has already walked away from, and a loop that retried that would
 * spin for the length of the lease and then report a timeout instead of the
 * finding.
 */
async function advance(id: string, parts: AdvanceParts) {
  for (let attempt = 1; attempt <= 40; attempt++) {
    const advanced = await runAsOwner(DEV_OWNER_ID, () => advanceJobWith(id, parts));
    if (!advanced?.busy) return advanced;
    if (advanced.job.status !== "queued") return advanced;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`job ${id} never got to run in 20s`);
}

async function jobRow(id: string) {
  const [row] = await db().select().from(jobsTable).where(eq(jobsTable.id, id)).limit(1);
  return row;
}

async function currentRevisionOf(slug: string): Promise<string | null> {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  return row?.currentRevisionId ?? null;
}

async function revisionRow(id: string) {
  const [row] = await db().select().from(articleRevisions).where(eq(articleRevisions.id, id)).limit(1);
  return row;
}

/* ------------------------------------------------------------------ cases -- */

describe("a claim whose draft is taken away mid-step", () => {
  afterAll(async () => {
    const database = getDb();
    for (const slug of Object.values(SLUGS)) {
      await database.delete(jobsTable).where(eq(jobsTable.slug, slug));
      const [row] = await database
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.slug, slug))
        .limit(1);
      if (!row) continue;
      await database.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, row.id));
      await database.delete(articles).where(eq(articles.id, row.id));
    }
    await runLock?.release();
  }, 60_000);

  /* ------------------------------------------------------------------ 1 -- */

  /**
   * **The fix for 260902f, asserted rather than the defect it replaced.**
   *
   * This case was pinned to the wedge until 2026-09-02: it asserted `busy`, a
   * row still `running`, a live lease, and a Stop that answered and did nothing.
   * Watched red against the fix at exactly the assertion the pin named —
   * `expected false to be true` on `advanced?.busy` — and then rewritten to the
   * three things its own header asked for.
   *
   * What changed underneath it: `requireLiveJobOwnsDraft`
   * (src/store/pg-revisions.ts) raises `JobDraftGone` rather than
   * `NotTheLiveAttempt` when the attempt is live and only the draft pointer has
   * moved, src/store/pg-session.ts gives that its own name across the seam
   * (`DraftGoneError`), and src/jobs.ts routes it to `endAsStorageFailure`
   * instead of `lostTheClaim`.
   */
  it("ends the job as a retryable error and lets the article's line move on", async () => {
    const slug = SLUGS.wedge;
    const { steps, blocks } = articleSteps(slug, "gna");

    /* An ordinary article first, so the job below is a *late* single step on a
       published article — which is what the reader's `ideas` job was. */
    const ingest = await queueJob(slug, INGEST);
    const ingested = await advance(ingest.id, {
      session: claimSession,
      steps: { ...STEPS, ...steps } as never,
    });
    expect(ingested?.job.status, "the fixture ingest has to publish before the wedge case").toBe("done");
    const published = await currentRevisionOf(slug);

    const job = await queueJob(slug, ["arc"]);

    /* **Queued behind it, and queued *now*.** The article's line refuses a job
       while an older active row exists on its slug (src/store/pg-jobs.ts §
       `blockedByAnother`, stage 1 of 260902e), so this one has to exist before
       the wedge to be the thing the wedge would have frozen. It is what turned
       one stuck job into twelve minutes of a dead article. */
    const behind = await queueJob(slug, ["quotes"]);

    let pointerWas: string | null = null;
    const startedAt = Date.now();
    const advanced = await advance(job.id, {
      session: claimSession,
      steps: {
        ...STEPS,
        arc: returningStep(
          "arc",
          { arc: { version: "arc/1", generator: "fixture", slug, entries: [] } },
          {
            /* **The event, in the middle of the step.** This is what a delete of
               the draft revision does to the job row through the foreign key —
               `on delete set null` in src/db/schema.ts — and the model call is
               where the reader's article spent its 50 seconds. */
            body: async () => {
              const [row] = await db()
                .select({ draft: jobsTable.draftRevisionId })
                .from(jobsTable)
                .where(eq(jobsTable.id, job.id))
                .limit(1);
              pointerWas = row?.draft ?? null;
              await db()
                .update(jobsTable)
                .set({ draftRevisionId: null })
                .where(eq(jobsTable.id, job.id));
            },
          },
        ),
      } as never,
    });

    expect(pointerWas, "the claim never opened a draft, so this case proves nothing").toBeTruthy();

    /* **The claim ends the job it still holds**, rather than reporting a lost
       claim about a row nobody took. `ran` is null on purpose: the step really
       did run, and nothing it produced was kept, so putting it on the card as a
       completed step would promise output no one can read. */
    expect(advanced?.busy, "the claim was never lost, so nothing answers busy").toBe(false);
    expect(advanced?.done, "and the job is over").toBe(true);
    expect(advanced?.ran, "with no step to show for it").toBeNull();
    expect(advanced?.job.status).toBe("error");
    expect(advanced?.job.failureKind, "retryable — nothing here says another go would fail").toBe(
      "retry",
    );
    expect(advanced?.job.error, "and the card says what happened").toMatch(
      /removed before it could be saved/,
    );
    expect(advanced?.job.error, "under a Retry button it is honest about").toMatch(
      /Trying again is safe/,
    );

    /* **The row is terminal**, which is the whole of the fix: no attempt, no
       lease, an ending time, and no draft pointer for the sweeper to spare. */
    const after = await jobRow(job.id);
    expect(after?.status).toBe("error");
    expect(after?.attemptId, "nothing holds it").toBeNull();
    expect(after?.leaseExpiresAt, "and no lease has to lapse first").toBeNull();
    expect(after?.draftRevisionId, "pointing at no draft").toBeNull();
    expect(after?.finishedAt, "it ended").not.toBeNull();
    expect(after?.failureKind).toBe("retry");

    /* **In a second, not in 760.** The wedge's only exit was `LEASE_MS`, and the
       incident's row showed `finished_at − started_at` of 760.16s to the
       millisecond. Ten seconds is loose enough for a shared box and three orders
       of magnitude away from the thing it is guarding. */
    expect(Date.now() - startedAt, "the recovery is immediate, not the lease").toBeLessThan(10_000);

    /* **The draft is disposed of rather than left immortal.**
       `sweepAbandonedDrafts` spares any revision a job row still names, so the
       pointer clear above and this are one act — see `endAsStorageFailure`. */
    expect((await revisionRow(pointerWas!))?.status, "the draft is failed, not left open").toBe(
      "failed",
    );

    /* And nothing was published: the reader keeps the article they had. */
    expect(await currentRevisionOf(slug), "the shelf is untouched").toBe(published);

    /* **Stop has nothing to stop**, which is the third thing the pin asked for.
       `requestCancel` only touches an active row (src/store/pg-jobs.ts), so a
       job that has already ended answers `undefined` — where the reader used to
       get a 200, a disabled "Stopping…", and a `cancelling` flag that no
       claimant was left to read. */
    const stopped = await runAsOwner(DEV_OWNER_ID, () => pgJobStore.requestCancel(job.id, DEV_OWNER_ID));
    expect(stopped, "there is nothing left for Stop to reach").toBeUndefined();

    /* **The article's line moves on**, which is what the reader actually lost.
       The job queued behind this one runs now instead of waiting out a lease it
       had nothing to do with. */
    const next = await advance(behind.id, {
      session: claimSession,
      steps: {
        ...STEPS,
        quotes: returningStep("quotes", {
          quotes: {
            version: "quotes/1",
            generator: "fixture",
            slug,
            sourceHash: hashBlocks(blocks),
            quotes: [{ id: "q1", blockId: blocks[0]!.id, text: "The opening paragraph", start: 0 }],
            discarded: {},
            generatedAt: new Date().toISOString(),
            elapsedMs: 1,
          } as unknown as Quotes,
        }),
      } as never,
    });
    expect(next?.job.status, "the job behind it is no longer waiting on a lease").toBe("done");
  }, 180_000);

  /* ------------------------------------------------------------------ 2 -- */

  /**
   * **The bug that would not reproduce, and this is the shape it was reported in.**
   *
   * `quotes` publishes, then `timeline` runs on the same article and publishes.
   * If a later job could bury an earlier job's artefact through the ordinary
   * serial path, this is where it would happen. It does not: the second draft is
   * copied from the first's publication (`based_on_revision_id` names it), the
   * carry policy brings `quotes` across, and `publishRevisionIn` compares the
   * two before it moves the pointer.
   *
   * Keep this passing. It is the control that says the incident needed a second
   * writer on the same database.
   */
  it("keeps an earlier job's artefact when a later job publishes", async () => {
    const slug = SLUGS.sequence;
    const { steps, blocks } = articleSteps(slug, "ptv");

    const ingest = await queueJob(slug, INGEST);
    expect((await advance(ingest.id, { session: claimSession, steps: { ...STEPS, ...steps } as never }))?.job.status).toBe("done");
    const afterIngest = await currentRevisionOf(slug);
    expect(afterIngest).not.toBeNull();

    const quotes = {
      version: "quotes/1",
      generator: "fixture",
      slug,
      sourceHash: hashBlocks(blocks),
      quotes: [{ id: "q1", blockId: blocks[0]!.id, text: "The opening paragraph", start: 0 }],
      discarded: {},
      generatedAt: new Date().toISOString(),
      elapsedMs: 1,
    } as unknown as Quotes;

    const quotesJob = await queueJob(slug, ["quotes"]);
    expect(
      (await advance(quotesJob.id, {
        session: claimSession,
        steps: { ...STEPS, quotes: returningStep("quotes", { quotes }) } as never,
      }))?.job.status,
    ).toBe("done");

    const afterQuotes = await currentRevisionOf(slug);
    expect(afterQuotes, "the quotes job published").not.toBe(afterIngest);
    expect((await revisionRow(afterQuotes!))?.basedOnRevisionId).toBe(afterIngest);
    expect((await revisionRow(afterQuotes!))?.quotes, "and the reader can see them").toBeTruthy();

    const timeline = {
      version: "timeline/1",
      generator: "fixture",
      slug,
      sourceHash: hashBlocks(blocks),
      events: [],
      generatedAt: new Date().toISOString(),
      elapsedMs: 1,
    } as unknown as Timeline;

    const timelineJob = await queueJob(slug, ["timeline"]);
    expect(
      (await advance(timelineJob.id, {
        session: claimSession,
        steps: { ...STEPS, timeline: returningStep("timeline", { timeline }) } as never,
      }))?.job.status,
    ).toBe("done");

    const afterTimeline = await currentRevisionOf(slug);
    expect(afterTimeline).not.toBe(afterQuotes);

    /* **The draft was copied from what the article was actually serving**, which
       is the reading the incident's log line contradicted: there, `timeline`
       began from a revision two publications behind. */
    const published = await revisionRow(afterTimeline!);
    expect(published?.basedOnRevisionId, "the later job drafted from the earlier job's publication").toBe(
      afterQuotes,
    );
    expect(published?.timeline, "the later job's own artefact is there").toBeTruthy();
    expect(published?.quotes, "and the earlier job's artefact survived it").toBeTruthy();
  }, 240_000);
});
