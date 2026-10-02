# Which model should write a *Dig deeper* answer?

2026-10-01 to 2026-10-02. The eval is plan
[261001s](../plans/261001s-dig-deeper-answer-model-eval.md) (worktree `dig-deeper-eval`); its own
report is [evals/results/dig-deeper/2026-10-02-main-report.md](../../evals/results/dig-deeper/2026-10-02-main-report.md),
run `main`, manifest commit `e0fe8741ffed`. GPT Sol reviewed it three times: the plan
([plan review](../plans/261001s-dig-deeper-answer-model-eval-plan-review-sol.md), F1–F9), the code
before any money was spent ([code review](../plans/261001s-dig-deeper-answer-model-eval-code-review-sol.md),
F10–F21) and the numbers with the conclusion
([results review](../plans/261001s-dig-deeper-answer-model-eval-results-review-sol.md), F22–F28,
*"stands after my fixes"*). Every number below is from those files unless it says otherwise.

**The decision: the answer model stays Opus 5.5.** Nothing in production changed.

## The question

*Dig deeper* is the one action that says "I want to know more about this": a glossary entry's
button, a comment's re-ask, and a cited work's closer look in Citations
([glossary.md § Digging deeper into a term](../project/glossary.md#digging-deeper-into-a-term)). A
press runs a forced web search on a quick model, then writes the answer on a bigger one.
[261001p](../plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md) put that answer on
Opus because Greg asked for "a bigger model", not because anything had measured Opus as better. So:
is Opus worth its price here, or does a cheaper model write as good an answer?

> yeah ok, let's set up that eval with at least 3 varied representative tricky examples, and then
> try a few different models (e.g. GPT Sol 6, Kimi K3, DeepSeek v4.1 Flash, Google Gemini 4 if
> available, and a couple of others that look promising based on Artificial Analysis results), and
> we'll have to think about how to trade off quality against cost.
>
> — Greg, 2026-10-01

## The six presses, and why each is hard

Two per entry point, because glossary and comment share one prompt and Citations has its own, so
one example per prompt would confuse "this model is worse" with "this example is odd". Chosen by an
Opus subagent from local articles; each quote checked verbatim against the database
(`evals/dig-deeper/examples.ts`).

| id | entry point | article | what makes it hard |
|---|---|---|---|
| `kuhn-challenge` | glossary | Kuhn, *A landscape of consciousness* (academic PDF, ~255k tokens) | "Challenge Theories" is Kuhn's own category; the web's "challenge theory" means unrelated things, and the definition sits ~1,600 blocks after the first mention |
| `seth-naturalism` | glossary | Seth, *The Mythology of Conscious AI* (essay, ~13k) | Seth's "biological naturalism" (being alive is necessary) is not Searle's, which is what the web says |
| `feynman-millikan` | comment | Feynman, *Cargo Cult Science* (talk, ~5k) | a famous story historians dispute; a good answer keeps the story apart from the history |
| `kuhn-sapolsky` | comment | Kuhn again | the article hedges the quote ~150 blocks earlier and Sapolsky hedges two blocks later; the web alone misses both |
| `gwern-schmidhuber` | citation | gwern, *The Scaling Hypothesis* (~26k) | two untitled works behind one footnote; a confident single pick is wrong |
| `antikythera-parker` | citation | *Antikythera mechanism*, Wikipedia (~24k) | the article contradicts itself on 365 vs 354 days, and the work is cited for the 354 reading |

## The method

- **The search was run once and frozen.** `capture --spend` ran production's `searchFirst` per
  example (and, for Citations, the lookup and paper read a first press does), and saved the result
  with a hash of the article's text. Every model then answered from **the same messages, built by
  production's own builders**, so only the answer model varied.
- **No web tool for the answer model, and it was told so.** In production the answer model may
  search again; here that would let each model read different pages. Every line promising a tool
  was replaced by *"That search is all the research there is; you cannot search again"*, guarded by
  a test that fails if the replaced text drifts (Sol F2, F11).
- **Production's settings and acceptance rules**: the 4,000-token ceiling, Anthropic models on the
  `dig-deeper` route, every answer through its entry point's real refusal rule, so an answer a
  reader would not have been shown counts as not delivered (Sol F1).
- **Three answers per model per press**; the first two judged, all three priced.
- **Three judges from three families, blind**: Opus 5.5, GPT-6.1 Sol and Grok 4.7, in small batches
  of three or four answers with random letters, **each batch including an Opus answer as the
  anchor**. Kimi K3 was the planned third judge; it could not be one (below).
- **Quality is measured against Opus**: an answer's overall score (1–10) minus the Opus answer's in
  the same batch, so 0 means "as good as Opus". *Acceptable* means accuracy ≥ 4 and sourcing ≥ 4
  from at least two of three judges, with no factual error two judges point at. Both were declared
  before the run.
- **A control**: Opus answered twice under two labels (`opus`, `opus-b`), judged blind side by
  side, to show how far one model drifts from itself.

## The result

Run `main`, 2026-10-02: 216 answers (12 arms × 6 presses × 3 draws), 120 judge calls. "Repeat
press" is a warm press including the shared search step (~$0.024); "first press" is the cold write
of the article, averaged over six presses and dominated by the 255k-token PDF. Table from the
plan's § Result, which is the report's per-arm table with the search step added.

| arm | delivered | acceptable | quality vs Opus | Grok judge | words | repeat press | first press | reader waits |
|---|---|---|---|---|---|---|---|---|
| **Opus 5.5** (today) | 18/18 | 8/12 | 0 | 0 | 337 | $0.085 | $0.74 | 19 s |
| Opus again (control) | 18/18 | 8/12 | −0.06 | −0.10 | 330 | — | — | — |
| **GPT-6.1 Sol** | 18/18 | **10/12** | −0.47 (all) / −1.23 (outside OpenAI) | −0.60 | 204 | **$0.036** | $0.25 | **12 s** |
| Luna + Opus check | 18/18 | 8/12 | −0.29 | −0.50 | 245 | $0.084 | $0.75 | 33 s |
| Grok 4.7 | 18/18 | 8/12 | −0.74 | (own family) | 235 | $0.136 | $0.38 | 46 s |
| Sonnet 5.5 | 18/18 | 6/12 | −1.24 | −1.70 | 270 | $0.065 | $0.38 | 14 s |
| DeepSeek V4.1 Flash | 17/18 | 3/12 | −1.23 | −1.00 | 350 | $0.028 | $0.03 | 41 s |
| Luna alone | 18/18 | 7/12 | −2.21 | −2.50 | 129 | $0.025 | $0.04 | 13 s |
| Sonnet 5 (before 261001p) | 18/18 | 1/12 | −2.38 | −1.90 | 329 | $0.063 | $0.38 | 7 s |
| Gemini 3.8 Flash | 18/18 | 2/12 | −2.79 | −2.40 | 214 | $0.037 | $0.10 | 15 s |
| GLM-5.3 | **8/18** | 2/12 | −1.35 | −1.00 | 290 | $0.071 | $0.05 | 71 s |
| Kimi K3 | **3/18** | 0/12 | −1.33 | −1.00 | 326 | — | — | — |

In plain words:

- **Opus has the highest quality point estimate, but six presses do not prove it is the best.**
  Sol's 90% interval (−1.06 to +0.06) and Luna + check's (−0.64 to +0.17) both include Opus.
- **Sol was the strongest challenger**: acceptable on all ten presses the full panel judged (the
  other two, on `kuhn-sapolsky`, had only two judges and so could not be certified), about **58%
  cheaper per warm press**, and **7 seconds quicker**. But it is shorter (204 words to 337), shallower
  (depth 3.7 to 4.5), and weakest on the long PDF's glossary term (−2.0 on `kuhn-challenge`).
- **"Luna writes, Opus checks" saved nothing.** Opus rewrote Luna's draft in 83% of presses; a warm
  press cost $0.08437 against Opus's $0.08500 (under 1% less), a cold one slightly more ($0.748 vs
  $0.743), and the reader waits for both calls: 33 s against Opus's 19 s, **14 seconds more**.
- **Everything cheaper than Sol is clearly worse** (DeepSeek, Luna, Gemini Flash), and Sonnet 5, the
  set-up before 261001p, is near the bottom, which supports that change after the fact.

### Noise

From the report's § Noise: the control (Opus drawn twice) is −0.06, interval −0.31 to +0.36;
re-judging 57 answers with a fresh shuffle moved the overall score by 0.37 on average, every one
within a point; Sol's run-to-run spread was the smallest of any arm (0.08).

## Caveats

- **Six presses.** The intervals are bootstrapped over the six, and they are wide.
- **Judges favour their own family, and not evenly.** Sol's own judge puts Sol *above* Opus (+0.92),
  the Opus judge well below (−1.75), Grok in between (−0.60). Grok scores its own arm −0.50 against
  −0.83 from the others, and the Opus judge put every arm below Opus. Grok is outside Sol's family,
  but "neutral judge" overstates it (Sol F24).
- **No model ran its own web search.** In production the answer model may search again. The
  production-shaped check, Opus and the two best others through the real route with the tool on,
  was planned (Sol F2) and **not run**: it did not fit the budget.
- **First-press cost is inflated by the 255k-token PDF**, and is far lower on an ordinary article.
- **The judging was trimmed to fit the budget**: Grok did not judge `kuhn-sapolsky`, and the
  re-judge covered two presses, so 120 of 162 planned judge calls (`manifest.json`, `trimmed`).

## Models that failed or were not available

- **Kimi K3** (Greg named it; Artificial Analysis's best long-context score) delivered **3 of 18**:
  every request on the 255k-token PDF came back HTTP 429, across two sessions, and most of the rest
  ran past explain's two-minute deadline. For the same reasons it could not be the third judge, and
  Grok 4.7 took its place.
- **GLM-5.3** delivered **8 of 18**: empty answers, and glossary answers cut off by the 4,000-token
  ceiling and refused as a reader's would be.
- **Gemini 4 was not available.** It is not on OpenRouter: "Gemini 4 Argon" was announced on
  2026-09-30 for a closed programme (checked 2026-10-01). Gemini 3.8 Flash, Google's newest listed
  model, stood in, and came last on quality.
- **Qwen3.8 Max** was passed over before the run: $5.41 a task and 39 tokens/s on Artificial
  Analysis (read 2026-10-01). Gemini 3.1 Pro Preview and MiniMax M3 were passed over as weaker than
  arms already in.

## Other paths not taken

- **Letting each model search for itself.** Closer to production, but each would read different
  pages and the comparison would be of searches, not of writing.
- **One judge, or all twelve answers in one judge call.** One judge would grade its own family; one
  big batch compresses the scores (Sol F5).
- **The production-shaped finalist run, ~$7.** Offered after the run, and declined (below).

## What it cost

Budget-accounted total **$38.74**: $37.51 on run `main` (capture included) and $1.23 of smoke runs.
$0.73 of that is a conservative upper bound for ten timed-out calls that reported no cost, so it is
what was charged against the cap, not an exact bill (Sol F25). The cap was raised three times
($37 → $38.60 → $38.70) because a warm Opus call on the PDF reserves its full uncached price, and
Greg then allowed a hard $50 ceiling for the whole eval.

## The decision

> Q-dig-deeper-model I was tempted to switch to Sol, but let's go with your recommendation and keep
> Opus for now. make sure all such research gets written up in docs/research/ or somewhere similar
>
> — Greg, 2026-10-02

So: **Dig deeper's answer stays on Opus 5.5** (`DIG_DEEPER_MODEL`, `src/dig-deeper.ts`). The ~$7
production-shaped Opus-vs-Sol check is **not run**, and **"Luna writes, Opus checks" is dropped**:
it measured no saving and added 14 seconds of waiting. Recorded in
[glossary.md § Digging deeper into a term](../project/glossary.md#digging-deeper-into-a-term).

## What would reopen it

- **More presses.** Six is enough to rule out the clearly worse models, not to separate Opus from Sol.
- **The wait becoming a complaint.** Sol answered 7 seconds sooner; if readers say Dig deeper is
  slow, that is the first lever.
- **Sol improving**, or a new Sol, especially on depth and on very long articles, its two weak spots.
- And before any switch: the production-shaped check above, since the ordering might not survive
  models being allowed to search.

## How to re-run it

From [evals/README.md § `dig-deeper/`](../../evals/README.md):

```
npm run eval:dig-deeper                          # preflight: free, builds every request, prints the bill
npm run eval:dig-deeper -- capture --spend       # the search step, once per press, frozen
npm run eval:dig-deeper -- answers --spend
npm run eval:dig-deeper -- judge --spend
npm run eval:dig-deeper -- report                # free
npm run eval:dig-deeper -- finalists --spend --arms a,b   # the production-shaped check, Opus added; not yet run
```

`--spend` is the only way to spend; the budget file per run reserves an upper bound before each
call. Everything raw (web excerpts, paper text, other articles' passages, every answer and
judgement) lives in **`output/dig-deeper-runs/<run>/`, which is gitignored** (`/output/` in
`.gitignore`), so it exists only on the machine that ran it. Only the promoted report is committed.
The judges are in `evals/dig-deeper/judges.ts`, apart from `arms.ts`, because `arms.ts` is in every
answer cell's key and editing it marks every paid answer stale.

---

Up: [research.md](../project/research.md)
