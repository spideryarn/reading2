/**
 * The second place a publication failure can put article prose in a log.
 *
 * GPT Sol's critical 1 named two statements, not one
 * (docs/plans/260830ad-v1-publish-finalizer-review-sol.md). The first is the `reason`
 * `failRevision` logs verbatim, and it is covered end-to-end, against a real
 * database and a real driver error, by *keeps publication and the job's finish
 * in one transaction* in tests/jobs-publish-finalizer.test.ts.
 *
 * **The second is the compensating cleanup failing.** When `failRevision` itself
 * throws, `src/store/publish-session.ts` logs that — and `failRevision` is not
 * wrapped in `guardDbStore`, so what arrives is a raw driver error with the
 * failed statement's bound parameters in its message. `errorFields(err)` would
 * hand that straight to pino, whose `safeError` keeps `message` on purpose
 * (src/log.ts). One line, `nameOf(cleanup)` instead, is the whole fix.
 *
 * That branch needs `failRevision` to fail *with something sensitive in it*, and
 * nothing a fixture can do to a real database produces that: the errors
 * `failRevisionIn` actually raises quote a slug and a revision id, neither of
 * which is prose, so a test built on one could never go red. So this file makes
 * the two failures instead of finding them.
 *
 * ## What is real here and what is not
 *
 * **Real:** `publishingSession` itself, every branch it takes, `guardDbStore`
 * around it, `copyArtefacts`, and the logger — including its `err` serialiser,
 * which is the thing that would do the leaking.
 *
 * **Fake:** the database (`getDb().transaction` runs its callback and nothing
 * else), the three `pg-revisions` calls this path makes, the inner session, and
 * the artefact store the copy reads from. None of them is under test, and faking
 * them is what makes this file hermetic — it needs no Postgres, so it cannot
 * skip itself into a green run (docs/reusable/silent-success.md, and
 * tests/helpers/pg-ready.ts for the suites that do).
 *
 * ## The mutation that reddened it, watched on 2026-08-30
 *
 * `errorFields(cleanup)` in place of `{ errorType: nameOf(cleanup) }` — the code
 * as it stood before Sol's review. Fails on `not.toContain(CLEANUP_SENTINEL)`:
 * the whole `Failed query: … params: …` message lands in the line. The reading
 * is in the report.
 */
import { describe, expect, it, vi } from "vitest";

/**
 * The log level, before any import. `level()` in src/log.ts reads `LOG_LEVEL`
 * once, at that module's load, and vitest's `NODE_ENV=test` otherwise makes the
 * logger `silent` — which writes nothing, which satisfies every `not.toContain`
 * below. Same reasoning, and the same shape, as
 * tests/jobs-publish-finalizer.test.ts.
 */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  if (previousLevel === undefined || ["silent", "fatal", "error"].includes(previousLevel)) {
    process.env.LOG_LEVEL = "warn";
  }
  return { previousLevel };
});

/**
 * Two strings that must never reach a log line.
 *
 * They stand where a driver error's bound parameters would: a step's `detail`,
 * which may be article prose, and the job's title, which is the article's.
 */
const PUBLISH_SENTINEL = "PROSE-IN-THE-PUBLICATION-ERROR";
const CLEANUP_SENTINEL = "PROSE-IN-THE-CLEANUP-ERROR";

/** The draft `openOrBeginJobDraft` is made to return. */
const DRAFT = {
  articleId: "00000000-0000-4000-8000-0000000000f2",
  revisionId: "00000000-0000-4000-8000-0000000000f3",
};

/**
 * A database that is only a transaction runner.
 *
 * The publication never reaches a statement — `copyArtefacts` throws on its
 * first read — so a real connection would add a dependency and prove nothing.
 */
vi.mock("../src/db/client.js", () => ({
  getDb: () => ({
    transaction: async (body: (tx: unknown) => Promise<unknown>) => await body({}),
  }),
}));

/**
 * Three calls replaced and the rest left alone — `importOriginal`, so that
 * `PublishRefused` and `NotTheLiveAttempt` stay the real classes the wrapper
 * does `instanceof` against. Mocking those out is how this kind of test quietly
 * stops exercising the branch it names.
 */
vi.mock("../src/store/pg-revisions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/store/pg-revisions.js")>();
  return {
    ...actual,
    openOrBeginJobDraft: async () => DRAFT,
    /* Answers with the draft's own article, so the identity check passes and the
       copy — the thing that is going to fail — is actually reached. */
    lockOrCreateArticle: async () => ({ id: DRAFT.articleId }),
    /* The compensating cleanup, failing the way an unguarded driver call does. */
    failRevision: async () => {
      throw driverError(CLEANUP_SENTINEL);
    },
  };
});

import { errorFields, log } from "../src/log.js";
import { publishingSession } from "../src/store/publish-session.js";
import type { ArtifactStore } from "../src/store/artifacts.js";
import type { StoreSession } from "../src/store/session.js";
import { logLinesWhile } from "./helpers/log-capture.js";

if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
else process.env.LOG_LEVEL = HOISTED.previousLevel;

/**
 * What Drizzle throws, in the shape that matters: a message built from the
 * failed statement and **its bound parameters**.
 *
 * Declared as a `function` rather than a `const` on purpose — `vi.mock` factories
 * are hoisted above every statement in the file, so an arrow assigned to a
 * `const` would not exist yet when the factory closed over it.
 */
function driverError(sentinel: string): Error {
  const err = new Error(
    `Failed query: update spideryarn.jobs set status = $1, steps = $2, title = $3 ` +
      `params: done,[{"name":"hierarchy","detail":"${sentinel}"}],${sentinel}`,
  );
  err.name = "DrizzleQueryError";
  return err;
}

describe("a publication whose compensating cleanup also fails", () => {
  it("logs the class of both errors and the message of neither", async () => {
    const job = { id: "spya-cleanup1", attemptId: "attempt-1" };
    const settled: unknown[] = [];

    const inner = {
      reads: {},
      beginStep: async () => "never",
      commit: async () => {
        throw new Error("the commit door is not the one under test");
      },
      settleJob: async (transition: unknown) => {
        settled.push(transition);
        return { kind: "ended" };
      },
    } as unknown as StoreSession;

    /* The source the copy reads, failing on its first read the way a database
       under load does. This is what makes the publication fail *after* the draft
       is open, which is the only position that reaches the cleanup at all. */
    const from = {
      read: async () => {
        throw driverError(PUBLISH_SENTINEL);
      },
      stampFor: async () => null,
    } as unknown as ArtifactStore;

    const session = publishingSession(inner, { job, slug: "cleanup-fixture", from });

    const logged = await logLinesWhile(async () => {
      await expect(
        session.settleJob({
          kind: "end",
          jobId: job.id,
          attempt: job.attemptId,
          ending: { status: "done", steps: [] },
        }),
      ).rejects.toThrow();
    });

    /* The wrapper did settle the job rather than let the failure escape with the
       row still `running` — Sol's High finding, from the unit side. */
    expect(settled).toHaveLength(1);

    /**
     * **First, that the line under test was written at all.**
     *
     * Every way this capture can be wrong — the level left at `silent`, a
     * cleanup that never failed, a branch that was skipped because an
     * `instanceof` matched — produces an empty capture, and an empty capture
     * passes all three absences below. See tests/helpers/log-capture.ts.
     */
    expect(logged).toContain("could not fail the draft of a publication that rolled back");

    /* And neither message is in it: not the cleanup's, which is the statement
       Sol named second, and not the publication's, which `guardDbStore` and the
       wrapper's own `plog.error` both see on the way out. */
    expect(logged).not.toContain(CLEANUP_SENTINEL);
    expect(logged).not.toContain(PUBLISH_SENTINEL);
    expect(logged).not.toMatch(/Failed query|params:/);

    /* The class is kept, because a log line that says only "something failed" is
       the other way to get this wrong. */
    expect(logged).toContain("DrizzleQueryError");
  });

  /**
   * The control for the assertions above: `errorFields` really does carry a
   * message into the line, so `not.toContain` is checking something a plausible
   * mistake would break — it is not passing because pino drops messages anyway.
   *
   * This is the mutation of `publish-session.ts` written down as a test instead
   * of applied by hand, so it goes on being true after the next edit.
   */
  it("would have leaked, had the log line kept the error rather than its class", async () => {
    const logged = await logLinesWhile(async () => {
      log("store").error(errorFields(driverError(CLEANUP_SENTINEL)), "the control line");
    });
    expect(logged).toContain("the control line");
    expect(logged).toContain(CLEANUP_SENTINEL);
  });
});
