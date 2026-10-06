# Review: fleet dashboard — history discipline (stage 1) and an exhaustive mode mount (stage 3)

Repo: this worktree, branch `worktree-fleet-borrow-reading-machinery`. TypeScript, ESM, React; the
fleet dashboard client is `tools/fleet/web/src/`, its tests `tests/fleet-*.test.ts(x)` (vitest, jsdom).

## The candidate

Committed: `0664f77bd` (stage 3) then `bcba3df08` (stage 1).
`git diff 844816cce..bcba3df08`; changed paths: `git diff --name-only 844816cce..bcba3df08`.

Start with: `tools/fleet/web/src/mode.ts`, `tools/fleet/web/src/SessionsPanel.tsx` (§ `openFromList`),
`tools/fleet/web/src/App.tsx` (the `switch`), `tests/fleet-history.test.tsx`. The call sites of
`useHashState` in `App.tsx` are in scope: the hook's guarantee is about what its callers get.
The plan is `docs/plans/261006l-borrow-the-reading-app-s-machinery-for-the-fleet-dashboard.md`
(Stage 1, Stage 3, and your own two plan reviews beside it). Not the limit of scope.

## What it is meant to do

Stage 1: the table in the plan — a mode change and opening a session from the list push; every other
write replaces; owned writes use the History API from a ref and fire no event; incoming navigation is
adopted from `hashchange` and `popstate`; a refused History API call keeps the view and leaves the
address stale until the next successful write; one-pane list scroll and focus are restored when the
detail closes. Existing hash spellings and every existing test are unchanged.

Stage 3: `App.tsx` mounts through one exhaustive `switch`; arm bodies were moved verbatim; no rendered
DOM changes. `docs/project/fleet-dashboard-modes.md` and two signposts were corrected to match.

This page is what the Overseer reaches for when other things are broken: it may not blank, and it may
not strand a reader on the wrong session.

## What you can run, and what you may change

You may edit this worktree. Fix what is inside these two stages — each finding red-first, with the
test that reproduces it — and leave anything wider as a finding for me to decide. Do not commit. List
every file you changed at the end. No network. Run `npx vitest run tests/fleet-history.test.tsx` and
any one other fleet suite yourself; `npm run typecheck` if the sandbox allows.

Doc edits: do not write or alter any quotation attributed to a person.

## Attack it

Independently, before my suspicions.

- Break the history rule: find a sequence of real controls on this page after which Back lands
  somewhere a reader would call wrong, or history grows without a deliberate act, or state shown and
  address disagree after successful writes.
- Is this statement accurate: *"the page's own writes never arrive back as events, and an incoming
  navigation always wins over unpersisted local state"*?
- The scroll restore: can it scroll or steal focus when it should not (two-pane, resize between open
  and close, selection changed by another tab's link, list reordered or the row gone)?
- The `switch`: any arm whose JSX or props changed; anything rendered differently.
- The tests: which would stay green with the behaviour broken? Mutate and say.
- The doc edits: any sentence now false against the code.

For each finding: an ID numbered from F11 (F1–F10 are taken by the plan reviews), severity (P0 data
loss or broadly unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2
design or maintainability risk; P3 prose), established or reasoned, (a) the input or mutation that
shows it, (b) the fix — applied if inside the stage. Refuse only on an established P0 or P1 you could
not fix. End with a one-line verdict: ship / ship with my fixes / do not ship.

## My own suspicions — read last

Already mine, worth less than what you find.

- A session opened from the AttentionPanel cards above the list (wired in `App.tsx`) saves no scroll.
- After a refused push the next write replaces, so the lost entry is never made.
- Feed → session (`go("sessions", { sel, selpid })`) is a mode change and a selection in one push;
  closing that detail then replaces, leaving Back to return to the feed. I think that is right.
