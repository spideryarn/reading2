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
import { cp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "../src/routes.js";
import { beginAnswer, createComment, loadComments, patchComment } from "../src/comments.js";
import { loadShelf } from "../src/shelf.js";
import { beginRun, deleteRun, loadRuns } from "../src/searches.js";
import { mintId } from "../src/ids.js";
import { originalUrl } from "../src/vercel.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const SLUG = "test-routes-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
/** The committed fixture, which several blocks here copy in to have an article
    with real block ids. It used to arrive for free — an unknown slug fell
    through to `example/` — and that fallback is gone (src/api.ts §
    `candidateDirs`), because it also answered a reader's own half-built article
    with the fixture's prose. */
const EXAMPLE = path.resolve(import.meta.dirname, "..", "example");
afterEach(() => rm(DIR, { recursive: true, force: true }));

/** A comment as a route answers with it — the fields these tests read off one. */
interface ReplyComment {
  id: string;
  status: string;
  error?: string;
  /** The reader's own words. Absent on a bare bookmark. */
  body?: string;
  threadId?: string;
}

interface Reply {
  handled: boolean;
  status: number;
  /* Named where a test needs the field to have a *type* — an id that goes into
     a URL, a status compared against a literal. Everything else is `unknown`,
     which `expect` takes happily: this is a fixture for driving `handleApi`,
     and a second, drifting copy of every response shape in the app is worth
     less than it costs. */
  body: {
    error?: string;
    comments?: ReplyComment[];
    comment?: ReplyComment;
    [key: string]: unknown;
  };
}

/** Drive `handleApi` with a fake request/response pair. */
async function call(
  method: string,
  url: string,
  body?: unknown,
  /** Omitted means "signed in". The gate's own cases below pass their own. */
  verify?: Parameters<typeof handleApi>[2],
  /** Omitted means the authenticated header. `{}` is an anonymous request. */
  headers: Record<string, string> = AUTHED_HEADERS,
): Promise<Reply> {
  const payload = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers },
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

  const handled = await handleApi(req, res, verify ?? acceptAny);
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
    { method, url, headers: AUTHED_HEADERS },
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

  await handleApi(req, res, acceptAny);
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

  it("stores a purpose and answers with what it stored, not with what was sent", async () => {
    await makeArticle();
    const r = await call("PATCH", `/api/library/${SHELF}`, { purpose: "  the evidence\r\n " });
    expect(r.status).toBe(200);
    /* Normalised on the way in, and answered from the store rather than echoed.
       A box showing one string while every prompt carries another is the exact
       failure this feature is arranged around. */
    expect(r.body.purpose).toBe("the evidence");
    expect((await loadShelf(SHELF)).purpose).toBe("the evidence");
  });

  it("keeps the purpose off the shelf card", async () => {
    /* Deliberate, and worth pinning: `LibraryEntry` is what every card on the
       homepage is built from, and only the metadata page renders this. The same
       argument `titleOverridden` already makes about the superseded title, one
       field further on. */
    await makeArticle();
    const r = await call("PATCH", `/api/library/${SHELF}`, { purpose: "the evidence" });
    expect(r.body.entry).not.toHaveProperty("purpose");
  });

  it("clears the purpose on null", async () => {
    await makeArticle();
    await call("PATCH", `/api/library/${SHELF}`, { purpose: "the evidence" });
    const r = await call("PATCH", `/api/library/${SHELF}`, { purpose: null });
    expect(r.body.purpose).toBeNull();
  });

  it("refuses a purpose that is not a string or null", async () => {
    await makeArticle();
    expect((await call("PATCH", `/api/library/${SHELF}`, { purpose: 42 })).status).toBe(400);
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
  /* **A file of its own, not `data/reader.json`.** Every other reader-state
     file is under `data/<slug>/`, so a test uses a fixture slug and cleans up
     without touching anything real. The global profile has no such escape, and
     the first version of this block wrote to the developer's own and deleted it
     afterwards — which, with several agents running `npm test` in one working
     tree, wiped Greg's profile mid-session and looked exactly like the save not
     working. src/profile.ts reads the path at call time for this. */
  const FILE = path.resolve(import.meta.dirname, "..", "data", "_test-reader.json");
  beforeEach(() => {
    process.env.SPIDERYARN_READER_FILE = FILE;
  });
  afterEach(() => {
    delete process.env.SPIDERYARN_READER_FILE;
    return rm(FILE, { force: true });
  });

  it("answers null for a reader who has written nothing", async () => {
    const r = await call("GET", "/api/reader");
    expect(r.status).toBe(200);
    /* **`purpose: null` rather than no `purpose` at all**, and this is a
       whole-body `toEqual` so that stays true: a field that is present on some
       responses and absent on others is the one a boundary drops silently, and
       the panel would then read "no purpose written" off a question nobody
       asked. There is no slug here, so there is no article to have one.
       docs/plans/260830c-profile-panel.md. */
    expect(r.body).toEqual({
      profile: null,
      purpose: null,
      purposeFailed: false,
      hasProfile: false,
      /* **Present and null, like `purpose`.** Off is the absence of a date, and
         a field that is simply missing when the switch is off is the one a
         boundary drops — leaving a client to read "not sent" as "off" by luck
         rather than by contract. docs/project/experimental-features.md. */
      experimentalSince: null,
    });
  });

  it("stores a profile and reads it back", async () => {
    const w = await call("PATCH", "/api/reader", { profile: "  A physicist.  " });
    expect(w.status).toBe(200);
    // Normalised on the way in, so the value stored is the value hashed.
    /* **Both fields, whichever one the body changed.** A reply whose shape
       follows the request is one a client reads as "the other thing is unset".
       `routes.ts` § patchReader. */
    expect(w.body).toEqual({ profile: "A physicist.", experimentalSince: null });
    expect((await call("GET", "/api/reader")).body).toEqual({
      profile: "A physicist.",
      purpose: null,
      purposeFailed: false,
      hasProfile: true,
      experimentalSince: null,
    });
  });

  it("treats null and blank as clearing it", async () => {
    await call("PATCH", "/api/reader", { profile: "A physicist." });
    expect((await call("PATCH", "/api/reader", { profile: null })).body).toEqual({
      profile: null,
      experimentalSince: null,
    });
    await call("PATCH", "/api/reader", { profile: "A physicist." });
    expect((await call("PATCH", "/api/reader", { profile: "   " })).body).toEqual({
      profile: null,
      experimentalSince: null,
    });
  });

  it("refuses a body that changes nothing, rather than answering 200", async () => {
    /* A request naming neither field meant something else — and a 200 would
       report a save that did not happen. */
    const r = await call("PATCH", "/api/reader", {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Nothing to change/);
  });

  it("counts an article's own purpose as a profile, even with no global one", async () => {
    /* The controls ask this question to decide whether to appear at all, and
       asking only about the global box hid them from a reader who had filled in
       "why you're reading this one" — who then could not opt out of something
       they could not see. GPT Sol's review of the built code, 2026-08-26. */
    const SLUG = "test-routes-purpose-only";
    const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
    await cp(path.resolve(import.meta.dirname, "..", "example"), DIR, { recursive: true });
    try {
      await call("PATCH", `/api/library/${SLUG}`, { purpose: "the evidence" });
      // No global profile at all, and — with no slug — nothing to say about a
      // purpose either, however much of one this article has.
      expect((await call("GET", "/api/reader")).body).toEqual({
        profile: null,
        purpose: null,
        purposeFailed: false,
        hasProfile: false,
        experimentalSince: null,
      });
      /* …and the article still has one. `purpose` comes back as the reader's
         own words rather than as a flag, because the panel prints each box
         separately with its own way in to edit it — the joined string
         `renderProfile` builds carries our prefixes and there is no honest way
         back from it to the two boxes. docs/plans/260830c-profile-panel.md. */
      const r = await call("GET", `/api/reader?slug=${SLUG}`);
      expect(r.body).toEqual({
        profile: null,
        purpose: "the evidence",
        purposeFailed: false,
        hasProfile: true,
        experimentalSince: null,
      });
    } finally {
      await rm(DIR, { recursive: true, force: true });
    }
  });

  /* -------------------------------------------- the experimental switch -- */

  it("is off until it is switched on, and says when it was", async () => {
    const on = await call("PATCH", "/api/reader", { experimental: true });
    expect(on.status).toBe(200);
    const since = (on.body as unknown as { experimentalSince: string | null }).experimentalSince;
    /* A date, not `true`. The column stores when, so the wire carries when —
       one fact, one spelling, and no boolean beside it to drift out of step.
       docs/project/experimental-features.md. */
    expect(since).toBeTypeOf("string");
    expect(Number.isNaN(Date.parse(since as string))).toBe(false);

    const read = await call("GET", "/api/reader");
    expect((read.body as unknown as { experimentalSince: string | null }).experimentalSince).toBe(
      since,
    );
  });

  it("does not move the date when it is switched on twice", async () => {
    /* **The value answers *since when*.** Re-asserting a switch that is already
       on — a second tab, a double click, a retried request — must not restamp
       it, or the date silently means "when did the client last send true" and
       the one question it exists to answer has no answer. */
    const first = await call("PATCH", "/api/reader", { experimental: true });
    const since = (first.body as unknown as { experimentalSince: string }).experimentalSince;
    const again = await call("PATCH", "/api/reader", { experimental: true });
    expect((again.body as unknown as { experimentalSince: string }).experimentalSince).toBe(since);
  });

  it("clears the date when it is switched off", async () => {
    await call("PATCH", "/api/reader", { experimental: true });
    expect((await call("PATCH", "/api/reader", { experimental: false })).body).toEqual({
      profile: null,
      experimentalSince: null,
    });
    expect(
      (await call("GET", "/api/reader")).body as unknown as { experimentalSince: null },
    ).toMatchObject({ experimentalSince: null });
  });

  it("keeps the profile and the switch out of each other's way", async () => {
    /* The regression this pins is a real one that was live for the length of
       one edit: the filesystem writer built the whole file from its single
       argument, so saving a profile deleted the switch — and both writes
       reported success. src/profile.ts § patchReaderFile. */
    await call("PATCH", "/api/reader", { experimental: true });
    await call("PATCH", "/api/reader", { profile: "A physicist." });
    const body = (await call("GET", "/api/reader")).body as unknown as {
      profile: string | null;
      experimentalSince: string | null;
    };
    expect(body.profile).toBe("A physicist.");
    expect(body.experimentalSince).toBeTypeOf("string");

    // …and the other way round: changing the switch must not touch the prose.
    await call("PATCH", "/api/reader", { experimental: false });
    expect(
      ((await call("GET", "/api/reader")).body as unknown as { profile: string | null }).profile,
    ).toBe("A physicist.");
  });

  it("refuses to change both halves in one request", async () => {
    /* Two store operations and no transaction across them: a body carrying both
       could save the profile, fail on the switch, and answer with an error
       having already committed half of what it was asked. No client sends both.
       GPT Sol's review of the built code, 2026-08-31. */
    const r = await call("PATCH", "/api/reader", { profile: "A physicist.", experimental: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/one at a time/);
    // …and nothing was stored on the way to refusing.
    expect((await call("GET", "/api/reader")).body).toMatchObject({
      profile: null,
      experimentalSince: null,
    });
  });

  it("refuses anything but a boolean for the switch", async () => {
    /* `"false"` and `0` are exactly what a client sends by mistake, and
       truthiness would answer both confidently and one of them backwards. */
    for (const bad of ["true", 1, 0, null]) {
      expect((await call("PATCH", "/api/reader", { experimental: bad })).status, `${bad}`).toBe(400);
    }
    // Nothing was stored on the way past.
    expect(
      ((await call("GET", "/api/reader")).body as unknown as { experimentalSince: string | null })
        .experimentalSince,
    ).toBeNull();
  });

  it("refuses a profile that is not a string or null", async () => {
    expect((await call("PATCH", "/api/reader", { profile: 42 })).status).toBe(400);
    expect((await call("PATCH", "/api/reader", '"hello"')).status).toBe(400);
  });

  it("refuses one longer than the cap, and stores nothing", async () => {
    const r = await call("PATCH", "/api/reader", { profile: "x".repeat(2000) });
    expect(r.status).toBe(400);
    expect((await call("GET", "/api/reader")).body).toEqual({
      profile: null,
      purpose: null,
      purposeFailed: false,
      hasProfile: false,
      experimentalSince: null,
    });
  });

  it("normalises what it hands back, so hasProfile and the text cannot disagree", async () => {
    /* `hasProfile` is asked of `renderProfile`, which trims — so a value that
       reaches the route un-normalised comes back truthy beside a
       `hasProfile: false`, and the profile panel draws a box containing three
       spaces where it should say nothing is written. GPT Sol, 2026-08-30.

       **It has to be the PURPOSE, and that is the whole fixture.** The global
       profile cannot reach this state: `loadReaderProfile` normalises on read
       (src/profile.ts). The shelf normalises on *write* and reads raw
       (src/shelf.ts § read), so a `shelf.json` written before that rule existed
       — or edited by hand — is the one way in. Writing it directly rather than
       through PATCH for exactly that reason: PATCH would clean it on the way
       past and the fixture would be testing nothing, which is what the first
       version of this test did. */
    const SLUG = "test-routes-dirty-purpose";
    const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
    await cp(path.resolve(import.meta.dirname, "..", "example"), DIR, { recursive: true });
    try {
      await writeFile(
        path.join(DIR, "shelf.json"),
        JSON.stringify({ opens: 0, purpose: "   \r\n  " }),
        "utf8",
      );
      expect((await call("GET", `/api/reader?slug=${SLUG}`)).body).toEqual({
        profile: null,
        purpose: null,
        purposeFailed: false,
        hasProfile: false,
        experimentalSince: null,
      });
    } finally {
      await rm(DIR, { recursive: true, force: true });
    }
  });

  it("keeps the two halves apart, rather than the string the model is given", async () => {
    /* The panel prints each box under its own heading, so it needs the two
       values as the reader typed them. What it must NOT be handed is
       `renderProfile`'s output — "About the reader: …\nWhy they are reading
       this piece: …" — whose prefixes are ours and which cannot be taken back
       apart into two boxes. This asserts the shape stays split.
       docs/plans/260830c-profile-panel.md. */
    const SLUG = "test-routes-both-halves";
    const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
    await cp(path.resolve(import.meta.dirname, "..", "example"), DIR, { recursive: true });
    try {
      await call("PATCH", "/api/reader", { profile: "A physicist." });
      await call("PATCH", `/api/library/${SLUG}`, { purpose: "the evidence" });
      expect((await call("GET", `/api/reader?slug=${SLUG}`)).body).toEqual({
        profile: "A physicist.",
        purpose: "the evidence",
        purposeFailed: false,
        hasProfile: true,
        experimentalSince: null,
      });
    } finally {
      await rm(DIR, { recursive: true, force: true });
    }
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
 * **The reason this survived is how a shallow attempt failed.** `../../etc`
 * found no blocks.json, so the loader fell through to the `example/` fixture
 * and served it — which looks exactly like a refusal. You had to traverse all
 * the way to a directory you control before the behaviour differed at all, so a
 * test that stopped short reported the endpoint safe. Hence the long escapes
 * below: a short one here would pass against the vulnerable code.
 *
 * That fallback was taken away on 2026-08-30 (src/api.ts § `candidateDirs`), so
 * a shallow attempt now 404s honestly. The long escapes stay: they are what
 * proves the *guard* refuses, and a 404 that happens to be right is not the
 * same evidence as a 400 that was reached before any path was joined.
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

  it("404s an unknown slug, rather than serving the example fixture under it", async () => {
    /* This test asserted the opposite until 2026-08-30, and was right about the
       code: `loadArticle` tried `data/<slug>/` and then `example/`, so every
       slug in a dev checkout resolved with a 200. What it made unreachable from
       here was the 404 — and what the 200 hid was a reader being shown somebody
       else's prose under their own address (src/api.ts § `candidateDirs`). */
    const r = await call("GET", "/api/article/no-such-article-anywhere");
    expect(r.status).toBe(404);
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
  /* A `pending` row now has to be *made* pending, because creating one is free
     and lands as `none`. `beginAnswer` is the only thing that writes `pending`
     — which is exactly the property the sweep depends on — and it refuses a
     `none` row, so this walks the whole way round: make the mark, give it an
     answer as the old world would have, then re-ask it. */
  const orphaned = async (id: string) => {
    await createComment(SLUG, { blockId: "spya-k3m9qt", quote: "the hard problem", start: 12, id });
    await patchComment(SLUG, id, { status: "done", answer: "an old explanation" });
    return (await beginAnswer(SLUG, id)).comment;
  };

  it("comes back as an error the reader can retry, not an eternal spinner", async () => {
    // What a crash mid-answer leaves on disk. Since `pending` is written before
    // the model call, this is indistinguishable from a live request *on disk* —
    // only the running process knows, and this one is not answering it.
    const orphan = await orphaned("spya-k3m9qt");
    expect(orphan.status).toBe("pending");

    const r = await call("GET", `/api/comments/${SLUG}`);
    expect(r.status).toBe(200);
    expect(r.body.comments?.[0]?.status).toBe("error");
    expect(r.body.comments?.[0]?.error).toMatch(/server stopped/);

    // And it is written down, so a second reader sees the same thing.
    expect((await loadComments(SLUG))[0]?.status).toBe("error");
  });

  it("leaves an already-answered comment alone", async () => {
    await orphaned("spya-k3m9qt");
    await call("GET", `/api/comments/${SLUG}`);
    const first = await call("GET", `/api/comments/${SLUG}`);
    // Swept once, then stable — the sweep must not keep rewriting the file.
    expect(first.body.comments?.[0]?.status).toBe("error");
    expect(first.body.comments).toHaveLength(1);
  });

  it("never touches a bookmark, because a bookmark is not a lost answer", async () => {
    /* The sweep's filter is `status === "pending"`, so `none` is invisible to
       it — and this test is deliberately NOT evidence that the filter is right,
       because it passes the moment `none` exists. What it guards is the
       *reverse* change: somebody widening the filter to "anything without an
       answer" would turn every bookmark on the shelf into an error. */
    await createComment(SLUG, { blockId: "spya-k3m9qt", quote: "q", start: 0, body: "mine" });
    const r = await call("GET", `/api/comments/${SLUG}`);
    expect(r.body.comments?.[0]?.status).toBe("none");
    expect(r.body.comments?.[0]?.error).toBeUndefined();
    expect(r.body.comments?.[0]?.body).toBe("mine");
  });
});

describe("making a comment costs nothing", () => {
  /* **A real block, and a quote really inside it.** The route checks the anchor
     against the article, so a made-up passage is a 400 rather than a stored
     comment nothing can draw. These three come from `example/blocks.json`,
     which is why the fixture is copied under this slug — the same source `HIT`
     below uses, for the same reason. */
  const BLOCK = "spya-gp3g6s";
  const QUOTE = "Berggruen Prize";
  const AT = 30;

  // The article the anchors are checked against. `data/<SLUG>/` is torn down by
  // the file-level afterEach, so this rebuilds it before each case.
  beforeEach(() => cp(EXAMPLE, DIR, { recursive: true }));

  /* **The value that crosses the wire.** Both halves of this app can be right
     about a body and still disagree — the store keeps it, the route drops it,
     and each side's own tests pass. So this goes in through the HTTP route and
     comes back out through the store, and nothing in between is mocked. */
  it("stores the reader's words, and reads them back off disk", async () => {
    const r = await call("POST", `/api/comments/${SLUG}`, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
      body: "  this is the bit I doubt  ",
    });
    expect(r.status).toBe(201);
    expect(r.body.comment?.status).toBe("none");
    // Trimmed once, in one place, so the two stores cannot disagree about it.
    expect(r.body.comment?.body).toBe("this is the bit I doubt");

    const stored = (await loadComments(SLUG))[0];
    expect(stored?.body).toBe("this is the bit I doubt");
    expect(stored?.id).toBe(r.body.comment?.id);
  });

  it("treats a body of nothing but spaces as no body at all", async () => {
    const r = await call("POST", `/api/comments/${SLUG}`, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
      body: "   ",
    });
    expect(r.status).toBe(201);
    // Absent, not `""` — `exactOptionalPropertyTypes` and the store round-trip
    // both treat those as different, and the database refuses the empty one.
    expect("body" in (await loadComments(SLUG))[0]!).toBe(false);
  });

  it("bookmarks a passage with nothing written on it", async () => {
    const r = await call("POST", `/api/comments/${SLUG}`, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
    });
    expect(r.status).toBe(201);
    expect(await loadComments(SLUG)).toHaveLength(1);
  });

  it("refuses a quote that is not in the block it names", async () => {
    // The check the chat route's `checkAnchor` does, written out here because
    // that one is weaker than it looks — it never verifies the offset, and on
    // its own would accept an empty quote. GPT Sol, reviewing the plan.
    const r = await call("POST", `/api/comments/${SLUG}`, {
      blockId: BLOCK,
      quote: "words that are not in this article at all",
      start: 0,
    });
    expect(r.status).toBe(400);
    expect(await loadComments(SLUG)).toEqual([]);
  });

  it("refuses an id that already belongs to a different comment", async () => {
    const first = await call("POST", `/api/comments/${SLUG}`, {
      id: "spya-k3m9qt",
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
    });
    expect(first.status).toBe(201);
    const clash = await call("POST", `/api/comments/${SLUG}`, {
      id: "spya-k3m9qt",
      blockId: BLOCK,
      quote: "Essay Competition",
      start: 0,
    });
    expect(clash.status).toBe(409);
    // The stored one is untouched, which is the half that matters.
    expect((await loadComments(SLUG))[0]?.quote).toBe(QUOTE);
  });

  it("will not answer a comment that was never a question", async () => {
    const made = await call("POST", `/api/comments/${SLUG}`, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
    });
    const r = await call("POST", `/api/comments/${SLUG}/${made.body.comment?.id}/answer`, {});
    expect(r.status).toBe(409);
  });

  it("edits the words, and clearing them leaves the mark behind", async () => {
    const made = await call("POST", `/api/comments/${SLUG}`, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
      body: "first thought",
    });
    const id = made.body.comment?.id;
    const edited = await call("PATCH", `/api/comments/${SLUG}/${id}`, { body: "second thought" });
    expect(edited.status).toBe(200);
    expect(edited.body.comment?.body).toBe("second thought");

    const cleared = await call("PATCH", `/api/comments/${SLUG}/${id}`, { body: null });
    expect(cleared.status).toBe(200);
    expect("body" in (await loadComments(SLUG))[0]!).toBe(false);
    // The mark is still there. Clearing the words is not deleting the comment.
    expect(await loadComments(SLUG)).toHaveLength(1);
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
  // model. The fixture's artefacts are copied under the slug so the search has
  // an article to run over; `searches.json` then lands beside them.
  const SEARCH_SLUG = "test-routes-search-fixture";
  const SEARCH_DIR = path.resolve(import.meta.dirname, "..", "data", SEARCH_SLUG);

  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    await rm(SEARCH_DIR, { recursive: true, force: true });
    await cp(EXAMPLE, SEARCH_DIR, { recursive: true });
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
      headers: new Headers(),
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
      headers: new Headers(),
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

/**
 * `PATCH /api/search/:slug/:id` — the reader's colour for one saved search.
 *
 * The route is four lines and three of them are the validation, which is where
 * the whole of the risk is: **slot 0 is a colour and `null` is a command**, so
 * every obvious shape of check gets one of them wrong. A truthiness test
 * refuses the first hue in the palette; a plain `!== undefined` lets a string
 * or a float through to a browser that will interpolate it into a custom
 * property name and paint nothing at all.
 */
describe("PATCH /api/search/:slug/:id", () => {
  const COLOUR_SLUG = "test-routes-colour-fixture";
  const COLOUR_DIR = path.resolve(import.meta.dirname, "..", "data", COLOUR_SLUG);
  afterEach(() => rm(COLOUR_DIR, { recursive: true, force: true }));

  async function saved(criterion = "arguments against"): Promise<string> {
    const { id } = await beginRun(COLOUR_SLUG, criterion);
    return id;
  }

  it("stores the slot the reader picked", async () => {
    const id = await saved();
    const r = await call("PATCH", `/api/search/${COLOUR_SLUG}/${id}`, { colour: 5 });
    expect(r.status).toBe(200);
    expect((await loadRuns(COLOUR_SLUG))[0]?.colour).toBe(5);
  });

  it("accepts slot 0, which a truthiness check would refuse", async () => {
    const id = await saved();
    const r = await call("PATCH", `/api/search/${COLOUR_SLUG}/${id}`, { colour: 0 });
    expect(r.status).toBe(200);
    expect((await loadRuns(COLOUR_SLUG))[0]?.colour).toBe(0);
  });

  it("takes null as 'put it back on automatic', not as a missing field", async () => {
    const id = await saved();
    await call("PATCH", `/api/search/${COLOUR_SLUG}/${id}`, { colour: 3 });
    const r = await call("PATCH", `/api/search/${COLOUR_SLUG}/${id}`, { colour: null });
    expect(r.status).toBe(200);
    const run = (await loadRuns(COLOUR_SLUG))[0];
    expect(run && "colour" in run).toBe(false);
  });

  it("refuses anything that is not a small whole number", async () => {
    const id = await saved();
    for (const colour of ["3", 2.5, -1, 64, true, {}]) {
      const r = await call("PATCH", `/api/search/${COLOUR_SLUG}/${id}`, { colour });
      expect(r.status).toBe(400);
    }
    // And nothing was written on the way to refusing.
    const run = (await loadRuns(COLOUR_SLUG))[0];
    expect(run && "colour" in run).toBe(false);
  });

  it("refuses a body with no colour in it at all", async () => {
    const id = await saved();
    const r = await call("PATCH", `/api/search/${COLOUR_SLUG}/${id}`, {});
    expect(r.status).toBe(400);
  });

  it("answers a body that is not an object with 400, not 500", async () => {
    /* A bare `null` is valid JSON, and destructuring it throws a TypeError the
       generic handler reports as a server fault. A malformed request answered
       as "this app is broken" is the one thing validation must never do — and
       it is the shape a client bug takes, so it would be reported as ours. */
    const id = await saved();
    for (const body of ["null", "[]", '"3"', "7"]) {
      const r = await call("PATCH", `/api/search/${COLOUR_SLUG}/${id}`, body);
      expect(r.status).toBe(400);
    }
  });

  it("answers with the whole list, the same shape as the delete beside it", async () => {
    const first = await saved("first");
    await saved("second");
    const r = await call("PATCH", `/api/search/${COLOUR_SLUG}/${first}`, { colour: 1 });
    expect((r.body as { runs?: unknown[] }).runs).toHaveLength(2);
  });

  it("refuses a slug that is not a path segment", async () => {
    const r = await call("PATCH", "/api/search/..%2Fetc/spya-k3m9qt", { colour: 1 });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

/**
 * The gate, at the seam it actually sits at.
 *
 * tests/auth.test.ts covers `requireUser` on its own. These two cover the thing
 * that has gone wrong in every project that ever built one: **the gate being
 * mounted somewhere that does not run.** Which is why they go through
 * `handleApi` rather than round it.
 *
 * The mutation test that makes them mean something is in
 * docs/plans/260826ae-auth-ui-and-production.md and has to be done by hand once: comment
 * out the `await requireUser(...)` line, watch the first of these go red, put
 * it back. A gate test that has never been seen to fail proves nothing —
 * docs/reusable/silent-success.md, and the memory with my name on it.
 */
describe("the gate", () => {
  it("refuses a request with no Authorization header", async () => {
    /* GET, because a 401 on a POST could equally be validation failing first —
       and the order matters: the gate runs before any body is read, so a
       stranger gets 401 rather than a diagnosis of their JSON. */
    const r = await call("GET", "/api/library", undefined, undefined, {});
    expect(r.status).toBe(401);
    /* Not an empty shelf. An empty library and a locked library look identical
       to a stranger and identical in a log, which is the failure this route
       would most plausibly have. */
    expect(r.body).not.toHaveProperty("articles");
  });

  it("refuses a request whose token does not check out", async () => {
    const no = async () => ({ ok: false, kind: "bad-token" }) as const;
    const r = await call("GET", "/api/library", undefined, no, {
      authorization: "Bearer nonsense",
    });
    expect(r.status).toBe(401);
  });

  /* Otherwise a gate that refuses absolutely everything passes both tests
     above and the suite still looks green. */
  it("lets a signed-in reader through", async () => {
    const r = await call("GET", "/api/library");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("articles");
  });
});

/**
 * The second gate: `/api/admin/` is the administrator's, and nobody else's.
 *
 * `tests/helpers/authed.ts` signs every other test in this file in as
 * `greg@gregdetre.com`, who *is* the administrator — so the interesting case
 * needs a verifier of its own. See src/admin.ts and docs/project/admin.md.
 */
describe("the admin gate", () => {
  /** Somebody else entirely, signed in perfectly properly. */
  const asSomebodyElse: Parameters<typeof handleApi>[2] = async () => ({
    ok: true,
    headers: new Headers(),
    claims: {
      /* Its own uuid, shared with nothing. Neither this file nor
         tests/admin.test.ts puts one in the database — both are about a
         refusal, which happens before any store is touched — but
         tests/fixture-ids.test.ts cannot tell that from a file that does, and a
         guard with an exception in it is a guard nobody trusts. */
      sub: "7c25b0d8-41ea-4f39-a6b2-5e8d3011c9f4",
      email: "someone@example.test",
      role: "authenticated",
      is_anonymous: false,
    },
  });

  it("refuses a signed-in reader who is not the administrator", async () => {
    const r = await call("GET", "/api/admin/users", undefined, asSomebodyElse);
    expect(r.status).toBe(403);
    /* Not an empty list. A page that says "no users" and a page that refused to
       answer look identical, and only one of them is true. */
    expect(r.body).not.toHaveProperty("users");
  });

  it("refuses them on any path under the prefix, not just the one that exists", async () => {
    /* The check guards the prefix rather than the route, so an admin endpoint
       added later is behind it whether or not whoever adds it remembers. A 403
       here rather than a 404 is what proves the order. */
    const r = await call("GET", "/api/admin/anything-at-all", undefined, asSomebodyElse);
    expect(r.status).toBe(403);
  });

  it("is not fooled by a query string", async () => {
    /* Matched on the path, not on `url` — a check that read the query string
       would be a check a `?` could be hidden behind. */
    const r = await call("GET", "/api/admin/users?by=email", undefined, asSomebodyElse);
    expect(r.status).toBe(403);
  });

  it("refuses them at the bare namespace too, with no trailing slash", async () => {
    /* `startsWith("/api/admin/")` alone would leave a future endpoint at
       exactly `/api/admin` outside the gate, which makes the whole claim —
       nothing under here can be added ungated — false. GPT Sol, 2026-08-27. */
    const r = await call("GET", "/api/admin", undefined, asSomebodyElse);
    expect(r.status).toBe(403);
  });

  it("does not swallow a route that merely starts with the same letters", async () => {
    /* The namespace is a path segment, not a prefix of a string. `/api/adminx`
       is somebody else's route, and if one is ever added it must not silently
       become the administrator's. A 404 is the right answer here, and it is the
       one that proves the check stopped at the slash. */
    const r = await call("GET", "/api/administer", undefined, asSomebodyElse);
    expect(r.status).toBe(404);
  });

  /* Otherwise a gate that refuses everybody passes every test above, and the
     suite is green while the page is dead.

     Under the filesystem store — which is what `npm test` runs with — the route
     answers **501**: "there are no user accounts on the filesystem store". That
     is the store refusing *after* the gate let the request through, so it is
     exactly the evidence wanted, and it is asserted exactly rather than as "not
     403". A 200 here would mean the suite had quietly acquired a database and
     this case had stopped testing what it says. */
  it("lets the administrator reach the route, where the store refuses instead", async () => {
    const r = await call("GET", "/api/admin/users");
    expect(r.status).toBe(501);
    expect(r.body.error).toMatch(/Postgres/);
  });

  it("is still the same path after production's rewrite", async () => {
    /* **The one decoding step the other cases cannot see.** On Vercel every
       `/api/*` request is rewritten to one function as
       `/api/index?__spy_path=<the path, encoded once>`, and `originalUrl` puts
       it back before `handleApi` sees anything (src/vercel.ts). So the address
       the gate matches on in production is the *output* of that function, and
       nothing in this file exercises it.

       Composed rather than assumed: the rewritten form is restored, the result
       is asserted, and then that exact string is handed to `handleApi`. GPT
       Sol asked for this in its review of the plan, 2026-08-27. */
    for (const encoded of ["admin/users", "admin%2Fusers", "admin"]) {
      const restored = originalUrl(`/api/index?__spy_path=${encoded}`);
      expect(restored, encoded).toMatch(/^\/api\/admin/);
      const r = await call("GET", restored ?? "", undefined, asSomebodyElse);
      expect(r.status, encoded).toBe(403);
    }
  });

  it("says nothing about users in any of its three refusals", async () => {
    /* Every refusal must be words rather than an empty list. A page that says
       "no accounts" and a page that could not answer look identical, and only
       one of them is true. Three ways in, three refusals: nobody signed in, the
       wrong person signed in, and the right person against a store that has no
       accounts to list. */
    const anonymous = await call("GET", "/api/admin/users", undefined, undefined, {});
    const stranger = await call("GET", "/api/admin/users", undefined, asSomebodyElse);
    const administrator = await call("GET", "/api/admin/users");
    expect([anonymous.status, stranger.status, administrator.status]).toEqual([401, 403, 501]);
    for (const r of [anonymous, stranger, administrator]) {
      expect(r.body).not.toHaveProperty("users");
      expect(r.body.error).toBeTruthy();
    }
  });
});
