# Code review: the command bar opens quick search, and the Search panel's box gets a clear cross

You are reviewing, and fixing, one committed stage in this worktree. You may write files in this
worktree. Do not commit, do not push, do not run `npm run deploy`, and do not touch anything outside
this worktree.

## The candidate

- Commit `11ae9db7f` on branch `worktree-bar-opens-quick-search` (its parent `53644d3bf` is the plan
  and the plan review). See it with `git show 11ae9db7f`.
- Changed paths, complete: `git show --stat --name-only 11ae9db7f` (23 files):
  - source: `src/web/CommandBar.tsx`, `src/web/command-proposal.ts`, `src/web/command-runners.ts`,
    `src/web/reader/Reader.tsx`, `src/web/reader/mode-press.ts`,
    `src/web/modes/search/SearchMode.tsx`, `src/web/SearchPanel.tsx`, `src/web/search-draft.ts`
    (docblock), `src/web/styles/search.css`, `src/web/styles/close.css` (comment),
    `src/web/help/help-modes.tsx`, `src/web/help/help-topics.tsx`
  - tests: `tests/command-bar-arguments.test.tsx`, `tests/command-bar-pick.test.tsx`,
    `tests/command-runners.test.ts`, `tests/dock-quick-search.test.tsx`, `tests/mode-press.test.ts`,
    `tests/quick-search-panel.test.tsx`
  - docs: `docs/project/search.md`, `docs/project/interface-vision.md`,
    `docs/project/reading-view-overview.md`, `docs/plans/261004g-quick-search-box-clear-cross.md`,
    and the plan
- Read the plan first:
  `docs/plans/261005i-the-command-bar-opens-quick-search-and-the-search-panel-box-gets-a-clear-cross.md`
  (its Review ledger F1–F5 overrides the design text above it), and your own plan review,
  `docs/plans/261005i-plan-review-sol.md`.
- Start there; it does not limit where you look. Neighbours: `src/web/DockQuickSearch.tsx`,
  `src/web/quick-session.ts`, `src/web/Dock.tsx`, `src/web/styles/dock-quick-search.css`.

## What it is for

Part A: a `find` argument in the command bar (a typed verb such as *search for X*, or a model's
`find` answer) now draws *Quick search “X”* first and the old exact-words row second. The new row
runs the bottom bar's quick-search box's own Enter (draft, a sealed `enter` handoff, open Search).
The bottom bar's quick-search icon and box stay exactly as they were. Part B: the Search panel's own
box has a cross that empties it, sharing one `clear()` with Escape.

## What to do

1. An independent pass first. Find what is wrong: behaviour a reader can reach, a state the tests do
   not cover, history and focus, CSS that takes a neighbour's presses or lets text run under the
   cross or spinner, accessibility, docs and help text that are untrue of the code.
2. Run the six test files above yourself (`npx vitest run <files>`; they need nothing outside the
   tree), and `node --import tsx scripts/typecheck.ts`. Mutate the code to check the new tests
   notice (for example: drop `generates: true`; make the handoff switch always `replace`; remove the
   `session?.edit("")` from `clear`), then put each back.
3. **Fix what is inside this stage**, narrowly, red test first where it is behaviour. **Report, do
   not fix**, anything wider.
4. Do not add any sentence attributed to Greg, and do not edit or add any blockquote of his words.
   His only words on this are the ones already quoted in the plan.
5. Record your findings in the plan's Review ledger as F6 onward (F1–F5 are the plan review's).

## Severity, and IDs

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding a stable ID, its severity, whether it is **established** (direct evidence) or
**reasoned**, and whether you fixed it. End with a verdict: ship / ship after these fixes / do not
ship, and a list of every file you changed.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `opening` in `useBarHandoff` is a ref flipped on the first microtask: under StrictMode's replayed
  effects, or when the first pass finds no handoff and one arrives a tick later from the same press,
  can a just-opened Search be read as "already open" and push where it should replace (or the
  reverse)? This also changes the existing Dock box's behaviour with Search open on another matcher.
- `openQuickSearch` in Reader.tsx is `showBand` plus the rail rule, not the Dock's `onMode`: it does
  not set the mode herald. Does it miss anything else that the Dock's quick search does on arrival?
- `quietMount` now reads `store.handoff()?.type === "enter"` with `pointer: coarse`: the Dock box's
  own Enter leaves an `enter` handoff too, but the Dock box is not drawn on a coarse pointer. Any
  other sender?
- The quick row's id is `quick-search:<encoded words>`; could it collide with a row id or break
  `suggestionSignature` / `pickKey`?
- `.srch-clear` under `any-pointer: coarse` is stretched to the field's height; the 14px icon and
  the focus ring at that shape.
