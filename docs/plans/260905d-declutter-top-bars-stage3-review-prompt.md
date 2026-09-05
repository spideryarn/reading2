# Review: stage 3 of the reading-view declutter — the header row loses its height, not its element

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars`, branch
`worktree-declutter-top-bars`. TypeScript + ESM, React client under `src/web/`, run with `tsx`,
tests with vitest.

## The candidate

Uncommitted working tree over `f47d25e1`. The scoped diff of `src/` and `tests/` is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/c526273e-b109-4254-9ce7-3b6bd0d1a21d/scratchpad/s3-code.diff`
(1,536 lines) with the new test file appended in full. Read the tree itself for anything the diff
crops. Doc changes under `docs/` are excluded from that file and are **in scope only where they
state a behavioural fact** — I care about a doc that now lies, not about prose taste.

You reviewed the *plan* for this work earlier today and refused it, with six established P1s. Your
findings F1, F3, F5, F8 and F9 all bear directly on this stage and I accepted all of them; F1 is why
the head is collapsed rather than deleted. Your own earlier review is
`docs/plans/260905d-declutter-top-bars-plan-review-sol.md`, and the plan as rewritten is
`docs/plans/260905d-declutter-the-reading-view-top-bars.md` § Stage 3. **Check whether the
implementation actually honours what you asked for**, not merely whether it says it does.

Files, in rough order of how much of the risk they carry:

- `src/web/styles.css` — `--head-h` → `0px`, § the head with no row, § the aimed column, and the
  deletion of § the header over the article's column
- `src/web/TableView.tsx` — the zero-height `<thead>`, `.sr-only` labels, `navDepth` prop removed
- `src/web/scroll.ts` — `stickyOffset()` now measures `.controls` alone
- `src/web/router.ts` — `liftStrandedText`, the fifth boot-time address rewrite
- `src/read-address.ts` — `hidesProse` / `isTextOffPair`, and `readMode`'s new branch
- `src/web/last-view.ts` — `text` moved from `REMEMBERED` to `NEVER_REMEMBERED`
- `src/web/App.tsx` — `data-aim` on `.reader`, pills renamed via `columnLabel`
- `src/web/tree.ts` — `columnPill` deleted
- `tests/aimed-column.test.ts` (new), `tests/mobile-chrome.test.ts`, `tests/address-settling.test.ts`

## What it is meant to do

Greg asked for the reading view's top chrome to collapse to **one top bar and one bottom bar**, with
nothing on screen that is not useful. He named the row of `PARTS L1 / SECTIONS L2` column headers
specifically: *"I'm even wondering if we can get rid of the row of column-header-labels in Hierarchy
mode … to save on vertical space."*

The row therefore gives up its height and keeps its element, because three other things read it:
`useColumnContext.ts` takes every fisheye panel's rectangle from `thead th[data-col]`,
`<th scope="col">` is what names a column to a screen reader, and `--head-h` is a term in
`td.gist .sticky`'s `top`. Deleting it would have emptied Hierarchy's Parts and Sections columns —
your F1.

Four things follow, and each is a place this could be wrong:

1. `stickyOffset()` drops its `thead` term (now always zero) and floors at `safeAreaInsets().top`.
2. The ← / → aim indicator loses its `<th>` underline and becomes a tint on the aimed column,
   driven by one `data-aim` attribute on `.reader`.
3. The controls-bar pills take the columns' full names, `columnPill` being deleted.
4. `?mode=hierarchy&text=0` — a state with no exit since the `Text` pill went in stage 1 — is
   rewritten at boot to `?mode=outline`, with the `text` pair dropped in every mode.

Invariants it must not break:

- **A deep link, an arrow-key step and the `?at=` reader land with the target's top clear of
  whatever chrome is actually on screen.** `stickyOffset()` measures rather than declares; three
  previous bugs in it are recorded in its own docstring.
- **The fisheye panels keep their geometry and their contents.** Verified in a browser before this
  stage: 9 Parts entries and 49 Sections entries on `fowler-phrenology`, re-centring on scroll.
- **`memo(TableView)` keeps holding.** The aim must not put a class on thousands of cells.
- **`?cols=`, `?spine=` and `?text=` keep working as URL parameters.** An old shared link must not
  break.
- **The client and the server must agree what mode an address settles on**, or a shared article's
  tab title says one mode and then another — `docs/project/page-titles.md`, and
  `tests/address-settling.test.ts`.
- The mobile hide-on-scroll behaviour of both bars is unaffected.

Out of scope: stage 4 (not rendering `.controls` when empty) and stage 5 (bands that name
themselves). Another worktree, `structure-mode`, is concurrently rewriting `App.tsx`, `layout.ts`,
`keynav.ts` and `styles.css`; I merged `dev` before this stage and will merge again after.

## What you can and cannot run

The tree is read-only to you; `/tmp` and the node_modules caches are writable. You can run
individual test files (`npx vitest run tests/<one>.test.ts`) and scripts
(`node --import tsx <script>`), and build a throwaway harness under `/tmp`. **No network, not even
loopback**, so anything needing Postgres or a dev server will skip — and note you therefore cannot
render the page, which matters here: half of this change is CSS whose failure mode is *renders
perfectly, shows nothing*.

Full suite is running as I write this; I will note the result in my dispositions. Stage 2's suites
were green: 12 files, 207 assertions.

## Attack it

Independently, before you read my questions below.

**The invariant to break: something on the page is now positioned, measured or tinted against
chrome that is not there — or that is there and was not counted.** The head is always zero-height,
the bar's height is the whole of `stickyOffset` and a `.reader::before` is the floor.

**Second angle: the CSS fails silently by construction.** A selector that matches nothing, a
`background-image` that loses to an opaque background, a `calc()` invalidated by a unitless zero —
each renders a perfectly good page that simply stops telling the reader something. `--head-h` is
`0px` for exactly this reason; find the ones that were missed. The aim matrix is bounded at depth 7
and names two surfaces per rung.

**Third: the address rewrite.** `liftStrandedText` is the fifth rewrite in `settleAddress`, a
function that exists because an interaction between two of the other four sent a reader to the wrong
page. It edits the query as text, rewrites only the first `mode` pair, and its decision is mirrored
server-side in `readMode`. Attack the ordering, the encoding, and the client/server agreement.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the code does not handle, or the authoritative contract it
        contradicts — an exact file and line where you can point at one
  - (b) the smallest change that closes it — a code block, not a direction
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

1. **`overflow: hidden` and `height: 0` on a `<th>`.** A table cell treats `height` as a minimum.
   The claim is that the row collapses because the `.sr-only` span is out of flow and there is no
   padding left. Is that actually true in a real engine for a *table-header-group*, or does the row
   keep a line box from somewhere — `line-height` inherited, the `<tr>`, the anonymous table box?
   If it is even 2px, `useColumnContext`'s `r.bottom` is 2px off on every panel and nothing says so.
2. **The aim matrix's `:is()` and the pinned columns.** `td.pin-left` and `td.pin-right` set
   `position: sticky` and their own `box-shadow`; `.ctx-panel` is `position: fixed` with an opaque
   background. Does `background-image: linear-gradient(…)` actually composite over each of those, or
   does something paint after it? And is `.ctx-panel.depth-N` still the right hook now that stage 2
   deleted `.ctx-panel.depth-0`'s tint rule?
3. **`readMode` returning `outline` for `?mode=hierarchy&text=0`.** It is used by
   `src/public/page.ts` to compose a shared page's `<title>` and meta. Is there any consumer for
   which that new answer is *wrong* — a canonical URL, an og:url, a cache key, a redirect?
4. **`text` moving to `NEVER_REMEMBERED`.** `last-view.ts` restores from a React effect, after
   `settleAddress`. Is there a path where the restore writes the address rather than reads it, and
   so re-creates `?text=0` in the URL after the rewrite has already run?
5. **The unbounded aim ladder.** `buildGeometry` produces three or five levels today; the matrix
   stops at 7. Is there any article shape that can exceed it, and is "the tint does not draw" really
   the failure, or does something else key off `data-aim` and get confused by a value with no rule?

Do not change any file.
