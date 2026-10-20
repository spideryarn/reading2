/**
 * **An article passing from one account to another**, and the list
 * `/admin/articles` picks it from.
 * docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md § D2, D4.
 *
 * Nothing else in `src/` changes an article's owner. Two callers: the
 * administrator's *Transfer* (`POST /api/admin/articles/:id/transfer`, through
 * `pgArticleTransferStore` below) and a voucher's claim moving its private
 * starter article to the recipient (D3), which calls `transferStarterOnClaim`
 * — the same transfer with three more refusals — inside its own transaction.
 *
 * ## Why `UPDATE articles SET owner_id` is not the whole of it
 *
 * Every owner-scoped read goes through the article (`ownedSlug`), no foreign
 * key couples a child row's owner to its article's, and storage keys are
 * content-addressed. So changing the one column moves **everything** that hangs
 * off the article's id — the old owner's comments and chats included, which the
 * new owner would then read. The transfer therefore sorts every table that
 * touches an article into three (`ARTICLE_TABLES`):
 *
 * - **moves**: what the article *is* — its revisions, blocks, structure, every
 *   mode's model-made artefacts, checkpoints. Nothing to do; the id carries it.
 * - **reader-state**: the old owner's own words and activity on it. Deleted
 *   (`READER_STATE`, src/admin-articles.ts, in the order deleted).
 * - **history**: the ledgers and audit logs. Kept as they are, about the old
 *   owner — and `ingest_events` frozen and unlinked so it stays that way.
 *
 * tests/article-transfer.test.ts reads `information_schema` and fails on any
 * table with an `article_id` or `starter_article_id` column, or an owner and a
 * slug, that is in none of the three: a new table cannot ride along to the new
 * owner unnoticed.
 *
 * ## The order inside the transaction
 *
 * The target account is checked by the caller **before** this transaction
 * (`confirmedAccountEmail`, a network call; Sol F11). Then: the article row,
 * `FOR UPDATE`, with its owner rechecked; every refusal decided against that
 * locked row **before anything is written**, so a refusal leaves a transaction
 * it is part of (the claim's) as it found it; then the writes.
 *
 * **No `billing_accounts` lock, and that is measured against the rule, not
 * forgotten.** pg-billing.ts § *The lock order* says every transaction that
 * changes visibility locks its owner's billing row first, because an owner's
 * usage reads `articles.visibility` live. This one changes the visibility *and*
 * in the same transaction unlinks every ledger row with the visibility it had
 * frozen onto it (step 6) — so the old owner's usage reads the same before and
 * after the commit, and the new owner has no ledger rows on the article to
 * read. Neither owner's usage moves, so there is nothing for an admission to
 * race. It also keeps this callable from the claim, which holds the claimant's
 * billing anchor and would otherwise have to take a second owner's lock in an
 * order nobody else uses.
 *
 * ## What is not fenced (recorded, D2 residual)
 *
 * A write of the old owner's that resolved the article id before this commits
 * and inserts after it lands on the new owner's article. It needs the old owner
 * to be writing to it in the milliseconds the press runs; any later request of
 * theirs gets a 404. Fencing every owner-scoped write is queued, not built.
 */

import { and, asc, desc, eq, getTableName, inArray, isNull, ne, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import {
  type AdminArticle,
  READER_STATE,
  type ReaderStateTable,
  type TransferBlocked,
  type TransferCounts,
  type TransferPreview,
  type TransferRequest,
  ownWordsIn,
} from "../admin-articles.js";
import { getDb } from "../db/client.js";
import {
  articleRevisions,
  checkpoints,
  articleShareLinkEvents,
  articleTags,
  articleVisibilityChanges,
  articles,
  billingVouchers,
  chatMentions,
  chatMessages,
  chatThreads,
  citationFinds,
  citationInvestigations,
  citationWebNotes,
  commandSuggestionDismissals,
  comments,
  glossaryHiddenEntries,
  glossaryLookups,
  ingestEvents,
  jobs,
  linkSummaries,
  quizAttempts,
  readingTime,
  refereePromises,
  refereeCriteria,
  refereeHiddenChecks,
  searchRuns,
  sourcesClaimChecks,
  staleNoticeDismissals,
} from "../db/schema.js";
import { isUuid } from "../ids.js";
import { log } from "../log.js";
import { publicSourceUrl } from "../urls.js";
import { spendByArticle } from "./ai-calls-spend-pg.js";
import { guardDbStore } from "./db-errors.js";
import { READ_COMMITTED } from "./isolation.js";

const logger = log("store");

/** A transaction; the claim (D3) passes its own, inside a savepoint it writes out. */
export type TransferTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/* ------------------------------------------------------ the classification -- */

/** What a transfer does with a table's rows on the article. See the header. */
export type TableClass = "moves" | "reader-state" | "history";

/**
 * **Every table that touches an article, and what a transfer does with it.**
 * By the database's own name, because that is what `information_schema` says
 * and what the test compares. Kept in step with the database by
 * tests/article-transfer.test.ts in both directions: a table missing here, or
 * a name here that is no table, fails it.
 *
 * Linked by `article_id` unless said otherwise. Checked against the foreign
 * keys on 2026-10-11 (`pg_constraint`), not assumed:
 */
export const ARTICLE_TABLES = {
  /* ---- moves: the article itself, and what it is ---- */
  /** The row. Re-owned, made private and reset (steps 2–4). */
  articles: "moves",
  /** Moves after resetRevisionReaderState removes its mixed reader-private fields. */
  article_revisions: "moves",
  block_identities: "moves",
  revision_blocks: "moves",
  revision_phrase_runs: "moves",
  /** The pipeline's resume points, for the article's own runs. */
  checkpoints: "moves",
  /** A model's guess at where an uploaded file came from: about the work, not the reader. */
  upload_source_guesses: "moves",
  /** Sources › Not cited's last search: OpenAlex's papers close to the article's own words, nothing of the reader's. */
  related_work_searches: "moves",

  /* ---- reader-state: the old owner's, deleted (src/admin-articles.ts § READER_STATE) ---- */
  /** Before `referee_criteria`: `comments_criterion` references it and does not cascade. */
  comments: "reader-state",
  /** Would cascade from the message; deleted first so it is counted. */
  chat_mentions: "reader-state",
  /** Would cascade from the thread (`chat_messages_thread_fk`); deleted first so it is counted. */
  chat_messages: "reader-state",
  chat_threads: "reader-state",
  quiz_attempts: "reader-state",
  referee_promises: "reader-state",
  referee_hidden_checks: "reader-state",
  referee_criteria: "reader-state",
  sources_claim_checks: "reader-state",
  search_runs: "reader-state",
  article_tags: "reader-state",
  glossary_hidden_entries: "reader-state",
  glossary_lookups: "reader-state",
  citation_finds: "reader-state",
  citation_investigations: "reader-state",
  citation_web_notes: "reader-state",
  reading_time: "reader-state",
  stale_notice_dismissals: "reader-state",
  command_suggestion_dismissals: "reader-state",
  link_summaries: "reader-state",

  /* ---- history: kept, about whoever it was about ---- */
  /** The old owner's charges: frozen at their visibility and unlinked (step 6). */
  ingest_events: "history",
  /** The spend ledger. Its `article_id` stays: the article's cost is the article's. */
  ai_calls: "history",
  /** Takedown evidence; a transfer that unshares writes a row of its own (step 3). */
  article_visibility_changes: "history",
  article_share_link_events: "history",
  /** Live-conversation sessions, with the ledger. */
  realtime_sessions: "history",
  /** `starter_article_id`: the voucher that named it, whoever owns it now. */
  billing_vouchers: "history",
  /** The administrator's draft gift for the article; D3 reads it after the move. */
  author_gifts: "history",
  /** By owner and slug: the old owner's imports. A Retry of one now fails on the slug, as it should. */
  jobs: "history",
  /** By owner and slug: the record of each import, for debugging. */
  import_records: "history",
  /** By owner and slug: the uploaded file's staging row. */
  uploads: "history",
  /** By owner and slug: a bug report filed from the article's page. */
  feedback: "history",
} as const satisfies Record<string, TableClass>;

/** A table with an `article_id`, for the delete and the counts. */
type ArticleChild = PgTable & { readonly articleId: AnyPgColumn };

/**
 * The reader-state tables as Drizzle objects, keyed by the same names, so the
 * delete and the counts name a table rather than a string. `satisfies` makes a
 * kind in src/admin-articles.ts without a table here a compile error.
 */
export const READER_STATE_TABLES = {
  comments,
  chat_mentions: chatMentions,
  chat_messages: chatMessages,
  chat_threads: chatThreads,
  quiz_attempts: quizAttempts,
  referee_promises: refereePromises,
  referee_hidden_checks: refereeHiddenChecks,
  referee_criteria: refereeCriteria,
  sources_claim_checks: sourcesClaimChecks,
  search_runs: searchRuns,
  article_tags: articleTags,
  glossary_hidden_entries: glossaryHiddenEntries,
  glossary_lookups: glossaryLookups,
  citation_finds: citationFinds,
  citation_investigations: citationInvestigations,
  citation_web_notes: citationWebNotes,
  reading_time: readingTime,
  stale_notice_dismissals: staleNoticeDismissals,
  command_suggestion_dismissals: commandSuggestionDismissals,
  link_summaries: linkSummaries,
} as const satisfies Record<ReaderStateTable, ArticleChild>;

/* Loud at import, not at the first transfer: a map entry whose key is not its table's name. */
for (const [name, table] of Object.entries(READER_STATE_TABLES)) {
  if (getTableName(table) !== name) throw new Error(`READER_STATE_TABLES.${name} is ${getTableName(table)}`);
}

function zeroCounts(): Record<ReaderStateTable, number> {
  return Object.fromEntries(READER_STATE.map((k) => [k.table, 0])) as Record<ReaderStateTable, number>;
}

/* --------------------------------------------------------------- refusals -- */

type Executor = Pick<ReturnType<typeof getDb>, "select" | "execute">;

/**
 * **Is anything running on this article?** A queued or running job on its
 * slug — anybody's: `jobs` is keyed by slug text with no foreign key, and a job
 * that publishes after the move would publish into the new owner's article as
 * the old one — or a reserved slot nobody has settled, which the ledger update
 * of step 6 would otherwise unlink from under the job that will settle it.
 *
 * Under the article's row lock this is a decision rather than a snapshot:
 * `tryEnqueue` takes the same row before inserting a job (pg-shelf.ts §
 * `lockedArticleForDestroyQuery`), so no new one can arrive until this commits,
 * and after it the old owner's enqueue no longer finds the article.
 */
async function busy(db: Executor, article: { id: string; slug: string }): Promise<boolean> {
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.slug, article.slug), inArray(jobs.status, ["queued", "running"])))
    .limit(1);
  if (job) return true;
  const [slot] = await db
    .select({ id: ingestEvents.id })
    .from(ingestEvents)
    .where(and(eq(ingestEvents.articleId, article.id), isNull(ingestEvents.succeededAt), isNull(ingestEvents.releasedAt)))
    .limit(1);
  return slot !== undefined;
}

async function blockedBy(
  db: Executor,
  article: { id: string; slug: string; processing: string },
): Promise<TransferBlocked | null> {
  if (await busy(db, article)) return "busy";
  if (article.processing === "minimal") return "minimal";
  return null;
}

/** Every reader-state count on one article, in one statement. */
async function countsOn(db: Executor, articleId: string): Promise<TransferCounts> {
  const columns = READER_STATE.map((kind) => {
    const table: ArticleChild = READER_STATE_TABLES[kind.table];
    return sql`(select count(*)::int from ${table} where ${table.articleId} = ${articleId}) as ${sql.identifier(kind.table)}`;
  });
  const result = await db.execute(sql`select ${sql.join(columns, sql`, `)}`);
  const row = (result as unknown as { rows: Record<string, unknown>[] }).rows[0];
  if (!row) throw new Error("the transfer counts returned no row, which a select of subqueries cannot do");
  const counts = zeroCounts();
  for (const kind of READER_STATE) {
    const n = Number(row[kind.table]);
    /* Never defaulted to zero: a count that is not one would read as "nothing of theirs on it". */
    if (!Number.isInteger(n) || n < 0) throw new Error(`the transfer count for ${kind.table} is not a count`);
    counts[kind.table] = n;
  }
  return counts;
}

/* --------------------------------------------------------------- preview -- */

/**
 * **What a transfer would do now** — the confirmation's counts, and the reason
 * it would be refused if one applies. Unlocked: it decides nothing, and the
 * transfer asks every question again under the lock. Null when there is no such
 * article.
 */
export async function previewTransfer(articleId: string): Promise<TransferPreview | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: articles.id,
      ownerId: articles.ownerId,
      slug: articles.slug,
      visibility: articles.visibility,
      processing: articles.processing,
      privateLink: sql<boolean>`${articles.shareTokenAt} is not null`,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!row) return null;
  return {
    articleId: row.id,
    ownerId: row.ownerId,
    visibility: row.visibility === "public" ? "public" : "private",
    privateLink: row.privateLink === true,
    counts: await countsOn(db, row.id),
    blocked: await blockedBy(db, row),
  };
}

/* -------------------------------------------------------------- transfer -- */

export interface TransferInput {
  readonly articleId: string;
  /** Who the caller saw owning it. Rechecked under the lock. */
  readonly from: string;
  readonly to: string;
  /**
   * Who pressed it, for the visibility and private-link audit rows a transfer
   * that unshares writes: the administrator, or on a claim (D3) the claimant.
   */
  readonly actor: string;
}

export type TransferAnswer =
  | {
      readonly kind: "transferred";
      readonly deleted: TransferCounts;
      /** It was public or had a private link, and is now neither. */
      readonly madePrivate: boolean;
      /** The slug, for a caller that has to say which article moved (D3's `claimedArticles`). */
      readonly slug: string;
    }
  | { readonly kind: "absent" }
  /** `stale` carries who owns it now, for the caller's log; never sent to a reader. */
  | { readonly kind: "refused"; readonly reason: "stale"; readonly ownerId: string }
  | { readonly kind: "refused"; readonly reason: "same-owner" | TransferBlocked };

/**
 * **Move one article from `from` to `to`, inside the caller's transaction** —
 * D2 steps 1–6. The caller has already confirmed `to` is a live account with a
 * confirmed address, outside any transaction.
 *
 * Every refusal is answered before the first write, so a refused transfer
 * leaves the transaction it ran in untouched and the caller may go on and
 * commit its own work (the claim does: the voucher is claimed either way).
 */
export async function transferArticle(tx: TransferTx, input: TransferInput): Promise<TransferAnswer> {
  return await transferLocked<never>(tx, input, null);
}

/** The article row as the transfer locked it: what a gate may decide on. */
interface LockedArticle {
  readonly id: string;
  readonly slug: string;
  readonly visibility: string;
}

/**
 * **Why a voucher's claim leaves its starter where it is** (D3) — on top of
 * the administrator's refusals, each decided under the same lock and before the
 * first write:
 *
 * - `public`: it is on the public shelf; moving it would pull it off (Opus).
 *   Only a private article — the one Greg's words name — moves on its own.
 * - `shared`: another voucher that is not revoked names it too, so it is not
 *   this recipient's alone to take.
 * - `own-words`: the creator has words of their own on it (`ownWords` in
 *   src/admin-articles.ts § READER_STATE). Nothing Greg wrote is deleted
 *   unattended (Sol F3); the administrator can still move it on
 *   /admin/articles, seeing what goes.
 */
export type ClaimTransferRefusal = "public" | "shared" | "own-words";

export type ClaimTransferAnswer = TransferAnswer | { readonly kind: "refused"; readonly reason: ClaimTransferRefusal };

/** The one revision artefact that stores the reader's exact words. */
function hasIllustrationNote(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "note" in value &&
    typeof (value as { note?: unknown }).note === "string" &&
    (value as { note: string }).note.trim() !== ""
  );
}

/** Keep upload provenance and the source control without carrying the reader's local name. */
function neutralUploadFilename(filename: string | null, kind: string | null, source: string | null): string | null {
  if (filename === null) return null;
  if (kind === "pdf" || source === "pdf") return "document.pdf";
  if (kind === "html") return "document.html";
  return "document";
}

/**
 * Revision rows mostly describe the article, but three fields belong to the
 * old reader. Keep only provenance URLs safe to show a stranger, drop their
 * local filename, and remove an illustration whose brief or image may repeat
 * their exact steering note.
 */
async function resetRevisionReaderState(tx: TransferTx, articleId: string): Promise<void> {
  /* The Illustrated brief the model wrote from that note can repeat it, and its
     key holds the old job's id, so nothing can reuse it after the move anyway
     (code review round 2, R1). */
  await tx
    .delete(checkpoints)
    .where(and(eq(checkpoints.articleId, articleId), eq(checkpoints.namespace, "illustrated-brief")));
  const revisions = await tx
    .select({
      id: articleRevisions.id,
      requestedUrl: articleRevisions.requestedUrl,
      finalUrl: articleRevisions.finalUrl,
      rawFilename: articleRevisions.rawFilename,
      savedFromUrl: articleRevisions.savedFromUrl,
      rawSourceKind: articleRevisions.rawSourceKind,
      source: articleRevisions.source,
      illustrated: articleRevisions.illustrated,
    })
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, articleId))
    .orderBy(asc(articleRevisions.id))
    .for("update");
  for (const revision of revisions) {
    await tx
      .update(articleRevisions)
      .set({
        requestedUrl: revision.requestedUrl === null ? null : publicSourceUrl(revision.requestedUrl),
        finalUrl: revision.finalUrl === null ? null : publicSourceUrl(revision.finalUrl),
        rawFilename: neutralUploadFilename(revision.rawFilename, revision.rawSourceKind, revision.source),
        /* The saved-from claim crosses as the provenance URLs do: only what a
           stranger could be shown (plan 261018j § Stage 3). */
        savedFromUrl: revision.savedFromUrl === null ? null : publicSourceUrl(revision.savedFromUrl),
        illustrated: hasIllustrationNote(revision.illustrated) ? null : revision.illustrated,
      })
      .where(eq(articleRevisions.id, revision.id));
  }
}

/**
 * **A claimed voucher's starter article, moved to its claimant only if D3's
 * rules all hold** — `transferArticle` with three more refusals, asked under
 * the article lock and before anything is written, so a refusal leaves the
 * claim's transaction as it found it. `from` is the voucher's creator: an
 * article they no longer own is `stale`. The caller runs this in a savepoint
 * (src/store/pg-vouchers.ts § `claimVouchersFor`), so an error rolls back the
 * move and not the claim.
 */
export async function transferStarterOnClaim(
  tx: TransferTx,
  input: TransferInput & { readonly voucherId: string },
): Promise<ClaimTransferAnswer> {
  return await transferLocked<ClaimTransferRefusal>(tx, input, async (row) => {
    if (row.visibility !== "private") return "public";
    const [other] = await tx
      .select({ id: billingVouchers.id })
      .from(billingVouchers)
      .where(
        and(
          eq(billingVouchers.starterArticleId, row.id),
          ne(billingVouchers.id, input.voucherId),
          isNull(billingVouchers.revokedAt),
        ),
      )
      .limit(1);
    if (other) return "shared";
    /* Counted under the lock: a comment of theirs cannot land between this
       count and the delete without the article's row, which they cannot
       resolve once the move commits (the D2 residual aside). */
    if (ownWordsIn(await countsOn(tx, row.id)) > 0) return "own-words";
    const revisions = await tx
      .select({ illustrated: articleRevisions.illustrated })
      .from(articleRevisions)
      .where(eq(articleRevisions.articleId, row.id))
      .orderBy(asc(articleRevisions.id))
      .for("update");
    if (revisions.some((revision) => hasIllustrationNote(revision.illustrated))) return "own-words";
    return null;
  });
}

/**
 * The transfer, with `gate` asked after the shared refusals and before the
 * first write. Null for the administrator's, who has seen what goes.
 */
async function transferLocked<R extends string>(
  tx: TransferTx,
  input: TransferInput,
  gate: ((row: LockedArticle) => Promise<R | null>) | null,
): Promise<TransferAnswer | { readonly kind: "refused"; readonly reason: R }> {
  const { articleId, from, to, actor } = input;

  /* Step 1, under the lock. */
  const [row] = await tx
    .select({
      id: articles.id,
      ownerId: articles.ownerId,
      slug: articles.slug,
      visibility: articles.visibility,
      processing: articles.processing,
      privateLink: sql<boolean>`${articles.shareTokenAt} is not null`,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .for("update")
    .limit(1);
  if (!row) return { kind: "absent" };
  if (row.ownerId !== from) return { kind: "refused", reason: "stale", ownerId: row.ownerId };
  if (from === to) return { kind: "refused", reason: "same-owner" };
  const blocked = await blockedBy(tx, row);
  if (blocked) return { kind: "refused", reason: blocked };
  const gated = gate === null ? null : await gate(row);
  if (gated !== null) return { kind: "refused", reason: gated };

  /* `article_revisions` is mostly article essence, but its URL provenance,
     upload filename and an illustration's steering note can be the old
     reader's secrets. Scrub them before the id carries the rows to its new
     owner. An automatic claim with a note was refused by the gate above; the
     administrator's confirmation explicitly warns that its artefact goes. */
  await resetRevisionReaderState(tx, row.id);

  /* Step 5: the old owner's words and activity, in READER_STATE's order. */
  const deleted = zeroCounts();
  for (const kind of READER_STATE) {
    const table: ArticleChild = READER_STATE_TABLES[kind.table];
    const result = await tx.delete(table).where(eq(table.articleId, row.id));
    deleted[kind.table] = result.rowCount ?? 0;
  }

  /* Step 6: **one statement**, the shape the delete trigger writes
     (drizzle/20260907200800_ingest_events_unlink_atomically.sql): unlinked and
     stamped together, so `ingest_events_frozen_only_after_unlink` is never
     momentarily false and `ingest_events_require_price_on_unlink` sees the
     price already set. Stamped with the visibility **before** step 3, so the old
     owner's usage is priced as it was, and no longer moves with the new
     owner's choices. The once-per-article High-powered charge goes with it, so
     the new owner pays their own if they switch it on. */
  const visibility = row.visibility === "public" ? "public" : "private";
  await tx
    .update(ingestEvents)
    .set({ articleVisibilityAtDelete: visibility, articleId: null })
    .where(eq(ingestEvents.articleId, row.id));

  /* Step 3's audit rows, the ones the owner's own switches write
     (pg-visibility.ts, pg-share-link.ts): a public article being made private
     is a transition the takedown log records, and so is a private link being
     turned off. Never the key. */
  if (visibility === "public") {
    await tx.insert(articleVisibilityChanges).values({
      articleId: row.id,
      slug: row.slug,
      actorOwnerId: actor,
      fromVisibility: "public",
      toVisibility: "private",
      rightsConfirmed: false,
    });
  }
  if (row.privateLink === true) {
    await tx.insert(articleShareLinkEvents).values({
      articleId: row.id,
      slug: row.slug,
      actorOwnerId: actor,
      event: "turned-off",
      rightsConfirmed: false,
    });
  }

  /* Steps 2–4 in one UPDATE: the owner, private with no key (Sol F2: a shared
     view carries the owner's marks, so a key the old owner handed out must not
     open the new owner's notes), and the old owner's state on the row reset —
     `asked_url` included, which may carry a credential (Sol F4), and
     `high_power_since` (Sol F5). `owner_id = from` again in the `where`, so the
     row count is the proof the lock's answer still held. */
  const moved = await tx
    .update(articles)
    .set({
      ownerId: to,
      visibility: "private",
      publicAt: null,
      shareToken: null,
      shareTokenAt: null,
      purpose: null,
      titleOverride: null,
      archivedAt: null,
      opens: 0,
      lastOpenedAt: null,
      skimProfileNoticeDismissedFor: null,
      skimProfileNoticeDismissedAt: null,
      askedUrl: null,
      highPowerSince: null,
      updatedAt: null,
    })
    .where(and(eq(articles.id, row.id), eq(articles.ownerId, from)));
  /* Unreachable while the lock is held; loud rather than a transfer reported over nothing. */
  if (moved.rowCount !== 1) throw new Error(`article transfer: the locked row matched ${moved.rowCount ?? 0} rows`);

  return {
    kind: "transferred",
    deleted,
    madePrivate: visibility === "public" || row.privateLink === true,
    slug: row.slug,
  };
}

/**
 * **The administrator's transfer**: `transferArticle` in a transaction of its
 * own. Logged by ids and counts only.
 */
export async function transferBetween(input: TransferInput): Promise<TransferAnswer> {
  const answer = await getDb().transaction((tx) => transferArticle(tx, input), READ_COMMITTED);
  if (answer.kind === "transferred") {
    logger.info(
      { articleId: input.articleId, from: input.from, to: input.to, deleted: answer.deleted, madePrivate: answer.madePrivate },
      "article transferred to another account",
    );
  }
  return answer;
}

/* ------------------------------------------------------------------ list -- */

/**
 * **Every article, newest first** (D4) — the one read here across owners, and
 * it says so in its name, for pg-admin.ts's reason. The title and slug only for
 * `adminId`'s own articles and public ones; addresses are the route's to add,
 * from the Auth service.
 */
export async function listArticlesAcrossOwners(adminId: string): Promise<Omit<AdminArticle, "ownerEmail">[]> {
  const [rows, spend] = await Promise.all([listRows(), spendByArticle()]);
  return rows.map((r) => {
    const mine = r.ownerId === adminId;
    const visibility = r.visibility === "public" ? "public" : "private";
    /* Another reader's public article is on the public shelf under its
       extracted title; their own rename of it is their state, not shown. */
    const shown = mine || visibility === "public";
    return {
      id: r.id,
      shortId: r.shortId,
      ownerId: r.ownerId,
      mine,
      createdAt: r.createdAt.toISOString(),
      visibility,
      processing: r.processing === "minimal" ? "minimal" : "full",
      title: shown ? ((mine ? r.titleOverride : null) ?? r.title ?? null) : null,
      slug: shown ? r.slug : null,
      published: shown ? r.currentRevisionId !== null : null,
      /* Spend and call counts, tied only to the opaque id for a private row;
         /admin/costs already shows the same across owners. */
      cost: spend.get(r.id) ?? { nanos: 0, calls: 0, unpricedCalls: 0 },
    };
  });
}

function listRows() {
  return getDb()
    .select({
      id: articles.id,
      shortId: articles.shortId,
      ownerId: articles.ownerId,
      createdAt: articles.createdAt,
      visibility: articles.visibility,
      processing: articles.processing,
      slug: articles.slug,
      titleOverride: articles.titleOverride,
      title: articleRevisions.title,
      currentRevisionId: articles.currentRevisionId,
    })
    .from(articles)
    .leftJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .orderBy(desc(articles.createdAt), articles.id);
}

/* ------------------------------------------------------------------ body -- */

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/** `POST /api/admin/articles/:id/transfer`'s body: exactly `to` and `expectedFrom`, both uuids. */
export function parseTransferRequest(body: unknown): Parsed<TransferRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Expected a JSON object." };
  }
  const unknown = Object.keys(body).filter((key) => key !== "to" && key !== "expectedFrom");
  if (unknown.length > 0) return { ok: false, message: `Unexpected field: ${unknown.join(", ")}.` };
  const { to, expectedFrom } = body as { to?: unknown; expectedFrom?: unknown };
  if (typeof to !== "string" || !isUuid(to)) return { ok: false, message: "to must be an account id." };
  if (typeof expectedFrom !== "string" || !isUuid(expectedFrom)) {
    return { ok: false, message: "expectedFrom must be the account id the article belonged to." };
  }
  return { ok: true, value: { to: to.toLowerCase(), expectedFrom: expectedFrom.toLowerCase() } };
}

/**
 * **The routes' entry points, behind the database-error guard**, for
 * pgAdminStore's reason. `transferArticle` stays bare: it runs inside a
 * caller's transaction, whose own guard is the caller's.
 */
export const pgArticleTransferStore = guardDbStore("article-transfer", {
  listArticlesAcrossOwners,
  previewTransfer,
  transferBetween,
});
