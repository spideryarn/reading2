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
 * ## There is still a second answer
 *
 * `isSlug` in [ingest.ts](./ingest.ts) is **stricter** — `^[a-z0-9][a-z0-9-]*$`
 * — and is what *mints* a slug, so nothing nonconforming should exist on disk.
 * It deliberately lives next to `slugFromUrl` so the two cannot drift. Whether
 * the two rules should collapse into one is an open question, with the
 * reasoning in docs/plans/simplification-audit.md § A.3; it needs a look at what
 * is actually stored before it can be tightened safely.
 */

/**
 * A slug is a path segment. Anything that isn't one is refused outright rather
 * than sanitised, because sanitising invites arguing about whether it worked.
 */
export function assertSlug(slug: string): void {
  if (!/^[\w.-]+$/.test(slug) || slug === "." || slug === "..") {
    throw new Error(`Not a valid slug: ${JSON.stringify(slug)}`);
  }
}
