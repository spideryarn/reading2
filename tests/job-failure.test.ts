/**
 * Which ingest failures are worth another go — src/job-failure.ts.
 *
 * The Retry button on a job card used to appear under every failure, including
 * the ones that are arithmetic. `TooLongForOnePass` cannot come out differently
 * on a second attempt, and neither can a missing source URL, a tree whose root
 * is not in its own node list, or a page Readability has already refused once
 * over bytes that are sitting in the cache. See
 * docs/postmortems/260826a-toc-max-tokens.md.
 *
 * **Most of these drive the real stage rather than a stand-in.** A classifier
 * that recognises a failure by a sentence somebody else's file writes is only
 * as good as its last reading of that file, so the tests that matter here throw
 * the failure for real and ask what it was called.
 */
import { describe, expect, it } from "vitest";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { partsOf } from "../src/arc.js";
import { JobCard } from "../src/web/AddArticle.js";
import {
  failureKindOf,
  jobWorthRetrying,
  readerFailureOf,
  stageFailure,
} from "../src/job-failure.js";
import {
  canRetry,
  MODEL_REFUSED,
  providerHttpFailure,
  stepGaveUp,
} from "../src/messages.js";
import { sanitise } from "../src/monitoring-scrub.js";
import { STEPS, type StepContext } from "../src/pipeline.js";
import { createFsArtifactStore, fsArtifacts } from "../src/store/artifacts-fs.js";
import { storeRawSource } from "../src/store/blobs.js";
import {
  budgetFor,
  MODEL_MAX_TOKENS,
  TooLongForOnePass,
  truncationFailure,
} from "../src/token-budget.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import type { Job, Tree } from "../src/types.js";

/** A finished, failed job carrying whatever kind we want to ask about. */
function failed(failureKind?: Job["failureKind"]): Job {
  return {
    id: "spya-testjb",
    slug: "a-slug",
    ownerId: DEV_OWNER_ID,
    steps: [],
    status: "error",
    createdAt: "2026-08-26T10:00:00.000Z",
    error: "something",
    ...(failureKind ? { failureKind } : {}),
  };
}

/**
 * The job card as HTML.
 *
 * A real render, not a scan of the source. There is no component test runner
 * here and `docs/plans/260826a-chat-mode.md` records that — but `JobCard` is a plain
 * function of its props, so `renderToStaticMarkup` needs neither a DOM nor a
 * JSX transform, and `createElement` keeps this file a `.ts` that
 * vitest.config.ts's `include` will actually pick up.
 *
 * The reason it has to be a render rather than a grep: the thing worth guarding
 * is that something *consults* `jobWorthRetrying`, and a test that reads the
 * file for a name is satisfied by a comment mentioning it.
 */
function cardHtml(job: Job): string {
  return renderToStaticMarkup(
    createElement(JobCard, { job, queue: {} as never, onHide: () => {} }),
  );
}

/** A step context pointing at a scratch directory instead of `data/<slug>`. */
function ctx(dir: string, over: Partial<StepContext> = {}): StepContext {
  return {
    slug: "a-slug",
    dir,
    htmlFile: path.join(dir, "a-slug.html"),
    report: () => {},
    signal: new AbortController().signal,
    cacheArticle: false,
    ...over,
  };
}

/** Run something that must throw, and hand back what it threw. */
async function threw(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("expected that to fail, and it did not");
}

describe("whether a failed job is worth retrying", () => {
  it("offers a retry when nothing said otherwise", () => {
    // Every job persisted before this field existed, plus the ones a restart
    // swept — those really are retryable, and they carry nothing.
    expect(jobWorthRetrying(failed())).toBe(true);
  });

  it("offers a retry for a transient failure", () => {
    expect(jobWorthRetrying(failed("retry"))).toBe(true);
  });

  it("withholds it for the three kinds a second attempt cannot change", () => {
    expect(jobWorthRetrying(failed("blocked"))).toBe(false);
    expect(jobWorthRetrying(failed("ours"))).toBe(false);
    expect(jobWorthRetrying(failed("bug"))).toBe(false);
  });
});

describe("what a failure says about itself", () => {
  it("says nothing about an ordinary error", () => {
    expect(failureKindOf(new Error("the disk is full"))).toBeUndefined();
    expect(failureKindOf(null)).toBeUndefined();
    expect(failureKindOf("a string")).toBeUndefined();
  });

  it("ignores a kind that is not one of the four", () => {
    // A field arriving off a JSON round-trip, or from a version of this that
    // knew a kind this one does not. Unrecognised must read as "no idea",
    // which offers the retry, rather than as a falsy lookup that hides it.
    const err = Object.assign(new Error("x"), { failureKind: "permanent" });
    expect(failureKindOf(err)).toBeUndefined();
  });

  it("reads the bracketed code off a model failure that carries one", () => {
    // These are the failures with nowhere else to put a kind — see
    // `kindOfMessage` in src/messages.ts. A job out of credit is `ours`.
    expect(failureKindOf(new Error(providerHttpFailure(402).message))).toBe("ours");
    expect(failureKindOf(new Error(providerHttpFailure(429).message))).toBe("retry");
  });
});

describe("the card the reader actually sees", () => {
  /* The rule being pure and correct is not the feature. Something has to ask
     it, and with the call deleted from JobCard every test above this line stays
     green — which is the failure these four exist to catch. */

  it("offers Retry under a failure that said nothing", () => {
    expect(cardHtml(failed())).toContain("Retry");
  });

  it("withholds Retry under a failure that cannot come out differently", () => {
    expect(cardHtml(failed("blocked"))).not.toContain("Retry");
  });

  it("still offers Retry on a job the reader stopped", () => {
    // You stopped it, which is not the same as not wanting it — and a cancel
    // never records a kind, so nothing withholds the button.
    const stopped: Job = { ...failed(), status: "cancelled" };
    expect(cardHtml(stopped)).toContain("Retry");
  });

  it("still shows the failed step's message when the button is gone", () => {
    // Nothing takes the button's place, so the sentence saying why has to
    // already be there. Hide the button *and* the explanation and the card says
    // only that something went wrong.
    const job: Job = {
      ...failed("blocked"),
      steps: [
        {
          name: "hierarchy",
          label: "Building the hierarchy",
          status: "error",
          error: "This article has to be processed in sections, which is not built yet.",
        },
      ],
    };
    const html = cardHtml(job);
    expect(html).not.toContain("Retry");
    expect(html).toContain("processed in sections");
  });
});

describe("the failures a retry cannot change", () => {
  it("calls an answer too long for one response `blocked`", () => {
    expect(failureKindOf(new TooLongForOnePass("table of contents", 200_000))).toBe("blocked");
  });

  it("calls it that when `budgetFor` is the thing that throws", async () => {
    // The real path: the estimate plus the reservation clears the ceiling and
    // the stage never makes a call at all.
    const err = await threw(() => budgetFor("table of contents", MODEL_MAX_TOKENS + 1));
    expect(failureKindOf(err)).toBe("blocked");
  });

  it("calls a truncated answer `bug`", () => {
    // Not arithmetic, unlike `TooLongForOnePass` — adaptive output varies, so
    // this is "unlikely to differ" rather than "cannot". It is `bug` because
    // the thing that needs changing is a constant in src/token-budget.ts, and
    // the message says which. See docs/postmortems/260826a-toc-max-tokens.md.
    const err = truncationFailure("table of contents", 77_100, 37_100, {
      outputTokens: 77_100,
      answerChars: 40_000,
    });
    expect(failureKindOf(err)).toBe("bug");
  });

  it("calls a missing source URL `ours`", async () => {
    // Retry copies the same absent URL, so it fails in the same place. The
    // article's meta.json has none and none was given: nothing about a second
    // attempt is different.
    const err = await threw(() => STEPS.fetch.run(ctx("/nowhere"), fsArtifacts, nullCheckpointStore()));
    expect((err as Error).message).toMatch(/No source URL/);
    expect(failureKindOf(err)).toBe("ours");
  });

  it("calls a tree whose root is missing `bug`", async () => {
    // Stage 5b over stage 4's stored tree. Retry skips the completed `hierarchy`
    // step, so it reads the identical tree.json and fails identically.
    const tree = { rootId: "spya-absent", nodes: {} } as unknown as Tree;
    const err = await threw(() => partsOf(tree));
    expect((err as Error).message).toMatch(/is not in nodes/);
    expect(failureKindOf(err)).toBe("bug");
  });

  /**
   * **The failure that convicted itself.** `NoBlocksProduced` (src/blocks.ts)
   * ends by telling the reader that re-running stage 3 over the same HTML will
   * produce nothing again — and until it was classified, the card underneath
   * that sentence offered a Retry, because an unrecognised failure offers one.
   * Retry skips `fetch` and `extract`, which both finished, so stage 3 gets the
   * identical prose-free HTML and fails in the identical place. GPT Sol,
   * 2026-08-29.
   *
   * The real stage, like the Readability one below and for a stronger reason:
   * this is where the classification physically is, so a landing that moves the
   * `runBlocks` call and drops the `catch` around it turns this red.
   */
  it("calls an extraction that produced no blocks `blocked`", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spya-blocks-"));
    try {
      const htmlFile = path.join(dir, "a-slug.html");
      /* Stage 2's output for a page that never gave up its prose: a
         JS-rendered shell, which is a shape a real fetch returns. */
      await writeFile(
        htmlFile,
        '<!doctype html><html><body>\n<div id="app"></div><script>window.__PAYWALL__ = true;</script>\n</body></html>',
      );
      /* A store over the scratch directory rather than `fsArtifacts`, which
         would send the baseline read at `data/a-slug/` in the real repo. */
      const store = createFsArtifactStore(() => ({ dir, htmlFile }));

      const err = await threw(() => STEPS.blocks.run(ctx(dir), store, nullCheckpointStore()));
      expect((err as Error).message).toMatch(/no blocks at all/);
      expect(failureKindOf(err)).toBe("blocked");
      /* Both halves, because the kind is only half the feature: the card is
         what the reader sees, and a rule nothing consults changes nothing. */
      expect(jobWorthRetrying(failed(failureKindOf(err)))).toBe(false);
      expect(cardHtml(failed(failureKindOf(err)))).not.toContain("Retry");
      /* **And the reader is told which way out there is.** The diagnostic above
         is four sentences about stages and block ids; what the reader needs out
         of it is that the page yielded no text and that the address it came
         from is the thing to look at. Until 2026-09-03 they got `stepGaveUp`'s
         generic `blocked` sentence and neither. */
      const reader = readerFailureOf(err, "Splitting it into blocks");
      expect(reader.message).not.toContain("[jb-step-no]");
      expect(reader.message).toMatch(/paywall/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * **The document behind the manifest is not there**, which is the third of
   * this file's real-stage classifications and the one whose sentence a reader
   * can actually act on: the fix is adding the article again, and nothing else
   * in the app can do it for them.
   *
   * A manifest naming an object that was never stored — `storedSha256` present,
   * nothing at that address — which is `RawDocumentUnavailable("missing")`, the
   * commonest of its three reasons (src/fetch.ts § `missingObjectAdvice`).
   */
  it("tells the reader a missing source document needs adding again", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spya-raw-gone-"));
    try {
      const htmlFile = path.join(dir, "a-slug.html");
      const store = createFsArtifactStore(() => ({ dir, htmlFile }));
      await writeFile(
        path.join(dir, "raw.json"),
        JSON.stringify({
          kind: "html",
          file: "raw.html",
          requestedUrl: "https://example.com/a-piece",
          url: "https://example.com/a-piece",
          contentType: "text/html",
          encoding: "utf-8",
          bytes: 12,
          /* A hash of nothing anybody stored, so the object is absent rather
             than corrupt. Sixty-four hex characters, which is what
             `canonicalKey` builds a name from. */
          sha256: "b".repeat(64),
          storedSha256: "b".repeat(64),
          storedBytes: 12,
          fetchedAt: new Date().toISOString(),
        }),
        "utf8",
      );
      const err = await threw(() =>
        STEPS.extract.run(
          ctx(dir, { url: "https://example.com/a-piece" }),
          store,
          nullCheckpointStore(),
        ),
      );
      expect(failureKindOf(err)).toBe("blocked");
      const reader = readerFailureOf(err, "Extracting the article");
      expect(reader.message).not.toContain("[jb-step-no]");
      /* The reader's move, and the one thing this failure knows. */
      expect(reader.message).toMatch(/again/i);
      /* And none of the diagnostic's own furniture: an object key, a file path,
         a plan reference. docs/project/copy.md § Who is reading this. */
      expect(reader.message).not.toMatch(/storedSha256|blobStore|SUPABASE|src\//);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * **And the reason next door, which wants the opposite sentence.**
   *
   * `missing` above and `corrupt` here were one message until GPT Sol's review
   * of the built stage 1: both said *adding the article again is what fixes it*,
   * which is true of an absent object and false of a damaged one. The object is
   * content-addressed, so a re-fetch computes the same name, finds something
   * already there and leaves the bad bytes untouched — `readRawBytes` and
   * `overlongObject` (src/fetch.ts) both say so in their own diagnostics, which
   * is what made the reader-facing half provably wrong rather than arguably.
   *
   * **An object longer than its manifest claims**, which is `overlongObject`'s
   * corruption: a prefix of a PDF parses far enough to look like an article, so
   * the bound is checked and exceeding it is corruption rather than a fault.
   * Cheaper to build than a hash mismatch and the same reason string.
   */
  it("tells the reader a damaged source document is not theirs to fix", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spya-raw-corrupt-"));
    try {
      const htmlFile = path.join(dir, "a-slug.html");
      const store = createFsArtifactStore(() => ({ dir, htmlFile }));
      const page = new TextEncoder().encode("<html><body><p>real bytes, wrongly described</p></body></html>");
      const put = await storeRawSource(page, "html");
      await writeFile(
        path.join(dir, "raw.json"),
        JSON.stringify({
          kind: "html",
          file: "raw.html",
          requestedUrl: "https://example.com/a-piece",
          url: "https://example.com/a-piece",
          contentType: "text/html",
          encoding: "utf-8",
          bytes: page.byteLength,
          sha256: put.sha256,
          storedSha256: put.sha256,
          /* Shorter than what is really under that name, so the read's bound
             throws and `overlongObject` classifies it `corrupt`. */
          storedBytes: 1,
          fetchedAt: new Date().toISOString(),
        }),
        "utf8",
      );
      const err = await threw(() =>
        STEPS.extract.run(
          ctx(dir, { url: "https://example.com/a-piece" }),
          store,
          nullCheckpointStore(),
        ),
      );
      /* `bug`, not `blocked`: all three non-retryable kinds withhold the button,
         and this is the one where the reader has no move at all. */
      expect(failureKindOf(err)).toBe("bug");
      const reader = readerFailureOf(err, "Extracting the article");
      expect(reader.message).toContain("[jb-source-damaged]");
      /* The whole of the split, and the assertion that would have gone red
         against the old shared sentence: it must not send them round the loop
         that cannot terminate. */
      expect(reader.message).toMatch(/will not replace it/i);
      expect(reader.message).not.toMatch(/storedSha256|blobStore|SUPABASE|src\//);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("calls a page Readability will not parse `blocked`", async () => {
    // Stage 2 reads the bytes stage 1 already cached, and Retry never re-runs a
    // step that finished — so the second attempt hands Readability the very
    // same page.
    //
    // **It is recognised by its type**, since 2026-09-03: `ReadabilityRefused`
    // (src/extract.ts), caught by `instanceof` in src/pipeline.ts. It used to be
    // matched on a prefix of its message, which is what stopped the sentence
    // being `{ authored }` — a prefix match is not proof that every character
    // came from us. This test still runs the real extractor, because what it is
    // now holding is that the real path throws that class at all.
    const dir = await mkdtemp(path.join(tmpdir(), "spya-extract-"));
    try {
      /* **The manifest and the object, not `raw.html`.** Since 2026-08-31 stage
         1 leaves nothing in the article's directory: it puts the document in the
         content-addressed `sources` bucket and returns a manifest naming it by
         hash, and stage 2 reads the manifest from the store and the bytes by
         address (docs/plans/260831b-finish-the-database-move.md § Stage 2c). A fixture
         that wrote `raw.html` would now fail before Readability ever saw the
         page — which is how this test found out, with the wrong sentence. */
      const htmlFile = path.join(dir, "a-slug.html");
      const store = createFsArtifactStore(() => ({ dir, htmlFile }));
      const page = new TextEncoder().encode("");
      const put = await storeRawSource(page, "html");
      await writeFile(
        path.join(dir, "raw.json"),
        JSON.stringify({
          kind: "html",
          file: "raw.html",
          requestedUrl: "https://example.com/a-piece",
          url: "https://example.com/a-piece",
          contentType: "text/html",
          encoding: "utf-8",
          bytes: page.byteLength,
          sha256: put.sha256,
          storedSha256: put.sha256,
          storedBytes: page.byteLength,
          fetchedAt: new Date().toISOString(),
        }),
        "utf8",
      );
      const err = await threw(() =>
        STEPS.extract.run(ctx(dir, { url: "https://example.com/a-piece" }), store, nullCheckpointStore()),
      );
      expect((err as Error).message).toMatch(/Readability/);
      expect(failureKindOf(err)).toBe("blocked");
      /* **And the reader is not shown that sentence**, which says "Readability"
         — a library they have never heard of. What they get instead is its own
         sentence, declared at the seam: until 2026-09-03 it was `stepGaveUp`'s
         generic `blocked` copy, which named the step and nothing else. */
      const reader = readerFailureOf(err, "Extracting the article");
      expect(reader.message).not.toMatch(/Readability/);
      expect(reader.message).not.toContain("[jb-step-no]");
      expect(reader.message).toMatch(/no article/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * **The seam itself**, one layer below tests/step-failure-seam.test.ts.
 *
 * That file drives a real job and asserts what is persisted. This one asks the
 * function directly, because two of its properties have no visible symptom when
 * they go wrong: the fallback being *total* over `FailureKind`, and a declared
 * sentence being shape-checked before it is published rather than trusted.
 *
 * src/job-failure.ts § Two strings, not one.
 */
describe("which sentence the reader gets", () => {
  const STEP = "Writing the questions";

  it("keeps the diagnostic off the reader's half and on the error", () => {
    const err = stageFailure(MODEL_REFUSED, "stop_reason=refusal, 41.2s, src/quiz.ts:530");
    /* The two really are two. A split that quietly assigned one string to both
       would satisfy every `not.toContain` written about the other. */
    expect((err as Error).message).toContain("stop_reason=refusal, 41.2s, src/quiz.ts:530");
    expect(readerFailureOf(err, STEP)).toEqual(MODEL_REFUSED);
    expect(readerFailureOf(err, STEP).message).not.toContain("src/quiz.ts");
  });

  /**
   * **The diagnostic does not buy its way past monitoring.**
   *
   * For six hours on 2026-09-03 `stageFailure` appended the reader sentence's
   * bracketed code to the diagnostic, so that `authored` in
   * src/monitoring-scrub.ts would forward it to Sentry. The reasoning was that
   * a code makes a message quotable. What a code actually does there is
   * *certify that we wrote every word*, and `sanitise` forwards a certified
   * message verbatim — so appending one let any text a step happened to put in
   * an exception buy that certificate. Which is the leak
   * `monitoring-scrub.ts` exists to stop, opened while closing a smaller one.
   * GPT Sol found it.
   *
   * So this drives the real `sanitise` rather than asserting on a string. A
   * test of `kindOfMessage` would have passed the whole time the hole was open;
   * only the function that makes the decision can say whether the decision is
   * right.
   */
  it("does not let a step's own words buy their way into Sentry", () => {
    const sentinel = "ARTICLE_SENTINEL: a sentence lifted out of the reader's article";
    const err = stageFailure(MODEL_REFUSED, sentinel);

    const scrubbed = sanitise(err);
    expect(scrubbed.withheld, "the diagnostic was forwarded to Sentry").toBe(true);
    expect(scrubbed.error.message).not.toContain("ARTICLE_SENTINEL");
    /* The event still arrives and still points at a line of code — which is
       what makes the withholding affordable. src/job-failure.ts § The log, and
       not Sentry. */
    expect(scrubbed.error.name).toBe(err.name);
    expect(scrubbed.error.stack).toBeTruthy();
  });

  it("still sends a message it really did author", () => {
    /* The positive control, and it is what makes the assertion above mean
       something: `withheld` is not simply always true. A declared failure with
       no separate diagnostic keeps its own coded sentence on `Error.message`,
       and that one is ours. */
    const scrubbed = sanitise(stageFailure(MODEL_REFUSED));
    expect(scrubbed.withheld).toBe(false);
    expect(scrubbed.error.message).toBe(MODEL_REFUSED.message);
  });

  /**
   * **The two forms of `detail` differ, and the difference is the whole point.**
   *
   * Identical text, one passed as free text and one claimed with `{ authored }`
   * — one is withheld and one travels. Asserted side by side and in one test
   * on purpose: the plain form looks redundant next to the authored one, and
   * the obvious tidy-up is to collapse them, which quietly hands every step's
   * free text the certificate again. That is the six-hour hole above, reopened
   * by somebody reading this file and finding it repetitive.
   *
   * `{ authored }` is a claim about provenance, not a formatting preference.
   * What earns it at the two real call sites is that every character is ours:
   * a fixed sentence, and a status the SDK handed over as a number. What must
   * never take it is an interpolation of anything from outside.
   */
  it("sends the same words when the throw site claims it wrote them", () => {
    const words = "the model answered with stop_reason: refusal";

    const free = sanitise(stageFailure(MODEL_REFUSED, words));
    expect(free.withheld, "free text reached Sentry").toBe(true);
    expect(free.error.message).not.toContain(words);

    const claimed = sanitise(stageFailure(MODEL_REFUSED, { authored: words }));
    expect(claimed.withheld, "an authored diagnostic was withheld").toBe(false);
    expect(claimed.error.message).toContain(words);
    /* And the code is on it, which is what `authored` reads and what
       tests/stop-details.test.ts pins on the log line to tell a refusal apart
       from a stage that never reached a model. */
    expect(claimed.error.message).toContain("[ai-model-refused]");
  });

  it("does not stamp a code on a diagnostic that carries one of its own", () => {
    /* The other half of the same mistake, and the reason this case is worth
       keeping rather than deleting with the append: a diagnostic ending in
       `[db-busy]` under a `blocked` reader failure would tell `kindOfMessage`
       *retry*. `failureKindOf` reads the field first, so nothing on screen
       turns on it — but the diagnostic must not be edited on its way to the
       log either way, and this pins that it is passed through untouched. */
    const err = stageFailure(MODEL_REFUSED, "went wrong [db-busy]");
    expect((err as Error).message).toBe("went wrong [db-busy]");
    expect(failureKindOf(err), "the field decides, not the borrowed code").toBe("blocked");
  });

  it("falls back to the reader's own sentence when there is no extra detail", () => {
    /* Safe, unlike falling back to an arbitrary `Error.message`: we wrote it. */
    expect(stageFailure(MODEL_REFUSED).message).toBe(MODEL_REFUSED.message);
  });

  it("gives an undeclared failure a generic sentence naming the step", () => {
    const err = new Error('wanted 2 "hard", got 1 — src/quiz.ts § bandQuota');
    const reader = readerFailureOf(err, STEP);
    expect(reader.message).toContain(STEP);
    expect(reader.message).not.toContain("src/quiz.ts");
    expect(reader.kind, "nobody said, so the retry stays offered").toBe("retry");
  });

  it("uses the kind the throw site declared, even with no sentence", () => {
    /* `stageFailure(kind, { generic })` is the kind-only form and most of the
       pipeline uses it: no reader sentence, but a real claim about retrying.
       The generic copy has to follow that claim rather than default to retry,
       or a reader is told to try again under a failure stored as `ours`. */
    const err = stageFailure("ours", { generic: 'No source URL for "a-slug".' });
    const reader = readerFailureOf(err, STEP);
    expect(reader.kind).toBe("ours");
    expect(canRetry(reader.kind)).toBe(false);
    expect(reader.message).not.toContain("a-slug");
  });

  it("puts a `{ generic }` diagnostic on the log side and the generic copy on the reader's", () => {
    /* Both halves of what the marker claims, in one test. The diagnostic is on
       `Error.message`, which is where the log reads it and where it stops; the
       reader gets `stepGaveUp`'s copy for the kind, with none of the
       diagnostic's arithmetic or file references in it. */
    const err = stageFailure("blocked", { generic: "142 pages, limit 100 — src/pdf-read.ts" });
    expect(err.message).toBe("142 pages, limit 100 — src/pdf-read.ts");
    const reader = readerFailureOf(err, STEP);
    expect(reader).toEqual(stepGaveUp("blocked", STEP));
    expect(reader.message).not.toContain("142");
    expect(reader.message).not.toContain("src/pdf-read.ts");
  });

  /**
   * **The test for the bug that was actually reported**, and it is a compile
   * error rather than an assertion, because the bug was a *shape* nobody could
   * see was wrong: `stageFailure(kind, detail)` read exactly like
   * `stageFailure(failure, detail)`, so eight throw sites wrote a sentence for
   * a reader and passed it to the form that keeps only the kind. One of them
   * was the 142-page PDF this file's plan is named after.
   *
   * **`npm run typecheck`, not `npm test`, is what checks this.** An
   * `@ts-expect-error` over a line that has stopped being an error is itself an
   * error, so if the bare-string overload is ever restored this goes red with:
   *
   *     tests/job-failure.test.ts(NNN,5): error TS2578: Unused '@ts-expect-error' directive.
   *
   * Seen, by temporarily putting the deleted overload back — 2026-09-04.
   *
   * The body runs as well, and pins what happens if somebody writes it anyway
   * from untyped JavaScript: **the runtime is unchanged** — the string is still
   * the diagnostic, and it still does not reach the reader. That is the seam
   * holding, and it is why refusing the spelling took nothing away from the
   * log.
   */
  it("refuses a bare diagnostic where a reader's sentence could have gone", () => {
    // @ts-expect-error a kind-only failure must mark its diagnostic `{ generic }` — the bare string is the form that swallowed eight reader sentences.
    const err = stageFailure("blocked", "This PDF has 142 pages and the limit is 100.");
    expect(err.message, "the log keeps it, as it always did").toContain("142");
    expect(readerFailureOf(err, STEP).message).not.toContain("142");
  });

  it("has its own sentence for each of the four kinds", () => {
    /* The fallback is a total map over `FailureKind`, so a fifth kind is a type
       error at `STEP_GAVE_UP` in src/messages.ts rather than a silent
       fall-through. What this asserts is the part the types cannot: that all
       four actually say something, and four different things. */
    const said = (["retry", "ours", "bug", "blocked"] as const).map(
      (kind) => readerFailureOf(stageFailure(kind, { generic: "detail" }), STEP).message,
    );
    expect(new Set(said).size).toBe(4);
    for (const message of said) expect(message).toContain(STEP);
  });

  it("does not publish a malformed declaration", () => {
    /* `readerFailure` is read off a thrown value, so it is outside the type
       system in the way `KNOWN_KINDS` above describes. Trusting a half-built
       one would put `undefined` on a reader's screen. */
    for (const bad of [
      { kind: "retry" },
      { kind: "retry", message: "" },
      { kind: "sideways", message: "Something." },
      "not an object",
    ]) {
      const err = Object.assign(new Error("raw diagnostic"), { readerFailure: bad });
      const reader = readerFailureOf(err, STEP);
      expect(reader.message, JSON.stringify(bad)).toContain(STEP);
      expect(reader.message).not.toContain("raw diagnostic");
    }
  });
});
