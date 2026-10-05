# Review: the Home link is drawn only without the corner logo, and a first-opened article defaults to Summary (and Marginalia)

Repo: this worktree, branch `worktree-fbgqj660-home-link-and-first-open-default`, TypeScript + ESM,
a React client under `src/web/`.

## The candidate

Committed: commit `815a2608e` (one commit, parent `9a6b51b3e`).
`git diff 9a6b51b3e..815a2608e`; changed paths: `git diff --name-only 9a6b51b3e..815a2608e`.

Start with: `src/web/last-view.ts`, `src/web/reader/measure.ts`, `src/web/BackLink.tsx`,
`src/web/App.tsx`, `src/web/AdminPage.tsx`, and the three test files
(`tests/last-view.test.ts`, `tests/first-open-default-wiring.test.tsx`,
`tests/home-link-only-without-the-corner-logo.test.tsx`). That is where to begin, not the limit.

## What it is meant to do

The plan is
`docs/plans/261005a-no-home-icon-beside-the-logo-and-a-first-open-default-of-summary-and-marginalia.md`;
read it, including both "Revised" sections, which override the text above them. Your own plan
review is `docs/plans/261005a-home-icon-and-first-open-plan-review-sol.md` (F1–F4, all accepted).
Number new findings from F5.

Contract, at its true strength:

1. No signed-in page draws both the fixed corner `HomeLogo` and a link home above its heading.
   Signed out, the five house pages keep their Home link.
2. A signed-in reader opening an article at a bare address, where this browser's storage was read
   cleanly and holds no key for the slug, and a marker was then written successfully, arrives at
   `?mode=summary` when a band fits beside the prose, plus `margin=1` when the notes also fit **and**
   the experimental switch is on. Decided once per arrival, after the switch's state is loaded.
3. Nothing else changes: an address carrying any article parameter is left as sent; a stored view is
   restored exactly as before; a reader who has left an article in Plain is not given the default
   again; the default starts no request that costs a model call.

Out of scope, deliberately: first-open across devices, visitors, and gating on whether a summary
exists. They are questions for the owner in the plan.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this change, narrowly, each finding red-first with
the test that reproduces it; leave anything wider as a finding for me to decide. Do not commit. List
every file you changed at the end. Never write a quotation attributed to Greg: the only words of
his that exist for this work are the two report texts at the top of the plan.

You can run one test file at a time (`npx vitest run tests/<one>`). If vitest cannot start in your
sandbox, say so plainly. No network, not even loopback; nothing here needs Postgres.

## Attack it

Independently, before reading my suspicions. Try to break each of the three contract statements.
Also check that every doc sentence added in this commit (`docs/project/url-state.md`,
`summaries.md`, `marginalia.md`, `website-text.md`, `src/web/help/help-topics.tsx`, the header
comments) is true of the code.

For each finding: an ID, a severity (P0 data loss/security/charging; P1 user-visible wrong behaviour
or a contract violated; P2 design risk; P3 prose), established or reasoned, (a) the input or
mutation that shows it, (b) the smallest change that closes it. Refuse only on an established P0 or
P1. End with a plain verdict.

## My own suspicions — read last

Already my doubts, worth less than what you find.

- The two layout effects in `useLastView`: ordering in one commit, StrictMode's double run, a slug
  change, and the passive `save()` writing between the claim and the default.
- A first visit to `/read/<slug>/metadata` at a bare address claims the first open (writes the
  marker) and then gets no default, so the article's own first open is used up.
- `measure.ts` was refactored to share `usableWidth()` / `rootFontPx()`: any behaviour change for
  the hooks that used to hold that code.
- `ArticlePage` now subscribes to the experimental store earlier, through `useLastView`.
- Admin `Shell`'s new top padding on the three sub-pages.

