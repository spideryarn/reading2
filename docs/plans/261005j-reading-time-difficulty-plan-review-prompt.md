# Plan review: the reading-time estimate knows how hard the piece is

You are reviewing a plan before it is built. **Read-only: change no files.**

Read, in this order:

1. `docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md`
   — the plan under review.
2. `docs/research/261005a-reading-time-estimates-and-text-difficulty.md` and
   `docs/plans/261005c-reading-time-estimate-says-its-rate-its-range-and-what-it-does-not-know.md`
   — what came before it.
3. The code it touches: `src/reading-time.ts`, `src/web/ReadTimeCard.tsx`, `src/web/stats.ts`,
   `src/library-scalars.ts`, `src/paper-metadata.ts` (the precedent for the call),
   `src/ai-call.ts` § `AI_JOB_ROUTE` and `CHAT_REASONING`, `src/pipeline.ts` § the `extract` step
   and `withArticleRegistry`, `src/store/artifacts-pg.ts` § `META_COLUMNS` and `metaColumns`,
   `src/store/pg-revisions.ts` § `REVISION_CARRY_POLICY`, `src/store/pg.ts` §
   `REVISION_READ_POLICY`, `src/store/public-reader.ts` § `PUBLIC_PROJECTIONS`,
   `src/public/dto.ts`.
4. `CLAUDE.md`, for the house rules: simplest version first, prefer boring, let the types catch it,
   store when it happened, a sentence is not a fix.

Evidence the plan's numbers rest on, which you cannot re-fetch from the sandbox, quoted from the
sources as read on 2026-10-05:

- Brysbaert 2019 (preprint, p. 33–34): "Britton et al. (1978) observed reading rates of 262 wpm
  for the easy texts, against 182 wpm for the difficult texts." "Miller and Coleman (1971) noticed
  that text difficulty correlates very well with word length. If instead of words per minute, they
  used letters per second as dependent variable, the effect of text difficulty on silent reading
  rate disappeared (see also Carver, 1976, 1983; Coke, 1974)." "The average word length of the two
  easy text passages was 4.2 letters; that of two most difficult passages was 5.4 letters. This
  translates to expected reading rates of 238 * 4.6/4.2 = 261 wpm for the easy texts (262 wpm
  obtained) and 238 * 4.6/5.4 = 203 wpm for the difficult texts (182 wpm obstained)."
- Carver 1997, *One second, one minute, one year of reading* (p. 13–14), on his 1976 data from
  college students: "when reading rate is measured in actual words per minute, wpm, the dashed
  line shows that reading rate decreases rapidly from a high of about 320 wpm for passages at
  Grades 1 to 3 difficulty to a low of about 200 wpm for passages at Grades 16 to 18 difficulty."
  In standard-length words: "Reading rate was approximately constant all the way from passages at
  Grades 1 to 3 in difficulty up to passages at Grades 13 to 15 in difficulty, varying only from
  about 250 to 270 Wpm. However, when the passages became relatively hard for these college
  students at Grades 16 to 18 in difficulty, rate dropped off to around 200 Wpm."
- Wake Forest's workload estimator, reading to understand: 250, 180 and 130 words a minute for no,
  some and many new concepts. The page ties no cell to a source.
- Our own recorded per-block reading times, production, read-only: 12 articles with at least 8
  body paragraphs whose time was between 0.5× and 3× the flat estimate; 11 are academic papers
  (mean word length 5.0–5.5) in one reader's library; the per-article median ratio of time spent to
  flat time has a median of 1.19 across them (range 0.72–2.42). Word length alone predicts about
  1.13 for them.

What I want from you:

1. **Is the design the simplest one that does what Greg asked?** In particular: the rating made
   inside the `extract` step and stored through `Meta`, against a table of its own or a pipeline
   step of its own; and the decision not to piggyback on `structure`. If a simpler or safer shape
   exists, say which and why.
2. **Will storing it through `Meta` and `META_COLUMNS` do something the plan has not seen?** Every
   column there is written `?? null` on every `meta` write. Find every writer of the `meta`
   artefact (the `metadata` step, `extract` on both paths, anything that rewrites `meta` later —
   a rename, the registry, *Read this*) and say whether any of them would clear a rating it should
   keep, or keep one it should clear. Is `carry` the right policy?
3. **The numbers.** Do the two tables and the bounds follow from the quoted evidence? Is
   multiplying the two defensible given that word length and conceptual load are correlated? Is
   anything overclaimed?
4. **The sample.** Is rating from about 3,000 sampled words inside `extract` sound, given that
   `extract` has the extracted HTML and not yet the blocks (so it does not yet know which
   paragraphs are notes)? Would the `blocks` step, or the start of `structure`, be a better place,
   and what would that cost?
5. **Stage 3 is held back** because the paid check cannot be run. Is the split safe — can stages 1
   and 2 land on `dev` with nothing rated and nothing misleading on screen? Is anything in stages
   1–2 unverifiable without the paid run?
6. **The tests.** Which of the listed tests could pass while the feature is broken? What is
   missing?
7. Anything else: the public DTO, the export, the privacy page's sentence about what DeepSeek is
   used for, cost attribution, the cached shelf in the browser.

Give a verdict (APPROVE, APPROVE WITH CHANGES, or REWORK), then numbered findings, most serious
first, each with the file and line that grounds it and what you would do instead. Say plainly where
you are unsure or could not check.
