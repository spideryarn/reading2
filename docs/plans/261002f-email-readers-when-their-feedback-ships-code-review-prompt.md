# Code review: email a reader when their feedback ships

Repo: Spideryarn (read CLAUDE.md for the house rules). You are the code reviewer for one commit, and
**you may fix what you find** inside its scope: edit the files, then say exactly what you changed and
why. Anything wider than this change, report rather than fix. Do not commit, do not push, do not run
anything against production (`.env.prod`), do not send any email, and do not run `npm run db:reset`
or `npm run deploy`.

The commit: `git show 630cc665e` (parent `03d0cad95`). The plan, with your own earlier plan review
and how it changed the design: `docs/plans/261002f-email-readers-when-their-feedback-ships.md`.

What it does: the last step of `npm run deploy` (`scripts/deploy.ts`, `feedbackShippedEmails`) runs
`scripts/feedback-shipped-emails.ts`, which reads the shipped report ids from
`src/feedback-endings.generated.ts` at the deployed commit, joins them in production to
`spideryarn.feedback`, `auth.users` (current confirmed address) and the new ledger table
`spideryarn.feedback_shipped_emails`, and emails each non-admin reader's report once, through
`sendEmail` (`src/email.ts`) with an idempotency key. Ledger states: sent / failed (retried next
deploy) / sending (in flight or ambiguous: a person's `--retry`).

Please check, against the code:

1. Correctness of the reserve / send / complete SQL and the state machine — any path that sends
   twice, sends to the wrong account, loses a letter silently, or wedges a row.
2. The deploy wiring: runs only when the code is live; its failure is in `AFTER_THE_FACT_CHECKS`
   and the generalised summary line in `summarise` is true in every case it prints.
3. The CLI: the dry run truly cannot write (it wraps the pool in a read-only transaction — check
   that `--send` is the only path that writes, and `--retry` handling).
4. The migration (`drizzle/20261002160823_feedback_shipped_emails.sql`) and schema entry: additive,
   the FK and cascade right, nothing a later `db:generate` would fight; does the running app's role
   need or get privileges (see `checkAppPrivileges` in scripts/deploy.ts)?
5. Privacy and logging: no address or report body printed or logged; the /privacy clause and
   docs/project/privacy.md true to the code.
6. Tests: `tests/feedback-shipped-emails.test.ts` (pure) and
   `tests/feedback-shipped-emails-ledger.test.ts` (private-postgres lane; run it with
   `npx vitest run --project private-postgres tests/feedback-shipped-emails-ledger.test.ts`) — do
   they cover the risky paths, and would they go red if the code were wrong?
7. Anything simpler that does the same job.

Run `npm run typecheck` and the two test files after any fix. Answer with numbered findings,
severity (P0–P3), file:line evidence, and for each either "FIXED: <what>" or "REPORTED". End with
a one-line verdict.
