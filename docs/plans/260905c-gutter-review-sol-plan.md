The mechanism is wrong as planned. The container-query idea is viable, but this version does not preserve the no-overhang invariant and the visibility matrix is incorrect.

## Blocking findings

1. The query thresholds stop matching the slot size above a 16px root.

The plan hard-codes `48 / 72 / 96px` thresholds ([plan:137](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/docs/plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md:137>)), while `--blk-slot` is `max(1.5rem, 24px)` ([styles.css:299](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:299>)). At a 20px root, a slot is 30px:

- `min-height: 48px` can reveal 60px of controls.
- `min-height: 72px` can reveal 90px.
- `min-height: 96px` can reveal 120px.

For example, at a 48px container height the two controls overflow the container by 12px; the 7.44px reserved bottom pad absorbs only part of that, leaving about 4.56px below the row. Paragraph line heights happen to jump over some unsafe intervals, but figures, captions, lists and other arbitrary-height rows need not.

Use thresholds derived from both halves of the slot:

```css
@container (min-height: max(3rem, 48px)) { /* two slots */ }
@container (min-height: max(4.5rem, 72px)) { /* three */ }
@container (min-height: max(6rem, 96px)) { /* four */ }
```

Pin those copies against `--blk-slot` at the root sizes already tested in [gutter-target-size.test.ts:45](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/tests/gutter-target-size.test.ts:45>).

Sub-pixel comparison itself is not the problem: a 47.999px container does not satisfy `min-height: 48px`; equality does. The unsafe discrepancy comes from comparing against a different slot size.

2. Removing every floor makes the default one-slot state unsafe.

The plan deletes all floors ([plan:183](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/docs/plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md:183>)), but the default always reveals one 24px control. Yesterday established why the one-slot floor exists: at a 12px root, a natural one-line paragraph has only about 18px of queried space and the 24px target extends roughly 1.56px below its row. That exact regression is documented in [styles.css:10026](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:10026>) and guarded structurally by [gutter-target-size.test.ts:116](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/tests/gutter-target-size.test.ts:116>).

Keep the cheap one-slot floors:

```css
td.text {
  height: calc(var(--blk-top) + var(--blk-slot) + var(--block-pad));
}

td.text.kind-heading {
  height: calc(var(--blk-slot) + var(--block-pad));
}
```

The expensive three-slot `.gutter-pad` floor can go. At a 16px root the ordinary floor costs effectively nothing; below 16px it is what keeps the px-floored target inside the row.

3. The heading arithmetic says “zero slots”, not one, and explicit height reverses the old bottom-anchor behaviour.

The plan’s own heading has `avail = 18.9px` but labels that as one 24px slot ([plan:50-60](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/docs/plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md:50>)). Numerically it fits zero.

Previously, the gutter’s auto height was its 24px child, so `bottom: …` made the box grow upward. With the proposed explicit 18.9px height and top-aligned grid content, the 24px child instead overflows downward. On the ordinary 16px heading that is roughly a 2.2px row overhang. The relevant geometry is the doubled `--blk-top` at [styles.css:1188](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:1188>) and the bottom-anchor at [styles.css:10082](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:10082>).

Give headings a safe box whose whole area is queryable, with controls aligned to its bottom:

```css
td.text.kind-heading .blk-gutter {
  top: 0;
  bottom: calc(var(--block-pad) / 2);
  align-content: end;
}
```

Together with the one-slot heading floor, that makes the queried capacity and the painted capacity agree.

4. The visibility rules fail at the component boundary.

The claim that `:nth-child(-n+k)` finds the first present controls is narrowly true only while there are at least `k` real controls before `…`. It does not answer whether an overflow control is required.

`comments`, `onChatAbout`, and `onHelp` are independent props ([BlockGutter.tsx:130](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/BlockGutter.tsx:130>), [BlockGutter.tsx:148](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/BlockGutter.tsx:148>), [BlockGutter.tsx:162](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/BlockGutter.tsx:162>)), while `…` is rendered only when either callback exists ([BlockGutter.tsx:589](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/BlockGutter.tsx:589>)). The resulting failures are:

| Props | Capacity | Result as planned |
|---|---:|---|
| no note, no callbacks | 1 | Nothing: permalink is hidden and there is no `…` |
| note, no callbacks | 1 | Nothing, including the note |
| note, no callbacks | 2 | Bookmark shown; permalink hidden with no route to it |
| note + exactly one callback | 3 | `:has(.blk-cmt)` treats three controls as four, unnecessarily hides the third and shows `…` |

The one-slot note row also contradicts the plan’s table: the default `display:none` rule shows `…`, not “mark at rest; `…` on hover” ([plan:97-101](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/docs/plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md:97>)).

Render `…` whenever the real control count is greater than one, not from callback capability, and expose the real count as `data-controls="1"…"4"`. Let the queries use count plus capacity. `:has(.blk-cmt)` is not a valid proxy for four controls.

Do not simply delete [gutter-pad-floor.test.tsx](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/tests/gutter-pad-floor.test.tsx:164>); replace it with the full eight-combination prop matrix. That test already exists specifically because the callbacks cannot be assumed to travel together.

## Other findings

5. The percentage height is spec-definite, but two insets are the better construction.

For an absolutely positioned child, modern positioned layout runs after the containing block’s final size is known and calls its available space definite. CSS Tables also explicitly says percentage heights should be resolved in the table cell’s second layout pass when the child is absolutely positioned. [CSS Positioned Layout](https://drafts.csswg.org/css-position/#abspos-layout), [CSS Tables](https://drafts.csswg.org/css-tables/#computing-cell-measure).

So `height: calc(100% - …)` is defensible by spec. I would still not make the invariant depend on it: table-internal positioning remains an interoperability-sensitive area, and WebKit has had recent percentage-sizing and layering disagreements in related positioned-table constructions. [WebKit bug 245496](https://bugs.webkit.org/show_bug.cgi?id=245496).

Use:

```css
.blk-gutter {
  top: var(--blk-top);
  bottom: var(--block-pad);
  height: auto;
  container-type: size;
}
```

The cost is small but must be handled explicitly:

- `[data-open]` must set `bottom: auto` when releasing to content height.
- Headings need the separate bottom-aligned safe box described above.
- A real Chrome/Safari/Firefox geometry pass remains required.

6. Opening a heading currently unfolds upward, contrary to the plan.

The plan says the panel unfolds downward ([plan:147](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/docs/plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md:147>)). Merely turning off containment and restoring `height:auto` leaves the heading’s `top:auto; bottom:…` rule in force, so its auto-height panel grows upward.

`[data-open]` needs to override the heading anchor to `top: var(--blk-top); bottom:auto`. It also needs a raised stacking level; otherwise later rows’ positioned gutters can paint over the open panel.

The plan must narrow the invariant to “no closed control overhangs.” An open, visibly opaque disclosure deliberately owns the rows beneath it; that is acceptable, but it is an explicit exception to the stated invariant, not a stronger version of it.

7. The `90vw` correction is right for ordinary prose.

The gutter and base `.prose` compute the same clamp: both use the reading size and weight, and the gutter inherits the same reading family from `body`. See [styles.css:411](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:411>), [styles.css:9939](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:9939>) and [styles.css:1261](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:1261>). The surrounding `max(0, …)` also mirrors the prose box becoming narrower than its maximum.

It deliberately differs for row-specific prose:

- Callouts use 58ch.
- Captions use 48ch and a smaller font.
- Opaque prose uses a smaller font.

So “matches `.prose`” should say “matches the ordinary paragraph measure”; it does not match every `.prose` variant.

## What to build

Keep the container-query approach, but:

1. Retain the one-slot paragraph and heading floors.
2. Stretch the query box with fixed `top` and `bottom` insets.
3. Give headings their own bottom-aligned safe query box.
4. Scale every query threshold with `max(rem, px)`.
5. Render `…` from real control count, expose that count in the DOM, and test all eight prop combinations.
6. Give `[data-open]` explicit downward geometry and stacking.
7. Browser-test closed control rectangles against their own `<tr>` at 12px, 16px and 20px roots, including headings and deliberately fractional row heights.

With those corrections, CSS containment is a reasonable mechanism. As written, it will lose controls and recreate the exact cross-row input bug the floor was introduced to prevent.