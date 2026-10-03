No P0/P1 found in **af5448a98**. I made no changes and did not commit.

All remaining findings are **P2**, left for your decision:

- **F5 — Fail-open removes the cap during a schema mismatch.** [feedback-notice.ts:208](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/feedback-notice.ts:208). Without the migration, the insert fails with CHECK violation `23514`; no allowance row survives, but every notice sends anyway. This matches the revised plan, although the email’s “At most” statement and `email.md:133` omit the exception. Decide whether permanent schema errors should suppress mail, or retain fail-open and qualify those promises.

- **F6 — “Never throws” has an injected-dependency exception.** [feedback-notice.ts:224](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/feedback-notice.ts:224). A synchronous `finish()` throw escapes because `.catch()` is attached only after the call returns. The actual Postgres implementation is async, so I found no current production trigger. A `try { await finish(...) } catch { ... }` would close the contract gap.

- **F7 — The new allowance test proves the hourly limit, not the daily limit.** [fetch-allowance.test.ts:258](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/tests/fetch-allowance.test.ts:258). Removing `FEEDBACK_NOTICE_POLICY.daily` would leave it green: all six requests occur within the five-per-hour window. Age the first five beyond an hour before the sixth. The route mock also records the supplied owner argument, rather than checking `currentOwnerId()`; production scope is correct, but that regression is untested.

- **F8 — Bidi stripping misses U+061C, Arabic Letter Mark.** [feedback-notice.ts:80](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/feedback-notice.ts:80). It survives both sanitizers, so the plan’s blanket “bidi controls removed” claim is incomplete. Add it or use the Unicode `Bidi_Control` property.

- **F9 — Documentation still overstates defanging.** [email.md:131](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/docs/project/email.md:131) says a mail client draws no link. The implementation correctly documents best effort: bare domains and email addresses can remain clickable. Carry that qualification into the doc.

- **F10 — The dedicated feedback privacy paragraph still names only two destinations.** [PrivacyPage.tsx:543](/home/greg/code/spideryarn2/.claude/worktrees/fb-wwx6ks-email-admin-on-feedback/src/web/PrivacyPage.tsx:543). The Resend entry discloses the inbox copy correctly, but this paragraph was another explicit plan-review recommendation. Add the email destination here.

The substantive plan fixes work: allowance reservations replace report counting; our-origin URLs use parsed serialization; reader prose is normalized, quoted and defanged; email starts after `send`, alongside Sentry. Owner scope traces through `handleApi` → `setRequestOwner(user.id)` → `fileFeedback` → `noticeFeedback` → `take(currentOwnerId())`. `Promise.all` preserves the mirror’s execution and waits for both with current production dependencies.

Kind, slug and report id are validated before storage; filed time comes from Postgres; the authenticated email is flattened and stripped of the listed bidi controls. I found no additional forged-line or header path.

Validation: **67 tests passed** across the three unit suites. **Typechecking passed** through the same script using Node after `npm run typecheck` hit the sandbox’s IPC restriction. The Postgres suite could not start because database/Docker access was blocked.