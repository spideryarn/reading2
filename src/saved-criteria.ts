/**
 * **A referee's criterion as it is stored and as it goes over the wire** — the
 * row both halves of the app speak in.
 *
 * The rules about what a criterion *is* live in
 * [src/referee-criteria.ts](referee-criteria.ts): the kinds, the poles, the two
 * clamps, `validateResults`. This file is the smaller thing that has to be
 * shared with the browser: the shape of one saved row, so the panel is typed
 * against exactly what `GET /api/referee/criteria/:slug` sends rather than
 * against a second declaration of it.
 *
 * **It is `SearchRun` one directory over**, and deliberately so — same
 * `status`-written-before-the-model-call, same `sourceHash`, same reader-chosen
 * `colour` the server stores without knowing what hue it is. What it is not is
 * `SearchRun` with fields added: `config` is a discriminated union and `results`
 * are three different shapes, which is the whole argument in
 * src/referee-criteria.ts § "Why this is not `search_runs` with a column added".
 *
 * It imports nothing but `referee-criteria.js`, and so is on
 * `tests/client-imports.test.ts`'s shared list — a leaf, as everything on that
 * list has to be.
 */

import type { RefereeCriterionConfig, RefereeResult } from "./referee-criteria.js";

/**
 * One criterion, and what came back when it was last run over the piece.
 *
 * `status` exists for the reason it exists on a `SearchRun` and on a `Comment`:
 * the row is written **before** the model is called, so a crash mid-run leaves
 * a visible unfinished criterion rather than a question that evaporated.
 */
export interface SavedCriterion {
  id: string;
  /** What the referee typed, in their own words. **Never logged** — it is prose. */
  criterion: string;
  /** The kind, and everything that kind carries. A union, not a bag of optionals. */
  config: RefereeCriterionConfig;
  createdAt: string;
  status: "pending" | "done" | "error";
  /**
   * The passages this criterion turned up, each stamped with the criterion's
   * own kind — `validateResults` in src/referee-criteria.ts is what keeps the
   * two in step.
   */
  results: RefereeResult[];
  model?: string;
  error?: string;
  /**
   * Fingerprint of the blocks this run was answered against — `hashBlocks`,
   * src/source-hash.ts. Same field, same function and same word for it as
   * `SearchRun`, and absent counts as stale for the same reason: not knowing is
   * not the same as knowing it is fine (`isStale`, src/search-stale.ts, which
   * takes this shape structurally).
   */
  sourceHash?: string;
  /**
   * **The palette slot the referee picked** — absent means "whichever one the
   * hash gives it", exactly as on a `SearchRun`.
   *
   * This is the **categorical** colour, the one that says *which criterion* a
   * mark in the prose came from. It is not the diverging scale, which says
   * which way a valence runs and lives on `config`. Sol's finding 7 is that
   * those two must never become one channel — see `DivergingResult.valence`.
   */
  colour?: number;
}

/**
 * How many criteria one article keeps.
 *
 * A cap for the reason `MAX_RUNS` in src/searches.ts is one: nothing in the
 * feature deletes anything and a list that only grows is a slow leak. Smaller
 * than search's thirty, because a referee form has a dozen questions on it and
 * a hundred saved criteria is not a referee's list, it is a leak with prose in
 * it. Oldest go first.
 */
export const MAX_CRITERIA = 20;
