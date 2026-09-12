Code review of STAGE 1 of docs/plans/260912c-gutter-bookmark-button-and-the-second-ellipsis.md, in the
spideryarn2 worktree at the current directory. Read the plan's § 38 first.

The change (uncommitted, see `git diff HEAD -- src/web/styles/gutter.css src/web/BlockGutter.tsx tests/gutter-target-size.test.ts`):
- src/web/styles/gutter.css: `.blk-gutter[data-open] > .blk-more { display: none; }` added after
  `.blk-gutter[data-open] > *`, so the column the "…" unfolds no longer draws a second "…" at its foot.
- src/web/BlockGutter.tsx: a comment on the "…" button saying so.
- tests/gutter-target-size.test.ts: a new test asserting the rule exists and comes after both the open
  rule and the last container query. It was red before the CSS line and green after.

Results so far: `npx vitest run tests/gutter-target-size.test.ts tests/block-gutter.test.tsx` → 65 passed.

The conclusion I would least like to be wrong about: that hiding the disclosure button while it is
expanded leaves no reader without a way to close the column or without a sensible focus position —
trace the keyboard path (Enter on "…" → focus to head → Tab through → Escape → focus back to "…"),
the pointer path (focus left on a button that becomes display:none), the touch path on an iPad
(`@media (hover: none)`, `tr.row-active`), and the heading variant (`td.text.kind-heading`). Also check
the specificity/source-order claim against every rule in gutter.css that sets `display` on `.blk-more`,
including any in other stylesheets (grep src/web/styles for blk-more).

House workflow: you FIX what you find inside this stage's scope (edit the files, keep the house's
comment style — reasons beside the code, Greg's words quoted), run
`npx vitest run tests/gutter-target-size.test.ts tests/block-gutter.test.tsx`, and report anything
wider for me to decide. Do not commit. Do not touch files outside these three unless a fix requires it,
and say so if it does. Finish with a findings list ranked P0/P1/P2, what you changed, and the test result.
