# Review prompt — stage 1 as built (the gutter's 2 × 2 pad)

You reviewed this plan before it was built and your findings reshaped it. This is the **code review
of stage 1**, which is the layout change only. Weight this review higher than the plan review: a
plan-stage review cannot find a CSS rule that loses on specificity.

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button`

## Read

1. `docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md` — the plan, updated since
   you saw it. Note § *The decision the review forced: no new ThreadKind* and § *What the review
   changed*, which say what your findings did.
2. `docs/plans/260904b-gutter-help-button-review-sol.md` — your own plan review, for reference.
3. `docs/plans/prose-gutter-icons.md` — the previous gutter work. Its § *The overhang, and how it was
   actually fixed* is the bug class this stage must not reintroduce.

## The diff under review

```
git diff
```

Scoped to stage 1: `src/web/styles.css`, `src/web/TableView.tsx`, `src/web/layout.ts`,
`src/web/BlockGutter.tsx` (comments only), `tests/layout.test.ts`,
`tests/text-alone-centring.test.ts`, plus doc updates. `preview-gutter.html` and
`src/web/preview-gutter.tsx` are a deliberately throwaway browser harness, kept for stage 2 and
deleted before landing — review them only for whether they could mislead a later measurement.

**Not in scope:** there is no "?" button yet, and nothing about sending, `ChatDialog`, or the prompt.
The fourth grid cell is deliberately empty. Do not review stages 2–4.

## What was claimed

- `--blk-slot` 0.95rem → 1.5rem; targets 22 × 15 → **24 × 24**, meeting WCAG 2.5.8, which this
  gutter has never met.
- `.blk-gutter` 1.4rem → 3rem, and from a flex column to a 2-column grid with **no row gap**.
- `--text-pad-l` 2.1rem → 3.7rem.
- A new `--blk-top` custom property on `td.text`, overridden for headings and for a first heading, so
  that the gutter's `top`, the row floor and the heading anchoring all read **one** number and cannot
  drift apart. It replaced hand-written arithmetic in three places.
- `td.text.has-marks` renamed **`td.text.gutter-pad`** and its condition changed from "this block has
  a comment" to "this gutter is the full pad" — set in `TableView.tsx` from
  `onChatAbout || cmtsByBlock.has(id)`, i.e. **from the capability**, so an owner is floored on every
  row and a visitor keeps the old single-slot rhythm.
- The `.kind-heading.has-marks` "switch back to top-anchoring" rule was **deleted** as unnecessary
  once `--blk-top` exists; ordinary-heading bottom-anchoring now applies only to
  `td.text.kind-heading:not(.gutter-pad)` — i.e. visitors.
- `PROSE_ALONE_MAX_REM` 50 → **52** (46 measure + 3.7 + 1.4 = 51.1, rounded up), with a new test guard
  in `text-alone-centring.test.ts` that reads `--text-pad-l`/`--text-pad-r` out of the stylesheet and
  fails if the constant stops covering measure + pads. The author reported watching it go red.
- Explicit `grid-area` on `.blk-permalink` (1/1), `.block-chat` (1/2), `.blk-cmt` (2/1), written
  against the classes rather than `:nth-child`.

Measured in system Chrome with the real `TableView`:

| | before | after (owner) | after (visitor) |
|---|---|---|---|
| target | 22 × 15 | 24 × 24 | 24 × 24 |
| one-line paragraph row | 39.1 | 63.1 | 39.1 |
| multi-line paragraph | 66.3 | 66.3 | 66.3 |
| ordinary heading | 39.9 | 69.1 | 39.9 |
| commented heading | 60.7 | 69.1 | n/a |
| long wrapping heading | — | 89.9 | 89.9 |

Overhang check, run programmatically at 1280, 820 × 1180 and 390 × 844 (the last two with touch
emulation so `(hover: none)` matches and every control is pointer-active), box-vs-row plus
`elementFromPoint` on each centre: **23/23 owner and 10/10 visitor controls inside their own row,
each topmost at its own centre. Worst clearance 2.97px.** The same harness *before* the change had
`.block-chat` hanging 0.45px below a one-line paragraph row.

## What I want from you

Be adversarial. Verify rather than accept — the numbers above are the author's, and a check nobody
has seen fail is not evidence.

1. **The overhang, again.** This is the bug class that shipped twice in this file's history and was
   fixed twice. Is it genuinely gone *by construction*, or does it hold only for the shapes the
   fixture happens to contain? Reason about shapes the harness does NOT have. In particular:
   a heading that is also the first row; a heading immediately following a one-line paragraph; a
   `kind-callout`; a row with `rowSpan` from the gist column; a block whose `td` gets extra padding
   from another rule; a 12px and a 20px root font size; and a browser zoom. Worst clearance is
   **2.97px** — how much of that is font metrics rather than design?

2. **`gutter-pad`'s condition is `onChatAbout || cmtsByBlock.has(id)`.** Is keying a *layout* class
   off a capability callback sound, or is it a coupling that will surprise someone? What happens on
   the transition — does an article flip row heights when ownership resolves after load (is
   `onChatAbout` ever undefined on first paint and defined later)? Would that be a visible reflow of
   the whole article under the reader? Check how `owner` is derived in `App.tsx` and when.

3. **The deleted rule.** `.kind-heading.has-marks { top: …; bottom: auto; }` is gone, on the argument
   that `--blk-top` makes it unnecessary. Prove or disprove that. The commented-heading shape is the
   one your own earlier review caught and the fixture did not originally have.

4. **Specificity and cascade.** The previous round of this work shipped a bug found only by reading
   specificity — `.blk-permalink.failed` losing to `tr:hover .blk-permalink`. Re-audit: do the new
   `grid-area` rules, the `:not(.gutter-pad)` selector, and the `@media (hover: none)` block all win
   where they must? Is there any rule whose comment now describes behaviour it no longer produces?

5. **`pointer-events`.** `.blk-gutter` is `pointer-events: none` with each child opting back in.
   Confirm this survived the flex → grid change, and specifically that `.blk-cmt` — the one slot with
   no hover rule to hand pointer-events back — is still clickable. That one would ship broken and
   look fine.

6. **`--blk-top` as a design.** Three rules now read one custom property. Is the indirection right,
   or has it just moved the coupling somewhere less visible? Does it hold for the first-heading
   override and under `@media (hover: none)`?

7. **The test guard** in `text-alone-centring.test.ts` that parses the stylesheet. Is it actually
   load-bearing, or can it pass while the thing it protects is broken? Would it survive someone
   writing the padding in `px`, or with a `calc()`?

8. **Anything else that is simply wrong**, and anything the stage should have done and did not. Is
   stage 1 genuinely shippable on its own — an article with visibly taller rows and an empty
   bottom-right cell — or does it look broken until stage 2 lands?

Run at least one test file yourself. `npx vitest run tests/layout.test.ts
tests/text-alone-centring.test.ts tests/spine-width.test.ts` is the relevant set; the author reports
49 passing. If you can drive a browser, do — a finding you reproduced outranks one you reasoned to.

Rank findings by severity and say plainly which would stop you committing this stage.
