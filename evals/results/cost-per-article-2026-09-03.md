# What one article costs, 2026-09-03

**An ingest costs $0.03 on a 561-word essay and $0.33 on a 16,855-word one. Pressing every mode
button on top takes those to $0.35 and $1.55.** A 14-page PDF sits between: $0.31 to ingest,
$1.23 with everything pressed. Nothing here is extrapolated — each figure is one measured job on
one committed fixture, with the ledger read back per call.

Ingest is what every reader pays without asking for anything. Everything above it is on demand, and
**four modes are two thirds of it**: sketch, timeline, quiz and ideas. They are expensive for one
reason — **36% of all the money measured here bought reasoning tokens**, billed as output at
$10/MTok and never shown to anybody.

The eval that produced this is [`evals/cost/`](../cost); the plan is
[260902g](../../docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md). The
sweep cost **$7.35** against $20 authorised. Every figure below carries its reproduction command.

## Per article, per step

Cold first generation, one mode per job, `anthropic/claude-sonnet-5` except where noted. All money
is credits plus BYOK upstream, totalled the way [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts)
does. **No unpriced rows in any run** — no line here is short by an unknown amount.

| step | short-html<br>561 w, 19 blocks | pdf<br>11,937 w, 14 pp, 94 blocks | long-html<br>16,855 w, 186 blocks |
|---|---:|---:|---:|
| `extract` (PDF only, BYOK Luna) | — | $0.0517 | — |
| `hierarchy` structure | $0.0241 | $0.1663 | $0.2149 |
| `hierarchy` label fan-out | $0.0102 | $0.0914 | $0.1150 |
| **ingest subtotal** | **$0.0343** | **$0.3094** | **$0.3299** |
| `arc` | $0.0080 | $0.0552 | $0.0733 |
| `tweets` | $0.0080 | $0.0592 | $0.0711 |
| `glossary` | $0.0151 | $0.0781 | $0.0941 |
| `quotes` | $0.0096 | $0.0635 | $0.0711 |
| `ideas` | $0.0391 | $0.1305 | $0.1760 |
| `timeline` | $0.0401 | $0.2736 | $0.2499 |
| `quiz` | $0.0484 | $0.0938 | $0.1854 |
| `sketch` | $0.1443 | $0.1671 | $0.2994 |
| article embeddings | not run | not run | $0.0010 |
| **everything pressed** | **$0.3468** | **$1.2304** | **$1.5511** |

`fetch`, `blocks` and `assets` call no model and cost nothing. Summary mode is free — it draws the
gists hierarchy already wrote ([summaries.md](../../docs/project/summaries.md)).

**The bottom row is a floor, not a ceiling.** `referee-claims` is a stored per-article artefact and
its one attempt produced nothing (see *Paid failures*), so no article total here includes it. Live
conversation is metered outside the ledger and is out of scope for this eval.

### The range

| | ingest only | everything pressed |
|---|---|---|
| 561-word essay | $0.034 | $0.35 |
| 14-page PDF | $0.31 | $1.23 |
| 16,855-word essay | **$0.32 – $0.39** (6 draws, median $0.331) | $1.55 |

**An article costs $0.03–$0.39 to ingest and $0.35–$1.55 with every mode generated.** That confirms
the estimate the Reader tier was priced against — Greg's "it can cost £1 to fully process an
article", [billing.md](../../docs/project/billing.md#what-we-sell-and-the-one-promise) — from
measurement rather than from a guess.

### Per 1,000 words

| | ingest | everything |
|---|---:|---:|
| short-html | $0.0611 | $0.6182 |
| pdf | $0.0259 | $0.1031 |
| long-html | $0.0196 | $0.0920 |

**The short article is three times dearer per word to ingest and nearly seven times dearer with
every mode pressed.** That is not a rounding artefact and it is worth understanding before anybody
prices per word: a mode's cost is dominated by what it *writes*, and what it writes is set by the
mode's shape far more than by the article's length. `sketch` on 561 words emits 12,973 output
tokens against 22,845 on 16,855 words — thirty times the input for 1.8× the output. Charging by
input length would misprice both ends.

## Where the money goes

Ranked on `long-html`, the worst case. The order is nearly identical on the other two.

| rank | AI job | $ | % of article | output tokens | of which reasoning |
|---|---|---:|---:|---:|---:|
| 1 | `sketch` | $0.2994 | 19% | 22,845 | 76% |
| 2 | `timeline` | $0.2499 | 16% | 18,915 | 87% |
| 3 | `hierarchy` structure | $0.2149 | 14% | 15,783 | 72% |
| 4 | `quiz` | $0.1854 | 12% | 12,415 | 67% |
| 5 | `ideas` | $0.1760 | 11% | 11,488 | 58% |
| 6 | `hierarchy` labels | $0.1150 | 7% | 4,730 | 0% |
| 7 | `glossary` | $0.0941 | 6% | 3,630 | 17% |
| 8 | `arc` | $0.0733 | 5% | 1,540 | 60% |
| 9 | `quotes` | $0.0711 | 5% | 1,503 | 0% |
| 10 | `tweets` | $0.0711 | 5% | 1,580 | 12% |

**The one number to take away: across all 33 Anthropic calls in the three per-mode runs, output
tokens are 61% of the $3.08 spent, and reasoning alone is 36% ($1.11).** 110,986 of 187,169 output
tokens were reasoning. The top five rows above are exactly the five jobs that run at effort `high`
or emit long structured answers; the cheap five are the ones that emit a short list. Effort is a
per-stage constant ([`src/models.ts`](../../src/models.ts) `STAGE_EFFORT`, read at run time by the
eval and recorded in each `run.json`), so it is a dial, not a fact about the work — but moving it
trades against quality, which
[`effort-vs-quality.md`](effort-vs-quality.md) has already measured for `arc` and `glossary` and
nothing has measured for the five that matter here. That is the next question, not this report's
answer.

`hierarchy` labels and `quotes` emit **zero** reasoning tokens and are correspondingly cheap per
token written. They are the shape the expensive modes are being compared against.

## Long-article hierarchy: observed variation

Hierarchy is the one paid step every article pays and the one whose cost the plan expected to
wobble, so it got repeat cold draws on `long-html` — a fresh slug and article per draw, because
`force` does not bypass step artefacts.

**Seven cold draws. Six produced a tree; one did not.**

| draw | run | structure | output | sections | labels | ingest total | outcome |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | `04-43-03` | $0.2149 | 15,783 | 39 | $0.1150 | $0.3299 | done |
| 2 | `04-59-07` r1 | $0.2114 | 15,424 | 36 | $0.1146 | $0.3260 | done |
| 3 | `04-59-07` r2 | $0.2124 | 15,530 | — | — | $0.2124 | **failed** |
| 4 | `05-22-04` r1 | $0.2071 | 14,991 | 35 | $0.1149 | $0.3220 | done |
| 5 | `05-22-04` r2 | $0.2126 | 15,551 | 40 | $0.1193 | $0.3320 | done |
| 6 | `05-22-04` r3 | $0.2247 | 16,764 | 41 | $0.1167 | $0.3414 | done |
| 7 | `05-22-04` r4 | $0.2453 | 18,813 | 39 | $0.1420 | $0.3873 | done |

Cost conditional on success: **median $0.2138, range $0.2071–$0.2453** — an 18% spread, inside the
~30% the plan set as the trigger for a fifth draw, so four was enough. Full ingest conditional on
success: median $0.3309, range $0.3220–$0.3873. Total paid across all seven, failure included:
$2.2511.

**This is an observed count, and it must not be turned into a rate.** Seven draws cannot support a
failure probability, and the plan's Principles forbid quoting a tail. The point of saying "6 of 7"
rather than "14%" is visible in the table: draws 2 and 3 were the first two ever taken, and on their
own they read as 50%. A number computed from them would have been confidently wrong in the
expensive direction.

Draw 3's failure is the interesting one and is not a truncation. The call returned, was billed
$0.2124 with `outcome: "ok"` at the gateway, and the tree it wrote failed its own range check —
`Node range not in blocks.json — at root > child 5 > child 3: end not a block id`. The label
fan-out never ran, because it runs only after the structure succeeds. **The gateway's outcome is
not the stage's outcome**, which is why the runner records both.

Cost tracks output tokens almost exactly (draw 7 is the dearest and wrote the most), and the number
of sections varies 35–41 across identical input. Both are adaptive thinking doing what
[`src/token-budget.ts`](../../src/token-budget.ts) says it does.

## Per interaction

A reader pays these **every time they press something**, and they must never be added to an
article's cost. Measured on the 16,855-word fixture — the ceiling, since every one of these sends
the whole article.

| interaction | cold | warm | cache worth |
|---|---:|---:|---:|
| `chat` turn | $0.1335 | $0.0232 | 5.7× |
| `remember` turn | $0.1293 | $0.0239 | 5.4× |
| `explain` a selection | $0.1088 | $0.0136 | 8.0× |
| `search` for passages | $0.1064 | $0.0206 | 5.2× |
| `quiz` marking | $0.1022 | $0.0113 | 9.0× |
| `referee-criterion` | $0.1321 | *paid failure* | — |
| `referee-candidates` (two turns) | **$0.3837** total | — | — |
| `referee-mirror` | $0.0115 | never warm | — |
| glossary term lookup | *see below* | $0.0133 | — |
| `dictation` (4-second clip) | $0.0001 | — | — |

**A cold interaction is mostly the cache write.** `chat` cold writes 43,053 tokens at the 1.25×
premium; that write is $0.108 of its $0.134. Warm, the same prefix reads at 0.1× and the turn costs
$0.023. This is [prompt-caching.md](../../docs/project/prompt-caching.md) working exactly as
documented — and the caveat there is the one that matters for pricing: **the second use has to be
of the same feature.** A reader who searches, then asks a question, then explains a sentence pays
three cold writes, not one.

Three rows need reading rather than quoting:

- **`referee-candidates` is one interaction that costs $0.38.** Its two turns do different work —
  round 1 is the fit brief ($0.1225), round 2 asks for names and does nearly all the searching
  ($0.2612, 355k input tokens against up to 30 Exa results). Their ratio is not a cache
  measurement. It is the most expensive thing a reader can press, by a factor of three.
- **`referee-mirror` is re-paid on every press and every reload.** `runMirror` stores nothing at
  all, and it sends no `cache_control`, so there is no prefix a second press could read warm. Cheap
  per press; unbounded per session.
- **The glossary lookup has no cold number, and that is a finding rather than a gap.** It is
  `explain` with a different selection by design — the same mechanism, not a second one — so its
  round ran against the cache `explain` had just written and read 41,674 tokens while labelled
  cold. What it does confirm is the prediction: **$0.0133 against `explain`'s warm $0.0136.** Nobody
  had checked that the two really are one mechanism. They are.

### Article costs measured here rather than in the pipeline

`embeddings` and `referee-claims` are per-article artefacts that are not pipeline steps, so they
were driven from `interactions.ts`. Add them to the article, never to a reader.

**Article embeddings: $0.0010** for 102 vectors on `voyageai/voyage-4`. **Its cache state is
unknown, not cold** — Voyage reports no cache-read field at all, and unknown is not evidence of
coldness. [`src/similar.ts`](../../src/similar.ts) still buys its own vectors rather than going
through [`src/article-vectors.ts`](../../src/article-vectors.ts), so a reader who opens both Force
and Drift can pay this twice. A known debt, not measured here.

## Two scenarios that are not per-mode costs

### Batched modes, and the cache that has never worked

What does a reader who presses two mode buttons at once pay, against two separate presses? Three
pairs, one per cache group, on the same fixture:

| job | batched | the same two, one per job | difference |
|---|---:|---:|---:|
| `arc` + `tweets` | $0.1572 | $0.1444 | +8.9% |
| `glossary` + `quotes` | $0.1701 | $0.1652 | +3.0% |
| `ideas` + `timeline` | $0.4285 | $0.4259 | +0.6% |

**Batching is not cheaper. It is slightly dearer, and the mechanism is a bug.** In all three pairs
the first step paid the 1.25× cache-write premium (25,428 / 25,428 / 27,239 tokens) and the second
read **zero**. Root-caused in
[260903c-the-conditional-article-cache-breakpoint-marks-the-writer-but-never-the-reader.md](../../docs/postmortems/260903c-the-conditional-article-cache-breakpoint-marks-the-writer-but-never-the-reader.md):
`cacheArticle` is decided from the steps that come *after* this one, so the last member of a cache
group — which is the reader — never sends a breakpoint, and a request with no breakpoint performs
no lookup however warm the entry is. It has never worked for a pair, since the day it landed. The
postmortem prices the fix at **$0.140 across these three jobs, 18.6%**, against $0.039 for deleting
the optimisation outright.

The percentages in the right-hand column are noisier than they look — the two sides are different
cold draws of a stochastic model on the same fixture, so run-to-run output variation is inside them.
The zero cache reads are not noisy, and they are the finding.

**These numbers must never be added to the per-mode table above.** They are a separate labelled
`scenario` in the run files for exactly that reason.

### PDF extraction is BYOK

`extract` is the only step that pays on a PDF and the only call in the whole eval that is not
Anthropic: `openai/gpt-5.6-luna`, six calls (a planning pass plus five chunks), 98 seconds. **Its
cost is $0.0517 of upstream nanos and $0.0000 of OpenRouter credits.** A total that sums the credits
column alone reports PDF extraction as free — which is why every figure in this report is credits
plus BYOK upstream, totalled the way [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts) does.

It is also the one place where a within-run cache legitimately shows up: 66,664 tokens written and
14,683 read across the six calls, chunk to chunk. Luna caches a repeated prefix automatically, so
that is production cost and stays in the number.

At $0.0517 for 14 pages, extraction is **4% of an all-modes PDF**. It is not where PDF money goes;
`timeline` alone is five times it.

## Money spent that is not the price of anything

Three things in the data would misprice a feature if they were quoted as its cost.

**Two paid failures.** Both are `ai-no-room` — the model exhausted its reasoning budget and wrote
nothing at all:

| what | cost | round |
|---|---:|---|
| `referee-claims` | $0.2157 | cold, 12,000 output tokens, all of them reasoning |
| `referee-criterion` | $0.0477 | warm, 4,000 output tokens, all of them reasoning |

The money was really spent. Neither is the cost of that interaction, and `referee-claims` — a
stored per-article artefact — **has never been successfully priced**. A single run bought a
$0.2157 nothing, which is a product question as much as a cost one.

**One contaminated round.** In the twelve-task run, `chat`'s cold round read 43,053 pre-existing
cached tokens while labelled cold, because an earlier standalone `--task chat` run had written that
entry minutes before. The runner detected it (`asLabelled: false`) and withheld the ratio rather
than printing a 1.2× that would have looked like a finding about caching. **Chat's cold number and
its 5.7× above come from the standalone `05-36-10` run**, which was genuinely cold: `cacheWrite
43,053`, `cacheRead 0`. The same contamination applies to the glossary lookup, for the structural
reason given above.

**One unknown.** `embeddings` reported no cache-read field, so its cache state is *unknown*. It is
recorded as unknown and not as a cold measurement.

## What to do about it, ranked by measured saving against ease

Every row is priced from this run. The tradeoff column is the point: none of these is free, and
the ones that touch quality are Greg's call rather than an engineer's.

| # | Change | Measured saving | Ease | Tradeoff |
|---|---|---|---|---|
| 1 | **Fix the article-cache breakpoint** so the *reader* marks too ([260903c](../../docs/postmortems/260903c-the-conditional-article-cache-breakpoint-marks-the-writer-but-never-the-reader.md)) | **18.6%** of a batched job — $0.1406 of $0.7558 measured | One condition in `src/jobs.ts`, plus a both-sides test | **None.** The premium is already being paid; today it buys nothing. |
| 2 | **Keep modes on demand** (status quo) | The modes are 79–90% of a fully-pressed article. Not pressing them is the whole saving | Already true | One eager exception: `arc` auto-fires on owner open (`src/web/useArc.ts`). Changing it costs the L0 column until a press. |
| 3 | **Effort on the five expensive modes** — sketch, timeline, hierarchy structure, quiz, ideas | Those five are **72% of a long article**. Reasoning is 36% of all spend | A per-stage constant already exists (`STAGE_EFFORT`) | **Quality, unmeasured.** `effort-vs-quality` covers `arc` and `glossary` only — neither is on this list. Measure before turning any dial. |
| 4 | **Bound reasoning on the tasks that hit the ceiling** | Three paid failures here: $0.2157 + $0.0477 + $0.2124 = **$0.4758 for nothing**, 6.5% of the whole sweep | Ceilings are per-call parameters | Answer depth, and a ceiling that is too low converts a good answer into a truncated one — which is how `hierarchy` got to `medium`. |
| 5 | **Cheaper models where selection is measurable** | Not measurable yet | Needs the model-arms follow-up plan | Quality. Deferred by design. |
| 6 | ~~Duplicate embedding purchase~~ | Tiny | **Done** by a peer, 2026-09-03 (`src/similar.ts` onto the `article-vectors.ts` seam) | — |
| 7 | ~~Duplicate job execution~~ | **$10.47–$10.81 of $31.22 historically** — a third of all spend ever | **Done** 2026-09-02 | — |

**The two that are worth doing now are 1 and 4**, because neither trades against quality. One is a
bug with a saving attached. The other is money we are demonstrably setting fire to: three
generations in this run were billed in full and wrote nothing, all by exhausting a reasoning budget
before producing a first token.

**Number 3 is the big one and it is not an engineering decision.** Reasoning tokens are 36% of
everything measured — $1.11 of $3.08 — and they are billed as output at $10/MTok and never shown to
anybody. But the five modes that spend it are the five whose output is hardest to judge, and
nothing has measured what `medium` does to a sketch or a timeline. The honest next step is
`effort-vs-quality` for those five, not a dial turned on cost evidence alone.

**What is no longer worth pursuing:** cost per word, as a mental model. A mode's bill tracks what
it *writes*, and its own shape sets that far more than the article's length does.

## Two gaps in the corpus, both open decisions for Greg

Named in [`evals/cost/fixtures.ts`](../cost/fixtures.ts) and unchanged by this run.

- **Nothing checked in is a normal ~1,000-word article.** The short fixture is **561 words**, not
  "about a thousand". The hole runs from 625 words (a deliberately-broken extraction fixture, so
  excluded) to 1,638 (a scene of a play). Since cost per word rises sharply as articles get shorter,
  the 700–1,500 band is where a typical blog post lives and we have not measured it.
- **No PDF fixture is near 20 pages.** `harder` is 14 pages and born-digital; `much-harder` is 17
  but a photographic scan, so its cost would be vision transcription and not representative. A true
  20-page fixture means a new licensed download.

One thing the run *did* settle: the PDF's block count, which the manifest left `null` because
measuring it costs money. It is **94 blocks**.

## Reproducing every figure

Ten commands, in order, from the repo root against a local Postgres. Each writes a directory under
[`evals/results/cost/`](cost/).

| # | command | result directory | $ |
|---|---|---|---:|
| 1 | `npm run eval:cost -- --preflight` | — | 0 |
| 2 | `npm run eval:cost -- --fixture short-html --all-modes` | `2026-09-03-04-25-01-hcaz8g3r-short-html-all-modes` | 0.3468 |
| 3 | `npm run eval:cost -- --fixture pdf --all-modes` | `2026-09-03-04-30-39-wp4hn1fp-pdf-all-modes` | 1.2304 |
| 4 | `npm run eval:cost -- --fixture long-html --all-modes` | `2026-09-03-04-43-03-w8i8qagf-long-html-all-modes` | 1.5501 |
| 5a | `npm run eval:cost -- --fixture long-html --repeat 4 --steps fetch,extract,blocks,hierarchy --keep` | `2026-09-03-04-59-07-1bpfhts0-long-html` (stopped after draw 2) | 0.5385 |
| 5b | the same command again | `2026-09-03-05-22-04-41wlze3j-long-html` (4 draws) | 1.3827 |
| 6a | `npm run eval:cost:interactions -- --slug <draw-1 slug> --task chat` | `2026-09-03-05-36-10-interactions-…` | 0.1567 |
| 6b | `npm run eval:cost:interactions -- --slug <draw-1 slug>` | `2026-09-03-05-38-10-interactions-…` | 1.3851 |
| 7 | `npm run eval:cost -- --against <draw-2 slug> --steps arc,tweets --batched-modes` | `2026-09-03-05-47-10-e0a1he1b-against-…` | 0.1572 |
| 8 | `npm run eval:cost -- --against <draw-3 slug> --steps glossary,quotes --batched-modes` | `2026-09-03-05-48-06-abo1ttk8-against-…` | 0.1701 |
| 9 | `npm run eval:cost -- --against <draw-4 slug> --steps ideas,timeline --batched-modes` | `2026-09-03-05-49-10-vm3b3zac-against-…` | 0.4285 |

Line 5a is in the table because it is where the hierarchy failure was observed, and it is the run
that forced `explained-absence`: a fatal `no-spend` on `labels` stopped a sweep whose entire purpose
was to count how often hierarchy fails. 5b is 5a re-run under the fix.

The four slugs are minted per run and cannot be reused — they are recorded in each `run.json`
(`draws[].slug`), and lines 6–9 target the articles line 5b kept. As run, they were
`evalcost-41wlze3j-long-html-{1,2,3,4}-spya-…`.

**The commands themselves are reconstructed** from the run directory names, the draw shapes and the
plan's own run table. `run.json` records the commit, the effort of every stage, the store, the
database target and the fixture hash — but **not the argv**. That is a small gap worth closing: a
report should not have to infer the command that produced it.

## Provenance

Every figure was produced at effort `medium` for `hierarchy`; `high` for `arc`, `tweets`, `ideas`,
`sketch`, `timeline` and `quiz`; `medium` for `glossary` and `quotes`. `SPIDERYARN_PIPELINE_EFFORT`
was unset in every run. Hierarchy's effort is read through `structureRequest` rather than restated,
because that constant has moved once already and took a whole analysis with it.

Two commits are involved:

| commit | runs | |
|---|---|---|
| `da3aba39` | lines 2, 3, 4, 5a | |
| `99a32e4a` | lines 5b, 6, 7, 8, 9 | harness only — `git diff da3aba39 99a32e4a -- src` is empty |

**Nothing under `src/` changed between them, so every price in this report is comparable.** All ten
runs record `gitDirty: true` with `srcPatchSha256: null`, which is the runner saying the dirt was
outside `src/` and `evals/` — the code that decides what a call costs was exactly the committed
code.

Every call ran under `scopeKind: "eval"` and `EVAL_OWNER_ID`, so none of this spend lands in
`npm run cost`'s Product bucket. A cost eval that reads its own numbers out of the product report
would be measuring itself; it self-reports from the ledger instead.

Two things the interaction runs do **not** record, unlike `run.ts`: the commit and the effort. The
commit is inferable from the timestamps (both post-date `99a32e4a` by minutes) and request-path
calls send no effort parameter at all, so neither figure here is in doubt — but the plan's own hard
requirement is "record effort and commit on every run", and `interactions.ts` does not.
