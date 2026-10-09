# Haiku 5.5, and an Opus digest for cheaper models

Written and run 2026-10-09 for [plan 261009a](../plans/261009a-latest-model-versions-haiku-5-5-and-an-opus-digest-spike.md),
from two of Greg's reports (`spya-gdv6dk`, `spya-esh49q`). Up:
[investigations.md](../project/investigations.md). The harness is [`evals/digest/`](../../evals/digest/README.md);
the raw outputs, costs and judgements are under
[`evals/results/digest-2026-10-09/`](../../evals/results/digest-2026-10-09/).

> some of the articles that we're processing really are pretty expensive. Some of them have been
> like a few dollars per article […] I did have feedback from a couple of people that they weren't
> that impressed by some of the summaries […] I wonder if that's partly because we're using Sonnet
> rather than Opus. […] perhaps we could budget, you know, conceivably up to 50 cents for this
> initial preprocessing, or maybe ideally 20 or 30 cents. And then, you know, if everything that
> happens thereafter can be done more cheaply, perhaps still with Opus but with less reasoning, or
> with Sonnet, or even with Haiku in some cases, as long as it's given this digest from Opus.
>
> — Greg, 2026-10-08

**Spend: about $5.66 of OpenRouter in all** — the digest spike $5.03, the Haiku evals $0.15, the command-bar re-runs $0.007, the smoke
tests of the model moves and the fidelity-guard re-run $0.47 (§ 1); every call through the gateway,
so the local ledger has each one. The judging (six blind judges, Opus and GPT Sol) ran on
subscriptions and cost nothing on OpenRouter. The saved eval files support $5.1776
($5.0280 digest, $0.1267 Help, $0.0230 title tidy); the smoke report estimates the
remaining $0.47 without an archived ledger export, so **the total is approximate**.

## The short answer

1. **We were a version behind on Sonnet.** The capable
   tier — 25-odd jobs, most of what a reader sees — was on Sonnet 5; it is now on **Sonnet 5.5**, the
   same input/output price, with cheaper cache reads. On these three articles, blind, Sonnet 5.5 alone scored near Opus 5.5 (7.7 to
   7.6 out of 10, both judges pooled). The quick tier moved from GPT-5.6 Luna to **GPT-6 Luna**, at
   lower token prices ($0.20/$1.20 → $0.10/$0.50), with one job fixed for it (quiz verdict) and two held back where a measurement
   said the newer model was worse at that job (Summary's fidelity guard; the PDF figure locator).
   Details in § 1.
2. **These runs give no reason to adopt Haiku 5.5 yet.** It costs the same as GPT-6 Luna for a prompt under 100k
   tokens and 5× more above; its tokenizer counts ~38% more tokens for the same text; and on every
   comparison here it offered no clear advantage over the current model; this does not test every job. § 2.
3. **The digest looks worth a larger quality eval.** Given an Opus digest,
   Sonnet 5.5 was the best arm of all five on both judges (8.3 against Opus alone's 7.6), and gained
   most on critical chat in the failure-excluded table, where only one article remains. Haiku with the digest stayed about a point behind
   Opus on this sample, so this run does not establish "Opus thinks once, cheap models do the rest" with Haiku, and
   with Sonnet it costs *more* than Sonnet alone. § 3.
4. **Getting an article under $1 is a different job**: most of the bill is ~15 steps that each read
   the whole article fresh, with no cache, and a few that write a great deal. § 4 names the levers.

## 1. The model-version sweep, with measured exceptions and deferred tools

Checked against OpenRouter's live model list on 2026-10-09. The table of what moved, and why each
move was safe, is the plan's § What the checking found; the code is `src/models.ts`, and the line
that keeps it true is in [setup-dev.md § Which model everything uses](../project/setup-dev.md#which-model-everything-uses).

- **Capable tier, Sonnet 5 → Sonnet 5.5.** Same input/output price ($2 / $10), cache reads
  $0.10/M instead of $0.20/M ([Anthropic's migration guide](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide)). Sonnet 5.5
  refuses what Opus 5.5 refuses — disabled thinking, sampling parameters, a forced `tool_choice` —
  and the default capable requests send none of them, which is why High-powered AI was already running every
  capable job on Opus 5.5 through the same code. **Completed capable artefacts stay fresh**: Sonnet 5's two
  spellings are in `generationKey`'s capable generation, so a summary or glossary Sonnet 5 wrote is
  still current. (In-flight checkpoints and the link-summary cache are keyed on the exact model and
  miss once, as they should.) Its prompt-cache floor is 512 tokens where Sonnet 5's was 1,024, so
  shorter prefixes now cache — `cacheFloorFor` in `src/article-prompt.ts`.
- **Quick tier, help chat and PDF reader, GPT-5.6 Luna → GPT-6 Luna.** Input halves and output
  falls by 58% ($0.10 / $0.50). Help chat re-run on production's own request: 9 factual answers
  and 4 appropriate admissions that the pages do not say; 11 of 11
  off-topic questions declined, warm cost $0.00032 against $0.0006.
- **PDF figure locator: tried on Gemini 3.8 Flash, and kept on Gemini 3 Flash preview.** 3.8 reasons
  on every call: ~5.5 s and ~$0.0045 a call against ~1.8 s and ~$0.0015, with 7 right, 3 correctly
  refused, 1 missed and none wrong over 11 calls — no gain shown to pay three times for. One exception
  to "latest of each family" this sweep made, written beside the constant.
- **Not moved, for now: the Overseer's attention classifier and the fleet dashboard's describer**
  (`tools/`). Both send `temperature: 0`, which GPT-6 Luna refuses while it reasons, and the
  Overseer has a higher bar than the app. The fix is small — drop `temperature`, send reasoning
  `none`, re-run `scripts/attention-eval.ts` — and is left to whoever next works there.
- Already current: Opus 5.5 (high power), DeepSeek V4.1 Flash, Voyage 4, Jev 1.13, GPT Transcribe;
  the dev reviews' `run-codex --model sol` resolves the newest Sol by itself.

**How the moves were checked** — one live call per request shape through production's code
([evals/results/latest-models-smoke-2026-10-09.md](../../evals/results/latest-models-smoke-2026-10-09.md),
$0.47):

- Sonnet 5.5 on the messages wire (Arc: adaptive thinking, effort, JSON schema) and on
  chat/completions with web search (Explain): both answered, no 400. A ~710-token marked prefix
  wrote 850 tokens to the cache and read 850 back — the 512 floor is real.
- GPT-6 Luna on link summary, simple check, dig deeper's forced web search (one search, five
  sources), the command bar's two calls: all answered and parsed.
- The command bar's two Luna jobs were chosen by measurement, so both evals were re-run on GPT-6
  Luna ($0.007): the words for a picked command 47 of 47 right, as before, at half the cost; the
  suggestions passed every automatic check GPT-5.6 Luna passed, one fewer stray word in a "why"
  (`evals/command-pick/results/261009/`, `evals/command-suggest/results/261009/`).
- **Quiz verdict broke, and is fixed.** It sends an 8-token ceiling and no reasoning setting; GPT-6
  Luna reasons by default, spent all 8 tokens thinking, and returned no word on 2 of 3 calls. It now
  sends reasoning `none` (`CHAT_REASONING` in src/ai-call.ts, a test in tests/ai-call.test.ts that
  was red first).
- PDF reader on GPT-6 Luna, all three fixture types through `npm run eval:pdf-read`: recall 0.997
  and 0.999 as before, the scan transcribed whole, one page checked against its image verbatim.
- **Summary's fidelity guard stays on GPT-5.6 Luna.** Re-run on GPT-6 Luna over 261001h's labelled
  paragraphs ([`261001h-fidelity-guard-luna6.jsonl`](../plans/261001h-fidelity-guard-luna6.jsonl)):
  the same 21 of 26 faults caught, at half the price, but 44 new alarms on paragraphs presumed
  faithful — and a hand read found none of them a real fault (6 arguable, 38 wrong or pedantic,
  often "not in the cited passage" read as "contradicts it";
  [the read](../../evals/results/fidelity-guard-luna6-new-alarms-2026-10-09.md)). Each alarm makes
  Opus rewrite a level, so a cheaper check could cost more overall; the rewrite loop
  was not measured end to end. `PINNED_MODEL` in `src/models.ts`
  holds it back, with that reason beside it — the second exception to "latest of each family".
- One consequence worth knowing: with Sonnet 5.5's 512 floor, the labels step's prefix (its system
  prompt alone is ~620 estimated tokens) now passes our cacheability estimate, so its first batch warms the cache before
  the rest fan out — a little more wait on labels, cheaper batches after.

## 2. Haiku 5.5: where it might fit

Released 2026-10-07. **$0.10 / $0.50 per million tokens for a prompt up to 100k tokens, $0.50 /
$2.50 above** (cache reads a tenth of input), 1M context, adaptive thinking with a default effort of
`medium`. The claim Greg heard — "cheaper than GPT Luna, especially under 100,000 tokens" — is true
against GPT-5.6 Luna, the one we ran until today, and not against GPT-6 Luna, which is the same
price under 100k and 2.5–5× cheaper above it. The task-level evidence below is
what supports the recommendation; the initial external benchmark figures had no
saved source here and were removed at review.

Where it could go, and what happened when it was tried:

| job | today | Haiku 5.5 | verdict |
|---|---|---|---|
| Help chat (`evals/help-chat`, 24 questions) | GPT-6 Luna: 9 factual answers, 4 appropriate unknowns, 11/11 off-topic/jailbreak requests declined, $0.0037 cold / $0.00032 warm | As good on refusals, wordier; 0/24 cache hits on the request as it stands; with an explicit cache breakpoint $0.0052 / $0.00047 | Luna: cheaper, terser, its cache works without help |
| Title tidy (`evals/title-tidy`, 62 titles) | DeepSeek V4.1 Flash, $0.0052 for all 62; 3 answers rejected as excessive edits | Same usable raw answers on 55 of 62, same stored titles including fallback on 57; two titles failed with unfinished answers and 249/229 thinking tokens; $0.01125, median 1.59 s against 0.73 s | No demonstrated reason to switch; effort differs (`none` for DeepSeek, provider default for Haiku) |
| Summary, Ideas and the two chat questions (§ 3) | Sonnet 5.5 / Opus 5.5 | ~1.2 points out of 10 behind Opus alone; ~0.9 behind with the digest | Do not adopt on this evidence; only these tasks and settings tested |

The prompt-size point matters more than it looks: the Help pages are 29.4k tokens to Luna and 40.7k
to Haiku, so the same text costs Haiku ~38% more at the same list price, and pushes long articles
over the 100k step sooner. Write-ups of the two small evals: `evals/help-chat/results/261007b/`
(`haiku55*.json`, `luna6.json`) and `evals/title-tidy/results/261009a/`.

## 3. The digest spike

**What it was.** Three articles from the local database, chosen to differ: an argumentative essay
(Seth, *The mythology of conscious AI*, 8.3k words), a scientific paper (*Entropy* 24-00930 on
partial information decomposition, 8.6k), and a long essay (Gwern, *The scaling hypothesis*, 12.6k).
For each, **Opus 5.5 wrote a digest once**: not a summary but a block-indexed map of the claims, how
the argument is built, the evidence and its qualifications, the weak points a careful critic would
raise, the passages a reader will find confusing (explained), key terms, and the traps a summariser
would fall into (GPT Sol's suggestion, at plan review: a synopsis would half-write the Summary for
the cheaper model; a map is reusable preparation). Example:
[the Seth digest](../../evals/results/digest-2026-10-09/the-mythology-of-conscious-ai-spya-rn5m0q/digest.md).

Then four outputs per article — **Summary (Fuller)**, **Ideas**, and **two chat questions** frozen
before any digest existed (one synthesis, one critical) — from five arms: **Opus 5.5** alone,
**Sonnet 5.5** alone, **Sonnet 5.5 + digest**, **Haiku 5.5** alone, **Haiku 5.5 + digest**. Summary
and Ideas are production's own requests, captured from `generateSimpleSummary` and `generateIdeas`
and replayed; chat is `buildConverseMessages`; outputs were checked with production's validators.
The digest arms differ from their twins by one added block and nothing else.

**Judging.** Each article's 20 outputs went to two judges — an Opus subagent and GPT Sol — under
shuffled letters, with the article and the task and nothing else: no model names, no digest. Each
scored every output on accuracy, coverage, nuance and usefulness (1–5) and overall (1–10), ties
allowed. The script is [`evals/digest/tally.ts`](../../evals/digest/tally.ts); its output, with every
judge's one-line note per output, is
[`judging/tally.md`](../../evals/results/digest-2026-10-09/judging/tally.md).

**Results** — overall score out of 10, both judges pooled, leaving out the three lineups where an
arm failed for a reason that was not its writing (below):

These are nine lineups, each scored twice; the 18 comparisons are judge-output
pairs, not independent samples. Summary and synthesis retain three articles,
Ideas two, and critical chat only Gwern. With all failures included, the pooled
means are Opus 7.17, Sonnet 6.67, Sonnet + digest 7.71, Haiku 6.25 and Haiku + digest
6.67. Excluding failures is a conditional writing comparison, not overall reliability.

| arm | Summary | Ideas | chat, synthesis | chat, critical | all | vs Opus | within a point of Opus, or better |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | 7.8 | 7.5 | 7.3 | 8.0 | **7.6** | — | — |
| Sonnet 5.5 | 7.7 | 7.8 | 8.2 | 6.5 | **7.7** | +0.1 | 16 of 18 |
| Sonnet 5.5 + digest | 8.0 | 8.8 | 8.5 | 8.0 | **8.3** | +0.7 | 18 of 18 |
| Haiku 5.5 | 6.7 | 5.8 | 6.8 | 5.5 | **6.4** | −1.2 | 9 of 18 |
| Haiku 5.5 + digest | 6.8 | 5.5 | 7.5 | 6.5 | **6.7** | −0.9 | 13 of 18 |

Per judge, all lineups in: the Opus judge put Sonnet + digest first (8.0, Opus 7.5); GPT Sol also put
it first (7.4, Opus 6.8). Neither judge favoured Opus's own outputs. They ordered a pair of arms the
same way 70 times and the opposite way 18 times (32 with a tie from one of them) — they agree on the
shape and often disagree on a particular answer, usually over one claim one of them read as a
misreading.

**What the judges' notes say the digest did.** It carried the author's hedges through. On the
*Entropy* paper the best answers kept that synergy depends on a contested redundancy measure, that
the rise in redundancy was relative, and that the macaque replication exists; the digest named all
three, and the digested arms kept them. On the Gwern essay's Summary, Sonnet + digest kept both the
author's turn that the pretraining approach "would've worked fine" and the hedged agency appendix;
Opus alone dropped the first, Sonnet alone the second. It
helped most in the **critical** chat column (Sonnet 6.5 → 8.0), which after exclusions
is Gwern alone. That suggests a hypothesis about "is this convincing?", not a
general result about critical questions. It did not stop every error: GPT Sol marked one digested Sonnet answer down
for reversing the direction of a measure effect.

**Four failed outputs in three lineups**, scored 1 by the judges and left out above:

- Both Sonnet arms' Ideas for the Gwern essay came back empty, `finish_reason: content_filter`,
  from Azure. The eval route has no provider preference; production prefers Anthropic
  and requires supported parameters. However, it does not set `only` or disable fallbacks,
  so these results cannot establish that Azure refusals are impossible in production
  ([OpenRouter's routing rules](https://openrouter.ai/docs/guides/routing/provider-selection)).
- Sonnet alone's critical chat answer on Seth wrote a web-search call out as text, because chat's
  prompt names tools the eval did not send. A harness artefact.
- **Opus's critical chat answer on *Entropy* was cut off at production's 4,000-token chat ceiling**,
  thinking included. That one is a real risk: High-powered chat runs Opus at `high` against the same
  ceiling. Worth raising the ceiling for high power, or watching `finish_reason: length` on chat.

**Cost.** The digest cost **$0.29, $0.33 and $0.37** (Opus 5.5 at `high`, ~2,500 words, 105–117 s).
That is inside Greg's 20–50 cents, at the top of it; `medium` might be cheaper and was not tested
(the eval route could not send it). At list price, without cache, an average output cost: Opus
$0.19, Sonnet + digest $0.09, Sonnet $0.07, Haiku + digest $0.006, Haiku $0.005. So:

- **With Sonnet versus Sonnet alone, the digest costs more.** Every downstream call reads
  ~7.3k more tokens (27% more input tokens on average), plus the digest. The measured
  uncached downstream bill rises 25%; that includes output as well as input. Versus
  Opus direct, Sonnet + digest has a cost break-even around 3.1 tasks per article at
  list price. These calculations include failed calls and this sample's output lengths.
- **With Haiku it is cheap** — a digest plus Haiku beats Opus alone on cost after about two tasks on
  an article — **but it scored below Opus here**: 6.7 to 7.6, and on Ideas two points behind.
- Effort was not production's for every arm: the `eval` route sends `high` to Opus and nothing to the
  others, so Sonnet ran at its default (`high`, which is what production asks for Summary and Ideas)
  and Haiku at its default (`medium`, one level below production's ask). Haiku at `high` would cost
  more and might close some of the gap; it was not measured.

**How far to trust this.** Three articles, one draw per arm, two judges. It can show a large effect
and a failure; it cannot establish equivalence, statistical significance or a
general family ranking. **Haiku scored lower at the tested settings**, with or
without the digest; **Sonnet's writing scores were near Opus after failures were
excluded**. The digest's +0.6 for Sonnet is positive in both judges' all-lineup means
and three of four task means in the conditional table. It is a promising observation
from one run, with different sample sizes per task and Haiku at lower effort.

## 4. Where the money actually goes

From production's ledger, read-only, the last 30 days: 38 articles, **median $0.94, p90 $2.85, max
$6.54**; 17 over $1. These are the original run's reported snapshot: no ledger
extract or calculation script was saved here, so they cannot be independently
recomputed from this change. The reported examples suggest cost does not simply follow length (a 38k-word book cost $3.20; a 7k-word paper $6.54)
— it follows **how many calls an article gets** (the $5.04 article had 177) and **which steps write a
lot**. By step, the biggest are debate (60k tokens in a call), ideas (12k out), Summary on Opus,
structure, labels, chat, sketch (15k out), glossary, quotes, citations, quiz, tweets, illustrated
(24k out). **The one-shot steps read the article with 0% cache**: each pays ~20–30k tokens of input
fresh, because no two steps share a byte-identical prefix today
([prompt-caching.md](../project/prompt-caching.md) § the pipeline row).

So the levers for "an article under $1" are, roughly in order of size: fewer calls per article
(what triggers the 100+), the output-heavy steps, a shared cacheable article prefix across steps,
and only then which model. A digest would not move those; nor would Haiku, without a quality cost.

## Recommendation for Greg

1. **Keep the model moves and measured exceptions** described above, and the rule in
   setup-dev.md. Sonnet 5.5 keeps the input/output price and lowers the cache-read price;
   on this small sample its conditional writing scores were near Opus.
2. **Don't adopt Haiku 5.5 on this evidence.** GPT-6 Luna is the same list price and cheaper
   in the Help run; DeepSeek was cheaper for title tidy on its zero-retention route;
   Haiku scored about a point lower on the tested reading tasks at the tested effort.
3. **Don't ship a digest cost-saving feature on this evidence.** Haiku did not match Opus
   here; Sonnet + digest can save against Opus after several tasks, but needs a larger
   quality and reliability eval. If you want
   to pursue it as a **quality** feature, the cheapest next step is **chat only**: one digest per
   article (~$0.33 here; lower effort has not been costed), placed after the article in chat's cached prefix and reused
   by every question — the one clean critical-chat lineup improved, and the digest's cost is
   spread over every question a reader asks. That would need a plan and a proper eval on more
   articles before it ships.
4. **Re-ask whether Summary needs Opus.** It moved to Opus on 2026-10-01 because Sonnet 5 made
   faults Opus didn't ([261001p](../plans/261001p-simple-on-opus-with-and-without-the-fidelity-guard.md)).
   Sonnet 5.5 scored level here; re-running that plan's fault count on Sonnet 5.5 would say whether
   Summary can come back to Sonnet at half the price.
5. **For the cost target, investigate calls per article and the uncached steps**, not the model.
6. **Two small follow-ups** found on the way: High-powered chat can be cut off at its 4,000-token
   ceiling; and the Overseer and fleet describer still run GPT-5.6 Luna (§ 1).
