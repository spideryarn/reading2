No P0.

- **P1 — fixed:** `known.delete()` ran before the database release. An overlapping request could re-cache the still-present row, then suppress every retry after deletion. The cache now remains populated until release settles, then is cleared. Added the controlled interleaving regression test in [reader-arrivals.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb79-signup-email-retry/tests/reader-arrivals.test.ts:152).
- **P2 — fixed:** The plan overstated the guarantees as “at-least-once,” “each request retries,” and that no post-deploy account could have existed. These are now described accurately in [the plan](/home/greg/code/spideryarn2/.claude/worktrees/fb79-signup-email-retry/docs/plans/261001b-sign-up-mail-retried-when-a-send-fails.md:24).
- **P2 — wider, unchanged:** [email.md](/home/greg/code/spideryarn2/.claude/worktrees/fb79-signup-email-retry/docs/project/email.md:118) still says a Resend outage loses both kinds of notice permanently. That is now false for sign-up mail.

`announced()` correctly distinguishes every current `SendResult`; release exceptions cannot escape `noteArrival`, and ambiguous release failures clear the cache so the next request consults the ledger. The claim-back tests would fail at `arrived() === false` if release were removed or `failed` were treated as announced. `src/billing/sync.ts` remains correct because upgrade notifications intentionally ignore the result; the narrowed `SkipReason` does not affect it or `tests/email.test.ts`.

The Cody conclusion remains true: his timestamp proves the migration backfilled him before notification code existed. I only qualified the stronger claim about potentially deleted later accounts.

Checks:

- Typecheck passed: all four projects, 2,473 source files covered.
- Biome and `git diff --check` passed.
- `tests/email.test.ts`: 11 passed.
- Direct release/cache orchestration probes passed.
- The database-backed suite could not run here because sandbox access to PostgreSQL was denied; the newly added interleaving test therefore still needs your normal environment run.

No commit or git-state mutation performed.