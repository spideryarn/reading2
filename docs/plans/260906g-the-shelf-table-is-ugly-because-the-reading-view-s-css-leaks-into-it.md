# The shelf table is ugly because the reading view's CSS leaks into it

Greg, 2026-09-06:

> The table view in the logged-in Homepage is pretty ugly. View browser screenshots, then make it
> more aesthetically pleasing, ideally in a reusable way that improves any other tables. Perhaps use
> Sonnet for web research for libraries. Also improve the UI/UX of the toggle above that toggles
> between cards and table (e.g. a rich tooltip, perhaps icons instead of toggle, etc. Oh, and the
> table should by default only show the top 50? or so Articles, with a button at the bottom to show
> all. Eventually we might consider paging, but probably that's overkill for now

**The table is not ugly. It is broken, and the breakage is not in the table.**

Two element selectors in [`styles.css`](../../src/web/styles.css), written for the reading view's
zoom table, have no class on them and therefore match **every `<table>` in the app**:

```css
thead th {
  position: sticky;
  top: var(--bar-bottom);       /* ≈44px on the shelf */
  z-index: 25;
  height: var(--head-h);        /* 0px */
  padding: 0;
  overflow: hidden;
}

td {
  vertical-align: top;
  border-bottom: 1px solid var(--rule);
  border-right: 1px solid var(--rule-strong);   /* ← the column grid */
}
```

On the homepage that produces exactly what the screenshot shows: the header row collapses to an
empty strip, and its labels — *Article*, *Added*, *Last opened ↓* — detach and float ~44px down the
page, **overprinting the first article's title**. The `td` rule draws a vertical column grid that
[`lib/DataTable.tsx`](../../src/web/lib/DataTable.tsx) never asked for and does not want.

**It has been worked around three times and fixed none.** `.design-table td` writes `border-right: 0`
with a comment that names the leak outright — *"The bare `td` rule far above gives EVERY cell in the
app a right border … it reaches here, and reaches into an article's own `<table>` inside `.prose` as
well"* — and `.prose th, .prose td` restate `border` in full for the same reason. Each author found
the leak, patched their own table, and left it running.

So the first stage is not cosmetic, and it is worth more than the rest of the plan put together:
**scope the two rules to `table.zoom`**. Everything after it is the actual request.

## What the research said, and the one place we are not taking its advice

A Sonnet web-research pass ([third-party-library-selection.md](../reusable/third-party-library-selection.md))
came back with a clear answer to *"is there a library worth adding?"*: **no.**

- **AG Grid, MUI X DataGrid, Mantine DataTable** all ship their own styling system — a second design
  system to fight Tailwind v4 — for features this shelf does not want (virtualisation, pivoting,
  Excel export, enterprise filtering). Rejected.
- **shadcn's "data-table" recipe** is not a component; it is a walkthrough, and most of its code is
  row-selection checkboxes, column-visibility dropdowns and faceted filters. Rejected: importing
  feature machinery for a 50-row shelf is exactly the premature complexity
  [vision.md § Simpler first](../project/vision.md#simpler-first) warns about.
- **TanStack Table v8**, already here, already headless. Keep. If row counts ever reach the
  hundreds, the honest escalation is **TanStack Virtual** — same vendor, same philosophy — and only
  once something shows it is needed. Its own docs put the threshold well above where we are.

The research's one concrete *add* was to copy shadcn's `Table` primitive file in as the shared
wrapper. **We are declining that**, and the reason is the same rule that made the rest of its advice
right: `lib/DataTable.tsx` **already is** that shared wrapper. Putting eight thin shadcn wrappers
underneath our own wrapper is a second way to do the same thing, which
[AGENTS.md § Prefer simple over easy](../../AGENTS.md) forbids. We take shadcn's *class strings* as a
reference — `h-10 px-2 text-left align-middle font-medium`, `hover:bg-muted/50` — and skip the file.

Everything else the research produced is design guidance, and it is used below.

## Stage 1 — Stop the reading view's CSS leaking into every other table

Scope both rules to the reading view's own table, which is what they were always about.

**The scope is a child combinator, not a descendant one, and it must add no specificity.** Two
separate traps, and the plan walked into the second one before GPT Sol's review pulled it out.

*First*, the obvious spelling — `table.zoom td` — does **not** work, because an article's own
`<table>` is rendered inside `td.text`, which is inside `table.zoom`. A descendant selector would go
on reaching every `.prose` cell exactly as the bare one does, and the reading-view half of the bug
would survive a change that looked like it fixed everything.

*Second*, and worse, the direct-child spelling **breaks the reading view's own cascade**.
`table.zoom > thead > tr > th` has specificity (0,1,4), which beats `thead th.pin-left` at (0,1,2) —
so the base `z-index: 25` would start overriding the pinned header's `z-index: 35`
([`styles.css:1010`](../../src/web/styles.css)), and `table.zoom > tbody > tr > td` would override
`border-right: none` on `td.pin-right` ([`styles.css:996`](../../src/web/styles.css)). The pinned
end columns would break, in the one view this whole rule exists for.

`:where()` contributes **zero** specificity, so it buys the scope and changes nothing else:

```css
:where(table.zoom > thead) > tr > th { … }   /* (0,0,2), exactly as `thead th` was */
:where(table.zoom > tbody > tr) > td { … }   /* (0,0,1), exactly as `td` was */
```

Safe against the real markup: [`TableView.tsx:1155`](../../src/web/TableView.tsx) always sets
`className="zoom …"`, and the `<thead>`, `<tr>` and `<tbody>` are all written explicitly rather than
left to the parser. `useColumnContext.ts` measures those same `data-col` headers. The head's doc
comment is entirely about `--head-h`, `--bar-bottom`, `useColumnContext.ts` and `td.gist .sticky` —
every one of those is the reading view, and none of it is a claim about tables in general.

**And there are four violations, not two.** `thead th` appears in two more selector lists — the
small-screen transition rule ([`styles.css:12851`](../../src/web/styles.css)) and the
reduced-motion rule ([`styles.css:13146`](../../src/web/styles.css)) — both of which currently hand
the shelf's and the article's header cells a `transition: top` written for chrome that slides under
a bar they do not have. Harmless today, the same bug, and they have to go too or the guard below
cannot pass.

Then delete `.design-table td { border-right: 0 }`, whose comment says it exists only to undo the
leak, and rewrite the comment on `.prose th, .prose td` — those borders are still wanted, but they
are no longer *defensive*.

**The third victim is real but latent, and the measurement corrected the guess.** The hypothesis
was that `.prose th` overrides the leaking rule's `padding` but not its `height: 0` or
`overflow: hidden`, so every article with a `<table>` would render its header as a clipped empty
strip. **Measured against the running app, that is wrong in its mechanism and right in its
conclusion.** On a table injected into `.prose`:

| | leaked | neutralised |
|---|---|---|
| `position` / `top` | `sticky` / `44px` | — |
| header cell height | **34.6px**, not 0 | 35px |
| header cell top | **342px** | 299px |
| first body row top | 334px | 334px |

The cell does **not** collapse: `height` on a table cell is a *minimum*, and `.prose th`'s own
`padding: 0.3em 0.7em` pushes it back to full height. What the leak does instead is **detach it and
push it 43px down the page, so the header row renders *below* the first body row it names.** Same
bug, same fix, different symptom from the one guessed.

**But no reader has seen it**, and that is worth stating rather than implying: the selector is
`thead th`, and of the six real prose tables in the corpus (all in *Antikythera mechanism*) **none
has a `<thead>` at all** — every one puts its `<th>` cells directly in `<tbody>`, which the selector
never matches. So this is a latent bug reachable by the first article whose HTML uses a proper
`<thead>`, not a live one. It is fixed by the same one-line change and needs no separate work.

The `td` half does *not* reach prose in practice either: `.prose th, .prose td` restate `border` in
full, and the measured `border-right` is `.prose`'s own `oklch(0.27 0 0)`. The workaround works —
which is exactly why nobody fixed the cause.

The **shelf** bug is the live one, and it gets the postmortem, because the class — *an unscoped
element selector in a 12,800-line stylesheet, worked around three times* — is the point rather than
the incident.

**The guard, narrowed to the bug it is about.** The first draft asserted that *no* rule in
`styles.css` has a selector without a class, id or attribute. Scanning per selector **branch**
rather than per rule — the first scan skipped a whole list if any one branch had a class, which is
how it missed the two transition rules — gives **42 bare branches**, most of them fine (`*`, `body`,
keyframe stops, and the arguments of `:is(h2, h3, …)` which are not branches at all). A test that
fires on forty things acquires an allowlist and then gets deleted.

**Restricted to `table`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`, there are exactly four, and
Stage 1 fixes all four.** So the guard ships with **no allowlist at all**, which is the only version
of it that will still be true in six months:

| Line | Branch | |
|---|---|---|
| 852 | `thead th` | the header displacement |
| 861 | `td` | the column grid |
| 12851 | `thead th` | transition, small screens |
| 13146 | `thead th` | transition, reduced motion |

The rule: *a selector branch naming a table tag must also carry a class, id or attribute.* `td` and
`thead th` fail; `.prose td`, `td.gist` and the `:where(table.zoom …)` forms above all pass. Those
five cases go in the test as calibration, so the next person can see what it is asserting without
running it.

The broader "no unscoped element selector anywhere" policy is **dropped**. It would inherit an
unrelated `h1` cleanup — `h1`, `h1 a`, `h1 a:hover` are written for the article title in the
masthead section and reach the homepage wordmark and every other `<h1>` in the app, which is the
identical mistake one element along. Real, worth fixing, and a different job; noting it here is how
the next person finds it.

[`tests/css-tokens.test.ts`](../../tests/css-tokens.test.ts) is the right neighbour and the wrong
description: it calls itself *"a text scanner, not a rendering engine … a tripwire rather than a
proof"*, and it does not parse CSS. This guard needs to split selector branches, which is more than
that file does today — so it is a sibling tripwire, not an addition to that one.

## Stage 2 — Make the table look good, in `lib/DataTable.tsx`

Reusable by construction: this file is already the only table wrapper, so every change here is a
change to any future table. Nothing in this stage is shelf-specific.

| What | Now | After | Why |
|---|---|---|---|
| Vertical rules | drawn by the leak | none | Hairline row dividers only — the 2025/26 consensus, and GitLab's own 2025 move off striping. **This is most of the win**, and it is Stage 1 doing it |
| Cell padding | `px-2 py-2` (8px) | `px-3 py-2`, first/last cell inset to `px-4` | Research: 8px vertical / 12–16px horizontal for a dense table |
| Zebra striping | none | none | Correct already: stripes fight hover/selected/focus tints once layered |
| Header | indistinguishable from a data row | `font-medium`, `text-muted-foreground`, one stronger rule beneath | "Quiet until interacted with"; weight is reserved for the sorted column, which already goes orange |
| Narrow window | title column crushes to ~30px | `min-w` on the table, so it scrolls instead | `max-w-0` lets the fluid column collapse to nothing while the date columns keep full width — see the 390px screenshot |

**Row height is not changing, and the first draft of this table claimed it would.** It said ~45px →
~38px off the back of a horizontal-padding change, which cannot reduce a height; GPT Sol caught it.
The article cell is deliberately two lines — title, then byline · site · minutes
([`library-columns.tsx`](../../src/web/library-columns.tsx)) — so ~45px is what two lines of 14px and
12px text plus 16px of padding *come to*, and the only way to 38px is to drop the subtitle. The
subtitle is worth more than the seven pixels. Density here comes from deleting the grid, not from
squeezing the rows.

**The scroll-edge shadow is deferred until the 390px screenshot says it is needed.** The four-layer
gradient technique is written down in the research and is the right answer *if* the horizontal
scroll turns out to be undiscoverable once `min-w` makes it real. Ship `min-w`, look, then decide —
rather than building the affordance and the thing it is an affordance for in the same step.

Two things are already right and are being kept, with the reasoning written down so nobody
"simplifies" them:

- **Row actions reveal on `:hover` *and* `:focus-within`, via `opacity`, never `display`.** That is
  WCAG 1.4.13, and `hover-none:opacity-100` covers the touch case. It was got right in August by a
  cross-family review and the research independently named it as the usual bug.
- **Zero is drawn, faintly; a missing value is an em dash.** GDS's position is that a blank cell is
  ambiguous between *zero*, *missing* and *not applicable*. `Count` and the `opened` column already
  do this.

**The dead column on the right resolves itself.** ~145px is reserved for five always-in-the-DOM
action buttons, and it must stay reserved — hiding them would take them out of the tab order. It
reads as a broken empty box today only because the leak draws a grid line down both sides of it.
With the vertical rules gone it reads as margin.

### The sticky header, and why it is not in this plan

A sticky header is the obvious next thing and it does not work here, for a reason worth writing
down rather than discovering twice. The table sits in an `overflow-x-auto` wrapper, and a box with
`overflow-x: auto` and `overflow-y: visible` **computes `overflow-y` to `auto`** — so the wrapper is
a scroll container on both axes, and `position: sticky; top: 0` on a `<th>` sticks to *it* rather
than to the page. The wrapper has no height, so it never scrolls vertically, so the header never
moves. Making it work means giving the table box a `max-height` and scrolling it internally, which
is a different design decision about the whole page. Deferred deliberately, not missed.

## Stage 3 — The first 50 rows, and a button for the rest

**The cap lives in `Library.tsx`, not in `DataTable`** — the first draft had it the other way round
and that was wrong for two reasons, both of which GPT Sol named.

`DataTable` has **two** consumers: the shelf, and `/admin`'s "Everyone with an account"
([`AdminPage.tsx:383`](../../src/web/AdminPage.tsx)). A generic `limit` prop would therefore need a
generic label, and *"Show all 213 articles"* — the whole point of the copy — is not generic. Making
it a prop means adding props to a shared component purely to carry one page's policy. And
`DataTable`'s own doc comment already says why rows are *passed in* rather than read off the table:
the caller may have something to say about the order that is not a sort. The cap is exactly that
kind of caller policy. So:

```tsx
rows={expanded ? sorted : sorted.slice(0, SHELF_ROW_CAP)}
```

sliced **after** both `sinkLast` passes, never before TanStack sorts — otherwise the cap would pick
its 50 rows out of the wrong order.

The `expanded` state lives in `Library` too, and that is the second correction: as component-local
state inside `DataTable` it would silently reset every time the component unmounts, which happens
whenever you switch to cards or a search matches nothing — so "stays pressed for the session" would
have been false in exactly the cases a reader would notice. In `Library` it survives both.

When there are more rows than the cap, one quiet full-width button sits under the last row:

> **Show all 213 articles**

Fused count-in-label rather than a separate *"showing 50 of 213"* caption, which is the shape Notion
uses and the only one of the candidates verified against a real product. It also avoids a second
count on a page that already prints one — `Library.tsx` draws *"12 of 47 articles"* whenever the
search or the Unread chip is narrowing.

50 is a sensible cut and not a novel one: GitHub's API pages at 30, Gmail at 50, Notion offers
10/25/50/100.

**Not pagination, and not infinite scroll.** NN/g's own framing is that infinite scroll suits
"homogeneous items with no particular task or goal" and hurts anything you need to *find or return
to*; a personal library is the second. A reveal-all button keeps the back button, the footer and the
reader's sense of place. Numbered pagination is the other correct answer and is more machinery than
a shelf this size can justify — Greg's *"probably that's overkill for now"*.

**Once pressed it stays pressed.** Re-collapsing when the search box changes is arguably righter and
costs a coupling between the limit and the query; not worth it. "Show all" reads as a display
preference, not as an answer to one particular search. Named here so the next person knows it was a
choice.

**Table only, as asked.** The cards view has the same problem and is left alone; it is the same two
lines at the same call site if Greg wants it.

## Stage 4 — The cards/table toggle

It is already icons, which is what Greg reached for — two 14px glyphs in 24px boxes inside a 28px
track. The problem is that it is *too* quiet to find, and that a native `title` is the weakest
tooltip there is: ~1s delay, unstyleable, and **absent entirely on touch**.

- **Bigger.** A 32px track holding 28px targets — so the *hit target* went 24px → 28px, not
  24 → 32, which is how this line first read and what the code review corrected. The current size is below every shadcn
  default and below Material's 40dp segmented-button spec. The `h-7`/`size-6` arithmetic in
  `chipClass` and `ShelfControls` is deliberate and documented, so this is a re-measure, not a nudge.
- **Labelled, where there is room.** `Cards` / `Table` beside the icon above `sm`, icon-only below.
  Research is clear that icon-only is fine for exactly two well-known glyphs (Linear does this), but
  the row has space at 1280 and a label is free discoverability.
- **A rich tooltip on each**, via the `ControlTip` this app already has — *what it is*, then *what it
  costs you*, which is the shape every other card in the app uses. This is the direct answer to
  Greg's "e.g. a rich tooltip".
- **`role="radiogroup"`, not two `aria-pressed` buttons.** The APG's radio pattern is "a set of
  checkable buttons where no more than one can be checked at a time", and it explicitly endorses
  styling them as toggle buttons. `aria-pressed` models *independent* binary controls and cannot
  express the mutual exclusivity. Tabs is wrong too — the APG defines tabs as switching *content*,
  and these two switch the *painting of one list*, which is the distinction `ShelfControls.tsx`'s own
  header comment already makes.

**Radix's `RadioGroup`, and the first draft was wrong twice over.** It proposed hand-rolling the
radiogroup on the grounds that for two options a roving tabindex is `tabIndex={selected ? 0 : -1}`
plus an arrow-key handler. It is not: it is also `aria-checked` rather than `aria-pressed`, a group
name, arrow keys that move *selection* as well as focus, wrapping at both ends, Home/End,
`preventDefault` so the page does not scroll, RTL, and tests for the focus behaviour and the history
push. That is a component, and one already exists.

It is `RadioGroup`, **not** the `ToggleGroup` the research recommended: a toggle group can be
deselected to an empty value, and "no view at all" is not a state this page has. `RadioGroup` models
the invariant exactly, ships roving focus and arrow-key selection, is unstyled, takes our existing
geometry classes directly, and is already installed as part of `radix-ui` — so this is reuse, not a
new dependency.

**The fallback, if it fights the geometry**: keep the existing fieldset and `aria-pressed` buttons
and change only size, labels and tooltips. That satisfies Greg's request on its own — the semantic
correction is something being fixed *while we are in here*, not the thing being asked for, and it is
not worth breaking a working control over.

## What the review changed

[260906g-shelf-table-review-sol.md](260906g-shelf-table-review-sol.md) is the cross-family review,
and it found five things wrong with the plan above, four of which would have shipped:

1. **The scoped selectors broke the reading view's cascade.** (0,1,4) beating `thead th.pin-left` at
   (0,1,2) would have taken the pinned end columns' `z-index` and `border-right` with it — a fix for
   the shelf that quietly broke the view the rule exists for. `:where()` is the answer.
2. **Two more `thead th` branches** in the transition rules, missed because the first scan skipped a
   selector list whenever any branch in it had a class.
3. **The guard's inventory was wrong** (9 vs 42 bare branches, for the same reason), and
   `css-tokens.test.ts` "parses" nothing — it says so in its own header. Narrowing the guard to
   table tags is what makes it allowlist-free.
4. **Stage 2 promised a row height it had no mechanism to deliver.**
5. **The row cap was at the wrong seam**, and its state would have reset on exactly the transitions
   where a reader would notice.

Two of its judgments were taken as offered — `RadioGroup` over a hand-rolled group, and deferring
the scroll shadow. Its endorsement of the two calls this plan had already argued — no shadcn `Table`
primitives, and the `overflow-y` reasoning behind deferring the sticky header — was checked against
the spec rather than accepted on the strength of agreeing.

## What the second review changed

[260906g-shelf-table-code-review-sol.md](260906g-shelf-table-code-review-sol.md) reviewed the built
code and found no runtime regression — it checked the specificity arithmetic, the child chains
against `TableView.tsx`'s real DOM (including `colgroup`, `rowSpan` and `withheldLeaf`), the design
table, `min-w-56` against `max-w-0`, the row-cap predicates, and the Radix/Floating-UI composition,
and cleared all of them. Three things were wrong anyway, all of them *claims* rather than behaviour:

1. **The guard had false greens.** `:is(td, th)` hid the tag behind a bracket the pattern did not
   treat as a boundary; `td:not(.zoom)` carried a dot and so read as scoped, when a class inside a
   negation *widens* a rule rather than scoping it. Both now caught, both now calibration cases.
2. **Every branch of a selector list got the first branch's line number.** It only looked right
   because `thead th` happened to come first in the lists this bug was in — and the lists in this
   file run to a dozen lines, so the failure mode was pointing a reader at an innocent selector.
   Fixed, and asserted on a multi-line fixture.
3. **"24px → 32px" overstated the toggle.** The track is 32px; the targets inside it are 28px.
   Corrected here, in `ShelfControls.tsx`, and in the postmortem.

One hole is left open deliberately: `:is(table, .zoom) td` reads as scoped and is not. Closing it
needs a real selector parser rather than a pattern match, which is more than this tripwire is worth
— so there is a test asserting the current behaviour, so that the boundary is written down and
anybody who does write the parser gets told.

The review also noted that **the row cap has no automated test**, only the browser check. That is
now `tests/shelf-row-cap.test.ts`.

## What this plan passed over

- **Adding any table library.** Section above.
- **Copying shadcn's `Table` primitives in.** We already have the wrapper they would be.
- **A sticky header.** Stage 2, with the `overflow-y` reason.
- **Pagination and virtualisation.** Stage 3.
- **Restyling the cards.** They are the thing the table should be as good as, not the problem.
- **Widening the page for the table view.** The shelf is `max-w-4xl` (896px), which is tight for
  seven columns and is why the title truncates at 1280. Letting the table view go wider than the
  cards view would help and makes the two views disagree about the page's shape; not while the
  cheaper fixes are untried.

## How we will know

- The header row is a header row: its rect sits above the first body row and does not overlap it, at
  scroll 0 and scrolled. Measured today at 342px vs a body row at 334px — it must end up above.
- No `td` in the shelf table has a right border.
- A `<table>` with a real `<thead>` injected into `.prose` puts its header above its first body row
  (299px, not 342px, in today's measurement). The corpus has no such table, so this check has to be
  constructed — and saying so is the point, since "it looks fine on every article we have" is what
  kept this bug alive.
- At 390px the title column is legible and the table scrolls sideways rather than crushing.
- `npm test`, `npm run typecheck`, `npm run check`.
- Screenshots before and after, at 1280 and 390.

Read against the screenshots, not the description: a table that renders nothing at all still
screenshots perfectly ([silent-success.md](../reusable/silent-success.md)).
