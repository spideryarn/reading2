# 261001h fidelity guard — the blind read of unflagged paragraphs

Part of [261001h § Measuring the guard](261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md#measuring-the-guard-2026-10-01).
It checks the presumption, built into the false-alarm figures, that a paragraph nobody labelled is
faithful (the plan review's third P1).

**The sample.** 30 paragraphs Luna's checker passed and nobody labelled: 15 from the PID paper and
15 from the Olah and Gwern controls, drawn at random. Six known faults that Luna flagged were mixed
in, so that the reader could not assume the sample was clean. The order was shuffled with
`Math.random`, and the faults landed at items 5, 22, 26, 27, 30 and 31. An Opus subagent read each
item against its cited passages. It was told neither how many faults there were nor what the checker
had said.

**The result.** It marked exactly the six known items as faults, and none of the 30 unflagged ones.
Seven of the 30 it marked *unsupported*: true claims that their cited passages do not cover. Item 3
(`high-none-pidpost8/paragraphs/2`, *"loops back between source neurons"*) it called borderline. Zero
in 30 puts the missed-fault rate among unflagged paragraphs below about 10% (95% confidence). It does
not show the rate is zero.

| item | paragraph | reader |
|---:|---|---|
| 1 | `high-goalA-slider3/olah-a4-spya-ujr7p0/fuller/3` | unsupported |
| 2 | `high-none-after1/olah-a4-spya-ujr7p0/paragraphs/0` | ok |
| 3 | `high-none-pidpost8/paragraphs/2` | unsupported; "loops back" borderline |
| 4 | `high-none-slider3/scaling-hypothesis/fuller/3` | unsupported |
| 5 | `high-none-pidpost7/paragraphs/2` *(known: gloss)* | fault |
| 6 | `high-none-after1/olah-a4-spya-ujr7p0/fuller/0` | ok |
| 7 | `high-none-pidpre1/olah-a4-spya-ujr7p0/brief/1` | ok |
| 8 | `high-goalA-split1/fuller/2` | ok |
| 9 | `high-none-after1/scaling-hypothesis/fuller/0` | ok |
| 10 | `high-about-split1/fuller/0` | ok |
| 11 | `high-goalB-slider3/olah-a4-spya-ujr7p0/brief/2` | ok |
| 12 | `high-none-pidpost5/fuller/2` | ok |
| 13 | `high-none-pidpost7/paragraphs/1` | ok |
| 14 | `high-none-pidpost12/fuller/3` | unsupported |
| 15 | `high-none-pidpost1/olah-a4-spya-ujr7p0/brief/2` | ok |
| 16 | `high-goalA-after1/scaling-hypothesis/paragraphs/0` | ok |
| 17 | `high-none-split2/olah-a4-spya-ujr7p0/paragraphs/0` | ok |
| 18 | `high-about-split2/fuller/2` | unsupported |
| 19 | `high-goalA-split2/scaling-hypothesis/paragraphs/1` | unsupported |
| 20 | `high-none-pidpre4/paragraphs/0` | ok |
| 21 | `medium-12/paragraphs/0` | ok |
| 22 | `medium-12-v2/paragraphs/2` *(known: swap)* | fault |
| 23 | `high-none-split1/olah-a4-spya-ujr7p0/paragraphs/0` | ok |
| 24 | `high-none-pidpre5/brief/1` | ok |
| 25 | `high-none-pidpost1/scaling-hypothesis/paragraphs/2` | ok |
| 26 | `high-none-pidpost10/paragraphs/2` *(known: swap)* | fault |
| 27 | `high-none-pidv2_6/paragraphs/3` *(known: swap)* | fault |
| 28 | `high-goalA-split2/fuller/0` | ok |
| 29 | `high-none-pidpre3/fuller/2` | ok |
| 30 | `high-none-slider3/paragraphs/2` *(known: swap)* | fault |
| 31 | `high-none-pidpost8/brief/2` *(known: swap)* | fault |
| 32 | `high-none-split2/scaling-hypothesis/fuller/2` | ok |
| 33 | `high-about-slider2/fuller/2` | unsupported |
| 34 | `high-none-pidv2_5/paragraphs/0` | ok |
| 35 | `high-none-pidv2_1/scaling-hypothesis/paragraphs/2` | ok |
| 36 | `high-none-pidpost10/fuller/1` | ok |
