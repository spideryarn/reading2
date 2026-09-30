What I changed

- `supabase/templates/recovery.html`, `supabase/config.toml`: replaced the still-false sign-in promise with neutral “Continue to Spideryarn” copy.
- Both templates: added `bgcolor` fallback for email clients that ignore CSS backgrounds.
- `scripts/supabase-auth-config.ts`: now rejects extra links, commented-out buttons, additional or malformed Go-template actions, whitespace-padded subjects, and misleading read-back results. Improved `show`/completion output.
- `tests/auth-email-templates.test.ts`: added witnessed regressions for the false recovery promise, extra links/actions, commented-out buttons, and both content-path mappings.
- `docs/plans/260930h-spike-e2e.mjs`: updated future spike expectations for the neutral recovery copy.
- `docs/project/email.md` and the plan: corrected claims about the recovery flow, character counts, historical screenshots, and the seven review findings.
- Verified: all seven earlier findings are now addressed. Focused tests pass, 29/29; full typecheck passes. The normal npm wrapper hit a sandbox IPC `EPERM`, so the identical typecheck script was run through Node’s tsx loader.

Findings not fixed

- **P1 — Wider:** Spideryarn still has no usable password-recovery flow; dashboard-generated recovery links reach the PKCE client in an incompatible form, and there is no new-password screen.
- **P2 — Wider:** one-use links remain vulnerable to mail scanners, and Resend click tracking still needs checking during production rollout.
- **P2 — Operational:** the templates have not been applied to or verified against production, as instructed.
- **nit:** the recovery screenshots show the earlier sign-in wording; the plan now labels them accurately.

Verdict: code is ready after fixes; production rollout and the broader recovery feature remain outstanding.