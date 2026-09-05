/**
 * **`GET /api/illustrated/:slug` and `GET /api/illustrated/:slug/:hash.jpeg`,
 * end to end through the real dispatcher.**
 *
 * The second one is why this file is long. Plates live in a
 * **content-addressed store shared by every article and every reader** —
 * `sha256/<hash>.jpeg`, the same bucket the articles' own figures are in — so a
 * route that put the caller's string into a blob key would be an arbitrary
 * object read: name a hash you have seen and get the object, whoever owns the
 * article it belongs to. Nothing about that failure is visible from the outside
 * unless a test names a hash the caller must not be able to reach.
 *
 * So the fixture is **two articles, both owned by the test reader**, each with
 * one plate whose bytes really are in the store. Asking article A for article
 * B's hash is the case, and it is the one that was watched failing: with
 * `sendPlate` changed to build its key from the path instead of from the
 * artefact, the request came back **200 and B's picture**, while every other
 * assertion in this file stayed green.
 *
 * Two articles rather than two owners on purpose. An outsider's 404 is already
 * covered by the ownership check the route shares with every other article
 * route, and testing the leak that way would prove the *gate* rather than the
 * key. The interesting adversary here is a reader who is entitled to be in the
 * app and is naming a hash they are not entitled to.
 *
 * Harness copied from tests/export-route.test.ts, including its per-run random
 * ids and the reasons for them.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq, like, lt } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Verifier } from "../src/auth.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { inputFingerprint as illustratedFingerprint } from "../src/illustrated.js";
import {
  ILLUSTRATED_VERSION,
  type Illustrated,
  type IllustratedImage,
} from "../src/illustrated-plate.js";
import type { OwnerId } from "../src/owner.js";
import type { Sketch } from "../src/sketch-scene.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/** Postgres, and set before src/routes.ts is ever imported — see export-route. */

/**
 * **The blob store, pointed at a temp directory.**
 *
 * `blobStore()` follows the process's credentials, so without this the route
 * would read the machine's real Supabase bucket — which on a box with a service
 * key in `.env.local` means the test depends on a container and on the bucket's
 * mime allowlist. Only the selector is replaced; `canonicalKey`, the
 * create-only write and the read-back are all the real thing, which is what the
 * key-rebuilding assertion needs them to be.
 */
let blobDir = "";
vi.mock("../src/store/blobs.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/blobs.js")>();
  const { fsBlobs } = await import("../src/store/blobs-fs.js");
  return { ...real, blobStore: () => fsBlobs(blobDir) };
});

const RUN = randomUUID();
const A = {
  slug: `test-illus-route-a-${RUN.slice(0, 8)}`,
  articleId: RUN,
  revisionId: randomUUID(),
  shortId: mintId(),
  blockId: "spya-pausa2",
};
const B = {
  slug: `test-illus-route-b-${RUN.slice(0, 8)}`,
  articleId: randomUUID(),
  revisionId: randomUUID(),
  shortId: mintId(),
  blockId: "spya-qausb2",
};

/** A reader who owns nothing — the same shape as export-route's `OUTSIDER`. */
const OUTSIDER = "0e5c0001-0000-4000-8000-0000000000c7" as OwnerId;
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

await pgReady({
  suite: "tests/illustrated-route.test.ts",
  tables: ["spideryarn.articles", "spideryarn.article_revisions"],
});
/* ------------------------------------------------------------ the fixture -- */

function sketchFor(slug: string): Sketch {
  return {
    version: "sketch/1",
    generator: "claude-opus-5",
    slug,
    sourceHash: "the-sketch-is-not-what-this-file-is-about",
    profileHash: null,
    title: "One argument",
    caption: "What the piece argues.",
    scenes: [
      {
        id: "overview",
        title: "The whole argument",
        height: 600,
        items: [
          { kind: "node", id: "n1", shape: "box", x: 10, y: 10, w: 100, h: 40, text: "The claim", size: "md" },
        ],
      },
    ],
  } as Sketch;
}

function illustratedFor(slug: string, sketch: Sketch, image: IllustratedImage): Illustrated {
  return {
    version: ILLUSTRATED_VERSION,
    generator: "claude-opus-5",
    illustrator: "openai/gpt-image-2",
    slug,
    sourceHash: illustratedFingerprint(sketch),
    profileHash: null,
    style: "An illuminated manuscript page.",
    plates: [
      {
        sceneId: "overview",
        title: "The whole argument",
        prompt: "A single vellum page, top to bottom.",
        vignettes: [],
        image,
      },
    ],
  } as Illustrated;
}

/** The two real plates, and the record each one is stored under. */
const stored: Record<"a" | "b", { image: IllustratedImage; bytes: Uint8Array }> = {} as never;

async function seed(
  who: typeof A,
  sketch: Sketch,
  illustrated: Illustrated,
): Promise<void> {
  const db = getDb();
  await db.insert(articles).values({
    id: who.articleId,
    ownerId: TEST_OWNER,
    slug: who.slug,
    shortId: who.shortId,
  });
  await db.insert(articleRevisions).values({
    id: who.revisionId,
    articleId: who.articleId,
    status: "published",
    title: "An article with a picture",
    finalUrl: `https://example.test/${who.slug}`,
    stampedHtml: `<article><p data-spya-id="${who.blockId}">a paragraph</p></article>`,
    sketch,
    illustrated,
  });
  await db.update(articles).set({ currentRevisionId: who.revisionId }).where(eq(articles.id, who.articleId));
  await db.insert(blockIdentities).values({ articleId: who.articleId, blockId: who.blockId });
  await db.insert(revisionBlocks).values({
    articleId: who.articleId,
    revisionId: who.revisionId,
    blockId: who.blockId,
    ordinal: 0,
    tag: "p",
    kind: "text",
    text: "a paragraph",
    words: 2,
    html: "<p>a paragraph</p>",
    gistable: true,
  });
}

async function clean(who: typeof A): Promise<void> {
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
        like(articles.slug, "test-illus-route-%"),
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

describe("the illustrated routes", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    blobDir = await mkdtemp(path.join(tmpdir(), "spya-illus-route-"));
    /* **Two different pictures**, so "it served the wrong plate" and "it served
       the right plate" are distinguishable by their bytes rather than only by
       their status. */
    const dir = path.resolve(import.meta.dirname, "..", "evals", "results", "illustrated-2026-09-03b");
    const jpegs = (await readdir(dir)).filter((n) => n.endsWith(".jpeg")).sort();
    const [one, two] = jpegs;
    if (!one || !two) throw new Error("need two plates in evals/results/illustrated-2026-09-03b/");

    const { storePlateImage } = await import("../src/illustrated-image.js");
    const bytesA = new Uint8Array(await readFile(path.join(dir, one)));
    stored.a = {
      bytes: bytesA,
      image: await storePlateImage({ image: bytesA, mediaType: "image/jpeg" }),
    };
    /* **`B`'s plate is a PNG, and that is the point of it being one.** Since
       2026-09-04 an article holds whatever the illustrator returned, and the
       current one returns PNG — so the two articles here are also the two
       formats, and every assertion below about the wrong article's plate is
       simultaneously an assertion that the extension in the URL is not
       decorative. `two` is left unread on purpose; the bytes only have to
       differ from `a`'s. */
    const bytesB = new Uint8Array(24);
    bytesB.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(bytesB.buffer).setUint32(16, 848);
    new DataView(bytesB.buffer).setUint32(20, 1264);
    stored.b = {
      bytes: bytesB,
      image: await storePlateImage({ image: bytesB, mediaType: "image/png" }),
    };
    expect(stored.a.image.sha256, "the two plates must differ").not.toBe(stored.b.image.sha256);
    expect(stored.a.image.ext).toBe("jpeg");
    expect(stored.b.image.ext).toBe("png");

    await sweepAbandoned();
    const sketchA = sketchFor(A.slug);
    const sketchB = sketchFor(B.slug);
    await seed(A, sketchA, illustratedFor(A.slug, sketchA, stored.a.image));
    await seed(B, sketchB, illustratedFor(B.slug, sketchB, stored.b.image));
  });

  afterAll(async () => {
    await clean(A);
    await clean(B);
    await rm(blobDir, { recursive: true, force: true });
    await closeDb();
  });

  /* ------------------------------------------------------------ the artefact */

  it("hands the owner the artefact, shaped like the Sketch response", async () => {
    const sent = await get(`/api/illustrated/${A.slug}`);
    expect(sent.status).toBe(200);
    const body = JSON.parse(sent.body.toString("utf8")) as {
      illustrated: Illustrated;
      stale: boolean;
      outdated: boolean;
      profileChanged: boolean;
    };
    expect(Object.keys(body).sort()).toEqual(["illustrated", "outdated", "profileChanged", "stale"]);
    expect(body.illustrated.plates[0]?.image?.sha256).toBe(stored.a.image.sha256);
    expect(body.outdated).toBe(false);
    expect(body.profileChanged).toBe(false);
  });

  it("404s the artefact for a reader who does not own the article", async () => {
    const sent = await get(`/api/illustrated/${A.slug}`, { verify: acceptOutsider });
    expect(sent.status).toBe(404);
  });

  /* --------------------------------------------------------------- the bytes */

  it("serves this article's own plate, with the headers a picture needs", async () => {
    const sent = await get(`/api/illustrated/${A.slug}/${stored.a.image.sha256}.jpeg`);
    expect(sent.status).toBe(200);
    expect(sent.headers["content-type"]).toBe("image/jpeg");
    expect(sent.headers["x-content-type-options"]).toBe("nosniff");
    expect(sent.headers["content-length"]).toBe(String(stored.a.bytes.byteLength));
    /* The bytes, not merely a 200 with a type on it: a route that streamed
       nothing would satisfy every header assertion above. */
    expect(Buffer.compare(sent.body, Buffer.from(stored.a.bytes))).toBe(0);
  });

  /**
   * **The one this file exists for.**
   *
   * `B`'s hash is a real, well-formed, currently-stored blob key. `A` must not
   * be a door onto it. Watched failing on 2026-09-03 with `sendPlate` building
   * its key from the path rather than from the artefact: 200, and B's picture.
   */
  it("refuses a hash that is a plate of a DIFFERENT article", async () => {
    /* Its own extension, so the 404 is about the article and not about the
       suffix — a URL that was wrong twice would prove neither. */
    const sent = await get(
      `/api/illustrated/${A.slug}/${stored.b.image.sha256}.${stored.b.image.ext}`,
    );
    expect(sent.status).toBe(404);
    expect(
      Buffer.compare(sent.body, Buffer.from(stored.b.bytes)),
      "the other article's bytes must not be in the response at all",
    ).not.toBe(0);
  });

  /**
   * **A PNG plate, served as one, all the way from the store to the header.**
   *
   * The illustrator changed on 2026-09-04 to one that ignores `output_format`
   * and returns PNG whatever it is asked. Every link in this chain used to say
   * `jpeg` as a literal — the storage key, the route pattern, the
   * `Content-Type`, and the URL the panel builds — so this is the assertion
   * that the whole of the change landed rather than most of it.
   */
  it("serves a PNG plate as a PNG", async () => {
    const sent = await get(`/api/illustrated/${B.slug}/${stored.b.image.sha256}.png`);
    expect(sent.status).toBe(200);
    expect(sent.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(sent.body, Buffer.from(stored.b.bytes))).toBe(0);
  });

  /**
   * **The extension is a promise about the bytes, not decoration.** The record
   * decides the `Content-Type`, so a `.jpeg` URL answered from a PNG record
   * would be this route telling a cache one thing and the header another — and
   * both are immutable for a year.
   */
  it("refuses a plate asked for under the wrong extension", async () => {
    const sent = await get(`/api/illustrated/${A.slug}/${stored.a.image.sha256}.png`);
    expect(sent.status).toBe(404);
  });

  it("refuses a well-formed hash that is nobody's plate", async () => {
    const sent = await get(`/api/illustrated/${A.slug}/${"ab".repeat(32)}.jpeg`);
    expect(sent.status).toBe(404);
  });

  it("404s the bytes for a reader who does not own the article", async () => {
    /* Their own hash would not help them either, but the interesting version is
       the one where the object genuinely exists and the article is not theirs. */
    const sent = await get(`/api/illustrated/${A.slug}/${stored.a.image.sha256}.jpeg`, {
      verify: acceptOutsider,
    });
    expect(sent.status).toBe(404);
  });

  it("does not answer a plate URL without authentication", async () => {
    const sent = await get(`/api/illustrated/${A.slug}/${stored.a.image.sha256}.jpeg`, {
      headers: {},
    });
    expect(sent.status).toBe(401);
  });

  it("404s an article that has never been painted", async () => {
    const sent = await get(`/api/illustrated/no-such-article-${RUN.slice(0, 8)}`);
    expect(sent.status).toBe(404);
  });
});
