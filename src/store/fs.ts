/**
 * The filesystem store, as a value rather than as a pile of imports.
 *
 * Every method here **delegates to the code that already does the job** — this
 * file adds no behaviour at all, and that is the point. It exists so the
 * filesystem can be one side of a comparison: the parity test asks the same
 * questions of this and of the Postgres store and demands the same answers.
 * A reimplementation would be comparing the migration against a fresh set of
 * bugs.
 *
 * It is also the rollback. docs/plans/postgres-migration.md § The order of work
 * keeps the filesystem adapter, the importer and the exporter for one release
 * after cutover and then deletes them. This is the first of those three.
 *
 * **This is not where a fallback lives.** Nothing may catch a Postgres error
 * and call into here — see docs/plans/postgres-storage-implementation.md
 * § Rules. A silent fallback hides divergence and makes the parity exercise
 * worthless, which is the single most important line in the plan.
 */

import {
  articleMetadata,
  deleteGlossary,
  listArticles,
  loadArticle,
  loadGlossary,
  loadSummaries,
  loadTweets,
  lookUpTerm,
} from "../api.js";
import { createComment, deleteComment, loadComments, patchComment } from "../comments.js";
import { searchLibrary } from "../library-search.js";
import { loadShelf, patchShelf, recordOpen } from "../shelf.js";
import type {
  ArticleReader,
  CommentStore,
  GlossaryStore,
  LibrarySearch,
  ShelfStore,
} from "./contracts.js";
import type { LibraryEntry } from "../types.js";

export const fsArticleReader: ArticleReader = {
  loadArticle,
  listArticles,
  articleMetadata,
  loadTweets,
  loadGlossary,
  loadSummaries,
};

export const fsGlossaryStore: GlossaryStore = {
  lookUpTerm,
  deleteGlossary,
};

/**
 * Comments, with no adaptation at all — the contract is `src/comments.ts`'s own
 * surface, so every method is the function itself. `count` is the one addition,
 * and it exists because the library needs a number without the comments.
 */
export const fsCommentStore: CommentStore = {
  load: loadComments,
  create: createComment,
  patch: patchComment,
  remove: deleteComment,

  async count(slug: string): Promise<number> {
    return (await loadComments(slug)).length;
  },
};

/**
 * The shelf's write side: archive, rename, count an open.
 *
 * Two properties, and each cost a round trip that is worth it at this size.
 *
 * **Nothing is written for an article that does not exist.** `src/shelf.ts`
 * happily creates `data/<slug>/shelf.json` for any slug-shaped string, so
 * without this check a typo produced a directory, a file, and then a 404 — a
 * request that reports "no such article" and leaves state behind for it. The
 * Postgres side gets this for free, because there is no row to update; the
 * filesystem has to be told. Caught by a cross-family review, 2026-08-26.
 *
 * **The entry comes back through `listArticles`**, rather than being patched
 * together here. One directory walk per click, and it buys the property that
 * matters: the card the client renders after a write is built by the same code
 * as the card before it. A second way of building a `LibraryEntry` is the
 * divergence this whole seam exists to make impossible.
 */
export const fsShelfStore: ShelfStore = {
  read: loadShelf,

  async patch(slug, change): Promise<LibraryEntry> {
    await requireEntry(slug);
    const state = await patchShelf(slug, change);
    return entryFor(slug, !!state.archivedAt);
  },

  async recordOpen(slug: string): Promise<void> {
    await requireEntry(slug);
    await recordOpen(slug);
  },
};

/** The article's entry from whichever half of the shelf it is on, or `null`. */
async function findEntry(slug: string): Promise<LibraryEntry | null> {
  const [shelf, archived] = await Promise.all([
    listArticles(),
    listArticles({ archived: true }),
  ]);
  return [...shelf, ...archived].find((e) => e.slug === slug) ?? null;
}

/** …or a 404, before anything is written. */
async function requireEntry(slug: string): Promise<LibraryEntry> {
  const entry = await findEntry(slug);
  if (!entry) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  return entry;
}

/**
 * The article as the shelf now describes it.
 *
 * `archived` says which half to look in, because an entry that has just been
 * archived is by definition no longer in the other one — and looking in the
 * wrong half would 404 an article that is sitting right there.
 */
async function entryFor(slug: string, archived: boolean): Promise<LibraryEntry> {
  const entries = await listArticles({ archived });
  const entry = entries.find((e) => e.slug === slug);
  if (!entry) {
    // `requireEntry` already proved the article exists, so this means it stopped
    // being one between the two calls — a concurrent re-extraction, or a
    // directory removed under us. Rare, and worth saying plainly rather than
    // reporting as the same thing as "no such article".
    throw Object.assign(
      new Error(`"${slug}" stopped being a complete article while the shelf was being written.`),
      { status: 409 },
    );
  }
  return entry;
}

/** Searching every article at once. One function, no adaptation — src/library-search.ts. */
export const fsLibrarySearch: LibrarySearch = { searchLibrary };
