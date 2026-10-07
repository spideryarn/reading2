# Review, round 2 (read-only, narrow): the hardened production delete

Read-only. Do not change any file; your reply is the review. Round 1 is
`docs/plans/261007f-tidy-the-never-published-production-articles-review-sol.md` (yours; verdict
"safe after these changes … I would allow none with the current script"). **Treat the fixes as
unreviewed code written by someone else**, and spend the run on them: commits `019c0e603` (R1),
`e8de1910d` (R2), `27a22a1b5` (R3), `22d2a867b` (R4), `277bf8504` (R6), `7704217b4` (R7),
`c60afb3ae` (R5, plan only), `9a067dd2d` (plan), `7dec41326` (a fixture type fix), on branch
`worktree-sweep7-never-published-tidy`. Read each with `git show`, and the plan's new § Review
status and § How to run it.

**The two that matter most:**

1. **R1, the guarded delete.** `pgShelfStore.destroy(slug, opts?)` gained `beforeDelete(tx, {id})`,
   run inside `destroy`'s transaction after the billing lock, the article lock and the live-job and
   stranded-reservation checks, before `deleteTerminalJobs` and the delete. The script's
   `refusalUnderTheLock` checks the pinned UUID, re-runs the full eligibility proof, and compares
   the rows about to go with the parsed backup (`row_to_json` deep comparison for `articles`,
   `block_identities`, `checkpoints`, plus id lists for `ai_calls` and `uploads`). The refusal is
   held in a closure because the guarded store scrubs errors thrown through it. Break it: a write
   the proof cannot see between the lock and the delete (a writer that does not take either lock);
   an `ON DELETE` cascade into a table the backup does not compare; the closure pattern losing a
   refusal (does `destroy` really abort the transaction, or just log?); the reader's ordinary
   Delete button changed in any way by the optional hook; `row_to_json` comparison differing for
   reasons other than a real change (timestamps formatted differently across the two connections:
   the builder notes it would refuse rather than delete wrongly — confirm that direction).
2. **R7, the restore.** `--restore <file>` re-inserts the backed-up rows and re-links `ai_calls`;
   it was round-tripped on throwaway local data with every column compared, and refuses a second
   time and a non-backup file. Is the round trip complete for what the delete removes in
   PRODUCTION (any cascaded table empty in the test fixture but possibly not in production)? Can
   `--restore` itself damage production (run against the wrong target, or on a file from a
   different run)? Is it guarded like `--delete` (`--prod`, local-target check)?

**Then briefly:** R2 (a non-local target without `--prod` refused before connecting; does the check
use the URL actually connected to?), R3 (`--delete` refuses `--quiet-days` below 7), R4 (the proof
and the survey now cover the same clocks and protect `high_power_since`, `share_token_at`,
`last_opened_at`; is any protected column still checked by one and not the other?), R6 (the CLI
orchestration tests), and the plan's run conditions: the `revision_blocks_article_block` index
verified in production (it is not there yet), after 2026-10-08 18:31 UTC, exactly the 13 ids, the
backup verified, run by the Overseer with the owner's knowledge.

Discovery closes after this round. **Verdict format:** safe to run under the plan's conditions /
safe after these changes (list them, smallest first) / not safe. Findings D1, D2, … with P0–P3, the
input or code path, and the smallest change.
