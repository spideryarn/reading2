/**
 * **Two readers import the same article, and each gets a copy of their own**,
 * through the real `enqueue`, the real claim, the real publication and the real
 * stores, against Postgres, with two seeded accounts.
 *
 * Stage 1 of
 * docs/plans/261007f-two-readers-import-the-same-article-checked-end-to-end-and-the-edge-cases.md.
 * Each layer under this already has a test of its own, and
 * tests/owner-isolation.test.ts sweeps every lookup for an owner. Nothing ran
 * the whole thing with two accounts, which is what Greg asked to be sure of.
 * The charging cases (E14, E15, E16) are in
 * tests/two-readers-one-article-billing-pg.test.ts.
 *
 * ## What is real and what is not
 *
 * `enqueue`, `retryJob`, `cancelJob`, `advanceJobWith`, `claimSession` and the
 * publication are production's. So are `blocks` and `structure`, the `fetch`
 * step when the job is an upload, and every store a case asks: visibility, the
 * shelf's delete, comments, tags, checkpoints, the owner's routes and the
 * public ones.
 *
 * The fakes are the network (`fetch` on an address), Readability (`extract`),
 * the publisher's images (`assets`), the model under `structure` (a counted
 * fake at `streamMessage`) and the bucket, which is a `Map` in this process.
 *
 * **A queued job is finished by driving that job**, never by
 * `loadArticleIntoPg` or `scratchArticleInPg`: those open a job of their own,
 * so a test could enqueue two jobs, publish two unrelated fixtures and pass.
 * The fake `extract` writes the job's own slug into the prose, so every read
 * below can tell whose article it was handed by its words and not only by its
 * address.
 *
 * It starts at `enqueue`, so it is a queue-to-publication test. The route's
 * admission and the slot it reserves are the other file's.
 *
 * ## Watched red, 2026-10-07
 *
 * One at a time, each edit made by hand and put back by hand.
 *
 * | the guard broken | red |
 * |---|---|
 * | `ownedByReader()` dropped from `articleUrls` (src/store/find-article.ts) | E1 → `B was told somebody else's article is the one they already have` |
 * | the three `ownedSlug(slug, ownerId)` in `destroy` made `eq(articles.slug, slug)` (src/store/pg-shelf.ts) | E4 → `promise resolved "{ destroyed: … }" instead of rejecting`, at B's delete of A's |
 * | `publicSlug` returns `eq(articles.visibility, "public")` alone (src/store/public-slug.ts) | E2 → `a visitor was served something at B's private address: expected 200 to be 404`, and E3, E6, E4 with it |
 * | this file's own `storeRawSource` default left unfilled | E5, and the last case → four requests to the local bucket listed |
 *
 * The first also reddens the first E13 case. The second needs all three sites:
 * with the `delete` statement alone unscoped the file stays green, because the
 * two owner-scoped reads before it have already answered 404.
 *
 * ## Outside this oracle
 *
 * `POST /api/jobs` itself: request parsing, billing admission and the slot.
 * The browser. A model's real output (the structure here is a root and nothing
 * else). Two imports that mint the same random id at the same instant, which
 * the plan leaves open on purpose (§ Stage 2, E10).
 */
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Assets } from "../src/assets.js";
import type { Verifier } from "../src/auth.js";
import type { Job, OwnerId, StepName } from "../src/types.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import { pgReady } from "./helpers/pg-ready.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/** What the structure call "returns". A root alone is a sound answer at any size. */
const MODEL_ANSWER = JSON.stringify({
  root: { title: "Why trees", gist: "A fixture that says things.", question: "What follows?" },
});

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => ({
      onText: () => {},
      finalMessage: async () => ({
        content: [{ type: "text", text: MODEL_ANSWER }],
        stop_reason: "end_turn",
        usage: { input_tokens: 7, output_tokens: 11 },
      }),
    }),
  };
});

/**
 * **The bucket, as a `Map` in this process.** `blobStore()` follows the
 * machine's credentials, so without this the steps and the image route would
 * talk to the real shared bucket over HTTP.
 *
 * Three names are replaced and not one. `storeRawSource`'s last parameter
 * defaults to the module's *own* `blobStore`, which a replaced export does not
 * reach, and the upload half of `fetch` calls it with no store. So the default
 * is filled in here. `postgresBlobStore` is the same selection under its
 * stricter name.
 */
const bucket = vi.hoisted(() => ({
  held: new Map<string, { bytes: Uint8Array; contentType: string }>(),
}));
vi.mock("../src/store/blobs.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/blobs.js")>();
  const memory: import("../src/store/blobs.js").RawSourceStore = {
    async head(key) {
      const found = bucket.held.get(key);
      return found ? { bytes: found.bytes.byteLength, contentType: found.contentType } : null;
    },
    async get(key, options) {
      const found = bucket.held.get(key);
      if (!found) return null;
      if (options?.maxBytes !== undefined && found.bytes.byteLength > options.maxBytes) {
        throw new Error(`${key} is larger than the ${options.maxBytes} bytes asked for`);
      }
      return new Uint8Array(found.bytes);
    },
    async putIfAbsent(key, bytes, contentType) {
      if (bucket.held.has(key)) return "already-there";
      bucket.held.set(key, { bytes: new Uint8Array(bytes), contentType });
      return "stored";
    },
    async remove(key) {
      bucket.held.delete(key);
    },
  };
  return {
    ...real,
    blobStore: () => memory,
    postgresBlobStore: () => memory,
    storeRawSource: (
      bytes: Uint8Array,
      kind: Parameters<typeof real.storeRawSource>[1],
      store?: import("../src/store/blobs.js").RawSourceStore,
    ) => real.storeRawSource(bytes, kind, store ?? memory),
  };
});

/**
 * **One random id, chosen by the test, once.** A slug ends in a random id, so
 * two requests never want the same full name by accident and
 * `jobs_reserved_slug` is never reached. E13 sets `next` to make them.
 */
const forcedId = vi.hoisted(() => ({ next: undefined as string | undefined }));
vi.mock("../src/ids.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/ids.js")>();
  return {
    ...real,
    mintId: () => {
      const forced = forcedId.next;
      if (forced === undefined) return real.mintId();
      forcedId.next = undefined;
      return forced;
    },
  };
});

const { closeDb, getDb } = await import("../src/db/client.js");
const {
  articleRevisions,
  articleTags,
  articles,
  checkpoints: checkpointsTable,
  comments: commentsTable,
  jobs: jobsTable,
  rawSources,
  revisionBlocks,
  uploads: uploadsTable,
} = await import("../src/db/schema.js");
const { loadEnvLocal } = await import("../src/env.js");
const { mintId } = await import("../src/ids.js");
const { shortIdInSlug, urlKey } = await import("../src/ingest.js");
const { advanceJobWith, cancelJob, claimSession, enqueue, retryJob } = await import("../src/jobs.js");
const { runAsOwner } = await import("../src/owner.js");
const { STEPS } = await import("../src/pipeline.js");
const { canonicalKey, stagingKey } = await import("../src/source.js");
const { blobStore, CONTENT_TYPE, storeRawSource } = await import("../src/store/blobs.js");
const { createPgCheckpointStore } = await import("../src/store/checkpoints-pg.js");
const { slugForUrlKey } = await import("../src/store/find-article.js");
const { articleIdForOwned } = await import("../src/store/pg.js");
const { pgCommentStore } = await import("../src/store/pg-comments.js");
const { pgShelfStore } = await import("../src/store/pg-shelf.js");
const { pgTagStore } = await import("../src/store/pg-tags.js");
const { pgVisibilityStore } = await import("../src/store/pg-visibility.js");
const { claimUpload, mintUpload } = await import("../src/upload-records.js");

type AdvanceParts = import("../src/jobs.js").AdvanceParts;
type StepRegistry = import("../src/jobs.js").StepRegistry;
type PipelineStep<N extends StepName> = import("../src/pipeline.js").PipelineStep<N>;

loadEnvLocal();

/* Long, because claiming waits on a contended slot rather than failing on it. */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

/* Two readers, minted per run. Neither is the machine's own owner, so nothing
   here can pass because of who `SPIDERYARN_OWNER_ID` happens to be. */
const OWNER_STEM = "0000261a-0007-4000-8000-";
const A = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const B = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

const RUN = randomUUID().slice(0, 8);
const SLUG_PREFIX = "test-two-readers-";
const SLUG_RUBBLE = `${SLUG_PREFIX}%`;

const SUITE = "tests/two-readers-one-article-pg.test.ts";

let runLock: HeldRunLock | undefined;

await pgReady({
  suite: SUITE,
  tables: [
    "spideryarn.jobs",
    "spideryarn.articles",
    "spideryarn.article_revisions",
    "spideryarn.revision_blocks",
    "spideryarn.raw_sources",
    "spideryarn.uploads",
    "spideryarn.comments",
    "spideryarn.article_tags",
    "spideryarn.checkpoints",
  ],
});

/** Everything either reader owns, gone. On the lock's own connection. */
async function sweep(query: (text: string, values: unknown[]) => Promise<unknown>): Promise<void> {
  await query("delete from spideryarn.jobs where owner_id::text like $1", [RUBBLE]);
  await query("delete from spideryarn.jobs where slug like $1", [SLUG_RUBBLE]);
  await query(
    "update spideryarn.articles set current_revision_id = null where owner_id::text like $1 or slug like $2",
    [RUBBLE, SLUG_RUBBLE],
  );
  await query("delete from spideryarn.articles where owner_id::text like $1 or slug like $2", [
    RUBBLE,
    SLUG_RUBBLE,
  ]);
  await query("delete from spideryarn.uploads where owner_id::text like $1", [RUBBLE]);
  await query("delete from spideryarn.reader_profiles where owner_id::text like $1", [RUBBLE]);
  await query("delete from spideryarn.billing_accounts where owner_id::text like $1", [RUBBLE]);
  await query("delete from auth.users where id::text like $1", [RUBBLE]);
}

runLock = await takeRunLockAndSetUp(SUITE, async (lockClient) => {
  await sweep((text, values) => lockClient.query(text, values));
  await seedAuthUser(lockClient, { id: A, email: `two-readers-a-${A}@example.invalid` });
  await seedAuthUser(lockClient, { id: B, email: `two-readers-b-${B}@example.invalid` });
});

/* -------------------------------------------------------------- the steps -- */

/** The words only this article has: its own slug, which no other article shares. */
const canary = (slug: string) => `canary-of-${slug}`;

/** A headed article with eight paragraphs, the first carrying the job's own slug. */
const extractedHtml = (slug: string) =>
  [
    "<h1>Why trees</h1>",
    "<h2>The first part</h2>",
    `<p>This copy is marked ${canary(slug)} so that a reader of it can be told whose it is.</p>`,
    ...[2, 3, 4].map(
      (n) => `<p>Paragraph ${n} of the first part, which says something at enough length to count as prose.</p>`,
    ),
    "<h2>The second part</h2>",
    ...[5, 6, 7, 8].map(
      (n) => `<p>Paragraph ${n} of the second part, which also says something at enough length to count.</p>`,
    ),
  ].join("\n");

const shaOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** What the publisher "serves" at an address: the same bytes for whoever asks. */
const pageAt = (url: string) => new TextEncoder().encode(`<html><body>The page at ${url}</body></html>`);

/** A real PNG header, 64 by 48: the one picture every fixture article came with. */
const FIGURE = (() => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 64);
  view.setUint32(20, 48);
  return bytes;
})();
const FIGURE_SHA = shaOf(FIGURE);

/**
 * Stage 1 for an address, without the network: the publisher's bytes go into
 * the bucket under their hash, as the real step puts them, so two readers of
 * one address name one stored document. **An upload runs the real step.**
 */
function fetchFakedForAnAddress(): PipelineStep<"fetch"> {
  return {
    ...STEPS.fetch,
    async run(ctx, store, checkpoints) {
      if (ctx.upload) return STEPS.fetch.run(ctx, store, checkpoints);
      const url = ctx.url ?? `https://example.com/${ctx.slug}`;
      const bytes = pageAt(url);
      const stored = await storeRawSource(bytes, "html", blobStore());
      return {
        parts: {
          raw: {
            kind: "html",
            file: "raw.html",
            origin: "url",
            requestedUrl: url,
            url,
            contentType: "text/html",
            encoding: "utf-8",
            bytes: bytes.byteLength,
            sha256: stored.sha256,
            storedSha256: stored.sha256,
            storedBytes: bytes.byteLength,
            fetchedAt: new Date().toISOString(),
          },
        },
        detail: "fetched",
      };
    },
  };
}

/** Stage 2 without Readability's guesswork: the HTML above, with this job's slug in it. */
function fakeExtract(fail: boolean): PipelineStep<"extract"> {
  return {
    name: "extract",
    label: STEPS.extract.label,
    produces: ["extractedHtml", "meta"],
    async run(ctx) {
      if (fail) throw new Error("the fixture's extract gave up on purpose");
      return {
        parts: {
          extractedHtml: extractedHtml(ctx.slug),
          meta: { slug: ctx.slug, title: "Why trees" },
        },
        detail: "Why trees",
      };
    },
  };
}

/** One picture, the same bytes for every article, stored under its hash. */
function fakeAssets(): PipelineStep<"assets"> {
  return {
    name: "assets",
    label: STEPS.assets.label,
    produces: ["assets"],
    async run() {
      await blobStore().putIfAbsent(canonicalKey(FIGURE_SHA, "png"), FIGURE, CONTENT_TYPE.png);
      const assets: Assets = {
        version: "assets/2",
        sourceHash: "a fixture with one figure",
        fetchedAt: new Date().toISOString(),
        entries: [
          {
            url: "https://example.com/two-readers/figure.png",
            status: "stored",
            sha256: FIGURE_SHA,
            ext: "png",
            contentType: "image/png",
            bytes: FIGURE.byteLength,
          },
        ],
      };
      return { parts: { assets }, detail: "one figure" };
    },
  };
}

function partsWith(opts: { failExtract?: boolean } = {}): AdvanceParts {
  const steps: StepRegistry = {
    ...STEPS,
    fetch: fetchFakedForAnAddress(),
    extract: fakeExtract(opts.failExtract === true),
    assets: fakeAssets(),
  };
  return { power: async () => "standard", session: claimSession, steps };
}

/** Drive one job to its end as its owner, waiting out a contended slot. */
function drive(owner: OwnerId, id: string, parts: AdvanceParts = partsWith()): Promise<Job> {
  return runAsOwner(owner, async () => {
    for (let n = 1; n <= 120; n++) {
      const advanced = await advanceJobWith(id, parts);
      if (advanced?.done) return advanced.job;
      if (advanced?.busy) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`job ${id} did not finish in 120 advances`);
  });
}

/* --------------------------------------------------------------- the reads -- */

const db = () => getDb();

/** The row, read with no owner in the question: the test's own eye, not a reader's. */
async function articleRow(slug: string) {
  const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  return row;
}

async function publishedRevision(slug: string) {
  const id = (await articleRow(slug))?.currentRevisionId;
  if (!id) throw new Error(`${slug} is not on the shelf`);
  const [revision] = await db().select().from(articleRevisions).where(eq(articleRevisions.id, id)).limit(1);
  if (!revision) throw new Error(`${slug} names a revision that is not there`);
  return revision;
}

const jobRow = async (id: string) =>
  (await db().select().from(jobsTable).where(eq(jobsTable.id, id)).limit(1))[0];

/**
 * Stop whatever is still waiting on this article, as its owner would. A
 * publication queues the modes behind it, and the shelf will not delete an
 * article with work in the line.
 */
async function stopQueued(owner: OwnerId, slug: string): Promise<void> {
  const waiting = await db()
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.slug, slug), inArray(jobsTable.status, ["queued", "running"])));
  for (const { id } of waiting) await runAsOwner(owner, () => cancelJob(id));
}

/** A verifier that vouches for exactly one person. src/auth.ts § `Verifier`. */
const asPerson = (sub: string): Verifier => async () => ({
  ok: true,
  claims: { sub, email: `${sub}@example.test`, role: "authenticated", is_anonymous: false },
});

interface Sent {
  status: number;
  body: Buffer;
  text: string;
}

/**
 * One request through the real dispatcher. `who` signed in, or `null` for a
 * visitor: no `Authorization` header at all, which is what a stranger's
 * browser sends. The public namespace is dispatched before the gate either
 * way, so `/api/public/…` with a `who` is a signed-in reader on the public
 * route.
 */
async function request(who: OwnerId | null, urlPath: string): Promise<Sent> {
  const { handleApi } = await import("../src/routes.js");
  const req = Object.assign((async function* () {})(), {
    method: "GET",
    url: urlPath,
    headers: who === null ? {} : { authorization: "Bearer test-token" },
  }) as unknown as IncomingMessage;

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
    setHeader() {},
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

  await handleApi(req, res, who === null ? undefined : asPerson(who));
  const body = Buffer.concat(chunks);
  return { status, body, text: body.toString("utf8") };
}

const asOwner = (who: OwnerId, slug: string) => request(who, `/api/article/${slug}`);
const asVisitor = (slug: string) => request(null, `/api/public/article/${slug}`);

/** The public shelf, cut down to this file's articles: the lane's database is shared with the run. */
async function publicShelf(): Promise<string[]> {
  const sent = await request(null, "/api/public/library");
  expect(sent.status, sent.text).toBe(200);
  return (JSON.parse(sent.text) as { entries: { slug: string }[] }).entries
    .map((entry) => entry.slug)
    .filter((slug) => slug.startsWith(SLUG_PREFIX))
    .sort();
}

/* ------------------------------------------------------------- the imports -- */

/** A new address each time, so no case's paste is another's article. */
const freshUrl = (name: string) => `https://example.com/two-readers/${RUN}/${name}-${randomUUID()}`;

const paste = (owner: OwnerId, name: string, url: string) =>
  runAsOwner(owner, () => enqueue({ slug: `${SLUG_PREFIX}${name}`, url, pump: false }));

/**
 * **The pair every case from E1 to E4 is about**: A's copy and B's copy of one
 * address. E1 makes it and the cases after it read it, in the order they are
 * written, because that is the story: private, one public, both public, one
 * taken back, one deleted.
 */
const PAIR_URL = freshUrl("why-trees");
let pair: { a: Job; b: Job } | undefined;
function thePair(): { a: Job; b: Job } {
  if (!pair) throw new Error("E1 did not publish the pair this case reads");
  return pair;
}

/* ------------------------------------------------------------------ tests -- */

describe("two readers and one article", () => {
  /* `VERCEL`, so `retryJob` and a publication's follow-on jobs do not start a
     real pump. The same arrangement as tests/open-before-structure-queue.test.ts. */
  let vercel: string | undefined;
  let network: ReturnType<typeof vi.spyOn> | undefined;
  beforeAll(() => {
    vercel = process.env.VERCEL;
    process.env.VERCEL = "1";
    network = vi.spyOn(globalThis, "fetch");
  });

  afterAll(async () => {
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
    network?.mockRestore();
    await cleanUpThenRelease(
      async () => {
        await closeDb();
        const client = runLock?.client;
        if (client) await sweep((text, values) => client.query(text, values));
      },
      async () => {
        await runLock?.release();
      },
    );
  });

  /* ----------------------------------------------------------------- E1 -- */

  it("E1: one address pasted by both is two articles, and each reader is only ever handed their own", async () => {
    const a = await paste(A, "why-trees", PAIR_URL);
    const b = await paste(B, "why-trees", PAIR_URL);

    expect(a.id, "B was handed A's job").not.toBe(b.id);
    expect(a.slug, "both readers were given one name").not.toBe(b.slug);
    expect(a.slug.startsWith(`${SLUG_PREFIX}why-trees-`)).toBe(true);
    expect(b.slug.startsWith(`${SLUG_PREFIX}why-trees-`)).toBe(true);
    expect(a.ownerId).toBe(A);
    expect(b.ownerId).toBe(B);

    /* The jobs `enqueue` returned are the ones driven, and each published the
       article at its own slug: the canary in the prose is that job's slug. */
    expect((await drive(A, a.id)).status).toBe("done");
    expect((await drive(B, b.id)).status).toBe("done");
    for (const [job, owner] of [[a, A], [b, B]] as const) {
      const row = await articleRow(job.slug);
      expect(row?.ownerId, `${job.slug} is not its asker's`).toBe(owner);
      const revision = await publishedRevision(job.slug);
      expect(revision.finalUrl).toBe(PAIR_URL);
      const prose = await db()
        .select({ text: revisionBlocks.text })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, revision.id));
      expect(
        prose.some((block) => block.text.includes(canary(job.slug))),
        `the article at ${job.slug} was not published by the job enqueued for it`,
      ).toBe(true);
    }
    pair = { a, b };

    /* "Do you already have this?" */
    const key = urlKey(PAIR_URL);
    expect(
      await runAsOwner(A, () => slugForUrlKey(key)),
      "A was told somebody else's article is the one they already have",
    ).toBe(a.slug);
    expect(
      await runAsOwner(B, () => slugForUrlKey(key)),
      "B was told somebody else's article is the one they already have",
    ).toBe(b.slug);

    /* A pastes it again: A's own article, and never B's. */
    const again = await paste(A, "why-trees", PAIR_URL);
    expect(again.slug, "a third paste by A adopted B's article").not.toBe(b.slug);
    expect(again.slug, "a third paste by A made a third article").toBe(a.slug);
    expect(again.ownerId).toBe(A);
    await runAsOwner(A, () => cancelJob(again.id));
  });

  it("E1, AI is separate: the same checkpoint key under each article holds each reader's own value", async () => {
    const { a, b } = thePair();
    const idA = await runAsOwner(A, () => articleIdForOwned(a.slug));
    const idB = await runAsOwner(B, () => articleIdForOwned(b.slug));
    expect(idA).not.toBe(idB);

    /* One namespace and one key, written for both. Read through each article's
       own store, so the store's request check passes and Postgres is what
       answers. */
    const NAMESPACE = "structure-labels";
    const KEY = `two-readers-${RUN}`;
    const storeA = createPgCheckpointStore({ slug: a.slug, articleId: idA });
    const storeB = createPgCheckpointStore({ slug: b.slug, articleId: idB });
    await storeA.write(a.slug, NAMESPACE, KEY, { marker: "written for A" });
    await storeB.write(b.slug, NAMESPACE, KEY, { marker: "written for B" });

    expect(
      (await storeA.read<{ marker: string }>(a.slug, NAMESPACE, [KEY])).get(KEY),
      "A's article read back a value written for another article",
    ).toEqual({ marker: "written for A" });
    expect(
      (await storeB.read<{ marker: string }>(b.slug, NAMESPACE, [KEY])).get(KEY),
      "B's article read back a value written for another article",
    ).toEqual({ marker: "written for B" });
    const held = await db().select().from(checkpointsTable).where(eq(checkpointsTable.key, KEY));
    expect(held.map((row) => row.articleId).sort()).toEqual([idA, idB].sort());

    /* And B cannot come by A's article id to build a store over it. */
    await expect(
      runAsOwner(B, () => articleIdForOwned(a.slug)),
      "B resolved A's article id through an owner lookup",
    ).rejects.toMatchObject({ status: 404 });
    await expect(runAsOwner(A, () => articleIdForOwned(b.slug))).rejects.toMatchObject({ status: 404 });
  });

  /* ---------------------------------------------------------------- E13 -- */

  it("E13: pasted at the same instant is two jobs, and a retry of A's keeps A's name and leaves B's alone", async () => {
    const url = freshUrl("same-instant");
    const [a, b] = await Promise.all([paste(A, "same-instant", url), paste(B, "same-instant", url)]);

    expect(a.id).not.toBe(b.id);
    expect(a.slug, "two readers racing for one address were given one name").not.toBe(b.slug);
    expect([a.status, b.status], "one of the two was not left active").toEqual(["queued", "queued"]);
    expect([a.ownerId, b.ownerId]).toEqual([A, B]);

    /* A's fails. B's is still waiting, untouched. */
    const failed = await drive(A, a.id, partsWith({ failExtract: true }));
    expect(failed.status).toBe("error");
    const before = await jobRow(b.id);

    const retry = await runAsOwner(A, () => retryJob(failed.id));
    expect(retry?.slug, "the retry is a different article").toBe(a.slug);
    expect(retry?.slug, "the retry took B's name").not.toBe(b.slug);
    expect(retry?.ownerId).toBe(A);
    expect(await jobRow(b.id), "retrying A's job changed B's").toEqual(before);
    /* B cannot retry A's failed job either. */
    expect(await runAsOwner(B, () => retryJob(failed.id)), "B retried A's job").toBeNull();

    const doneA = await drive(A, retry!.id);
    const doneB = await drive(B, b.id);
    expect(doneA.status, doneA.error).toBe("done");
    expect(doneB.status, doneB.error).toBe("done");
    expect((await articleRow(a.slug))?.ownerId).toBe(A);
    expect((await articleRow(b.slug))?.ownerId).toBe(B);
    expect(await runAsOwner(A, () => slugForUrlKey(urlKey(url)))).toBe(a.slug);
    expect(await runAsOwner(B, () => slugForUrlKey(urlKey(url)))).toBe(b.slug);
  });

  it("E13: two requests that want the same full name get two names, and the first keeps its own", async () => {
    /* Random ids never collide, so the collision is made: both mints are
       handed the same id, and the name reservation, which has no owner in it,
       has to refuse the second. */
    const id = mintId();
    const url = freshUrl("same-name");

    forcedId.next = id;
    const a = await paste(A, "same-name", url);
    expect(forcedId.next, "A's mint did not take the forced id").toBeUndefined();
    expect(a.slug).toBe(`${SLUG_PREFIX}same-name-${id}`);

    forcedId.next = id;
    const b = await paste(B, "same-name", url);
    expect(forcedId.next, "B's mint did not take the forced id, so nothing collided").toBeUndefined();

    expect(b.id).not.toBe(a.id);
    expect(b.slug, "B was given the name A's import has reserved").not.toBe(a.slug);
    expect(b.slug.startsWith(`${SLUG_PREFIX}same-name-`)).toBe(true);
    expect(shortIdInSlug(b.slug), "B's second name has no id of its own").not.toBe(id);
    expect(b.ownerId).toBe(B);
    const first = await jobRow(a.id);
    expect([first?.slug, first?.ownerId, first?.status], "A's job was disturbed").toEqual([a.slug, A, "queued"]);

    /* Both then publish, each under its own name. */
    expect((await drive(A, a.id)).status).toBe("done");
    expect((await drive(B, b.id)).status).toBe("done");
    expect((await articleRow(a.slug))?.ownerId).toBe(A);
    expect((await articleRow(b.slug))?.ownerId).toBe(B);
  });

  /* ------------------------------------------------------ per-reader data -- */

  /* Before E2 to E4 and not after them, because it needs A's copy to still
     exist: "on B's article only" says nothing once A's is deleted. */
  it("per-reader data: a comment and a tag B adds land on B's article id and nowhere on A's", async () => {
    const { a, b } = thePair();
    const idA = (await articleRow(a.slug))!.id;
    const idB = (await articleRow(b.slug))!.id;
    const [block] = await db()
      .select({ blockId: revisionBlocks.blockId })
      .from(revisionBlocks)
      .where(eq(revisionBlocks.revisionId, (await publishedRevision(b.slug)).id))
      .limit(1);

    const comment = await runAsOwner(B, () =>
      pgCommentStore.create(b.slug, { blockId: block!.blockId, body: "B's own note" }),
    );
    const tags = await runAsOwner(B, () => pgTagStore.edit(b.slug, { add: ["two-readers"] }));
    expect(tags).toEqual(["two-readers"]);

    const written = await db().select().from(commentsTable).where(eq(commentsTable.id, comment.id));
    expect(written.map((row) => [row.articleId, row.ownerId])).toEqual([[idB, B]]);
    expect(
      await db().select().from(commentsTable).where(eq(commentsTable.articleId, idA)),
      "B's comment is on A's article",
    ).toEqual([]);
    const tagged = await db().select().from(articleTags).where(inArray(articleTags.articleId, [idA, idB]));
    expect(tagged.map((row) => [row.articleId, row.tag]), "B's tag is on A's article").toEqual([
      [idB, "two-readers"],
    ]);

    /* What each reader then sees of their own. */
    expect(await runAsOwner(A, () => pgCommentStore.load(a.slug))).toEqual([]);
    expect(await runAsOwner(A, () => pgTagStore.tagsFor(a.slug))).toEqual([]);
    expect((await runAsOwner(B, () => pgCommentStore.load(b.slug))).map((c) => c.id)).toEqual([comment.id]);

    /* And neither can write on the other's. */
    await expect(
      runAsOwner(A, () => pgTagStore.edit(b.slug, { add: ["not-mine"] })),
      "A tagged B's article",
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      runAsOwner(A, () => pgCommentStore.create(b.slug, { blockId: block!.blockId, body: "A's note" })),
      "A commented on B's article",
    ).rejects.toMatchObject({ status: 404 });
  });

  /* ----------------------------------------------------------------- E2 -- */

  it("E2: A's is public and B's is not: a visitor gets A's, and B's is a 404 to everyone but B", async () => {
    const { a, b } = thePair();
    expect(await publicShelf(), "something of this file's was public before anybody shared it").toEqual([]);

    const state = await runAsOwner(A, () => pgVisibilityStore.set(a.slug, "public", true));
    expect(state.visibility).toBe("public");
    expect((await articleRow(b.slug))?.visibility, "sharing A's changed B's").toBe("private");

    const visitorA = await asVisitor(a.slug);
    expect(visitorA.status, visitorA.text).toBe(200);
    expect(visitorA.text).toContain(canary(a.slug));

    const visitorB = await asVisitor(b.slug);
    expect(visitorB.status, "a visitor was served something at B's private address").toBe(404);
    expect(visitorB.text).not.toContain("canary-of-");

    /* To A, B's is as absent as it is to a stranger: by the owner's route and
       by the public one. */
    expect((await asOwner(A, b.slug)).status, "A read B's private copy as its owner").toBe(404);
    expect((await request(A, `/api/public/article/${b.slug}`)).status).toBe(404);

    const own = await asOwner(B, b.slug);
    expect(own.status, own.text).toBe(200);
    expect(own.text).toContain(canary(b.slug));
    expect(own.text, "B was served A's words at B's own address").not.toContain(canary(a.slug));

    expect(await publicShelf(), "the public shelf does not list exactly A's").toEqual([a.slug]);
  });

  /* ----------------------------------------------------------------- E3 -- */

  it("E3: B shares theirs too: both are listed, and each public address returns its own article", async () => {
    const { a, b } = thePair();
    const state = await runAsOwner(B, () => pgVisibilityStore.set(b.slug, "public", true));
    expect(state.visibility, "the second reader could not publish the same article").toBe("public");
    expect((await articleRow(a.slug))?.visibility).toBe("public");

    expect(await publicShelf(), "the public shelf does not list both copies").toEqual([a.slug, b.slug].sort());

    const servedA = await asVisitor(a.slug);
    const servedB = await asVisitor(b.slug);
    expect(servedA.status, servedA.text).toBe(200);
    expect(servedB.status, servedB.text).toBe(200);
    expect(servedA.text).toContain(canary(a.slug));
    expect(servedA.text, "A's public address served B's article").not.toContain(canary(b.slug));
    expect(servedB.text).toContain(canary(b.slug));
    expect(servedB.text, "B's public address served A's article").not.toContain(canary(a.slug));
  });

  /* ----------------------------------------------------------------- E6 -- */

  it("E6: B, signed in and holding their own, is a visitor at A's address and the owner at theirs", async () => {
    const { a, b } = thePair();
    expect((await articleRow(a.slug))?.visibility, "this case needs A's to be public").toBe("public");

    expect((await asOwner(B, a.slug)).status, "B was answered as the owner of A's article").toBe(404);

    const visiting = await request(B, `/api/public/article/${a.slug}`);
    expect(visiting.status, visiting.text).toBe(200);
    expect(visiting.text).toContain(canary(a.slug));
    expect(visiting.text, "B, visiting A's, was served their own copy").not.toContain(canary(b.slug));

    const own = await asOwner(B, b.slug);
    expect(own.status, own.text).toBe(200);
    expect(own.text).toContain(canary(b.slug));
    expect(own.text).not.toContain(canary(a.slug));
  });

  /* ----------------------------------------------------------------- E4 -- */

  it("E4: A unshares and then deletes, and B's article, its blocks, its picture and the stored source are untouched", async () => {
    const { a, b } = thePair();
    const revisionA = await publishedRevision(a.slug);
    const revisionB = await publishedRevision(b.slug);
    const SOURCE = shaOf(pageAt(PAIR_URL));
    /* The thing shared between them, said out loud before one of them goes:
       one stored document, and one picture named by both manifests. */
    expect([revisionA.rawSourceSha256, revisionB.rawSourceSha256]).toEqual([SOURCE, SOURCE]);
    const stored = () =>
      db().select().from(rawSources).where(and(eq(rawSources.sha256, SOURCE), eq(rawSources.kind, "html")));
    expect(await stored(), "the two copies do not share one stored source").toHaveLength(1);
    const figureIn = (revision: { assets: unknown }) =>
      ((revision.assets as Assets | null)?.entries ?? []).map((entry) =>
        entry.status === "stored" ? entry.sha256 : null,
      );
    expect([figureIn(revisionA), figureIn(revisionB)]).toEqual([[FIGURE_SHA], [FIGURE_SHA]]);

    /* A unshares. */
    await runAsOwner(A, () => pgVisibilityStore.set(a.slug, "private", false));
    expect(await publicShelf(), "A's unshare did not leave exactly B's on the public shelf").toEqual([b.slug]);
    expect((await asVisitor(a.slug)).status).toBe(404);
    expect((await asVisitor(b.slug)).status, "A's unshare took B's copy down").toBe(200);

    /* B cannot delete A's, by its name or at all. */
    await stopQueued(A, a.slug);
    await expect(
      runAsOwner(B, () => pgShelfStore.destroy(a.slug)),
      "B deleted A's article",
    ).rejects.toMatchObject({ status: 404 });
    expect((await articleRow(a.slug))?.ownerId, "B deleted A's article").toBe(A);

    /* A deletes their own. */
    expect(await runAsOwner(A, () => pgShelfStore.destroy(a.slug))).toEqual({ destroyed: a.slug });
    expect(await articleRow(a.slug)).toBeUndefined();
    expect((await asOwner(A, a.slug)).status).toBe(404);

    /* B's is all still there, and still serves. */
    const row = await articleRow(b.slug);
    expect([row?.ownerId, row?.currentRevisionId, row?.visibility]).toEqual([B, revisionB.id, "public"]);
    const own = await asOwner(B, b.slug);
    expect(own.status, own.text).toBe(200);
    expect(own.text).toContain(canary(b.slug));
    const blocks = await db()
      .select({ blockId: revisionBlocks.blockId })
      .from(revisionBlocks)
      .where(eq(revisionBlocks.revisionId, revisionB.id));
    expect(blocks.length, "B's blocks went with A's article").toBeGreaterThanOrEqual(8);
    expect(figureIn(await publishedRevision(b.slug))).toEqual([FIGURE_SHA]);

    const picture = await request(B, `/api/asset/${b.slug}/${FIGURE_SHA}.png`);
    expect(picture.status, "B's picture stopped serving when A deleted theirs").toBe(200);
    expect(new Uint8Array(picture.body)).toEqual(FIGURE);
    const publicPicture = await request(null, `/api/public/asset/${b.slug}/${FIGURE_SHA}.png`);
    expect(publicPicture.status).toBe(200);
    expect(new Uint8Array(publicPicture.body)).toEqual(FIGURE);
    /* And A's address no longer names that picture, to A or to anyone. */
    expect((await request(A, `/api/asset/${a.slug}/${FIGURE_SHA}.png`)).status).toBe(404);

    expect(await stored(), "the shared stored source went with A's article").toHaveLength(1);
    expect((await publishedRevision(b.slug)).rawSourceSha256).toBe(SOURCE);
    expect(await publicShelf()).toEqual([b.slug]);
  });

  /* ----------------------------------------------------------------- E5 -- */

  it("E5: the same file uploaded by both is two articles over one stored file, each upload its uploader's", async () => {
    const bytes = new TextEncoder().encode(
      `<!doctype html><html><head><meta charset="utf-8"><title>Why trees</title></head>` +
        `<body><h1>Why trees</h1><p>One file, chosen by two readers, ${RUN}.</p></body></html>`,
    );
    const sha = shaOf(bytes);

    /** What the upload route leaves behind: a record, claimed, and the bytes in staging. */
    const upload = async (owner: OwnerId) => {
      const minted = await mintUpload(
        { filename: "why-trees.html", bytes: bytes.byteLength, sha256: sha, owner },
        async (key) => ({
          url: `https://x.test/${key}`,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
        stagingKey,
      );
      const id = minted.record.id;
      await blobStore().putIfAbsent(stagingKey(id), bytes, CONTENT_TYPE.html);
      const claimed = await claimUpload(id, { owner });
      expect(claimed.ok, JSON.stringify(claimed)).toBe(true);
      const job = await runAsOwner(owner, () =>
        enqueue({
          slug: `${SLUG_PREFIX}upload`,
          upload: { id, filename: minted.record.filename },
          pump: false,
        }),
      );
      return { id, job };
    };

    const a = await upload(A);
    const b = await upload(B);
    /* B cannot claim, or queue a job on, the upload that is A's. */
    expect((await claimUpload(a.id, { owner: B })).ok, "B claimed A's upload").toBe(false);
    expect(a.job.slug).not.toBe(b.job.slug);

    const doneA = await drive(A, a.job.id);
    const doneB = await drive(B, b.job.id);
    expect(doneA.status, doneA.error).toBe("done");
    expect(doneB.status, doneB.error).toBe("done");

    expect((await articleRow(a.job.slug))?.ownerId).toBe(A);
    expect((await articleRow(b.job.slug))?.ownerId).toBe(B);
    const [revisionA, revisionB] = [await publishedRevision(a.job.slug), await publishedRevision(b.job.slug)];
    expect(revisionA.id).not.toBe(revisionB.id);

    /* One stored file: both revisions name it, one row describes it, and the
       bucket holds it once under its hash. */
    const storedSha = revisionA.rawSourceSha256;
    expect(storedSha, "A's article names no stored file").toMatch(/^[0-9a-f]{64}$/);
    expect(revisionB.rawSourceSha256, "the two uploads were stored as two files").toBe(storedSha);
    expect(
      await db().select().from(rawSources).where(and(eq(rawSources.sha256, storedSha!), eq(rawSources.kind, "html"))),
    ).toHaveLength(1);
    expect(await blobStore().head(canonicalKey(storedSha!, "html"))).not.toBeNull();

    /* Each upload is its uploader's, and each was checked against the bytes. */
    const records = await db().select().from(uploadsTable).where(inArray(uploadsTable.id, [a.id, b.id]));
    const by = (id: string) => records.find((row) => row.id === id);
    expect([by(a.id)?.ownerId, by(a.id)?.status, by(a.id)?.sha256]).toEqual([A, "verified", sha]);
    expect([by(b.id)?.ownerId, by(b.id)?.status, by(b.id)?.sha256]).toEqual([B, "verified", sha]);
  });

  /* ---------------------------------------------------------------- E11 -- */

  it("E11: a legacy article whose slug is a bare name is not the name B's import of that name gets", async () => {
    /* A row as they were made before 2026-08-31: a name, and no id on the end
       of it or in `short_id`. */
    const bare = `${SLUG_PREFIX}legacy-${RUN}`;
    const legacyId = randomUUID();
    await db().insert(articles).values({ id: legacyId, ownerId: A, slug: bare });
    const before = await articleRow(bare);
    expect([before?.shortId, shortIdInSlug(bare)]).toEqual([null, undefined]);

    /* B imports an address that derives exactly that name. */
    const job = await runAsOwner(B, () =>
      enqueue({ slug: bare, url: freshUrl("legacy"), pump: false }),
    );
    expect(job.slug, "B's import was given A's legacy name").not.toBe(bare);
    expect(job.slug.startsWith(`${bare}-`)).toBe(true);
    expect(shortIdInSlug(job.slug), "a new import's name carries no id").toBeDefined();

    const done = await drive(B, job.id);
    expect(done.status, done.error).toBe("done");
    expect((await articleRow(job.slug))?.ownerId).toBe(B);
    expect(await articleRow(bare), "A's legacy row was touched by B's import").toEqual(before);
    /* B, naming the bare slug outright, is told there is no such article. */
    await expect(
      runAsOwner(B, () => enqueue({ slug: bare, steps: ["assets"], pump: false })),
    ).rejects.toMatchObject({ status: 404 });
  });

  /* -------------------------------------------------------------- the end -- */

  it("and none of it reached the network", () => {
    const asked = (network?.mock.calls ?? [["no spy"]]) as unknown[][];
    expect(asked.map((call) => String(call[0]))).toEqual([]);
  });
});
