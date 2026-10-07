# Check of fixes (read-only, narrow): D1–D4 of round 2

Read-only. Do not change any file; your reply is the check. **Discovery is closed**: this is not a
third round. Its only question is whether the four fixes made after your round 2
(`docs/plans/261007f-tidy-the-never-published-production-articles-review-2-sol.md`) close what you
found. Treat them as code written by someone else.

The fixes, on branch `worktree-sweep7-never-published-tidy`: `1c0ace86e` (D2), `542bd540a` (D3),
`11545a285` (D4), `d9862dc0d` (D1), and the plan update `abb4414f3`. Read each with `git show`, the
script `scripts/never-published-tidy.ts` and its test, and the plan's § 5 (the deadlock reasoning)
and § Review status.

For each of D1–D4 answer: **closed / not closed / closed with a residue**, with the code path. In
particular:
- **D1:** the hook now locks the target's `block_identities` and `checkpoints` rows `FOR UPDATE`
  (one statement per table, primary-key order) before the proof and the comparison, held through
  the delete. Does that close both of your interleavings (a checkpoint update; a reading-time insert
  that locks a block identity)? Is there a THIRD table whose rows cascade from the article or its
  identities and can be written without either lock (check every `ON DELETE CASCADE` reaching
  `block_identities` or `articles`)? Is the deadlock reasoning in § 5 right, and is the worst case
  (Postgres aborts one side) safe as stated?
- **D2:** are `article_share_link_events`, `article_visibility_changes` and `realtime_sessions`
  refused in BOTH the survey and the final proof?
- **D3:** does a subset restore filter articles, identities, checkpoints and ledger links by the
  same set, and refuse a selected article that is present?
- **D4:** the backup header records `system <system_identifier>, database <name> (oid <oid>)`;
  restore compares it with the target before writing; `readBackup` refuses a header/rows mismatch
  and child rows naming an article it does not hold; a remote restore needs `--ids`. Any path
  around those checks?

End with one line: **safe to run under the plan's conditions** / **not safe**, and if not, the
single smallest change.
