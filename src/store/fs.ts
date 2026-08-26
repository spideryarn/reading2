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
import {
  createComment,
  deleteComment,
  loadComments,
  type NewComment,
  patchComment,
} from "../comments.js";
import type { Comment } from "../types.js";
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
 * Comments, with one adaptation.
 *
 * `createComment` takes a `NewComment` — the reader's half — and mints the id,
 * the timestamp and `status: "pending"` itself. The contract takes a whole
 * `Comment` instead, because the Postgres version needs the id to be
 * **client-minted**: that is what makes creating one idempotent on retry, which
 * matters the moment there is more than one server process. So this narrows a
 * `Comment` back down to the `NewComment` the existing function wants, and the
 * id it mints is discarded in favour of the caller's.
 *
 * That is a real (small) divergence between the two stores, and it is written
 * down here rather than smoothed over, because a parity test that compares ids
 * will see it.
 */
export const fsCommentStore: CommentStore = {
  load: loadComments,

  async begin(slug: string, comment: Comment): Promise<Comment> {
    const draft: NewComment = {
      blockId: comment.blockId,
      quote: comment.quote,
      start: comment.start,
    };
    return createComment(slug, draft);
  },

  async finish(slug: string, id: string, patch: Partial<Comment>): Promise<Comment[]> {
    return patchComment(slug, id, patch);
  },

  remove: deleteComment,

  async count(slug: string): Promise<number> {
    return (await loadComments(slug)).length;
  },
};
