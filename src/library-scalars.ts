/**
 * The derivations both stores share, and neither may spell twice.
 *
 * ## Why this is its own module
 *
 * It used to live in src/store/pg-revisions.ts, beside the two writers that
 * call it — `publishRevision` and the importer. That was fine while only
 * Postgres derived them. It stopped being fine on 2026-08-28, when the shelf
 * stopped recomputing these per request and started reading the columns
 * instead: `describeArticle` then needed the same derivation, and it lived in
 * src/api.ts, which was the **filesystem** store. Importing pg-revisions.ts
 * there would have pulled drizzle and the connection pool in behind it, into
 * the one path that existed so this app ran with no database at all.
 *
 * So the derivation moved out to a leaf with nothing under it, and both stores
 * reached it from above. `src/store/pg-revisions.ts` re-exports it, because
 * `publishRevision`'s return type is built from it. (The importer reached for
 * it at that address too, until src/store/import.ts was deleted on 2026-09-01;
 * the re-export outlived it.)
 *
 * **`describeArticle` itself moved in here on 2026-09-05**, at the bottom of
 * this file, when src/api.ts was deleted with the filesystem store. The
 * argument this module was created to make now finishes inside it.
 *
 * ## The rule this exists to keep
 *
 * **One function, called by both writers and by both readers**, because a
 * review found they had already diverged: `describeArticle` fell back to
 * `meta.excerpt` for the blurb and the importer did not, so an article with no
 * root gist had a blurb on the filesystem and none in Postgres. Two
 * implementations of one derivation is the divergence the Postgres migration
 * exists to make impossible — and the shelf now prints whichever one ran, so
 * there had better be only one.
 *
 * Pure, so it can be tested without a filesystem and without a database.
 *
 * ## Two of them, and the second one is not a scalar
 *
 * `headingTitleOf` is here too, despite the file's name, because it is the same
 * kind of thing for the same reason: one rule, needed by both stores, and there
 * were **three** copies of it when this module was written — src/api.ts,
 * src/store/pg.ts, and a fourth spelling in SQL. It feeds the reading view's
 * masthead as well as the card, which is why it is not called
 * `deriveLibraryTitle`.
 */

import { articleWordCounts, type Treated } from "./block-policy.js";
import { readingMinutes } from "./reading-time.js";
import { supplementIndex } from "./supplement.js";
import type { Block, LibraryEntry, Meta, ShelfState, Tree, Visibility } from "./types.js";

/**
 * What a shelf card needs that neither the metadata nor the shelf state holds.
 *
 * `rootGist` is **legitimately null** — an article with no root gist, no root
 * summary and no excerpt has no blurb, and that is a correct answer rather than
 * a missing one. Anything treating "null scalars" as "not computed yet" must
 * therefore look at the four numbers and not at this. GPT Sol's first finding
 * on docs/plans/260828c-library-read-latency.md, and the plan had it wrong.
 */
export interface LibraryScalars {
  /**
   * **The body's words, not every block's** — since 2026-08-28.
   *
   * The number the card says out loud and the number
   * src/reading-time.ts turns into "55 min". A bibliography is on the page and
   * is not what a reader is deciding whether to start: gwern was being
   * advertised at 73 minutes for an article whose argument is 55.
   * `countsTowardReadingTime` in src/block-policy.ts is the rule; the split is
   * `articleWordCounts`.
   *
   * **Articles published before roles existed keep the old number**, because
   * this is stored at publish and their stored block rows carry no `treatment`
   * — so a backfill over the *rows* would produce the identical figure. A
   * repair from `stamped_html` is possible and is deliberately not built: see
   * docs/plans/260828o-footnotes.md § The stale cached word count for the option and
   * why letting it heal on re-extraction was chosen instead.
   */
  wordCount: number;
  blockCount: number;
  partCount: number;
  sectionCount: number;
  rootGist: string | null;
}

/**
 * The five, from the two artefacts they describe.
 *
 * `excerpt` is the third rung of the blurb's fallback and is passed in rather
 * than read, so this stays pure.
 */
export function deriveLibraryScalars(input: {
  blocks: readonly (Pick<Block, "words"> & Treated)[];
  tree: Tree | null;
  excerpt?: string | null | undefined;
}): LibraryScalars {
  const { blocks, tree } = input;
  let partCount = 0;
  let sectionCount = 0;
  if (tree) {
    // One pass rather than two filters: the tree of a long article is thousands
    // of nodes, and this runs once per article per homepage load.
    /* The apparatus is a depth-one child of the root and its leaves are at
       depth two, so counting by depth alone would advertise gwern as having one
       more part than it argues and forty-one more sections than it has. A card
       that says "8 parts" about a seven-part piece is a small lie in the one
       place a reader is deciding whether to start. src/supplement.ts. */
    const supplement = supplementIndex(tree);
    for (const node of Object.values(tree.nodes)) {
      if (supplement.has(node.id)) continue;
      if (node.depth === 1) partCount++;
      else if (node.depth === 2) sectionCount++;
    }
  }
  const root = tree ? tree.nodes[tree.rootId] : undefined;
  return {
    wordCount: articleWordCounts(blocks).body,
    blockCount: blocks.length,
    partCount,
    sectionCount,
    /* The blurb: the whole piece in one sentence, which is exactly what a card
       wants and is already generated. Note what is deliberately NOT a rung of
       this: the first arc entry. An arc sentence says where the argument stands
       at the end of part one, so using it here would put a sentence about the
       opening where the reader expects a sentence about the article, and it
       would look right. */
    rootGist: root?.gist ?? root?.summary ?? input.excerpt ?? null,
  };
}

/**
 * The article's own first-level heading — **`meta.title`'s fallback**.
 *
 * When nothing stored a title, the article's own `<h1>` is what the card and the
 * masthead show, and the slug is the last resort. Both stores need the rule and
 * had their own copy of it: src/api.ts scanned `blocks.json`, `metaFrom` in
 * src/store/pg.ts scanned the rows it had just read, and neither knew about the
 * other.
 *
 * **The first by document order, not any of them.** The array is in document
 * order by construction on the filesystem and by `order by ordinal` in
 * Postgres, and an article with two `<h1>`s is not unusual.
 *
 * There is a fourth spelling, and it cannot be this function: the shelf asks
 * Postgres for one row rather than reading every block, so the same rule exists
 * as a correlated subquery in `listArticlesQuery`. It is pinned against this
 * one by tests/store-shelf-reads.test.ts, over the real corpus and over a
 * fixture with two headings deliberately stored out of order.
 */
export function headingTitleOf(blocks: readonly Block[]): string | null {
  return blocks.find((b) => b.kind === "heading" && b.level === 1)?.text ?? null;
}

/* ------------------------------------------------------------ the library --
   The card the homepage prints, and the title on it. Both moved here from
   src/api.ts on 2026-09-05, when that file — the filesystem article reader —
   was deleted (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
   § G). They are the only two things in it that were not about directories:
   one pure record-assembler over an already-derived `LibraryScalars`, and a
   three-line precedence rule. This is the file that exists *because*
   `describeArticle` needed a derivation neither store could own, so it is
   where the assembler that needed it belongs. */

/**
 * One shelf-ready record, assembled from things already in memory.
 *
 * Pure, so it can be tested without a filesystem.
 *
 * The blurb, the word count and the three other numbers arrive as `scalars`;
 * `deriveLibraryScalars` above is where the rules for them live, including why
 * the first arc entry is deliberately not a fallback for the blurb.
 */
export function describeArticle(input: {
  slug: string;
  meta: Meta;
  /**
   * The five, **received rather than derived** — since 2026-08-28.
   *
   * This function used to take `blocks` and `tree` and compute them, which made
   * it the second implementation of `deriveLibraryScalars`; both files said so
   * in a comment, and a review had already caught them disagreeing about the
   * `excerpt` rung of the blurb. There was one derivation reached from two
   * moments while there were two stores; since 2026-09-05 there is one store,
   * and it reads the columns `deriveLibraryScalars` wrote at publish.
   * docs/plans/260828c-library-read-latency.md § 2.
   *
   * That mattered for latency as well as for correctness: deriving here meant
   * reading every block row and the whole tree of every article — and
   * sanitising each one through jsdom — on every homepage load.
   */
  scalars: LibraryScalars;
  comments: number;
  addedAt: string;
  fixture?: boolean;
  /**
   * What the reader has done to the card — src/shelf.ts.
   *
   * Passed in rather than read here, so this function stays pure: the store
   * fetches it its own way (four columns on the article row) and hands it over.
   * It is optional so that a caller who has not got round to it still gets an
   * entry rather than a type error, and the default is "never touched".
   */
  shelf?: ShelfState;
  /** Which optional stages have produced something. Absent means none of them. */
  has?: Partial<LibraryEntry["has"]>;
  /**
   * Whether anyone with the link can read it — **passed in, like `shelf`.**
   *
   * Optional because it used to be the field only one of the two stores could
   * answer: the filesystem had no `visibility` column and passed nothing, so
   * every card off it was unshared and sharing was refused with a 501. Postgres
   * reads the column the query already selected.
   */
  visibility?: Visibility;
}): LibraryEntry {
  const { slug, meta, scalars } = input;
  const shelf = input.shelf ?? { opens: 0 };

  // Conditional spreads, not `byline: meta.byline` — exactOptionalPropertyTypes
  // is on, so an explicitly-undefined property is not the same as an absent one.
  // See docs/project/typechecking.md.
  return {
    slug,
    // Through `titleFor`, which is also what `loadArticle` uses — so the card
    // and the masthead cannot end up calling one article two things.
    title: titleFor(meta, shelf).title,
    ...(shelf.title ? { titleOverridden: true as const } : {}),
    opens: shelf.opens,
    ...(shelf.lastOpenedAt ? { lastOpenedAt: shelf.lastOpenedAt } : {}),
    ...(shelf.archivedAt ? { archivedAt: shelf.archivedAt } : {}),
    has: {
      arc: input.has?.arc ?? false,
      tweets: input.has?.tweets ?? false,
      glossary: input.has?.glossary ?? false,
    },
    ...(meta.byline ? { byline: meta.byline } : {}),
    ...(meta.siteName ? { siteName: meta.siteName } : {}),
    ...(meta.url ? { url: meta.url } : {}),
    addedAt: input.addedAt,
    words: scalars.wordCount,
    minutes: readingMinutes(scalars.wordCount),
    blocks: scalars.blockCount,
    parts: scalars.partCount,
    sections: scalars.sectionCount,
    comments: input.comments,
    ...(scalars.rootGist ? { gist: scalars.rootGist } : {}),
    /* **Only when it is public.** Spelling the private case out would put a
       `"private"` on every card — see `LibraryEntry.visibility` in
       src/types.ts, which is optional for this reason. The shelf reads it as
       `=== "public"`, so an absence and a private article are the same
       question answered the same way. */
    ...(input.visibility === "public" ? { visibility: "public" as const } : {}),
    ...(input.fixture ? { fixture: true as const } : {}),
  };
}

/**
 * The title the reader should see, and the one place that precedence lives.
 *
 * Reader's override first, extractor's second. Called by `loadArticle` for the
 * masthead and by `describeArticle` for the card, so the two cannot disagree —
 * which they did, for exactly as long as only one of them knew about overrides.
 */
export function titleFor(meta: Meta, shelf: ShelfState | undefined): Meta {
  return shelf?.title ? { ...meta, title: shelf.title } : meta;
}
