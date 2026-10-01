# Plan review: 261001m — a sign-in page of its own

You are reviewing a PLAN, read-only, before anything is built. Worktree HEAD is the base; the plan is the untracked file
`docs/plans/261001m-a-sign-in-page-of-its-own-signposted-from-the-signed-out-pages.md`. Read it first.

Then read the code it changes: src/web/SignInControls.tsx, src/web/SignInPage.tsx, src/web/LandingPage.tsx,
src/web/SiteBits.tsx (SiteNav), src/web/PricingPage.tsx (the buy path and its sign-in panel), src/web/App.tsx (the
signed-out gate and the signed-in `/login` branch), src/web/AuthCallback.tsx, src/web/auth-return.ts,
src/web/router.ts, src/web/main.tsx (the callback exemption), src/web/buy-intent.ts. Docs: docs/project/auth.md,
docs/project/security-map.md, docs/project/marketing-pages.md, docs/project/website-text.md.

Attack it independently: what will break, what security defence it weakens (open redirect via `next`, the
one-time code landing in a URL, a stale return destination), what reader-visible flow it gets wrong (deep links,
the pricing buy path, email confirmation in a new tab, password reset landing on /login), what is over- or
under-built, and whether a simpler version gets the same value. You may run single test files that need no
network (e.g. `npx vitest run tests/auth-return.test.ts`).

Severity: P0 data loss / exploitable security / incorrect charging / broadly unusable; P1 user-visible wrong
behaviour or an authoritative contract violated; P2 design/maintainability risk; P3 prose. Give every finding an
ID (F1, F2…), its severity, whether it is established or reasoned, and the concrete fix.

## My own suspicions (worth less; spend most of the run elsewhere)
- Should `/pricing`'s top-bar Sign in go to /login, given its buy path?
- `?new` as a bare query flag vs `?tab=create`.
- Whether the App.tsx signed-in `/login` branch is the right place to honour `next` for password sign-in.
