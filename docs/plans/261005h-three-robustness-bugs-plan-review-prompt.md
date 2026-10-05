# Plan review: three robustness bugs (261005h)

You are reviewing a **plan**, read-only. Change no file.

## The candidate

Commit `8f93796bb` on branch `worktree-qi-three-robustness-bugs`, one file:
`docs/plans/261005h-three-robustness-bugs-unknown-wire-values-rootless-children-list-chain-timer.md`.
Read it in full, then the code it names. Nothing is built yet.

## What it is for

Three independent small bug fixes from a queue, each to land as its own commit:

- **A** — six client lookups of a table by a server-sent value get an own-key lookup and a named
  fallback, and the on-demand temml import gets the stale-build recovery the lazy routes have.
- **B** — the reading view's tree walkers survive a stored node with no `children` list.
- **C** — the ↑/↓ and Diagram Previous/Next "chain" stops believing its last aim for 600 ms and
  instead asks whether its own jump has ended.

Files to start with (this does not limit scope): `src/web/Metadata.tsx` § `stageIcon`,
`src/web/SourceScanNotice.tsx`, `src/web/MirrorPanel.tsx`, `src/web/CriteriaPanel.tsx`,
`src/web/marginalia/MarginaliaColumn.tsx`, `src/web/ProfilePage.tsx`,
`src/web/live/gpt-live/useGptLive.ts`, `src/web/maths.ts`, `src/web/stale-shell.ts`,
`src/web/LazyPage.tsx`, `src/web/tree.ts`, `src/supplement.ts`, `src/web/keynav.ts`,
`src/web/DiagramPanel.tsx`, `src/web/scroll.ts`, `tests/diagram-step.test.tsx`,
`tests/keynav.test.ts`, `docs/postmortems/261005d-whose-scroll-was-that-decided-by-a-clock.md`.

## What to do

Make your own independent pass first: for each stage, is the defect described correctly, is the
proposed fix the right one, what does it break, and what is missing. Run any single test file you
like that needs nothing outside the tree (you have no network, not even loopback, so nothing that
touches Postgres).

Severity scale, fixed: **P0** would ship a regression or lose data; **P1** the fix is wrong or
incomplete in a way a reader would meet; **P2** worth doing, not blocking; **P3** note. Give every
finding an id (`P-1`, `P-2`, …), say whether it is *established* (you reproduced or traced it) or
*reasoned*, and end with a one-line verdict per stage: build as planned / build with changes / do
not build.

## My own doubts, last, and only doubts

- Stage A: is calling `reloadIfStale()` from the maths path safe? It runs while an article is
  opening, not on a route that failed to load. Could it reload a reader who is mid-something that
  `safeToReload` does not know about, or loop?
- Stage A: is "the raw value in plain words" a sound fallback for a badge, or should an unknown
  kind draw nothing?
- Stage B: is guarding the three walkers in `tree.ts` enough for the reading view to paint, or does
  the crash simply move to the next walker of `children`?
- Stage C: is "clear the chain when our own jump's `done` fires" correct for `keynav.ts`? In
  particular the plan claims that after a glide settles a fresh `measureRow()` is right, against a
  2026-08-31 comment in `DiagramPanel.tsx` that says there is a gap. Which is true today?
- Stage C: the clamped-end edge the plan names. Real, or not worth a mechanism?
