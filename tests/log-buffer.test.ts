/**
 * The client log buffer — what it keeps, what it refuses to keep, and what
 * comes out the other end.
 *
 * This is the file that has to be red first. The buffer's whole value is that
 * a reader can tick a box and hand us the run-up to their bug; its whole risk
 * is that the same box hands us their article, their search terms or their
 * bearer token. Every assertion below is one of those two halves, and a test
 * that has never failed proves neither — docs/reusable/silent-success.md.
 *
 * See docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md
 * § The client log buffer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOG_BUFFER_CAPACITY,
  LOG_MAX_CHARS,
  clearLogBuffer,
  readLogBuffer,
  recordLog,
  serialiseLogBuffer,
  watchUncaughtErrors,
} from "../src/web/log-buffer.js";

/**
 * Distinctive enough that a substring search for it cannot pass by luck.
 * Stands in for everything the buffer must never end up holding: an article's
 * sentences, a reader's search box, a provider's error body.
 */
const PROSE = "Nagel-the-bat-considered-as-an-unread-appendix";

beforeEach(() => {
  clearLogBuffer();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the buffer keeps", () => {
  it("round-trips all three variants of the union", () => {
    recordLog({
      kind: "api",
      outcome: "response",
      method: "GET",
      path: "/api/article/ants",
      status: 200,
      ms: 41,
      vercelId: "lhr1::abc-123",
      bytes: null,
      contentType: null,
      error: null,
    });
    recordLog({
      kind: "upload",
      phase: "failed",
      status: 409,
      bytes: 2_400_000,
      ms: 8_100,
    });
    recordLog({ kind: "client-error", source: "boundary", name: "TypeError" });

    const entries = readLogBuffer();
    expect(entries.map((e) => e.kind)).toEqual(["api", "upload", "client-error"]);

    const [api, upload, failure] = entries;
    expect(api).toMatchObject({
      kind: "api",
      outcome: "response",
      method: "GET",
      path: "/api/article/ants",
      status: 200,
      ms: 41,
      vercelId: "lhr1::abc-123",
    });
    expect(upload).toMatchObject({ kind: "upload", phase: "failed", status: 409 });
    expect(failure).toMatchObject({ kind: "client-error", source: "boundary", name: "TypeError" });

    /* Every entry is stamped, by the buffer rather than by the caller — a
       timeline whose ordering depends on thirty call sites remembering to pass
       a clock is a timeline that will be wrong somewhere. */
    for (const entry of entries) expect(typeof entry.at).toBe("number");
  });

  /**
   * Counted on `bytes` rather than on a name, because a name is a closed
   * vocabulary now and two hundred distinguishable names do not exist. A
   * number field is the right thing to count a ring with anyway.
   */
  it("keeps the newest, oldest-first, and never grows past its capacity", () => {
    for (let i = 0; i < LOG_BUFFER_CAPACITY + 37; i++) {
      recordLog({ kind: "upload", phase: "done", status: 200, bytes: i, ms: null });
    }

    const entries = readLogBuffer();
    expect(entries).toHaveLength(LOG_BUFFER_CAPACITY);

    const sizes = entries.map((e) => (e.kind === "upload" ? e.bytes : null));
    expect(sizes[0]).toBe(37);
    expect(sizes.at(-1)).toBe(LOG_BUFFER_CAPACITY + 36);
  });
});

describe("what the buffer refuses to keep", () => {
  /**
   * The one that was missed twice in planning, and the reason it is stated
   * twice in the plan: `apiFetch("/api/library/search?q=…")` carries text the
   * reader typed, and `?find=` carries more of it. Stripping at the call site
   * is stripping thirty times and forgetting once.
   */
  it("strips the query string and the fragment from a recorded path", () => {
    recordLog({
      kind: "api",
      outcome: "response",
      method: "GET",
      path: `/api/library/search?q=${encodeURIComponent(PROSE)}&find=${PROSE}#${PROSE}`,
      status: 200,
      ms: 12,
      vercelId: null,
      bytes: null,
      contentType: null,
      error: null,
    });

    const entry = readLogBuffer()[0];
    expect(entry?.kind).toBe("api");
    expect(entry && entry.kind === "api" ? entry.path : "").toBe("/api/library/search");
    expect(serialiseLogBuffer()).not.toContain("Nagel");
  });

  /** An absolute URL reduces to its path. Nothing of the origin, nothing after it. */
  it("reduces an absolute response URL to its path alone", () => {
    recordLog({
      kind: "api",
      outcome: "not-json",
      method: null,
      path: `https://www.spideryarn.com/api/search/ants?q=${PROSE}`,
      status: 500,
      ms: null,
      vercelId: null,
      bytes: 4213,
      contentType: "text/html",
      error: null,
    });

    const entry = readLogBuffer()[0];
    expect(entry && entry.kind === "api" ? entry.path : "").toBe("/api/search/ants");
  });

  /**
   * The redundant second mechanism. The field types are closed, so nothing in
   * the union is called `token` today — this is the tripwire for the day
   * somebody adds one, and it fires before the value is ever resident.
   */
  it("redacts a value whose key name is on the denylist", () => {
    const hostile = {
      kind: "client-error",
      source: "boundary",
      name: "TypeError",
      // Not part of `LogInput`; that is the point of the test.
      token: `Bearer ${PROSE}`,
      sessionId: PROSE,
      apiKey: PROSE,
    } as unknown as Parameters<typeof recordLog>[0];

    recordLog(hostile);

    const blob = serialiseLogBuffer();
    expect(blob).not.toContain("Nagel");
    expect(blob).toContain("[redacted]");
  });

  /**
   * On `contentType`, which is the longest-lived plain string left in the
   * union: `name` and `error` no longer reach `truncate` at all, because a
   * closed vocabulary has already replaced anything long with `"Error"`.
   */
  it("truncates a long string at write time, not on the way out", () => {
    recordLog({
      kind: "api",
      outcome: "not-json",
      method: "GET",
      path: "/api/library",
      status: 200,
      ms: null,
      vercelId: null,
      bytes: null,
      contentType: "x".repeat(5_000),
      error: null,
    });

    const entry = readLogBuffer()[0];
    const type = entry && entry.kind === "api" ? (entry.contentType ?? "") : "";
    // Resident already short: the value never sat in memory at full length.
    expect(type.length).toBeLessThanOrEqual(LOG_MAX_CHARS + 1);
    expect(type.endsWith("…")).toBe(true);
  });

  /**
   * `error` and `name` are where a call site could pass `err.message` when it
   * meant `err.name`, and that one-word slip is how an `Error.message` here has
   * four times turned out to contain the article. Checked in the buffer, not
   * trusted at the seam.
   */
  it("keeps an error's name and drops anything sentence-shaped in its place", () => {
    recordLog({ kind: "client-error", source: "boundary", name: "AbortError" });
    recordLog({ kind: "client-error", source: "tweets", name: `Failed to fetch: ${PROSE}` });

    const names = readLogBuffer().map((e) => (e.kind === "client-error" ? e.name : ""));
    expect(names).toEqual(["AbortError", "Error"]);
  });

  /**
   * A fixture with prose in every field prose could arrive through. If any of
   * them survives to the blob, the tick-box is a leak.
   */
  it("produces a blob with none of the prose it was fed", () => {
    recordLog({
      kind: "api",
      outcome: "error-body",
      method: "POST",
      path: `/api/chat/ants?question=${PROSE}&find=${PROSE}`,
      status: 500,
      ms: 3_100,
      vercelId: "lhr1::iad1-abc-123",
      bytes: PROSE.length,
      contentType: "application/json",
      error: `TypeError: ${PROSE}`,
    });
    recordLog({ kind: "upload", phase: "failed", status: 400, bytes: 12, ms: 3 });
    recordLog({ kind: "client-error", source: "tweets", name: PROSE });

    const blob = serialiseLogBuffer();
    expect(blob).not.toContain("Nagel");
    expect(blob).not.toContain("question=");
    // And what is left is still worth having.
    expect(blob).toContain("/api/chat/ants");
    expect(blob).toContain("lhr1::iad1-abc-123");
  });
});

describe("when the serialising happens", () => {
  it("does not serialise anything until it is asked for", () => {
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      for (let i = 0; i < 20; i++) {
        recordLog({ kind: "upload", phase: "done", status: 200, bytes: i, ms: null });
      }
      expect(stringify).not.toHaveBeenCalled();

      const blob = serialiseLogBuffer();
      expect(stringify).toHaveBeenCalledTimes(1);
      expect(blob).toContain('"bytes":19');
    } finally {
      stringify.mockRestore();
    }
  });

  it("never throws out of the serialiser", () => {
    const stringify = vi.spyOn(JSON, "stringify").mockImplementation(() => {
      throw new TypeError("Converting circular structure to JSON");
    });
    try {
      recordLog({ kind: "client-error", source: "boundary", name: "TypeError" });
      expect(() => serialiseLogBuffer()).not.toThrow();
    } finally {
      stringify.mockRestore();
    }
  });
});

/**
 * **The two global listeners, which nothing exercised until GPT Sol said so.**
 *
 * `watchUncaughtErrors` is the one door into the buffer that a *reader's* page
 * can push arbitrary values through: `event.error` is whatever was thrown, and
 * `Error.name` is a writable string, so `{ name: "PROVIDER_BODY_MARKER" }` and
 * `err.name = "reader_search_term"` are both things a throw can carry. Sol's
 * second review, 2026-08-31, listed six cases and observed that none of them
 * had a test. These are those six, plus the control that stops the whole
 * describe passing because the vocabulary rejects everything.
 *
 * A fake `window` rather than jsdom: the two listeners are the entire surface,
 * and holding them by hand means the test can throw a getter at them.
 */
function watch(): { fire: (type: "error" | "unhandledrejection", event: unknown) => void } {
  const handlers = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      handlers.set(type, fn);
    },
  });
  watchUncaughtErrors();
  /* Both listeners exist, checked here rather than assumed: a `fire` for a
     listener that was never registered would silently do nothing, and every
     assertion below would then be about an empty buffer. */
  expect([...handlers.keys()].sort()).toEqual(["error", "unhandledrejection"]);
  return {
    fire: (type, event) => {
      handlers.get(type)!(event);
    },
  };
}

/** The names recorded, in order. */
function recordedNames(): string[] {
  return readLogBuffer().map((e) => (e.kind === "client-error" ? e.name : ""));
}

describe("what an uncaught throw is recorded as", () => {
  /** The control. Without it, a vocabulary that rejected everything would pass. */
  it("records a genuine built-in by its real name, from both listeners", () => {
    const { fire } = watch();
    fire("error", { error: new TypeError("Cannot read properties of null") });
    fire("unhandledrejection", { reason: new RangeError("Maximum call stack size exceeded") });

    expect(readLogBuffer().map((e) => (e.kind === "client-error" ? e.source : ""))).toEqual([
      "window",
      "rejection",
    ]);
    expect(recordedNames()).toEqual(["TypeError", "RangeError"]);
    // The browser's own words are not in there — only the name ever was.
    expect(serialiseLogBuffer()).not.toContain("Cannot read");
  });

  /** One of ours, so the authored half of the vocabulary is load-bearing too. */
  it("records an error class this app wrote", () => {
    const { fire } = watch();
    const authored = new Error("504 from /api/chat");
    authored.name = "HttpError";
    fire("error", { error: authored });

    expect(recordedNames()).toEqual(["HttpError"]);
  });

  /**
   * **Sol's first example.** A thrown object literal with a `name` that is a
   * perfectly good identifier and is not a name at all. A shape check passes
   * this; a list does not.
   */
  it("reduces a thrown object whose name is a marker rather than a name", () => {
    const { fire } = watch();
    fire("error", { error: { name: "PROVIDER_BODY_MARKER" } });

    expect(recordedNames()).toEqual(["Error"]);
    expect(serialiseLogBuffer()).not.toContain("PROVIDER_BODY_MARKER");
  });

  /**
   * **Sol's second.** `Error.name` is writable, so a real `Error` can carry a
   * reader's search term in the one field this buffer keeps.
   */
  it("reduces a real Error whose name has been overwritten", () => {
    const { fire } = watch();
    const err = new Error("nothing to see");
    err.name = "reader_search_term";
    fire("unhandledrejection", { reason: err });

    expect(recordedNames()).toEqual(["Error"]);
    expect(serialiseLogBuffer()).not.toContain("reader_search_term");
  });

  /** A cross-origin script failure. The event arrives with nothing in it. */
  it("records a null error as Error rather than dropping the row", () => {
    const { fire } = watch();
    fire("error", { error: null });

    expect(recordedNames()).toEqual(["Error"]);
  });

  /** A `name` getter that throws. There is nothing to learn from it, and no throw out. */
  it("survives a name getter that throws", () => {
    const { fire } = watch();
    const hostile = {
      get name(): string {
        throw new Error(PROSE);
      },
    };
    expect(() => fire("error", { error: hostile })).not.toThrow();

    expect(recordedNames()).toEqual(["Error"]);
    expect(serialiseLogBuffer()).not.toContain("Nagel");
  });

  /** `throw "…"` and `throw 7`. Neither is an object, so neither has a name. */
  it("records a thrown primitive as Error, and none of the string", () => {
    const { fire } = watch();
    fire("error", { error: `TypeError: ${PROSE}` });
    fire("unhandledrejection", { reason: 7 });

    expect(recordedNames()).toEqual(["Error", "Error"]);
    expect(serialiseLogBuffer()).not.toContain("Nagel");
  });

  /** Nothing at all where the event should be. The listener must not be the bug. */
  it("does not throw when the event itself is not what it should be", () => {
    const { fire } = watch();
    expect(() => fire("error", {})).not.toThrow();
    expect(() => fire("unhandledrejection", { reason: undefined })).not.toThrow();

    expect(recordedNames()).toEqual(["Error", "Error"]);
  });
});

describe("the one value that came off a response header", () => {
  /**
   * `x-vercel-id` is the only thing in the buffer that `apiFetch` did not
   * write itself, and rule 1 of this file is *redact at write time, not at send
   * time*. The collector and the route check it too; those are redundancy. What
   * this asserts is that the raw header value is never **resident** — Sol's
   * finding 6, and the reason `serialiseLogBuffer` cannot expose it.
   */
  it("keeps a real request id and stores nothing at all for a bogus one", () => {
    const bogus = ["not a vercel id", `lhr1::${PROSE} and more`, PROSE, "lhr1:no-double-colon"];
    recordLog({
      kind: "api",
      outcome: "response",
      method: "GET",
      path: "/api/library",
      status: 200,
      ms: 3,
      vercelId: "lhr1::abcde-1234567890-0123456789ab",
      bytes: null,
      contentType: null,
      error: null,
    });
    for (const value of bogus) {
      recordLog({
        kind: "api",
        outcome: "response",
        method: "GET",
        path: "/api/library",
        status: 200,
        ms: 3,
        vercelId: value,
        bytes: null,
        contentType: null,
        error: null,
      });
    }

    const ids = readLogBuffer().map((e) => (e.kind === "api" ? e.vercelId : "?"));
    expect(ids).toEqual(["lhr1::abcde-1234567890-0123456789ab", null, null, null, null]);
    expect(serialiseLogBuffer()).not.toContain("Nagel");
  });
});
