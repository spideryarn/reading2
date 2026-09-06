Stage 1 is directionally correct, but it is not safe as currently written. There are three definite defects in the plan: the new selectors change specificity, two other leaking selectors are missed, and the claimed row-height reduction has no implementation behind it.

## Findings

1. **Certain, high severity — Stage 1’s proposed selectors break the reading table’s cascade.**

`table.zoom > thead > tr > th` has specificity `(0,1,4)`, so it beats the later `thead th.pin-left` `(0,1,2)`. The base `z-index: 25` would therefore override the intended pinned-header `z-index: 35` at [styles.css:852](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/styles.css:852) and [styles.css:1010](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/styles.css:1010).

Likewise, `table.zoom > tbody > tr > td` beats `td.pin-right`, so the new base border would override `border-right: none` at [styles.css:996](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/styles.css:996).

Preserve the original specificity while gaining the correct direct-child scope:

```css
:where(table.zoom > thead) > tr > th { /* specificity 0,0,2 */ }
:where(table.zoom > tbody > tr) > td { /* specificity 0,0,1 */ }
```

The direct-child insight in [the plan:77-84](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/docs/plans/260906g-the-shelf-table-is-ugly-because-the-reading-view-s-css-leaks-into-it.md:77) is otherwise exactly right. A descendant selector would reach article tables nested inside `td.text`.

Nothing outside `table.zoom` needs these declarations. The measured headers are the direct header children rendered at [TableView.tsx:1129](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/TableView.tsx:1129) and [TableView.tsx:1190](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/TableView.tsx:1190); `useColumnContext` queries those same `data-col` headers at [useColumnContext.ts:109](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/useColumnContext.ts:109).

2. **Certain — Stage 1 misses two more instances of the same leak.**

There are also bare `thead th` branches in:

- The small-device transition rule: [styles.css:12851](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/styles.css:12851)
- The reduced-motion rule: [styles.css:13146](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/styles.css:13146)

They currently apply reading-view transition behavior to the shelf and article tables. They should receive the same low-specificity direct-child scope. Otherwise Stage 1 is incomplete and the proposed guard cannot pass without accidentally allowlisting them.

3. **Certain — the proposed regression-test inventory and implementation claim are wrong.**

A raw selector scan finds 30 branches without a class, ID or attribute; excluding keyframes leaves 13, not nine. More importantly, four table-related branches currently violate the intended rule: the two main declarations plus the two transition declarations above.

Also, `tests/css-tokens.test.ts` does not parse CSS. It explicitly calls itself “a text scanner, not a rendering engine” at [css-tokens.test.ts:5](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/tests/css-tokens.test.ts:5), and reads/decomments strings at [css-tokens.test.ts:56](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/tests/css-tokens.test.ts:56). Neither PostCSS nor a selector parser is a direct dependency.

A guard that should hold:

- Limit it to `table`, `thead`, `tbody`, `tfoot`, `tr`, `th`, and `td`, not every HTML element.
- Parse selector branches, skipping keyframes.
- Reject a branch containing one of those table tags unless it contains a class, ID or attribute selector.
- Calibrate it with examples: `td` and `thead th` fail; `.prose td`, `td.gist`, and the proposed `:where(table.zoom …)` selectors pass.

That gives a zero-allowlist guard for this exact bug class. The broad “no unscoped element selector anywhere” policy inherits the unrelated `h1` cleanup and is more likely to become administrative noise.

4. **Certain — the prose-table “clipped empty strip” prediction is probably wrong, although the leak is real.**

The stylesheet itself notes that table-cell height is a minimum and the zoom header collapses only because its content is out of flow at [styles.css:845](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/styles.css:845). Article `<th>` text is in flow, so `height: 0` should not by itself collapse it into an empty strip.

Article headers still incorrectly receive `position: sticky`, `top`, `z-index`, and `overflow`, so scoping remains necessary. The browser pass should test unwanted sticking/offset, not assume an empty header.

Removing the global `td` declarations breaks nothing intended:

- `.prose th, .prose td` overrides all three relevant properties—border, vertical alignment, and thus both border sides—at [styles.css:1709](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/styles.css:1709).
- `.design-table td` also overrides vertical alignment and both relevant borders at [styles.css:4219](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/styles.css:4219). Remove only its `border-right: 0` declaration and defensive comment, not the whole rule.
- The design table has no `<thead>` at [DesignPage.tsx:414](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/DesignPage.tsx:414).

5. **Certain — Stage 2 cannot produce the promised 38px rows.**

The plan retains `py-2` and changes only horizontal padding at [the plan:134-135](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/docs/plans/260906g-the-shelf-table-is-ugly-because-the-reading-view-s-css-leaks-into-it.md:134). The current cell already has `py-2` at [DataTable.tsx:398](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/lib/DataTable.tsx:398), while the article cell can contain two block lines at [library-columns.tsx:276](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/library-columns.tsx:276) and [library-columns.tsx:282](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/library-columns.tsx:282).

Changing `px-2` to `px-3` cannot reduce height. Either remove the 38px claim or specify a real vertical/content change; a two-line cell is unlikely to fit 38px without sacrificing the subtitle.

6. **Judgment — the 50-row cap belongs in `Library`, after `sorted`, not inside `DataTable`.**

`DataTable` already documents that the caller supplies rows because caller-specific policy can alter the final order at [DataTable.tsx:348](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/lib/DataTable.tsx:348). `Library` performs both `sinkLast` passes at [Library.tsx:223](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/Library.tsx:223). The simplest correct seam is therefore:

```tsx
rows={expanded ? sorted : sorted.slice(0, 50)}
```

with the reveal button beside the call site. Do not slice `rows` before TanStack sorting or before the two sinks.

A generic `limit` also cannot naturally render “Show all 213 articles”: the same component renders accounts at [AdminPage.tsx:383](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/AdminPage.tsx:383). Making the label generic adds props solely to support a shelf policy.

Not resetting expansion when the query changes is reasonable: “Show all” can be treated as an explicit display preference. The actual contradiction is “stays pressed for the session.” `DataTable` unmounts when switching to cards or when a query yields zero rows at [Library.tsx:454](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/Library.tsx:454), so component-local state resets in both cases. Put the state in `Library` if session-like persistence is intended.

7. **Judgment — do not hand-roll the radiogroup. Prefer Radix `RadioGroup`, not `ToggleGroup`.**

The plan understates what hand-rolling entails. It needs:

- `role="radio"` and `aria-checked`, not `aria-pressed`
- An accessible group name
- One tab stop
- Arrow navigation that moves focus and selection
- Wrapping, `preventDefault`, Home/End behavior and RTL handling
- Tests covering focus and URL/history changes

`tabIndex={selected ? 0 : -1}` plus “an arrow-key handler” is not the whole implementation.

The installed Radix `ToggleGroup` does provide radiogroup roles, but it is still a toggle: activating the selected item can produce an empty value. Radix `RadioGroup` more exactly models the invariant and officially provides roving focus plus arrow-key selection. It is already available through `radix-ui`, is unstyled, and accepts the existing geometry classes directly—no CVA variants need to be introduced. [Radix’s Radio Group documentation](https://www.radix-ui.com/primitives/docs/components/radio-group) confirms the keyboard behavior.

The simpler alternative is also defensible: retain the existing fieldset and pressed buttons at [ShelfControls.tsx:91](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/ShelfControls.tsx:91), then improve only appearance, labels and tooltips. The semantic rewrite is not required to satisfy the original aesthetic request.

## Other judgments

The decision not to copy shadcn’s Table primitives is sound. `DataTable` already owns the actual table structure and styling at [DataTable.tsx:363](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/lib/DataTable.tsx:363), and it already has multiple consumers. Adding thin wrappers underneath it would provide no current capability. That reasoning is evidence-based, not self-justifying.

The sticky-header diagnosis is accurate for this markup. `overflow-x: auto` is on the immediate wrapper at [DataTable.tsx:377](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks/src/web/lib/DataTable.tsx:377). The overflow specification says the other axis’s `visible` computes to `auto`, and sticky positioning uses the nearest scrollport. [CSS Overflow Level 3](https://www.w3.org/TR/css-overflow-3/) and [CSS Positioned Layout Level 3](https://www.w3.org/TR/css-position-3/) support the plan’s explanation. Giving the wrapper a capped height is one solution, not the only solution; restructuring or separating the header could also work. Deferring it is sensible.

The complexity I would remove is:

- The broad all-element selector policy—use a table-specific guard.
- Generic `DataTable.limit`—keep the shelf policy in `Library`.
- The hand-written radiogroup—either retain the current semantics or use Radix `RadioGroup`.
- Potentially the four-layer scroll shadow until the 390px screenshot shows that a simpler edge treatment is insufficient.

Pagination and virtualisation are correctly excluded.