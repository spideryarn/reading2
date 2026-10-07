/**
 * **A referee's criterion as it is stored and as it goes over the wire** — the
 * row both halves of the app speak in.
 *
 * The rules about what a criterion *is* live in
 * [src/referee-criteria.ts](referee-criteria.ts): the kinds, the poles, the two
 * clamps, `validateResults`. This file is the smaller thing that has to be
 * shared with the browser: the shape of one saved row, so the panel is typed
 * against exactly what `GET /api/referee/criteria/:slug` sends rather than
 * against a second declaration of it. The ceiling and its refusal sentence
 * also live here, so the browser can recognise a refused add without importing
 * the store.
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
 * **How many criteria one article can hold: a ceiling, not a trim.** At this
 * many, adding another is refused with `CRITERIA_AT_CEILING`
 * (below); nothing is ever dropped to make room.
 *
 * It was 20, with the oldest finished criterion deleted to make room: chosen
 * by an agent on 2026-09-01 (b9f1d2a53) by analogy with `MAX_RUNS` in
 * src/searches.ts, not asked for. That threw away a referee's own words
 * without saying so, and could not add at all when the one to drop had
 * comments on it. Greg chose a ceiling of 200 that refuses, on 2026-10-07;
 * his words are in docs/project/referee-mode.md § a criterion with comments on it.
 *
 * 200 is far past any referee form (a dozen questions) and still a bound on a
 * table a script could otherwise fill.
 */
export const MAX_CRITERIA = 200;

/**
 * **What a referee is told when the article already holds `MAX_CRITERIA`.** A
 * 409, from `begin` in src/store/pg-referee-criteria.ts, before any stream
 * opens: nothing is written and nothing is deleted. It replaced, on 2026-10-07,
 * a trim that dropped the oldest criterion to make room without saying so
 * (docs/plans/261007f-referee-criteria-are-never-dropped-a-ceiling-of-200-refuses-instead.md).
 *
 * The number is spelled from the constant, so the sentence cannot name a
 * ceiling the store does not enforce.
 *
 * **And it takes the real count, `n`.** A list can already be past the
 * ceiling: the old trim spared criteria still being answered, so one could be
 * inherited above 200 (production's largest was 4 on 2026-10-07, so this is
 * for correctness, not for a reader we know of). There "200" and "Delete one"
 * would both be false, so the sentence names `n` and how many deletes leave
 * room for one more. At exactly the ceiling it is `CRITERIA_AT_CEILING`, word
 * for word. GPT Sol's C2 in the plan above.
 */
export function criteriaAtCeiling(n: number): string {
  if (n <= MAX_CRITERIA) {
    return (
      `This article already has ${MAX_CRITERIA} criteria, which is as many as it can hold. ` +
      "Delete one to add another."
    );
  }
  return (
    `This article already has ${n} criteria, and it can hold ${MAX_CRITERIA}. ` +
    `Delete ${n - (MAX_CRITERIA - 1)} to add another.`
  );
}

/** The sentence at exactly the ceiling — the one nearly every refusal says. */
export const CRITERIA_AT_CEILING = criteriaAtCeiling(MAX_CRITERIA);

/**
 * **Is this the ceiling's refusal, at any count?** The browser keeps a refused
 * add as a draft (src/web/criterion-refusal-drafts.ts) only for this refusal,
 * and the sentence is the only thing the 409 carries. Read the count back out
 * and rebuild the sentence, so the two forms stay one definition.
 */
export function isCriteriaAtCeiling(message: string): boolean {
  const n = /^This article already has (\d+) criteria/.exec(message)?.[1];
  return n !== undefined && criteriaAtCeiling(Number(n)) === message;
}
