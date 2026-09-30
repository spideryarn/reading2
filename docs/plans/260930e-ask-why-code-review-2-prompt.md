# Code review round 2 (read-only): 260930e — the reviewer's own fixes

Read-only. Do not change any file.

Round 1 (`docs/plans/260930e-ask-why-code-review-sol.md`) fixed C1–C3 itself; those fixes are commit
`966badb5` (`git show 966badb5`) and nobody else has reviewed them. Check **only** that commit:

1. C1 in `src/web/AddPage.tsx`: the source-scoped completions, `draftSource` reset effect,
   `activeCompletionKey`, and the new `claimed.current = null` at the top of the deciding effect.
   In particular: can resetting `claimed` there let StrictMode's repeated effect, or a re-render
   while phase is `saving`, queue or navigate twice, or strand the page (never open)? Does a Retry
   (same address, new job id) still keep the draft and open after save?
2. C2/C3 in `src/web/TrajectoryPurpose.tsx` / `TrajectoryPanel.tsx`: does `planning` ever stay
   stuck `true` so the button silently does nothing, and is the `live` fence right under StrictMode
   (effect cleanup then setup on the same mount)?

Run `npx vitest run tests/add-page-purpose.test.tsx tests/trajectory-purpose-line.test.tsx`.

Answer with findings R1, R2… (P0–P3 as before, file:line, a concrete fix) and a one-line verdict.
Under 500 words.
