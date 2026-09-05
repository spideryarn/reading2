# Review prompt: mark every visible quote, and lean the quiz prompt easier

The answer is in [260905g-…-review-sol.md](260905g-mark-every-visible-quote-and-make-the-quiz-start-easier-review-sol.md).
Up: [260905g](260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md)

You are reviewing built code (not a plan), in the repo
`/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating`. Read the files in the
repo directly wherever you need more than the diff shows. The scoped diff is
`/tmp/claude-1000/-home-greg-code-spideryarn2/3e5ba01a-9316-48b6-b169-6eb2630f80ba/scratchpad/review-diff.txt`.

**Ignore one hunk**: in `src/web/App.tsx` around line 454, `<FeedbackButton readerEmail=… />` →
`<FeedbackButton />`. That is another agent's live work in the same shared file and is not part of
this change.

## What the change is

Two user feedback reports from the site's owner.

### A — quotes mode marks every visible quote, not only the selected one

`useQuotesMode` in `src/web/App.tsx` used to resolve *the selected quote* into `Found[]` and return
`[]` otherwise, so the article showed no marks until a row was pressed. It now resolves the whole
list the panel is showing.

- `markedQuotes(quotes, rank, bar)` was extracted into `src/web/QuotesPanel.tsx` — `snapToStop` →
  `effectiveRank` → `rankQuotes` — and is called by **both** the panel (for its rows) and the hook
  (for the marks), so the rows and the washes are one set. In `prioritised` rank that list is
  thresholded, which makes the existing `?bar=` slider double as the highlight-density control.
- `resolveQuote` (singular) in `src/web/search-hits.ts` became `resolveQuotes` (plural). Every quote
  now gets the **same** `runId` (`QUOTES_RUN = "quotes"`) and `slot: 0`. Reason: the rail packs one
  lane per run id (`laneOrder` in `src/web/spine-marks.ts`) into a 10px gutter, so a run id per quote
  would give ~16 overlapping 1.5px lanes ordered by an arbitrary id string. The per-quote identity
  stays in `Found.key`, built by the new exported `quoteMarkKey(id, blockId)`.
- The pressed quote now gets `mark.hit[data-hit-open]`: a `quoteOpenKey` state in `Reader`, threaded
  through `QuotesBand` / `VisitorQuotesBand` as `onOpenKey`, pushed from the band in the **same**
  layout effect as `onFound`, and cleared on unmount.
- `src/quotes.ts`: `MAX_QUOTES` 16 → 32, `suggestedQuotes` one per ~600 words clamped 4–16 → one per
  ~300 clamped 8–32, `PROMPT_VERSION` `quotes/2` → `quotes/3`. `STEP_BUDGET_MS.quotes` 120s → 180s.

Tests: new `tests/quote-marks.test.ts` (behaviour), new assertions in
`tests/glossary-band-wiring.test.ts` (source-level wiring, in the style already there),
`tests/quotes.test.ts` updated for the new counts.

### B — the quiz prompt leads easier

`QUIZ_SYSTEM` in `src/quiz.ts`: `easy` redefined against the reader, spread target three-and-three →
**five easy and two hard**, a new `MOST OF THE BATCH IS ABOUT WHAT MATTERS MOST` section, and
`PROMPT_VERSION` `quiz/2` → `quiz/3`.

**`missingBandEnds` was deliberately not touched** and no number went back into it — a proportion
there caused a production build failure on 2026-09-03 and was deleted rather than retuned
(`docs/plans/260903c-…`). The gate still refuses a batch missing an end outright, which is why the
prompt still asks for `hard` questions **by name** even though the point of the change is fewer of
them.

Evidence: one generation run each side of the edit on the same article and model —
`evals/results/quiz.md` (before, 4 easy / 3 medium / 4 hard, 5 of 11 at value 4-or-5) and
`evals/results/quiz-easier-2026-09-05.md` (after, 6 / 3 / 3, 10 of 12 at value 4-or-5).

## What I want from you, in priority order

1. **Correctness bugs in A.** Especially: effect ordering and the unmount clear now that two
   callbacks are pushed together; the `hiddenSelection` memo, which still guards on
   `effectiveRank(...) !== "prioritised"` — I kept that guard deliberately because `listed` is empty
   while the artefact is being fetched and an unguarded "is my quote in the visible list" would strip
   a shared `?quote=` out of the URL before its own data arrived. Is that reasoning right, and is
   there a state where the guard now lets a hidden selection stay selected?
2. **The shared `runId`.** Does anything downstream of `Found.runId` break when many passages share
   one — `blockMatches`, `blockHues`, `spineMarks`, `orderFound`, `hitMarks`, `SearchPanel`? Note
   quotes mode and search mode are mutually exclusive (`passages` in `Reader` is a pick, not a merge).
3. **Anything that gets quietly worse at 32 quotes rather than 5** — token budget
   (`answerTokens = 500 + count * 220`), the 180s step budget, overlapping marks in one paragraph,
   `dedupeOverlaps`, the paragraph bar, render cost of `annotateHtml`.
4. **The quiz prompt.** Is there a way this edit makes a batch *more* likely to trip
   `missingBandEnds` (which throws and loses a paid build)? And does the new VALUE section fight the
   existing "band and value are different axes and must not be collapsed" rule?
5. Anything in the prose of the comments or docs that is now false.

Be concrete: file, symbol, what breaks, and what you would do instead. Say plainly if a finding is a
guess. Do not rewrite the code.
