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

/**
 * **`Name <address>`, as a mail client copies it**, split into the address and
 * the name — Greg, 2026-10-11 (spya-cfbp0q): *"If I paste in a combination
 * name and email address … keep just the email address, and immediately
 * populate the name if it's empty."* Plan 261011k.
 *
 * Accepts `Name <a@b>`, `"Name" <a@b>`, `'Name' <a@b>` and `<a@b>` (name null).
 * Anything else, including one address of several or a name quoted at one
 * end only, is null, so the field
 * keeps what was typed and the server's shape check still decides. The address
 * comes back as written inside the brackets; the table's own rule
 * (`normaliseEmail`) is applied where it always is.
 */
export function splitNameAndAddress(raw: string): { email: string; name: string | null } | null {
  const match = /^\s*([^<>]*?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(raw);
  if (!match) return null;
  const email = match[2] ?? "";
  if (!looksLikeEmail(normaliseEmail(email))) return null;
  const before = match[1] ?? "";
  const quoted = /^(["'])(.*)\1$/.exec(before);
  /* A quote at one end only is not a name a mail client wrote (Sol, 261011k plan review F3). */
  if (!quoted && /^["']|["']$/.test(before)) return null;
  const name = (quoted ? (quoted[2] ?? "") : before).replace(/\s+/g, " ").trim();
  return { email, name: name === "" ? null : name };
}

/**
 * **What an address box and the name box beside it hold after a change** to
 * the address box: `Name <a@b>` becomes `a@b`, and the name is filled only if
 * it was empty. Anything else is kept exactly as typed.
 */
export function addressBoxChange(raw: string, name: string): { email: string; name: string } {
  const split = splitNameAndAddress(raw);
  if (split === null) return { email: raw, name };
  return { email: split.email, name: name.trim() === "" && split.name !== null ? split.name : name };
}
