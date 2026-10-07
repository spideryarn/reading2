/**
 * **Which criterion a `begin` produces** — the one decision `pgRefereeCriteria`
 * (src/store/pg-referee-criteria.ts) is written against, plus the sentence a
 * sweep writes.
 *
 * The file-writing half went with `src/store/fs.ts` on 2026-09-05
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * the stage-G section), and nothing here touches a disk any more. What is left
 * is `withCriterion`, which is the fourth of this app's `with*` decisions after
 * `withRun`, `withTurn` and `withSpokenTurn`, and holds the mint-or-retry rule
 * that must not exist in two implementations.
 *
 * ## What differs from searches
 *
 * - A criterion has a **kind**, and `diverging` carries poles and a scale. So
 *   `withCriterion` takes a whole `RefereeCriterionConfig` where `withRun` took
 *   a string, and a reset adopts the **new** config — see the note there.
 * - The results are three shapes rather than one, discriminated by that kind,
 *   and `validateResults` in src/referee-criteria.ts stamps it. Nothing here
 *   looks inside a result.
 * - Everything else — the fingerprint, the retry rule, the colour — is
 *   deliberately identical, and where it is identical it is *imported* from
 *   src/searches.ts rather than copied (`pg-referee-criteria.ts` imports
 *   `requireColour` from there directly). The trim is each Postgres store's
 *   own, in SQL: `MAX_CRITERIA` mirrors `MAX_RUNS`.
 *
 * ## What may be logged from this file
 *
 * Ids, slugs, counts, statuses, kinds. **Never `criterion`, never a pole,
 * never a result's `quote` or `reasoning`.** A criterion is what a referee has
 * been asked to judge a paper against — it is their own words about somebody
 * else's unpublished work, which is the most private string in this app. The
 * rule outlives the logging that used to be here: `pg-referee-criteria.ts`
 * carries it now.
 */

import { isSpideryarnId, mintUniqueId } from "./ids.js";
import type { RefereeCriterionConfig } from "./referee-criteria.js";
import type { SavedCriterion } from "./saved-criteria.js";

/**
 * Which criterion a `begin` produces, as a value. **Pure — no clock, no disk.**
 *
 * `withRun` in src/searches.ts, one field wider, and it is lifted out for the
 * same reason: both stores call it, so the three-condition retry rule this repo
 * carries a postmortem for
 * (docs/postmortems/260826f-search-retry-remints-instead-of-resetting.md) has one
 * implementation rather than two behaviours.
 *
 * **The retry rule is the same three conditions**: the same id, the same
 * criterion text, *and* a row that actually failed. The criterion stops a
 * request asking a different question under an id somebody already holds from
 * overwriting it; the status stops a double-clicked POST, a stale tab and a
 * replayed request from resetting a row that is `pending` or `done`.
 *
 * **The config is NOT one of the three, and a reset adopts the new one.** That
 * is a deliberate difference from `withRun`, which has no config to adopt. A
 * `diverging` criterion whose run failed because its poles were nonsense is
 * exactly the row a referee edits and runs again, and refusing to take the new
 * poles would answer the fixed question with the broken configuration and store
 * it under the same id. The *question* — the criterion text — still has to
 * match, so this cannot silently repurpose somebody's row.
 *
 * `kind` tells the caller which branch ran, because in SQL the two are
 * different statements. A store reading `status` to work it out would get it
 * wrong: both branches produce `pending`.
 *
 * **It returns the row and not the list** — `withRun` says why. The trim to
 * `MAX_CRITERIA` is the SQL one in src/store/pg-referee-criteria.ts § begin.
 */
export function withCriterion(
  criteria: SavedCriterion[],
  criterion: string,
  config: RefereeCriterionConfig,
  wantedId: string | undefined,
  at: string,
  sourceHash?: string,
): { row: SavedCriterion; kind: "reset" | "minted" } {
  const existing = wantedId
    ? criteria.find(
        (c) => c.id === wantedId && c.criterion === criterion && c.status === "error",
      )
    : undefined;

  if (existing) {
    /* Rebuilt field by field rather than spread, and that is the whole point:
       `results`, `model` and `error` are absent from this object, so the failed
       attempt cannot survive underneath a later successful answer. `createdAt`
       is kept, because it is still the same criterion the referee asked for and
       only the attempt is new. The **colour** is kept for the reason
       src/searches.ts records after getting it wrong once: a colour is not part
       of the attempt, it is a property of the question, and the two stores
       disagreeing about that is a hue that vanishes on files and survives on
       Postgres. */
    const row: SavedCriterion = {
      id: existing.id,
      criterion,
      config,
      createdAt: existing.createdAt,
      status: "pending",
      results: [],
      ...(existing.colour === undefined ? {} : { colour: existing.colour }),
      // The **new** attempt's article, not the failed one's.
      ...(sourceHash === undefined ? {} : { sourceHash }),
    };
    return { row, kind: "reset" };
  }

  const taken = new Set(criteria.map((c) => c.id));
  const row: SavedCriterion = {
    id:
      wantedId && isSpideryarnId(wantedId) && !taken.has(wantedId)
        ? wantedId
        : mintUniqueId(taken),
    criterion,
    config,
    createdAt: at,
    status: "pending",
    results: [],
    // Absent, not `undefined` — `exactOptionalPropertyTypes`, and no
    // `"sourceHash": null` on disk for a store that could not answer.
    ...(sourceHash === undefined ? {} : { sourceHash }),
  };
  return { row, kind: "minted" };
}


/** What a sweep writes over an abandoned `pending` row. */
export const CRITERION_SWEPT = "The server stopped before this criterion finished.";

/**
 * The foreign key from a comment to the criterion it is placed on
 * (src/db/schema.ts § `comments_criterion_fk`). Named once, because three
 * store methods ask `violatesForeignKey` about it and a misspelt name matches
 * nothing and says nothing.
 */
export const COMMENTS_CRITERION_FK = "comments_criterion_fk";

/**
 * **What a referee is told when they delete a criterion their own comments are
 * placed on.** A 409: the key refusing is the design
 * (docs/project/database.md § `restrict` and `no action`), and until 2026-10-07
 * its refusal reached the reader as *"That is a bug here rather than anything
 * you did"*.
 *
 * In the pattern of `importRunning` (src/store/pg-shelf.ts): what is in the
 * way, and what to do about it, in the panel's own words — *Place on a
 * criterion* and *Clear placement* are the controls' labels. No bracketed
 * code, on docs/project/copy.md's rule that a refusal which is an answer gets
 * none. What Delete *should* do with the comments is Greg's open question 3,
 * docs/plans/261006m-seventh-codebase-sweep-depth-umbrella.md § For Greg.
 */
export const CRITERION_HAS_COMMENTS =
  "Your comments are placed on this criterion, so it cannot be deleted until you clear those " +
  "placements or delete those comments.";

/**
 * **And when adding one would trim such a criterion.** The same refusal reached
 * from `begin`: finished rows past the cap are trimmed to make room, while
 * pending rows are skipped. The same key refuses that delete, so the insert
 * rolls back. Whether a list may
 * instead grow past the cap to protect them is question 3a in the same plan;
 * this is only the sentence for today's behaviour.
 *
 * It says "the one that would be dropped", not "the oldest one": the oldest
 * criterion can be a pending one the trim skips, with nothing placed on it,
 * while a younger finished one is what the key refuses to delete. The
 * sentence said "the oldest one" as first built, on 2026-10-07, which pointed the
 * referee at the wrong row in exactly that case; it was changed before it shipped.
 */
export const CRITERIA_FULL_NEXT_TO_DROP_HAS_COMMENTS =
  "The list of criteria is full and the one that would be dropped to make room has your comments " +
  "placed on it, so a new criterion cannot be added until you clear those placements or delete " +
  "those comments.";

/**
 * **What a placement is told when its criterion is not there** — a 400, and
 * word for word what `tidyMark` in src/routes.ts answers when it looks first
 * and finds nothing. That early check stays; this is the same answer for the
 * placement that passed it and then lost a race with a delete in another tab,
 * which used to be a 500. `tidyMark` imports this same sentence, and
 * tests/referee-routes-postgres.test.ts compares the two replies.
 */
export const CRITERION_NOT_ON_ARTICLE = "criterionId is not one of your criteria on this article";

/** A store-side refusal that crosses `guardDbStore` by door 1: it carries a `status`. */
export function criterionRefusal(status: 400 | 409, sentence: string): Error {
  return Object.assign(new Error(sentence), { status });
}
