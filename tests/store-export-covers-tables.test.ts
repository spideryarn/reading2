/**
 * **A new table must not be able to arrive without EITHER export noticing — and
 * "we export that one" must be something the export was watched doing.**
 *
 * There are two projections of one article now, and they share only the query
 * walk in `src/store/article-rows.ts`: the rollback below, and
 * `src/store/export-bundle.ts`, the zip a reader downloads. So the coverage
 * record lives beside the *queries* rather than beside either projection — a
 * record kept beside one of them would only make that one answerable for a new
 * table — and every check here runs the same sentinel fixtures through both.
 * A projection that receives a row and discards it goes red on its own account.
 * docs/plans/260901h-export-article-data.md § Stage B.
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
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
/* **From the query layer, not from either projection.** That is the move this
   file is the guard for: the record is a claim about what happens to a row of
   one article, and both outputs read that article through `readArticleRows`. */
import {
  ARTICLE_TABLE_COVERAGE,
  type ArticleTable,
  type BundledTable,
  type RollbackTable,
  type TableCoverage,
} from "../src/store/article-rows.js";
import { articleBundle } from "../src/store/export-bundle.js";
import { type ExportResult, exportArticle } from "../src/store/export.js";
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

/** The two outputs, by the key each has in the coverage record. */
const PROJECTIONS = ["rollback", "bundle"] as const;
type Projection = (typeof PROJECTIONS)[number];

/** The tables the record says one projection writes, in one sorted list. */
function declaredIn(projection: Projection): ArticleTable[] {
  return (Object.entries(ARTICLE_TABLE_COVERAGE) as [ArticleTable, TableCoverage][])
    .filter(([, coverage]) => coverage[projection].exported)
    .map(([name]) => name)
    .sort();
}

describe("both exports know about every article-scoped table", () => {
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
      `src/store/article-rows.ts has never heard of ${missing.join(", ")}. ` +
        "Both exports read an article through it, and a table neither knows about " +
        "is dropped silently — each reports success and lists the files it did " +
        "write. Add an entry to ARTICLE_TABLE_COVERAGE with BOTH projections " +
        "answered: { rollback: …, bundle: … }, each either " +
        "{ exported: true, into: '<file>' } with the code to write it AND a " +
        "sentinel fixture below, or { exported: false, why: '<why that output " +
        "does not need it>' }.",
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

  it("gives every omission a reason written in words, for each output", () => {
    for (const [name, coverage] of Object.entries(ARTICLE_TABLE_COVERAGE)) {
      for (const projection of PROJECTIONS) {
        const destination = coverage[projection];
        if (destination.exported) continue;
        // A reason, not a shrug. "not needed" is what somebody writes when they
        // have not thought about it, and it is what the next reader has to
        // re-derive from scratch. Per projection, because the two leave things
        // out for different reasons — `block_identities` is recoverable from
        // the HTML a rollback writes, and load-bearing for a reader's anchors.
        expect(
          destination.why.length,
          `${name} is not in the ${projection} export and says why in too few words`,
        ).toBeGreaterThan(40);
      }
    }
  });

  it("answers for the bundle too, not only the rollback", () => {
    /* The alarm for the move itself. If `bundle` were ever quietly dropped from
       the record — a merge, a refactor, a `satisfies` that stopped biting —
       every loop above would still run and check the rollback alone, and the
       bundle would be back to having no guard at all while the file stayed
       green. */
    expect(declaredIn("bundle")).toContain("block_identities");
    expect(declaredIn("bundle").length).toBeGreaterThan(8);
  });
});

/* ---------------------------------------------------------- the list is true -- */

const SLUG = "store-export-coverage-fixture";
/* Moved off `…ea`/`…eb` on 2026-09-01: `tests/public-visibility-pg.test.ts` had
   claimed the same pair, which tests/fixture-ids.test.ts exists to catch. Its
   docstring has the reason this matters — the loser's article is deleted
   mid-run by the winner's `afterAll`, and the only symptom is a 404 over in
   whichever file lost, so it reads as a flake in somebody else's work. This
   file is the one that moved because the export coverage guard is load-bearing
   for docs/plans/260901h-export-article-data.md, and a guard that goes red for
   a reason that is not its own teaches people to ignore it. */
const ARTICLE_ID = "00000000-0000-4000-8000-00000000e5a0";
const REVISION_ID = "00000000-0000-4000-8000-00000000e5a1";
const BLOCK_ID = "spya-cvb234";
const CRITERION_ID = "spya-cvc234";

/**
 * A block id that has **left the article** — minted once, and no longer a block
 * of the current revision.
 *
 * The whole reason the bundle carries `block_identities` while the rollback does
 * not: a comment or a chat thread can still be anchored to this id, so a bundle
 * without it holds anchors pointing at nothing. It doubles as the sentinel for
 * that table, which has no free-text column to hide a string in.
 */
const DEPARTED_BLOCK_ID = "spya-cvj234";

/**
 * The string that has to survive the export, one per table.
 *
 * Distinct per table on purpose: `chat_threads` and `chat_messages` both declare
 * `chat.json`, and one sentinel for both would let either of them carry the
 * other. The prefix is nonsense so that finding it in a file means it came from
 * the row and not from a field name or a fixture path — except for
 * `block_identities`, whose only column worth checking is a block id and which
 * must therefore carry a well-formed one.
 */
function sentinel(table: string): string {
  return table === "block_identities" ? DEPARTED_BLOCK_ID : `sentinel-3f9c1e-${table}`;
}

/** One table's row, inserted with its sentinel somewhere a reader would keep. */
type Fixture = () => Promise<void>;

const owner = () => currentOwnerId();

/**
 * A row for every table **either** record calls exported.
 *
 * Typed `Record<RollbackTable | BundledTable, …>`, so declaring a new table
 * exported from either projection without writing a fixture for it does not
 * compile — and the test below says the same thing in words, because `npm test`
 * does not typecheck.
 */
function fixtures(): Record<RollbackTable | BundledTable, Fixture> {
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
    referee_claims: async () => {
      /* One row and no id — a referee asks the paper what it claims exactly
         once. The sentinel goes in `model` rather than in a claim, because a
         claim has to anchor to a block that exists and `Claim`'s shape is
         currently moving under another session; `model` is a plain exported
         column and the check here is "did this table's row reach that file",
         not "is a claim well formed". */
      await db.insert(schema.refereeClaims).values({
        articleId: ARTICLE_ID,
        ownerId: owner(),
        status: "done",
        claims: [],
        model: sentinel("referee_claims"),
      });
    },
    /* An id the article used to have. `beforeAll` already inserts the identity
       row for the block that is still there — this is the other kind, the one
       only the bundle carries. */
    block_identities: async () => {
      await db
        .insert(schema.blockIdentities)
        .values({ articleId: ARTICLE_ID, blockId: sentinel("block_identities") })
        .onConflictDoNothing();
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

/* ------------------------------------------------ the list is true, column by column -- */

/**
 * **The sentinel check above is table-level, and a table-level check cannot see
 * a dropped column.**
 *
 * GPT Sol said so while reviewing the plan — "table-level, not column-level; it
 * cannot see a dropped column" — and Stage B fixed only the other half of it,
 * the projection that receives a row and discards it. What was left is exactly
 * how the `article_revisions` bug survived Stage C. That table has forty-six
 * columns: fifteen are files of their own in the zip, **one** — `title` — was in
 * `manifest.json`, and the other thirty were in no file at all, `byline`,
 * `siteName`, `excerpt`, `publishedAt` and `wordCount` among them. The sentinel
 * went into `title`. One column out of forty-six satisfied the check for the
 * whole table, and every test in the suite was green.
 *
 * So: for each table the record says the bundle exports, compare the keys the
 * bundle **actually emitted** against `getTableColumns` — the schema, read at
 * runtime, never a second list — and require every difference to be declared
 * below in words. Both directions, because a note claiming a column is left out
 * while it ships is the same drift the other way round.
 *
 * ## Why this covers the bundle and not the rollback
 *
 * The bundle serialises whole rows, so its keys **are** column names and a key
 * comparison is meaningful. The rollback's projection is hand-listed by design
 * and renames as it goes — `extract_method` lands as `method`, `final_url` as
 * `url`, and `meta.json` is a `Meta`, not a row — so there is no key set to
 * compare against, and `tests/store-roundtrip.test.ts` already pins its output
 * byte for byte against what the filesystem store writes. A key check there
 * would either be a third copy of those field lists or vacuous. It is
 * deliberately not attempted.
 */

/**
 * The columns `export-bundle.ts` strips from **every** row, and why in words.
 *
 * Deliberately a second, independently-written copy of that file's
 * `OURS_NOT_THEIRS` rather than an import of it: a guard that reads its answer
 * out of the code it is guarding agrees with that code by construction. Dropping
 * one of these from the bundle turns the `stale` check below red, which is the
 * point.
 */
const DROPPED_EVERYWHERE: Readonly<Record<string, string>> = {
  ownerId: "An auth uuid that says nothing about the article, and is not the reader's data.",
  articleId: "An internal key. The zip is one article, and nothing in it is addressed by this.",
  revisionId: "An internal key. The zip is one revision, and nothing in it is addressed by this.",
  fts: "A generated tsvector: a search index, unreadable, and big enough to double blocks.json.",
};

/**
 * Per table, the columns the bundle deliberately keeps out of its row JSON —
 * each with the reason, in the same "say it in words" style the coverage record
 * itself uses. A shrug is not a reason: the next reader has to be able to tell
 * a decision from an oversight, which is the whole failure this file exists for.
 */
const COLUMNS_LEFT_OUT: Record<BundledTable, Readonly<Record<string, string>>> = {
  articles: {
    id: "An internal uuid naming nothing else in the zip; `shortId` is the reader-facing one.",
    currentRevisionId: "An internal uuid, and the zip holds exactly that revision already.",
    fixture: "Says this is the shipped demo article — about our deployment, not the reader's data.",
  },
  article_revisions: {
    id: "An internal uuid. `basedOnRevisionId` is kept because lineage is a fact about the piece.",
    stampedHtml: "Written whole as content/stamped.html — the one file a reader opens.",
    extractedHtml: "Written whole as content/extracted.html.",
    assets: "Written whole as content/assets.json, the image manifest.",
    tree: "Written whole as augmentations/tree.json.",
    arc: "Written whole as augmentations/arc.json.",
    tweets: "Written whole as augmentations/tweets.json.",
    glossary: "Written whole as augmentations/glossary.json.",
    ideas: "Written whole as augmentations/ideas.json.",
    quotes: "Written whole as augmentations/quotes.json.",
    timeline: "Written whole as augmentations/timeline.json.",
    quiz: "Written whole as augmentations/quiz.json.",
    sketch: "Written whole as augmentations/sketch.json.",
    labels: "Written whole as augmentations/labels.json.",
  },
  revision_blocks: {},
  block_identities: {},
  comments: {},
  chat_threads: {},
  chat_messages: {
    threadId: "Each message is nested inside its thread in chat.json, so the key would be noise.",
  },
  search_runs: {},
  referee_criteria: {},
  referee_claims: {},
  glossary_lookups: {},
};

/** A property of `value`, or `undefined` if it is not an object. */
function at(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

/** The array under `key`, or empty — an alarm the caller reads as "found nothing". */
function listAt(value: unknown, key: string): unknown[] {
  const found = at(value, key);
  return Array.isArray(found) ? found : [];
}

/**
 * Where one table's rows sit inside the file `ARTICLE_TABLE_COVERAGE` names for
 * it — the only hand-written thing here, and it is about the *shape of the
 * file*, not about which columns are in it.
 *
 * Keyed by the record's own destination rather than by a path written twice, so
 * a table whose `into` changes is read out of the file it now claims.
 */
const ROWS_IN: Record<BundledTable, (parsed: unknown) => unknown[]> = {
  articles: (parsed) => [parsed],
  article_revisions: (parsed) => [parsed],
  revision_blocks: (parsed) => listAt(parsed, "blocks"),
  block_identities: (parsed) => listAt(parsed, "identities"),
  comments: (parsed) => listAt(parsed, "comments"),
  chat_threads: (parsed) => listAt(parsed, "threads"),
  chat_messages: (parsed) =>
    listAt(parsed, "threads").flatMap((thread) => listAt(thread, "messages")),
  search_runs: (parsed) => listAt(parsed, "runs"),
  referee_criteria: (parsed) => listAt(parsed, "criteria"),
  referee_claims: (parsed) => [at(parsed, "run")],
  glossary_lookups: (parsed) => listAt(parsed, "lookups"),
};

/** Every key any of these rows carries. */
function keysOf(rows: readonly unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    for (const key of Object.keys(row)) keys.add(key);
  }
  return keys;
}

/** Every drizzle table by its SQL name — from the schema, not from a list. */
function tablesByName(): Map<string, PgTable> {
  return new Map(schemaTables().map((table) => [getTableName(table), table]));
}

/**
 * The bundled tables the two records above can actually answer for.
 *
 * `declaredIn` is typed over every table in the record, so this narrows. **A
 * table it filters out is skipped in silence**, which is the shape of thing this
 * file exists to prevent — so the `it` above holds `declaredIn("bundle")`
 * against these two records and goes red before this ever quietly shrinks.
 */
function checkableBundledTables(): BundledTable[] {
  return declaredIn("bundle").filter(
    (table): table is BundledTable => table in ROWS_IN && table in COLUMNS_LEFT_OUT,
  );
}

const { reachable } = await pgReady({
  suite: "tests/store-export-covers-tables.test.ts",
  tables: [
    "spideryarn.referee_criteria",
    "spideryarn.referee_claims",
    "spideryarn.glossary_lookups",
  ],
});

const when = reachable ? describe : describe.skip;

when("what the record calls exported, both exports were watched writing", () => {
  let out: string;
  let result: ExportResult;
  /** Every entry of the reader's zip, decoded — path to text. */
  let bundled: Map<string, string>;

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
    /* **The same fixtures through both projections.** One article, one set of
       rows, two outputs — which is the only way to catch a projection that
       receives a row and drops it, since each looks perfectly healthy on its
       own. GPT Sol's suggestion, and stronger than what either had. */
    result = await exportArticle(SLUG, { dataRoot: out, outputRoot: path.join(out, "output") });
    const bundle = await articleBundle(SLUG);
    const decoder = new TextDecoder();
    bundled = new Map(
      Object.entries(unzipSync(bundle.bytes)).map(([name, bytes]) => [
        name,
        decoder.decode(bytes),
      ]),
    );
  });

  afterAll(async () => {
    const db = getDb();
    // Children first: `comments_criterion_fk` is `no action`, so a criterion
    // still pointed at refuses to go.
    await db.delete(schema.comments).where(eq(schema.comments.articleId, ARTICLE_ID));
    await db
      .delete(schema.refereeCriteria)
      .where(eq(schema.refereeCriteria.articleId, ARTICLE_ID));
    await db.delete(schema.refereeClaims).where(eq(schema.refereeClaims.articleId, ARTICLE_ID));
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

  it("has a sentinel row for every table either output calls exported", () => {
    const written = Object.keys(fixtures());
    const missing = [...new Set(PROJECTIONS.flatMap(declaredIn))]
      .filter((table) => !written.includes(table))
      .sort();
    expect(
      missing,
      `ARTICLE_TABLE_COVERAGE calls ${missing.join(", ")} exported and nothing here ` +
        "puts a row in it, so the checks below would pass over it in silence. Add a " +
        "fixture to `fixtures()` that inserts one row carrying `sentinel('<table>')` " +
        "somewhere an export would keep it.",
    ).toEqual([]);
  });

  /**
   * The half that stops the record becoming a wish, and the reason it reads the
   * output rather than the source: adding a name to the list is one edit and
   * wiring the export is another, and a declaration that says "exported" while
   * nothing writes the row is worse than no declaration — it reads as the check
   * having been done.
   *
   * **One `it` per projection, over one shared set of fixtures.** Two tests
   * rather than a loop inside one, so a failure names which output lost the row:
   * "the bundle dropped `chat_messages`" and "the rollback dropped
   * `chat_messages`" are different bugs in different files.
   */
  for (const projection of PROJECTIONS) {
    it(`puts each table's own row into the file the ${projection} declares`, async () => {
      const read =
        projection === "rollback"
          ? (into: string) => readFile(path.join(out, SLUG, into), "utf8").catch(() => null)
          : async (into: string) => bundled.get(into) ?? null;

      /* An alarm on the reader itself, not on the export. A `read` that always
         answered `null` — a wrong root, an empty zip — would turn every
         assertion below into a failure that reads as the export's fault, and a
         `read` that somehow always answered the whole output would pass
         everything. Ask it for something that must exist and something that
         must not, first. */
      expect(await read(projection === "rollback" ? "meta.json" : "manifest.json")).not.toBeNull();
      expect(await read("no-such-file.json")).toBeNull();

      for (const table of declaredIn(projection)) {
        const destination = ARTICLE_TABLE_COVERAGE[table][projection];
        /* Narrowing for the compiler; `declaredIn` already filtered. */
        if (!destination.exported) continue;
        const { into } = destination;
        const text = await read(into);
        expect(
          text,
          `ARTICLE_TABLE_COVERAGE says ${table} goes into ${into} in the ` +
            `${projection}, and the ${projection} wrote no ${into} at all. The ` +
            "declaration is a claim about that output; write the code that makes " +
            "it true, or change the entry to { exported: false, why: … }.",
        ).not.toBeNull();
        expect(
          text?.includes(sentinel(table)) ?? false,
          `ARTICLE_TABLE_COVERAGE says ${table} goes into ${into} in the ` +
            `${projection}, but the row this test put in ${table} is not in the ` +
            `${into} it wrote. Either nothing reads that table, or its rows are ` +
            "going somewhere other than the file declared here — and a projection " +
            "that receives a row and discards it reports success and lists the " +
            "files it did write.",
        ).toBe(true);
      }
    });
  }

  it("has a column list and a row-finder for every table the bundle exports", () => {
    /* The typed `Record<BundledTable, …>` above says this at compile time, and
       `npm test` does not typecheck — the same reason the fixture check exists. */
    const declared = declaredIn("bundle");
    const missing = declared.filter(
      (table) => !(table in COLUMNS_LEFT_OUT) || !(table in ROWS_IN),
    );
    expect(
      missing,
      `ARTICLE_TABLE_COVERAGE calls ${missing.join(", ")} exported by the bundle ` +
        "and the column check below has no entry for it, so it would be skipped " +
        "in silence. Add one to COLUMNS_LEFT_OUT (`{}` if the bundle keeps every " +
        "column) and one to ROWS_IN saying where its rows sit in the file.",
    ).toEqual([]);
    for (const [table, columns] of Object.entries(COLUMNS_LEFT_OUT)) {
      for (const [column, why] of Object.entries(columns)) {
        // A reason, not a shrug — same rule as the table-level omissions.
        expect(
          why.length,
          `${table}.${column} is left out of the bundle and says why in too few words`,
        ).toBeGreaterThan(30);
      }
    }
  });

  it("puts every column of every table it exports into the zip, or says why not", () => {
    /* The check the sentinel above cannot make. One string in one column proves
       the table was read; it proves nothing about the other forty-five. */
    const tables = tablesByName();
    for (const table of checkableBundledTables()) {
      const destination = ARTICLE_TABLE_COVERAGE[table].bundle;
      /* Narrowing for the compiler; `declaredIn` already filtered. */
      if (!destination.exported) continue;
      const drizzle = tables.get(table);
      expect(drizzle, `src/db/schema.ts has no table called ${table}`).toBeDefined();
      if (!drizzle) continue;

      const text = bundled.get(destination.into);
      expect(text, `the bundle wrote no ${destination.into}`).toBeDefined();
      const rows = ROWS_IN[table](JSON.parse(text ?? "null"));
      const emitted = keysOf(rows);
      /* The reader's own alarm. A row-finder that has fallen out of step with
         the file's shape finds nothing, and "found nothing" would otherwise read
         as "the bundle dropped every column" — a true-looking failure pointing
         at the wrong file. */
      expect(
        emitted.size,
        `ROWS_IN[${table}] found no row objects in ${destination.into}. That is ` +
          "this test being wrong about the file's shape, not the bundle being " +
          "wrong about the table.",
      ).toBeGreaterThan(0);

      const left = { ...DROPPED_EVERYWHERE, ...COLUMNS_LEFT_OUT[table] };
      const columns = Object.keys(getTableColumns(drizzle));
      const dropped = columns.filter((column) => !emitted.has(column) && !(column in left));
      expect(
        dropped,
        `${table} loses ${dropped.join(", ")} on the way into ${destination.into}. ` +
          "The bundle is meant to serialise whole rows, so a column added to " +
          "src/db/schema.ts reaches the reader without anybody remembering it. " +
          "Either serialise the row (rowJson) rather than naming fields, or add " +
          "the column to COLUMNS_LEFT_OUT with the reason in words.",
      ).toEqual([]);

      const stale = Object.keys(left).filter(
        (column) => emitted.has(column) && columns.includes(column),
      );
      expect(
        stale,
        `COLUMNS_LEFT_OUT/DROPPED_EVERYWHERE say ${table} leaves out ` +
          `${stale.join(", ")}, and ${destination.into} carries it. A note that ` +
          "claims a column is dropped while it ships is the same drift the other " +
          "way round: delete the entry.",
      ).toEqual([]);
    }
  });

  it("reports every declared table among the ones the rollback actually wrote", () => {
    /* `ExportResult.tables` is appended to by `put` as the export runs, so it is
       what happened rather than what was declared. It catches the case the
       sentinel search cannot: a file written from the right rows by code that
       never names the table, which leaves the two lists agreeing by luck.

       The bundle has no equivalent and needs none — it writes whole rows rather
       than attributing writes, so there is no second list there to fall out of
       step. */
    const missing = declaredIn("rollback").filter(
      (table) => !(result.tables as readonly string[]).includes(table),
    );
    expect(
      missing,
      `db:export finished without recording a write from ${missing.join(", ")}, ` +
        "which ARTICLE_TABLE_COVERAGE calls exported by the rollback. Pass the " +
        "table name to `put(…)` at the call that writes its rows.",
    ).toEqual([]);
    // And the run has to have done something at all — an empty result would
    // satisfy every `filter` above.
    expect(result.files.length).toBeGreaterThan(5);
    expect(bundled.size).toBeGreaterThan(5);
  });
});
