# Review prompt — stage 2 as built (the "?" button)

You reviewed the plan, and then stage 1, and both reviews changed the work. This is the **code
review of stage 2**. Weight it higher than the plan review: a plan-stage review cannot find a CSS
rule that loses on specificity, and your stage 1 review is the proof — you passed the overhang
construction at 12 and 20px roots, correctly, and the px floor that fixed your *other* finding then
broke that very scaling and reintroduced the overhang at 12px. Only re-measuring found it.

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button`

## Read

1. `docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md` — the plan, with a new
   § *Built, and measured* for stage 2.
2. `docs/plans/260904b-gutter-help-button-stage1-review-sol.md` — your stage 1 review.
3. `git show 8a681120` — stage 1, committed. Its message records the overhang the floor introduced.

## The diff under review

```
git diff
```

`src/web/BlockGutter.tsx`, `src/web/App.tsx`, `src/web/TableView.tsx`, `src/web/styles.css`,
`tests/block-gutter.test.tsx`, `tests/gutter-target-size.test.ts`, plus the plan.
`preview-gutter.html` / `src/web/preview-gutter.tsx` are an untracked throwaway harness, deleted
before landing — review them only for whether they could mislead a measurement.

**Not in scope:** nothing sends yet. No `ThreadKind`, no prompt addendum, no change to
Cancel/Close. Those are stages 3 and 4. Do not review them.

## What was claimed

- A fourth grid cell, row 2 / column 2: `.blk-help`, a `CircleHelp` at `size={12}` — the same ink as
  the other three, because stage 1 grew the hit box and deliberately not the glyph.
- `onHelp?: ((id: BlockId) => void) | undefined`, rendered only where the callback is, wired in App
  as `onHelp={owner ? chatAboutBlock : undefined}` — so **it currently does exactly what the chat
  button does** and spends nothing.
- Copy: `"Ask for help with this paragraph"` in both `title` and `aria-label`, pinned by an
  exact-string test, chosen to promise a question rather than an answer until stage 3 makes
  "explain" true.
- Rendered last, so tab order is address → mark → chat → help.
- `.blk-help` added to the hidden-at-rest group, the `tr:hover` / `:focus-visible` reveal (where
  `pointer-events: auto` comes back), and the `@media (hover: none)` block.
- **The touch opacities were levelled to 0.35**, from `.blk-permalink` 0.35 / `.block-chat` 0.45.
  Argument: with a third permanently-visible glyph on touch, 0.45 + 0.45 in the right column against
  a lone 0.35 reads lopsided; the split was two rules written months apart, not a hierarchy. Claimed
  peak glyph luminance 67 → 54 against a page at 10, with 0.28 measured at 45 and rejected as too
  faint for an iPad in daylight. `.block-chat.has` claimed unaffected at opacity 1, its (0,2,0)
  beating the touch rule's (0,1,0).
- Nine new tests, each confirmed red first. Two were mutation-checked: deleting `stopPropagation`
  reddens its test; and the `(hover: none)` helper had been reading the *first* such block in the
  stylesheet when there are two 3,000 lines apart — a check that could never have failed for its
  stated reason, since fixed.

Measured, 18 combinations (1280 / 820×1180 / 390×844, the last two with touch emulation and
`(hover: none)` asserted true, × roots 12/16/20 × owner/visitor), each control scrolled into view
before `elementFromPoint`:

**33/33 owner and 10/10 visitor controls, all 24×24, none outside its own row, each topmost at its
own centre.** Worst clearance owner 4.45 / 5.95 / 7.44px at roots 12/16/20; visitor 2.22 / 2.97 /
3.72 — identical to stage 1, as are all row heights. The claim is that a fourth drawn cell cost
zero pixels because stage 1 had already floored the row for it.

## What I want from you

Be adversarial. Verify rather than accept.

1. **Is the "cost zero pixels" claim true, or true-by-luck?** Stage 1 floored the row for two rows
   of slots. Confirm the fourth cell genuinely fits within that floor at every root and row shape —
   including ones the fixture lacks. Pay attention to the *visitor* numbers being unchanged: they
   should be, since a visitor gets no `onHelp`, but check the floor rules still agree.

2. **The row floor is keyed off `onChatAbout` alone**, not `onHelp`. The author flags this as a
   latent hazard: correct today only because App gates both on `owner`, and if stage 3 ever hands
   out `onHelp` without `onChatAbout` the "?" lands in an unfloored row and the overhang class comes
   back silently. Is that the right call, or should the floor read both now? Would a test pin it
   usefully, or is that belt-and-braces?

3. **Specificity and cascade, again.** This is the stylesheet that shipped
   `.blk-permalink.failed` losing to `tr:hover .blk-permalink`. Audit the new `.blk-help` rules:
   does it hide at rest, reveal on hover *and* focus, get `pointer-events` back in every path that
   reveals it, and behave under `@media (hover: none)`? And verify the claim that `.block-chat.has`
   still wins at opacity 1 against the levelled touch rule.

4. **The opacity levelling.** It is a visual judgment made from a 4× crop and a luminance
   measurement. Is the reasoning sound, and is anything *else* depending on the 0.45 that was
   changed? Is 0.35 defensible for the chat button specifically, given `.block-chat` is the one that
   can also be a *state* (`.has`)?

5. **The copy.** `"Ask for help with this paragraph"` in both `title` and `aria-label`, identical.
   Is that right for a screen reader, given the other three slots have divergent `title`/`aria-label`
   for stated reasons? Does the exact-string test help or will it just be updated mechanically in
   stage 3?

6. **The tests.** Nine claimed red-first. Read them: do they test behaviour or restate the
   implementation? Would any pass while the feature is broken? The `(hover: none)` helper bug the
   author found is exactly the class I care about — look for more of it.

7. **Anything else wrong**, and: is stage 2 shippable on its own? It gives the reader a second
   button that does exactly what the button next to it does. Is that acceptable as an intermediate
   commit, or actively confusing?

Run at least one test file yourself: `npx vitest run tests/block-gutter.test.tsx
tests/gutter-target-size.test.ts` (38 tests claimed green). Drive a browser if you can — a finding
you reproduced outranks one you reasoned to.

Rank findings by severity and say plainly which would stop you committing this stage.
