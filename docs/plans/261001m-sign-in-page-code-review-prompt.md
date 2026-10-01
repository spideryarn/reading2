# Code review: 261001m — a sign-in page of its own

Candidate: commit 073ac151 (parent 917809f3). Diff: `git diff 917809f3 073ac151`. Changed paths:
`git diff --name-only 917809f3 073ac151`. Start with src/web/SignInControls.tsx, SignInPage.tsx, App.tsx (LeaveLogin,
the signed-in /login branch), auth-return.ts (loginNext, forgetReturn), router.ts (loginHref), SiteBits.tsx (SiteNav
Sign in), LandingPage.tsx, PricingPage.tsx (PlansForAStranger), AuthCallback.tsx, and the tests named in the diff. That
list does not limit scope. Plan and its review: docs/plans/261001m-a-sign-in-page-of-its-own-signposted-from-the-signed-out-pages.md
and docs/plans/261001m-sign-in-page-plan-review-sol.md — check each of F1-F7 was really done, not just written down.

After the commit, two small fixes landed uncommitted in the worktree (in scope, review them too): SignInPage wraps
SiteFooter in SHELL; App.tsx's signed-in /login redirect moved from render into a `LeaveLogin` useEffect (React warned
"Cannot update a component while rendering a different component").

Evidence I ran: full suite green except three fleet-* files that needed `npm run build:fleet` (green after it);
typecheck clean. A Playwright check at 1440 and 390 passed: / links, /login tabs/show-hide/autocomplete, a deep link
/read/x → /login?next → real password sign-in → landed on /read/x, /pricing Get Reader → /login?new&next=%2Fpricing,
signed-in /login?next=%2Fpricing with nothing remembered → /.

You are a reviewer-fixer. Attack it independently first: open redirect, the one-time code in a URL, stale or wrong
return destinations (StrictMode, cross-tab session arrival, failed starts), the pricing buy path, accessibility of the
switch and Show/Hide, regressions in other pages that used SignInControls or #sign-in, comments and docs that now lie.
Fix what is inside this stage, narrowly and red-first (a failing test before the fix), and run the test files you touch
(`npx vitest run <file>` — no network or Postgres in your sandbox). Report, do not fix, anything wider. Do not commit.
Do not edit docs/project/security-map.md (an entry point whose wording is a rule); if it is now wrong, say so.

Severity: P0 data loss / exploitable security / incorrect charging / broadly unusable; P1 user-visible wrong behaviour
or an authoritative contract violated; P2 design or maintainability risk; P3 prose. IDs C1, C2…; say established vs
reasoned, and what you changed for each.

## My suspicions (worth less; spend most of the run elsewhere)

- LeaveLogin's pathname guard against StrictMode's effect double-run.
- PrimaryCta became a Link: does any other caller rely on a fragment?
- The landing foot panel uses a second orange `site-cta-primary`; marketing-pages says one per page.
