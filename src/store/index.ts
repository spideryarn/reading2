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
 *
 * **`notMigrated` can only guard what comes through this file, and chat and
 * meaning-search do not.** src/routes.ts imports their writes straight from
 * src/chat.ts and src/searches.ts, which write to disk with `node:fs/promises`.
 * So in `postgres` mode those two did the thing the paragraph above calls the
 * worst available outcome, and no line written *here* could change it — which
 * matters, because two plans proposed extending `notMigrated` to cover them and
 * it cannot: the call never arrives.
 *
 * They now refuse at their own `save()`, using the same 501 from
 * [live.ts](live.ts) so the reader gets the same answer whichever door the call
 * came through. That is scaffolding. The end state is wiring `pgChatStore` and
 * `pgSearchStore` — both built, both reviewed, both still unwired — through
 * this file and switching routes.ts to them, which is step 10 of
 * docs/plans/postgres-storage-implementation.md.
 *
 * ## The other thing this file is the boundary for
 *
 * Every error leaving a Postgres store is translated on the way out, by
 * `guardDbStore` in [db-errors.ts](db-errors.ts). A failed Drizzle query puts
 * **every bound parameter into `Error.message`**, and the bound parameters here
 * are the reader's quote and the model's answer. Read that file before
 * exporting anything new from this one — a store wired in without the guard is
 * a store that can publish the article in a 500.
 */

import { log } from "../log.js";
import type {
  ArticleReader,
  CommentStore,
  GlossaryStore,
  LibrarySearch,
  ShelfStore,
} from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import {
  fsArticleReader,
  fsCommentStore,
  fsGlossaryStore,
  fsLibrarySearch,
  fsShelfStore,
} from "./fs.js";
import { notMigrated, STORE } from "./live.js";
import { pgArticleReader } from "./pg.js";
import { pgCommentStore } from "./pg-comments.js";
import { pgLibrarySearch, pgShelfStore } from "./pg-shelf.js";

/**
 * The flag and the refusal both live in [live.ts](live.ts), which imports
 * nothing of ours.
 *
 * They were here until 2026-08-26 and had to move, for a reason worth knowing
 * before anybody moves them back: `src/chat.ts` and `src/searches.ts` need to
 * ask which store is live, and this file imports [fs.ts](fs.ts), which imports
 * both of them. Asking from here would be an import cycle, and `npm run check`
 * gates on cycles.
 *
 * Re-exported rather than merely imported, because `STORE` is what
 * `src/vercel-health.ts` reports and `storeFromEnv` is what
 * `tests/store-selection.test.ts` drives — neither should have to know the flag
 * moved house.
 */
export { type StoreName, STORE, storeFromEnv } from "./live.js";

if (STORE === "postgres") {
  // info, not debug: which store is serving reads is the first thing anybody
  // investigating a wrong answer needs to know, and it is one line per boot.
  log("store").info({ store: STORE }, "serving article reads from Postgres");
}

/**
 * Every Postgres store goes through here, and only the Postgres ones do.
 *
 * The filesystem stores are not wrapped, deliberately. They bind no parameters,
 * so they cannot leak one — and routes.ts reads `err.code === "ENOENT"` off
 * them to answer 404, which a translation would take away. Narrower blast
 * radius, and the honest reason: the hazard is Drizzle's, not storage's.
 */
function guarded<T extends object>(what: string, pg: T, files: T): T {
  return STORE === "postgres" ? guardDbStore(what, pg) : files;
}

const reader: ArticleReader = guarded(
  "reader",
  pgArticleReader as ArticleReader,
  fsArticleReader,
);

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
export const commentStore: CommentStore = guarded("comments", pgCommentStore, fsCommentStore);

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
export const shelfStore: ShelfStore = guarded("shelf", pgShelfStore, fsShelfStore);

export const librarySearch: LibrarySearch = guarded("library", pgLibrarySearch, fsLibrarySearch);
