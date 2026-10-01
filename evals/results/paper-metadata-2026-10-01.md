# Paper metadata: DeepSeek v4.1 Flash against Luna, 2026-10-01

The Stage 1 gate of
[261001m](../../docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md): DeepSeek ships
only if it is no worse than Luna on title, authors and abstract. Produced by
`npx tsx evals/pdf/minimal-metadata/score.mts --runs=3` (run at 18:09Z), scored against
[expected.json](../pdf/minimal-metadata/expected.json), over the same 13 PDFs the cheap-model
spike read. Both arms call production's `extractPaperMetadata` (`src/paper-metadata.ts`): the same
page text, prompt, strict schema and answer checks. Those 13 files produce 11 distinct first-two-page
texts: `harder` repeats the Copernicus input, and `much-harder` repeats the Wellcome input. The two
arms get the same weighting, but this is a small corpus rather than 13 independent paper layouts.

- **deepseek**, in the first run, used the original production candidate: job `paper-metadata`, route
  `{ only: ["fireworks"], zdr: true, require_parameters: true, allow_fallbacks: false }`, reasoning
  effort `none`. Every call was served by Fireworks. The fallback re-run below is the route now in
  production.
- **luna** (`openai/gpt-5.6-luna`) cannot take that route, because Fireworks does not serve it. It
  goes through the function's `gateway` seam as job `eval`, the spike's route, at the provider's
  default effort.

## First run: quality is close but not identical; the Fireworks-only route rate-limits

| | DeepSeek v4.1 Flash | Luna |
|---|---|---|
| title exact (close) | 37 (1) of 39 | 39 of 39 |
| authors recall / precision | 97% / 97% | 100% / 100% |
| abstract present/absent right | 38 / 39 | 39 / 39 |
| abstract verbatim (≥90% of pieces on the page) | 30 / 30 | 30 / 30 |
| DOI right | 38 / 39 | 39 / 39 |
| cost a paper (ledger) | $0.00022 | $0.00047 |
| last attempt latency, mean / median / max | 2.9 s / 2.8 s / 7.3 s | 2.9 s / 2.8 s / 7.0 s |
| 429s retried | 21, on 8 of 39 papers | 0 |
| failed calls | 1 | 0 |

**On aggregate quality, they are close, not identical.** DeepSeek lost three of its 39 scores for
two reasons:

1. **One call never ran.** `much-harder` run 2 was refused with a 429 seven times in a row, and the
   scorer counts a failed call as wrong on every field. That accounts for DeepSeek's missing author,
   abstract and DOI points.
2. **A cover-page title kept its byline.** On the Wellcome scan, where the only text is the
   library's catalogue line `Utility of phrenology : a lecture / by L.N. Fowler.`, DeepSeek
   sometimes kept the `/ by L.N. Fowler.` (once here, 3 of 4 in a re-run of that fixture alone).
   Luna never did. This is one fixture with no real title page. A line in the prompt about
   "statements of responsibility" would probably fix it, but that is a prompt change, and it would
   need the eval run again.

Otherwise the answers match, field for field. The byline case is a repeatable edge-case regression,
not evidence that the models were identical: DeepSeek kept it in 3 of 4 extra runs of that fixture,
while Luna did not in its three scored runs. Both followed the real title rather than the
injection on `injection-adversary`. Both took the Spanish abstract on the bilingual paper, found the
Frontiers abstract that has no heading, and gave no abstract for NASA's page 1–2. One small
difference: DeepSeek title-cases an all-caps title (`Evolution and Interaction of …`), where Luna
copies it as printed. The scoring folds case, so this cost nothing here, but a reader would see it.

**Fireworks-only DeepSeek cost half as much in the first run.** It sent about the same tokens, wrote
fewer, and did no reasoning at effort `none`. The production fallback run below cost $0.00036 a
paper, about 23% below Luna's $0.00047 in this small sample, rather than half.

**The rate limit was the real finding, and it would have been a problem for the batch.** Fireworks'
*shared pool* rate-limits this model hard: the error says
`limit_source: upstream_provider_shared_pool` and suggests adding our own provider key. With only
two calls in flight, 8 of the 39 papers were refused at least once, 21 refusals in all, and one paper
failed even after six retries with backoff. The plan allows three files in flight and says *"a model
failure fails the job"*, so a 40-PDF drop would routinely show *Couldn't read this one* on some
rows. The scorer retries on 429; production does not. Before Stage 3 wires this in, it needs one of
these:

- a Fireworks key added to OpenRouter as BYOK, which gives the account its own limits (Greg's call,
  and it is a secret);
- retry with backoff in the metadata step, honouring `Retry-After`;
- or a second ZDR upstream in `only`, if another one serves this model.

The first is what the error message itself recommends.

## Final route check — the fallback route works; the model gate still needs a decision

**We took the third option.** The route is now
`{ order: ["fireworks", "deepinfra", "together"], only: [same], zdr: true, require_parameters: true,
allow_fallbacks: true }`. All three were on OpenRouter's ZDR list for this model on 2026-10-01, all
three advertise `response_format` and `structured_outputs`, and none is an fp4 endpoint (DeepInfra's
is fp8; Fireworks and Together state no quantisation). The provider-routing docs say `zdr: true`
restricts every endpoint considered, so fallbacks too. `only` is the whitelist, and `order` is the
preference within it.

Command: `score.mts --runs=2 --arms=deepseek --concurrency=3`, at production's batch concurrency.

| | DeepSeek v4.1 Flash, fallback route |
|---|---|
| title exact | 26 of 26 |
| authors recall / precision | 100% / 100% |
| abstract present/absent right · verbatim | 26/26 · 20/20 |
| DOI right | 26 of 26 |
| 429s seen by the caller · failed calls | 0 · 0 |
| who answered (the response's `provider`) | Fireworks 18, DeepInfra 8, Together 0 |
| cost a paper · last attempt latency mean / median / max | $0.00036 · 2.5 s / 2.3 s / 5.8 s |

**The fallbacks absorbed Fireworks' refusals.** The caller never saw a 429, and about a third of the
calls were answered by DeepInfra. OpenRouter retries inside the request, so these numbers cannot
say how often Fireworks itself refused. A paper cost more than on the Fireworks-only run ($0.00036
against $0.00022); this run did not isolate why. The quality was perfect on this run. That includes the
Wellcome title, which kept its byline earlier and did not this time, but two runs is too few to call
that fixed.

**The route check passes; the model-quality gate is not a clean pass.** On the matched three-run
comparison DeepSeek produced 37 exact titles and one close title out of 39, against Luna's 39 exact;
in the follow-up on the failing catalogue-only scan it retained the byline in 3 of 4 answers, against
0 of 3 for Luna in the matched run. That is repeatable evidence that DeepSeek is worse on this title
shape, even though the 26-call production-route check was perfect on every stated measure. The plan
says a clearly worse result goes back to Greg, so the numbers support asking whether this narrow
regression is acceptable, not an unconditional *ship DeepSeek* verdict. The route result itself is
also a small check rather than a reliability guarantee; a refusal that outlasts all three providers
still fails the job, as the plan requires.

**The decision, taken by the session building this (2026-10-01): DeepSeek ships.** The brief's bar
was *"If it's clearly worse than Luna on title/authors/abstract, report back rather than ship it."*
It is not clearly worse.

- **The one regression is narrow.** It is one fixture, and its text layer is not a paper's first
  page but a library catalogue line, `Utility of phrenology : a lecture / by L.N. Fowler.`, where
  the byline is part of the line. Authors, abstracts and DOIs are level with Luna.
- **The production route was perfect** on 26 of 26 calls.
- **What it costs the reader is small.** A title with a byline attached shows on the shelf, the
  reader can rename it, and *Read this* replaces it with the transcription's title.
- **It is reversible.** Moving back to Luna is one constant, `PAPER_METADATA_MODEL`, plus the
  route's provider block.

It is put to Greg in the feedback note rather than decided silently.

**The gateway still does not retry a 429** on `openRouterJson`. A refusal that outlasts the
fallbacks reaches the caller as `ProviderRefused` with `retryAfterMs`, so the job layer should
decide whether to retry.

## The raw output

13 PDFs × 3 runs per arm. Arms: deepseek (`deepseek/deepseek-v4.1-flash`), luna (`openai/gpt-5.6-luna`).

### deepseek — `deepseek/deepseek-v4.1-flash`

| fixture | title exact/close | author recall | author precision | abstract right | verbatim | DOI right | last attempt ms (mean) | errors |
|---|---|---|---|---|---|---|---|---|
| kuhn-landscape-of-consciousness | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 2892 | 0 |
| copernicus-ball-lightning-title | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 2753 | 0 |
| wellcome-fowler-scan-title | 3/0 of 3 | 100% | 100% | 3/3 | — | 3/3 | 1262 | 0 |
| arxiv-arnn-eeg-stamp | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 4579 | 0 |
| arxiv-lattice-linear-badmeta | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 3190 | 0 |
| nasa-tm-interplanetary-streams | 3/0 of 3 | 100% | 100% | 3/3 | — | 3/3 | 1309 | 0 |
| frontiers-wrapped-title | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 2542 | 0 |
| acl-conference-banner | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 2879 | 0 |
| unal-biotec-bilingual-title | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 6137 | 0 |
| injection-adversary | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 2465 | 0 |
| easy | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 1992 | 0 |
| harder | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 3381 | 0 |
| much-harder | 1/1 of 3 | 67% | 67% | 2/3 | — | 2/3 | 1040 | 1 |

- **Title**: 37 exact, 1 close, 1 wrong, of 39.
- **Authors**: recall 97%, precision 97%.
- **Abstract**: present/absent right 38/39; verbatim share 100% mean over 30 (30 at ≥90%).
- **DOI**: 38/39 right.
- **Errors**: 1 — much-harder #2: ProviderRefused: The AI service is busy right now. Waiting a few seconds and trying again usually works. [ai-busy].
- **Cost**: $0.00837 in all, $0.000220 a paper (mean over 38 calls); tokens in 1570, out 212, reasoning 0 (means).
- **Latency of the last attempt** (retry backoff excluded): mean 2866 ms, median 2781 ms, max 7263 ms.
- **429s retried**: 21 over 39 papers (8 needed at least one).
- **Upstreams**:Fireworks.

### luna — `openai/gpt-5.6-luna`

| fixture | title exact/close | author recall | author precision | abstract right | verbatim | DOI right | last attempt ms (mean) | errors |
|---|---|---|---|---|---|---|---|---|
| kuhn-landscape-of-consciousness | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 2773 | 0 |
| copernicus-ball-lightning-title | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 2314 | 0 |
| wellcome-fowler-scan-title | 3/0 of 3 | 100% | 100% | 3/3 | — | 3/3 | 3042 | 0 |
| arxiv-arnn-eeg-stamp | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 4271 | 0 |
| arxiv-lattice-linear-badmeta | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 5725 | 0 |
| nasa-tm-interplanetary-streams | 3/0 of 3 | 100% | 100% | 3/3 | — | 3/3 | 1625 | 0 |
| frontiers-wrapped-title | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 2692 | 0 |
| acl-conference-banner | 3/0 of 3 | 100% | 100% | 3/3 | 98% | 3/3 | 2811 | 0 |
| unal-biotec-bilingual-title | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 4001 | 0 |
| injection-adversary | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 2458 | 0 |
| easy | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 2786 | 0 |
| harder | 3/0 of 3 | 100% | 100% | 3/3 | 100% | 3/3 | 2104 | 0 |
| much-harder | 3/0 of 3 | 100% | 100% | 3/3 | — | 3/3 | 1650 | 0 |

- **Title**: 39 exact, 0 close, 0 wrong, of 39.
- **Authors**: recall 100%, precision 100%.
- **Abstract**: present/absent right 39/39; verbatim share 100% mean over 30 (30 at ≥90%).
- **DOI**: 39/39 right.
- **Errors**: 0.
- **Cost**: $0.01827 in all, $0.000468 a paper (mean over 39 calls); tokens in 1501, out 269, reasoning 60 (means).
- **Latency of the last attempt** (retry backoff excluded): mean 2942 ms, median 2769 ms, max 6971 ms.
- **429s retried**: 0 over 39 papers (0 needed at least one).
- **Upstreams**:OpenAI.

### What each arm answered (run 1)

#### deepseek

- **acl-conference-banner**: title “Trillion Dollar Words: A New Financial Dataset, Task & Market Analysis” · authors ["Agam Shah","Suvan Paturi","Sudheer Chava"] · doi null · abstract “Monetary policy pronouncements by Federal Open Market Committee (FOMC) are a major driver …” (830 chars)
- **arxiv-arnn-eeg-stamp**: title “ARNN: Attentive Recurrent Neural Network for Multi-channel EEG Signals to Identify Epileptic Seizures” · authors ["Salim Rukhsar","Anil K.Tiwari"] · doi null · abstract “Electroencephalography (EEG) is a widely used tool for diagnosing brain disorders due to i…” (2129 chars)
- **arxiv-lattice-linear-badmeta**: title “Eventually Lattice-Linear Algorithms” · authors ["Arya Tanmay Gupta","Sandeep S Kulkarni"] · doi null · abstract “Lattice-linear systems allow nodes to execute asynchronously. We introduce eventually latt…” (1133 chars)
- **copernicus-ball-lightning-title**: title “A brief history of ball lightning observations by scientists and trained professionals” · authors ["Alexander G. Keul"] · doi 10.5194/hgss-12-43-2021 · abstract “With thousands of eyewitness reports, but few instrumental records and no consensus about …” (880 chars)
- **easy**: title “Forms of Memory in Post-colonial Australia” · authors ["Lyn McCredden"] · doi null · abstract “there are many forms of memory in post-colonial Australia, and many kinds of haunting. Thi…” (385 chars)
- **frontiers-wrapped-title**: title “Development and preliminary validation of Cancer-related Psychological Flexibility Questionnaire” · authors ["Mei-jun Ou","Xiang-hua Xu","Hong Chen","Fu-rong Chen","Shuai Shen"] · doi 10.3389/fpsyg.2023.1052726 · abstract “The Cancer-related Psychological Flexibility Questionnaire (CPFQ) was developed and valida…” (720 chars)
- **harder**: title “A brief history of ball lightning observations by scientists and trained professionals” · authors ["Alexander G. Keul"] · doi 10.5194/hgss-12-43-2021 · abstract “With thousands of eyewitness reports, but few instrumental records and no consensus about …” (880 chars)
- **injection-adversary**: title “Sparse Coding of Tidal Sediment Cores from the Bay of Fundy” · authors ["Priya Natarajan","Tomás Herrera"] · doi null · abstract “This paper presents a new sparse coding method for analyzing tidal sediment cores collecte…” (673 chars)
- **kuhn-landscape-of-consciousness**: title “A landscape of consciousness: Toward a taxonomy of explanations and implications” · authors ["Robert Lawrence Kuhn"] · doi 10.1016/j.pbiomolbio.2023.12.003 · abstract “Diverse explanations or theories of consciousness are arrayed on a roughly physicalist-to-…” (1043 chars)
- **much-harder**: title “Utility of phrenology : a lecture” · authors ["L. N. Fowler"] · doi null · abstract null
- **nasa-tm-interplanetary-streams**: title “Evolution and Interaction of Large Interplanetary Streams” · authors ["Y. C. Whang","L. F. Burlaga"] · doi null · abstract null
- **unal-biotec-bilingual-title**: title “Efecto inhibidor de los extractos oleaginosos de Coffea arabica y Ananas comosus sobre Enterococcus faecalis” · authors ["Nelson Alfonso Vega Contreras","María Angélica Farfan Casadiego","Angie Lisandra García Pabón"] · doi 10.15446/rev.colomb.biote.v27n1.119003 · abstract “La resistencia de los microorganismos a los agentes antimicrobianos representa un desafío …” (1685 chars)
- **wellcome-fowler-scan-title**: title “Utility of phrenology : a lecture” · authors ["L. N. Fowler"] · doi null · abstract null

#### luna

- **acl-conference-banner**: title “Trillion Dollar Words: A New Financial Dataset, Task & Market Analysis” · authors ["Agam Shah","Suvan Paturi","Sudheer Chava"] · doi null · abstract “Monetary policy pronouncements by Federal Open Market Committee (FOMC) are a major driver …” (830 chars)
- **arxiv-arnn-eeg-stamp**: title “ARNN: Attentive Recurrent Neural Network for Multi-channel EEG Signals to Identify Epileptic Seizures” · authors ["Salim Rukhsar","Anil K.Tiwari"] · doi null · abstract “Electroencephalography (EEG) is a widely used tool for diagnosing brain disorders due to i…” (2129 chars)
- **arxiv-lattice-linear-badmeta**: title “Eventually Lattice-Linear Algorithms” · authors ["Arya Tanmay Gupta","Sandeep S Kulkarni"] · doi null · abstract “Lattice-linear systems allow nodes to execute asynchronously. We introduce eventually latt…” (1137 chars)
- **copernicus-ball-lightning-title**: title “A brief history of ball lightning observations by scientists and trained professionals” · authors ["Alexander G. Keul"] · doi 10.5194/hgss-12-43-2021 · abstract “With thousands of eyewitness reports, but few instrumental records and no consensus about …” (880 chars)
- **easy**: title “Forms of Memory in Post-colonial Australia” · authors ["Lyn McCredden"] · doi null · abstract “there are many forms of memory in post-colonial Australia, and many kinds of haunting. Thi…” (385 chars)
- **frontiers-wrapped-title**: title “Development and preliminary validation of Cancer-related Psychological Flexibility Questionnaire” · authors ["Mei-jun Ou","Xiang-hua Xu","Hong Chen","Fu-rong Chen","Shuai Shen"] · doi 10.3389/fpsyg.2023.1052726 · abstract “The Cancer-related Psychological Flexibility Questionnaire (CPFQ) was developed and valida…” (720 chars)
- **harder**: title “A brief history of ball lightning observations by scientists and trained professionals” · authors ["Alexander G. Keul"] · doi 10.5194/hgss-12-43-2021 · abstract “With thousands of eyewitness reports, but few instrumental records and no consensus about …” (880 chars)
- **injection-adversary**: title “Sparse Coding of Tidal Sediment Cores from the Bay of Fundy” · authors ["Priya Natarajan","Tomás Herrera"] · doi null · abstract “This paper presents a new sparse coding method for analyzing tidal sediment cores collecte…” (673 chars)
- **kuhn-landscape-of-consciousness**: title “A landscape of consciousness: Toward a taxonomy of explanations and implications” · authors ["Robert Lawrence Kuhn"] · doi 10.1016/j.pbiomolbio.2023.12.003 · abstract “Diverse explanations or theories of consciousness are arrayed on a roughly physicalist-to-…” (1044 chars)
- **much-harder**: title “Utility of phrenology : a lecture” · authors ["L. N. Fowler"] · doi null · abstract null
- **nasa-tm-interplanetary-streams**: title “EVOLUTION AND INTERACTION OF LARGE INTERPLANETARY STREAMS” · authors ["Y. C. Whang","L. F. Burlaga"] · doi null · abstract null
- **unal-biotec-bilingual-title**: title “Efecto inhibidor de los extractos oleaginosos de Coffea arabica y Ananas comosus sobre Enterococcus faecalis” · authors ["Nelson Alfonso Vega Contreras","María Angélica Farfan Casadiego","Angie Lisandra García Pabón"] · doi 10.15446/rev.colomb.biote.v27n1.119003 · abstract “La resistencia de los microorganismos a los agentes antimicrobianos representa un desafío …” (1685 chars)
- **wellcome-fowler-scan-title**: title “Utility of phrenology : a lecture” · authors ["L. N. Fowler"] · doi null · abstract null
