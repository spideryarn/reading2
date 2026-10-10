/**
 * **An email address as Spideryarn stores and compares it** — two pure rules
 * with no imports, so a module that has no business loading the database
 * (src/author-lookup.ts, which checks an address a model reported against the
 * search results) can use the same rules the voucher tables enforce.
 * docs/plans/261010c-author-gift-draft-voucher-from-the-add-page.md, D4.
 */

/**
 * **An address as the table stores it**: trimmed and lower-cased. The check
 * constraint `billing_vouchers_email_normalised` refuses anything else, so a
 * writer that forgets this fails loudly rather than storing an address the
 * claim can never match.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** A shape check, not a deliverability check: something, an @, something. */
export function looksLikeEmail(normalised: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(normalised) && normalised.length <= 320;
}
