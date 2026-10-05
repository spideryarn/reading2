# Reading-time estimates, and whether they can know how hard a piece is

Up: [research.md](../project/research.md)

Researched 2026-10-05 by a Sonnet subagent (web search and fetch), for Greg's report `spya-jew7ds`.
The plan it fed is
[261005c](../plans/261005c-reading-time-estimate-says-its-rate-its-range-and-what-it-does-not-know.md).

> We estimate the number of minutes to read. Does this take into account the difficulty? I think the
> old_version of Spideryarn had some logic along these lines, though maybe it was too simplistic (and
> maybe it should be something the LLM returns as part of the input process). For example, this Carlo
> Rovelli book uses fairly simple language for complex ideas, so our difficulty ratings should take
> into account both dimensions. And also perhaps the user's profile.
>
> — Greg, 2026-10-04 (`spya-jew7ds`)

Every claim below is marked: **[read]** the page or its abstract was read; **[snippet]** from a
search-result summary only; **[inferred]** ours.

## The short answer

- **No, the estimate did not know about difficulty.** It was body words ÷ 230, a folk number.
- **A cheap formula uses one proxy for difficulty.** Mean word length predicts reading rate in
  the studies cited below, but does not directly measure hard ideas expressed in plain words,
  Greg's Rovelli example. **[read, inferred]** (Rovelli's own word length was not measured.)
- **A model may help with the other kind [inferred]**, but a model's rating has not been validated
  against reading *time* on articles and readers like ours. The model studies read below assess
  human readability judgements rather than reading time. **[read]**
- **Reading pace varies between readers as well as between texts.** The sources below establish
  both, without establishing that the spreads are equal. **[read]** So our cheap step is to say the
  range, and what the number does not know. **[inferred]**
- **We already record a signal worth exploring**: how long readers spend with each block on screen
  ([reading-time.md](../project/reading-time.md)). It is shared out by visible area and is a running
  total with no sessions, so re-reads, skipped paragraphs and idling are mixed in. A lead to
  validate, not a calibration.

## What the old version did

The old repo is on Greg's Mac only (`/Users/greg/dev/spideryarn/reading`), so its code and its three
research docs were **not read**. This is from our digest,
[difficulty-and-reading-time.md](../project/original-version/difficulty-and-reading-time.md).

- One model call per document returned `{level, confidence, factors[]}`, High school to
  Post-doctoral.
- The digest describes a baseline reading rate of 238 words a minute, scaled by a multiplier from
  1.0 (high school) to 0.55 (post-doctoral), damped with
  `1 - (1 - multiplier) * confidenceWeight`. A lower rate means more reading time; how the raw
  confidence became this weight was not verified.
- It dropped Flesch-style formulas with citations, and adopted the model with none. Nothing checked
  that the model's badge was better, or that the multipliers matched real reading times.
- One overall level compresses the distinction between language and ideas, even if the returned
  factors describe both. That is the sense in which it was too simple. **[inferred]**

## How fast people read

- **Brysbaert 2019**, *How many words do we read per minute?* (J. Memory and Language 109), 190
  studies, 18,573 people. Silent reading in English: **238 wpm for non-fiction, 260 for fiction**.
  *"For silent reading of English non-fiction most adults fall in the range of 175 to 300 wpm; for
  fiction the range is 200 to 320 wpm."* **[read]** — the abstract, at
  <https://api.osf.io/v2/preprints/xynwg/>, fetched 2026-10-05.
- SD 52 wpm, memorising 138 wpm, second-language readers about 10% slower in one study.
  **[snippet]**, from secondary summaries; check against the paper before quoting.
- **Mean word length is a measured proxy for text difficulty, and the equation is one line.**
  Brysbaert, Sui, Duyck and Dirix 2021 (QJEP 74): for English, *"By taking the equation 238 * 4.6/WL text, the estimate is
  adapted for the text at hand"*, where WL is the text's mean letters per word and 4.6 is the mean
  for English non-fiction (4.2 for fiction, which is where 260 comes from). So a text averaging 5.1
  letters is predicted to read at about 215 wpm, about 10% slower (11% more time).
  **[read, inferred]** — the authors' PDF,
  <https://users.ugent.be/~wduyck/articles/BrysbaertSuiDuyckDirixInPress.pdf>, text extracted on the
  box 2026-10-05. The 4.5 → 270, 5.1 → 238, 6.0 → 202 figures in that paper's abstract are **Dutch**,
  whose baseline is 5.1; the first draft of this doc read them as English, and GPT Sol caught it.
  Rearranged, the English equation says reading time is **letters ÷ 1,095 a minute**.
  The authors caution that word length is a proxy correlated with word frequency, syntax and topic
  familiarity, not evidence that length is the primary cause of the slowdown. **[read]**
- Carver 1976: rate fell from about 315 to 200 wpm as text went from grade 2 to grade 17.
  **[snippet]**.
- Wake Forest's course-workload estimator, for reading to understand each sentence: 250 wpm with
  no new concepts, 180 with some, 130 with many. **[read]**,
  <https://cat.wfu.edu/resources/workload/estimationdetails/>. A teacher's rule of thumb, not an
  experiment. It is the only published number found for *conceptual* load.
- This search found no separate, validated time adjustment for equations, tables or code; the
  word-length model above can predict lower rates for scientific prose with longer words. **[read, inferred]**

## What other products do

- Medium: 265 wpm, plus 12 seconds for the first image tapering to 3. **[read]**, a third-party
  description (<https://www.freecodecamp.org/news/how-to-more-accurately-estimate-read-time-for-medium-articles-in-javascript-fb563ff0282a/>);
  Medium's own page returned 403.
- Kindle measures the reader's own page turns. **[snippet]**. It is the only mainstream product
  found that adjusts for the person, and it does it by measuring, not by asking.
- **No verified difficulty adjustment was found among the mainstream reading apps checked.**
  **[inferred]** Readwise (265) and Pocket (220) are unverified.

## Formulas that need no model

- ARI and Coleman-Liau use only characters, words and sentences. **[read]** (Wikipedia). Flesch,
  Flesch-Kincaid, Fog and SMOG need syllable counts, which code gets wrong on acronyms and technical
  words. Dale-Chall needs a word list.
- Against *human judgement*, they do badly. Cachola, Khashabi and Dredze 2025
  (<https://arxiv.org/abs/2508.19221>): most of eight formulas correlate poorly with human ratings;
  language models did better and "better capture … required background knowledge". **[read]**
  abstract.
- Trott and Rivière 2024 (<https://arxiv.org/html/2410.14028v1>): zero-shot GPT-4 Turbo correlated
  0.76 with teachers' ratings of 4,724 excerpts (r² ≈ 0.58). A regression using word frequency,
  concreteness and age of acquisition explained 36% of the variance (R² 0.36). These are human
  readability judgements, not reading times. **[read]**, checked again in the code review, 2026-10-05.
- **Idea density** is the literature behind the Rovelli point. Kintsch and Keenan 1973: more
  propositions in the same number of words takes longer to read. **[snippet]**. Surface formulas
  cannot see it.
- **The model comparisons read above assess readability judgements, not reading time.** Our search
  found no model study using reading time. GPT Sol,
  reviewing the plan, pointed to one from August 2026
  (<https://link.springer.com/article/10.1007/s11145-026-10888-0>) that it summarised as finding
  model difficulty estimates associated with second-language readers' total reading time, with
  limited extra predictive benefit. **Not read by us** — the page is behind a sign-in.

## The options, and what each can and cannot do

| | What it is | Sees long words | Sees hard ideas in plain words | Cost |
|---|---|---|---|---|
| F0 | words ÷ 238, with the 175–300 range said out loud | no | no | none |
| F1 | Brysbaert's equation: `238 × 4.6 ÷ mean letters per word`, which is body letters ÷ 1,095 | yes — about 11% more time at 5.1 letters | not directly | a stored letter count per article, so the shelf card agrees with the masthead |
| F3 | seconds per figure, Medium-style | — | — | a convention, not evidence |
| M | a model rates language and ideas separately at import | yes | probably | a new call, a stored rating, a multiplier table not calibrated on our readers |
| P | the reader's own pace, from the block times we already record | — | — | only for readers with the experimental switch on, today |

F1 is the published English equation, quoted above. How letters are counted (ours would exclude
maths and code) should match the paper's before it ships.

## Dead ends, and what was not verified

- A sentence-length term: no calibrated term was selected for our estimate. The 2021 authors
  identify sentence length as a correlate of word length, not a separate coefficient we can apply.
- The old repo's intermediate multipliers and how `confidence` became a weight: unknown.
- Brysbaert 2019's full PDF was not read in the original research, so its claims beyond the abstract
  are second-hand. The 2021 co-authored PDF above was read.
- LIX and the Kindle 250 wpm baseline are from memory or commentators.
