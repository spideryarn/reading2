# Queue item draft: the contract half of the Sources rename (261009w)

For the Overseer to file with `scripts/overseer-queue.ts add` (only Greg or the Overseer may
write the queue). **Not before** the deploy carrying all three expand migrations is live in
production and has stayed live, because the contract removes what the pre-rename code needs:

- `drizzle/20261010030345_bibliography_expand.sql`
- `drizzle/20261010044614_stale_notice_bibliography.sql`
- `drizzle/20261010063350_reception_expand.sql`

**Title:** Sources rename, the contract: drop the compatibility the expand migrations added (261009w)

**Text:**

The Sources rename (plan docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md, Greg's
reply spya-egmn6r) expanded the database rather than renaming in place, so the code before and
after its deploy both worked. Once that deploy is live, remove the compatibility in one contract
migration plus the code that served the old spellings for one deploy. Plan § The database and
§ After GPT Sol's plan review list it; in full:

1. `article_revisions`: drop `citations`, `debate`, `debate_claims`, the trigger
   `article_revisions_mirror_renamed` and its function, and the `legacyCitations` /
   `legacyDebate` / `legacyDebateClaims` declarations in `src/db/schema.ts` (with their entries in
   `src/store/revision-columns.ts` and the carry policy's `mirror`). Check equality of every pair
   first and refuse if any differ.
2. `revision_step_runs`: drop the trigger `revision_step_runs_mirror_renamed` **before** deleting the
   old-named rows (otherwise the delete removes their partners), drop `step_name_partner`, delete
   the `citations` / `debate` / `debate-claims` rows, narrow `revision_step_runs_step`, and empty
   `ADMITTED_DURING_EXPAND` in `tests/db-step-constraint.test.ts`.
3. `jobs.steps[].name` and `jobs.reset.regenerate[]`: rewrite the three old step names (order kept;
   refuse a row naming both spellings, as `drizzle/20261001224759_skim.sql` does).
4. `chat_threads`: rewrite `origin_mode` `citations` → `bibliography`, `debate` with a lens →
   `reception`, `debate` with a block → `sources-claims`; drop `chat_threads_origin_debate`; narrow
   `chat_threads_origin_mode`, `_item`, and rename `chat_threads_origin_lens_debate_only` (now
   `in ('reception')`).
5. `sources_claim_checks`: drop the `debate_claim_checks` view; rename its constraints and index from
   `debate_claim_checks_*` to `sources_claim_checks_*` (and the literals in schema.ts, and the old
   index name the store still recognises in `src/store/pg-sources-claim-checks.ts`).
6. Rate buckets: rewrite or delete rows with bucket `debate-check`, then narrow the bucket CHECK;
   `RETIRED_RATE_BUCKETS` may then go.
7. `stale_notice_dismissals`: rewrite `citations` / `debate` / `debate-claims` rows (the later
   dismissal wins where both exist), narrow its mode CHECK, empty `STALE_NOTICE_TABLE.retiredModes`.
8. Code: remove the one-deploy aliases — the old routes `/api/citations/…`, `/api/debate/…`,
   `/api/debate-claims/…` (and `/checks`), and the public payload's `citations` / `debate` /
   `debateClaims` keys. Remove the old job-step spellings from `GET /api/jobs` too, together with
   `previousClientStepName` and the browser's `currentClientJob` decoder: they let a tab loaded
   before the deploy keep matching its running job by exact step name. Each carries a comment
   pointing at this contract; `git grep -n "one-deploy\|one deploy"` finds them. The read-side aliases (`RETIRED_STEPS`,
   `RETIRED_JOBS`, `RETIRED_ORIGIN_MODES`, `RETIRED_STALE_NOTICE_MODES`, `currentLedgerName`) may stay,
   as `trajectory` and `remember` do: ai_calls and feedback rows still hold the old names.

The contract migration is itself a deploy where the old (expand-era) code runs against the
contracted database for some minutes. The expand-era code writes only new names, so that is
safe only if no statement in it names a dropped column. Check that before building, including a
bare drizzle `.returning()` or `select()` on `article_revisions` that would list the declared
`legacy…` columns. Any that do need fixing in a deploy *before* the contract. Checked on
2026-10-10 at commit 9ac4332ae (a Sonnet sweep of about 75 statements in src/, scripts/ and tools/,
plus `STORAGE` read by hand): none does. The whole-row paths are `carriedColumns` (policy `mirror`
filters them) and `ACTIVE_REVISION_COLUMNS`. Re-check if the code has moved since.
Give the migration its own GPT Sol SQL review before deploying, as the expand had
(docs/plans/261009w-migration-review-sol.md, 261009w-reception-migration-review-sol.md).

**Source:** spya-c2qmbg SPIDERYARN-READING2-BV; q-xf2xvb reply spya-egmn6r; plan 261009w.
**Size:** half a day. **Areas:** db, sources. **Waiting on:** the expand deploy being live.
