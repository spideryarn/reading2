Code review of STAGE 2b of docs/plans/260912c-gutter-bookmark-button-and-the-second-ellipsis.md, in the
spideryarn2 worktree at the current directory. Stage 2 is uncommitted and you reviewed it already
(docs/plans/260912c-gutter-bookmark-stage2-review-sol.md). This review is ONLY the follow-up below.

The problem, found by a browser pass after your review: on a ONE-LINE paragraph the gutter has room for
one 24px slot, and the "…" takes it, folding the mark (`.blk-cmt`) behind it. The "…" itself is only
visible when the row is hovered/selected. So a whole-paragraph bookmark — which underlines nothing in the
prose — was invisible at rest on one-line paragraphs, and pressing the bookmark button made it vanish
with nothing in its place.

The fix (see `git diff HEAD -- src/web/styles/gutter.css src/web/BlockGutter.tsx tests/gutter-target-size.test.ts tests/block-gutter.test.tsx`
and search gutter.css for "One slot and a mark"):
- BlockGutter sets `data-marked` on `.blk-gutter` when the block has a comment.
- gutter.css adds `@container not ((min-height: 48px) and (min-height: 3rem)) { … }`: for
  `.blk-gutter[data-marked]:not([data-open])`, `.blk-cmt` is displayed and both `.blk-cmt` and `.blk-more`
  get `grid-area: 1 / 1` (same cell, "…" later in DOM so on top). At rest the "…" is opacity 0 /
  pointer-events none, so a press lands on the mark. When the "…" is revealed (tr:hover under
  (hover: hover); :where(tr.row-active) under (hover: none)), the mark gets opacity 0. When the "…" is
  keyboard-focused on an unhovered row, it paints `background: var(--page)` over the mark (no :has(), which
  this section deliberately avoids).
- The test that forbade any `grid-area:` now allows it only inside that block; a new test pins the block.

Results: gutter tests pass (run: `npx vitest run tests/gutter-target-size.test.ts tests/block-gutter.test.tsx tests/gutter-touch-contrast.test.ts tests/block-selection-by-tap.test.tsx`),
typecheck exit 0. A browser recheck is running separately.

What I would least like to be wrong about: the cascade. Check every rule in the reader stylesheets that
sets `display`, `opacity`, `pointer-events`, `grid-area`/placement or `background` on `.blk-cmt` or
`.blk-more` against the new block — specificity AND source order — including `.blk-cmt:hover`,
`.blk-cmt:focus-visible`, `.blk-more:focus-visible`, the (hover: none) touch block, `.blk-gutter[data-open]
> *`, the heading variant (`td.text.kind-heading .blk-gutter`, bottom-aligned), `td.text.opaque`
(--muted ground under the --page patch), and the container-query semantics of `@container not (A and B)`
on an element that is itself the size container (the gutter) vs its children. Also: is a keyboard reader
ever left with a focused element that is invisible, and can a touch press ever land on the wrong one of the
two stacked controls?

House workflow: fix what you find inside this scope, rerun those test files and `node scripts/typecheck.ts`,
report anything wider. Do not commit. Finish with findings ranked P0/P1/P2, what you changed, and results.
