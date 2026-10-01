You are reviewing one small, security-relevant change, and may fix what you find (workspace-write). Repo: Spideryarn. Worktree: the current directory.

The change is the uncommitted diff: `git diff HEAD -- src/web/AuthCallback.tsx tests/auth-callback.test.ts docs/project/security-map.md docs/plans/261001i-password-reset.md`.

Background: src/web/auth-return.ts stores where the reader was going before a sign-in and promises that a failed sign-in never leaves it behind to redirect the next one. AuthCallback consumed it (takeReturn) on two failure paths but not on [auth-slow], [auth-nosession] or [auth-finish] — your own finding 3 in docs/plans/261001i-password-reset-review-sol.md. Greg approved fixing it. The fix routes every failure through one `fail()` that stops the deadline, clears the auth params, consumes the return, and sets the error; a test pins that `setError` has exactly one call site.

Check:
1. Behaviour is otherwise unchanged: the verdict order (initialize() error, then session, then recovery classification), the success paths (leave() uses the stored return; recovery consumes and ignores it), param clearing, the "nothing on it" path (no error, leave()), StrictMode, and the [auth-kind] path keeping its "go to your shelf" button.
2. Can any failure still reach the screen without consuming the return? Can the guard test be satisfied by a regression (e.g. an error set some other way)?
3. Is the security-map.md row accurate against the code?

Run: `npx vitest run tests/auth-callback.test.ts tests/recovery-form-survives-the-session.test.tsx tests/auth-return.test.ts` and `node scripts/typecheck.ts` (exit codes). Do not commit; do not touch anything outside these files unless a fix needs it.

Answer: numbered findings with severity, evidence (file:line), and what you changed or why not; the commands with exit codes; a one-line verdict.
