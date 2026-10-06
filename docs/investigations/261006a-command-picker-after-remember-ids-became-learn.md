# Command picker after the Remember ids became Learn

Written 2026-10-06, for finding PR-8 of
[the plan review](../plans/261006a-plan-review-sol.md) of
[261006a](../plans/261006a-remember-identifiers-become-learn-all-the-way-down.md). It follows
[261004e](261004e-command-pick-re-measured-after-more-nicknames-and-find-more-rows.md), whose
phrases and method it reuses. How the eval is run is in
[evals/command-pick/README.md](../../evals/command-pick/README.md).

## The question

The command bar sends a model (Jev, `typesafe/jev-1.13`) the list of rows with their ids, and it
answers with an id. The ids are part of that prompt. `mode:remember` became `mode:learn` and
`submode:remember:*` became `submode:learn:*`. Did that change what the picker picks, or how
confident it is, for requests about this mode and its neighbours?

## What was run

- `npx tsx evals/command-pick/run.ts --arm jev-pick --results 261006 --budget 1 --only <38 ids>`,
  run twice (the second with `--force`), from the Hetzner box on 2026-10-06. Production's first
  call only (the pick). The second call (Luna copying words out) was not run: no Learn row takes
  words, so it cannot change a Learn pick.
- **Model**: `typesafe/jev-1.13` on every one of the 76 calls (read from the saved rows; this arm
  prints no `Target:` line).
- **38 phrases**, chosen by `results/261006/select.ts`: every phrase whose accepted ids include
  a Learn id (6: `p10 p11 n47 n48 b15 m18`), every phrase whose accepted ids include Chat,
  Summary or Debate, and every phrase whose text mentions remember, quiz, tutorial, explore,
  recall, learn, summary, gist, chat or debate. The word "remember" appears in `b15` only ("help
  me actually remember this stuff, quiz me on it"); no phrase says "remember mode" or "remembering".
  There is no Explore-only phrase in the set. `BLIND_RELABEL` already accepts the new ids for
  `b15`.
- **Cost**: $0.0115 per pass, $0.023 for both, against a $3 ceiling.
- **Before**: `results/261004/jev-pick.json` (old ids, compared by meaning, `remember` read as
  `learn`) and, where the phrase existed, `results/261003/jev-pick.json`.

## Results

Right means an accepted id was picked, scored on today's labels.

| | 2026-10-03 | 2026-10-04 | now, run 1 | now, run 2 |
|---|---|---|---|---|
| right, of the 38 | 31 of the 31 it had | 36 | 36 | 36 |
| right, of the 6 that accept a Learn id | 5 of the 5 it had | 6 | 6 | 6 |

(2026-10-03 lacked the seven `m` phrases, so it is not comparable.) The full per-phrase table,
all four columns, is in `results/261006/compare.out`.

**Picks that differ between 2026-10-04 and now:** one phrase, `p11`.

| phrase | 2026-10-03 | 2026-10-04 | now, run 1 | now, run 2 |
|---|---|---|---|---|
| p11 "test whether I understood it" | Quiz 0.75 | Quiz 0.52 | Recall 0.48 | Recall 0.51 |

Both picks are accepted for `p11`. Its confidence was already near a coin toss on 2026-10-04.

The other 37 picked the same row in all three of the 2026-10-04 and two new runs. The Learn
phrases, with confidence (2026-10-04, then now run 1 and run 2):

| phrase | picked | confidence |
|---|---|---|
| p10 "quiz me on this" | Learn › Quiz | 0.90, 0.96, 0.96 |
| n47 "walk me through it a bit at a time and ask me things" | Learn › Tutorial | 1.00, 1.00, 1.00 |
| n48 "I want to write down what I remember and see if I got it right" | Learn › Recall | 0.98, 0.99, 0.99 |
| b15 "help me actually remember this stuff, quiz me on it" | Learn › Quiz | 0.91, 0.95, 0.93 |
| m18 "I need to revise this for an exam" | Learn (the mode) | 0.87, 0.92, 0.93 |
| n35 "…make a new quiz" | Quiz › Run again | 0.76, 0.71, 0.77 |

Neighbours (Chat, Summary, Debate, FAQ, Ideas) kept their picks. No pick moved onto or off a Learn
row except `p11`'s move within Learn.

**Confidence** (`results/261006/spread.out`): the two new runs differ from each other by at most
0.07 on any phrase. Against 2026-10-04, the confidence moved by more than 0.1 on three phrases,
none of them Learn: `n74` (a request with no right answer, `none` 0.39 to 0.64 and 0.65), `p38`
(Find, 0.46 to 0.56 and 0.59) and `m33` (Chat, 0.69 to 0.78 and 0.81). Every Learn phrase moved by
0.06 or less, upwards or flat except `p11` (0.52 to 0.48 and 0.51). `p10` (0.96, 0.96) and `b15`
(0.95, 0.93) sit at or near the 0.95 cut; both are Quiz picks for a request to be quizzed, as before
(0.90 and 0.91 on 2026-10-04).

(Differences against 2026-10-03 for `p08`, `p12`, `p15`, `b04`, `h05`, `b13` are 261004e's, not
this change.)

## What it shows, and what it cannot

- On these 38 phrases, run twice, the new ids gave the same right-answer count as 2026-10-04 (36)
  and the same row for 37 of 38. The one change, `p11`, moved between two accepted Learn rows at
  about 0.5 confidence.
- The two new runs agree with each other on every pick. Two runs per phrase is a weak read of
  noise, though, and the 2026-10-04 data has one run only.
- **Not isolated.** The list also changed between 2026-10-04 and now for other reasons: the
  Remember mode was renamed Learn in what a reader sees (261005l stage 1), Explore's wording widened
  (stage 2), and the list grew from 68 to 73 rows. This is "everything since 2026-10-04", with the
  ids the last piece, not an A/B on the ids alone. An id-only A/B would need the old catalogue
  with the same wording, which was not rebuilt.
- 38 phrases, six of them Learn. No Explore sub-mode phrase exists in the set, and the
  mode's other neighbours (Glossary, Quotes) were not selected unless they matched above.
- Only the pick and its confidence; not the suggester (`src/command-suggest-call.ts`), which also
  carries these ids and was not run.
- A "remember" in a sentence ("remember quiz", "remembering mode") is untested; no
  such phrase exists in `phrases.ts`.

## Where the raw results are

`evals/command-pick/results/261006/`: `run1-jev-pick.json`, `run2-jev-pick.json` (and `raw/`, the
second run's raw bodies), `select.ts` (the selection), `compare.ts` and `compare.out` (the
before/after). Nothing in `results/261003/` or `results/261004/` was written.
