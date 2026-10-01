No unresolved P0–P2 findings remain. I fixed six issues, all red-first where behavior changed.

- **C1 — P1 — Established:** F2 was incomplete. Email confirmation did not tell readers to return to the original tab, losing deep-link or purchase continuation. Updated [messages.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-sign-in-page/src/messages.ts:2723) and auth documentation.
- **C2 — P1 — Reasoned:** a cross-tab session arriving during Google’s provider preflight could lose the return destination, then let the unmounted handler launch OAuth. The destination is now stored before the wait and the abandoned handler stops after unmount in [SignInControls.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-sign-in-page/src/web/SignInControls.tsx:97).
- **C3 — P1 — Established:** Google being unavailable did not clear an older return destination, violating F1’s “every failed start” contract. It now uses the shared failure path.
- **C4 — P1 — Reasoned:** choosing Free could leave a prior paid-plan marker, causing a later `/pricing` visit to open the superseded checkout. Free now consumes any old intent in [PricingPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-sign-in-page/src/web/PricingPage.tsx:464).
- **C5 — P2 — Established:** the landing page had two orange primary CTAs despite the one-primary rule. The lower Create account link is now outlined in [LandingPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-sign-in-page/src/web/LandingPage.tsx:353).
- **C6 — P2 — Established:** the switch used an ARIA group where a native semantic element exists. It now uses a labelled `<fieldset>` while retaining `aria-pressed`.
- **C7 — P3 — Established:** current comments and website text still described inline sign-in panels. Corrected across the affected source, tests, and docs.

F1–F7 are now implemented. The open-redirect checks and bare callback URL remain intact; `LeaveLogin`’s pathname guard correctly handles StrictMode’s second effect. `PrimaryCta` has only one caller, now a real `/login` destination, so its change to `Link` does not break fragment navigation. `security-map.md` remains accurate and was not edited.

Verification:

- 14 focused test files: **256 passed**
- Final `SignInControls` rerun: **15 passed**
- Typecheck: all four projects green; all **2,552** source files covered
- Targeted lint: no errors; one existing `App` complexity advisory
- `git diff --check`: clean
- No commit made; the pre-existing untracked review prompt remains untouched.