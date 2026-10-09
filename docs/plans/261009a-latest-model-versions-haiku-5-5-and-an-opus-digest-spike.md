# 261009a — Latest model versions, Haiku 5.5, and an Opus digest spike

Reports: `spya-gdv6dk` and `spya-esh49q` (Greg, admin, 2026-10-08). The write-up is
[docs/investigations/261009a-haiku-5-5-and-an-opus-digest-for-cheaper-models.md](../investigations/261009a-haiku-5-5-and-an-opus-digest-for-cheaper-models.md).

## What Greg asked for

> we should check that we're using Sonnet 5.5, or in fact, we should always be using the latest
> versions of any of our models. So that's worth a minimal update to our docs.

> It crossed my mind to wonder whether we could do some kind of initial preparatory work with a
> frontier model like Opus 5.5 […] then cheaper, less capable models, when given the article plus
> this output from Opus, would be able to do basically as good a job as Opus would have done
> […] perhaps we could budget, you know, conceivably up to 50 cents for this initial preprocessing,
> or maybe ideally 20 or 30 cents.

> There's a new Claude Haiku 5.5 model that is cheaper than GPT Luna, especially for prompts fewer
> than 100,000 tokens […] consider whether there are places where we might want to use this, and
> then run some evals to see how it compares.

— Greg, 2026-10-08. Not high priority; keep the whole thing under about **$10** of OpenRouter spend.
Build nothing into the product except the model-version fixes; the write-up ends with a
recommendation.

## What the checking found (2026-10-09, OpenRouter's live model list)

| Job / constant | Today | Latest in the family | Price change |
|---|---|---|---|
| capable tier, `CAPABLE_MODEL[_OPENROUTER]` — 25+ jobs | Sonnet 5 | **Sonnet 5.5** ([2026-09-28](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)) | input/output unchanged ($2 / $10), cache reads halved |
| quick tier `QUICK_MODEL_OPENROUTER`, `HELP_CHAT_MODEL`, `PDF_READER_MODEL`, the Overseer's attention classifier, fleet `describe` | GPT-5.6 Luna | **GPT-6 Luna** (already used by shelf topics and live) | halves ($0.20/$1.20 → $0.10/$0.50) |
| `PDF_FIGURE_LOCATOR_MODEL` | Gemini 3 Flash *preview* | Gemini 3.8 Flash | +50% (~$0.002 → ~$0.003 a call) |
| high power | Opus 5.5 | Opus 5.5 | — |
| DeepSeek jobs | V4.1 Flash | V4.1 Flash | — |
| dev reviews (`run-codex --model sol`) | resolves the newest listed Sol by itself | — | — |
| embeddings (Voyage 4), Jev 1.13, GPT Transcribe, image model | current | — | — |

Prior evidence that the capable bump is right, not just new: in
[261001s](261001s-dig-deeper-answer-model-eval.md) Sonnet 5.5 scored −1.24 against Opus where Sonnet
5 scored −2.38, 6/12 acceptable against 1/12, at the same price.

Haiku 5.5 (released 2026-10-07): $0.10 / $0.50 for a prompt up to 100k tokens, **$0.50 / $2.50
above** — so it ties GPT-6 Luna under 100k and costs 2.5–5× more above it. The claim Greg heard is
true against GPT-5.6 Luna, the one we run today, and not against GPT-6 Luna.

Production cost, last 30 days (read-only): 38 articles, median **$0.94**, p90 $2.85, max $6.54; 17
over $1. Most of it is ~15 pipeline steps that each send the whole article fresh (0% cache) — ideas,
debate, sketch, structure, glossary, quotes, citations, quiz, tweets — and output-heavy ones (ideas
12k tokens, sketch 15k, illustrated 24k).

## Stages

### 1. The model-version fixes (code, the only product change)

- `CAPABLE_MODEL` → `claude-sonnet-5-5`, `CAPABLE_MODEL_OPENROUTER` → `anthropic/claude-sonnet-5.5`.
  **Nothing goes stale**: add the two Sonnet 5 spellings to `generationKey`'s capable generation,
  which its own comment anticipated ("lets a later capable-tier replacement join the same
  generation"). The alternative — let every stored artefact read as stale — would show a banner on
  every article and re-bill the corpus on the next press, for work that is not wrong.
- Every `openai/gpt-5.6-luna` model constant → `openai/gpt-6-luna` (quick tier, help chat, PDF
  reader, Overseer attention, fleet describe), and the PDF size-limit table entry with it.
- `PDF_FIGURE_LOCATOR_MODEL` → `google/gemini-3.8-flash` (out of preview).
- Price rows, display names and the `/api/models` inventory follow; tests updated.
- Sonnet 5.5 rejects `thinking: disabled`, sampling parameters and a forced `tool_choice`; so does
  Opus 5.5, which already runs every capable task under High-powered AI through the same seams, and
  `src/` sends none of them on the capable tier. Verified anyway with one live smoke call per wire.
- One live smoke call on GPT-6 Luna per quick-tier job shape (reasoning `none`, JSON schema,
  streamed help chat), one PDF transcription of an eval fixture, and one figure-locator call.
- **The doc line**: one sentence under setup-dev.md § Which model everything uses — always the
  latest version of each model family, checked against OpenRouter's list. That section owns model
  choice; nothing else gets a copy.

### 2. Haiku 5.5: where it might fit, measured small

Candidates, by price and by what the job needs: (a) the quick tier's jobs, where it is the same price
as GPT-6 Luna; (b) the DeepSeek jobs (title tidy, difficulty) — but those sit on a zero-retention
route Haiku is not on; (c) the capable tier's pipeline steps, which is stage 3's question. Run two
existing evals with Haiku as an extra arm: **help chat** (evals/help-chat) and **title tidy**
(evals/title-tidy), cents each.

### 3. The digest spike

Three articles from the local database: an argumentative essay (Seth, *The mythology of conscious
AI*, 8.3k words), a scientific paper (*Entropy* 24-00930, 8.6k), a long essay (Gwern, *The scaling
hypothesis*, 12.6k).

- **The digest**: Opus 5.5, one call, the article with block ids → key points and thesis, the
  argument's structure (which sections do what, by block id), limitations and concerns, passages a
  reader may find confusing with a plain explanation, the most important sections, key terms.
  Budget check: target ≤ $0.30 an article.
- **Downstream tasks**, production's own prompts and schemas (imported from `src/`), the digest added
  as a second system block after the article: **Summary (Fuller)**, **Ideas**, and **two chat
  questions** per article.
- **Arms**: Opus 5.5 (the ceiling, and production for Summary), Sonnet 5.5, Sonnet 5.5 + digest,
  Haiku 5.5, Haiku 5.5 + digest.
- **Judging**: blind, per article × task, the five outputs shuffled and relabelled; an Opus subagent
  and GPT Sol (Codex, subscription — no OpenRouter spend) each rank and score them against the
  article. Agreement between the two is reported; where they disagree, said so.
- **Cost**: every call through the gateway (`openRouterJson`, job `eval`), so the ledger has it;
  a running total with a hard stop at $8.
- **A better version, if one shows itself**: e.g. the digest used only where the cheaper model is
  weakest, or caching the shared article+digest prefix across steps. Tried only if cheap.

### 4. Write-up and bookkeeping

The investigation doc, ending in a recommendation; feedback note for both report ids; spend total.

## Simpler options passed over

- **Use OpenRouter's `~anthropic/claude-sonnet-latest` alias** instead of a pinned id, so "latest"
  happens by itself. Passed over: the stored `generator` stamps, price rows and staleness checks are
  keyed on a pinned name; an alias would change the model under every stored artefact without a
  commit anyone reviewed, and the cost ledger would record an alias. A pinned id moved by a
  one-line commit keeps that review. A cheap mechanism (a script listing newer same-family ids) is
  a recommendation in the write-up, not built here.
- **Bump only Sonnet.** Greg's rule is every family; the Luna bump halves the quick tier's price.
- **Run the summaries eval harness (evals/summaries)** for the digest question. It judges question
  wording over a fixed tree, not whole outputs, and runs ~50 calls a variant; a small purpose-built
  spike is cheaper and answers the question asked.
- **Leave the PDF reader on GPT-5.6 Luna** because it was chosen by measurement. Kept on the list
  but checked with one fixture transcription before it moves; if it degrades visibly, it stays and
  the write-up says why.

## Risks

- Sonnet 5.5's effort levels are "recalibrated" from Sonnet 5's; `STAGE_EFFORT` values carry over
  unchanged. Not measured here beyond the smoke calls and the spike.
- GPT-6 Luna's behaviour at reasoning `none` on the quick tier's strict-schema jobs: smoke-tested
  per shape, not evaluated per job.
- An Opus judge may favour Opus's own style — hence the second, cross-family judge.

## Plan review (GPT Sol, read-only) and what changed

[261009a-latest-models-plan-review-sol.md](261009a-latest-models-plan-review-sol.md). Verdict: "the
capable-generation approach is sound", revise the rest. Finding by finding:

1. **Fleet and Overseer requests send `temperature: 0` with no reasoning setting** — GPT-6 Luna
   reasons by default and rejects sampling parameters when it does. *Accepted, by not moving them:*
   `tools/overseer/attention-classify.ts` and `tools/fleet/describe.ts` stay on GPT-5.6 Luna in this
   change. The Overseer has a higher bar than dev and its own owner; the write-up names the fix
   (drop `temperature`, send reasoning `none`, re-run `scripts/attention-eval.ts`) as a follow-up.
2. **Sonnet 5.5's cache floor is 512, not 1,024.** *Accepted:* `cacheFloorFor(model)` in
   src/article-prompt.ts; Sonnet 5's floor kept for its literal spelling and for unlisted models;
   tests use literal ids.
3. **Cache-read price.** Initially rejected, incorrectly; **accepted at code review**:
   [Anthropic's Sonnet 5.5 migration guide](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide)
   gives cache reads at $0.10/M (0.05× input), versus Sonnet 5's $0.20/M.
   The new price row overrides that rate and a regression prices a cached call.
   OpenRouter's actual settled costs remain the ledger source for app calls.
4. **Not every key survives.** *Accepted as a narrower promise:* completed capable artefacts and the
   citation context hashes stay fresh; in-flight checkpoints (labels, structure, PDF) and the
   link-summary cache are keyed on the exact model and will miss once — re-paid only when that work
   is next run, which is the honest behaviour for a checkpoint.
5. **One PDF transcription and one locator call are not a quality gate.** *Accepted:* all three
   fixture types and ~10 locator calls including a multi-picture page and a no-match control; either
   model reverts if the result is worse or inconclusive.
6. **The Luna smoke matrix misses shapes.** *Accepted:* link-summary (`low`), simple-check,
   quiz-verdict (provider default), dig-deeper's forced web search (asserting a search happened),
   command-pick-words and command-suggest.
7. **Job `eval` strips caller effort**, so the spike would not run at production effort.
   *Accepted:* the spike records the effort each call actually ran at and holds each model's settings
   identical between its digest and no-digest arms.
8. **Haiku on the Help route ran without a cache.** *Accepted:* measured both ways.
9. **Acceptance criteria.** *Accepted:* chat questions frozen before the digests exist (one synthesis,
   one detail/counterexample); schemas, block ids and production parsing validated; judges see the
   article and task, never the digest or the arms' names; ties allowed.
10. **Reserve spend before a call; amortise the digest; and a better digest.** *Accepted:* worst-case
    reservation; the digest's cost once per article with a break-even count; the digest written as a
    block-indexed map of claims, evidence, qualifications, confusing terms and counterarguments
    rather than a synopsis that pre-writes the Summary.
11. **Reader-facing inventory.** *Accepted:* the privacy page names the new models with the old ones
    "until 9 October 2026"; old display names and price rows kept; setup-dev.md's table updated.
