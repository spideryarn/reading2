/**
 * Every column of `article_revisions` has been decided about, in both
 * directions and against the real table.
 *
 * `beginRevision` copies a published revision into a new draft
 * (src/store/pg-revisions.ts). What it copies is a **denylist** — everything
 * except the four it mints and the five it derives — because an allowlist is
 * something somebody has to remember to extend, and a reader's paid-for
 * glossary silently not being carried is the kind of bug nothing reports.
 *
 * A denylist has the opposite failure, and a review named it: **carry-by-default
 * is the dangerous default, not the safe one.** A later `validated_at`,
 * `published_at`, `based_on_revision_id` or `attempt_id` would be actively
 * harmful copied — new content inheriting an old certification, or a dead
 * worker's ownership. So the policy map is exhaustive, and this is what makes
 * "exhaustive" a fact rather than a habit.
 *
 * ## Three checks, and the third is the one that is not free
 *
 * 1. Every schema column has a policy. The `Record` type says so at compile
 *    time; `carriedColumns()` says so at runtime, and this proves it says it out
 *    loud rather than shrugging.
 * 2. Every policy key is a real column — the reverse direction, which catches a
 *    renamed column leaving a stale entry behind that quietly classifies nothing.
 * 3. **Against the live table**, because a column added by a hand-written SQL
 *    migration never reaches `getTableColumns` at all. That is the one a review
 *    pointed at: the drift guard helps only if the column arrives through
 *    `schema.ts`. Needs a database, and skips loudly without one.
 *
 * The manifest test (tests/store-artefact-manifest.test.ts) is the same idea for
 * artefacts on disk, and it exists because five of them appeared under a
 * one-day-old schema.
 */

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { articleRevisions } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
/* `deriveLibraryScalars` lives in src/library-scalars.ts since 2026-08-28 —
   src/api.ts, the filesystem store, needs it too and must not import the
   Postgres driver to get it. src/store/pg-revisions.ts re-exports it, and this
   file imports it from its real address. */
import { deriveLibraryScalars } from "../src/library-scalars.js";
import { REVISION_CARRY_POLICY } from "../src/store/pg-revisions.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const declared = Object.keys(getTableColumns(articleRevisions));
const classified = Object.keys(REVISION_CARRY_POLICY);

describe("the carry-forward policy", () => {
  it("classifies every column the schema declares", () => {
    const unclassified = declared.filter((name) => !classified.includes(name));
    expect(
      unclassified,
      "add each to REVISION_CARRY_POLICY — a new column must not be carried or dropped by accident",
    ).toEqual([]);
  });

  it("classifies nothing that is not a column", () => {
    const stale = classified.filter((name) => !declared.includes(name));
    expect(stale, "a policy entry for a column that no longer exists").toEqual([]);
  });

  it("mints the five that belong to the row itself and derives the five the library prints", () => {
    /* Pinned by name, not counted. A count passes when somebody moves
       `block_count` from `derive` to `carry` and adds a new derived column in
       the same breath — and moving `block_count` to `carry` is precisely the
       resurrect-dead-data bug the split exists to prevent. */
    /* `basedOnRevisionId` joined them on 2026-09-01, and it is the one where
       carrying is worst: a draft would inherit its *parent's* base, so
       `refuseIfBaseMoved` (src/store/pg-session.ts) would compare the wrong
       pair and publish over work nobody asked to lose. */
    const of = (policy: string) => classified.filter((k) => REVISION_CARRY_POLICY[k as never] === policy).sort();
    expect(of("mint")).toEqual(["articleId", "basedOnRevisionId", "createdAt", "id", "status"]);
    expect(of("derive")).toEqual([
      "blockCount",
      "partCount",
      "rootGist",
      "sectionCount",
      "wordCount",
    ]);
  });

  it("carries the artefacts a step owns, including the three a shorter list forgot", () => {
    /* `tree`, `labels` and `arc` are the ones the plan's three-column reading
       missed. Dropping any of them makes a `{ steps: ["blocks"] }` job publish
       an article with no tree, which is an article nobody can read. */
    /* `assets` joined them on 2026-08-29. Its objects are content-addressed and
       never deleted, so carrying the manifest cannot make it point at bytes
       that have gone — and not carrying it is the quiet failure: an article
       goes back to hot-linking every image after a run that had nothing to do
       with its figures. docs/plans/260829b-hosting-the-articles-images.md. */
    /* `summary` was in this list until 2026-08-31 and `quotes` replaced it:
       stage 5e and the column it wrote were deleted together, so there is
       nothing left to carry (docs/plans/260831s-gist-only-summaries.md, drizzle/0036).
       A name swapped in rather than one simply removed, because what this
       assertion is worth is the *count* of artefacts nobody remembered — and a
       list that only ever shrinks stops being that. */
    for (const column of ["tree", "labels", "arc", "assets", "glossary", "tweets", "quotes"]) {
      expect(REVISION_CARRY_POLICY[column as never], column).toBe("carry");
    }
  });
});

describe("deriveLibraryScalars", () => {
  const tree = {
    version: "toc/2",
    generator: "fixture",
    slug: "x",
    rootId: "root",
    nodes: {
      root: { id: "root", depth: 0, parent: null, children: ["p"], range: ["a", "a"], title: "T", gist: "the root gist" },
      p: { id: "p", depth: 1, parent: "root", children: ["s"], range: ["a", "a"], title: "P", gist: "part" },
      s: { id: "s", depth: 2, parent: "p", children: [], range: ["a", "a"], title: "S" },
    },
  } as never;

  it("counts words, blocks, parts and sections", () => {
    const out = deriveLibraryScalars({ blocks: [{ words: 3 }, { words: 4 }], tree });
    expect(out).toMatchObject({ wordCount: 7, blockCount: 2, partCount: 1, sectionCount: 1 });
  });

  it("falls back to the excerpt for the blurb, which the importer used not to", () => {
    /* The divergence a review found: `describeArticle` (src/api.ts) reads
       `root.gist ?? root.summary ?? meta.excerpt`, and the importer stopped at
       the second rung — so an article with no root gist had a blurb on the
       filesystem and none in Postgres. One function now, so they cannot differ. */
    const gistless = { ...(tree as never as { nodes: Record<string, unknown> }) } as never;
    const stripped = JSON.parse(JSON.stringify(gistless)) as { nodes: Record<string, { gist?: string }> };
    delete stripped.nodes.root!.gist;
    expect(
      deriveLibraryScalars({ blocks: [], tree: stripped as never, excerpt: "what the page says" })
        .rootGist,
    ).toBe("what the page says");
    expect(deriveLibraryScalars({ blocks: [], tree, excerpt: "unused" }).rootGist).toBe(
      "the root gist",
    );
  });

  it("answers for a revision with no tree at all rather than throwing", () => {
    // A `{ steps: ["fetch"] }` draft on a brand-new article has none, and the
    // publication guard is what refuses it — not an exception in the arithmetic.
    expect(deriveLibraryScalars({ blocks: [{ words: 9 }], tree: null })).toEqual({
      wordCount: 9,
      blockCount: 1,
      partCount: 0,
      sectionCount: 0,
      rootGist: null,
    });
  });
});

/* ------------------------------------------------- against the real table -- */

/* This one wants the probe's ROWS, not just its verdict, so it keeps the pool
   and reads the column list through it. The old version had a silent hole: an
   empty result left `liveColumns` null and the suite skipped with nothing on
   stderr, because only the `catch` warned. */
let liveColumns: string[] | null = null;

const { reachable, pool } = await pgReady({
  suite: "tests/store-revision-policy.test.ts",
  tables: ["spideryarn.article_revisions"],
  keepPool: true,
});

if (reachable && pool) {
  const probe = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = 'spideryarn' and table_name = 'article_revisions'`,
  );
  liveColumns = probe.rows.map((r) => r.column_name);
  await pool.end();
}

const when = liveColumns ? describe : describe.skip;

when("the policy against the live table", () => {
  it("knows about every column Postgres actually has", () => {
    /* The half `getTableColumns` cannot see. A `drizzle-kit generate --custom`
       migration — and this repo has eight of them — adds a column that
       TypeScript never hears about, and it would then be dropped from every
       carry-forward with nothing to say so. */
    const snakeOf = new Map(
      Object.entries(getTableColumns(articleRevisions)).map(([key, col]) => [col.name, key]),
    );
    const unknown = (liveColumns ?? []).filter((name) => !snakeOf.has(name));
    expect(
      unknown,
      "columns in spideryarn.article_revisions that src/db/schema.ts does not declare",
    ).toEqual([]);
  });
});
