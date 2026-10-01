# Code review (and fix): 261001d Annotations mode, stage 1

Repo worktree: /home/greg/code/spideryarn2/.claude/worktrees/fb7e-annotations-mode, branch
worktree-fb7e-annotations-mode. Review the diff `git diff 1a60d690..07ef6ce6` (three commits: the plan c2a06ff5,
the build a6631c60, the design pass 07ef6ce6). 1a60d690 is the origin/dev it branched from.

Read first: CLAUDE.md (house rules), the plan docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md
(including the sections recording your own plan review and GPT Astra's design pass), docs/project/mode.md.

## You may fix

The house workflow: you are a reviewer-fixer. Fix what is inside this stage, narrowly and red-first (write or
point to a test that fails before your fix), and REPORT — do not fix — anything wider you notice. Do not commit;
leave your changes in the working tree for me to read and commit. Do not run git commands that discard work
(checkout --, restore, stash, reset, clean). Do not touch the database or .env files. You have no network: tests
that need Postgres are mine to run — the jsdom/unit tests below need nothing outside the tree:

  npx vitest run tests/annotations-notes.test.ts tests/layout-margin.test.ts tests/a-broken-mode-leaves-the-article-readable.test.tsx tests/every-mode-draws-its-surface.test.tsx tests/public-network-trace.test.tsx tests/dock-experimental-modes.test.tsx tests/visitor-gaps.test.ts tests/last-view.test.ts

and `npm run typecheck` (judge it by exit code).

## Evidence you have

- All of the above test files pass at 07ef6ce6 (230 tests in the last 6). Mutations I ran: removing NoteBoundary's
  catch, making OwnerIdeasFeed never deliver ideas, setting margReserve = margW, and setting PARAGRAPH_MIN_WORDS = 0
  each turned a named test red.
- A Playwright pass on a real local article measured: table x unchanged vs Plain at 1600; 0 overlapping notes at
  1600/1100/800; no horizontal scroll; head top = 0 with the dock at the bottom; selection across annotated rows
  carries no note text; idea and arc cards do not overlap `.prose`. Screenshots in logs/fb7e/shots/ (v2-*.png).

## Look especially at

1. `useMarginLayout` (src/web/annotations/AnnotationsColumn.tsx): it queries `table.zoom` globally and collects notes
   once per effect run — is it stale when TableView re-renders a note's content without the `key` (marginNotes map)
   changing? Is `key` the right trigger? ResizeObserver loop risk? requestAnimationFrame cleanup? StrictMode?
2. `OwnerIdeasFeed`: the two effects calling `onIdeas` (setState in Reader) — any loop, any stale ideas surviving a
   slug change, any request on the visitor path?
3. Reader.tsx: `bandOpen` now false for annotations — anything that keyed on `mode !== "plain"` meaning "a band is
   open" that is now wrong (ModeHerald, BandBackChip, band-covers, reading-time counting, flash.ts, Dock press
   herald)? The layoutKey change: any consumer that splits it?
4. layout.ts `fitMargin` and `margLeft`: correctness with safe-area insets (`--safe-left`, `horizontalInset`), and
   `.reader` min-width + padding-right; and the CSS `.reader { padding-right }` in marginalia.css overriding
   shell.css — is it inert in every other mode, including when `--marg-reserve` is unset?
5. marginalia.css: `.marg-head` fixed at `--bar-bottom` — on a phone/when the bar hides, is that right? z-index vs
   the dock, tooltips, dialogs. `all: unset` on buttons — focus ring still visible?
6. The mode-catalog `how` card text: true against the code? (mode.md § The card on the button.)
7. Anything in the mode.md checklist missed (e.g. tests/mode-surface-changes-no-markup, shared-inventory,
   command-bar GENERATES, the Dock's mode page, docs).

Severity: P0 ships broken/unsafe, P1 must fix before landing, P2 should fix, P3 nit. ID every finding (C1, C2…),
say whether you fixed it (and which test proves it) or only report it. Write the findings first, then a final line
"VERDICT: land | land after fixes | do not land".
