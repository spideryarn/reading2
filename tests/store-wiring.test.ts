/**
 * What `src/routes.ts` hands the store, and what it forgets to.
 *
 * ## Why a test at this seam at all
 *
 * Step 10 moved chat and meaning-search behind `src/store/index.js`, and two of
 * the things that move with them are **invisible in `files` mode**:
 *
 * 1. **The attempt token.** `begin` / `retry` / `edit` hand one back and
 *    `finish` has to present it. The Postgres store refuses a `finish` without
 *    one — deliberately, rather than falling back to identity, because a run or
 *    a message keeps its id across a retry and identity therefore cannot say
 *    which model call is reporting. The filesystem store has no attempts and
 *    ignores the argument entirely. So a route that simply **drops the token**
 *    passes every filesystem test there is and breaks the fence the column
 *    exists for.
 *
 * 2. **The sweep's `keep` set.** `streaming` and `searching` are keyed
 *    `slug/…/id` because that is what a stop request names; `SweepOptions.keep`
 *    is a set of bare row ids. A route that hands over the composite keys, or
 *    an empty set, buries the answer this very server is streaming — and on the
 *    filesystem it *still* passes, because a fresh message is younger than the
 *    grace window and would not have been swept anyway. That is the shape of
 *    bad-reason-green the review of this step kept finding.
 *
 * Neither needs a database. What is asserted is the **call**, so the store is
 * wrapped and the arguments recorded: the real filesystem store still does the
 * work, and the spy only watches it go past.
 *
 * See docs/plans/260826e-postgres-storage-implementation.md § Step 10 and
 * `SweepOptions` in src/store/contracts.ts.
 */

import { cp, rm } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SweepOptions } from "../src/store/contracts.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

/**
 * The recorder, hoisted because `vi.mock` is.
 *
 * A plain `const` here would be initialised *after* the mock factory runs, and
 * the factory would close over `undefined` — which reads as "the route never
 * called the store" rather than as a broken test.
 */
const seen = vi.hoisted(() => ({
  chatBegin: [] as (string | undefined)[],
  chatFinish: [] as (string | undefined)[],
  chatSweep: [] as SweepOptions[],
  searchBegin: [] as (string | undefined)[],
  searchFinish: [] as (string | undefined)[],
  searchSweep: [] as SweepOptions[],
  /** What the fake store hands back as an attempt, so the route can carry it. */
  chatToken: "chat-attempt-from-the-store",
  searchToken: "search-attempt-from-the-store",
}));

/**
 * The real store, with attempts bolted on.
 *
 * `importActual` rather than a hand-written fake, on purpose: a fake would let
 * this test agree with a routes.ts that has stopped agreeing with the store.
 * The filesystem adapter answers `attempt: undefined` because it has none, so
 * the token is substituted here — which is what makes "did the route carry it"
 * an answerable question without a database.
 */
vi.mock("../src/store/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/store/index.js")>("../src/store/index.js");
  return {
    ...actual,
    chatStore: {
      ...actual.chatStore,
      begin: async (...args: Parameters<typeof actual.chatStore.begin>) => {
        const turn = await actual.chatStore.begin(...args);
        seen.chatBegin.push(seen.chatToken);
        return { ...turn, attempt: seen.chatToken };
      },
      retry: async (...args: Parameters<typeof actual.chatStore.retry>) => {
        const turn = await actual.chatStore.retry(...args);
        seen.chatBegin.push(seen.chatToken);
        return { ...turn, attempt: seen.chatToken };
      },
      finish: async (...args: Parameters<typeof actual.chatStore.finish>) => {
        seen.chatFinish.push(args[4]?.attempt);
        return actual.chatStore.finish(...args);
      },
      sweepPending: async (slug: string, opts: SweepOptions) => {
        seen.chatSweep.push(opts);
        return actual.chatStore.sweepPending(slug, opts);
      },
    },
    searchStore: {
      ...actual.searchStore,
      begin: async (...args: Parameters<typeof actual.searchStore.begin>) => {
        const begun = await actual.searchStore.begin(...args);
        seen.searchBegin.push(seen.searchToken);
        return { ...begun, attempt: seen.searchToken };
      },
      finish: async (...args: Parameters<typeof actual.searchStore.finish>) => {
        seen.searchFinish.push(args[3]);
        return actual.searchStore.finish(...args);
      },
      sweepPending: async (slug: string, opts: SweepOptions) => {
        seen.searchSweep.push(opts);
        return actual.searchStore.sweepPending(slug, opts);
      },
    },
  };
});

const { handleApi, CHAT_ORPHAN_GRACE_MS, SEARCH_ORPHAN_GRACE_MS } = await import(
  "../src/routes.js"
);
const { CHAT_TIMEOUT_MS } = await import("../src/converse.js");
const { SEARCH_TIMEOUT_MS } = await import("../src/search.js");

const SLUG = "test-store-wiring-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
/* An article to answer about. This slug used to get one for nothing — an
   unknown slug fell through to the committed `example/` fixture — and that
   fallback is gone (src/api.ts § `candidateDirs`), because it also answered a
   reader's own half-built article with the fixture's prose. */
const EXAMPLE = path.resolve(import.meta.dirname, "..", "example");

/* The same hanging body tests/chat-live-turn.test.ts uses: one word, then
   silence for ever. It is the only way to have a `pending` row that this
   process is genuinely still writing while a second request arrives. */
const frame = (text: string) =>
  `data: ${JSON.stringify({ model: "test/model", choices: [{ delta: { content: text } }] })}\n\n`;

function hangingBody(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(encoder.encode(frame("Because")));
        return;
      }
      return new Promise<void>(() => {});
    },
  });
}

beforeEach(async () => {
  await rm(DIR, { recursive: true, force: true });
  await cp(EXAMPLE, DIR, { recursive: true });
  process.env.OPENROUTER_API_KEY = "test-key";
  for (const list of [
    seen.chatBegin,
    seen.chatFinish,
    seen.chatSweep,
    seen.searchBegin,
    seen.searchFinish,
    seen.searchSweep,
  ]) {
    list.length = 0;
  }
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return new Promise<Response>((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        resolve(new Response(hangingBody(), { headers: { "Content-Type": "text/event-stream" } }));
      });
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(DIR, { recursive: true, force: true });
});

interface Call {
  done: Promise<void>;
  status(): number;
  frames(): { event: string; data: Record<string, unknown> }[];
  body(): Record<string, unknown>;
}

function call(method: string, url: string, body?: unknown): Call {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let written = "";
  let status = 0;
  const res = {
    get statusCode() {
      return status;
    },
    set statusCode(v: number) {
      status = v;
    },
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {},
    on() {},
    /* The search route opens its stream through `sse(res)`, which calls
       `writeHead`; `streamChat` sets its headers one at a time. A fake without
       both throws inside the route — and the throw lands after `searching.add`
       and before its `finally`, which leaks the key into every later test. */
    writeHead(code: number) {
      status = code;
    },
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  return {
    done: handleApi(req, res, acceptAny).then(() => {}),
    status: () => status,
    body: () =>
      written.startsWith("event: ")
        ? {}
        : (JSON.parse(written || "{}") as Record<string, unknown>),
    frames: () =>
      written
        .split("\n\n")
        .filter((b) => b.startsWith("event: "))
        .map((b) => {
          const [head, ...rest] = b.split("\n");
          return {
            event: (head as string).slice("event: ".length),
            data: JSON.parse(rest.join("\n").slice("data: ".length)) as Record<string, unknown>,
          };
        }),
  };
}

async function begun(c: Call): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i++) {
    const first = c.frames()[0];
    if (first && first.data.text === undefined) return first.data;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no begin frame");
}

async function streamed(c: Call): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (c.frames().some((f) => f.event === "delta")) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("nothing streamed");
}

describe("the chat route carries the store's attempt", () => {
  it("presents on `finish` the token `begin` handed back", async () => {
    const live = call("POST", `/api/chat/${SLUG}`, {
      threadId: "spya-t7r4wz",
      question: "why is it like that?",
    });
    const first = await begun(live);
    const threadId = first.threadId as string;
    const messageId = first.messageId as string;
    await streamed(live);

    // Stopping is the cheapest way to reach `finish` from here: the body never
    // ends on its own, and a stopped answer is stored `done` like any other.
    await call("POST", `/api/chat/${SLUG}/${threadId}/stop`, { messageId }).done;
    await live.done;

    expect(seen.chatBegin).toEqual([seen.chatToken]);
    /* The assertion the whole file exists for. Delete `{ attempt: storeAttempt }`
       from streamChat and this is `[undefined]` — while every other chat test
       stays green, because the filesystem store ignores the argument. */
    expect(seen.chatFinish).toEqual([seen.chatToken]);
  });
});

describe("the chat sweep is told what this process is writing", () => {
  it("spares the live answer by naming its message id, not its stream key", async () => {
    const live = call("POST", `/api/chat/${SLUG}`, {
      threadId: "spya-t7r4wz",
      question: "why is it like that?",
    });
    const first = await begun(live);
    const threadId = first.threadId as string;
    const messageId = first.messageId as string;
    await streamed(live);

    const read = call("GET", `/api/chat/${SLUG}`);
    await read.done;

    expect(seen.chatSweep).toHaveLength(1);
    const opts = seen.chatSweep[0] as SweepOptions;
    /* A bare row id. Handing over `slug/threadId/messageId` would match nothing
       in the store and the set would silently protect nobody — and on the
       filesystem, where a fresh message is inside the grace window anyway,
       nothing would look wrong. */
    expect([...opts.keep]).toEqual([messageId]);
    expect(opts.graceMs).toBe(CHAT_ORPHAN_GRACE_MS);

    await call("POST", `/api/chat/${SLUG}/${threadId}/stop`, { messageId }).done;
    await live.done;
  });

  it("hands over an empty set once nothing is streaming", async () => {
    // The quiet article, which is the case a `NOT IN ()` would have broken.
    const read = call("GET", `/api/chat/${SLUG}`);
    await read.done;
    expect(read.status()).toBe(200);
    expect([...(seen.chatSweep[0] as SweepOptions).keep]).toEqual([]);
  });
});

describe("the search route carries the store's attempt", () => {
  it("presents on `finish` the token `begin` handed back", async () => {
    /* No hanging body here — the search has to *finish* for `finish` to be
       called, and a model that never answers is a different test. The stub
       returns something unparseable, which lands as a stored `error`; the route
       stores it through exactly the same call, with exactly the same fence. */
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("data: {}\n\ndata: [DONE]\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          }),
      ),
    );

    const run = call("POST", `/api/search/${SLUG}`, { criterion: "every passage about cost" });
    await run.done;

    expect(seen.searchBegin).toEqual([seen.searchToken]);
    expect(seen.searchFinish).toEqual([seen.searchToken]);
  });
});

describe("the search sweep is told what this process is running", () => {
  it("hands over an empty set on a quiet article, and the right grace window", async () => {
    const read = call("GET", `/api/search/${SLUG}`);
    await read.done;
    expect(read.status()).toBe(200);
    const opts = seen.searchSweep[0] as SweepOptions;
    expect([...opts.keep]).toEqual([]);
    expect(opts.graceMs).toBe(SEARCH_ORPHAN_GRACE_MS);
  });
});

describe("the grace windows clear the deadlines they have to clear", () => {
  /* There is no heartbeat: an attempt says it has started and then says it has
     finished, and nothing in between. So a window shorter than the hard
     deadline on the model call buries answers that are still being written,
     and it does it under exactly the load that makes them slow. src/routes.ts
     throws at import if either of these stops holding; this says so where
     somebody changing a timeout will read it. */
  it("chat: longer than the whole-turn deadline in converse.ts", () => {
    expect(CHAT_ORPHAN_GRACE_MS).toBeGreaterThan(CHAT_TIMEOUT_MS);
  });

  it("search: longer than the deadline in search.ts", () => {
    expect(SEARCH_ORPHAN_GRACE_MS).toBeGreaterThan(SEARCH_TIMEOUT_MS);
  });
});
