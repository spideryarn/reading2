/**
 * **One gift voucher as `/admin/vouchers` sees it** — the wire contract between
 * `GET /api/admin/vouchers` (src/store/pg-vouchers.ts builds it) and
 * src/web/AdminVouchersPage.tsx (draws it).
 *
 * A flat module with no imports — types, and the four small functions at the
 * bottom that say the gift email's subject, heading and greeting — for the reason src/admin.ts and
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

/** Where one voucher email has got to. The table's own five. */
export type VoucherEmailStatus = "queued" | "sending" | "sent" | "skipped" | "failed";

/**
 * **One delivery** — the latest of its kind for a voucher — as the Status cell
 * draws it. docs/plans/261001p-voucher-emails-to-recipient-and-creator.md.
 * No address: `detail` is a reason (`Resend answered 422`, `not production`,
 * `creator address unavailable`), never who it went to.
 */
export interface VoucherEmailState<K extends "gift" | "claimed" = "gift" | "claimed"> {
  readonly id: string;
  /** `gift` to the recipient; `claimed` to the creator. */
  readonly kind: K;
  readonly status: VoucherEmailStatus;
  readonly attempts: number;
  readonly detail: string | null;
  readonly updatedAt: string;
  /** When the current or last attempt was reserved; null if none ever was. */
  readonly attemptStartedAt: string | null;
  /** Whether `POST /api/admin/voucher-emails/:id/retry` would take it — the server's own predicate. */
  readonly retryable: boolean;
}

/** The latest delivery of each kind; null where there has been none. */
export interface VoucherEmails {
  readonly gift: VoucherEmailState<"gift"> | null;
  readonly claimed: VoucherEmailState<"claimed"> | null;
}

/**
 * What `POST /api/admin/vouchers` answers: 201 with `queued` for a new voucher,
 * whose email goes after the response; 200 with `replayed` for the same body
 * under an id that already exists, which queues nothing.
 */
export interface VoucherCreated {
  readonly id: string;
  readonly email: "queued" | "replayed";
}

/** One voucher as `/admin/vouchers` draws it. Admin-only: it carries the note. */
export interface AdminVoucher {
  readonly id: string;
  readonly email: string;
  readonly articles: number;
  readonly note: string | null;
  /** The note to the recipient, put in their email. Plan 261002b. */
  readonly recipientNote: string | null;
  /** Their name: the email opens *Dear <name>,*. Null is no greeting. Plan 261007f. */
  readonly recipientName: string | null;
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
  /** Its emails, the latest of each kind. */
  readonly emails: VoucherEmails;
}


/* ------------------------------------------------- the gift email's words -- */

/**
 * **`20 free articles`, `1 free article`** — digits even for one. Here rather
 * than in src/store/pg-voucher-emails.ts so that `/admin/vouchers`' sketch of
 * the email and the email itself say the subject and heading from one place.
 * Plan 261002b.
 */
export function freeArticles(n: number): string {
  return `${n} free article${n === 1 ? "" : "s"}`;
}

/** The gift email's heading, for both audiences. */
export function giftEmailHeading(articles: number): string {
  return `A gift of ${freeArticles(articles)}`;
}

/** The gift email's subject, for both audiences. Never carries the note or the name. */
export function giftEmailSubject(articles: number): string {
  return `${giftEmailHeading(articles)} on Spideryarn`;
}

/**
 * **`Dear Ada,`** — the line the gift email opens with when its voucher has a
 * name, under the heading and above the note. `name` is somebody else's text:
 * the caller cleans it to one line first, and escapes the result where it meets
 * HTML. Plan 261007f.
 */
export function giftEmailGreeting(name: string): string {
  return `Dear ${name},`;
}

/** The longest recipient name the API and table take, in Unicode code points. */
export const RECIPIENT_NAME_MAX = 80;

/* Formatting that can make a stored name invisible or reorder the greeting.
   Unicode's property avoids the hand-list omission described in
   feedback-notice.ts. ZWNJ and ZWJ stay: real names and emoji use them. */
const UNSAFE_NAME_FORMATTING = /\p{Bidi_Control}|[\u200b\u2060-\u2064\ufeff]/gu;
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

/** The one shared name rule for the form's sketch, storage and email rendering. */
export function cleanRecipientName(raw: string | null): string | null {
  if (raw === null) return null;
  const flat = [
    ...raw
      .replace(/[\p{Cc}\u2028\u2029]/gu, " ")
      .replace(UNSAFE_NAME_FORMATTING, " ")
      .trim(),
  ];
  const name =
    flat.length > RECIPIENT_NAME_MAX
      ? `${flat.slice(0, RECIPIENT_NAME_MAX - 1).join("")}…`
      : flat.join("");
  return name === "" || name.replace(DEFAULT_IGNORABLE, "").trim() === "" ? null : name;
}
