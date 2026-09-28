# Code review — stage 7: the scroll that aims at the element, the quote-words flash (plan 260928a)

Reviewer and fixer. Candidate: commit `4291abb7` on branch `worktree-trajectory-flash-position-0928`,
its stage-7 half: `src/web/scroll.ts` (`glide`, `aimAt`, `scrollToBlock`, the instant path),
`src/web/flash.ts` (`flashBlock(id, { passage })`), `src/web/modes/trajectory/TrajectoryMode.tsx`
(`arrive`), `src/web/styles/prose.css` (`passage-flash`), `tests/scroll-settlement.test.ts`,
`tests/block-flash.test.ts`, `tests/trajectory-panel.test.tsx`, and the postmortem
`docs/postmortems/260928c-a-scroll-aimed-at-a-pixel-not-at-the-element.md`. The Abstract half of
the commit was reviewed separately. Plan: § "Stage 7" in
`docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md`.

The bug (reproduced in Playwright): a Trajectory step to a stop below the current one settled ~86px
too far because the "Next stop" door moved out from above the target after `scrollToBlock` measured
it. The fix makes the shared glide re-measure the element every frame. **This changes scrolling for
every caller** — `beginJump`, the arrow keys, swipe, comment jumps, Reader, `useReadingPosition`
(including restore-on-load and rotation), Trajectory.

Attack:

1. Regressions in the shared helper: a user wheel/touch mid-glide still cancels and is never fought;
   a target that keeps moving (images loading, a streaming band growing) — does the glide chase for
   ever, overshoot, or oscillate? Is there a bound (time, frames) and does `settled` still mean
   "arrived where the element is"? The row replaced by React mid-glide (re-found by id?). The
   clamp to the page's max scroll while the page height changes. `useReadingPosition`'s restore on
   load and the rotation re-anchor (plan 260916a) — any double correction or fight with them?
   `?at=` written during the corrective frames?
2. The instant path's one correction frame: reduced motion users get a second jump? Is it
   skipped when nothing moved?
3. Cost: `getBoundingClientRect` per frame — a forced layout every frame of a glide; acceptable?
4. The flash on the quote's fragments: key correctness (`quoteMarkKey` vs what annotate.ts writes),
   quotes that span several fragments, a stop whose quote is not drawn (fallback), restart and
   held-behind-the-band rules with a passage.
5. **Close this gap, in scope**: a Trajectory row press goes through `beginJump` and still washes
   the whole block. Greg asked for the quote's words on every arrival. Give `beginJump` an optional
   passage (or let Trajectory's row press pass one) without changing any other caller's behaviour.
   Red-first.
6. The postmortem: is the class named right, is "introduced by 64595ca9" true, are the recommendations
   ranked by ease and value?

Run `npx vitest run tests/scroll-settlement.test.ts tests/block-flash.test.ts tests/trajectory-panel.test.tsx`
plus any keynav/swipe/comment-jump/reading-position test files (grep), and
`node --import tsx scripts/typecheck.ts`. Fix inside stage 7, red-first; report anything wider. Do
not commit. Severity P0–P3; IDs from **F90**. Verdict: accept / accept after fixes / reject.
