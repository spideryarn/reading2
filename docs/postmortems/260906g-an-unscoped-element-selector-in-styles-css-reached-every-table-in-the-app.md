# An unscoped element selector in styles.css reached every table in the app

**2026-09-06**, on [260906g](../plans/260906g-the-shelf-table-is-ugly-because-the-reading-view-s-css-leaks-into-it.md).
Two bare selectors in [`src/web/styles.css`](../../src/web/styles.css) — `thead th` and `td` — were
written for the reading view's own table (`table.zoom`, [`TableView.tsx`](../../src/web/TableView.tsx))
and, having no class on them, matched every `<table>` in the app instead. **This reached readers**:
the homepage shelf's table view ([`lib/DataTable.tsx`](../../src/web/lib/DataTable.tsx)) shipped on
top of the leak and rendered visibly broken — the header row detached and overprinted the first
article's title — for the eleven days between the shelf table's own launch and Greg noticing. Nobody
lost data; what shipped was ugly and confusing to anyone who opened the table view.

## What happened

`src/web/styles.css` was created in one commit, `4bd4d94c6` *"Fix nested lists being swallowed; add
structural fixture"* (2026-08-24 23:25:59), as the stylesheet for a single-purpose reading-view
prototype. At that moment
`table.zoom` was the only table the app had, so writing its geometry directly onto `thead th` and
`td` was not yet wrong — there was nothing else for those tags to match:

```css
thead th { position: sticky; top: var(--bar-bottom); z-index: 25; height: var(--head-h); padding: 0; overflow: hidden; }
td       { vertical-align: top; border-bottom: 1px solid var(--rule); border-right: 1px solid var(--rule-strong); }
```

One day later, `fa05c379d` *"Set the reading column in the sans they actually shipped"*
(2026-08-25 18:40:22) built the `/design` page and, while adjusting `.prose`, ran straight
into the leak. It fixed nothing at the source; it patched around it twice, in the same commit:

- `.design-table td { border-right: 0 }`, with a comment naming the mechanism outright: *"the bare
  `td` rule far above gives EVERY cell in the app a right border … it reaches here, and reaches into
  an article's own `<table>` inside `.prose` as well."*
- `.prose th, .prose td { border: 1px solid var(--rule); … }`, restating the whole border rather than
  the one property the leak didn't already give it, for the same stated reason.

The very next day, `ddd1d80b` *"Hand the sort to TanStack, and let the shelf be sorted two ways at
once"* (2026-08-26) shipped `lib/DataTable.tsx` — the shelf's own table — with no
defensive override, because nothing about building it gave any reason to suspect the reading view's
stylesheet reached it. It rendered broken from that day.

Measured 2026-09-06, on the shelf: every `<th>` sat `position: sticky` at `top: 44px`
(`--bar-bottom`), which put it **inside the first data row** — th rect 495.3–527.8px against a first
body row of 484.3–536.8px, a 32.5px overlap (the header's whole height), unchanged at scroll 0 and
400. The header labels — *Article*, *Added*, *Last opened ↓* — rendered on top of the first article's
title. The `td` rule drew `border-right: 1px solid oklch(0.36 0 0)` on every cell, a column grid
`DataTable.tsx` never asked for.

**A second, latent victim exists and no reader has hit it.** `.prose table` — an article's own HTML
table — is only half-protected: `.prose th, .prose td` neutralises the border, but not
`position: sticky`, `top`, `z-index`, `height` or `overflow`. Measured on a table constructed to have
a real `<thead>`: the header cell does not collapse (a table cell's `height` is a minimum, and
`.prose th`'s own `padding: 0.3em 0.7em` pushes it back to 34.6px), but it is displaced 43px down the
page and renders **below** the first body row it names (top 342px, against 299px with the leaking
rule neutralised). It stayed latent because the selector is `thead th`, and of the six real prose
tables in the corpus — all in "Antikythera mechanism" — none has a `<thead>`; every one puts `<th>`
directly in `<tbody>`.

Greg reported the live symptom in the plain terms a reader would use: *"The table view in the
logged-in Homepage is pretty ugly"* — not "broken", because from outside it doesn't look like a bug,
it looks like a table nobody designed.

## The class: an unscoped element selector is a global change disguised as a local one

A selector written against a bare tag — `td`, `thead th` — reads, at the point it is written, as a
statement about the one table on screen. It is actually a statement about **every element of that tag
anywhere the stylesheet is loaded**, which in this app is everywhere. The mistake is invisible at
write time whenever it happens to be true that only one table exists yet, and it stays invisible
afterwards because the failure mode is not a crash: it is a second author, working on a second table,
who runs into a rule that already fights them.

**And a workaround that works is why nobody fixes the cause.** Both patches above were correct
diagnoses — one of them said so, in a comment, in writing, naming the exact rule and the exact
mechanism. Both stopped at silencing the symptom in the one place its author could see it. That is
individually the cheaper move every time it happens: writing `border-right: 0` on one selector costs
one line and ships immediately; walking three sections up the file to scope the rule at its source
costs an audit of everything else that rule might be touching. So the cheap fix keeps winning, right
up until a table appears that nobody thought to give the same defensive override — which is exactly
what `DataTable.tsx` was, a day later.

## Why nothing went red

**No test could have caught this before 260906g, because none existed for this shape.** The closest
neighbour, [`tests/css-tokens.test.ts`](../../tests/css-tokens.test.ts), says of itself that it is *"a
text scanner, not a rendering engine"* and *"a tripwire rather than a proof"* — it does not parse
selectors at all, so a bare `td` was never something it could see.

**And a screenshot of the reading view — the obvious check — would not have caught it either.** The
reading view's own `table.zoom` is what the rule was written for; a screenshot of it looks exactly
right, because that table has always had this rule and it was never wrong there. The bug only shows
up in a screenshot of a *different* table, and nobody was taking one, because nobody had reason to
suspect the reading view's stylesheet governed the shelf's.

**Each of the three people who met this bug diagnosed it correctly.** `fa05c379d`'s comment names the
rule and the mechanism precisely. The plan for 260906g independently rediscovered the same mechanism
from Greg's report of "pretty ugly" and traced it to the same two lines. Nobody here failed to
understand the bug when they were looking directly at it — the failure was that understanding it once
produced a local patch rather than a change at the source, twice, and the shelf table shipped in the
gap between those two patches and the third.

## What would have caught it, ranked by ease against value

1. **[`tests/table-selectors-are-scoped.test.ts`](../../tests/table-selectors-are-scoped.test.ts)**,
   shipped with this fix. It splits every selector list in `styles.css` into branches and fails on any
   branch that names `table`, `thead`, `tbody`, `tfoot`, `tr`, `th` or `td` without also carrying a
   class, id or attribute selector. Restricted to those seven tags it needs **no allowlist** — the
   first draft checked every bare selector in the file and fired on 42 branches, almost all of them
   fine (`*`, `body`, keyframe stops); narrowed to table tags there were exactly four, all this bug,
   all fixed together. Verified by reintroducing the bug and watching it report all four with line
   numbers.
2. **A habit that costs nothing: scope a rule to a class from the line it is written, even when the
   tag it names currently matches only one thing.** `thead th` was not wrong to write on the day only
   one table existed; it became wrong the moment a second one did, and nothing about writing it
   `table.zoom > thead th` on day one would have cost anything. This is the cheap countermeasure a
   test cannot enforce — it has to be a habit — but it is also the only one of the three that would
   have stopped the mistake before it existed rather than after.
3. **Rejected: restructuring `styles.css` into per-component stylesheets or CSS Modules**, which makes
   this class of leak structurally impossible by construction. One shared stylesheet is a deliberate
   choice elsewhere in this app ([design-css-overview.md](../project/design-css-overview.md)), and
   swapping the architecture to close one bug class that a five-line guard now closes for free is a
   large solution bought for a problem that no longer needs one.

## The fix that is right for the long term

Scope the two rules — and two more `thead th` branches found the same way, in a small-screen
transition rule and its `prefers-reduced-motion` counterpart — to `table.zoom`, using `:where()`
rather than a plain child combinator:

```css
:where(table.zoom > thead) > tr > th { … }   /* (0,0,2), exactly as bare `thead th` was */
:where(table.zoom > tbody > tr) > td { … }   /* (0,0,1), exactly as bare `td` was */
```

This is not the obvious spelling, and the obvious spelling would have shipped a second, smaller
version of the same bug: **scoping a selector changes its specificity as a side effect, and `:where()`
is the tool that scopes without paying that cost.** `table.zoom > thead > tr > th` reads as the
natural fix and has specificity `(0,1,4)`, which *beats* the existing `thead th.pin-left` at `(0,1,2)`
— so the base `z-index: 25` would start overriding the pinned header's `z-index: 35`, and
`table.zoom > tbody > tr > td` would override `border-right: none` on `td.pin-right`. That breaks the
pinned end columns in the one view these rules exist for, silently, because nothing renders visibly
wrong until a reader scrolls a wide table sideways and the columns that are supposed to stay put
don't. `:where()` contributes zero specificity, so the scoped rules stay exactly as strong as the bare
ones were and the pinned-column overrides keep winning. A descendant selector (`table.zoom td`) is
also wrong, for an unrelated reason: an article's own `<table>` renders inside `td.text`, which is
inside `table.zoom`, so a descendant form goes on reaching every `.prose` cell exactly as the bare one
did.

This is the fix GPT Sol's review ([260906g-shelf-table-review-sol.md](../plans/260906g-shelf-table-review-sol.md))
caught before it shipped, not after: the plan's first draft proposed the higher-specificity form, and
the review is what forced the `:where()` rewrite. The two workarounds this postmortem is about
(`.design-table td { border-right: 0 }`, and `.prose th, .prose td`'s full-border restatement) are
removed and rewritten respectively, now that there is nothing left for either to defend against.

## The thing I would tell myself

I wrote `.design-table td { border-right: 0 }` and named the exact rule and the exact mechanism in
the comment next to it, on 2026-08-25 — I knew, in writing, that `td` was unscoped and reaching things
I hadn't intended. I stopped one line above the actual fix because the design page worked once I'd
silenced it there, and there was no visible symptom left pulling me back up the file to the source.
Two commits later I shipped a table that had no reason to know it needed the same defence, because by
then the leak had never failed loudly enough for anyone to go looking for it. The lesson isn't "read
your own comments" — I did read it, twice, while writing it — it's that a comment naming a global leak
at the site of a local patch is a flag for the *next* table, not just an explanation for this one, and
I left it as the second.

## Files

- [`src/web/styles.css`](../../src/web/styles.css) — the fix, and the comment at the scoped rule that
  now carries this history
- [`tests/table-selectors-are-scoped.test.ts`](../../tests/table-selectors-are-scoped.test.ts) — the
  guard
- [260906g-the-shelf-table-is-ugly-because-the-reading-view-s-css-leaks-into-it.md](../plans/260906g-the-shelf-table-is-ugly-because-the-reading-view-s-css-leaks-into-it.md) —
  the plan, with the full measurement tables
- [260906g-shelf-table-review-sol.md](../plans/260906g-shelf-table-review-sol.md) — the review that
  caught the specificity trap before it shipped
