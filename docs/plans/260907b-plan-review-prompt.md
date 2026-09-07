# Review: a plan to make the reading view's top bar hide on scroll at every width, not just on phones

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls`, branch
`worktree-hierarchy-column-controls`, off `dev` at `70040b0b`. TypeScript + ESM, React client under
`src/web/`, hand-written CSS in `src/web/styles/` (one file per area, import order in
`src/web/styles.css` is load-bearing), Vitest under `tests/`.

**This is a review of a PLAN, before any code is written.** Nothing has been built. The candidate is
one new document.

## The candidate

Live pre-commit; base `70040b0b`.

- **untracked, and the whole candidate:**
  `docs/plans/260907b-the-top-bar-leaves-while-you-read-at-every-width.md`
- no tracked file has been modified

(Not durable — I will record the resulting commit SHA in the plan once it lands.)

**Start with the plan itself, then the code it proposes to change:**

- `src/web/scroll.ts` — `SMALL_DEVICE`, `stepBar`, `watchBarVisibility`, `stickyOffset`, `markOurScroll`
- `src/web/styles/narrow-window.css` — § a small device (the `@media (max-height: 620px), (max-width: 731px)` block, roughly lines 360–600)
- `src/web/styles/shell.css` — the `.controls` rule (~line 406)
- `src/web/styles/tokens.css` — `--bar-h`, `--bar-bottom`, `--bar-hide`, `--dock-bottom`, `--safe-top`
- `src/web/useColumnContext.ts` — the whole file; `ColumnRect`, `measure`, `schedule`
- `src/web/ContextPanel.tsx` — how `top` reaches `.ctx-panel`
- `src/web/styles/column-context.css` — `.ctx-panel`
- `src/web/styles/table.css` — the sticky gist / head rules
- `tests/bar-visibility.test.ts`, `tests/spine-width.test.ts`, `tests/mobile-chrome.test.ts`

That is where to begin, not the limit of scope.

## Background you need

Read `docs/project/granularity-zoom.md` (§ the tabular view, § what the bar calls each column, § the
header row kept its element and gave up its height), `docs/project/column-context.md`, and
`docs/plans/260905d-declutter-the-reading-view-top-bars.md` (§ Stage 4, abandoned) and
`docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md`. Those last two are the
immediate history: the top bar was emptied down to three pills on 2026-09-05, and the wordmark and
Feedback button moved out of the top corners into the bottom Dock on 2026-09-06.

## What it is meant to do

Today `.controls` (a 44px sticky top bar) slides out of the way while the reader scrolls forwards
and returns the instant they scroll back — **but only when `(max-height: 620px) or (max-width: 731px)`
matches**. The plan extends that to every width. The bottom bar (`.dock`) deliberately does **not**
join it on a wide screen.

The invariants it must not break:

- A deep link / keyboard jump must land with its target's top clear of the bar, whichever state the
  bar is in (`stickyOffset()` in `scroll.ts`).
- A keyboard reader tabbing along the granularity pills must never have the bar slide out from under
  them mid-tab.
- The fisheye `.ctx-panel`s (fixed overlays covering each gist column, whose `top` is measured from
  `thead th[data-col]`) must not be left stranded out of alignment with the bar.
- Chrome must never answer to a scroll *we* started (`markOurScroll` / `quietUntil`).

Deliberately out of scope: changing the pills, deleting the bar (that is 260905g stage 3), moving
the Dock.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/bar-visibility.test.ts`) and a script (`node --import tsx <script>`), and you
can build a throwaway harness under `/tmp`. You have no network, not even loopback, so anything
needing Postgres, a dev server or a browser will not run. There is no browser here at all, so any
claim about rendered geometry has to come from reading the CSS.

**Evidence I gathered in a real browser on this box, 2026-09-07** (Playwright, system Chrome, dev
server from this worktree, article `antikythera-mechanism-spya-zhxrzm` in Hierarchy, signed in):

| viewport | `.controls` height | scrollWidth/clientWidth | `.controls` children | `thead th` count / height | `.ctx-panel` count |
|---|---|---|---|---|---|
| 1440×900 | 44px | 1428 / 1428 | Parts, Sections, Paragraphs | 3 / all 0px | 2 (230px wide, `data-ctx-lines="0"`) |
| 1280×800 | 44px | 1268 / 1268 | same 3 | 3 / 0px | 2 |
| 900×800  | 44px | 888 / 888   | same 3 | 2 / 0px | **1** |
| 390×844  | 44px | 378 / 378   | same 3 | 1 / 0px | **0** |
| Plain 1440×900 | 44px | 1428 / 1428 | **none** | 1 / 0px | 0 |

`--bar-h` is `2.75rem` (44px) at every width. `--bar-bottom` resolves to `calc(2.75rem + 0px)`
everywhere except the hidden state at 390px, where it is `0px`. `.dock` is present at every width
(40px, 52px at 390). `dataset.bars` is `null` before scrolling at 390 and `"hidden"` after.

## Attack it

Independently, and before you read my suspicions at the bottom.

The invariant I most want broken: **that moving the hidden-state rules and their two `:has()` guards
out of `@media (max-height: 620px), (max-width: 731px)` in `narrow-window.css` and into `shell.css`
preserves their behaviour.** `narrow-window.css` is imported *near the end* of `src/web/styles.css`
and `shell.css` is imported *second*, and the file's own header says nearly every rule in it wins by
being later rather than by specificity. The guards are claimed to win on specificity `(0,3,0)` vs
`(0,2,0)`; check that claim against the actual selectors, and check whether anything *else* in the
later file would now beat the moved rules.

Second target: **the plan's stage 1 claim** that snapping the invisible zero-height `<th>` (removing
it from the `transition: top` list) plus adding a `MutationObserver` on `data-bars` to
`useColumnContext` is sufficient to stop a `.ctx-panel` being stranded. Trace the actual sequence:
scroll event → `watchBarVisibility`'s rAF `apply()` → attribute write → style recalc → `measure()`'s
`getBoundingClientRect()`. Is there a case where the panel still ends up out of step, or where it now
double-moves (measured `top` jumping *and* a CSS `transition: top` animating the same element)?

Third: **what else reads `--bar-bottom`, `--bar-hide` or the bar's rect** that has only ever been
exercised on a phone and would now be exercised on a laptop. Grep for both tokens and for
`data-bars`. In particular check `stickyOffset`, `.mode-band`, `.spine`,
`.reader:has(table.zoom.overflowing)::after`, `.install-hint`, and anything in
`useColumnContext.ts` / `ContextPanel.tsx` that assumes a stable `top`.

For each finding give:
- an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) what shows it fails its own claim — for a plan, the concrete scenario it does not handle, or
  the authoritative contract in the repo it contradicts (cite file and line)
- (b) the smallest change that closes it — exact replacement wording for the plan, or a code block

A finding with no (a) goes last.

Severity, graded by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by file: a defect in the plan's prose that will cause a P1 to ship is not
a P3 because it is made of words.

**Refuse only on an established P0 or P1**, and name what established it. Established means direct
evidence with no unresolved material inference — an exact reachable source path, or an authoritative
contract the plan directly contradicts. If a load-bearing premise is still inferred, it is
*reasoned*: it ranks and informs but does not block.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run elsewhere.

1. `tests/spine-width.test.ts` asserts `SMALL_DEVICE` in `scroll.ts` is byte-identical to the CSS
   query. The plan deletes the constant from `scroll.ts`. I think the right move is to keep the half
   of that test that ties the CSS number to `GIST_MIN + PROSE_MIN + SPINE_W − 1` and drop the
   pairing — but that removes a guard, and I may be removing the wrong half.
2. Decision 3 keeps `.mode-band` in the "bar stays" guard at every width, so the bar hides in Plain
   and Hierarchy and stands still in the twelve band modes. I think that is coherent. It might just
   be inconsistent in a way a reader will notice.
3. Thresholds unchanged (`BAR_HIDE_AFTER = 24`, `BAR_KEEP_UNTIL = 160`). 24px of travel is a much
   smaller fraction of a 900px viewport than of a 390px one; a laptop reader may find the bar too
   twitchy. I have chosen "simplest first" and to change the number only after somebody reads on one.
4. `performance.md` argues against installing a scroll listener on every machine, and this plan does
   exactly that. `useColumnContext` already installs one on every machine, so I believe the marginal
   cost is a rAF-coalesced `stepBar` call — three numbers, no DOM read. Check whether
   `performance.md` says something stronger that this contradicts.
5. The plan asserts there are no `.ctx-panel`s at 390px and therefore stage 1 changes nothing
   observable on a phone. That is measured (table above), but it is measured on **one** article at
   **one** width, and I have not checked what governs it.
