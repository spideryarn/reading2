# Digest spike — costs (2026-10-09)

Total **$5.0280** over 63 cells (63 ledger rows, job `eval`, scope `eval`, local database). Every figure is the gateway's own spend record for the call (`recordUsd`, src/ai-spend.ts: OpenRouter's `usage.cost`).

## Effort each arm ran at

Job `eval` sends no `reasoning` except to Opus 5.5, where the gateway's `wireEffort` sends `high`. The others run at their provider default: Sonnet 5.5 `high`, Haiku 5.5 `medium`. Production sends `high` for Summary and Ideas and nothing (Sonnet) or `high` (Opus) for chat, so **Haiku runs one level below production's ask**. The digest also ran at `high`, not the `medium` the brief asked for: the eval route cannot send `medium` to Opus.

| arm | model | effort sent | effort ran |
|---|---|---|---|
| A-opus | anthropic/claude-opus-5.5 | high | high |
| B-sonnet | anthropic/claude-sonnet-5.5 | none | high |
| C-sonnet+digest | anthropic/claude-sonnet-5.5 | none | high |
| D-haiku | anthropic/claude-haiku-5.5 | none | medium |
| E-haiku+digest | anthropic/claude-haiku-5.5 | none | medium |

## The digest, per article (paid once per article)

| article | cost | words | ids cited | unknown ids | input tok | output tok | of which thinking | seconds |
|---|---|---|---|---|---|---|---|---|
| the-mythology-of-conscious-ai-spya-rn5m0q | $0.2925 | 2591 | 92 | 0 | 19094 | 9927 | 2849 | 105 |
| entropy-24-00930-spya-pywwkq | $0.3253 | 2442 | 65 | 0 | 19954 | 11349 | 4594 | 117 |
| scaling-hypothesis | $0.3683 | 2654 | 82 | 0 | 28334 | 11405 | 3791 | 116 |

Digest total $0.9861.

## Per arm: cost to produce these outputs

Billed cost depends on cache order: every call marks the article for caching, so whichever call reached an upstream second could read what the first wrote (see the cache-read column: the +digest arms ran after their no-digest twins and read far more), and a write that nobody read cost 1.25× the input price. So billed figures flatter the arms that ran second. The list-price column prices every call's input and output tokens at the uncached rate, which compares arms fairly.

| arm | calls | failures | billed | billed + digests | list, no cache | list + digests | output tok | of which thinking | cache-read tok | chat-q1 | chat-q2 | ideas | summary-fuller |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A-opus | 12 | 1 | $2.5693 | $2.5693 | $2.2667 | $2.2667 | 48067 | 19841 | 0 | $0.5182 | $0.5832 | $0.8854 | $0.5825 |
| B-sonnet | 12 | 1 | $0.8599 | $0.8599 | $0.8628 | $0.8628 | 21014 | 4766 | 64258 | $0.2557 | $0.1012 | $0.2654 | $0.2375 |
| C-sonnet+digest | 12 | 1 | $0.5072 | $1.4933 | $1.0820 | $2.0052 | 25413 | 7083 | 302558 | $0.0895 | $0.0998 | $0.1652 | $0.1526 |
| D-haiku | 12 | 0 | $0.0577 | $0.0577 | $0.0601 | $0.0601 | 54900 | 38093 | 86714 | $0.0131 | $0.0041 | $0.0150 | $0.0255 |
| E-haiku+digest | 12 | 0 | $0.0478 | $1.0340 | $0.0751 | $0.9982 | 67345 | 50400 | 302558 | $0.0059 | $0.0071 | $0.0103 | $0.0245 |

(the per-task columns are billed)

Per article, digest amortised over this article's tasks only:

| arm | the-mythology-of-conscious-ai-spya-rn5m0q | entropy-24-00930-spya-pywwkq | scaling-hypothesis |
|---|---|---|---|
| A-opus | $0.7377 / $0.7377 | $0.7657 / $0.7657 | $1.0659 / $1.0659 |
| B-sonnet | $0.2962 / $0.2962 | $0.2526 / $0.2526 | $0.3111 / $0.3111 |
| C-sonnet+digest | $0.1717 / $0.4642 | $0.1650 / $0.4903 | $0.1705 / $0.5388 |
| D-haiku | $0.0188 / $0.0188 | $0.0187 / $0.0187 | $0.0203 / $0.0203 |
| E-haiku+digest | $0.0192 / $0.3117 | $0.0124 / $0.3377 | $0.0163 / $0.3846 |

(without digest / with this article's digest added)

## Break-even

**Billed.** Average task: Opus $0.2141, Sonnet+digest $0.0423, Haiku+digest $0.0040; average digest $0.3287. Tasks on one article after which a digest plus the cheaper model costs less than Opus alone:

- C-sonnet+digest: 1.9
- E-haiku+digest: 1.6

**List price, no cache.** Average task: Opus $0.1889, Sonnet+digest $0.0902, Haiku+digest $0.0063; average digest $0.3077. Tasks on one article after which a digest plus the cheaper model costs less than Opus alone:

- C-sonnet+digest: 3.1
- E-haiku+digest: 1.7

These are cost break-evens only. Whether a cheaper arm's output is as good as Opus's is the judging's question.

## Failures

- entropy-24-00930-spya-pywwkq chat-q2 A-opus: finish_reason length: the answer was cut off at max_tokens
- scaling-hypothesis ideas B-sonnet: empty answer (finish_reason content_filter)
- scaling-hypothesis ideas C-sonnet+digest: empty answer (finish_reason content_filter)

## Per call

| article | task | arm | ok | cost | in | out | thinking | cache read | cache write | s |
|---|---|---|---|---|---|---|---|---|---|---|
| the-mythology-of-conscious-ai-spya-rn5m0q | digest | digest | yes | $0.2925 | 19094 | 9927 | 2849 | 0 | 17630 | 105 |
| the-mythology-of-conscious-ai-spya-rn5m0q | chat-q1 | A-opus | yes | $0.1406 | 22712 | 1363 | 612 | 0 | 22456 | 16 |
| the-mythology-of-conscious-ai-spya-rn5m0q | chat-q1 | B-sonnet | yes | $0.0687 | 22712 | 1206 | 627 | 0 | 22456 | 10 |
| the-mythology-of-conscious-ai-spya-rn5m0q | chat-q1 | C-sonnet+digest | yes | $0.0292 | 29941 | 1200 | 487 | 22456 | 0 | 10 |
| the-mythology-of-conscious-ai-spya-rn5m0q | chat-q1 | D-haiku | yes | $0.0036 | 22712 | 1524 | 1078 | 0 | 22456 | 9 |
| the-mythology-of-conscious-ai-spya-rn5m0q | chat-q1 | E-haiku+digest | yes | $0.0019 | 29941 | 1808 | 1250 | 22456 | 0 | 10 |
| the-mythology-of-conscious-ai-spya-rn5m0q | chat-q2 | A-opus | yes | $0.1497 | 22694 | 1825 | 1117 | 0 | 22456 | 22 |
| the-mythology-of-conscious-ai-spya-rn5m0q | chat-q2 | B-sonnet | yes | $0.0634 | 22694 | 678 | 593 | 0 | 22456 | 29 |
| the-mythology-of-conscious-ai-spya-rn5m0q | chat-q2 | C-sonnet+digest | yes | $0.0327 | 29923 | 1553 | 884 | 22456 | 0 | 47 |
| the-mythology-of-conscious-ai-spya-rn5m0q | chat-q2 | D-haiku | yes | $0.0015 | 22694 | 2581 | 2131 | 22456 | 0 | 14 |
| the-mythology-of-conscious-ai-spya-rn5m0q | chat-q2 | E-haiku+digest | yes | $0.0023 | 29923 | 2720 | 2062 | 22456 | 0 | 15 |
| the-mythology-of-conscious-ai-spya-rn5m0q | ideas | A-opus | yes | $0.2841 | 22143 | 8867 | 3980 | 0 | 18164 | 115 |
| the-mythology-of-conscious-ai-spya-rn5m0q | ideas | B-sonnet | yes | $0.0925 | 22143 | 3910 | 0 | 0 | 18164 | 25 |
| the-mythology-of-conscious-ai-spya-rn5m0q | ideas | C-sonnet+digest | yes | $0.0680 | 29372 | 4375 | 0 | 18164 | 0 | 29 |
| the-mythology-of-conscious-ai-spya-rn5m0q | ideas | D-haiku | yes | $0.0056 | 22143 | 5951 | 4283 | 0 | 18164 | 28 |
| the-mythology-of-conscious-ai-spya-rn5m0q | ideas | E-haiku+digest | yes | $0.0036 | 29372 | 4583 | 3042 | 18164 | 0 | 21 |
| the-mythology-of-conscious-ai-spya-rn5m0q | summary-fuller | A-opus | yes | $0.1633 | 21423 | 2973 | 1019 | 0 | 18144 | 51 |
| the-mythology-of-conscious-ai-spya-rn5m0q | summary-fuller | B-sonnet | yes | $0.0717 | 21423 | 1974 | 0 | 0 | 18144 | 32 |
| the-mythology-of-conscious-ai-spya-rn5m0q | summary-fuller | C-sonnet+digest | yes | $0.0418 | 28652 | 1894 | 0 | 18144 | 0 | 14 |
| the-mythology-of-conscious-ai-spya-rn5m0q | summary-fuller | D-haiku | yes | $0.0080 | 21423 | 10795 | 8674 | 0 | 18144 | 45 |
| the-mythology-of-conscious-ai-spya-rn5m0q | summary-fuller | E-haiku+digest | yes | $0.0114 | 28652 | 20323 | 18223 | 18144 | 0 | 95 |
| entropy-24-00930-spya-pywwkq | digest | digest | yes | $0.3253 | 19954 | 11349 | 4594 | 0 | 18489 | 117 |
| entropy-24-00930-spya-pywwkq | chat-q1 | A-opus | yes | $0.1414 | 23554 | 1195 | 502 | 0 | 23311 | 16 |
| entropy-24-00930-spya-pywwkq | chat-q1 | B-sonnet | yes | $0.0711 | 23554 | 1229 | 532 | 0 | 23311 | 10 |
| entropy-24-00930-spya-pywwkq | chat-q1 | C-sonnet+digest | yes | $0.0282 | 30464 | 1162 | 460 | 23315 | 0 | 9 |
| entropy-24-00930-spya-pywwkq | chat-q1 | D-haiku | yes | $0.0036 | 23554 | 1379 | 821 | 0 | 23311 | 8 |
| entropy-24-00930-spya-pywwkq | chat-q1 | E-haiku+digest | yes | $0.0016 | 30464 | 1260 | 753 | 23315 | 0 | 7 |
| entropy-24-00930-spya-pywwkq | chat-q2 | A-opus | NO | $0.1976 | 23564 | 4000 | 102 | 0 | 23311 | 33 |
| entropy-24-00930-spya-pywwkq | chat-q2 | B-sonnet | yes | $0.0200 | 23564 | 1716 | 993 | 23311 | 0 | 44 |
| entropy-24-00930-spya-pywwkq | chat-q2 | C-sonnet+digest | yes | $0.0327 | 30474 | 1610 | 796 | 23315 | 0 | 13 |
| entropy-24-00930-spya-pywwkq | chat-q2 | D-haiku | yes | $0.0013 | 23564 | 2075 | 1339 | 23311 | 0 | 12 |
| entropy-24-00930-spya-pywwkq | chat-q2 | E-haiku+digest | yes | $0.0025 | 30474 | 3026 | 2343 | 23315 | 0 | 15 |
| entropy-24-00930-spya-pywwkq | ideas | A-opus | yes | $0.2640 | 23281 | 7592 | 3246 | 0 | 19023 | 170 |
| entropy-24-00930-spya-pywwkq | ideas | B-sonnet | yes | $0.0892 | 23281 | 3317 | 0 | 0 | 19023 | 24 |
| entropy-24-00930-spya-pywwkq | ideas | C-sonnet+digest | yes | $0.0626 | 30186 | 3842 | 0 | 19023 | 0 | 26 |
| entropy-24-00930-spya-pywwkq | ideas | D-haiku | yes | $0.0041 | 23281 | 2654 | 0 | 0 | 19023 | 12 |
| entropy-24-00930-spya-pywwkq | ideas | E-haiku+digest | yes | $0.0027 | 30186 | 2849 | 0 | 19023 | 0 | 12 |
| entropy-24-00930-spya-pywwkq | summary-fuller | A-opus | yes | $0.1627 | 22283 | 2727 | 735 | 0 | 19003 | 48 |
| entropy-24-00930-spya-pywwkq | summary-fuller | B-sonnet | yes | $0.0723 | 22283 | 1821 | 0 | 0 | 19003 | 15 |
| entropy-24-00930-spya-pywwkq | summary-fuller | C-sonnet+digest | yes | $0.0414 | 29188 | 1908 | 0 | 19003 | 0 | 13 |
| entropy-24-00930-spya-pywwkq | summary-fuller | D-haiku | yes | $0.0096 | 22283 | 13787 | 11351 | 0 | 19003 | 57 |
| entropy-24-00930-spya-pywwkq | summary-fuller | E-haiku+digest | yes | $0.0056 | 29188 | 8820 | 6445 | 19003 | 0 | 38 |
| scaling-hypothesis | digest | digest | yes | $0.3683 | 28334 | 11405 | 3791 | 0 | 26870 | 116 |
| scaling-hypothesis | chat-q1 | A-opus | yes | $0.2362 | 41189 | 1524 | 821 | 0 | 40947 | 22 |
| scaling-hypothesis | chat-q1 | B-sonnet | yes | $0.1160 | 41189 | 1313 | 651 | 0 | 40947 | 12 |
| scaling-hypothesis | chat-q1 | C-sonnet+digest | yes | $0.0321 | 48954 | 1195 | 517 | 40947 | 0 | 13 |
| scaling-hypothesis | chat-q1 | D-haiku | yes | $0.0059 | 41189 | 1507 | 1025 | 0 | 40947 | 10 |
| scaling-hypothesis | chat-q1 | E-haiku+digest | yes | $0.0024 | 48954 | 2430 | 1835 | 40947 | 0 | 14 |
| scaling-hypothesis | chat-q2 | A-opus | yes | $0.2359 | 41179 | 1514 | 750 | 0 | 40947 | 18 |
| scaling-hypothesis | chat-q2 | B-sonnet | yes | $0.0178 | 41179 | 1323 | 702 | 40947 | 0 | 13 |
| scaling-hypothesis | chat-q2 | C-sonnet+digest | yes | $0.0343 | 48944 | 1426 | 683 | 40947 | 0 | 28 |
| scaling-hypothesis | chat-q2 | D-haiku | yes | $0.0012 | 41179 | 1600 | 1024 | 40947 | 0 | 9 |
| scaling-hypothesis | chat-q2 | E-haiku+digest | yes | $0.0023 | 48944 | 2250 | 1701 | 40947 | 0 | 13 |
| scaling-hypothesis | ideas | A-opus | yes | $0.3373 | 31657 | 9163 | 3810 | 0 | 27404 | 277 |
| scaling-hypothesis | ideas | B-sonnet | NO | $0.0837 | 31657 | 668 | 668 | 0 | 27404 | 17 |
| scaling-hypothesis | ideas | C-sonnet+digest | NO | $0.0346 | 39422 | 783 | 783 | 27404 | 0 | 9 |
| scaling-hypothesis | ideas | D-haiku | yes | $0.0052 | 31657 | 2680 | 0 | 0 | 27404 | 13 |
| scaling-hypothesis | ideas | E-haiku+digest | yes | $0.0040 | 39422 | 4988 | 2885 | 27404 | 0 | 24 |
| scaling-hypothesis | summary-fuller | A-opus | yes | $0.2565 | 30663 | 5324 | 3147 | 0 | 27384 | 346 |
| scaling-hypothesis | summary-fuller | B-sonnet | yes | $0.0936 | 30663 | 1859 | 0 | 0 | 27384 | 14 |
| scaling-hypothesis | summary-fuller | C-sonnet+digest | yes | $0.0695 | 38428 | 4465 | 2473 | 27384 | 0 | 42 |
| scaling-hypothesis | summary-fuller | D-haiku | yes | $0.0079 | 30663 | 8367 | 6367 | 0 | 27384 | 38 |
| scaling-hypothesis | summary-fuller | E-haiku+digest | yes | $0.0075 | 38428 | 12288 | 9861 | 27384 | 0 | 54 |
