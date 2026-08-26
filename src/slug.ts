/**
 * What counts as a slug, in one place.
 *
 * **This is a path-traversal guard, not a tidiness check.** A slug arrives from
 * the client and is joined onto `data/`, so `../../.ssh` has to be refused here
 * or it is refused nowhere. See [security.md](../docs/project/security.md).
 *
 * ## Why this file exists
 *
 * `assertSlug` was written five times — `comments.ts`, `searches.ts`,
 * `chat.ts`, `glossary-lookups.ts`, `shelf.ts` — byte-for-byte identical,
 * comments included, because each new reader-state module was written by
 * copying the last one. security.md predicted it back when there was one copy:
 *
 * > `isSlug` and `assertSlug` are two different definitions of a slug… a
 * > codebase with two answers… will eventually be asked the question by
 * > something that only checks one of them.
 *
 * Five copies is five places to remember on the day the rule is tightened after
 * a real traversal bug, and the count was still going up.
 *
 * ## The decision this overrides
 *
 * `shelf.ts` argued the opposite, and said so out loud: *"Copied deliberately
 * from src/comments.ts rather than shared: the two files are about to be
 * deleted at different times, and a helper shared across a seam is a helper
 * somebody has to think about twice."*
 *
 * That is a real concern and it does not apply here. This module imports
 * nothing and depends on no seam, so it stays correct however many of its
 * callers the Postgres migration deletes, and in whatever order. The friction
 * it was protecting against is the friction of a *shared abstraction over a
 * moving boundary*; four lines with no dependencies is not that.
 *
 * ## Two rules, on purpose — and this was checked rather than assumed
 *
 * `isSlug` in [ingest.ts](./ingest.ts) is **stricter**: `^[a-z0-9][a-z0-9-]*$`.
 * It is what *mints* a slug, next to `slugFromUrl`, so every slug this app
 * creates is lower-case and dash-separated.
 *
 * This one is looser, and it stays looser. Tightening it to match was tried on
 * 2026-08-26 and reverted, because **something real depends on the difference**:
 * `_`-prefixed directories mean "not an article" (see `listArticles` in
 * src/api.ts and src/library-search.ts, which both skip them), and reader-state
 * paths are asked about such names — `loadComments("_test-parse-json")` and
 * friends. Minting refuses a leading underscore; reading must not.
 *
 * That is a *tidiness* difference, not a safety one, which is the part worth
 * being clear about. This rule already refuses everything that could climb out
 * of `data/`: no `/`, no `\`, and `.` and `..` by name. A slug that passes here
 * is a single path segment. What it does not guarantee is that the slug is one
 * we would have minted — and nothing needs that guarantee at a read.
 *
 * So security.md's warning ("a codebase with two answers will eventually be
 * asked by something that only checks one") is answered by there being **one
 * definition per question** — may this be minted? may this be read? — rather
 * than by forcing one answer onto both. What was actually wrong was five copies
 * of the read rule, and that is what this file fixed.
 *
 * `data/_jobs/` never reaches either: it is a hardcoded `JOBS_DIR` constant in
 * src/jobs.ts. There is a test pinning that.
 */

/** The rule, in one place. Private, so there is nothing to import and diverge. */
const SLUG = /^[\w.-]+$/;

/**
 * A slug is a path segment. Anything that isn't one is refused outright rather
 * than sanitised, because sanitising invites arguing about whether it worked.
 */
export function assertSlug(slug: string): void {
  if (!SLUG.test(slug) || slug === "." || slug === "..") {
    throw new Error(`Not a valid slug: ${JSON.stringify(slug)}`);
  }
}
