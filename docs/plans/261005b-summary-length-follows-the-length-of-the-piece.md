# Summary's length follows the length of the piece

Up: [plans.md](../project/plans.md) · the mode: [summaries.md](../project/summaries.md)

**Status: plan, before review.**

## What it is for

Greg, 2026-10-04, from Summary's Fuller view of a book (`spya-gttwhn`, admin, so trusted input):

> The length of the summaries should somewhat reflect the length of the text. Not linearly. But a
> book will surely need (at least somewhat) longer summaries than a short article. Hopefully we can
> add a tweak to the prompts to this effect.

Today Brief is asked for about 80 words and Fuller for about 500, whatever the piece. The only
allowance is one sentence in Fuller's prompt, *"Shorter is fine for a short piece"*.

**What that does today**, one write each on Opus with the guard on, before any change
(`evals/results/simple/high-none-len0a`):

| piece | its words | Brief | Fuller |
|---|---:|---:|---:|
| *Keep Your Identity Small* (an essay) | 879 | 88 | 402 |
| *Haters* (an essay) | 1,398 | 98 | 553 |
| *Geometric Deep Learning* (a book) | 49,462 | 113 | 489 |

So the length does not follow the piece in either direction: a Fuller summary of an 879-word essay
is nearly half as long as the essay, and a book gets no more than an essay does.

## The change

**Four length bands, chosen by the body's word count, each with its own numbers in the prompt.**
The band is picked in code from the words of the body-evidence blocks the request sends (the same
set the prompt shows), and the level's system prompt is built for that band.

| band | body words | Brief: shape · about · never | Fuller: shape · about · never |
|---|---|---|---|
| `short` | under 2,500 | two short paragraphs · 60 · 100 | three to five paragraphs · 250 · 330 |
| `standard` | 2,500 to 14,999 | **as today** · 80 · 130 | **as today**, five to eight · 500 · 600 |
| `long` | 15,000 to 39,999 | two or three short paragraphs · 110 · 160 | six to nine paragraphs · 700 · 820 |
| `book` | 40,000 and up | three short paragraphs · 140 · 190 | seven to ten paragraphs · 900 · 1,050 |

- **Not linear, as asked.** From the short band to the book band the piece grows more than
  twentyfold and Fuller's ask grows 3.6 times, Brief's 2.3 times.
- **The standard band's two prompts do not change by a byte.** Most articles are in it, so most
  summaries are written exactly as they are now, and the measurement only has to cover the three
  new bands. A test pins those bytes (the hashes `tests/simple-two-levels.test.ts` already holds).
- **The long and book bands gain one sentence**, because a longer summary of a long piece has a
  known way to go wrong, which is spending itself on the opening: *"This is a long piece. Cover the
  whole of it, the later parts as well as the opening, and give each main part its share."* It
  ships only if the measurement shows it does no harm; the numbers alone are the fallback.
- **Everything else in the prompt is the same in every band**: the reader, the shape, the fidelity
  rules, the doors, bold and bullets, plain words, paperwork, the profile.
- **The prompt version becomes `simple-prompt/9`.** Every stored summary becomes *outdated*, which
  is silent, and none is rewritten for it: an unforced run skips a stored summary whatever its
  prompt's age. Metadata's Rerun, and *Write it again* when it is offered, write the new length.
  So Greg's Rovelli summary changes when he presses Rerun on it, and not before.

### The stored limits rise, once, for every band

`SIMPLE_LIMITS` in `src/types.ts` is the hard cap that both the writer and every reader enforce:
over it, the write fails and stores nothing. It has to clear the book band's "never":

| | today | proposed |
|---|---|---|
| Brief | 2 to 3 paragraphs, 240 words | 2 to 4 paragraphs, 300 words |
| Fuller | 3 to 8 paragraphs, 850 words | 3 to 12 paragraphs, 1,400 words |

The minimums stay, so every stored summary still reads. The answer's token budget
(`ANSWER_TOKENS`) is computed from these limits and grows with them.

**What this gives up:** the cap is one number per level, not per band, so a standard-band Fuller
that ran to 1,000 words would now be stored where today it fails the write. The prompt's own
"never more than 600" is what holds the length, as it does today (the cap was already 250 over
it). A per-band cap is the alternative, and it is passed over: the reader-side check
(`isSimpleParagraphs`) has no article to measure, so a per-band cap could only be enforced at
write time, and two caps that disagree is more machinery than the risk is worth.

**A rollback** of the code after a book-length summary is stored would make that one summary read
as absent (over the old cap), and the next open would offer to write it. Nothing is lost that a
press does not put back.

## The simpler option passed over

**One sentence in the prompt, and no code**: *"Let the length follow the piece: shorter for a short
piece, longer for a book."* It is what the prompt nearly says already, and the table above is what
that gets: 402 words for an 879-word essay. A model given a number writes to the number. And a
book's summary could not get much longer in any case, because the prompt's "never more than 600"
and the stored cap of 850 would both still be there. Telling the model the piece's word count and
asking it to choose is the same idea with one more step, and it leaves the stored cap as the only
thing that knows what length was meant.

**A formula instead of bands** (say, the square root of the word count) gives every article its own
prompt. Bands give four prompts that can each be read, pinned by a test and measured.

## What it costs

- **A longer wait for Fuller on a long piece.** Brief is shown first (since 2026-10-04), so the
  wait is for Fuller alone. The measurement records it.
- **A little more money on a long piece**: a few hundred more answer tokens on a write whose cost
  is almost all the article itself ($0.77 for the book above).
- **A shorter wait and a slightly cheaper write on a short piece.**

## Stages

One stage; it is small.

1. `src/simple-summary.ts`: `SimpleBand`, `bandFor(bodyWords)`, `PITCH` per band,
   `simpleSystem(level, band)`. `SIMPLE_SYSTEMS` stays as the standard band's pair, so everything
   that pins it still does; `SIMPLE_SYSTEMS_BY_BAND` holds all four. `generateSimpleSummary`
   counts the evidence's words and picks the band. `src/types.ts`: the limits.
2. Tests, red first: the thresholds at their edges; each band's asks; the standard band's bytes
   unchanged; the request for a short and a book-length article carries that band's prompt; a
   Fuller of ten paragraphs and 1,000 words is stored.
3. Measure (below), and write it up in
   [docs/investigations/261005a](../investigations/261005a-summary-length-bands-measured.md).
4. Docs: [summaries.md](../project/summaries.md) gains a section and its "about 500" lines are
   qualified; `/help` if it states a length.
5. GPT Sol on the code, the gates, push to `dev`, the feedback note.

No UI changes, so no browser check: the panel draws however many paragraphs it is given, and eight
is already drawn today. One thing is checked in a browser anyway if cheap: a ten-paragraph Fuller
in the band on a phone.

## Measuring it

By [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change),
with `evals/simple/probe.ts`, which calls production's own `generateSimpleSummary`.

- **Articles.** Two short (879 and 1,398 words), one long (about 17,000 to 23,000), one book
  (49,462). **The Rovelli book is not in the local database**, and a session's production reads
  are refused, so *Geometric Deep Learning* stands in for it: about the same length. One run on a
  piece over 100,000 words checks the top of the range works at all.
- **Before, twice** (`len0a`, `len0b`): the second is the control, for how much two writes of one
  prompt differ in length.
- **After, twice** (`len1a`, `len1b`), on the commit with the change.
- **What is compared.**
  1. *Length*: each level's words against its band's ask and "never", and against the control's
     spread. No write may fail on a limit.
  2. *Is the extra length worth reading?* A length change cannot be judged blind for length, since
     the longer one is visibly longer. So a fresh subagent that sees only the pairs, sides
     shuffled, answers per pair: does either repeat itself or pad; does either state something
     that reads as bent or blurred; and for the book, which one covers more of the piece's parts.
     The table of contents is given for that last question.
  3. *Fidelity*: the guard's record on each write (flags, retries).
  4. *The wait* to Brief and to Fuller, and the cost.
  5. Reading every output myself, as the guide says.
- **The short band is a cut**, so its question is the opposite one: did the shorter Fuller lose
  something a reader needed? The same judge is asked which of the pair it would rather have before
  reading the essay.

## Open, for Greg (asked in the debrief, not waited on)

- **[Q-summary-length-numbers]** whether these four rows are the lengths he wants. They are easy
  to change: one table in `src/simple-summary.ts`.
- **[Q-brief-grows-too]** whether Brief should grow at all for a book. The plan grows it modestly
  (80 to 140 words), because he wrote "summaries", plural. The alternative is that Brief stays the
  one-glance answer at every length and only Fuller grows.

## Ledger

(filled in as the work lands)
