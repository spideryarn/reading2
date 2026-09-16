# FAQ — the questions a careful reader would ask this piece, and where it responds

A mode in the band between the spine and the prose. It lists the questions a careful first-time
reader would put to the piece *while reading it* — the objection it anticipates, the move that needs
clarifying, how one part bears on another — and under each, **the passages where the piece itself
responds**. It is [vision.md](vision.md)'s *interrogate*, worked out in advance: every row leads back
into the prose. Asked for by an admin through the Feedback button on 2026-09-12
(SPIDERYARN-READING2-3A):

> Add FAQ (frequently asked questions) mode as a new experimental features mode.

The design, the two reviews that reshaped it and the real runs are
[260916d-faq-mode.md](../plans/260916d-faq-mode.md). This page says what is built.

## A row

The question, one sentence in the article's own terms; then one to three passages, in document
order, each a quotation drawn with the solid left rule that Ideas and the Glossary use for *what
comes from the article*, with a jump to its paragraph ([`BlockRef`](../../src/web/BlockRef.tsx)).
Questions are in reading order, ranked by their earliest passage. There are at most twelve, and
zero is a real answer: *"The model found no questions worth asking this piece."*

**There is no written answer**, and that is the design rather than a gap. The passages are the
answer; a paragraph from the model under each question would be a summary wearing question marks.
The plan's § The one product call says why, and what adding one later would take.

## The promise, and where it stops

The foot says both halves, and the second one is not optional:

- **The quoted words are the article's own, checked against it.** `verifyPassage` in
  [`src/faq.ts`](../../src/faq.ts) needs the block to exist and `findQuote(…, "spaced")` to find the
  words in *that* block, then stores the article's slice, never the model's string. An overlong
  quote is dropped rather than cut.
- **Which passage answers which question is the model's reading.** Nothing checks the pairing.

When validation left anything out, a quiet line under the promise gives the count (questions and
passages together; the kinds are on the artefact and in the stage's log line).

## Not Quiz, not Ideas

Quiz is the article asking *you*, afterwards, and marking your answer ([quiz.md](quiz.md)). Ideas are
the propositions you need to hold, which nobody asks ([ideas.md](ideas.md)). Chat is *your* question,
answered by a model now. FAQ never marks the reader and never writes an answer.

## Who sees it

Owner-only, and behind the [experimental switch](experimental-features.md). A visitor gets the
explanatory band — no public projection of the `faq` column is built.

## Deferred

A written short answer; questions the piece leaves open; inherited question ids; *Ask about this*, a
per-row button into an anchored Chat; marks in the prose and a `?faq=` selection; the reader's
profile shaping the questions; a visitor's list; real FAQs from readers' own comments. Each is in the
plan's § Deferred, with the reason.

## The code

[`src/faq.ts`](../../src/faq.ts) (the stage) · [`useFaq.ts`](../../src/web/useFaq.ts) ·
[`FaqPanel.tsx`](../../src/web/FaqPanel.tsx) ·
[`FaqMode.tsx`](../../src/web/modes/faq/FaqMode.tsx) ·
[`faq.css`](../../src/web/styles/faq.css).

Up: [reading-view-overview.md](reading-view-overview.md)
