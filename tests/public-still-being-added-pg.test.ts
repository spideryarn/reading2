/**
 * **A visitor before publication: "still being added", against a real Postgres
 * and through the real public route.**
 *
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md
 * § 2c and § What the stage 2 plan review changed. Greg accepted that a person
 * holding the address of a *shared*, unpublished article learns an import is
 * under way there. This file is the edge of that: every other request still
 * gets the absent article's 404.
 *
 * | Article | Job | Request | Answer |
 * |---|---|---|---|
 * | public, unpublished | running, lease live | no key | 409 `still-being-added` |
 * | link on, unpublished | queued | its key | 409 |
 * | link on, unpublished | queued | a rotated or turned-off key | 404 |
 * | link on, unpublished | running | wrong key, no key | 404 |
 * | private, unpublished | running | no key | 404 |
 * | public, unpublished | none, failed, cancelled | no key | 404 |
 * | public, unpublished | running, **lease expired** | no key | 404 |
 * | public, unpublished | **another owner's** live job on the slug | no key | 404 |
 * | public, unpublished, archived | running | no key | 409 |
 * | public, published | running | no key | 200 |
 *
 * **"The 404" is compared whole** against a slug nobody has, as
 * tests/share-link-pg.test.ts does: a different sentence would be a second
 * answer about whether the article exists.
 *
 * ## Why a real database
 *
 * The answer is one `where`: an access predicate, a null revision and a
 * correlated `exists` whose lease is compared with the database's own clock.
 * tests/public-reads.test.ts reads the statement; this proves what it returns.
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
  jobs,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import * as messages from "../src/messages.js";
import { currentOwnerId, type OwnerId } from "../src/owner.js";
import { PUBLIC_ONLY } from "../src/store/public-access.js";
import * as publicReader from "../src/store/public-reader.js";
import type { ShareLinkState } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/* The blob store pointed at a temp directory, as tests/share-link-pg.test.ts
   does and for its reason: without it the asset route reads the machine's
   bucket. */
let blobDir = "";
vi.mock("../src/store/blobs.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/blobs.js")>();
  const { fsBlobs } = await import("../src/store/blobs-fs.js");
  return { ...real, blobStore: () => fsBlobs(blobDir) };
});

await pgReady({
  suite: "tests/public-still-being-added-pg.test.ts",
  tables: ["spideryarn.jobs"],
  columns: [{ table: "spideryarn.articles", column: "share_token" }],
});

const RUN = randomUUID().slice(0, 8);

/** The seeded development owner. */
const OWNER = currentOwnerId();
/** Somebody else with a row in `auth.users`, so a job can be theirs. Minted per run. */
const STRANGER = randomUUID() as OwnerId;

const asPerson = (sub: string): Verifier => async () => ({
  ok: true,
  claims: { sub, email: `${sub}@example.test`, role: "authenticated", is_anonymous: false },
});

type JobShape =
  | { status: "queued" | "error" | "cancelled" | "done"; owner?: OwnerId }
  /** `leaseMs` from now: positive is live, negative ran out that long ago. */
  | { status: "running"; leaseMs: number; owner?: OwnerId };

interface Fixture {
  name: string;
  slug: string;
  articleId: string;
  visibility: "private" | "public";
  archived?: boolean;
  /** Published, with one block and one picture. Everything else has no revision at all. */
  published?: { revisionId: string; blockId: string; prose: string; sha256: string };
  processing?: "minimal";
  jobs: JobShape[];
}

const LIVE = 10 * 60_000;

function fixture(name: string, extra: Partial<Fixture> = {}): Fixture {
  return {
    name,
    slug: `test-still-adding-${name}-${RUN}`,
    articleId: randomUUID(),
    visibility: "public",
    jobs: [],
    ...extra,
  };
}

const published = (name: string) => ({
  revisionId: randomUUID(),
  blockId: mintId(),
  prose: `The prose of the ${name} article, canary ${name.toUpperCase()}-${RUN}.`,
  sha256: "",
});

/** Row 1: public, unpublished, a job running inside its lease. */
const PUBLIC_RUNNING = fixture("public-running", { jobs: [{ status: "running", leaseMs: LIVE }] });
/** Private, and given a link in `beforeAll`; its job is still waiting. */
const LINK_QUEUED = fixture("link-queued", { visibility: "private", jobs: [{ status: "queued" }] });
/** Private with a link, job running: the wrong-key and no-key rows. */
const LINK_RUNNING = fixture("link-running", {
  visibility: "private",
  jobs: [{ status: "running", leaseMs: LIVE }],
});
/** Private, no link, running. */
const PRIVATE_RUNNING = fixture("private-running", {
  visibility: "private",
  jobs: [{ status: "running", leaseMs: LIVE }],
});
const NO_JOB = fixture("no-job");
const FAILED_JOB = fixture("failed-job", { jobs: [{ status: "error" }] });
const CANCELLED_JOB = fixture("cancelled-job", { jobs: [{ status: "cancelled" }] });
/** Finished without publishing anything: not an import in flight either. */
const DONE_JOB = fixture("done-job", { jobs: [{ status: "done" }] });
/** A claimant that died: still `running`, and its lease ran out a minute ago. */
const EXPIRED_LEASE = fixture("expired-lease", { jobs: [{ status: "running", leaseMs: -60_000 }] });
/** Ours, public, unpublished; the only live job on this slug is somebody else's. */
const STRANGERS_JOB = fixture("strangers-job", {
  jobs: [
    { status: "running", leaseMs: LIVE, owner: STRANGER },
    { status: "queued", owner: STRANGER },
  ],
});
const ARCHIVED = fixture("archived", { archived: true, jobs: [{ status: "running", leaseMs: LIVE }] });
/** Published and public, with a mode job running on it: the control for every 404 and 409. */
const PUBLISHED = fixture("published", {
  published: published("published"),
  jobs: [{ status: "running", leaseMs: LIVE }],
});
/** A minimal paper of the owner's, for a 409 that is not this one. */
const MINIMAL = fixture("minimal", {
  visibility: "private",
  published: published("minimal"),
  processing: "minimal",
});

const ALL = [
  PUBLIC_RUNNING,
  LINK_QUEUED,
  LINK_RUNNING,
  PRIVATE_RUNNING,
  NO_JOB,
  FAILED_JOB,
  CANCELLED_JOB,
  DONE_JOB,
  EXPIRED_LEASE,
  STRANGERS_JOB,
  ARCHIVED,
  PUBLISHED,
  MINIMAL,
];
const ABSENT = `test-still-adding-absent-${RUN}`;
/** Key-shaped, and nobody's. */
const NOBODYS_KEY = "zzzzzzzzzzzzzzzzzzzzzz";

interface Reply {
  status: number;
  headers: Record<string, string>;
  text: string;
  body: Record<string, unknown>;
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
  const text = Buffer.concat(chunks).toString("utf8");
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* An image. */
  }
  return { status, headers, text, body };
}

const article = (who: { slug: string }, key?: string) =>
  call("GET", `/api/public/article/${who.slug}${key === undefined ? "" : `?key=${key}`}`);
const picture = (who: { slug: string }, sha256: string) =>
  call("GET", `/api/public/asset/${who.slug}/${sha256}.png`);
const link = (method: string, who: Fixture, body?: unknown) =>
  call(method, `/api/article/${who.slug}/share-link`, { as: OWNER, ...(body === undefined ? {} : { body }) });

async function makeLink(who: Fixture): Promise<string> {
  const r = await link("POST", who, { rightsConfirmed: true });
  expect(r.status, `${who.name}: ${r.text}`).toBe(200);
  const state = r.body as ShareLinkState;
  if (!state.on) throw new Error(`${who.name} has no link after making one`);
  return state.key;
}

/** What a refusal has to equal: the reply for a slug nobody has. */
function sameAs(absent: Reply, slug: string) {
  return {
    status: absent.status,
    headers: absent.headers,
    text: absent.text.split(ABSENT).join(slug),
  };
}
const shape = (r: Reply) => ({ status: r.status, headers: r.headers, text: r.text });

/** The one 409 this file is about, and nothing else in its body. */
function expectStillBeingAdded(r: Reply, who: Fixture) {
  expect(r.status, `${who.name}: ${r.text}`).toBe(409);
  /* **Exactly two keys.** No title, no owner, no progress, no job, and none of
     the adjunct payload a published article carries (comments, searches, the
     source guess): there is no separate public route for those to be a 404 on,
     so their absence is asserted here. Sol's F6. */
  expect(Object.keys(r.body).sort()).toEqual(["code", "error"]);
  expect(r.body.code).toBe("still-being-added");
  expect(r.body.error).toBe(messages.STILL_BEING_ADDED_REFUSAL.message);
  /* A fixed sentence: the same bytes for every article. */
  expect(r.text).not.toContain(who.slug);
  expect(r.headers["cache-control"]).toBe("no-store");
}

/** A real PNG header, as tests/asset-route.test.ts builds one. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const JOB_IDS: string[] = [];

async function seed(who: Fixture): Promise<void> {
  const db = getDb();
  await db.insert(articles).values({
    id: who.articleId,
    ownerId: OWNER,
    slug: who.slug,
    shortId: mintId(),
    visibility: who.visibility,
    publicAt: who.visibility === "public" ? new Date() : null,
    ...(who.archived ? { archivedAt: new Date() } : {}),
  });

  if (who.published) {
    const { blobStore } = await import("../src/store/blobs.js");
    const { canonicalKey } = await import("../src/source.js");
    const bytes = png(640, 480 + ALL.indexOf(who));
    who.published.sha256 = createHash("sha256").update(bytes).digest("hex");
    await blobStore().putIfAbsent(canonicalKey(who.published.sha256, "png"), bytes, "image/png");
    const assets: Assets = {
      version: "assets/2",
      sourceHash: "not-what-this-file-is-about",
      fetchedAt: new Date().toISOString(),
      entries: [
        {
          url: `https://example.test/${who.slug}.png`,
          status: "stored",
          sha256: who.published.sha256,
          ext: "png",
          contentType: "image/png",
          bytes: bytes.byteLength,
        },
      ],
      pdfFigures: [],
    };
    const { revisionId, blockId, prose } = who.published;
    await db.insert(articleRevisions).values({
      id: revisionId,
      articleId: who.articleId,
      status: "published",
      title: `Title of the ${who.name} article ${RUN}`,
      wordCount: 9,
      blockCount: 1,
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
            range: [blockId, blockId],
            title: "Root",
            gist: `Gist of ${who.name}.`,
          },
        },
      },
    });
    await db.update(articles).set({ currentRevisionId: revisionId }).where(eq(articles.id, who.articleId));
    await db.insert(blockIdentities).values({ articleId: who.articleId, blockId });
    await db.insert(revisionBlocks).values({
      articleId: who.articleId,
      revisionId,
      blockId,
      ordinal: 0,
      tag: "p",
      kind: "text",
      text: prose,
      words: 9,
      html: `<p>${prose}</p>`,
      gistable: true,
    });
    if (who.processing === "minimal") {
      await db.update(articles).set({ processing: "minimal" }).where(eq(articles.id, who.articleId));
    }
  }

  for (const job of who.jobs) {
    const id = mintId();
    JOB_IDS.push(id);
    await db.insert(jobs).values({
      id,
      ownerId: job.owner ?? OWNER,
      slug: who.slug,
      steps: [],
      status: job.status,
      workKey: `work-${id}`,
      /* `jobs_running_is_fenced` refuses a `running` row without both. */
      ...(job.status === "running" && {
        attemptId: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + job.leaseMs),
      }),
    });
  }
}

async function clean(): Promise<void> {
  const db = getDb();
  const ids = ALL.map((who) => who.articleId);
  if (JOB_IDS.length) await db.delete(jobs).where(inArray(jobs.id, JOB_IDS));
  await db.delete(jobs).where(inArray(jobs.slug, ALL.map((w) => w.slug)));
  await db.delete(articleShareLinkEvents).where(inArray(articleShareLinkEvents.articleId, ids));
  await db.delete(articleShareLinkEvents).where(inArray(articleShareLinkEvents.slug, ALL.map((w) => w.slug)));
  await db.delete(revisionBlocks).where(inArray(revisionBlocks.articleId, ids));
  await db.update(articles).set({ currentRevisionId: null }).where(inArray(articles.id, ids));
  await db.delete(articleRevisions).where(inArray(articleRevisions.articleId, ids));
  await db.delete(blockIdentities).where(inArray(blockIdentities.articleId, ids));
  await db.delete(articles).where(inArray(articles.id, ids));
  await db.execute(sql`delete from auth.users where id = ${STRANGER}`);
}

describe("a visitor before publication", { timeout: 60_000 }, () => {
  let absent: Reply;
  let absentPicture: Reply;

  beforeAll(async () => {
    blobDir = await mkdtemp(path.join(tmpdir(), "spya-still-adding-"));
    await seedAuthUser(getDb(), { id: STRANGER, email: `still-adding-${RUN}@example.test` });
    for (const who of ALL) await seed(who);
    absent = await article({ slug: ABSENT });
    absentPicture = await picture({ slug: ABSENT }, "0".repeat(64));
  });

  afterAll(async () => {
    await clean();
    await rm(blobDir, { recursive: true, force: true });
    await closeDb();
  });

  it("has a 404 to compare with, and a published article that reads", async () => {
    expect(absent.status).toBe(404);
    expect(absent.headers["cache-control"]).toBe("no-store");
    expect(absent.body.code).toBeUndefined();

    /* **The control for every refusal below**, and the last row of the table:
       published is 200 whatever jobs are running on it. A fixture that could
       not be read at all would make each 404 here true of any code. */
    const r = await article(PUBLISHED);
    expect(r.status, r.text).toBe(200);
    expect(r.text).toContain(`PUBLISHED-${RUN}`);
    expect(r.body.code).toBeUndefined();
  });

  /* ------------------------------------------------------------ the 409 -- */

  it("says still being added for a public, unpublished article whose job is running", async () => {
    expectStillBeingAdded(await article(PUBLIC_RUNNING), PUBLIC_RUNNING);
    /* Public wins: a key that is nobody's changes nothing, as for a published one. */
    expectStillBeingAdded(await article(PUBLIC_RUNNING, NOBODYS_KEY), PUBLIC_RUNNING);
  });

  it("says it to the holder of a private link whose job is still queued, and to nobody else", async () => {
    const first = await makeLink(LINK_QUEUED);
    expectStillBeingAdded(await article(LINK_QUEUED, first), LINK_QUEUED);
    for (const key of [undefined, "", NOBODYS_KEY]) {
      expect(shape(await article(LINK_QUEUED, key)), String(key)).toEqual(sameAs(absent, LINK_QUEUED.slug));
    }

    /* **Rotated.** A new link is a new key; the old one opens nothing. */
    const second = await makeLink(LINK_QUEUED);
    expect(second).not.toBe(first);
    expect(shape(await article(LINK_QUEUED, first)), "the old key").toEqual(sameAs(absent, LINK_QUEUED.slug));
    expectStillBeingAdded(await article(LINK_QUEUED, second), LINK_QUEUED);

    /* **Turned off.** The key that worked a line ago is the absent article's 404. */
    expect((await link("DELETE", LINK_QUEUED)).status).toBe(200);
    expect(shape(await article(LINK_QUEUED, second)), "a turned-off key").toEqual(
      sameAs(absent, LINK_QUEUED.slug),
    );
  });

  it("refuses a wrong key, another article's key and no key while a linked article's job runs", async () => {
    const own = await makeLink(LINK_RUNNING);
    const anothers = await makeLink(PRIVATE_RUNNING);
    try {
      /* The control: with its own key this very row is the 409. */
      expectStillBeingAdded(await article(LINK_RUNNING, own), LINK_RUNNING);
      for (const key of [undefined, "", NOBODYS_KEY, anothers, "not-a-key"]) {
        expect(shape(await article(LINK_RUNNING, key)), String(key)).toEqual(sameAs(absent, LINK_RUNNING.slug));
      }
    } finally {
      /* `PRIVATE_RUNNING` goes back to having no link, which is what its own case is about. */
      await link("DELETE", PRIVATE_RUNNING);
    }
  });

  it("says nothing about a private article with no link, running or not", async () => {
    for (const key of [undefined, NOBODYS_KEY]) {
      expect(shape(await article(PRIVATE_RUNNING, key)), String(key)).toEqual(
        sameAs(absent, PRIVATE_RUNNING.slug),
      );
    }
  });

  /* ------------------------------------------------- a live job is required -- */

  it.each([
    ["no job at all", NO_JOB],
    ["a failed job", FAILED_JOB],
    ["a cancelled job", CANCELLED_JOB],
    ["a finished job", DONE_JOB],
  ])("is an ordinary 404 for a public, unpublished article with %s", async (_what, who) => {
    expect(shape(await article(who))).toEqual(sameAs(absent, who.slug));
  });

  it("is a 404 once a running job's lease has run out, and nothing is settled by asking", async () => {
    /* A dead claimant stays `running` until its owner's request sweeps it. A
       visitor's poll sweeps nothing, so the read itself has to ask the lease
       (Sol's F5), or the page says "still being added" for ever. */
    expect(shape(await article(EXPIRED_LEASE))).toEqual(sameAs(absent, EXPIRED_LEASE.slug));
    const [row] = await getDb()
      .select({ status: jobs.status, lease: jobs.leaseExpiresAt })
      .from(jobs)
      .where(eq(jobs.slug, EXPIRED_LEASE.slug));
    /* The read wrote nothing: still `running`, still carrying its dead lease. */
    expect(row?.status).toBe("running");
    expect(row?.lease).not.toBeNull();

    /* **And the same row is the 409 when its lease is live**, so the 404 above
       is about the lease and not about this fixture. */
    await getDb()
      .update(jobs)
      .set({ leaseExpiresAt: new Date(Date.now() + LIVE) })
      .where(eq(jobs.slug, EXPIRED_LEASE.slug));
    try {
      expectStillBeingAdded(await article(EXPIRED_LEASE), EXPIRED_LEASE);
    } finally {
      await getDb()
        .update(jobs)
        .set({ leaseExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(jobs.slug, EXPIRED_LEASE.slug));
    }
  });

  it("does not count another owner's live job on the same slug", async () => {
    /* `jobs` has no article id: the tie is slug **and** owner. With the slug
       alone, anybody could make a stranger's unpublished public article say
       "still being added" by queueing work under its slug. */
    expect(shape(await article(STRANGERS_JOB))).toEqual(sameAs(absent, STRANGERS_JOB.slug));
  });

  it("says it for an archived article too, as a published archived one reads by its address", async () => {
    /* Archiving takes an article off listings, not off its own address: a
       published, archived, shared article is a 200 to whoever has the link
       (tests/share-link-pg.test.ts). So the same article one step earlier is
       the 409, and a 404 here would be the odd one out. */
    expectStillBeingAdded(await article(ARCHIVED), ARCHIVED);
  });

  /* ------------------------------------------------ only the article read -- */

  it("leaves the page head and the pictures a 404 before publication, and working after", async () => {
    const head = await publicReader.pgPublicReader.loadHead(PUBLIC_RUNNING.slug, PUBLIC_ONLY).then(
      (found) => ({ found }),
      (err: { status?: number; code?: string; message: string }) => ({ err }),
    );
    expect("err" in head && head.err.status, JSON.stringify(head)).toBe(404);
    expect("err" in head && head.err.code).toBeUndefined();
    const absentHead = await publicReader.pgPublicReader
      .loadHead(ABSENT, PUBLIC_ONLY)
      .catch((err: Error) => err.message);
    expect("err" in head && head.err.message).toBe(String(absentHead).split(ABSENT).join(PUBLIC_RUNNING.slug));

    const sha = PUBLISHED.published?.sha256 ?? "";
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    const noPicture = await picture(PUBLIC_RUNNING, sha);
    expect(shape(noPicture)).toEqual({
      status: absentPicture.status,
      headers: absentPicture.headers,
      text: absentPicture.text.split(ABSENT).join(PUBLIC_RUNNING.slug),
    });
    expect(noPicture.status).toBe(404);

    /* **The positive controls**, without which both 404s above are what a
       broken head read and a broken asset route also answer. */
    const publishedHead = await publicReader.pgPublicReader.loadHead(PUBLISHED.slug, PUBLIC_ONLY);
    expect(publishedHead.sharedBy).toBe("public");
    expect(publishedHead.sharedBy === "public" && publishedHead.head.title).toBe(
      `Title of the published article ${RUN}`,
    );
    const publishedPicture = await picture(PUBLISHED, sha);
    expect(publishedPicture.status, publishedPicture.text).toBe(200);
    expect(publishedPicture.headers["content-type"]).toBe("image/png");
  });

  /* ------------------------------------------------------ the code's edge -- */

  it("does not lend its code to another 409", async () => {
    const r = await link("POST", MINIMAL, { rightsConfirmed: true });
    expect(r.status, r.text).toBe(409);
    expect(r.body.code).toBe("not-processed");
    expect(r.body.error).not.toBe(messages.STILL_BEING_ADDED_REFUSAL.message);
  });

  it("sends the statement the SQL test reads, with a real connection", () => {
    /* tests/public-reads.test.ts reads this query off a `QueryBuilder`. A
       real connection is a different builder, and a correlated subquery whose
       columns came out unqualified would compare `jobs.slug` with itself. */
    const { sql: text } = publicReader.publicPendingImportQuery(getDb(), "a-slug", PUBLIC_ONLY).toSQL();
    expect(text).toContain('"jobs"."slug" = "spideryarn"."articles"."slug"');
    expect(text).toContain('"jobs"."owner_id" = "spideryarn"."articles"."owner_id"');
  });
});
