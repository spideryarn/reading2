/**
 * The five numbers and the one sentence a library card is made of.
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
 */

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
  blocks: readonly Pick<Block, "words">[];
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
    wordCount: blocks.reduce((n, b) => n + b.words, 0),
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
