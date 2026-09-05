/**
 * **The seam a step's failure crosses on its way to the reader.**
 *
 * A step throws; `src/jobs.ts` catches it and writes something onto
 * `step.error` and `job.error`; those two fields are persisted, read back
 * unchanged, and rendered — `job.error` in the band (src/web/JobProgress.tsx),
 * `step.error` on the shelf card (src/web/AddArticle.tsx). Until 2026-09-03
 * what it wrote was `(err as Error).message`, so **whatever a step happened to
 * put in an exception was published**.
 *
 * That is not a hypothetical. It has produced at least eight leaks:
 * six pipeline stages threw `Model refused: ${JSON.stringify(stop_details)}`
 * until 2026-08-26 (src/messages.ts § `MODEL_REFUSED`); `truncatedMessage`
 * (src/token-budget.ts) is developer copy that reaches the same screen and was
 * *recorded rather than fixed* in docs/project/copy.md; and the quiz's
 * band-spread sentence put a source-file reference on a reader's screen on
 * 2026-09-03.
 *
 * So the rule this file guards is deliberately about the **class**, not about
 * any one of those: an error nobody declared a reader sentence for must not
 * reach either persisted field, whatever it says. The diagnostic still goes to
 * the log — `Error.message` is untouched — and deliberately not to Sentry,
 * which tests/job-failure.test.ts pins one layer down.
 *
 * **Both fields, not the rendered HTML.** GPT Sol's point, and it is the
 * difference between a test and a comfort: the band and the card deliberately
 * render *different* fields, so a DOM test of one would stay green while the
 * leak survived in the other. Since the stage 2 review the same argument runs
 * one layer further out — the last two cases here are **not** about `runStep`
 * at all, because a class is not a function:
 *
 * - a **publication that was refused**, which reaches `job.error` through
 *   `endAsStorageFailure` and kept an explicit exception for `PublishRefused`
 *   until somebody looked for *writers of the field* rather than for throwers;
 * - a **run the reader stopped**, which unwinds through the failure catch and
 *   was being handed a failure's sentence for something nobody would call a
 *   failure.
 *
 * And the persisted assertions are read back **off the row the queue wrote**,
 * not off `getJob` — see `persisted`.
 *
 * ## It ran on the filesystem queue until 2026-09-04
 *
 * Every job here was a JSON file under `data/_jobs/`, every session was
 * `fsStoreSession`, and `persisted` parsed the file back. That made the whole
 * file a test of a queue production does not run
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § B),
 * and it made the *sharpest* thing in it — *read back off what the queue really
 * wrote* — a claim about a JSON round trip rather than about a `text` column and
 * a `jsonb` one.
 *
 * The flag is now pinned to `postgres` before any import; `enqueue` and
 * `advanceJobWith` drive the real `pgJobStore` and the session `claimSession`
 * builds; and `persisted` selects the two columns straight out of
 * `spideryarn.jobs`. **No article is seeded**, and that is deliberate rather
 * than a saving: these jobs are first ingests of a slug nothing holds, so
 * `openOrBeginJobDraft` → `lockOrCreateArticle` makes the row the way a real one
 * would — which is the state the `fetch` step actually fails in. The rows are
 * taken away by slug in `afterAll`.
 *
 * **The race this file was seen losing is gone.** It had failed once under heavy
 * load on a read-after-write against `data/_jobs/` — a test of the very store
 * being deleted. There is no `data/_jobs/` in it any more, and neither
 * `persisted` nor `settle` reads a directory. Ten consecutive runs, 2026-09-04,
 * on a sixteen-core box at load average 32–52 with several other worktrees
 * running their own suites: ten green, 9/9 every time. That is a measurement
 * with a date on it rather than a proof — the old failure was seen once — but it
 * is the measurement the plan asked for and the mechanism it blamed is gone.
 *
 * See docs/project/copy.md § The seam between the two audiences, and
 * docs/plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md § Stage 2.
 *
 * ## The mutation, watched red on 2026-09-04
 *
 * **Mutation.** `steps: ending.steps` in `finishIn` (src/store/pg-jobs.ts) made
 * `steps: ending.steps.map((s) => ({ ...s, error: undefined }))` — a field lost
 * on the way to a column, which is the precise failure `persisted` was written
 * for. *5 of 8 red*, and see `persisted` for what that count says about the
 * function's own justification.
 *
 * **Blind to.** The `jsonb` column and not the `text` one beside it:
 * `job.error` survives this mutation untouched, so the band's field is
 * covered by nothing here. Nor `releaseStepIn`, which writes the same `steps`
 * array *between* steps and is what a reader watching a multi-step job actually
 * sees — every job in this file has one step and ends on the first failure, so
 * the mid-walk writer is never exercised. Nor the fence in the same `where`, nor
 * `claimIn`. And this file still cannot see a step whose product was never
 * written: nothing here asserts on a revision.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { eq, inArray } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import {
  type AdvanceParts,
  advanceJobWith,
  cancelJob,
  claimSession,
  DEADLINE_MARGIN_MS,
  enqueue,
  getJob,
  REQUEUE_BUDGET,
} from "../src/jobs.js";
import { STEPS } from "../src/pipeline.js";
import { jobWorthRetrying, stageFailure } from "../src/job-failure.js";
import { ANSWER_OVERFLOWED_FIXED_ASK, MODEL_REFUSED, worthRetrying } from "../src/messages.js";
import { currentOwnerId } from "../src/owner.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { PublishRefused } from "../src/store/pg-revisions.js";
import type { StoreSession } from "../src/store/session.js";
import type { Job } from "../src/types.js";
import { bareArticles } from "./helpers/bare-article.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

await pgReady({
  suite: "tests/step-failure-seam.test.ts",
  tables: ["spideryarn.articles", "spideryarn.jobs"],
});

/**
 * One slug per case, and every row under them is removed afterwards.
 *
 * Three cases share `test-seam-undeclared` on purpose — they are three questions
 * about one failure — and that is safe because each waits for its own job to
 * reach a terminal status before the next enqueues.
 */
const SLUGS = [
  "test-seam-cancelled",
  /* Two overrun cases, two articles. They must not share one: the first leaves
     its job `queued` — that is what a pause *is* — and a second job on the same
     slug would then wait behind it rather than running. `test-seam-overran` was
     one slug until 2026-09-04, when the second case arrived. */
  "test-seam-overran-pa",
  "test-seam-overran-ov",
  "test-seam-undeclared",
  "test-seam-declared-blocked",
  "test-seam-declared-retry",
  "test-seam-publish-refused",
];

/**
 * **An `articles` row per slug, before anything is queued** — added 2026-09-05.
 *
 * `enqueue` refuses a bare-slug request for an article the reader does not have
 * (src/jobs.ts), and every case below queues one. The rows are what this suite
 * always meant: its subject is what a *failing step* persists onto the job, and
 * a job on an article that does not exist was never the question. See
 * ./helpers/bare-article.ts.
 */
beforeAll(async () => {
  await bareArticles(SLUGS);
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

/** Poll until the job stops moving, or give up. */
async function settle(id: string) {
  for (let i = 0; i < 60; i++) {
    const job = await getJob(id);
    if (job && job.status !== "queued" && job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job never finished");
}

/**
 * Run one job whose only step throws `err`, and hand back what was persisted.
 *
 * `fetch` because it is the cheapest step to fail in: with `run` replaced there
 * is no network, no model call and nothing to clean up but a directory.
 */
async function failingJob(slug: string, err: unknown) {
  vi.spyOn(STEPS.fetch, "run").mockRejectedValue(err);
  const queued = await enqueue({ slug, steps: ["fetch"] });
  return await settle(queued.id);
}

/**
 * **The persisted pair, read back off the row the queue actually wrote.**
 *
 * The argument for this function is older than the store it now reads. Under the
 * filesystem queue `getJob` handed back a `structuredClone` of the in-memory
 * index (src/store/jobs-fs.ts § `get`), so every assertion made against it was
 * an assertion about the object this process had just built, and a leak that
 * only appeared once the record was serialised would pass all of them. GPT Sol's
 * point on the first version of this file, and it is the same shape as the
 * assertion it was already making about the band and the card: check the thing
 * that is really read, not a copy that happens to agree.
 *
 * **Postgres weakens most of that, and the honest thing is to say by how much.**
 * `getJob` is a `SELECT` now, so `settle()`'s answer is already a round trip and
 * the every-assertion-so-far-is-about-an-object-this-process-built sentence
 * above is simply no longer true of this file. Measured rather than reasoned:
 * the mutation below, which drops `error` from the steps on their way into the
 * column, turns **five** cases red, and the first thing it breaks is one of the
 * *in-memory* assertions. So the two kinds of read now differ by exactly one
 * thing — `toJob(row)`, a mapping with its own opportunities to lose a field —
 * and this function is kept for that difference and for the plainness of the
 * claim it makes: *what is in the database is not a leak*.
 */
async function persisted(id: string): Promise<{ error: string | null; steps: Job["steps"] }> {
  const rows = await getDb()
    .select({ error: jobsTable.error, steps: jobsTable.steps })
    .from(jobsTable)
    .where(eq(jobsTable.id, id));
  const row = rows[0];
  if (!row) throw new Error(`no row in spideryarn.jobs for job ${id}`);
  return { error: row.error, steps: row.steps as Job["steps"] };
}

/**
 * Everything these jobs made, by slug — the `articles` rows included.
 *
 * Jobs first: a job row's `draft_revision_id` is a foreign key into the revision
 * the article delete would be trying to cascade away.
 */
afterAll(async () => {
  await getDb().delete(jobsTable).where(inArray(jobsTable.slug, SLUGS));
  await getDb().delete(articles).where(inArray(articles.slug, SLUGS));
  await closeDb();
}, 60_000);

describe("an error nobody wrote a reader sentence for", () => {
  /**
   * The text below is every genre this seam has actually leaked, in one string:
   * a source-file reference, a section name, band arithmetic addressed to
   * whoever tunes a prompt, and a fragment standing in for the provider prose
   * that `MODEL_REFUSED` exists to keep off the screen.
   */
  const RAW =
    'wanted 2 "hard", got 1 — src/quiz.ts § bandQuota. Model said: {"stop_details":' +
    '{"reason":"the article argues that consciousness is subjective"}}';

  it("reaches neither persisted field", async () => {
    const finished = await failingJob("test-seam-undeclared", new Error(RAW));

    expect(finished.status, "the job did not fail, so this proves nothing").toBe("error");
    expect(finished.steps[0]?.status).toBe("error");

    /* Both, and separately, because the two are rendered by different surfaces
       and an earlier version of this fix wrote one and not the other. */
    expect(finished.error, "the raw message reached job.error").not.toContain("src/quiz.ts");
    expect(finished.error).not.toContain("stop_details");
    expect(finished.error).not.toContain("consciousness is subjective");
    expect(finished.steps[0]?.error, "the raw message reached step.error").not.toContain(
      "src/quiz.ts",
    );
    expect(finished.steps[0]?.error).not.toContain("stop_details");
    expect(finished.steps[0]?.error).not.toContain("consciousness is subjective");

    /* **And on disk**, which is a different claim from the one above: `getJob`
       hands back a clone of the in-memory index, so every assertion so far is
       about the object this process built. See `persisted`. */
    const row = await persisted(finished.id);
    expect(row.error, "the raw message reached the persisted job.error").not.toContain(
      "src/quiz.ts",
    );
    expect(row.steps[0]?.error, "the raw message reached the persisted step.error").not.toContain(
      "src/quiz.ts",
    );
    expect(row.error, "the sentence did not survive being written down").toMatch(
      /\[jb-step-again\]$/,
    );
    expect(row.steps[0]?.error).toMatch(/\[jb-step-again\]$/);
  });

  it("is replaced by something the reader can read, with a code to quote", async () => {
    const finished = await failingJob("test-seam-undeclared", new Error(RAW));
    /* Not `not.toBeNull()`: a field that went empty would also pass every
       `not.toContain` above, which is the way this test could be green while
       the reader is told nothing at all. */
    expect(finished.error).toMatch(/\[jb-step-again\]$/);
    expect(finished.steps[0]?.error).toMatch(/\[jb-step-again\]$/);
    /* The step is named rather than counted — the same rule the card follows,
       and the one thing the generic sentence knows about this failure. */
    expect(finished.error).toContain(STEPS.fetch.label);
  });

  it("is still offered another go, because nobody said it could not work", async () => {
    /* The compatibility direction, src/job-failure.ts § Which way to be wrong.
       An unrecognised failure keeps the Retry button; the generic copy has to
       agree with that rather than quietly hide it. */
    const finished = await failingJob("test-seam-undeclared", new Error(RAW));
    expect(jobWorthRetrying(finished)).toBe(true);
  });
});

describe("an error that declared its reader sentence", () => {
  it("arrives word for word, and its diagnostic does not", async () => {
    const detail = "stop_reason=refusal after 41.2s — src/quiz.ts:530";
    const finished = await failingJob(
      "test-seam-declared-blocked",
      stageFailure(MODEL_REFUSED, detail),
    );

    expect(finished.error).toBe(MODEL_REFUSED.message);
    expect(finished.steps[0]?.error).toBe(MODEL_REFUSED.message);
    expect(finished.error).not.toContain("src/quiz.ts");
    expect(finished.error).not.toContain("stop_reason");
  });

  it("lets its kind decide whether another go is offered", async () => {
    /* The positive control's second half. `MODEL_REFUSED` is `blocked`, so the
       Retry button is withheld — and `ANSWER_OVERFLOWED_FIXED_ASK` is `retry`,
       so it is not. One declared failure of each, because a test that only ever
       saw the withholding case would pass with the field hard-wired. */
    const refused = await failingJob(
      "test-seam-declared-blocked",
      stageFailure(MODEL_REFUSED, "detail"),
    );
    expect(refused.failureKind).toBe("blocked");
    expect(jobWorthRetrying(refused)).toBe(false);

    const overflowed = await failingJob(
      "test-seam-declared-retry",
      stageFailure(ANSWER_OVERFLOWED_FIXED_ASK, "detail"),
    );
    expect(overflowed.failureKind).toBe("retry");
    expect(jobWorthRetrying(overflowed)).toBe(true);
    expect(overflowed.error).toBe(ANSWER_OVERFLOWED_FIXED_ASK.message);
  });
});

/**
 * **The other door onto `job.error`, and the reason this file is about a class
 * rather than about `runStep`.**
 *
 * Everything above injects into a step, so everything above exercises one
 * catch. `endAsStorageFailure` is a second writer of `job.error` entirely —
 * the claim could not open its draft, the draft went away, or the publication
 * was refused — and for the first six hours of the seam's life it kept an
 * explicit exception: `PublishRefused`'s own message went straight onto the
 * field. That message is ours, which is what made the exception look safe, and
 * it reads *"Refusing to publish "<slug>": the tree was built from different
 * blocks (hierarchy ran against `<hash>`, these blocks are `<hash>`) — re-run
 * hierarchy"*. Being ours and being fit to show a reader are different things.
 *
 * GPT Sol found it by looking for *writers of the field* rather than for
 * throwers, which is the same lesson `MODEL_REFUSED` records as **grep the
 * genre, not the list** — and the reason the case belongs here, beside the
 * step-level ones, rather than only in the Postgres suite that first reached
 * this door (`tests/all-skipped-publication-refusal.test.ts`, which asserts the
 * same thing against a real row).
 *
 * The refusal is injected into the session's own `settleJob` rather than
 * provoked with a real lineage conflict, and that is still right after the move
 * to Postgres: it is the coordinator's handling of the throw that is under test,
 * not the query that produces it. `tests/all-skipped-publication-refusal.test.ts`
 * is the one that makes a real row refuse.
 */
describe("a publication that was refused", () => {
  it("tells the reader the publication failed, not why the tree was rejected", async () => {
    const slug = "test-seam-publish-refused";
    const refusal = new PublishRefused(slug, [
      "the tree was built from different blocks (hierarchy ran against abc123, these blocks are def456) — re-run hierarchy",
    ]);

    /* **Into the store, not through `enqueue`.** `enqueue` starts the local
       pump, which would be a second driver racing the `advanceJobWith` below
       and claiming the job out from under it — tests/jobs-walk.test.ts §
       `queueJob` learned this first. */
    const queued: Job = {
      /* **`mintId()`, not a hand-written mnemonic.** `jobs_id_format` requires
         the body to start with a letter, so the old `spya-seam<2 random>` — and
         `spya-seamc<1>` below — are refused by Postgres outright. The filesystem
         store validated nothing, which is why a decade of fixture ids were never
         wrong until now. */
      id: mintId(),
      ownerId: currentOwnerId(),
      slug,
      steps: [{ name: "fetch", label: STEPS.fetch.label, status: "pending" }],
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    await pgJobStore.enqueueOrGet(queued, { workKey: `seam-${queued.id}`, reservesName: false });

    const parts: AdvanceParts = {
      /* **Production's own session factory**, with two things replaced — the
         freshness reads, so the step skips, and the successful settlement, so
         the publication throws. Spreading it is safe: `pgStoreSession` returns
         an object of closures, not methods that need a `this`. */
      session: async (job: Job, attempt: string): Promise<StoreSession> => {
        const real = await claimSession(job, attempt);
        return {
          ...real,
          /* `stepIsDone` asks these three before it ever looks at the step, so
             saying the artefact is there is what makes the step skip. Nothing
             is written and nothing is read: the point of this case is the
             publication, and the walk has to get past the step to reach it. */
          reads: {
            ...real.reads,
            interrupted: async () => false,
            has: async () => true,
            stampFor: async () => null,
          },
          settleJob: async (settle) => {
            /* **Only the successful ending.** `endAsStorageFailure` settles the
               job a second time to record the failure, and a wrapper that threw
               on both would take the recovery down with it and prove nothing
               about what the reader is shown. */
            if (settle.kind === "end" && settle.ending.status === "done") throw refusal;
            return await real.settleJob(settle);
          },
        };
      },
      /* **A step that skips**, which is not a shortcut — it is the production
         shape of this door. `endJob` is reached with nothing having run
         (src/jobs.ts § the all-skipped publication), which is exactly the case
         `PublishRefused` was met on in the first place. A step that *ran* would
         reach the same line, and this one needs neither artefacts nor a
         product. */
      steps: {
        ...STEPS,
        fetch: {
          ...STEPS.fetch,
          /* No `stamp`, so `stepIsDone` falls through to `isDone` rather than
             comparing a fingerprint against artefacts that are not there. */
          stamp: undefined,
          isDone: async () => true,
          run: async () => {
            throw new Error("the skipping step was run");
          },
        },
      } as unknown as AdvanceParts["steps"],
    };

    const advanced = await advanceJobWith(queued.id, parts);
    expect(advanced?.job.status, "the job did not fail, so this proves nothing").toBe("error");

    for (const [where, message] of [
      ["in memory", advanced?.job.error],
      ["on disk", (await persisted(queued.id)).error],
    ] as const) {
      expect(message, `the refusal's reasons reached the reader ${where}`).not.toMatch(
        /Refusing to publish|re-run hierarchy|abc123|def456/,
      );
      /* And it says something — the publication door's own sentence, so this
         cannot pass by the field being empty. */
      expect(message, `nothing was said ${where}`).toMatch(
        /putting the finished article on your shelf/,
      );
    }
  });
});

/**
 * **Stop is not a failure, and the seam nearly made it read like one.**
 *
 * A cancel unwinds through the same `catch` as a failure — the step throws
 * because it honoured the signal — so for the first six hours of the seam's
 * life it was handed `readerFailureOf`'s answer. Two things were wrong with
 * that, and GPT Sol named both:
 *
 * - the generic copy says the problem *"has been recorded"*, on the one branch
 *   that deliberately skips `captureFailure`;
 * - a refusal racing with Stop leaves a `blocked` sentence — *asking again will
 *   be refused* — on a step of a job `recordFailureKind` is about to mark
 *   retryable. The reader is then told two things and can act on the wrong one.
 *
 * The case below is that race, on purpose: the step throws a declared,
 * non-retryable failure **and** the reader has stopped it. Under the old code
 * that combination is what produced the contradiction, and a test using a plain
 * `new Error` would have missed it.
 */
describe("a run the reader stopped", () => {
  it("says they stopped it, rather than reporting a failure they chose", async () => {
    const slug = "test-seam-cancelled";
    const queued: Job = {
      id: mintId(),
      ownerId: currentOwnerId(),
      slug,
      steps: [{ name: "fetch", label: STEPS.fetch.label, status: "pending" }],
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    await pgJobStore.enqueueOrGet(queued, { workKey: `seam-${queued.id}`, reservesName: false });

    vi.spyOn(STEPS.fetch, "run").mockImplementation(async () => {
      /* Stop arriving *inside* the step, which is the path that aborts the
         claimant's own controller — the between-steps path never reaches the
         catch at all (tests/jobs-walk.test.ts § a Stop between two steps). */
      await cancelJob(queued.id);
      throw stageFailure(MODEL_REFUSED, "the model answered with stop_reason: refusal");
    });

    const advanced = await advanceJobWith(queued.id, { session: claimSession, steps: STEPS });

    expect(advanced?.job.status, "it was not cancelled, so this proves nothing").toBe("cancelled");

    const step = advanced?.job.steps[0];
    expect(step?.error, "the reader was told a refusal they did not cause").not.toMatch(
      /declined to do this one|most likely get the same/,
    );
    expect(step?.error, "and not told it had been recorded when it was not").not.toMatch(
      /has been recorded/,
    );
    expect(step?.error).toMatch(/\[jb-stopped\]$/);

    /* The other half of the contradiction: the job is retryable, so nothing on
       the step may say another go cannot work. */
    expect(advanced?.job.failureKind).toBeUndefined();
    expect(jobWorthRetrying(advanced?.job as Job)).toBe(true);
    expect(worthRetrying(step?.error ?? null), "the sentence disagrees with the job").toBe(true);
  });
});

/**
 * **And the mirror of it: a run that ran out of time, told the reader *they*
 * stopped it.**
 *
 * Found in a browser run on 2026-09-04, not by any test: a 144-page PDF's
 * hierarchy step hit the 740 s deadline at 742.8 s and the card said *"You
 * stopped this before it finished."* Nobody had pressed anything.
 *
 * The cause is one line. The claimant's self-deadline **aborts the same
 * `AbortController` that Stop aborts** (src/jobs.ts), and `runStep` decided with
 * a bare `controller.signal.aborted` — so an overrun took the branch written for
 * a reader who chose to stop. The outer level had it right all along
 * (`overran ? interruptedEnding(job) : …`), which made the contradiction worse
 * rather than better: the band said *nobody came back* and the shelf card, over
 * the same job, said *you did this*.
 *
 * `messages.ts` states the distinction these two codes exist to hold — *"an
 * interruption is nobody came back, and telling somebody who pressed Stop that
 * something went wrong is the app not listening"* — and this is that same
 * disrespect reversed. **Raising `MAX_PAGES` to 250 is what makes it common**,
 * because a deadline overrun on a long PDF goes from rare to routine.
 *
 * **Since 2026-09-04 the first two overruns do not produce a sentence at all**,
 * which is the other half of the same respect: the claimant is alive and hands
 * the job back rather than ending it (`pauseForDeadline`, src/store/jobs.ts).
 * So there are two cases here now — what a paused job says, which is nothing,
 * and what the ending says once the windows are gone, which is what this case
 * always asserted.
 */
describe("a run its own deadline stopped", () => {
  /**
   * One overrunning job, driven until it either pauses or ends.
   *
   * `leaseMs` is `DEADLINE_MARGIN_MS + 100`, so the claimant gives up a tenth of
   * a second in — the deadline is `leaseMs - DEADLINE_MARGIN_MS` after the claim.
   *
   * **Merged 2026-09-04, and the resolution is worth recording.** Two agents
   * added a block of this name within hours: one here for the pause, driving the
   * filesystem store, and one from `dev` driving Postgres. `dev` had converted
   * this whole file off the filesystem deliberately (see the header), so the fs
   * fixtures no longer exist — keeping them would have re-opened a decision
   * somebody had just made. What survives is `dev`'s store and this side's
   * coverage: the second case below, a job merely put down, which the pause
   * added and which nothing else in this file asserts.
   */
  async function overrun(id: string) {
    return await advanceJobWith(id, {
      session: claimSession,
      steps: {
        ...STEPS,
        fetch: {
          ...STEPS.fetch,
          /* A step that honours its signal and never finishes on its own —
             which is what an overrunning PDF extract is, at a scale a test can
             wait for. */
          run: (ctx: { signal: AbortSignal }) =>
            new Promise<never>((_, reject) => {
              ctx.signal.addEventListener(
                "abort",
                () => reject(new Error("the step honoured the signal")),
                { once: true },
              );
            }),
        },
      } as unknown as AdvanceParts["steps"],
      leaseMs: DEADLINE_MARGIN_MS + 100,
    });
  }

  async function anOverrunningJob(seed: string): Promise<Job> {
    const queued: Job = {
      id: mintId(),
      ownerId: currentOwnerId(),
      slug: `test-seam-overran-${seed}`,
      steps: [{ name: "fetch", label: STEPS.fetch.label, status: "pending" }],
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    await pgJobStore.enqueueOrGet(queued, { workKey: `seam-${queued.id}`, reservesName: false });
    return queued;
  }

  /**
   * **A job that is merely waiting its turn says nothing at all**, and that is
   * the sentence rule applied to a state that is not an ending.
   *
   * **Watched red on 2026-09-04**, against the pause as first written: the
   * filesystem store's `noteProgress` aliased the coordinator's own steps array
   * rather than copying it, so `runStep`'s failure narrative — `error`,
   * `[jb-gone]`, a `finishedAt` — was already on the record by the time the
   * pause read it, and `sweepStopped` only resets a step that says `running`.
   * A card waiting its turn drew a red step with an interruption on it.
   */
  it("says nothing about a job it has merely put down", async () => {
    const job = await anOverrunningJob("pa");
    const advanced = await overrun(job.id);

    expect(advanced?.done, "the job ended instead of being put down").toBe(false);
    expect(advanced?.job.status).toBe("queued");
    expect(advanced?.job.requeues).toBe(1);

    const step = advanced?.job.steps[0];
    expect(step?.status, "a job waiting its turn is showing a failed step").toBe("pending");
    expect(step?.error, "a job waiting its turn is carrying an ending's sentence").toBeUndefined();
    expect(advanced?.job.error).toBeUndefined();
    /* `jobWorthRetrying` reads `failureKind`, and a kind under a status that is
       not an ending is a Retry rule answering about a state it was not written
       for. */
    expect(advanced?.job.failureKind).toBeUndefined();

    /* And the same is true of what was actually persisted, not only of the
       answer this call happened to hand back. */
    const stored = await getJob(job.id);
    expect(stored?.steps[0]?.status).toBe("pending");
    expect(stored?.steps[0]?.error).toBeUndefined();
  });

  it("does not tell the reader they stopped something they did not", async () => {
    const job = await anOverrunningJob("ov");

    /* Through the windows the pause buys, so this is the *ending* — which is
       what this case has always been about. `REQUEUE_BUDGET` of them are
       hand-backs and the next one ends it. */
    for (let window = 0; window < REQUEUE_BUDGET; window++) {
      expect((await overrun(job.id))?.done, `window ${window + 1} ended the job early`).toBe(false);
    }
    const advanced = await overrun(job.id);
    expect(advanced?.done, "the job went round again past its budget").toBe(true);

    const step = advanced?.job.steps[0];
    expect(step?.status, "the step did not fail, so this proves nothing").toBe("error");
    expect(step?.error, "told the reader they stopped a job they never touched").not.toMatch(
      /\[jb-stopped\]|You stopped this/,
    );
    /* The two surfaces render different fields (see this file's header), and
       the whole finding was that they disagreed about who did this. */
    expect(step?.error).toMatch(/\[jb-gone\]$/);
    expect(advanced?.job.error).toMatch(/\[jb-gone\]$/);
    /* Retryable either way — what was wrong was the account of it, not the
       button. */
    expect(jobWorthRetrying(advanced?.job as Job)).toBe(true);
  });
});
