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
import type { ChatEffects } from "../src/web/chat/controller.js";

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

describe("the lost-connection sentence on a built page", () => {
  /* *"is `npm run dev` still running?"* reached production readers from five
     places. A built page says `COULD_NOT_REACH` and nothing of the browser's
     own; the development build keeps the hint. Plan 260924a § Stage 2b. */
  afterEach(() => vi.unstubAllEnvs());

  it("says nothing about npm, or the browser's words, in production", async () => {
    const { couldNotReach } = await import("../src/web/lib/reader-facing.js");
    const { COULD_NOT_REACH } = await import("../src/messages.js");
    vi.stubEnv("PROD", true);
    expect(couldNotReach("Failed to fetch")).toBe(COULD_NOT_REACH.message);
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const e = await apiFetch("/api/comments/x", { method: "POST" }).catch((x: Error) => x);
    const said = describeFetchFailure(e as Error);
    expect(said).not.toContain("npm");
    expect(said).not.toContain("Failed to fetch");
    expect(said).toMatch(/\[net-down\]$/);
  });

  it("keeps the dev-server hint in development", async () => {
    const { couldNotReach } = await import("../src/web/lib/reader-facing.js");
    vi.stubEnv("PROD", false);
    expect(couldNotReach("Failed to fetch")).toContain("npm run dev");
  });
});

describe("the chat controller's own catches", () => {
  /* `ChatController` caught an effect's rejection and put `e.message` straight
     into the state the panel draws — four catches, the spoken repair's among
     them. Plan 260924a § Stage 2b. Each rejection path is driven separately:
     reverting any one of the four catches must make its case expose React's
     words again. */
  const never = () => new Promise<never>(() => {});
  const task = () => new Promise((go) => setTimeout(go, 0));

  async function controller(overrides: Partial<ChatEffects> = {}) {
    const { ChatController } = await import("../src/web/chat/controller.js");
    return new ChatController("a-slug", {
      loadThreads: never,
      renameThread: never,
      deleteThread: never,
      runTurn: never,
      appendSpoken: never,
      settledAnswer: async () => null,
      stopAnswer: never,
      cancelThread: never,
      ...overrides,
    });
  }

  const spoken = async (overrides: Partial<ChatEffects>) => {
    const { asOpId } = await import("../src/web/chat/model.js");
    const c = await controller(overrides);
    const at = "2026-09-24T10:00:00.000Z";
    const landed = c.appendSpoken({
      id: asOpId("spya-dff1sp"),
      kind: "spoken",
      threadId: "spya-dff1th",
      question: { id: "spya-dff1qn", role: "user", text: "why?", createdAt: at, status: "done" },
      reply: { id: "spya-dff1rp", role: "assistant", text: "because", createdAt: at, status: "done" },
      expectedTailId: null,
      at,
    });
    return { c, landed };
  };

  it("does not draw an effect's foreign exception as the turn's failure", async () => {
    const { asOpId } = await import("../src/web/chat/model.js");
    const c = await controller({ runTurn: () => Promise.reject(new Error(REACT_185)) });
    const at = "2026-09-24T10:00:00.000Z";
    c.startTurn({
      type: "turn.started",
      op: {
        id: asOpId("spya-dff1op"),
        kind: "turn",
        shape: "send",
        threadId: "spya-dff1th",
        replyId: "spya-dff1rp",
        reply: { id: "spya-dff1rp", role: "assistant", text: "", createdAt: at, status: "pending" },
        question: { id: "spya-dff1qn", role: "user", text: "why?", createdAt: at, status: "done" },
        editing: null,
        opening: { id: "spya-dff1th", title: "why?", createdAt: at, updatedAt: at, kind: "chat", messages: [] },
        title: null,
        at,
        began: false,
        attempt: null,
      },
      payload: {},
    });
    for (let i = 0; i < 3; i++) await task();
    const drawn = JSON.stringify({ state: c.state, threads: c.threads });
    expect(drawn).not.toContain("Minified React error");
    expect(drawn).toContain("[web-unexpected]");
  });

  it("does not keep a rejected spoken write's foreign exception for its repair", async () => {
    const { landed } = await spoken({
      appendSpoken: () => Promise.reject(new Error(REACT_185)),
      loadThreads: async () => ({ ok: true, threads: [] }),
    });
    const result = await landed;
    if (result.ok) throw new Error("the rejected spoken write was reported as saved");
    expect(result.error).not.toContain("Minified React error");
    expect(result.error).toBe(PAGE_FAULT.message);
  });

  it("does not keep a rejected spoken repair's foreign exception", async () => {
    const { landed } = await spoken({
      appendSpoken: async () => ({ ok: false, conflict: true, error: "That write was refused." }),
      loadThreads: () => Promise.reject(new Error(REACT_185)),
    });
    const result = await landed;
    if (result.ok) throw new Error("the rejected spoken repair was reported as saved");
    expect(result.error).not.toContain("Minified React error");
    expect(result.error).toBe(PAGE_FAULT.message);
  });

  it("does not report the spoken repair's own late abort as a page fault", async () => {
    vi.useFakeTimers();
    try {
      const { landed } = await spoken({
        appendSpoken: async () => ({ ok: false, conflict: true, error: "That write was refused." }),
        loadThreads: (_slug, signal) =>
          new Promise((_, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(signal.reason ?? new Error("the repair was aborted")),
              { once: true },
            );
          }),
      });
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await landed;
      if (result.ok) throw new Error("the timed-out spoken repair was reported as saved");
      expect(result.error).toContain("Couldn’t confirm");
      expect(captured).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not draw a one-shot effect's foreign exception", async () => {
    const { asOpId } = await import("../src/web/chat/model.js");
    const c = await controller({ loadThreads: () => Promise.reject(new Error(REACT_185)) });
    c.dispatch({ type: "load.started", op: { id: asOpId("spya-dff1ld"), kind: "load" } });
    await task();
    expect(c.state.error).not.toContain("Minified React error");
    expect(c.state.error).toBe(PAGE_FAULT.message);
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
