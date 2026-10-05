/**
 * **How a visitor may be let in, as one value, and the one function that turns
 * it into a `where`.**
 *
 * There are two ways to read an article without being its owner: it is public,
 * or the request carries the key of its private link
 * (docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md).
 * Every read in [public-reader.ts](public-reader.ts) takes a `PublicAccess` and
 * puts `publicAccessWhere(slug, access)` in its own `where`.
 *
 * ## Public wins
 *
 * The `link` arm is *public **or** this key*, never the key alone. So a public
 * article reads the same with a right key, a wrong one, a stale one or none,
 * and turning its link off changes nothing a visitor sees. Sol's F2 on the
 * plan.
 *
 * ## Why this is not the predicate parameter public-reader.ts refuses
 *
 * That file's header turns down a reader that takes a `where`, because an
 * owner's predicate and a public one have the same type and swapping them
 * compiles. This value cannot say "owner". Its two arms are built here from
 * the two ownerless leaves and from nothing else, and neither leaf can reach
 * `currentOwnerId` (tests/owner-isolation.test.ts). What a caller chooses is
 * whether a key came with the request, which is a fact about the request.
 *
 * ## Not for a listing
 *
 * A listing names no slug, so there is nothing for a key to be the key of.
 * [public-library.ts](public-library.ts) does not import this file, and
 * tests/public-imports.test.ts holds that.
 */

import { or } from "drizzle-orm";

import type { ShareKey } from "../share-key.js";
import { linkSharedSlug } from "./link-shared-slug.js";
import { publicSlug } from "./public-slug.js";

/**
 * `public`: no usable key came with the request. `link`: one did, already
 * bounded by `parseShareKey`. Whether it opens anything is the database's to
 * say.
 */
export type PublicAccess = { kind: "public" } | { kind: "link"; key: ShareKey };

/** No key: the article must be public. What every caller without one passes. */
export const PUBLIC_ONLY: PublicAccess = { kind: "public" };

/** The access a request with this `?key=` has. `null` is no usable key. */
export function accessFor(key: ShareKey | null): PublicAccess {
  return key === null ? PUBLIC_ONLY : { kind: "link", key };
}

export function publicAccessWhere(slug: string, access: PublicAccess) {
  switch (access.kind) {
    case "public":
      return publicSlug(slug);
    case "link":
      return or(publicSlug(slug), linkSharedSlug(slug, access.key));
    default: {
      /* Fixed words, and not the value: one arm of it holds a key. */
      const unreachable: never = access;
      void unreachable;
      throw new Error("Unknown public access.");
    }
  }
}
