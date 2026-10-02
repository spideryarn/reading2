# Simple on Opus, with and without the fidelity guard

Research write-up: [docs/research/261002c-simple-fidelity-guard-prompt-rules-failed-luna-checks-opus-writes.md](../research/261002c-simple-fidelity-guard-prompt-rules-failed-luna-checks-opus-writes.md).

**Status, 2026-10-01:** measured; decided **(b) Opus with the checker kept**; built and on `dev` in
ef04cfd5 (merged as 2a573770), see § What ships. Not deployed: the Overseer deploys.

Simple (Summary's plain-words levels: Brief · Simple · Fuller) is written on Sonnet unless the
article has High-powered AI on. On the PID paper (`entropy-24-00930-spya-pywwkq`) Sonnet borrows the
paper's word for one kind of connection ("feedback") to name another (recurrent), turning a finding
around, in 6 of 18 levels ([261001h](261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md)).
The fix that shipped is a quick-tier checker that reads each paragraph beside its cited passages and
buys one rewrite on a flag ([261001i](261001i-simple-fidelity-guard-built.md);
[summaries.md § The fidelity guard](../project/summaries.md#the-fidelity-guard-since-2026-10-01)).
Greg asked whether a bigger model would do better, with or without the check, and on
[Q-simple-opus-test] said, 2026-10-01:

> A yes and then make your own judgment about what's best, proceed autonomously

## The outcome, first

| per press, PID paper unless said | Sonnet (today) | Opus 5.5 |
|---|---:|---:|
| term swaps, hand-scored (261001h's rubric) | **5 / 18** levels (4 of 6 runs) | **0 / 36** (0 of 12 runs) |
| … states the recurrent finding at all | 17 / 18 | 22 / 36, every time correctly ("more links between the two inputs meant more synergy") |
| checker flags, PID | 6 / 18 levels (5 of 6 presses) | 2 / 36 (both borderline, neither a fault) |
| checker flags, Olah + Gwern | 1 / 36 (borderline) | 1 / 36 (**a real fault**) |
| blind read by GPT Sol, 27 levels each across all three articles: major · minor · clean | 3 · 2 · 22 | 0 · 1 · 26 |
| writer cost, warm cache: median | $0.052 (PID) · $0.057 (controls) | $0.100 · $0.104 |
| writer cost, cold (first press on an article) | $0.094 | $0.181 |
| writer wall time, three levels: median · max | 17.2 s · 19.2 s (controls 17.9 s · 82.9 s, one outlier; next 32.1 s) | 19.6 s · 26.6 s (controls 20.3 s · 27.6 s) |
| first token of the first level (the stagger's wait), read once from the local `ai_calls` start times of the first three presses, not saved | ~3.3 s | ~5–7.5 s |
| words, Brief · Simple · Fuller (prompt asks 100 · 170 · 220) | 154 · 212 · 306.5 | 121 · 184 · 237 |

**Decision: (b), Opus writes Simple for every article, and the checker stays.** Opus did not make the
fault Simple was guarded for in 36 levels where Sonnet made it in 5 of 18. It still made a fault
elsewhere that the checker caught, so the checker earns its place. And on the paper where the
checker matters most, it now fires on about one press in six, not five in six, so the ~15 s retry
mostly goes away.

## What was measured

Production's `generateSimpleSummary` through [`evals/simple/probe.ts`](../../evals/simple/probe.ts),
with two new flags: `--power high` (Opus, chosen by `modelFor("simple", "high")`, the High-powered
AI path, no hardcoded id) and `--guard off` (the writer alone). `high` effort, no profile, all three
levels a run, the prompt unchanged from 261001h's arms (`SIMPLE_VERSION` `simple/2`; the system
prompts hash the same as `pidpost`).

- `high-none-opus1…12`: Opus on the PID paper, 36 levels.
- `high-none-sonnetnow1…6`: Sonnet on today's code, so cost and latency compare like for like. The
  old `pidpre` baseline predates the 261001j stagger and the shared cache.
- `high-none-opusctl1…6`, `high-none-sonnetctl1…6`: both on Olah's *A4* and Gwern's *Scaling
  Hypothesis*, 261001h's controls. Neither is a contrasting-terms trap; 261001h and 261001i have no
  second such paper, so these measure faults in general and the checker's firing rate.

**Scoring the trap.** [`term-swap.ts`](../../evals/simple/term-swap.ts), then every sentence about
feedback, loops, recurrence, wiring or linking read by hand against `spya-sd9fzd` and `spya-xs5660`.
The screen found nothing in Opus's 36 levels because Opus never uses those words. The hand read
found the recurrent finding in 22 Opus levels, every one correct ("synergy also rose when the two
input neurons were linked to each other"; "trios whose two senders were also linked to each other
had up to 50% more"; "more links between the two inputs meant more synergy"). My first count, 8,
came from a regex that missed "links between"; Sol's review recounted 18 and a second pass found 22.
The other 14 leave the finding out, which an orientation is allowed to do.
Sonnet's 5 are all *"feedback loops between source neurons"*, the clear swap; its *"connections
looping back between source neurons"* (three levels) is scored as 261001h scored it, not a swap.

**The checker on the new text.** [`scripts/probes/261001p-check-saved-levels.ts`](../../scripts/probes/261001p-check-saved-levels.ts)
sends every saved level to production's own `checkLevel`, as a press with the guard on would.
156 calls, [results](261001p-check-saved-levels.jsonl). Each flag was read by hand:

- **Opus, PID, 2 flags:** both on *"synergy peaked when the inputs' activity was moderately
  similar"* / *"overlapped a little, about 7% of the most possible"*, against `spya-ybmve2` (peak at
  7% of maximal mutual information). Fair plain readings; the same wording passed unflagged in
  Sonnet's levels. Borderline alarms, not faults.
- **Sonnet, PID, 6 flags in 18 levels, on 5 of 6 presses:** 4 of its 5 swaps (it missed the Brief
  in `sonnetnow3`), plus *"experiments in behaving monkeys"* and *"rich-club neurons"* rather than
  triads, both borderline. Separately, the older `pidpre` arm re-checked with the shipped checker is
  also flagged on 6 of 18 levels.
- **Opus, Gwern, 1 flag, real:** *"agency … may appear even in models trained without human data"*;
  `spya-msngfz` says *"even in settings free of selection or optimization"*.
- **Sonnet, Olah, 1 flag, borderline:** *"impossible to blend partway between two items"* against
  *"you also generally can't represent objects 'between' these features"*.

**The blind read.** Runs 1–3 of each model on each article, every level, 54 in all, shuffled under
neutral keys by [`scripts/probes/261001p-blind-packet.ts`](../../scripts/probes/261001p-blind-packet.ts)
and judged by GPT Sol against the whole article, not only the cited passages:
[prompt](261001p-blind-read-prompt.md), [answer](261001p-blind-read-sol.md). The key stayed out of
the tree it could read. Unblinded, Sonnet's 3 majors are the three swaps in those runs, and its
minors are *"new recording technology has fixed the first problem"* (the article: *"abated
considerably"*) and *"surprised its own creators"* (GPT-3). Opus's one minor: rich clubs as
*"the busiest cells"* where the article defines them by connectivity. **Sol marked the Opus Gwern
level clean**, the one the checker flagged and I judge a real fault, so the blind read is not
exhaustive either: it and the checker each caught something the other did not.

**Not measured:** a retry's outcome on Opus (too few flags to sample), any article beyond these
three, profiles or goals (261001h found the fault commonest with no profile, so that is where it was
measured), and Opus at any effort but `high`.

### What the numbers support, and what they do not

- **0 of 36 is not 0.** Its exact 95% upper bound is about 10% of levels. Against Sonnet's 5 of 18 here (11
  of 36 with `pidpre`), Fisher's exact test gives p ≈ 0.003 (p < 0.001 pooled). That is strong
  evidence that Opus makes this fault less often on this paper. It is not evidence that Opus never
  makes it, and it is one paper.
- **Some of the difference is omission, most is not.** Opus mentions the finding in 22 levels of
  36, Sonnet in 17 of 18, so 0 swaps in 22 mentions against 5 in 17. In every mention Opus avoided
  the paper's terms ("linked to each other", "links between the two inputs") rather than naming
  the contrast, so the evidence is "Opus sidesteps the trap", not "Opus names the contrast". Where
  it does leave the finding out, that is the safe failure for an orientation: a reader who misses a
  finding can read the piece; a reader told it backwards cannot tell.
- **Opus is not fault-free**: one real fault on Gwern, which the checker caught. That settles (c).

## The decision

The four options, against the numbers:

- **(a) Sonnet + checker, as now.** About $0.055 a warm press plus retries. On the PID paper the
  checker flags about 1.0 level a press, so ~$0.02 more and ~15 s more on 5 presses in 6, and with
  four of five swaps caught and a retry an independent sample, roughly 1 level in 9 still ships the
  swap (a pooled projection, `1/18 + 4/18 × 5/18`; not a measured retry outcome). On ordinary articles it is the cheapest and quickest option.
- **(b) Opus + checker.** About $0.10 a warm press ($0.18 cold); the checker fires on about 1 level
  in 18 on the trap paper and 1 in 36 on the controls, so retries are rare. ~2.5 s slower than Sonnet
  on an ordinary press, faster than (a) on a press that retries. Fewest faults measured. Levels
  nearer their word targets.
- **(c) Opus, no checker.** Saves $0.003 and ~4 s. Rejected: Opus made a real fault on Gwern that
  only the checker caught, and the brief's bar, *"don't drop the checker unless Opus shows 0 faults
  across enough runs that you'd defend it to Sol"*, is not met.
- **(d) Something else that beats these.** Considered: passing the checker's reason to the retry
  (261001h's follow-up) would make (a) better at catching, but it is a prompt change of the kind
  261001h found noisy, and it leaves the retry latency. Nothing measured beats (b) on faults.

**Chosen: (b).** The reasoning:

1. **Simple's failure mode is the one its readers can least spot.** A reader who chose plain words
   is the reader least able to tell that "feedback" should have been "recurrent". The measured major
   fault rate goes from 3 in 27 to 0 in 27 (blind), and on the trap from 5 of 18 to 0 of 36.
2. **The cost is small in absolute terms and ours, not the reader's.** About +$0.05 a press (+$0.09
   cold), once per article. A reader's allowance counts articles, not money, so this comes out of
   margin and buys nothing a reader is charged for. Against an article's processing it is a few
   per cent.
3. **Latency is a wash.** About 2.5 s slower on an ordinary press, about 15 s faster on a press that
   would have retried, and the retries are on exactly the articles where faults happen.
4. **The checker stays**, so a fault Opus does make still costs only a retry.

**What this gives up.**

- **High-powered AI no longer changes Simple**: it is Opus either way. The switch is priced as
  *"double the processing cost per-article"* (Greg, 2026-09-30, [high-powered-ai.md](../project/high-powered-ai.md)),
  so this hands every article one stage of what that switch sells. Simple is one stage of ~20 and
  pressed once, so the switch keeps most of its meaning; but it is a pricing call and it is Greg's to
  reverse. Reversing is one line (§ What ships). **Decided 2026-10-01, keep it:** Greg, *"yes
  let's switch to the better/safer version for everyone"* (Q-simple-high-power).
- **Opus says a little less.** Its levels are shorter, and it leaves out findings Sonnet includes
  (this one in 14 levels of 36, against 1 of 18). Nearer the word targets Greg asked for (7J, 7F),
  but less in them.
- **One more exception in the tier table.** Simple is the only capable-tier task that ignores the
  article's power.

**Sol's view on the decision** is in § Reviews.

## What ships

- **`ALWAYS_HIGH_POWER` and `powerFor(task, articlePower)`** in [`src/models.ts`](../../src/models.ts),
  holding `simple`. The `simple` step in [`src/pipeline.ts`](../../src/pipeline.ts) passes
  `powerFor("simple", ctx.power)` rather than `ctx.power`, and `GET /api/models` reports each task
  through `powerFor` too, so the "what's running" page names the model the call sends (Sol's P1;
  the first build put the constant in `simple-summary.ts`, where the route could not see it).
  `generateSimpleSummary` keeps its required `power` so the probe and tests still choose. The stamp
  is unchanged: `generationKey` already treats Sonnet and Opus as one generation, so no stored
  summary goes stale and is paid for again (`tests/high-power-models.test.ts` already proves it).
- **Two tests**, both seen red with the set emptied and green with `simple` in it: the step sends all
  three writer calls at high power for an article whose power is standard, and stores an Opus
  `generator` (`tests/simple-summary.test.ts` § the step); `GET /api/models` reports Simple on the
  high-power model (`tests/authenticated-api-route-contract.test.ts`).
- **Copy:** the High-powered AI switch on `/metadata` and the line on `/features` say plain-words
  summaries are on Opus already (Sol's P2). `/pricing` says "a stronger AI model" for one article,
  which stays true.
- **The probe's two flags**, recorded on every result file (`power`, `guard`). Without `--guard`
  the probe does what a press does, which it has silently done since 261001i turned the guard on.
- **Docs:** [summaries.md § The fidelity guard](../project/summaries.md#the-fidelity-guard-since-2026-10-01)
  gets these numbers; [high-powered-ai.md](../project/high-powered-ai.md) says Simple is always on
  Opus; 261001h's and 261001i's open lines are closed.

**Unchanged:** the checker (quick tier, `SIMPLE_CHECK_ENABLED`), the prompt and `SIMPLE_VERSION`,
and the 261001j stagger. The stagger was exercised on Opus in every run above: within a press, the
first call writes the 18,489-token cache and the other two read it, started on its `message_start`
(`ai_calls`, 17:20–17:22).

## Spend

$4.00 in all: $1.31 (Opus, PID) + $0.35 (Sonnet, PID) + $1.38 (Opus, controls) + $0.81 (Sonnet,
controls) on writers, from each result file's `costUsd`, and $0.14 on 156 checker calls, from the
collector's records. Within the $5–10 budget. The blind read and the reviews were on Sol's
subscription.

## Reviews

- **Plan and decision:** [261001p-plan-review-sol.md](261001p-plan-review-sol.md). No P0. Sol would
  choose the same: *"I would still choose Opus + checker … the known Sonnet failure is major, hard
  for Simple's intended reader to detect … Removing the checker is not justified because it
  uniquely caught the real Gwern fault. The High-powered AI product overlap is real but small enough
  to handle honestly in the copy."* All taken: `/api/models` reporting Sonnet (P1, fixed in
  `models.ts`, with a test); the mention count (P1: Sol counted 18, a second pass 22, not 8 — this
  strengthens the decision); the Sonnet flags, 6 of 18 not 7 (P1); the copy (P2); the 82.9 s
  outlier, the 306.5 median and the unsaved first-token figure (P2). It recounted and confirmed the
  hand scores, the blind tallies, the Fisher values, the bound, the residual and the spend.
