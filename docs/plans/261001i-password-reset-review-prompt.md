You are reviewing a plan, read-only, before it is built. Repo: Spideryarn (TypeScript, React, Supabase Auth, PKCE browser client).

Plan: docs/plans/261001i-password-reset.md. Read it first.

Then check it against the code and the SDK, not against its own prose:
- src/web/AuthCallback.tsx, src/web/SignInControls.tsx, src/web/lib/supabase.ts, src/web/auth-return.ts, src/web/main.tsx (the callback exemption), src/web/useSession.ts, src/web/lib/api.ts (its onAuthStateChange)
- node_modules/@supabase/auth-js/dist/module/GoTrueClient.js — _initialize (~line 380-440), _getSessionFromURL (~3240-3330), _exchangeCodeForSession (~1610-1650), resetPasswordForEmail (~3740), onAuthStateChange, updateUser
- docs/project/auth.md, docs/project/security-map.md, docs/plans/260930h-auth-emails-in-spideryarn-s-voice.md (§ The finding, § Deferred), supabase/templates/recovery.html, tests/auth-callback.test.ts, tests/auth-email-templates.test.ts

Questions I most want answered:
1. Is the claim about event ordering right (PASSWORD_RECOVERY fires from setTimeout(0) after initialize resolves), and does a module-scope onAuthStateChange registered right after createClient reliably see it? Any way the first SIGNED_IN/PASSWORD_RECOVERY seen there is NOT the URL exchange's (e.g. _recoverAndRefresh, another tab's storage event, INITIAL_SESSION)?
2. Does anything in the plan weaken an existing defence in security-map.md or AuthCallback's verdict logic? If the work seemed to need that, I must stop instead.
3. Is the fallback (deadline passes with a session but no event → leave() as a sign-in) right, or should it be something else?
4. Inline form on /auth/callback vs a separate route: anything that breaks (main.tsx rewrites, App.tsx gate, useSession rerenders unmounting AuthCallback once a session appears, etc.)? Check how App.tsx/main.tsx decide to render AuthCallback when a session exists — if a session appearing re-routes away from AuthCallback, the inline form would vanish.
5. Anything missing from the tests or the browser check, or any simpler design.

Answer as a numbered list of findings, each with severity (P0/P1/P2), the evidence (file:line), and the fix. End with a one-line verdict: build as planned / build with these changes / do not build.
