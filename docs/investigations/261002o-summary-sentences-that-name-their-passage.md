# Summary sentences that name their passage — does the new answer shape cost anything?

Up: [investigations.md](../project/investigations.md) · Plan:
[261002e](../plans/261002e-summary-sentences-point-at-their-passage.md) · Report `spya-ra5fuz`.

**The question.** Summary's plain-words writer (`src/simple-summary.ts`) used to answer each
paragraph as `{text, ids}`. For Greg's ask that a summary sentence light up while its passage is on
screen, it now answers `{ids, sentences: [{text, id | null}]}`, with each sentence naming at most
one of its paragraph's ids (`simple-prompt/4`). The words instructions did not change, but the
shape of the answer did. Did that make the writing worse, less faithful, slower or dearer? And are
the sentence links right?

**Decision: ship it.** No effect on plainness or fidelity could be seen. The links are right 29 times
in 31. The cost is about 40% more output tokens and a couple of seconds more wait per press.

## What was run (2026-10-02)

The method is [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change),
scaled to the change. The writer was production's own `generateSimpleSummary`, through
`evals/simple/probe.ts run --power high` (Opus, `high` effort, guard on, no profile). It was run on
three local articles: the PID paper `entropy-24-00930-spya-pywwkq`, `greatwork-spya-yw4d3t` and
`noema-mythology-of-conscious-ai`.

- **Before**: two runs on e23212480 (`simple-prompt/3`), in
  `evals/results/simple/high-none-sentbefore{1,2}/`.
- **After**: two runs on 28f99cdf1 (`simple-prompt/4`), in `high-none-sentafter{1,2}/`.
- **Pairs**: `npx tsx evals/simple/sentence-pairs.ts <dir> 2` built 27 blind pairs: three articles,
  three levels, and per article-level two before×after pairs and one before×before control. Sides
  were shuffled with `blindCoin`. Seed 2 was chosen because it balances the key, putting the after
  arm on X in 9 of 18 pairs; the default seed gave 14 of 18. A fresh Opus judge read only the pairs
  file, with each text beside its cited passages cut to 500 characters, and answered two questions.
  Q1: which reads more easily to an outsider? Q2: does either lose, bend or add a claim?
- **Links**: every linked sentence of the Simple level in the after1 arm (31) was set beside the one
  passage it names. A second fresh Opus grader marked each GOOD, PARTIAL or WRONG.

The verdicts, key and tally are in `evals/results/simple/sentence-judge-261002/`, and
`python3 tally.py` there reproduces the counts below.

## Results

| | before | after |
|---|---|---|
| valid presses (retries and guard outcomes not recorded by the probe — Sol C4) | 6 / 6 | 6 / 6 |
| words, Brief · Simple · Fuller (mean) | 98 · 196 · 240 | 94 · 193 · 252 |
| output tokens per press (mean) | 3,380 | 4,700 |
| wall time per press (median) | 23.5 s | 26.1 s |
| sentences with an id | — | 189 of 196 (96%) |
| sentence ids outside their paragraph (nulled) | — | 0 |

Cost per press moved from a mean of $0.145 to $0.175, but cache state confounds it: each arm's first
run paid for writing the cache. The output tokens are the cleaner measure.

**Plainness (Q1), effect pairs:** after 8, before 8, same 2. Control (before against before): 4, 1,
and same 4. So no effect is visible, and the noise between two runs of the old prompt is as large as
anything here.

**Fidelity (Q2):** in the effect pairs the judge flagged the after arm 6 times and the before arm 12
times. In the control pairs each before run was flagged 6 times in 9 pairs. Both arms made the PID
paper's known trap, rewording a mutual-information peak as inputs that are "somewhat alike".
**Most flags here are an artefact**: "uncited" often means the support lay past the 500-character
cut. So these counts compare the arms with each other and say nothing absolute about fidelity. What
they support is narrower: the new shape shows no sign of making the writing less faithful.

**Links:** 29 GOOD, 1 PARTIAL (the sentence defines synergy and redundancy, and the passage defines
only synergy), 1 PARTIAL-CUT, 0 WRONG.

## What was ruled out, and why

- **Guessing the sentence's block in the client** by word overlap. The summary is in plain words and
  the passage is not, so overlap is weakest where it matters most. The plan has the reasoning; it was
  not measured.
- **A paragraph-level highlight only.** That is what 8K already gives through the chips.

## Not measured

- Profiled readers: every run had no profile.
- How often the fidelity guard fires. The probe files do not record the check outcome, and the
  guard's input (`text` and `ids`) is unchanged.
- A second article with a contrasting-terms trap.
