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
 * src/store/pg.ts and src/library-search.ts, which both skip them), and reader-state
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
 * ## The one name that is refused outright
 *
 * `_jobs` is reserved, because `data/_jobs/` is the job queue.
 *
 * An earlier version of this comment said the queue "never reaches either"
 * rule, on the grounds that `JOBS_DIR` is a hardcoded constant in src/jobs.ts.
 * That is true and it is the wrong direction. Nothing was going to arrive
 * *from* the queue; the risk was arriving *at* it — `loadComments("_jobs")`
 * builds `data/_jobs/comments.json`, and `loadFromDisk` in jobs.ts reads every
 * `.json` in that directory as a queued job. So reader state could be written
 * into the queue's own directory and then parsed as a job.
 *
 * Not reachable today: the HTTP routes screen slugs through the stricter
 * `slugPart` in routes.ts before this ever sees them, and that refuses a
 * leading underscore. So this is a false invariant rather than a live hole —
 * which is exactly the kind worth closing, because the next caller to reach a
 * reader-state module by some other path inherits the assumption without the
 * screening. Found by review, 2026-08-26.
 */

/** The rule, in one place. Private, so there is nothing to import and diverge. */
const SLUG = /^[\w.-]+$/;

/**
 * Longer than any filesystem will take as one path segment.
 *
 * Not a traversal question — a 300-character slug is a single segment and goes
 * nowhere it should not. It is about *where the refusal happens*: without this,
 * an absurd name passes every check here and dies inside `mkdir` as an
 * unmapped `ENAMETOOLONG`, which reaches the reader as a bare 500. 255 bytes is
 * the common limit (ext4, APFS, NTFS all sit at or above it); this counts
 * characters rather than bytes, so a name of multi-byte characters could still
 * exceed it — the point is that the ordinary case fails here, with a sentence,
 * rather than three layers down without one.
 */
const MAX_SLUG = 255;

/**
 * Names that are a directory under `data/` belonging to something other than an
 * article. `.` and `..` are handled below rather than here, because they are
 * about climbing out rather than about landing somewhere already taken.
 *
 * **Compared case-folded**, which is not fussiness. `SLUG` admits uppercase, so
 * a set membership test on the raw string refuses `_jobs` and waves through
 * `_JOBS` — and this repo develops on macOS, where APFS is case-insensitive by
 * default, so `data/_JOBS/` and `data/_jobs/` are one directory. Reserving a
 * name case-sensitively on a filesystem that does not distinguish case is a
 * reservation that does not hold. Caught in review the same afternoon the
 * reservation was added.
 */
const RESERVED = new Set(["_jobs"]);

/**
 * A slug is a path segment. Anything that isn't one is refused outright rather
 * than sanitised, because sanitising invites arguing about whether it worked.
 */
export function assertSlug(slug: string): void {
  if (
    slug.length > MAX_SLUG ||
    !SLUG.test(slug) ||
    slug === "." ||
    slug === ".." ||
    RESERVED.has(slug.toLowerCase())
  ) {
    throw new Error(`Not a valid slug: ${JSON.stringify(slug)}`);
  }
}
