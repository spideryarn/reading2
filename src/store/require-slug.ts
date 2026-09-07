/**
 * **A slug that is about to reach a query, or a 400** — and a leaf, so anything
 * can use it.
 *
 * The same guard `src/api.ts` kept on the filesystem side, and the reason it is
 * a shared function rather than a line in each store is written out in
 * [`tests/store-slug-guard.test.ts`](../../tests/store-slug-guard.test.ts): six
 * modules each grew their own copy of the lookup, five called this and one did
 * not, and a malformed slug reaching that sixth came back as *"there is no such
 * article"* about a string that could not name one. A fix that failed to reach
 * one of six copies is the shape that predicts the seventh — and the seventh was
 * `pgVisibilityStore.set`, found while this file was being extracted.
 *
 * ## Why it is here rather than in `pg.ts`
 *
 * The same reason [`owned-slug.ts`](owned-slug.ts) and
 * [`isolation.ts`](isolation.ts) are their own files: `pg.ts` imports
 * `glossary.ts` and `arc.ts`, so anything importing
 * `pg.ts` inherits the whole read layer and risks an import cycle —
 * and `npm run cycles` is a gate, not advice. This file imports `isSlug` from
 * `src/ingest.ts` and nothing else.
 *
 * `pg.ts` re-exports it, so its dozen existing callers did not have to know it
 * moved.
 */

import { isSlug } from "../ingest.js";

/** A slug that is about to reach a query, or a 400. */
export function requireSlug(slug: string): void {
  if (isSlug(slug)) return;
  throw Object.assign(new Error(`Not a slug: ${JSON.stringify(slug)}`), { status: 400 });
}
