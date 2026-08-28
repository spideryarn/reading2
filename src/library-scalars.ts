/**
 * The derivations both stores share, and neither may spell twice.
 *
 * ## Why this is its own module
 *
 * It used to live in src/store/pg-revisions.ts, beside the two writers that
 * call it — `publishRevision` and the importer. That was fine while only
 * Postgres derived them. It stopped being fine on 2026-08-28, when the shelf
 * stopped recomputing these per request and started reading the columns
 * instead: `describeArticle` in src/api.ts then needed the same derivation, and
 * src/api.ts is the **filesystem** store. Importing pg-revisions.ts there would
 * pull drizzle and the connection pool in behind it, into the one path that
 * exists so this app runs with no database at all.
 *
 * So the derivation moved out to a leaf with nothing under it, and both stores
 * reach it from above. `src/store/pg-revisions.ts` re-exports it, because
 * `publishRevision`'s return type is built from it and src/store/import.ts
 * reaches for it at that address.
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
import type { Block, Tree } from "./types.js";

/**
 * What a shelf card needs that neither the metadata nor the shelf state holds.
 *
 * `rootGist` is **legitimately null** — an article with no root gist, no root
 * summary and no excerpt has no blurb, and that is a correct answer rather than
 * a missing one. Anything treating "null scalars" as "not computed yet" must
 * therefore look at the four numbers and not at this. GPT Sol's first finding
 * on docs/plans/library-read-latency.md, and the plan had it wrong.
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
   * this is stored at publish and their stored blocks carry no `treatment` —
   * so recomputing over them would produce the identical figure. It corrects
   * itself when the article is re-extracted and republished, and nothing
   * cheaper can correct it. docs/plans/footnotes.md.
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
    for (const node of Object.values(tree.nodes)) {
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
