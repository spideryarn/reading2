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
 * which is deliberate — see docs/plans/260826e-postgres-storage-implementation.md.
 *
 * ## The rule this file exists to keep
 *
 * **No fallback, ever.** Nothing here catches a Postgres error and retries
 * against the filesystem. A fallback would hide exactly the divergence the
 * parity test is built to find, and would do it in production, silently, where
 * nobody is comparing. From
 * [the order of work](../../docs/plans/260825f-postgres-migration.md#the-order-of-work):
 * *"Do not catch a Postgres error and fall back to files."*
 *
 * The corollary was the `notMigrated` helper in [live.ts](live.ts): a write with
 * no Postgres implementation must fail loudly rather than quietly write a file
 * the reader will never read back. A write that lands in the store nobody is
 * reading is the worst available outcome — it reports success and loses the
 * data.
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
 * **Nothing in this file refuses any more.** `chatStore`, `searchStore` and
 * `glossaryLookupStore` are wired below and routes.ts calls them; `deleteGlossary`
 * was the last one holding out, and it was built on 2026-09-03
 * (docs/plans/260903e-glossary-delete-in-postgres.md). The helper still exists
 * for the next seam that needs it, and `SEAM_ASYMMETRIES` in
 * [live.ts](live.ts) is what keeps a refusal from being mistaken for a store.
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
  AdminStore,
  ArticleReader,
  ChatStore,
  CommentStore,
  FeedbackStore,
  GlossaryLookupStore,
  GlossaryStore,
  LibrarySearch,
  ReaderStore,
  RealtimeSessionStore,
  RefereeClaimsStore,
  RefereeCriteriaStore,
  SearchStore,
  ShelfStore,
  SourceStore,
  VisibilityStore,
} from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { fsSourceStore } from "./artifacts-fs.js";
import {
  fsArticleReader,
  fsAssertWritableGlossary,
  fsChatStore,
  fsCommentStore,
  fsGlossaryLookupStore,
  fsGlossaryStore,
  fsLibrarySearch,
  fsReaderStore,
  fsRefereeClaimsStore,
  fsRefereeCriteriaStore,
  fsSearchStore,
  fsShelfStore,
} from "./fs.js";
import { STORE } from "./live.js";
import { fsRealtimeSessionStore } from "./realtime-sessions-fs.js";
import { pgRealtimeSessionStore } from "./realtime-sessions-pg.js";
import { pgAdminStore } from "./pg-admin.js";
import { pgArticleReader } from "./pg.js";
import { pgChatStore } from "./pg-chat.js";
import { pgCommentStore } from "./pg-comments.js";
import { pgFeedbackStore } from "./pg-feedback.js";
import { pgGlossaryStore } from "./pg-glossary.js";
import { pgGlossaryLookupStore } from "./pg-lookups.js";
import { pgReaderStore } from "./pg-reader.js";
import { pgRefereeClaimsStore } from "./pg-referee-claims.js";
import { pgRefereeCriteriaStore } from "./pg-referee-criteria.js";
import { pgSearchStore } from "./pg-searches.js";
import { pgLibrarySearch, pgShelfStore } from "./pg-shelf.js";
import { pgSourceStore } from "./pg-source.js";
import { pgVisibilityStore } from "./pg-visibility.js";

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

import { postgresBlobStore } from "./blobs.js";

if (STORE === "postgres") {
  /**
   * **Postgres without a matching bucket is not a configuration, it is a split
   * brain.** Article rows would go to Postgres while their source documents
   * went to `data/_blobs/` on whichever machine happened to run the fetch,
   * where no other instance can reach them — or to a *different* Supabase
   * project from the one the row is stored in, which is the same failure by a
   * longer route. `DATABASE_URL` chooses the database and the presence of a
   * service key chooses the blob store; two independent choices, and once a
   * revision row holds an object key they must agree or the row points at
   * nothing.
   *
   * Both refusals now live in the **constructor**, `postgresBlobStore` in
   * [blobs.ts](blobs.ts), and this line is one of its two callers. They were
   * written out here until 2026-08-28, and that is exactly how
   * `scripts/db-export.ts` came to have neither: it imports `src/store/export.js`
   * and never this file, so the rollback tool ran unchecked. A check that only
   * one door passes through is not a check.
   *
   * Boot-time rather than per-request, because otherwise it surfaces as a
   * missing source document on some article weeks later, which reads like a
   * lost file rather than like a configuration that was never coherent. Loud,
   * now, before anybody's data is involved. Only under `postgres`, because it is
   * only there that a reference is written down at all. GPT Sol raised the
   * project pair, 2026-08-27, as the one way a dangling reference arrives
   * without anybody deleting anything — and found that the credentials check I
   * had written beside it missed the commonest case.
   *
   * The store itself is discarded: the fetch and upload paths call `blobStore()`
   * for their own, deliberately following the credentials rather than
   * `SPIDERYARN_STORE` (blobs.ts § Why selection does not read
   * `SPIDERYARN_STORE`). Constructing one here is how the pair is checked.
   */
  postgresBlobStore('SPIDERYARN_STORE is "postgres"');

  // info, not debug: which store is serving reads is the first thing anybody
  // investigating a wrong answer needs to know, and it is one line per boot.
  log("store").info({ store: STORE }, "serving article reads from Postgres");
} else if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  /**
   * **The filesystem store cannot be the live one where strangers can sign in.**
   *
   * It has no owner column and no owner filter — it is one directory per slug
   * under `data/`, and there is nowhere for a second reader's articles to go.
   * Postgres got `owner_id` filtering on 2026-08-27 (src/store/pg.ts §
   * `ownedSlug`); the filesystem side deliberately did not, because it is the
   * local development store and its replacement is the whole point of
   * docs/plans/260825f-postgres-migration.md.
   *
   * So this is a boot-time refusal rather than a per-request one. On Vercel it
   * would have failed anyway — there is no writable disk — but it would have
   * failed as ENOENT on the first read, which reads as a missing article rather
   * than as a store that must never have been selected. Loud, at the moment the
   * configuration is wrong, and before anybody's data is involved.
   */
  throw new Error(
    `SPIDERYARN_STORE is "${STORE}" in production. The filesystem store has no ` +
      "owner column, so every signed-in reader would share one library. " +
      "Set SPIDERYARN_STORE=postgres. See src/store/index.ts.",
  );
}

/**
 * Which of the two a seam gets — and, for the Postgres one, a second guard.
 *
 * **The wrapping here is now redundant, and deliberately so.** Every Postgres
 * store this helper is handed already comes out of `guardDbStore` at its own
 * export (`pgCommentStore` in pg-comments.ts, and so on for all seventeen), so
 * `guardDbStore` sees a store that is already marked and hands the same object
 * straight back. Guarding at the export is what makes the guard travel with the
 * store rather than depend on whoever selects it — the 2026-08-27 accident in
 * docs/postmortems/260827c-unguarded-job-store-and-the-migration-that-migrated-the-laptop.md
 * was three selection sites, one of which forgot. Keeping the call here costs
 * nothing (the early return in db-errors.ts, proved by
 * tests/store-guard-idempotent.test.ts) and means a store added tomorrow is
 * wrapped even if its author has read none of this.
 *
 * The filesystem stores are not wrapped, deliberately. They bind no parameters,
 * so they cannot leak one — and routes.ts reads `err.code === "ENOENT"` off
 * them to answer 404, which a translation would take away. Narrower blast
 * radius, and the honest reason: the hazard is Drizzle's, not storage's.
 *
 * A store that already guards itself at its own export — `pgCommentStore` does,
 * the way src/store/pg-jobs.ts and src/store/pg-uploads.ts do — passes through
 * unchanged, because `guardDbStore` is idempotent. There is no special case
 * here to remember: the invariant lives with the wrapper (db-errors.ts § Wrapping
 * a wrapped store is a no-op), where it protects every caller and not just this
 * one.
 */
function guarded<T extends object>(what: string, pg: T, files: T): T {
  return STORE === "postgres" ? guardDbStore(what, pg) : files;
}

const reader: ArticleReader = guarded("reader", pgArticleReader, fsArticleReader);

export const loadArticle = reader.loadArticle.bind(reader);
export const listArticles = reader.listArticles.bind(reader);
export const articleMetadata = reader.articleMetadata.bind(reader);
export const loadTweets = reader.loadTweets.bind(reader);
export const loadGlossary = reader.loadGlossary.bind(reader);
export const loadQuotes = reader.loadQuotes.bind(reader);
export const loadIdeas = reader.loadIdeas.bind(reader);
export const loadTimeline = reader.loadTimeline.bind(reader);
export const loadQuiz = reader.loadQuiz.bind(reader);
export const loadSketch = reader.loadSketch.bind(reader);
export const loadIllustrated = reader.loadIllustrated.bind(reader);
/* The one read whose answer is bytes. See `ArticleReader.loadSource` in
   contracts.ts for what `null` means and what it deliberately does not. */
export const loadSource = reader.loadSource.bind(reader);
export const loadArc = reader.loadArc.bind(reader);

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

/**
 * **A referee's own criteria, run over the paper** — the same flag as the
 * searches beside it, and for the same reason plus one of its own.
 *
 * The general reason first: a criterion written to a file while the article it
 * is about came from Postgres is a write no Postgres read will ever return —
 * the failure this file's header calls the worst available outcome, because it
 * reports success and loses the data.
 *
 * The one of its own is `comments.criterion_id`. The referee's *own* placement
 * of a passage is a comment (drizzle/0043), and it carries a foreign key to
 * `(article_id, id)` on this table. Comments follow the flag; if criteria did
 * not, a referee's mark would point at a row that store cannot see.
 *
 * `guarded(...)` is not optional. The parameters Drizzle puts into a failed
 * query's message here are the referee's criterion and the passages the model
 * quoted — see [db-errors.ts](db-errors.ts).
 */
export const refereeCriteriaStore: RefereeCriteriaStore = guarded(
  "referee-criteria",
  pgRefereeCriteriaStore,
  fsRefereeCriteriaStore,
);

/**
 * **A paper's claims run** — `guarded(...)` like the criteria above it, since
 * 2026-09-01.
 *
 * It was not, and the reason is worth keeping rather than deleting. Claims
 * shipped on 2026-08-31 with a filesystem store only, and every method here
 * refused with a 501 under `SPIDERYARN_STORE=postgres` — a recorded decision
 * with two arguments behind it.
 *
 * **The first still stands**: a claims run is an article-derived reusable
 * artefact, and the plan
 * (docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2) is explicit that
 * its right home is a **pipeline artefact** — `StepName`, `ArtifactKind`, an
 * `article_revisions` column. `referee_claims` is therefore an **interim**, and
 * drizzle/0051_referee_claims.sql says so in its own header so that the day it
 * is replaced is a decision rather than a discovery.
 *
 * **The second has expired, and it was the blocking one.** src/store/export.ts
 * was being rewritten in another session that day, so a new table could only
 * have landed *without* an `ARTICLE_TABLE_COVERAGE` entry — precisely the
 * accident of the day before, when `db:export` had never heard of
 * `referee_criteria` and dropped every one of them from the rollback while
 * reporting success. That file is committed and stable, so the table lands with
 * its coverage entry and with the fixture that makes the entry true.
 *
 * What stood against the interim was a cross-family review's finding 4: under
 * the store that actually deploys, *"'Pull the paper's claims' cannot load,
 * start or persist a run"*. A sub-mode that only works on a laptop is not built.
 *
 * `guarded(...)` is not optional. The parameters Drizzle puts into a failed
 * query's message here are the paper's own sentences — a claims run is nothing
 * but quotations from somebody else's unpublished work. See
 * [db-errors.ts](db-errors.ts).
 */
export const refereeClaimsStore: RefereeClaimsStore = guarded(
  "referee-claims",
  pgRefereeClaimsStore,
  fsRefereeClaimsStore,
);

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
 * `assertWritable` is the one genuinely file-shaped piece: the filesystem can
 * reach the committed `example/` article, which nobody owns, so it needs a 403
 * that Postgres does not (no such article there at all).
 */
export const lookUpTerm = makeLookUpTerm({
  reader,
  lookups: glossaryLookupStore,
  ...(STORE === "postgres" ? {} : { assertWritable: fsAssertWritableGlossary }),
});

/**
 * Throwing the glossary away, so the article can find a new one.
 *
 * The glossary panel's **Start again**, and one method: null the list on the
 * article's current revision and say whether there was one to null. It answered
 * 501 under `postgres` until 2026-09-03, which meant the button worked for
 * nobody but a developer on a laptop.
 *
 * **It can now answer 409**, and that is the one thing a reader can be told here
 * that they could not before: while a live job holds a draft of this article,
 * the delete is refused, because every draft carries the glossary forward and
 * publishing one after the delete would put the old list back. The panel shows
 * the message and does not fall through to a run.
 * src/store/pg-glossary.ts; docs/plans/260903e-glossary-delete-in-postgres.md.
 */
const glossary: Pick<GlossaryStore, "deleteGlossary"> = guarded(
  "glossary",
  pgGlossaryStore,
  fsGlossaryStore,
);

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
 * failure `notMigrated` exists to prevent. docs/plans/260826t-reader-profile.md.
 */
export const readerStore: ReaderStore = guarded("reader-profile", pgReaderStore, fsReaderStore);

/**
 * **The document the article was made from** — `GET /api/source/:slug`.
 *
 * The last route that did not come through this file. `sendSource` in
 * src/routes.ts authorised through `shelfStore` and then read
 * `data/<slug>/raw.pdf` off the disk itself, whatever `SPIDERYARN_STORE` said,
 * so under `postgres` it reported *"that article did not come from a PDF"*
 * about a PDF sitting in the `sources` bucket — and on a deployment it was the
 * jobless `dataRoot()` caller that src/store/data-root.ts names by route.
 * docs/plans/260831b-finish-the-database-move.md, stage 1.
 *
 * `guarded(...)` like the reads above it, because there really are two
 * implementations: `data/<slug>/` beside the manifest naming the file, and a
 * reference to a content-addressed object in the bucket. Not `notMigrated`, not
 * a refusal — both stores can answer.
 */
export const sourceStore: SourceStore = guarded("source", pgSourceStore, fsSourceStore);

/**
 * Who has signed up — the admin page's one endpoint.
 *
 * **Not `guarded(...)` like everything above it**, and the asymmetry is the
 * point: the other stores have two real implementations and a flag choosing
 * between them, while this one has a Postgres implementation and a filesystem
 * *refusal*. There is no user list on a filesystem — `data/` is one directory
 * per slug and nothing in it records that a person exists — so the `files`
 * side cannot be written, only declined.
 *
 * Declined loudly, with its own sentence rather than `notMigrated`'s: that one
 * says "no Postgres implementation yet", which is the opposite of what is true
 * here and would send whoever reads it to the wrong plan. The alternative — an
 * empty array — is the failure this whole directory keeps warning about: a page
 * that says *you have no users* and looks exactly like a page that works.
 * docs/reusable/silent-success.md.
 */
const adminOnFiles: AdminStore = {
  listUsersAcrossOwners: () => {
    throw Object.assign(
      new Error(
        "The admin users page needs Postgres — there are no user accounts on the " +
          "filesystem store. Run with SPIDERYARN_STORE=postgres. See docs/project/admin.md.",
      ),
      { status: 501 },
    );
  },
  /* Same refusal, same reason, and stated separately rather than shared: an
     empty array here would be a page saying *nobody has reported anything*,
     which is the exact silent success `feedbackOnFiles` below is written to
     avoid at the other end of the same feature. */
  listFeedbackAcrossOwners: () => {
    throw Object.assign(
      new Error(
        "The admin feedback page needs Postgres — the filesystem store has no " +
          "feedback table, so there are no reports to show. Run with " +
          "SPIDERYARN_STORE=postgres. See docs/project/admin.md.",
      ),
      { status: 501 },
    );
  },
  readFeedbackAcrossOwners: () => {
    throw Object.assign(
      new Error("Feedback needs Postgres — there are no reports on the filesystem store."),
      { status: 501 },
    );
  },
  readFeedbackScreenshotAcrossOwners: () => {
    throw Object.assign(
      new Error("Feedback needs Postgres — there are no reports on the filesystem store."),
      { status: 501 },
    );
  },
};

export const adminStore: AdminStore =
  STORE === "postgres" ? guardDbStore("admin", pgAdminStore) : adminOnFiles;

/* ------------------------------------------------------------- sharing -- */

/**
 * May a stranger read this article — the owner's switch.
 *
 * Selected the same way `adminStore` is, and for the same reason: there is a
 * Postgres implementation and a filesystem *refusal*, not two implementations
 * and a flag. `data/` is one directory per slug and there is nowhere in it to
 * record that a document is shared.
 *
 * Declined with its own sentence rather than `notMigrated`'s, which says "no
 * Postgres implementation yet" — the opposite of what is true here, and it would
 * send whoever read it to the wrong plan. The alternative — quietly reporting
 * success — is the failure this whole directory keeps warning about: a toggle
 * that flips, says nothing, and shares nothing.
 * docs/reusable/silent-success.md.
 *
 * The public *reads* are deliberately not wired through this file at all. They
 * go straight to src/store/public-reader.ts from src/public/routes.ts, because
 * this module imports the whole read layer and the public import graph is
 * asserted closed against it — tests/public-imports.test.ts.
 * docs/plans/260827ai-public-read-only-access.md.
 */
const visibilityOnFiles: VisibilityStore = {
  set: () => {
    throw Object.assign(
      new Error(
        "Sharing needs Postgres — the filesystem store has no visibility column, so " +
          "there is nowhere to record that a document is shared. Run with " +
          "SPIDERYARN_STORE=postgres. See docs/plans/260827ai-public-read-only-access.md.",
      ),
      { status: 501 },
    );
  },
};

export const visibilityStore: VisibilityStore =
  STORE === "postgres" ? guardDbStore("visibility", pgVisibilityStore) : visibilityOnFiles;

/* ------------------------------------------------------------- feedback -- */

/**
 * **A bug report from a reader who is looking at the thing that went wrong.**
 *
 * Selected the way `adminStore` and `visibilityStore` are, and for the same
 * reason: there is a Postgres implementation and a filesystem *refusal*, not two
 * implementations and a flag. A files adapter would be twenty lines written
 * against a module that docs/plans/260831b-finish-the-database-move.md deletes
 * this week, plus a `tests/store-parity.test.ts` obligation to keep two
 * implementations agreeing until one of them goes.
 *
 * Declined with its own sentence rather than `notMigrated`'s, which says "no
 * Postgres implementation yet" — the opposite of what is true here. The
 * alternative — quietly reporting success — is the failure this whole directory
 * keeps warning about, and it would be at its worst here: a Feedback button that
 * accepts a report and drops it teaches the one reader who tried to tell us
 * something that telling us does nothing. docs/reusable/silent-success.md.
 *
 * The refusal has to reach the reader as a **sentence**, not as a spinner that
 * stops — the rule `Masthead.tsx` already states about the rename pencil: a
 * button that can only fail is worse than no button, because pressing it is how
 * you find out.
 */
const feedbackOnFiles: FeedbackStore = {
  submit: () => {
    throw Object.assign(
      new Error(
        "Feedback needs Postgres — the filesystem store has no feedback table, so " +
          "there is nowhere to keep a bug report. Your report was not saved. Run " +
          "with SPIDERYARN_STORE=postgres. See " +
          "docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md.",
      ),
      { status: 501 },
    );
  },
  read: () => {
    throw Object.assign(
      new Error("Feedback needs Postgres — there are no reports on the filesystem store."),
      { status: 501 },
    );
  },
  markMirrorAttempted: () => {
    throw Object.assign(
      new Error("Feedback needs Postgres — there are no reports on the filesystem store."),
      { status: 501 },
    );
  },
  markMirrored: () => {
    throw Object.assign(
      new Error("Feedback needs Postgres — there are no reports on the filesystem store."),
      { status: 501 },
    );
  },
};

export const feedbackStore: FeedbackStore =
  STORE === "postgres" ? guardDbStore("feedback", pgFeedbackStore) : feedbackOnFiles;

/* -------------------------------------------------------- the AI ledger -- */

/**
 * **Every model call this app has paid for**, in whichever store is live.
 *
 * Selected and guarded in [ai-calls.ts](ai-calls.ts) rather than here, because
 * `src/jobs.ts` needs it too and cannot import this file without closing a
 * cycle — the same reason `live.ts` is its own file. Re-exported so that a route
 * does not have to know where it lives.
 *
 * The one thing worth saying that is not obvious from the line: **this is a
 * genuine second implementation, not the fallback the header forbids.** Nothing
 * catches a Postgres error and writes a file instead; the flag chooses at boot
 * and the other adapter is never consulted. The alternative — always Postgres,
 * warn and carry on when there is no `DATABASE_URL` — would have made the
 * **default** configuration the one that records nothing, with a warn line that
 * becomes background noise inside a week. GPT Sol's call, 2026-08-28; it
 * reversed docs/plans/260827q-ai-cost-tracking.md's own recommendation.
 */
export { costStore } from "./ai-calls.js";

/* --------------------------------------------------- live conversation -- */

/**
 * **The journal of live conversations** — issued, connected, closed.
 *
 * Selected the way `chatStore` and the rest are, with two real implementations
 * and a flag: `guarded()` is not used only because that helper is shaped for the
 * seams above it. There is nothing about a session journal a file cannot hold,
 * so this is deliberately **not** one of the filesystem *refusals* three
 * sections up — `AdminStore`, `VisibilityStore` and `FeedbackStore` refuse
 * because there is genuinely no user list, no visibility column and no feedback
 * table on a filesystem, and refusing here would only turn off a working feature
 * on every default checkout.
 *
 * The row it writes is what makes a live conversation *visible* even when it
 * reports nothing at all — see `realtimeSessions` in ../db/schema.ts, and
 * docs/project/live-conversation.md. Postgres is where this belongs and where
 * production reads it; the filesystem adapter exists so the laptop default keeps
 * working.
 */
export const realtimeSessionStore: RealtimeSessionStore =
  STORE === "postgres"
    ? guardDbStore("realtime-sessions", pgRealtimeSessionStore)
    : fsRealtimeSessionStore;
