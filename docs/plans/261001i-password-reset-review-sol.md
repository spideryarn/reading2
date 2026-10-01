The inline callback design is sound, but the event discriminator needs changing before build.

1. **P1 — “first `SIGNED_IN`/`PASSWORD_RECOVERY` wins” can classify the wrong session.**

   Evidence: the ordering claim is only partly right. `_exchangeCodeForSession` emits the event during initialization ([GoTrueClient.js:1599](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:1599), [GoTrueClient.js:1640](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:1640)); that notification is queued and flushed after the internal initialization promise settles ([GoTrueClient.js:337](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:337), [GoTrueClient.js:4319](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:4319)). `_initialize` then schedules a second, duplicate event with `setTimeout(0)` ([GoTrueClient.js:412](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:412)). A listener installed immediately after `createClient` should therefore see the normal URL event.

   `INITIAL_SESSION` is harmless because the watcher ignores it, and `_recoverAndRefresh` is the alternative to the URL branch, not something run during a valid callback ([GoTrueClient.js:396](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:396)). But another tab’s BroadcastChannel event is delivered immediately with `broadcast=false`, bypassing the initialization queue ([GoTrueClient.js:260](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:260), [GoTrueClient.js:4327](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:4327)). It can therefore resolve the current first-event promise incorrectly ([url-session-kind.ts:31](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/src/web/lib/url-session-kind.ts:31)).

   Fix: record relevant events by `session.access_token` or session ID, then ask for the kind matching the exact session returned by `getSession()`. Do not use one global first-event promise. Add both race orders to the test: unrelated `SIGNED_IN` then URL `PASSWORD_RECOVERY`, and the reverse.

2. **P2 — No matching event should not silently become a sign-in, and the deadline should remain one absolute deadline.**

   Evidence: the proposed fallback explicitly navigates after no event ([auth-callback.test.ts:258](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/tests/auth-callback.test.ts:258)). But the SDK promises `PASSWORD_RECOVERY` for this flow and currently emits it twice. Absence of a matching event is therefore an invariant failure, not evidence that the callback was an ordinary sign-in. Silently leaving also contradicts the newly specific “Choose a new password” email.

   Fix: after a successful `initialize()` and a real session, an absent matching event should show a dedicated recovery-classification error, consume the stored return, and offer an explicit shelf/retry action. Keep one ten-second budget measured from arrival; test initialization consuming most of it so event waiting does not start a fresh deadline.

3. **P2 — The plan’s “`takeReturn` is consumed on every path” security claim is not true in the current callback.**

   Evidence: the return store’s stated contract is that failed sign-ins must not redirect the next attempt ([auth-return.ts:63](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/src/web/auth-return.ts:63)). `AuthCallback` consumes it for provider denial and initialization errors, but not for timeout, successful initialization with no session, or the catch path ([AuthCallback.tsx:141](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/src/web/AuthCallback.tsx:141), [AuthCallback.tsx:175](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/src/web/AuthCallback.tsx:175), [AuthCallback.tsx:201](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/src/web/AuthCallback.tsx:201)).

   Fix: consume the return on every terminal error path and add assertions for timeout, no-session, and thrown initialization. This strengthens rather than weakens the existing defense. The important verdict order—`initialize()` error first, session second, recovery classification last—must remain.

4. **P2 — Inline rendering on `/auth/callback` is correct, but deserves an App-level regression test.**

   Evidence: `App` selects `AuthCallback` before either the loading or user gate ([App.tsx:83](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/src/web/App.tsx:83), [App.tsx:128](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/src/web/App.tsx:128)). Consequently, `useSession` receiving the new session rerenders `App` but does not unmount the callback. `main.tsx` exempts the callback based only on its pathname, so clearing the query does not lose the exemption ([main.tsx:159](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/src/web/main.tsx:159)).

   Fix: keep the inline design. Add one test rendering `App` at `/auth/callback`, deliver a recovery/session update through the session listener, and assert the password form remains mounted. A separate route adds no benefit here.

5. **P2 — `updateUser` rejection handling and its test are missing.**

   Evidence: `updateUser` returns ordinary Auth errors but rethrows non-Auth failures such as transport/storage exceptions ([GoTrueClient.js:2835](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:2835), [GoTrueClient.js:2879](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:2879)). The form currently awaits it without `try/finally` ([SetNewPassword.tsx:37](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/src/web/SetNewPassword.tsx:37)), while its tests cover only resolved success and resolved error ([set-new-password.test.tsx:74](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/tests/set-new-password.test.tsx:74)).

   Fix: catch rejection, restore `busy`, keep the form visible, and show a stable reader-facing error; add `mockRejectedValue` tests. Do the same test for `resetPasswordForEmail`.

6. **P2 — Extend the checks around the two silent-failure seams.**

   Evidence: the URL-kind fake always emits the same token and only tests recovery followed by sign-in, which bakes in the faulty first-event assumption ([url-session-kind.test.ts:18](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/tests/url-session-kind.test.ts:18), [url-session-kind.test.ts:66](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/tests/url-session-kind.test.ts:66)). The template test pins the Supabase-owned link correctly ([auth-email-templates.test.ts:23](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/tests/auth-email-templates.test.ts:23)), but should independently pin the recovery subject, heading, and button rather than one occurrence of “Choose a new password.”

   Fix: add token-distinct cross-tab cases, duplicate-event coverage, the App mounting test above, and explicit template assertions. Add a same-browser multi-tab contamination case to the browser pass if practical. The existing fresh-browser PKCE-failure check remains valuable.

No existing `security-map.md` defense needs weakening: the bare allow-listed callback, `{{ .ConfirmationURL }}`, callback rewrite exemption, initialization verdict, parameter clearing, server gate, and owner isolation can all remain intact.

**Verdict: build with these changes.**