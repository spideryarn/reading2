## Verdict

I would **not commit stage 2 unchanged**. Two findings should be fixed first. The geometry itself is sound; the blockers are touch contrast and the knowingly incomplete floor condition.

## Ranked findings

1. **High — commit-blocking: 0.35 is too faint for an icon-only active control**

   The visual-balancing argument is coherent, and nothing else depends on the old `0.45`. `.block-chat.has` still wins at opacity 1 exactly as claimed.

   But the supplied best-case pixels—glyph 54 against page 10—do not meet WCAG’s 3:1 non-text contrast requirement for the visual information identifying an active control. They work out below 3:1 whether interpreted as ordinary sRGB values or already-linear luminance; anti-aliased pixels will be weaker still. The invisible 24px hit box does not help a reader locate the button. [WCAG 2.2, Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

   That makes [styles.css](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/styles.css:9741) hard to defend, particularly when this work is explicitly correcting touch accessibility. Raise the touch contrast or provide another sufficiently contrasting visual boundary. The prior 0.35 permalink is existing debt, not a reason to add a new control and lower chat to the same level.

2. **Medium — commit-blocking: the floor is keyed to the wrong invariant**

   [TableView.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/TableView.tsx:1062) applies `gutter-pad` from `onChatAbout || comments`, while its public API independently permits `onHelp`.

   Current App wiring is safe because both callbacks are owner-gated, but “the two can only ever agree” is false at the type boundary. An `onHelp`-only caller renders the always-present permalink in row 1 and help in row 2 without the two-row floor, recreating the exact overhang class this work exists to eliminate.

   Use `onChatAbout || onHelp || cmtsByBlock.has(block.id)`. This is not belt-and-braces; it makes layout follow the children that establish its required geometry. A useful regression test would render `TableView` with only `onHelp`, then assert both the help button and `td.gutter-pad`.

3. **Medium — non-blocking: the nine tests leave the production integration unprotected**

   The six component tests mostly exercise real behavior. The three stylesheet tests verify declarations, not the resulting cascade. A later, stronger `.reader .blk-help { opacity: 0; pointer-events: none }` would break the feature while all three remained green.

   More importantly, all nine remain green if App stops supplying `onHelp`. The browser harness also supplies `onHelp` directly to `TableView` at [preview-gutter.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/preview-gutter.tsx:232), so it cannot catch missing or incorrect App wiring. It is a valid geometry harness, but not an end-to-end presence check.

4. **Low — the implementation comment says the paragraph is “already quoted”**

   [BlockGutter.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/BlockGutter.tsx:425) says the composer opens with the paragraph quoted. In fact, `chatAboutBlock` supplies `opening`, which ChatDialog displays separately above an empty composer; the structural anchor contains only `blockId`. This distinction becomes load-bearing in stage 3, so the comment should say “shows the paragraph’s opening.”

## Confirmed sound

- **“Cost zero pixels” is true by construction, not luck.** A padded row already has two explicit `--blk-slot` tracks and a floor derived from the same variable. Adding the fourth child merely occupies the reserved cell. This holds for arbitrary roots, headings, first headings, captions/callouts, and taller content. Font metrics can increase the row but cannot reduce that minimum.
- Visitor figures correctly remain unchanged: App supplies neither callback, and the one-slot visitor floors still use the same px-floored slot.
- The current cascade is correct:
  - hidden at rest;
  - hover and `:focus-visible` both restore opacity and pointer events;
  - touch restores visibility and pointer events;
  - `.block-chat.has` at specificity `(0,2,0)` beats the touch rule at `(0,1,0)`.
- Identical `title` and `aria-label` are appropriate here. Unlike the permalink and note controls, help has no dynamic state or secondary information requiring divergent strings.
- The exact-copy test is useful for stage 2: it prevents the button from promising an automatically generated answer prematurely. Intentionally updating it alongside stage 3 is fine.

## Product shippability

This is acceptable as an intermediate commit on `dev`, once the two blockers above are fixed. It is **not independently product-shippable**: on touch, the bubble and question mark look like different actions but open exactly the same empty composer, and touch users receive no tooltip explaining the distinction. I would not deploy stage 2 without stage 3.

Verification:

- Requested Vitest run: **2 files, 38/38 passed**
- `git diff --check`: passed
- Browser reproduction was blocked by this sandbox: Vite could not bind a local port and system Chrome could not create its crashpad socket.
- Typecheck likewise could not start because `tsx` was denied its `/tmp` IPC socket; this is not a TypeScript result.