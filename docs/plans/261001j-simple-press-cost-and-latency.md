# One Simple press, one article cache: Fuller first, the other two once it has begun

**Status as of 2026-10-01:** spiked and measured; built (the stagger and `MeteredCall.onStart`).
Streaming to the reader is not built; it is a decision for Greg, with numbers, in § Streaming.

Part of [summaries.md § Simple](../project/summaries.md#simple-a-plain-words-orientation). The
Overseer's second stage of the 261001i session, from Greg:

> re Simple summary cost. Yes, we definitely want to reduce costs, and should be using
> prompt-caching where you can. And perhaps generate all 3 of those summaries at the same time with
> one call (probably most complex first)? I suppose the only downside to doing that is latency. I
> don't suppose we could stream the output? If that's more complicated than it's worth, maybe
> generating all 3 at the same time, but with prompt caching is the way to go? Use your judgment
> (and perhaps run spikes) to trade off cost, latency, complexity, etc and look for a
> best-of-all-worlds.
>
> — Greg, 2026-10-01

## The finding that decides most of it

**A lone Simple press cached nothing.** Each of its three calls (Brief, Simple, Fuller) sends the
whole article, about 18,500 tokens on the PID paper. The article is marked for caching only when
`cacheArticleForStep` sees another step in the same job sharing it, and Simple's own three calls do
not count. So a press paid for the article three times. Marking it is not enough on its own either:
three calls fired together each pay the 1.25x cache *write*, because an entry cannot be read until
the request writing it has begun ([prompt-caching.md § What breaks a cache](../project/prompt-caching.md#what-breaks-a-cache),
point 4). Measured below: marked-and-together is the most expensive arm.

## What was measured

[`evals/simple/fanout-spike.ts`](../../evals/simple/fanout-spike.ts) builds each arm from production's
own pieces: the level prompts, the article rendering, `streamMessage`, `buildLevel` and the fidelity
checker. Each press is three levels at `high`, no profile, no retries, run one at a time. The
articles are the PID paper (3 runs) and two controls, Olah's *A4* and Gwern's *Scaling Hypothesis*
(2 runs each): 7 presses an arm, $5.4 in all.

**Cold, or the numbers lie.** The first batch's cached arms mostly read a cache an earlier run had
left, and looked cheaper than they are. The second batch opens every press with its own one-line
marker, so no press can read another's cache. Only the cold arms count below; the warm ones are in
the results directory and the report, labelled.

| arm (7 presses each) | $ a press | first level ready, median | all three, median · worst | valid | flagged by the guard |
|---|---:|---:|---:|---:|---:|
| **today**: three together, nothing marked | 0.142 | 7.4 s | 14.2 s · 18.2 s | 21/21 | 5/21 |
| three together, article marked | 0.172 | 6.3 s | 12.3 s · 40.6 s | 21/21 | 4/21 |
| staggered on Fuller's first text | 0.088 | 10.5 s | 17.0 s · 28.8 s | 21/21 | 4/21 |
| **staggered on Fuller's stream start** | **0.090** | 10.8 s | **16.2 s · 20.3 s** | 21/21 | 5/21 |
| one call for all three (warm cache) | 0.112 | 40.7 s | 45.6 s · 133 s | 21/21 | 1/21 |

Times exclude the guard, which adds one quick check (3.5–5 s) after each level in every arm alike.
"Ready" is when that level's text is complete.

- **One call for all three is out**, on latency, as 261001b found for two: reasoning rose from about
  1,100 tokens a press to 4,300, and the wait to 17–133 s. Streaming it would not help: nothing is
  visible while it thinks, and the first level was complete only 4–5 s before the last.
- **Marking without staggering costs more than doing nothing**: three cache writes, no reads.
- **Staggering cuts a press by about 37%** ($0.142 → $0.090), for about 2 s more median wait. The
  two later calls read the whole article from the cache in every cold press.
- **Start versus text** came out close, because on this route `message_start` arrives late: 3–7 s
  in, usually just before the first text. Seven presses an arm cannot tell the two apart (the worst
  cases, 20.3 s and 28.8 s, are as likely noise as anything). Start is the trigger because it is
  mechanically never later than the first text, and it is the earliest point the cache can be read.
- **Quality does not move.** Every level of every arm was valid, and the guard flagged a similar
  share (4–5 of 21, nearly all on the PID paper, as 261001h predicts). The per-level prompts are
  unchanged; only what is cached changes.

**One real press through production** after building it (`evals/simple/probe.ts`, arm
`high-none-stagger1`): Fuller wrote the cache, the other two started 4.9 s later and read all 18,489
article tokens, and so did both retries (Brief after a flag, Simple after failing validation). The
first three calls cost $0.090, as the spike said; the retries took the press to $0.122.

## What is built

- **`src/simple-summary.ts`**: when the article clears the model's cache floor (`underCacheFloor`),
  the article is marked, `FIRST_LEVEL` (Fuller, the slowest to write) is asked first, and Brief and
  Simple wait until its stream begins. If its call ends without beginning, they go then. If it
  *fails* before beginning, the press is lost anyway, so they wait for the abort instead of opening
  two billed calls into it (Sol's plan review, P1; the first build let them). Below the floor
  nothing can be cached, so the three go together, unmarked, as before.
- **A job that already marks the article** (`cacheArticle`, when another step shares it) still
  staggers. If an earlier step, FAQ say, has already warmed the cache, that costs the 3–7 s wait
  for nothing. Ordinary presses run Simple alone, so this is left as it is; skipping the stagger
  needs knowing the cache is warm, which `cacheArticleForStep`'s own comment explains nobody can.
- **`MeteredCall.onStart`** in `src/messages-stream.ts`: once, on `message_start`. Additive, no
  other caller changed. The Overseer agreed it before it was written.
- Retries — the guard's and validation's — read the same cache at a tenth of the price, once
  something has written it.

**Passed over:** a separate tiny "warm-up" call to write the cache before all three (an extra call and
ledger row for the same saving), and changing which level goes first by what the reader pressed (the
press stores all three before anything is shown, so order only moves the total, and the slowest
first keeps it lowest).

## Streaming — for Greg

CLAUDE.md says to stream any call a reader waits on, and Greg asked. Simple does not stream today:
a press runs as a job and the panel shows the three levels when the job has stored them (260930i §
*A departure from CLAUDE.md*). **The new fidelity guard is the complication.** It reads a level only
once it is complete, and a flag rewrites the level. How often: on the PID paper a third of levels
were flagged, with at least one flag in 5 of 6 presses (261001h); on the two controls, about one
level in fifty.

**The wait, measured** (cold, staggered; medians; the check adds about 4 s to each level):

| | Brief | Simple (the default) | Fuller | all three |
|---|---:|---:|---:|---:|
| text complete, today's three-together | 7.4 s | 9.9 s | 13.7 s | 14.2 s |
| text complete, staggered | 11.8 s | 16.2 s | 13.2 s | 16.2 s |
| … and checked, no retry | ~16 s | ~20 s | ~17 s | ~20 s |
| one real press with two retries (PID paper) | | | | 37 s |

So a press with no retry shows its words at about 20 s, and on the PID paper, where most presses
have a retry, 30–40 s is normal: a retry is another writer call (5–14 s) and another check.

```
1. no streaming (built):
   press ── Fuller ─┬─ Brief, Simple ── checks ── [retry, check] ── all three shown
                    └ cache                        ~20 s, ~30-40 s with a retry

2. stream the words as written:
   press ── first words ~6-10 s ── level complete ── check ── flagged? ── rewritten in place
                                                              1 in 3 levels on the PID paper

3. show each level once it has passed its check:
   press ── the reader's level first ── checked ── shown ── the other two follow
            nothing shown is ever taken back
```

1. **No streaming (built).** About 20 s to the first words with no retry, 30–40 s with one. Nothing
   shown is ever replaced. No more work.
2. **Stream the words.** First words at about 6–10 s. But on the papers the guard exists for, one
   level in three would be visibly rewritten under the reader, or shown unchecked. It also needs a
   streaming route beside the job and a client to read it: days, not lines.
3. **Show each level once it has passed its check.** Only worth building with the reader's chosen
   level asked *first* (and the stagger on it), which changes `FIRST_LEVEL` from a constant to the
   press's choice. The default Simple level would then be ready at about 14 s rather than 20 with no
   retry, and nothing is ever taken back. It needs the job to publish a level at a time and the
   panel to show a partly written press: smaller than 2, still a client change.

**Recommendation: 1 now, 3 if the wait proves too long in use.** 2 buys the most seconds, but on
exactly the papers where the guard matters it would show a reader a claim and then take it back.

## Reviews

- Plan: [261001j-simple-press-cost-and-latency-plan-review-sol.md](261001j-simple-press-cost-and-latency-plan-review-sol.md).
  No P0; "revise, keep the core choice". Taken: P1, a first call that fails before it begins no
  longer lets the other two open billed calls (with a test that saw it happen); P1, the streaming
  section's flag rate, retry case and per-level times corrected, and option 3 tied to asking the
  reader's level first; P2, no tail claim for start over text; P2, cache reads are a tenth of the
  price, not free. Noted, not changed: P2, a job with an already-warm cache still staggers.
