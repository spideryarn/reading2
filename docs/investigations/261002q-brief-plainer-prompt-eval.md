# Brief for a reader in a hurry: the before/after prompt eval

Up: [investigations.md](../project/investigations.md)

Run on 2026-10-02 for [plan 261002h](../plans/261002h-brief-summary-plainer-for-a-reader-in-a-hurry.md),
Greg's report `spya-rpqqxb`:

> The Briefer summary should also use slightly simpler language, and slightly less jargon, i.e.
> assume it's for someone with less expertise or in more of a hurry.
>
> — Greg, 2026-10-02

The research behind the prompt change is
[261002c-what-makes-a-good-summary](../research/261002c-what-makes-a-good-summary.md).

## The question

Does `simple-prompt/5` write a plainer Brief than `simple-prompt/4`, especially for a reader whose
profile claims the field, without losing fidelity or the goal-to-takeaway shape?

## What was run

- **Harness:** `evals/simple/probe.ts` calls production's `generateSimpleSummary` with `--power
  high`, effort `high` and the fidelity guard on, which is what a press does.
  `evals/simple/brief-plain.ts screen | pairs` gives the numbers and the blind pairs, and
  `evals/simple/brief-plain-unblind.ts` the tally. Results are in `evals/results/simple/high-{none,about}-fb9p{b1,b2,a1,a2}/`
  and `evals/results/simple/brief-plain-261002h/` (pairs, key, verdicts).
- **Articles (5):** Greg's own rat-rearing paper (imported locally as
  `s41598-023-33209-9-spya-s0qydm`), `entropy-24-00930-spya-pywwkq` (neuroscience),
  `source-spya-f550ta` (ball lightning), `scaling-hypothesis`, and `analog-cognition-…`.
- **Readers (2):** `none`, and `about`, the synthetic expert in `evals/simple/readers.json` (cognitive
  science, machine learning, information theory).
- **Arms, separated in time:** `fb9pb1`, `fb9pb2` (the old prompt, twice, as the control), then
  `fb9pa1`, `fb9pa2` (the new). That is 40 presses, about **$7.50**.
- **Three runs hit `402 ai-no-credit`** on the dev key. These were spend failures, not prompt
  failures. Their files were removed and the runs repeated, and all 20 new-prompt runs succeeded.
- **The blind read:** 20 test pairs (old against new, same article, reader and draw) and 10 control
  pairs (old against old), interleaved. Sides were exactly balanced (10 of 20 new-on-X), because the
  first fair-coin draw gave 6 of 20. Each side carried its cited passages. One fresh Opus subagent
  read only `pairs.md`.

## The numbers

**Screens** (Brief only; *hard* means outside the 6,000 commonest words; grade is Flesch–Kincaid):

| reader | arm | Brief words | hard share | grade |
|---|---|---|---|---|
| none | old b1 / b2 | 107 / 95 | 6.0% / 6.6% | 8.1 / 8.7 |
| none | **new** a1 / a2 | 102 / 99 | **5.1% / 5.4%** | 8.2 / 8.0 |
| about | old b1 / b2 | 102 / 97 | 13.8% / 13.6% | 10.7 / 10.7 |
| about | **new** a1 / a2 | 97 / 101 | **6.4% / 7.7%** | 9.2 / 8.4 |

**The expert profile had doubled Brief's hard-word share. The new prompt takes it back to roughly
the no-profile level.** Simple and Fuller lengths did not move beyond the arms' own spread (Simple
175–194 words, Fuller 229–252).

**Blind verdicts** (test: new : old : same; control: b1 : b2 : same):

| set | n | Q1 plainer | Q2 fidelity faults (new / old) | Q3 shape |
|---|---|---|---|---|
| test, `about` | 10 | **8 : 0 : 2** | 5 / 7 | 1 : 0 : 9 |
| test, `none` | 10 | **3 : 1 : 6** | 7 / 5 | 2 : 2 : 6 |
| test, all | 20 | **11 : 1 : 8** | 12 / 12 | 3 : 2 : 15 |
| control, all | 10 | 2 : 3 : 5 | 5 / 7 | 1 : 2 : 7 |

## Against the ship rule declared before the after-runs

- **Q1, at least two to one for each reader:** `about` 8:0 and `none` 3:1. **Met.** The new
  prompt won 11 of 12 decided test pairs (92%). The control's larger side won 3 of 5 (60%). That
  is a 32-point margin, over the 20 required. For `none` alone the control decided only one pair,
  so the margin there is uninformative.
- **Q2, no more faults on the new side:** 12 against 12 pooled. **Met, with a soft spot.** For
  `none`, the new side had 7 faults and the old 5. Three fell only on the new side: an overreach
  on scaling-hypothesis, a stretched causal claim on analog-cognition, and a narrowed framing on
  Greg's paper ("helps memory" for "hippocampal activity during rearing matters"). The control's own
  split is 5 to 7, so this is inside the noise.
- **Q3, the shape no worse:** 3:2. **Met.**
- **No failed runs:** met, once the three credit failures were repeated.

**Decision: ship `simple-prompt/5`.**

## Read by hand: Greg's article

Greg's production Brief (expert profile, `simple-prompt/2`) said "closed-loop optogenetic silencing
of dorsal hippocampus" and "delayed win-shift radial maze task". The new prompt with the expert
reader wrote:

> Rats often stop and stand up on their back legs to look around, called rearing. The hippocampus,
> a brain part needed to remember places, was known to matter for memory. But nobody knew if its
> work during rearing mattered, so this rat experiment tested it.
>
> Briefly switching off the hippocampus only while rats reared made them worse at a maze memory
> test. Their correct first choices fell from about 78% to 66%. Switching it off for the same time,
> but six seconds later, caused no clear drop. So brain activity during rearing can be important for
> remembering places.

It opens on the goal and ends on the conclusion, keeping the hedge ("can be important"). One
no-profile draw dropped the 78% → 66% figures for "remembered where food was less well". The prompt
allows that ("only the numbers the takeaway rests on"), but it is a loss for a reader who wanted the
size of the effect.

**The local expert is weaker than Greg's own case.** `readers.json` claims cognitive science, not
hippocampal physiology, and the old prompt's local Brief on this paper was already plainer than his
production one. The screens and the blind read measure the mechanism, a claimed background no longer
licensing jargon. They do not measure his exact profile.

## Side findings, not caused here

- **Most fidelity faults sit on both sides**, and they are the same kind: a detail true elsewhere
  in the article but absent from the passages a paragraph cites ("thunderstorms" on the
  ball-lightning paper, "mouse brain tissue" and "monkeys" on the entropy paper). The judge saw
  only the cited passages, so some are citation gaps rather than inventions. The production
  fidelity guard passed every Brief in the after arms. It is worth a look if Brief's citations
  matter more than they do now.
- **"Seems promising" became "among the best evidence"** on the ball-lightning paper in old and new
  drafts alike. That is hedge inflation, which the prompt already forbids.

## Caveats

Five articles, two draws a side, and one judge from the same family as the writer. The `about`
reader is synthetic. The screens are proxies (prompting-guide.md § Measuring, step 7).
