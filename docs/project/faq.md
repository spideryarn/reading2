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
The list is **stored** in reading order, ranked by each question's earliest passage; what the reader
**sees first** is the prioritised order below. There are at most twelve, and zero is a real answer:
*"The model found no questions worth asking this piece."*

## A few big questions first, and a threshold

Greg, 2026-09-29, on a dense paper (SPIDERYARN-READING2-5D):

> The FAQ questions seemed pretty kind of dense and low level. I wonder if we could perhaps start
> with a few that are a little bit more high level. Or actually, perhaps we could even consider
> using the same approach we use for the glossary and other places, where we give each question a
> rating for something like how difficult and how central, as well as the ordering. And that way
> then we could have a prioritized ordering by default with a threshold, and the threshold could be
> some compound of difficulty and centrality. And then it would show them in order given that
> threshold.

Since `faq/4`:

- **The prompt asks for up to three broad pressure questions** on the central claim — an objection,
  dependency or tension that remains once the claim is understood, still answered in the piece's
  own passages. *"Why should we believe the main claim?"* and its kin stay banned as summaries.
- **The prompt asks every question for `difficulty` and `centrality`**, 0–1, the Glossary's two
  scores under its names, validated by the same code
  ([`src/score-fields.ts`](../../src/score-fields.ts)). A missing or rejected score stays absent,
  rather than costing the question. Difficulty here is how much of the piece, and how much
  technical detail, a reader needs before the question makes sense.
- **The default order is *prioritised*:** questions under a bar on
  **`centrality × (1 − difficulty)`** are hidden, and the rest are shown highest first, reading order
  breaking ties. *Reading order* is one tap away. The available raw scores are drawn on each row; the
  compound never is. The bar starts at `0.20` and is the reader's to move (`?faqby=`, `?faqbar=` —
  [url-state.md](url-state.md)).
- **Each score is also an order of its own**, since 2026-09-30 — *most central* and *hardest*,
  the Glossary's words for the same two scores. Greg (SPIDERYARN-READING2-67):

  > the prioritisation must be based on some dimension (or more than one). Let's also make it
  > possible to sort by that too (just as in Glossary we can sort by "hardest", "most central" etc,
  > as well as by "prioritised"

  They behave as the Glossary's do: every question, no bar, highest first, a missing score last, and
  each row draws only the score it was placed by. *Hardest* rather than *easiest* first because the
  prioritised order already leads with the approachable questions, so the new view is the one it
  buries. Each button is offered only when some question carries its score
  ([260930d](../plans/260930d-faq-provenance-into-a-tooltip-and-sort-by-centrality-and-difficulty.md)).

**Why not the Glossary's compound.** `difficulty × centrality` measures the cost of *not knowing a
term*, and sends easy-and-central to the bottom — exactly the question Greg asked to see first. So
difficulty is turned round. **Why one number both gates and orders**, where the Glossary gates on
its product and orders by first use: here the order is the request, and with one number the bar
trims the list from the bottom, where two would pull rows out of the middle. Both calls were GPT
Sol's, in review of a plan that had gated on centrality and sorted by difficulty. What it gives
up: a dense but central question falls below an easy peripheral one.

**What the eval found** (six articles, two runs of each prompt, a blind judge —
[260929g](../plans/260929g-faq-difficulty-centrality-and-a-threshold.md) § Progress): the
*ordering* is what moves the opening — the prioritised view beat the same list in reading order
7–1 across two runs — while the prompt's wording on its own was inside the noise of two runs of the
old prompt. Neither let summary questions back in.

**A list from before `faq/4`** has no scores, so it offers no order and no bar and is drawn in
reading order exactly as it was. **Those stay as they are**: the new order is for new articles, and
an owner who wants it re-runs the FAQ from the Metadata page. Greg, 2026-10-01, asked whether to
rebuild existing FAQs across production: *"new articles only"*. The rule and its arithmetic are
[`src/web/faq-order.ts`](../../src/web/faq-order.ts), on the threshold machinery the Glossary and
Citations share ([`src/web/threshold.ts`](../../src/web/threshold.ts)).

**There is no written answer**, and that is the design rather than a gap. The passages are the
answer; a paragraph from the model under each question would be a summary wearing question marks.
The plan's § The one product call says why, and what adding one later would take.

## The promise, and where it stops

An **(i)** at the right-hand end of the order row says both halves, and the second one is not
optional. It was a line in the band's foot until Greg, 2026-09-30 (SPIDERYARN-READING2-62):

> In FAQ mode, move this text […] into a tooltip, e.g. behind an `(i)` icon.

— the move Trajectory made for its own promise (SPIDERYARN-READING2-52). Hover, focus or a tap opens
it; the row is drawn for the (i) alone when a list has no orders to offer.

- **The quoted words are the article's own, checked against it.** `verifyPassage` in
  [`src/faq.ts`](../../src/faq.ts) needs the block to exist and `findQuote(…, "spaced")` to find the
  words in *that* block, then stores the article's slice, never the model's string. An overlong
  quote is dropped rather than cut.
- **Which passage answers which question is the model's reading.** Nothing checks the pairing.

When validation left anything out, a second line in the same card gives the count (questions and
passages together; the kinds are on the artefact and in the stage's log line).

## Not Quiz, not Ideas

Quiz is the article asking *you*, afterwards, and marking your answer ([quiz.md](quiz.md)). Ideas are
the propositions you need to hold, which nobody asks ([ideas.md](ideas.md)). Chat is *your* question,
answered by a model now. FAQ never marks the reader and never writes an answer.

## Making it again

From the Metadata page: *AI processing* has an FAQ row, since 2026-09-29, and it is the only
redo — the panel says nothing when its list was made by an older prompt
([260929c](../plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md)). A press is one
model call; the list is replaced only if the run succeeds. The row is drawn with the experimental
switch off too, as Timeline's and Debate's are. Why it is safe to offer is in
[`src/rerun-steps.ts`](../../src/rerun-steps.ts).

## Who sees it

Asking for one is owner-only, and behind the [experimental switch](experimental-features.md) — which
is also why the add page's *generate the main modes* box does not make one after an import: that
list is every mode outside the switch that makes something, derived in [`src/web/auto-modes.ts`](../../src/web/auto-modes.ts)
([ingest-queue.md § The add page](ingest-queue.md#the-add-page)). **Since
2026-09-29 a visitor to a public article sees a stored FAQ**, drawn from the page's own payload with
no way to ask for another; with none stored they are told nobody has built one (SPIDERYARN-READING2-56,
[260929c](../plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md)).

## Deferred

A written short answer; questions the piece leaves open; inherited question ids; moving the Glossary's and Citations' sliders onto the shared
[`ThresholdSlider`](../../src/web/ThresholdSlider.tsx) (plan 260929g); *Ask about this*, a
per-row button into an anchored Chat; marks in the prose and a `?faq=` selection; the reader's
profile shaping the questions; real FAQs from readers' own comments. Each is in the
plan's § Deferred, with the reason.

## The code

[`src/faq.ts`](../../src/faq.ts) (the stage) · [`useFaq.ts`](../../src/web/useFaq.ts) ·
[`FaqPanel.tsx`](../../src/web/FaqPanel.tsx) · [`faq-order.ts`](../../src/web/faq-order.ts) ·
[`FaqMode.tsx`](../../src/web/modes/faq/FaqMode.tsx) ·
[`faq.css`](../../src/web/styles/faq.css).

Up: [reading-view-overview.md](reading-view-overview.md)
