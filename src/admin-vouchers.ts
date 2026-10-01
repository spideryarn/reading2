/**
 * **One gift voucher as `/admin/vouchers` sees it** — the wire contract between
 * `GET /api/admin/vouchers` (src/store/pg-vouchers.ts builds it) and
 * src/web/AdminVouchersPage.tsx (draws it).
 *
 * A flat module with no imports, for the reason src/admin.ts and
 * src/billing-plan.ts are: the browser may not import from src/store/, even a
 * type (tests/client-imports.test.ts), and two hand-kept copies of one shape
 * are two places to disagree. Admin-only: it carries the private note.
 * docs/plans/261001m-gift-vouchers-for-free-articles.md.
 */

/**
 * The claimant's standing, for the admin table's *how used* column.
 *
 * `free` is the only state in which the gift is doing anything; `paid` says it
 * is bound and waiting for them to be back on Free; `unknown` is a stored
 * period that does not contain now, as `/profile` says it.
 */
export type ClaimantUsage =
  | {
      readonly kind: "free";
      /** Ingests counted against the allowance, as `/profile`'s `used`. */
      readonly used: number;
      /** The whole Free allowance, gifts included. */
      readonly limit: number;
      /** Further private articles the wall would admit — `ingestHeadroom`. */
      readonly remaining: number;
      /** Back on Free after a subscription ended. */
      readonly lapsed: boolean;
    }
  | { readonly kind: "paid"; readonly tierId: string }
  | { readonly kind: "unknown" };

/** One voucher as `/admin/vouchers` draws it. Admin-only: it carries the note. */
export interface AdminVoucher {
  readonly id: string;
  readonly email: string;
  readonly articles: number;
  readonly note: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  readonly revokedAt: string | null;
  /** The claimant's current address, from the Auth service; null when it could not say. */
  readonly claimantEmail: string | null;
  /** Present only for a claimed voucher. */
  readonly claimant?: ClaimantUsage;
}

