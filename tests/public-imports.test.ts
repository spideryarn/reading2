/**
 * **What a request from a stranger can reach**, as an import graph.
 *
 * GPT Sol asked for this by name, 2026-08-28:
 *
 * > A transitive-import test, modelled on `tests/client-imports.test.ts`,
 * > starting at `src/public/routes.ts`. It must not reach `src/api.ts`,
 * > `src/store/index.ts`, `src/store/pg.ts`, writer modules, or any AI/gateway
 * > root.
 *
 * The first three are about **leaks**: `src/api.ts` runs the meta through
 * `titleFor()`, `pg.ts`'s `blocksQuery` selects per-block `note` and its
 * glossary read joins `glossary_lookups`. Every one of those is correct for the
 * owner and is somebody's private data here. The last two are about **money**:
 * Greg's rule is that no logged-out visitor causes a paid call, and a module
 * that cannot be reached cannot be called by mistake.
 *
 * ## Two things this test is honest about
 *
 * **It follows runtime imports only.** `import type` erases at compile time and
 * cannot call anything, and this matters immediately rather than in theory:
 * `src/db/schema.ts` does `import type { LabelsFile } from "../labels.js"` for
 * one `jsonb().$type<…>()`, and `src/labels.ts` is a model pass that reaches
 * the whole gateway. Counting that would make the check unpassable for every
 * store module in the repo, including `pg.ts`, and would say nothing true about
 * what a request can do. Written down because a walker that ignores `type` is
 * exactly the kind of leniency that should be argued for rather than noticed.
 *
 * **A static graph is not the whole proof, which is why it is not the whole
 * check.** docs/plans/260827ai-public-read-only-access.md already records the first
 * draft's mistake here — it proposed a static "no public file imports the
 * gateway" test and Sol pointed out `src/api.ts` imports the writers, so the
 * test could not pass. The runtime gateway spy in
 * tests/public-visibility-pg.test.ts is the half that watches what actually
 * happens; this half is what stops somebody adding the import in the first
 * place.
 *
 * ## The positive control is in the test, not in a note
 *
 * The last case walks the same function from `src/routes.ts` and asserts it
 * **does** reach the forbidden modules. So "the public graph is clean" and "the
 * walker can see a dirty graph" are checked in the same run, and a walker
 * broken into always returning nothing fails rather than passing twice. That is
 * docs/reusable/silent-success.md applied to the check itself.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/* **The walker moved to a helper on 2026-09-04**, unchanged, because a second
   guard came to need the same walk: tests/owner-isolation.test.ts § ownerless
   enumeration inventories every `.from(articles)` query in this same graph. Two
   copies would be two sets of rules about what counts as an import. The
   reasoning about the walk's shape stays here, in the header above, because that
   is where the rule is stated. */
import { graphFrom, PUBLIC_ENTRIES, publicFiles, ROOT } from "./helpers/import-graph.js";

/**
 * **The owner's read layer.** Each one returns something the public payload must
 * not contain, and each one is correct where it lives.
 */
const OWNER_READS = ["src/api.ts", "src/store/index.ts", "src/store/pg.ts"];

/**
 * **The owner himself.** `currentOwnerId()` is the runtime tripwire — on an
 * ownerless request it throws — but a public module that could reach it is a
 * public module one edit away from `setRequestOwner`. Sol's four reinforcing
 * boundaries, and this is the second.
 */
const THE_OWNER = ["src/owner.ts"];

/** Anything that can spend Greg's money, and the stages that call them. */
const SPENDS = [
  "src/ai-call.ts",
  "src/anthropic-call.ts",
  "src/openrouter-stream.ts",
  "src/messages-stream.ts",
  "src/converse.ts",
  "src/explain.ts",
  "src/embeddings.ts",
  "src/search.ts",
  "src/models.ts",
  "src/term-lookup.ts",
  /* The mark: a model call in a request handler, on the reader's own answer.
     It stores nothing, so it is not a WRITER — but a stranger's door must not
     reach it, because a quiz answer is a record of what somebody did not know
     and marking is spend a signed-in reader pays for.
     docs/plans/260831al-review-quiz-sub-mode.md § What gets logged. */
  "src/quiz-mark.ts",
];

/** The pipeline stages, which write as well as spend. */
const WRITERS = [
  "src/arc.ts",
  "src/blocks.ts",
  "src/extract.ts",
  "src/fetch.ts",
  "src/glossary.ts",
  "src/ideas.ts",
  "src/labels.ts",
  "src/pdf-read.ts",
  "src/pipeline.ts",
  "src/hierarchy.ts",
  "src/tweets.ts",
  /* Writes `timeline.json`, and spends. Listed the day the stage landed rather
     than the day it was wired, because a *missing* row here is a silent gap:
     nothing goes red when a writer is left out, so the guard simply stops
     covering it. docs/plans/260831i-timeline-mode.md. */
  "src/timeline.ts",
  /* Writes `quiz.json`, and spends. Listed for `timeline`'s reason: a *missing*
     row here is a silent gap — nothing goes red when a writer is left out, so
     the guard simply stops covering it.

     **`src/quiz-mark.ts` is not here and belongs in `SPENDS` instead**, which
     it already is by way of the OpenRouter check: it writes nothing at all. It
     is a model call in a request handler that stores no row, which is the one
     thing about this feature a stranger's door must never reach. */
  "src/quiz.ts",
  "src/jobs.ts",
];

const FORBIDDEN = [...OWNER_READS, ...THE_OWNER, ...SPENDS, ...WRITERS];

describe("the public API's import graph", () => {
  const publicGraph = publicFiles();

  it("cannot reach the owner's reads, the owner, a writer or the gateway", () => {
    expect(publicGraph.filter((f) => FORBIDDEN.includes(f))).toEqual([]);
  });

  /**
   * And each door on its own, so a failure names the one that opened.
   *
   * The case above would go red for either, and then somebody would have to
   * work out which — these two make the answer the test name.
   */
  it.each(PUBLIC_ENTRIES)("and neither does %s on its own", (entry) => {
    expect(graphFrom(entry).filter((f) => FORBIDDEN.includes(f))).toEqual([]);
  });

  /**
   * And the reader itself, checked separately — because somebody adding a
   * public endpoint would edit `public/routes.ts`, and somebody adding a public
   * *query* would edit this one, and the second is where the leak would be.
   */
  it("and neither can the public reader on its own", () => {
    expect(graphFrom("src/store/public-reader.ts").filter((f) => FORBIDDEN.includes(f))).toEqual([]);
  });

  /**
   * **The route inventory's spelling is a leaf, and must stay one.**
   *
   * `src/public/route-names.ts` imports nothing at all. That is not tidiness: it
   * lived in `routes.ts` beside the readers until 2026-08-28, which meant
   * importing the inventory pulled `store/public-reader.ts` → `sanitize.ts` →
   * **jsdom**, and cost **803ms measured on an idle machine**. The client's test
   * that pins its paths against this inventory did that import inside a test
   * body on vitest's default 5s timeout and failed in two full runs out of two
   * while passing alone — a cross-lane failure that read as flakiness and was a
   * module graph.
   *
   * This is the check that stops somebody adding a convenience import next month
   * and quietly restoring it, because nothing else would notice until a test
   * somewhere else started timing out again.
   *
   * `toEqual` on the whole graph rather than a forbidden list, deliberately:
   * *anything* it reaches is a regression, including a module that is cheap
   * today and grows an expensive import of its own later.
   */
  it("keeps the route inventory's spelling free of every import", () => {
    expect(graphFrom("src/public/route-names.ts")).toEqual(["src/public/route-names.ts"]);
  });

  /**
   * **The predicate leaf really is a leaf.**
   *
   * This is the point of `public-slug.ts` being its own file rather than living
   * beside `ownedSlug`: putting the two predicates together would make the
   * public leaf import `currentOwnerId`, which is exactly the dependency public
   * reads should lack. Sol's answer 4.
   */
  it("and publicSlug imports nothing but the schema", () => {
    expect(graphFrom("src/store/public-slug.ts")).toEqual([
      "src/db/schema.ts",
      "src/ids.ts",
      "src/store/public-slug.ts",
    ]);
  });

  /**
   * **The positive control**, and the reason the three cases above are worth
   * believing.
   *
   * The same walker, the same forbidden list, one different entry point. If it
   * ever returns an empty list here, the walker has stopped working and the
   * cases above are passing for the wrong reason — a check nobody has watched
   * fail is not evidence (docs/reusable/silent-success.md).
   */
  it("but the authenticated API reaches all of them, which is how we know the walk works", () => {
    const authenticated = graphFrom("src/routes.ts");
    const reached = authenticated.filter((f) => FORBIDDEN.includes(f));
    for (const named of ["src/api.ts", "src/store/index.ts", "src/owner.ts", "src/ai-call.ts"]) {
      expect(reached, named).toContain(named);
    }
  });
});

/**
 * **Which of the seventeen tables the public surface may touch.**
 *
 * The block above asks which *modules* a public request can reach. This asks
 * which *tables*, and it exists because the answer to the first question does
 * not imply the second: `src/db/schema.ts` is legitimately in the public graph —
 * the public reader has to name `articles` somehow — and it exports every table
 * in the database, including `comments`, `chat_messages`, `search_runs` and
 * `glossary_lookups`.
 *
 * ## The hole this closes, demonstrated before it was written
 *
 * Six lines added to `src/store/public-reader.ts`, 2026-08-28:
 *
 * ```ts
 * export function leakLookups(db, articleId: string) {
 *   return db.select().from(glossaryLookups).where(eq(glossaryLookups.articleId, articleId));
 * }
 * ```
 *
 * That is the owner's private glossary lookups — their requested answer, its
 * citations, its search count, its model and its exact time — on the public
 * reader, reachable with no owner. **Typecheck clean, and all five existing
 * guards green: 83 tests passing.** GPT Sol pointed at the shape of it; the
 * exhibit is what made it a fact rather than an argument.
 *
 * ## Why every other defence misses it, one by one
 *
 * This paragraph is the reason this guard exists, and it is here so that
 * whoever finds it in six months does not delete it as redundant with the five
 * things it looks redundant with.
 *
 * - **`tests/owner-isolation.test.ts`** greps for `eq(articles.slug, …)`. That
 *   query never mentions `articles` at all — a child table is keyed by
 *   `article_id`, and the id is one the public read already legitimately holds.
 * - **The module graph above** forbids `api.ts`, `store/index.ts`, `pg.ts`,
 *   `owner.ts`, the writers and the gateway. `db/schema.ts` is on none of those
 *   lists and must not be: it is how any query names a table.
 * - **`tests/public-dto.test.ts`** asserts the keys of what a projection
 *   returns. It never sees a query nobody wired into a DTO.
 * - **The zero-spend sweep** is about money. Reading a table costs nothing.
 * - **`currentOwnerId()`**, the runtime tripwire, never runs — which is exactly
 *   GPT Sol's closing point: the tripwire would not stop a call that reads a
 *   child table by `article_id`, or one that spends money, because neither needs
 *   an owner. The real defences are the closed import graph, the predicate-less
 *   reader, and now this.
 *
 * The hardwired reader is the defence that *should* have covered it and cannot:
 * its whole strength is that it accepts no predicate, and a child table needs no
 * predicate.
 *
 * ## An allowlist, for the third time in this feature
 *
 * `PUBLIC_ROUTES` enumerates the routes; the DTOs enumerate the keys; this
 * enumerates the tables. A denylist of reader-owned tables would have to be
 * updated by whoever adds the eighteenth, and they will be thinking about their
 * own feature rather than about this. Widening the four below has to be done on
 * purpose, by somebody who then has to write down why.
 */
describe("the public API's tables", () => {
  const SCHEMA = "src/db/schema.ts";
  const CLIENT = "src/db/client.ts";

  /** Every table the schema exports, read from the schema rather than listed. */
  function everyTable(): string[] {
    const text = readFileSync(path.join(ROOT, SCHEMA), "utf8");
    return [...text.matchAll(/^export const (\w+) = spideryarn\.table/gm)].map((m) => m[1] ?? "");
  }

  /**
   * The six the public surface may name.
   *
   * `articles` and `article_revisions` are the work itself; `revision_blocks` is
   * its prose; `block_identities` is the spine those ids hang on.
   *
   * **`comments` is the fifth, added deliberately on 2026-09-04**, and it is
   * the first time this list has grown. Greg decided that a shared link carries
   * the owner's comments — docs/plans/260904c-more-modes-on-a-shared-link.md
   * § Stage 3 — so the sentence this comment used to carry, that everything a
   * *reader* does is a different table by design, is no longer true of all of
   * them. It is still true of chats, searches, lookups, profiles, uploads and
   * jobs, and those are still refused here.
   *
   * **What makes this a widening rather than the hole this test was written
   * for**, stated so the next person to add a line has to clear the same bar:
   *
   *  - the read is `publicCommentsQuery` in src/store/public-reader.ts, which
   *    names its columns and **repeats `publicSlug` in its own `where`** — it
   *    does not take an article id from an earlier statement and trust it,
   *    which is precisely the *"obtain an article id, then read a child table
   *    by id"* move the header below describes;
   *  - it refuses referee notes and unfinished model calls in SQL
   *    (`PUBLIC_COMMENTS_WHERE`), so the filtering is not a `map` somebody can
   *    widen;
   *  - and the owner's own reader, `listFor(articleId)` in
   *    src/store/pg-comments.ts, is **not** what serves it. That was the first
   *    proposal and GPT Sol blocked it.
   *
   * **`searchRuns` is the sixth, on the same day**, and here are its three
   * sentences. Greg decided that *"only owner can create new searches; everyone
   * else can see the ones they have already created"*
   * (docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4), and:
   *
   *  - the read is `publicSearchesQuery`, which names its columns and repeats
   *    `publicSlug` in its own `where`;
   *  - it refuses unfinished and failed runs in SQL (`PUBLIC_SEARCHES_WHERE`),
   *    so the filtering is not a `map` somebody can widen;
   *  - and the owner's `list` in src/store/pg-searches.ts is not what serves
   *    it.
   *
   * It has a fourth of its own, because this table carries a column the wire
   * must not: `source_hash` is selected and turns into the derived `stale`
   * boolean before it reaches the DTO, which is the one place in this feature
   * where a selected column is deliberately not a promise about the payload.
   * src/store/public-reader.ts says so at the line where it stops.
   *
   * A seventh line needs the same three sentences written about it, or it
   * should not be here.
   *
   * `article_visibility_changes` is deliberately **not** here. It is written by
   * the owner's switch and read by nobody yet, and when something does read it
   * that will be an owner-facing page, not this one.
   */
  const ALLOWED = [
    "articles",
    "articleRevisions",
    "revisionBlocks",
    "blockIdentities",
    "comments",
    "searchRuns",
  ];

  /**
   * **Detected through the import, not by grepping for the word.**
   *
   * The first version matched the identifier anywhere in the stripped source and
   * produced four false positives immediately — `src/log.ts` names
   * `src/comments.ts` in a trailing `//` comment that a line-leading stripper
   * misses, and `src/messages.ts` imports `"./uploads.js"`, a *module* that
   * shares a name with a table. Loosening the stripper would have been the wrong
   * repair: a guard with known false positives is one people learn to wave
   * through, and it is a short walk from there to waving through a true one.
   *
   * So it asks the precise question instead: **what does this file import from
   * `db/schema.ts`?** In TypeScript a table cannot be used without being bound,
   * so the import *is* the use, and checking the binding is strictly stronger
   * than searching for the word — it has no false positives at all, and it
   * catches an import that is not used yet, which is the case that matters,
   * because an unused import today is a used one next month.
   *
   * A re-export cannot get round it: any module handing a table on would have to
   * import it first, and every module in the public graph is checked here.
   *
   * **The known limit, said out loud rather than implied:** a table named only
   * inside a raw `sql` template — `sql\`select … from spideryarn.glossary_lookups\``
   * — binds no identifier and would not be caught by the import arm. So there is
   * a second arm below for the snake_case names, which is where raw SQL would
   * spell them.
   */
  it("imports only the tables the allowlist names", () => {
    const tables = everyTable();
    /* The schema really does export the dangerous ones, so this is not passing
       for want of anything to find. */
    expect(tables).toEqual(expect.arrayContaining(["glossaryLookups", "comments", "chatMessages"]));
    const forbidden = tables.filter((t) => !ALLOWED.includes(t));

    const offenders: string[] = [];
    for (const file of publicFiles()) {
      if (file === SCHEMA) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      const full = path.join(ROOT, file);

      for (const m of source.matchAll(
        /(?:^|\n)\s*import\s+([^;'"]*?)from\s*["']([^"']+)["']/g,
      )) {
        const spec = m[2] ?? "";
        if (!spec.startsWith(".")) continue;
        const resolved = path.relative(
          ROOT,
          path.resolve(path.dirname(full), spec).replace(/\.js$/, ".ts"),
        );
        if (resolved !== SCHEMA) continue;

        const clause = (m[1] ?? "").trim();
        /* `import * as schema` would hand this module every table at once, and
           no allowlist over bindings could see which it then used.

           **`src/db/client.ts` is the one exemption**, and it earns it: it does
           `drizzle(pool, { schema })`, which is how every query in the repo gets
           its column types. It runs no query of its own. The exemption is
           narrow, and the arm below is what covers what it opens — see there. */
        if (clause.includes("*")) {
          if (file !== CLIENT) offenders.push(`${file} → import * from the schema`);
          continue;
        }
        const braces = /\{([\s\S]*)\}/.exec(clause);
        for (const raw of (braces?.[1] ?? "").split(",")) {
          const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim() ?? "";
          if (name && forbidden.includes(name)) offenders.push(`${file} → ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * **And the two routes to a table that bind no identifier at all.**
   *
   * The import arm above is precise but not complete, and both gaps are real
   * rather than theoretical:
   *
   * - **Raw SQL.** `sql\`select … from spideryarn.glossary_lookups\`` names a
   *   table in a template string and imports nothing.
   * - **Drizzle's relational query API.** `getDb().query.glossaryLookups.findMany()`
   *   needs no import either, because `src/db/client.ts` hands the *whole*
   *   schema to `drizzle(pool, { schema })` to type it — which is exactly the
   *   namespace import exempted above. Finding that exemption is what turned
   *   this arm from tidiness into the half that covers the other half.
   *
   * **Matched by their qualified spellings**, which is what makes this precise
   * where matching the bare name was not. The first version looked for the
   * snake_case name anywhere and flagged `jobs`, `comments` and `uploads` in
   * `src/log.ts` and `src/messages.ts` — because those are ordinary English
   * words, and the reasoning that multi-word table names do not appear in prose
   * simply does not hold for single-word ones. `spideryarn.comments` and
   * `.query.comments` are not English.
   */
  it("and reaches no forbidden table through raw SQL or the relational API", () => {
    const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const forbidden = everyTable().filter((t) => !ALLOWED.includes(t));
    expect(forbidden).toContain("glossaryLookups");

    const offenders: string[] = [];
    for (const file of publicFiles()) {
      if (file === SCHEMA) continue;
      /* Comments stripped — this file and the public reader both discuss these
         tables by name while explaining the rule, and a guard that fires on its
         own documentation teaches people to delete the documentation. */
      const code = readFileSync(path.join(ROOT, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const table of forbidden) {
        /* **Both spellings of a qualified name, because Postgres has two.**
           `spideryarn.glossary_lookups` and `"spideryarn"."glossary_lookups"`
           are the same table, and Drizzle emits the quoted form — so a guard
           matching only the bare one was green over the spelling the ORM
           actually writes. GPT Sol found it, 2026-08-29, and a mutation
           confirmed it: a quoted `select` in the public reader passed. */
        if (new RegExp(`"?spideryarn"?\\s*\\.\\s*"?${snake(table)}\\b"?`).test(code)) {
          offenders.push(`${file} → raw sql on ${snake(table)}`);
        }
        /* And both ways to reach a property: `db.query.comments` and
           `db.query["comments"]` are one expression written twice. A computed
           key from a variable is the one route left open, and it cannot be
           closed by reading the text — see the note below. */
        if (
          new RegExp(
            `\\.query\\s*(?:\\.\\s*${table}\\b|\\[\\s*["'\`]${table}["'\`]\\s*\\])`,
          ).test(code)
        ) {
          offenders.push(`${file} → db.query.${table}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * **And the four it is allowed are really being used**, which is the control.
   *
   * A guard that fires on everything is as useless as one that fires on nothing.
   * If the public reader stopped naming `articleRevisions` the case above would
   * still pass, and it would be passing over a public surface that had stopped
   * reading anything.
   */
  it("and does name the ones it is allowed, so the rule is not vacuous", () => {
    const reader = readFileSync(path.join(ROOT, "src/store/public-reader.ts"), "utf8");
    for (const table of ["articles", "articleRevisions", "revisionBlocks"]) {
      expect(reader, table).toMatch(new RegExp(`\\b${table}\\b`));
    }
  });
});
