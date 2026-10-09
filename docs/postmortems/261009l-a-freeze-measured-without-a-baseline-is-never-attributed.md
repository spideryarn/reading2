# A freeze measured without a baseline is never attributed

Up: [postmortems.md](../project/postmortems.md) · plan:
[261009r](../plans/261009r-excerpts-measured-in-chrome-search-list-stall.md) · the change:
[261009k](../plans/261009k-excerpts-keep-maths-and-formatting.md)

261009k drew every excerpt outside the prose from its block's markup, so maths stays maths. Its own
browser check saw a Search for "the" in BERT (588 hits) freeze the page for 1–3 s, wrote down
*"There is no baseline with the old code, so how much of that is this change is not known"*, made
the code 4× faster **in jsdom**, and landed. Measured afterwards in Chrome, one tree, five runs each,
that change had added **about 1.0 s** to the longest freeze (1,787 → 2,808 ms median), on top of a
freeze of about 1.8 s that was already there. **It reached readers**: the Overseer held one
deploy until these numbers came in, and 261009k then went to production at 17:54 UTC on 2026-10-09
(`8bd1e67bd`, `dpl_D9L7e5ugBCusggMgACwBcrgCcZo9`), as a known regression only on a search with
hundreds of hits. It lasts until the fix in 261009r is deployed.

Commit `3488ca196` introduced formatted excerpts to every Search row; the surrounding 261009k work
landed across `ec92f91ea`, `3488ca196` and `1cd753d1e`.

## What happened

The browser check did its job: it looked, and it saw a freeze. What it could not do was say whose
freeze it was, because it had one number and nothing to compare it with. A freeze of unknown cause
in a feature that had just been rewritten could be the rewrite or could be the list. "Not known"
was written down honestly, and then treated as "probably fine". The jsdom optimisation that followed
was real, but jsdom is not a browser. It does no style, layout or MathML layout. A CPU profile of the
slow run later put only about 130 ms of the extra time in the excerpt code's own JavaScript. It did
not assign the rest; the 1,245 extra nodes, 99 of them MathML, make browser parsing, styling and
layout a plausible source rather than a measured one.

## The class: a cost seen without a baseline is filed as "known", not as "unexplained"

Once a number is written down, it feels handled. But a number with no comparison answers neither
question a reviewer needs, *is this new?* and *is this mine?*, so the defect stays exactly as
undetected as if nobody had looked. The tell is the sentence *"how much of that is this change is
not known"*. It was the moment to measure the commit before. It is a sibling of
[silent-success.md](../reusable/silent-success.md): the check ran, produced output, and the output
was taken as a verdict it never gave.

## Why nothing went red

- **The browser check** measured only the new code. It recorded the freeze, as it should have, but
  without a baseline the freeze was not a finding.
- **The jsdom benchmark** (765 → 197 ms) was measured in the environment that leaves out the
  expensive part. A real speed-up there was taken as evidence about Chrome.
- **GPT Sol's code review** saw the diff, the jsdom numbers and the browser-check prose. It
  questioned nothing about cost, because nothing in front of it was a comparison.
- **The tests** pin what an excerpt draws, not what drawing 588 of them costs. Nothing in the suite
  measures time, rightly.

## What would have caught it, ranked by ease against value

1. **When a check sees a cost and cannot say whose it is, measure the commit before, before
   landing.** [performance.md § Comparing a change against `main`](../project/performance.md#comparing-a-change-against-main)
   already had the two-tree recipe. 261009r adds the cheaper form that was used here: one tree, a
   temporary switch between the old and new draw, alternating runs, so the 26 other commits and the
   fonts are the same on both sides. A line in performance.md now says so. Done.
2. **Never cite a jsdom timing as evidence about a browser**, only about the JavaScript inside it.
   Folded into the same line.
3. **A performance test in the suite** — rejected. A timing test on a shared box with a load average
   of 12–17 is either flaky or so loose it catches nothing. The class is a missing comparison, not a
   missing test; `tests/search-excerpt-lazy.test.tsx` pins the *mechanism* (no row is formatted
   before it is seen) instead, which a test can hold.

## The fix that is right for the long term

What shipped: a Search row draws its words as the plain string until the row comes near the screen,
and formats them then (`src/web/when-seen.ts`, `Excerpt`'s `lazy`). This brings the median longest
freeze back to within about 0.1 s of the old strings. The median fast-scroll run had no long task;
the recorded maximum was 111 ms. It does nothing about the older 1.8 s, which includes React
creating 588 rows; capping or windowing that list is a product call left for Greg in the plan.

## The thing I would tell myself

When you write "not known" next to a number, you have found the next thing to do, not the end of
the job. The commit before was one `git worktree add` away, and the comparison took ten minutes.
