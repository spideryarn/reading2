# Review: a plan to borrow the reading app's URL/Back, tooltip and mode-table ideas for the fleet dashboard

Repo: this worktree, branch `worktree-fleet-borrow-reading-machinery` (TypeScript, ESM, React). Two
separate React apps live here: the product's reading view (`src/web/`) and an internal fleet
dashboard (`tools/fleet/web/src/`) that may import from `src/` only what
`tests/fleet-imports.test.ts` allowlists.

## The candidate

Live pre-commit: base `844816cce`; scoped paths: none changed; untracked:
`docs/plans/261006l-borrow-the-reading-app-s-machinery-for-the-fleet-dashboard.md` (the plan — the
thing under review) and this prompt. (Not durable; the commit SHA will be recorded in the plan.)

Start with: the plan; then `tools/fleet/web/src/mode.ts`, `App.tsx`, `SessionsPanel.tsx`,
`SessionParts.tsx`, `FeedPanel.tsx`, `Dock.tsx`, `Tooltip.tsx`, `fit.ts`; on the product side
`docs/project/url-state.md`, `src/web/router.ts`, `src/web/layout.ts`. Background:
`docs/project/fleet-dashboard-modes.md`, `docs/project/overseer-direction.md`. That is where to
begin, not the limit.

## What it is meant to do

Greg's request is quoted at the top of the plan. The plan claims an inventory found most of it
already built, names the real gaps (history discipline; no hover card on a compact session card;
four mode registers and an unchecked mount), and proposes three stages. The dashboard is the page the
Overseer relies on when other things are broken, so it has a higher robustness bar than the product:
a change may not blank the page or strand a reader.

## What you can and cannot run, and what you may change

The tree is read-only. You may run one test file (`npx vitest run tests/<one>.test.tsx`) and build a
throwaway harness under /tmp. No network.

## Attack it

Independently, before reading my suspicions.

1. **Is the inventory accurate?** Check each cell of the plan's table and each bullet of "what every
   write being a push costs" against the code. In particular, verify or refute: Sessions already has
   a measured two-pane layout; typing in the feed's text filter pushes a history entry per keystroke;
   "← All sessions" pushes.
2. **Is the "what does not carry over" reasoning accurate**, including keeping the hash rather than a
   real query string, and not importing the product's `Tooltip.tsx`?
3. **Is the Stage 1 design correct and the smallest that works?** Break it: hashchange vs
   replaceState ordering, the `fleetOpened` mark across reload / bfcache / iOS tab reclaim /
   navigation from another mode, `history.back()` being asynchronous, the debounce racing a push or a
   Back, React state diverging from `location.hash`, existing tests that assert on
   `window.location.hash` synchronously after a filter change, other writers of the hash.
4. **Stage 2 and 3**: anything that makes them wrong, harmful or not worth doing; anything in the
   current code that already does them.
5. **Is anything Greg asked for missing from the plan**, or is the plan doing something he did not
   ask for that changes what he sees in a way he should decide?

For each finding give an ID (F1, F2, …), a severity (P0 data loss / broadly unusable; P1 user-visible
wrong behaviour or an authoritative contract violated; P2 design or maintainability risk; P3 prose),
whether it is established or reasoned, (a) the concrete scenario or contract, and (b) the smallest
change that closes it, as exact replacement wording or a code sketch. Refuse only on an established
P0 or P1. End with a one-line verdict: build as written / build with the listed changes / do not
build.

## My own suspicions — read last

Already mine, so worth less than what you find yourself.

- The `history.back()`-on-close mechanism may be more machinery than it earns; a plain replace on
  close might be the right v1.
- The trailing debounce splits "what React shows" from "what the URL says" for 300 ms; I am not sure
  that is safe against a mode switch inside the window.
- Stage 3 touches the file every mode author edits and may not be worth it in this job.

Do not change any file.
