# Review: fleet dashboard — a hover preview on compact session cards (stage 2)

Repo: this worktree, branch `worktree-fleet-borrow-reading-machinery`. TypeScript, ESM, React; client
in `tools/fleet/web/src/`, tests `tests/fleet-*.test.tsx` (vitest, jsdom).

## The candidate

Committed: `7dd717b35`. `git diff 38ed43920..7dd717b35`; changed paths:
`git diff --name-only 38ed43920..7dd717b35`.

Start with: `tools/fleet/web/src/SessionPreview.tsx`, `tools/fleet/web/src/SessionsPanel.tsx`
(§ `PreviewOn`, `SessionCard`), `tests/fleet-session-preview.test.tsx`, and
`tools/fleet/web/src/Tooltip.tsx` (unchanged, but its contract is what the stage leans on). The plan
is `docs/plans/261006l-borrow-the-reading-app-s-machinery-for-the-fleet-dashboard.md` § Stage 2. Not
the limit of scope. The previous stage's code (your own fixes in `38ed43920`, § `openFromList` /
`listScroll` in `SessionsPanel.tsx`) is unreviewed-by-anyone-else code that this stage sits beside.

## What it is meant to do

Beside an open session the list's cards are `compact`. Hovering or focusing a compact, unselected
card's title button opens a presentational preview built only from the pushed row: nothing
focusable inside, bounded, and anything cut is said to be cut. Mouse and keyboard only. No fetch, no
new prop from `App`, no wire change. `Tooltip.tsx` is unchanged. No existing test changed.

Known and reported by the builder: the title button remounts when a card gains or loses its preview,
because `Tooltip` cannot be disabled in place.

## What you can run, and what you may change

You may edit this worktree. Fix what is inside this stage — each finding red-first with its test —
and leave anything wider as a finding for me. Do not commit. List every file you changed. No network.
Run `npx vitest run tests/fleet-session-preview.test.tsx` and one other fleet suite yourself.
Do not write or alter any quotation attributed to a person in a doc.

## Attack it

Independently, before my suspicions.

- Can the preview show something false or stale about a session, or text from one session under
  another's name?
- Does the remount of the title button break anything that holds or looks up that node: the scroll
  and focus restore (`listScroll`, `data-session`), `detailRef`, `aria-current`, keyboard tab order,
  a focus that is lost when a card flips between compact and not?
- Accessibility: the button's accessible name, `aria-describedby`, what a screen reader gets.
- Is this statement accurate: *"the preview holds nothing focusable and nothing that needs the
  pointer, for every shape of `FleetRow` and `question` the wire allows"*? Check the wire types.
- Tests that would stay green with the behaviour broken; mutate and say.
- The paragraph added to `docs/project/overseer-direction.md`: any sentence false against the code.

For each finding: an ID numbered from F15, severity (P0 data loss or broadly unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk; P3 prose), established or reasoned, (a) the input or mutation, (b) the fix — applied if inside
the stage. Refuse only on an established P0 or P1 you could not fix. End with a one-line verdict:
ship / ship with my fixes / do not ship.

## My own suspicions — read last

- The remount, above. An additive `enabled` prop on `Tooltip` would remove it; I excluded changing
  `Tooltip` from the builder's brief and am open to being told that was wrong.
- A tap's focus on a touch device might open the card (jsdom skips `:focus-visible`); a browser check
  is running separately for that.
