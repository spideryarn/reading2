/**
 * **How the public routes are spelled** — and nothing about what they read.
 *
 * The name, the pattern that recognises it, and the path a request would use.
 * [routes.ts](routes.ts) attaches a reader to each of these and exports the
 * result as `PUBLIC_ROUTES`; the dispatcher walks that, and so do the method
 * sweep, the zero-spend sweep and the client's own path test. One spelling,
 * several consumers.
 *
 * ## **This file imports nothing, and that is the whole point of it**
 *
 * Do not add an import here — not a type, not a constant, not a convenience.
 * The spelling of a URL is a fact about the wire and needs nothing to state it,
 * and `tests/public-imports.test.ts` asserts that this module's import graph is
 * exactly itself.
 *
 * It was declared in `routes.ts` until 2026-08-28, beside the readers, which
 * meant that importing the inventory pulled `store/public-reader.ts` →
 * `sanitize.ts` → **jsdom**. **Measured: 803ms to import, on an idle machine.**
 * The client's test that pins its paths against this inventory did that import
 * inside a test body on vitest's default 5s timeout, and timed out in two full
 * runs out of two while passing when run alone — a cross-lane failure that
 * looked like flakiness and was a module graph.
 *
 * Raising that timeout was the other option and it was refused: it buys silence.
 * The 803ms would still be there, and the next thing to import the inventory
 * would meet it again with no clue why. Welding a list of URL shapes to an HTML
 * sanitiser was an accident of where it happened to be declared, not a design.
 *
 * So: a leaf. If you find yourself wanting an import here, what you want
 * probably belongs in `routes.ts` beside the readers instead.
 */

/**
 * What a slug may be spelled with, in a route pattern.
 *
 * The character class every authenticated slug route in src/routes.ts uses, so
 * a slug that is legal there is legal here and the two cannot disagree about
 * what a slug looks like. It is permissive on purpose — `%` and `.` are in it —
 * and `slugFrom` in [routes.ts](routes.ts) is what makes that safe.
 */
const SLUG_CHARS = "[\\w.%-]+";

/**
 * **A route about one article**, named by a slug: `/api/public/<name>/<slug>`.
 *
 * Every entry here was this shape until 2026-09-04, which is why `path` used to
 * take a slug unconditionally — see `PublicRouteName` below for what changed and
 * why it is a union rather than an optional argument.
 */
export interface PublicSlugRouteName {
  readonly kind: "slug";
  /** The path segment after `/api/public/`. */
  readonly name: string;
  readonly pattern: RegExp;
  /** The path a request for `slug` would use. Exported so sweeps can build one. */
  path(slug: string): string;
}

/**
 * **A route about no article in particular**, at `/api/public/<name>` — a list.
 *
 * The pattern captures nothing, so there is no slug to validate and no
 * `slugFrom` to run; `routes.ts` switches on `kind` and the compiler makes the
 * switch exhaustive.
 */
export interface PublicCollectionRouteName {
  readonly kind: "collection";
  readonly name: string;
  readonly pattern: RegExp;
  /** The one path this route has. Takes nothing, for the same reason. */
  path(): string;
}

/**
 * **One public route's identity: how to recognise it, and how to spell it.**
 *
 * A **discriminated union**, and it is one rather than `path(slug?: string)`
 * deliberately. The three sweeps that drive off this inventory ask different
 * questions of the two kinds — a malformed slug is meaningless for a collection,
 * and `path()` with a slug it ignores would let a sweep believe it had tested
 * something it had not. With a union, a sweep that forgets a kind does not
 * compile, and `servePublicApi`'s `switch` has a `never` arm.
 *
 * docs/plans/260904b-pricing-page-and-public-showcase.md § 6 is the argument;
 * the short version is that generalising the closed room does not weaken it
 * provided method enforcement, Postgres enforcement, dispatch and `send` stay
 * shared and the type stops anybody handling one kind and not the other.
 */
export type PublicRouteName = PublicSlugRouteName | PublicCollectionRouteName;

function publicRoute(name: string): PublicSlugRouteName {
  return {
    kind: "slug",
    name,
    /* Both built from the name rather than written out beside it. Two spellings
       of one route is one place for them to disagree, and the disagreement
       would be a route the dispatcher serves and the sweeps never visit. */
    pattern: new RegExp(`^/api/public/${name}/(${SLUG_CHARS})$`),
    path: (slug) => `/api/public/${name}/${slug}`,
  };
}

function publicCollection(name: string): PublicCollectionRouteName {
  return {
    kind: "collection",
    name,
    /* Anchored at both ends, with nothing after the name — so
       `/api/public/library/anything` is **not** this route. It falls to the
       namespace's own 404 rather than being served as the list with a segment
       nobody read, which is the quiet version of the same mistake. */
    pattern: new RegExp(`^/api/public/${name}$`),
    path: () => `/api/public/${name}`,
  };
}

/**
 * **The path a sweep should ask for**, whichever kind of route it is holding.
 *
 * Here rather than repeated in each test, because there are three sweeps and the
 * ternary is the one line every one of them would otherwise write for itself.
 * It stays in the leaf so the client's path test can use it without importing
 * the readers — the whole reason this file has no imports.
 */
export function pathOf(route: PublicRouteName, slug: string): string {
  return route.kind === "slug" ? route.path(slug) : route.path();
}

/**
 * **Every route in the closed room, in one place.**
 *
 * GPT Sol's finding 5, 2026-08-28: the method sweep and the zero-spend sweep
 * both hardcoded the same two paths, so the day slice 1b adds `summary`,
 * `glossary`, `ideas` and `tweets` — four routes, which is what 1b is — the new
 * ones would be unswept and the suite would stay green. The inventory is the
 * fix, and adding a route to it is now the only way to add a route at all:
 * `routes.ts` refuses to load if a name here has no reader attached.
 *
 * **One entry between 2026-09-02 and 2026-09-04, and that was deliberate rather
 * than unfinished.** `metadata` was deleted with its reader, its DTO and its
 * type: the client had read the artefact booleans off the article payload since
 * 2026-08-28, and the only thing still calling the route was a deployment
 * checker, which now reads `meta.title` off the article instead.
 * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § Cluster B.
 *
 * **`library` is the second, and the first that is not about one article.** It
 * is the shelf `/read/public` draws — every article whose owner has shared it,
 * which is a *list* and so is the first thing in this namespace a stranger can
 * ask for without already knowing a slug.
 * docs/plans/260904b-pricing-page-and-public-showcase.md § Stage 3a.
 */
export const PUBLIC_ROUTE_NAMES: readonly PublicRouteName[] = [
  publicRoute("article"),
  publicCollection("library"),
];
