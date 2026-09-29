# FAQ: a few big questions first, and the Glossary's scores and threshold

**Status:** planned, 2026-09-29. Feedback report SPIDERYARN-READING2-5D (`spya-yyf38a`).

## What was asked

Greg, 2026-09-29, on `/read/9689-full-spya-m43th2?mode=faq`:

> The FAQ questions seemed pretty kind of dense and low level. I wonder if we could perhaps start
> with a few that are a little bit more high level. Or actually, perhaps we could even consider
> using the same approach we use for the glossary and other places, where we give each question a
> rating for something like how difficult and how central, as well as the ordering. And that way
> then we could have a prioritized ordering by default with a threshold, and the threshold could be
> some compound of difficulty and centrality. And then it would show them in order given that
> threshold.

The brief that came with it: reuse the Glossary's rating and threshold machinery rather than
build a second one; this is a prompt change, so measure before and after on real articles; old
FAQ lists with no ratings must still render.

## Why the questions come out dense

Not an accident: the prompt asks for it. `FAQ_SYSTEM` in [`src/faq.ts`](../../src/faq.ts) bans
"whole-piece questions" and puts "an objection the piece anticipates" first, and "the rule that
matters most" is to skip any question the passage in front of you answers. That rule, and nothing
else, is what makes every question local. So the fix has two halves, and they answer Greg's two
sentences:

1. **The prompt asks for a few big questions as well** — two or three about the central claim or the
   overall move (*"Why should we think X at all?"*, *"What would have to be true for the main claim
   to fail?"*). They are still questions a careful reader would put to the piece, still anchored to
   the passages where it responds, and still not summaries: *"What is this about?"* stays banned.
2. **Every question carries `difficulty` and `centrality`, 0–1**, the Glossary's two scores under
   the Glossary's names, and the panel gets the Glossary's *prioritised* order with a threshold
   slider, as the default.

## The design

### The two scores, for a question

- **`difficulty`** — how deep into the piece a reader has to be before the question arises: `0` is a
  question anyone would ask on first meeting the main claim, `1` one that only arises inside a
  technical detail. This is the axis Greg called "high level" versus "dense and low level".
- **`centrality`** — how much of the piece's argument turns on the answer: `1` the main claim stands
  or falls with it, `0` a side point.

Validated exactly as the Glossary's are — `score()` and `scoreCounting()` from
[`src/glossary.ts`](../../src/glossary.ts), exported rather than copied, counting absent and
rejected scores into a `GlossaryScoreDrops`, logged on the stage's line and not stored.

### What the threshold is on, and what order survivors are in (the product call)

Greg left the compound open (*"some compound of difficulty and centrality"*). The Glossary's is
`difficulty × centrality`, and **it is the wrong compound here**: it measures the cost of *not
knowing* a term, so it sends easy-and-central to the bottom — and easy-and-central is exactly the
high-level question Greg asked to see first. A question scored `d 0.1, c 1.0` would sit on the
Glossary's default bar at `0.10`, the first thing a drag would hide.

So, the simplest version that does what he described, taken as an **assumption to be confirmed**:

```
prioritised (the default)
  in or out:  centrality ≥ the threshold          the slider; peripheral questions go first
  order:      difficulty, lowest first            the big questions at the top, then deeper
              ties → reading order                (and unscored → end, in reading order)

reading order (one tap away)
  every question, where the piece first responds  what the FAQ does today
```

The compound is therefore the pair: centrality decides *whether*, difficulty decides *where*. Both
raw scores are drawn on every row in the prioritised order (`ScoreBars`), never a composite, as in
the Glossary and Citations.

**Why ordering by a model score is acceptable here when the Glossary refuses it:** the Glossary
argues two noisy scores multiplied rank badly. One score, on the axis the reader asked about, with
reading order as the tie-break, is a coarse sort that the reader can see the basis of and undo in one
tap. What this still bets on is that the model separates "big question" from "detail question"
reliably enough for the top three to be big — which is what the eval measures.

**The simpler option passed over:** prompt-only — ask for big questions and do nothing in the UI.
It answers the first sentence but not the second, and in reading order the big questions land
wherever their first passage is, often not at the top.

### Reuse, not a third copy

The Glossary's gate arithmetic (`floorToGateStep`, `GATE_STEP`, the track's top, *can this list be
prioritised at all*) was already copied once, into Citations (`barTop`, `barMax`, `canPrioritise`).
FAQ would be the third. Instead:

- **[`src/web/threshold.ts`](../../src/web/threshold.ts)** gains `GATE_STEP`, `floorToGateStep` and
  three generic helpers taking a score accessor — `thresholdTop`, `thresholdMax`, `canThreshold`.
  The Glossary's and Citations' exports become one-line wrappers (their names stay, since tests and
  other files import them).
- **A shared `ThresholdSlider` component** for the slider row (label, value, `N of M`, reset, range,
  foot line), which the Glossary's `GateSlider` and Citations' `BarSlider` already duplicate
  line for line. FAQ uses it; Citations and Glossary move onto it if their tests stay green untouched.
  Quotes and Search have different tracks and are left alone.

### URL, defaults, old lists

- `?faqorder=prioritised|document` and `?faqbar=0.xx`, spelled like `?citeorder=`/`?citebar=` in
  [`params.ts`](../../src/web/params.ts): order pushes history, the bar replaces and is debounced,
  and the bar has no default of its own so absent means *nobody touched it*.
- The default bar is set from the eval's scores so that most questions show (Greg, 2026-09-12:
  *"most of the entries are coming in by default"*); the starting guess is `0.30`.
- **An old FAQ has no scores**, so `canThreshold` is false, the order falls back to reading order,
  no order row and no slider are drawn, and the list renders as it does today. A test pins it.
- `PROMPT_VERSION` goes to `faq/4`. Old lists are not announced (plan 260929c); Metadata re-runs.
- Visitors: `publicFaq` in [`src/public/dto.ts`](../../src/public/dto.ts) copies field by field, so
  the two scores are added there — a visitor sees the same order and slider.

## Stages

1. **Plan review** (Sol, read-only).
2. **Build**: the prompt and validation (`src/faq.ts`, `types.ts`, `dto.ts`, pipeline log line); the
   shared threshold helpers and slider; the FAQ panel's order row, slider and score bars; params and
   Reader wiring; tests. Gates: `npm test` on the touched suites, `npm run typecheck`.
3. **Eval** — `evals/faq-levels/run.ts`, production's `generateFaq` on three local articles
   (`entropy-24-00930-spya-pywwkq`, a dense paper like Greg's; `noema-mythology-of-conscious-ai`;
   `spider-silk-spya-ge30uz`). Arms: `before` and `before-2` on the parent commit, `after` on this
   one. Blind pairs, shuffled with `crypto.randomInt` and the key checked for balance, compare **the
   first five questions a reader sees by default** (reading order for `before`, prioritised at the
   default bar for `after`). A fresh judge answers per pair: which opening gives a first-time reader a
   better way in; did either include a summary-with-a-question-mark, a definition or a trivia
   question. Screens: questions per run, drops, score spread, how many the default bar hides.
4. **Code review** (Sol, fixing inside the stage), gates, browser check (Sonnet subagent, owner and
   visitor, an old unscored list), docs (`faq.md`), feedback note, push, remove the worktree.

## Progress

### Stage 2 — built (2026-09-29)

As § Stage 1 says, with one addition: the eval's harness had no spend collector, so the four arms
below are in no `ai_calls` ledger (each call logged *"no spend collector open"*). `run.ts` now opens
one with an `eval` scope, as `evals/illustrated/run.ts` does.

### Stage 3 — the eval (2026-09-29)

`evals/faq-levels/`: `run.ts` (generate, report, pairs), `calibrate.ts`, and the arms and the judge's
verdicts under `evals/results/faq-levels/`. Six local articles — two dense papers
(`entropy-24-00930`, `analog-cognition-and-consciousness`), four essays. Four arms: `before`,
`before-2` on the parent commit (`faq/3`); `after`, `after-2` on this one (`faq/4`). 24 calls to
`claude-sonnet-5`, 507k input and 131k output tokens: **about $2.30** at the ledger's rates
($2 / $10 per million).

**Screens.** Every `faq/4` question in all 12 runs carried both scores (zero absent, zero rejected).
Questions per list 6–10, as before (6–11). Drops unchanged in kind.

**The blind judge** (a fresh Opus subagent, reading only the lettered pair files; keys balanced 2–4
of 6 on each side). Per comparison, wins / ties over six articles and the mean of the judge's 1–5
"how high-level is this opening":

| | comparison | wins | ties | level |
|---|---|---|---|---|
| A | old prompt vs itself (control) | 3–2 | 1 | 3.33 vs 3.17 |
| B | prompt: old vs new, both reading order | 1–2 | 3 | 3.33 vs 3.50 |
| C | prompt, second draw | 1–2 | 3 | 3.17 vs 3.50 |
| D | rule: new reading order vs new prioritised | 1–3 | 2 | 3.50 vs 3.83 |
| E | rule, second draw | 0–4 | 2 | 3.50 vs 4.33 |
| F | what Greg saw vs what he will see | 2–4 | 0 | 3.33 vs 3.83 |
| G | the same, second draw | 0–6 | 0 | 3.17 vs 4.33 |

**What it says.** The **ordering** is the effect: prioritised beat reading order 7–1 over two draws,
and the whole change beat the old default 10–2. The **prompt's wording alone** is inside the
control's spread (2–1 twice against 3–2 for old-vs-old) — not shown to help, and not shown to hurt.
Banned kinds were rare on both sides: the judge flagged three borderline questions in 84 openings,
two from the old prompt and one from the new — and that one is under the default bar.

**Stability.** Two `faq/4` runs write different questions, so the top three can only overlap by
substance: on average 1.7 of 3 of one run's top three have an equivalent in the other's opening,
from 3 of 3 (the bugs essay) to 0–1 (the analog paper). Both draws of the rule comparison won, so
the sort is doing its job even where the questions differ. **Kept the sort; did not fall back.**

**The default bar**, chosen on three articles and checked on three held out (predeclared floor 80%):

| bar | calibration | held out | lowest list |
|---|---|---|---|
| 0.10 | 97% | 97% | 83% |
| 0.15 | 93% | 95% | 83% |
| **0.20** | **89%** | **91%** | **71%** |
| 0.25 | 75% | 82% | 67% |

`0.20`: the highest stop over the floor on the calibration half, and nearest the Glossary's 87%.

**Greg's own article** (`9689-full-spya-m43th2`) is on production only; nothing here reads
production, so it was not in the set. It will get the new prompt when the FAQ is re-run from
Metadata.

### Stage 1 — plan review (GPT Sol, 2026-09-29): build with changes

[The review](260929g-faq-difficulty-centrality-and-a-threshold-review-sol.md). Taken, and what they
change above (where this section and the design disagree, **this section wins**):

- **F1 (P1) — one compound, not a pair.** Centrality-gates-and-difficulty-orders is not a compound
  threshold, and it makes the slider remove rows from arbitrary places in the list. Now:
  `priority = centrality × (1 − difficulty)` — the FAQ's analogue of the Glossary's product: central
  and approachable scores highest. It gates **and** orders (descending, reading order breaks ties,
  unscored last in reading order), so dragging the bar right trims the list from the bottom, which
  is what a reader will expect. The cost: a dense but central question (`d .8, c 1.0` → `0.20`) is
  cut before an easy peripheral one (`d .1, c .3` → `0.27`). Accepted, because the complaint was
  density, and the default bar keeps both. If the two `after` runs disagree on the top three, fall
  back to compound-gated reading order (the Glossary's rule) rather than keep an unstable sort.
- **F2 (P2) — what "difficulty" means.** It stays `difficulty` — Greg's word, and the Glossary's
  field — but is defined as reader difficulty: how much of the piece, and how much technical
  detail, a reader needs before the question makes sense. The bar's tooltip says that.
- **F3 (P1) — the prompt.** Sol's wording for "broad pressure questions", with the bad examples
  (*"Why should we believe the main claim?"*, *"What evidence supports it?"*, *"How does the article
  develop its argument?"*).
- **F4/F5 (P2) — reuse.** The arithmetic moves to `threshold.ts` (`GATE_STEP`, `floorToGateStep`,
  `thresholdTop`, `thresholdMax`, `canThreshold`); Glossary and Citations keep their exported names
  as wrappers, and the generic invariant is pinned
  (`canThreshold ⇔ applyThreshold at thresholdTop hides something`). **The slider component is
  deferred for the other two panels**: FAQ gets a dumb `ThresholdSlider` taking primitives, and
  moving Glossary and Citations onto it is follow-up work with its own browser check.
- **F6 (P1)** — `ANSWER_TOKENS` gains the two scores per question.
- **F7 (P1)** — `publicFaq` copies both scores, and the public-DTO test gets scored values and
  asserts them; a legacy question with neither still renders.
- **F8 (P2) — duplicates.** The first occurrence owns the text and the scores; later duplicates add
  passages only. Scores are counted (absent / rejected) on every readable raw question before
  merging. The validator and its counter move to a neutral `src/score-fields.ts`; the Glossary
  imports it from there.
- **F9 (P2)** — `?faqby=` / `?faqbar=`, following `citeby`/`citebar`; a `useFaqControls` in
  `FaqMode.tsx`, shared by both bands; `last-view.ts`, `url-state.md`, `mode-catalog.ts`, the panel's
  and controller's "no scores, no params" comments, and the head-row test all updated.
- **F10 (P1) — the eval.** Six articles, `before`, `before-2`, `after`, `after-2`. Greg's own
  article (`9689-full-spya-m43th2`) is on production only and this box has no production read, so
  it is not in the set. Two separate comparisons: (1) the prompt — old against new, both in reading
  order; (2) the rule — new reading order against new prioritised. Per opening the judge scores
  high-levelness and the forbidden classes, not only a winner. Top-three overlap between `after` and
  `after-2` in prioritised order tests the sort's stability. The default bar is chosen on three
  articles to show at least 80% on average (predeclared, the Glossary's 87% being the reference) and
  checked on the other three.
