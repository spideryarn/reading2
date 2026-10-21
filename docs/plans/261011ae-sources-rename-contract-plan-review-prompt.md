# Plan review: the Sources rename's contract (261011ae, queue item qi-mzfxw3q2)

You are reviewing a **plan**, read-only, in the worktree you are in (uncommitted changes included).
The plan is `docs/plans/261011ae-sources-rename-contract.md`. The queue item it executes is
`docs/plans/261009w-contract-queue-item.md`; the rename's plan is
`docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md` (§ The database, § After GPT
Sol's plan review). The expand migrations it undoes are `drizzle/20261010030345_bibliography_expand.sql`,
`drizzle/20261010044614_stale_notice_bibliography.sql` and `drizzle/20261010063350_reception_expand.sql`;
the precedents for the data movement are `drizzle/20261001224759_skim.sql` and
`drizzle/20261011025758_referee_promises.sql`.

This **drops columns and deletes rows on production**. `npm run deploy` applies every pending
migration in one transaction, then pushes and waits for Vercel, so for some minutes the code
deployed now runs against the contracted database (`scripts/deploy.ts`,
`docs/project/deployment.md`).

Stage 1 ("Deploy A") is already written: `docs/plans/261011ae-sources-rename-contract-stage-a.diff`
(the diff of `src/store/pg-revisions.ts`, then the new test file). Review it as code, too.

## What to do

1. **Attack the window claim.** The plan says the only statement in the current code that names a
   column the contract drops is drizzle's first-draft insert. Find any other: in `src/`, `scripts/`
   and `tools/`, any statement (drizzle or raw SQL) that would name `article_revisions.citations`,
   `.debate`, `.debate_claims`; the view `debate_claim_checks`; the functions or triggers being
   dropped; any constraint or index by its old `debate_claim_checks_*` name; or that would *write*
   an old spelling the narrowed CHECKs refuse (step names, chat origins, rate buckets, stale-notice
   modes). Include drizzle `insert(...).values()` (lists every declared column), `onConflictDoUpdate`,
   bare `select()`/`returning()`, and joins.
2. **The two-deploy sequencing.** Is holding Stage 2 off `dev` until A is live right, and is there a
   cheaper safe shape?
3. **The migration's order and locks** (§ The migration): the lock mode and lock ordering, the
   refuse-on-mismatch checks, dropping the step-run trigger before the delete, the jobs rewrite, the
   chat-origin rewrite against the CHECKs, the stale-notice "later wins" rule against
   `src/store/pg-stale-notices.ts § list`, keeping `claims` for 261011g's own contract, the rate
   bucket rewrite-versus-delete, the claim-check renames (including the hand-written owner FK).
   Anything that passes on an empty database and fails where there is history.
4. **The code removals** (§ The code): anything listed that must not go, anything that must go and
   is not listed. Use `git grep -n "one-deploy\|one deploy\|261009w"`.
5. **Testing** (§ Testing the migration itself): is rehearsing on the shared local database enough,
   and what would you add?

## Output

Write findings to the output file: each with an id (F1…), a severity (P0 blocks, P1 must fix
before deploy, P2 should fix, P3 note), the file and line, the concrete failure, and the fix. End
with one verdict line: `VERDICT: BUILD AS PLANNED`, `VERDICT: BUILD WITH CHANGES`, or
`VERDICT: DO NOT BUILD`. Do not edit any file.
