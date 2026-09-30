Review complete. No blocking code defects remain.

- `apply` preserves the same six-field body, GET/PATCH/GET sequence, read-back rules, dry-run behavior, and exit codes. Its reporting now additionally shows SMTP fields.
- `rate_limit_email_sent` is correctly sent as an integer and safely accepts either `30` or `"30"` on read-back. `smtp_port` is correctly sent as `"465"`; numeric/string normalization cannot cause a meaningful false result.
- All seven field names and types match Supabase’s [Management API reference](https://supabase.com/docs/reference/api/v1-update-auth-service-config). Resend’s documented credentials are exactly `smtp.resend.com`, port `465`, username `resend`, and the API key as password. [Resend documentation](https://resend.com/docs/send-with-supabase-smtp)
- The 30/hour setting matches Supabase’s documented custom-SMTP default. [Supabase custom SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp)
- `RESEND_API_KEY` violates none of the payload guards: it is not forbidden, a hosted Supabase JWT, a live Stripe key, or a database URL. The targeted policy tests pass.

I fixed:

- A contradictory error saying the failed Vercel Marketplace integration supplied the key.
- Stale pre-SMTP comments in [supabase-auth-config.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/resend-smtp/scripts/supabase-auth-config.ts:315).
- The remote payload banner, which previously implied every paid provider key was a model key, in [gjd-remote-env.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/resend-smtp/scripts/gjd-remote-env.ts:463).
- Ambiguous MX wording and, importantly, the verification instructions in [email.md](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/resend-smtp/docs/project/email.md:19).

One verification remains: `smtp_pass` can only be checked for non-empty presence. An old password could therefore mask a failed replacement. The direct Resend API send proves the key and domain work, but not Supabase’s SMTP configuration. Trigger a password reset for an existing account and confirm it in both Resend’s log and the inbox.

Validation:

- Targeted Vitest: 4 files, 138 tests passed.
- Typecheck: all four projects passed; 2,376 source files covered. The literal `npm run typecheck` launcher was blocked by sandbox IPC permissions, so its same wrapper script was run directly with Node.
- Scoped lint: no errors; one unrelated pre-existing informational diagnostic.
- Full `npm test` was additionally attempted but could not reach local Postgres under the sandbox, so no full-suite result is claimed.
- No production commands run, no commit made.