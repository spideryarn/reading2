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
  /**
   * **Who wrote the piece — the article's author, never the reader who shared
   * it.**
   *
   * `article_revisions.byline`, which stage 2 read off the publisher's own page
   * through Readability (docs/project/content-extraction.md).
   * It is a fact about the document, in the same class as `siteName` beside it,
   * and that is the only reason it is allowed on an ownerless projection at all.
   *
   * **The other reading of "whose article is this" would be a serious mistake,**
   * so it is written down rather than left to be obvious: the Spideryarn reader
   * who added a piece and the person who wrote it are different people, and
   * nothing about a reader's identity is on the public wire — there is no owner
   * column in the listing's projection and no field here to put one in
   * (store/public-library.ts § `PUBLIC_LIBRARY_CARD`). A card that started
   * naming the sharer would be this app publishing its readers' names to
   * strangers.
   *
   * `null` for most articles: a byline is whatever the page happened to declare,
   * and plenty declare none.
   *
   * Greg, asked on 2026-09-04 whether a public article should show whose it is,
   * said yes. The article page already did — the masthead and the visitor's
   * details page both draw `PublicMeta.byline` — and this shelf did not.
   */
  byline: string | null;
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
  /**
   * **The keys of the public topics this card is under**, naming entries of
   * `PublicLibrary.topics`. `[]` when it is under none, or no topics are sent.
   */
  topics: string[];
}

/**
 * **One of the public shelf's topic pills.** Named by a model from the shared
 * articles' titles and one-line summaries only, stored under the site account,
 * and sent here as stored: nothing is worked out or spent for the visitor.
 * src/public-library-topics.ts; plan 261008j, approved as "q-p5h2a7 A".
 *
 * A hostile shared title can nudge these labels; the bounds are a reader's
 * own pills': at most 40 characters, drawn as plain text, and only articles
 * the model was shown.
 */
export interface PublicShelfTopic {
  /** What a card's `topics` names. */
  key: string;
  label: string;
  /** 0 for broad, towards 1 for finer, as a reader's shelf's terms. */
  granularity: number;
  /** The `key` of the broader topic this is inside, when that one is sent too. */
  within?: string;
}

/** The shelf itself. */
export interface PublicLibrary {
  entries: PublicLibraryEntry[];
  /**
   * **The topic pills, broad first.** Empty below eight cards, before the
   * first tree, and **while any article the tree was made from is no longer
   * listed** (src/public-library-topics.ts says why the whole set goes).
   */
  topics: PublicShelfTopic[];
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
