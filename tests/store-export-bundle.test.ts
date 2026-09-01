/**
 * **The reader's download must not inherit the rollback's losses, and must not
 * touch the bucket.**
 *
 * `src/store/export.ts` and `src/store/export-bundle.ts` are two projections of
 * one article and they share only the query walk. The first is the rollback, and
 * its output is pinned byte for byte by `tests/store-roundtrip.test.ts` against
 * what the filesystem store writes — so it is *deliberately* lossy in three ways
 * that nothing can fix in place:
 *
 * - a `candidates` chat thread is written as `chat`;
 * - `passages` and `interrupted` are dropped from every message;
 * - `extractedHtml` is never written at all.
 *
 * Each of those is a whole feature quietly missing from a file somebody
 * downloaded to keep, and each looks fine: the zip opens, the JSON parses, the
 * thread is there. So every one gets a test here, and each is written as a
 * **contrast** — the bundle keeps it, the rollback does not — because the claim
 * that matters is that the two differ on purpose. If you deliberately fix the
 * rollback (which means changing what `store-roundtrip` compares), delete the
 * rollback half of the pair rather than the whole test.
 *
 * ## And it never reads the bucket
 *
 * No image bytes and no original document, so `articleBundle` has no reason to
 * reach Supabase Storage — which is what keeps the future route a plain
 * owner-scoped database read. That is a stronger claim than "it writes no bytes":
 * `writeRawDocument` in export.ts calls `readRawDocument` *before* it writes, so
 * a sink that discarded the bytes would still have paid for the fetch. The test
 * below makes both store constructors — `blobStore()` and `postgresBlobStore()`,
 * which is every sanctioned way to get one — hand back a store that refuses, and
 * proves the trap is armed by watching the rollback fall into it.
 *
 * docs/plans/260901h-export-article-data.md § Stage B, Stage C.
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import type { RawSourceStore } from "../src/store/blobs.js";
import {
  BUNDLE_BYTE_CAP,
  BUNDLE_FORMAT,
  articleBundle,
  overBundleCap,
} from "../src/store/export-bundle.js";
import { exportArticle } from "../src/store/export.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/**
 * A blob store that refuses everything, and the mock that installs it as the
 * one every caller in this process gets.
 *
 * `vi.hoisted` because `vi.mock`'s factory is hoisted above the imports and
 * cannot close over an ordinary `const`. Spreading the real module keeps every
 * other export intact, so only the two constructors change: a module that
 * imports `blobStore()` or `postgresBlobStore()` — as export.ts does, and as the
 * bundle must never start doing — gets this.
 */
const { refusingStore, BUCKET_TOUCHED } = vi.hoisted(() => {
  const BUCKET_TOUCHED = "blob store touched: this code path must not read the bucket";
  const refuse = () => {
    throw new Error(BUCKET_TOUCHED);
  };
  return {
    BUCKET_TOUCHED,
    refusingStore: { head: refuse, get: refuse, putIfAbsent: refuse, remove: refuse },
  };
});

vi.mock("../src/store/blobs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/store/blobs.js")>();
  return { ...actual, blobStore: () => refusingStore, postgresBlobStore: () => refusingStore };
});

const SLUG = "store-export-bundle-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-00000000b0d1";
const REVISION_ID = "00000000-0000-4000-8000-00000000b0d2";
/** Three blocks, deliberately inserted out of order — see the ordering test. */
const BLOCKS = ["spya-bnd234", "spya-bne234", "spya-bnf234"] as const;
/**
 * A block id the article no longer has, with a comment still anchored to it.
 *
 * The reason `content/block-identities.json` is not optional: without it the
 * zip holds an anchor pointing at nothing and an importer cannot tell a comment
 * on since-removed text from a corrupted one.
 */
const DEPARTED_BLOCK = "spya-bng234";
const THREAD_ID = "spya-bnt234";
const MESSAGE_ID = "spya-bnu234";
const COMMENT_ID = "spya-bnm234";

/** The second fixture, for the bucket half — see that describe. */
const NO_BUCKET_SLUG = "store-export-bundle-nobucket";
const NO_BUCKET_ARTICLE_ID = "00000000-0000-4000-8000-00000000b0d3";
const NO_BUCKET_REVISION_ID = "00000000-0000-4000-8000-00000000b0d4";

const EXTRACTED = "<article><p>before the ids were stamped on</p></article>";
const STAMPED = `<article><p data-spya-id="${BLOCKS[0]}">before the ids were stamped on</p></article>`;
const PASSAGES = [{ blockIds: [BLOCKS[0]], why: "the passage the answer came from" }];

/* A real source document, so the rollback's `readRawDocument` actually reaches
   for the bucket — which is what makes the control below bite. The hash has to
   match the bytes or it throws `CorruptRawObject` instead. */
const RAW_BYTES = new TextEncoder().encode("<html><body>the page as fetched</body></html>");
const RAW_SHA256 = createHash("sha256").update(RAW_BYTES).digest("hex");

/** A store that answers, for the runs that are about something else. */
const workingStore: RawSourceStore = {
  head: async () => ({ bytes: RAW_BYTES.byteLength, contentType: "text/html" }),
  get: async () => RAW_BYTES,
  putIfAbsent: async () => {
    throw new Error("the export never writes");
  },
  remove: async () => {
    throw new Error("the export never removes");
  },
};

const owner = () => currentOwnerId();

const { reachable } = await pgReady({
  suite: "tests/store-export-bundle.test.ts",
  tables: ["spideryarn.chat_messages", "spideryarn.block_identities", "spideryarn.raw_sources"],
  columns: [
    { table: "spideryarn.chat_messages", column: "passages" },
    { table: "spideryarn.chat_messages", column: "interrupted" },
  ],
});

const when = reachable ? describe : describe.skip;

when("the bundle is the faithful projection", () => {
  /** Every entry of the zip, decoded. */
  let bundled: Map<string, string>;
  let byteLength: number;
  let entryCount: number;
  /** `data/<slug>/` from the same rows, for the contrast. */
  let out: string;

  const parsed = (name: string): Record<string, unknown> => {
    const text = bundled.get(name);
    if (text === undefined) throw new Error(`the bundle has no ${name}`);
    return JSON.parse(text) as Record<string, unknown>;
  };

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(schema.rawSources)
      .values({
        sha256: RAW_SHA256,
        kind: "html",
        bytes: RAW_BYTES.byteLength,
        contentType: "text/html",
        verifiedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(schema.articles)
      .values({
        id: ARTICLE_ID,
        ownerId: owner(),
        slug: SLUG,
        shortId: "spya-bns234",
        purpose: "to check the export keeps what the rollback drops",
        opens: 3,
        visibility: "public",
        publicAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(schema.articleRevisions)
      .values({
        id: REVISION_ID,
        articleId: ARTICLE_ID,
        status: "published",
        title: "The article the bundle is built from",
        finalUrl: "https://example.test/bundle",
        extractedHtml: EXTRACTED,
        stampedHtml: STAMPED,
        /* A minimal but *valid* `Tree`, since the column is typed. The bundle
           writes this column verbatim, so its content matters only in that it
           has to be there. */
        tree: {
          version: "1",
          generator: "fixture",
          slug: SLUG,
          rootId: "n0",
          nodes: {
            n0: {
              id: "n0",
              depth: 0,
              parent: null,
              children: [],
              range: [BLOCKS[0], BLOCKS[2]],
              title: "the whole article",
              gist: "what the piece says",
            },
          },
        },
        rawSourceSha256: RAW_SHA256,
        rawSourceKind: "html",
      })
      .onConflictDoNothing();
    await db
      .update(schema.articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(schema.articles.id, ARTICLE_ID));

    for (const blockId of [...BLOCKS, DEPARTED_BLOCK]) {
      await db
        .insert(schema.blockIdentities)
        .values({ articleId: ARTICLE_ID, blockId })
        .onConflictDoNothing();
    }
    /* **Inserted 2, 0, 1.** Ids are random and carry no position, so a projection
       that lost the `order by ordinal` would produce a shuffled article that
       still validates — and Postgres will happily hand back insertion order, so
       the scramble is what makes the ordering test able to fail at all. */
    for (const ordinal of [2, 0, 1]) {
      const blockId = BLOCKS[ordinal];
      if (!blockId) throw new Error("fixture: no block for that ordinal");
      await db.insert(schema.revisionBlocks).values({
        articleId: ARTICLE_ID,
        revisionId: REVISION_ID,
        blockId,
        ordinal,
        tag: "p",
        kind: "text",
        text: `paragraph ${ordinal}`,
        words: 2,
        html: `<p>paragraph ${ordinal}</p>`,
        gistable: true,
      });
    }

    /* A Candidates thread, which the rollback writes out as an ordinary chat. */
    await db.insert(schema.chatThreads).values({
      articleId: ARTICLE_ID,
      id: THREAD_ID,
      ownerId: owner(),
      /* Not "candidate passages": the rollback keeps thread titles, and the
         test below asserts the word `passages` appears nowhere in its file. */
      title: "the shortlist",
      kind: "candidates",
    });
    await db.insert(schema.chatMessages).values({
      articleId: ARTICLE_ID,
      threadId: THREAD_ID,
      id: MESSAGE_ID,
      ordinal: 0,
      role: "assistant",
      text: "the answer the reader talked over",
      status: "done",
      passages: PASSAGES,
      interrupted: true,
    });
    /* Anchored to a block that is no longer in the revision. */
    await db.insert(schema.comments).values({
      articleId: ARTICLE_ID,
      id: COMMENT_ID,
      ownerId: owner(),
      blockId: DEPARTED_BLOCK,
      quote: "a stretch of prose that has since gone",
      start: 0,
      body: "still worth keeping",
      status: "none",
    });

    const bundle = await articleBundle(SLUG);
    byteLength = bundle.byteLength;
    entryCount = bundle.entries.length;
    const decoder = new TextDecoder();
    bundled = new Map(
      Object.entries(unzipSync(bundle.bytes)).map(([name, bytes]) => [
        name,
        decoder.decode(bytes),
      ]),
    );

    out = await mkdtemp(path.join(tmpdir(), "spideryarn-bundle-contrast-"));
    await exportArticle(SLUG, { dataRoot: out, outputRoot: path.join(out, "output") }, workingStore);
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(schema.comments).where(eq(schema.comments.articleId, ARTICLE_ID));
    await db.delete(schema.chatMessages).where(eq(schema.chatMessages.articleId, ARTICLE_ID));
    await db.delete(schema.chatThreads).where(eq(schema.chatThreads.articleId, ARTICLE_ID));
    await db.delete(schema.revisionBlocks).where(eq(schema.revisionBlocks.articleId, ARTICLE_ID));
    await db
      .update(schema.articles)
      .set({ currentRevisionId: null })
      .where(eq(schema.articles.id, ARTICLE_ID));
    await db.delete(schema.articleRevisions).where(eq(schema.articleRevisions.id, REVISION_ID));
    await db
      .delete(schema.blockIdentities)
      .where(eq(schema.blockIdentities.articleId, ARTICLE_ID));
    await db.delete(schema.articles).where(eq(schema.articles.id, ARTICLE_ID));
    /* `raw_sources` is left alone: nothing in the schema deletes those rows —
       see the table's own note — and another article may reference this hash. */
    await closeDb();
    if (out) await rm(out, { recursive: true, force: true });
  });

  /* ------------------------------------------------------------- the layout -- */

  it("writes a manifest naming the format, every entry and what it left out", () => {
    const manifest = parsed("manifest.json");
    expect(manifest.format).toBe(BUNDLE_FORMAT);
    expect(manifest.slug).toBe(SLUG);
    expect(manifest.url).toBe("https://example.test/bundle");

    const entries = manifest.entries as { path: string; bytes: number }[];
    /* Every file in the zip is listed, and every listed file is in the zip — a
       list that drifts from the archive is worse than no list. Everything but
       `manifest.json` itself, which cannot state its own size without changing
       it; the README says so. */
    const listed = new Set([...entries.map((e) => e.path), "manifest.json"]);
    expect(listed).toEqual(new Set(bundled.keys()));
    expect(entries.every((e) => e.bytes > 0)).toBe(true);

    /* Machine-readable, so an importer checks what it is missing rather than
       inferring it from absent files. The four pipeline tables and Greg's three
       content omissions are all named. */
    const omitted = manifest.omitted as { kind: string; what: string; why: string }[];
    const named = new Set(omitted.map((o) => o.what));
    for (const expected of ["checkpoints", "jobs", "ai_calls", "image-bytes"]) {
      expect(named, `manifest.omitted says nothing about ${expected}`).toContain(expected);
    }
    expect(omitted.every((o) => o.why.length > 40)).toBe(true);
  });

  it("carries the shelf and sharing state the rollback has nowhere to put", async () => {
    const article = parsed("article.json");
    expect(article.purpose).toBe("to check the export keeps what the rollback drops");
    expect(article.opens).toBe(3);
    /* `visibility`, `publicAt` and `shortId` reach no file the rollback writes:
       `data/` has no public sharing at all, so `shelf.json` has nowhere to put
       them. This is the fourth loss found in the audit, and unlike the three
       above it is a difference of scope rather than of shape. */
    expect(article.visibility).toBe("public");
    expect(article.publicAt).toEqual(expect.any(String));
    expect(article.shortId).toBe("spya-bns234");
    const shelf = await readFile(path.join(out, SLUG, "shelf.json"), "utf8");
    expect(shelf).not.toContain("visibility");
    /* And nothing of ours rides along: `ownerId` is an auth uuid that says
       nothing about the article. */
    expect(bundled.get("article.json")).not.toContain(owner());
  });

  it("leaves out a file with nothing in it, and keeps the README", () => {
    expect(bundled.has("README.md")).toBe(true);
    expect(bundled.get("README.md")).toContain("The block id contract");
    expect(bundled.has("augmentations/tree.json")).toBe(true);
    // No glossary was ever generated for this article, so there is no file.
    expect(bundled.has("augmentations/glossary.json")).toBe(false);
    expect(bundled.has("augmentations/searches.json")).toBe(false);
  });

  /* ------------------------------------------------- the three known losses -- */

  it("keeps a Candidates thread's kind, where the rollback flattens it to chat", async () => {
    const threads = parsed("augmentations/chat.json").threads as { kind: string }[];
    expect(threads[0]?.kind).toBe("candidates");

    /* The contrast. `export.ts` maps anything that is not `remember` to `chat`,
       because store-roundtrip compares its bytes against a file the filesystem
       store wrote — so a reader's Candidates thread comes back as an ordinary
       chat, silently. */
    const rollback = JSON.parse(await readFile(path.join(out, SLUG, "chat.json"), "utf8")) as {
      threads: { kind: string }[];
    };
    expect(rollback.threads[0]?.kind).toBe("chat");
  });

  it("keeps passages and interrupted on a message, which the rollback drops", async () => {
    const threads = parsed("augmentations/chat.json").threads as {
      messages: Record<string, unknown>[];
    }[];
    const message = threads[0]?.messages[0];
    expect(message?.passages).toEqual(PASSAGES);
    expect(message?.interrupted).toBe(true);

    const rollbackText = await readFile(path.join(out, SLUG, "chat.json"), "utf8");
    expect(rollbackText).not.toContain("passages");
    expect(rollbackText).not.toContain("interrupted");
  });

  it("writes content/extracted.html, which the rollback never writes at all", async () => {
    expect(bundled.get("content/extracted.html")).toBe(EXTRACTED);
    expect(bundled.get("content/stamped.html")).toBe(STAMPED);

    /* The rollback writes the stamped HTML to `output/<slug>.html` and the
       extracted HTML nowhere: `grep extractedHtml src/store/export.ts` returns
       nothing. Checked over every file it wrote rather than over one name, since
       the claim is that there is no such file anywhere in it. */
    const files = await Promise.all(
      ["meta.json", "blocks.json", "raw.html", "raw.json"].map((name) =>
        readFile(path.join(out, SLUG, name), "utf8").catch(() => ""),
      ),
    );
    expect(files.some((text) => text.includes("before the ids were stamped on"))).toBe(false);
  });

  /* -------------------------------------------------- ids, order and anchors -- */

  it("writes blocks in document order, not in the order Postgres holds them", () => {
    const blocks = parsed("content/blocks.json").blocks as { blockId: string; ordinal: number }[];
    expect(blocks.map((b) => b.blockId)).toEqual([...BLOCKS]);
    expect(blocks.map((b) => b.ordinal)).toEqual([0, 1, 2]);
  });

  it("always writes block-identities.json, including ids no block has any more", () => {
    const identities = parsed("content/block-identities.json").identities as {
      blockId: string;
    }[];
    const ids = identities.map((row) => row.blockId);
    expect(ids).toContain(DEPARTED_BLOCK);
    /* The point of it: the comment below anchors to an id the current revision
       does not contain, so without this file the zip holds an anchor pointing at
       nothing. */
    const comments = parsed("augmentations/comments.json").comments as { blockId: string }[];
    expect(comments[0]?.blockId).toBe(DEPARTED_BLOCK);
    expect(ids).not.toContain("spya-nobody");
  });

  /* --------------------------------------------------------------- the size -- */

  it("reports its own size against the cap the platform imposes", () => {
    expect(byteLength).toBeGreaterThan(0);
    expect(entryCount).toBe(bundled.size);
    /* A fixture article is nowhere near 4.5 MB; the assertion is that the number
       is real and the caller can compare it, since a warning log would not help —
       the reader's request still fails. */
    expect(byteLength).toBeLessThan(BUNDLE_BYTE_CAP);
  });
});

/* ------------------------------------------------------------ the bucket -- */

when("the bundle never reads the blob store", () => {
  /* Its own fixture rather than the one above, because the article has to name
     a source document for the control to have anything to fetch — and this
     describe deliberately runs with every blob store refusing. */
  let out: string;

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(schema.rawSources)
      .values({
        sha256: RAW_SHA256,
        kind: "html",
        bytes: RAW_BYTES.byteLength,
        contentType: "text/html",
        verifiedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(schema.articles)
      .values({ id: NO_BUCKET_ARTICLE_ID, ownerId: owner(), slug: NO_BUCKET_SLUG })
      .onConflictDoNothing();
    await db
      .insert(schema.articleRevisions)
      .values({
        id: NO_BUCKET_REVISION_ID,
        articleId: NO_BUCKET_ARTICLE_ID,
        status: "published",
        title: "an article whose source document is in the bucket",
        stampedHtml: "<article><p>prose</p></article>",
        rawSourceSha256: RAW_SHA256,
        rawSourceKind: "html",
      })
      .onConflictDoNothing();
    await db
      .update(schema.articles)
      .set({ currentRevisionId: NO_BUCKET_REVISION_ID })
      .where(eq(schema.articles.id, NO_BUCKET_ARTICLE_ID));
    out = await mkdtemp(path.join(tmpdir(), "spideryarn-bundle-nobucket-"));
  });

  afterAll(async () => {
    const db = getDb();
    await db
      .update(schema.articles)
      .set({ currentRevisionId: null })
      .where(eq(schema.articles.id, NO_BUCKET_ARTICLE_ID));
    await db
      .delete(schema.articleRevisions)
      .where(eq(schema.articleRevisions.id, NO_BUCKET_REVISION_ID));
    await db.delete(schema.articles).where(eq(schema.articles.id, NO_BUCKET_ARTICLE_ID));
    await closeDb();
    if (out) await rm(out, { recursive: true, force: true });
  });

  it("the trap is armed: the rollback falls into it", async () => {
    /* **The positive control, and without it the test below is worthless** — a
       bundle that succeeds against a store nobody would have called proves
       nothing (docs/reusable/silent-success.md). This is the same article, the
       same process, the same mocked module, and no store passed in: exportArticle
       takes `postgresBlobStore()` by default, and that is now the refusing one.
       `writeRawDocument` reads before it writes, which is the trap. */
    await expect(
      exportArticle(NO_BUCKET_SLUG, { dataRoot: out, outputRoot: path.join(out, "output") }),
    ).rejects.toThrow(BUCKET_TOUCHED);
  });

  it("builds the whole zip without one", async () => {
    const bundle = await articleBundle(NO_BUCKET_SLUG);
    expect(bundle.entries.length).toBeGreaterThan(3);
    const names = Object.keys(unzipSync(bundle.bytes));
    expect(names).toContain("content/stamped.html");
    /* And it names the source document nowhere, since it never asked for it. */
    expect(names).not.toContain("content/raw.html");
  });
});

/**
 * The cap itself, with no database — the one part of the size story that can be
 * watched going both ways without a five-megabyte fixture.
 *
 * `overCap` on a real bundle has never been true in a test, and cannot be
 * without one; this is what stands in for it, and it is why the comparison is a
 * named function rather than a `>` written once in the builder and again in the
 * route.
 */
describe("the size cap", () => {
  it("is the buffered-response limit, and is exclusive at the boundary", () => {
    expect(BUNDLE_BYTE_CAP).toBe(4_500_000);
    expect(overBundleCap(BUNDLE_BYTE_CAP - 1)).toBe(false);
    // Exactly at the cap still fits: the platform's limit is what a response may
    // not exceed.
    expect(overBundleCap(BUNDLE_BYTE_CAP)).toBe(false);
    expect(overBundleCap(BUNDLE_BYTE_CAP + 1)).toBe(true);
  });
});
