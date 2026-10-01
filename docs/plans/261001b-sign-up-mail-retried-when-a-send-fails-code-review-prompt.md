Code review, with fixes. You may edit files inside this worktree to fix what you find, within this
change only; report anything wider for me to decide. Do not commit, do not touch git state.

The plan: docs/plans/261001b-sign-up-mail-retried-when-a-send-fails.md (and your own plan review
beside it, -review-sol.md). The change: `git diff HEAD -- src/arrivals.ts src/email.ts
tests/reader-arrivals.test.ts`.

Gates I ran: `npx vitest run tests/reader-arrivals.test.ts` (12 passed; the three new "gives the
claim back" cases were red before the fix), `npm run typecheck` (exit 0), biome lint on the three
files (clean).

Check: correctness of `announced()` and the release path in `noteArrival`; that a release cannot
throw out of `noteArrival`; the cache handling; that the tests would go red if the release were
removed or `announced()` returned true for `failed`; other callers of `SendResult`/`sendEmail`
(src/billing/sync.ts, tests/email.test.ts) still correct with the narrowed `SkipReason`; and whether
the plan's claims about the behaviour match the code. Also check the conclusion in the plan's first
section still reads true. Prioritised findings P0/P1/P2, then what you changed, concisely.
