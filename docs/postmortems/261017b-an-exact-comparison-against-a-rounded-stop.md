# An exact comparison against a rounded stop

**What happened.** The browser check for
[261017f](../plans/261017f-threshold-sliders-jump-between-the-values-that-change-the-count.md)
stepped a real glossary's slider with the arrow keys and saw `1@0.28, 1@0.30`. That is a stop that
changed nothing, which is the very thing the plan exists to remove. The term Millikan scores
`0.4 × 0.7`, which is `0.27999999999999997` in a double. It is printed as `0.28`, and its stop is
`0.28`: `floorToGateStep` rounds the quotient to nine places before it floors, so it can land a hair
*above* its argument. `survivesThreshold` then compared the raw score exactly (`score >= t`), and the
term vanished at the threshold printed beside it.

## 1. The root cause

Two functions answered one question, "is this score at least this bar?", at two precisions.
`floorToGateStep` was made float-tolerant (its comment says why: `0.58 / 0.01` is
`57.99999999999999`). `survivesThreshold` was not. Each was right on its own terms, and they
disagreed by one ulp exactly where a product of two decimals falls short of the decimal it prints
as.

## 2. The class

**One comparison, two precisions**: a value made tolerant of float error in one place, and checked
exactly against that value in another. The tolerant side stops being able to promise anything, and
here it broke a comment that said so: *"Never above its argument: the item a number was computed
from always survives that number."*

## 3. The commit that introduced it

Latent since `1b3f4258b` (2026-09-03, *The threshold sliders hide what is below them*), which gave
the sliders an inclusive `>=` beside a rounded track. Before 261017f the window was hard to hit: only
`thresholdTop` (the track's right-hand end) produced a rounded value, and a top term hidden at the
far right was easy to miss. Making every score a stop made every product a chance to hit it.

## 4. The right fix

Shipped: the bar is inclusive by `1e-9`, the same scale `floorToGateStep` rounds at
(`SCORE_EPSILON` in `src/web/threshold.ts`). It covers every caller, it matches what the reader
sees printed, and it is far below any score's real precision. The alternative was to floor the stop
strictly below the score (`0.27`). That keeps exact comparison but prints a threshold under the
score on the row, which is the "printed `0.28`, gone at `0.28`" confusion `survivesThreshold`'s
own comment rules out.

## 5. What would have caught the class, ranked

1. **A test that uses a product, not a literal.** `tests/threshold.test.ts` checked `0.3` against
   `0.3`, a literal that is exactly itself. `0.4 * 0.7` against `0.28` fails, and is now there.
   Being done.
2. **Habit: when one side of a comparison is rounded with a tolerance, give the other side the same
   tolerance, in the same module.** Costs nothing. It would have flagged this at `1b3f4258b`.
3. A property test over random products of two-decimal scores, asserting that every stop changes the
   count. Worth it only if this class turns up again; the two lines above cover the known shapes.
