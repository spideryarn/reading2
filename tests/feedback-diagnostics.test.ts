/**
 * What the browser hands to `POST /api/feedback` when the reader ticks *Send
 * extra diagnostics* — and, more to the point, what it must never hand over.
 *
 * Two halves, and each has to be able to fail:
 *
 * 1. **The round trip.** The route rebuilds the blob from an allowlist and
 *    **drops anything malformed without saying so** (src/feedback-payload.ts).
 *    So a collector that spells a timestamp differently, or a path with a
 *    capital in it, does not error — the field simply is not in the report, and
 *    nobody finds out until somebody opens a report and wonders where the
 *    request ids went. That is docs/reusable/silent-success.md in one field, so
 *    the collector's output is run through `parseFeedbackDiagnostics` here and
 *    compared with itself.
 * 2. **No prose.** Every field our own code writes into is filled with an
 *    article's sentences, and the report is searched for them.
 *
 * See docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md
 * § the client log buffer and the diagnostics.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseFeedbackDiagnostics } from "../src/feedback-payload.js";
import { clearLogBuffer, recordLog, watchUncaughtErrors } from "../src/web/log-buffer.js";
import {
  clearFeedbackContext,
  setFeedbackArticleContext,
  setFeedbackJobContext,
} from "../src/web/feedback-context.js";
import { collectFeedbackDiagnostics } from "../src/web/feedback-diagnostics.js";

/**
 * The article, standing in for everything a report must not carry: a sentence
 * of somebody's reading, a search box, a provider's error body. Distinctive
 * enough that a substring search for it cannot pass by luck.
 */
const PROSE = "Nagel-the-bat-considered-as-an-unread-appendix";

/** Real ids, so the round trip has something that is supposed to survive. */
const ROOT_ID = "spya-k3m9qt";
const BLOCK_IDS = ["spya-k3m9qt", "spya-m7p2wd", "spya-n4r8xz"];
const REVISION_ID = "6f1c8a2e-9b4d-4f27-8c31-0a5e7d2b6194";

/** A browser that answers every question, in the shapes the server accepts. */
function stubBrowser(over: { matchMedia?: unknown; navigator?: unknown } = {}): void {
  vi.stubGlobal("window", {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2,
    matchMedia:
      "matchMedia" in over
        ? over.matchMedia
        : (query: string) => ({ matches: query.includes("dark") }),
  });
  vi.stubGlobal(
    "navigator",
    "navigator" in over
      ? over.navigator
      : {
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
          language: "en-GB",
          onLine: true,
        },
  );
}

beforeEach(() => {
  clearLogBuffer();
  clearFeedbackContext();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the round trip through the server's allowlist", () => {
  /**
   * Seed all five groups with values that are *supposed* to survive, and assert
   * the blob that arrives is the blob that left.
   *
   * `toEqual` on the whole object rather than field by field, deliberately: a
   * per-field list is a list somebody has to extend, and the field nobody
   * extended it for is the one that vanishes.
   */
  it("keeps every field the collector fills in", () => {
    stubBrowser();
    recordLog({
      kind: "api",
      outcome: "response",
      method: "GET",
      path: "/api/article/ants",
      status: 200,
      ms: 41,
      vercelId: "lhr1::abcde-1234567890-0123456789ab",
      bytes: 8_100,
      contentType: "application/json",
      error: null,
    });
    recordLog({
      kind: "api",
      outcome: "transport-failed",
      method: "POST",
      path: "/api/feedback",
      status: null,
      ms: 12_000,
      vercelId: null,
      bytes: null,
      contentType: null,
      error: "TypeError",
    });
    recordLog({ kind: "client-error", source: "window", name: "RangeError" });
    setFeedbackArticleContext({
      slug: "what-is-it-like-to-be-a-bat-k3m9qt",
      revisionId: REVISION_ID,
      view: "article",
      mode: "hierarchy",
      level: 2,
      blockCount: 412,
      rootBlockId: ROOT_ID,
      blockIds: BLOCK_IDS,
    });
    setFeedbackJobContext({ id: "spya-p9t4vw", step: "hierarchy", status: "running" });

    const collected = collectFeedbackDiagnostics();
    const parsed = parseFeedbackDiagnostics(collected);

    /* The interesting assertion. Anything the collector got into the wrong
       shape is missing from `parsed` and nowhere else, so this is the only
       check that can see it. */
    expect(parsed).toEqual(collected);

    /* And the blob is actually populated — `toEqual` on two empty shapes would
       pass just as happily, which is how a collector that collects nothing
       looks from here. */
    expect(parsed?.api).toHaveLength(2);
    expect(parsed?.errors).toHaveLength(1);
    expect(parsed?.article?.revisionId).toBe(REVISION_ID);
    expect(parsed?.article?.blockIds).toEqual(BLOCK_IDS);
    expect(parsed?.job).toEqual({ id: "spya-p9t4vw", step: "hierarchy", status: "running" });
    expect(parsed?.device?.userAgent).toContain("Safari");
    expect(parsed?.device?.colorScheme).toBe("dark");
  });

  /**
   * **And the check above can fail** — which is the whole reason it is worth
   * anything (docs/reusable/silent-success.md).
   *
   * One field is spelled wrong on purpose. Nothing raises, nothing is logged:
   * the timestamp is simply not in the report that comes back, while its
   * neighbour in the same object survives. That is exactly the failure mode a
   * mistake in the collector would have.
   */
  it("silently drops a timestamp in the wrong shape, and says nothing about it", () => {
    stubBrowser();
    recordLog({
      kind: "api",
      outcome: "response",
      method: "GET",
      path: "/api/article/ants",
      status: 200,
      ms: 41,
      vercelId: "lhr1::abcde-1234567890-0123456789ab",
      bytes: null,
      contentType: null,
      error: null,
    });

    const collected = collectFeedbackDiagnostics();
    expect(collected.api[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    /* `2026-08-31 12:00:00` rather than `2026-08-31T12:00:00.000Z` — the shape
       a `toLocaleString()` or a `Date.toString()` would have produced, which is
       the mistake this is standing in for. */
    const mangled = {
      ...collected,
      api: [{ ...collected.api[0], at: "2026-08-31 12:00:00" }],
    };
    const parsed = parseFeedbackDiagnostics(mangled);

    expect(parsed?.api[0]?.at).toBeNull();
    // The rest of the same call is untouched, so this really is one field.
    expect(parsed?.api[0]?.status).toBe(200);
    expect(parsed).not.toEqual(mangled);
  });

  /**
   * **The `x-vercel-id` must survive a path we cannot state.**
   *
   * `parseFeedbackDiagnostics` drops a whole call when its path will not
   * template — too many segments, too long, or the empty string `safePath()`
   * leaves behind for an address it could not parse. The status, the timing and
   * the Vercel request id go with it, and that id is the only thing in the app
   * that ties this browser to a line in a server log. The request odd enough to
   * lose its path is exactly the one worth correlating, so the collector sends
   * `/:x` — the server's own word for a segment it will not repeat — and the row
   * lives. Found by GPT Sol's audit of client-keeps/server-drops, 2026-09-01.
   */
  it("keeps a call whose path cannot be stated, because the Vercel id rides on it", () => {
    stubBrowser();
    recordLog({
      kind: "api",
      outcome: "response",
      method: "GET",
      /* Ten segments — two past the server's cap of eight. */
      path: "/a/b/c/d/e/f/g/h/i/j",
      status: 502,
      ms: 90,
      vercelId: "lhr1::abcde-1234567890-0123456789ab",
      bytes: null,
      contentType: null,
      error: null,
    });

    const parsed = parseFeedbackDiagnostics(collectFeedbackDiagnostics());
    expect(parsed?.api).toHaveLength(1);
    expect(parsed?.api[0]?.vercelId).toBe("lhr1::abcde-1234567890-0123456789ab");
    expect(parsed?.api[0]?.status).toBe(502);
    expect(parsed?.api[0]?.path).toBe("/:x");
  });
});

describe("what a report may never contain", () => {
  /**
   * **The article, in every field our own code writes into.**
   *
   * The fields deliberately left alone are the three the *browser* writes —
   * `userAgent`, `language`, `timezone`. No line of this app touches them, so
   * there is no path by which an article reaches one, and filling them with
   * prose here would be testing the stub rather than the collector. The server
   * holds all three to a shape on arrival, which is where a claim off the wire
   * belongs (src/feedback-payload.ts § USER_AGENT).
   *
   * Two mechanisms are under test at once and that is the point: the buffer
   * scrubs at write time, and the collector shape-checks the article context on
   * the way out. Both halves of the assertion were watched red — see the test
   * below, which pins the second.
   */
  it("carries no article prose, in the blob or in the filed report", () => {
    stubBrowser();
    recordLog({
      kind: "api",
      outcome: "error-body",
      method: "GET",
      // A query string, which is where reader-typed search text lives.
      path: `/api/library/search?q=${PROSE}&find=${PROSE}`,
      status: 500,
      ms: 90,
      vercelId: PROSE,
      bytes: null,
      contentType: PROSE,
      // `err.message` where `err.name` was meant — the one-word slip.
      error: `Failed to parse: ${PROSE}`,
    });
    recordLog({ kind: "client-error", source: "rejection", name: `${PROSE} is not a function` });
    setFeedbackArticleContext({
      slug: PROSE,
      revisionId: PROSE,
      view: PROSE as never,
      mode: PROSE as never,
      level: 1,
      blockCount: 2,
      rootBlockId: PROSE,
      blockIds: [PROSE, `spya-k3m9qt ${PROSE}`, ROOT_ID],
    });
    setFeedbackJobContext({ id: PROSE, step: PROSE as never, status: PROSE as never });

    const collected = collectFeedbackDiagnostics();
    expect(JSON.stringify(collected)).not.toContain(PROSE);

    /* And again on the thing that actually leaves the machine, because the two
       allowlists are meant to be independent: if only one of them held, this
       would still be green and the client half would have quietly stopped
       working. */
    expect(JSON.stringify(parseFeedbackDiagnostics(collected))).not.toContain(PROSE);

    // The one legitimate id in that list survived, so this is not passing by
    // dropping everything.
    expect(collected.article?.blockIds).toEqual([ROOT_ID]);
  });

  /**
   * The collector's own half of the allowlist, asked directly.
   *
   * The test above would go green if the server were doing all the work, so
   * this one looks at the collector's output alone, with a context nothing but
   * a shape check would refuse.
   */
  it("refuses a slug, a mode, a view and a block id that are not one", () => {
    stubBrowser();
    setFeedbackArticleContext({
      slug: "Not A Slug",
      revisionId: "not-a-uuid",
      view: "sideways" as never,
      mode: "upside-down" as never,
      level: Number.NaN,
      blockCount: Number.POSITIVE_INFINITY,
      rootBlockId: "spya-TOOLOUD",
      blockIds: ["spya-", "k3m9qt", ROOT_ID],
    });

    expect(collectFeedbackDiagnostics().article).toEqual({
      slug: null,
      revisionId: null,
      view: null,
      mode: null,
      level: null,
      blockCount: null,
      rootBlockId: null,
      blockIds: [ROOT_ID],
    });
  });
});

describe("a browser that will not answer", () => {
  /**
   * Nothing is stubbed at all — no `window`, no `matchMedia`.
   *
   * The collector runs inside a dialog the reader opened *because something was
   * already broken*, so a throw here loses the bug report. Every read is guarded
   * on its own, and the answer is `null` rather than an exception.
   */
  it("returns nulls rather than throwing when the globals are absent", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("navigator", undefined);

    const collected = collectFeedbackDiagnostics();
    expect(collected.device).toMatchObject({
      viewportW: null,
      viewportH: null,
      devicePixelRatio: null,
      userAgent: null,
      language: null,
      online: null,
      colorScheme: null,
      reducedMotion: null,
    });
    expect(collected.api).toEqual([]);
    expect(collected.article).toBeNull();
  });

  /** One hostile getter costs one field, not the other eight. */
  it("loses only the field that threw", () => {
    stubBrowser({
      navigator: {
        get userAgent(): string {
          throw new Error("blocked by a privacy extension");
        },
        language: "en-GB",
        onLine: true,
      },
    });

    const device = collectFeedbackDiagnostics().device;
    expect(device?.userAgent).toBeNull();
    expect(device?.language).toBe("en-GB");
    expect(device?.viewportW).toBe(1440);
    expect(device?.colorScheme).toBe("dark");
  });

  /** `matchMedia` missing is "we could not ask", which is not "no preference". */
  it("reports no colour scheme at all when matchMedia is not there", () => {
    stubBrowser({ matchMedia: undefined });
    const device = collectFeedbackDiagnostics().device;
    expect(device?.colorScheme).toBeNull();
    expect(device?.reducedMotion).toBeNull();
  });

  /** And "asked, and the answer was neither" is the third value. */
  it("reports no-preference when both queries answer false", () => {
    stubBrowser({ matchMedia: () => ({ matches: false }) });
    expect(collectFeedbackDiagnostics().device?.colorScheme).toBe("no-preference");
  });
});

describe("the caps", () => {
  /**
   * **The most recent entries, not the oldest.**
   *
   * The route keeps the *first* fifty of the array and the buffer hands them
   * over oldest-first, so a collector that sent all two hundred would file the
   * calls from ten minutes ago and throw away the seconds the reader is
   * actually complaining about. Nothing would look wrong: fifty calls would
   * arrive, with the right shape, from the wrong end of the buffer.
   */
  it("sends the newest fifty API calls, and the route keeps all fifty", () => {
    stubBrowser();
    for (let i = 0; i < 120; i++) {
      recordLog({
        kind: "api",
        outcome: "response",
        method: "GET",
        path: `/api/article/a${i}`,
        status: 200,
        ms: i,
        vercelId: null,
        bytes: null,
        contentType: null,
        error: null,
      });
    }

    const collected = collectFeedbackDiagnostics();
    expect(collected.api).toHaveLength(50);
    // 70…119 — the tail, in document order.
    expect(collected.api[0]?.ms).toBe(70);
    expect(collected.api.at(-1)?.ms).toBe(119);

    const parsed = parseFeedbackDiagnostics(collected);
    expect(parsed?.api).toHaveLength(50);
    expect(parsed?.api[0]?.ms).toBe(70);
  });

  /**
   * Cycled through real vocabulary names rather than `Error0`…`Error59`: names
   * are a closed list now (src/feedback-payload.ts § `safeDiagnosticName`), so
   * a made-up one is stored as `"Error"` and sixty identical rows could not
   * show which twenty survived — which is the only thing this test is for.
   */
  it("sends the newest twenty errors", () => {
    stubBrowser();
    const cycle = ["TypeError", "RangeError", "AbortError", "HttpError"] as const;
    for (let i = 0; i < 60; i++) {
      recordLog({ kind: "client-error", source: "boundary", name: cycle[i % cycle.length]! });
    }

    const collected = collectFeedbackDiagnostics();
    expect(collected.errors).toHaveLength(20);
    // 40…59, so the tail starts where 40 % 4 does.
    expect(collected.errors.map((e) => e.name)).toEqual(
      Array.from({ length: 20 }, (_, i) => cycle[(40 + i) % cycle.length]),
    );
    expect(parseFeedbackDiagnostics(collected)?.errors).toHaveLength(20);
  });

  it("sends at most two hundred block ids", () => {
    stubBrowser();
    setFeedbackArticleContext({
      slug: "bats-k3m9qt",
      revisionId: null,
      view: "article",
      mode: "plain",
      level: 0,
      blockCount: 900,
      rootBlockId: ROOT_ID,
      blockIds: Array.from({ length: 900 }, () => ROOT_ID),
    });

    const collected = collectFeedbackDiagnostics();
    expect(collected.article?.blockIds).toHaveLength(200);
    expect(parseFeedbackDiagnostics(collected)?.article?.blockIds).toHaveLength(200);
  });

  /** Uploads are in the buffer and are not part of this wire shape. */
  it("ignores the buffer's upload entries", () => {
    stubBrowser();
    recordLog({ kind: "upload", phase: "failed", status: 409, bytes: 2_400_000, ms: 8_100 });
    const collected = collectFeedbackDiagnostics();
    expect(collected.api).toEqual([]);
    expect(collected.errors).toEqual([]);
  });
});

describe("what the global error listeners put on the wire", () => {
  /**
   * **The round trip for the one door a reader's page can push values through.**
   *
   * `tests/log-buffer.test.ts` proves the buffer reduces a hostile `Error.name`
   * to `"Error"`. This proves the other half, which is the half that goes
   * silently wrong: that what the buffer *does* record still passes the
   * server's allowlist. A vocabulary the two ends disagreed about would drop
   * every error from every report and nothing would say so — the client would
   * send `errors`, the server would store `[]`, and the field would just not be
   * there (docs/reusable/silent-success.md).
   */
  it("survives the server's allowlist, hostile names reduced and real ones intact", () => {
    const handlers = new Map<string, (event: unknown) => void>();
    vi.stubGlobal("window", {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        handlers.set(type, fn);
      },
    });
    watchUncaughtErrors();

    const overwritten = new Error("nothing to see");
    overwritten.name = PROSE.replace(/-/g, "_");
    handlers.get("error")!({ error: new TypeError(PROSE) });
    handlers.get("error")!({ error: { name: "PROVIDER_BODY_MARKER" } });
    handlers.get("unhandledrejection")!({ reason: overwritten });
    handlers.get("unhandledrejection")!({ reason: new DOMException("aborted", "AbortError") });

    stubBrowser();
    const collected = collectFeedbackDiagnostics();
    const parsed = parseFeedbackDiagnostics(collected);

    /* Nothing was dropped between the two ends. `toEqual` on the whole array
       rather than on a length, so a name the server rewrote would show. */
    expect(parsed?.errors).toEqual(collected.errors);
    expect(collected.errors.map((e) => e.name)).toEqual([
      "TypeError",
      "Error",
      "Error",
      "AbortError",
    ]);
    expect(JSON.stringify(parsed)).not.toContain("Nagel");
    expect(JSON.stringify(parsed)).not.toContain("PROVIDER_BODY_MARKER");
  });
});
