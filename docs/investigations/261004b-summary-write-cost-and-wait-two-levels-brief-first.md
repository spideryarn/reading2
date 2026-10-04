# What a Summary write costs and how long each level takes, with two levels and Brief first

Up: [investigations.md](../project/investigations.md) · the work:
[261004f](../plans/261004f-stop-writing-the-simple-summary-level.md) · the mode:
[summaries.md](../project/summaries.md)

Measured 2026-10-04, on the box, against the local database. This is a signpost and a statement of
what the numbers can bear. The tables themselves are in the plan's Ledger (§ *Cost and wait,
measured* and § *Stage 2: cost and wait, measured*) and are not repeated here.

## What was asked

1. Does dropping the hidden middle level make a write cheaper or faster?
2. How long does a reader wait for Brief, and for Fuller, once Brief is shown first?
3. Does asking Fuller for about 500 words, not 350, make the wait longer?

## How

`evals/simple/probe.ts`, which calls production's `generateSimpleSummary` and prices each write
from the ledger. Opus, the fidelity guard on, no reader profile. Three articles of 8.6k to 12.6k
body words, the three written at once, as the earlier arms were. Two passes an arm, more than five
minutes apart so each starts from a cold cache.

| arm (under `evals/results/simple/`) | what it is |
|---|---|
| `high-none-fbazc1`, `fbazc2` | three levels, Fuller at 350 (from 261004a; the "before" of question 1) |
| `high-none-nosimple1`, `nosimple3` | two levels, Fuller at 350 |
| `high-none-nosimple2` | the same inside the cache's five minutes; kept apart |
| `high-none-timed350a`, `timed350b` | two levels, Fuller at 350, with each level's ready time |
| `high-none-timed500a`, `timed500b` | two levels, Fuller at 500, with each level's ready time |

## What it shows

1. **Cheaper by about 16%, not faster.** $0.256 to $0.216 a cold write. A cold write is mostly the
   one cache write of the article, which both shapes pay.
2. **Brief is final at 12 to 26 s; Fuller at 24 to 64 s.** In all twelve timed writes Fuller was
   last, and the two slowest had Brief at 12 and 13 s.
3. **The longer Fuller was not slower in these writes** (median 35.6 s at 350, 34.7 s at 500), and
   came back at 438 to 513 words.

## What it does not show

- **That the longer Fuller is free.** [261004a](261004a-summary-fuller-longer-and-bold-and-bullets-prompt-eval.md)
  measured 55 s for it. Fuller's wait moves by tens of seconds from one write to the next at
  either length; six writes a side cannot see a difference smaller than that.
- **What a reader in production waits.** These are direct calls. One real press through the job, in
  a browser, on a fourth article: Brief at 26 s and Fuller at 56 s. One sample.
- **Anything about a short article**, below the cache floor, where the two calls run together.
- **Anything about quality.** The 500-word prompt is the one 261004a's fidelity pass judged; it was
  not judged again.

## What was decided from it

The middle level is gone, Brief is shown as soon as it is final, and Fuller is asked for about 500
words. Greg's decisions and their wording are in the plan and in
[summaries.md](../project/summaries.md).
