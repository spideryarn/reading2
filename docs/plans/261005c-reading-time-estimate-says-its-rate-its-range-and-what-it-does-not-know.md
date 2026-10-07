# The reading-time estimate says its rate, its range, and what it does not know

Up: [plans.md](../project/plans.md) · Report `spya-jew7ds` (Greg, 2026-10-04) · Research:
[261005a](../research/261005a-reading-time-estimates-and-text-difficulty.md)

> We estimate the number of minutes to read. Does this take into account the difficulty? […] For
> example, this Carlo Rovelli book uses fairly simple language for complex ideas, so our difficulty
> ratings should take into account both dimensions. And also perhaps the user's profile.
>
> Create a rich tooltip that explains the estimate of reading time, reused both at the top of article
> and in Metadata.
>
> — Greg, 2026-10-04

## What we are building

1. **One card, two places.** `ReadTimeCard` in `src/web/ReadTimeCard.tsx`, shown on the masthead's
   `~47 min` and on Metadata's *Read time* tile. Short paragraphs, per
   [tooltips.md](../project/tooltips.md):
   - *About 47 minutes to read* (head)
   - *11,200 words at 238 words a minute, the average for an adult reading English non-fiction
     silently.* (A piece too short for that to make a minute adds *Never shown as less than a
     minute.*)
   - *Most adults read such text at between 175 and 300 words a minute, which would be about 37–64
     minutes.*
   - *The estimate does not know how hard this piece is, or who is reading it. Dense ideas, maths,
     figures or an unfamiliar subject can all take longer.*
   - *2,400 words of notes set apart from the main text are not counted.* (only when there are some)
2. **238, not 230**, and cited: Brysbaert 2019. The range is his too. `src/reading-time.ts` gains
   `readingRange(words)`; the numbers stay in that one module.
3. **The gutter's own 230 stays.** `src/web/reading-time.ts` § `READING_WPM` is the unit of a
   brightness scale Greg tuned by eye, shared with the quiz's "read" boundary; moving it would
   reclassify recorded time near each boundary. It is said to the reader in one place, the gutter
   line's card (*"It takes about … to read"*), 3% away from the masthead's rate. Known, commented at
   the constant, and left. (The first draft of this plan merged the two; a dozen threshold tests
   showed what that would move.)
4. **Both triggers can be reached by a keyboard**: the masthead's minutes and Metadata's tiles are
   focusable. A tap already opens a `Tooltip` (checked in a browser at iPad and phone widths).

The headline number on the shelf card, the masthead and Metadata stays one formula, so they cannot
disagree.

## What we are not building, and why

**A difficulty adjustment to the number itself.** Greg's question is the right one and the research
answer is: not cheaply, not yet.

- The cheap formula is real and published: reading time is letters ÷ 1,095 a minute (Brysbaert
  2021), about 11% more time for a text averaging 5.1 letters a word. But it sees long words, not hard
  ideas in plain ones, which is the example in the report.
- It also needs a new stored number per article (a letter count), or the shelf card and the
  masthead disagree. That is a schema change and a backfill, so it is Greg's to choose.
- A model's rating could see hard ideas in plain words, but it has not been validated against
  reading time on our articles and readers, and the old version adopted one unchecked. The per-block
  times we record are a lead for that check, not yet a calibration.

This goes to Greg as a question in the debrief, not as a silent default.

## The simpler option passed over

Changing only the Metadata tile's sentence. It leaves the masthead, where the number is first read,
with no explanation, and Greg asked for both.

## Stages

One stage: the module, the card, the two call sites, tests, docs
([library.md](../project/library.md) owns the estimate's line; tooltips need none). GPT Sol reviews
this plan, then the code. A Sonnet subagent checks the card at desktop, iPad and phone widths.

## Tests, seen red first

- `readingRange`: quick ≤ typical ≤ slow, never under one minute, uses `WPM`.
- The card: renders the words, the rate, the range and the "does not know" sentence; the supplement
  line only when there are supplement words.
- Masthead and Metadata both render the same card for the same article (one assertion across both).

## Log

- 2026-10-05: research done; plan written.
- 2026-10-05: GPT Sol's plan review, APPROVE WITH CHANGES, seven findings. Taken: the English
  word-length equation (the research had read the Dutch figures as English and fitted a slope);
  the card's wording (rates not a promise, *English*, *can* take longer, *who is reading it*, notes
  *set apart*); Metadata's tile focusable; softer claims about model ratings and about our recorded
  times; the false "not said to a reader" about the gutter's 230. Not taken: native buttons with
  `usePressToggle` at both sites — a tap opens the card already, seen in the browser check, and a
  button that does nothing when pressed is a worse control than a focusable fact.
- 2026-10-05: browser check (Sonnet, Playwright): desktop, iPad and phone, masthead and Metadata,
  hover, Tab and tap, on two articles. All passed; light theme and an article with no notes not seen.
- 2026-10-05: GPT code review of 759bb1257: qualified the population range and its conversion to
  minutes, explained rounding and the one-minute minimum, corrected research overclaims and the
  comparison of r with R². Tests now compare the displayed minutes with the shelf's derivation for
  short and book-length pieces, check both viewer shapes and all six tiles' descriptions, and were
  seen fail with either card removed and with Metadata's displayed minutes changed. Targeted
  card/block-policy/doc-link suites: 60 passed; typecheck and scoped lint passed. The sandbox
  blocked tsx's CLI socket, so typecheck ran via `node --import tsx scripts/typecheck.ts`; it also
  blocked Chrome at launch, so the wrap test and touch checks could not be rerun in this review.
- 2026-10-05: after the review, the card's two lengthened sentences were cut back (the floor is
  explained only on a piece short enough to show it), and the two stale mentions of 230 the review
  left as out of scope were corrected (`Dock.tsx`, `borrow-list.md`).
