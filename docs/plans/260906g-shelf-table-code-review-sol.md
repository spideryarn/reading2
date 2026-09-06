The runtime changes look sound. I found no reading-view, admin-table, row-cap, or Radix/tooltip regression. I did find one meaningful weakness in the CSS guard and two smaller documentation/UX mismatches.

## Findings

1. **Certain, medium — the selector guard has false-green cases.**

The combination of `TABLE_TAG` and `SCOPED` at [table-selectors-are-scoped.test.ts:58](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/tests/table-selectors-are-scoped.test.ts:58) does not establish the invariant its test name claims.

Examples that incorrectly pass:

```css
:is(td, th) { ... }           /* table tags hidden behind ( and ) */
td:not(.zoom) { ... }         /* dot counted as scope, but rule is global except .zoom */
:is(table, .zoom) td { ... }  /* .zoom exists somewhere, but every table still matches */
```

There is another false-green path at [table-selectors-are-scoped.test.ts:88](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/tests/table-selectors-are-scoped.test.ts:88): a semicolon at-rule is retained in the text before the following selector, so `@layer foo; td { … }` starts with `@` and is skipped. The existing `@import` means the stylesheet’s first `:root` rule is already skipped this way, though that rule contains no table selector.

This does not weaken the evidence for this fix: it catches the four original bare branches, and the reintroduction check is valid. It does mean the postmortem’s broader “any branch naming a table tag” claim is too strong. At minimum, add calibration cases for functional pseudos and semicolon at-rules, or narrow the documented promise to the exact bare-selector class it reliably detects.

Other parser behavior:

- Nested `@media`, block-form `@supports`, `@container`, and block-form `@layer` work for the stylesheet’s present syntax.
- Standard `@keyframes` nesting is tracked correctly. Vendor-prefixed keyframes are not recognized.
- Braces inside strings or `url()` can corrupt depth tracking because the scanner has no string state. There are no such constructs in the current file.
- CSS nesting such as `.zoom { & td { … } }` produces a safe false red because the parent scope is forgotten.
- Every branch in a multiline selector list receives the first branch’s line number at [table-selectors-are-scoped.test.ts:96](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/tests/table-selectors-are-scoped.test.ts:96). The four reconstructed violations happened to point usefully because `thead th` was first in those lists.

2. **Certain, low — the switch’s track is 32px, but its interactive targets are 28px.**

The root is `h-8` at [ShelfControls.tsx:159](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/ShelfControls.tsx:159), while each actual radio button is `h-7` at [ShelfControls.tsx:203](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/ShelfControls.tsx:203). The border/padding around those buttons is not clickable.

That remains above WCAG’s 24px minimum and is an improvement over the old 24px buttons, so I would not treat it as an accessibility failure. But the plan’s “24px → 32px boxes” and the implementation comment’s “32px, not 28” overstate the hit-target change. Either make the items 32px or describe this accurately as a 32px track containing 28px targets.

3. **Certain, low — `/admin` now behaves differently from its own explanation.**

The account column comment still says the fluid column “collapses to almost nothing” at [admin-columns.tsx:359](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/admin-columns.tsx:359). It can no longer do that: `FLUID_CELL` gives it a 224px minimum at [DataTable.tsx:195](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/lib/DataTable.tsx:195), repeated on its header at [DataTable.tsx:488](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/lib/DataTable.tsx:488).

The behavioral change is beneficial: `/admin`’s Account column stays readable and its existing overflow wrapper scrolls sooner. Only the explanation is stale.

## Requested checks

The reading table itself is unchanged by the CSS scoping:

- Old `thead th` and new `:where(table.zoom > thead) > tr > th` both have specificity `(0,0,2)`.
- Old `td` and new `:where(table.zoom > tbody > tr) > td` both have `(0,0,1)`.
- Source order is unchanged.
- `thead th.pin-left`, `td.pin-left`, and `td.pin-right` therefore retain their stronger specificity and their intended z-index, shadow, and border overrides at [styles.css:988](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/styles.css:988) and [styles.css:1024](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/styles.css:1024).
- `td.gist .sticky`, `--head-h`, and `--bar-bottom` are untouched, so their arithmetic remains identical.

The child chains match the actual DOM. `colgroup` is merely a sibling of `thead`; every header is `table > thead > tr > th`, and every ordinary, `rowSpan`, prose, and `withheldLeaf` cell is `table > tbody > tr > td`. The relevant markup is at [TableView.tsx:1129](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/TableView.tsx:1129), [TableView.tsx:1190](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/TableView.tsx:1190), and [TableView.tsx:1383](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/TableView.tsx:1383). `rowSpan` changes table layout, not DOM ancestry.

The only reading-view elements intentionally losing old behavior are nested article-table headers. Nested prose `td`s lose the bare base declaration, but `.prose th, .prose td` overrides all three affected properties—vertical alignment and both border sides—at [styles.css:1744](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/styles.css:1744). Proper `<thead>` headers stop being displaced, which is the latent bug being fixed. I found no other reading-view element that matched the old rules and now loses intended styling.

The design table remains computed-equivalent: it still sets bottom border and middle alignment at [styles.css:4253](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/styles.css:4253), while the right border now defaults to none instead of explicitly undoing the global rule.

`min-w-56` safely wins when it conflicts with `max-w-0`; `w-full` remains the preferred-width signal that lets the fluid column absorb spare space. Both current consumers have exactly one fluid column. The only `/admin` consequence is a readable Account column and earlier horizontal overflow.

The row-cap seam and predicates are correct. The cap and button share the same condition: when `!expanded && sorted.length > 50`, rows are sliced and the button renders; otherwise the list is not capped. The button’s total is the current filtered-and-sorted result count. I found no capped-without-button or misleading-count state. There is no automated test for this behavior, however—the temporary browser verification is the only regression evidence.

The Radix/Floating-UI composition is sound. `Tooltip` merges the child ref and composes handlers at [Tooltip.tsx:215](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/Tooltip.tsx:215); the installed Radix item forwards that ref and composes its own focus/keyboard handlers rather than replacing them. The responsive span at [ShelfControls.tsx:218](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/ShelfControls.tsx:218) remains in the accessibility tree at both widths, so “Cards” and “Table” remain the accessible names. The tooltip adds description rather than replacing those names.

I reran the four focused test files: 20 tests passed. No files were changed.