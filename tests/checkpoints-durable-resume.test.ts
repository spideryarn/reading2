/**
 * **A retry on another machine must not re-pay for the chunks the last attempt
 * finished** — the liveness property landing D2 exists for, measured against a
 * real Postgres store and the real stages.
 *
 * ## This is not a saving, it is whether a long PDF can finish at all
 *
 * `MAX_PAGES` is 100 and `planChunks` will make a one-page chunk out of a dense
 * enough page, so a hundred pages can be a hundred chunks. `CHUNK_CONCURRENCY`
 * does the arithmetic in its own comment: `ceil(100/8) × 45s = 585s` against a
 * 740s step deadline, which has margin at the *mean* call duration and would
 * still fail at a bad enough p95.
 *
 * Until 2026-09-01 the finished chunks were written to
 * `data/<slug>/pdf-chunks/`, which on Vercel is a job-scoped `/tmp`
 * (src/store/data-root.ts). **A retry is a new job id by design** — so it got a
 * new directory, on a different machine, and started from zero. It timed out
 * again, and offered a Retry that would do the same thing. An accepted PDF
 * could therefore fail for ever without ever accumulating enough completed work
 * to get under the deadline. That is "does not work in production", not a bill.
 * docs/plans/260901d-simpler-finish-sol.md § 4.
 *
 * So the first test here is shaped as **two attempts under two different job
 * ids over one article**, and it counts model calls. A test that asserted "a
 * row exists after the write" would pass with the lookup broken, because the
 * row does exist.
 *
 * ## The red, and it is the liveness failure rather than the plumbing
 *
 * | mutation | what fails, and with what |
 * |---|---|
 * | `createPgCheckpointStore` prefixes every key with a **per-store random scope** — which is exactly what a job-scoped `/tmp` directory was, since a new job builds a new store | *a second job over the same article does not re-read the chunks the first one finished*: **`expected 6 to be 1`**. The second attempt re-read all six chunks when it owed one. That is the shipped bug, in the one term that mattered, and it is the number this landing is about: 6 re-done before, 1 after. |
 * | `createPgCheckpointStore`'s `read` drops `eq(checkpoints.articleId, …)` | *a checkpoint written for one article is never served to another*: `expected 0 to be 2`. Article B paid nothing for a document it had never seen, because it was served article A's transcription of the same bytes. *does not serve one article's label batches to another* goes red with it. |
 * | `pgStoreSession` hands out `nullCheckpointStore()` instead of the real one | *the session hands a stage a store bound to its own article*: `expected 0 to be 1`, and the two PDF tests with it. This is the mutation that re-creates the three days the seam sat there with no caller. |
 * | `generateLabels` ignores `stored` and always calls the model | *resumes every label batch a previous job paid for, without a credential*: it throws `[ai-not-set-up]` out of `runBatch`, which is a real request being attempted. |
 *
 * Each was applied to the real source, the named test was watched failing, and
 * the mutation reverted. The first is the one to read.
 *
 * ## Why the store here is Postgres and not the in-memory fake
 *
 * tests/helpers/memory-checkpoints.ts is right for the stage tests, which ask
 * *does the caller stop paying*. This file asks *does the thing that survives a
 * new job and a new machine actually survive one*, and the only honest answer
 * to that comes from the table. It needs a database and migration 0028, and
 * says so out loud on stderr — same probe as tests/store-checkpoints.test.ts,
 * because a suite that skips in silence reads exactly like one that passed.
 */
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import type { Pass0, PdfRecord } from "../src/pdf.js";
import { pass0 } from "../src/pdf.js";
import { type PdfReader, planChunks, runPdfExtract } from "../src/pdf-read.js";
import {
  batchFingerprint,
  generateLabels,
  planBatches,
  renderOutline,
} from "../src/labels.js";
import type { CheckpointStore } from "../src/store/checkpoints.js";
import type { Block, Tree, TreeNode } from "../src/types.js";
import { failIfPostgresRequired, type MissingKind } from "./helpers/pg-ready.js";

const EASY = new URL("../evals/pdf/easy/source.pdf", import.meta.url);

/* --------------------------------------------------------------- the probe -- */

const { loadEnvLocal } = await import("../src/env.js");
loadEnvLocal();

let reachable = false;
let why = "DATABASE_URL is not set — run npm run db:start (docs/project/supabase-local.md)";
let kind: MissingKind = "no-url";
if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  kind = "migration";
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.checkpoints') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) {
      why =
        "there is no spideryarn.checkpoints table — migration 0028 has not been applied. " +
        "Run `npm run db:migrate` (read its Target: line first) and these will run.";
    }
  } catch (err) {
    reachable = false;
    kind = "unreachable";
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
}
if (!reachable) {
  process.stderr.write(
    `\n  ⚠ tests/checkpoints-durable-resume.test.ts is NOT RUNNING.\n` +
      `    These assertions have not executed: ${why}\n\n`,
  );
  failIfPostgresRequired("tests/checkpoints-durable-resume.test.ts", why, kind);
}
const when = reachable ? describe : describe.skip;

/* -------------------------------------------------------------- the reader -- */

/** The pages an instruction asks to be emitted, ignoring any context page. */
function askedPages(instruction: string): number[] {
  const all = [...instruction.matchAll(/\d+/g)].map(Number);
  return instruction.includes("included only so you can see") ? all.slice(1) : all;
}

/**
 * A reader that transcribes from the PDF's own text layer, **counts what it was
 * asked for**, and can be told to refuse a page.
 *
 * The count is the whole measurement: a resumed chunk costs nothing and a
 * re-bought one costs a vision-model call, and those are the only two things
 * this file is about.
 */
function countingReader(
  pass: Pass0,
  hooks: {
    refuse?: (pages: number[]) => boolean;
    /** Held before answering, so the test decides who finishes and in what order. */
    hold?: (pages: number[]) => Promise<void>;
    /** After a call has answered — the barrier below counts these. */
    onDone?: (pages: number[]) => void;
  } = {},
): PdfReader & { asked: number[][] } {
  const asked: number[][] = [];
  return {
    id: "test/counting",
    asked,
    async read(_pdf, instruction) {
      const pages = askedPages(instruction);
      asked.push(pages);
      await hooks.hold?.(pages);
      if (hooks.refuse?.(pages)) throw new Error(`refused pages ${pages.join(", ")}`);
      const records: PdfRecord[] = [];
      const wanted = new Set(pages);
      for (const page of pass.pages) {
        if (!wanted.has(page.page)) continue;
        for (const line of page.text.split("\n")) {
          if (line.trim()) {
            records.push({
              page: page.page,
              type: "paragraph",
              text: line,
              continues: false,
              uncertain: false,
            });
          }
        }
      }
      hooks.onDone?.(pages);
      return { records, stripped: 0, finish: "stop" as const, usage: { input: 100, output: 200 }, ms: 1 };
    },
  };
}

/**
 * A PDF dense enough that there are several chunks — copied from
 * tests/pdf-chunk-concurrency.test.ts, which explains the arithmetic. Six
 * chunks is enough to lose some and keep some; the committed fixtures plan two
 * to five, and two cannot tell "resumed one of two" from a race.
 */
async function manyChunkPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let p = 1; p <= pages; p++) {
    const page = doc.addPage([612, 792]);
    for (let line = 0; line < 43; line++) {
      const words = Array.from({ length: 40 }, (_, w) => `p${p}l${line}w${w}`);
      page.drawText(words.join(" "), { x: 20, y: 770 - line * 17, size: 4 });
    }
  }
  return doc.save();
}

/* ---------------------------------------------------------------- the suite -- */

when("a checkpoint survives the job that paid for it", () => {
  const SLUG = "test-durable-resume";
  const OTHER_SLUG = "test-durable-resume-other";

  let mod: Awaited<ReturnType<typeof importDb>>;
  let db: Awaited<ReturnType<typeof importDb>>["db"];
  let articleId = "";
  let otherArticleId = "";

  async function importDb() {
    const client = await import("../src/db/client.js");
    const schema = await import("../src/db/schema.js");
    const pg = await import("../src/store/checkpoints-pg.js");
    const admin = await import("../src/admin.js");
    return { db: client.getDb(), schema, pg, admin };
  }

  /**
   * The store a claim would be handed — **built fresh, exactly as a new job on a
   * new machine would build it.**
   *
   * That is the point of taking no arguments beyond the article: there is
   * nowhere here to put a job id, an attempt token or a revision, because the
   * production constructor has nowhere to put one either
   * (src/store/checkpoints.ts § *A checkpoint is addressed by the article and
   * the question, never by the revision*).
   */
  function storeFor(id = articleId, slug = SLUG): CheckpointStore {
    return mod.pg.createPgCheckpointStore({ slug, articleId: id });
  }

  async function wipe(slug: string): Promise<void> {
    const { schema } = mod;
    const rows = await db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.slug, slug));
    for (const { id } of rows) {
      await db.execute(
        sql`update ${schema.articles} set current_revision_id = null where id = ${id}::uuid`,
      );
      await db.delete(schema.checkpoints).where(eq(schema.checkpoints.articleId, id));
      await db.delete(schema.articleRevisions).where(eq(schema.articleRevisions.articleId, id));
      await db.delete(schema.articles).where(eq(schema.articles.id, id));
    }
  }

  beforeAll(async () => {
    mod = await importDb();
    db = mod.db;
    const { schema, admin } = mod;
    await wipe(SLUG);
    await wipe(OTHER_SLUG);
    const [a] = await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID_LOCAL, slug: SLUG })
      .returning();
    const [b] = await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID_LOCAL, slug: OTHER_SLUG })
      .returning();
    if (!a || !b) throw new Error("could not create the fixture articles");
    articleId = a.id;
    otherArticleId = b.id;
  }, 60_000);

  beforeEach(async () => {
    const { schema } = mod;
    await db.delete(schema.checkpoints).where(eq(schema.checkpoints.articleId, articleId));
    await db.delete(schema.checkpoints).where(eq(schema.checkpoints.articleId, otherArticleId));
  });

  afterAll(async () => {
    await wipe(SLUG);
    await wipe(OTHER_SLUG);
  });

  /**
   * Wait until this article has `n` checkpoint rows, or give up loudly.
   *
   * The barrier the first test hangs on. A fixed sleep would be a flake with a
   * longer fuse; a timeout that throws says which number it was stuck at, so a
   * genuine failure of the write path reads as one rather than as a hang.
   */
  async function untilRows(n: number, ms = 20_000): Promise<void> {
    const until = Date.now() + ms;
    for (;;) {
      const have = await chunkRows();
      if (have >= n) return;
      if (Date.now() > until) {
        throw new Error(`Waited ${ms}ms for ${n} checkpoint rows and only ${have} arrived.`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /** How many `pdf-chunk` rows this article has — the cause, where `asked` is the effect. */
  async function chunkRows(id = articleId): Promise<number> {
    const rows = await db
      .select({ key: mod.schema.checkpoints.key })
      .from(mod.schema.checkpoints)
      .where(eq(mod.schema.checkpoints.articleId, id));
    return rows.length;
  }

  it(
    "a second job over the same article does not re-read the chunks the first one finished",
    async () => {
      const bytes = await manyChunkPdf(12);
      const pass = await pass0(bytes);
      const total = planChunks(pass).length;
      /* Not vacuous. With one or two chunks, "resumed some" and "raced" are the
         same observation. */
      expect(total).toBeGreaterThan(2);

      /**
       * **Attempt one, killed part way through** — one chunk refuses, which
       * ends the run (`allOrStop` aborts the rest). Whatever had already come
       * back is paid for, and that is what has to survive.
       *
       * **The refusal is held behind a barrier**, and that is not decoration.
       * Without it the number of chunks that got as far as a row is whatever
       * the race decided, and — worse — the writes of the chunks still in
       * flight land *after* the rejection, so a row count taken here reads low
       * and the assertion below compares two numbers taken at different
       * moments. The first draft of this test did exactly that and failed with
       * `expected 1 to be 5`, which is a flaky test rather than a finding.
       *
       * So: every other chunk's work is **stored** before the last one throws.
       * The barrier waits on the row count rather than on the readers
       * returning, and that distinction is the second thing this test got
       * wrong: `keepChunk` runs after the reader answers, so releasing on
       * "everyone has answered" left the writes racing the rejection, and the
       * rows that lost the race landed during the *next* test. Waiting on the
       * thing being asserted is the only barrier that cannot drift from it.
       */
      const lastPage = pass.pages[pass.pages.length - 1]!.page;
      const isVictim = (pages: number[]): boolean => pages.includes(lastPage);
      const dying = countingReader(pass, {
        hold: async (pages) => {
          if (isVictim(pages)) await untilRows(total - 1);
        },
        refuse: isVictim,
      });
      await expect(
        runPdfExtract({
          bytes,
          url: "https://example.test/long.pdf",
          checkpoints: storeFor(),
          slug: SLUG,
          reader: dying,
        }),
      ).rejects.toThrow();

      const saved = await chunkRows();
      /* The first attempt got somewhere and did not finish. Both halves matter:
         nothing saved makes the second attempt's number meaningless, and
         everything saved means the kill did not kill anything. */
      expect(saved).toBe(total - 1);

      /**
       * **Attempt two: a new job, a new claim, a new store object.** In
       * production it is also a new draft revision and, on Vercel, a different
       * machine with an empty `/tmp`. Nothing of the first attempt survives
       * except the rows.
       */
      const retry = countingReader(pass);
      const result = await runPdfExtract({
        bytes,
        url: "https://example.test/long.pdf",
        checkpoints: storeFor(),
        slug: SLUG,
        reader: retry,
      });

      /* **The number this whole landing is about.** The second attempt pays for
         exactly what the first one did not finish — not for the whole document
         again, which is what a `/tmp` directory bought it. */
      expect(retry.asked.length).toBe(total - saved);
      expect(retry.asked.length).toBeLessThan(total);
      expect(result.chunks).toBe(total);
      /* And a third attempt would pay nothing at all, which is the end state a
         document too long for one invocation has to be able to reach. */
      expect(await chunkRows()).toBe(total);
      const third = countingReader(pass);
      await runPdfExtract({
        bytes,
        url: "https://example.test/long.pdf",
        checkpoints: storeFor(),
        slug: SLUG,
        reader: third,
      });
      expect(third.asked.length).toBe(0);
    },
    180_000,
  );

  it(
    "a checkpoint written for one article is never served to another",
    async () => {
      /**
       * **The same bytes, so the same key** — which is the point. The chunk key
       * is a content address over the source hash, the pages, the prompt, the
       * model and the token ceiling (src/pdf-read.ts § `chunkKey`); it does not
       * and must not contain the article. Two readers who upload the same paper
       * mint identical keys, and the *only* thing keeping one person's
       * transcription out of the other's article is that the store is bound to
       * an `articleId` and its `read` says so in the `where`.
       *
       * Rows are per-article and an article has one owner, so this is stated in
       * src/store/checkpoints.ts as a correctness rule rather than a privacy
       * one — but it stops being only that the day anything un-scopes these
       * rows, which is why it is asserted at the stage rather than at the store.
       */
      const bytes = new Uint8Array(await readFile(EASY));
      const pass = await pass0(bytes);
      const total = planChunks(pass).length;

      const first = countingReader(pass);
      await runPdfExtract({
        bytes,
        url: "https://example.test/paper.pdf",
        checkpoints: storeFor(),
        slug: SLUG,
        reader: first,
      });
      expect(first.asked.length).toBe(total);
      expect(await chunkRows()).toBe(total);

      /* The control, and it is not decoration: without it a store that found
         nothing for anybody would pass the assertion below. Same article, same
         bytes — this one must resume everything. */
      const again = countingReader(pass);
      await runPdfExtract({
        bytes,
        url: "https://example.test/paper.pdf",
        checkpoints: storeFor(),
        slug: SLUG,
        reader: again,
      });
      expect(again.asked.length).toBe(0);

      /* And the other article pays in full, for the identical document. */
      const stranger = countingReader(pass);
      await runPdfExtract({
        bytes,
        url: "https://example.test/paper.pdf",
        checkpoints: storeFor(otherArticleId, OTHER_SLUG),
        slug: OTHER_SLUG,
        reader: stranger,
      });
      expect(stranger.asked.length).toBe(total);
      expect(await chunkRows(otherArticleId)).toBe(total);
    },
    120_000,
  );

  it(
    "refuses to answer about an article it was not built for, before it reads anything",
    async () => {
      /* The store bound to article A, asked about article B's slug. It throws
         rather than answering, and it throws before any statement is sent —
         which is what stops a mis-wired caller writing one article's work into
         another's rows. src/store/checkpoints.ts § `CheckpointArticleRef`. */
      await expect(
        storeFor().read(OTHER_SLUG, "pdf-chunk", ["a1b2c3d4e5f60718"]),
      ).rejects.toThrow(/bound to/);
    },
  );

  it(
    "the session hands a stage a store bound to its own article",
    async () => {
      /**
       * **The wiring itself**, which is the piece that was missing rather than
       * the idea. `createPgCheckpointStore` was written on 2026-08-29 and had no
       * caller for three days, because a stage was never handed the stable
       * `articleId` — it was handed `ctx.dir`. `StoreSession.checkpoints` is
       * where that is fixed, so this asserts on the property the coordinator
       * actually reads rather than on a store the test built itself.
       *
       * The ref is built by hand rather than by opening a real draft: nothing
       * about `checkpoints` touches the revision, the job or the attempt, and
       * that is exactly the property worth pinning — a checkpoint keyed on any
       * of the three is written on every run and read on none.
       */
      const { pgStoreSession } = await import("../src/store/pg-session.js");
      const { randomUUID } = await import("node:crypto");
      const session = pgStoreSession({
        ref: {
          slug: SLUG,
          articleId,
          revisionId: randomUUID(),
          jobId: randomUUID(),
          attemptId: randomUUID(),
        },
      });
      await session.checkpoints.write(SLUG, "pdf-chunk", "1234abcd5678ef90", { records: [] });
      expect(await chunkRows()).toBe(1);

      /* A second session — a second job, a second attempt, a second draft —
         finds the first one's work. */
      const later = pgStoreSession({
        ref: {
          slug: SLUG,
          articleId,
          revisionId: randomUUID(),
          jobId: randomUUID(),
          attemptId: randomUUID(),
        },
      });
      const found = await later.checkpoints.read(SLUG, "pdf-chunk", ["1234abcd5678ef90"]);
      expect(found.size).toBe(1);

      /* And a session over the other article does not. */
      const stranger = pgStoreSession({
        ref: {
          slug: OTHER_SLUG,
          articleId: otherArticleId,
          revisionId: randomUUID(),
          jobId: randomUUID(),
          attemptId: randomUUID(),
        },
      });
      expect(
        (await stranger.checkpoints.read(OTHER_SLUG, "pdf-chunk", ["1234abcd5678ef90"])).size,
      ).toBe(0);
    },
    60_000,
  );

  /* ------------------------------------------------------- and the label half -- */

  /**
   * The other caller, and it is the same plumbing: `hierarchy` hands the store
   * down to `generateLabels`, which reads every batch fingerprint in one
   * statement and writes each answer as it lands.
   *
   * **Proved by taking the money away rather than by counting.** With no
   * credential a single request throws, so a run that resumes every batch and
   * returns is a run that made no call — which is the only way to show a
   * resumed batch did not quietly go and ask again. The same argument, and the
   * same `noAuth`, as tests/labels-batching.test.ts.
   */
  async function noAuth(fn: () => Promise<void>): Promise<void> {
    const saved = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.OPENROUTER_API_KEY;
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
    }
  }

  /**
   * A tree the way `buildTree` shapes one — a node's children are either all
   * internal or all leaves, never mixed. Copied from
   * tests/labels-batching.test.ts, which owns the shape; `planBatches` refuses
   * anything else, loudly, and a hand-rolled two-node tree was refused here
   * first.
   */
  function labelFixture(sections = 3, per = 4): { tree: Tree; blocks: Block[] } {
    const total = sections * per;
    const blocks: Block[] = Array.from({ length: total }, (_, i): Block => {
      const id = `spya-${String(i).padStart(6, "0")}`;
      return {
        id,
        tag: "p",
        kind: "text",
        text: `Paragraph ${i} says something about the matter at hand.`,
        words: 9,
        html: `<p id="${id}">Paragraph ${i}</p>`,
        gistable: true,
      };
    });
    const nodes: Record<string, TreeNode> = {};
    let n = 0;
    const nextId = (): string => `n${String(++n).padStart(4, "0")}`;
    const rootId = nextId();
    const sectionIds: string[] = [];
    for (let sec = 0; sec < sections; sec++) {
      const sectionId = nextId();
      const from = sec * per;
      const to = from + per - 1;
      const leafIds: string[] = [];
      for (let i = from; i <= to; i++) {
        const leafId = nextId();
        nodes[leafId] = {
          id: leafId,
          depth: 2,
          parent: sectionId,
          children: [],
          range: [blocks[i]!.id, blocks[i]!.id],
          title: "",
        };
        leafIds.push(leafId);
      }
      nodes[sectionId] = {
        id: sectionId,
        depth: 1,
        parent: rootId,
        children: leafIds,
        range: [blocks[from]!.id, blocks[to]!.id],
        title: `Section ${sec}`,
        gist: `Section ${sec} argues something.`,
      };
      sectionIds.push(sectionId);
    }
    nodes[rootId] = {
      id: rootId,
      depth: 0,
      parent: null,
      children: sectionIds,
      range: [blocks[0]!.id, blocks[total - 1]!.id],
      title: "Whole piece",
      gist: "The article argues something.",
    };
    return {
      tree: { version: "test", generator: "test", slug: "test", rootId, nodes },
      blocks,
    };
  }

  it(
    "resumes every label batch a previous job paid for, without a credential",
    async () => {
      const { tree, blocks } = labelFixture();
      const outline = renderOutline(tree);
      const batches = planBatches(tree, blocks);
      expect(batches.length).toBeGreaterThan(0);

      /* Written through the store the way a first attempt would have written
         them — one row per batch, under the fingerprint the plan mints. */
      const writer = storeFor();
      for (const batch of batches) {
        const fingerprint = batchFingerprint(batch, blocks, outline);
        await writer.write(SLUG, "hierarchy-labels", fingerprint, {
          fingerprint,
          labels: Object.fromEntries(batch.blocks.map((b) => [b.id, `Saved label for ${b.id}`])),
          record: {
            blocks: batch.blocks.map((b) => b.id),
            setStarts: batch.setStarts,
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            ms: 10,
          },
        });
      }

      await noAuth(async () => {
        /* A new store object, as a new job would build. */
        const run = await generateLabels({ tree, blocks, slug: SLUG, checkpoints: storeFor() });
        expect(run.resumed).toBe(batches.length);
        expect(run.batches).toBe(batches.length);
        expect(run.inputTokens).toBe(0);
        expect(run.labels[blocks[0]!.id]).toBe(`Saved label for ${blocks[0]!.id}`);
      });
    },
    60_000,
  );

  it(
    "does not serve one article's label batches to another",
    async () => {
      const { tree, blocks } = labelFixture();
      const outline = renderOutline(tree);
      const batches = planBatches(tree, blocks);
      const writer = storeFor();
      for (const batch of batches) {
        const fingerprint = batchFingerprint(batch, blocks, outline);
        await writer.write(SLUG, "hierarchy-labels", fingerprint, {
          fingerprint,
          labels: Object.fromEntries(batch.blocks.map((b) => [b.id, `Saved label for ${b.id}`])),
          record: {
            blocks: batch.blocks.map((b) => b.id),
            setStarts: batch.setStarts,
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            ms: 10,
          },
        });
      }

      await noAuth(async () => {
        /* The other article, the same tree and blocks — so every fingerprint is
           identical, since `batchFingerprint` is a content address and carries
           no article. It must find nothing, go to the model, and throw for want
           of a key. `[ai-not-set-up]` rather than the SDK's own message:
           src/anthropic-call.ts replaces it before it can reach a caller, so
           matching on the code is what proves a real request was attempted. */
        await expect(
          generateLabels({
            tree,
            blocks,
            slug: OTHER_SLUG,
            checkpoints: storeFor(otherArticleId, OTHER_SLUG),
          }),
        ).rejects.toThrow(/\[ai-not-set-up\]/);
      });
    },
    60_000,
  );
});

/* ------------------------------------------ the session, which is the wiring -- */

/**
 * **`StoreSession.checkpoints` is what the two stages are actually handed**, and
 * it was the missing piece rather than a missing idea: the seam existed from
 * 2026-08-29 and had no caller, because nothing ever gave a stage the stable
 * `articleId` it has to be keyed on (docs/plans/260901d-simpler-finish-sol.md § 4).
 *
 * The filesystem session has no article row, so it hands out a store that
 * remembers nothing — the laptop path keeps working and stops resuming, which
 * is a decision and is written down at `nullCheckpointStore`.
 */
describe("the session's checkpoint capability", () => {
  it("hands the filesystem session a store that remembers nothing but still refuses a bad key", async () => {
    const { nullCheckpointStore } = await import("../src/store/checkpoints.js");
    const store = nullCheckpointStore();
    await store.write("anything", "pdf-chunk", "a1b2c3d4e5f60718", { records: [] });
    expect((await store.read("anything", "pdf-chunk", ["a1b2c3d4e5f60718"])).size).toBe(0);

    /* And it is not merely a shrug. A key the database's CHECK would reject
       throws here too, so a stage that minted one finds out from `npm test` on
       a laptop rather than from production. */
    await expect(
      store.read("anything", "pdf-chunk", ["NOT-LOWER-CASE"]),
    ).rejects.toThrow(/not a usable checkpoint key/);
    await expect(
      store.write("anything", "pdf-chunk", "a1b2c3d4e5f60718", undefined),
    ).rejects.toThrow(/must serialise to JSON/);
  });
});
