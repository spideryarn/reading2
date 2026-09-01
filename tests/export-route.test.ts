/**
 * **`GET /api/export/:slug`, end to end through the route.**
 *
 * Its sibling, tests/store-export-bundle.test.ts, tests what is *in* the zip —
 * that a `candidates` thread stays `candidates`, that `passages` survives, that
 * nothing reaches the bucket. None of that says anything about the route, and
 * the route is where a download can go wrong in the two ways that matter: it
 * can hand somebody else's article to a stranger, and it can hand a reader a
 * file their computer will not open.
 *
 * So this drives the real `handleApi` against real Postgres, with one article
 * seeded as the test owner, and asks:
 *
 * - the owner gets bytes that **actually unzip** — not merely a 200 with a
 *   `Content-Type` on it, which is what a route that streamed nothing would
 *   also produce;
 * - **another reader gets 404**, and gets it *from the owner filter* rather
 *   than from a route that happens to be broken for everyone;
 * - a request with no `Authorization` never reaches the route at all;
 * - `/api/public/export/:slug` is not a second door onto the same bytes;
 * - a traversal-shaped slug is a 400 before anything is read;
 * - a bundle over the cap is a readable 413 rather than a truncated download.
 *
 * ## The one that needed a control, and what was done about it
 *
 * "Another owner gets 404" passes if the route is broken for *everybody* — a
 * `readArticleRows` that matched nothing at all would look identical
 * (docs/reusable/silent-success.md). Two things stop that here. The owner's own
 * 200 is the standing positive control: it is red the moment nothing matches.
 * And the outsider's 404 asserts that `articleBundle` was **reached**, so the
 * refusal came from the owner predicate inside it and not from the gate, the
 * matcher or a typo in the path.
 *
 * The stronger control was run by hand, on 2026-09-01, and is recorded here
 * because it is not going to be run again. Add this above `const SLUG`:
 *
 *     vi.mock("../src/store/owned-slug.js", async (importOriginal) => {
 *       const actual = await importOriginal<typeof import("../src/store/owned-slug.js")>();
 *       const { eq: equals } = await import("drizzle-orm");
 *       const { articles: table } = await import("../src/db/schema.js");
 *       return { ...actual, ownedSlug: (slug: string) => equals(table.slug, slug) };
 *     });
 *
 * — the owner clause gone and nothing else changed, which is exactly the
 * regression. The outsider test failed with `expected 200 to be 404`: the
 * stranger got the zip. **The other nine stayed green**, which is the part
 * worth writing down — this one test is the whole of what stands between one
 * reader's articles and another's, and every other assertion in the file is
 * satisfied by a route that leaks.
 *
 * It is not kept as a permanent suite. A test that removes the owner filter
 * in-process sits next to every other suite sharing this database, and the
 * thing it disables is the thing it is testing.
 *
 * docs/plans/260901h-export-article-data.md § Stage D.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Verifier } from "../src/auth.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import { BUNDLE_BYTE_CAP, overBundleCap } from "../src/store/export-bundle.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/**
 * **Postgres, and set before `src/routes.ts` is ever imported** — `STORE` is
 * read once at module load in src/store/live.ts, which is why the import of
 * `handleApi` at the bottom of this block is dynamic and nothing else is.
 * tests/owner-isolation.test.ts has the long version.
 */
process.env.SPIDERYARN_STORE = "postgres";

/**
 * The bundle, with a seam for the one outcome no fixture can produce.
 *
 * `overCap` has never been true of a real article — the largest in the local
 * database is 307 KB against a 4.5 MB ceiling — so the only honest way to
 * exercise the 413 is to hand the route a bundle that says it is over. Every
 * other test below goes through the **real** `articleBundle`, so this mock
 * cannot make the zip tests pass by supplying a zip.
 *
 * `vi.hoisted` because `vi.mock`'s factory is hoisted above the imports and
 * cannot close over an ordinary `const`.
 */
const seen = vi.hoisted(() => ({
  /** In call order, so "did the 404 come from the store or from the gate" is answerable. */
  calls: [] as string[],
  /** Set by one test only. `null` means: use the real bundle. */
  instead: null as null | ((slug: string) => Promise<unknown>),
}));

vi.mock("../src/store/export-bundle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/store/export-bundle.js")>();
  return {
    ...actual,
    articleBundle: async (slug: string) => {
      seen.calls.push(`articleBundle(${slug})`);
      if (seen.instead) return seen.instead(slug);
      return actual.articleBundle(slug);
    },
  };
});

const SLUG = "test-export-route";
const ARTICLE_ID = "0e5c0001-0000-4000-8000-000000000001";
const REVISION_ID = "0e5c0001-0000-4000-8000-000000000002";
const BLOCK_ID = "spya-exprt2";

/**
 * **A reader who owns nothing**, which is the strongest version of the outsider
 * half: every assertion about them is about this article being invisible, and
 * none of them can pass by their own article turning up instead.
 *
 * Not a row in `auth.users` and it does not need to be — `articles.owner_id`
 * references that table, so seeding a *second* real owner would mean driving
 * GoTrue's admin API and would make this suite fail whenever auth was down
 * rather than whenever isolation broke. The same reasoning, and the same shape,
 * as `OUTSIDER` in tests/owner-isolation.test.ts.
 */
const OUTSIDER = "0e5c0001-0000-4000-8000-0000000000b9" as OwnerId;

/** The gate, answering as somebody who is not the owner. */
const acceptOutsider: Verifier = async () => ({
  ok: true,
  claims: {
    sub: OUTSIDER,
    email: "someone-else@example.test",
    role: "authenticated",
    is_anonymous: false,
  },
});

interface Sent {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/**
 * One request through the real dispatcher.
 *
 * `path` rather than `slug`, because two of the tests below are about paths
 * that are not slugs at all — a helper that took a slug and interpolated it
 * would have had to be worked around by exactly the tests it matters for.
 */
async function get(
  path: string,
  options: { verify?: Verifier; headers?: Record<string, string> } = {},
): Promise<Sent> {
  const { handleApi } = await import("../src/routes.js");
  const req = Object.assign((async function* () {})(), {
    method: "GET",
    url: path,
    headers: options.headers ?? AUTHED_HEADERS,
  }) as unknown as IncomingMessage;

  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
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
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = String(value);
    },
    flushHeaders() {},
    on() {},
    writeHead(code: number) {
      status = code;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.from(chunk as never));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.from(chunk as never));
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, options.verify ?? acceptAny);
  return { status, headers, body: Buffer.concat(chunks) };
}

const { reachable } = await pgReady({
  suite: "tests/export-route.test.ts",
  tables: ["spideryarn.articles", "spideryarn.block_identities"],
});

const when = reachable ? describe : describe.skip;

async function clean(): Promise<void> {
  const db = getDb();
  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, ARTICLE_ID));
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, ARTICLE_ID));
  await db.delete(articleRevisions).where(eq(articleRevisions.id, REVISION_ID));
  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, ARTICLE_ID));
  await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
}

when("downloading one article's data", { timeout: 20_000 }, () => {
  beforeAll(async () => {
    await clean();
    const db = getDb();
    await db.insert(articles).values({
      id: ARTICLE_ID,
      ownerId: TEST_OWNER,
      slug: SLUG,
      shortId: "spya-exprt9",
    });
    await db.insert(articleRevisions).values({
      id: REVISION_ID,
      articleId: ARTICLE_ID,
      status: "published",
      title: "The article the download is built from",
      finalUrl: "https://example.test/export-route",
      stampedHtml: `<article><p data-spya-id="${BLOCK_ID}">a paragraph</p></article>`,
    });
    await db
      .update(articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(articles.id, ARTICLE_ID));
    await db.insert(blockIdentities).values({ articleId: ARTICLE_ID, blockId: BLOCK_ID });
    await db.insert(revisionBlocks).values({
      articleId: ARTICLE_ID,
      revisionId: REVISION_ID,
      blockId: BLOCK_ID,
      ordinal: 0,
      tag: "p",
      kind: "text",
      text: "a paragraph",
      words: 2,
      html: "<p>a paragraph</p>",
      gistable: true,
    });
  });

  afterAll(async () => {
    await clean();
    await closeDb();
  });

  beforeEach(() => {
    seen.calls.length = 0;
    seen.instead = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * **A 200 is not the assertion; a zip that opens is.**
   *
   * A route that set the headers and ended the response with nothing in it
   * would pass every check short of this one — same status, same three headers,
   * `Content-Length: 0`. So the bytes go through a real unzip and the file the
   * README promises is always present has to be in there.
   */
  it("hands the owner a zip that actually opens", async () => {
    const sent = await get(`/api/export/${SLUG}`);

    expect(sent.status).toBe(200);
    expect(sent.headers["content-type"]).toBe("application/zip");
    expect(sent.headers["x-content-type-options"]).toBe("nosniff");
    /* Measured off the response, not off the bundle's own count: the two are
       the same number whenever both exist, and this is the one that is true
       when they are not. */
    expect(sent.headers["content-length"]).toBe(String(sent.body.byteLength));

    const entries = unzipSync(new Uint8Array(sent.body));
    expect(Object.keys(entries)).toContain("manifest.json");
    const manifest = JSON.parse(
      new TextDecoder().decode(entries["manifest.json"]),
    ) as Record<string, unknown>;
    expect(manifest.slug).toBe(SLUG);
  });

  /**
   * **`attachment`, and it has to be asserted on the route.**
   *
   * `contentDisposition` took no disposition until 2026-09-01 and always said
   * `inline`, which for a zip means a browser tab full of binary rather than a
   * file on disk. The argument is now required, so which one this route passes
   * is a fact about this route and nothing but this test holds it. The filename
   * matters too: it is the only thing that survives the trip, because the
   * client reads the body as a blob and the header's name is lost with it.
   */
  it("asks the browser to save the zip, under the article's name", async () => {
    const sent = await get(`/api/export/${SLUG}`);
    expect(sent.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(sent.headers["content-disposition"]).toContain(`filename="${SLUG}.zip"`);
  });

  /**
   * **The one standing between one reader's articles and another's.**
   *
   * Two assertions, and the second is what makes the first mean anything: the
   * refusal has to come from the owner predicate inside `articleBundle`, not
   * from the gate refusing the token or the matcher missing the path. A 404
   * with `articleBundle` never called would be the route broken for everybody,
   * which is the shape this whole file's header is about.
   */
  it("404s another reader asking for it, from the owner filter and not from the gate", async () => {
    const sent = await get(`/api/export/${SLUG}`, { verify: acceptOutsider });

    expect(sent.status).toBe(404);
    expect(seen.calls).toEqual([`articleBundle(${SLUG})`]);
    /* Nothing about the article travels with the refusal — not its title, not
       its length, and in particular not an admission that the slug is real. */
    expect(sent.headers["content-type"]).not.toBe("application/zip");
    expect(sent.body.toString()).not.toContain("The article the download is built from");
  });

  /**
   * **And the owner still gets it**, which is the positive control for the test
   * above: a `readArticleRows` matching nothing at all would satisfy every
   * 404 assertion in this file and fail here. It is deliberately the same
   * request as the outsider's with one thing changed — who is asking.
   */
  it("but the owner still gets it, so the 404 is about them and not about the route", async () => {
    expect((await get(`/api/export/${SLUG}`)).status).toBe(200);
  });

  /**
   * **401 before anything else** — before the route matches, before a slug is
   * validated, before the store is touched. `requireUser` runs above the whole
   * dispatcher (src/routes.ts § the gate, and it is inside the `try`), so this
   * is asserting where the refusal lands as much as that it happens: an
   * unauthenticated caller is owed no diagnosis, and `articleBundle` must not
   * have been reached to produce one.
   */
  it("401s a request with no sign-in, without reaching the store", async () => {
    const sent = await get(`/api/export/${SLUG}`, { headers: {} });
    expect(sent.status).toBe(401);
    expect(seen.calls).toEqual([]);
  });

  /**
   * **The closed room has no door onto this.**
   *
   * `/api/public/` is dispatched before `requireUser` and deliberately never
   * calls `setRequestOwner`, so a handler there that reached for an owner would
   * throw rather than quietly answer as somebody. The rule that keeps this
   * feature out of it is stronger than that: the public namespace terminates on
   * an unknown path and never falls through into the authenticated table
   * (src/public/routes.ts). This is that rule, said about this route — the
   * check being that it 404s rather than serving a zip, and that the store is
   * never reached.
   */
  it("cannot be reached through the unauthenticated public namespace", async () => {
    const sent = await get(`/api/public/export/${SLUG}`, { headers: {} });
    expect(sent.status).toBe(404);
    expect(sent.headers["content-type"]).not.toBe("application/zip");
    expect(seen.calls).toEqual([]);
  });

  /**
   * **400, and the check is on the capture rather than on what it reaches.**
   *
   * The pattern allows `%` and `.` and `part` percent-decodes, so
   * `..%2F..%2F…` is a path by the time anything looks at it — the real
   * traversal of 2026-08-25, demonstrated by planting a file under `/tmp` and
   * reading it back through `/api/article`. Nothing behind *this* route joins a
   * slug onto a filesystem path today, which is exactly why the check has to be
   * on the slug: "what it reaches" is a fact that changes.
   *
   * 400 rather than 404 because the request is malformed, and "not found" would
   * send whoever sent it looking for a missing article.
   */
  it.each([
    ["a traversal", "/api/export/..%2F..%2Fetc%2Fpasswd"],
    ["an encoded slash", "/api/export/a%2Fb"],
    ["a name that is not a slug at all", "/api/export/Not.A.Slug"],
  ])("400s %s, before the store is asked anything", async (_what, path) => {
    const sent = await get(path);
    expect(sent.status).toBe(400);
    expect(seen.calls).toEqual([]);
  });

  /**
   * **Assembled, and too big to send.**
   *
   * A buffered Vercel response tops out at 4.5 MB and stored HTML artefacts may
   * be 32 MiB, so this is a real outcome — and the platform's own answer to it
   * is a truncated download, which is worse than a refusal because it looks
   * like a file. No article in the local database is near the cap, so the only
   * honest way to reach this branch is to hand the route a bundle that says it
   * is over.
   *
   * `overBundleCap` computes the flag rather than a literal `true`: this test
   * would otherwise pass with the constant set to zero, or to a number the
   * route disagreed with.
   *
   * The message is matched loosely, on purpose. Copy should be rewritable
   * without turning a suite red (docs/project/copy.md); what is pinned is the
   * status, that the reader is told retrying will not help, and that nothing
   * that looks like a zip goes out.
   */
  it("413s a bundle over the cap, in words rather than a broken download", async () => {
    const tooBig = BUNDLE_BYTE_CAP + 1;
    seen.instead = async (slug: string) => ({
      slug,
      /* Not `tooBig` bytes of anything: the route must refuse on the reported
         size, and allocating five megabytes to prove it would be the test
         asserting something the route is not allowed to look at. */
      bytes: new Uint8Array(0),
      byteLength: tooBig,
      overCap: overBundleCap(tooBig),
      entries: [],
    });

    const sent = await get(`/api/export/${SLUG}`);
    expect(sent.status).toBe(413);
    expect(sent.headers["content-type"]).not.toBe("application/zip");
    const said = (JSON.parse(sent.body.toString()) as { error: string }).error;
    expect(said).toMatch(/too big/i);
    expect(said).toMatch(/trying again will not help/i);
    /* No status code, no byte count, no "413" — the reader did not come here to
       operate an HTTP server. docs/project/copy.md § Who is reading this. */
    expect(said).not.toMatch(/\d/);
  });
});
