/**
 * **A private link, end to end, against a real Postgres.**
 *
 * docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md,
 * stage 1. The owner makes a link; anybody holding its key reads the article
 * as a visitor reads a public one; nobody else does. This file is the cases
 * the plan's test table gives tests/public-visibility-pg.test.ts and
 * tests/asset-route.test.ts, with the owner's route beside them. It is its own
 * file because it needs its own fixture: several articles at once, so that a
 * key can be tried against the article it does *not* belong to, which is the
 * case a one-article fixture cannot ask.
 *
 * ## The cases, and why each is here
 *
 * | Sent with the request | A private article with a link |
 * |---|---|
 * | its own key | 200, and the payload says `sharedBy: "link"` |
 * | no key, an empty key, a malformed key | the absent article's 404 |
 * | a well-formed key that is nobody's | the same 404 |
 * | **another article's valid key** | the same 404 |
 * | the key after *Turn off* | the same 404 |
 * | the old key after a new link is made | the same 404 |
 *
 * and the same table for one picture's bytes. Then: a public article reads
 * with any of those (public wins) and says `"public"`; an unreadable revision
 * is a 404 with the right key, as its public twin is; an archived article
 * reads by its link and is not listed, as its public twin is; no private
 * article with a link is ever in `/api/public/library`; and a second signed-in
 * person can neither read, make nor turn off somebody else's link.
 *
 * **"The same 404" is compared whole**: status, headers and body, against a
 * slug nobody has. A different message would tell a stranger the article
 * exists.
 *
 * ## Why a real database
 *
 * The defence is a `where`, a CHECK and SQL's rule that null equals nothing.
 * None of those exists outside Postgres. tests/public-reads.test.ts reads the
 * statements; this proves what they return over real rows.
 */

import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Assets } from "../src/assets.js";
import type { Verifier } from "../src/auth.js";
import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articleShareLinkEvents,
  articles,
  blockIdentities,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { currentOwnerId, type OwnerId, runInRequest } from "../src/owner.js";
import { parseShareKey } from "../src/share-key.js";
import { accessFor, PUBLIC_ONLY } from "../src/store/public-access.js";
import type { ShareLinkState } from "../src/types.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { pgReady } from "./helpers/pg-ready.js";

/* Raised before src/log.ts is first imported, which is inside the first
   `handleApi` call below: vitest's `NODE_ENV=test` would otherwise make the
   logger silent, and "no line contains the key" would be true of no lines. */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  if (previousLevel === undefined || ["silent", "fatal", "error", "warn"].includes(previousLevel)) {
    process.env.LOG_LEVEL = "info";
  }
  return { previousLevel };
});

loadEnvLocal();

/* The blob store pointed at a temp directory, as tests/asset-route.test.ts
   does and for its reason: without it the route reads the machine's bucket. */
let blobDir = "";
vi.mock("../src/store/blobs.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/blobs.js")>();
  const { fsBlobs } = await import("../src/store/blobs-fs.js");
  return { ...real, blobStore: () => fsBlobs(blobDir) };
});

await pgReady({
  suite: "tests/share-link-pg.test.ts",
  tables: ["spideryarn.article_share_link_events"],
  columns: [
    { table: "spideryarn.articles", column: "share_token" },
    { table: "spideryarn.articles", column: "share_token_at" },
  ],
});

const RUN = randomUUID().slice(0, 8);

/** The seeded development owner. Read here, where the environment still answers. */
const OWNER = currentOwnerId();
/** Somebody else, signed in, who owns nothing. */
const OUTSIDER = "00000000-0000-4000-8000-0000005a11ec" as OwnerId;

const asPerson = (sub: string): Verifier => async () => ({
  ok: true,
  claims: { sub, email: `${sub}@example.test`, role: "authenticated", is_anonymous: false },
});

/** A canary in each article's prose, so "served the wrong article" has a body to show it. */
interface Fixture {
  name: string;
  slug: string;
  articleId: string;
  revisionId: string;
  blockId: string;
  prose: string;
  title: string;
  visibility: "private" | "public";
  processing?: "minimal";
  archived?: boolean;
  /** No blocks at all: a revision React cannot draw. */
  boneless?: boolean;
  /** A picture of its own, distinct bytes per article. */
  figure?: { bytes: Uint8Array; sha256: string };
}

function fixture(name: string, extra: Partial<Fixture> = {}): Fixture {
  return {
    name,
    slug: `test-share-link-${name}-${RUN}`,
    articleId: randomUUID(),
    revisionId: randomUUID(),
    blockId: mintId(),
    prose: `The prose of the ${name} article, canary ${name.toUpperCase()}-${RUN}.`,
    title: `Title of the ${name} article ${RUN}`,
    visibility: "private",
    ...extra,
  };
}

/** A real PNG header, different per size, as tests/asset-route.test.ts builds one. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** The private article the link is made for. */
const MINE = fixture("mine", { figure: { bytes: png(640, 480), sha256: "" } });
/** A second private article with a link of its own: the source of "another article's valid key". */
const OTHER = fixture("other", { figure: { bytes: png(320, 200), sha256: "" } });
/** A private article nobody made a link for. */
const BARE = fixture("bare");
/** Public, and given a link as well. */
const BOTH = fixture("both", { visibility: "public" });
/** A paper with only minimal processing. */
const MINIMAL = fixture("minimal", { processing: "minimal" });
/** Private, with a link, and a revision with no blocks. */
const BONELESS = fixture("boneless", { boneless: true });
/** Private, with a link, and archived. */
const ARCHIVED = fixture("archived", { archived: true });

const ALL = [MINE, OTHER, BARE, BOTH, MINIMAL, BONELESS, ARCHIVED];
/** A slug nothing has, for the 404 everything else is compared with. */
const ABSENT = `test-share-link-absent-${RUN}`;
/** Key-shaped, and nobody's. */
const NOBODYS_KEY = "zzzzzzzzzzzzzzzzzzzzzz";

interface Reply {
  status: number;
  headers: Record<string, string>;
  text: string;
  body: Record<string, unknown>;
  bytes: Buffer;
}

/** Drive `handleApi`. No `as` is an anonymous request with no header at all. */
async function call(
  method: string,
  url: string,
  opts: { body?: unknown; as?: string } = {},
): Promise<Reply> {
  const payload = opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: opts.as === undefined ? {} : { authorization: "Bearer whatever" } },
  ) as unknown as IncomingMessage;

  let status = 0;
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = String(value);
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.from(chunk as never));
    },
  } as unknown as ServerResponse;

  const { handleApi } = await import("../src/routes.js");
  await handleApi(req, res, opts.as === undefined ? undefined : asPerson(opts.as));
  const bytes = Buffer.concat(chunks);
  const text = bytes.toString("utf8");
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* An image. `bytes` is what the case reads. */
  }
  return { status, headers, text, body, bytes };
}

const article = (who: Fixture, key?: string) =>
  call("GET", `/api/public/article/${who.slug}${key === undefined ? "" : `?key=${key}`}`);
const picture = (who: Fixture, sha256: string, key?: string) =>
  call("GET", `/api/public/asset/${who.slug}/${sha256}.png${key === undefined ? "" : `?key=${key}`}`);
const link = (method: string, who: Fixture | string, opts: { body?: unknown; as?: string } = {}) =>
  call(method, `/api/article/${typeof who === "string" ? who : who.slug}/share-link`, {
    as: OWNER,
    ...opts,
  });

/** Make a link as the owner and hand back its key. */
async function makeLink(who: Fixture): Promise<string> {
  const r = await link("POST", who, { body: { rightsConfirmed: true } });
  expect(r.status, `${who.name}: ${r.text}`).toBe(200);
  const state = r.body as ShareLinkState;
  if (!state.on) throw new Error(`${who.name} has no link after making one`);
  return state.key;
}

const events = (who: Fixture) =>
  getDb()
    .select()
    .from(articleShareLinkEvents)
    .where(eq(articleShareLinkEvents.articleId, who.articleId))
    .orderBy(articleShareLinkEvents.createdAt);

const tokenOf = async (who: Fixture) =>
  (
    await getDb()
      .select({ token: articles.shareToken, at: articles.shareTokenAt })
      .from(articles)
      .where(eq(articles.id, who.articleId))
  )[0];

/** What a refusal has to equal: the reply for a slug nobody has. */
function sameAs(absent: Reply, slug: string) {
  return {
    status: absent.status,
    headers: absent.headers,
    /* The one legitimate difference is the slug the caller sent, echoed in the
       message as it is for an absent article. */
    text: absent.text.split(ABSENT).join(slug),
  };
}
const shape = (r: Reply) => ({ status: r.status, headers: r.headers, text: r.text });

async function seed(who: Fixture): Promise<void> {
  const db = getDb();
  let assets: Assets | null = null;
  if (who.figure) {
    const { blobStore } = await import("../src/store/blobs.js");
    const { canonicalKey } = await import("../src/source.js");
    who.figure.sha256 = createHash("sha256").update(who.figure.bytes).digest("hex");
    await blobStore().putIfAbsent(canonicalKey(who.figure.sha256, "png"), who.figure.bytes, "image/png");
    assets = {
      version: "assets/2",
      sourceHash: "not-what-this-file-is-about",
      fetchedAt: new Date().toISOString(),
      entries: [
        {
          url: `https://example.test/${who.slug}.png`,
          status: "stored",
          sha256: who.figure.sha256,
          ext: "png",
          contentType: "image/png",
          bytes: who.figure.bytes.byteLength,
        },
      ],
      pdfFigures: [],
    };
  }
  await db.insert(articles).values({
    id: who.articleId,
    ownerId: OWNER,
    slug: who.slug,
    shortId: mintId(),
    visibility: who.visibility,
    publicAt: who.visibility === "public" ? new Date() : null,
    ...(who.archived ? { archivedAt: new Date() } : {}),
  });
  await db.insert(articleRevisions).values({
    id: who.revisionId,
    articleId: who.articleId,
    status: "published",
    title: who.title,
    wordCount: 9,
    blockCount: who.boneless ? 0 : 1,
    partCount: 0,
    sectionCount: 0,
    rootGist: `Gist of ${who.name}.`,
    assets,
    tree: {
      version: "1",
      generator: "test",
      slug: who.slug,
      rootId: "n0",
      nodes: {
        n0: {
          id: "n0",
          depth: 0,
          parent: null,
          children: [],
          range: [who.blockId, who.blockId],
          title: "Root",
          gist: `Gist of ${who.name}.`,
        },
      },
    },
  });
  await db.update(articles).set({ currentRevisionId: who.revisionId }).where(eq(articles.id, who.articleId));
  if (!who.boneless) {
    await db.insert(blockIdentities).values({ articleId: who.articleId, blockId: who.blockId });
    await db.insert(revisionBlocks).values({
      articleId: who.articleId,
      revisionId: who.revisionId,
      blockId: who.blockId,
      ordinal: 0,
      tag: "p",
      kind: "text",
      text: who.prose,
      words: 9,
      html: `<p>${who.prose}</p>`,
      gistable: true,
    });
  }
  /* After the revision, so the fixture's own inserts are not refused: a
     minimal paper is on the shelf with nothing to read. */
  if (who.processing === "minimal") {
    await db.update(articles).set({ processing: "minimal" }).where(eq(articles.id, who.articleId));
  }
}

async function clean(): Promise<void> {
  const db = getDb();
  const ids = ALL.map((who) => who.articleId);
  await db.delete(articleShareLinkEvents).where(inArray(articleShareLinkEvents.articleId, ids));
  await db.delete(articleShareLinkEvents).where(inArray(articleShareLinkEvents.slug, ALL.map((w) => w.slug)));
  await db.delete(revisionBlocks).where(inArray(revisionBlocks.articleId, ids));
  await db.update(articles).set({ currentRevisionId: null }).where(inArray(articles.id, ids));
  await db.delete(articleRevisions).where(inArray(articleRevisions.articleId, ids));
  await db.delete(blockIdentities).where(inArray(blockIdentities.articleId, ids));
  await db.delete(articles).where(inArray(articles.id, ids));
}

/** The keys this run made. Filled in `beforeAll`, read everywhere. */
const KEYS = { mine: "", other: "", both: "", boneless: "", archived: "" };

describe("a private link", { timeout: 60_000 }, () => {
  let absent: Reply;
  let absentPicture: Reply;

  beforeAll(async () => {
    blobDir = await mkdtemp(path.join(tmpdir(), "spya-share-link-"));
    for (const who of ALL) await seed(who);
    absent = await article({ ...MINE, slug: ABSENT });
    absentPicture = await picture({ ...MINE, slug: ABSENT }, "0".repeat(64));
  });

  afterAll(async () => {
    await clean();
    await rm(blobDir, { recursive: true, force: true });
    await closeDb();
    if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = HOISTED.previousLevel;
  });

  /* ------------------------------------------------- before there is one -- */

  it("starts with no link: the owner is told so, and a stranger gets the absent article's 404", async () => {
    expect(absent.status).toBe(404);
    expect(absent.headers["cache-control"]).toBe("no-store");

    const state = await link("GET", MINE);
    expect(state.status).toBe(200);
    expect(state.body).toEqual({ on: false });
    expect(state.headers["cache-control"]).toBe("private, no-store");

    expect(await tokenOf(MINE)).toEqual({ token: null, at: null });
    for (const key of [undefined, "", NOBODYS_KEY]) {
      expect(shape(await article(MINE, key)), String(key)).toEqual(sameAs(absent, MINE.slug));
    }
  });

  /* --------------------------------------------------- the owner's route -- */

  it("refuses to make one without the rights tick, and changes nothing", async () => {
    for (const body of [
      {},
      { rightsConfirmed: false },
      { rightsConfirmed: "yes" },
      { rightsConfirmed: 1 },
      { rightsConfirmed: true, key: "AbCdEfGhIjKlMnOpQrStU_" },
      { rightsConfirmed: true, visibility: "public" },
      [],
      null,
    ]) {
      const r = await link("POST", MINE, { body });
      expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]);
    }
    expect(await tokenOf(MINE)).toEqual({ token: null, at: null });
    expect(await events(MINE)).toEqual([]);
  });

  it("refuses a paper that has not been read through, exactly as going public does", async () => {
    const asLink = await link("POST", MINIMAL, { body: { rightsConfirmed: true } });
    const asPublic = await call("PUT", `/api/article/${MINIMAL.slug}/visibility`, {
      body: { visibility: "public", rightsConfirmed: true },
      as: OWNER,
    });
    expect(asLink.status).toBe(409);
    expect({ status: asLink.status, body: asLink.body }).toEqual({
      status: asPublic.status,
      body: asPublic.body,
    });
    expect(asLink.body.code).toBe("not-processed");
    expect(await tokenOf(MINIMAL)).toEqual({ token: null, at: null });
    expect(await events(MINIMAL)).toEqual([]);
  });

  it("is refused to somebody who does not own the article: read, make and turn off", async () => {
    /* What a non-owner gets from the visibility switch, which is the model. */
    const model = await call("PUT", `/api/article/${MINE.slug}/visibility`, {
      body: { visibility: "private" },
      as: OUTSIDER,
    });
    expect(model.status).toBe(404);
    for (const [method, body] of [
      ["GET", undefined],
      ["POST", { rightsConfirmed: true }],
      ["DELETE", undefined],
    ] as const) {
      const r = await link(method, MINE, { as: OUTSIDER, ...(body === undefined ? {} : { body }) });
      expect([method, r.status, r.body]).toEqual([method, 404, model.body]);
      /* And an anonymous caller does not get that far. */
      expect([method, (await call(method, `/api/article/${MINE.slug}/share-link`)).status]).toEqual([method, 401]);
    }
    expect(await tokenOf(MINE)).toEqual({ token: null, at: null });
    expect(await events(MINE)).toEqual([]);
  });

  it("answers a slug nobody has, and one that is not a slug, as every owner route does", async () => {
    expect((await link("GET", ABSENT)).status).toBe(404);
    expect((await link("POST", ABSENT, { body: { rightsConfirmed: true } })).status).toBe(404);
    expect((await link("DELETE", ABSENT)).status).toBe(404);
    expect((await link("GET", "Not%20A%20Slug")).status).toBe(400);
  });

  it("makes a link for its owner: a 22-character key, when, and one audit row without the key", async () => {
    const before = Date.now();
    const r = await link("POST", MINE, { body: { rightsConfirmed: true } });
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    const state = r.body as ShareLinkState;
    if (!state.on) throw new Error("no link");
    expect(Object.keys(state).sort()).toEqual(["key", "on", "since"]);
    expect(parseShareKey(state.key)).toBe(state.key);
    expect(Date.parse(state.since)).toBeGreaterThanOrEqual(before - 1000);
    KEYS.mine = state.key;

    /* The row holds exactly what the owner was told. */
    const row = await tokenOf(MINE);
    expect(row?.token).toBe(state.key);
    expect(row?.at?.toISOString()).toBe(state.since);

    const log = await events(MINE);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      articleId: MINE.articleId,
      slug: MINE.slug,
      actorOwnerId: OWNER,
      event: "created",
      rightsConfirmed: true,
    });
    expect(JSON.stringify(log)).not.toContain(state.key);

    /* Visibility did not move: a link-shared article is a private article. */
    const [vis] = await getDb()
      .select({ visibility: articles.visibility, publicAt: articles.publicAt })
      .from(articles)
      .where(eq(articles.id, MINE.articleId));
    expect(vis).toEqual({ visibility: "private", publicAt: null });
  });

  it("reads the same link back, so the card can show it again", async () => {
    const again = await link("GET", MINE);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ on: true, key: KEYS.mine });
    expect(await events(MINE)).toHaveLength(1);
    /* And still not to anybody else. */
    expect((await link("GET", MINE, { as: OUTSIDER })).status).toBe(404);
  });

  it("is the only owner response that carries the key", async () => {
    for (const url of [
      `/api/article/${MINE.slug}`,
      `/api/library`,
      `/api/metadata/${MINE.slug}`,
    ]) {
      const r = await call("GET", url, { as: OWNER });
      expect(r.text, url).not.toContain(KEYS.mine);
      expect(r.text, url).not.toMatch(/share_?token/i);
    }
    /* The control: the article route did answer with this article. */
    expect((await call("GET", `/api/article/${MINE.slug}`, { as: OWNER })).status).toBe(200);
  });

  /* ------------------------------------------------- what the key opens -- */

  it("lets a stranger with the key read the article, and says it came by a link", async () => {
    const r = await article(MINE, KEYS.mine);
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body.sharedBy).toBe("link");
    expect(r.text).toContain(MINE.prose);
    expect((r.body.meta as { slug: string }).slug).toBe(MINE.slug);
    /* The key that opened it is not in what came back. */
    expect(r.text).not.toContain(KEYS.mine);
    expect(r.text).not.toMatch(/share_?token/i);
  });

  it("and a signed-in stranger with the key gets byte for byte what an anonymous one gets", async () => {
    const anonymous = await article(MINE, KEYS.mine);
    const signedIn = await call("GET", `/api/public/article/${MINE.slug}?key=${KEYS.mine}`, { as: OUTSIDER });
    expect(signedIn.text).toBe(anonymous.text);
  });

  it("gives every way of not having the key the absent article's 404, whole", async () => {
    KEYS.other = await makeLink(OTHER);
    expect(KEYS.other).not.toBe(KEYS.mine);
    /* The control for the row below it: OTHER's key is a working key. */
    expect((await article(OTHER, KEYS.other)).status).toBe(200);

    for (const [why, key] of [
      ["no key", undefined],
      ["an empty key", ""],
      ["a short key", KEYS.mine.slice(0, 21)],
      ["the key with a character added", `${KEYS.mine}A`],
      ["the key in another case", KEYS.mine.toUpperCase() === KEYS.mine ? KEYS.mine.toLowerCase() : KEYS.mine.toUpperCase()],
      ["a key that is nobody's", NOBODYS_KEY],
      ["another article's valid key", KEYS.other],
      ["a SQL wildcard", "%".repeat(22)],
      ["an encoded null", "%00"],
    ] as const) {
      const r = await article(MINE, key);
      expect(r.text, why).not.toContain(MINE.prose);
      expect(shape(r), why).toEqual(sameAs(absent, MINE.slug));
    }
    /* A key is a key for one article: MINE's does not open OTHER, nor BARE. */
    expect(shape(await article(OTHER, KEYS.mine))).toEqual(sameAs(absent, OTHER.slug));
    expect(shape(await article(BARE, KEYS.mine))).toEqual(sameAs(absent, BARE.slug));
    /* And a HEAD is refused the same way. */
    const head = await call("HEAD", `/api/public/article/${MINE.slug}?key=${NOBODYS_KEY}`);
    expect(head.status).toBe(404);
  });

  it("serves a picture to the key's holder, and nobody else, by the same table", async () => {
    const sha = MINE.figure?.sha256 ?? "";
    const otherSha = OTHER.figure?.sha256 ?? "";
    expect(absentPicture.status).toBe(404);

    const mine = await picture(MINE, sha, KEYS.mine);
    expect(mine.status).toBe(200);
    expect(mine.headers["content-type"]).toBe("image/png");
    expect(mine.headers["cache-control"]).toBe("no-store");
    expect(mine.bytes.equals(Buffer.from(MINE.figure?.bytes ?? []))).toBe(true);

    /* Not having the key: the article's own 404, whichever way. */
    const noSuchArticle = await picture({ ...MINE, slug: ABSENT }, sha);
    for (const [why, key] of [
      ["no key", undefined],
      ["an empty key", ""],
      ["a key that is nobody's", NOBODYS_KEY],
      ["another article's valid key", KEYS.other],
    ] as const) {
      const r = await picture(MINE, sha, key);
      expect(r.bytes.equals(Buffer.from(MINE.figure?.bytes ?? [])), why).toBe(false);
      expect(shape(r), why).toEqual(sameAs(noSuchArticle, MINE.slug));
    }

    /* **A hash that belongs to a different private article.** OTHER's picture
       is a real object in the same bucket. Asked for under MINE's slug with
       MINE's key, it is not in MINE's manifest, so it is the 404 a hash of
       nothing gets; and under OTHER's slug with MINE's key it is OTHER's
       closed door. Neither says the object exists. */
    const nothing = await picture(MINE, "0".repeat(64), KEYS.mine);
    expect(nothing.status).toBe(404);
    const crossed = await picture(MINE, otherSha, KEYS.mine);
    expect(crossed.bytes.equals(Buffer.from(OTHER.figure?.bytes ?? []))).toBe(false);
    expect(shape(crossed)).toEqual(shape(nothing));
    expect(shape(await picture(OTHER, otherSha, KEYS.mine))).toEqual(
      sameAs(await picture({ ...OTHER, slug: ABSENT }, otherSha), OTHER.slug),
    );
    /* The control: OTHER's own key does serve OTHER's picture. */
    const theirs = await picture(OTHER, otherSha, KEYS.other);
    expect(theirs.status).toBe(200);
    expect(theirs.bytes.equals(Buffer.from(OTHER.figure?.bytes ?? []))).toBe(true);
  });

  it("gives the page's head read a link and no title, and a wrong key the 404", async () => {
    const { pgPublicReader } = await import("../src/store/public-reader.js");
    const found = await runInRequest(() => pgPublicReader.loadHead(MINE.slug, accessFor(parseShareKey(KEYS.mine))));
    expect(found).toEqual({ sharedBy: "link" });
    expect(JSON.stringify(found)).not.toContain(MINE.title);
    for (const access of [PUBLIC_ONLY, accessFor(parseShareKey(NOBODYS_KEY)), accessFor(parseShareKey(KEYS.other))]) {
      await expect(runInRequest(() => pgPublicReader.loadHead(MINE.slug, access))).rejects.toMatchObject({
        status: 404,
      });
    }
  });

  it("serves the page itself as a 200 with nothing of the article in it, and the wrong key as the absent 404", async () => {
    const { servePublicReadPage } = await import("../src/public/page.js");
    const SHELL = [
      "<!doctype html><html><head>",
      "<!-- spideryarn:managed-head:start -->",
      "<title>Spideryarn</title>",
      "<!-- spideryarn:managed-head:end -->",
      '</head><body><div id="root"></div></body></html>',
    ].join("\n");
    const page = async (slug: string, query: string) => {
      const headers: Record<string, string> = {};
      let status = 0;
      let body = "";
      const res = {
        set statusCode(v: number) {
          status = v;
        },
        get statusCode() {
          return status;
        },
        setHeader(name: string, value: string) {
          headers[name] = value;
        },
        end(chunk?: string) {
          body = chunk ?? "";
        },
      } as unknown as ServerResponse;
      await runInRequest(() =>
        servePublicReadPage({
          req: { method: "GET", url: `/read/${slug}${query}` },
          res,
          slug,
          shell: { html: SHELL, sha256: "e".repeat(64) },
        }),
      );
      return { status, headers, body };
    };

    const keyed = await page(MINE.slug, `?key=${KEYS.mine}`);
    expect(keyed.body).not.toContain(MINE.title);
    expect(keyed.body).not.toContain(KEYS.mine);
    expect(keyed.status).toBe(200);
    expect(keyed.body).toBe(SHELL);

    const gone = await page(ABSENT, "");
    expect(gone.status).toBe(404);
    for (const query of ["", `?key=${NOBODYS_KEY}`, `?key=${KEYS.other}`, "?key="]) {
      expect({ query, ...(await page(MINE.slug, query)) }).toEqual({ query, ...gone });
    }

    /* Public wins: BOTH keeps its full head, with a key that is not its own. */
    const publicPage = await page(BOTH.slug, `?key=${KEYS.mine}`);
    expect(publicPage.status).toBe(200);
    expect(publicPage.body).toContain(BOTH.title);
  });

  /* --------------------------------------------------- never on the shelf -- */

  it("is not on the public shelf, whatever key is sent with the request", async () => {
    KEYS.archived = await makeLink(ARCHIVED);
    const privateSlugs = [MINE, OTHER, BARE, ARCHIVED].map((who) => who.slug);
    for (const query of ["", `?key=${KEYS.mine}`, `?key=${KEYS.other}`, `?key=${NOBODYS_KEY}`]) {
      const r = await call("GET", `/api/public/library${query}`);
      expect(r.status).toBe(200);
      const listed = (r.body.entries as { slug: string }[]).map((entry) => entry.slug);
      for (const slug of privateSlugs) expect(listed, `${query} ${slug}`).not.toContain(slug);
      /* The control: the shelf does list a public article of this fixture. */
      expect(listed, query).toContain(BOTH.slug);
      expect(r.text).not.toContain(KEYS.mine);
    }
  });

  it("reads an archived article by its link, as an archived public one reads, and lists neither", async () => {
    const r = await article(ARCHIVED, KEYS.archived);
    expect(r.status).toBe(200);
    expect(r.body.sharedBy).toBe("link");
    expect(shape(await article(ARCHIVED))).toEqual(sameAs(absent, ARCHIVED.slug));
  });

  it("refuses an unreadable revision even with its own key, as its public twin is refused", async () => {
    KEYS.boneless = await makeLink(BONELESS);
    expect(shape(await article(BONELESS, KEYS.boneless))).toEqual(sameAs(absent, BONELESS.slug));
    const { pgPublicReader } = await import("../src/store/public-reader.js");
    await expect(
      runInRequest(() => pgPublicReader.loadHead(BONELESS.slug, accessFor(parseShareKey(KEYS.boneless)))),
    ).rejects.toMatchObject({ status: 404 });
  });

  /* ------------------------------------------------ public and link together -- */

  it("reads a public article with any key at all, and says public every time", async () => {
    const bare = await article(BOTH);
    expect(bare.status).toBe(200);
    expect(bare.body.sharedBy).toBe("public");

    KEYS.both = await makeLink(BOTH);
    for (const key of [undefined, KEYS.both, KEYS.mine, NOBODYS_KEY, "", "nonsense"]) {
      const r = await article(BOTH, key);
      expect(r.text, String(key)).toBe(bare.text);
    }

    /* Turning the link off changes nothing a visitor sees, and it stays listed. */
    expect((await link("DELETE", BOTH)).body).toEqual({ on: false });
    for (const key of [undefined, KEYS.both]) {
      expect((await article(BOTH, key)).text, String(key)).toBe(bare.text);
    }
    const shelf = await call("GET", "/api/public/library");
    expect((shelf.body.entries as { slug: string }[]).map((e) => e.slug)).toContain(BOTH.slug);
  });

  it("leaves a link working when a public article is made private again, and says link then", async () => {
    const key = await makeLink(BOTH);
    const down = await call("PUT", `/api/article/${BOTH.slug}/visibility`, {
      body: { visibility: "private" },
      as: OWNER,
    });
    expect(down.status).toBe(200);
    expect(shape(await article(BOTH))).toEqual(sameAs(absent, BOTH.slug));
    const viaLink = await article(BOTH, key);
    expect(viaLink.status).toBe(200);
    expect(viaLink.body.sharedBy).toBe("link");
    const shelf = await call("GET", "/api/public/library");
    expect((shelf.body.entries as { slug: string }[]).map((e) => e.slug)).not.toContain(BOTH.slug);
  });

  /* -------------------------------------------------------- the log -- */

  /**
   * **A request carrying `?key=` writes no line containing the key.** The
   * request log takes the path, which has no query; the refusals name the
   * slug. Read off the real logger, over the successes and every kind of
   * refusal, including the owner's route that returns the key.
   */
  it("writes no log line containing a key, for a read, a refusal or the owner's own route", async () => {
    const sha = MINE.figure?.sha256 ?? "";
    const written = await logLinesWhile(async () => {
      expect((await article(MINE, KEYS.mine)).status).toBe(200);
      expect((await picture(MINE, sha, KEYS.mine)).status).toBe(200);
      expect((await article(OTHER, KEYS.mine)).status).toBe(404);
      expect((await picture(OTHER, sha, KEYS.mine)).status).toBe(404);
      expect((await call("POST", `/api/public/article/${MINE.slug}?key=${KEYS.mine}`)).status).toBe(405);
      expect((await call("GET", `/api/public/nothing?key=${KEYS.mine}`)).status).toBe(404);
      expect((await call("GET", `/api/public/library?key=${KEYS.mine}`)).status).toBe(200);
      expect((await link("GET", MINE)).body).toMatchObject({ key: KEYS.mine });
      expect((await link("GET", MINE, { as: OUTSIDER })).status).toBe(404);
    });
    /* The control: the requests were logged, with their paths. */
    expect(written).toContain(`/api/public/article/${MINE.slug}`);
    expect(written).toContain("/share-link");
    expect(written).not.toContain(KEYS.mine);
    expect(written).not.toContain("key=");
  });

  /* ----------------------------------------------- turning it off, and again -- */

  it("stops working on the next request after Turn off, for the page and for a picture", async () => {
    const off = await link("DELETE", MINE);
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ on: false });
    expect(await tokenOf(MINE)).toEqual({ token: null, at: null });
    expect((await link("GET", MINE)).body).toEqual({ on: false });

    expect(shape(await article(MINE, KEYS.mine))).toEqual(sameAs(absent, MINE.slug));
    const noSuchArticle = await picture({ ...MINE, slug: ABSENT }, MINE.figure?.sha256 ?? "");
    expect(shape(await picture(MINE, MINE.figure?.sha256 ?? "", KEYS.mine))).toEqual(
      sameAs(noSuchArticle, MINE.slug),
    );

    const log = await events(MINE);
    expect(log.map((e) => [e.event, e.rightsConfirmed])).toEqual([
      ["created", true],
      ["turned-off", false],
    ]);
    expect(JSON.stringify(log)).not.toContain(KEYS.mine);
  });

  it("is idempotent to turn off: nothing changes and nothing is recorded", async () => {
    expect((await link("DELETE", MINE)).body).toEqual({ on: false });
    expect(await events(MINE)).toHaveLength(2);
    /* Nor does a link that was never made leave a row. */
    expect((await link("DELETE", BARE)).body).toEqual({ on: false });
    expect(await events(BARE)).toEqual([]);
  });

  it("makes a new key when a link is made again, and the old one stays dead", async () => {
    const first = KEYS.mine;
    const second = await makeLink(MINE);
    expect(second).not.toBe(first);
    expect((await article(MINE, second)).status).toBe(200);
    expect(shape(await article(MINE, first))).toEqual(sameAs(absent, MINE.slug));

    /* And again while one is on: the key that was working stops in the same step. */
    const third = await makeLink(MINE);
    expect(third).not.toBe(second);
    expect((await article(MINE, third)).status).toBe(200);
    expect(shape(await article(MINE, second))).toEqual(sameAs(absent, MINE.slug));
    expect(shape(await article(MINE, first))).toEqual(sameAs(absent, MINE.slug));
    KEYS.mine = third;

    expect((await events(MINE)).map((e) => e.event)).toEqual([
      "created",
      "turned-off",
      "created",
      "created",
    ]);
  });

  /* ---------------------------------------------------- one transaction -- */

  it("rolls the key back when the audit row cannot be written, both ways", async () => {
    const db = getDb();
    const before = await events(MINE);
    await db.execute(sql`
      create or replace function spideryarn.test_break_share_link_log()
      returns trigger language plpgsql as $$
      begin
        if new.slug = ${sql.raw(`'${MINE.slug}'`)} then
          raise exception 'forced failure for the rollback test';
        end if;
        return new;
      end $$`);
    await db.execute(sql`
      create trigger test_break_share_link_log
      before insert on spideryarn.article_share_link_events
      for each row execute function spideryarn.test_break_share_link_log()`);
    try {
      /* Making one: the old key is still the key. */
      const made = await link("POST", MINE, { body: { rightsConfirmed: true } });
      expect(made.status).toBe(500);
      expect(made.text).not.toContain("forced failure");
      expect((await tokenOf(MINE))?.token).toBe(KEYS.mine);
      expect((await article(MINE, KEYS.mine)).status).toBe(200);

      /* Turning it off: it is still on. */
      expect((await link("DELETE", MINE)).status).toBe(500);
      expect((await tokenOf(MINE))?.token).toBe(KEYS.mine);
      expect((await article(MINE, KEYS.mine)).status).toBe(200);

      expect(await events(MINE)).toHaveLength(before.length);
    } finally {
      await db.execute(
        sql`drop trigger if exists test_break_share_link_log on spideryarn.article_share_link_events`,
      );
      await db.execute(sql`drop function if exists spideryarn.test_break_share_link_log()`);
    }
  });

  /* ------------------------------------------------- below the route -- */

  it("cannot be given a key of the wrong shape, an empty one, or one without its time", async () => {
    const db = getDb();
    for (const bad of ["", "short", "A".repeat(23), "has spaces in it 123456", "AAAAAAAAAAAAAAAAAAAAA="]) {
      await expect(
        db.update(articles).set({ shareToken: bad, shareTokenAt: new Date() }).where(eq(articles.id, BARE.articleId)),
        JSON.stringify(bad),
      ).rejects.toThrow();
    }
    await expect(
      db.update(articles).set({ shareToken: "A".repeat(22), shareTokenAt: null }).where(eq(articles.id, BARE.articleId)),
    ).rejects.toThrow();
    await expect(
      db.update(articles).set({ shareToken: null, shareTokenAt: new Date() }).where(eq(articles.id, BARE.articleId)),
    ).rejects.toThrow();
    expect(await tokenOf(BARE)).toEqual({ token: null, at: null });
  });

  it("cannot share one key between two articles", async () => {
    await expect(
      getDb()
        .update(articles)
        .set({ shareToken: KEYS.mine, shareTokenAt: new Date() })
        .where(eq(articles.id, BARE.articleId)),
    ).rejects.toThrow();
  });

  it("and the audit table refuses a made link without the tick, a turn-off with it, and any third word", async () => {
    const db = getDb();
    const row = { articleId: BARE.articleId, slug: BARE.slug, actorOwnerId: OWNER };
    await expect(
      db.insert(articleShareLinkEvents).values({ ...row, event: "created", rightsConfirmed: false }),
    ).rejects.toThrow();
    await expect(
      db.insert(articleShareLinkEvents).values({ ...row, event: "turned-off", rightsConfirmed: true }),
    ).rejects.toThrow();
    await expect(
      db.insert(articleShareLinkEvents).values({ ...row, event: "rotated" as never, rightsConfirmed: true }),
    ).rejects.toThrow();
    expect(await events(BARE)).toEqual([]);
  });

  /* ----------------------------------------------- billing does not move -- */

  it("leaves a link-shared article private in every column billing reads", async () => {
    const [row] = await getDb()
      .select({ visibility: articles.visibility, publicAt: articles.publicAt })
      .from(articles)
      .where(eq(articles.id, MINE.articleId));
    expect(row).toEqual({ visibility: "private", publicAt: null });
  });
});
