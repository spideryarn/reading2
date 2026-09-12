Review complete. No P0 findings, and nothing was committed.

### Findings

- **P1 — fixed:** with a mouse left over the row, tabbing to `.blk-cmt` left keyboard focus on an invisible mark. The higher-specificity hover rule beat `.blk-cmt:focus-visible`, while the later-painted ellipsis covered it. The hover prefix now uses `:where()`, and a focused mark suppresses the overlapping ellipsis’s paint and hit-testing: [gutter.css](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/styles/gutter.css:532).

- **P2 — fixed:** keyboard-focused ellipsis painted `--page` over an opaque row’s `--muted` background, producing a dark square. Opaque rows now receive a matching patch: [gutter.css](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/styles/gutter.css:520).

- **P2 — wider, unchanged:** the already-documented disclosure issue remains: activating a normally folded control such as the permalink closes the column and browser focus falls to `body`. This is not an invisible focused element, but it loses the reader’s position. It predates Stage 2b and remains explicitly deferred in the plan.

Regression assertions were added for specificity, focus visibility, pointer routing, and opaque backgrounds: [gutter-target-size.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/gutter-target-size.test.ts:406).

The remaining cascade is sound:

- The negated query means “either two-slot threshold is unmet,” matching `max(48px, 3rem)`.
- Its subjects are gutter children, which query their `.blk-gutter` size-container ancestor.
- `[data-open]` excludes every overlapping rule before the open-column rules apply.
- Heading rules change alignment only; the shared grid cell remains bottom-aligned.
- At rest, touch hits the mark; on a selected row, the later DOM ellipsis paints and receives presses. Keyboard focus on the mark now reverses that safely.
- No later reader stylesheet declares these properties for `.blk-cmt` or `.blk-more`.

### Results

- Requested four test files: **90 passed**
- `node scripts/typecheck.ts`: **passed**, all 2,154 files covered
- Client production build: **passed**
- `git diff --check`: **passed**
- Targeted Biome lint: no errors; three existing descending-specificity warnings and one existing style note
- No commit made.