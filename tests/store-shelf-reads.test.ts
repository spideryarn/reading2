/**
 * **What the shelf reads, and how many times it asks.**
 *
 * `listArticles` used to run one query for the page and then, **per article**, a
 * full block read — every `text`, every `html`, and the generated `fts` vector
 * whose own schema comment says it is never selected — followed by a jsdom
 * sanitise of all of it, followed by a second query that selected every comment
 * row's id in order to take the array's length. Measured on this laptop against
 * the local Supabase, six entries:
 *
 * ```
 *   statements per call    13          (1 + 2N)
 *   row JSON per call      640,893 B
 *   wall clock (median)    558 ms
 * ```
 *
 * All of it to print a title, a date, a blurb, four numbers and four ticks —
 * every one of which was already a column. docs/plans/library-read-latency.md.
 *
 * ## What this file pins, and what it deliberately cannot
 *
 * The **shape** of the reads: a constant number of statements whatever the shelf
 * holds, none of them touching `revision_blocks`. It does not pin their cost — a
 * constant number of statements that each read a megabyte would pass here, and
 * `tests/store-revision-columns.test.ts` is what stops that, by asserting the
 * generated SQL of the query itself.
 *
 * Four ways a query-counting test passes over the exact regression it names, all
 * of them from GPT Sol's review of the plan, and all of them guarded below:
 *
 *  1. the counting wrapper never attaches, so nothing is counted → it throws;
 *  2. the fixture produces no shelf rows, so `1 + 2N` is 1 → the entries are
 *     asserted first, by slug;
 *  3. one batched read of every block row is still a constant → the captured
 *     statements are inspected, not just counted;
 *  4. "two runs agree" rather than an absolute number → the number is absolute.
 *
 * Skips loudly when there is no database, for the reason tests/db-schema.test.ts
 * explains at length: a skipped test protects nothing, so the run must say
 * "skipped" rather than show a green tick for having checked nothing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, isNull } from "drizzle-orm";

import { loadEnvLocal } from "../src/env.js";

loadEnvLocal();

/**
 * Every warning the store wrote.
 *
 * **Mocked rather than read off stdout.** src/log.ts is `silent` under
 * `NODE_ENV=test` on purpose, so an in-process assertion against the real
 * logger would pass against a logger that emits nothing — the vacuous green
 * this repo keeps a document about. Same reasoning and same shape as
 * tests/health.test.ts.
 */
const warnings: { fields: Record<string, unknown>; message: string }[] = [];

vi.mock("../src/log.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/log.js")>();
  const capture = {
    debug() {},
    info() {},
    warn(fields: Record<string, unknown>, message: string) {
      warnings.push({ fields, message });
    },
    error() {},
    child() {
      return capture;
    },
  };
  return { ...actual, log: () => capture };
});

const { closeDb, getDb } = await import("../src/db/client.js");
const { articleRevisions, articles, blockIdentities, comments, revisionBlocks } = await import(
  "../src/db/schema.js"
);
const { currentOwnerId } = await import("../src/owner.js");
const { pgArticleReader } = await import("../src/store/pg.js");
const { deriveLibraryScalars } = await import("../src/library-scalars.js");
import type { Block, Glossary, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

/* ------------------------------------------------------------- the fixture -- */

/** Distinct from every other file's, and tests/fixture-ids.test.ts enforces it. */
const A = {
  plain: "00000000-0000-4000-8000-00000000c5a0",
  untitled: "00000000-0000-4000-8000-00000000c5a2",
  unscalared: "00000000-0000-4000-8000-00000000c5a4",
  /* A **second** article with no scalars, and it is not a spare. With only one,
     "one line for the whole page" and "one line per bad row" produce the same
     single warning, and reverting the aggregation leaves every assertion here
     green — which it did, until this existed. */
  unscalaredToo: "00000000-0000-4000-8000-00000000c5aa",
  gistless: "00000000-0000-4000-8000-00000000c5a6",
  blockless: "00000000-0000-4000-8000-00000000c5a8",
} as const;
const R = {
  plain: "00000000-0000-4000-8000-00000000c5b0",
  untitled: "00000000-0000-4000-8000-00000000c5b2",
  unscalared: "00000000-0000-4000-8000-00000000c5b4",
  unscalaredToo: "00000000-0000-4000-8000-00000000c5ba",
  gistless: "00000000-0000-4000-8000-00000000c5b6",
  blockless: "00000000-0000-4000-8000-00000000c5b8",
} as const;

const SLUG = {
  plain: "test-shelf-reads-plain",
  untitled: "test-shelf-reads-untitled",
  unscalared: "test-shelf-reads-unscalared",
  unscalaredToo: "test-shelf-reads-unscalared-too",
  gistless: "test-shelf-reads-gistless",
  blockless: "test-shelf-reads-blockless",
} as const;

/** No `1`, no `l`, no `i`, no `o` — the id alphabet is src/ids.ts. */
const B = {
  headA: "spya-shfaaa",
  bodyA: "spya-shfaab",
  headB: "spya-shfaac",
  bodyB: "spya-shfaad",
  laterB: "spya-shfaaj",
  headC: "spya-shfaae",
  bodyC: "spya-shfaaf",
  headE: "spya-shfaak",
  bodyE: "spya-shfaam",
  headD: "spya-shfaag",
  ruleD: "spya-shfaah",
} as const;

/**
 * The heading `metaFrom` must fall back to. Deliberately **not** the slug and
 * not any stored title, so a card showing it can only have come from the block.
 */
const FALLBACK_HEADING = "A Heading No Column Holds";

/**
 * A **second** depth-1 heading, later in the article, inserted into the table
 * *first*.
 *
 * Without it, dropping `order by ordinal` from the subquery changes nothing:
 * one h1 is the first h1 whatever order the rows come back in, and the test
 * stays green over the missing clause. With the rows physically out of order,
 * an unordered scan returns this one — so the assertion is about the ordering
 * and not merely about the filter. GPT Sol named this hole in its review of the
 * plan ("corpus data that does not distinguish the orders"), and the first
 * version of this file had it.
 */
const LATER_HEADING = "The Heading That Must Not Win";

function treeFor(slug: string, range: [string, string], gist: string | null): Tree {
  return {
    version: "1",
    generator: "test",
    slug,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: ["n1"],
        range,
        title: "Root",
        ...(gist === null ? {} : { gist }),
      },
      n1: {
        id: "n1",
        depth: 1,
        parent: "n0",
        children: [],
        range,
        title: "Part one",
      },
    },
  } as unknown as Tree;
}

function blocksOf(headId: string, bodyId: string, heading: string): Block[] {
  return [
    { id: headId, tag: "h1", kind: "heading", level: 1, text: heading, words: heading.split(" ").length, html: `<h1>${heading}</h1>`, gistable: true },
    { id: bodyId, tag: "p", kind: "text", text: "Four plain words here.", words: 4, html: "<p>Four plain words here.</p>", gistable: true },
  ] as unknown as Block[];
}

/** The smallest thing the column will accept: an artefact that exists and is empty. */
const EMPTY_GLOSSARY: Glossary = {
  version: "glossary/1",
  generator: "fixture",
  slug: SLUG.plain,
  sourceHash: "not-a-real-hash",
  entries: [],
  passes: 0,
  generatedAt: "2026-03-01T00:00:00.000Z",
  elapsedMs: 0,
};

const ALL_ARTICLES = Object.values(A);

async function clean(): Promise<void> {
  const db = getDb();
  await db.delete(comments).where(inArray(comments.articleId, [...ALL_ARTICLES]));
  await db.update(articles).set({ currentRevisionId: null }).where(inArray(articles.id, [...ALL_ARTICLES]));
  await db.delete(revisionBlocks).where(inArray(revisionBlocks.articleId, [...ALL_ARTICLES]));
  await db.delete(articleRevisions).where(inArray(articleRevisions.articleId, [...ALL_ARTICLES]));
  await db.delete(blockIdentities).where(inArray(blockIdentities.articleId, [...ALL_ARTICLES]));
  await db.delete(articles).where(inArray(articles.id, [...ALL_ARTICLES]));
}

/* Probes for `word_count` and not merely for the schema — the scalars this
   suite reads are what that migration added. */
const { reachable } = await pgReady({
  suite: "tests/store-shelf-reads.test.ts",
  columns: [{ table: "spideryarn.article_revisions", column: "word_count" }],
});

const when = reachable ? describe : describe.skip;

/* ----------------------------------------------------- counting statements -- */

/**
 * Every statement the pool sent while `fn` ran.
 *
 * **Throws if it cannot wrap the pool.** A counter that quietly counts nothing
 * reports zero queries, which passes every assertion below — the fail-open hole
 * GPT Sol found in the benchmark script this test grew out of.
 */
async function statementsDuring<T>(fn: () => Promise<T>): Promise<{ value: T; sent: string[] }> {
  const pool = (getDb() as unknown as { $client?: { query?: unknown } }).$client;
  if (!pool || typeof pool.query !== "function") {
    throw new Error("cannot reach the pg pool through db.$client — nothing would be counted");
  }
  const client = pool as { query: (...a: unknown[]) => Promise<unknown> };
  const original = client.query.bind(client);
  const sent: string[] = [];
  client.query = (...args: unknown[]) => {
    const first = args[0];
    sent.push(typeof first === "string" ? first : String((first as { text?: string })?.text ?? first));
    return original(...args);
  };
  try {
    return { value: await fn(), sent };
  } finally {
    client.query = original;
  }
}

const mentions = (sent: string[], fragment: string): string[] =>
  sent.filter((s) => s.includes(fragment));

/**
 * Statements **whose subject is the blocks** — the read that was happening once
 * per article.
 *
 * Not "mentions `revision_blocks`": the shelf's own query names that table, in
 * the one-row correlated subquery that finds the title fallback's heading, so a
 * check on the table's name would fail on the fix itself. And not "names the
 * `html` column" either — drizzle drops the table qualifier from a single-table
 * select, so `"revision_blocks"."html"` never appears in the statement it is
 * meant to catch, and that version of this helper reported zero block reads
 * while one was plainly happening.
 *
 * So: a statement that reads **from** the block table and not from `articles`.
 * The shelf's query is the second; a per-article block read is the first.
 */
const blockReads = (sent: string[]): string[] =>
  sent.filter(
    (s) =>
      s.includes('from "spideryarn"."revision_blocks"') &&
      !s.includes('from "spideryarn"."articles"'),
  );

/* ------------------------------------------------------------- the checks -- */

when("the shelf's reads", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    const db = getDb();
    await clean();

    const owner = currentOwnerId();
    await db.insert(articles).values([
      { id: A.plain, ownerId: owner, slug: SLUG.plain },
      { id: A.untitled, ownerId: owner, slug: SLUG.untitled },
      { id: A.unscalared, ownerId: owner, slug: SLUG.unscalared },
      { id: A.unscalaredToo, ownerId: owner, slug: SLUG.unscalaredToo },
      { id: A.gistless, ownerId: owner, slug: SLUG.gistless },
      { id: A.blockless, ownerId: owner, slug: SLUG.blockless },
    ]);

    const plainBlocks = blocksOf(B.headA, B.bodyA, "The Stored Title Wins");
    const untitledBlocks = [
      ...blocksOf(B.headB, B.bodyB, FALLBACK_HEADING),
      {
        id: B.laterB,
        tag: "h1",
        kind: "heading",
        level: 1,
        text: LATER_HEADING,
        words: 6,
        html: `<h1>${LATER_HEADING}</h1>`,
        gistable: true,
      },
    ] as unknown as Block[];
    const unscalaredBlocks = blocksOf(B.headC, B.bodyC, "Recomputed From These");
    const unscalaredTooBlocks = blocksOf(B.headE, B.bodyE, "And These As Well");

    await db.insert(blockIdentities).values([
      { articleId: A.plain, blockId: B.headA },
      { articleId: A.plain, blockId: B.bodyA },
      { articleId: A.untitled, blockId: B.headB },
      { articleId: A.untitled, blockId: B.bodyB },
      { articleId: A.untitled, blockId: B.laterB },
      { articleId: A.unscalared, blockId: B.headC },
      { articleId: A.unscalared, blockId: B.bodyC },
      { articleId: A.unscalaredToo, blockId: B.headE },
      { articleId: A.unscalaredToo, blockId: B.bodyE },
      { articleId: A.gistless, blockId: B.headD },
      { articleId: A.gistless, blockId: B.ruleD },
      ]);

    const plainTree = treeFor(SLUG.plain, [B.headA, B.bodyA], "The plain one's blurb.");
    const untitledTree = treeFor(SLUG.untitled, [B.headB, B.bodyB], "The untitled one's blurb.");
    const unscalaredTree = treeFor(SLUG.unscalared, [B.headC, B.bodyC], "Recomputed blurb.");
    const unscalaredTooTree = treeFor(SLUG.unscalaredToo, [B.headE, B.bodyE], "The second blurb.");
    /* **All four numbers legitimately zero, and the blurb legitimately null.**
       Two blocks with no prose in them (a picture and a rule, which is what
       `gistable: false` means), and a tree that is only its root — so no parts
       and no sections — and a revision with no excerpt, so there is no third
       rung for the blurb to fall to. Every one of those is a real answer, and
       none of them is a reason to go and read the article. */
    const gistlessTree = {
      version: "1",
      generator: "test",
      slug: SLUG.gistless,
      rootId: "n0",
      nodes: {
        n0: { id: "n0", depth: 0, parent: null, children: [], range: [B.headD, B.ruleD], title: "Root" },
      },
    } as unknown as Tree;
    const gistlessBlocks = [
      { id: B.headD, tag: "figure", kind: "media", text: "", words: 0, html: "<figure></figure>", gistable: false },
      { id: B.ruleD, tag: "hr", kind: "other", text: "", words: 0, html: "<hr>", gistable: false },
    ] as unknown as Block[];

    await db.insert(articleRevisions).values([
      {
        id: R.plain,
        articleId: A.plain,
        status: "published",
        title: "The Stored Title Wins",
        fetchedAt: new Date("2026-03-01T00:00:00.000Z"),
        tree: plainTree,
        /* A real `Glossary`, not `{}` with a plausible field. The column is
           typed, and the shelf now only asks whether it is null — but a fixture
           that would not deserialise is a fixture that proves less than it
           looks. */
        glossary: EMPTY_GLOSSARY,
        ...deriveLibraryScalars({ blocks: plainBlocks, tree: plainTree }),
      },
      {
        /* **No title.** `metaFrom` must fall back to the first depth-1 heading,
           which lives in a block this query is no longer allowed to read. */
        id: R.untitled,
        articleId: A.untitled,
        status: "published",
        title: null,
        fetchedAt: new Date("2026-03-02T00:00:00.000Z"),
        tree: untitledTree,
        ...deriveLibraryScalars({ blocks: untitledBlocks, tree: untitledTree }),
      },
      {
        /* **The scalars deliberately absent**, which is the hole in the data the
           fallback exists for. Written as nulls rather than omitted, so the
           intent is legible. */
        id: R.unscalared,
        articleId: A.unscalared,
        status: "published",
        title: "Its Numbers Are Missing",
        fetchedAt: new Date("2026-03-03T00:00:00.000Z"),
        tree: unscalaredTree,
        wordCount: null,
        blockCount: null,
        partCount: null,
        sectionCount: null,
        rootGist: null,
      },
      {
        /* The second one with nothing stored. See `A.unscalaredToo`. */
        id: R.unscalaredToo,
        articleId: A.unscalaredToo,
        status: "published",
        title: "Its Numbers Are Missing Too",
        fetchedAt: new Date("2026-03-06T00:00:00.000Z"),
        tree: unscalaredTooTree,
        wordCount: null,
        blockCount: null,
        partCount: null,
        sectionCount: null,
        rootGist: null,
      },
      {
        /* Zero words, zero parts, zero sections, no blurb — **all of it real,
           computed data**, and none of it a reason to recompute anything. */
        id: R.gistless,
        articleId: A.gistless,
        status: "published",
        title: "Nothing To Say",
        fetchedAt: new Date("2026-03-04T00:00:00.000Z"),
        tree: gistlessTree,
        ...deriveLibraryScalars({ blocks: gistlessBlocks, tree: gistlessTree }),
      },
      {
        /* What the importer can publish: blocks.json parsed to an empty array,
           so the insert was skipped and `block_count` is 0. The shelf has always
           dropped it, and must go on dropping it. */
        id: R.blockless,
        articleId: A.blockless,
        status: "published",
        title: "No Blocks At All",
        fetchedAt: new Date("2026-03-05T00:00:00.000Z"),
        tree: treeFor(SLUG.blockless, [B.headD, B.ruleD], "Never seen."),
        wordCount: 0,
        blockCount: 0,
        partCount: 1,
        sectionCount: 0,
        rootGist: "Never seen.",
      },
    ]);

    const row = (
      block: Block,
      articleId: string,
      revisionId: string,
      ordinal: number,
    ) => ({
      articleId,
      revisionId,
      blockId: block.id,
      ordinal,
      tag: block.tag,
      kind: block.kind,
      level: block.level ?? null,
      text: block.text,
      words: block.words,
      html: block.html,
      gistable: block.gistable,
    });

    await db.insert(revisionBlocks).values([
      ...plainBlocks.map((b, i) => row(b, A.plain, R.plain, i)),
      /* **Deliberately inserted out of order**: ordinal 2 into the heap first,
         so a scan with no `order by` comes back with the wrong heading. See
         `LATER_HEADING`. */
      row(untitledBlocks[2]!, A.untitled, R.untitled, 2),
      row(untitledBlocks[0]!, A.untitled, R.untitled, 0),
      row(untitledBlocks[1]!, A.untitled, R.untitled, 1),
      ...unscalaredBlocks.map((b, i) => row(b, A.unscalared, R.unscalared, i)),
      ...unscalaredTooBlocks.map((b, i) => row(b, A.unscalaredToo, R.unscalaredToo, i)),
      ...gistlessBlocks.map((b, i) => row(b, A.gistless, R.gistless, i)),
    ]);

    for (const [id, articleId, revisionId] of [
      [R.plain, A.plain, R.plain],
      [R.untitled, A.untitled, R.untitled],
      [R.unscalared, A.unscalared, R.unscalared],
      [R.unscalaredToo, A.unscalaredToo, R.unscalaredToo],
      [R.gistless, A.gistless, R.gistless],
      [R.blockless, A.blockless, R.blockless],
    ] as const) {
      void id;
      await getDb().update(articles).set({ currentRevisionId: revisionId }).where(eq(articles.id, articleId));
    }

    /* Three different counts, and one article with none. Equal counts would
       hide a mis-keyed join, and the zero is the case `group by` gets wrong —
       an article with no comments is *absent* from the result, not zero in it. */
    const comment = (articleId: string, id: string, blockId: string) => ({
      articleId,
      id,
      ownerId: owner,
      blockId,
      quote: "Four plain words here.",
      start: 0,
      body: "A mark.",
      status: "none",
    });
    await db.insert(comments).values([
      comment(A.plain, "c1", B.bodyA),
      comment(A.plain, "c2", B.bodyA),
      comment(A.untitled, "c3", B.bodyB),
      comment(A.unscalared, "c4", B.bodyC),
      comment(A.unscalared, "c5", B.bodyC),
      comment(A.unscalared, "c6", B.bodyC),
    ]);
  });

  afterAll(async () => {
    await clean();
    await closeDb();
  });

  beforeEach(() => {
    warnings.length = 0;
  });

  const mine = (entries: Awaited<ReturnType<typeof pgArticleReader.listArticles>>) =>
    entries.filter((e) => e.slug.startsWith("test-shelf-reads-"));

  /** Every slug named across every warning, narrowed to this file's own. */
  const warnedMine = () =>
    warnings
      .flatMap((w) => (w.fields.slugs as string[] | undefined) ?? [])
      .filter((slug) => slug.startsWith("test-shelf-reads-"));

  it("asks two questions for the whole page, and neither is about a block", async () => {
    const { value, sent } = await statementsDuring(() => pgArticleReader.listArticles({ archived: false }));

    /* **The entries first**, so an empty shelf cannot make `1 + 2N` come out as
       a small number and pass. Four of the five, because the blockless one is
       supposed to be dropped. */
    expect(mine(value).map((e) => e.slug).sort()).toEqual([
      SLUG.gistless,
      SLUG.plain,
      SLUG.unscalared,
      SLUG.unscalaredToo,
      SLUG.untitled,
    ].sort());

    /* One of them falls back on purpose, so this run is not the constant one —
       that is the next test. What must hold here is that nothing read a block
       for any article whose scalars were present.

       **Scoped to this file's own slugs.** Vitest runs test files concurrently
       against one local Postgres, so another suite's fixture can be on the
       shelf while this runs; `mine` is why the entry assertion above is exact,
       and this is the same idea for the warnings. */
    expect(warnedMine().sort()).toEqual([SLUG.unscalared, SLUG.unscalaredToo].sort());
    /* **One block read per warning, and no more — and one warning covers the
       whole page.** Every article that has its scalars costs nothing; however
       many do not, they are recomputed together in a single statement and
       reported in a single line (docs/project/logging.md: a piece of code whose
       line count grows with the data says it once instead). Written against the
       warnings rather than the number 1, so a foreign fixture arriving mid-run
       moves both sides together instead of turning this red for somebody
       else's reason. */
    expect({ warnings: warnings.length, blockReads: blockReads(sent).length }).toEqual({
      warnings: 1,
      blockReads: 1,
    });
  });

  it("sends exactly two statements when the scalars are all there", async () => {
    /* The whole change, as a number. It was `1 + 2N`. */
    const db = getDb();
    /* Both of the hollow ones, so this run has nothing to recompute. */
    await db
      .update(articleRevisions)
      .set(
        deriveLibraryScalars({
          blocks: blocksOf(B.headC, B.bodyC, "Recomputed From These"),
          tree: treeFor(SLUG.unscalared, [B.headC, B.bodyC], "Recomputed blurb."),
        }),
      )
      .where(eq(articleRevisions.id, R.unscalared));
    await db
      .update(articleRevisions)
      .set(
        deriveLibraryScalars({
          blocks: blocksOf(B.headE, B.bodyE, "And These As Well"),
          tree: treeFor(SLUG.unscalaredToo, [B.headE, B.bodyE], "The second blurb."),
        }),
      )
      .where(eq(articleRevisions.id, R.unscalaredToo));

    try {
      const { value, sent } = await statementsDuring(() =>
        pgArticleReader.listArticles({ archived: false }),
      );
      expect(mine(value).length).toBe(5);
      expect(warnedMine()).toEqual([]);

      /**
       * **Two, plus two for each article that had to be recomputed.**
       *
       * The old shape was `1 + 2N` — one query for the page, then a block read
       * and a comment read per article. The new one is 2, and it does not move
       * when the shelf grows: not with the number of articles, and not with the
       * number of them that need recomputing either, because that is one
       * batched statement and one log line however many there are.
       *
       * Written against `warnings.length` rather than as the bare number 2
       * because vitest runs these files concurrently against one database, and
       * a fixture belonging to a suite that has not finished can be on the
       * shelf while this runs. That moves both sides together; it does not let
       * `1 + 2N` through, because `1 + 2N` needs a block read per article and
       * the warning is capped at one.
       *
       * Counted **and** inspected: one batched read of every block row in the
       * database would be a single constant statement and would pass a count.
       */
      expect({ statements: sent.length, sent }).toEqual({
        statements: 2 + warnings.length,
        sent,
      });
      expect(mentions(sent, '"spideryarn"."articles"."slug"').length).toBe(1);
      expect(mentions(sent, 'group by "spideryarn"."comments"."article_id"').length).toBe(1);
      /* Accounted for, not absent: a foreign fixture mid-run can force one, and
         the assertion that matters is that every block read had a reason. None
         of this file's articles did — that is the line above. */
      expect(blockReads(sent).length).toBe(warnings.length);
    } finally {
      /* **`finally`, not a trailing statement.** This is the only test that
         edits the shared fixture, and when an earlier assertion in it threw,
         the hole the two fallback tests below need was never put back — so they
         failed for a reason that had nothing to do with them. */
      await db
        .update(articleRevisions)
        .set({ wordCount: null, blockCount: null, partCount: null, sectionCount: null, rootGist: null })
        .where(inArray(articleRevisions.id, [R.unscalared, R.unscalaredToo]));
    }
  });

  it("counts each article's comments, and zero for one that has none", async () => {
    const entries = await pgArticleReader.listArticles({ archived: false });
    const by = new Map(entries.map((e) => [e.slug, e.comments]));
    expect({
      plain: by.get(SLUG.plain),
      untitled: by.get(SLUG.untitled),
      unscalared: by.get(SLUG.unscalared),
      gistless: by.get(SLUG.gistless),
      unscalaredToo: by.get(SLUG.unscalaredToo),
    }).toEqual({ plain: 2, untitled: 1, unscalared: 3, gistless: 0, unscalaredToo: 0 });
  });

  it("falls back to the article's own heading when no column holds a title", async () => {
    /* Assert the null first. A fixture whose title turned out not to be null
       would pass this test with the subquery deleted. */
    const [row] = await getDb()
      .select({ title: articleRevisions.title })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, R.untitled));
    expect(row?.title).toBeNull();

    const entries = await pgArticleReader.listArticles({ archived: false });
    /* The **first** depth-1 heading by ordinal, not merely a depth-1 heading:
       this article has two, and the later one is physically first in the table.
       `metaFrom`'s TypeScript half reads an array `blocksQuery` ordered, so the
       SQL half has to order too. */
    expect(entries.find((e) => e.slug === SLUG.untitled)?.title).toBe(FALLBACK_HEADING);
  });

  it("recomputes the scalars, loudly, when a published revision has none", async () => {
    const entries = await pgArticleReader.listArticles({ archived: false });
    const entry = entries.find((e) => e.slug === SLUG.unscalared);
    /* The right numbers, from the blocks and tree themselves — not zeroes, and
       not a dropped article. */
    expect({ words: entry?.words, blocks: entry?.blocks, parts: entry?.parts, gist: entry?.gist }).toEqual({
      words: 7,
      blocks: 2,
      parts: 1,
      gist: "Recomputed blurb.",
    });
    /* **One line, not one per article**, and it carries the count as well as
       the names — the shape docs/project/logging.md requires of anything whose
       output would otherwise grow with the shelf. */
    expect(warnings.length).toBe(1);
    const line = warnings[0];
    const count = Number(line?.fields.count);
    const named = (line?.fields.slugs as string[] | undefined) ?? [];
    expect({
      message: line?.message,
      mine: warnedMine().sort(),
      /* **Not an exact count.** Another suite's fixture can be on the shelf
         while this runs (vitest runs these files concurrently against one
         database), and if it has no scalars either it is in this same line —
         which is the behaviour, not a flaw in it. What has to hold is that
         there is one line, that it names the article, and that it carries a
         count at least as big as the names it managed to print. The cap on
         those names is the point of the count existing at all. */
      carriesACount: Number.isInteger(count) && count >= 1,
      countCoversTheNames: count >= named.length,
      namesAreCapped: named.length <= 5,
    }).toEqual({
      message: "published revisions have no library scalars; recomputing from their blocks",
      mine: [SLUG.unscalared, SLUG.unscalaredToo],
      carriesACount: true,
      countCoversTheNames: true,
      namesAreCapped: true,
    });
  });

  it("does not recompute an article that legitimately has no blurb", async () => {
    /* `deriveLibraryScalars` returns `rootGist: null` for an article with no
       root gist, no root summary and no excerpt. That is correct data. Treating
       it as "not computed yet" would send every shelf request back to reading
       the whole article, for ever, while logging a warning about nothing —
       which is what the plan said to do until GPT Sol's first finding. */
    const entries = await pgArticleReader.listArticles({ archived: false });
    const entry = entries.find((e) => e.slug === SLUG.gistless);
    expect({
      words: entry?.words,
      blocks: entry?.blocks,
      parts: entry?.parts,
      sections: entry?.sections,
    }).toEqual({ words: 0, blocks: 2, parts: 0, sections: 0 });
    expect("gist" in (entry ?? {})).toBe(false);
    expect(warnedMine()).not.toContain(SLUG.gistless);
  });

  it("still drops a published revision that has no blocks", async () => {
    /* The importer can produce one: it requires blocks.json to parse, then
       guards its insert with `if (blocks.length)`, so an empty array publishes
       a revision with no blocks and moves the pointer to it. The old code
       skipped it on `blocks.length` after reading them all; this one skips it
       on `block_count` without reading anything. */
    const entries = await pgArticleReader.listArticles({ archived: false });
    expect(entries.map((e) => e.slug)).not.toContain(SLUG.blockless);
  });
});

/* ------------------------------------------ the fourth spelling of one rule -- */

when("the title fallback, in SQL and in TypeScript", { timeout: 30_000 }, () => {
  /**
   * **A consistency check, not a correctness one**, and it says so because both
   * spellings were written from the same sentence by the same person on the
   * same day. What it catches is one of them drifting later — a `level = 2`, an
   * `order by block_id`, a `kind` that stops meaning what it meant.
   *
   * It runs over the real corpus in `data/`, imported into the database, rather
   * than over a fixture: the fixture above proves the rule under conditions
   * chosen to break it, and this proves the two implementations still agree
   * about eight real articles, one of which genuinely has no stored title.
   */
  it("agree about every article on the shelf", async () => {
    const all = await pgArticleReader.listArticles({ archived: false });
    /* **Real articles only.** Another suite's fixture can be renamed, archived
       or torn down *while this runs* — vitest runs these files concurrently
       against one database — so comparing two reads taken a moment apart
       against a moving row is not a test of anything. It cost a run to a
       fixture whose `title_override` was set between the two reads. */
    const entries = all.filter((e) => !e.slug.startsWith("test-"));
    expect(entries.length).toBeGreaterThan(0);

    const disagreements: { slug: string; sql: string; ts: string | null }[] = [];
    let compared = 0;
    for (const entry of entries) {
      /* `loadArticle` reads the blocks and applies `headingTitleOf` to them —
         the TypeScript half. `listArticles` never sees a block. Both then go
         through `titleFor`, so a reader's rename cannot make them differ. */
      let article: Awaited<ReturnType<typeof pgArticleReader.loadArticle>>;
      try {
        article = await pgArticleReader.loadArticle(entry.slug);
      } catch (err) {
        /* **Rethrown.** The first version caught everything, which meant that if
           the TypeScript title path started failing for the one article that
           exercises the fallback, that row was skipped and the test passed on
           the strength of the titled ones — swallowing exactly the failure it
           exists to expose. GPT Sol's fifth finding on the built code. Foreign
           fixtures, the only rows that can disappear mid-run, are filtered out
           above rather than caught here. */
        throw err;
      }
      compared++;
      if (article.meta.title !== entry.title) {
        disagreements.push({ slug: entry.slug, sql: entry.title, ts: article.meta.title });
      }
    }
    expect({ disagreements, compared: compared > 0 }).toEqual({ disagreements: [], compared: true });
  });

  it("and the corpus, where it has one, really does exercise the fallback", async () => {
    /* **Without this, the test above can be vacuous.** If every article in
       `data/` has a stored title, the two spellings agree by never being asked.
       The local corpus has one revision with a null title, so this asserts the
       card shows the article's heading rather than its slug — and where a corpus
       has none, it says so rather than quietly proving nothing. The fixture at
       the top of this file covers the case unconditionally. */
    const untitled = await getDb()
      .select({ slug: articles.slug })
      .from(articles)
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      .where(isNull(articleRevisions.title));
    /* **Real articles only**, for the same reason as the test above: another
       suite's fixture can be created, renamed or torn down between these two
       reads, and asserting that a row we do not own is still on the shelf is
       not a test of this code. `test-reader-state-parity` cost a run before the
       filter went from this file's own prefix to every fixture's. */
    const real = untitled.filter((r) => !r.slug.startsWith("test-"));
    if (!real.length) {
      console.warn("\n  ⚠ no article in data/ has a null title — the corpus half of this proves nothing\n");
      return;
    }
    const entries = await pgArticleReader.listArticles({ archived: false });
    for (const { slug } of real) {
      const entry = entries.find((e) => e.slug === slug);
      /* **Asserted, not skipped.** `if (!entry) continue` here would make the
         whole loop vacuous the moment the shelf stopped listing the article —
         which is one of the things this is supposed to catch. */
      expect({ slug, listed: Boolean(entry) }).toEqual({ slug, listed: true });
      expect({ slug, title: entry?.title }).not.toEqual({ slug, title: slug });
    }
  });
});

/* --------------------------------------- what parity can no longer tell you -- */

when("every published revision's stored scalars", { timeout: 60_000 }, () => {
  /**
   * **The guard that replaces one the parity test quietly stopped being.**
   *
   * `tests/store-parity.test.ts` is the strongest thing in this repo: it asks
   * both stores for every article in `data/` and compares what the client would
   * receive. It used to prove the shelf's five numbers, because the Postgres
   * side derived them from the rows and the filesystem side from the files.
   *
   * It cannot any more. The Postgres side now reads columns, and that suite
   * **imports every article immediately before comparing** — so the columns were
   * written from the same files, moments earlier, by the same function. A stale
   * column is invisible to it by construction. GPT Sol's third finding on the
   * built code, and it is right that the loss is real.
   *
   * So this checks the columns against the rows they describe, directly and for
   * every current revision in the database: recompute from the blocks and the
   * tree that are there *now*, and compare with what is stored. It catches a
   * writer that updates one without the other, which is the whole invariant the
   * shelf rests on — and it catches it even for an article the shelf's own
   * fallback would silently paper over.
   *
   * It reads blocks, so it is slow, and it is the one place here that should be.
   */
  it("describe the blocks and tree that are actually there", async () => {
    const db = getDb();
    const current = await db
      .select({
        slug: articles.slug,
        id: articleRevisions.id,
        tree: articleRevisions.tree,
        excerpt: articleRevisions.excerpt,
        wordCount: articleRevisions.wordCount,
        blockCount: articleRevisions.blockCount,
        partCount: articleRevisions.partCount,
        sectionCount: articleRevisions.sectionCount,
        rootGist: articleRevisions.rootGist,
      })
      .from(articles)
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId));

    /* **Real articles only**, and both halves of that are deliberate. This
       file's own fixtures are excluded because one has its scalars nulled on
       purpose and another has them deliberately wrong for the blockless case.
       Every *other* suite's are excluded because their columns are somebody
       else's to keep honest, and a red here for their fixture is a red in the
       wrong file — it happened, correctly, and the fix belonged in
       tests/store-shelf-pg.test.ts. What is left is `data/`, which is where the
       writers under test actually write. */
    const real = current.filter((r) => !r.slug.startsWith("test-"));
    expect(real.length).toBeGreaterThan(0);

    const wrong: { slug: string; stored: unknown; actual: unknown }[] = [];
    for (const row of real) {
      /* Null columns are a different failure — the shelf's fallback covers them
         and its own tests pin that. What this is about is a column that is
         present and wrong, which nothing else can see. */
      if (row.wordCount === null) continue;
      const blocks = await db
        .select({ words: revisionBlocks.words })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, row.id));
      const actual = deriveLibraryScalars({
        blocks,
        tree: row.tree as Parameters<typeof deriveLibraryScalars>[0]["tree"],
        excerpt: row.excerpt,
      });
      const stored = {
        wordCount: row.wordCount,
        blockCount: row.blockCount,
        partCount: row.partCount,
        sectionCount: row.sectionCount,
        rootGist: row.rootGist,
      };
      if (JSON.stringify(stored) !== JSON.stringify(actual)) {
        wrong.push({ slug: row.slug, stored, actual });
      }
    }
    expect(wrong).toEqual([]);
  });
});
