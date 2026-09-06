/**
 * **The two asset routes, end to end through the real dispatchers** —
 * `GET /api/asset/:slug/:hash.:ext` and `GET /api/public/asset/:slug/:hash.:ext`.
 *
 * Stage D of
 * docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md, and
 * step 7 of docs/plans/260829b-hosting-the-articles-images.md names the two
 * cases this file exists for:
 *
 * > a hash absent from the manifest 404s even for the owner, and a public
 * > reader can fetch a public article's asset but not a private one's.
 *
 * ## Why the fixture is two articles rather than two owners
 *
 * Assets live in a **content-addressed bucket shared by every article and every
 * reader** — `sha256/<hash>.png` — so a route that put the caller's string into
 * a blob key would be an arbitrary-object read: name a hash you have seen and
 * get the object, whoever owns the article it belongs to. An outsider's 404
 * would prove the *gate* rather than the key; the interesting adversary is a
 * reader who is entitled to be in the app and is naming a hash they are not
 * entitled to. So: two articles, both owned by the test reader, each with one
 * figure whose bytes really are in the store, and the case is asking article A
 * for article B's hash.
 *
 * That is `sendPlate`'s lesson, one route later — tests/illustrated-route.test.ts
 * says the same thing at length and this harness is copied from it, including
 * the per-run random ids and the temp-directory blob store.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq, like, lt } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Assets, PdfFigureEntry } from "../src/assets.js";
import type { Verifier } from "../src/auth.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import type { OwnerId } from "../src/owner.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/**
 * **The blob store, pointed at a temp directory** — the illustrated route
 * test's reason, restated because it is load-bearing here too: `blobStore()`
 * follows the process's credentials, so without this the route would read the
 * machine's real Supabase bucket. Only the *selector* is replaced;
 * `canonicalKey`, the create-only write and the read-back are the real thing,
 * which is what the key-rebuilding assertions need them to be.
 */
let blobDir = "";
vi.mock("../src/store/blobs.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/blobs.js")>();
  const { fsBlobs } = await import("../src/store/blobs-fs.js");
  return { ...real, blobStore: () => fsBlobs(blobDir) };
});

const RUN = randomUUID();

/** One article of the fixture. */
interface Fixture {
  slug: string;
  articleId: string;
  revisionId: string;
  shortId: string;
  blockId: string;
  visibility: "private" | "public";
  /** The recovered figure: its ref, its bytes and the hash they are stored under. */
  ref: string;
  bytes: Uint8Array;
  sha256: string;
}

/** A reader who owns nothing — the shape tests/export-route.test.ts uses. */
const OUTSIDER = "0e5c0001-0000-4000-8000-0000000000a5" as OwnerId;
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

async function get(
  urlPath: string,
  options: { verify?: Verifier; headers?: Record<string, string> } = {},
): Promise<Sent> {
  const { handleApi } = await import("../src/routes.js");
  const req = Object.assign((async function* () {})(), {
    method: "GET",
    url: urlPath,
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

/**
 * The same request with **no `Authorization` header at all** — which is the
 * only honest way to exercise the public route.
 *
 * `handleApi` dispatches the public namespace *before* the gate, so this really
 * is a stranger's request rather than a signed-in one that happened to take the
 * other path. A visitor's browser has no token to send, so neither does this.
 */
function getAnonymously(urlPath: string): Promise<Sent> {
  return get(urlPath, { headers: {} });
}

await pgReady({
  suite: "tests/asset-route.test.ts",
  tables: ["spideryarn.articles", "spideryarn.article_revisions"],
});

/* ------------------------------------------------------------ the fixture -- */

/**
 * A real PNG of `width` × `height`, distinct per article.
 *
 * Real bytes rather than `Uint8Array(4)`, because `sniffImage` and
 * `imageDimensions` (src/assets.ts) are the discipline this feature rests on —
 * a fixture that could not survive a sniff would be a fixture testing nothing —
 * and because the two articles' pictures must be **different bytes**, so that
 * *served the wrong figure* and *served the right one* are distinguishable by
 * content and not only by status.
 */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/**
 * A well-formed figure ref, exactly as `pdfFigureMarkerValue` spells one
 * (src/assets.ts): a version tag, thirty-two hex digits, the page and the
 * ordinal.
 */
function refFor(seed: string, page: number): string {
  return `pf1-${seed.replace(/-/g, "").slice(0, 32)}.${page}.1`;
}

/** The manifest one article's revision carries. */
function manifest(entries: PdfFigureEntry[]): Assets {
  return {
    version: "assets/2",
    sourceHash: "not-what-this-file-is-about",
    fetchedAt: new Date().toISOString(),
    entries: [],
    pdfFigures: entries,
  };
}

const A: Fixture = {
  slug: `test-asset-route-a-${RUN.slice(0, 8)}`,
  articleId: RUN,
  revisionId: randomUUID(),
  shortId: mintId(),
  blockId: "spya-pausa3",
  visibility: "private",
  ref: refFor(RUN, 3),
  bytes: png(1536, 864),
  sha256: "",
};
const B_ID = randomUUID();
const B: Fixture = {
  slug: `test-asset-route-b-${RUN.slice(0, 8)}`,
  articleId: B_ID,
  revisionId: randomUUID(),
  shortId: mintId(),
  blockId: "spya-qausb3",
  visibility: "public",
  ref: refFor(B_ID, 7),
  bytes: png(770, 372),
  sha256: "",
};

/**
 * A ref that is in the manifest as a **failure** — the state the muted line in
 * the prose is about. It has no hash at all, which is the point: there is
 * nothing for a URL to name, so nothing this route could serve.
 */
const FAILED_REF = refFor(randomUUID(), 9);

async function seed(who: Fixture, figures: PdfFigureEntry[]): Promise<void> {
  const db = getDb();
  await db.insert(articles).values({
    id: who.articleId,
    ownerId: TEST_OWNER,
    slug: who.slug,
    shortId: who.shortId,
    visibility: who.visibility,
  });
  await db.insert(articleRevisions).values({
    id: who.revisionId,
    articleId: who.articleId,
    status: "published",
    title: "An article made from a PDF",
    finalUrl: `https://example.test/${who.slug}`,
    stampedHtml: `<article><p data-spya-id="${who.blockId}">a paragraph</p></article>`,
    assets: manifest(figures),
  });
  await db.update(articles).set({ currentRevisionId: who.revisionId }).where(eq(articles.id, who.articleId));
  await db.insert(blockIdentities).values({ articleId: who.articleId, blockId: who.blockId });
  await db.insert(revisionBlocks).values({
    articleId: who.articleId,
    revisionId: who.revisionId,
    blockId: who.blockId,
    ordinal: 0,
    tag: "figure",
    kind: "text",
    text: "Figure 1. A diagram.",
    words: 4,
    html: `<figure data-spya-pdf-figure="${who.ref}"><figcaption>Figure 1. A diagram.</figcaption></figure>`,
    gistable: true,
  });
}

async function clean(who: Fixture): Promise<void> {
  const db = getDb();
  await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, who.articleId));
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, who.articleId));
  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, who.articleId));
  await db.delete(blockIdentities).where(eq(blockIdentities.articleId, who.articleId));
  await db.delete(articles).where(eq(articles.id, who.articleId));
}

const LEAK_AGE_MS = 60 * 60 * 1000;
async function sweepAbandoned(): Promise<void> {
  const db = getDb();
  const stale = await db
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        like(articles.slug, "test-asset-route-%"),
        lt(articles.createdAt, new Date(Date.now() - LEAK_AGE_MS)),
      ),
    );
  for (const { id } of stale) {
    await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, id));
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
    await db.delete(articleRevisions).where(eq(articleRevisions.articleId, id));
    await db.delete(blockIdentities).where(eq(blockIdentities.articleId, id));
    await db.delete(articles).where(eq(articles.id, id));
  }
}

/** Put one figure's bytes in the bucket under the name the manifest will use. */
async function store(who: Fixture): Promise<PdfFigureEntry> {
  const { createHash } = await import("node:crypto");
  const { blobStore } = await import("../src/store/blobs.js");
  const { canonicalKey } = await import("../src/source.js");
  who.sha256 = createHash("sha256").update(who.bytes).digest("hex");
  await blobStore().putIfAbsent(canonicalKey(who.sha256, "png"), who.bytes, "image/png");
  return {
    ref: who.ref,
    page: 3,
    status: "stored",
    sha256: who.sha256,
    ext: "png",
    contentType: "image/png",
    bytes: who.bytes.byteLength,
    width: 1536,
    height: 864,
  };
}

describe("the article-asset routes", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    blobDir = await mkdtemp(path.join(tmpdir(), "spya-asset-route-"));
    await sweepAbandoned();
    const figureA = await store(A);
    const figureB = await store(B);
    expect(A.sha256, "the two figures must differ").not.toBe(B.sha256);
    await seed(A, [
      figureA,
      { ref: FAILED_REF, page: 9, status: "failed", reason: "no-raster", at: new Date().toISOString() },
    ]);
    await seed(B, [figureB]);
  });

  afterAll(async () => {
    await clean(A);
    await clean(B);
    await rm(blobDir, { recursive: true, force: true });
    await closeDb();
  });

  /* ------------------------------------------------------- the owner's route */

  it("hands the owner the bytes their own manifest names", async () => {
    const sent = await get(`/api/asset/${A.slug}/${A.sha256}.png`);
    expect(sent.status).toBe(200);
    expect(Buffer.from(A.bytes).equals(sent.body)).toBe(true);
    /* From the manifest entry, not from the extension in the URL — src/routes.ts
       § `sendArticleAsset`. */
    expect(sent.headers["content-type"]).toBe("image/png");
    expect(sent.headers["content-length"]).toBe(String(A.bytes.byteLength));
    /* A stranger's file served from our origin: the one place a wrong content
       type becomes script. */
    expect(sent.headers["x-content-type-options"]).toBe("nosniff");
    /* The URL contains the hash of its own contents, so it can never change —
       and `private`, because the article is one reader's. */
    expect(sent.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
  });

  /**
   * **The case this file exists for.** The object is in the bucket, the URL is
   * well-formed, the caller owns *both* articles — and article A's manifest
   * does not name it, so it is a 404.
   *
   * This is the assertion that would go red if `sendArticleAsset` ever built
   * its key from the path instead of from the entry it found. Everything else
   * in this file would stay green.
   */
  it("404s a hash the article's own manifest does not name, even for the owner", async () => {
    const sent = await get(`/api/asset/${A.slug}/${B.sha256}.png`);
    expect(sent.status).toBe(404);
    expect(Buffer.from(B.bytes).equals(sent.body)).toBe(false);
  });

  /** And the other direction, so the case above is not passing on an empty A. */
  it("still serves that same hash from the article that does name it", async () => {
    const sent = await get(`/api/asset/${B.slug}/${B.sha256}.png`);
    expect(sent.status).toBe(200);
    expect(Buffer.from(B.bytes).equals(sent.body)).toBe(true);
  });

  /**
   * **The extension has to match the record**, for `sendPlate`'s reason: the
   * URL is a promise about the bytes exactly as the storage key is, so a
   * `.jpeg` URL must never serve a PNG.
   */
  it("404s the right hash under the wrong extension", async () => {
    const sent = await get(`/api/asset/${A.slug}/${A.sha256}.jpeg`);
    expect(sent.status).toBe(404);
  });

  /** A reader who owns nothing gets the same 404 every article route gives. */
  it("404s a reader who does not own the article", async () => {
    const sent = await get(`/api/asset/${A.slug}/${A.sha256}.png`, { verify: acceptOutsider });
    expect(sent.status).toBe(404);
    expect(Buffer.from(A.bytes).equals(sent.body)).toBe(false);
  });

  /**
   * A malformed hash is not this route at all, so it falls through the
   * authenticated table to its 404 — the pattern narrows what the capture can
   * be, which is not a security boundary (nothing trusts it) but is what keeps
   * the next reader from mistaking the capture for a storage key.
   */
  it("does not match a hash that is not one", async () => {
    for (const tail of ["nothex.png", `${"a".repeat(63)}.png`, `${A.sha256}.webp`]) {
      const sent = await get(`/api/asset/${A.slug}/${tail}`);
      expect({ tail, status: sent.status }).toEqual({ tail, status: 404 });
    }
  });

  /* ------------------------------------------------------- the public route */

  /**
   * **A stranger, with no `Authorization` header, on a shared article.** This
   * is the half that is easiest to leave out and hardest to notice missing: an
   * owner-only route looks finished from the owner's chair while every shared
   * article shows a blank space.
   */
  it("hands a signed-out reader a public article's picture", async () => {
    const sent = await getAnonymously(`/api/public/asset/${B.slug}/${B.sha256}.png`);
    expect(sent.status).toBe(200);
    expect(Buffer.from(B.bytes).equals(sent.body)).toBe(true);
    expect(sent.headers["content-type"]).toBe("image/png");
    expect(sent.headers["x-content-type-options"]).toBe("nosniff");
    /* **`no-store`, not the owner's year-long immutable.** The bytes cannot
       change, but the entitlement can: making an article private has to take
       effect on the next request. src/public/routes.ts § `sendBytes`. */
    expect(sent.headers["cache-control"]).toBe("no-store");
  });

  /**
   * **And not a private article's**, which is the other half of step 7's pair.
   *
   * Article A is private and its figure's bytes are in the same bucket as
   * article B's, under a name a visitor could perfectly well have seen — this
   * asks for it by that name with no session at all.
   */
  it("404s a private article's picture for a signed-out reader", async () => {
    const sent = await getAnonymously(`/api/public/asset/${A.slug}/${A.sha256}.png`);
    expect(sent.status).toBe(404);
    expect(Buffer.from(A.bytes).equals(sent.body)).toBe(false);
  });

  /** The manifest rule again, on the public side. */
  it("404s a hash the public article's manifest does not name", async () => {
    const sent = await getAnonymously(`/api/public/asset/${B.slug}/${A.sha256}.png`);
    expect(sent.status).toBe(404);
    expect(Buffer.from(A.bytes).equals(sent.body)).toBe(false);
  });

  /**
   * **A failed figure has no hash, so it has no URL** — and a request naming
   * the object that a *different* figure is stored under does not become one
   * because a failure exists beside it. Stated because `pdfFigures` holds both
   * kinds and a lookup that forgot to check `status` would serve the first
   * entry whose `ref` matched anything.
   */
  it("has nothing to serve for a figure recorded as failed", async () => {
    /* There is no hash to ask for, so the closest a caller can come is naming
       the *other* article's object on this article, which is the 404 above —
       and the manifest carrying a failure changes nothing about it. */
    const sent = await get(`/api/asset/${A.slug}/${B.sha256}.png`);
    expect(sent.status).toBe(404);
  });
});
