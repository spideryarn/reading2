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
import type { ArticleReader, CommentStore, GlossaryStore } from "./contracts.js";

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
