/**
 * The HTTP surface — src/routes.ts. See docs/project/comments.md.
 *
 * No server and no network: `handleApi` is a plain function over a request and
 * a response, which is the point of it not being Vite-specific. Nothing here
 * reaches the model — the requests under test are rejected before they get
 * anywhere near one.
 *
 * Writes under `data/<throwaway slug>/`, which is gitignored, and removes it.
 */
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "../src/routes.js";
import { createComment, loadComments } from "../src/comments.js";
import { loadShelf } from "../src/shelf.js";
import { deleteRun, loadRuns } from "../src/searches.js";
import { mintId } from "../src/ids.js";

const SLUG = "test-routes-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
afterEach(() => rm(DIR, { recursive: true, force: true }));

interface Reply {
  handled: boolean;
  status: number;
  body: { error?: string; comments?: { id: string; status: string; error?: string }[] };
}

/** Drive `handleApi` with a fake request/response pair. */
async function call(method: string, url: string, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  const handled = await handleApi(req, res);
  return { handled, status, body: text ? JSON.parse(text) : {} };
}

/**
 * The same drive, but with a response that can be streamed to — and that
 * remembers whether it was.
 *
 * `call` above deliberately has no `writeHead`, `write` or `on`, which is why
 * every existing POST test still passes now that a successful POST is an event
 * stream: they all fail validation, and validation happens before a single
 * header is written. That is load-bearing rather than lucky, so it gets a test
 * of its own below.
 */
async function callStreaming(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; headers: Record<string, string>; frames: string; streamed: boolean }> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url },
  ) as unknown as IncomingMessage;

  let status = 0;
  let streamed = false;
  let headers: Record<string, string> = {};
  let frames = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    on() {},
    flushHeaders() {},
    writeHead(code: number, h: Record<string, string>) {
      streamed = true;
      status = code;
      headers = h;
    },
    write(chunk: string) {
      frames += chunk;
    },
    end(chunk?: string) {
      if (chunk) frames += chunk;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res);
  return { status, headers, frames, streamed };
}

describe("asking a question is a stream, and refusing one is not", () => {
  /* The two shapes, and they must not be able to swap places. A failure the
     server can see before it starts writing is an HTTP status the client can
     read with `r.ok`; a failure after that can only be a frame. If validation
     ever moved below `sse(res)`, a malformed request would get a 200 event
     stream carrying an error nobody checks for — and the reader would watch a
     spinner. */
  it("refuses a malformed body with JSON, before any header is written", async () => {
    const r = await callStreaming("POST", `/api/comments/${SLUG}`, { blockId: 1 });
    expect(r.streamed).toBe(false);
    expect(r.status).toBe(400);
  });

  it("refuses a negative offset the same way", async () => {
    const r = await callStreaming("POST", `/api/comments/${SLUG}`, {
      blockId: "spya-aaaaaa",
      quote: "x",
      start: -1,
    });
    expect(r.streamed).toBe(false);
    expect(r.status).toBe(400);
  });

  it("refuses a traversing slug before it can write anything at all", async () => {
    const r = await callStreaming("POST", "/api/comments/..%2F..%2Fetc", {
      blockId: "spya-aaaaaa",
      quote: "x",
      start: 0,
    });
    expect(r.streamed).toBe(false);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe("the library route", () => {
  it("serves the shelf, with the committed fixture on it", async () => {
    const r = await call("GET", "/api/library");
    expect(r.status).toBe(200);
    const articles = (r.body as unknown as { articles: { slug: string }[] }).articles;
    expect(articles.some((a) => a.slug === "example")).toBe(true);
  });

});

describe("the shelf routes", () => {
  const SHELF = "test-routes-shelf";
  const SHELF_DIR = path.resolve(import.meta.dirname, "..", "data", SHELF);
  const EXAMPLE = path.resolve(import.meta.dirname, "..", "example");

  /** A complete-enough article, because the shelf routes now refuse to write for one that isn't. */
  const makeArticle = () => cp(EXAMPLE, SHELF_DIR, { recursive: true });

  afterEach(() => rm(SHELF_DIR, { recursive: true, force: true }));

  it("counts an open, and says nothing back", async () => {
    await makeArticle();
    const r = await call("POST", `/api/library/${SHELF}/open`);
    expect(r.status).toBe(204);
    expect(await loadShelf(SHELF)).toMatchObject({ opens: 1 });
  });

  it("refuses to count an open for an article that does not exist", async () => {
    /* And, crucially, writes nothing. src/shelf.ts will happily create
       `data/<slug>/shelf.json` for any slug-shaped string, so without the
       existence check a typo left a directory and a file behind for an article
       the server had just said it did not have. */
    const r = await call("POST", `/api/library/${SHELF}/open`);
    expect(r.status).toBe(404);
    expect(await loadShelf(SHELF)).toEqual({ opens: 0 });
  });

  it("refuses a PATCH with nothing in it, rather than answering 200", async () => {
    await makeArticle();
    const r = await call("PATCH", `/api/library/${SHELF}`, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Nothing to change/);
  });

  it("refuses a body that is not an object, rather than throwing a 500", async () => {
    for (const body of ['"hello"', "42", "null", "[1,2]"]) {
      const r = await call("PATCH", `/api/library/${SHELF}`, body);
      expect(r.status, body).toBe(400);
    }
  });

  it("refuses a title that is not a string or null", async () => {
    await makeArticle();
    const r = await call("PATCH", `/api/library/${SHELF}`, { title: 42 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/title must be/);
  });

  it("refuses an archived flag that is not a boolean", async () => {
    // `"true"` is the shape a hand-written query string produces, and treating
    // it as truthy would mean `archived: "false"` archived the article.
    await makeArticle();
    const r = await call("PATCH", `/api/library/${SHELF}`, { archived: "true" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/archived must be/);
  });

  it("changes NOTHING when one of two fields is invalid", async () => {
    /* The test this route was rewritten for. It used to write each field in
       turn, so this renamed the article and *then* answered 400 — a request
       that reports failure and changes your data. */
    await makeArticle();
    const r = await call("PATCH", `/api/library/${SHELF}`, {
      title: "Should not stick",
      archived: "no",
    });
    expect(r.status).toBe(400);
    expect(await loadShelf(SHELF)).toEqual({ opens: 0 });
  });

  it("applies both fields together when both are valid", async () => {
    await makeArticle();
    const r = await call("PATCH", `/api/library/${SHELF}`, {
      title: "Both at once",
      archived: true,
    });
    expect(r.status).toBe(200);
    const state = await loadShelf(SHELF);
    expect(state.title).toBe("Both at once");
    expect(state.archivedAt).toBeTruthy();
    // The entry comes back from the half it now lives in, not the one it left.
    expect((r.body as unknown as { entry: { title: string } }).entry.title).toBe("Both at once");
  });

  it("refuses a slug that is not a slug", async () => {
    /* 400, not 404, and that is `slugPart`'s rule rather than this route's: the
       request is malformed, and answering "not found" would send whoever sent
       it looking for a missing article. The path decodes to `../../etc`, which
       reached `loadArticle` as a real traversal before that guard existed —
       see docs/project/security.md. */
    const r = await call("POST", "/api/library/..%2F..%2Fetc/open");
    expect(r.status).toBe(400);
  });

  it("searches the library, and echoes the query back", async () => {
    const r = await call("GET", "/api/library/search?q=the");
    expect(r.status).toBe(200);
    const body = r.body as unknown as { query: string; hits: unknown[]; capped: boolean };
    // Echoed so a client can drop a response that arrived after it moved on.
    expect(body.query).toBe("the");
    expect(Array.isArray(body.hits)).toBe(true);
  });

  it("answers an empty search with an empty list, not an error", async () => {
    const r = await call("GET", "/api/library/search?q=");
    expect(r.status).toBe(200);
    expect((r.body as unknown as { hits: unknown[] }).hits).toEqual([]);
  });

  it("clamps a silly limit instead of refusing it", async () => {
    // A limit is a hint from a client we wrote. A 400 here would be a broken
    // search box rather than a corrected one — but unbounded is not on offer.
    for (const limit of ["9999", "abc", "0", "-5"]) {
      const r = await call("GET", `/api/library/search?q=the&limit=${limit}`);
      expect(r.status, limit).toBe(200);
      expect((r.body as unknown as { hits: unknown[] }).hits.length, limit).toBeLessThanOrEqual(30);
    }
  });

  it("keeps /api/library/search out of the rename route's way", async () => {
    // `search` is a valid slug shape, so the two patterns overlap. If the
    // `:slug` one won, this would be a request to rename an article called
    // "search" — and the search box would 405 or worse.
    const r = await call("GET", "/api/library/search?q=zzz");
    expect(r.status).toBe(200);
  });
});

describe("the reader routes", () => {
  const FILE = path.resolve(import.meta.dirname, "..", "data", "reader.json");
  afterEach(() => rm(FILE, { force: true }));

  it("answers null for a reader who has written nothing", async () => {
    const r = await call("GET", "/api/reader");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ profile: null });
  });

  it("stores a profile and reads it back", async () => {
    const w = await call("PATCH", "/api/reader", { profile: "  A physicist.  " });
    expect(w.status).toBe(200);
    // Normalised on the way in, so the value stored is the value hashed.
    expect(w.body).toEqual({ profile: "A physicist." });
    expect((await call("GET", "/api/reader")).body).toEqual({ profile: "A physicist." });
  });

  it("treats null and blank as clearing it", async () => {
    await call("PATCH", "/api/reader", { profile: "A physicist." });
    expect((await call("PATCH", "/api/reader", { profile: null })).body).toEqual({ profile: null });
    await call("PATCH", "/api/reader", { profile: "A physicist." });
    expect((await call("PATCH", "/api/reader", { profile: "   " })).body).toEqual({ profile: null });
  });

  it("refuses a body with no profile in it, rather than answering 200", async () => {
    /* This body has exactly one field, so a request without it meant something
       else — and a 200 would report a save that did not happen. */
    const r = await call("PATCH", "/api/reader", {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Nothing to change/);
  });

  it("refuses a profile that is not a string or null", async () => {
    expect((await call("PATCH", "/api/reader", { profile: 42 })).status).toBe(400);
    expect((await call("PATCH", "/api/reader", '"hello"')).status).toBe(400);
  });

  it("refuses one longer than the cap, and stores nothing", async () => {
    const r = await call("PATCH", "/api/reader", { profile: "x".repeat(2000) });
    expect(r.status).toBe(400);
    expect((await call("GET", "/api/reader")).body).toEqual({ profile: null });
  });
});

describe("the library route, continued", () => {
  it("does not answer to a path that merely starts with it", async () => {
    // `/api/library/anything` quietly serving the whole shelf would be the
    // kind of thing nobody notices until something depends on it.
    //
    // It is a 404 rather than a fall-through now: an unmatched `/api/` path
    // used to be handed back to Vite, whose SPA fallback answered it with
    // index.html and a 200, so the client reported a JSON parse error for a
    // route that simply did not exist. What the test is really asserting is
    // unchanged — no shelf came back.
    const r = await call("GET", "/api/library/anything");
    expect(r.status).toBe(404);
    expect(r.body).not.toHaveProperty("articles");
  });
});

/**
 * Path traversal — the one that was real, and was confirmed by experiment.
 *
 * The route patterns allow `%` and `.`, and the handler percent-decodes the
 * capture, so `..%2F..%2F…` reached the loaders as `../../…`. `path.join`
 * normalises `..` away rather than refusing it, so a slug of enough `../`
 * followed by a real path walked straight out of the repo: a `blocks.json`
 * planted under /tmp came back through `GET /api/article/` as HTTP 200 with the
 * planted text in the body, 2026-08-25.
 *
 * **The reason this survived is how a shallow attempt fails.** `../../etc` finds
 * no blocks.json, so the loader falls through to the `example/` fixture and
 * serves it — which looks exactly like a refusal. You have to traverse all the
 * way to a directory you control before the behaviour differs at all, so a test
 * that stops short reports the endpoint safe. Hence the long escapes below:
 * a short one here would pass against the vulnerable code.
 *
 * See docs/project/security.md § The URL is the second untrusted party.
 */
describe("a slug that is not a slug", () => {
  // Deep enough to climb out of any checkout, then somewhere absolute.
  const TRAVERSAL = `${encodeURIComponent("../".repeat(12))}private%2Ftmp%2Fanything`;

  it("refuses a percent-encoded traversal on every route that opens a directory", async () => {
    const cases: [string, string][] = [
      ["GET", `/api/article/${TRAVERSAL}`],
      ["GET", `/api/metadata/${TRAVERSAL}`],
      ["GET", `/api/tweets/${TRAVERSAL}`],
      ["GET", `/api/comments/${TRAVERSAL}`],
      ["DELETE", `/api/comments/${TRAVERSAL}/spya-k3m9qt`],
    ];
    for (const [method, url] of cases) {
      const r = await call(method, url);
      expect(r.status, url).toBe(400);
      expect(r.body.error, url).toMatch(/Not a slug/);
    }
  });

  it("refuses the write route too, before it can create a directory", async () => {
    // The worst of them: `save()` in src/comments.ts mkdir -p's the parent
    // before writing, so an unguarded slug here is an arbitrary write, not
    // merely an arbitrary read.
    const r = await call("POST", `/api/comments/${TRAVERSAL}`, {
      blockId: "spya-k3m9qt",
      quote: "x",
      start: 0,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Not a slug/);
  });

  it("refuses the shapes that are not traversals but are not slugs either", async () => {
    // `isSlug` is lowercase-alphanumeric-and-dashes. Anything else is refused
    // outright rather than sanitised — sanitising invites arguing about
    // whether it worked (src/comments.ts says the same).
    for (const bad of ["..", ".", "%2e%2e", "Example", "_jobs", "a%2Fb"]) {
      const r = await call("GET", `/api/article/${bad}`);
      expect(r.status, bad).toBe(400);
    }
  });

  it("still serves an ordinary slug", async () => {
    // The guard has to be narrow enough to leave the app working, and this is
    // the assertion that would catch it being too strict.
    expect((await call("GET", "/api/article/example")).status).toBe(200);
    expect((await call("GET", "/api/metadata/example")).status).toBe(200);
  });
});

describe("what a failure is reported as", () => {
  // Every one of these used to come back 404, which sent the reader looking for
  // a missing article instead of the thing that was actually wrong.
  it("calls a malformed body 400, not 404", async () => {
    const r = await call("POST", `/api/comments/${SLUG}`, "{");
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/valid JSON/);
  });

  it("calls an oversized body 413", async () => {
    const r = await call("POST", `/api/comments/${SLUG}`, { blockId: "x".repeat(70_000) });
    expect(r.status).toBe(413);
  });

  it("calls a missing field 400", async () => {
    const r = await call("POST", `/api/comments/${SLUG}`, { blockId: "spya-k3m9qt" });
    expect(r.status).toBe(400);
  });

  it("calls an unknown /api/ route 404, rather than letting Vite answer it", async () => {
    // This used to return false, which handed the request to Vite's SPA
    // fallback: index.html, status 200, and a client reporting
    // `Unexpected token '<'` from r.json(). A parse error blaming the client
    // for a route that does not exist. See docs/reusable/silent-success.md.
    const r = await call("GET", "/api/nothing-of-the-sort");
    expect(r.handled).toBe(true);
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/No API route/);
  });

  it("still falls through for a path that is not ours at all", async () => {
    // The 404 above is only for /api/. Anything else must still be handed on,
    // which is what makes handleApi mountable as middleware.
    const r = await call("GET", "/read/example/metadata");
    expect(r.handled).toBe(false);
  });

  it("serves any slug, because an unknown one falls back to the example fixture", async () => {
    // Not a missing-article test: `loadArticle` tries `data/<slug>/` and then
    // `example/`, so in a dev checkout every slug resolves (src/api.ts). The
    // 404 path is exercised by the tagged error there, not reachable from here.
    const r = await call("GET", "/api/article/no-such-article-anywhere");
    expect(r.status).toBe(200);
  });

  it("is not ours if the path is not /api/", async () => {
    expect((await call("GET", "/index.html")).handled).toBe(false);
  });
});

describe("the anchor offset must be a real offset", () => {
  // A negative start silently drew the mark a few characters left of the words
  // it belonged to. Refusing it at the door is cheaper than defending every
  // reader of the value. See src/web/annotate.ts § resolveMark.
  // Not NaN: `JSON.stringify` turns it into `null`, so it never arrives as a
  // number at all and is caught by the missing-field check above.
  for (const start of [-1, 1.5]) {
    it(`rejects start = ${start}`, async () => {
      const r = await call("POST", `/api/comments/${SLUG}`, {
        blockId: "spya-k3m9qt",
        quote: "the hard problem",
        start,
      });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/non-negative integer/);
      // Nothing was written: a refused request must not leave a comment behind.
      expect(await loadComments(SLUG)).toEqual([]);
    });
  }
});

describe("a pending comment nobody is answering", () => {
  it("comes back as an error the reader can retry, not an eternal spinner", async () => {
    // What a crash mid-answer leaves on disk. Since `pending` is written before
    // the model call, this is indistinguishable from a live request *on disk* —
    // only the running process knows, and this one is not answering it.
    const orphan = await createComment(SLUG, {
      blockId: "spya-k3m9qt",
      quote: "the hard problem",
      start: 12,
    });
    expect(orphan.status).toBe("pending");

    const r = await call("GET", `/api/comments/${SLUG}`);
    expect(r.status).toBe(200);
    expect(r.body.comments?.[0]?.status).toBe("error");
    expect(r.body.comments?.[0]?.error).toMatch(/server stopped/);

    // And it is written down, so a second reader sees the same thing.
    expect((await loadComments(SLUG))[0]?.status).toBe("error");
  });

  it("leaves an already-answered comment alone", async () => {
    await createComment(SLUG, { blockId: "spya-k3m9qt", quote: "q", start: 0, id: "spya-k3m9qt" });
    await call("GET", `/api/comments/${SLUG}`);
    const first = await call("GET", `/api/comments/${SLUG}`);
    // Swept once, then stable — the sweep must not keep rewriting the file.
    expect(first.body.comments?.[0]?.status).toBe("error");
    expect(first.body.comments).toHaveLength(1);
  });
});

describe("the tweets route", () => {
  // Reads only. Writing a thread is a job, not a request, so there is no POST
  // here to test and nothing in this file can reach a model.

  it("refuses a slug that could climb out of data/", async () => {
    // Not theoretical: `part()` percent-decodes, so `%2E%2E%2F` arrives as
    // `../` and `path.join` is happy to follow it. `loadTweets` calls `isSlug`
    // before it touches the filesystem — docs/project/ingest-queue.md#the-one-security-check.
    const r = await call("GET", `/api/tweets/${encodeURIComponent("../../../../etc")}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Not a slug/);
  });

  it("says there is no thread yet, and how to ask for one", async () => {
    // The fixture has no tweets.json, and an unknown slug falls through to it —
    // the same resolution `loadArticle` uses. 404 here is the ordinary case,
    // not a fault, so the message has to be actionable rather than apologetic.
    const r = await call("GET", "/api/tweets/example");
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/steps.*tweets/);
  });

  it("does not answer to POST", async () => {
    // A thread is half a minute of model time. If this ever starts answering,
    // somebody has put a model call inside a request handler.
    //
    // 404 rather than a fall-through, as above — the assertion that matters is
    // that no thread came back.
    const r = await call("POST", "/api/tweets/example");
    expect(r.status).toBe(404);
    expect(r.body).not.toHaveProperty("thread");
  });
});

describe("POST /api/search/:slug is a stream too", () => {
  // Its own slug, and its own OpenRouter mock, so stubbing `fetch` here cannot
  // touch any other describe block in this file — none of the rest reach a
  // model. loadArticle falls back to example/ for an unknown slug, same as
  // every other route test here, so `data/<this slug>/` only ever holds
  // searches.json.
  const SEARCH_SLUG = "test-routes-search-fixture";
  const SEARCH_DIR = path.resolve(import.meta.dirname, "..", "data", SEARCH_SLUG);

  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(async () => {
    await rm(SEARCH_DIR, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  // A quote genuinely inside example/blocks.json's spya-gp3g6s, so
  // validateHits (src/search.ts) keeps it rather than dropping it as unquoted.
  const HIT = {
    blockId: "spya-gp3g6s",
    quote: "Berggruen Prize",
    confidence: 88,
    reasoning: "names the prize the essay won",
  };

  /** An OpenRouter SSE reply carrying the given hits as one content delta. */
  function openRouterReply(hits: unknown[]): Response {
    const text =
      `data: ${JSON.stringify({
        model: "anthropic/claude-sonnet-4.5",
        choices: [{ delta: { content: JSON.stringify({ hits }) } }],
      })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n` +
      "data: [DONE]\n\n";
    const bytes = new TextEncoder().encode(text);
    return {
      ok: true,
      body: new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(bytes);
          c.close();
        },
      }),
    } as unknown as Response;
  }

  /** The `event:`/`data:` frames our own `sse()` writer produced, parsed back. */
  function parseFrames(raw: string): { event: string; data: unknown }[] {
    return raw
      .split("\n\n")
      .filter((chunk) => chunk.trim() !== "")
      .map((chunk) => {
        const lines = chunk.split("\n");
        const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "message";
        const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim() ?? "{}";
        return { event, data: JSON.parse(dataLine) };
      });
  }

  it("emits begin, then a hit frame per hit, then exactly one done", async () => {
    fetchMock.mockResolvedValue(openRouterReply([HIT]));
    const r = await callStreaming("POST", `/api/search/${SEARCH_SLUG}`, {
      criterion: "the prize the essay won",
    });
    expect(r.status).toBe(200);
    const frames = parseFrames(r.frames);
    expect(frames.map((f) => f.event)).toEqual(["begin", "hit", "done"]);
    expect((frames[0]!.data as { status: string }).status).toBe("pending");
    expect((frames[1]!.data as { hit: { blockId: string } }).hit.blockId).toBe("spya-gp3g6s");
    const done = frames[2]!.data as { status: string; hits: unknown[] };
    expect(done.status).toBe("done");
    expect(done.hits).toHaveLength(1);
  });

  it("a model failure arrives as a done frame with status: error, not an HTTP error", async () => {
    fetchMock.mockRejectedValue(new Error("network exploded"));
    const r = await callStreaming("POST", `/api/search/${SEARCH_SLUG}`, {
      criterion: "anything at all",
    });
    // The headers went out 200 before the model was ever called — see `sse`.
    expect(r.status).toBe(200);
    const frames = parseFrames(r.frames);
    expect(frames.map((f) => f.event)).toEqual(["begin", "done"]);
    const done = frames[1]?.data as { status: string; error?: string };
    expect(done.status).toBe("error");
    expect(done.error).toBeTruthy();
  });

  it("a run deleted before any hit streamed gets no done frame and does not come back", async () => {
    const id = mintId();
    fetchMock.mockImplementation(async () => {
      // The reader deletes the run while the model is still thinking, before
      // a single byte of its answer has been read.
      await deleteRun(SEARCH_SLUG, id);
      return openRouterReply([HIT]);
    });
    const r = await callStreaming("POST", `/api/search/${SEARCH_SLUG}`, {
      id,
      criterion: "the prize the essay won",
    });
    const frames = parseFrames(r.frames);
    // The model's hits still stream — the route has no cheap way to notice a
    // delete mid-hit without a store read per hit, so it doesn't try.
    expect(frames.map((f) => f.event)).toEqual(["begin", "hit"]);
    expect(frames.some((f) => f.event === "done")).toBe(false);
    expect(await loadRuns(SEARCH_SLUG)).toHaveLength(0);
  });

  it("a run deleted after a hit streamed, but before the search finishes, still gets no done frame", async () => {
    const id = mintId();
    const firstChunk = `data: ${JSON.stringify({
      choices: [{ delta: { content: `{"hits":[${JSON.stringify(HIT)}` } }],
    })}\n\n`;
    const restChunk =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "]}" } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n` +
      "data: [DONE]\n\n";
    let pulls = 0;
    fetchMock.mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        async pull(c) {
          pulls++;
          if (pulls === 1) {
            c.enqueue(new TextEncoder().encode(firstChunk));
            return;
          }
          if (pulls === 2) {
            // The delete lands between the first hit arriving and the search
            // finishing — after the reader has already seen it highlighted.
            await deleteRun(SEARCH_SLUG, id);
            c.enqueue(new TextEncoder().encode(restChunk));
            return;
          }
          c.close();
        },
      }),
    } as unknown as Response);

    const r = await callStreaming("POST", `/api/search/${SEARCH_SLUG}`, {
      id,
      criterion: "the prize the essay won",
    });
    const frames = parseFrames(r.frames);
    expect(frames.map((f) => f.event)).toEqual(["begin", "hit"]);
    expect(frames.some((f) => f.event === "done")).toBe(false);
    expect(await loadRuns(SEARCH_SLUG)).toHaveLength(0);
  });
});
