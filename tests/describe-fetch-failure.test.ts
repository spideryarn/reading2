/**
 * Only a sentence written for the reader reaches the reader.
 *
 * `describeFetchFailure` is the one function seven client files describe a
 * caught failure through. Until 2026-09-24 it passed any `Error`'s message
 * through and called every `TypeError` a lost connection, so React's own
 * `Minified React error #185` reached a reader as a chat answer's failure
 * (docs/user-feedback/260912_1120-question-answer-replaced-by-react-error-185.md).
 * docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md.
 *
 * The positive cases go through the **real** producers — `readJson` on a real
 * `Response`, `apiFetch` over a rejecting `fetch` — rather than constructing the
 * marks by hand, because a producer that forgot to set the mark is the
 * regression worth catching.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_FAULT } from "../src/messages.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "T" } } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: async () => undefined,
  writeCached: async () => undefined,
  reserveTicket: async () => null,
  invalidate: async () => undefined,
  cachedSlugs: async () => new Set<string>(),
  rememberUser: () => {},
  lastKnownUser: () => null,
  forgetUser: () => {},
}));

/* The Sentry seam, watched: what `describeFetchFailure` reports, and how. */
const captured: { err: unknown; options: unknown }[] = [];
vi.mock("../src/web/monitoring.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/monitoring.js")>(
    "../src/web/monitoring.js",
  );
  return {
    ...real,
    captureClientFailure: (err: unknown, _context?: unknown, options?: unknown) => {
      captured.push({ err, options });
    },
  };
});

const { describeFetchFailure } = await import("../src/web/useComments.js");
const { sanitise } = await import("../src/monitoring-scrub.js");
const { apiFetch, readJson } = await import("../src/web/lib/api.js");
const { readEvents } = await import("../src/web/lib/sse.js");
const { ReaderFacingError } = await import("../src/web/lib/reader-facing.js");
const { askForThreads, runTurn } = await import("../src/web/chat/effects.js");

beforeEach(() => {
  captured.length = 0;
  vi.stubGlobal("navigator", { onLine: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const REACT_185 =
  "Minified React error #185; visit https://react.dev/errors/185 for the full message or use the " +
  "non-minified dev environment for full errors and additional helpful warnings.";

describe("an exception nobody wrote for a reader", () => {
  it("does not put React's own sentence in front of a reader", () => {
    const said = describeFetchFailure(new Error(REACT_185));
    expect(said).not.toContain("React");
    expect(said).toBe(PAGE_FAULT.message);
  });

  it("is reported with its message withheld, whatever code it happens to end in", () => {
    /* A foreign message ending in a registered code would pass `sanitise`'s
       `authored` test on its suffix alone — GPT Sol, plan review F1. */
    const foreign = new Error("a stretch of the article [ai-busy]");
    describeFetchFailure(foreign);
    expect(captured).toEqual([{ err: foreign, options: { neverAuthored: true } }]);
    const sent = sanitise(foreign, { neverAuthored: true });
    expect(sent.withheld).toBe(true);
    expect(sent.error.message).not.toContain("article");
  });

  it("does not call a bug's TypeError a lost connection, or quote it", () => {
    const said = describeFetchFailure(new TypeError("Cannot read properties of undefined (reading 'x')"));
    expect(said).not.toContain("Cannot read");
    expect(said).not.toContain("reach");
    expect(said).toMatch(/\[web-unexpected\]/);
  });
});

describe("a sentence that was written for a reader", () => {
  it("passes the server's own { error } through, from a real readJson", async () => {
    const res = new Response(JSON.stringify({ error: "That question is longer than the limit." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    const e = await readJson(res).catch((x: Error) => x);
    expect(describeFetchFailure(e as Error)).toBe("That question is longer than the limit.");
  });

  it("passes a client-written ReaderFacingError through", () => {
    expect(describeFetchFailure(new ReaderFacingError("The answer stopped arriving. Try again."))).toBe(
      "The answer stopped arriving. Try again.",
    );
  });

  it("passes readJson's own 200-but-not-JSON sentence through", async () => {
    const e = await readJson(new Response("<html>", { status: 200 })).catch((x: Error) => x);
    expect(describeFetchFailure(e as Error)).toContain("not with JSON");
  });
});

describe("a lost connection, marked where it happened", () => {
  it("is still said as one when fetch itself rejects, through apiFetch", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const e = await apiFetch("/api/comments/x", { method: "POST" }).catch((x: Error) => x);
    expect(e).toBeInstanceOf(TypeError); // untouched, for the sites that read it
    const said = describeFetchFailure(e as Error);
    expect(said).toContain("Couldn't reach");
    expect(said).toContain("Failed to fetch");
  });

  it("is still said as one when a successful reply's body dies mid-read", async () => {
    const torn = new Response(
      new ReadableStream({ start: (c) => c.error(new TypeError("terminated")) }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    const e = await readJson(torn).catch((x: Error) => x);
    expect(describeFetchFailure(e as Error)).toContain("Couldn't reach");
  });

  it("is still said as one when a stream's body dies mid-read", async () => {
    const body = new ReadableStream<Uint8Array>({ start: (c) => c.error(new TypeError("network error")) });
    const e = await (async () => {
      for await (const _ of readEvents(body)) {
        /* nothing arrives */
      }
    })().catch((x: Error) => x);
    expect(describeFetchFailure(e as Error)).toContain("Couldn't reach");
  });
});

describe("a stream that dies after it has started", () => {
  it("is still said as a lost connection on the clocked read path", async () => {
    /* `readEvents` reads through `readBefore` once the first byte is in, and
       that is a second `reader.read()` — plan review F4. */
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
        c.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"a"}\n\n'));
      },
    });
    const e = await (async () => {
      for await (const _ of readEvents(body, { stallMs: 60_000 })) {
        controller.error(new TypeError("network error"));
      }
    })().catch((x: Error) => x);
    expect(describeFetchFailure(e as Error)).toContain("Couldn't reach");
  });
});

describe("a read our own caller gave up on", () => {
  it("is not reported as a fault in the page", async () => {
    /* The spoken repair aborts `askForThreads` after it has finished — plan
       review F2. */
    const abort = new AbortController();
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        const aborted = () => reject(new DOMException("The operation was aborted.", "AbortError"));
        if (init.signal?.aborted) aborted();
        else init.signal?.addEventListener("abort", aborted);
      }),
    );
    const outcome = askForThreads("a-slug", abort.signal);
    abort.abort();
    expect((await outcome).ok).toBe(false);
    expect(captured).toEqual([]);
  });
});

describe("the reader's path: a chat turn", () => {
  it("fails with the page's own sentence when the store throws mid-stream, not React's", async () => {
    const frames =
      'event: begin\ndata: {"threadId":"t","messageId":"m"}\n\n' +
      'event: delta\ndata: {"text":"Hello"}\n\n' +
      'event: done\ndata: {}\n\n';
    vi.stubGlobal("fetch", async () =>
      new Response(frames, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const failed: string[] = [];
    await runTurn("a-slug", "t", { question: "why?" }, {
      began() {},
      delta() {
        throw new Error(REACT_185);
      },
      tool() {},
      done() {},
      failed(error) {
        failed.push(error);
      },
      refused() {},
      disconnected() {},
    });
    expect(failed).toEqual([PAGE_FAULT.message]);
  });
});

describe("every file that describes its failures through it", () => {
  /**
   * **A sentence thrown as a plain `Error` now reaches the reader as
   * `PAGE_FAULT`**, and nothing else would notice: the hooks' own tests mostly
   * assert that *an* error appeared (GPT Sol, code review F6). So a file whose
   * `catch` hands errors to `describeFetchFailure` may not `throw new Error(`
   * at all — a sentence for the reader is a `ReaderFacingError`, and a
   * diagnostic belongs somewhere that is not on this path. The list is found,
   * not written, so a new caller is covered the day it arrives.
   */
  it("throws no plain Error for it to swallow", () => {
    const web = path.resolve(import.meta.dirname, "..", "src", "web");
    const files = (readdirSync(web, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => path.join(web, f))
      .filter((f) => /describeFetchFailure\(/.test(readFileSync(f, "utf8")));
    expect(files.length).toBeGreaterThanOrEqual(7);
    const offenders = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => ({ line: line.trim(), at: `${path.relative(web, f)}:${i + 1}` }))
        .filter(({ line }) => !line.startsWith("*") && !line.startsWith("//"))
        .filter(({ line }) => /throw new Error\(/.test(line))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });
});
