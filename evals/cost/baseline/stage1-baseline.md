# Stage 1 baseline: what the ledger we already have can tell us

Free analysis of the existing AI-spend ledger, for
[260902g-estimate-article-ingestion-and-mode-generation-costs.md](../../../docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md).
No model calls were made. Read-only against local data only.

**Every number below is reproducible.** Scripts, in the same directory as this file:

| script | what it does |
|---|---|
| `pg-dump.mjs` | dumps the **local** Postgres `spideryarn.ai_calls` non-fixture rows to `pg-rows.json`, camelCased. It refuses a non-local `DATABASE_URL` rather than trusting the caller |
| `pg-articles.mjs` | word / block / gistable counts from `spideryarn.revision_blocks` |
| `coverage.py` | mode coverage across both ledgers |
| **`final-numbers.py`** | **every figure quoted in this document**, labelled |

Run it from the repo root. `pg-dump.mjs` reads `DATABASE_URL` from the real environment and does
**not** load `.env.local` itself, so pass it in:

```
export DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2-)
node evals/cost/baseline/pg-dump.mjs evals/cost/baseline/pg-rows.json
python3 evals/cost/baseline/final-numbers.py
```

`pg-rows.json` is a generated file and is not committed — regenerate it. Re-run on 2026-09-02 from
this directory reproduced $28.6727 / $31.2174 / $52.6248 exactly, which is the point of keeping the
scripts rather than only the conclusions.

---

## 0. The headline

Under **current code**, a cold ingest plus first open costs

| article | words | ingest + first open (hierarchy+labels + arc + embeddings) |
|---|---|---|
| `own-spya-bf6g9b` ("A Project of One's Own") | 2,530 | **$0.0987 observed** (+ ~$0.0006 embeddings) |
| `replication-crisis-spya-hrjamq` (Wikipedia) | 21,200 | **$0.6100 observed** (+ ~$0.0010 embeddings) |

Everything else the reader can press adds roughly **$0.9–1.4 more** on a long article
(*extrapolated* — see §5). Nothing in the ledger supports the plan's "$5+" era continuing: that was
duplicate execution at a higher effort setting, and both have since been changed.

---

## 1. Total historical spend

| ledger | rows | total | breakdown | unpriced |
|---|---|---|---|---|
| `data/_ai-calls.jsonl` | 565 | **$28.6727** | credits $27.3938 + BYOK upstream $1.2788 + computed $0.000096 | **39** |
| local Postgres `spideryarn.ai_calls`, non-fixture | 36 | **$2.5447** | all credits | 0 |
| **both** (they do not overlap in time or content) | 601 | **$31.2174** | credits $29.9385 + BYOK $1.2788 + computed $0.0001 | **39** |

The 39 unpriced rows are **unknown, not zero**: 22 eval `error` rows, 6 aborted chats, 2 CLI
hierarchy errors, 2 embeddings errors, 4 `claude-test` fixture calls, 1 job_step hierarchy error,
1 eval PDF, 1 chat error. The true total is $31.22 **plus an unknown amount** — most of it small,
but two of those unpriced rows are aborted long calls.

**The naive `SUM` trap, quantified.** Summing `creditsUsedNanos + upstreamInferenceNanos +
computedCostNanos` straight off the filesystem ledger gives **$52.6248** against the truth of
$28.6727 — an 84% overstatement, because `upstreamInferenceNanos` is populated on non-BYOK rows
equal to `creditsUsedNanos`. `final-numbers.py` computes both so the gap stays visible.

**Cross-check.** `npm run cost -- --since 2026-08-01 --until 2026-09-30` reports
`All recorded: $28.6727 over 565 call(s)`, Product $18.2345 / Eval $10.4382, and a by-job table
identical to mine to the last cent. My totalling agrees with `totalRows()` exactly.

### Identifying the Postgres test-fixture rows

The local table holds **4,865** rows, of which **4,829 are test fixtures**. Two independent
identifications agree on exactly the same 4,829 rows, with zero disagreement:

- `article_slug LIKE 'test-%-fixture'` (`test-remember-route-fixture` 3,349, `test-chat-route-fixture`
  1,066, `test-candidates-route-fixture` 414), and
- `answered_model IS NULL AND cost_source = 'none'`.

They carry no money at all, so they do not distort *totals* — but they do bury the `By owner` and
`By article` tables, which is what the cost-tracking plan warns about.

Note: the local database has **not yet had the `byok_upstream_nanos` rename applied** — the column
is still `upstream_inference_nanos` in `spideryarn.ai_calls`, while `src/store/ai-calls.ts` already
reads `byokUpstreamNanos`. Any query written against the live local DB today must use the old name.

---

## 2. Duplicate execution — verified, and larger than the plan says

Detected exactly as specified: **overlapping wall-clock windows with distinct `runId`s under one
`jobId` + `stepName`**. Five groups, all in the filesystem ledger, **none in Postgres** (confirming
the postmortem: Postgres claiming never had the bug).

| slug | step | jobId | executions | total | median exec | max exec | window (UTC) |
|---|---|---|---|---|---|---|---|
| `read` | hierarchy | `spya-v2f7b3` | 6 | $0.3901 | $0.0671 | $0.0777 | 08-30 08:29 |
| `towards-a-theory-of-bugs…` | hierarchy | `spya-p38nga` | 10 | $5.0536 | $0.5623 | $0.6338 | 08-30 14:05 |
| `towards-a-theory-of-bugs…` | hierarchy | `spya-zf0bgj` | 11 | $5.5729 | $0.5623 | $0.6615 | 08-30 17:48 |
| `towards-a-theory-of-bugs…` | hierarchy | `spya-gv99gh` | 2 | $0.8206 | $0.4103 | $0.5623 | 08-30 17:53 |
| **`openai-huggingface`** | **summary** | `spya-dmrwav` | **3** | **$0.8694** | $0.2954 | $0.3038 | **08-31 09:22** |

- **Spend inside duplicated groups: $12.7066.**
- **Waste: $10.47 (keep the most expensive execution) to $10.81 (keep the median).**
- That is **34–35% of all recorded spend, both ledgers combined.**

**New finding the postmortem does not have: the fifth group.** `openai-huggingface` / `summary` /
`spya-dmrwav` stormed on **2026-08-31 at 09:22 UTC**, three concurrent executions of 11–12 calls
each. The postmortem's table lists only the four hierarchy jobs. This one is a *different step* on a
*different article*, and it is **19 hours later than the last hierarchy storm** — which strengthens
rather than weakens the postmortem's root cause (a dev-server restart is not length- or
step-specific), but it means the incident kept happening after the day the write-up covers.

### Postmortem cross-check (structure calls only, `job='hierarchy'`)

Every figure in `docs/postmortems/260902c` reproduces:

| jobId | slug | calls | runIds | spend | at ceiling | below | non-ok | postmortem says |
|---|---|---|---|---|---|---|---|---|
| `spya-epn0ze` | bigger-brains | 1 | 1 | $0.2378 | 0 | 1 | 0 | — |
| `spya-v2f7b3` | read | 6 | 6 | $0.3043 | 0 | 6 | 0 | 6 calls, $0.30, all six fine ✅ |
| `spya-ug2qtq` | towards-a-theory | 1 | 1 | $0.3216 | 0 | 1 | 0 | 1 call, $0.32 ✅ |
| `spya-p38nga` | towards-a-theory | 10 | 10 | $4.8108 | 6 | 3 | 1 | 10, $4.81, 6 ceiling / 3 below / 1 error ✅ |
| `spya-zf0bgj` | towards-a-theory | 11 | 11 | $5.4275 | 7 | 4 | 0 | 11, $5.43, 6 ceiling / 5 below ⚠️ |
| `spya-gv99gh` | towards-a-theory | 2 | 2 | $0.8206 | 1 | 1 | 0 | 2, $0.82 ✅ |

- **Four storm jobs, structure-only: $11.3632** — the postmortem's **$11.36**, exactly.
- **Keep-max waste over those four: $9.6155** — the postmortem's **$9.62**, exactly. (The convention
  it used is "keep the *most expensive* call in each group"; keeping the median gives $9.7741.)
- One trivial discrepancy: on `spya-zf0bgj` I count **7** structure calls at exactly 52,225 output
  tokens and 4 below, where the postmortem says 6 and 5. Not worth a correction; the money is
  identical.

---

## 3. Named cases — replacing the plan's appendix table

Cost of a **single execution** (one `runId`), not the sum of duplicated executions. Word / block /
gistable counts from `data/<slug>/blocks.json` and `spideryarn.revision_blocks`. Wall clock is
`max(finishedAt) − min(startedAt)` across the execution's calls.

### Under current code (hierarchy at `medium`, from the Postgres ledger, 2026-09-01/02)

| slug | words | blocks | gistable | step | execs | cost | calls | wall | $/1k words |
|---|---|---|---|---|---|---|---|---|---|
| `replication-crisis-spya-hrjamq` | 21,200 | 551 | 542 | hierarchy+labels | 1 | **$0.5200** | 7 | 265 s | $0.0245 |
| `replication-crisis-spya-hrjamq` | 21,200 | 551 | 542 | arc | 1 | $0.0900 | 1 | 28 s | $0.0042 |
| `own-spya-bf6g9b` | 2,530 | 61 | 59 | hierarchy+labels | 1 | **$0.0814** | 2 | 57 s | $0.0322 |
| `own-spya-bf6g9b` | 2,530 | 61 | 59 | glossary | 1 | $0.0242 | 1 | 11 s | $0.0096 |
| `own-spya-bf6g9b` | 2,530 | 61 | 59 | arc | 1 | $0.0173 | 1 | 8 s | $0.0068 |
| `towards-a-theory-of-bugs…` | 8,001 | 244 | 164 | arc | 2 | $0.0663 / $0.0764 | 1 | 35–41 s | $0.0089 |
| `read` | 459 | 23 | 21 | arc | 1 | $0.0056 | 1 | 3 s | $0.0121 |
| `todo` | 243 | 10 | 9 | arc | 2 | $0.0045 / $0.0048 | 1 | 4–10 s | $0.0190 |

Within hierarchy, the **structure call is ~65% and the labels fan-out ~35%**:
`replication-crisis` = $0.3419 structure + $0.1781 across 6 label calls;
`own-` = $0.0517 + $0.0297.

### Under the old code (hierarchy at `high`, filesystem ledger, ≤ 2026-08-30 20:03 UTC)

| slug | words | blocks | gistable | step | execs | single-exec cost | calls | wall |
|---|---|---|---|---|---|---|---|---|
| `towards-a-theory-of-bugs…` | 8,001 | 244 | 164 | hierarchy+labels, **complete** (reached labels) | 3 | **$0.5807 / $0.6338 / $0.6615** | 4–5 | 422–490 s |
| `towards-a-theory-of-bugs…` | 8,001 | 244 | 164 | hierarchy, **truncated at the 52,225-token ceiling** | 14 | $0.5623 each | 1 | 444–513 s |
| `towards-a-theory-of-bugs…` | 8,001 | 244 | 164 | hierarchy, finished below ceiling but never reached labels | 6 | $0.2583–$0.4653 | 1 | 194–385 s |
| `what-if-we-had-bigger-brains…` | 12,975 | 172 | 165 | hierarchy+labels | 1 | **$0.3639** ($0.2378 + $0.1261) | 4 | 186 s |
| `read` | 459 | 23 | 21 | hierarchy+labels | 6 | **$0.0470–$0.0777**, median $0.0671 | 2–3 | 40–70 s |
| `what-if-we-had-bigger-brains…` | 12,975 | 172 | 165 | sketch | 1 | $0.2304 | 1 | 159 s |
| `what-if-we-had-bigger-brains…` | 12,975 | 172 | 165 | ideas | 1 | $0.1736 | 1 | 129 s |
| `what-if-we-had-bigger-brains…` | 12,975 | 172 | 165 | glossary | 1 | $0.0806 | 1 | 29 s |
| `what-if-we-had-bigger-brains…` | 12,975 | 172 | 165 | arc | 1 | $0.0607 | 1 | 10 s |
| `openai-huggingface` | 4,187 | 95 | — | summary **(step since deleted)** | 3 | $0.2702–$0.3038 | 11–12 | 51–56 s |
| `openai-huggingface` | 4,187 | 95 | — | arc | 1 | $0.0463 | 1 | 31 s |
| `openai-huggingface` | 4,187 | 95 | — | glossary | 1 | $0.0382 | 1 | 20 s |
| `openai-huggingface` | 4,187 | 95 | — | quotes | 1 | $0.0290 | 1 | 12 s |

### Steps whose only evidence is a CLI or eval run (article unrecorded; sized by input tokens)

| step | scope | runs | cost | input tokens |
|---|---|---|---|---|
| timeline | cli | 4 | $0.1219 / $0.1465 / $0.1538 / $0.1820 | ~12,100 |
| quiz | eval | 12 | $0.0790–$0.1103, median $0.0886 | ~21,000 |
| quiz | cli | 1 | $0.0892 | 19,148 |
| sketch | eval | 5 | $0.1780–$0.6830 (1–3 calls each) | 23k–115k |
| sketch | cli | 1 | $0.2779 | 35,549 |
| ideas | eval | 2 | $0.0630 / $0.0613 | 19,399 |
| hierarchy | cli, post-`medium` | 2 | $0.1376 / $0.1392 | 10,191 |
| tweets | cli | 2 | **$0.0000, both unpriced, model `claude-test`** | 10 |

### Per-interaction unit costs (`scopeKind: "request"`), cold vs warm split by cache-read tokens

| job | interactions | cold (no cache read) | warm (cache read > 0) |
|---|---|---|---|
| chat turn | 21 priced | median $0.0681, $0.0476–$0.0931 | median $0.0269, $0.0121–$0.1158 |
| referee-candidates | 7 | median $0.0970, $0.0689–$0.1942 | median $0.0810, $0.0226–$0.2427 |
| referee-criteria | 8 | median $0.0732, $0.0202–$0.1959 | $0.0309 (n=1) |
| referee-claims | 2 | $0.1639 | $0.0826 |
| search | 3 | $0.1310, $0.0194 | $0.0249 |
| quiz-mark | 4 | $0.0501 | median $0.0068, $0.0065–$0.0072 |
| referee-mirror | 5 | median $0.0087, $0.0083–$0.0166 | none |
| explain | 1 | $0.0284 | none |
| embeddings, per article | 78 | median **$0.0006**, $0.0001–$0.0010 | n/a |

**The prompt cache is worth 2.5× on chat and 7× on quiz marking.** That is the single largest
observed lever in the whole dataset and it is already switched on for request-path work.

### PDF extraction (BYOK, `openai/gpt-5.6-luna`, credits $0 + upstream nanos)

| run | model | calls | upstream cost | input tokens |
|---|---|---|---|---|
| `e243cfd0` | gpt-5.6-terra | 14 | **$0.9425** | 317,783 |
| `b2afba8d` | gpt-5.6-luna | 21 | $0.1178 | 374,856 |
| `d1c19049` | gpt-5.6-luna | 20 | $0.1132 | 370,067 |
| `8a3c163d` | gpt-5.6-luna | 12 | $0.0709 | 226,419 |
| `e3c8a9a2` | gpt-5.6-luna | 4 | $0.0147 | 34,352 |
| `06daddbb` | gpt-5.6-luna | 5 | $0.0129 | 41,020 |
| `e41351ff` | gpt-5.6-luna | 2 | $0.0067 | 12,838 |

Luna is **8× cheaper than terra** for the same corpus (317k vs 374k input tokens, $0.94 vs $0.12).
These are extraction-bakeoff eval runs, not production ingests, so they are an upper bound on a
per-PDF cost, not a measurement of one.

---

## 4. Ranked: the most expensive bits

### By cost of one execution, per article (what an article actually costs us)

1. **hierarchy + labels** — $0.08 (2.5k words) to $0.52 (21k words) at `medium`; $0.36–$0.66 at
   `high`. **By far the largest single per-article cost, and the only one on the default ingest
   path.** It is also the only step observed to fail at the token ceiling.
2. **sketch** — $0.23 on a 13k-word article; $0.28 on a CLI run. Slowest call in the app too.
3. **ideas** — $0.17 on a 13k-word article.
4. **timeline** — $0.12–$0.18 (only CLI evidence).
5. **quiz** — $0.079–$0.110 (only CLI/eval evidence).
6. **arc** — $0.005–$0.09, scaling cleanly with length. Small, but **it is the one on-demand step
   that fires automatically** on owner open, so every article pays it.
7. **glossary** — $0.024–$0.081.
8. **quotes** — $0.029 (one observation, 4k words).
9. **PDF extraction** — $0.007–$0.12 upstream per document on Luna.
10. **embeddings** — $0.0006 per article. Negligible; the duplicate purchase in `similar.ts` is
    worth fixing for tidiness, not for money.
11. **tweets** — never measured for real. Zero priced observations.

### By total historical spend (both ledgers, $31.22)

| rank | job | spend | share | note |
|---|---|---|---|---|
| 1 | `hierarchy` (structure calls) | $13.0015 | 42% | **$9.62 of it duplicate execution at `high` effort** |
| 2 | `eval` (extraction bakeoffs) | $5.6826 | 18% | our own measurement, not product |
| 3 | `sketch` | $2.9336 | 9% | mostly the sketch eval, not ingests |
| 4 | `summarise` | $1.3579 | 4% | **a step that no longer exists** |
| 5 | `chat` | $1.3493 | 4% | 21 priced turns |
| 6 | `quiz` | $1.1819 | 4% | the quiz eval |
| 7 | `labels` | $1.0307 | 3% | the hierarchy fan-out |
| 8 | `referee-candidates` | $0.7757 | 2% | |
| 9 | `quiz-mark` | $0.7054 | 2% | |
| 10 | `referee-criteria` | $0.6354 | 2% | |
| 11 | `timeline` | $0.6043 | 2% | |
| 12 | `referee-claims` | $0.5027 | 2% | |
| 13 | `arc` | $0.4550 | 1% | |
| 14 | `search` | $0.3971 | 1% | |
| 15 | `ideas` | $0.2979 | 1% | |
| — | everything else | $0.3064 | 1% | glossary, referee-mirror, embeddings, quotes, explain, pdf, tweets |

**The single largest line in our history is money we did not need to spend**: $10.5–10.8 of
duplicate execution, all of it inside hierarchy and summary, all of it in the filesystem-mode queue,
all of it fixed.

---

## 5. Extrapolations (labelled as such — this is what the eval must replace)

Composed from the single-execution figures above; **not observed end to end on any one article**.

| shape | ingest + first open | + every on-demand mode pressed |
|---|---|---|
| short HTML, ~2,500 words | **$0.0987 observed** (hierarchy $0.0814 + arc $0.0173); embeddings ~$0.0006 *extrapolated* | ~$0.25–0.35 *extrapolated* |
| medium HTML, ~13,000 words | ~$0.35 *extrapolated* | **~$1.2–1.3** *extrapolated* (arc 0.06 + glossary 0.08 + quotes ~0.06 + ideas 0.17 + timeline ~0.15 + quiz ~0.09 + sketch 0.23 + tweets ?) |
| long HTML, ~21,000 words | **$0.6100 observed** (hierarchy $0.5200 + arc $0.0900); embeddings ~$0.0010 *extrapolated* | ~$1.5–2.0 *extrapolated* |
| ~20-page PDF | + $0.01–0.12 upstream for extraction, then as above | as above |

Reader interaction is additive and unbounded: a chat turn is $0.03–0.07, a search $0.02–0.13, a
referee pass $0.10–0.20.

---

## 6. What the ledger cannot tell us — the gaps the eval must measure

**Steps with no usable per-article evidence at all:**

| step | job_step executions | any evidence? |
|---|---|---|
| `extract` | **0** | **none, ever.** HTML extraction has never written a paid row (it is free); PDF extraction has never run through the job queue in either ledger — the only Luna rows are eval-scope bakeoffs. |
| `tweets` | **0** | two CLI runs, both against the `claude-test` stub, both **unpriced**. **We have never paid for a tweets step and do not know what one costs.** |
| `timeline` | **0** | 4 CLI runs, article unknown |
| `quiz` | **0** | 13 CLI/eval runs, article unknown |
| `quotes` | 1 | one article, one execution |
| `ideas` | 1 | one article, one execution |
| `sketch` | 1 | one article, one execution |
| `glossary` | 3 | three articles, one execution each |
| `arc` | 9 | the only step with real coverage besides hierarchy |
| `hierarchy` | 33 | but 24 of them are one storming article at the old effort; **only 2 under current code** |

**Other things the ledger structurally cannot answer:**

- **Variance.** Only two (slug, step) pairs have more than one *legitimate* independent execution:
  `arc` on `todo` ($0.0045 / $0.0048) and `arc` on `towards-a-theory-of-bugs` ($0.0663 / $0.0764,
  a 15% spread). Everything else is either n=1 or a storm.
- **Cold vs warm on the pipeline path.** Every job_step execution here is cold; there is no observed
  warm pipeline execution, because pipeline cache breakpoints are off by default.
- **The referee stored artefacts vs per-turn calls.** All referee rows are `scopeKind: "request"`;
  nothing distinguishes the article-scoped first purchase from a later turn.
- **Remember, dictation, glossary term lookup, live conversation.** Zero rows each, in both ledgers.
- **The truncation rate under current code.** 14 of 24 structure calls on
  `towards-a-theory-of-bugs` hit the ceiling — but **all of them at effort `high`**. The one long
  article measured at `medium` (21,200 words, more than twice the length) did not truncate. We
  cannot state a current-code truncation rate from this data.
- **The 39 unpriced rows.** Cost unknown. Two are aborted multi-minute calls.

---

## 7. What contradicts the plan's current appendix

### ❌ Wrong: "$9.62 of the ledger's $11.36 was this"

**The ledger's total is $28.67 (filesystem) / $31.22 (both), not $11.36.** $11.36 is the
structure-only spend of the *four storm jobs* — which is what the postmortem's sentence means, and
the plan compressed it into a claim about the whole ledger. Both the $9.62 and the $11.36 are
correct as job-scoped figures and reproduce exactly; the framing around them is not.

Corrected: **duplicate execution wasted $10.47–$10.81 of $31.22 recorded spend, i.e. 34–35%** — more
than the plan says, because the plan's figure counts only structure calls in four hierarchy jobs and
misses the labels fan-out and the fifth (summary) group.

### ❌ Missing: a fifth duplicate-execution group, a day later, on a different step

`openai-huggingface` / `summary` / `spya-dmrwav`, 3 concurrent executions, $0.8694, 2026-08-31
09:22 UTC. The plan and the postmortem both describe the incident as hierarchy-only and confined to
2026-08-30.

### ❌ Misleading: every headline hierarchy number in the appendix is at effort `high`

`EFFORT` in `src/hierarchy.ts` went `high` → `medium` in commit **fb82dc8, 2026-08-30 20:03 UTC**.
Every hierarchy row in the filesystem ledger predates it. So:

- "`read`, 468 words — **$0.047–0.078**" — the *money is right* ($0.0470–$0.0777, six executions,
  median $0.0671) but it is an effort-`high` measurement of a step that now runs at `medium`.
- "`what-if-we-had-bigger-brains…` — **$0.36**" — right ($0.3639), same caveat.
- The entire `towards-a-theory-of-bugs` story is effort-`high`.

The only current-code hierarchy observations in existence are the two Postgres rows: **$0.0814 at
2,530 words and $0.5200 at 21,200 words.** The plan's baseline should quote those.

### ⚠️ Wrong word counts (minor)

The plan says `read` is 468 words and `what-if-we-had-bigger-brains…` is 13,476. Counting
`revision_blocks.words` — the database's own count, which is what the pipeline sees — they are
**459** and **12,975**. Trivial, but the eval should use the database's number so cost-per-1k-words
is comparable across runs.

### ⚠️ Incomplete: "same article + arc, glossary, ideas, sketch … ~$0.91 partial"

Confirmed as a sum: $0.3639 + $0.0607 + $0.0806 + $0.1736 + $0.2304 = **$0.9092**. Adding the
missing four from elsewhere in the ledger takes the plausible all-modes figure on that article to
**~$1.2–1.3** (*extrapolated*, and `tweets` is still a guess because we have never paid for one).

### ⚠️ Stale: `summary` is not a step

The ledger holds $1.3579 of `summarise` spend and 34 `summary` job_step rows, but `summary` was
removed from `StepName` in **cc2b67d, 2026-08-31 11:11 UTC**. That money must be excluded from any
per-article estimate, and the eval must not try to run the step.

### ✅ Confirmed

- The $5.43 incident is duplicate execution, not a retry chain — verified from timestamps: eleven
  distinct `runId`s starting 7–60 s apart while earlier calls were still in flight.
- Postgres claiming never had the bug: **zero** `(jobId, stepName)` groups with more than one
  `runId` in the Postgres ledger.
- "Only hierarchy/labels pay at ingest": no `extract`, `blocks`, `fetch` or `assets` row has ever
  been written in either ledger.
- Chat turn ≈ $0.04: cold median $0.0681, warm median $0.0269 — the plan's single figure sits
  between them; splitting cold and warm is the honest form.
- Embeddings ≈ $0.0003 per article: measured median **$0.0006** (range $0.0001–$0.0010) — the plan
  understates by ~2×, and it is still negligible.
- PDF easy fixture ≈ $0.01: the smallest Luna run is $0.0067 and the next $0.0129. ✅
- Eval rows are excluded from `npm run cost`'s product bucket, and BYOK rows carry $0 credits with
  the real cost in upstream nanos (78 such rows, $1.2788). ✅

---

## 8. What this means for the rest of the plan

1. **The stage-1 answer to "roughly what does an article cost" is $0.10–$0.61 to ingest and open,
   and ~$0.3–$2.0 with every mode pressed.** That is an order of magnitude below the historical
   per-article numbers, and the difference is entirely duplicate execution plus the effort change.
2. **Hierarchy is 42% of all history and the only per-article cost that matters.** Rank the
   cost-reduction candidates accordingly; effort tuning on hierarchy has already delivered the
   largest measured saving in the dataset and nobody priced it.
3. **The prompt cache is the biggest observed lever** (2.5–7×) and it is off on the pipeline path
   by design. Whether an ingest's steps could share one cached article prefix is worth a number.
4. **The eval's job is coverage, not precision.** Eight of ten paying steps have ≤1 legitimate
   observation, and two have none at all. Getting one clean cold execution of each on three fixtures
   is worth more than repeats of hierarchy.
5. **The runner must record the effort setting and the commit** — this analysis was nearly wrong by
   2× because a config constant changed mid-ledger and nothing in the row said so.
