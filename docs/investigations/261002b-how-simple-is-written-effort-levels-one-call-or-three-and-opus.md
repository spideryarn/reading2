# How Simple is written: effort, the three levels, one call or three, the cache stagger, and Opus

Written 2026-10-02, after the fact, from the plans and result files below; nothing was re-run. It is
the working behind five decisions about Simple (Summary's plain-words levels, Brief · Simple ·
Fuller): `high` effort, a call per level, the word asks, Fuller-first caching, and Opus as the
writer. The plans are [260930i](../plans/260930i-simple-summaries-eli15-sub-mode.md),
[261001b](../plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md),
[261001j](../plans/261001j-simple-press-cost-and-latency.md) and
[261001p](../plans/261001p-simple-on-opus-with-and-without-the-fidelity-guard.md). The fidelity
checker, and the fault Opus was chosen to avoid, are in
[261002c](261002c-simple-fidelity-guard-prompt-rules-failed-luna-checks-opus-writes.md).

## Questions and what was measured

All runs are production's own `generateSimpleSummary` through `evals/simple/probe.ts`, on local
articles (the PID paper `entropy-24-00930-spya-pywwkq`, Olah's *A4*, Gwern's *Scaling Hypothesis*,
sometimes the Cargo Cult and Noema essays). Raw answers are under `evals/results/simple/<arm>/`;
`npx tsx evals/simple/tally.ts <arm>` prints any arm's table.

**1. Medium or high effort; pitched at 12 or 15** (260930i stage 1, 2026-09-30,
[evals/simple/results-260930.md](../../evals/simple/results-260930.md), 18 calls, about $0.70).
- `medium` and `high` cost and took the same: 10-12 s against 11-12 s, 2-5 cents, 680-920 output
  tokens. The plan's reason for `medium` (a shorter wait) did not hold. **`high` chosen.**
- On the PID paper both `medium` runs at 15, and both at 12, turned "recurrent connections" into
  "feedback loops"; one `high` run kept "recurrent". This is the first sighting of the fault in
  [261002c](261002c-simple-fidelity-guard-prompt-rules-failed-luna-checks-opus-writes.md).
  One article, one term: evidence, not a rate.
- The model runs about a third over any total it is given: "under 250" gave 261-339 words and two
  of three `high` runs failed the 320 ceiling. The v2 ask (about 200, sentences capped at 25) gave
  239-289.
- A twelve-year-old's pitch is shorter (190-208 words) and reads more simply but loses detail;
  fifteen shipped, with twelve a probe only (Sol's suggestion).

**2. One call for two or three levels, or one call per level** (261001b, 2026-10-01; the same
question again in 261001j for all three).
- Two levels in one call (`*-after1`): 11 of 12 valid, but reasoning rose from 150-800 tokens to
  1-15k and the wait from 9-18 s to 24-134 s.
- Three levels in one call (261001j spike, `evals/results/simple-fanout/one-call`): $0.112 a press,
  first level 40.7 s, all three 45.6 s median and 133 s worst. **Rejected on latency**; streaming
  would not help because nothing shows while it thinks.
- **A call per level, side by side, chosen.**

**3. The word asks and the gate** (261001b, `*-split`, `*-slider1..3`). Asks of about 100 / 170 / 220
words, ceilings 240 / 360 / 480. `slider2` was 12 of 12 valid, `slider3` 10 of 12; together 22 of 24
(92%), over the 90% gate. Cheap fix chosen over more prompt tuning: a level that fails validation
is asked once more (`LEVEL_ATTEMPTS = 2`). 261001b's blind read (a fresh Opus judge, shuffled
pairs, `evals/results/simple/judge-261001/`, scored by `evals/simple/judge-score.ts`): the profile
made Simple spend fewer words on what a CTO already knows in 5 of 5; the goal was recovered 11 of
12; the ladder Brief < Simple < Fuller held in 29 of 33 pairs. With no profile the new middle level
was judged easier in 1, the old in 3, the same in 2, so it is a shade less plain; that was accepted
as Greg's "fairly-simple" middle stop.

**4. Caching across the three calls** (261001j, `evals/simple/fanout-spike.ts`, 7 cold presses an
arm, about $5.4). Each call sends the whole article (about 18,500 tokens).

| arm | $ a press | all three, median / worst |
|---|---:|---:|
| today: together, nothing marked | 0.142 | 14.2 s / 18.2 s |
| together, article marked | 0.172 | 12.3 s / 40.6 s |
| staggered on Fuller's stream start | 0.090 | 16.2 s / 20.3 s |

Marking without staggering is the worst (three cache writes, no reads). **Chosen: Fuller first, the
other two when its stream starts**: -37% cost for about 2 s more wait. Start versus first-text could
not be told apart at this size. Cold arms only count; the warm ones in the results directory flatter
the cache. Greg's brief:

> re Simple summary cost. Yes, we definitely want to reduce costs, and should be using
> prompt-caching where you can. And perhaps generate all 3 of those summaries at the same time with
> one call (probably most complex first)? … Use your judgment (and perhaps run spikes) to trade off
> cost, latency, complexity, etc and look for a best-of-all-worlds.
>
> — Greg, 2026-10-01 (261001j)

**5. Sonnet or Opus as the writer** (261001p, 2026-10-01; `high-none-opus1..12`,
`-sonnetnow1..6`, `-opusctl`, `-sonnetctl`; $4.00 in all, of which $1.31 and $0.35 are the PID
Opus and Sonnet writers, which I re-summed from each file's `costUsd`).
- Writer cost per warm press $0.052 (Sonnet) against $0.100 (Opus); cold $0.094 against $0.181.
- Wall time for three levels, median: 17.2 s against 19.6 s. First token about 3.3 s against 5-7.5 s
  (read once from local `ai_calls`, not saved).
- Words Brief / Simple / Fuller: 154 / 212 / 306.5 on Sonnet, 121 / 184 / 237 on Opus (asks 100 / 170 / 220).
- The reason: the PID term-swap in 5 of 18 Sonnet levels against 0 of 36 Opus; 0 of 36 has an exact
  upper bound near 10%, Fisher p about 0.003. Details in 261002c.

## Decisions, and where they live

`high` effort, a call per level, retry once on validation, Fuller-first stagger, and **Opus for
every article** (a pricing call: it takes one stage of what High-powered AI sells). Greg, 2026-10-01
(Q-simple-high-power, quoted in 261001p): *"yes let's switch to the better/safer version for
everyone"*. Homes: [summaries.md § Simple](../project/summaries.md#simple-a-plain-words-orientation),
[high-powered-ai.md](../project/high-powered-ai.md); code in `src/simple-summary.ts` and
`powerFor` in `src/models.ts`.

## Dead ends and caveats

- Streaming Simple was not built; 261001j recommends no streaming now, "show each level once it
  passed its check" if the wait proves long (about 20 s with no retry, 30-40 s with one).
- A separate warm-up call to write the cache: an extra call for the same saving.
- Opus says less (it dropped the recurrent finding in 14 of 36 levels); Opus at efforts other than
  `high`, a retry's outcome on Opus, and articles beyond three were not measured.
- Sample sizes are small throughout (7 presses an arm, 6-12 runs); the T3 read is 6 pairs.
- 261001b's first draft said "23 of 24" and 261001j's first draft "2 of 11 failed"; both were
  recounted by Sol review and the corrected numbers are the ones above.

## Re-running

`npx tsx evals/simple/probe.ts run --arm <name> <slug>` (`--power high` for Opus, `--guard off` for
the writer alone); `npx tsx evals/simple/tally.ts <arm>`; the spike is `evals/simple/fanout-spike.ts`.
Each costs real money (about $0.05-0.20 a press).

Up: [research.md](../project/research.md)
