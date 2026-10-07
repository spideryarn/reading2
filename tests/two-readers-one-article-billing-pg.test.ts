/**
 * **Two readers hold the same article: what each is charged, what each paper
 * costs, and whose link opens what.** The billing half of plan
 * docs/plans/261007f-two-readers-import-the-same-article-checked-end-to-end-and-the-edge-cases.md,
 * Stage 1: cases E16, E14 and E15. Its sibling,
 * tests/two-readers-one-article-pg.test.ts, drives the queue; this file is the
 * money and the sharing.
 *
 * Greg, 2026-10-06:
 *
 * > They should both have their own copy with their own AI processing.
 *
 * Every layer here already has a test of its own with one reader in it. What
 * none of them asks is what happens when **the other reader's copy of the same
 * thing is sitting beside it**: the same address on both revisions, the same
 * PDF bytes behind both papers, the same picture's hash in both manifests.
 * That is the one arrangement in which a lookup that forgot the owner, or
 * trusted a hash, or counted by address, finds a second row to get wrong.
 *
 * 1. **E16, charging.** Each reader has one ingest of their own. Sharing A's
 *    halves A's and leaves B's at full price; deleting A's freezes A's price
 *    and leaves B's row alone; and a model call's ledger row is attached to
 *    the article of the reader it bills, never to the other reader's.
 * 2. **E14, the cheap import.** Both add the same PDF bytes without AI
 *    processing: two papers, two charges of 2 points, one stored file. A's
 *    *Read this* supersedes A's minimal row and no other. B's stays minimal
 *    and is read later, for B's own 200.
 * 3. **E15, private links.** Both make one. A's key opens A's article and A's
 *    picture, and is the absent article's 404 at B's address, although both
 *    manifests name the same hash. B cannot turn A's link off. A turns it off
 *    and then deletes the article: B's key and B's picture still answer.
 *
 * A real database and the real routes, stores, reservations and publication.
 * The bucket is a temp directory and the upload grant is a made-up address, so
 * nothing here reaches Storage; the model steps are fakes, so nothing reaches a
 * provider either.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiCallRow } from "../src/ai-spend.js";
import type { Assets } from "../src/assets.js";
import type { Verifier } from "../src/auth.js";
import { blocksArtefact } from "../src/blocks.js";
import { FREE } from "../src/billing/tiers.js";
import { closeDb, getDb } from "../src/db/client.js";
import { aiCalls, articleRevisions, articles, blockIdentities, ingestEvents, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { type AdvanceParts, type StepRegistry, advanceJobWith, claimSession } from "../src/jobs.js";
import { mergeLabels, type PendingLabelsFile } from "../src/labels.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import type { PaperMetadata } from "../src/paper-metadata.js";
import { STEPS, articleRegistryDeps, metadataReaders, titleTidiers, type PipelineStep } from "../src/pipeline.js";
import { hashBlocks, structureHash } from "../src/source-hash.js";
import { canonicalKey, stagingKey } from "../src/source.js";
import { buildTree } from "../src/structure.js";
import { reserveIngest, settleReservation, usageFor, wallUsed } from "../src/store/pg-billing.js";
import { ruleTitleTidier } from "../src/title-tidy.js";
import type { Job, ShareLinkState } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

/* The blob store pointed at a temp directory, as tests/asset-route.test.ts
   does and for its reason: without it the routes read the machine's bucket.
   And the upload grant with it, which that file has no need of: minting a
   real one is a request to Storage, and all this file wants from a grant is
   an upload record. The bytes are put at the staging key by hand, as the
   browser's PUT would have left them.

   `postgresBlobStore` too, because the metadata step reads a paper's stored
   file through it (src/store/pg-source.ts) and the fetch step wrote that file
   through `blobStore()`: mock one and not the other and the paper's own
   source is "not where it should be". Both are asked per call, so both see
   the directory `beforeAll` makes.

   And `storeRawSource`'s default, which is the one that is easy to miss. Its
   third parameter defaults to `blobStore()` *inside* blobs.ts, a binding no
   mock of the export reaches, and the upload's acquire step calls it with two
   arguments (src/pipeline.ts). Left alone, that one write goes to the
   machine's real bucket while every read here looks in the temp directory.
   The function itself is the real one; only what it defaults to is handed in. */
let blobDir = "";
vi.mock("../src/store/blobs.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/blobs.js")>();
  const { fsBlobs } = await import("../src/store/blobs-fs.js");
  return {
    ...real,
    blobStore: () => fsBlobs(blobDir),
    postgresBlobStore: () => fsBlobs(blobDir),
    storeRawSource: (...[bytes, kind, store]: Parameters<typeof real.storeRawSource>) =>
      real.storeRawSource(bytes, kind, store ?? fsBlobs(blobDir)),
    uploadGrants: () => ({
      sign: async (key: string) => ({
        url: `https://storage.example.invalid/${key}`,
        token: "not-a-grant",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    }),
  };
});

await pgReady({
  suite: "tests/two-readers-one-article-billing-pg.test.ts",
  tables: [
    "spideryarn.articles",
    "spideryarn.ingest_events",
    "spideryarn.uploads",
    "spideryarn.ai_calls",
    "spideryarn.article_share_link_events",
    "auth.users",
  ],
  columns: [
    { table: "spideryarn.ingest_events", column: "superseded_by" },
    { table: "spideryarn.ingest_events", column: "article_visibility_at_delete" },
    { table: "spideryarn.articles", column: "share_token" },
  ],
});

/** Fixed reader ids unique to this file; tests/fixture-ids.test.ts refuses reuse elsewhere. */
const A = "dbd38869-cc97-475e-b4d5-0d690338daad" as OwnerId;
const B = "0ee81fe4-6630-450f-9d3a-97750838f812" as OwnerId;

const RUN = randomUUID().slice(0, 8);
const ROOT = path.resolve(import.meta.dirname, "..");

/** The address both readers pasted. One string, on both revisions. */
const ADDRESS = `https://example.test/two-readers-billing/${RUN}/why-trees`;

/* ------------------------------------------------------------ the requests -- */

const asPerson =
  (sub: OwnerId): Verifier =>
  async () => ({
    ok: true,
    claims: {
      sub,
      email: `two-readers-billing-${sub}@example.invalid`,
      role: "authenticated",
      is_anonymous: false,
    },
  });

interface Reply {
  status: number;
  headers: Record<string, string>;
  text: string;
  body: Record<string, unknown>;
  bytes: Buffer;
}

/**
 * One request through the real dispatcher. `who` is the signed-in reader, or
 * `null` for a stranger: no `Authorization` header at all, which is the only
 * honest way to ask the public routes.
 */
async function call(who: OwnerId | null, method: string, url: string, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: who === null ? {} : { authorization: "Bearer test-token" } },
  ) as unknown as IncomingMessage;

  let status = 0;
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
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

  const { handleApi } = await import("../src/routes.js");
  await handleApi(req, res, who === null ? undefined : asPerson(who));
  const bytes = Buffer.concat(chunks);
  const text = bytes.toString("utf8");
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* A picture. `bytes` is what the case reads. */
  }
  return { status, headers, text, body: parsed, bytes };
}

/** **`VERCEL`, so nothing starts a pump**: this file drives every job itself. */
async function withoutTheWorker<T>(body: () => Promise<T>): Promise<T> {
  const was = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    return await body();
  } finally {
    if (was === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = was;
  }
}

/* -------------------------------------------------------------- the reads -- */

async function rowsOf<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await getDb().execute(query)).rows as T[];
}

/** One reader's whole ledger, oldest first. */
function ledgerOf(owner: OwnerId) {
  return getDb().select().from(ingestEvents).where(eq(ingestEvents.ownerId, owner)).orderBy(ingestEvents.reservedAt);
}

async function articleRow(slug: string) {
  const [row] = await getDb().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  if (!row) throw new Error(`no article ${slug}`);
  return row;
}

/** Neither reader has a subscription, so the allowance is the free one. */
const usageOf = (owner: OwnerId) => usageFor(owner, FREE);

async function clear(): Promise<void> {
  for (const owner of [A, B]) {
    for (const statement of [
      sql`delete from spideryarn.jobs where owner_id = ${owner}::uuid`,
      /* One statement for the whole ledger, so a row and the row that
         superseded it go together. */
      sql`delete from spideryarn.ingest_events where owner_id = ${owner}::uuid`,
      sql`delete from spideryarn.article_visibility_changes where actor_owner_id = ${owner}::uuid`,
      sql`delete from spideryarn.article_share_link_events where actor_owner_id = ${owner}::uuid`,
      sql`delete from spideryarn.uploads where owner_id = ${owner}::uuid`,
      sql`delete from spideryarn.ai_calls where owner_id = ${owner}::uuid`,
      sql`delete from spideryarn.articles where owner_id = ${owner}::uuid`,
      sql`delete from spideryarn.billing_accounts where owner_id = ${owner}::uuid`,
    ]) {
      await getDb().execute(statement);
    }
  }
}

beforeAll(async () => {
  blobDir = await mkdtemp(path.join(tmpdir(), "spya-two-readers-billing-"));
  for (const id of [A, B]) {
    await seedAuthUser(getDb(), { id, email: `two-readers-billing-${id}@example.invalid`, onConflictDoNothing: true });
  }
});

/* Every case starts from two readers who hold nothing and owe nothing, so a
   count below is a count of what that case did. */
beforeEach(async () => {
  await clear();
});

afterAll(async () => {
  await clear();
  await getDb()
    .execute(sql`delete from auth.users where id in (${A}::uuid, ${B}::uuid)`)
    .catch(() => {});
  await rm(blobDir, { recursive: true, force: true });
  await closeDb();
});

/* ------------------------------------------------- an article, seeded whole -- */

/** A real PNG header, as tests/asset-route.test.ts builds one. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** **The article's one picture, and it is the same bytes in both copies.** */
const PICTURE = png(1024, 577);
const PICTURE_SHA = createHash("sha256").update(PICTURE).digest("hex");

interface Copy {
  owner: OwnerId;
  slug: string;
  articleId: string;
  /** A canary in the prose, so "served the other reader's copy" has a body to show it. */
  prose: string;
}

/**
 * **One reader's copy of the article**, published: a row, a revision at
 * `ADDRESS` whose manifest names `PICTURE_SHA`, and one block. The shape
 * tests/share-link-pg.test.ts seeds, which is what the public reader needs to
 * draw anything.
 *
 * Seeded rather than imported because E15 and E16 are about what happens
 * *after* publication. The sibling file is the one that gets two readers there
 * through the queue.
 */
async function copyFor(owner: OwnerId, name: string): Promise<Copy> {
  const { blobStore } = await import("../src/store/blobs.js");
  await blobStore().putIfAbsent(canonicalKey(PICTURE_SHA, "png"), PICTURE, "image/png");

  const copy: Copy = {
    owner,
    /* The name plus a random id, as `slugWithShortId` makes one: the two
       copies of one address differ only in the id. */
    slug: `why-trees-${name}-${mintId().toLowerCase()}`,
    articleId: randomUUID(),
    prose: `Why trees, as ${name} has it. Canary ${name.toUpperCase()}-${RUN}.`,
  };
  const revisionId = randomUUID();
  const blockId = mintId();
  const assets: Assets = {
    version: "assets/2",
    sourceHash: "not-what-this-file-is-about",
    fetchedAt: new Date().toISOString(),
    entries: [
      {
        url: `${ADDRESS}/figure-1.png`,
        status: "stored",
        sha256: PICTURE_SHA,
        ext: "png",
        contentType: "image/png",
        bytes: PICTURE.byteLength,
      },
    ],
    pdfFigures: [],
  };
  const db = getDb();
  await db.insert(articles).values({ id: copy.articleId, ownerId: owner, slug: copy.slug, shortId: mintId() });
  await db.insert(articleRevisions).values({
    id: revisionId,
    articleId: copy.articleId,
    status: "published",
    title: "Why trees",
    finalUrl: ADDRESS,
    wordCount: 9,
    blockCount: 1,
    partCount: 0,
    sectionCount: 0,
    rootGist: "Why trees.",
    assets,
    tree: {
      version: "1",
      generator: "test",
      slug: copy.slug,
      rootId: "n0",
      nodes: {
        n0: { id: "n0", depth: 0, parent: null, children: [], range: [blockId, blockId], title: "Root", gist: "Why trees." },
      },
    },
  });
  await db.update(articles).set({ currentRevisionId: revisionId }).where(eq(articles.id, copy.articleId));
  await db.insert(blockIdentities).values({ articleId: copy.articleId, blockId });
  await db.insert(revisionBlocks).values({
    articleId: copy.articleId,
    revisionId,
    blockId,
    ordinal: 0,
    tag: "p",
    kind: "text",
    text: copy.prose,
    words: 9,
    html: `<p>${copy.prose}</p>`,
    gistable: true,
  });
  return copy;
}

/** Both readers' copies. The precondition every case below stands on is asserted, not assumed. */
async function bothCopies(): Promise<{ a: Copy; b: Copy }> {
  const a = await copyFor(A, "a");
  const b = await copyFor(B, "b");
  const held = await rowsOf<{ slug: string; owner_id: string; final_url: string; sha: string }>(sql`
    select a.slug, a.owner_id, r.final_url, r.assets -> 'entries' -> 0 ->> 'sha256' as sha
      from spideryarn.articles a
      join spideryarn.article_revisions r on r.id = a.current_revision_id
     where a.id in (${a.articleId}::uuid, ${b.articleId}::uuid)
     order by a.slug`);
  expect(held, "two readers, one address, one picture hash, two slugs").toEqual(
    [
      { slug: a.slug, owner_id: A, final_url: ADDRESS, sha: PICTURE_SHA },
      { slug: b.slug, owner_id: B, final_url: ADDRESS, sha: PICTURE_SHA },
    ].sort((x, y) => x.slug.localeCompare(y.slug)),
  );
  return { a, b };
}

/* ================================================================== E16 == */

describe("E16: each reader is charged for their own copy, and only for that", () => {
  /**
   * **A real reservation, charged onto the reader's own copy**: admitted under
   * the owner's billing lock (`reserveIngest`) and settled the way a
   * publication settles it. Returns the ledger row's id.
   */
  async function charged(copy: Copy): Promise<string> {
    const admitted = await reserveIngest(copy.owner, copy.slug);
    if (admitted.kind !== "admitted") throw new Error(`the ingest was not admitted: ${admitted.kind}`);
    await settleReservation(getDb(), admitted.reservationId, { kind: "succeeded", articleId: copy.articleId });
    return admitted.reservationId;
  }

  const setVisibility = (copy: Copy, to: "public" | "private") =>
    call(copy.owner, "PUT", `/api/article/${copy.slug}/visibility`, {
      visibility: to,
      ...(to === "public" ? { rightsConfirmed: true } : {}),
    });

  it("gives each one ingest event of their own", async () => {
    const { a, b } = await bothCopies();
    const eventA = await charged(a);
    const eventB = await charged(b);

    for (const [copy, event] of [
      [a, eventA],
      [b, eventB],
    ] as const) {
      const ledger = await ledgerOf(copy.owner);
      expect(ledger, `${copy.slug}: one row, their own`).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ id: event, ownerId: copy.owner, kind: "ingest", articleId: copy.articleId });
      expect(ledger[0]?.succeededAt).not.toBeNull();
      /* One private article each: 200 points, not 400 for the address. */
      const usage = await usageOf(copy.owner);
      expect(usage, copy.slug).toMatchObject({ chargedFullPrice: 1, chargedHalfPrice: 0, inFlightIngest: 0 });
      expect(wallUsed(usage), copy.slug).toBe(200);
    }
  });

  it("halves A's when A shares, and leaves B's at full price", async () => {
    const { a, b } = await bothCopies();
    await charged(a);
    await charged(b);

    const shared = await setVisibility(a, "public");
    expect(shared.status, shared.text).toBe(200);

    let usageA = await usageOf(A);
    let usageB = await usageOf(B);
    expect(usageA, "A, shared").toMatchObject({ chargedFullPrice: 0, chargedHalfPrice: 1 });
    expect(wallUsed(usageA), "A, shared").toBe(100);
    /* The same address, public a row away, and B's copy is still private. */
    expect(usageB, "B, while A's is public").toMatchObject({ chargedFullPrice: 1, chargedHalfPrice: 0 });
    expect(wallUsed(usageB), "B, while A's is public").toBe(200);
    expect((await articleRow(b.slug)).visibility).toBe("private");

    /* And taking it down puts A's straight back, again without touching B's. */
    const unshared = await setVisibility(a, "private");
    expect(unshared.status, unshared.text).toBe(200);
    usageA = await usageOf(A);
    usageB = await usageOf(B);
    expect(usageA, "A, unshared").toMatchObject({ chargedFullPrice: 1, chargedHalfPrice: 0 });
    expect(wallUsed(usageA), "A, unshared").toBe(200);
    expect(wallUsed(usageB), "B, after A unshared").toBe(200);
  });

  it("is refused to B: A's copy cannot be shared or unshared from B's account", async () => {
    const { a, b } = await bothCopies();
    await charged(a);
    await charged(b);

    const theirs = await setVisibility({ ...a, owner: B }, "public");
    expect(theirs.status).toBe(404);
    expect((await articleRow(a.slug)).visibility).toBe("private");
    expect(wallUsed(await usageOf(A))).toBe(200);
  });

  it("freezes only A's price when A deletes a shared copy", async () => {
    const { a, b } = await bothCopies();
    const eventA = await charged(a);
    const eventB = await charged(b);
    expect((await setVisibility(a, "public")).status).toBe(200);

    const gone = await call(A, "DELETE", `/api/library/${a.slug}`);
    expect(gone.status, gone.text).toBe(200);

    /* A's row lost its article and kept the price the article had. */
    const frozen = await rowsOf<{ id: string; article_id: string | null; at_delete: string | null }>(sql`
      select id, article_id, article_visibility_at_delete as at_delete
        from spideryarn.ingest_events where id in (${eventA}::uuid, ${eventB}::uuid)`);
    expect(frozen.find((r) => r.id === eventA)).toEqual({ id: eventA, article_id: null, at_delete: "public" });
    /* B's row still names B's article, and nothing was stamped on it. */
    expect(frozen.find((r) => r.id === eventB)).toEqual({ id: eventB, article_id: b.articleId, at_delete: null });

    const usageA = await usageOf(A);
    expect(usageA, "A, deleted while public").toMatchObject({ chargedFullPrice: 0, chargedHalfPrice: 1 });
    expect(wallUsed(usageA), "A, deleted while public").toBe(100);
    const usageB = await usageOf(B);
    expect(usageB, "B, after A's delete").toMatchObject({ chargedFullPrice: 1, chargedHalfPrice: 0 });
    expect(wallUsed(usageB), "B, after A's delete").toBe(200);

    /* And B's copy is still B's article, private, at B's address. */
    expect(await articleRow(b.slug)).toMatchObject({ id: b.articleId, ownerId: B, visibility: "private" });
  });

  /** A plausible finished call, as tests/store-ai-calls.test.ts spells one out. */
  function modelCall(over: Pick<AiCallRow, "id" | "ownerId" | "articleSlug" | "jobId">): AiCallRow {
    return {
      runId: randomUUID(),
      generationId: `gen-two-readers-billing-${over.id}`,
      scopeKind: "job_step",
      stepName: "structure",
      wire: "messages",
      job: "structure",
      requestedModel: "anthropic/claude-sonnet-5",
      answeredModel: "anthropic/claude-sonnet-5",
      upstream: "Anthropic",
      providerAccount: "openrouter",
      costSource: "provider",
      computedCostNanos: null,
      priceVersion: null,
      credentialFingerprint: "abcdef012345",
      startedAt: "2026-10-07T10:00:00.000Z",
      finishedAt: "2026-10-07T10:00:01.200Z",
      durationMs: 1200,
      outcome: "ok",
      attempt: null,
      failurePhase: null,
      failureClass: null,
      failureStatus: null,
      creditsUsedNanos: 21_523_500,
      byokUpstreamNanos: null,
      isByok: false,
      reportedInputTokens: 13,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      reasoningTokens: 0,
      webSearches: null,
      serviceTier: "standard",
      inferenceGeo: null,
      realtimeSessionId: null,
      providerEventId: null,
      eventKind: null,
      providerStatus: null,
      inputTextTokens: null,
      inputAudioTokens: null,
      inputImageTokens: null,
      cachedTextTokens: null,
      cachedAudioTokens: null,
      outputTextTokens: null,
      outputAudioTokens: null,
      transcriptionSeconds: null,
      voiceSeconds: null,
      ...over,
    };
  }

  it("attaches each job's model call to the article of the reader it bills", async () => {
    const { pgCostStore } = await import("../src/store/ai-calls-pg.js");
    const { a, b } = await bothCopies();
    const jobA = `job-two-readers-billing-a-${RUN}`;
    const jobB = `job-two-readers-billing-b-${RUN}`;
    const callA = modelCall({ id: randomUUID(), ownerId: A, articleSlug: a.slug, jobId: jobA });
    const callB = modelCall({ id: randomUUID(), ownerId: B, articleSlug: b.slug, jobId: jobB });
    /* The row that can go wrong: billed to B, naming A's slug. A slug is
       unique across everybody, so a lookup by slug alone finds A's article
       and files B's spend under it. It has to resolve to nothing instead. */
    const stray = modelCall({ id: randomUUID(), ownerId: B, articleSlug: a.slug, jobId: jobB });
    for (const row of [callA, callB, stray]) await pgCostStore.record(row);

    const written = await getDb()
      .select({ id: aiCalls.id, ownerId: aiCalls.ownerId, articleId: aiCalls.articleId, jobId: aiCalls.jobId })
      .from(aiCalls)
      .where(sql`${aiCalls.id} in (${callA.id}::uuid, ${callB.id}::uuid, ${stray.id}::uuid)`);
    const byId = new Map(written.map((r) => [r.id, r]));
    expect(byId.get(callA.id)).toEqual({ id: callA.id, ownerId: A, articleId: a.articleId, jobId: jobA });
    expect(byId.get(callB.id)).toEqual({ id: callB.id, ownerId: B, articleId: b.articleId, jobId: jobB });
    expect(byId.get(stray.id), "B's call naming A's slug must not land on A's article").toEqual({
      id: stray.id,
      ownerId: B,
      articleId: null,
      jobId: jobB,
    });

    /* Each job reads back its own calls and nobody else's. */
    expect((await pgCostStore.forJob(jobA)).rows.map((r) => r.ownerId)).toEqual([A]);
    expect((await pgCostStore.forJob(jobB)).rows.map((r) => r.ownerId).sort()).toEqual([B, B]);
  });
});

/* ================================================================== E14 == */

describe("E14: both add the same PDF without AI processing, and one presses Read this", () => {
  /**
   * **One file, and nobody else's.** The fixture PDF with a comment after its
   * end marker, which a PDF reader ignores, so the hash is this run's own and
   * the `raw_sources` row counted below is the one these two imports made.
   */
  const PDF = new Uint8Array(
    Buffer.concat([
      fs.readFileSync(path.join(ROOT, "tests/fixtures/pdf-vector-figure/entropy-24-00930-p8.pdf")),
      Buffer.from(`\n% two-readers-billing ${RUN}\n`),
    ]),
  );
  const PDF_SHA = createHash("sha256").update(PDF).digest("hex");
  const FILENAME = `two-readers-entropy-${RUN}.pdf`;

  const found: PaperMetadata = {
    from: "model",
    title: "A Paper About Entropy",
    authors: ["Ada Lovelace", "Alan Turing"],
    abstract: "We measure something and find it is entropy.",
    doi: null,
    textChars: 1200,
    answeredBy: "fixture",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    /* No model, and no registry: the readers answer from the fixture, the
       title's tidy is the rule and not a model's, and the lookup finds nothing. */
    vi.spyOn(metadataReaders, "pdf").mockResolvedValue(found);
    vi.spyOn(titleTidiers, "import").mockImplementation(ruleTitleTidier);
    vi.spyOn(articleRegistryDeps, "lookup").mockResolvedValue({ kind: "unavailable", why: "busy" });
  });

  const PARAGRAPHS = [
    "The opening paragraph of a paper read through by two readers at once.",
    "A middle paragraph that says the measurement was entropy all along.",
  ];

  /** Stage 2 without the model: the HTML, and a title. tests/minimal-paper.test.ts's fake. */
  function fakeExtract(): PipelineStep<"extract"> {
    return {
      name: "extract",
      label: STEPS.extract.label,
      produces: ["extractedHtml", "meta"],
      async run(ctx) {
        return {
          parts: {
            extractedHtml: ["<h1>A Paper About Entropy</h1>", ...PARAGRAPHS.map((p) => `<p>${p}</p>`)].join("\n"),
            meta: { slug: ctx.slug, title: "A Paper About Entropy", source: "pdf" },
          },
          detail: "read",
        };
      },
    };
  }

  /** `structure` without the model, likewise. */
  function fakeStructure(): PipelineStep<"structure"> {
    return {
      name: "structure",
      label: STEPS.structure.label,
      produces: ["tree", "labels", "blocks"],
      async run(ctx, store) {
        const file = await store.read(ctx.slug, "blocks", "blocks");
        if (!file?.blocks) throw new Error(`no blocks for ${ctx.slug}`);
        const root = {
          title: "A Paper About Entropy",
          gist: "A fixture paper.",
          range: [file.blocks[0]?.id ?? "", file.blocks[file.blocks.length - 1]?.id ?? ""] as [string, string],
          children: [],
        };
        const structure = mergeLabels(buildTree(root, {}, file.blocks, ctx.slug), {});
        const labels: PendingLabelsFile = {
          slug: ctx.slug,
          sourceHash: hashBlocks(file.blocks),
          structureHash: structureHash(structure),
          structureVersion: structure.version,
          labels: {},
          batches: null,
        };
        return {
          parts: { tree: structure, labels, blocks: blocksArtefact(file.blocks) },
          stamp: { inputHash: labels.sourceHash },
          detail: "1 section",
        };
      },
    };
  }

  function fakeAssets(): PipelineStep<"assets"> {
    return {
      name: "assets",
      label: STEPS.assets.label,
      produces: ["assets"],
      async run() {
        const assets: Assets = { version: "assets/2", sourceHash: "none", fetchedAt: new Date().toISOString(), entries: [] };
        return { parts: { assets }, detail: "no figures" };
      },
    };
  }

  /** The production claim and publication (`claimSession`), with the three model steps faked. */
  const PARTS: AdvanceParts = {
    power: async () => "standard",
    session: claimSession,
    steps: { ...STEPS, extract: fakeExtract(), structure: fakeStructure(), assets: fakeAssets() } satisfies StepRegistry,
  };

  /** Drive one job to its end, as its owner. */
  async function drive(owner: OwnerId, id: string): Promise<Job> {
    return await withoutTheWorker(() =>
      runAsOwner(owner, async () => {
        for (let n = 1; n <= 80; n++) {
          const advanced = await advanceJobWith(id, PARTS);
          if (advanced?.done) return advanced.job;
          if (advanced?.busy) await new Promise((resolve) => setTimeout(resolve, 200));
        }
        throw new Error(`job ${id} did not finish in 80 advances`);
      }),
    );
  }

  /** `POST /api/uploads {level: "minimal"}`, answered whatever it says. */
  const mintMinimal = (owner: OwnerId) =>
    call(owner, "POST", "/api/uploads", {
      filename: FILENAME,
      bytes: PDF.byteLength,
      sha256: PDF_SHA,
      level: "minimal",
    });

  /** The paper, all the way to the shelf, through the real routes. Returns its slug. */
  async function addMinimal(owner: OwnerId): Promise<string> {
    const minted = await mintMinimal(owner);
    expect(minted.status, `minting refused: ${minted.text}`).toBe(201);
    const uploadId = String(minted.body.uploadId);
    const { blobStore } = await import("../src/store/blobs.js");
    await blobStore().putIfAbsent(stagingKey(uploadId), PDF, "application/pdf");
    const queued = await withoutTheWorker(() => call(owner, "POST", "/api/jobs", { uploadId, level: "minimal" }));
    expect(queued.status, queued.text).toBe(202);
    const job = await drive(owner, String(queued.body.id));
    expect(job.status, job.error).toBe("done");
    return job.slug;
  }

  /** *Read this*, pressed and driven to its end. */
  async function readThis(owner: OwnerId, slug: string): Promise<Job> {
    const queued = await withoutTheWorker(() => call(owner, "POST", "/api/jobs", { slug, readThis: true }));
    expect(queued.status, queued.text).toBe(202);
    return await drive(owner, String(queued.body.id));
  }

  /** What one reader's paper looks like in the database, in the terms the case is about. */
  async function paperOf(owner: OwnerId, slug: string) {
    const article = await articleRow(slug);
    const ledger = (await ledgerOf(owner)).filter((r) => r.releasedAt === null);
    return {
      article,
      minimal: ledger.filter((r) => r.kind === "minimal"),
      ingest: ledger.filter((r) => r.kind === "ingest"),
      points: wallUsed(await usageOf(owner)),
    };
  }

  it("makes two papers and two charges of one file, and Read this supersedes only its own reader's", async () => {
    const slugA = await addMinimal(A);
    /* B's are the same bytes, and that is not a duplicate: the rule asks about
       B's shelf. Asked at the grant and again under B's billing lock. */
    const slugB = await addMinimal(B);
    expect(slugA).not.toBe(slugB);

    let a = await paperOf(A, slugA);
    let b = await paperOf(B, slugB);
    for (const [owner, paper] of [
      [A, a],
      [B, b],
    ] as const) {
      expect(paper.article, owner).toMatchObject({ ownerId: owner, processing: "minimal" });
      expect(paper.minimal, owner).toHaveLength(1);
      expect(paper.minimal[0], owner).toMatchObject({ ownerId: owner, articleId: paper.article.id, supersededBy: null });
      expect(paper.minimal[0]?.succeededAt, owner).not.toBeNull();
      expect(paper.ingest, owner).toHaveLength(0);
      /* A hundredth of an article each. */
      expect(paper.points, owner).toBe(2);
    }

    /* The same bytes behind both, and stored once. */
    const revisions = await rowsOf<{ owner_id: string; raw_sha256: string }>(sql`
      select a.owner_id, r.raw_sha256
        from spideryarn.articles a
        join spideryarn.article_revisions r on r.id = a.current_revision_id
       where a.slug in (${slugA}, ${slugB})
       order by a.owner_id`);
    expect(revisions).toEqual(
      [
        { owner_id: A, raw_sha256: PDF_SHA },
        { owner_id: B, raw_sha256: PDF_SHA },
      ].sort((x, y) => x.owner_id.localeCompare(y.owner_id)),
    );
    const stored = await rowsOf<{ n: number }>(
      sql`select count(*)::int as n from spideryarn.raw_sources where sha256 = ${PDF_SHA}`,
    );
    expect(stored[0]?.n).toBe(1);

    /* Each reader's own second drop of the folder *is* a duplicate, naming
       their own paper and never the other reader's. The control for the two
       201s above: the rule is switched on, and it is per reader. */
    const againA = await mintMinimal(A);
    expect(againA.status).toBe(409);
    expect(againA.body).toMatchObject({ code: "duplicate", article: slugA });
    const againB = await mintMinimal(B);
    expect(againB.body).toMatchObject({ code: "duplicate", article: slugB });

    /* B cannot press Read this on A's paper, and it costs B nothing to try. */
    const theirs = await withoutTheWorker(() => call(B, "POST", "/api/jobs", { slug: slugA, readThis: true }));
    expect(theirs.status).toBe(404);
    expect(wallUsed(await usageOf(B))).toBe(2);

    /* A reads theirs. */
    const read = await readThis(A, slugA);
    expect(read.status, read.error).toBe("done");

    a = await paperOf(A, slugA);
    expect(a.article.processing).toBe("full");
    expect(a.ingest).toHaveLength(1);
    expect(a.ingest[0]).toMatchObject({ ownerId: A, articleId: a.article.id });
    expect(a.ingest[0]?.succeededAt).not.toBeNull();
    expect(a.minimal[0]?.supersededBy, "A's minimal row is paid for by A's ingest").toBe(a.ingest[0]?.id);
    /* One article in all: the 2 points are superseded, not added. */
    expect(a.points).toBe(200);

    /* B's paper did not move: still minimal, its row unsuperseded, 2 points. */
    b = await paperOf(B, slugB);
    expect(b.article.processing, "B's paper after A's Read this").toBe("minimal");
    expect(b.minimal, "B's minimal row after A's Read this").toHaveLength(1);
    expect(b.minimal[0]?.supersededBy, "B's minimal row after A's Read this").toBeNull();
    expect(b.ingest, "B's ledger after A's Read this").toHaveLength(0);
    expect(b.points, "B's points after A's Read this").toBe(2);

    /* And B can still read theirs later, for B's own article's worth. */
    const later = await readThis(B, slugB);
    expect(later.status, later.error).toBe("done");
    b = await paperOf(B, slugB);
    expect(b.article.processing).toBe("full");
    expect(b.ingest).toHaveLength(1);
    expect(b.ingest[0]).toMatchObject({ ownerId: B, articleId: b.article.id });
    expect(b.minimal[0]?.supersededBy).toBe(b.ingest[0]?.id);
    expect(b.points).toBe(200);
    /* Which changed nothing of A's. */
    a = await paperOf(A, slugA);
    expect(a.minimal[0]?.supersededBy).toBe(a.ingest[0]?.id);
    expect(a.points).toBe(200);
  });
});

/* ================================================================== E15 == */

describe("E15: both make a private link, and each key opens only its own copy", () => {
  /** A slug nothing has, for the 404 every refusal is compared with. */
  const ABSENT = `why-trees-nobody-${RUN}`;

  const article = (slug: string, key?: string) =>
    call(null, "GET", `/api/public/article/${slug}${key === undefined ? "" : `?key=${key}`}`);
  const picture = (slug: string, key?: string) =>
    call(null, "GET", `/api/public/asset/${slug}/${PICTURE_SHA}.png${key === undefined ? "" : `?key=${key}`}`);

  /** Make a link as the copy's owner and hand back its key. */
  async function linkFor(copy: Copy): Promise<string> {
    const made = await call(copy.owner, "POST", `/api/article/${copy.slug}/share-link`, { rightsConfirmed: true });
    expect(made.status, made.text).toBe(200);
    const state = made.body as ShareLinkState;
    if (!state.on) throw new Error(`${copy.slug} has no link after making one`);
    return state.key;
  }

  /** **The absent article's reply, whole**: a different message would say the article exists. */
  const shape = (r: Reply) => ({ status: r.status, headers: r.headers, text: r.text });
  async function refusedLike(ask: (slug: string) => Promise<Reply>, slug: string) {
    const absent = await ask(ABSENT);
    expect(absent.status).toBe(404);
    return { status: absent.status, headers: absent.headers, text: absent.text.split(ABSENT).join(slug) };
  }

  /** The link opens this copy: its own prose, by a link, and the picture's own bytes. */
  async function expectOpens(copy: Copy, key: string, other: Copy): Promise<void> {
    const page = await article(copy.slug, key);
    expect(page.status, `${copy.slug} with its own key`).toBe(200);
    expect(page.body.sharedBy).toBe("link");
    expect((page.body.meta as { slug: string }).slug).toBe(copy.slug);
    expect(page.text).toContain(copy.prose);
    expect(page.text, "the other reader's copy must not be what came back").not.toContain(other.prose);

    const image = await picture(copy.slug, key);
    expect(image.status, `${copy.slug}'s picture with its own key`).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.bytes.equals(Buffer.from(PICTURE))).toBe(true);
  }

  /** The key does not open this copy: the absent article's 404, for the page and for the picture. */
  async function expectShut(copy: Copy, key: string, why: string): Promise<void> {
    expect(shape(await article(copy.slug, key)), `${why}: the page`).toEqual(
      await refusedLike((slug) => article(slug, key), copy.slug),
    );
    expect(shape(await picture(copy.slug, key)), `${why}: the picture`).toEqual(
      await refusedLike((slug) => picture(slug, key), copy.slug),
    );
  }

  it("opens A's with A's key and B's with B's, and neither with the other's, though both manifests name one hash", async () => {
    const { a, b } = await bothCopies();
    const keyA = await linkFor(a);
    const keyB = await linkFor(b);
    expect(keyA).not.toBe(keyB);

    await expectOpens(a, keyA, b);
    await expectOpens(b, keyB, a);

    /* The picture is in B's manifest under the very hash A's key was just
       served. Holding a key and knowing a hash is still not B's key. */
    await expectShut(b, keyA, "A's key at B's address");
    await expectShut(a, keyB, "B's key at A's address");
    /* And with no key at all both are private articles. */
    expect((await article(a.slug)).status).toBe(404);
    expect((await picture(b.slug)).status).toBe(404);

    /* Signed in, each owner is served the picture from their own copy and
       not from the other's, by the same hash. */
    const own = await call(B, "GET", `/api/asset/${b.slug}/${PICTURE_SHA}.png`);
    expect(own.status).toBe(200);
    expect(own.bytes.equals(Buffer.from(PICTURE))).toBe(true);
    expect((await call(B, "GET", `/api/asset/${a.slug}/${PICTURE_SHA}.png`)).status).toBe(404);
  });

  it("does not let B read or turn off A's link", async () => {
    const { a, b } = await bothCopies();
    const keyA = await linkFor(a);
    const keyB = await linkFor(b);

    const peek = await call(B, "GET", `/api/article/${a.slug}/share-link`);
    expect(peek.status).toBe(404);
    expect(peek.text).not.toContain(keyA);
    const off = await call(B, "DELETE", `/api/article/${a.slug}/share-link`);
    expect(off.status, "B turning off A's link").toBe(404);

    /* A's link is still on, with the key A was given. */
    const still = await call(A, "GET", `/api/article/${a.slug}/share-link`);
    expect(still.body).toMatchObject({ on: true, key: keyA });
    await expectOpens(a, keyA, b);
    await expectOpens(b, keyB, a);
  });

  it("keeps B's key and B's picture working after A turns the link off and then deletes the article", async () => {
    const { a, b } = await bothCopies();
    const keyA = await linkFor(a);
    const keyB = await linkFor(b);
    await expectOpens(a, keyA, b);

    const off = await call(A, "DELETE", `/api/article/${a.slug}/share-link`);
    expect(off.status, off.text).toBe(200);
    expect(off.body).toEqual({ on: false });
    await expectShut(a, keyA, "A's key after Turn off");
    /* B's column is B's own: still on, same key. */
    expect((await call(B, "GET", `/api/article/${b.slug}/share-link`)).body).toMatchObject({ on: true, key: keyB });
    await expectOpens(b, keyB, a);

    const gone = await call(A, "DELETE", `/api/library/${a.slug}`);
    expect(gone.status, gone.text).toBe(200);
    expect(await getDb().select({ id: articles.id }).from(articles).where(eq(articles.id, a.articleId))).toEqual([]);

    /* A's article went, and the picture did not go with it: nothing deletes
       stored bytes, and B's manifest still names them. */
    const { blobStore } = await import("../src/store/blobs.js");
    expect(await blobStore().head(canonicalKey(PICTURE_SHA, "png"))).not.toBeNull();
    await expectOpens(b, keyB, a);
    await expectShut(a, keyA, "A's key after the delete");
    expect((await call(B, "GET", `/api/asset/${b.slug}/${PICTURE_SHA}.png`)).status).toBe(200);
  });
});
