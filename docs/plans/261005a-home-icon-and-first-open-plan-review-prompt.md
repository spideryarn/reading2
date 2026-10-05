# Review: a plan to remove the duplicate Home link and to default a first-opened article to Summary + Marginalia

Repo: this worktree, branch `worktree-fbgqj660-home-link-and-first-open-default`, TypeScript + ESM,
a React client under `src/web/`. This is a **plan** review: nothing is built yet.

## The candidate

Live pre-commit: base `9a6b51b3e7808d12dca7d598f3a8830871f388c4`; untracked:
`docs/plans/261005a-no-home-icon-beside-the-logo-and-a-first-open-default-of-summary-and-marginalia.md`
(the plan) and this prompt. No code has changed.

Start with: the plan; then `src/web/last-view.ts`, `src/web/layout.ts` (`bandCoversProse`,
`fitView`, `fitBoth`), `src/web/marginalia/press.ts` (`notesFit`), `src/web/article/ArticlePage.tsx`
(where `useLastView` is called), `src/web/App.tsx` (which routes draw `HomeLogo`),
`src/web/BackLink.tsx` and its callers, `tests/last-view.test.ts`, `tests/back-link.test.tsx`,
`docs/project/url-state.md` § Reopening an article where you left it. That is where to begin, not
the limit of scope.

## What it is meant to do

Two small product changes asked for by the owner (his words are quoted at the top of the plan):

1. Remove the link home above the heading on pages that already show the corner logo.
2. On an article's first open at a bare address, arrive in Summary (left band) when the window has
   room for a band, and with Marginalia's column too when it has room for both; never override a
   later choice; a link carrying state always wins; start no model call.

The owner asked for the simplest version that gets most of the value.

## What you can and cannot run, and what you may change

The tree is read-only. You may run one test file (`npx vitest run tests/last-view.test.ts`) or a
script under /tmp. No network, not even loopback.

## Attack it

Independently, before reading my suspicions. Is each statement the plan makes about the existing
code accurate, and does the design do what the owner's three bounds say? In particular try to break:
"the default never opens a column the layout then refuses to draw", "arriving by default spends
nothing", "a reader's later choice is never overridden", and "restores behave exactly as before
once the empty string is stored instead of the key being removed".

For each finding give:
  - an ID (F1, F2, …), a severity (P0 data loss/security/charging; P1 user-visible wrong behaviour
    or a contract violated; P2 design risk; P3 prose), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the source lines it contradicts
  - (b) the smallest change to the plan that closes it, as exact wording
A finding with no (a) goes last. Refuse only on an established P0 or P1. Say plainly at the end:
"build it", or "do not build until F… is settled".

## My own suspicions — read last

These are already my doubts, worth less than what you find yourself.

- Is `readerId` settled when `ArticlePage` first runs its layout effect, or can a signed-in reader
  be seen as signed out for one render, with the once-per-slug ref then blocking the default?
- Anything else that reads the stored value or relies on the key being absent (tests, the offline
  cache, sign-out clearing).
- A page among the seven where `HomeLogo` is missing in one shell, or where removing the link leaves
  the heading under the fixed logo.
- StrictMode's double effect run, and a slug change from one article to another.

Do not change any file.
