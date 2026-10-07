# Outside web check of the citations influence scores (2026-10-03)

Source rows: `after-1-*.json`, antikythera and scaling-hypothesis articles (openai-huggingface has 6 rows, not sampled).
Sampling: every Nth row inside each band. The high band holds only 15 rows in total, 8 sampled. The low band holds 13, 8 sampled. The null band holds 79, 12 sampled.
Counts are OpenAlex `cited_by_count` unless stated. They are crude: they split a book from its reviews, miss some preprint versions, and run well below Google Scholar. "n/f" means no matching record was found. "ns" means a record exists but no count was retrieved (rate-limited or not surfaced).

## A. Rows the model gave a number (24)

| Article | Title | Authors | Yr | Model | Exists? | Citations | Judgement | Note |
|---|---|---|---|---|---|---|---|---|
| anti | Decoding the ancient Greek astronomical calculator... | Freeth et al. | 2006 | 1.0 | yes (Nature 444) | 357 | about right | The field's anchor paper. |
| anti | The Cosmos in the Antikythera Mechanism | Freeth, Jones | 2012 | 0.8 | yes (ISAW Papers 4) | n/f | about right | Core specialist reference; no count. |
| anti | Calendars with Olympiad display and eclipse prediction... | Freeth et al. | 2008 | 0.8 | yes (Nature 454) | 159 | about right | |
| anti | Gears from the Greeks | Price | 1974 | 0.9 | yes (Trans. APS 64.7) | 0-1 (OpenAlex holds only reviews) | about right | Landmark by reputation; the count says nothing. |
| anti | Ptolemy's Almagest | Ptolemy | 1998 | 0.9 | yes (1998 is an edition year) | n/a | about right | Famous work. |
| anti | De Re Publica, Liber Primus | Cicero | null | 0.7 | yes, classical text | n/a | cannot tell | Real; a classical text, no citation count to compare. |
| scal | T5 | (none) | null | 0.8 | yes (Raffel et al. 2019) | 3,690 | about right | Possibly a notch low. |
| scal | EfficientNet | (none) | null | 0.7 | yes (Tan and Le 2019) | 4,987 | about right | |
| anti | The Calendar on the Antikythera Mechanism and the Corinthian Family... | Iversen | 2017 | 0.4 | yes (Hesperia 86) | 28 | about right | |
| anti | In search of lost time | Marchant | 2006 | 0.4 | yes (Nature 444:534, news feature) | n/f | cannot tell | Real; a news feature, not research. |
| anti | An improved calendar ring hole-count... | Woan, Bayley | 2024 | 0.4 | yes (arXiv 2403.00040, Horological J.) | 0 | too high | Real and recent; nothing cites it yet. 0.2 or less. |
| anti | Solar anomaly and planetary displays... | Evans, Carman, Thorndike | 2010 | 0.5 | yes (JHA 41) | ns | about right | Cited as standard in later reviews. |
| anti | De Natura Deorum II.88 | Cicero | null | 0.5 | yes, classical passage | n/a | cannot tell | A passage, not a paper. |
| scal | Jukebox | (none) | null | 0.5 | yes (Dhariwal et al. 2020) | ns | about right | Widely cited in music-generation work. |
| scal | AI and Compute | Amodei et al. | 2018 | 0.6 | yes, OpenAI blog post | n/a | about right | Heavily cited in scaling discussion. |
| scal | BiT (Big Transfer) | (none) | null | 0.5 | yes (Kolesnikov et al. 2020) | 1,001 | about right | Slightly low, if anything. |
| anti | The Reconstruction of the Antikythera Mechanism | Efstathiou et al. | 2013 | 0.3 | yes (poster) | 0 | about right | |
| anti | Determination of the gears geometrical parameters... | Efstathiou et al. | 2012 | 0.3 | yes | 23 | about right | |
| anti | The Initial Calibration Date... Saros spiral... | Voularis et al. | 2022 | 0.2 | yes (arXiv 2203.15045) | ns | about right | |
| anti | Building the Cosmos in the Antikythera Mechanism | Freeth | 2013 | 0.3 | yes | 12 | about right | |
| anti | How Many Days in an Egyptian Year? | Malin, Dickens | 2024 | 0.3 | cannot tell (no record found) | n/f | cannot tell | Search returned nothing. |
| anti | Conclusions from the Functional Reconstruction... | Voulgaris et al. | 2018 | 0.2 | cannot tell (neighbouring papers by the group found, not this one) | n/f | cannot tell | Plausibly real. |
| anti | Vitruvius' odometer | Sleeswyk | 1981 | 0.3 | cannot tell (only later papers on the topic found) | n/f | cannot tell | I believe it is real (Scientific American 1981) but did not verify. |
| anti | Early mathematical wheelwork: Byzantine calendrical gearing | Maddison | 1985 | 0.3 | yes | 2 | about right | Possibly slightly high. |

## B. Rows the model called unknown (12)

| Article | Title | Authors | Yr | Exists? | Citations | Judgement | Note |
|---|---|---|---|---|---|---|---|
| anti | The Antikythera mechanism: who was its creator...? | Pinotsis | 2007 | cannot tell (not found) | n/f | fair to call unknown | Could not verify it exists. |
| anti | Ancient computer's gears may not have been able to turn | Wilkins | 2025 | yes (New Scientist news, Alex Wilkins) | n/a | fair to call unknown | News piece reporting Szigety and Arenas. |
| anti | No, Archaeologists Probably Did Not Find a New Piece... | Daley | 2018 | yes (Smithsonian Magazine, 2018-11-15) | n/a | fair to call unknown | |
| anti | Important New Discoveries from Greece's Ancient Antikythera Shipwreck | Kampouris | 2019 | yes (Greek Reporter, 2019-10-18) | n/a | fair to call unknown | |
| anti | Ancient Device Was Used To Predict Olympic Games | Connor | 2008 | cannot tell (exact title not found; story widely syndicated) | n/a | fair to call unknown | |
| anti | The Impact of Triangular-Toothed Gears... | Szigety, Arenas | 2025 | yes (arXiv 2504.00327) | n/f | fair to call unknown | Press-covered but a fresh preprint. |
| anti | The Song Dynasty in China | (none) | null | no, a topic not a work | n/a | fair to call unknown | Extraction noise. |
| scal | Schmidhuber 2015/2018 | Schmidhuber | null | yes, but ambiguous | 28,345 (Google Scholar) for the 2015 Overview; 34 for One Big Net (2018) | fair to call unknown, with a caveat | No title. If it means the 2015 Overview it is famous and deserves a number; if the RL-prompt line or One Big Net, it is minor. Unresolvable as written. |
| scal | Brants et al 2007 | Brants et al. | 2007 | yes (EMNLP 2007, "Large Language Models in Machine Translation") | n/f (OpenAlex returned a different 2008 paper, 38) | arguably should have had a number | Well known to specialists and a standard scaling citation. About 0.4 would be fair. Count not retrieved. |
| scal | Child 2020 | Child | 2020 | cannot tell which paper | n/f | fair to call unknown | No title, so nothing to check. |
| scal | Lake 2019 | Lake | 2019 | probably (NeurIPS 2019 meta seq2seq paper) | n/f | fair to call unknown | Specialist paper; unidentifiable from the row alone. |
| scal | Viering & Loog 2021 | Viering, Loog | 2021 | yes (IEEE TPAMI review) | ns | fair to call unknown | Respectable, not famous. |

## Totals

**A (24 rows).**
- Number about right: 17.
- Too high: 1 (Woan and Bayley 2024, 0.4, zero citations).
- Too low: 0 clearly (T5 and BiT possibly a notch low).
- Cannot judge: 6. These are the two Cicero rows and the Marchant news feature (no citation count to compare), and Malin and Dickens, Voulgaris 2018 and Sleeswyk (could not confirm they exist).
- Existence: 21 confirmed real, 3 cannot tell, none shown not to exist.
- Ordering is right: 1.0 for the Nature 2006 paper at 357 citations, down to 0.2-0.3 for items with 0-23. The one error is on a very recent item.

**B (12 rows).**
- Fair to call unknown: 10.
- Arguably should have had a number: 1 (Brants et al. 2007).
- Ambiguous: 1 (Schmidhuber 2015/2018, no title).
- Existence: 7 confirmed real, Lake 2019 probable, 1 not a work (Song Dynasty), 3 not verified (Pinotsis, Connor, Child).

## Most telling cases

1. **Brants et al. 2007 (null).** The clearest miss: a specialist-known scaling citation left unknown. The row has only author and year, which may be why.
2. **Schmidhuber 2015/2018 (null).** One author has a 28k-citation paper from 2015 and a 34-citation one from 2018. A row with no title cannot be scored fairly, so "unknown" is the honest answer.
3. **Woan and Bayley 2024 (0.4).** The one clear overestimate: real and press-covered, zero citations. The model may score recent, well-covered items above their record.
4. **Freeth 2006 and 2008 (1.0, 0.8).** The top of the scale is right: 357 and 159 citations in a small field, with Price 1974 as the acknowledged precursor.

## What I could not check

- OpenAlex counts are low and incomplete (357 for the Nature 2006 paper; Google Scholar would be several times higher). Use them for ranking only.
- Counts not retrieved (rate limits, or no matching record): Evans 2010, Jukebox, Voularis 2022, Viering and Loog, Marchant, the Cosmos ISAW paper.
- Existence unsettled: Malin and Dickens 2024, Voulgaris 2018, Sleeswyk 1981, Pinotsis 2007, Connor 2008, Child 2020.
- News articles, blog posts and classical passages have no meaningful citation count, so "about right" there is a judgement of reputation only.
- Several scaling rows have no title or authors (T5, EfficientNet, Jukebox, BiT, Child, Lake). I identified them by name, which is a guess about what the row refers to.
- Sample is skewed: the high band held only 15 rows, 6 of them Antikythera and 2 scaling. The low band is all Antikythera. The openai-huggingface article was not sampled.
