/**
 * **The one sanctioned way to look an article up by slug** — and a leaf, so
 * anything can use it.
 *
 * `articles.slug` is globally unique, so `eq(articles.slug, …)` on its own finds
 * *anybody's* article, and the failure is silent in the worst way: the query
 * works, a real article comes back, and it is somebody else's. This predicate is
 * the answer, and [`tests/owner-isolation.test.ts`](../../tests/owner-isolation.test.ts)
 * greps `src/store/` to make sure nothing writes the unfiltered spelling
 * anywhere else. The long version of that reasoning is in [pg.ts](pg.ts), which
 * re-exports this so that no caller has to know it moved.
 *
 * ## Why it is here rather than in `pg.ts`
 *
 * Because `pg.ts` imports `src/api.ts`, which reaches `glossary.ts` and
 * `arc.ts`. The AI ledger needs this predicate and is itself reached from the
 * pipeline stages, so importing it from `pg.ts` closed an import cycle that
 * `npm run cycles` gates on — and made a CLI stage run impossible to account
 * for. This file imports the schema and the owner and nothing else.
 *
 * ## The owner is an argument, and usually omitted
 *
 * Omitted, it is `currentOwnerId()`, which is what every reader path wants.
 * Passed, it is whoever the caller already knows the row belongs to — the AI
 * ledger's case, where the owner was captured when the collector opened and
 * asking the ambient one again would be a second opinion that can differ. GPT
 * Sol asked for the argument for exactly that reason.
 */

import { and, eq } from "drizzle-orm";

import { articles } from "../db/schema.js";
import { currentOwnerId, type OwnerId } from "../owner.js";

/**
 * **`OwnerId`, not `string`** — tightened 2026-08-28 on GPT Sol's finding that
 * the argument added for the AI ledger *"currently accepts any string"*.
 *
 * The default is the ambient owner, which is safe; the explicit form is for a
 * caller that already knows whose row it is writing, and the whole value of it
 * is that the caller knows. A `string` parameter would take a slug, an email or
 * a job id as happily as a uuid, and the query would run and match nothing —
 * which reads exactly like "there is no such article".
 */
export function ownedSlug(slug: string, ownerId?: OwnerId) {
  return and(eq(articles.slug, slug), eq(articles.ownerId, ownerId ?? currentOwnerId()));
}
