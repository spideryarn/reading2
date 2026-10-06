# A sideways-scrolling box can be reached from the keyboard (qi-t2ee3kyx)

Up: [plans.md](../project/plans.md). Queue item qi-t2ee3kyx, from GPT Sol's F2 in the 2026-10-06
small tidies. One stage.

## The defect

A wide table here scrolls sideways inside its own box rather than pushing the page
([`SidewaysScrollBox`](../../src/web/lib/SidewaysScrollBox.tsx), and the plain copy of the same box
in [`DataTable`](../../src/web/lib/DataTable.tsx)). None of those boxes can take keyboard focus. In
a browser that does not make a scroller focusable by itself (Safari; Chrome before 130), somebody
without a pointer cannot bring the hidden columns into view: the arrow keys scroll whatever has
focus, and the box never has it. This is axe's `scrollable-region-focusable`, WCAG 2.1.1.

The boxes, found with
`git grep -n -E "overflow-x-auto|overflowX" -- src/web ':!*.css'` at `a680cc53b`:

| Where | Box | Reader sees it? |
|---|---|---|
| `SidewaysScrollBox` (four tables on `/admin/costs`) | measured, with the shade | admin |
| `DataTable` without `sidewaysCue` (the shelf table, `/admin/users`) | bare `SCROLL_BOX` div | **yes, the shelf** |
| `AdminVouchersPage.tsx` | a hand-written copy of `SCROLL_BOX` | admin |
| `cost-charts.tsx` § the per-day chart | `style={{ overflowX: "auto" }}` | admin |

## The fix

*(As first written. The plan review changed three things — see § GPT Sol's plan review below.)*

`SidewaysScrollBox` already measures whether its content overflows. So it becomes the one box:

- **While content overflows, the scrolling element gets `tabIndex={0}`, `role="region"` and an
  `aria-label`.** When it fits, none of the three: a tab stop that scrolls nothing is a wasted
  stop, and a `region` for every small table is landmark noise. (Adrian Roselli's "Under-Engineered
  Responsive Tables" pattern, made conditional.)
- **`label` is a new required prop**, so a box cannot be made focusable without a name. For a table
  it is the caption's words.
- **`cue` is a new prop, default `true`.** `cue={false}` draws the single scrolling `div` with no
  wrapper and no shades, exactly the DOM `DataTable` draws today, plus the measuring and the three
  attributes. `DataTable`'s plain path and the vouchers table use it, so nothing visible changes on
  the shelf or `/admin/users` and the shade stays something `/admin/costs` asked for.
- **`overflowing` is its own measurement**, `scrollWidth - clientWidth > NEAR`, not
  `more.left || more.right` — those agree today, but one is "is there anything to scroll" and the
  other is "which way", and the first should not depend on the scroll position.
- **The chart** uses the same hook on its own `div` (exported as `useSidewaysScroll`, returning the
  ref, the sides, and the props to spread), because it has no border and is also rendered to a
  static report by a script, where the effect never runs and the attributes are simply absent.
- **The focus ring is the browser's own.** Preflight is not imported and nothing zeroes `outline`
  on these boxes, so `:focus-visible` draws the default ring. The browser check confirms it is
  visible in both themes; if it is not, one `tw:focus-visible:outline-*` on `SCROLL_BOX`.

### Passed over

- **`tabIndex={0}` always**, no measuring. Simpler, but every table on a wide screen becomes a tab
  stop that does nothing, on the shelf, for every reader.
- **Leaving `DataTable`'s plain path alone because its header has sort buttons** (axe passes a
  scroller with focusable children). Focusing a header button does not let the arrow keys scroll
  the box in Safari, which is the actual complaint.

## Not in this plan

- **Article prose**: `.prose pre`, `.prose table`, `.prose math.tml-display`
  (`src/web/styles/prose.css`) scroll sideways too and are not focusable. They are the author's
  HTML, not React elements, so this needs a DOM pass after render; and in the reading view the left
  and right arrow keys are the app's own ([keyboard.md](../project/keyboard.md)), so focus alone
  would not scroll them. A product question, reported back rather than built.
- **Rows of buttons that scroll** (the dock, the mode band, Sketch's scenes): each child is
  focusable and focus scrolls it into view.

## Tests (red first)

In `tests/sideways-scroll-box.test.tsx`, which already fakes the geometry:

1. overflowing ⇒ the scroll box has `tabindex="0"`, `role="region"`, and the label;
2. fits ⇒ none of the three;
3. content grows with no scroll ⇒ it becomes focusable; shrinks ⇒ it stops;
4. scrolled to the far end ⇒ still focusable (the measurement that must not follow `more`);
5. `DataTable` with no `sidewaysCue`, overflowing ⇒ its one box is focusable, named by the caption,
   and there is still no wrapper and no shade;
6. the chart's box, overflowing ⇒ focusable and named.

Then mutate: drop `tabIndex`, and swap `overflowing` for `more.right`; the suite must notice both.

## Done

Tests above green, `npm test` and `npm run typecheck` green, GPT Sol's code review read and its
fixes checked, a browser check at desktop, iPad and phone widths (Tab reaches an overflowing table
on the shelf and `/admin/costs`, a ring shows, arrow keys scroll it, a table that fits is skipped),
[admin-costs.md](../project/admin-costs.md) and
[web-client.md](../project/web-client.md) say it.

## GPT Sol's plan review, and what changed

[The review](261006h-focusable-sideways-scroll-boxes-plan-review-sol.md) refused, on two P1s.

- **F1, accepted in part: the inventory was incomplete.** The search above left out CSS rules and
  `overflow-auto`. Sol named three more React-drawn scrollers with no focusable child: chat code
  blocks (`Cited.tsx` § `fmt-pre`), the diagnostics `<pre>` in `AdminFeedbackList.tsx`, and the
  colour scales on `/design`. A wider grep finds 43 `overflow: auto|scroll` rules in
  `src/web/styles`, several inside the reading view (the lightbox, Sketch, Illustrated, chat). So
  **the plan's claim is narrowed, not the code widened**: this plan covers *tables and the costs
  chart*, the seams the queue item names. The rest is listed under "Not in this plan" and reported
  back. Reason: the reading-view ones share the prose problem (the arrow keys are the app's there),
  and the two admin/dev ones are low value next to a test harness each; `useScrollBox` is now the
  one-line way to do any of them.
- **F2, accepted.** `> NEAR` would have left a box one pixel too narrow unfocusable. Eligibility is
  `scrollWidth > clientWidth` with no tolerance (`More.any`); `NEAR` stays for the shades only. A
  test holds the 361/360 case.
- **F3, accepted.** The chart and the vouchers table each have an overflowing *and* a fitting test
  on the real page. Safari is named in the browser brief.
- **The static cost report** has no JavaScript, so its chart box gets no attributes. Stated here
  rather than fixed: the report is a file an admin opens, and it scrolls with a pointer as before.

Also changed from the plan above: the chart cannot call the hook itself (`cost-charts.tsx` is
hook-free by contract, for the static renderer), so `StackedDayChart` takes the props as `box` and
`AdminCostsPage` § `OverTime` calls `useScrollBox`.

### Still not done (reported to the Overseer)

- Article prose: `.prose pre`, `.prose table`, `.prose math.tml-display`; `.note-preview pre`.
- Chat code blocks: `.chat-turn.model .fmt-pre`.
- `/admin/feedback` diagnostics `<pre>`; `/design` colour scales.
- Two-axis scrollers in the reading view (lightbox, Sketch, Illustrated, live-chat tools).

## What landed

- `src/web/lib/SidewaysScrollBox.tsx`: `useScrollBox(label)` (was the private `useMoreSideways`)
  returns the props to spread on the scrolling element — the ref, plus `tabIndex={0}`,
  `role="region"` and `aria-label` while it overflows. `SidewaysScrollBox` takes a required `label`
  and a `cue` (default on); `cue={false}` is the single box with no wrapper. `SCROLL_BOX` is no
  longer exported.
- `DataTable` always draws `SidewaysScrollBox`, named by its caption; `sidewaysCue` only chooses
  the shade. So the shelf and `/admin/users` are covered.
- `AdminVouchersPage` uses the shared box instead of its hand-written copy.
- `StackedDayChart` takes `box`; `OverTime` supplies it.
- **GPT Sol's code review**
  ([answer](261006h-focusable-sideways-scroll-boxes-code-review-sol.md)) accepted commit
  `3f8446a87`, with one prose finding (F4, the test count below).
- **Browser check, 2026-10-06** (Sonnet subagent; system Chrome through Playwright at 1440, 820 and
  390, light and dark; Playwright WebKit at 390, light). On the shelf, `/admin/users`,
  `/admin/costs` (ranking, pivot, per-day chart) and `/admin/vouchers`, every box had the three
  attributes exactly when `scrollWidth > clientWidth`; Tab reached each overflowing box and skipped
  each fitting one; the arrow keys moved `scrollLeft`; the browser's own focus ring was visible and
  unclipped in both themes and in WebKit, so no ring of ours was added; no page scrolled sideways;
  the shelf's search box and sort headers behaved as before. The shelf table fits at 1440 and
  overflows at 820 and 390. Not checked: real iOS Safari, and WebKit in the dark theme.
- Tests: twelve new. Nine were seen red first; the other three are the "fits, so not a tab stop"
  cases, which pass without the fix and are held by the mutations instead. Mutations: `any = right` failed two tests; dropping
  `tabIndex` failed eight.
