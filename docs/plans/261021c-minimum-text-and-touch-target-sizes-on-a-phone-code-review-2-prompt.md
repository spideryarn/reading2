# Code review round 2: minimum text and touch-target sizes (261021c)

You reviewed and fixed this stage once (C1–C3, see
docs/plans/261021c-minimum-text-and-touch-target-sizes-on-a-phone-code-review-sol.md). This round is narrow:
only what changed after your review, in commit `ac1829de1` beyond your own C1–C3 edits
(`git show ac1829de1 -- src/web/styles/mode-band.css src/web/styles/reception.css src/web/styles/footnotes.css
tests/chat-latest-pill-in-flow.test.ts tests/chat-send-is-the-primary-control.test.tsx`), plus the merge of
origin/dev that followed it (`git diff ac1829de1 HEAD --stat`; it brought in plan 261021b, Investigate's
thread continuity, which touched chat code).

1. mode-band.css: a coarse-pointer rule raising `.chat-composer .chat-send, .chat-composer .prof-mic` to
   `max(40px, var(--control-h))` square and `.chat-live-btn`/`.chat-live-arrow` height. Does it lose to a
   later or more specific rule (Learn's `.learn .chat-send`, quiz's `.chat-send.quiz-go`, any composer rule
   in another sheet loaded after mode-band.css)? Does a 40px Send break Learn's or Quiz's composer layout?
2. reception.css `.rcp-view-count`: now `max(var(--text-min), 0.9em)`. Right?
3. The two test edits: did either weaken what the test protected? The pill test now ignores
   `.chat-to-bottom` rules nested in an at-rule when it looks for "the shared rule".
4. Did 261021b add any font-size, `tw:text-[…]` or small control that this stage's guard or 40px rule
   should cover? Run `npx vitest run tests/minimum-text-size.test.ts tests/chat-latest-pill-in-flow.test.ts
   tests/chat-send-is-the-primary-control.test.tsx tests/tap-target.test.tsx`.

Fix what is inside this stage, narrowly; report anything wider. Findings as D1, D2…, severity P0–P3,
file:line, fixed or not. If you find nothing, say so explicitly.
