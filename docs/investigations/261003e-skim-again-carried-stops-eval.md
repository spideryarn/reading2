# Skim: does `skim/9` carry the right stops into the deeper passes?

Written 2026-10-03 for
[plan 261003l § Stage 2](../plans/261003l-skim-arrows-stay-in-the-band-and-stops-shared-across-depths.md),
run the same evening. This compares two prompts, `skim/8` and `skim/9`, on the same model
(`power: "standard"`, Sonnet) and the same stored Quotes and Ideas. Results are in
`evals/results/skim-coverage-2026-10-03T18-10-38*`.

**There were two rounds, the same evening.** Round one measured the first `skim/9` wording
(**NEW-a**) against `skim/8` (**OLD**). It found that a carried stop lands at the top of More as a
recap, so the prompt gained one paragraph telling the model to mix the depths in one order, and
round two measured that wording (**NEW-b**) against the same OLD routes. Sections 1 to 4 below are
round one, left as written. [Round two](#round-two-new-b-the-route-is-one-order-with-the-depths-mixed)
and the [conclusion](#conclusion) follow them.

**Both rounds in one paragraph.** NEW-b does what it was changed to do: carried stops now sit
among More's own stops in 7 of 11 runs, against 1 of 11. It is as valid as NEW-a, and the Gist walk,
pass sizes and coverage are not disturbed. But it carries **more**: a third of More and a fifth of
Most, against a quarter and a seventh, and More is now within ten points of the full nesting Greg
found annoying. The blind judge still prefers the new More for a reader who starts there (11 of
12). For a reader coming from Gist, which is the complaint, it came out 8 to 3 with 1 tie; the
control, two runs of the old prompt, came out 5 to 0, so **that is still not shown**.

**Round one in one paragraph.** `skim/9` carries a moderate amount: a quarter of the More walk and a seventh
of the Most walk, against 42% under the old full nesting and 0% today. Nothing failed and nothing
was dropped. Pass sizes and Idea coverage did not move. A blind judge preferred the new More for a
reader who **starts** at More in 12 pairs of 12, far outside the control. For a reader who has
**just walked Gist** the judge preferred it 6 to 2 with 4 ties, and that is **not** outside the
control, where two runs of the old prompt split 5 to 0. Three things the averages hide: the amount
carried swings from all of Gist to none of it between two runs on one article; the carried stops
almost always sit at the head of More, as a recap, and not beside the stops they pair with; and
the carrying into Most is the weaker half.

## The question

Greg's report spya-ms9d69: two related points were split between Gist and More, and the walk felt
disjointed. Earlier (260929e) he had found full nesting, where More replays all of Gist, annoying;
that measured 43% and 46% repeats. `skim/9` gives each stop `again`, the deeper passes it is also
walked in, and tells the model when to carry a stop and when not to. Four things were asked:

1. How much does it carry?
2. Did anything else move (pass sizes, Idea coverage)?
3. Does More read less disjointed, and are the carried stops the right ones?
4. What does reading the outputs show that the numbers do not?

## How it was run

The method is [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change).

- **Script:** [`scripts/eval/skim-coverage-eval.ts`](../../scripts/eval/skim-coverage-eval.ts),
  extended to record each stop's `again`, each pass as it is walked, the route's drop counts, the
  thinking tokens, and any failed run. It calls production's `skimInput` and `generateSkim` in
  both arms, through the gateway, `profile: null`. **Nothing was written to the database**; the
  spend collector has no sink.
- **Arms:** NEW is `src/skim.ts` in the working tree (`skim/9`). OLD is `skim/8`, from
  `git show 6236d0957:src/skim.ts > src/skim-v8-eval-tmp.ts`, deleted when the calls finished
  (checked with `test -e`, exit 1). Two runs each; OLD run 1 against OLD run 2 is the control.
- **Articles (6):** two essays `vb-spya-vu3xen` (8 quotes offered) and `best-spya-ny2pgx` (23), a
  talk `cargocult-spya-rz663q` (11), a paper `entropy-24-00930-spya-pywwkq` (20, 8,580 words), a
  long paper `source-spya-furjgs` (13, 9,995 words) and a long old text `fowler-phrenology` (31,
  8,717 words). These are the local articles with stored Quotes and Ideas that have enough quotes
  to make three passes.
- **One departure:** every local article's Ideas are from an older Ideas prompt, which the script
  refuses by default. `--allow-outdated-ideas` let them in. Both arms get the same Ideas, so their
  age is not a variable; the snapshot in the results file names each version.

```
git show 6236d0957:src/skim.ts > src/skim-v8-eval-tmp.ts
npx tsx scripts/eval/skim-coverage-eval.ts --runs=2 --old=src/skim-v8-eval-tmp.ts \
  --old-version=skim/8 --new-version=skim/9 --allow-outdated-ideas \
  vb-spya-vu3xen cargocult-spya-rz663q entropy-24-00930-spya-pywwkq source-spya-furjgs \
  best-spya-ny2pgx fowler-phrenology
rm src/skim-v8-eval-tmp.ts
npx tsx scripts/eval/skim-again-pairs.ts evals/results/skim-coverage-2026-10-03T18-10-38.json
```

The second script, [`scripts/eval/skim-again-pairs.ts`](../../scripts/eval/skim-again-pairs.ts),
makes no model call. It prints every table below, writes the blind pairs and their keys, and, run
again once a judgment file exists, scores it against the key.

## 1. How much it carries

Each cell is **walk length · carried · carried share**. A walk is the pass's own stops plus the
stops carried into it.

| Article | run | More | Most | Gist stops carried into More |
|---|---|---|---|---|
| vb (essay) | 1 | 4 · 1 · 25% | 4 · 1 · 25% | 1 of 2 |
| | 2 | 5 · 1 · 20% | 2 · 0 · 0% | 1 of 2 |
| cargocult (talk) | 1 | 5 · 2 · 40% | 6 · 1 · 17% | 2 of 3 |
| | 2 | 5 · 1 · 20% | 6 · 2 · 33% | 1 of 3 |
| entropy (paper) | 1 | 9 · 3 · 33% | 10 · 0 · 0% | 3 of 4 |
| | 2 | 9 · 3 · 33% | 11 · 1 · 9% | 3 of 4 |
| source (long paper) | 1 | 5 · 1 · 20% | 7 · 1 · 14% | 1 of 3 |
| | 2 | 5 · 1 · 20% | 9 · 3 · 33% | 1 of 3 |
| best (essay) | 1 | 12 · 5 · 42% | 12 · 1 · 8% | **5 of 5** |
| | 2 | 7 · 0 · 0% | 11 · 0 · 0% | **0 of 5** |
| fowler (long) | 1 | 9 · 2 · 22% | 19 · 0 · 0% | 2 of 5 |
| | 2 | 8 · 1 · 13% | **26 · 7 · 27%** | 1 of 5 |
| **All 12 runs** | | **83 · 21 · 25%** | **123 · 17 · 14%** | **21 of 44** |

For scale, on the same NEW routes: full nesting would make More 44 of 106, **42%** repeats. Today's
rule (OLD) is **0%**.

- 11 of 12 runs carry something into More. Two runs reach 40%; none goes over 42%.
- 8 of 12 runs carry something into Most.
- The model carries about **half of the Gist stops** into More (21 of 44).
- Of the 17 stops carried into Most, 10 come from Gist and 7 from More.

**Validity.** 24 calls, **no failed route, no truncation** (a truncated answer throws, and a throw
is written to `failures`, which is empty). `badAgain` is 0 in every run, and so is every other drop
count. The effort is the module's constant `low`; no environment override was set. The script
cannot see the effort on the wire, only the thinking tokens the gateway reports:

| Arm | cost (12 calls) | input / call | output / call | of which thinking | runs that thought at all |
|---|---|---|---|---|---|
| OLD `skim/8` | $0.310 | 7,428 | 1,097 | 297 | 6 of 12 |
| NEW `skim/9` | $0.377 | 8,031 | 1,532 | 626 | 7 of 12 |

NEW costs about a fifth more per route (603 more input tokens, and about twice the thinking where
it thinks). The longest answer was 3,838 output tokens.

## 2. Did anything else move?

**Pass sizes did not.** Stops first placed at Gist / More / Most:

| Article | OLD 1 | OLD 2 | NEW 1 | NEW 2 |
|---|---|---|---|---|
| vb | 2 / 2 / 4 | 2 / 4 / 2 | 2 / 3 / 3 | 2 / 4 / 2 |
| cargocult | 3 / 3 / 5 | 3 / 3 / 5 | 3 / 3 / 5 | 3 / 4 / 4 |
| entropy | 4 / 6 / 10 | 4 / 6 / 10 | 4 / 6 / 10 | 4 / 6 / 10 |
| source | 3 / 4 / 6 | 3 / 4 / 6 | 3 / 4 / 6 | 3 / 4 / 6 |
| best | 5 / 7 / 11 | 5 / 7 / 11 | 5 / 7 / 11 | 5 / 7 / 11 |
| fowler | 5 / 7 / 19 | 5 / 7 / 19 | 5 / 7 / 19 | 5 / 7 / 19 |

**Idea coverage did not.** Ideas with a stop on one of their own paragraphs, summed over the six
articles (39 Ideas), counting each stop once at its first depth as the script always has:

| | OLD 1 | OLD 2 | NEW 1 | NEW 2 |
|---|---|---|---|---|
| by Gist | 21 | 20 | 20 | 20 |
| by More | 30 | 31 | 30 | 30 |
| by Most | 32 | 32 | 32 | 32 |

Per article, and "in or beside", and sections with a stop, are in `…-again-stats.md`. Every NEW
cell is inside OLD's own range or one away from it.

**Which quotes go where moved on one article.** Quotes two routes place at the same first depth:

| Article | OLD 1 v OLD 2 (control) | NEW 1 v NEW 2 | OLD v NEW, four pairings |
|---|---|---|---|
| vb | 6/8 | 7/8 | 6 to 8 |
| cargocult | 9/11 | 10/11 | 8 to 11 |
| entropy | 18/20 | 18/20 | 16 to 18 |
| **source** | **13/13** | **13/13** | **9, 9, 9, 9** |
| best | 17/23 | 21/23 | 17 to 21 |
| fowler | 27/31 | 25/31 | 25 to 29 |

On five articles new against old is inside old against old. On the long paper it is not: both OLD
runs agree with each other exactly, both NEW runs agree with each other exactly, and the two arms
differ on 4 of 13 quotes. NEW moves the "no single norm" quote up to Gist, the "benchmarks" quote
down to More, the "random, anecdotal" quote up to More and Gerlach's speed estimate down to Most.
Idea coverage by More on that paper is 4 of 8 in both NEW runs against 5 of 8 in both OLD runs. One
article, so it is a note and not a finding; but it is a consistent shift and not run-to-run noise.

## 3. The blind read

**What the judge saw.** For each article and run, two candidates. Each is its own Gist walk and
then its own More walk, every stop with its cue, its quote and its whole paragraph. OLD's More is
its depth-2 stops; NEW's More is its depth-2 stops plus the carried ones, in route order. Nothing
marks a stop as carried. 12 treatment pairs (OLD run *n* against NEW run *n*) and 6 control pairs
(OLD run 1 against OLD run 2).

**Sides.** Assigned by `blindCoin`. Treatment key: NEW on side A in 7, side B in 5. Control key:
OLD run 1 on side A in 3, side B in 3. The control's first two seeds each came out 5 to 1 and were
replaced before any judging; the script's comment says so.

**The judges.** Two fresh Opus subagents, one per pairs file, each given a copy of its file in a
folder with nothing else in it. The questions: (a) for a reader who has just walked that
candidate's Gist, which More reads more as one connected walk; (b) for a reader who starts at
More, which gives a more complete, less disjointed picture.

| | (a) after Gist | (b) starting at More |
|---|---|---|
| **NEW v OLD** (12 pairs) | NEW 6 · OLD 2 · tie 4 | **NEW 12 · OLD 0 · tie 0** |
| **OLD 1 v OLD 2**, the control (6 pairs) | run 2 5 · run 1 0 · tie 1 | run 2 3 · run 1 1 · tie 2 |

Side picks, to rule out a side preference: treatment (a) A 6, B 2; (b) A 7, B 5. Control (a) A 2,
B 3; (b) A 3, B 1.

- **(b) is an effect.** Twelve of twelve, on both sides of the page, with no ties. The control
  never does better than 3 to 1. The reasons are the same each time: the new More opens with the
  definition or the framing question that its other stops assume. One of the twelve is `best`
  run 2, where NEW carried nothing, so that one win is the route and not the carrying; 11 of 11 is
  the honest count.
- **(a) is not shown.** 6 to 2 looks like a lead, but two runs of the *same* prompt gave 5 to 0.
  The judge picks a side readily in this format whatever the cause. In its own words on the pairs
  where NEW won (a), the reason is usually the order or the ending of the new stops, and the
  carried stop is *"redundant but not disconnecting"*; where OLD won, it is because OLD's More is
  *"all new"*.

**The carried stops, one by one.** A fresh Sonnet subagent, not blind, since a carried stop is
marked as one. All 38:

| Carried into | bridge or main point | redundant repeat | superseded by finer stops |
|---|---|---|---|
| More (21) | 20 | 1 | 0 |
| Most (17) | 10 | 7 | 0 |
| **All (38)** | **30** | **8** | **0** |

Six of the eight repeats are in one walk, `fowler` run 2's Most.

## 4. What reading the outputs shows

- **A carried stop is a recap at the head of the walk, not a bridge beside its pair.** Most
  routes list their Gist stops first, and a carried stop *"keeps its one place in the route
  order"*. So in 10 of the 11 runs that carry into More, every carried stop comes before every new
  one: `entropy`'s More opens with three stops the reader has just walked, in a row, then six new
  ones. Only `best` run 1, whose route interleaves the depths, puts each carried stop next to the
  new stops that lean on it (positions 1, 5, 6, 10 and 12 of 12), and that is the walk the judge
  called *"one continuous walk … each stop leading to the next, at the cost of repeating the
  Gist"*. This is why (b) is strong and (a) is not: a recap at the top is exactly what a reader
  starting at More needs, and it does little for one arriving from Gist.
- **The same article can get everything or nothing.** `best`: all five Gist stops carried in
  run 1, none in run 2, same input. "Decide stop by stop" is not yet a stable decision.
- **Most is the weaker half.** Greg's report was about Gist and More. Carrying into Most made a
  19-stop walk 26 in one run, and 7 of the 17 stops carried there were judged plain repeats.
  The prompt's "would miss a main point if they START at that pass" licenses almost any Gist stop
  for Most.
- **What gets carried is the frame**: the definition (`entropy`'s whole-versus-parts), the
  framing question (`fowler`'s "of what practical use"), the first principle (`cargocult`). Nearly
  never the detail. That matches the classifier's 20 of 21 at More.
- **Nothing was ever "superseded".** Either the model follows that rule well or the classifier
  does not use the label; this run cannot tell which.

## What this did not show

- **No person read these.** Every judgment is a model's, and Opus is the same family as the model
  that wrote the routes.
- **The read is not blind to the arm**, only to the side. A More stop that repeats a Gist stop is
  visibly the new arm. A judge who likes or dislikes repeats can act on it.
- **It did not test Greg's actual complaint directly.** That was a reader walking Gist and then
  More. Question (a) is that reader, and (a) is inside the noise.
- **Most was not read blind**, only classified stop by stop.
- **Six articles, two runs.** The source-paper shift is one article. `entropy`'s stored Quotes are
  stale against its current blocks (three of 23 are not offered); both arms saw the same list.
- **Only `profile: null` and standard power.** A profile changes where a route starts.
- **The carried-stop classifier is generous** and unblinded; read its 30 of 38 as an upper bound.

## What round one left open

Written at the end of round one, and what round two acted on: a carried stop sat at the top of
the deeper walk, because the route listed Gist first, so it could not be next to its pair; Most
was the weaker half; and the amount swung from 0 of 5 to 5 of 5 on one article.

## Round two: NEW-b, the route is one order with the depths mixed

**What changed.** One paragraph at the end of the carrying rules in section 2 of `SKIM_SYSTEM`.
`PROMPT_VERSION` stayed `skim/9`, which was never released. The file's sha256 began `3c55882b` in
round one and `286b40ca` in round two.

> A carried stop keeps its one place in the route order, so that place has to work in every pass
> it is walked in. The route is ONE order with the depths mixed, not the depth-1 stops first and
> the deeper ones after them. Put each deeper stop where it belongs among the others: next to the
> stop it explains or pairs with. Then a carried stop is met beside the stops that lean on it, not
> as a recap before them.

**How it was run.** NEW-b alone, two runs, the same six articles and flags; OLD's routes, the
control pairs and the control judgment are round one's. A third script,
[`scripts/eval/skim-route-order.ts`](../../scripts/eval/skim-route-order.ts), reads the articles
to say how far each walk follows the article's own order.

```
npx tsx scripts/eval/skim-coverage-eval.ts --runs=2 --new-only --new-version=skim/9 \
  --allow-outdated-ideas vb-spya-vu3xen cargocult-spya-rz663q entropy-24-00930-spya-pywwkq \
  source-spya-furjgs best-spya-ny2pgx fowler-phrenology
npx tsx scripts/eval/skim-again-pairs.ts evals/results/skim-coverage-2026-10-03T18-18-47.json \
  --old-from=evals/results/skim-coverage-2026-10-03T18-10-38.json
npx tsx scripts/eval/skim-route-order.ts evals/results/skim-coverage-2026-10-03T18-10-38.json \
  evals/results/skim-coverage-2026-10-03T18-18-47.json
```

### (i) How much NEW-b carries, and validity

Each cell is **walk length · carried · share**.

| Article | run | More, NEW-b | More, NEW-a | Most, NEW-b | Most, NEW-a | Gist carried into More, b (a) |
|---|---|---|---|---|---|---|
| vb | 1 | 5 · 1 · 20% | 4 · 1 · 25% | 3 · 1 · 33% | 4 · 1 · 25% | 1 of 2 (1 of 2) |
| | 2 | 5 · 1 · 20% | 5 · 1 · 20% | 2 · 0 · 0% | 2 · 0 · 0% | 1 of 2 (1 of 2) |
| cargocult | 1 | 6 · 3 · **50%** | 5 · 2 · 40% | 6 · 1 · 17% | 6 · 1 · 17% | **3 of 3** (2 of 3) |
| | 2 | 3 · 0 · 0% | 5 · 1 · 20% | 5 · 0 · 0% | 6 · 2 · 33% | **0 of 3** (1 of 3) |
| entropy | 1 | 8 · 3 · 38% | 9 · 3 · 33% | **19 · 8 · 42%** | 10 · 0 · 0% | 3 of 4 (3 of 4) |
| | 2 | 9 · 3 · 33% | 9 · 3 · 33% | 13 · 3 · 23% | 11 · 1 · 9% | 3 of 4 (3 of 4) |
| source | 1 | 5 · 1 · 20% | 5 · 1 · 20% | 7 · 1 · 14% | 7 · 1 · 14% | 1 of 3 (1 of 3) |
| | 2 | 6 · 2 · 33% | 5 · 1 · 20% | 8 · 2 · 25% | 9 · 3 · 33% | 2 of 3 (1 of 3) |
| best | 1 | 10 · 4 · 40% | 12 · 5 · 42% | 15 · 3 · 20% | 12 · 1 · 8% | 4 of 5 (5 of 5) |
| | 2 | 9 · 3 · 33% | 7 · 0 · 0% | 15 · 4 · 27% | 11 · 0 · 0% | 3 of 6 (0 of 5) |
| fowler | 1 | 10 · 3 · 30% | 9 · 2 · 22% | 21 · 2 · 10% | 19 · 0 · 0% | 3 of 5 (2 of 5) |
| | 2 | 12 · 5 · 42% | 8 · 1 · 13% | 24 · 5 · 21% | 26 · 7 · 27% | **5 of 5** (1 of 5) |
| **All 12** | | **88 · 29 · 33%** | 83 · 21 · 25% | **138 · 30 · 22%** | 123 · 17 · 14% | **29 of 45** (21 of 44) |

- **NEW-b carries more.** A third of More against a quarter; a fifth of Most against a seventh;
  two thirds of the Gist stops against a half. Full nesting on the NEW-b routes would be 43% at
  More, so NEW-b is ten points under it where NEW-a was seventeen.
- Three runs are at 40% or over at More (two for NEW-a), and a fourth is at 38%.
- The spread is no narrower: `cargocult` carried 3 of 3 in one run and 0 of 3 in the next.
- In `entropy` run 1 every More stop is carried into Most as well, which makes Most 19 stops, 8 of
  them seen before.

**Validity is the same as NEW-a's.** 12 calls, no failed route, no truncation, `badAgain` 0 and
every other drop 0. Thinking: 812 tokens per call (8 of 12 runs thought), against 626 and 297.

### (ii) Pass sizes and coverage

Stops first placed at Gist / More / Most. OLD and NEW-a are in section 2.

| Article | OLD 1 | OLD 2 | NEW-b 1 | NEW-b 2 |
|---|---|---|---|---|
| vb | 2 / 2 / 4 | 2 / 4 / 2 | 2 / 4 / 2 | 2 / 4 / 2 |
| cargocult | 3 / 3 / 5 | 3 / 3 / 5 | 3 / 3 / 5 | 3 / 3 / 5 |
| entropy | 4 / 6 / 10 | 4 / 6 / 10 | 4 / **5 / 11** | 4 / 6 / 10 |
| source | 3 / 4 / 6 | 3 / 4 / 6 | 3 / 4 / 6 | 3 / 4 / 6 |
| best | 5 / 7 / 11 | 5 / 7 / 11 | 5 / **6 / 12** | **6 / 6** / 11 |
| fowler | 5 / 7 / 19 | 5 / 7 / 19 | 5 / 7 / 19 | 5 / 7 / 19 |

Three runs move one stop between passes, where NEW-a moved none on these four articles. It is
small and inside the caps.

Ideas "in", summed over the six articles (39):

| | OLD 1 | OLD 2 | NEW-a 1 | NEW-a 2 | NEW-b 1 | NEW-b 2 |
|---|---|---|---|---|---|---|
| by Gist | 21 | 20 | 20 | 20 | 20 | 21 |
| by More | 30 | 31 | 30 | 30 | 30 | 30 |
| by Most | 32 | 32 | 32 | 32 | 32 | 32 |

**Coverage holds.** Per article the Gist figure spreads more than before (`best` 5 and 4 against
OLD's 3 and 3; `fowler` 4 and 5 against 6 and 5; `entropy` 3 and 4 against 4 and 4), and `best`
run 1's Gist reaches 3 of 9 sections where every other run reaches 5.

Quotes placed at the same first depth, summed over the six articles (of 106):

| OLD 1 v OLD 2 (control) | NEW-a 1 v 2 | NEW-b 1 v 2 | OLD v NEW-a, four pairings | OLD v NEW-b, four pairings |
|---|---|---|---|---|
| 90 | 94 | 83 | 85 to 91, mean 88 | 78 to 89, mean 84 |

NEW-b agrees a little less with OLD, and with itself, than the control does. The long-paper shift
of round one is still there (9 to 11 of 13 against OLD's 13 of 13). Placement moves somewhat;
what the passes cover does not.

### (iii) Interleaving

| | OLD | NEW-a | NEW-b |
|---|---|---|---|
| Routes that list every Gist stop before any deeper stop | **9 of 12** | 8 of 12 | **4 of 12** |
| Of the runs that carry into More: every carried stop before every new one ("recap at the head") | n/a | **10 of 11** | **4 of 11** |

- **The old prompt already listed Gist first**, in 9 routes of 12, and the first `skim/9` wording
  did not change that. So round one's recap was the old habit plus `again`.
- **The new paragraph changes it.** Seven of NEW-b's eleven carrying runs put carried stops among
  More's own. The four that still recap are the two `vb` runs (one carried stop each), `entropy`
  run 2 and `source` run 1.

### (iv) The Gist walk

Mixing the depths could have scrambled Gist. It did not. A "step forward" is a stop later in the
article than the one walked before it:

| | OLD | NEW-a | NEW-b |
|---|---|---|---|
| Gist walks wholly in the article's order | 8 of 12 | 10 of 12 | 10 of 12 |
| Gist steps forward | 28 of 32 | 30 of 32 | 31 of 33 |
| Whole-route steps forward | 165 of 200 | 175 of 200 | 179 of 200 |
| More-walk steps forward | 40 of 48 | 60 of 71 | 66 of 76 |

Read by eye, NEW-b's Gist walks are the same kind of walk as before: mostly the same stops, in the
article's order. Two are a little worse: `best` run 1's Gist no longer has the essay's thesis or
its closing line (both went to More) and opens on the "pulling on a thread" detail, and `vb` run 2
opens on the closing summary. Neither is a change in kind.

**A finding of its own, in every arm:** these routes follow the article's order. The prompt says
*"The route is not the article's order"* and asks for the main claim first; in practice eight to
ten Gist walks of twelve run front to back, old prompt and new. NEW-b's "one order" is, in effect,
the article's order with the depths marked on it.

### The blind read, round two

Same format, same seed, a fresh Opus judge with only the pairs file. Key: NEW-b on side A in 7,
side B in 5.

| | (a) after Gist | (b) starting at More |
|---|---|---|
| **NEW-b v OLD** (12 pairs) | NEW 8 · OLD 3 · tie 1 | NEW 11 · OLD 1 · tie 0 |
| NEW-a v OLD, round one | NEW 6 · OLD 2 · tie 4 | NEW 12 · OLD 0 · tie 0 |
| OLD 1 v OLD 2, the control (6 pairs) | run 2 5 · run 1 0 · tie 1 | run 2 3 · run 1 1 · tie 2 |

Side picks for NEW-b: (a) A 4, B 7; (b) A 6, B 6.

- **(b) holds.** The one loss is `cargocult` run 2, the run that carried nothing.
- **(a) is still inside the control.** 8 to 3 is a larger lead than 6 to 2 and has fewer ties, but
  the same prompt against itself gave 5 to 0. It cannot be called an effect.
- **Inside NEW-b, (a) follows the interleaving.** Of the seven runs that interleave, NEW-b won six
  and tied one. Of the four that recap, it won two and lost two, and it lost the run that carried
  nothing. The judge's reasons on the interleaved wins are about pairing: *"pairing each principle
  with its case"*, *"poses the 'of what use' question and then walks the answers"*. On the losses
  they are about repeats: *"replays three Gist stops and then doubles back"*. This is the best
  evidence here that placement matters, and it is seven runs, sorted after the fact.

**The carried stops, one by one**, with the extra question (is it directly next to a stop it pairs
with, or that explains it?). A fresh Sonnet subagent, not blind:

| Carried into | bridge or main point | redundant repeat | superseded | next to its pair |
|---|---|---|---|---|
| More (29) | 25 | 4 | 0 | 16 of 29 |
| Most (30) | 24 | 5 | 1 | 24 of 30 |
| **All (59)** | **49** | **9** | **1** | **40 of 59** |
| NEW-a, all (38) | 30 | 8 | 0 | not asked |

Six of the nine repeats are `fowler`'s: the closing line *"the mind that makes the man"* and
*"every faculty is good"*, each carried into both deeper passes. Nearly half of the stops carried
into More are still not next to their pair, by this reading; most of those are a framing stop at
the head of the walk, which every later stop leans on and none sits beside.

## Conclusion

**NEW-b is not worse than NEW-a on validity, on the Gist walk or on coverage.** It is worse on one
thing that matters: it carries more, and more of it into Most.

1. **Both wordings are safe**: no failed route, no bad `again`, no truncation, coverage and pass
   sizes inside the old prompt's own noise.
2. **Both clearly help the reader who opens More without walking Gist** (12 of 12, 11 of 12;
   control 3 to 1). Nobody asked for that, but it is real.
3. **Neither is shown to fix what Greg reported**, the walk from Gist into More. NEW-a 6 to 2,
   NEW-b 8 to 3, control 5 to 0. Inside NEW-b the interleaved runs win and the recap runs do not,
   which points the right way without proving it.
4. **NEW-b fixes the placement**, which was round one's main defect: 7 of 11 runs interleave,
   against 1 of 11.
5. **NEW-b carries a third of More and a fifth of Most**, and its More is ten points under full
   nesting. Greg found nesting annoying. A reader coming from Gist meets two thirds of Gist again.
6. **The amount is unstable in both**: all of Gist in one run, none in the next, on one article.

**Which to keep.** NEW-b's paragraph, because a carried stop beside its pair is what the feature
is for and a recap is not. But not as it stands: the amount needs a limit, and wording has now
gone the wrong way on it once. The plan already names the fallback, a cap in `validateRoute`. Two
that this data would support, neither tried here:

- **do not carry into Most.** It is the weaker half in both rounds (most of the repeats, the
  longest walks), and the report was about Gist and More;
- **cap what More takes from Gist**, for instance at half of the Gist stops, or two. NEW-a's
  median was already about that.

If the choice is between the two wordings with nothing else changed, it is close, and NEW-a is the
more cautious one: it repeats less, and the gain from NEW-b's placement is not yet shown.

## Cost

$1.089 in route calls, the gateway's own figures summed by the script: $0.687 for round one's 24
(OLD $0.310, NEW-a $0.377) and $0.402 for round two's 12. The five judging subagents ran inside the
Claude session, about 600k tokens between them, and are not in that figure.

## Files

All under `evals/results/`, with the stem `skim-coverage-2026-10-03T18-10-38`:

- `.json`: every run's stops with `again`, the full quote and paragraph, the cues, the walks, the
  drop counts, the tokens, and the snapshot of the Quotes and Ideas.
- `-again-stats.md`: the tables of sections 1 and 2, per article.
- `-again-blind-pairs.md`, `-again-blind-key.json`, `-again-blind-judgment.json`.
- `-again-control-pairs.md`, `-again-control-key.json`, `-again-control-judgment.json`.
- `-again-carried.md`, `-again-carried-classes.json`. The `.md` was written again in round two,
  when the script gained the "next to its pair" question; the round-one classifier saw it without
  that question. The stops and ids are the same. `-again-stats.md` was also rewritten then and
  gained the order table.

Round two, with the stem `skim-coverage-2026-10-03T18-18-47`: `.json` (NEW-b only),
`-again-stats.md` (NEW-b beside round one's OLD), `-again-blind-{pairs.md,key.json,judgment.json}`,
`-again-carried.md`, `-again-carried-classes.json`, and `-again-control-{pairs.md,key.json}`, which
are byte for byte round one's; the control judgment was not repeated.
