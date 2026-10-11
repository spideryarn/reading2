# Queue item draft: the contract half of Referee's Claims → Promises (261011g)

For the Overseer to file with `scripts/overseer-queue.ts add` (only Greg or the Overseer may
write the queue). **Not before** the deploy carrying
`drizzle/20261011025758_referee_promises.sql` is live in production and has stayed live, because
the contract removes what the pre-rename code needs.

**Title:** Referee Promises rename, the contract: drop the `referee_claims` view and the old
stale-notice word (261011g)

**Text:**

Plan docs/plans/261011g-referee-claims-become-promises-and-starter-criteria-wait-for-the-referee-own.md
renamed `referee_claims` to `referee_promises` in place and left a `referee_claims` view so the old
code kept working for the deploy's minutes. Once that deploy is live, one contract migration:

1. `DROP VIEW spideryarn.referee_claims;` and drop the view's checks from
   `tests/referee-promises-expand-pg.test.ts` (keep the new store's assertions, or delete the file
   if nothing else is left in it, along with its `TEST_LANES` entry).
2. `stale_notice_dismissals`: rewrite rows whose `mode = 'claims'` to `'promises'`; where a reader
   already has a `promises` row for the same article, keep the later dismissal and delete the other.
   Then narrow `stale_notice_dismissals_mode` to drop `'claims'` (other retired words may already
   have gone with 261009w's contract, qi-mzfxw3q2: build the CHECK from `STALE_NOTICE_MODES` and
   whatever `retiredModes` remains). Remove `claims` from `STALE_NOTICE_TABLE.retiredModes`
   (`src/db/schema.ts`). `RETIRED_STALE_NOTICE_MODES` in `src/stale-notice.ts` may keep it as a
   read-side alias.
3. Read-side aliases that may stay, as `trajectory` and `remember` do: `RETIRED_JOBS`'
   `referee-claims` (old `ai_calls` rows are append-only and need it forever), and the
   `?referee=claims` lift (`liftLegacyRefereeClaims`).

Rollback note: new code writes `promises` in `stale_notice_dismissals` and the `referee-promises`
job name in `ai_calls`. The pre-rename code reads neither, so rolling back past this deploy loses a
dismissed stale notice on Promises and files new cost rows under a job it does not know. Nothing
breaks for a reader.
