/**
 * Which store object answers which contract — and since 2026-09-05 there is
 * only one store, so this file wires rather than chooses.
 *
 * ## The choice is gone, and this is what that means here
 *
 * `SPIDERYARN_STORE` selected between a directory under `data/` and Postgres
 * until 2026-09-05, when the flag and the filesystem store went
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § F). Every seam below is now the Postgres adapter, unconditionally, and the
 * three refusals that used to stand in for a filesystem side — admin, sharing,
 * feedback — are gone with the side they were refusing for. What is left of the
 * flag is a tombstone in [live.ts](live.ts): unset and `postgres` pass, anything
 * else throws, until Greg takes the variable out of Vercel.
 *
 * `src/routes.ts` imports the article reads from here instead of from
 * `src/api.ts`. That is a one-line change in a file several agents are editing,
 * which is deliberate — see docs/plans/260826e-postgres-storage-implementation.md.
 *
 * ## The rule this file exists to keep
 *
 * **No fallback, ever.** Nothing here catches a Postgres error and retries
 * against anything else. A fallback would hide exactly the divergence the parity
 * tests were built to find, and would do it in production, silently, where
 * nobody is comparing. From
 * [the order of work](../../docs/plans/260825f-postgres-migration.md#the-order-of-work):
 * *"Do not catch a Postgres error and fall back to files."* With one store there
 * is nothing to fall back **to**, which is the strongest form of that rule and
 * the point of having got here.
 *
 * The corollary was the `notMigrated` helper in [live.ts](live.ts): a write with
 * no Postgres implementation had to fail loudly rather than quietly write a file
 * the reader would never read back. **Nothing in this file refuses any more** —
 * `deleteGlossary` was the last one holding out and was built on 2026-09-03
 * (docs/plans/260903e-glossary-delete-in-postgres.md).
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

/* **The `SPIDERYARN_STORE` tombstone is not imported here, and that is the
   correction.** It was, for about a day: this file is the reader wiring hub and
   the obvious place. It is also only one door — `src/jobs.ts`,
   `src/upload-records.ts` and `src/store/ai-calls.ts` all reach Postgres without
   coming through here, so the refusal was in the program on one path of several
   and the fix looked complete because the reported symptom went away. It lives
   at [`src/db/client.ts`](../db/client.ts) now, which is the boundary every one
   of them crosses, and that file says why at length.

   Every seam below reaches `getDb`, so importing one of them loads it. */

import { log } from "../log.js";
import { makeAskAboutTerm, makeLookUpTerm } from "../term-lookup.js";
import type {
  AdminStore,
  ArticleReader,
  ChatStore,
  CommentStore,
  FeedbackStore,
  FetchAllowanceStore,
  GlossaryLookupStore,
  GlossaryStore,
  LibrarySearch,
  LinkPreviewStore,
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
import { pgRealtimeSessionStore } from "./realtime-sessions-pg.js";
import { pgAdminStore } from "./pg-admin.js";
import { pgArticleReader } from "./pg.js";
import { pgChatStore } from "./pg-chat.js";
import { pgCommentStore } from "./pg-comments.js";
import { pgFeedbackStore } from "./pg-feedback.js";
import { pgGlossaryStore } from "./pg-glossary.js";
import { pgLinkPreviewStore } from "./pg-link-previews.js";
import { pgFetchAllowanceStore } from "./pg-rate-limit.js";
import { pgGlossaryLookupStore } from "./pg-lookups.js";
import { pgReaderStore } from "./pg-reader.js";
import { pgRefereeClaimsStore } from "./pg-referee-claims.js";
import { pgRefereeCriteriaStore } from "./pg-referee-criteria.js";
import { pgSearchStore } from "./pg-searches.js";
import { pgLibrarySearch, pgShelfStore } from "./pg-shelf.js";
import { pgSourceStore } from "./pg-source.js";
import { pgVisibilityStore } from "./pg-visibility.js";

import { postgresBlobStore } from "./blobs.js";

/**
 * **Postgres without a matching bucket is not a configuration, it is a split
 * brain.** Article rows go to Postgres while their source documents would go to
 * `data/_blobs/` on whichever machine happened to run the fetch, where no other
 * instance can reach them — or to a *different* Supabase project from the one
 * the row is stored in, which is the same failure by a longer route.
 * `DATABASE_URL` chooses the database and the presence of a service key chooses
 * the blob store; two independent choices, and once a revision row holds an
 * object key they must agree or the row points at nothing.
 *
 * Both refusals live in the **constructor**, `postgresBlobStore` in
 * [blobs.ts](blobs.ts), and this line is one of its two callers. They were
 * written out here until 2026-08-28, and that is exactly how
 * `scripts/db-export.ts` came to have neither: it imports `src/store/export.js`
 * and never this file, so the rollback tool ran unchecked. A check that only one
 * door passes through is not a check.
 *
 * Boot-time rather than per-request, because otherwise it surfaces as a missing
 * source document on some article weeks later, which reads like a lost file
 * rather than like a configuration that was never coherent. Loud, now, before
 * anybody's data is involved. GPT Sol raised the project pair, 2026-08-27, as
 * the one way a dangling reference arrives without anybody deleting anything —
 * and found that the credentials check I had written beside it missed the
 * commonest case.
 *
 * **It used to sit under `if (STORE === "postgres")`**, whose `else` was the
 * boot-time refusal that stopped the filesystem store serving a signed-in world.
 * Both went with the flag on 2026-09-05: there is no other store to select, so
 * there is no configuration in which the pair does not have to agree.
 *
 * ## Why it is off under the test runner, which is a real weakening said out loud
 *
 * Because the unit lane **deliberately** points `DATABASE_URL` and
 * `SUPABASE_URL` at two different loopback ports, so that an escapee reaching
 * either fails in milliseconds naming the one it reached
 * ([`tests/helpers/unit-lane-poison.ts`](../../tests/helpers/unit-lane-poison.ts)).
 * That is exactly the split brain this line refuses, and with the flag gone the
 * line runs on every import — so around thirty unit-lane files that merely
 * import a route stopped collecting at all, on a message about Supabase ports
 * and nothing to do with what they test.
 *
 * A test importing this module is not a server boot, and two poisons are not a
 * configuration anybody deployed. `src/env.ts` and `src/log.ts` already draw a
 * line at `NODE_ENV === "test"` for the same kind of reason.
 *
 * **`VITEST` as well as `NODE_ENV`, and the second one is not belt and braces.**
 * Four suites spawn a child with `NODE_ENV=development` **on purpose**, because
 * `src/log.ts` is silent under `test` and their evidence is the child's stdout
 * (`tests/chat-empty-answer-log.test.ts` says why). Those children inherit the
 * poison and *not* the `NODE_ENV`, so a `NODE_ENV`-only guard let them through
 * and nine cases died on the port message — measured 2026-09-05, after the
 * one-condition version was written. `VITEST=true` is set by the runner and does
 * survive into a child, which is precisely the property needed here.
 *
 * **What it costs**: nothing exercises this call under the runner any more.
 * `tests/blobs.test.ts` drives `postgresBlobStore` directly and owns both
 * refusals, and `tests/one-store-only.test.ts` asserts *this line still exists*,
 * because a check nobody runs is one somebody deletes.
 *
 * The store itself is discarded: the fetch and upload paths call `blobStore()`
 * for their own, following the credentials (blobs.ts § Why selection does not
 * read `SPIDERYARN_STORE`). Constructing one here is how the pair is checked.
 */
if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
  postgresBlobStore("the store is Postgres");
}

// info, not debug: which store is serving reads is the first thing anybody
// investigating a wrong answer needs to know, and it is one line per boot.
log("store").info("serving article reads from Postgres");

/**
 * What a seam gets: the Postgres store, with a second guard round it.
 *
 * **It used to choose**, taking a filesystem store as a third argument and a
 * flag deciding. There is one store since 2026-09-05, so all that is left is the
 * guard — kept as a helper rather than inlined, because the thing worth keeping
 * from the choice is that every seam below is wired through *one* line that
 * cannot forget it.
 *
 * **The wrapping here is now redundant, and deliberately so.** Every Postgres
 * store this helper is handed already comes out of `guardDbStore` at its own
 * export (`pgCommentStore` in pg-comments.ts, and so on for all seventeen), so
 * `guardDbStore` sees a store that is already marked and hands the same object
 * straight back. Guarding at the export is what makes the guard travel with the
 * store rather than depend on whoever wires it — the 2026-08-27 accident in
 * docs/postmortems/260827c-unguarded-job-store-and-the-migration-that-migrated-the-laptop.md
 * was three selection sites, one of which forgot. Keeping the call here costs
 * nothing (the early return in db-errors.ts, proved by
 * tests/store-guard-idempotent.test.ts) and means a store added tomorrow is
 * wrapped even if its author has read none of this.
 *
 * A store that already guards itself at its own export — `pgCommentStore` does,
 * the way src/store/pg-jobs.ts and src/store/pg-uploads.ts do — passes through
 * unchanged, because `guardDbStore` is idempotent. There is no special case
 * here to remember: the invariant lives with the wrapper (db-errors.ts § Wrapping
 * a wrapped store is a no-op), where it protects every caller and not just this
 * one.
 */
function guarded<T extends object>(what: string, pg: T): T {
  return guardDbStore(what, pg);
}

const reader: ArticleReader = guarded("reader", pgArticleReader);

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
export const chatStore: ChatStore = guarded("chat", pgChatStore);

export const searchStore: SearchStore = guarded("searches", pgSearchStore);

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
export const refereeCriteriaStore: RefereeCriteriaStore = guarded("referee-criteria", pgRefereeCriteriaStore);

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
export const refereeClaimsStore: RefereeClaimsStore = guarded("referee-claims", pgRefereeClaimsStore);

export const glossaryLookupStore: GlossaryLookupStore = guarded("lookups", pgGlossaryLookupStore);

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
 * **No `assertWritable` since 2026-09-05.** It was the one genuinely file-shaped
 * piece: the filesystem could reach the committed `example/` article, which
 * nobody owns, so it needed a 403 that Postgres does not — there is no such
 * article in the database at all. The seam in src/term-lookup.ts stays optional
 * for the next store-shaped 403; nothing supplies one.
 */
export const lookUpTerm = makeLookUpTerm({
  reader,
  lookups: glossaryLookupStore,
});

/**
 * Explaining a term the reader typed into the glossary's box.
 *
 * **The same parts as `lookUpTerm` above, minus the store**, because nothing is
 * saved — src/types.ts § `AskedTermAnswer` has the three reasons, the sharpest
 * being that the glossary blob is published with a shared article. So there is
 * no `lookups` seam here and no second copy of the anchor rule: both verbs are
 * built from `anchorIn` in src/term-lookup.ts, which is the whole argument for
 * that file existing.
 *
 * No `assertWritable`, for the same reason as its neighbour above.
 */
export const askAboutTerm = makeAskAboutTerm({
  reader,
});

/**
 * Throwing the glossary away, so the article can find a new one.
 *
 * The glossary panel's **Start again**, and one method: null the list on the
 * article's current revision and say whether there was one to null. It answered
 * 501 under `postgres` until 2026-09-03, which meant the button worked for
 * nobody but a developer on a laptop — and the button itself went on 2026-09-05
 * (`Foot` in src/web/GlossaryPanel.tsx), so this has no client caller now. Kept
 * deliberately: docs/project/glossary.md § Finding more.
 *
 * **It can now answer 409**, and that is the one thing a reader can be told here
 * that they could not before: while a live job holds a draft of this article,
 * the delete is refused, because every draft carries the glossary forward and
 * publishing one after the delete would put the old list back. The panel used to
 * show that message; with the button gone the caller is whatever reaches the
 * route, so the sentence names no button.
 * src/store/pg-glossary.ts; docs/plans/260903e-glossary-delete-in-postgres.md.
 */
const glossary: Pick<GlossaryStore, "deleteGlossary"> = guarded("glossary", pgGlossaryStore);

export const deleteGlossary = glossary.deleteGlossary;

/**
 * Comments follow the same flag as the article reads, and they have to.
 *
 * A comment anchors to a block id, and in `postgres` mode the article those
 * blocks came from is a set of rows. Leaving comments on the filesystem while
 * the article came from Postgres would mean the reader's questions and the
 * paragraphs they point at living in two stores that nothing keeps in step.
 */
export const commentStore: CommentStore = guarded("comments", pgCommentStore);

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
export const shelfStore: ShelfStore = guarded("shelf", pgShelfStore);

export const librarySearch: LibrarySearch = guarded("library", pgLibrarySearch);

/**
 * The reader's global profile — "about you", not scoped to any article.
 *
 * Follows the same flag as everything above, for the same reason: a profile
 * written to `data/reader.json` while `postgres` mode serves reads out of
 * `reader_profiles` is a write nothing will ever read back — the exact
 * failure `notMigrated` exists to prevent. docs/plans/260826t-reader-profile.md.
 */
export const readerStore: ReaderStore = guarded("reader-profile", pgReaderStore);

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
export const sourceStore: SourceStore = guarded("source", pgSourceStore);

/**
 * Who has signed up — the admin page's one endpoint.
 *
 * **There was a filesystem *refusal* beside this until 2026-09-05**, and it is
 * worth knowing what it was refusing: there is no user list on a filesystem —
 * `data/` was one directory per slug and nothing in it recorded that a person
 * exists — so that side could only be declined, never written. It is gone with
 * the store it was declining for, and this is now `guarded(...)` like every
 * other seam. docs/project/admin.md.
 */
export const adminStore: AdminStore = guarded("admin", pgAdminStore);

/* ------------------------------------------------------------- sharing -- */

/**
 * May a stranger read this article — the owner's switch.
 *
 * **A filesystem *refusal* stood beside this until 2026-09-05.** `data/` was one
 * directory per slug and there was nowhere in it to record that a document is
 * shared, so a files adapter could only have reported success and shared
 * nothing. It is gone with the store, and this is `guarded(...)` like the rest.
 *
 * The public *reads* are deliberately not wired through this file at all. They
 * go straight to src/store/public-reader.ts from src/public/routes.ts, because
 * this module imports the whole read layer and the public import graph is
 * asserted closed against it — tests/public-imports.test.ts.
 * docs/plans/260827ai-public-read-only-access.md.
 */
export const visibilityStore: VisibilityStore = guarded("visibility", pgVisibilityStore);

/* ------------------------------------------------------------- feedback -- */

/**
 * **A bug report from a reader who is looking at the thing that went wrong.**
 *
 * **A filesystem *refusal* stood beside this until 2026-09-05**, because there
 * was no feedback table on a filesystem and a Feedback button that accepts a
 * report and drops it teaches the one reader who tried to tell us something that
 * telling us does nothing (docs/reusable/silent-success.md). There is one store
 * now, so there is nothing to decline.
 */
export const feedbackStore: FeedbackStore = guarded("feedback", pgFeedbackStore);

/* -------------------------------------------------------- link previews -- */

/**
 * **What the page on the other end of a hyperlink says about itself.**
 *
 * The one seam here whose rows have **no owner** — see src/db/schema.ts §
 * `linkPreviews` for why that is the privacy feature rather than a lapse, and
 * what three things had to be true before it could be. Guarded like the rest:
 * `guardDbStore` matters as much here as anywhere, because a failed Drizzle
 * query puts every bound parameter into `Error.message` and the bound parameter
 * here is a URL somebody hovered.
 */
export const linkPreviewStore: LinkPreviewStore = guarded("link-previews", pgLinkPreviewStore);

/**
 * **How many outbound fetches one reader's pointer may cause.**
 *
 * Owner-scoped where the table above is ownerless, and the two must never be
 * joined: one knows what was fetched and nothing about who asked, the other
 * knows who asked and nothing about what. src/store/pg-rate-limit.ts.
 */
export const fetchAllowanceStore: FetchAllowanceStore = guarded(
  "fetch-allowance",
  pgFetchAllowanceStore,
);

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
export const realtimeSessionStore: RealtimeSessionStore = guarded(
  "realtime-sessions",
  pgRealtimeSessionStore,
);
