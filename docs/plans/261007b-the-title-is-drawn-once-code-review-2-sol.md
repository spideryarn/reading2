## Findings

- **D1 — P1 — Authored metadata can still be mistaken for the legacy wrapper.** [`OUR_LINE_HTML`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/masthead-echo.ts:52) treats whitespace as provenance, but `splitIntoBlocks` preserves that whitespace. Both of these ordinary authored forms:

  ```html
  <p>
    Jo Bloggs · Example Review
    · ~5 min read
  </p>
  ```

  ```html
  <div>
    Jo Bloggs · Example Review
    · ~5 min read
  </div>
  ```

  become a stored paragraph matching the regex. The `<div>` does so because [`rewrapOrphanText`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/blocks.ts:513) wraps its text node in `<p>` without changing its whitespace; [`content.outerHTML`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/blocks.ts:1554) then preserves it. I ran both through `splitIntoBlocks` and `mastheadEcho`; each caused blocks 0 and 1 to be hidden. The new test at [`masthead-echo.test.ts:93`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/tests/masthead-echo.test.ts:93) constructs inline HTML, so it misses this real stored shape.

- **D2 — P2 — The early return does not cancel a pending instant scroll.** [`beginJump`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/keynav.ts:457) calls `abandonScroll` only when `glideTarget()` is non-null. Under reduced motion, however, `glide` deliberately sets the target to null while retaining a corrective animation frame and landing callback ([`scroll.ts:780`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/scroll.ts:780)). If another jump to the echo occurs at page top before that frame, the newer jump reports ended, but the older frame can subsequently move, flash, or install an arrival anchor. Calling `abandonScroll()` unconditionally in this branch would cancel that frame; unlike the ordinary `alreadyThere` branch, `origin.kind === "top"` proves there is no valid arrival anchor to preserve.

`beginJump` otherwise leaves its callers consistent: it drops an already-held pending flash, a valid arrival anchor prevents the early branch because `measureOrigin` returns that anchored block, and the Diagram’s `ended` callback closes its per-step chain immediately. Smooth older glides are also cancelled correctly.

The fold behavior is correct. [`foldedAway`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/fold.ts:187) comes only from `hiddenBlocks(blocks, folded)`; echo rows are added separately to `hidden`. Echo headings are removed from `foldable`, so an echo enters `foldedAway` only when covered by another genuine folded heading—for example, the metadata echo beneath a renamed, non-echo heading. [`revealBlock`](/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow/src/web/fold.ts:267) correctly leaves that fold alone because the masthead remains the visible copy and scrolling targets page top.

Tests run: all 4 requested files passed, 76 tests total.

**Verdict: ready after the reported P0 and P1s**