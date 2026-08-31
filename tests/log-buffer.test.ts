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
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOG_BUFFER_CAPACITY,
  LOG_MAX_CHARS,
  clearLogBuffer,
  readLogBuffer,
  recordLog,
  serialiseLogBuffer,
} from "../src/web/log-buffer.js";

/**
 * Distinctive enough that a substring search for it cannot pass by luck.
 * Stands in for everything the buffer must never end up holding: an article's
 * sentences, a reader's search box, a provider's error body.
 */
const PROSE = "Nagel-the-bat-considered-as-an-unread-appendix";

beforeEach(() => {
  clearLogBuffer();
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

  it("keeps the newest, oldest-first, and never grows past its capacity", () => {
    for (let i = 0; i < LOG_BUFFER_CAPACITY + 37; i++) {
      recordLog({ kind: "client-error", source: "boundary", name: `E${i}` });
    }

    const entries = readLogBuffer();
    expect(entries).toHaveLength(LOG_BUFFER_CAPACITY);

    const names = entries.map((e) => (e.kind === "client-error" ? e.name : ""));
    expect(names[0]).toBe("E37");
    expect(names.at(-1)).toBe(`E${LOG_BUFFER_CAPACITY + 36}`);
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

  it("truncates a long string at write time, not on the way out", () => {
    recordLog({ kind: "client-error", source: "boundary", name: "x".repeat(5_000) });

    const entry = readLogBuffer()[0];
    const name = entry && entry.kind === "client-error" ? entry.name : "";
    // Resident already short: the value never sat in memory at full length.
    expect(name.length).toBeLessThanOrEqual(LOG_MAX_CHARS + 1);
    expect(name.endsWith("…")).toBe(true);
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
        recordLog({ kind: "client-error", source: "boundary", name: `E${i}` });
      }
      expect(stringify).not.toHaveBeenCalled();

      const blob = serialiseLogBuffer();
      expect(stringify).toHaveBeenCalledTimes(1);
      expect(blob).toContain("E19");
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
