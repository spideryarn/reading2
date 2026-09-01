/**
 * **A new table must not be able to arrive without the rollback noticing — and
 * "we export that one" must be something the export was watched doing.**
 *
 * `src/store/export.ts` is the rollback: `npm run db:export` writes Postgres
 * back out as `data/<slug>/`, and it is the only thing standing between a
 * migration to Postgres and a decision nobody can undo. It reads a hand-written
 * list of tables, which means a table added to `src/db/schema.ts` is invisible
 * to it, and an exporter that has never heard of a table behaves *exactly* like
 * one that has nothing to say about it: it writes its files, logs a count, and
 * reports success.
 *
 * That is what happened to `referee_criteria` on 2026-08-31. The table landed,
 * the store landed, the routes landed, and `db:export` silently dropped every
 * criterion a referee had written. Nothing failed, nothing warned, and no test
 * in the suite could have gone red — the round-trip test compares the artefacts
 * it knows about, so a file that is never written is a file it never misses.
 * docs/reusable/silent-success.md § "A round-trip test over a corpus missing the
 * field".
 *
 * ## Two halves, because the two claims fail differently
 *
 * **Is the list complete?** — schema-derived, no database. Every table that
 * reaches an article, found by reading `src/db/schema.ts` at runtime rather than
 * by keeping a second copy of the names, must appear in `ARTICLE_TABLE_COVERAGE`
 * saying either which file it exports into or, in words, why it does not.
 *
 * **Is the list true?** — behavioural, needs Postgres. Every table the record
 * calls exported gets a row with a sentinel string in it, the export runs, and
 * that string has to come back out of the file the record names.
 *
 * The second half used to be a search of `src/store/export.ts` for
 * `put("<filename>"`, and GPT Sol was right that it was theatre: it tied a table
 * to a *string in the source*, not to a query, a projection or a serialized
 * value. Two edits satisfied it while exporting nothing — declare a new table
 * into an existing file such as `comments.json`, or write
 * `// TODO: put("new-file.json", …)`, since comments are not stripped. A
 * sentinel row that has to survive a real export cannot be faked by either.
 *
 * **The trade that made:** the "actually writes" half now skips where there is
 * no database, where the source scan always ran. A check that always runs and
 * proves nothing is not the safer of those two — it is the more dangerous one,
 * because it reads as the check having been done. `pgReady` says out loud when
 * it skips, and `REQUIRE_POSTGRES=1` turns the skip into a failure.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import {
  ARTICLE_TABLE_COVERAGE,
  type ExportResult,
  type ExportedTable,
  exportArticle,
} from "../src/store/export.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* ------------------------------------------------------ the list is complete -- */

/** Every drizzle table in `src/db/schema.ts`, in declaration order. */
function schemaTables(): PgTable[] {
  const tables: PgTable[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value as never, PgTable)) continue;
    tables.push(value as unknown as PgTable);
  }
  return tables;
}

/**
 * Every table in the schema that hangs off an article, by SQL name.
 *
 * **Derived, never listed.** A second hand-written list beside the schema is
 * the thing this file exists to make impossible — see
 * docs/reusable/silent-success.md § "Never write a 'should I emit this?'
 * condition as a second list beside the data".
 *
 * **In scope is anything that reaches `articles` at all**, not only what carries
 * an `article_id`. The first version tested for the column, and GPT Sol pointed
 * out on 2026-09-01 that this makes silence the default for the next child
 * table: a row keyed only by `criterion_id`, `thread_id` or `revision_id` is one
 * article's data in substance and invisible to a column test. It already had a
 * live example — `revision_step_runs`, keyed by `revision_id` alone. So the
 * closure walks foreign keys outward from `articles` until it stops growing, and
 * a child of a child is in scope for the same reason its parent is.
 *
 * `articles` itself is in the set rather than excluded: its own columns are the
 * reader's shelf state, and `shelf.json` is written from them.
 */
function articleScopedTables(): string[] {
  const tables = schemaTables();
  const scoped = new Set<string>(["articles"]);
  for (const table of tables) {
    if ("articleId" in getTableColumns(table)) scoped.add(getTableName(table));
  }
  /* Fixpoint, because a table's parent may be found after it is. Small enough
     that the loop is cheaper to read than a topological sort. */
  for (let grew = true; grew; ) {
    grew = false;
    for (const table of tables) {
      const name = getTableName(table);
      if (scoped.has(name)) continue;
      for (const fk of getTableConfig(table).foreignKeys) {
        if (!scoped.has(getTableName(fk.reference().foreignTable))) continue;
        scoped.add(name);
        grew = true;
        break;
      }
    }
  }
  return [...scoped].sort();
}

describe("the rollback knows about every article-scoped table", () => {
  it("finds the tables by looking at the schema, not at a list", () => {
    /* The collector's own alarm. A `getTableColumns` that stopped recognising
       drizzle tables, or an import that resolved to an empty module, would
       return `[]` — and every assertion below would then pass forever while
       checking nothing. A collector that matches nothing passes every assertion
       about its contents. */
    const found = articleScopedTables();
    expect(found.length).toBeGreaterThan(8);
    expect(found).toContain("comments");
    expect(found).toContain("referee_criteria");
  });

  it("follows a foreign key, so a child table cannot hide behind its parent", () => {
    /* The alarm for the *second* half of the collector specifically. Everything
       above is satisfied by the column test alone, so without this the closure
       could break — a drizzle upgrade moving `foreignKeys`, an inline
       `.references()` that stops being collected — and the list would silently
       shrink back to "tables with an article_id" while staying green.

       `revision_step_runs` is the case: `revision_id` and no `article_id`. */
    const found = articleScopedTables();
    expect(getTableColumns(schema.revisionStepRuns)).not.toHaveProperty("articleId");
    expect(found).toContain("revision_step_runs");
  });

  it("names every one of them, so a new table cannot arrive quietly", () => {
    const missing = articleScopedTables().filter((name) => !(name in ARTICLE_TABLE_COVERAGE));
    expect(
      missing,
      `src/store/export.ts has never heard of ${missing.join(", ")}. ` +
        "db:export is the rollback, and a table it does not know about is dropped " +
        "silently — it reports success and lists the files it did write. Add an " +
        "entry to ARTICLE_TABLE_COVERAGE: either { exported: true, into: '<file>.json' } " +
        "with the code to write it AND a sentinel fixture below, or " +
        "{ exported: false, why: '<why a rollback of data/ does not need it>' }.",
    ).toEqual([]);
  });

  it("names nothing that is not a table any more", () => {
    /* The other direction. A renamed or dropped table leaves an entry here that
       reads as coverage and covers nothing, which is how a list beside the data
       goes wrong in the quiet direction. */
    const scoped = new Set(articleScopedTables());
    const stale = Object.keys(ARTICLE_TABLE_COVERAGE).filter((name) => !scoped.has(name));
    expect(
      stale,
      `ARTICLE_TABLE_COVERAGE names ${stale.join(", ")}, which is not an ` +
        "article-scoped table in src/db/schema.ts any more. Delete the entry, or " +
        "fix the name.",
    ).toEqual([]);
  });

  it("gives every omission a reason written in words", () => {
    for (const [name, coverage] of Object.entries(ARTICLE_TABLE_COVERAGE)) {
      if (coverage.exported) continue;
      // A reason, not a shrug. "not needed" is what somebody writes when they
      // have not thought about it, and it is what the next reader has to
      // re-derive from scratch.
      expect(
        coverage.why.length,
        `${name} is not exported and says why in too few words`,
      ).toBeGreaterThan(40);
    }
  });
});

/* ---------------------------------------------------------- the list is true -- */

const SLUG = "store-export-coverage-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000ea";
const REVISION_ID = "00000000-0000-4000-8000-0000000000eb";
const BLOCK_ID = "spya-cvb234";
const CRITERION_ID = "spya-cvc234";

/**
 * The string that has to survive the export, one per table.
 *
 * Distinct per table on purpose: `chat_threads` and `chat_messages` both declare
 * `chat.json`, and one sentinel for both would let either of them carry the
 * other. The prefix is nonsense so that finding it in a file means it came from
 * the row and not from a field name or a fixture path.
 */
function sentinel(table: string): string {
  return `sentinel-3f9c1e-${table}`;
}

/** One table's row, inserted with its sentinel somewhere a reader would keep. */
type Fixture = () => Promise<void>;

const owner = () => currentOwnerId();

/**
 * A row for every table the record calls exported.
 *
 * Typed `Record<ExportedTable, …>`, so declaring a new table exported without
 * writing a fixture for it does not compile — and the test below says the same
 * thing in words, because `npm test` does not typecheck.
 */
function fixtures(): Record<ExportedTable, Fixture> {
  const db = getDb();
  return {
    /* The article's own row: the shelf state, and `purpose` is the reader's own
       words. It went missing from this export once already. */
    articles: async () => {
      await db
        .update(schema.articles)
        .set({ purpose: sentinel("articles") })
        .where(eq(schema.articles.id, ARTICLE_ID));
    },
    article_revisions: async () => {
      await db
        .update(schema.articleRevisions)
        .set({ title: sentinel("article_revisions") })
        .where(eq(schema.articleRevisions.id, REVISION_ID));
    },
    revision_blocks: async () => {
      await db.insert(schema.revisionBlocks).values({
        articleId: ARTICLE_ID,
        revisionId: REVISION_ID,
        blockId: BLOCK_ID,
        ordinal: 0,
        tag: "p",
        kind: "text",
        text: sentinel("revision_blocks"),
        words: 1,
        html: `<p>${sentinel("revision_blocks")}</p>`,
        gistable: true,
      });
    },
    comments: async () => {
      await db.insert(schema.comments).values({
        articleId: ARTICLE_ID,
        id: "spya-cvm234",
        ownerId: owner(),
        blockId: BLOCK_ID,
        quote: "a stretch of prose",
        start: 0,
        body: sentinel("comments"),
        status: "none",
      });
    },
    chat_threads: async () => {
      await db.insert(schema.chatThreads).values({
        articleId: ARTICLE_ID,
        id: "spya-cvt234",
        ownerId: owner(),
        title: sentinel("chat_threads"),
        kind: "chat",
      });
    },
    chat_messages: async () => {
      await db.insert(schema.chatMessages).values({
        articleId: ARTICLE_ID,
        threadId: "spya-cvt234",
        id: "spya-cvu234",
        ordinal: 0,
        role: "user",
        text: sentinel("chat_messages"),
        status: "done",
      });
    },
    search_runs: async () => {
      await db.insert(schema.searchRuns).values({
        articleId: ARTICLE_ID,
        id: "spya-cvs234",
        ownerId: owner(),
        criterion: sentinel("search_runs"),
        status: "done",
      });
    },
    referee_criteria: async () => {
      await db.insert(schema.refereeCriteria).values({
        articleId: ARTICLE_ID,
        id: CRITERION_ID,
        ownerId: owner(),
        kind: "diverging",
        criterion: sentinel("referee_criteria"),
        poleAgainst: "the controls are inadequate",
        poleFavour: "the controls are adequate",
        scale: "rg",
        status: "done",
      });
    },
    glossary_lookups: async () => {
      await db.insert(schema.glossaryLookups).values({
        articleId: ARTICLE_ID,
        entryId: "spya-cvg234",
        ownerId: owner(),
        answer: sentinel("glossary_lookups"),
        searches: 0,
        model: "test",
        at: new Date(),
      });
    },
  };
}

/** The tables the record says are exported, in one sorted list. */
function declaredExported(): ExportedTable[] {
  return (Object.entries(ARTICLE_TABLE_COVERAGE) as [ExportedTable, { exported: boolean }][])
    .filter(([, coverage]) => coverage.exported)
    .map(([name]) => name)
    .sort();
}

const { reachable } = await pgReady({
  suite: "tests/store-export-covers-tables.test.ts",
  tables: ["spideryarn.referee_criteria", "spideryarn.glossary_lookups"],
});

const when = reachable ? describe : describe.skip;

when("what the record calls exported, the export was watched writing", () => {
  let out: string;
  let result: ExportResult;

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(schema.articles)
      .values({ id: ARTICLE_ID, ownerId: owner(), slug: SLUG })
      .onConflictDoNothing();
    await db
      .insert(schema.articleRevisions)
      .values({ id: REVISION_ID, articleId: ARTICLE_ID, status: "published" })
      .onConflictDoNothing();
    await db
      .update(schema.articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(schema.articles.id, ARTICLE_ID));
    await db
      .insert(schema.blockIdentities)
      .values({ articleId: ARTICLE_ID, blockId: BLOCK_ID })
      .onConflictDoNothing();

    /* Every fixture, as a loop rather than nine calls — a loop cannot quietly
       skip the table somebody just added, and the test below holds the set of
       fixtures against the set the record declares.

       **In `fixtures()`' own order, not sorted**: a message needs its thread,
       and alphabetical order puts `chat_messages` first. */
    for (const fixture of Object.values(fixtures())) await fixture();

    out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-coverage-"));
    result = await exportArticle(SLUG, { dataRoot: out, outputRoot: path.join(out, "output") });
  });

  afterAll(async () => {
    const db = getDb();
    // Children first: `comments_criterion_fk` is `no action`, so a criterion
    // still pointed at refuses to go.
    await db.delete(schema.comments).where(eq(schema.comments.articleId, ARTICLE_ID));
    await db
      .delete(schema.refereeCriteria)
      .where(eq(schema.refereeCriteria.articleId, ARTICLE_ID));
    await db.delete(schema.chatMessages).where(eq(schema.chatMessages.articleId, ARTICLE_ID));
    await db.delete(schema.chatThreads).where(eq(schema.chatThreads.articleId, ARTICLE_ID));
    await db.delete(schema.searchRuns).where(eq(schema.searchRuns.articleId, ARTICLE_ID));
    await db
      .delete(schema.glossaryLookups)
      .where(eq(schema.glossaryLookups.articleId, ARTICLE_ID));
    await db.delete(schema.revisionBlocks).where(eq(schema.revisionBlocks.articleId, ARTICLE_ID));
    await db
      .update(schema.articles)
      .set({ currentRevisionId: null })
      .where(eq(schema.articles.id, ARTICLE_ID));
    await db
      .delete(schema.articleRevisions)
      .where(eq(schema.articleRevisions.id, REVISION_ID));
    await db
      .delete(schema.blockIdentities)
      .where(eq(schema.blockIdentities.articleId, ARTICLE_ID));
    await db.delete(schema.articles).where(eq(schema.articles.id, ARTICLE_ID));
    await closeDb();
    if (out) await rm(out, { recursive: true, force: true });
  });

  it("has a sentinel row for every table it calls exported", () => {
    const written = Object.keys(fixtures());
    const missing = declaredExported().filter((table) => !written.includes(table));
    expect(
      missing,
      `ARTICLE_TABLE_COVERAGE calls ${missing.join(", ")} exported and nothing here ` +
        "puts a row in it, so the check below would pass over it in silence. Add a " +
        "fixture to `fixtures()` that inserts one row carrying `sentinel('<table>')` " +
        "somewhere the export would keep it.",
    ).toEqual([]);
  });

  it("puts each table's own row into the file that table declares", async () => {
    /* The half that stops the record becoming a wish, and the reason it reads a
       file rather than the source: adding a name to the list is one edit and
       wiring the export is another, and a declaration that says "exported"
       while nothing writes the row is worse than no declaration — it reads as
       the check having been done. */
    for (const table of declaredExported()) {
      const coverage = ARTICLE_TABLE_COVERAGE[table];
      /* Narrowing for the compiler; `declaredExported` already filtered. */
      if (!coverage.exported) continue;
      const file = path.join(out, SLUG, coverage.into);
      const text = await readFile(file, "utf8").catch(() => null);
      expect(
        text,
        `ARTICLE_TABLE_COVERAGE says ${table} is exported into ${coverage.into}, ` +
          `and db:export wrote no ${coverage.into} at all. The declaration is a ` +
          "claim about the rollback; write the code that makes it true, or change " +
          "the entry to { exported: false, why: … }.",
      ).not.toBeNull();
      expect(
        text?.includes(sentinel(table)) ?? false,
        `ARTICLE_TABLE_COVERAGE says ${table} is exported into ${coverage.into}, ` +
          `but the row this test put in ${table} is not in the ${coverage.into} ` +
          "db:export wrote. Either nothing reads that table, or its rows are going " +
          "somewhere other than the file declared here. A rollback that drops a " +
          "table reports success and lists the files it did write.",
      ).toBe(true);
    }
  });

  it("reports every declared table among the ones it actually wrote", () => {
    /* `ExportResult.tables` is appended to by `put` as the export runs, so it is
       what happened rather than what was declared. It catches the case the
       sentinel search cannot: a file written from the right rows by code that
       never names the table, which leaves the two lists agreeing by luck. */
    const missing = declaredExported().filter((table) => !result.tables.includes(table));
    expect(
      missing,
      `db:export finished without recording a write from ${missing.join(", ")}, ` +
        "which ARTICLE_TABLE_COVERAGE calls exported. Pass the table name to " +
        "`put(…)` at the call that writes its rows.",
    ).toEqual([]);
    // And the run has to have done something at all — an empty result would
    // satisfy every `filter` above.
    expect(result.files.length).toBeGreaterThan(5);
  });
});
