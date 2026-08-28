/**
 * **The second way to name an article, and the only ownerless one.**
 *
 *     slug = ? AND visibility = 'public'
 *
 * The sibling of [`ownedSlug`](owned-slug.ts), and deliberately **not** a
 * widening of it. The worst available version of public reading is
 * `or(eq(articles.visibility, "public"))` bolted onto the owner predicate: one
 * edit, in the one place every read in the app goes through, quietly making
 * every one of them match somebody else's row. So there are two predicates and
 * a static guard that names both — see
 * [owner-isolation.test.ts](../../tests/owner-isolation.test.ts), which greps
 * `src/store/` for `eq(articles.slug, …)` and now inspects the three sanctioned
 * lookups rather than trusting three whole files.
 *
 * ## Why its own file, rather than beside `ownedSlug`
 *
 * GPT Sol's answer 4, 2026-08-28, and it is a stronger reason than tidiness:
 * putting the two predicates in one module would make **the public leaf import
 * `currentOwnerId`**, which is exactly the dependency public reads must not
 * have. This file imports the schema and `drizzle-orm` and nothing else. There
 * is no owner in its import graph to reach for.
 *
 * `docs/plans/public-read-only-access.md` proposed putting it in `pg.ts`; Sol
 * showed that would *weaken* the guard rather than extend it, because the test
 * exempts the whole of that file.
 *
 * ## Part of the query, never a preliminary check
 *
 * This is a `where`, and it has to stay one. The tempting alternative — ask
 * whether the article is public, then read it unfiltered — has a window between
 * the two questions and, worse, leaves an unfiltered read in the code for
 * somebody to reuse without the question.
 */

import { and, eq } from "drizzle-orm";

import { articles } from "../db/schema.js";

export function publicSlug(slug: string) {
  return and(eq(articles.slug, slug), eq(articles.visibility, "public"));
}
