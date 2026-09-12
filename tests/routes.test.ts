/**
 * The HTTP surface — src/routes.ts. See docs/project/comments.md.
 *
 * No server and no network: `handleApi` is a plain function over a request and
 * a response, which is the point of it not being Vite-specific. Nothing here
 * reaches the model — the requests under test are rejected before they get
 * anywhere near one.
 *
 * ## It ran on the filesystem store until 2026-09-04, and that is what B2 is
 *
 * The whole of it. Every route below was being driven against
 * `data/<throwaway slug>/` — 16 `cp`/`rm`/`writeFile` sites and 28 calls into
 * the filesystem-only readers and writers in `src/comments.ts`, `src/shelf.ts`
 * and `src/searches.ts` — so the broadest suite in the repo was making its
 * claims about the store that is not deployed
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § B2). It is now five articles seeded into Postgres by `scratchArticleInPg`,
 * and every read-back goes through `commentStore`, `shelfStore`, `searchStore`
 * or `readerStore`.
 *
 * **Three things changed meaning rather than merely moving**, and each says so
 * where it is:
 *
 * 1. the reader profile is a row keyed on the **owner** rather than a file this
 *    file could point somewhere safe (§ *the reader routes*);
 * 2. the three admin cases that asserted **501 because filesystem** now assert
 *    what an administrator actually gets — 200 and a list (§ *the admin gate*);
 * 3. an orphaned `pending` comment is one whose **lease has run out**, which is
 *    a distinction a directory could not hold (§ *a pending comment nobody is
 *    answering*), and it brought a case with it.
 *
 * ## Every mutation this file was watched under is written beside the
 * assertion it bears on
 *
 * Search for `**Mutation.**`. The rule is one per store-touching `describe`,
 * and the blocks that need none say why in their own headers — a body-shape
 * refusal that never reaches a store cannot be moved by breaking one.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { eq, sql } from "drizzle-orm";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articles, comments as commentsTable, readerProfiles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { originalUrl } from "../src/vercel.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/** The article the comment cases hang off, and the one the tweets route 404s on. */
const SLUG = "test-routes-fixture";
/** The shelf routes' own article, so their writes cannot reach anybody else's. */
const SHELF = "test-routes-shelf";
/** The per-article purpose the reader routes read. */
const PURPOSE_SLUG = "test-routes-purpose";
const SEARCH_SLUG = "test-routes-search-fixture";
const COLOUR_SLUG = "test-routes-colour-fixture";
/**
 * A slug nothing ever seeds.
 *
 * **The filesystem version did not need one**: it made an article by copying a
 * directory and unmade it by removing one, so "no such article" was simply the
 * state between two tests. A seeded article outlives the case that uses it, so
 * the absence has to be a name of its own — and it has to be a *different* name,
 * because asking a route about a slug that exists is not asking it about one
 * that does not.
 */
const MISSING = "test-routes-no-such-article";

await pgReady({
  suite: "tests/routes.test.ts",
  tables: ["spideryarn.articles", "spideryarn.comments", "spideryarn.search_runs"],
});

const { handleApi } = await import("../src/routes.js");
const { commentStore, readerStore, searchStore, shelfStore } = await import(
  "../src/store/index.js"
);


/**
 * The five articles, seeded once.
 *
 * **`SLUG` has its `tweets.json` taken out on the way in**, which the tweets
 * block below depends on and which is the trap
 * docs/plans/260903f-… § *The seeder ships the artefact your oracle asserts*
 * names: `scratchArticleInPg` clones `writes`, and `writes` has a thread. Its
 * *"says there is no thread yet"* case would then have been asserting 404
 * against an article that has one, and would have gone red rather than green —
 * but the same shape read the other way round is how an oracle passes over a
 * step that persisted nothing.
 */
let fixture: ScratchArticle | undefined;
let shelfArticle: ScratchArticle | undefined;
let purposeArticle: ScratchArticle | undefined;
let searchArticle: ScratchArticle | undefined;
let colourArticle: ScratchArticle | undefined;

/**
 * A real block of the seeded article, and a phrase really inside it.
 *
 * **Read off the fixture rather than written down.** They were `spya-gp3g6s`
 * and `"Berggruen Prize"` — a block of `example/blocks.json` — and the route
 * checks the anchor against the article, so a literal from a different source
 * article would make every 201 below a 400 and every 400 a pass for the wrong
 * reason. `ScratchArticle.blocks` says the same thing at the helper.
 */
let BLOCK = "";
let QUOTE = "";
const AT = 0;
/**
 * A **second** real anchor in the same block.
 *
 * One case needs a different comment that is still anchorable — the id clash —
 * and its old second quote ("Essay Competition") was another `example/`
 * literal. A quote the route cannot find is a 400, and a 400 would have made
 * *refuses an id that already belongs to a different comment* pass without ever
 * reaching the id check.
 */
let QUOTE2 = "";
const AT2 = 30;

beforeAll(async () => {
  fixture = await scratchArticleInPg(SLUG, {
    ownerId: TEST_OWNER,
    mutate: async (dir) => {
      const { rm } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await rm(join(dir, "tweets.json"), { force: true });
    },
  });
  expect(fixture.copied).toContain("blocks");
  /* The point of the `mutate` above, asserted rather than assumed: a step list
     that still carried `tweets` would make the 404 case below a lie. */
  expect(fixture.copied).not.toContain("tweets");
  shelfArticle = await scratchArticleInPg(SHELF, { ownerId: TEST_OWNER });
  purposeArticle = await scratchArticleInPg(PURPOSE_SLUG, { ownerId: TEST_OWNER });
  searchArticle = await scratchArticleInPg(SEARCH_SLUG, { ownerId: TEST_OWNER });
  colourArticle = await scratchArticleInPg(COLOUR_SLUG, { ownerId: TEST_OWNER });

  const block = fixture.blocks.find((b) => b.text.length > 80);
  if (!block) throw new Error("the fixture has no block long enough to quote");
  BLOCK = block.id;
  QUOTE = block.text.slice(AT, AT + 20);
  QUOTE2 = block.text.slice(AT2, AT2 + 20);
}, 120_000);

afterAll(async () => {
  /* **The reader profile is the one row this file writes that no article
     owns**, so nothing cascades it away — see § *the reader routes*. Deleted
     here, and then asserted gone, because "we tidied up" is a claim and the
     read is the result. */
  await getDb().delete(readerProfiles).where(eq(readerProfiles.ownerId, TEST_OWNER));
  expect(await asTestOwner(() => readerStore.readProfile())).toBeNull();
  expect(await asTestOwner(() => readerStore.readExperimental())).toBeNull();
  await fixture?.remove();
  await shelfArticle?.remove();
  await purposeArticle?.remove();
  await searchArticle?.remove();
  await colourArticle?.remove();
  await closeDb();
});

/** This article's comments, whatever a case left behind. */
async function commentsOn(slug: string): Promise<Awaited<ReturnType<typeof commentStore.load>>> {
  return asTestOwner(() => commentStore.load(slug));
}

/**
 * Everything the reader wrote on the fixture, gone.
 *
 * This used to be `rm -rf data/<slug>/` in a file-level `afterEach` — a fresh
 * article every test. The article now outlives the file, so what has to go is
 * the reader state written on it.
 */
afterEach(async () => {
  await asTestOwner(async () => {
    for (const c of await commentStore.load(SLUG)) await commentStore.remove(SLUG, c.id);
  });
});

/** A comment as a route answers with it — the fields these tests read off one. */
interface ReplyComment {
  id: string;
  blockId?: string;
  quote?: string;
  start?: number;
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

/**
 * **No mutation, and the reason is the block's own subject.** All three cases
 * are refusals decided by `readBody` and the field checks, above every store
 * call — there is nothing in Postgres to break that any of them could see, and
 * a store made to fail would leave a 400 a 400. The thing they assert about is
 * the *position* of `sse(res)` relative to the validation, which nothing can
 * move without rewriting the handler — the same limit `quiz-mark-route`
 * records against the same claim.
 */
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
  /**
   * **The fixture-visibility control for the whole file.**
   *
   * It used to look for `example` — the committed directory every block copied
   * — and under Postgres the shelf is what *this reader* owns, so the honest
   * question is whether the seeded article is on it. That makes this one of the
   * two cases (the other is *still serves an ordinary slug*) that can only pass
   * through a fixture the request can actually see, which is the guard against
   * the failure the plan calls the most likely one here: seed as one owner,
   * read as another, and every refusal in this file passes for the wrong reason
   * with the fixture completely invisible.
   *
   * **Mutation.** `src/store/pg.ts` § `listArticles`, the owner term deleted
   * from its `where` — `and(eq(articles.ownerId, currentOwnerId()), …)` reduced
   * to the archived predicate alone. **Stayed green, 127 passed.** A private
   * database with one seeded owner cannot tell a scoped query from an unscoped
   * one: every article in it belongs to `TEST_OWNER`, so a query that dropped
   * the filter returns the identical rows. Fourth file in stage B to find this,
   * and it is a property of the lane rather than of this file —
   * `tests/owner-isolation.test.ts` is what speaks for that predicate.
   *
   * **Blind to.** Ownership, per the above; and to *ordering*, the archived
   * split, and every field on the card — this asserts one slug is present, not
   * that the shelf is right. `tests/library-*.test.ts` cover the entry itself.
   */
  it("serves the shelf, with the seeded fixture on it", async () => {
    const r = await call("GET", "/api/library");
    expect(r.status).toBe(200);
    const articles = (r.body as unknown as { articles: { slug: string }[] }).articles;
    expect(articles.some((a) => a.slug === SLUG)).toBe(true);
  });
});

/**
 * The shelf routes, against one seeded article that outlives them.
 *
 * **`makeArticle()` is gone and the reset took its place.** Every case used to
 * copy `example/` in and the block's `afterEach` removed it, so each started
 * from a directory that had never been touched. A published revision cannot be
 * made and unmade eleven times for 300 ms a go, and it does not have to be: what
 * these cases change is four columns on `articles`, so the fixture is the
 * article and the reset is those columns.
 *
 * **`shelfState()` reads through the store, not off disk.** `loadShelf` from
 * src/shelf.ts is the filesystem adapter's own implementation exported from
 * `src/*.ts` — it `readFile`s `data/<slug>/shelf.json` unconditionally and
 * nothing in its name or its import path says so. Left alone it would have
 * answered `{ opens: 0 }` for every one of these, and the two cases that assert
 * exactly that would have passed while asserting nothing.
 */
describe("the shelf routes", () => {
  /** What the shelf now says, as the reader the request ran as. */
  const shelfState = (slug: string) => asTestOwner(() => shelfStore.read(slug));

  /**
   * The four columns these cases write, back to how a freshly seeded article
   * has them. `opens` is why it is SQL: the store's only way to change it is
   * `recordOpen`, which counts up.
   */
  beforeEach(async () => {
    await getDb()
      .update(articles)
      .set({ opens: 0, lastOpenedAt: null, titleOverride: null, purpose: null, archivedAt: null })
      .where(eq(articles.slug, SHELF));
  });

  /**
   * **Mutation.** `src/store/pg-shelf.ts` § `recordOpen`, with
   * `.set({ opens: sql\`${articles.opens} + 1\`, lastOpenedAt: sql\`now()\` })`
   * cut down to `.set({ lastOpenedAt: sql\`now()\` })` — the update still
   * matches a row, so the route still answers 204. **1 failed of 127**: *counts
   * an open, and says nothing back*, `expected { opens: +0, …(1) } to match
   * object { opens: 1 }`. The filesystem store has no such statement to break.
   *
   * **Blind to.** Whether the count is done *in Postgres* rather than
   * read-then-written here, which is the property `recordOpen`'s own comment is
   * about and which only two concurrent opens could show; and to `lastOpenedAt`,
   * which nothing below reads.
   */
  it("counts an open, and says nothing back", async () => {
    const r = await call("POST", `/api/library/${SHELF}/open`);
    expect(r.status).toBe(204);
    expect(await shelfState(SHELF)).toMatchObject({ opens: 1 });
  });

  it("refuses to count an open for an article that does not exist", async () => {
    /* And, crucially, creates nothing. On the filesystem this was the sharper
       claim: `src/shelf.ts` would happily write `data/<slug>/shelf.json` for any
       slug-shaped string, so without the existence check a typo left a directory
       behind for an article the server had just said it did not have.

       Postgres cannot be got into that state from here — `recordOpen` is an
       `UPDATE`, and an UPDATE over no rows writes nothing — so what is left to
       assert is that the slug is still unknown afterwards rather than newly
       half-known. `shelfStore.read` throwing `notFound` is that assertion, and
       it is also this block's proof that `MISSING` really is missing: a name
       that had quietly acquired a row would answer instead of throwing. */
    const r = await call("POST", `/api/library/${MISSING}/open`);
    expect(r.status).toBe(404);
    await expect(shelfState(MISSING)).rejects.toThrow(/no such article|not found|No article/i);
  });

  it("stores a purpose and answers with what it stored, not with what was sent", async () => {
    const r = await call("PATCH", `/api/library/${SHELF}`, { purpose: "  the evidence\r\n " });
    expect(r.status).toBe(200);
    /* Normalised on the way in, and answered from the store rather than echoed.
       A box showing one string while every prompt carries another is the exact
       failure this feature is arranged around. */
    expect(r.body.purpose).toBe("the evidence");
    expect((await shelfState(SHELF)).purpose).toBe("the evidence");
  });

  it("keeps the purpose off the shelf card", async () => {
    /* Deliberate, and worth pinning: `LibraryEntry` is what every card on the
       homepage is built from, and only the metadata page renders this. The same
       argument `titleOverridden` already makes about the superseded title, one
       field further on. */
    const r = await call("PATCH", `/api/library/${SHELF}`, { purpose: "the evidence" });
    expect(r.body.entry).not.toHaveProperty("purpose");
  });

  it("clears the purpose on null", async () => {
    await call("PATCH", `/api/library/${SHELF}`, { purpose: "the evidence" });
    const r = await call("PATCH", `/api/library/${SHELF}`, { purpose: null });
    expect(r.body.purpose).toBeNull();
  });

  it("refuses a purpose that is not a string or null", async () => {
    expect((await call("PATCH", `/api/library/${SHELF}`, { purpose: 42 })).status).toBe(400);
  });

  it("refuses a PATCH with nothing in it, rather than answering 200", async () => {
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
    const r = await call("PATCH", `/api/library/${SHELF}`, { title: 42 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/title must be/);
  });

  it("refuses an archived flag that is not a boolean", async () => {
    // `"true"` is the shape a hand-written query string produces, and treating
    // it as truthy would mean `archived: "false"` archived the article.
    const r = await call("PATCH", `/api/library/${SHELF}`, { archived: "true" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/archived must be/);
  });

  it("changes NOTHING when one of two fields is invalid", async () => {
    /* The test this route was rewritten for. It used to write each field in
       turn, so this renamed the article and *then* answered 400 — a request
       that reports failure and changes your data. */
    const r = await call("PATCH", `/api/library/${SHELF}`, {
      title: "Should not stick",
      archived: "no",
    });
    expect(r.status).toBe(400);
    expect(await shelfState(SHELF)).toEqual({ opens: 0 });
  });

  it("applies both fields together when both are valid", async () => {
    const r = await call("PATCH", `/api/library/${SHELF}`, {
      title: "Both at once",
      archived: true,
    });
    expect(r.status).toBe(200);
    const state = await shelfState(SHELF);
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

/**
 * The reader's own profile and switch — one row, keyed on the owner.
 *
 * ## The isolation moved, and there was no equivalent to move it to
 *
 * This block used to point `SPIDERYARN_READER_FILE` at a throwaway path,
 * because the global profile is the one piece of reader state with no slug to
 * hide behind: *"the first version of this block wrote to the developer's own
 * and deleted it afterwards — which, with several agents running `npm test` in
 * one working tree, wiped Greg's profile mid-session and looked exactly like
 * the save not working."*
 *
 * `pg-reader.ts` keys every row on `currentOwnerId()` and there is no
 * scratch-root equivalent, so the answer is the **owner**: every request below
 * runs as `TEST_OWNER` (`acceptAny` authenticates as the local administrator),
 * every read-back runs inside `asTestOwner`, and the whole file is in the
 * `private-postgres` lane so that row is in a database minted for this run. On
 * the *shared* database `TEST_OWNER` is Greg's own account, which is the same
 * accident one layer down and the reason the lane entry says so out loud.
 * Settled in docs/plans/260903f-… § *Two design decisions*.
 *
 * The row is deleted **and asserted gone** in the file's `afterAll`. Nothing
 * cascades it away: it hangs off the owner, not off any article, so it is the
 * one thing here that would outlive every `article.remove()`.
 *
 * **Mutation.** `src/store/pg-reader.ts` § `writeProfile`, its
 * `.onConflictDoUpdate({ … })` replaced with `.onConflictDoNothing()` — the
 * upsert the file's own header argues for, turned into the *"keep serving the
 * FIRST thing the reader ever typed, for ever, while every write after it
 * reported success"* version. **2 failed of 129**, watched 2026-09-04: *treats
 * null and blank as clearing it*, whose `GET` after the clearing `PATCH` still
 * answers `profile: "A physicist.", hasProfile: true`; and *keeps the profile
 * and the switch out of each other's way*, `expected null to be 'A
 * physicist.'`. Those are the two cases that write the row twice, and so the
 * only two whose second write meets a conflict at all.
 *
 * **It was 1 of 127 until B3, and the case that did not fail is the whole
 * lesson.** *Treats null and blank as clearing it* asserted only the two echoed
 * `PATCH` replies, and `writeProfile` **returns its own argument** while
 * `PATCH /api/reader` answers with that — the reply is computed rather than
 * read back, so an upsert that wrote nothing whatever still answered
 * `profile: null`, which is exactly what a case named for *clearing* wanted to
 * see. B2 recorded that as a finding and left it green; B3 sends it round
 * through `GET`, for the same reason the identical `recolour` hole was closed
 * rather than written up.
 *
 * **Blind to.** Whether two servers can lose each other's edit, which is the
 * property the upsert exists for and which one process cannot show; and to
 * `writeExperimental`'s `coalesce` — *does not move the date when it is
 * switched on twice* covers the behaviour, but no mutation here reaches the SQL
 * that makes it true. And still to the *reply* on any write that is not written
 * twice: every other `PATCH` assertion in this block reads the echo, so a store
 * that dropped a first write would be visible only through the `GET` that
 * follows it.
 */
describe("the reader routes", () => {
  /** The one row this block writes, gone — so each case starts from nothing. */
  beforeEach(async () => {
    await getDb().delete(readerProfiles).where(eq(readerProfiles.ownerId, TEST_OWNER));
    await getDb()
      .update(articles)
      .set({ purpose: null })
      .where(eq(articles.slug, PURPOSE_SLUG));
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
    /* **Every clearing claim goes round through `GET`, and that is the whole
       point of the case.** `writeProfile` **returns its own argument** and
       `PATCH /api/reader` answers with that, so the two echoed replies below
       are computed rather than read back: an upsert that wrote nothing at all
       would answer `profile: null` just as cheerfully as one that cleared the
       row. Only a read can tell those apart, and this case is *named* for the
       clearing. B2 recorded that as a finding and left it green; B3 closes it,
       for the same reason the identical `recolour` hole was closed rather than
       written up. */
    await call("PATCH", "/api/reader", { profile: "A physicist." });
    /* The row is really there before it is cleared — otherwise "it is gone
       afterwards" is a sentence about a row that never existed, and every
       assertion below passes over a write that did nothing. */
    expect((await call("GET", "/api/reader")).body).toMatchObject({
      profile: "A physicist.",
      hasProfile: true,
    });

    expect((await call("PATCH", "/api/reader", { profile: null })).body).toEqual({
      profile: null,
      experimentalSince: null,
    });
    expect((await call("GET", "/api/reader")).body).toMatchObject({
      profile: null,
      hasProfile: false,
    });

    await call("PATCH", "/api/reader", { profile: "A physicist." });
    expect((await call("GET", "/api/reader")).body).toMatchObject({ profile: "A physicist." });
    expect((await call("PATCH", "/api/reader", { profile: "   " })).body).toEqual({
      profile: null,
      experimentalSince: null,
    });
    /* Whitespace is *clearing*, not storing three spaces — and the row says so
       rather than the reply. */
    expect((await call("GET", "/api/reader")).body).toMatchObject({
      profile: null,
      hasProfile: false,
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
    await call("PATCH", `/api/library/${PURPOSE_SLUG}`, { purpose: "the evidence" });
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
    const r = await call("GET", `/api/reader?slug=${PURPOSE_SLUG}`);
    expect(r.body).toEqual({
      profile: null,
      purpose: "the evidence",
      purposeFailed: false,
      hasProfile: true,
      experimentalSince: null,
    });
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
       profile cannot reach this state: `readProfile` normalises on read
       (src/store/pg-reader.ts, and src/profile.ts for the other half). The
       shelf normalises on *write* and reads raw (`shelfFrom` in
       src/store/pg.ts hands the column straight back), so a row written before
       that rule existed — or edited by hand — is the one way in.

       **The `writeFile` over `shelf.json` became an `UPDATE`, and it is the
       same fixture rather than a weaker one.** Writing it directly rather than
       through PATCH is the whole point: PATCH runs `normaliseProfileText` on
       the way past and the fixture would be testing nothing, which is what the
       first version of this test did. Postgres has no more of a route to a
       dirty purpose than the filesystem had — which is why this is SQL. */
    await getDb()
      .update(articles)
      .set({ purpose: "   \r\n  " })
      .where(eq(articles.slug, PURPOSE_SLUG));
    expect((await call("GET", `/api/reader?slug=${PURPOSE_SLUG}`)).body).toEqual({
      profile: null,
      purpose: null,
      purposeFailed: false,
      hasProfile: false,
      experimentalSince: null,
    });
  });

  it("keeps the two halves apart, rather than the string the model is given", async () => {
    /* The panel prints each box under its own heading, so it needs the two
       values as the reader typed them. What it must NOT be handed is
       `renderProfile`'s output — "About the reader: …\nWhy they are reading
       this piece: …" — whose prefixes are ours and which cannot be taken back
       apart into two boxes. This asserts the shape stays split.
       docs/plans/260830c-profile-panel.md. */
    await call("PATCH", "/api/reader", { profile: "A physicist." });
    await call("PATCH", `/api/library/${PURPOSE_SLUG}`, { purpose: "the evidence" });
    expect((await call("GET", `/api/reader?slug=${PURPOSE_SLUG}`)).body).toEqual({
      profile: "A physicist.",
      purpose: "the evidence",
      purposeFailed: false,
      hasProfile: true,
      experimentalSince: null,
    });
  });
});

/**
 * **No mutation: this is the route table, not a store.** Its one case asserts
 * that `/api/library/anything` is a 404 rather than a fall-through, which is
 * decided by pattern matching before anything is read. The library read itself
 * is mutated in *the library route* above.
 */
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
 *
 * ## The mutations, and the one that had to break three things at once
 *
 * **Mutation.** Three, because the first two both stayed green and the reason
 * they did is the finding.
 *
 * 1. `src/store/require-slug.ts` § `requireSlug`, `if (isSlug(slug)) return;`
 *    weakened to `if (slug) return;` — the *store's* guard gone. **Stayed
 *    green, 127 passed.**
 * 2. `src/routes.ts` § `slugPart`, `if (!isSlug(value)) throw httpError(400, …)`
 *    reduced to `if (false) …` — the *route's* guard gone. **Also stayed green,
 *    127 passed.**
 * 3. Both of those plus `src/api.ts` § `requireSlug`, the third copy, weakened
 *    the same way. **5 failed of 127** — every case in this block bar *still
 *    serves an ordinary slug*, plus *refuses a slug that is not a slug* in the
 *    shelf block and *refuses a slug that could climb out of data/* in the
 *    tweets one. All five `expected 404 to be 400`.
 *
 * **So this block proves that *some* guard refuses, and cannot say which.** The
 * three are belt and braces over each other — `src/api.ts`'s own comment says
 * so in as many words — and a mutation of any one is invisible from here. That
 * is the right design and a real limit on the evidence at the same time, and it
 * is worth knowing before somebody deletes a "redundant" check on the strength
 * of a green suite. The 404s in run 3 are also the honest news: with all three
 * off, a traversal under Postgres is a query for a slug nothing owns, not a
 * read outside the repository — the filesystem store is what made this class of
 * bug reachable, and the move is most of the fix.
 *
 * **Blind to.** Which layer answered, per the above; and to what a traversal
 * would have *done* — the original vulnerability was a planted `blocks.json`
 * coming back with HTTP 200, and no store the app can reach today has a path to
 * join, so this block is now about the refusal rather than about the escape.
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
    /* The guard has to be narrow enough to leave the app working, and this is
       the assertion that would catch it being too strict.

       **It is also the second of the two cases in this file that can only pass
       through a fixture the reader can see.** It named `example` — the
       committed directory — and every refusal above it is a 4xx that would go
       on being a 4xx if the seeded article were invisible to this request. The
       block is refusal-shaped, so it needs one case that is not. */
    expect((await call("GET", `/api/article/${SLUG}`)).status).toBe(200);
    expect((await call("GET", `/api/metadata/${SLUG}`)).status).toBe(200);
  });
});

/**
 * **No mutation, and one of these seven is a judgement rather than an
 * exemption.** Six are body-shape and route-table refusals with no store under
 * them. The seventh — *404s an unknown slug, rather than serving the example
 * fixture under it* — is a real store read, and the bug it pins is a
 * **filesystem** one: `loadArticle` tried `data/<slug>/` and then fell through
 * to `example/`, so every slug in a dev checkout resolved with a 200 and a
 * reader was shown somebody else's prose under their own address. Postgres has
 * no directory to fall through to; `currentRevision` finds a row or it does
 * not, and every way of breaking it that this case could see makes a *known*
 * slug 404 as well, which the block above catches. The move is what closed the
 * class, and this case is now a guard against somebody reopening it.
 */
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

  it("calls half an anchor 400", async () => {
    /* `{ blockId }` alone is a whole-block bookmark since 2026-09-12, so the
       missing field worth refusing is half of the pair — a quote with no offset
       draws a mark in the wrong place. */
    const r = await call("POST", `/api/comments/${SLUG}`, { blockId: "spya-k3m9qt", quote: "q" });
    expect(r.status).toBe(400);
    const s = await call("POST", `/api/comments/${SLUG}`, { blockId: "spya-k3m9qt", start: 0 });
    expect(s.status).toBe(400);
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

/**
 * **No mutation of its own, and its store read is a negative that cannot be
 * moved from underneath.** Both cases are 400s decided before `commentStore` is
 * called, and the read after each asks whether nothing was written — an
 * assertion a broken `create` satisfies just as well as a working one, since
 * the route never reaches it. What makes the read non-vacuous is that the same
 * `commentStore.load` is watched going red in *making a comment costs nothing*
 * below, so it is known to be able to see a row.
 */
describe("the anchor offset must be a real offset", () => {
  // A negative start silently drew the mark a few characters left of the words
  // it belonged to. Refusing it at the door is cheaper than defending every
  // reader of the value. See src/web/annotate.ts § resolveMark.
  // Not NaN: `JSON.stringify` turns it into `null`, so it never arrives as a
  // number at all and is caught by the missing-field check above.
  for (const start of [-1, 1.5]) {
    it(`rejects start = ${start}`, async () => {
      /* A **real** block and a quote really inside it, so the 400 is about the
         offset and nothing else. The literals here were `spya-k3m9qt` and "the
         hard problem" — an id of `example/blocks.json` — and against the seeded
         article they would have named a block that does not exist, which is a
         400 as well and would have made both cases pass for the wrong reason. */
      const r = await call("POST", `/api/comments/${SLUG}`, {
        blockId: BLOCK,
        quote: QUOTE,
        start,
      });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/non-negative integer/);
      // Nothing was written: a refused request must not leave a comment behind.
      expect(await commentsOn(SLUG)).toEqual([]);
    });
  }
});

/**
 * A pending comment nobody is answering — and under Postgres "nobody" is a
 * fact about a **lease** rather than about a process.
 *
 * **This is the block whose meaning changed most.** On the filesystem a
 * `pending` row was *"indistinguishable from a live request on disk — only the
 * running process knows"*, and the sweep errored every one it saw. The Postgres
 * store keeps a `lease_expires_at`, and `sweepPending` refuses to touch a row
 * whose lease is still running: an answer arriving on another machine is not an
 * orphan. So the orphan fixture has to age its own lease, and the distinction
 * earns a case of its own — *leaves a live attempt alone* below, which nothing
 * in the filesystem version could express.
 *
 * **Mutation.** `src/store/pg-comments.ts` § `sweepPending`, its lease
 * predicate deleted — the
 * `sql` line reading `lease_expires_at is null or lease_expires_at <=
 * clock_timestamp()` removed from the `and(...)`, leaving it to sweep every
 * `pending` row the way the filesystem store did. **1 failed of 127**: *leaves
 * a live attempt alone, because somebody else may be answering it*, `expected
 * 'error' to be 'pending'`. **That is the only case it can reach**, and it is
 * the one the move added: the other three either age the lease themselves or
 * never make one, so a sweep that ignored leases answers them identically. The
 * three inherited from the filesystem version would have watched this mutation
 * go green — read off the fixtures rather than re-run, which is the weaker kind
 * of evidence and is said so here rather than dressed up.
 *
 * **Blind to.** `keep`, the live-work set the route passes in: every case here
 * sweeps from a request that is answering nothing, so a sweep that ignored
 * `keep` entirely would pass. And to the *clearing* of `attempt_id` beside the
 * status, which nothing here reads back.
 */
describe("a pending comment nobody is answering", () => {
  /* A `pending` row now has to be *made* pending, because creating one is free
     and lands as `none`. `beginAnswer` is the only thing that writes `pending`
     — which is exactly the property the sweep depends on — and it refuses a
     `none` row, so this walks the whole way round: make the mark, give it an
     answer as the old world would have, then re-ask it.

     **"As the old world would have" is an `UPDATE` now, and it has to be.**
     `commentStore.patch` refuses a call with no attempt token (`MissingAttempt`),
     and the only way to get one is `beginAnswer`, which refuses a `none` row —
     so there is no path through the live store from a bookmark to a legacy
     explanation, which is the point: nothing makes one any more. The SQL below
     is the fixture, exactly as `patchComment` over a JSON file was. */
  const orphaned = async (id: string, opts: { live?: boolean } = {}) => {
    await asTestOwner(() =>
      commentStore.create(SLUG, { blockId: BLOCK, quote: QUOTE, start: AT, id }),
    );
    await getDb()
      .update(commentsTable)
      .set({ status: "done", answer: "an old explanation" })
      .where(eq(commentsTable.id, id));
    const { comment } = await asTestOwner(() => commentStore.beginAnswer(SLUG, id));
    if (!opts.live) {
      /* The process that took this lease is gone. `beginAnswer` stamps a live
         one, so an orphan has to be aged — which is the honest fixture: a crash
         mid-answer leaves a row whose lease nobody is renewing. */
      await getDb()
        .update(commentsTable)
        .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 hour'` })
        .where(eq(commentsTable.id, id));
    }
    return comment;
  };

  it("comes back as an error the reader can retry, not an eternal spinner", async () => {
    // What a crash mid-answer leaves in the database. Since `pending` is written
    // before the model call, the row alone cannot say whether anybody is still
    // working on it — the expired lease is what says nobody is.
    const orphan = await orphaned("spya-k3m9qt");
    expect(orphan.status).toBe("pending");

    const r = await call("GET", `/api/comments/${SLUG}`);
    expect(r.status).toBe(200);
    expect(r.body.comments?.[0]?.status).toBe("error");
    expect(r.body.comments?.[0]?.error).toMatch(/server stopped/);

    // And it is written down, so a second reader sees the same thing.
    expect((await commentsOn(SLUG))[0]?.status).toBe("error");
  });

  it("leaves a live attempt alone, because somebody else may be answering it", async () => {
    /* **The case the move brought with it.** On Vercel the process answering a
       question is not the process the next `GET` lands on, so a sweep that
       errored every `pending` row would bury an answer while the reader watched
       it arrive — the same shape as the referee sweep's grace period
       (docs/plans/260903f-… § *Two mutations stayed green*). The filesystem
       store had one process and no lease, so it could not have this case, and
       the three inherited ones cannot see the predicate that makes it true. */
    const live = await orphaned("spya-k3m9qt", { live: true });
    expect(live.status).toBe("pending");

    const r = await call("GET", `/api/comments/${SLUG}`);
    expect(r.body.comments?.[0]?.status).toBe("pending");
    expect((await commentsOn(SLUG))[0]?.status).toBe("pending");
  });

  it("leaves an already-answered comment alone", async () => {
    await orphaned("spya-k3m9qt");
    await call("GET", `/api/comments/${SLUG}`);
    const first = await call("GET", `/api/comments/${SLUG}`);
    // Swept once, then stable — the sweep must not keep rewriting the row.
    expect(first.body.comments?.[0]?.status).toBe("error");
    expect(first.body.comments).toHaveLength(1);
  });

  it("never touches a bookmark, because a bookmark is not a lost answer", async () => {
    /* The sweep's filter is `status === "pending"`, so `none` is invisible to
       it — and this test is deliberately NOT evidence that the filter is right,
       because it passes the moment `none` exists. What it guards is the
       *reverse* change: somebody widening the filter to "anything without an
       answer" would turn every bookmark on the shelf into an error. */
    await asTestOwner(() =>
      commentStore.create(SLUG, { blockId: BLOCK, quote: QUOTE, start: AT, body: "mine" }),
    );
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
     below uses, for the same reason.

     They are now the file-level `BLOCK`/`QUOTE`/`AT`, read off the seeded
     article in `beforeAll`. The literals `spya-gp3g6s` / "Berggruen Prize" were
     `example/blocks.json`'s and do not survive the move to `writes` — the route
     would answer 400 for an anchor it cannot find, and every 201 below would
     have become a 400 while the two cases that *want* a 400 went on passing.

     The article they are checked against is seeded once for the whole file; the
     file-level `afterEach` removes the comments a case wrote, which is what the
     `cp`/`rm` of `data/<SLUG>/` used to do by removing the article itself. */

  /* **The value that crosses the wire.** Both halves of this app can be right
     about a body and still disagree — the store keeps it, the route drops it,
     and each side's own tests pass. So this goes in through the HTTP route and
     comes back out through the store, and nothing in between is mocked.

     **Mutation.** `src/store/pg-comments.ts` § `create`, its `fields` object's
     `body: input.body ?? null` replaced by `body: null`. **3 failed of 129**,
     watched 2026-09-04: *stores the reader's words, and reads them back through
     the store* and *refuses a body patch that never says what the body is*
     here, and *never touches a bookmark, because a bookmark is not a lost
     answer* in the block above. All three `expected undefined to be …`.

     **This note used to say the route's 201 and echoed body were unchanged, so
     that "only the row is wrong". That is false, and the run says so.**
     `create` is `INSERT … RETURNING` put through `toComment`, and src/routes.ts
     answers with that result — so the echo loses the body too, and *stores the
     reader's words* fails on the route's own reply (`r.body.comment?.body`)
     three lines above the store read-back it was supposed to be evidence for.
     The mutation is real and it reaches SQL; what it does **not** show is the
     route-right/store-wrong divergence this case was written for. The two cases
     that do read a row are the other two: *refuses a body patch…* goes through
     `commentsOn`, and *never touches a bookmark…* through `GET`, and neither
     touches the create response at all. GPT Sol found the reasoning wrong in
     its review of B2; B3 re-ran it rather than reasoning it out again.

     **Blind to.** Everything about the anchor: `blockId`, `quote` and `start`
     are asserted through the route's *reply* rather than through the row, so a
     `create` that stored the wrong offset would pass every case in this block.
     And to the *edit*: *edits the words, and clearing them leaves the mark
     behind* stayed green, because `patchBody` writes the body a second time and
     puts back what `create` dropped — so this file covers the create path and
     the patch path separately and nothing here needs both to be right at once.
     `tests/store-comments-parity.test.ts` is what speaks for the round trip. */
  it("stores the reader's words, and reads them back through the store", async () => {
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

    const stored = (await commentsOn(SLUG))[0];
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
    expect("body" in (await commentsOn(SLUG))[0]!).toBe(false);
  });

  it("bookmarks a passage with nothing written on it", async () => {
    const r = await call("POST", `/api/comments/${SLUG}`, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
    });
    expect(r.status).toBe(201);
    expect(await commentsOn(SLUG)).toHaveLength(1);
  });

  it("bookmarks a whole paragraph from the gutter — no quote, no offset, read back the same", async () => {
    /* SPIDERYARN-READING2-37: the gutter's one-press bookmark. Through the real
       route and back off the store, because the anchor is two nullable columns
       and a `null` that crossed as a key would compare unequal to an absent
       one. docs/plans/260912c-gutter-bookmark-button-and-the-second-ellipsis.md. */
    const r = await call("POST", `/api/comments/${SLUG}`, { blockId: BLOCK });
    expect(r.status).toBe(201);
    expect(r.body.comment?.status).toBe("none");
    const stored = (await commentsOn(SLUG))[0]!;
    expect(stored.blockId).toBe(BLOCK);
    expect("quote" in stored).toBe(false);
    expect("start" in stored).toBe(false);
  });

  it("is idempotent on a whole-paragraph bookmark pressed twice under one id", async () => {
    // The same-Save comparison meets two absent quotes, which must be equal.
    // Minted rather than typed: a hand-written id that misses the alphabet is a
    // 400 for a reason that has nothing to do with this test.
    const { mintId } = await import("../src/ids.js");
    const id = mintId();
    const first = await call("POST", `/api/comments/${SLUG}`, { id, blockId: BLOCK });
    const again = await call("POST", `/api/comments/${SLUG}`, { id, blockId: BLOCK });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(await commentsOn(SLUG)).toHaveLength(1);
  });

  it("refuses a whole-paragraph bookmark on a block that is not in the article", async () => {
    const r = await call("POST", `/api/comments/${SLUG}`, { blockId: "spya-zzzzzz" });
    expect(r.status).toBe(400);
    expect(await commentsOn(SLUG)).toHaveLength(0);
  });

  it("shows whole-block bookmarks only to a client that opts into their anchor shape", async () => {
    /* An old open tab reads `c.quote.length`, so the default response must stay
       selection-only. The new client asks explicitly and must not have its own
       bookmark filtered out. GPT Sol's plan review of 260912c. */
    await call("POST", `/api/comments/${SLUG}`, { blockId: BLOCK });
    await call("POST", `/api/comments/${SLUG}`, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
    });

    const oldClient = await call("GET", `/api/comments/${SLUG}`);
    expect(oldClient.body.comments).toHaveLength(1);
    expect(oldClient.body.comments?.[0]).toMatchObject({ quote: QUOTE, start: AT });

    const newClient = await call("GET", `/api/comments/${SLUG}?anchors=whole-block`);
    expect(newClient.body.comments).toHaveLength(2);
    const whole = newClient.body.comments?.find((c) => !("quote" in c));
    expect(whole?.blockId).toBe(BLOCK);
    expect(whole && "start" in whole).toBe(false);
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
    expect(await commentsOn(SLUG)).toEqual([]);
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
      /* A **different but real** anchor: the route checks the passage before it
         checks the id, so a made-up quote here would be a 400 and this case
         would never reach the 409 it is named for. */
      quote: QUOTE2,
      start: AT2,
    });
    expect(clash.status).toBe(409);
    // The stored one is untouched, which is the half that matters.
    expect((await commentsOn(SLUG))[0]?.quote).toBe(QUOTE);
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
    expect("body" in (await commentsOn(SLUG))[0]!).toBe(false);
    // The mark is still there. Clearing the words is not deleting the comment.
    expect(await commentsOn(SLUG)).toHaveLength(1);
  });

  /**
   * **A patch that does not mention the body must not delete it.**
   *
   * `tidyBody(undefined)` is `null`, and both stores' `patchBody` then write
   * `body = null` unconditionally — so `PATCH {}`, or a `PATCH` carrying some
   * other field, answered **200 and destroyed the reader's words**, with
   * nothing erroring and nothing in the log. It was latent only because
   * `useComments.edit` is the sole caller and always sends `{ body }`; it stops
   * being latent the moment a second field is added to this route, which is
   * exactly what a careless version of the placement work would have done.
   * Found by reading, 2026-09-01, alongside
   * docs/plans/260901i-the-referee-places-the-passage-themselves.md.
   *
   * `{ body: null }` still clears — that is how a comment becomes a bare
   * bookmark, and the test above covers it. What is refused is a request with
   * **no `body` key at all**, where absent could mean either *clear it* or
   * *leave it* and the route must not guess.
   */
  it("refuses a body patch that never says what the body is", async () => {
    const made = await call("POST", `/api/comments/${SLUG}`, {
      blockId: BLOCK,
      quote: QUOTE,
      start: AT,
      body: "first thought",
    });
    const id = made.body.comment?.id;

    /* The last three are valid JSON that is not an object, and they are here
       because `"body" in raw` is a **TypeError** on a string or a number — a
       500 for a request that deserves a 400, which is a second bug wearing the
       first one's clothes. `readBody` hands back whatever JSON arrived, so "is
       this even a bag of fields" is a question the route has to ask. (The
       harness sends a string body as raw bytes, hence the quotes inside it.) */
    for (const sent of [
      {},
      { criterionId: "spya-k3m9qt", valence: -80 },
      { note: "hm" },
      '"hello"',
      "123",
      "[1, 2]",
    ]) {
      const r = await call("PATCH", `/api/comments/${SLUG}/${id}`, sent);
      expect(r.status, `${JSON.stringify(sent)} was not refused`).toBe(400);
      expect(r.body.error).toMatch(/\[cmt-body-missing\]/);
      // The words are still there, which is the whole point.
      expect(
        (await commentsOn(SLUG))[0]?.body,
        `${JSON.stringify(sent)} took the words with it`,
      ).toBe("first thought");
    }
  });
});

/**
 * The tweets route — reads only. Writing a thread is a job, not a request, so
 * there is no POST here to test and nothing in this file can reach a model.
 *
 * **This block is the one that met the seeder trap head-on.** It asks for a 404
 * from an article that has no thread, and the corpus article `scratchArticleInPg`
 * clones — `writes` — ships a `tweets.json`. The fixture's `mutate` deletes it
 * on the way in and `beforeAll` asserts the `tweets` step was not copied, so the
 * 404 is about the article rather than about a step that quietly did nothing.
 * Read the other way round, that is the trap
 * docs/plans/260903f-… names: *the seeder ships the artefact your oracle asserts*.
 *
 * **Mutation.** `src/store/pg.ts` § `loadTweets`, its
 * `const thread = found.revision.tweets as TweetThread | null` replaced by
 * `null` — the read that has stopped reading. **1 failed of 129**, watched
 * 2026-09-04: *hands back the thread of an article that has one*, `expected 404
 * to be 200`. The two 404 cases stayed green under it, which is the point.
 *
 * **B2 waived a mutation here, and the argument does not hold.** It said the
 * block's only store call was `loadTweets` answering *"nothing here"*, which is
 * what every plausible break of it also answers. But only `SLUG` had its
 * `tweets.json` taken out on the way in: the other four `scratchArticleInPg`
 * articles kept theirs, so a read that lost track of *which* article — or which
 * revision — it was asked about answers with **another article's thread**, which
 * is not "nothing here". GPT Sol, reviewing B2, 2026-09-04. The positive case
 * the file already had everything for is now here, and the pair of slugs is what
 * makes the distinction visible: one answers 404 and the other answers a thread,
 * in one run against one database.
 *
 * **Blind to.** *Which* thread. Every `scratchArticleInPg` article is a clone of
 * the same corpus article, so the four that kept a thread all carry the same
 * one — a read that fetched `SEARCH_SLUG`'s thread for `SHELF` would be
 * invisible here, and what the pair above can see is only a read that lost the
 * slug badly enough to answer for the article that has none. And to `stale`:
 * its type is asserted and its value is not, so the fingerprint arithmetic
 * (`tweetsStale`, the tree and the metadata head) is `tests/store-parity.test.ts`'s
 * to speak for.
 */
describe("the tweets route", () => {

  it("refuses a slug that could climb out of data/", async () => {
    // Not theoretical: `part()` percent-decodes, so `%2E%2E%2F` arrives as
    // `../` and `path.join` is happy to follow it. `loadTweets` calls `isSlug`
    // before it touches the filesystem — docs/project/ingest-queue.md#the-one-security-check.
    const r = await call("GET", `/api/tweets/${encodeURIComponent("../../../../etc")}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Not a slug/);
  });

  it("says there is no thread yet, and how to ask for one", async () => {
    // The fixture's `tweets` step was deliberately not copied (see the block
    // header), so this is a real article with no thread on it. 404 here is the
    // ordinary case, not a fault, so the message has to be actionable rather
    // than apologetic.
    const r = await call("GET", `/api/tweets/${SLUG}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/steps.*tweets/);
  });

  it("hands back the thread of an article that has one", async () => {
    /* **The positive half, and the block had none until B3.**

       Without it the block's whole claim was two 404s, and a `loadTweets` that
       had stopped reading anything at all would answer both of them correctly —
       "nothing here" is what a broken read says too. B2 waived a mutation on
       exactly that reasoning; the reasoning does not hold, because only `SLUG`
       had its `tweets.json` taken out on the way in. The other four
       `scratchArticleInPg` articles kept theirs, so a read that lost track of
       *which* article it was asked about would hand this thread back for `SLUG`
       as well — which is not "nothing here", and which the pair of cases can now
       see: one slug answers 404 and the other answers a thread, in the same
       lane, in the same run.

       `SHELF` rather than a sixth fixture: the shelf block writes opens on it
       and nothing writes its artefacts, so its thread is the corpus's own. */
    const r = await call("GET", `/api/tweets/${SHELF}`);
    expect(r.status).toBe(200);
    const body = r.body as unknown as {
      thread?: { tweets?: { text: string }[] };
      stale?: unknown;
      profileChanged?: unknown;
    };
    expect(body.thread?.tweets?.length).toBeGreaterThan(0);
    expect(typeof body.thread?.tweets?.[0]?.text).toBe("string");
    /* Both flags present and boolean. A read that answered with the thread
       alone would leave the panel unable to say *the article has moved under
       this* — and a missing field reads as `false`, which is the reassuring
       answer. `ThreadResponse` in src/types.ts. */
    expect(typeof body.stale).toBe("boolean");
    expect(typeof body.profileChanged).toBe("boolean");
  });

  it("does not answer to POST", async () => {
    // A thread is half a minute of model time. If this ever starts answering,
    // somebody has put a model call inside a request handler.
    //
    // 404 rather than a fall-through, as above — the assertion that matters is
    // that no thread came back.
    const r = await call("POST", `/api/tweets/${SLUG}`);
    expect(r.status).toBe(404);
    expect(r.body).not.toHaveProperty("thread");
  });
});

/**
 * `POST /api/search/:slug` — its own article and its own OpenRouter mock, so
 * stubbing `fetch` here cannot touch any other block in this file. None of the
 * rest reach a model.
 *
 * **The seed happens in the file's `beforeAll`, above this stub, and that is
 * not an accident of ordering.** `scratchArticleInPg` puts the raw source in
 * the Supabase bucket **over HTTP**, so a seed inside a test whose `fetch` is
 * stubbed fails with the stub's own answer and reads as a route bug — trap 3 in
 * docs/plans/260903f-… § *Two more traps*.
 *
 * **Mutation.** `src/store/pg-searches.ts` § `remove`, its
 * `and(eq(searchRuns.articleId, articleId), eq(searchRuns.id, runId))` reduced
 * to the `articleId` term alone, so a delete takes every run on the article
 * rather than the one named. **1 failed of 129**, watched 2026-09-04: *deletes
 * the run it was given, and leaves the reader's other search standing*,
 * `expected [] to deeply equal [ 'spya-qks0vp' ]`.
 *
 * **It stayed green at 127, and the reason was that every case here had one
 * run.** With one run on the article "delete this one" and "delete all of them"
 * are the same statement, and the two cases that called `remove` were both
 * asserting the run was *gone* — which both spellings achieve. B2 recorded that
 * as a finding; B3 adds the second run, which is the same repair the two-run
 * `recolour` case in the block below already got, and it is a few lines.
 *
 * **Blind to.** The *owner* scope on `remove`, for the reason every owner-term
 * mutation in this file is blind — one seeded owner in a private database, and
 * `tests/owner-isolation.test.ts` is what speaks for that predicate. And to
 * everything about `finish`: nothing here reads a completed run back out of the
 * store, only out of the frames.
 */
describe("POST /api/search/:slug is a stream too", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    /* The runs a previous case left, rather than a directory removed and
       re-copied. The article outlives the block; its saved searches do not. */
    await asTestOwner(async () => {
      for (const run of await searchStore.load(SEARCH_SLUG)) {
        await searchStore.remove(SEARCH_SLUG, run.id);
      }
    });
    process.env.OPENROUTER_API_KEY = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
  });

  /**
   * A block of the **seeded** article and a quote really inside it, so
   * `validateHits` (src/search.ts) keeps the hit rather than dropping it as
   * unquoted — a dropped hit means no `hit` frame and the first case below
   * fails on its frame list rather than on anything it is about.
   */
  const hit = () => ({
    blockId: BLOCK,
    quote: QUOTE,
    confidence: 88,
    reasoning: "quotes the passage",
  });

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
    fetchMock.mockResolvedValue(openRouterReply([hit()]));
    const r = await callStreaming("POST", `/api/search/${SEARCH_SLUG}`, {
      criterion: "the prize the essay won",
    });
    expect(r.status).toBe(200);
    const frames = parseFrames(r.frames);
    expect(frames.map((f) => f.event)).toEqual(["begin", "hit", "done"]);
    expect((frames[0]!.data as { status: string }).status).toBe("pending");
    expect((frames[1]!.data as { hit: { blockId: string } }).hit.blockId).toBe(BLOCK);
    const done = frames[2]!.data as { status: string; hits: unknown[] };
    expect(done.status).toBe("done");
    expect(done.hits).toHaveLength(1);
    /* **And the run is in the store, not only in the frames.** The three cases
       below assert a run is *absent*; without this one they would all pass over
       a `begin` that wrote nothing at all — the refusal-shaped-block trap
       docs/plans/260903f-… names, pointed at a stream. */
    expect(await asTestOwner(() => searchStore.load(SEARCH_SLUG))).toHaveLength(1);
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
      await asTestOwner(() => searchStore.remove(SEARCH_SLUG, id));
      return openRouterReply([hit()]);
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
    expect(await asTestOwner(() => searchStore.load(SEARCH_SLUG))).toHaveLength(0);
  });

  it("a run deleted after a hit streamed, but before the search finishes, still gets no done frame", async () => {
    const id = mintId();
    const firstChunk = `data: ${JSON.stringify({
      choices: [{ delta: { content: `{"hits":[${JSON.stringify(hit())}` } }],
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
            await asTestOwner(() => searchStore.remove(SEARCH_SLUG, id));
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
    expect(await asTestOwner(() => searchStore.load(SEARCH_SLUG))).toHaveLength(0);
  });

  it("deletes the run it was given, and leaves the reader's other search standing", async () => {
    /* **Two runs, because with one run on the article "delete this one" and
       "delete all of them" are the same statement.** Every other case in this
       block has exactly one, so dropping `eq(searchRuns.id, runId)` from the
       delete in `src/store/pg-searches.ts` § `remove` left all 127 of them
       green — the file could not tell *this* run from *these* runs. B2 recorded
       that as a finding; this is the case that closes it, and it is the same
       repair the two-run `recolour` case in the block below already got.

       Driven through `DELETE /api/search/:slug/:id` rather than through the
       store, so the route that carries the id is in the path too — this is the
       only case in the file that reaches that method. */
    const keep = await asTestOwner(() => searchStore.begin(SEARCH_SLUG, "the one to keep"));
    const doomed = await asTestOwner(() => searchStore.begin(SEARCH_SLUG, "the one to delete"));
    expect(keep.run.id).not.toBe(doomed.run.id);

    const r = await call("DELETE", `/api/search/${SEARCH_SLUG}/${doomed.run.id}`);
    expect(r.status).toBe(200);
    /* The surviving list by **id**, not by length: taking both and taking
       neither are each a wrong number, and taking the wrong one is the right
       number. */
    expect((r.body as unknown as { runs: { id: string }[] }).runs.map((run) => run.id)).toEqual([
      keep.run.id,
    ]);
    /* And out of the store, not only out of the list the route computed. */
    expect((await asTestOwner(() => searchStore.load(SEARCH_SLUG))).map((run) => run.id)).toEqual([
      keep.run.id,
    ]);
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
 *
 * **Mutation.** `src/store/pg-searches.ts` § `recolour`, its
 * `eq(searchRuns.id, runId)` deleted from the `where`, so a recolour paints
 * every saved search on the article.
 *
 * **It stayed green against the file as it stood — 127 passed — and that is
 * the finding.** *Answers with the whole list* is the only case here with two
 * runs on one article, and it asserted the list's **length** and nothing else,
 * so a write that coloured both rows answered with exactly the list it wanted.
 * Every other case has one run, where "this one" and "all of them" are the same
 * statement. One assertion was added — the second run comes back with no colour
 * — and the same mutation is then **1 failed of 127**: *answers with the whole
 * list, and colours only the run it was given*, `expected 1 to be undefined`.
 * `remove` in the block above has the identical hole and no two-run case at all
 * to close it with.
 *
 * **Blind to.** The owner scope: `runsFor` reaches the article through
 * `ownedSlug`, and a private database with one seeded owner cannot tell a
 * scoped query from an unscoped one — `tests/owner-isolation.test.ts` is what
 * speaks for that predicate. And to the *validation*, which is the block's own
 * subject and happens above the store: every 400 here is decided before a
 * statement runs.
 */
describe("PATCH /api/search/:slug/:id", () => {
  /* The runs a previous case saved, rather than a removed directory. */
  beforeEach(async () => {
    await asTestOwner(async () => {
      for (const run of await searchStore.load(COLOUR_SLUG)) {
        await searchStore.remove(COLOUR_SLUG, run.id);
      }
    });
  });

  /** A saved search on the colour article, through the store the route uses. */
  async function saved(criterion = "arguments against"): Promise<string> {
    const { run } = await asTestOwner(() => searchStore.begin(COLOUR_SLUG, criterion));
    return run.id;
  }

  /** The runs as the store now has them, as the reader the request ran as. */
  const runsOn = (slug: string) => asTestOwner(() => searchStore.load(slug));

  it("stores the slot the reader picked", async () => {
    const id = await saved();
    const r = await call("PATCH", `/api/search/${COLOUR_SLUG}/${id}`, { colour: 5 });
    expect(r.status).toBe(200);
    expect((await runsOn(COLOUR_SLUG))[0]?.colour).toBe(5);
  });

  it("accepts slot 0, which a truthiness check would refuse", async () => {
    const id = await saved();
    const r = await call("PATCH", `/api/search/${COLOUR_SLUG}/${id}`, { colour: 0 });
    expect(r.status).toBe(200);
    expect((await runsOn(COLOUR_SLUG))[0]?.colour).toBe(0);
  });

  it("takes null as 'put it back on automatic', not as a missing field", async () => {
    const id = await saved();
    await call("PATCH", `/api/search/${COLOUR_SLUG}/${id}`, { colour: 3 });
    const r = await call("PATCH", `/api/search/${COLOUR_SLUG}/${id}`, { colour: null });
    expect(r.status).toBe(200);
    const run = (await runsOn(COLOUR_SLUG))[0];
    expect(run && "colour" in run).toBe(false);
  });

  it("refuses anything that is not a small whole number", async () => {
    const id = await saved();
    for (const colour of ["3", 2.5, -1, 64, true, {}]) {
      const r = await call("PATCH", `/api/search/${COLOUR_SLUG}/${id}`, { colour });
      expect(r.status).toBe(400);
    }
    // And nothing was written on the way to refusing.
    const run = (await runsOn(COLOUR_SLUG))[0];
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

  it("answers with the whole list, and colours only the run it was given", async () => {
    /* **The list is the shape the delete beside it answers with**, which is
       what this case was written for. The second half arrived with the move and
       is the only assertion in the file that can tell *this* run from *these*
       runs: every other case here has one saved search, so a write with no `id`
       in its `where` is indistinguishable from a correct one. */
    const first = await saved("first");
    const second = await saved("second");
    const r = await call("PATCH", `/api/search/${COLOUR_SLUG}/${first}`, { colour: 1 });
    const runs = (r.body as { runs?: { id: string; colour?: number }[] }).runs ?? [];
    expect(runs).toHaveLength(2);
    expect(runs.find((run) => run.id === first)?.colour).toBe(1);
    expect(runs.find((run) => run.id === second)?.colour).toBeUndefined();
  });

  it("refuses a slug that is not a path segment", async () => {
    const r = await call("PATCH", "/api/search/..%2Fetc/spya-k3m9qt", { colour: 1 });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

/**
 * **Every PATCH route, against a body that is not an object.**
 *
 * This is the check the postmortem asked for, and it is deliberately a table
 * rather than a case per route: the search PATCH had a per-route version of
 * this test since 2026-08-27 and it protected exactly one route, while the
 * comment beside it said in as many words that "the same hole is latent in the
 * other PATCH routes here". It was, for six days, in the chat rename.
 * docs/postmortems/260902e-a-comment-that-named-the-latent-hole-and-left-it-latent.md.
 *
 * **4xx, not a specific code**, because these routes legitimately differ: some
 * refuse a non-object outright through `objectBody`, and the two comment routes
 * read it through `fields`, which coerces to `{}` and then refuses for having
 * no fields. What none of them may do is 500 — that is a malformed request
 * reported as a server fault, and it is the shape a client bug takes, so it
 * arrives looking like ours.
 *
 * No fixtures: every one of these validates the body before it touches a store,
 * so a route that 404s here would be failing for the wrong reason and the
 * assertion would still hold. If one ever needs a real row to reach its
 * validation, that is itself worth knowing.
 */
describe("no PATCH route answers a malformed body with a 500", () => {
  const PATCH_ROUTES = [
    "/api/library/a-slug",
    "/api/reader",
    "/api/comments/a-slug/spya-k3m9qt",
    "/api/comments/a-slug/spya-k3m9qt/mark",
    "/api/chat/a-slug/t1",
    "/api/search/a-slug/r1",
    "/api/referee/criteria/a-slug/c1",
  ];

  for (const url of PATCH_ROUTES) {
    for (const body of ["null", "[]", '"3"', "7"]) {
      it(`${url} refuses ${body}`, async () => {
        const r = await call("PATCH", url, body);
        expect(r.status).toBeGreaterThanOrEqual(400);
        expect(r.status).toBeLessThan(500);
      });
    }
  }
});

/**
 * **The hole the search PATCH beside it wrote down and nobody closed.**
 *
 * That route's comment has said since 2026-08-27 that "the same hole is latent
 * in the other PATCH routes here". It was: renaming a chat thread destructured
 * `readBody`'s result without first checking it was an object, so a body of
 * bare `null` — valid JSON — threw a `TypeError` that the generic handler
 * reported as a **500**. A malformed request answered as a server fault is the
 * one thing validation must never do, and it is the shape a client bug takes,
 * so it would have been reported as ours.
 *
 * Written down is not checked. Found by GPT Sol reviewing the rework plan,
 * 2026-09-02; docs/reusable/written-down-is-not-checked.md.
 *
 * No thread has to exist for this: the destructure happened before any store
 * call, so the 500 did not depend on the id being real. **Which is also why it
 * has no mutation** — same as the table above it, and for the same reason
 * stated in its own header: there is no store between the request and the
 * refusal to break.
 */
describe("PATCH /api/chat/:slug/:threadId with a body that is not an object", () => {
  for (const body of ["null", "[]", '"3"', "7"]) {
    it(`answers ${body} with 400, not 500`, async () => {
      const r = await call("PATCH", "/api/chat/test-routes-colour-fixture/t1", body);
      expect(r.status).toBe(400);
    });
  }
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
 * docs/plans/260826ae-auth-ui-and-production.md and had to be done by hand
 * once. **It has been, on 2026-09-04, and here is what it printed.** A gate test
 * that has never been seen to fail proves nothing —
 * docs/reusable/silent-success.md, and the memory with my name on it.
 *
 * **Mutation.** `src/auth.ts` § `requireUser`, its opening refusal —
 * `if (scheme?.toLowerCase() !== "bearer" || !token) throw httpError(401, …)` —
 * emptied, so a request with no `Authorization` header at all goes on to
 * `verify` instead of being turned away. (Emptied rather than the plan's
 * *"comment out the `await requireUser(...)` line"*, which does not compile:
 * `serveAuthenticatedApi` takes the `VerifiedUser` it returns, and a type only
 * that function can produce is the point of the split.) **2 failed of 127**:
 * *refuses a request with no Authorization header*, `expected 200 to be 401` —
 * an anonymous stranger served the whole shelf — and, in the block below, *says
 * nothing about users in three refusals*, `expected [ 200, 403, 200 ] to deeply
 * equal [ 401, 403, 200 ]`.
 *
 * **Blind to.** The *order* — that the gate runs before any body is read, which
 * this block's first case asserts by choosing a GET and argues for in prose;
 * nothing here sends a malformed body without a header and watches for a 401
 * rather than a 400. And to `verify` itself: the second case injects a verifier
 * that says no, so a `requireUser` that ignored a *bad* token would be caught,
 * but every claims check inside the real verifier — `role`, `is_anonymous`, the
 * `sub` shape — is `tests/auth.test.ts`'s, not this file's.
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
 * `tests/helpers/authed.ts` signs every other test in this file in as the local
 * administrator (`TEST_SUB`, which `isAdmin` says yes to) — so the interesting
 * case needs a verifier of its own. See src/admin.ts and docs/project/admin.md.
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

  /**
   * Otherwise a gate that refuses everybody passes every test above, and the
   * suite is green while the page is dead.
   *
   * **This asserted 501 until 2026-09-04, and the 501 was the filesystem store
   * speaking.** *"There are no user accounts on the filesystem store"* is
   * `adminOnFiles` in src/store/index.ts refusing after the gate let the request
   * through — which was the right evidence to take from a suite that could not
   * have a database, and its own comment said a 200 here *"would mean the suite
   * had quietly acquired a database"*. It has: the file is pinned to Postgres
   * and runs against one. So what an administrator actually gets is asserted
   * instead, which is behaviour the store flag's deletion does not touch — F
   * removes the `files` path, not this one.
   *
   * `tests/seed-admin-signin.test.ts` already drives this route against Postgres
   * with a **real** GoTrue token; this one drives it with `acceptAny` and is
   * about the gate rather than about the token. The two are not the same claim,
   * and that file's header says so.
   *
   * **Mutation.** `src/routes.ts`, the admin `users` handler, its
   * `send(res, 200, { users: await adminStore.listUsersAcrossOwners() })`
   * replaced with `send(res, 200, { users: [] })` — the page a store failure
   * would draw, and the exact thing the *"not an empty list"* comments above are
   * about. **2 failed of 129**, watched 2026-09-04: this case and *says nothing
   * about users in three refusals*, both `expected 0 to be greater than 0`.
   *
   * **Blind to.** Everything below the call. This is a **call-site mutation**:
   * it deletes the `await` rather than breaking anything inside the store, so
   * **no SQL runs at all** and it proves only that the route refuses to answer
   * with an empty list. It is the same shape stage B already recorded against
   * `list-reconciles-expired` — a file whose watched reds all stopped at a call
   * site — recurring in the next file, which is why the mutation below exists.
   * GPT Sol, reviewing B2, 2026-09-04.
   *
   * **Mutation.** `src/store/pg-admin.ts` § `adminQueries`, the `shelf`
   * aggregate's `live` count inverted — `filter (where archived_at is null)` to
   * `is not null`, the wrong side of the one predicate that decides whether an
   * article is on the shelf or off it. **1 failed of 129**, watched 2026-09-04:
   * this case, `expected 0 to be greater than 0` on `me?.articles`. That one
   * reaches Postgres: the count is a grouped aggregate over *this run's private
   * database*, joined to the account by owner id, and this file's own five
   * seeded articles are what it is counting.
   *
   * **Blind to.** Every other field on the row, and the arithmetic of this one —
   * `toBeGreaterThan(0)` says the join arrived, not that it is right.
   * `tests/admin-store.test.ts` asserts the shapes and the runtime types,
   * `tests/admin-queries.test.ts` pins what each builder means in SQL, and
   * `tests/admin-users-merge.test.ts` the join itself. And blind to the GoTrue
   * half entirely: the accounts are an HTTP call, and no mutation in this file
   * can reach it.
   */
  it("lets the administrator reach the route, and gets the list", async () => {
    const r = await call("GET", "/api/admin/users");
    expect(r.status).toBe(200);
    const users = (r.body as unknown as { users: { id: string; articles?: unknown }[] }).users;
    /* At least one: the accounts come from the Auth service, and the private
       lane's own setup seeds the local administrator among them. Zero would be
       a list that had arrived from nowhere. */
    expect(users.length).toBeGreaterThan(0);
    /* **And one number off the row, which is what makes this case reach a
       statement at all.**

       The list is two halves joined by owner id: the accounts are an HTTP call
       to GoTrue, the counts are aggregates over *this run's private database*.
       Asserting only the length asks the first half and never the second — so
       every mutation this case could see was a mutation of the route's own call
       site, proving the route rejects an empty list and nothing whatever about
       the store. GPT Sol's review of B2, 2026-09-04.

       This file seeds five articles under `TEST_OWNER`, and `acceptAny`
       authenticates as that same local administrator, so the administrator's own
       row must count them. `toBeGreaterThan(0)` rather than `toBe(5)`: the
       private database is this run's, but a peer copy of this file is not the
       only thing that could put an article in it, and the claim here is that the
       join arrived — `tests/admin-store.test.ts` is what pins the arithmetic. */
    const me = users.find((u) => u.id === TEST_OWNER);
    expect(me, "the administrator is not in their own list").toBeDefined();
    expect(me?.articles).toBeGreaterThan(0);
  });

  /* **The feedback routes, named rather than left to the prefix.** The case
     above already proves an unwritten admin endpoint is refused, so these are
     not testing the gate again — they are making the gate's guarantee say these
     two addresses out loud, which is what stops a later refactor moving one of
     them out from under it without a test going red.
     docs/plans/260902l-admin-feedback-page.md. */
  it("refuses a non-administrator the feedback list, and hands back no reports", async () => {
    const r = await call("GET", "/api/admin/feedback", undefined, asSomebodyElse);
    expect(r.status).toBe(403);
    /* Not an empty list — this page shows other people's words, so "refused"
       and "nothing to show" must not be one answer. */
    expect(r.body).not.toHaveProperty("reports");
  });

  it("refuses a non-administrator a screenshot", async () => {
    const r = await call(
      "GET",
      `/api/admin/feedback/${ADMIN_USER_ID_LOCAL}/spya-k3m9qt/screenshot`,
      undefined,
      asSomebodyElse,
    );
    expect(r.status).toBe(403);
  });

  it("lets the administrator reach the feedback list, and gets a page of it", async () => {
    /* 501 until 2026-09-04, for the same reason and with the same repair as the
       users case above. **An empty `reports` array is the right answer here and
       an empty `users` array is not**: nobody has filed a report in a database
       minted for this run, and the page is a page rather than a list of
       accounts — so what is asserted is the *shape*, which is what tells "the
       store answered" from "the route refused". `hasMore` and `nextCursor` are
       in it because a page missing them is one a client pages past the end of.
       tests/feedback-store.test.ts is what covers a report actually arriving. */
    const r = await call("GET", "/api/admin/feedback");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ reports: [], hasMore: false, nextCursor: null });
  });

  it("refuses either half of the key when it is the wrong shape", async () => {
    /* **The address carries two segments because a report is `(owner_id, id)`**
       — the id is minted by a browser, so it is unique within an owner and not
       globally. GPT Sol, 2026-09-02; src/store/pg-admin-feedback.ts.

       The patterns' `[\w-]+` is a *shape*; `isUuid` and `isSpideryarnId` are
       the rules. A 400 rather than a 501 is what proves they run before the
       store, and that the pattern is not being trusted as the check. */
    for (const path of [
      `/api/admin/feedback/not-a-uuid/spya-k3m9qt/screenshot`,
      `/api/admin/feedback/${ADMIN_USER_ID_LOCAL}/not-an-id/screenshot`,
      `/api/admin/feedback/not-a-uuid/spya-k3m9qt`,
      `/api/admin/feedback/${ADMIN_USER_ID_LOCAL}/not-an-id`,
    ]) {
      const r = await call("GET", path);
      expect(r.status, path).toBe(400);
    }
  });

  it("refuses a malformed page cursor rather than quietly starting from the top", async () => {
    /* Reading a bad `?before=` as "no cursor" would hand back page 1 while the
       reader pressed *Load older* — a request that looks like it worked and
       silently skipped everything in between.
       docs/reusable/silent-success.md. */
    const r = await call("GET", "/api/admin/feedback?before=nonsense");
    expect(r.status).toBe(400);
  });

  it("does not match a report path with anything extra on the end", async () => {
    /* Exact, anchored, two segments. `/…/screenshot/anything` is a 404 rather
       than a quiet match — the same rule `/api/admin/users/anything` follows,
       and the reason both are exact rather than `startsWith`. */
    const r = await call(
      "GET",
      `/api/admin/feedback/${ADMIN_USER_ID_LOCAL}/spya-k3m9qt/screenshot/extra`,
    );
    expect(r.status).toBe(404);
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

  it("says nothing about users in three refusals", async () => {
    /* Every refusal must be words rather than an empty list. A page that says
       "no accounts" and a page that could not answer look identical, and only
       one of them is true — which is still exactly the point, and is why this
       case survived the move rather than being replaced.

       **The third arm changed and the claim did not.** It used to be "the right
       person against a store that has no accounts to list", which was a third
       *refusal* — the filesystem store's 501. Against Postgres the right person
       gets the page, so the three ways in are now: nobody signed in, the wrong
       person signed in, and the administrator. Two refusals that must carry
       words and no list, and one answer that must carry the list — which is a
       stronger version of the same sentence, because it is the arm that proves
       an empty `users` really would be indistinguishable from a refusal. */
    const anonymous = await call("GET", "/api/admin/users", undefined, undefined, {});
    const stranger = await call("GET", "/api/admin/users", undefined, asSomebodyElse);
    const administrator = await call("GET", "/api/admin/users");
    expect([anonymous.status, stranger.status, administrator.status]).toEqual([401, 403, 200]);
    for (const r of [anonymous, stranger]) {
      expect(r.body).not.toHaveProperty("users");
      expect(r.body.error).toBeTruthy();
    }
    expect((administrator.body as unknown as { users: unknown[] }).users.length).toBeGreaterThan(0);
    expect(administrator.body.error).toBeUndefined();
  });
});
