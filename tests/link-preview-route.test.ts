/**
 * `GET /api/link-preview` — **who may cause a fetch, and of what.**
 *
 * The route is the whole security story of this feature, and every case here is
 * a way it can be wrong while looking right. Being authenticated is not enough:
 * without the two checks below, any signed-in account could hand this endpoint
 * any URL at all, which is an open proxy and an open wallet with a login page in
 * front of it. GPT Sol's finding P1-1, 2026-09-05, and it is the reason the
 * route takes a slug.
 *
 * Five claims:
 *
 * 1. **A URL this article does not point at is refused, and nothing is
 *    fetched.** The assertion is a call count on `fetchDocument`, because a
 *    route that fetched and then answered `unavailable` would look identical
 *    from the outside — the client cannot see the difference and neither could a
 *    body assertion.
 * 2. **An article the caller does not own is a 404, and nothing is fetched.**
 *    Seeded as a *different, real* owner, so this stands in front of the actual
 *    owner filter in `ownedSlug` rather than in front of a slug that does not
 *    exist.
 * 3. **The two URL identities do not collapse into one.** `urlKey` folds
 *    `http`/`https`, `www.` and a trailing slash together, and this route must
 *    not: membership and the cache are keyed on `requestTarget`, and a spelling
 *    the article does not literally contain is refused even when `urlKey` would
 *    call it the same page. It is also asserted the other way round — two
 *    spellings the article *does* contain are two fetches, not one.
 * 4. **A credential-bearing URL never reaches the ownerless table.** Refused
 *    before the fetch, so neither the URL nor its content is stored anywhere a
 *    stranger who hovers the same address could read it back. P1-7.
 * 5. **A second ask is a cache hit**: one fetch, and the answer carries no
 *    timestamp — returning one would say whether and when some prior reader
 *    caused a fetch.
 *
 * `fetchDocument` is replaced rather than the network stubbed, so nothing here
 * depends on a real host and the count is exact. Everything else — the store,
 * the claim, the limiter, the ownership filter — is real Postgres.
 *
 * Skips loudly when there is no database; tests/helpers/pg-ready.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { linkPreviews, rateLimitEvents } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { Block } from "../src/types.js";
import type { OwnerId } from "../src/owner.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/* ------------------------------------------------------- the destinations -- */

/** In the article, and the ordinary case. */
const PAPER = "https://destination.example/paper";
/**
 * Also in the article, and **`urlKey` folds it into `PAPER`** — different
 * scheme, a `www.`, a trailing slash. Two rows in this cache and one row on a
 * shelf, which is the whole of finding P1-2 in one constant.
 */
const PAPER_OTHER_SPELLING = "http://www.destination.example/paper/";
/** In the article, with a query the author wrote. */
const WITH_QUERY = "https://destination.example/paper?ref=footnote";
/** In the article, and it carries something that works like a key. */
const SIGNED = "https://destination.example/grant?sig=abc123";
/** Not in the article at all. */
const ELSEWHERE = "https://somewhere-else.example/whatever";
/**
 * **In the article, and its escaped slash is the whole of finding P1-1.**
 *
 * `/a%2Fb` is not `/a/b` — it is one path segment containing a slash, and a
 * server may serve something completely different at each. A `requestTarget`
 * that percent-decoded the path merged them, which meant an article linking
 * this address *authorized a fetch of the other one*.
 */
const ESCAPED = "https://destination.example/papers/a%2Fb";
/** In the article, and it redirects somewhere signed. */
const REDIRECTS = "https://destination.example/go";
/** Where it lands. Never published by anybody, and never to be stored. */
const SIGNED_LANDING = "https://cdn.destination.example/blob?X-Amz-Signature=deadbeef";

/** Every URL `fetchDocument` was called with, in order. */
let fetched: string[] = [];
/** Requested URL → where the fake fetch pretends it redirected to. */
const redirectTo = new Map<string, string>();

vi.mock("../src/fetch.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/fetch.js")>();
  return {
    ...actual,
    /* Only the one function. `FetchFailure`, `classifyStatus` and the rest are
       the real ones, because src/link-previews.ts branches on them and a fake
       error class would make every classification assertion vacuous. */
    fetchDocument: async (url: string) => {
      fetched.push(url);
      /* A redirect, when a test asked for one. `chain` is requested first and
         final last, exactly as `fetchDocument` builds it. */
      const to = redirectTo.get(url);
      return {
        requestedUrl: url,
        url: to ?? url,
        chain: to ? [url, to] : [url],
        status: 200,
        kind: "html" as const,
        contentType: "text/html",
        bytes: new Uint8Array(),
        text:
          '<html><head><meta property="og:title" content="A Paper About Something">' +
          '<meta property="og:site_name" content="Destination">' +
          '<meta name="description" content="What the paper is about, at some length, in a ' +
          'sentence that is comfortably long enough to look like prose.">' +
          "</head><body><article><p>" +
          /* Long enough for the word count to be a real one:
             `extractPreview` drops a count below `MIN_COUNTABLE_WORDS`,
             because a handful of words off a button is a measurement of
             Readability rather than of the page. */
          Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ") +
          "</p></article></body></html>",
        encoding: "utf-8",
        fetchedAt: new Date().toISOString(),
      };
    },
  };
});

const SLUG = "test-link-preview-route";
const STRANGERS_SLUG = "test-link-preview-strangers";
/** A second real reader, so "not yours" is an owner filter rather than a typo. */
const BOB = "00000000-0000-4000-8000-00000000fe01" as OwnerId;

await pgReady({
  suite: "tests/link-preview-route.test.ts",
  tables: ["spideryarn.link_previews", "spideryarn.rate_limit_events", "spideryarn.articles"],
});

const { handleApi } = await import("../src/routes.js");

/**
 * Put the four destinations into one block's markup.
 *
 * The corpus article has no hyperlinks at all — four of the seven articles here
 * came from PDFs and the rest are plain — so the links this suite is about have
 * to be written in. `articleLinks` parses `block.html`, which is what this
 * rewrites; `scratchArticleInPg` mirrors `blocks.json` into its `output/` twin
 * and re-stamps the hierarchy, so the published revision really does contain
 * them.
 */
async function withLinks(dir: string): Promise<void> {
  const file = path.join(dir, "blocks.json");
  const parsed = JSON.parse(await readFile(file, "utf8")) as {
    blocks: Block[];
  };
  const target = parsed.blocks.find((b) => b.kind === "text" && b.html);
  if (!target) throw new Error("the fixture article has no text block to hang a link on");
  target.html =
    `<p id="${target.id}">` +
    [PAPER, PAPER_OTHER_SPELLING, WITH_QUERY, SIGNED, ESCAPED, REDIRECTS]
      .map((href, i) => `<a href="${href}">link ${i}</a>`)
      .join(" ") +
    "</p>";
  await writeFile(file, JSON.stringify(parsed, null, 2));
}

let mine: ScratchArticle | undefined;
let theirs: ScratchArticle | undefined;

beforeAll(async () => {
  /* **An address nobody else uses**, and the `onConflictDoNothing` below is not
     enough on its own: `auth.users` carries a partial unique index on `email`,
     so `on conflict (id) do nothing` sails past a *different* row that already
     holds this address and the insert fails on the email instead. Found by a
     full run, where this file and `tests/admin-feedback-store.test.ts` both
     wanted `bob@example.invalid` under different ids — and it reddened *that*
     file rather than this one, which is why re-running a red suite alone is
     only half a diagnosis. */
  await seedAuthUser(getDb(), {
    id: BOB,
    email: "bob-link-preview@example.invalid",
    onConflictDoNothing: true,
  });
  mine = await scratchArticleInPg(SLUG, {
    ownerId: TEST_OWNER,
    mutate: withLinks,
  });
  /* The same links, in an article belonging to somebody else. Same links on
     purpose: the refusal below must be about the *article's owner* and not
     about the URL, and an article with different links could pass for the
     wrong reason. */
  theirs = await scratchArticleInPg(STRANGERS_SLUG, {
    ownerId: BOB,
    mutate: withLinks,
  });
}, 120_000);

afterAll(async () => {
  await mine?.remove();
  await theirs?.remove();
  await closeDb();
});

/**
 * The cache is global and the allowance is per reader, so both outlive a test.
 * Cleared between cases, or the second case in the file is a cache hit for
 * reasons the first case chose.
 */
afterEach(async () => {
  fetched = [];
  const db = getDb();
  await db.delete(linkPreviews);
  await db.delete(rateLimitEvents);
});

interface Reply {
  status: number;
  body: Record<string, unknown> | null;
}

async function ask(query: string): Promise<Reply> {
  const req = Object.assign(
    (async function* () {
      /* No body: this is a GET. */
    })(),
    {
      method: "GET",
      url: `/api/link-preview${query}`,
      headers: AUTHED_HEADERS,
    },
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
    end(chunk?: string) {
      if (chunk) text += chunk;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  return { status, body };
}

const forSlug = (slug: string, url: string) =>
  ask(`?slug=${encodeURIComponent(slug)}&url=${encodeURIComponent(url)}`);

describe("GET /api/link-preview", () => {
  it("answers for a URL the article really points at", async () => {
    const { status, body } = await forSlug(SLUG, PAPER);
    expect(status).toBe(200);
    expect(body).toEqual({
      state: "ready",
      page: {
        title: "A Paper About Something",
        siteName: "Destination",
        description:
          "What the paper is about, at some length, in a sentence that is comfortably long " +
          "enough to look like prose.",
        words: 120,
      },
    });
    /* **No timestamp of any kind**, and it is asserted as an absence rather
       than trusted: a `fetchedAt` would tell a caller whether and when some
       prior reader caused a fetch of this URL. P1-7. */
    expect(JSON.stringify(body)).not.toMatch(/fetchedAt|expiresAt|\d{4}-\d{2}-\d{2}T/);
    expect(fetched).toEqual([PAPER]);
  });

  it("refuses a URL the article does not point at, without fetching it", async () => {
    const { status, body } = await forSlug(SLUG, ELSEWHERE);
    expect(status).toBe(200);
    expect(body).toEqual({ state: "refused" });
    /* The assertion that matters. Answering `unavailable` *after* fetching
       would be indistinguishable from this at the client. */
    expect(fetched).toEqual([]);
  });

  it("refuses an article the caller does not own, without fetching anything", async () => {
    const { status } = await forSlug(STRANGERS_SLUG, PAPER);
    /* 404 rather than 403: the Postgres reader filters by owner, so somebody
       else's slug is simply not found — and a 403 would confirm the article
       exists. The throw becomes the route's own status. */
    expect(status).toBe(404);
    expect(fetched).toEqual([]);
  });

  it("will not let `urlKey`'s idea of sameness stand in for the article's links", async () => {
    /* `https://destination.example/paper/` is not in the article — the article
       has the `www.`/`http` spelling and the bare `https` one, and neither is
       this. `urlKey` folds all three together; `requestTarget` does not, and
       membership is the second. */
    const near = "https://destination.example/paper/";
    const { body } = await forSlug(SLUG, near);
    expect(body).toEqual({ state: "refused" });
    expect(fetched).toEqual([]);
  });

  it("keeps two spellings of one page apart in the cache", async () => {
    await forSlug(SLUG, PAPER);
    await forSlug(SLUG, PAPER_OTHER_SPELLING);
    /* Two requests, because they are two requests: `http` and `https` can serve
       different pages and `www.` can be a different host. A cache keyed on
       `urlKey` would have made the second a hit and asked the network once —
       which is the bug, not the optimisation. */
    expect(fetched).toEqual([PAPER, PAPER_OTHER_SPELLING]);
    const rows = await getDb().select({ target: linkPreviews.target }).from(linkPreviews);
    expect(rows.map((r) => r.target).sort()).toEqual(
      ["http://www.destination.example/paper/", "https://destination.example/paper"].sort(),
    );
  });

  it("keeps a query the author wrote, because the far end may act on it", async () => {
    await forSlug(SLUG, WITH_QUERY);
    expect(fetched).toEqual([WITH_QUERY]);
    const rows = await getDb().select({ target: linkPreviews.target }).from(linkPreviews);
    expect(rows.map((r) => r.target)).toEqual(["https://destination.example/paper?ref=footnote"]);
  });

  it("refuses a credential-bearing URL, and stores nothing about it", async () => {
    const { body } = await forSlug(SLUG, SIGNED);
    expect(body).toEqual({ state: "refused" });
    expect(fetched).toEqual([]);
    /* Nothing at all in the ownerless table — not the URL, not a negative row.
       A refusal that recorded the address would defeat its own purpose. */
    const rows = await getDb().select({ target: linkPreviews.target }).from(linkPreviews);
    expect(rows).toEqual([]);
  });

  it("serves the second ask out of the cache, spending nothing", async () => {
    await forSlug(SLUG, PAPER);
    await getDb().delete(rateLimitEvents);
    const { body } = await forSlug(SLUG, PAPER);
    expect(body).toMatchObject({ state: "ready" });
    expect(fetched).toEqual([PAPER]);
    /* **A hit bypasses the limiter entirely**, which is a design property
       rather than an optimisation: the cache absorbs the steady state, so the
       allowance is only ever about outbound traffic. An empty table after a
       served request is the whole of that claim. */
    const spent = await getDb().select({ id: rateLimitEvents.id }).from(rateLimitEvents);
    expect(spent).toEqual([]);
  });

  it("will not let an escaped slash authorize the address it is not", async () => {
    /* The article publishes `/papers/a%2Fb`. `/papers/a/b` is a different
       request and this route must not fetch it — the collision a decoding
       `requestTarget` created, and the reason that function is now the plain
       WHATWG serialization. GPT Sol, 2026-09-05, P1-1. */
    const decoded = "https://destination.example/papers/a/b";
    expect((await forSlug(SLUG, decoded)).body).toEqual({ state: "refused" });
    expect(fetched).toEqual([]);

    /* And the escaped one, which really is in the article, still works — the
       control, without which this case would pass on any refusal at all. */
    expect((await forSlug(SLUG, ESCAPED)).body).toMatchObject({ state: "ready" });
    expect(fetched).toEqual([ESCAPED]);
  });

  it("stores nothing about a redirect that lands on a signed URL", async () => {
    redirectTo.set(REDIRECTS, SIGNED_LANDING);
    try {
      const { body } = await forSlug(SLUG, REDIRECTS);
      /* `unavailable` rather than `refused`: we did ask, and the answer is a
         property of that address. */
      expect(body).toEqual({ state: "unavailable" });
      expect(fetched).toEqual([REDIRECTS]);

      const rows = await getDb()
        .select({ target: linkPreviews.target, outcome: linkPreviews.outcome })
        .from(linkPreviews);
      /* One row, under the address the author published — which was vetted
         before the fetch, so writing it down says nothing new. **Nothing at all
         about where it went**, which is the whole point: an ownerless table is
         the worst available home for a signed URL, and a harmless published
         address can redirect into one. GPT Sol, P1-3. */
      expect(rows).toEqual([
        { target: "https://destination.example/go", outcome: "transient" },
      ]);
    } finally {
      redirectTo.delete(REDIRECTS);
    }
  });

  it("tells a refusal apart from a destination that gave nothing", async () => {
    /* The two look identical on the card and must not look identical to the
       client's cache: `unavailable` is a fact about the URL and is remembered,
       `refused` is a fact about this request and is not. Without the split, one
       hover of a chat link — in no article, so always refused — silences that
       URL for the session. GPT Sol, P2-1. */
    expect((await forSlug(SLUG, ELSEWHERE)).body).toEqual({ state: "refused" });
    expect((await forSlug(SLUG, SIGNED)).body).toEqual({ state: "refused" });
  });

  it("refuses a slug that is not a slug, loudly", async () => {
    /* The one thing this route says out loud. A malformed request is a client
       bug and must not read as a destination we could not reach — every other
       refusal here is a 200 with `unavailable`. */
    const { status } = await ask(`?slug=${encodeURIComponent("../etc")}&url=${PAPER}`);
    expect(status).toBe(400);
    expect(fetched).toEqual([]);
  });
});
