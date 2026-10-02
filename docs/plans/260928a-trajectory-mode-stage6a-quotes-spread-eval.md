# Trajectory stage 6a — does a "cover the main parts" nudge spread Quotes better? (offline eval)

Research write-up: [docs/research/261002k-skim-trajectory-coverage-quote-spread-deeper-passes-and-diversity-evals.md](../research/261002k-skim-trajectory-coverage-quote-spread-deeper-passes-and-diversity-evals.md).

Stage 6a of [260928a](260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md) § "Stage 6,
widened", run as the **offline evaluation arm** Sol's F66 asked for: the Quotes version is bumped
only if the nudge wins. Greg's prompt for it:

> It might make sense to make a minimal update to Quotes to increase representativeness a bit more widely across sections
>
> — Greg, 2026-09-28

Sol's objection (F66) was that `quotes/7` already says *"Take them from across the whole piece"*
and already gets the outline with gists. This eval asks whether saying it more pointedly moves
anything beyond the prompt's own run-to-run noise.

**Verdict: no. Do not land it.** Details at the end.

## The nudge, exactly

Inserted into `SYSTEM` (src/quotes.ts, `quotes/7`) as a new paragraph directly after the existing
one under *SPREAD THEM OUT, AND DO NOT REPEAT A POINT* that begins "Take them from across the whole
piece…":

> Cover its main parts, too. Look at the parts listed under ITS SHAPE: where a
> part that carries the argument — not front matter, notes or references — has a
> passage worth keeping, take at least one from it. Do not lower the bar to do
> it: a part with nothing worth keeping gets nothing.

("Parts" because the user prompt lists the outline as `PART 1: …`, `PART 2: …` under `=== ITS SHAPE ===`.)

## Method

Script: [`scripts/eval/quotes-spread-eval.ts`](../../scripts/eval/quotes-spread-eval.ts). Raw
output: `evals/results/quotes-spread-2026-09-28T14-19-04.json` (every run's quotes and metrics),
`…-pairs.md` (the blind pairs), `…-key.json` (the key).

- **Production's own `generateQuotes`**, called as src/pipeline.ts's `quotes` step calls it, with
  `previous: null` (a fresh list, not a Find more), `profile: null`, no cache breakpoint. Model
  `claude-sonnet-5` at production effort. The article was read through `pgArticleReader` and
  passed as `{ slug, blocks, tree, meta }`; its `inputFingerprint` matched each article's stored
  Quotes `sourceHash`, i.e. the same bytes the pipeline generates from.
- **How the nudge gets in without editing src/**: `SYSTEM` is a module constant that
  `generateQuotes` reads directly. So for the nudge arm only, the script patches the Anthropic SDK's
  `Messages.prototype.stream`: it finds the system block whose text is exactly `SYSTEM` and
  replaces it with `SYSTEM.replace(ANCHOR, ANCHOR + "\n\n" + NUDGE)`. Everything else (article
  block, user prompt, model, effort, token budget, parsing, placement, dedupe) is production's.
  The patch throws if the block or anchor is missing and counts its applications. **It applied 6
  times in 6 nudge calls**, and 0 in control.
- **Arms**: control (current prompt) ×2 and nudge ×2 on each of the three stage-6 articles, 12
  calls. Run order C1, N1, C2, N2; the three articles in parallel within each.
- **Nothing written to the database**: the spend collector had no sink, and no artefact was
  stored.
- **Metrics**: top-level sections are the tree root's children. A section is **content-bearing**
  if it has body words (blocks not `treatment === "supplement"`), the rule
  `scripts/trajectory-coverage.ts` uses. The **Idea ceiling** is scored against the **stored** Ideas
  (3 / 8 / 8 Ideas; the entropy paper's are `ideas/2`, outdated but not stale). "In" means a quote
  sits on the same block as one of the Idea's occurrences. "In or beside" also counts the nearest
  body, non-heading paragraph on either side of a quote, never leaving its top-level section,
  which is the same walk as `trajectoryInput`'s `neighbour` in src/trajectory.ts.

## Results

Ideas "in" / "in or beside" are counts out of the stored Ideas. *Empty* means content-bearing
top-level sections with no quote.

| Article | Arm / run | Quotes | Quotes per top-level section | Empty | Ideas in | In or beside | Cost | Latency |
|---|---|---|---|---|---|---|---|---|
| Essay `vb-spya-vu3xen` (6 sections, 3 Ideas) | stored `quotes/6` | 10 | — | 1/6 | 3/3 | 3/3 | — | — |
| | control 1 | 10 | 1 4 1 3 1 **0** | 1/6 | 3/3 | 3/3 | $0.0243 | 11.1 s |
| | control 2 | 10 | 1 4 1 3 1 **0** | 1/6 | 3/3 | 3/3 | $0.0260 | 10.0 s |
| | nudge 1 | 9 | 1 3 1 2 2 **0** | 1/6 | 3/3 | 3/3 | $0.0230 | 10.6 s |
| | nudge 2 | 9 | 1 2 2 2 2 **0** | 1/6 | **1/3** | 2/3 | $0.0234 | 11.3 s |
| Normal paper `entropy-24-00930-spya-pywwkq` (9 sections, 8 Ideas) | stored `quotes/7` | 23 | — | 2/9 | 5/8 | 7/8 | — | — |
| | control 1 | 20 | **0** 1 3 1 3 8 3 **0** 1 | 2/9 | 5/8 | 6/8 | $0.0718 | 25.8 s |
| | control 2 | 18 | **0** 1 1 1 2 9 3 **0** 1 | 2/9 | 5/8 | 6/8 | $0.0684 | 23.3 s |
| | nudge 1 | 23 | **0** 2 3 1 6 8 2 **0** 1 | 2/9 | 5/8 | 7/8 | $0.0799 | 32.9 s |
| | nudge 2 | 20 | **0** 3 1 **0** 4 7 3 **0** 2 | 3/9 | 4/8 | 6/8 | $0.0773 | 29.3 s |
| Long paper `source-spya-furjgs` (8 sections, 8 Ideas) | stored `quotes/6` | 16 | — | 1/8 | 5/8 | 6/8 | — | — |
| | control 1 | 23 | 2 3 2 6 1 2 3 4 | 0/8 | 7/8 | 7/8 | $0.0797 | 28.8 s |
| | control 2 | 18 | 1 3 2 2 2 1 3 4 | 0/8 | 6/8 | 7/8 | $0.0745 | 24.8 s |
| | nudge 1 | 19 | 1 4 1 3 2 1 2 5 | 0/8 | 5/8 | 6/8 | $0.0756 | 22.8 s |
| | nudge 2 | 19 | **0** 3 2 5 2 1 3 3 | 1/8 | 6/8 | 7/8 | $0.0807 | 28.0 s |

Section order: essay: Life Actually Is Short · Eliminating Bullshit · Seeking What Matters ·
Surprised by Loss · Savoring the Time You Have · Notes (111 w, not marked supplement). Entropy:
Front Matter (376 w) · 1 Introduction · 2 Tracking · 3 Processing · 4 PID · 5 PID in Action ·
6 Practical Considerations · **7 Future Directions (636 w)** · 8 Summary. Ball lightning: Article
overview (202 w) · 1 Historical outline · 2 Methodology · 3 Scientists · 4 Other trained observers
· 5 Synopsis · 6 Other notable · 7 Conclusions.

**Summed over the three articles** (19 Ideas, 23 content-bearing sections):

| | control 1 | control 2 | nudge 1 | nudge 2 |
|---|---|---|---|---|
| Empty content sections | 3 | 3 | 3 | 5 |
| Ideas in | 15 | 14 | 13 | 11 |
| Ideas in or beside | 16 | 16 | 16 | 15 |
| Quotes | 53 | 46 | 51 | 48 |

**Quotes dropped for not being found verbatim** (`unfound`, the stage's paraphrase alarm): 0 in all
six control runs; 0, 0, 0 and 0 in four nudge runs, but **5 in nudge 2 on the entropy paper** and 1
in nudge 2 on the ball-lightning paper. With one sample it cannot be told apart from chance, but
it is the wrong direction.

The one real gap in the stage-6 baseline, the entropy paper's *7. Future Directions* (636 body
words), got **no quote in any of the four runs**. The nudge did not reach it. The other empty
sections are front matter or notes, which the nudge says to leave alone anyway.

## Blind quality read

Pairs are control-run-1 against nudge-run-1 for each article. Sides were assigned by
`crypto.randomInt(2)` and the key was kept in its own file. The key came out balanced enough: the
nudge was A twice and B once. I judged from the pairs file alone, on worthiness and not on
coverage, and wrote the verdicts down before opening the key.

| Article | Pick | Why (written before the key) | Key | Winner |
|---|---|---|---|---|
| Essay | B, narrowly | fuller, more memorable lines (Christmas 8 times; "literally taking your life"; the mother passage), though B4 starts mid-sentence | A = nudge, B = control | control |
| Entropy | A | keeps the payoffs B cuts short (A4 "does not quantify transfer", A6 "We propose… PID", A13's synergy ≈ ¼ TE result); A's two definition lines are weaker | A = nudge, B = control | nudge |
| Ball lightning | B | fewer filler lines. A has "positive strokes… discussed at the conference", "reached a high international media impact" and the Charcot fragment | A = control, B = nudge | nudge |

The nudge won 2 to 1 on three pairs, which tells us almost nothing either way. **No sign that the
nudge hurts worthiness**, and no sign that it helps either.

## Cost

12 calls, **$0.7045** in all (OpenRouter's settled figures, none unpriced). A call cost $0.023–0.081
and took 10–33 s. Nudge calls averaged $0.0600 against control's $0.0575, which is within noise.

## Verdict

**The nudge does not beat the control's own noise, and on the numbers it leans slightly the wrong
way.** Section spread is flat. Control left 3 of 23 content sections empty on both runs. The nudge
left 3 and then 5, and the one section that mattered (the entropy paper's Future Directions) stayed
empty under both prompts. The Idea ceiling is flat to slightly worse. Control had 15 and 14 of 19
Ideas "in", and 16 and 16 "in or beside"; the nudge had 13 and 11, then 16 and 15. The essay's
nudge-2 fell to 1 of 3. The blind read split 2–1 for the nudge, which is noise on three pairs.
The one worrying sign is 5 non-verbatim quotes in a single nudge run. This matches Sol's F66
prediction: `quotes/7` already spreads its lines, and the empty sections left are mostly front
matter or notes, where no "cover every part" instruction should put a quote. **Recommendation**:
keep `quotes/7`, bump nothing, and record in trajectory.md § question 6 that 6a was measured and
did not earn its place. If Future Directions-type gaps matter, a route-side fix (6b, deferred) is
the lever, not the Quotes prompt.
