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
 * **`notMigrated` can only guard what comes through this file.** For most of
 * 2026-08-26 chat and meaning-search did not: src/routes.ts imported their
 * writes straight from src/chat.ts and src/searches.ts, which write to disk
 * with `node:fs/promises` and never read the flag. So in `postgres` mode those
 * two did the thing the paragraph above calls the worst available outcome, and
 * no line written *here* could change it — which mattered, because two plans
 * proposed extending `notMigrated` to cover them and it could not: the call
 * never arrived. They refused at their own `save()` in the interim.
 *
 * **That interim is over.** `chatStore`, `searchStore` and
 * `glossaryLookupStore` are wired below and routes.ts calls them, so those
 * writes come through this file like everything else and the two `save()`
 * guards are gone. What is left of `notMigrated` is one method:
 * `deleteGlossary`, which nulls the glossary on a *published* revision, and
 * whether a published revision may be mutated at all is the open decision step
 * 11 carries. So the glossary panel's "start over" does not work under
 * `postgres` yet, and that is written down rather than waiting to be found.
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
import { makeLookUpTerm } from "../term-lookup.js";
import type {
  ArticleReader,
  ChatStore,
  CommentStore,
  GlossaryLookupStore,
  GlossaryStore,
  LibrarySearch,
  ReaderStore,
  SearchStore,
  ShelfStore,
} from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import {
  fsArticleReader,
  fsAssertWritableGlossary,
  fsChatStore,
  fsCommentStore,
  fsGlossaryLookupStore,
  fsGlossaryStore,
  fsLibrarySearch,
  fsReaderStore,
  fsSearchStore,
  fsShelfStore,
} from "./fs.js";
import { notMigrated, STORE } from "./live.js";
import { pgArticleReader } from "./pg.js";
import { pgChatStore } from "./pg-chat.js";
import { pgCommentStore } from "./pg-comments.js";
import { pgGlossaryLookupStore } from "./pg-lookups.js";
import { pgReaderStore } from "./pg-reader.js";
import { pgSearchStore } from "./pg-searches.js";
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

/**
 * The reader's own state: conversations, saved searches, checked terms.
 *
 * All three follow the same flag as the article reads, and all three have to.
 * A conversation written to a file while the article it is about came from
 * Postgres is a conversation no Postgres read will ever return — the failure
 * the header calls the worst available outcome, because it reports success and
 * loses the data.
 *
 * `guarded` is not optional on any of them. The parameters Drizzle puts into a
 * failed query's message here are the reader's question and the model's whole
 * answer — see [db-errors.ts](db-errors.ts) before adding a fourth.
 */
export const chatStore: ChatStore = guarded("chat", pgChatStore, fsChatStore);

export const searchStore: SearchStore = guarded("searches", pgSearchStore, fsSearchStore);

export const glossaryLookupStore: GlossaryLookupStore = guarded(
  "lookups",
  pgGlossaryLookupStore,
  fsGlossaryLookupStore,
);

/**
 * Checking one term on the web.
 *
 * **Not an adapter method**, and that is the point of the move. A lookup reads
 * the glossary, the blocks and the meta, calls `explain`, and stores one
 * answer; only the last of those differs between the stores, and the first
 * three are the seams above. So it is built here out of the parts rather than
 * written twice — two copies of the 404 / 403 / 409 rules and the `safeUrl`
 * filter is the divergence this whole seam exists to make impossible.
 * src/term-lookup.ts.
 *
 * `assertWritable` is the one genuinely file-shaped piece: `articleDir` falls
 * through to the committed `example/` directory for any slug with no artefacts,
 * so the filesystem needs a 403 that Postgres does not (no row, 404).
 */
export const lookUpTerm = makeLookUpTerm({
  reader,
  lookups: glossaryLookupStore,
  ...(STORE === "postgres" ? {} : { assertWritable: fsAssertWritableGlossary }),
});

/**
 * Throwing the glossary away, which is **still 501 under `postgres`**.
 *
 * The SQL is trivial. What is not settled is whether it may run at all: it
 * nulls `article_revisions.glossary` on the *published* revision, and that
 * table says immutable once published. Step 11 of
 * docs/plans/postgres-storage-implementation.md owns that decision, so this
 * stays refused rather than being quietly made an exception — and the visible
 * cost is that the glossary panel's "start over" does not work in `postgres`
 * mode.
 */
const glossary: Pick<GlossaryStore, "deleteGlossary"> =
  STORE === "postgres" ? { deleteGlossary: notMigrated("Deleting the glossary") } : fsGlossaryStore;

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

/**
 * The reader's global profile — "about you", not scoped to any article.
 *
 * Follows the same flag as everything above, for the same reason: a profile
 * written to `data/reader.json` while `postgres` mode serves reads out of
 * `reader_profiles` is a write nothing will ever read back — the exact
 * failure `notMigrated` exists to prevent. docs/plans/reader-profile.md.
 */
export const readerStore: ReaderStore = guarded("reader-profile", pgReaderStore, fsReaderStore);
