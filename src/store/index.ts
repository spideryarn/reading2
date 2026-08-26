/**
 * Which store the server is using, and the one place that decides.
 *
 *     SPIDERYARN_STORE=postgres npm run dev
 *
 * Default is `files`, so nothing changes for anyone who has not opted in. The
 * flag is read once at module load rather than per call: a store that could
 * change under a running request is a much worse thing to debug than one that
 * needs a restart.
 *
 * `src/routes.ts` imports the article reads from here instead of from
 * `src/api.ts`. That is a one-line change in a file several agents are editing,
 * which is deliberate — see docs/plans/postgres-storage-implementation.md.
 *
 * ## The rule this file exists to keep
 *
 * **No fallback, ever.** Nothing here catches a Postgres error and retries
 * against the filesystem. A fallback would hide exactly the divergence the
 * parity test is built to find, and would do it in production, silently, where
 * nobody is comparing. From
 * [the order of work](../../docs/plans/postgres-migration.md#the-order-of-work):
 * *"Do not catch a Postgres error and fall back to files."*
 *
 * The corollary is the `notMigrated` helper below. Two glossary **writes** have
 * no Postgres implementation yet, and in `postgres` mode they must fail loudly
 * rather than quietly write a file that the reader will never read back. A
 * write that lands in the store nobody is reading is the worst available
 * outcome: it reports success and loses the data.
 */

import { loadEnvLocal } from "../env.js";
import { log } from "../log.js";
import type {
  ArticleReader,
  CommentStore,
  GlossaryStore,
  LibrarySearch,
  ShelfStore,
} from "./contracts.js";
import {
  fsArticleReader,
  fsCommentStore,
  fsGlossaryStore,
  fsLibrarySearch,
  fsShelfStore,
} from "./fs.js";
import { pgArticleReader } from "./pg.js";
import { pgCommentStore } from "./pg-comments.js";
import { pgLibrarySearch, pgShelfStore } from "./pg-shelf.js";

loadEnvLocal();

export type StoreName = "files" | "postgres";

/** `postgres` only when asked for by name. Anything else, including a typo, is `files`. */
export const STORE: StoreName = process.env.SPIDERYARN_STORE === "postgres" ? "postgres" : "files";

if (STORE === "postgres") {
  // info, not debug: which store is serving reads is the first thing anybody
  // investigating a wrong answer needs to know, and it is one line per boot.
  log("store").info({ store: STORE }, "serving article reads from Postgres");
}

/** A write with no Postgres implementation yet. Loud on purpose — see the header. */
function notMigrated(what: string): () => never {
  return () => {
    throw Object.assign(
      new Error(
        `${what} has no Postgres implementation yet, and SPIDERYARN_STORE=postgres. ` +
          "Refusing rather than writing a file nothing will read back. " +
          "See docs/plans/postgres-storage-implementation.md.",
      ),
      { status: 501 },
    );
  };
}

const reader: ArticleReader = STORE === "postgres" ? (pgArticleReader as ArticleReader) : fsArticleReader;

export const loadArticle = reader.loadArticle.bind(reader);
export const listArticles = reader.listArticles.bind(reader);
export const articleMetadata = reader.articleMetadata.bind(reader);
export const loadTweets = reader.loadTweets.bind(reader);
export const loadGlossary = reader.loadGlossary.bind(reader);
export const loadSummaries = reader.loadSummaries.bind(reader);

const glossary: GlossaryStore =
  STORE === "postgres"
    ? { lookUpTerm: notMigrated("Looking a term up"), deleteGlossary: notMigrated("Deleting the glossary") }
    : fsGlossaryStore;

export const lookUpTerm = glossary.lookUpTerm;
export const deleteGlossary = glossary.deleteGlossary;

/**
 * Comments follow the same flag as the article reads, and they have to.
 *
 * A comment anchors to a block id, and in `postgres` mode the article those
 * blocks came from is a set of rows. Leaving comments on the filesystem while
 * the article came from Postgres would mean the reader's questions and the
 * paragraphs they point at living in two stores that nothing keeps in step.
 */
export const commentStore: CommentStore =
  STORE === "postgres" ? pgCommentStore : fsCommentStore;

/**
 * The shelf's write side, and the library-wide search box.
 *
 * Both follow the same flag as the article reads, and both have to. An archived
 * flag written to a file while the shelf is being listed out of Postgres would
 * archive nothing at all — the card would come straight back on the next load,
 * having reported success. That is the exact failure `notMigrated` exists to
 * prevent above, and it is why these are wired here rather than imported
 * directly by routes.ts.
 */
export const shelfStore: ShelfStore = STORE === "postgres" ? pgShelfStore : fsShelfStore;

export const librarySearch: LibrarySearch = STORE === "postgres" ? pgLibrarySearch : fsLibrarySearch;
