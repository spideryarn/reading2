# Latest-models smoke test, 2026-10-09

Plan 261009a. Capable tier Sonnet 5 -> Sonnet 5.5, quick tier / PDF reader GPT-5.6 Luna -> GPT-6 Luna,
figure locator Gemini 3 Flash preview -> Gemini 3.8 Flash. Every call below went through production code
(`src/` functions or the stage's own CLI), against the LOCAL Supabase ledger (`postgres@127.0.0.1:54362`).
A fetch spy in the scratch harness recorded each request's shape and the finish reason; the ledger row
supplied answered model, upstream, tokens, reasoning and cost. Total spend about $0.47 of the $1.50.

This records the exploratory run before its fixes. Final disposition: Sonnet and
the quick/PDF/Help Luna defaults moved; quiz-verdict now sends reasoning `none`;
the fidelity guard and figure locator retained their old models. The later hand
read below supersedes the initial unlabelled-alarm estimates. No raw ledger
export or scratch harness was retained, so the approximate total and PDF/locator
measurements cannot be independently recomputed from the tracked files.

## Verdicts

| Job | Verdict |
|---|---|
| Capable tier, Messages wire (arc: adaptive thinking + effort + JSON schema) | works |
| Capable tier, chat/completions (explain, with web_search tool) | works |
| Cache at the 512-token floor (`cacheFloorFor`) | works: write then read at a ~850-token prefix |
| link-summary, simple-check, dig-deeper-search, command-pick-words, command-suggest on GPT-6 Luna | work |
| **quiz-verdict on GPT-6 Luna** | **BROKEN in the initial run; fixed afterwards with reasoning `none`** |
| PDF reader on GPT-6 Luna | no degradation observed on these fixtures |
| Fidelity guard (261001h) on GPT-6 Luna | same catch rate; more false alarms |
| Figure locator on Gemini 3.8 Flash | safe but slightly worse and about 3x the cost and 3x the time |

## 1. Capable tier on Sonnet 5.5

`cacheFloorFor`: Sonnet 5.5 (both spellings) 512, Opus 5.5 512, Sonnet 5 1,024.

| Call | Wire | finish | Answered / upstream | in | out | cache write / read | reasoning | cost |
|---|---|---|---|---|---|---|---|---|
| arc #1 (`generateArc`, cacheArticle) | messages | end_turn | anthropic/claude-sonnet-5.5 / Anthropic | 2,937 | 115 | 1,321 / 0 | 0 | $0.0103 |
| arc #2, same article | messages | end_turn | same | 2,937 | 130 | 0 / 1,321 | 0 | $0.0073 |
| ~712-est-token marked prefix #1 | messages | end_turn | same | 22 | 57 | 850 / 0 | 0 | $0.0027 |
| same prefix #2 | messages | end_turn | same | 22 | 70 | 0 / 850 | 0 | $0.0008 |
| explain #1 (`explain()`, tool `openrouter:web_search`) | chat | stop | same / Anthropic | 6,830 | 455 | 6,753 / 0 | 112 | $0.0216 |
| explain #2 | chat | stop | same | 6,830 | 476 | 0 / 6,753 | 183 | $0.0056 |

Notes. The arc request carried `thinking: adaptive`, `output_config` effort `high` plus the JSON schema, and
`provider: {order: [anthropic], require_parameters: true}`; no 400. Adaptive thinking produced 0 reasoning
tokens on the arc. `underCacheFloor(prefix, sonnet-5.5)` is false for the 712-token prefix, and the cache
did write and read, so the 512 floor is right (a 1,024 floor would have wrongly skipped the marker). The
explain prompt carries the whole article plus the tool block, so it is well above 512 and does not test the
floor itself; the Messages-wire prefix test does.

## 2. Quick tier on GPT-6 Luna, each request shape

| Job (shape) | Result | finish | Answered / upstream | in | out | reasoning | cost |
|---|---|---|---|---|---|---|---|
| link-summary (streamed, effort low, `max_completion_tokens` 1,700) | ok, 438-char summary | stop | openai/gpt-6-luna / OpenAI | 1,838 (1,835 cached) | 87 | 0 | $0.00006 |
| simple-check (strict json_schema, low) | ok, parsed by `parseCheckVerdicts`, flagged the planted contradiction | stop | same | 680 | 285 | 212 | $0.00021 |
| **quiz-verdict (provider default, `max_tokens` 8)** | **3 calls, 2 dropped** (`classifyVerdict` returned `undefined` for a right answer and a hedged one; "wrong" came through once) | **length** | same | ~310 | 16 | 9-16 | $0.00004 each |
| dig-deeper-search (`tool_choice: required`, `openrouter:web_search` exa, low) | ok: `searches: 1`, 5 annotations, 5 sources through `searchFirst` | stop | same | 2,727 | 55 | 0 | $0.0074 |
| command-pick-words (effort none, json_object), 3 sentences | ok, words returned (find, define, tag) | stop | same | 82-95 | 12-13 | 0 | $0.000015 |
| command-suggest (effort none, strict schema) | ok | stop | same | 2,360 | 120 | 0 | $0.00035 |

**quiz-verdict is a real regression.** Production sends `max_tokens: 8` and no `reasoning` field (the gateway
row is "provider default"). GPT-6 Luna's default is to reason, and the reasoning spends the 8 tokens, so the
answer is empty and `parseVerdict` returns `undefined`; the failure is swallowed by design, so nothing
reports it. Raw diagnostic against OpenRouter, same prompt shape (reasoning controls sent directly; through
the gateway they are stripped for this job):

| request | content | finish | reasoning tokens |
|---|---|---|---|
| default, max 8 | null | length | 0 |
| effort none, max 8 | "right" | stop | 0 |
| default, max 200 | "right" | stop | 19 |
| effort low, max 200 | "right" | stop | 0 |

Either fix works: `quiz-verdict: { effort: "none" }` in `CHAT_REASONING` (src/ai-call.ts, beside
`command-pick-words`), or a larger `VERDICT_MAX_TOKENS` (src/quiz-verdict.ts:63). The built change chose
reasoning `none`; the review also tests the real request through `classifyVerdict`. Help
chat was skipped, as instructed. command-pick's first call goes to `typesafe/jev-1.13`, not Luna; only its
words call is on Luna. Not tested: the fleet/overseer requests Sol finding 1 names (`temperature: 0` with
default reasoning); those are outside this brief.

### Fidelity guard rerun (plan 261001h)

`scripts/probes/261001h-fidelity-guard-probe.ts` run unchanged except a temporary copy that wrote a new key
(`luna6`, deleted afterwards; the real probe is untouched). Output:
`docs/plans/261001h-fidelity-guard-luna6.jsonl` (547 levels, stopped at its $0.25 budget). The corpus was
rebuilt locally first (`... corpus`), and it is larger than the one behind the stored file, so the
comparison below uses only the 274 levels both files have.

| On the 274 common levels | GPT-5.6 Luna (stored) | GPT-6 Luna |
|---|---|---|
| Labelled faults caught | 21 / 26 (81%) | 21 / 26 (81%) |
| Alarms on unlabelled paragraphs (corrected by the later hand read) | 15 / 1,018 (1.5%) | 56 / 1,018 (5.5%) |
| Unreadable or failed answers | 0 | 0 |
| Shipped config (`pidpre`), faulty paragraphs flagged | 5 / 6 outputs | 5 / 6 outputs |
| Shipped config, clean PID outputs flagged / clean control outputs flagged | 1 / 12, 1 / 12 | 0 / 12, 2 / 12 |
| Cost per three-level press | $0.0027 | $0.0013 |
| Latency, one call median | 3.5 s | 3.3 s |

Two faults flip each way (`pidpost7/paragraphs/2` caught by old only, `pidv2_3/fuller/3` by new only).
GPT-6 Luna adds 44 alarms and removes 3 (net +41) on unlabelled paragraphs in the
common levels. The [later hand read](fidelity-guard-luna6-new-alarms-2026-10-09.md)
classifies those 44 as 38 nitpicks and 6 borderline, none a clear fault; it
corrects the initial denominator/counts to the table above. The shipped
configuration alone showed little difference. The broader false-alarm concern
is why the built change keeps the guard on GPT-5.6 Luna; lower checker cost
does not establish lower total rewrite cost.

## 3. PDF reader on GPT-6 Luna (production `npm run eval:pdf-read`, scorer `src/pdf-score.ts`)

| Fixture | GPT-5.6 Luna (evals/pdf/README.md, 2026-08-26) | GPT-6 Luna (this run) | Spend |
|---|---|---|---|
| easy, 8pp born-digital | 0.997 mean recall, 8 of 8 pages | **0.997**, 8 of 8, precision 1, 64 records, 0 uncertain | $0.0245 |
| harder, 14pp two-column, 3 tables | 0.999 over 12 of 14 pages | **0.999** over 12 of 14, precision 0.97-0.99, 203 records, 0 uncertain, no catastrophe | $0.0538 |
| much-harder, 17pp scan | every page transcribed, one block uncertain | every page transcribed (86 records, ~520-585 words/page), one block uncertain (page 17) | $0.0271 |

Scan, by eye. I extracted printed page 8 (PDF page 9) as an image and read it against the output: every
line matches verbatim, including the paragraph continued from the previous page being joined, "Destructiveness,
Firmness, Self-esteem, small Ideality..." and the hyphenated line-ends being mended. No dropped paragraph,
no invented text, one page checked. The first and last pages read as coherent prose with no gaps. Not
checked: every page, and the first run of the harder fixture's tables page by page (the scorer covers them:
no catastrophe, recall 0.997-1.0). Verdict: **same**. Only one run of each, so it cannot show better.

## 4. Figure locator on Gemini 3.8 Flash

Production route: `collectPdfFigures` with `openRouterFigureLocator` on the harder fixture
(`evals/pdf/harder/source.pdf`, four figures on four different pages, each window of three pages
holding other pictures). Each figure was filed one page early (the failure the locator exists for), twice;
plus controls. The recorded measurement (docs/plans/260924e..., § Stage 2) was 30 calls: 21 right, 9 correctly
refused, 0 wrong, ~1.8 s, $0.0013-0.0019 a call, on Gemini 3 Flash preview.

| Case | Calls | Outcome |
|---|---|---|
| F1, F3, F4, filed a page early, x2 each (6 calls) | 6 | all 6 stored, and the stored picture is the same size as when filed on its true page (1034x871, 689x1110, 1034x762), so the right one |
| F2 filed a page early x2 | 2 | 1 stored (1034x613, matches true-page size); 1 answered page 3, outside the window 4-6, so production's `judgeLocatedBox` refused it (`no-raster`): safe, but a miss |
| F2 filed on its true page | 0 | stored by the deterministic route, no call |
| Caption that is in no document, x2 | 2 | both `{page: null}`, refused |
| F1's caption filed 6 pages away (window 8-10) | 1 | `{page: null}`, refused |

Tally on 11 calls: 7 right, 1 safely refused (a miss), 3 correctly refused, **0 wrong**. Every call finished
`stop`, answered by `google/gemini-3.8-flash` on provider Google, the existing `[ymin, xmin, ymax, xmax]` 0-1000
convention unchanged, no 400.

What changed: the model now reasons (219-655 tokens of reasoning on each call), so a call took 3.7-16 s
(median about 5.5 s, against about 1.8 s) and cost $0.0036-0.0054 (against $0.0013-0.0019), about three
times. Recall on the positive cases was 7 of 8 against 21 of 21; with 8 positive calls this is not a
measured difference, but it is not evidence of "same". Not covered: a page that holds two pictures on the
same page as the target (this paper has none; the 260924e essay and analog-cognition PDFs are not in the
repo), and a vector figure. Verdict: **inconclusive-to-slightly-worse; safe (no wrong picture ever
stored), slower, triple the cost.** Per the standing instruction, retain `google/gemini-3-flash-preview` unless
Greg accepts that trade. `MAX_LOCATE_CALLS` caps it at 8 calls an article, so the cost difference is at
most about $0.03 an article.

## Commands run

```
npm run eval:pdf-read -- evals/pdf/easy/source.pdf smoke-luna6-easy          # also harder/, much-harder/ (slugs smoke-luna6-*)
npx tsx scripts/probes/261001h-fidelity-guard-probe.ts corpus
npx tsx <temp copy of the probe, key luna6> check luna6 --budget 0.25
npx tsx <scratch> capable.mts   # generateArc x2, streamMessage x2, explain x2, via a fetch-spying harness
npx tsx <scratch> quick.mts     # summaryRequest+openRouterStream, checkLevel, classifyVerdict, searchFirst, pickCommand, suggestCommands
npx tsx <scratch> quick2.mts    # link-summary retry, quiz-verdict x3, raw OpenRouter diagnostics for quiz-verdict
npx tsx <scratch> locate.mts    # collectPdfFigures with openRouterFigureLocator, 12 trials
```

The scratch scripts live in the session scratchpad, not the repo. Side effects: `output/smoke-luna6-*.html`,
`data/smoke-luna6-*`, `data/probes/261001h-fidelity-guard-corpus.json` (all gitignored), local `ai_calls` rows,
and the new `docs/plans/261001h-fidelity-guard-luna6.jsonl`. No source file was changed.
