/**
 * **What a stranger is served by `GET /api/public/library`** — the shelf of
 * public articles, one card each.
 *
 * The sibling of [public-types.ts](public-types.ts), which is the contract for
 * one *article*. This is the contract for the *list*, and it is a separate file
 * for the same reason the reader is a separate reader: nothing here is a subset
 * or a widening of `PublicMeta`, and a type that looked like one would invite
 * the card and the article payload to be built from one projection. They are two
 * queries with two different bars to clear.
 *
 * **Not a widened `LibraryEntry`.** The owner's shelf card carries `opens`,
 * `lastOpenedAt`, `comments`, `titleOverridden`, `archivedAt` and `purpose` —
 * every one of them a fact about a *person's* relationship with a document
 * rather than about the document. A public card has none of them and there is no
 * field here to put one in.
 *
 * Like `public-types.ts` this is nothing but `interface` declarations, so it
 * erases entirely at compile time; it imports nothing at all, which is what puts
 * it on the client's allowlist (tests/client-imports.test.ts).
 *
 * The query that fills it is [store/public-library.ts](store/public-library.ts);
 * the route is `library` in [public/route-names.ts](public/route-names.ts).
 * See docs/plans/260904b-pricing-page-and-public-showcase.md § Stage 3a.
 */

/** One card on the public shelf. */
export interface PublicLibraryEntry {
  /** Its address: `/read/<slug>`. */
  slug: string;
  /**
   * **Always a string**, unlike `PublicMeta.title`, and for a reason about this
   * surface rather than a difference of opinion: a card is nothing but its
   * title, so "no title" here is a blank row a reader cannot act on. The server
   * resolves `title ?? <first h1> ?? slug` — the same three-step fallback
   * `metaFrom` and `loadHead` use, so the card, the tab and the masthead cannot
   * disagree about what a piece is called.
   */
  title: string;
  /** The one-line description, from `root_gist`. Absent for a piece with none. */
  gist: string | null;
  /** Where it was published — the extraction's `site_name`, not our domain. */
  siteName: string | null;
  /** How long it is. `null` for a revision published before the scalar existed. */
  words: number | null;
  /**
   * When it was last switched on, ISO-8601, or `null`.
   *
   * `articles.public_at` is *"how long has this been up"* and explicitly not an
   * audit log (src/db/schema.ts). It is here because it is what the list is
   * ordered by, so a client that re-sorts is sorting by the same value the
   * server did rather than by a proxy for it.
   */
  publicAt: string | null;
}

/** The shelf itself. */
export interface PublicLibrary {
  entries: PublicLibraryEntry[];
  /**
   * **There were more, and you are not seeing them.**
   *
   * An anonymous response is capped (store/public-library.ts § `PUBLIC_LIBRARY_LIMIT`),
   * and a cap that reports nothing is a list that quietly stops being the list.
   * Today nothing can reach it; the field exists so that the day something does,
   * the page can say so instead of looking complete.
   * docs/reusable/silent-success.md.
   */
  truncated: boolean;
}
