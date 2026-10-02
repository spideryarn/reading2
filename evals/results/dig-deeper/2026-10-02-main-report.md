# Dig deeper answer models — run `main`

**Complete trimmed run**: every retained manifest answer and judgement is present, current and valid (216 answers, 120 judgements; 42 planned judgements deliberately omitted).

Selection: examples kuhn-challenge, seth-naturalism, feynman-millikan, kuhn-sapolsky, gwern-schmidhuber, antikythera-parker; arms opus, opus-b, sonnet-5, sonnet-5.5, luna, luna+check, sol, kimi-k3, deepseek-flash, gemini-flash, glm-5.3, grok-4.7; 3 answer run(s), first 2 judged; judges opus, sol, grok; re-judge on; declared trim removed 42 judge calls. Commit at manifest: `e0fe8741ffed`.

Costs use the ledger's billed-spend rule. Ordinary OpenRouter calls are credits from `usage.cost` (cash is about 5.5% more when buying those credits); BYOK calls use the reported upstream inference cost and are billed on that provider's account instead.

**BYOK**: calls to openai/gpt-6-luna, openai/gpt-6.1-sol were served on our own provider key, so their `usage.cost` is a legitimate $0 of credits; they are priced here at the upstream figure plus any fee (`totalSpend`'s rule, src/ai-spend.ts), which is billed to that key rather than to credits.

## Per arm

| arm | delivered | acceptable (judged) | primary (vs opus) | 90% CI | outside-family | acc | src | depth | plain | overall | errors (pointed / not) | words | first press | repeat press (n, misses) | shared: first / repeat | answer: first word / total | wait: first / repeat | prefix read | truncated |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| opus | 18/18 | 8/12 | 0.00 | – | – | 4.6 | 4.2 | 4.5 | 4.5 | 8.1 | 0.3 / 0.0 | 337 | $0.720 | $0.061 (12, 0) | $0.024 / $0.024 | 11.8s / 15.1s | 18.7s / 18.7s | 72% | 0 |
| opus-b | 18/18 | 8/12 | -0.06 | -0.31 – 0.36 | 0.00 | 4.6 | 4.4 | 4.4 | 4.5 | 7.9 | 0.4 / 0.0 | 330 | $0.719 | $0.062 (12, 0) | $0.024 / $0.024 | 9.6s / 14.9s | 17.0s / 17.0s | 100% | 0 |
| sonnet-5 | 18/18 | 1/12 | -2.38 | -2.58 – -2.17 | -2.05 | 3.5 | 2.9 | 3.3 | 3.4 | 5.8 | 1.2 / 0.2 | 329 | $0.354 | $0.039 (12, 0) | $0.024 / $0.024 | 1.0s / 7.6s | 7.0s / 7.0s | 72% | 0 |
| sonnet-5.5 | 18/18 | 6/12 | -1.24 | -1.61 – -0.67 | -1.18 | 4.4 | 4.0 | 3.6 | 4.2 | 6.9 | 0.6 / 0.0 | 270 | $0.356 | $0.041 (12, 0) | $0.024 / $0.024 | 6.0s / 9.0s | 13.6s / 13.6s | 72% | 0 |
| luna | 18/18 | 7/12 | -2.21 | -2.42 – -1.92 | -2.86 | 4.6 | 4.1 | 2.3 | 4.4 | 5.9 | 0.2 / 0.0 | 129 | $0.011 | $0.001 (12, 0) | $0.024 / $0.024 | 7.1s / 8.0s | 13.4s / 13.4s | 73% | 0 |
| luna+check | 18/18 | 8/12 | -0.29 | -0.64 – 0.17 | 0.00 | 4.8 | 4.5 | 3.8 | 4.7 | 7.8 | 0.1 / 0.0 | 245 | $0.725 | $0.061 (12, 0) | $0.024 / $0.024 | 20.0s / 20.0s | 32.8s / 32.8s | 100% | 0 |
| sol | 18/18 | 10/12 | -0.47 | -1.06 – 0.06 | -1.23 | 4.9 | 4.5 | 3.7 | 4.6 | 7.6 | 0.1 / 0.0 | 204 | $0.228 | $0.012 (12, 0) | $0.024 / $0.024 | 4.9s / 10.4s | 11.6s / 11.6s | 73% | 0 |
| kimi-k3 | 3/18 | 0/12 | -1.33 | – | -1.33 | 3.7 | 3.0 | 4.0 | 4.0 | 5.7 | 1.0 / 0.3 | 326 | – | $0.022 (3, 9) | $0.024 / $0.024 | 9.4s / 12.5s | 15.1s / 15.1s | 33% | 0 |
| deepseek-flash | 17/18 | 3/12 | -1.23 | -1.69 – -0.50 | -1.23 | 4.1 | 3.9 | 4.0 | 3.5 | 6.8 | 1.1 / 0.0 | 350 | $0.004 | $0.004 (10, 2) | $0.024 / $0.024 | 35.3s / 44.4s | 41.1s / 41.1s | 56% | 2 |
| gemini-flash | 18/18 | 2/12 | -2.79 | -3.08 – -2.58 | -2.79 | 3.5 | 2.9 | 3.0 | 3.7 | 5.4 | 1.3 / 0.2 | 214 | $0.077 | $0.013 (12, 0) | $0.024 / $0.024 | 9.5s / 11.5s | 15.4s / 15.4s | 100% | 0 |
| glm-5.3 | 8/18 | 2/12 | -1.35 | -3.08 – -0.75 | -1.35 | 4.2 | 3.8 | 3.6 | 3.5 | 6.6 | 0.7 / 0.1 | 290 | $0.024 | $0.047 (3, 9) | $0.024 / $0.024 | 60.0s / 64.7s | 71.3s / 71.3s | 23% | 10 |
| grok-4.7 | 18/18 | 8/12 | -0.74 | -1.36 – -0.28 | -0.83 | 4.6 | 4.3 | 3.6 | 4.4 | 7.3 | 0.3 / 0.1 | 235 | $0.351 | $0.112 (11, 1) | $0.024 / $0.024 | 35.1s / 38.2s | 45.5s / 45.5s | 62% | 0 |

Primary and criterion means are conditional on delivered answers the panel could score; the delivered column exposes that denominator. Acceptability includes every scheduled judged press, so a refusal or delivery failure counts against it.
Shared first-press cost and time are the frozen capture. Shared repeat is a conservative reconstruction, not a second measurement: it removes *Look it up* only where production would skip an assessed lookup and otherwise holds the captured shared calls fixed.

**Reduced panel**: 2 judged press(es) had fewer than three judges. Their scores remain in quality means, but they cannot be certified acceptable under the declared two-of-three rule.

**The Opus check** (`luna+check`): replaced the draft in 83% of presses; the check call alone cost $0.059 a press on average.

## Noise

- **Incumbent generation spread** (opus-b against opus, judged blind side by side): -0.06 (90% CI -0.31 – 0.36). This is the spread of one model drawn twice, not a universal floor.
- **Run-to-run spread** (SD across runs of each arm's mean difference from opus): opus-b 0.42, sonnet-5 0.21, sonnet-5.5 0.17, luna 0.21, luna+check 0.50, sol 0.08, kimi-k3 –, deepseek-flash 0.08, gemini-flash 0.37, glm-5.3 0.34, grok-4.7 0.29.
- **Judge stability** (retained run-1 re-judgements with a fresh shuffle): 57 pairs, mean |Δ overall| 0.37, within one point 100%.
- **Position** (the repeated Opus answer's mean; non-anchor mean vs Opus in the same batch): 1: Opus 8.13 (n 24); -1.28 vs Opus (n 78); 2: Opus 8.09 (n 33); -1.20 vs Opus (n 69); 3: Opus 7.89 (n 18); -1.36 vs Opus (n 84); 4: Opus 8.17 (n 23); -1.44 vs Opus (n 63); 5: Opus 7.75 (n 4); -0.79 vs Opus (n 29).
- **Outside-family sensitivity**: disagrees with the all-judge mean for opus-b, luna+check.

## The frontier

- On acceptable rate against repeat-press cost: **luna, sol**.
- On primary quality against repeat-press cost: **opus, luna, luna+check, sol, deepseek-flash**.

## Three readings, for Greg to choose between

1. **Best quality**: opus — primary 0.00; $0.085 a press, $8.50 a hundred (repeat press with the shared search step).
2. **Cheapest within the incumbent spread of Opus** (primary ≥ −0.06): opus; $0.085 a press, $8.50 a hundred (repeat press with the shared search step).
3. **Cheapest acceptable on every example** (acceptable in at least two thirds of its runs on each): – none.

## Presses that were not delivered

- kimi-k3, kuhn-challenge r1: the call failed: HTTP 429: The AI service is busy right now. Waiting a few seconds and trying again usually works. [ai-busy]
- kimi-k3, kuhn-challenge r2: the call failed: HTTP 429: The AI service is busy right now. Waiting a few seconds and trying again usually works. [ai-busy]
- kimi-k3, kuhn-challenge r3: the call failed: HTTP 429: The AI service is busy right now. Waiting a few seconds and trying again usually works. [ai-busy]
- kimi-k3, seth-naturalism r1: the call failed: The AI service did not finish within 120 seconds, so this app stopped waiting. Long articles and complicated questions take longer; trying again, or asking something narrower, usually gets there. [ai-slow]
- kimi-k3, seth-naturalism r2: the call failed: The AI service did not finish within 120 seconds, so this app stopped waiting. Long articles and complicated questions take longer; trying again, or asking something narrower, usually gets there. [ai-slow]
- kimi-k3, feynman-millikan r1: the call failed: The AI service did not finish within 120 seconds, so this app stopped waiting. Long articles and complicated questions take longer; trying again, or asking something narrower, usually gets there. [ai-slow]
- kimi-k3, kuhn-sapolsky r1: the call failed: HTTP 429: The AI service is busy right now. Waiting a few seconds and trying again usually works. [ai-busy]
- kimi-k3, kuhn-sapolsky r2: the call failed: HTTP 429: The AI service is busy right now. Waiting a few seconds and trying again usually works. [ai-busy]
- kimi-k3, kuhn-sapolsky r3: the call failed: HTTP 429: The AI service is busy right now. Waiting a few seconds and trying again usually works. [ai-busy]
- kimi-k3, gwern-schmidhuber r1: the call failed: The AI service did not finish within 120 seconds, so this app stopped waiting. Long articles and complicated questions take longer; trying again, or asking something narrower, usually gets there. [ai-slow]
- kimi-k3, gwern-schmidhuber r2: the call failed: The AI service did not finish within 120 seconds, so this app stopped waiting. Long articles and complicated questions take longer; trying again, or asking something narrower, usually gets there. [ai-slow]
- kimi-k3, gwern-schmidhuber r3: the call failed: The AI service did not finish within 120 seconds, so this app stopped waiting. Long articles and complicated questions take longer; trying again, or asking something narrower, usually gets there. [ai-slow]
- kimi-k3, antikythera-parker r1: the call failed: The AI service did not finish within 120 seconds, so this app stopped waiting. Long articles and complicated questions take longer; trying again, or asking something narrower, usually gets there. [ai-slow]
- kimi-k3, antikythera-parker r2: the call failed: The AI service did not finish within 120 seconds, so this app stopped waiting. Long articles and complicated questions take longer; trying again, or asking something narrower, usually gets there. [ai-slow]
- kimi-k3, antikythera-parker r3: the call failed: The AI service did not finish within 120 seconds, so this app stopped waiting. Long articles and complicated questions take longer; trying again, or asking something narrower, usually gets there. [ai-slow]
- deepseek-flash, feynman-millikan r1: explain throws on an empty answer
- glm-5.3, kuhn-challenge r1: the glossary refuses truncated: The explanation ran past the room it had and stopped part-way, so it is not shown as a whole answer. Trying again usually gets one that fits. [gl-cut-off]
- glm-5.3, seth-naturalism r1: the glossary refuses truncated: The explanation ran past the room it had and stopped part-way, so it is not shown as a whole answer. Trying again usually gets one that fits. [gl-cut-off]
- glm-5.3, seth-naturalism r2: explain throws on an empty answer
- glm-5.3, seth-naturalism r3: explain throws on an empty answer
- glm-5.3, feynman-millikan r1: explain throws on an empty answer
- glm-5.3, feynman-millikan r2: explain throws on an empty answer
- glm-5.3, feynman-millikan r3: explain throws on an empty answer
- glm-5.3, kuhn-sapolsky r1: explain throws on an empty answer
- glm-5.3, kuhn-sapolsky r3: explain throws on an empty answer
- glm-5.3, antikythera-parker r3: Citations keeps only finished, not truncated

## The examples

- **kuhn-challenge** (glossary; Kuhn, A landscape of consciousness — long academic PDF, ~255k tokens) — Kuhn's own tenth category; the web's 'challenge theory' means unrelated things, and the article's definition sits ~1,600 blocks after the first mention. Capture 5 sources, 0 library passages; article sha fbd7b32179e3.
- **seth-naturalism** (glossary; Seth, The Mythology of Conscious AI — essay, ~13k tokens) — Seth's version (being alive is necessary) differs from Searle's, which is what the web says. Capture 2 sources, 4 library passages; article sha c41113e48633.
- **feynman-millikan** (comment; Feynman, Cargo Cult Science — talk transcript, ~5k tokens) — a famous claim historians dispute; a good answer keeps Feynman's story apart from the history. Capture 5 sources, 0 library passages; article sha dbbf38c1b50c.
- **kuhn-sapolsky** (comment; Kuhn, A landscape of consciousness — the same PDF as kuhn-challenge) — the article itself hedges this ~150 blocks earlier, and Sapolsky hedges two blocks later; the web alone misses both. Capture 5 sources, 0 library passages; article sha fbd7b32179e3.
- **gwern-schmidhuber** (citation; gwern, The Scaling Hypothesis — essay, ~26k tokens) — two untitled works behind one footnote; a confident single pick is wrong. Capture 5 sources, 0 library passages, lookup no-match, paper no-address; article sha 8c45de3aa105.
- **antikythera-parker** (citation; Antikythera mechanism — Wikipedia, technical, ~24k tokens) — the article contradicts itself about 365 vs 354 days; the work is cited for the 354 reading. Capture 5 sources, 0 library passages, lookup found, paper no-address; article sha 98d5b4ce3991.


Budget-accounted on this run (budget.json): $37.5094, including $0.7296 of conservative upper bounds for calls with no reported cost.
