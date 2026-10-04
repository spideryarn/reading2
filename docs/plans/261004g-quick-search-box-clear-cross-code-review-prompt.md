# Code review: a cross that empties the quick-search box in the bottom bar

You are reviewing, and fixing, one small committed stage in this worktree. You may write files in
this worktree. Do not commit, do not push, do not run `npm run deploy`, and do not touch anything
outside this worktree.

## The candidate

- Commit `cdb7642e8` on branch `worktree-quick-search-clear-x`. See it with
  `git show cdb7642e8`.
- Changed paths, complete:
  - `src/web/DockQuickSearch.tsx`
  - `src/web/styles/dock-quick-search.css`
  - `tests/dock-quick-search.test.tsx`
  - `src/web/help/help-modes.tsx`
  - `docs/project/search.md`
  - `docs/plans/261004g-quick-search-box-clear-cross.md` (the plan; read it first)
- Start there; it does not limit where you look. Useful neighbours: `src/web/search-draft.ts`,
  `src/web/quick-session.ts`, `src/web/modes/search/SearchMode.tsx` (the band's typing session),
  `src/web/dock-fit.ts` and `src/web/styles/dock-fit.css` (the fit ladder), `src/web/styles/close.css`
  and `src/web/Library.tsx § SearchBox` (the shelf's clear cross, landed the same day).

## What it is for

The reader asked for a small cross in the bottom bar's quick-search box that wipes it after a
search. The cross is shown only while the box has words, does what Escape already did (one shared
`clear` function), and leaves the cursor in the box. The box deliberately does not wipe itself after
a search.

## What to do

1. An independent pass first. Find what is wrong with it: behaviour a reader can reach, a state the
   tests do not cover, CSS that changes the bar's width or height or steals a neighbour's taps,
   accessibility, the docs and help text being untrue.
2. Run `npx vitest run tests/dock-quick-search.test.tsx` yourself (it needs nothing outside the
   tree). Mutate the code to check the new tests notice, then put it back.
3. **Fix what is inside this stage**, narrowly, red test first where it is behaviour. **Report, do
   not fix**, anything wider.
4. Do not add any sentence attributed to Greg, and do not edit or add any blockquote of his words.
   His only words on this are the ones already quoted in the plan.

## Severity, and IDs

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding a stable ID (`F1`, `F2`, …), its severity, whether it is **established** (direct
evidence) or **reasoned**, and whether you fixed it. End with a verdict: ship / ship after these
fixes / do not ship, and a list of every file you changed.

## My own suspicions (already mine, worth less — spend most of the run elsewhere)

- Whether `preventDefault` on `mousedown` is enough to keep focus on every input path (touch, pen),
  or whether `pointerdown` is needed too.
- Whether `box-sizing: border-box` plus a 20px right padding on the input can change the row's
  measured width at any rung.
- Whether the cross's `::after` finger target, clipped by the bar's `overflow-y: hidden`, overlaps
  anything it should not.
