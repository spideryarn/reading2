# Code review and fix, round 2: 261008i stage 3, the fixes to round 1

Repo: Spideryarn, this worktree. Round 1 is `docs/plans/261008i-debate-claims-stage3-code-review-sol.md`
(verdict "do not land"). Candidate for this round: three commits, each to be read on its own —
`a75b92773` (your round-1 fixes E3, E4, E9, E10: unreviewed code by someone else now),
`52819af19` (E1, E5, E6, E7, E8, E11, by an Opus builder), and `1e1b30156` (the new migration
`drizzle/20261009024756_debate_check_bucket.sql` and its snapshot). `git show <sha>` for each. The
merge `5779a2243` only brings in dev; ignore it except where it touches these files. E2 is
gateway-wide and queued separately; do not reopen it.

House rules: `CLAUDE.md`. Plan: `docs/plans/261008i-debate-claims-picked-by-the-reader.md` § 3.

## What to do

**Discovery is closed after this round**: check that each round-1 finding is actually fixed by
these commits, and look for defects the fixes introduced. Specifically:

- E1: does the `debate-check` bucket hold concurrency for the whole call (lease vs
  `DEBATE_CHECK_TIMEOUT_MS`, including the finish retries of E7)? Is Dig deeper's policy
  untouched? Does the migration match the schema's CHECK literal and the `RateBucket` union?
- E5: `drawChecks` in `src/web/debate-checks.ts` and `CheckedClaim` in `DebatePanel.tsx`: can a
  paid row now be drawn twice, under two claims, or not at all? Is the earlier-version group
  read-only? Does the server's Dig further for an id no longer on the list take its words and
  addresses only from stored rows, and refuse an id it cannot find?
- E6, E7, E8, E11 as described in round 1.
- Your own E3, E4, E9, E10 fixes, read fresh.

**You may fix what you find inside this scope**, narrowly and red first. Run test files with
`npx vitest run <file>` (Postgres-backed tests may not run in your sandbox; say so). Do not commit.
Anything that changes a defence in security-map.md beyond adding the `debate-check` bucket: report,
do not fix.

Severity: P0 data loss, exploitable security, incorrect charging, broadly unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design/maintainability;
P3 prose. IDs G1, G2 …, established or reasoned, file:line, what you changed.

Final answer: for each of E1, E3–E11 one line "fixed" or "still open: why"; then new findings;
files edited; tests run with results; one-line verdict ("land", "land with the fixes made", "do
not land").
