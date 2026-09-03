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
 * And the persisted assertions are read back **off the file the queue wrote**,
 * not off `getJob` — see `persisted`.
 *
 * See docs/project/copy.md § The seam between the two audiences, and
 * docs/plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md § Stage 2.
 */
import path from "node:path";
import { rm } from "node:fs/promises";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { type AdvanceParts, advanceJobWith, cancelJob, enqueue, getJob } from "../src/jobs.js";
import { STEPS } from "../src/pipeline.js";
import { jobWorthRetrying, stageFailure } from "../src/job-failure.js";
import { ANSWER_OVERFLOWED_FIXED_ASK, MODEL_REFUSED, worthRetrying } from "../src/messages.js";
import { currentOwnerId } from "../src/owner.js";
import { fsArtifacts } from "../src/store/artifacts-fs.js";
import { fsJobStore } from "../src/store/jobs-fs.js";
import { PublishRefused } from "../src/store/pg-revisions.js";
import { fsStoreSession } from "../src/store/session.js";
import type { Job } from "../src/types.js";
import { jobFilesOnDisk } from "./helpers/job-files.js";

const ROOT_DATA = path.resolve(import.meta.dirname, "..", "data");

/**
 * One slug per case, and each is removed afterwards.
 *
 * `beginStep` makes `data/<slug>/steps/` before the stage runs, so a job that
 * fails on its first step still leaves a directory behind — which every suite
 * that reads the shelf then walks. tests/jobs.test.ts learned this the same way.
 */
const SLUGS = [
  "test-seam-cancelled",
  "test-seam-undeclared",
  "test-seam-declared-blocked",
  "test-seam-declared-retry",
  "test-seam-publish-refused",
];

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const { path: full, record } of await jobFilesOnDisk()) {
    if (record.slug !== undefined && SLUGS.includes(record.slug)) {
      await rm(full, { force: true });
    }
  }
  for (const slug of SLUGS) {
    await rm(path.join(ROOT_DATA, slug), { recursive: true, force: true });
  }
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
 * **The persisted pair, read back off the file the queue actually wrote.**
 *
 * `getJob` under the filesystem store hands back a `structuredClone` of the
 * in-memory index (src/store/jobs-fs.ts § `get`), so every assertion made
 * against it is an assertion about the object this process just built. A leak
 * that only appeared once the record was serialised — or a field lost on the
 * way to a column — would pass all of them. GPT Sol's point on the first
 * version of this file, and it is the same shape as the assertion it was
 * already making about the band and the card: check the thing that is really
 * read, not a copy that happens to agree.
 *
 * `jobFilesOnDisk` is the loader the queue's own `loadFromDisk` mirrors, so
 * this is a genuine JSON round trip.
 */
async function persisted(id: string): Promise<Partial<Job>> {
  const found = (await jobFilesOnDisk()).find((f) => f.record.id === id);
  if (!found) throw new Error(`no file on disk for job ${id}`);
  return found.record;
}

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
    expect(row.steps?.[0]?.error, "the raw message reached the persisted step.error").not.toContain(
      "src/quiz.ts",
    );
    expect(row.error, "the sentence did not survive being written down").toMatch(
      /\[jb-step-again\]$/,
    );
    expect(row.steps?.[0]?.error).toMatch(/\[jb-step-again\]$/);
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
 * reached through Postgres, so this stays a filesystem test: it is the
 * coordinator's handling of the throw that is under test, not the query that
 * produces it.
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
      id: `spya-seam${Math.random().toString(36).slice(2, 4)}`,
      ownerId: currentOwnerId(),
      slug,
      steps: [{ name: "fetch", label: STEPS.fetch.label, status: "pending" }],
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    await fsJobStore.enqueueOrGet(queued, { workKey: `seam-${queued.id}`, reservesName: false });

    const parts: AdvanceParts = {
      session: async () => {
        const real = fsStoreSession({ artifacts: fsArtifacts, jobs: fsJobStore });
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
      id: `spya-seamc${Math.random().toString(36).slice(2, 3)}`,
      ownerId: currentOwnerId(),
      slug,
      steps: [{ name: "fetch", label: STEPS.fetch.label, status: "pending" }],
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    await fsJobStore.enqueueOrGet(queued, { workKey: `seam-${queued.id}`, reservesName: false });

    vi.spyOn(STEPS.fetch, "run").mockImplementation(async () => {
      /* Stop arriving *inside* the step, which is the path that aborts the
         claimant's own controller — the between-steps path never reaches the
         catch at all (tests/jobs-walk.test.ts § a Stop between two steps). */
      await cancelJob(queued.id);
      throw stageFailure(MODEL_REFUSED, "the model answered with stop_reason: refusal");
    });

    const advanced = await advanceJobWith(queued.id, {
      session: async () => fsStoreSession({ artifacts: fsArtifacts, jobs: fsJobStore }),
      steps: STEPS,
    });

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
