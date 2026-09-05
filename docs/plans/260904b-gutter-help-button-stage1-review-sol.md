## Verdict

I would **not commit stage 1 unchanged**. The overhang fix itself is sound, but the claimed 24×24/WCAG target is false at a 12px root. That is commit-blocking because this codebase explicitly supports non-16px roots.

## Ranked findings

1. **High — commit-blocking: the targets shrink below 24px**

   [`--blk-slot: 1.5rem`](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/styles.css:1041>) produces:

   - 18×18 CSS px at a 12px root
   - 24×24 at 16px
   - 30×30 at 20px

   The gutter width likewise becomes 36px at 12px, so each column is 18px. The code therefore meets the 24×24 claim only at the default root. Browser zoom generally preserves the CSS-pixel geometry or enlarges it, but changing the browser’s default font size changes `rem`.

   The fix needs a 24px minimum governing both the slot height and column width—not merely `max()` on `--blk-slot`, which would leave the grid columns at 18px.

2. **Medium — the regression remains unprotected after the harness is deleted**

   The 49 passing tests do not exercise the gutter’s rendered geometry, cascade, hit testing, target size, or pointer events. Deleting the `height` floor or `.blk-cmt { pointer-events: auto }` would leave this test set green.

   Given that this exact class shipped twice, I would retain a browser check covering at least owner/visitor, heading/paragraph/comment, touch, and 12/16/20px roots. I would not independently block the current commit on the full retained harness, but the 12px failure should gain a regression check with its fix.

3. **Medium — stage 1 reserves a future row that presently contains nothing**

   [`gutter-pad`](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/TableView.tsx:1045>) floors every owner row from `onChatAbout`, although on an uncommented stage-1 row both current controls occupy row 1. The extra 24px is entirely preparation for stage 2.

   This is intentional and does not look mechanically broken in the supplied screenshot, so I would accept it as an intermediate branch commit. It weakens the claim that stage 1 is independently product-shippable: short owner rows become visibly taller before a control uses the space. The comments saying the floor follows what the row “can actually draw” are not literally true until stage 2.

4. **Low — the centring guard is narrow, not a general invariant**

   The new test at [text-alone-centring.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/tests/text-alone-centring.test.ts:82>) catches the exact failure it was written for: changing literal rem padding while forgetting `PROSE_ALONE_MAX_REM`.

   It can still pass while the measure is clipped if `--reading-measure`, the reading font, or its `ch` metrics change, because `46rem` is duplicated as an approximation. Writing the padding in `px` or `calc()` would fail loudly rather than silently pass; safe, but brittle. It is load-bearing for one drift, not proof of the overall geometry.

5. **Low — one stale comment is already demonstrably false**

   [BlockGutter.tsx](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/BlockGutter.tsx:123>) says `onJump` is needed for keyboard activation “and a copy that failed.” The handler explicitly says and implements that a failed copy does nothing else at [line 218](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/BlockGutter.tsx:218>). Correct before committing while this file is already being edited.

## Overhang audit

For a padded owner row, the construction is:

```text
row minimum = --blk-top + 2 × --blk-slot + --block-pad
gutter box  = --blk-top + 2 × --blk-slot
clearance   = --block-pad
```

That holds for ordinary text, ordinary headings, and first headings because each heading variation changes `--blk-top`, which both placement and the floor consume. Extra cell content or padding can only increase the row. The prose `<td>` is non-spanning on every row, so a neighboring gist `rowSpan` can increase distributed height but cannot erase its minimum.

Specific cases:

- The fixture actually **does contain a first heading**, and its desktop/tablet gist has a root cell spanning all fixture rows.
- A heading after a one-line paragraph is independent of the preceding row’s height.
- `kind-callout` changes only the inner `.prose` indentation/measure, not the `<td>` or gutter.
- At 12px and 20px roots the overflow construction scales and remains safe, although target compliance fails at 12px.
- Browser zoom does not consume the CSS clearance.
- The reported 2.97px worst clearance is not font-metric luck: it is exactly the visitor-heading rule’s `--block-pad / 2` at a 16px root. It becomes about 2.23px at a 12px root and 3.72px at 20px.

The deleted commented-heading exception is correctly replaced. Padded headings no longer match [`:not(.gutter-pad)`](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/styles.css:9536>), so they retain the base `top: var(--blk-top)` with `bottom: auto`; the floor reads the same heading-specific value.

## Cascade, ownership, and pointer events

I found no cascade defect:

- The three `grid-area` rules have no competing declarations.
- The heading `:not(.gutter-pad)` selector beats the base gutter positioning.
- The first-heading custom-property override is more specific than the ordinary heading rule.
- The touch declarations come after the base hidden state; `.block-chat.has` remains intentionally stronger.
- The existing failed-permalink selector still beats `tr:hover`.
- The container remains `pointer-events: none`, while the bookmark explicitly restores hit testing at [styles.css:9651](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/styles.css:9651>).

There is no owner-resolution reflow. [`ArticlePage`](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/App.tsx:894>) renders a loading state until access resolves, then mounts either `OwnedArticle` or `VisitorArticle`; it never first paints a visitor `TableView` and later turns it into an owner one. The owner callback is present on that first owner paint at [App.tsx:2782](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/App.tsx:2782>). Keying layout from a callback is still semantic coupling, but it is stable today and causes no transition.

## Verification

- `npx vitest run tests/layout.test.ts tests/text-alone-centring.test.ts tests/spine-width.test.ts`: **3 files, 49 tests passed**.
- `git diff --check`: passed.
- I could inspect the supplied screenshot but could not independently drive Chrome in this review context, so I do not count the author’s 23/23 geometry result as reproduced.
- `npm run typecheck` could not start because this sandbox denied `tsx` its `/tmp` IPC socket (`EPERM`); that is an environment failure, not a TypeScript result.