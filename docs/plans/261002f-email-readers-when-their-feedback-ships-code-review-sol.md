Found seven issues and fixed all within scope. No commit, push, production access, or email occurred.

1. **P1 — malformed CLI flags could widen a targeted retry into a broad send.** **FIXED:** strict parsing now rejects missing values, duplicate/unknown flags, and malformed targets before opening production dependencies. [feedback-shipped-emails.ts:499](/home/greg/code/spideryarn2/.claude/worktrees/fbmmhrnw-feedback-shipped-email/scripts/feedback-shipped-emails.ts:499)

2. **P1 — Resend idempotency conflicts were automatically retried.** **FIXED:** both `concurrent_idempotent_requests` and `invalid_idempotent_request` now remain `sending` for human review, preventing a duplicate after Resend’s 24-hour window. [feedback-shipped-emails.ts:305](/home/greg/code/spideryarn2/.claude/worktrees/fbmmhrnw-feedback-shipped-email/scripts/feedback-shipped-emails.ts:305)

3. **P2 — overlapping retries could both send, and stale completion could be reported as success.** **FIXED:** retries compare the observed attempt, fresh in-flight reservations have a ten-minute lease, ownership is renewed immediately before sending, and zero-row completion becomes a problem instead of “emailed.” [feedback-shipped-emails.ts:250](/home/greg/code/spideryarn2/.claude/worktrees/fbmmhrnw-feedback-shipped-email/scripts/feedback-shipped-emails.ts:250), [feedback-shipped-emails.ts:388](/home/greg/code/spideryarn2/.claude/worktrees/fbmmhrnw-feedback-shipped-email/scripts/feedback-shipped-emails.ts:388)

4. **P2 — shipped IDs without a feedback row disappeared silently.** **FIXED:** their IDs are now printed. They do not fail every deploy because erased and historical rows are legitimate cases. [feedback-shipped-emails.ts:365](/home/greg/code/spideryarn2/.claude/worktrees/fbmmhrnw-feedback-shipped-email/scripts/feedback-shipped-emails.ts:365)

5. **P2 — a wrong or stale targeted retry exited successfully.** **FIXED:** an ineligible target or lost reservation now produces a problem and nonzero CLI exit. [feedback-shipped-emails.ts:370](/home/greg/code/spideryarn2/.claude/worktrees/fbmmhrnw-feedback-shipped-email/scripts/feedback-shipped-emails.ts:370)

6. **P2 — the idempotency header disclosed raw account and report IDs to Resend.** **FIXED:** it now uses a stable SHA-256-derived opaque key; privacy documentation remains true. Tests ensure neither identifier appears in the key. [feedback-shipped-emails.ts:181](/home/greg/code/spideryarn2/.claude/worktrees/fbmmhrnw-feedback-shipped-email/scripts/feedback-shipped-emails.ts:181)

7. **P2 — the deploy summary could contradict a forced red gate.** **FIXED:** it now says only that live functional checks passed and explicitly separates forced gates. The mail step remains after live verification and in `AFTER_THE_FACT_CHECKS`. [deploy.ts:1730](/home/greg/code/spideryarn2/.claude/worktrees/fbmmhrnw-feedback-shipped-email/scripts/deploy.ts:1730), [deploy-checks.ts:941](/home/greg/code/spideryarn2/.claude/worktrees/fbmmhrnw-feedback-shipped-email/scripts/deploy-checks.ts:941)

The migration is additive, its composite FK/cascade matches the schema, and the generated snapshot differs from its predecessor only by this table. The mail script uses the migrator role; the running app does not need the table, though normal default privileges grant it access.

Verification:

- Pure tests: **16 passed**.
- All four TypeScript projects pass direct `tsc --noEmit`.
- `npm run typecheck` itself was blocked by sandbox-denied tsx IPC (`EPERM /tmp/tsx-1000/14.pipe`).
- The requested private-Postgres test could not start because sandbox networking denied local Postgres (`EPERM 127.0.0.1:54362`); its new concurrency tests compile but did not execute.
- Scoped lint exits successfully, with existing complexity advisories.
- No simpler design preserves the same reconciliation and ambiguity guarantees.

**Verdict: fixes complete; rerun the private-Postgres test outside this sandbox before shipping.**