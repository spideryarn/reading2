/**
 * Which ingest failures are worth another go — src/job-failure.ts.
 *
 * The Retry button on a job card used to appear under every failure, including
 * the ones that are arithmetic. `TooLongForOnePass` cannot come out differently
 * on a second attempt, and neither can a missing source URL, a tree whose root
 * is not in its own node list, or a page Readability has already refused once
 * over bytes that are sitting in the cache. See
 * docs/postmortems/toc-max-tokens.md.
 *
 * **Most of these drive the real stage rather than a stand-in.** A classifier
 * that recognises a failure by a sentence somebody else's file writes is only
 * as good as its last reading of that file, so the tests that matter here throw
 * the failure for real and ask what it was called.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { partsOf } from "../src/arc.js";
import { JobCard } from "../src/web/AddArticle.js";
import { failureKindOf, jobWorthRetrying } from "../src/job-failure.js";
import { providerHttpFailure } from "../src/messages.js";
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
 * here and `docs/plans/chat-mode.md` records that — but `JobCard` is a plain
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
          name: "toc",
          label: "Building the table of contents",
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
    // the message says which. See docs/postmortems/toc-max-tokens.md.
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
    const err = await threw(() => STEPS.fetch.run(ctx("/nowhere"), fsArtifacts));
    expect((err as Error).message).toMatch(/No source URL/);
    expect(failureKindOf(err)).toBe("ours");
  });

  it("calls a tree whose root is missing `bug`", async () => {
    // Stage 5b over stage 4's stored tree. Retry skips the completed `toc`
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

      const err = await threw(() => STEPS.blocks.run(ctx(dir), store));
      expect((err as Error).message).toMatch(/no blocks at all/);
      expect(failureKindOf(err)).toBe("blocked");
      /* Both halves, because the kind is only half the feature: the card is
         what the reader sees, and a rule nothing consults changes nothing. */
      expect(jobWorthRetrying(failed(failureKindOf(err)))).toBe(false);
      expect(cardHtml(failed(failureKindOf(err)))).not.toContain("Retry");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("calls a page Readability will not parse `blocked`", async () => {
    // Stage 2 reads the bytes stage 1 already cached, and Retry never re-runs a
    // step that finished — so the second attempt hands Readability the very
    // same page. This one is recognised by its sentence rather than tagged
    // where it is thrown, which is exactly why this test runs the real
    // extractor: change that sentence in src/extract.ts and this goes red.
    const dir = await mkdtemp(path.join(tmpdir(), "spya-extract-"));
    try {
      /* **The manifest and the object, not `raw.html`.** Since 2026-08-31 stage
         1 leaves nothing in the article's directory: it puts the document in the
         content-addressed `sources` bucket and returns a manifest naming it by
         hash, and stage 2 reads the manifest from the store and the bytes by
         address (docs/plans/finish-the-database-move.md § Stage 2c). A fixture
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
        STEPS.extract.run(ctx(dir, { url: "https://example.com/a-piece" }), store),
      );
      expect((err as Error).message).toMatch(/Readability/);
      expect(failureKindOf(err)).toBe("blocked");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
