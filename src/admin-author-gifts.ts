/**
 * **An author gift as `/admin/vouchers` sees it** — the wire contract between
 * the routes under `/api/admin/author-gifts` (src/store/pg-author-gifts.ts
 * builds it) and the page that draws it.
 * docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md.
 *
 * A flat module with no imports, for src/admin-vouchers.ts's reason: the
 * browser may not import from src/store/, even a type
 * (tests/client-imports.test.ts), and two hand-kept copies of one shape are two
 * places to disagree. Admin-only: it carries the notes and the addresses.
 */

/**
 * **Where a gift has got to — derived, never stored** (D1). `sending` is
 * frozen with no voucher yet: a *Send* that died part-way, which pressing
 * *Send* again finishes.
 */
export type AuthorGiftStatus = "draft" | "sending" | "sent" | "discarded";

/** What one lookup came to. Null while it is pending. */
export type AuthorLookupOutcome = "address" | "author" | "nothing" | "failed";

/** The longest the notes may be, in code points (D6). The table's CHECK is a far higher ceiling. */
export const AUTHOR_GIFT_NOTES_MAX = 20_000;

/** A lookup unfinished this long is `failed / stale`, and a new one may start (D4). */
export const AUTHOR_LOOKUP_STALE_MINUTES = 5;

/** How many free articles a new gift carries until somebody changes it. The column's default. */
export const AUTHOR_GIFT_DEFAULT_ARTICLES = 20;

/**
 * **What a lookup cost, from the ledger** — every `ai_calls` row with its
 * `run_id` (D5). `unpricedCalls` above zero means the figure is a floor: some
 * call has not said what it cost.
 */
export interface AuthorLookupCost {
  /** Nano-dollars: 1e-9 USD. Whole numbers, so nothing is lost to floats on the wire. */
  readonly nanos: number;
  readonly calls: number;
  readonly unpricedCalls: number;
}

/** One lookup run, as the gift's row lists it. */
export interface AdminAuthorLookup {
  readonly id: string;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly outcome: AuthorLookupOutcome | null;
  /** A reason — a status code, an error name, `stale` — never the provider's prose. */
  readonly failure: string | null;
  readonly authorName: string | null;
  readonly authorSourceUrl: string | null;
  /** An address seen in a result or the article. Whether it was applied is `AdminAuthorGift.emailLookupId`. */
  readonly email: string | null;
  readonly emailSourceUrl: string | null;
  /** An address the model gave that no result showed: *suggested, not seen*. Never applied. */
  readonly suggestedEmail: string | null;
  readonly contactUrl: string | null;
  /** How many searches the provider says ran. */
  readonly searches: number | null;
  readonly model: string | null;
  /** Null until the run claimed the row and could spend. */
  readonly cost: AuthorLookupCost | null;
}

/** One gift, as `/admin/vouchers`' *Author gifts* draws it. */
export interface AdminAuthorGift {
  readonly id: string;
  readonly status: AuthorGiftStatus;
  /** The article, by the slug frozen at create, and its current title; null once deleted. */
  readonly starter: { readonly slug: string; readonly title: string | null };
  readonly email: string | null;
  readonly recipientName: string | null;
  readonly recipientNote: string | null;
  readonly articles: number;
  readonly notes: string | null;
  readonly notesUpdatedAt: string | null;
  /** The lookup that supplied the current address; null when typed, or edited since. */
  readonly emailLookupId: string | null;
  /** The lookup that supplied the current name; null when typed, or edited since. */
  readonly nameLookupId: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly sendStartedAt: string | null;
  readonly discardedAt: string | null;
  /** The voucher's id once it exists (`sent`); null before. */
  readonly voucherId: string | null;
  /** Newest first. */
  readonly lookups: readonly AdminAuthorLookup[];
}

/**
 * What `POST /api/admin/author-gifts` answers (R2-F2): `202` with
 * `created: true` and the first lookup's id for a new gift; `200` with
 * `created: false` for one that already existed, whose link and lookups it did
 * not touch.
 */
export type AuthorGiftEnsured =
  | { readonly id: string; readonly status: AuthorGiftStatus; readonly created: true; readonly lookupId: string }
  | { readonly id: string; readonly status: AuthorGiftStatus; readonly created: false };

/** What `POST /api/admin/author-gifts/:id/lookups` answers with its `202`. */
export interface AuthorLookupStarted {
  readonly lookupId: string;
}

/**
 * What `POST /api/admin/author-gifts/:id/send` answers: `201` with `queued`
 * when this press made the voucher, `200` with `replayed` when it already
 * existed. The voucher list has the rest.
 */
export interface AuthorGiftSent {
  readonly voucherId: string;
  readonly email: "queued" | "replayed";
}
