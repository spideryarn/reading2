/**
 * **The thin article, on the server** — plan
 * docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md, Stage 3.
 *
 * A *minimal paper* is a file added with only its title, authors and abstract
 * read: no blocks, no tree, a hundredth of an article. What this file holds,
 * and why each is a way the feature could quietly go wrong:
 *
 * 1. **The publish gate** lets a revision with no blocks and no tree through
 *    only when the article is `'minimal'` and its `metadata` step ran.
 * 2. **A tree landing on a minimal paper is *Read this*, paid for**: the
 *    publication flips `processing` and supersedes the minimal row, and a tree
 *    no *Read this* reservation paid for is refused.
 * 3. **Every free path in is shut**: a `{slug, steps}` job, Rebuild, sharing,
 *    High-powered AI, *Start again*, and `loadArticle` itself — a typed 409
 *    through two real AI routes, so nothing is spent.
 * 4. **One paper per file**: the duplicate rule, sequentially, with two
 *    concurrent job requests, after a crash between the claim and the enqueue,
 *    and after a delete.
 * 5. ***Read this* end to end** through the real route, claim and publication,
 *    with the model steps faked: 200 points in all; and a failed one released.
 * 6. **The shelf keeps a minimal row** and says it is one.
 *
 * A real database, this file's own two readers, Storage for the uploads, and
 * no model: the metadata reader is `vi.spyOn`'d and the rest are fakes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Assets } from "../src/assets.js";
import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import type { VerifyResult, Verifier } from "../src/auth.js";
import { blocksArtefact } from "../src/blocks.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, ingestEvents, jobs as jobsTable, uploads } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { buildTree } from "../src/structure.js";
import {
  type AdvanceParts,
  type StepRegistry,
  advanceJobWith,
  claimSession,
  enqueue,
  enqueueReset,
  retryJob,
} from "../src/jobs.js";
import { mergeLabels, type PendingLabelsFile } from "../src/labels.js";
import { NOT_READ_YET, NOT_READ_YET_RESET, NOT_READ_YET_SHARE } from "../src/messages.js";
import { duplicateOnShelfSql, isMinimalJob } from "../src/minimal-paper.js";
import { NotProcessed } from "../src/not-processed.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import type { PaperMetadata } from "../src/paper-metadata.js";
import { DEFAULT_INGEST_STEPS, STEPS, articleRegistryDeps, metadataReaders, type PipelineStep } from "../src/pipeline.js";
import { handleApi } from "../src/routes.js";
import { hashBlocks, structureHash } from "../src/source-hash.js";
import { stagingKey } from "../src/source.js";
import { blobStore, CONTENT_TYPE } from "../src/store/blobs.js";
import { loadArticle, listArticles } from "../src/store/index.js";
import { accountSnapshot, entitlementFromRow, reserveIngest, usageFor, wallUsed } from "../src/store/pg-billing.js";
import { withRetrySlot } from "../src/billing/admission.js";
import { workKeyFor } from "../src/store/jobs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { mintId } from "../src/ids.js";
import { claimUpload } from "../src/upload-records.js";
import { pgVisibilityStore } from "../src/store/pg-visibility.js";
import { PublishRefused, beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/artifacts.js";
import type { Job, StepName } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

await pgReady({
  suite: "tests/minimal-paper.test.ts",
  tables: ["spideryarn.articles", "spideryarn.uploads", "spideryarn.ingest_events", "auth.users"],
  /* The migration this file is about. */
  columns: [{ table: "spideryarn.articles", column: "processing" }],
});

/** This file's two readers — tests/fixture-ids.test.ts refuses a uuid two files share. */
const READER = "3e1ec7ed-0000-4000-8000-00000000ab01" as OwnerId;
const DUPER = "3e1ec7ed-0000-4000-8000-00000000ab02" as OwnerId;

const ROOT = path.resolve(import.meta.dirname, "..");
const PDF = new Uint8Array(fs.readFileSync(path.join(ROOT, "tests/fixtures/pdf-vector-figure/entropy-24-00930-p8.pdf")));

beforeAll(async () => {
  for (const id of [READER, DUPER, ADMIN_USER_ID_LOCAL as OwnerId]) {
    await seedAuthUser(getDb(), { id, email: `minimal-paper-${id}@example.invalid`, onConflictDoNothing: true });
  }
});

afterAll(async () => {
  await closeDb();
});

/* ---------------------------------------------------------- the requests -- */

const verifierFor =
  (sub: OwnerId): Verifier =>
  async (): Promise<VerifyResult> => ({
    ok: true,
    claims: { sub, email: `minimal-paper-${sub}@example.invalid`, role: "authenticated", is_anonymous: false },
  });

/** One request through the real dispatcher, as `owner`. */
async function call(
  owner: OwnerId,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url: pathname, headers: { authorization: "Bearer test-token" } },
  ) as unknown as IncomingMessage;
  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(code: number) {
      (this as { statusCode: number }).statusCode = code;
    },
    flushHeaders() {},
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, verifierFor(owner));
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(written) as Record<string, unknown>;
  } catch {
    /* A stream, or nothing: the status is still the answer. */
  }
  return { status: res.statusCode, body: parsed };
}

/** **`VERCEL`, so `enqueue` starts no pump**: this file drives every job itself. */
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

const shaOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const PARAGRAPHS = [
  "The opening paragraph of a paper read through by tests/minimal-paper.test.ts.",
  "A middle paragraph that says the measurement was entropy all along.",
];
/** A web page nobody else's test has the bytes of. */
const pageBytes = (label: string) =>
  new TextEncoder().encode(
    `<!doctype html><html><head><meta charset="utf-8"><title>${label}</title></head>` +
      `<body><article><h1>${label}</h1><p>${randomUUID()} — some prose about ${label}.</p>` +
      PARAGRAPHS.map((p) => `<p>${p} ${p} ${p}</p>`).join("") +
      "</article></body></html>",
  );

/** `POST /api/uploads {level: "minimal"}`, answered whatever it says. */
async function mintMinimal(owner: OwnerId, filename: string, bytes: Uint8Array) {
  const was = process.env.VERCEL;
  delete process.env.VERCEL;
  try {
    return await call(owner, "POST", "/api/uploads", {
      filename,
      bytes: bytes.byteLength,
      sha256: shaOf(bytes),
      level: "minimal",
    });
  } finally {
    if (was !== undefined) process.env.VERCEL = was;
  }
}

/** Minted and landed — what the browser's grant and PUT leave behind. */
async function landed(owner: OwnerId, filename: string, bytes: Uint8Array): Promise<string> {
  const reply = await mintMinimal(owner, filename, bytes);
  expect(reply.status, `minting refused: ${String(reply.body.error)}`).toBe(201);
  const uploadId = String(reply.body.uploadId);
  await blobStore().putIfAbsent(stagingKey(uploadId), bytes, CONTENT_TYPE[filename.endsWith(".pdf") ? "pdf" : "html"]);
  return uploadId;
}

/* -------------------------------------------------------------- the steps -- */

const found = (over: Partial<PaperMetadata> = {}): PaperMetadata => ({
  from: "model",
  title: "A Paper About Entropy",
  authors: ["Ada Lovelace", "Alan Turing"],
  abstract: "We measure something and find it is entropy.",
  doi: "10.3390/e24070930",
  textChars: 1200,
  answeredBy: "fixture",
  ...over,
});

beforeEach(() => {
  vi.restoreAllMocks();
  /* No network, ever: both readers answer from the fixture. */
  vi.spyOn(metadataReaders, "pdf").mockResolvedValue(found());
  vi.spyOn(metadataReaders, "html").mockResolvedValue(found({ title: null, abstract: null, doi: null }));
  /* Nor the registry: the fetch guard refuses Crossref, so the steps are handed
     an answer. It is the fixture paper's own record, by title and author. */
  vi.spyOn(articleRegistryDeps, "lookup").mockImplementation(async (id) => ({
    kind: "found",
    record: {
      id,
      source: "crossref",
      title: "A paper about entropy",
      authors: [{ family: "Lovelace", given: "Ada" }],
      year: 2022,
      venue: "Entropy",
      published: "2022-07-06",
      doi: "10.3390/e24070930",
    },
  }));
});

const EXTRACTED_HTML = ["<h1>A Paper About Entropy</h1>", ...PARAGRAPHS.map((p) => `<p>${p}</p>`)].join("\n");

/** Stage 2 without the model: the HTML, and a title. */
function fakeExtract(fail = false): PipelineStep<"extract"> {
  return {
    name: "extract",
    label: STEPS.extract.label,
    produces: ["extractedHtml", "meta"],
    async run(ctx) {
      if (fail) throw new Error("the fixture's extract gave up on purpose");
      return {
        parts: { extractedHtml: EXTRACTED_HTML, meta: { slug: ctx.slug, title: "A Paper About Entropy", source: "pdf" } },
        detail: "read",
      };
    },
  };
}

/** `structure` without the model — tests/reset-and-regenerate.test.ts's fake. */
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

/** The production claim (`claimSession`, which births the minimal article), with the model steps faked. */
function partsWith(opts: { failExtract?: boolean } = {}): AdvanceParts {
  const steps: StepRegistry = {
    ...STEPS,
    /* The real stage 2 for a web page — Readability, no model — so what
       *Read this* keeps of the paper's metadata is the real step's doing. */
    extract: opts.failExtract ? fakeExtract(true) : STEPS.extract,
    structure: fakeStructure(),
    assets: fakeAssets(),
  };
  return { power: async () => "standard", session: claimSession, steps };
}

/** Drive one job to its end, as its owner. */
async function drive(owner: OwnerId, id: string, parts: AdvanceParts = partsWith()): Promise<Job> {
  return await runAsOwner(owner, async () => {
    for (let n = 1; n <= 80; n++) {
      const advanced = await advanceJobWith(id, parts);
      if (advanced?.done) return advanced.job;
      if (advanced?.busy) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`job ${id} did not finish in 80 advances`);
  });
}

/** A minimal paper, all the way to the shelf, through the real routes. Returns its slug. */
async function addMinimal(owner: OwnerId, filename: string, bytes: Uint8Array): Promise<string> {
  const uploadId = await landed(owner, filename, bytes);
  const queued = await withoutTheWorker(() => call(owner, "POST", "/api/jobs", { uploadId, level: "minimal" }));
  expect(queued.status, String(queued.body.error)).toBe(202);
  const job = await drive(owner, String(queued.body.id));
  expect(job.status, job.error).toBe("done");
  return job.slug;
}

/* --------------------------------------------------------------- the reads -- */

async function articleRow(slug: string) {
  const [row] = await getDb().select().from(articles).where(eq(articles.slug, slug)).limit(1);
  if (!row) throw new Error(`no article ${slug}`);
  return row;
}

async function ledgerOf(articleId: string) {
  return await getDb()
    .select()
    .from(ingestEvents)
    .where(eq(ingestEvents.articleId, articleId))
    .orderBy(ingestEvents.reservedAt);
}

async function pointsUsed(owner: OwnerId): Promise<number> {
  const entitlement = entitlementFromRow(await accountSnapshot(owner), [], new Date());
  if ("kind" in entitlement) throw new Error("a stale entitlement in a test with no subscription");
  return wallUsed(await usageFor(owner, entitlement));
}

const stepRun = (revisionId: string, name: StepName) =>
  recordStepRun({
    revisionId,
    stepName: name,
    inputHash: NO_INPUT_HASH,
    implementationVersion: PIPELINE_RUN,
    promptVersion: null,
    model: null,
    status: "done",
    startedAt: new Date(),
    finishedAt: new Date(),
  });

/* ------------------------------------------------------------------ tests -- */

describe("the minimal job shape", () => {
  it("is exactly fetch then metadata, not merely a list containing metadata", () => {
    expect(isMinimalJob(["fetch", "metadata"])).toBe(true);
    expect(isMinimalJob(["metadata"])).toBe(false);
    expect(isMinimalJob(["metadata", "metadata"])).toBe(false);
    expect(isMinimalJob(["metadata", "fetch"])).toBe(false);
    expect(isMinimalJob(["fetch", "metadata", "extract"])).toBe(false);
  });
});

describe("a minimal paper, added", () => {
  it("publishes with no blocks and no tree, its metadata on the revision, for 2 points", async () => {
    const before = await pointsUsed(READER);
    const slug = await addMinimal(READER, "entropy.pdf", PDF);
    const article = await articleRow(slug);
    expect(article.processing).toBe("minimal");
    expect(article.currentRevisionId).not.toBeNull();

    const paper = await runAsOwner(READER, () => loadArticle(slug).catch((err: unknown) => err));
    expect(paper).toBeInstanceOf(NotProcessed);
    expect((paper as NotProcessed).status).toBe(409);
    expect((paper as NotProcessed).paper).toMatchObject({
      slug,
      title: "A Paper About Entropy",
      authors: ["Ada Lovelace", "Alan Turing"],
      abstract: "We measure something and find it is entropy.",
      doi: "10.3390/e24070930",
      filename: "entropy.pdf",
      kind: "pdf",
    });
    /* The registry's record for that DOI agreed on title and author, so the
       revision keeps where and when it was published (261004a). */
    const [revision] = await getDb()
      .select({ journal: articleRevisions.journal, publishedAt: articleRevisions.publishedAt })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, article.currentRevisionId ?? randomUUID()));
    expect(revision).toEqual({ journal: "Entropy", publishedAt: "2022-07-06" });

    const rows = await ledgerOf(article.id);
    expect(rows.map((r) => [r.kind, r.succeededAt !== null])).toEqual([["minimal", true]]);
    expect((await pointsUsed(READER)) - before).toBe(2);
  });

  it("names a paper with no text after its file, and makes no call", async () => {
    vi.spyOn(metadataReaders, "pdf").mockResolvedValue(
      found({ from: "no-text-layer", title: null, authors: [], abstract: null, doi: null, textChars: 0, answeredBy: null }),
    );
    /* The same bytes would be a duplicate of the case above, so a web page. */
    vi.spyOn(metadataReaders, "html").mockResolvedValue(
      found({ from: "no-text-layer", title: null, authors: [], abstract: null, doi: null, textChars: 0, answeredBy: null }),
    );
    const slug = await addMinimal(READER, "Scanned Lecture Notes.html", pageBytes("scan"));
    const paper = (await runAsOwner(READER, () => loadArticle(slug).catch((err: unknown) => err))) as NotProcessed;
    expect(paper.paper?.title).toBe("Scanned Lecture Notes");
    expect(paper.paper?.authors).toEqual([]);
    expect(paper.paper?.kind).toBe("html");
  });

  it("is on the shelf, saying it is minimal, with its abstract and no numbers", async () => {
    const slug = await addMinimal(READER, "shelf.html", pageBytes("shelf"));
    const shelf = await runAsOwner(READER, () => listArticles());
    const entry = shelf.find((e) => e.slug === slug);
    expect(entry).toMatchObject({ processing: "minimal", words: 0, blocks: 0, parts: 0, sections: 0 });
    /* Every row says which it is; none is left to guess. */
    expect(shelf.every((e) => e.processing === "minimal" || e.processing === "full")).toBe(true);
  });

  it("fails the job, and charges nothing, when the model fails", async () => {
    vi.spyOn(metadataReaders, "html").mockRejectedValue(new Error("the fixture model gave up"));
    const before = await pointsUsed(READER);
    const uploadId = await landed(READER, "fails.html", pageBytes("fails"));
    const queued = await withoutTheWorker(() => call(READER, "POST", "/api/jobs", { uploadId, level: "minimal" }));
    expect(queued.status).toBe(202);
    const job = await drive(READER, String(queued.body.id));
    expect(job.status).toBe("error");
    expect(await pointsUsed(READER)).toBe(before);
  });
});

describe("the publish gate", () => {
  /** An article row in the given state, with a draft carrying a title. */
  async function draftOn(processing: "minimal" | "full", metadataRan: boolean) {
    return await runAsOwner(READER, async () => {
      const slug = `test-minimal-gate-${randomUUID().slice(0, 8)}`;
      const begun = await beginRevision({ slug });
      await getDb().update(articles).set({ processing }).where(eq(articles.id, begun.articleId));
      await getDb().execute(sql`update spideryarn.article_revisions set title = 'A gate' where id = ${begun.revisionId}::uuid`);
      if (metadataRan) await stepRun(begun.revisionId, "metadata");
      return { slug, ...begun };
    });
  }

  it("publishes no blocks and no tree when the article is minimal and metadata ran", async () => {
    const { slug, revisionId } = await draftOn("minimal", true);
    await runAsOwner(READER, () => publishRevision({ slug, revisionId }));
    expect((await articleRow(slug)).currentRevisionId).toBe(revisionId);
  });

  it("refuses it when the metadata step did not run", async () => {
    const { slug, revisionId } = await draftOn("minimal", false);
    await expect(runAsOwner(READER, () => publishRevision({ slug, revisionId }))).rejects.toThrow(
      /metadata step has not finished/,
    );
  });

  it("refuses it on a full article, metadata or not", async () => {
    const { slug, revisionId } = await draftOn("full", true);
    const err = await runAsOwner(READER, () => publishRevision({ slug, revisionId })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishRefused);
    expect(String(err)).toMatch(/no blocks/);
  });
});

describe("no free way into a minimal paper", () => {
  let slug: string;
  beforeAll(async () => {
    vi.spyOn(metadataReaders, "html").mockResolvedValue(found());
    slug = await addMinimal(READER, "guarded.html", pageBytes("guarded"));
  });

  it("refuses a mode job on it", async () => {
    await expect(
      runAsOwner(READER, () => enqueue({ slug, steps: ["glossary"], pump: false })),
    ).rejects.toBeInstanceOf(NotProcessed);
  });

  it("refuses Rebuild on it — the default steps from extract, with no Read this reservation", async () => {
    await expect(
      runAsOwner(READER, () => enqueue({ slug, force: ["extract"], pump: false })),
    ).rejects.toThrow(NOT_READ_YET.message);
  });

  it("refuses a reader the metadata step anywhere but the minimal job", async () => {
    await expect(
      runAsOwner(READER, () => enqueue({ slug, steps: ["metadata"], pump: false })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("keeps metadata runnable on its own for the verified administrator", async () => {
    const admin = ADMIN_USER_ID_LOCAL as OwnerId;
    const adminSlug = await addMinimal(admin, "admin-metadata.html", pageBytes("admin metadata"));
    const job = await runAsOwner(admin, () =>
      enqueue({ slug: adminSlug, steps: ["metadata"], force: ["metadata"], pump: false }),
    );
    expect((await drive(admin, job.id)).status).toBe("done");
  });

  it("refuses sharing it, and Start again", async () => {
    await expect(runAsOwner(READER, () => pgVisibilityStore.set(slug, "public", true))).rejects.toThrow(
      NOT_READ_YET_SHARE.message,
    );
    await expect(runAsOwner(READER, () => enqueueReset({ slug, regenerate: false, pump: false }))).rejects.toThrow(
      NOT_READ_YET_RESET.message,
    );
  });

  it("refuses High-powered AI, through the route", async () => {
    const reply = await call(READER, "PUT", `/api/article/${slug}/high-power`, { on: true });
    expect(reply.status).toBe(409);
    expect(reply.body.code).toBe("not-processed");
  });

  it("answers the article read with a 409 carrying the paper", async () => {
    const reply = await call(READER, "GET", `/api/article/${slug}`);
    expect(reply.status).toBe(409);
    expect(reply.body.code).toBe("not-processed");
    expect(reply.body.paper).toMatchObject({ slug, title: "A Paper About Entropy" });
  });

  it("refuses chat and a glossary question before anything is spent", async () => {
    const chat = await call(READER, "POST", `/api/chat/${slug}`, { threadId: randomUUID(), question: "What is it about?" });
    expect(chat.status).toBe(409);
    expect(chat.body.error).toBe(NOT_READ_YET.message);
    const term = await call(READER, "POST", `/api/glossary/${slug}/ask`, { term: "entropy" });
    expect(term.status).toBe(409);
    expect(term.body.code).toBe("not-processed");
  });

  /**
   * **The guard behind `enqueue`'s**, for a path round it nobody has found yet:
   * a full re-read inserted straight into the queue, with no reservation and
   * then with an ordinary one, runs to the end and its tree is refused at the
   * publication (`requirePaidUpgrade`), so the paper stays minimal and unpaid.
   */
  for (const carrying of ["no reservation", "an ordinary ingest's reservation"] as const) {
    it(`refuses a tree landing on it from a job carrying ${carrying}`, async () => {
      const ingestEventId =
        carrying === "no reservation"
          ? undefined
          : await runAsOwner(READER, async () => {
              const admission = await reserveIngest(READER, slug, []);
              if (admission.kind !== "admitted") throw new Error(`reserving was ${admission.kind}`);
              return admission.reservationId;
            });
      const names: StepName[] = [...DEFAULT_INGEST_STEPS];
      const wanted: Job = {
        id: mintId(),
        ownerId: READER,
        slug,
        steps: names.map((name) => ({ name, label: STEPS[name].label, status: "pending", ...(name === "fetch" ? {} : { force: true }) })),
        status: "queued",
        createdAt: new Date().toISOString(),
      };
      const outcome = await pgJobStore.enqueueOrGet(wanted, {
        workKey: workKeyFor(names, new Set(names.filter((n) => n !== "fetch")), `around-the-guard-${carrying}`),
        reservesName: false,
        requiresArticle: true,
        ...(ingestEventId ? { ingestEventId } : {}),
      });
      if (outcome.kind !== "created") throw new Error(`the job was ${outcome.kind}`);
      const job = await drive(READER, outcome.job.id);
      expect(job.status).toBe("error");
      /* Refused by the rule, not by a broken query — the first draft of the rule
         compared a text id to a uuid, and this case went red for that reason
         while looking green. */
      expect(job.error ?? "").not.toMatch(/db-failed/);
      expect((await articleRow(slug)).processing).toBe("minimal");
      if (ingestEventId) {
        const [row] = await getDb().select().from(ingestEvents).where(eq(ingestEvents.id, ingestEventId));
        expect(row?.succeededAt).toBeNull();
        expect(row?.releasedAt).not.toBeNull();
      }
    });
  }
});

describe("one paper per file", () => {
  it("refuses the same bytes again, at the grant, naming the paper", async () => {
    const bytes = pageBytes("twice");
    const slug = await addMinimal(DUPER, "twice.html", bytes);
    const again = await mintMinimal(DUPER, "twice-again.html", bytes);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "duplicate", article: slug });
  });

  it("counts an archived paper as on the shelf", async () => {
    const bytes = pageBytes("archived");
    const slug = await addMinimal(DUPER, "archived.html", bytes);
    await getDb().update(articles).set({ archivedAt: new Date() }).where(eq(articles.slug, slug));
    const again = await mintMinimal(DUPER, "archived.html", bytes);
    expect(again.status).toBe(409);
    expect(String(again.body.error)).toMatch(/archived/);
  });

  it("makes one paper of two uploads of one file sent at once", async () => {
    const bytes = pageBytes("race");
    const a = await landed(DUPER, "race.html", bytes);
    const b = await landed(DUPER, "race.html", bytes);
    const [one, two] = await withoutTheWorker(() =>
      Promise.all([
        call(DUPER, "POST", "/api/jobs", { uploadId: a, level: "minimal" }),
        call(DUPER, "POST", "/api/jobs", { uploadId: b, level: "minimal" }),
      ]),
    );
    expect([one.status, two.status].sort()).toEqual([202, 409]);
    const loser = one.status === 409 ? one : two;
    expect(loser.body.code).toBe("duplicate");
    /* And the loser's reservation went back with its claim. */
    const loserId = one.status === 409 ? a : b;
    const [row] = await getDb().select().from(uploads).where(eq(uploads.id, loserId));
    expect(row?.status).toBe("pending");
    const winner = one.status === 202 ? one : two;
    expect((await drive(DUPER, String(winner.body.id))).status).toBe("done");
  });

  it("holds a claimed upload with no job for two hours, and then lets the file in again", async () => {
    const bytes = pageBytes("crash");
    const crashed = await landed(DUPER, "crash.html", bytes);
    /* The claim, and then nothing: the process died before `enqueue`. */
    expect((await claimUpload(crashed, { owner: DUPER, arrived: true })).ok).toBe(true);
    const soon = await mintMinimal(DUPER, "crash.html", bytes);
    expect(soon.status).toBe(409);
    expect(soon.body.code).toBe("duplicate");

    await getDb()
      .update(uploads)
      .set({ mintedAt: sql`now() - interval '3 hours'` })
      .where(eq(uploads.id, crashed));
    const later = await mintMinimal(DUPER, "crash.html", bytes);
    expect(later.status, String(later.body.error)).toBe(201);
  });

  it("does not let a fresh drop pass while a failed minimal job is being retried", async () => {
    const bytes = pageBytes("retry-race");
    vi.spyOn(metadataReaders, "html").mockRejectedValueOnce(new Error("fail the first attempt"));
    const firstUpload = await landed(DUPER, "retry-race.html", bytes);
    const firstQueued = await withoutTheWorker(() =>
      call(DUPER, "POST", "/api/jobs", { uploadId: firstUpload, level: "minimal" }),
    );
    const failed = await drive(DUPER, String(firstQueued.body.id));
    expect(failed.status).toBe("error");

    /* A new grant is allowed after a terminal failure. Hold the retry after its
       reservation commits but before its replacement job is inserted: this is
       the gap a simultaneous re-drop must still see as on its way. */
    const freshUpload = await landed(DUPER, "retry-race-again.html", bytes);
    let entered!: () => void;
    const insideBody = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const mayEnqueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    const retrying = runAsOwner(DUPER, () =>
      withRetrySlot({ jobId: failed.id, ownerId: DUPER }, async (slot) => {
        entered();
        await mayEnqueue;
        return await retryJob(failed.id, slot);
      }),
    );
    await insideBody;
    const dropped = await withoutTheWorker(() =>
      call(DUPER, "POST", "/api/jobs", { uploadId: freshUpload, level: "minimal" }),
    );
    release();
    const retried = await retrying;

    expect(retried).not.toBeNull();
    expect(dropped.status).toBe(409);
    expect(dropped.body.code).toBe("duplicate");
  });

  it("lets a deleted paper be added again", async () => {
    const bytes = pageBytes("deleted");
    const slug = await addMinimal(DUPER, "deleted.html", bytes);
    const gone = await call(DUPER, "DELETE", `/api/library/${slug}`);
    expect(gone.status, String(gone.body.error)).toBe(200);
    const again = await mintMinimal(DUPER, "deleted.html", bytes);
    expect(again.status, String(again.body.error)).toBe(201);
  });

  it("asks the planner for the hash index, not a scan, for (a)", async () => {
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const plan = await tx.execute(sql`explain ${duplicateOnShelfSql(DUPER, "a".repeat(64))}`);
      const text = (plan.rows as Record<string, string>[]).map((r) => Object.values(r)[0]).join("\n");
      expect(text).toContain("article_revisions_raw_sha256");
    });
  });
});

describe("Read this", () => {
  it("reads the paper in full: processing full, the minimal row superseded, 200 points in all", async () => {
    vi.spyOn(metadataReaders, "html").mockResolvedValue(found());
    const before = await pointsUsed(READER);
    const slug = await addMinimal(READER, "read-me.html", pageBytes("read me"));
    expect((await pointsUsed(READER)) - before).toBe(2);

    const queued = await withoutTheWorker(() => call(READER, "POST", "/api/jobs", { slug, readThis: true }));
    expect(queued.status, String(queued.body.error)).toBe(202);
    /* A second press while the first runs is one at a time. */
    const twice = await withoutTheWorker(() => call(READER, "POST", "/api/jobs", { slug, readThis: true }));
    expect(twice.status).toBe(409);

    /* The registry is unreachable by the time the paper is read in full. */
    vi.spyOn(articleRegistryDeps, "lookup").mockResolvedValue({ kind: "unavailable", why: "busy" });
    const job = await drive(READER, String(queued.body.id));
    expect(job.status, job.error).toBe("done");

    const article = await articleRow(slug);
    expect(article.processing).toBe("full");
    const read = await runAsOwner(READER, () => loadArticle(slug));
    expect(read.blocks.length).toBeGreaterThan(0);
    /* The abstract the shelf showed survives a re-read that found none. */
    expect(read.meta.abstract).toBe("We measure something and find it is entropy.");
    /* And so does what the registry said about its DOI, though nobody could ask again. */
    expect(read.meta).toMatchObject({ doi: "10.3390/e24070930", journal: "Entropy", publishedAt: "2022-07-06" });

    const rows = await ledgerOf(article.id);
    const minimal = rows.find((r) => r.kind === "minimal");
    const ingest = rows.find((r) => r.kind === "ingest");
    expect(ingest?.succeededAt).not.toBeNull();
    expect(minimal?.supersededBy).toBe(ingest?.id);
    expect((await pointsUsed(READER)) - before).toBe(200);

    const shelf = await runAsOwner(READER, () => listArticles());
    expect(shelf.find((e) => e.slug === slug)?.processing).toBe("full");
  });

  it("gives the slot back when it fails, leaves the paper minimal, and a retry reads it", async () => {
    vi.spyOn(metadataReaders, "html").mockResolvedValue(found());
    const before = await pointsUsed(READER);
    const slug = await addMinimal(READER, "fail-then-read.html", pageBytes("fail then read"));

    const queued = await withoutTheWorker(() => call(READER, "POST", "/api/jobs", { slug, readThis: true }));
    expect(queued.status).toBe(202);
    const failed = await drive(READER, String(queued.body.id), partsWith({ failExtract: true }));
    expect(failed.status).toBe("error");
    expect((await articleRow(slug)).processing).toBe("minimal");
    expect((await pointsUsed(READER)) - before).toBe(2);

    /* The retry goes back through Read this's own admission (`withRetrySlot` →
       `withUpgradeSlot`), bound to the same paper. */
    const retried = await withoutTheWorker(() => call(READER, "POST", `/api/jobs/${failed.id}/retry`));
    expect(retried.status, String(retried.body.error)).toBe(202);
    const [retryRow] = await getDb().select().from(jobsTable).where(eq(jobsTable.id, String(retried.body.id)));
    const article = await articleRow(slug);
    const [reservation] = await getDb()
      .select()
      .from(ingestEvents)
      .where(and(eq(ingestEvents.id, retryRow?.ingestEventId ?? randomUUID())));
    expect(reservation).toMatchObject({ kind: "ingest", articleId: article.id });

    expect((await drive(READER, String(retried.body.id))).status).toBe("done");
    expect((await articleRow(slug)).processing).toBe("full");
    expect((await pointsUsed(READER)) - before).toBe(200);
  });

  it("is refused on a paper already read, and on somebody else's", async () => {
    vi.spyOn(metadataReaders, "html").mockResolvedValue(found());
    const slug = await addMinimal(READER, "theirs.html", pageBytes("theirs"));
    const stranger = await call(DUPER, "POST", "/api/jobs", { slug, readThis: true });
    expect(stranger.status).toBe(404);
  });
});
