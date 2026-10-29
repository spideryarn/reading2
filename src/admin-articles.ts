/**
 * **Every article as `/admin/articles` sees it, and a transfer of one** — the
 * wire contract between the routes under `/api/admin/articles`
 * (src/store/pg-article-transfer.ts builds it) and the page that draws it.
 * docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md § D2, D4.
 *
 * A flat module with no imports, for src/admin-vouchers.ts's reason: the
 * browser may not import from src/store/, even a type
 * (tests/client-imports.test.ts), and two hand-kept copies of one shape are two
 * places to disagree. Admin-only: it carries other people's addresses.
 */

/**
 * **One article, across owners** (D4). The title and slug are there only for
 * the administrator's own articles and public ones: another reader's private
 * article is a row of dates and an owner, because *which* articles somebody
 * reads is their reading (docs/project/admin.md § What it deliberately does
 * not show). The slug carries the title's words, so it goes with the title.
 */
export interface AdminArticle {
  readonly id: string;
  /** `spya-…`, or null for an article added before short ids (the page shows the id). */
  readonly shortId: string | null;
  readonly ownerId: string;
  /** Null when the Auth service does not know the account, or the listing failed. */
  readonly ownerEmail: string | null;
  /** True when the owner is the administrator reading the list. */
  readonly mine: boolean;
  readonly createdAt: string;
  readonly visibility: "private" | "public";
  readonly processing: "minimal" | "full";
  /** Null for another reader's private article, and for one with nothing published yet. */
  readonly title: string | null;
  /** Null for another reader's private article. */
  readonly slug: string | null;
  /**
   * Whether an import ever finished and published it (it has a current
   * revision). False is a failed or unfinished import, whose address says
   * *Not shared* to anyone without its job. Null for another reader's private
   * article, with the title (spya-zt7u0h, plan 261019n).
   */
  readonly published: boolean | null;
  /** What the ledger says it has cost over its whole life (plan 261020s). */
  readonly cost: AdminArticleCost;
}

/**
 * **One article's ID-keyed total cost**, `/admin/costs`' rule in bulk
 * (src/store/ai-calls-spend-pg.ts § `spendByArticle`): the three pockets
 * already added, in nano-dollars. Unlike `spendForArticle`, this does not
 * claim slug-only rows. `unpricedCalls` reported no money, so a total with any
 * is a floor. Zeros for an article nothing has spent on.
 */
export interface AdminArticleCost {
  readonly nanos: number;
  readonly calls: number;
  readonly unpricedCalls: number;
}

export interface AdminArticles {
  readonly articles: readonly AdminArticle[];
  /** False when the Auth service's listing failed: the rows are there, the addresses are not. */
  readonly emailsAvailable: boolean;
}

/**
 * **What a transfer deletes: the old owner's own words and activity on the
 * article** (D2 step 5), one entry per table, in the order the transfer
 * deletes them — `comments` first, because a comment can point at a Referee
 * criterion and that foreign key does not cascade; `chat_mentions` before
 * their messages, and `chat_messages` before their threads, so each is
 * counted rather than taken by a cascade.
 *
 * `ownWords` splits the kinds the way D3 needs: a starter article moves on a
 * voucher's claim only when the creator has **none of their own words** on it
 * (Sol F3: nothing Greg wrote is deleted unattended). Reading time, the notices
 * and suggestions sent away, and the link summaries the reader opened are
 * activity, and go without asking.
 *
 * The store's classification map (src/store/pg-article-transfer.ts §
 * `ARTICLE_TABLES`) names every table that touches an article, and
 * tests/article-transfer.test.ts holds that this list and that map's
 * reader-state entries are the same tables.
 */
export const READER_STATE = [
  { table: "comments", label: "questions and notes", ownWords: true },
  { table: "chat_mentions", label: "articles brought into chats", ownWords: false },
  { table: "chat_messages", label: "chat messages", ownWords: true },
  { table: "chat_threads", label: "chats", ownWords: true },
  /* Skim briefs: the sentence is the reader's own, like a chat's (plan 261027d, Sol F1). */
  { table: "skim_briefs", label: "Skim briefs", ownWords: true },
  { table: "quiz_attempts", label: "quiz answers", ownWords: true },
  { table: "referee_promises", label: "Referee promises runs", ownWords: true },
  { table: "referee_hidden_checks", label: "Referee hidden checks", ownWords: true },
  { table: "referee_criteria", label: "Referee criteria", ownWords: true },
  { table: "sources_claim_checks", label: "Sources claim checks", ownWords: true },
  { table: "search_runs", label: "searches", ownWords: true },
  { table: "article_tags", label: "tags", ownWords: true },
  { table: "glossary_hidden_entries", label: "hidden glossary entries", ownWords: true },
  { table: "glossary_lookups", label: "glossary lookups", ownWords: true },
  { table: "citation_finds", label: "citation finds", ownWords: true },
  { table: "citation_investigations", label: "citation investigations", ownWords: true },
  { table: "citation_web_notes", label: "citation web notes", ownWords: true },
  { table: "reading_time", label: "passages with reading time", ownWords: false },
  { table: "reading_place", label: "place in the article", ownWords: false },
  { table: "stale_notice_dismissals", label: "notices sent away", ownWords: false },
  { table: "command_suggestion_dismissals", label: "suggestions sent away", ownWords: false },
  { table: "link_summaries", label: "link summaries", ownWords: false },
] as const;

export type ReaderStateTable = (typeof READER_STATE)[number]["table"];

/** How many rows of each kind are on the article (a preview) or were deleted (a transfer). */
export type TransferCounts = Readonly<Record<ReaderStateTable, number>>;

/** How many of the counted rows are the old owner's own words — D3's question. Zero means none. */
export function ownWordsIn(counts: TransferCounts): number {
  return READER_STATE.reduce((n, kind) => (kind.ownWords ? n + counts[kind.table] : n), 0);
}

/**
 * **Why a transfer would change nothing** (D2 step 1).
 *
 * - `busy`: an import or a job is queued or running on the article, or a slot
 *   it reserved is unsettled — moving it mid-run would hand the run's
 *   publication and its charge to the wrong owner.
 * - `minimal`: abstract only; *Read this* supersedes by owner and would fail
 *   for the new one. Read it in full first.
 */
export type TransferBlocked = "busy" | "minimal";

/**
 * `stale`: the article is no longer the owner the caller saw (409);
 * `same-owner`: it already belongs to the account named.
 */
export type TransferRefusal = TransferBlocked | "stale" | "same-owner";

/** `GET /api/admin/articles/:id/transfer` — what a transfer would do now. Read unlocked. */
export interface TransferPreview {
  readonly articleId: string;
  readonly ownerId: string;
  readonly visibility: "private" | "public";
  /** A private link is on, and the transfer will turn it off. */
  readonly privateLink: boolean;
  readonly counts: TransferCounts;
  /** Null when a transfer would go ahead. */
  readonly blocked: TransferBlocked | null;
}

/** `POST /api/admin/articles/:id/transfer`'s body. */
export interface TransferRequest {
  /** The account it goes to. */
  readonly to: string;
  /** The owner the confirmation showed; a different one now is a 409. */
  readonly expectedFrom: string;
}

/** `POST /api/admin/articles/:id/transfer`'s answer when it went through. */
export interface TransferDone {
  readonly articleId: string;
  readonly from: string;
  readonly to: string;
  /** What was deleted, by kind. */
  readonly deleted: TransferCounts;
  /** It was public, or had a private link, and is now neither. */
  readonly madePrivate: boolean;
}

/**
 * **`GET /api/admin/articles/:slug/access[?key=]`** — whose an article is, and
 * who opened its private link, for the administrator on its details page.
 * Only for an article the administrator can already read: their own, a public
 * one, or a private one named with its link's key; anything else is a 404.
 * No title, slug or key. Greg's reply `spya-xug3kf` to q-agbc89; plan 261021d.
 */
export interface AdminArticleAccess {
  readonly ownerId: string;
  /** Null when the Auth service does not know the account, or the listing failed. */
  readonly ownerEmail: string | null;
  /** False when the account listing failed, so every address here is null for that reason. */
  readonly emailsAvailable: boolean;
  /** True when the owner is the administrator asking. */
  readonly mine: boolean;
  /** A private link is on now. */
  readonly privateLink: boolean;
  /** Signed-in accounts that opened it through its private link, most recent first. */
  readonly openers: readonly AdminLinkOpener[];
  /** Signed-out opens, counted, approximate (security-risks.md § R31). Null: none recorded. */
  readonly signedOut: { readonly opens: number; readonly firstOpenedAt: string; readonly lastOpenedAt: string } | null;
}

export interface AdminLinkOpener {
  readonly readerId: string;
  readonly email: string | null;
  readonly opens: number;
  readonly firstOpenedAt: string;
  readonly lastOpenedAt: string;
}
