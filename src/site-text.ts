/**
 * **Facts about Spideryarn-the-website, said once.**
 *
 * Not error copy — that is src/messages.ts, and the rules it follows are in
 * docs/project/copy.md. This is the handful of strings that are true of the
 * *site* rather than of anything happening in it: the address a reader writes
 * to, and nothing else yet.
 *
 * Greg, 2026-09-02: *"The contact address to use anywhere in the site is
 * hello@spideryarn.com … in one place, with signposting elsewhere to that
 * single source of truth."* The doc is
 * docs/project/website-text.md; this file is the code half of the same rule.
 *
 * It imports nothing, which is what qualifies it for
 * tests/client-imports.test.ts's `SHARED` list — the privacy page needs it in
 * the browser and a server-side page or email will need it later, and two
 * copies of an address is how one of them goes stale after a domain move.
 */

/**
 * Where a reader writes to us: support, privacy requests, "delete my account".
 *
 * One address on purpose. A separate `privacy@` would look like a department
 * that does not exist, and the person reading both inboxes is the same person.
 */
export const CONTACT_EMAIL = "hello@spideryarn.com";
