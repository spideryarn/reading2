# Review: a plan to strip the reading view's sticky top chrome down to one bar

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars`, branch
`worktree-declutter-top-bars`. TypeScript + ESM, React client under `src/web/`, run with `tsx`,
tests with vitest.

## The candidate

**A plan document, not code.** Nothing has been built yet.

Live pre-commit: base `d0bdb31c`; untracked file:
`docs/plans/260905d-declutter-the-reading-view-top-bars.md`. That is the whole candidate.
(Not durable — I will record the resulting commit SHA here once it lands.)

Start with that file. The code it proposes to change, which is where to check its claims:

- `src/web/App.tsx` lines ~2760–2930 — the `.controls` bar it is emptying
- `src/web/TableView.tsx` lines ~700–790 — the `<thead>` it is deleting
- `src/web/scroll.ts` lines ~54–140 — `stickyOffset()`, which the plan says breaks
- `src/web/layout.ts` — `fitView` / `fitMode`, the spine default, `?cols=` fitting
- `src/web/tree.ts` lines ~205–280 — `columnLabel` / `columnPill` / `columnHint`
- `src/web/keynav.ts` — `navPlan`, the ← / → rungs
- `src/web/styles.css` — `.controls` (~line 572), `thead th` (~769), the `--bar-h` / `--bar-bottom`
  / `--head-h` tokens (~line 29), § a narrow window, § a small device
- `src/web/OutlinePanel.tsx` ~line 409 and `src/web/outline.ts` — the other reader of the arc
- `src/web/Dock.tsx`, `src/web/HomeLogo.tsx`, `src/web/FeedbackButton.tsx` — the bottom bar and the
  two fixed corner elements

This is where to begin, not the limit of scope.

## What it is meant to do

The reading view has, at the top: a masthead that scrolls away; a sticky `.controls` bar; and, in
Hierarchy mode only, a second sticky row of table column headers. The product owner has asked for
**one sticky top bar and one bottom bar, with nothing on screen that is not useful**, and named the
specific controls he wants gone.

The plan removes nine controls from `.controls`, removes the table's `<thead>`, removes the arc's
L0 column from Hierarchy while keeping the arc artefact (because Outline mode also renders it), and
finally stops rendering `.controls` at all in the modes where it would then be empty.

Invariants it must not break:

- **A deep link, an arrow-key step and the `?at=` reader must land with the target's top clear of
  whatever chrome is actually on screen.** That number comes from `stickyOffset()`, which measures
  rather than declares — see its own docstring for the two occasions it was wrong before.
- **`?cols=`, `?spine=` and `?text=` keep working as URL parameters** even though nothing writes
  them any more. An old shared link must not break.
- **Outline mode's rung 4 must keep showing the arc sentence**, and `npm run arc` must keep working.
- **`memo(TableView)` must keep holding** — the aim indicator must not put a class on thousands of
  cells.
- The mobile hide-on-scroll behaviour of both bars (`styles.css` § a small device, `stepBar` in
  `scroll.ts`) must be unaffected.

Deliberately out of scope: building the Argument mode, deleting `?cols=`/`?spine=`/`?text=`, moving
the view-only chip or the comment error into the Dock. Another worktree (`structure-mode`, plan
`docs/plans/260903b-one-structure-mode-hierarchy-and-outline-merged.md`) is actively rewriting
`App.tsx`'s controls bar, `layout.ts`, `keynav.ts` and `styles.css`; the plan tries to stay out of
its way, and I would like to know if it fails to.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and you can
build a throwaway harness under `/tmp`. `tests/mobile-chrome.test.ts` and `tests/column-names.test.ts`
are both self-contained and relevant. You have no network, not even loopback, so anything needing
Postgres or a local service will skip.

Full-suite baseline on this worktree at `d0bdb31c`, 2026-09-05: 687 files pass, 4 fail, 1 skipped.
The four are `tests/admin-store.test.ts` (two cases, Postgres contention),
`tests/cold-start-lazy-imports.test.ts` and `tests/pdf-bundle-trace.test.ts` (both "has a build to
inspect"), and `tests/hierarchy-deepen-wave.test.ts`. All pre-existing.

## Attack it

Independently, before you read my questions below.

**The invariant to break: after this plan lands, something on the page is positioned or scrolled
against chrome that is not there — or that is there and was not counted.** The bar is sometimes
absent, the table head is always absent, and the rail's default flips. Find the reader-visible
consequence.

Second angle: **find the thing the plan deletes that something else still needs.** It removes
`arcCells`, the `hasArc` parameter, the `Text` toggle, the `Spine` toggle, `columnPill`, the
`<thead>`, and six CSS classes. Each has readers the plan may not have found.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it
        contradicts — an exact file and line where you can point at one
  - (b) the smallest change that closes it — exact replacement wording for the plan, or a code block
A finding with no (a) goes last.

Severity, graded by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run elsewhere.

1. `stickyOffset()` returning `0` with no `thead th` — I found this and stage 3 addresses it. Is the
   proposed shape (bar alone, head alone, `0` only when neither) actually right, given the clamp's
   ceiling is a *prediction* rather than a measurement and the floor is `safeTop`?
2. Stage 4's `--bar-h` / `--bar-bottom` zeroing. `styles.css` § tokens has a `--bar-hide` that is
   `--bar-h + --safe-top`, and § a small device switches both together. Is there a third token or a
   consumer I have not named?
3. Flipping the spine's default from `showSpine ?? showText` to `showSpine ?? true` changes `?text=0`
   and possibly the `band-covers` crossover, which is `MODE_MIN + PROSE_MIN` against the window
   *minus the rail*. Does turning the rail on by default move that crossover in a way
   `tests/spine-width.test.ts` will catch, or in a way it will not?
4. The aim indicator via a `data-aim` attribute on the `<table>`: `td.text` has an opaque
   `background: var(--page)` and `td.gist.active` / `.continuation` have their own, so a `<col>`
   background would not show. Is a `table[data-aim="N"] td.depth-N { box-shadow: inset … }` rule set
   sound, and does it survive the pinned-column `position: sticky` cells?
5. Whether removing the `Text` toggle while leaving `?text=0` honoured leaves outline-in-Hierarchy
   reachable but undiscoverable in a way that breaks something rather than merely hiding it.

Do not change any file.
